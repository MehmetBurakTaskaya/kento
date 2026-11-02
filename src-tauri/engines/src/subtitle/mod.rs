// SPDX-License-Identifier: MIT
//! Subtitle conversions (SPEC 5.4): SRT and VTT to each other and to TXT.
//!
//! The reader is lenient: BOM, any line ending, missing cue numbers, VTT timestamps without
//! hours, a dot or a comma before the milliseconds, NOTE/STYLE/REGION blocks and cue settings.
//! Cues stay in file order, overlapping ones included.

#[cfg(test)]
mod tests;

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::text::{self, Newline};
use crate::{Conversion, Error, Result};

const MAX_SUBTITLE_BYTES: u64 = 64 << 20;

pub fn supports(from: &str, to: &str) -> bool {
    matches!(from, "srt" | "vtt") && matches!(to, "srt" | "vtt" | "txt") && from != to
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    if !supports(job.from, job.to) {
        return Err(Error::Unsupported {
            from: job.from.to_owned(),
            to: job.to.to_owned(),
        });
    }
    job.progress.check()?;
    let bytes = text::read_capped(job.input, MAX_SUBTITLE_BYTES)?;
    let content = text::decode(&bytes);
    drop(bytes);
    let newline = Newline::detect(&content);
    let content = text::normalize_newlines(&content);
    let source = if job.from == "vtt" || content.starts_with("WEBVTT") {
        Source::Vtt
    } else {
        Source::Srt
    };
    let cues = parse(&content, source);
    if cues.is_empty() {
        return Err(Error::Unreadable("no subtitles found in the file".into()));
    }
    job.progress.check()?;
    let out = match job.to {
        "srt" => write_srt(&cues, source),
        "vtt" => write_vtt(&cues, source),
        _ => write_txt(&cues, source),
    };
    fs::write(job.dest, newline.apply(&out))?;
    job.progress.report(1.0);
    Ok(vec![job.dest.to_path_buf()])
}

/// Reads a subtitle file as the conversions do: any text encoding, SRT or VTT (by its extension
/// or its `WEBVTT` header). A file without a single cue is `Error::Unreadable`.
fn load(input: &Path) -> Result<(Vec<Cue>, Source)> {
    let bytes = text::read_capped(input, MAX_SUBTITLE_BYTES)?;
    let content = text::normalize_newlines(&text::decode(&bytes));
    let vtt = input
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("vtt"));
    let source = if vtt || content.starts_with("WEBVTT") {
        Source::Vtt
    } else {
        Source::Srt
    };
    let cues = parse(&content, source);
    if cues.is_empty() {
        return Err(Error::Unreadable("no subtitles found in the file".into()));
    }
    Ok((cues, source))
}

/// The subtitles as a UTF-8 SRT with `\n` line breaks, for FFmpeg's subtitle drawing, which then
/// never has to guess an encoding: VTT's tags and entities become SRT's. With `top`, every cue
/// without a position of its own starts with `{\an8}` (top centre), the override SRT files borrow
/// from ASS; it means the same in every libass version, unlike a forced style's alignment.
pub(crate) fn to_srt(input: &Path, top: bool) -> Result<String> {
    let (mut cues, source) = load(input)?;
    if top {
        for cue in &mut cues {
            let placed = cue.lines.iter().any(|line| line.contains("{\\a"));
            if let Some(first) = cue.lines.iter_mut().find(|line| !line.trim().is_empty()) {
                if !placed {
                    first.insert_str(0, "{\\an8}");
                }
            }
        }
    }
    Ok(write_srt(&cues, source))
}

/// The first cue with words, for a preview.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Sample {
    /// Seconds.
    pub start: f64,
    pub end: f64,
    /// Its lines without tags, joined by `\n`.
    pub text: String,
}

