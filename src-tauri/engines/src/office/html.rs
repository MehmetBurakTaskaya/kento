// SPDX-License-Identifier: MIT
//! HTML for Writer's import, made safe for an app that stays on the computer: nothing left in it
//! can make LibreOffice fetch anything (SPEC 2, privacy).
//!
//! - Pictures keep only `data:` URLs of raster images. A relative `src` becomes one when the caller
//!   finds the file (beside the original page, or inside the EPUB); any other picture goes.
//! - Every other attribute that loads something (`src`, `href` outside links, `poster`,
//!   `background`, `data`, `action`, …) keeps only a fragment (`#id`).
//! - Scripts, comments (which can hide markup), `<base>`, `<link>`, refresh and charset `<meta>`
//!   go; CSS loses `@import` and every `url()` that is not a picture's `data:` URL.
//! - Links (`<a href>`) stay: they are written into the result, never loaded.

use std::fs;
use std::path::PathBuf;

use super::base64;
use crate::text::decode_entities;

/// Each picture read from disk stays under this size, and all of them together under the next.
const MAX_PICTURE: u64 = 32 << 20;
const MAX_PICTURES: u64 = 256 << 20;

/// Rewrites `html` as described above. `picture` gets the `src` of a picture that is a relative
/// reference and returns the `data:` URL to use, or None to drop the picture.
pub(super) fn clean(html: &str, picture: &mut dyn FnMut(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(html.len() + 64);
    let mut at = 0;
    while let Some(offset) = html[at..].find('<') {
        let start = at + offset;
        out.push_str(&html[at..start]);
        let rest = &html[start..];
        at = if let Some(comment) = rest.strip_prefix("<!--") {
            comment
                .find("-->")
                .map_or(html.len(), |end| start + 4 + end + 3)
        } else if starts_with_ignore_case(rest, "<![cdata[") {
            rest.find("]]>").map_or(html.len(), |end| start + end + 3)
        } else if rest.starts_with("<?") {
            // Processing instructions, such as a stylesheet named in XHTML.
            rest.find('>').map_or(html.len(), |end| start + end + 1)
        } else if rest.starts_with("<!") || rest.starts_with("</") {
            let end = rest.find('>').map_or(html.len(), |end| start + end + 1);
            out.push_str(&html[start..end]);
            end
        } else if rest[1..].starts_with(|c: char| c.is_ascii_alphabetic()) {
            // A tag that never closes takes the rest of the page with it.
            let Some(tag) = Tag::parse(rest) else {
                at = html.len();
                break;
            };
            let after = start + tag.len;
            match tag.local.as_str() {
                "script" => {
                    let end = end_tag(html, after, "script");
                    html[end..]
                        .find('>')
                        .map_or(html.len(), |close| end + close + 1)
                }
                "style" => {
                    let end = end_tag(html, after, "style");
                    if let Some(open) = tag.rebuild(picture) {
                        out.push_str(&open);
                    }
                    out.push_str(&clean_css(&html[after..end]));
                    end
                }
                _ => {
                    if let Some(open) = tag.rebuild(picture) {
                        out.push_str(&open);
                    }
                    after
                }
            }
        } else {
            out.push_str("&lt;");
            start + 1
        };
    }
    if at < html.len() {
        out.push_str(&html[at..]);
    }
    out
}

fn starts_with_ignore_case(text: &str, prefix: &str) -> bool {
    text.len() >= prefix.len()
        && text.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
}

/// Where `</name` starts at or after `from`, or the end of the page.
fn end_tag(html: &str, from: usize, name: &str) -> usize {
    let needle = format!("</{name}");
    let bytes = html.as_bytes();
    (from..bytes.len())
        .find(|&i| {
            bytes[i] == b'<' && bytes[i..].len() >= needle.len() && {
                bytes[i..i + needle.len()].eq_ignore_ascii_case(needle.as_bytes())
            }
        })
        .unwrap_or(html.len())
}

/// What an attribute value points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ref {
    Empty,
    Fragment,
    /// A `data:` URL of a raster picture.
    Picture,
    /// Any other `data:` URL (SVG pictures can load others in turn).
    Data,
    Relative,
    /// A scheme (`http:`, `file:`, a drive letter), a protocol-relative or rooted path, a UNC path.
    Elsewhere,
}

