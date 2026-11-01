// SPDX-License-Identifier: MIT
//! HTML in: plain text through `html2text`, Markdown through `htmd`.

use html2text::render::TextDecorator;

use crate::{Error, Result};

/// Pages nested deeper than this are refused before parsing: the HTML parser's work grows with
/// the number of tags times their depth, so 20,000 levels take seconds and a large crafted file
/// could take hours.
const MAX_TAG_DEPTH: usize = 5000;
/// Pages whose tags × depth pass this are refused too; a shallow page gets there only past
/// roughly 100 MB.
const MAX_PARSE_COST: u64 = 300_000_000;

fn check_depth(html: &str) -> Result<()> {
    if !within_parse_budget(html) {
        return Err(Error::Limit(
            "the page is too large or nests its elements too deeply".into(),
        ));
    }
    Ok(())
}

/// HTML as plain text, one line per paragraph or line break: the reader's editor wraps it.
pub(super) fn to_text(html: &str) -> Result<String> {
    check_depth(html)?;
    let html = replace_rules(html);
    // No paragraph can be longer than the page itself, so this width never wraps.
    let width = html.len().max(80) + 16;
    let text = html2text::config::with_decorator(PlainText)
        .no_table_borders()
        .allow_width_overflow()
        .string_from_read(html.as_bytes(), width)
        .map_err(|error| Error::Unreadable(error.to_string()))?;
    Ok(tidy(&text))
}

/// `htmd` recurses once per level of nesting and slows down sharply on very deep pages; real
/// pages stay far below this.
const MAX_MARKDOWN_DEPTH: usize = 1000;

/// The stack `htmd` runs on, whatever the calling thread has: room for `MAX_MARKDOWN_DEPTH`
/// levels many times over. Only touched pages of it are committed.
const MARKDOWN_STACK: usize = 64 << 20;

pub(super) fn to_markdown(html: &str) -> Result<String> {
    check_depth(html)?;
    let depth = nesting(html)?;
    if depth > MAX_MARKDOWN_DEPTH {
        return Err(Error::Limit(format!(
            "the page nests elements more than {MAX_MARKDOWN_DEPTH} levels deep"
        )));
    }
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .name("html-to-markdown".into())
            .stack_size(MARKDOWN_STACK)
            .spawn_scoped(scope, || markdown(html))?
            .join()
            .map_err(|_| Error::Other("the HTML to Markdown converter failed".into()))?
    })
}

/// The deepest element, walked without recursion so the measurement cannot overflow itself.
fn nesting(html: &str) -> Result<usize> {
    let dom = html2text::config::plain()
        .parse_html(html.as_bytes())
        .map_err(|error| Error::Unreadable(error.to_string()))?;
    let mut deepest = 0;
    let mut pending = vec![(dom.document.clone(), 0)];
    while let Some((node, depth)) = pending.pop() {
        deepest = deepest.max(depth);
        pending.extend(
            node.children
                .borrow()
                .iter()
                .map(|child| (child.clone(), depth + 1)),
        );
    }
    Ok(deepest)
}

/// Estimates the parser's load from the tags alone, stopping as soon as it is over budget. The
/// open-element stack it keeps follows the parser where it matters: end tags close what they
/// enclose, list items, cells and paragraphs close their open siblings, and void and raw-text
/// elements hold nothing.
pub(super) fn within_parse_budget(html: &str) -> bool {
    const VOID: &[&str] = &[
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source",
        "track", "wbr", "basefont", "bgsound", "frame", "keygen", "param",
    ];
    const RAW: &[&str] = &[
        "script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes",
    ];
    // A start tag closes an open element of these names, unless one of the scope elements
    // after it is open in between.
    const SIBLINGS: &[(&[&str], &[&str])] = &[
        (&["p"], &[]),
        (&["li"], &["ul", "ol", "menu"]),
        (&["dt", "dd"], &["dl"]),
        (&["td", "th"], &["table", "tr"]),
        (&["tr"], &["table", "thead", "tbody", "tfoot"]),
        (&["thead", "tbody", "tfoot"], &["table"]),
        (&["option"], &["select", "datalist", "optgroup"]),
        (&["optgroup"], &["select"]),
    ];
    const FOREIGN: &[&str] = &["svg", "math"];
    let is = |name: &str, names: &[&str]| names.iter().any(|n| n.eq_ignore_ascii_case(name));
    // Closes everything from `keep` up, keeping count of the open SVG and MathML elements, in
    // which `<tag/>` holds nothing.
    let close = |open: &mut Vec<&str>, foreign: &mut usize, keep: usize| {
        *foreign -= open[keep..].iter().filter(|n| is(n, FOREIGN)).count();
        open.truncate(keep);
    };
    let bytes = html.as_bytes();
    let mut open: Vec<&str> = Vec::new();
    let mut foreign = 0;
    let mut cost: u64 = 0;
    let mut at = 0;
    while let Some(offset) = bytes[at..].iter().position(|&b| b == b'<') {
        // The scans below walk the open stack too, so this also bounds the estimate's own work.
        cost += open.len() as u64 + 1;
        if cost > MAX_PARSE_COST {
            return false;
        }
        let start = at + offset;
        let rest = &html[start + 1..];
        if rest.starts_with("!--") {
            at = rest
                .find("-->")
                .map_or(bytes.len(), |end| start + 1 + end + 3);
            continue;
        }
        let closing = rest.starts_with('/');
        let name_start = start + 1 + usize::from(closing);
        let name_len = bytes[name_start..]
            .iter()
            .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b':'))
            .count();
        let Some(end) = bytes[name_start..].iter().position(|&b| b == b'>') else {
            break;
        };
        at = name_start + end + 1;
        if name_len == 0 || !bytes[name_start].is_ascii_alphabetic() {
            continue;
        }
        let name = &html[name_start..name_start + name_len];
        if closing {
            if let Some(found) = open.iter().rposition(|n| n.eq_ignore_ascii_case(name)) {
                close(&mut open, &mut foreign, found);
            }
            continue;
        }
        if is(name, VOID) || (foreign > 0 && bytes[at - 2] == b'/') {
            continue;
        }
        if is(name, RAW) {
            at = raw_text_end(html, at, name);
            continue;
        }
        if let Some((siblings, scopes)) = SIBLINGS.iter().find(|(names, _)| is(name, names)) {
            let sibling = open.iter().rposition(|n| is(n, siblings));
            let scope = open.iter().rposition(|n| is(n, scopes));
            if let Some(sibling) = sibling.filter(|&s| scope.is_none_or(|scope| scope < s)) {
                close(&mut open, &mut foreign, sibling);
            }
        }
        foreign += usize::from(is(name, FOREIGN));
        open.push(name);
        if open.len() > MAX_TAG_DEPTH {
            return false;
        }
    }
    true
}