/// The first cue that shows any text.
pub fn sample(input: &Path) -> Result<Option<Sample>> {
    let (cues, source) = load(input)?;
    Ok(cues.iter().find_map(|cue| {
        let text = write_txt(std::slice::from_ref(cue), source);
        let text = text.trim_end();
        (!text.is_empty()).then(|| Sample {
            start: cue.start as f64 / 1000.0,
            end: cue.end as f64 / 1000.0,
            text: text.to_owned(),
        })
    }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    Srt,
    Vtt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Cue {
    id: Option<String>,
    /// Milliseconds.
    start: u64,
    end: u64,
    /// VTT cue settings (`line:0 align:start`), as written.
    settings: String,
    lines: Vec<String>,
}

fn parse(content: &str, source: Source) -> Vec<Cue> {
    let mut lines: Vec<&str> = content.split('\n').collect();
    if source == Source::Vtt && lines.first().is_some_and(|l| l.starts_with("WEBVTT")) {
        // The header block ends at the first blank line.
        let header = lines
            .iter()
            .position(|line| line.trim().is_empty())
            .unwrap_or(lines.len());
        lines.drain(..header);
    }
    let mut cues: Vec<Cue> = Vec::new();
    for block in lines.split(|line| line.trim().is_empty()) {
        if block.is_empty() {
            continue;
        }
        let timings: Vec<(usize, (u64, u64, &str))> = block
            .iter()
            .enumerate()
            .filter_map(|(i, line)| parse_timing(line).map(|timing| (i, timing)))
            .collect();
        if timings.is_empty() {
            // In SRT a blank line inside a caption splits it; VTT blocks without a timing are
            // comments, styles or regions.
            let lone_number = block.len() == 1 && is_number(block[0]);
            if source == Source::Srt && !lone_number {
                if let Some(cue) = cues.last_mut() {
                    cue.lines
                        .extend(block.iter().map(|line| line.trim_end().to_owned()));
                }
            }
            continue;
        }
        for (k, &(at, (start, end, settings))) in timings.iter().enumerate() {
            // Cues without the blank line between them: the number before the next timing is
            // that cue's identifier, not caption text.
            let next = timings.get(k + 1).map(|&(n, _)| n);
            let mut text_end = next.unwrap_or(block.len());
            if next.is_some() && text_end > at + 1 && is_number(block[text_end - 1]) {
                text_end -= 1;
            }
            let previous = k.checked_sub(1).map(|p| timings[p].0);
            let id = (at > 0)
                .then(|| block[at - 1])
                .filter(|line| previous.is_none_or(|p| at - 1 > p && is_number(line)))
                .map(|line| line.trim().to_owned());
            cues.push(Cue {
                id,
                start,
                end,
                settings: settings.to_owned(),
                lines: block[at + 1..text_end]
                    .iter()
                    .map(|line| line.trim_end().to_owned())
                    .collect(),
            });
        }
    }
    cues
}

fn is_number(line: &str) -> bool {
    let line = line.trim();
    !line.is_empty() && line.bytes().all(|b| b.is_ascii_digit())
}

/// `start --> end [settings]`.
fn parse_timing(line: &str) -> Option<(u64, u64, &str)> {
    let (left, right) = line.split_once("-->")?;
    let start = parse_time(left.trim())?;
    let right = right.trim_start();
    let (end, settings) = match right.find([' ', '\t']) {
        Some(at) => (&right[..at], right[at..].trim()),
        None => (right.trim_end(), ""),
    };
    Some((start, parse_time(end)?, settings))
}

/// `[hh:]mm:ss[.,]fff`, in milliseconds.
fn parse_time(text: &str) -> Option<u64> {
    let (clock, fraction) = match text.rfind(['.', ',']) {
        Some(at) => (&text[..at], &text[at + 1..]),
        None => (text, ""),
    };
    let number = |part: &str| -> Option<u64> {
        (!part.is_empty() && part.len() <= 9 && part.bytes().all(|b| b.is_ascii_digit()))
            .then(|| part.parse().ok())
            .flatten()
    };
    let parts: Vec<&str> = clock.split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [h, m, s] => (number(h)?, number(m)?, number(s)?),
        [m, s] => (0, number(m)?, number(s)?),
        _ => return None,
    };
    if minutes > 59 || seconds > 59 || fraction.bytes().any(|b| !b.is_ascii_digit()) {
        return None;
    }
    // "5" after the separator is half a second, as in a decimal fraction.
    let millis = fraction
        .bytes()
        .chain(std::iter::repeat(b'0'))
        .take(3)
        .fold(0, |ms, digit| ms * 10 + u64::from(digit - b'0'));
    Some(((hours * 60 + minutes) * 60 + seconds) * 1000 + millis)
}

fn format_time(ms: u64, separator: char) -> String {
    let (hours, rest) = (ms / 3_600_000, ms % 3_600_000);
    format!(
        "{hours:02}:{:02}:{:02}{separator}{:03}",
        rest / 60_000,
        rest % 60_000 / 1000,
        rest % 1000
    )
}

fn write_srt(cues: &[Cue], source: Source) -> String {
    let mut out = String::new();
    for (number, cue) in cues.iter().enumerate() {
        out.push_str(&format!(
            "{}\n{} --> {}\n",
            number + 1,
            format_time(cue.start, ','),
            format_time(cue.end, ',')
        ));
        for line in &cue.lines {
            let line = match source {
                Source::Vtt => text::decode_entities(&srt_tags(line)),
                Source::Srt => line.clone(),
            };
            if !line.trim().is_empty() {
                out.push_str(&line);
                out.push('\n');
            }
        }
        out.push('\n');
    }
    out
}

fn write_vtt(cues: &[Cue], source: Source) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for cue in cues {
        // SRT numbers carry nothing; VTT identifiers may be referenced by styles.
        if let Some(id) = cue.id.as_ref().filter(|_| source == Source::Vtt) {
            out.push_str(id);
            out.push('\n');
        }
        out.push_str(&format!(
            "{} --> {}",
            format_time(cue.start, '.'),
            format_time(cue.end, '.')
        ));
        if source == Source::Vtt && !cue.settings.is_empty() {
            out.push(' ');
            out.push_str(&cue.settings);
        }
        out.push('\n');
        for line in &cue.lines {
            let line = match source {
                Source::Srt => vtt_escape(&strip_overrides(line)),
                Source::Vtt => line.clone(),
            };
            // A blank line would end the cue.
            if !line.trim().is_empty() {
                out.push_str(&line);
                out.push('\n');
            }
        }
        out.push('\n');
    }
    out
}

fn write_txt(cues: &[Cue], source: Source) -> String {
    let mut out = String::new();
    for cue in cues {
        let lines: Vec<String> = cue
            .lines
            .iter()
            .map(|line| {
                let plain = strip_tags(&strip_overrides(line));
                let plain = match source {
                    Source::Vtt => text::decode_entities(&plain),
                    Source::Srt => plain,
                };
                plain.trim().to_owned()
            })
            .filter(|line| !line.is_empty())
            .collect();
        if lines.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        for line in lines {
            out.push_str(&line);
            out.push('\n');
        }
    }
    out
}

/// Every `<...>` tag out.
fn strip_tags(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(at) = rest.find('<') {
        out.push_str(&rest[..at]);
        match rest[at..].find('>') {
            Some(end) => rest = &rest[at + end + 1..],
            None => {
                out.push_str(&rest[at..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// `{\an8}`-style override codes that SRT files borrow from ASS; other players show them as text.
fn strip_overrides(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(at) = rest.find("{\\") {
        out.push_str(&rest[..at]);
        match rest[at..].find('}') {
            Some(end) => rest = &rest[at + end + 1..],
            None => {
                out.push_str(&rest[at..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// VTT cue text for SRT readers: the italic, bold and underline tags they know stay (without VTT
/// classes); voice, class, language, ruby and timestamp tags go.
fn srt_tags(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(at) = rest.find('<') {
        out.push_str(&rest[..at]);
        let Some(end) = rest[at..].find('>') else {
            out.push_str(&rest[at..]);
            rest = "";
            break;
        };
        let tag = &rest[at + 1..at + end];
        let (closing, name) = match tag.strip_prefix('/') {
            Some(name) => ("/", name),
            None => ("", tag),
        };
        let name = name.split(['.', ' ', '\t']).next().unwrap_or_default();
        if matches!(name, "i" | "b" | "u") {
            out.push_str(&format!("<{closing}{name}>"));
        }
        rest = &rest[at + end + 1..];
    }
    out.push_str(rest);
    out
}

/// SRT text as VTT cue text: tags stay, a bare `&` or `<` is escaped, and `-->` cannot appear.
fn vtt_escape(line: &str) -> String {
    let mut out = String::with_capacity(line.len() + 8);
    for (at, c) in line.char_indices() {
        match c {
            '&' if !text::starts_with_entity(&line[at..]) => out.push_str("&amp;"),
            '<' => {
                let tag_like = line[at + 1..]
                    .chars()
                    .next()
                    .is_some_and(|n| n.is_ascii_alphanumeric() || n == '/')
                    && line[at..].contains('>');
                out.push_str(if tag_like { "<" } else { "&lt;" });
            }
            '>' if out.ends_with("--") => out.push_str("&gt;"),
            _ => out.push(c),
        }
    }
    out
}
