// SPDX-License-Identifier: MIT
//! Markdown in and out: escaping plain text so it renders as written, rendering CommonMark (with
//! the GitHub table, strikethrough and task list extensions) and reading it back as plain text.

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

/// Plain text (with `\n` line breaks) as Markdown that renders the same words, line breaks and
/// indentation.
pub(super) fn escape_text(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out = String::with_capacity(text.len() + text.len() / 8);
    for (i, line) in lines.iter().enumerate() {
        let line = line.trim_end_matches([' ', '\t']);
        if !line.is_empty() {
            escape_line(line, &mut out);
            // Markdown joins the lines of a paragraph; a trailing backslash keeps the break.
            let continues = lines
                .get(i + 1)
                .is_some_and(|next| !next.trim_matches([' ', '\t']).is_empty());
            if continues {
                out.push('\\');
            }
        }
        if i + 1 < lines.len() {
            out.push('\n');
        }
    }
    out
}

fn escape_line(line: &str, out: &mut String) {
    let content_start = line.find(|c| c != ' ' && c != '\t').unwrap_or(line.len());
    // Leading spaces would start a code block or vanish; no-break spaces keep the indentation.
    for c in line[..content_start].chars() {
        out.push_str(if c == '\t' {
            "\u{a0}\u{a0}\u{a0}\u{a0}"
        } else {
            "\u{a0}"
        });
    }
    let content = &line[content_start..];
    let block_marker = block_marker_at(content);
    let chars: Vec<(usize, char)> = content.char_indices().collect();
    for (k, &(at, c)) in chars.iter().enumerate() {
        let prev = k.checked_sub(1).map(|p| chars[p].1);
        let next = chars.get(k + 1).map(|&(_, n)| n);
        let escape = match c {
            '\\' | '`' | '*' | '[' | '<' | '|' | '~' => true,
            // `_` inside a word never emphasizes, so snake_case stays readable.
            '_' => {
                !(prev.is_some_and(char::is_alphanumeric)
                    && next.is_some_and(char::is_alphanumeric))
            }
            '&' => super::starts_with_entity(&content[at..]),
            _ => block_marker == Some(at),
        };
        if escape {
            out.push('\\');
        }
        out.push(c);
    }
}

/// The byte offset of a character that would start a heading, quote, list or rule at the start
/// of a line.
fn block_marker_at(content: &str) -> Option<usize> {
    let bytes = content.as_bytes();
    let first = *bytes.first()?;
    let space_after = |i: usize| bytes.get(i).is_none_or(|b| matches!(b, b' ' | b'\t'));
    match first {
        b'>' => Some(0),
        b'#' => {
            let hashes = bytes.iter().take_while(|&&b| b == b'#').count();
            (hashes <= 6 && space_after(hashes)).then_some(0)
        }
        b'-' | b'+' | b'=' => {
            let only_marks = bytes.iter().all(|&b| b == first || b == b' ' || b == b'\t');
            (only_marks || (first != b'=' && space_after(1))).then_some(0)
        }
        b'0'..=b'9' => {
            let digits = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
            (digits <= 9
                && matches!(bytes.get(digits), Some(b'.' | b')'))
                && space_after(digits + 1))
            .then_some(digits)
        }
        _ => None,
    }
}

fn options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS
}

pub(super) fn to_html(text: &str) -> String {
    let mut body = String::with_capacity(text.len() * 3 / 2);
    pulldown_cmark::html::push_html(&mut body, Parser::new_ext(text, options()));
    body
}

/// Markdown read as plain text: markup goes, the words, list markers and code stay.
pub(super) fn to_text(text: &str) -> String {
    let mut plain = Plain::default();
    for event in Parser::new_ext(text, options()) {
        plain.event(event);
    }
    plain.finish()
}

#[derive(Default)]
struct Plain {
    out: String,
    /// The indentation of each open list item.
    indent: Vec<usize>,
    /// The next number of each open list; `None` for bullets.
    lists: Vec<Option<u64>>,
    /// Table cells written in the current row.
    cells: usize,
}