fn classify(value: &str) -> Ref {
    let decoded = decode_entities(value);
    let compact: String = decoded
        .chars()
        .filter(|c| !c.is_ascii_whitespace() && !c.is_control())
        .collect::<String>()
        .to_ascii_lowercase();
    if compact.is_empty() {
        Ref::Empty
    } else if compact.starts_with('#') {
        Ref::Fragment
    } else if let Some(data) = compact.strip_prefix("data:") {
        if data.starts_with("image/") && !data.starts_with("image/svg") {
            Ref::Picture
        } else {
            Ref::Data
        }
    } else if compact.starts_with(['/', '\\'])
        || compact
            .find(':')
            .is_some_and(|colon| !compact[..colon].contains(['/', '?', '#']))
    {
        Ref::Elsewhere
    } else {
        Ref::Relative
    }
}

/// Whether an attribute that loads something may keep this value.
fn inert(value: &str) -> bool {
    matches!(classify(value), Ref::Empty | Ref::Fragment)
}

/// Attributes that load what they name, on any element.
const LOADING: &[&str] = &[
    "src",
    "href",
    "poster",
    "background",
    "data",
    "codebase",
    "action",
    "formaction",
    "manifest",
    "profile",
    "archive",
    "classid",
    "usemap",
    "icon",
];

/// Attributes that go whatever they hold: other sources of a picture, and link pings.
const DROPPED: &[&str] = &["srcset", "lowsrc", "dynsrc", "longdesc", "ping"];

struct Attr<'a> {
    /// The attribute as written, name to the end of its value.
    raw: &'a str,
    /// Lowercase, without a namespace prefix (`xlink:href` is `href`).
    local: String,
    value: Option<&'a str>,
}

struct Tag<'a> {
    name: &'a str,
    /// Lowercase, without a namespace prefix.
    local: String,
    attrs: Vec<Attr<'a>>,
    self_closing: bool,
    /// Bytes from `<` to `>` inclusive.
    len: usize,
}

fn local_name(name: &str) -> String {
    name.rsplit(':').next().unwrap_or(name).to_ascii_lowercase()
}

