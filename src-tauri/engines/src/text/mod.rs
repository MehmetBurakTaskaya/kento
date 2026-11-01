// SPDX-License-Identifier: MIT
//! Text conversions (SPEC 5.4): TXT, MD and HTML to each other, and TEXTCLIPPING to TXT.
//!
//! Inputs may be UTF-8, UTF-16 with a BOM or a legacy Windows code page; outputs are UTF-8
//! without a BOM and keep the input's line endings.

mod clipping;
mod html;
mod markdown;
mod read;
#[cfg(test)]
pub(crate) mod tests;

use std::fs;
use std::path::{Path, PathBuf};

use crate::{Conversion, Error, Result};

pub(crate) use read::{
    decode, decode_entities, decode_html, escape_html, html_document, html_open,
    normalize_newlines, read_capped, starts_with_entity, Newline, HTML_CLOSE, MAX_TEXT_BYTES,
};

const TEXT: [&str; 3] = ["txt", "md", "html"];

pub fn supports(from: &str, to: &str) -> bool {
    (TEXT.contains(&from) && TEXT.contains(&to) && from != to)
        || (from == "textclipping" && to == "txt")
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    if !supports(job.from, job.to) {
        return Err(Error::Unsupported {
            from: job.from.to_owned(),
            to: job.to.to_owned(),
        });
    }
    job.progress.check()?;
    let output = if job.from == "textclipping" {
        clipping::read(job.input)?
    } else {
        let bytes = read_capped(job.input, MAX_TEXT_BYTES)?;
        let text = if job.from == "html" {
            decode_html(&bytes)
        } else {
            decode(&bytes)
        };
        drop(bytes);
        let newline = Newline::detect(&text);
        let text = normalize_newlines(&text);
        job.progress.check()?;
        let title = stem(job.input);
        let out = match (job.from, job.to) {
            ("txt", "md") => markdown::escape_text(&text),
            ("txt", "html") => html_document(&title, TXT_STYLE, &txt_to_html(&text)),
            ("md", "html") => html_document(&title, MD_STYLE, &markdown::to_html(&text)),
            ("md", "txt") => markdown::to_text(&text),
            ("html", "txt") => html::to_text(&text)?,
            _ => html::to_markdown(&text)?,
        };
        newline.apply(&out)
    };
    job.progress.check()?;
    fs::write(job.dest, output)?;
    job.progress.report(1.0);
    Ok(vec![job.dest.to_path_buf()])
}

/// The input's name without its extension, for page titles.
pub(crate) fn stem(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
}

macro_rules! base_style {
    () => {
        "body{font-family:system-ui,sans-serif;line-height:1.5;max-width:50em;margin:2em auto;\
         padding:0 1em}\n"
    };
}

const TXT_STYLE: &str = concat!(base_style!(), "p{white-space:pre-wrap}\n");

const MD_STYLE: &str = concat!(
    base_style!(),
    "pre,code{font-family:ui-monospace,monospace}\npre{overflow:auto}\n",
    "table{border-collapse:collapse}\nth,td{border:1px solid #8888;padding:.25em .5em}\n"
);

/// One paragraph per block of lines; `pre-wrap` keeps spaces and line breaks as written.
fn txt_to_html(text: &str) -> String {
    let mut body = String::new();
    let mut paragraph: Vec<&str> = Vec::new();
    let flush = |paragraph: &mut Vec<&str>, body: &mut String| {
        if !paragraph.is_empty() {
            let lines: Vec<String> = paragraph.iter().map(|line| escape_html(line)).collect();
            body.push_str("<p>");
            body.push_str(&lines.join("<br>"));
            body.push_str("</p>\n");
            paragraph.clear();
        }
    };
    for line in text.split('\n') {
        if line.trim().is_empty() {
            flush(&mut paragraph, &mut body);
        } else {
            paragraph.push(line.trim_end());
        }
    }
    flush(&mut paragraph, &mut body);
    body
}
