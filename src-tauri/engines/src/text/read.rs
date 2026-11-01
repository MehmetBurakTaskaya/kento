// SPDX-License-Identifier: MIT
//! Reading text whose encoding nobody wrote down, and the small helpers every text-like engine
//! shares (line endings, HTML escaping, the HTML page around converted content).

use std::fs::File;
use std::io::Read;
use std::path::Path;

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252, WINDOWS_1254};

use crate::{Error, Result};

/// Text inputs over this size are refused instead of being loaded into memory.
pub(crate) const MAX_TEXT_BYTES: u64 = 256 << 20;

/// Reads a whole file, refusing it once it passes `max` bytes.
pub(crate) fn read_capped(path: &Path, max: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(max + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max {
        return Err(Error::Limit(format!(
            "the file is larger than {} MB",
            max >> 20
        )));
    }
    Ok(bytes)
}

/// BOM first, then UTF-8 as is, then the legacy code page the bytes most likely use.
pub(crate) fn decode(bytes: &[u8]) -> String {
    if let Some((encoding, bom)) = Encoding::for_bom(bytes) {
        return encoding
            .decode_without_bom_handling(&bytes[bom..])
            .0
            .into_owned();
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    legacy(bytes)
        .decode_without_bom_handling(bytes)
        .0
        .into_owned()
}

/// Like `decode`, but a page that names its charset in a `<meta>` tag gets that charset.
pub(crate) fn decode_html(bytes: &[u8]) -> String {
    if Encoding::for_bom(bytes).is_none() && std::str::from_utf8(bytes).is_err() {
        let head = &bytes[..bytes.len().min(1024)];
        // A page that claims UTF-8 but is not valid UTF-8 is better served by the guess.
        if let Some(encoding) = meta_charset(head).filter(|&e| e != UTF_8) {
            return encoding.decode_without_bom_handling(bytes).0.into_owned();
        }
    }
    decode(bytes)
}

fn legacy(bytes: &[u8]) -> &'static Encoding {
    // Windows-1254 puts Ğ İ Ş ğ ı ş where Windows-1252 has the Icelandic Ð Ý Þ ð ý þ, which are
    // rare enough that any of these bytes points to Turkish.
    let turkish = bytes
        .iter()
        .any(|b| matches!(b, 0xD0 | 0xDD | 0xDE | 0xF0 | 0xFD | 0xFE));
    if turkish {
        WINDOWS_1254
    } else {
        WINDOWS_1252
    }
}

fn meta_charset(head: &[u8]) -> Option<&'static Encoding> {
    let lower = head.to_ascii_lowercase();
    let start = lower.windows(8).position(|w| w == b"charset=")? + 8;
    let rest = &lower[start..];
    let rest = rest
        .strip_prefix(b"\"")
        .or_else(|| rest.strip_prefix(b"'"))
        .unwrap_or(rest);
    let end = rest
        .iter()
        .position(|b| matches!(b, b'"' | b'\'' | b';' | b'>' | b'/') || b.is_ascii_whitespace())
        .unwrap_or(rest.len());
    let encoding = Encoding::for_label(&rest[..end])?;
    // The HTML standard reads a UTF-16 label in a meta tag as UTF-8.
    Some(if encoding == UTF_16LE || encoding == UTF_16BE {
        UTF_8
    } else {
        encoding
    })
}

/// The line ending an input uses, so the output can use the same one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Newline {
    Lf,
    CrLf,
    Cr,
}

impl Newline {
    /// The first line break decides.
    pub(crate) fn detect(text: &str) -> Self {
        match text.find(['\r', '\n']) {
            Some(i) if text[i..].starts_with("\r\n") => Newline::CrLf,
            Some(i) if text.as_bytes()[i] == b'\r' => Newline::Cr,
            _ => Newline::Lf,
        }
    }

    /// Turns `\n` line breaks into this style.
    pub(crate) fn apply(self, text: &str) -> String {
        match self {
            Newline::Lf => text.to_owned(),
            Newline::CrLf => text.replace('\n', "\r\n"),
            Newline::Cr => text.replace('\n', "\r"),
        }
    }
}

/// Every CRLF and lone CR becomes `\n`.
pub(crate) fn normalize_newlines(text: &str) -> String {
    if text.contains('\r') {
        text.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        text.to_owned()
    }
}

pub(crate) fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// A complete, self-contained HTML5 page.
pub(crate) fn html_document(title: &str, style: &str, body: &str) -> String {
    format!("{}{body}{HTML_CLOSE}", html_open(title, style))
}

/// Everything of a page before its content, for pages written piece by piece.
pub(crate) fn html_open(title: &str, style: &str) -> String {
    format!(
        "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>{}</title>\n<style>\n{style}</style>\n</head>\n<body>\n",
        escape_html(title)
    )
}

pub(crate) const HTML_CLOSE: &str = "</body>\n</html>\n";

/// The named references subtitles and simple markup use, plus numeric ones. Anything else stays
/// as written.
pub(crate) fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let decoded = rest[1..]
            .find(';')
            .filter(|&end| end <= 10)
            .and_then(|end| entity(&rest[1..=end]).map(|c| (c, end + 2)));
        match decoded {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn entity(name: &str) -> Option<char> {
    Some(match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => '\u{a0}',
        "lrm" => '\u{200e}',
        "rlm" => '\u{200f}',
        _ => {
            let number = name.strip_prefix('#')?;
            let code = match number.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => number.parse().ok()?,
            };
            char::from_u32(code)?
        }
    })
}

/// Whether `text` starts with a character reference (`&amp;`, `&#233;`), so its `&` is not
/// literal.
pub(crate) fn starts_with_entity(text: &str) -> bool {
    let Some(body) = text.strip_prefix('&') else {
        return false;
    };
    let Some(end) = body.find(';') else {
        return false;
    };
    let name = &body[..end];
    !name.is_empty()
        && name.len() <= 32
        && match name.strip_prefix('#') {
            Some(number) => match number.strip_prefix(['x', 'X']) {
                Some(hex) => !hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit()),
                None => !number.is_empty() && number.chars().all(|c| c.is_ascii_digit()),
            },
            None => name.chars().all(|c| c.is_ascii_alphanumeric()),
        }
}