impl<'a> Tag<'a> {
    /// Reads the start tag at the beginning of `text`; None when it never closes.
    fn parse(text: &'a str) -> Option<Tag<'a>> {
        let bytes = text.as_bytes();
        let space = |b: u8| b.is_ascii_whitespace();
        let mut i = 1;
        while i < bytes.len() && !space(bytes[i]) && !matches!(bytes[i], b'/' | b'>') {
            i += 1;
        }
        let name = &text[1..i];
        let mut attrs = Vec::new();
        let mut self_closing = false;
        loop {
            while i < bytes.len() && space(bytes[i]) {
                i += 1;
            }
            match *bytes.get(i)? {
                b'>' => {
                    i += 1;
                    break;
                }
                b'/' => {
                    i += 1;
                    if bytes.get(i) == Some(&b'>') {
                        self_closing = true;
                        i += 1;
                        break;
                    }
                    continue;
                }
                b'=' => {
                    // A stray `=`, read as nothing.
                    i += 1;
                    continue;
                }
                _ => {}
            }
            let start = i;
            while i < bytes.len()
                && !space(bytes[i])
                && !matches!(bytes[i], b'=' | b'>')
                && !(bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'>'))
            {
                i += 1;
            }
            let attr_name = &text[start..i];
            let mut j = i;
            while j < bytes.len() && space(bytes[j]) {
                j += 1;
            }
            let mut value = None;
            if bytes.get(j) == Some(&b'=') {
                j += 1;
                while j < bytes.len() && space(bytes[j]) {
                    j += 1;
                }
                match *bytes.get(j)? {
                    quote @ (b'"' | b'\'') => {
                        let close = text[j + 1..].find(char::from(quote))?;
                        value = Some(&text[j + 1..j + 1 + close]);
                        i = j + 1 + close + 1;
                    }
                    _ => {
                        let begin = j;
                        while j < bytes.len() && !space(bytes[j]) && bytes[j] != b'>' {
                            j += 1;
                        }
                        value = Some(&text[begin..j]);
                        i = j;
                    }
                }
            }
            attrs.push(Attr {
                raw: &text[start..i],
                local: local_name(attr_name),
                value,
            });
        }
        Some(Tag {
            name,
            local: local_name(name),
            attrs,
            self_closing,
            len: i,
        })
    }

    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|attr| attr.local == name)
            .and_then(|attr| attr.value)
    }

    /// The tag as it goes into the page, or None when it goes altogether.
    fn rebuild(&self, picture: &mut dyn FnMut(&str) -> Option<String>) -> Option<String> {
        let local = self.local.as_str();
        match local {
            "base" | "link" => return None,
            "meta" => {
                let equiv = self
                    .attr("http-equiv")
                    .map(|value| value.trim().to_ascii_lowercase());
                if matches!(equiv.as_deref(), Some("refresh" | "set-cookie")) {
                    return None;
                }
                if self.attr("charset").is_some() || equiv.as_deref() == Some("content-type") {
                    // Kento writes every page as UTF-8.
                    return Some("<meta charset=\"utf-8\">".to_owned());
                }
            }
            _ => {}
        }
        let is_picture = matches!(local, "img" | "image")
            || (local == "input"
                && self
                    .attr("type")
                    .is_some_and(|kind| kind.trim().eq_ignore_ascii_case("image")));
        // SVG's <image> becomes <img>, which Writer reads (an EPUB's cover is often one).
        let svg_image = local == "image";
        let mut out = format!("<{}", if svg_image { "img" } else { self.name });
        let mut has_source = false;
        for attr in &self.attrs {
            let name = attr.local.as_str();
            let value = attr.value.unwrap_or("");
            if is_picture && matches!(name, "src" | "href") {
                if has_source {
                    continue;
                }
                has_source = true;
                let source = match classify(value) {
                    Ref::Picture => value.to_owned(),
                    Ref::Relative => picture(decode_entities(value).trim())?,
                    _ => return None,
                };
                out.push_str(&format!(" src=\"{}\"", source.replace('"', "&quot;")));
                continue;
            }
            if svg_image && !matches!(name, "width" | "height") {
                continue;
            }
            if DROPPED.contains(&name) {
                continue;
            }
            if name == "href" && matches!(local, "a" | "area") {
                out.push(' ');
                out.push_str(attr.raw);
                continue;
            }
            if LOADING.contains(&name) {
                if inert(value) {
                    out.push(' ');
                    out.push_str(attr.raw);
                }
                continue;
            }
            if name == "style" {
                let css = clean_css(value);
                out.push_str(&format!(" style=\"{}\"", css.replace('"', "&quot;")));
                continue;
            }
            out.push(' ');
            out.push_str(attr.raw);
        }
        if self.self_closing {
            out.push_str(" /");
        }
        out.push('>');
        Some(out)
    }
}