impl Plain {
    fn event(&mut self, event: Event) {
        match event {
            Event::Start(tag) => self.start(tag),
            Event::End(tag) => self.end(tag),
            Event::Text(text) | Event::Code(text) => self.write(&text),
            Event::InlineMath(text) | Event::DisplayMath(text) => self.write(&text),
            Event::Html(html) => self.write(&strip_tags(&html)),
            Event::InlineHtml(html) => {
                let tag = html.trim().to_ascii_lowercase();
                if matches!(tag.as_str(), "<br>" | "<br/>" | "<br />") {
                    self.write("\n");
                }
            }
            Event::SoftBreak | Event::HardBreak => self.write("\n"),
            Event::Rule => self.blank_line(),
            Event::TaskListMarker(done) => self.write(if done { "[x] " } else { "[ ] " }),
            Event::FootnoteReference(label) => self.write(&format!("[{label}]")),
        }
    }

    fn start(&mut self, tag: Tag) {
        match tag {
            Tag::Paragraph
            | Tag::Heading { .. }
            | Tag::BlockQuote(_)
            | Tag::CodeBlock(_)
            | Tag::HtmlBlock => self.block(),
            Tag::List(first) => {
                if self.indent.is_empty() {
                    self.blank_line();
                } else {
                    self.newline();
                }
                self.lists.push(first);
            }
            Tag::Item => {
                self.newline();
                let marker = match self.lists.last_mut() {
                    Some(Some(number)) => {
                        *number += 1;
                        format!("{}. ", *number - 1)
                    }
                    _ => "- ".to_owned(),
                };
                let indent = self.indent_width();
                self.out.extend(std::iter::repeat_n(' ', indent));
                self.out.push_str(&marker);
                self.indent.push(marker.chars().count());
            }
            Tag::Table(_) => self.blank_line(),
            Tag::TableHead | Tag::TableRow => {
                self.newline();
                self.cells = 0;
            }
            Tag::TableCell => {
                if self.cells > 0 {
                    self.out.push('\t');
                }
                self.cells += 1;
            }
            Tag::FootnoteDefinition(label) => {
                self.blank_line();
                self.write(&format!("[{label}] "));
            }
            _ => {}
        }
    }

    fn end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Paragraph
            | TagEnd::Heading(_)
            | TagEnd::BlockQuote(_)
            | TagEnd::CodeBlock
            | TagEnd::HtmlBlock
            | TagEnd::TableHead
            | TagEnd::TableRow
            | TagEnd::Table => self.newline(),
            TagEnd::Item => {
                self.indent.pop();
                self.newline();
            }
            TagEnd::List(_) => {
                self.lists.pop();
                if self.indent.is_empty() {
                    self.blank_line();
                }
            }
            _ => {}
        }
    }

    fn indent_width(&self) -> usize {
        self.indent.iter().sum()
    }

    fn at_line_start(&self) -> bool {
        self.out.is_empty() || self.out.ends_with('\n')
    }

    /// A new block: a blank line before it, unless it opens a list item.
    fn block(&mut self) {
        if self.at_line_start() {
            self.blank_line();
        }
    }

    fn newline(&mut self) {
        if !self.at_line_start() {
            self.out.push('\n');
        }
    }

    fn blank_line(&mut self) {
        self.newline();
        if !self.out.is_empty() && !self.out.ends_with("\n\n") {
            self.out.push('\n');
        }
    }

    fn write(&mut self, text: &str) {
        for (i, part) in text.split('\n').enumerate() {
            if i > 0 {
                self.out.push('\n');
            }
            if !part.is_empty() {
                if self.at_line_start() {
                    let indent = self.indent_width();
                    self.out.extend(std::iter::repeat_n(' ', indent));
                }
                self.out.push_str(part);
            }
        }
    }

    fn finish(self) -> String {
        let mut out: String = self
            .out
            .split('\n')
            .map(|line| line.trim_end_matches([' ', '\t']))
            .collect::<Vec<_>>()
            .join("\n");
        let end = out.trim_end().len();
        out.truncate(end);
        let start = out.len() - out.trim_start_matches('\n').len();
        out.drain(..start);
        if !out.is_empty() {
            out.push('\n');
        }
        out
    }
}

/// Tags and comments out, character references decoded.
fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(at) = rest.find('<') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let close = if rest.starts_with("<!--") {
            rest.find("-->").map(|end| end + 3)
        } else {
            rest.find('>').map(|end| end + 1)
        };
        match close {
            Some(len) => rest = &rest[len..],
            None => {
                out.push_str(rest);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    super::decode_entities(&out)
}