/// Where the text of a `<script>`-like element ends: after its end tag, or at the end of input.
fn raw_text_end(html: &str, from: usize, name: &str) -> usize {
    let bytes = html.as_bytes();
    let mut at = from;
    while let Some(offset) = html[at..].find("</") {
        let tag = at + offset + 2;
        let candidate = &bytes[tag..bytes.len().min(tag + name.len())];
        if candidate.eq_ignore_ascii_case(name.as_bytes()) {
            return bytes[tag..]
                .iter()
                .position(|&b| b == b'>')
                .map_or(bytes.len(), |end| tag + end + 1);
        }
        at = tag;
    }
    bytes.len()
}

fn markdown(html: &str) -> Result<String> {
    use htmd::options::{BrStyle, BulletListMarker, HrStyle, Options};
    let converter = htmd::HtmlToMarkdown::builder()
        .options(Options {
            bullet_list_marker: BulletListMarker::Dash,
            hr_style: HrStyle::Dashes,
            // Editors strip trailing spaces; a backslash break survives them.
            br_style: BrStyle::Backslash,
            ul_bullet_spacing: 1,
            ol_number_spacing: 1,
            ..Options::default()
        })
        .skip_tags(vec!["head", "script", "style", "noscript", "template"])
        .build();
    let markdown = converter
        .convert(html)
        .map_err(|error| Error::Unreadable(error.to_string()))?;
    let markdown = markdown.trim_matches('\n');
    Ok(if markdown.is_empty() {
        String::new()
    } else {
        format!("{markdown}\n")
    })
}

/// `html2text` draws a rule as wide as the page, which is the whole document here; a short
/// separator paragraph reads the same.
fn replace_rules(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(at) = rest.find('<') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let bytes = rest.as_bytes();
        let is_rule = bytes.len() > 3
            && bytes[1].eq_ignore_ascii_case(&b'h')
            && bytes[2].eq_ignore_ascii_case(&b'r')
            && matches!(
                bytes[3],
                b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r' | b'\x0c'
            );
        match rest.find('>').filter(|_| is_rule) {
            Some(end) => {
                out.push_str("<p>* * *</p>");
                rest = &rest[end + 1..];
            }
            None => {
                out.push('<');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Trailing spaces off, at most one blank line in a row, one final line break.
fn tidy(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank_lines = 0;
    for line in text.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            blank_lines += 1;
            continue;
        }
        if !out.is_empty() {
            out.push_str(if blank_lines > 0 { "\n\n" } else { "\n" });
        }
        blank_lines = 0;
        out.push_str(line);
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out
}

/// Text without markup: no link brackets, no heading hashes, but list markers and quote marks
/// stay because they carry meaning in plain text too.
#[derive(Clone, Copy)]
struct PlainText;

impl TextDecorator for PlainText {
    type Annotation = ();

    fn decorate_link_start(&mut self, _url: &str) -> (String, ()) {
        (String::new(), ())
    }

    fn decorate_link_end(&mut self) -> String {
        String::new()
    }

    fn decorate_em_start(&self) -> (String, ()) {
        (String::new(), ())
    }

    fn decorate_em_end(&self) -> String {
        String::new()
    }

    fn decorate_strong_start(&self) -> (String, ()) {
        (String::new(), ())
    }

    fn decorate_strong_end(&self) -> String {
        String::new()
    }

    fn decorate_strikeout_start(&self) -> (String, ()) {
        (String::new(), ())
    }

    fn decorate_strikeout_end(&self) -> String {
        String::new()
    }

    fn decorate_code_start(&self) -> (String, ()) {
        (String::new(), ())
    }

    fn decorate_code_end(&self) -> String {
        String::new()
    }

    fn decorate_preformat_first(&self) {}

    fn decorate_preformat_cont(&self) {}

    fn decorate_image(&mut self, _src: &str, title: &str) -> (String, ()) {
        (title.to_owned(), ())
    }

    fn header_prefix(&self, _level: usize) -> String {
        String::new()
    }

    fn quote_prefix(&self) -> String {
        "> ".to_owned()
    }

    fn unordered_item_prefix(&self) -> String {
        "- ".to_owned()
    }

    fn ordered_item_prefix(&self, i: i64) -> String {
        format!("{i}. ")
    }

    fn make_subblock_decorator(&self) -> Self {
        PlainText
    }

    fn decorate_superscript_start(&self) -> (String, ()) {
        (String::new(), ())
    }

    fn decorate_superscript_end(&self) -> String {
        String::new()
    }
}