/// CSS without `@import` rules and with `none` for every `url()` that is not a picture's
/// `data:` URL.
pub(super) fn clean_css(css: &str) -> String {
    let lower = css.to_ascii_lowercase();
    let mut out = String::with_capacity(css.len());
    let mut at = 0;
    loop {
        let import = lower[at..].find("@import").map(|i| i + at);
        let url = lower[at..].find("url(").map(|i| i + at);
        let next = match (import, url) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => break,
        };
        out.push_str(&css[at..next]);
        if Some(next) == import {
            at = after_rule(css, next);
            continue;
        }
        let inner = next + 4;
        let close = closing_paren(css, inner);
        let target = css[inner..close]
            .trim()
            .trim_matches(|c| c == '"' || c == '\'');
        let end = (close + 1).min(css.len());
        if classify(target) == Ref::Picture {
            out.push_str(&css[next..end]);
        } else {
            out.push_str("none");
        }
        at = end;
    }
    out.push_str(&css[at..]);
    out
}

/// Just past the `;` that ends the at-rule starting at `from`, outside quotes.
fn after_rule(css: &str, from: usize) -> usize {
    let mut quote = None;
    for (i, c) in css[from..].char_indices() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, ';') => return from + i + 1,
            _ => {}
        }
    }
    css.len()
}

/// The `)` that closes a `url(` whose content starts at `from`, outside quotes.
fn closing_paren(css: &str, from: usize) -> usize {
    let mut quote = None;
    for (i, c) in css[from..].char_indices() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, ')') => return from + i,
            _ => {}
        }
    }
    css.len()
}

/// Pictures beside the original page (`pictures/a.png` next to `page.html`), read only from that
/// folder and below, as `data:` URLs.
pub(super) struct LocalPictures {
    base: Option<PathBuf>,
    left: u64,
}

impl LocalPictures {
    pub(super) fn new(base: Option<PathBuf>) -> Self {
        LocalPictures {
            base,
            left: MAX_PICTURES,
        }
    }

    pub(super) fn data_url(&mut self, src: &str) -> Option<String> {
        let base = self.base.as_ref()?;
        let parts = relative_parts(src)?;
        let kind = picture_type(parts.last()?)?;
        let path = parts
            .iter()
            .fold(base.clone(), |path, part| path.join(part));
        let size = fs::metadata(&path)
            .ok()
            .filter(|meta| meta.is_file())?
            .len();
        if size > MAX_PICTURE || size > self.left {
            return None;
        }
        let bytes = fs::read(&path).ok()?;
        self.left = self.left.saturating_sub(bytes.len() as u64);
        Some(data_url(kind, &bytes))
    }
}

pub(super) fn data_url(kind: &str, bytes: &[u8]) -> String {
    format!("data:{kind};base64,{}", base64(bytes))
}

/// The parts of a relative URL path, percent-decoded, without query or fragment; None when it
/// climbs out of its folder (`..`) or names a drive or stream (`:`).
pub(super) fn relative_parts(src: &str) -> Option<Vec<String>> {
    let src = src.trim();
    let end = src.find(['?', '#']).unwrap_or(src.len());
    let decoded = percent_decode(&src[..end])?;
    let mut parts = Vec::new();
    for part in decoded.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => return None,
            part if part.contains(':') => return None,
            part => parts.push(part.to_owned()),
        }
    }
    (!parts.is_empty()).then_some(parts)
}

/// The media type of a raster picture Writer reads, by its file name.
pub(super) fn picture_type(name: &str) -> Option<&'static str> {
    let extension = name.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "tif" | "tiff" => "image/tiff",
        _ => return None,
    })
}

pub(super) fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &str = "data:image/png;base64,iVBORw0KGgo=";

    fn none(_: &str) -> Option<String> {
        None
    }

    fn cleaned(html: &str) -> String {
        clean(html, &mut none)
    }

    #[test]
    fn office_html_remote_references_go() {
        let page = "<html><head>\
            <base href=\"https://example.com/\">\
            <link rel=\"stylesheet\" href=\"https://example.com/a.css\">\
            <meta http-equiv=\"refresh\" content=\"0; url=https://example.com/\">\
            <script src=\"https://example.com/a.js\">document.write('<img src=x>')</script>\
            <style>@import url(\"https://example.com/b.css\"); body{background:url(//example.com/c.png) no-repeat}</style>\
            </head><body>\
            <p>Çağrı şöyle dedi: ışık 🧪</p>\
            <img src=\"https://example.com/d.png\" alt=\"remote\">\
            <IMG SRC=//example.com/e.png>\
            <img src=\"&#104;ttps://example.com/f.png\">\
            <img src=\"\\\\server\\share\\g.png\">\
            <img src=\"file:///C:/secret.png\">\
            <img src=\"x.png\" srcset=\"https://example.com/h.png 2x\">\
            <video poster=\"http://example.com/i.png\" src=\"ftp://example.com/j.mp4\"></video>\
            <iframe src=\"https://example.com/k\"></iframe>\
            <table background=\"https://example.com/l.png\"><tr><td style=\"background-image: url('https://example.com/m.png')\">x</td></tr></table>\
            <svg><image xlink:href=\"https://example.com/n.png\"/></svg>\
            <a href=\"https://example.com/page\" ping=\"https://example.com/ping\">a link</a>\
            <!--[if IE]><img src=\"https://example.com/o.png\"><![endif]-->\
            </body></html>";
        let out = cleaned(page);
        for gone in [
            "example.com/a.",
            "example.com/b.",
            "example.com/c.",
            "example.com/d.",
            "example.com/e.",
            "example.com/f.",
            "server",
            "secret",
            "example.com/h.",
            "example.com/i.",
            "example.com/j.",
            "example.com/k",
            "example.com/l.",
            "example.com/m.",
            "example.com/n.",
            "example.com/o.",
            "/ping",
            "<script",
            "<base",
            "<link",
            "refresh",
            "document.write",
            "x.png",
        ] {
            assert!(!out.contains(gone), "{gone} is still in {out}");
        }
        assert!(out.contains("<p>Çağrı şöyle dedi: ışık 🧪</p>"));
        assert!(
            out.contains("<a href=\"https://example.com/page\">a link</a>"),
            "links stay: {out}"
        );
        assert!(out.contains("background-image: none"), "{out}");
        assert!(out.contains("body{background:none no-repeat}"), "{out}");
        assert!(out.contains("<video>"), "{out}");
        assert!(out.contains("<table>"), "{out}");
    }

    #[test]
    fn office_html_pictures_become_data_urls_or_go() {
        let out = cleaned(&format!("<p><img src=\"{PNG}\" alt=\"dot\"></p>"));
        assert!(
            out.contains(&format!("<img src=\"{PNG}\" alt=\"dot\">")),
            "{out}"
        );
        let svg = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
        assert!(!cleaned(&format!("<img src=\"{svg}\">")).contains("<img"));

        let mut seen = Vec::new();
        let out = clean(
            "<img src=\"resim%20bir.png?x=1\" width=2><img src='yok.png'>\
             <svg:image href=\"kapak.jpg\" width=\"10\" x=\"3\"/>",
            &mut |src| {
                seen.push(src.to_owned());
                (src != "yok.png").then(|| PNG.to_owned())
            },
        );
        assert_eq!(seen, ["resim%20bir.png?x=1", "yok.png", "kapak.jpg"]);
        assert!(
            out.contains(&format!("<img src=\"{PNG}\" width=2>")),
            "{out}"
        );
        assert!(!out.contains("yok.png"));
        assert!(
            out.contains(&format!("<img src=\"{PNG}\" width=\"10\" />")),
            "an SVG image becomes an img: {out}"
        );
    }

    #[test]
    fn office_html_charset_declarations_say_utf8() {
        let out = cleaned(
            "<head><meta http-equiv=\"Content-Type\" content=\"text/html; charset=windows-1254\">\
             <meta charset=iso-8859-9><meta name=\"author\" content=\"Şule\"></head>",
        );
        assert_eq!(
            out,
            "<head><meta charset=\"utf-8\"><meta charset=\"utf-8\">\
             <meta name=\"author\" content=\"Şule\"></head>"
        );
    }

    #[test]
    fn office_html_odd_markup_stays_harmless() {
        // A `>` inside a quoted value does not end the tag.
        let out = cleaned("<p title=\"a > b\" class=x>t</p>");
        assert_eq!(out, "<p title=\"a > b\" class=x>t</p>");
        // A lone `<` is text; an unterminated tag takes the rest with it.
        assert_eq!(cleaned("1 < 2 <3"), "1 &lt; 2 &lt;3");
        assert_eq!(cleaned("ok <img src=\"https://x"), "ok ");
        // Fragments stay; CDATA and processing instructions go.
        assert_eq!(
            cleaned("<?xml-stylesheet href=\"http://x/s.css\"?><use href=\"#a\"/><![CDATA[<img src=http://x>]]>"),
            "<use href=\"#a\" />"
        );
        // An unclosed script hides nothing after it.
        assert_eq!(cleaned("a<script>b"), "a");
    }

    #[test]
    fn office_html_css_keeps_only_picture_data() {
        assert_eq!(
            clean_css("@import 'x.css'; @import url(\"data:text/css;base64,QA==\");p{color:red}"),
            " p{color:red}"
        );
        assert_eq!(
            clean_css(&format!(
                "a{{background:url( '{PNG}' )}} b{{background:URL(x.png)}}"
            )),
            format!("a{{background:url( '{PNG}' )}} b{{background:none}}")
        );
    }

    #[test]
    fn office_html_references_are_classified() {
        assert_eq!(classify(""), Ref::Empty);
        assert_eq!(classify("#top"), Ref::Fragment);
        assert_eq!(classify("resim.png"), Ref::Relative);
        assert_eq!(classify("klasör/resim.png"), Ref::Relative);
        for elsewhere in [
            "https://example.com/x",
            " HTTP://example.com/x",
            "ht\ttp://example.com/x",
            "//example.com/x",
            "\\\\server\\share\\x",
            "/rooted/x",
            "C:\\x.png",
            "file:///x",
            "smb://server/x",
            "&#x68;ttp://example.com/",
        ] {
            assert_eq!(classify(elsewhere), Ref::Elsewhere, "{elsewhere}");
        }
        assert_eq!(classify(PNG), Ref::Picture);
        assert_eq!(classify("data:text/html,<p>"), Ref::Data);
    }

    #[test]
    fn office_html_local_pictures_stay_in_their_folder() {
        assert_eq!(
            relative_parts("res%C3%AEm/a%20b.png#x").unwrap(),
            ["resîm", "a b.png"]
        );
        assert_eq!(relative_parts("./a.png").unwrap(), ["a.png"]);
        assert_eq!(relative_parts("../a.png"), None);
        assert_eq!(relative_parts("a/../../b.png"), None);
        assert_eq!(relative_parts("C:a.png"), None);
        assert_eq!(relative_parts("%ZZ.png"), None);

        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("Sayfa ğ 🧪");
        fs::create_dir_all(base.join("resimler")).unwrap();
        fs::write(base.join("resimler").join("nokta ş.png"), b"\x89PNG").unwrap();
        fs::write(dir.path().join("dışarıda.png"), b"\x89PNG").unwrap();
        fs::write(base.join("notlar.txt"), b"x").unwrap();
        let mut pictures = LocalPictures::new(Some(base.clone()));
        assert_eq!(
            pictures.data_url("resimler/nokta%20%C5%9F.png").as_deref(),
            Some("data:image/png;base64,iVBORw==")
        );
        assert_eq!(pictures.data_url("../dışarıda.png"), None);
        assert_eq!(pictures.data_url("notlar.txt"), None, "not a picture");
        assert_eq!(pictures.data_url("yok.png"), None);
        assert_eq!(
            LocalPictures::new(None).data_url("resimler/nokta ş.png"),
            None
        );
    }
}
