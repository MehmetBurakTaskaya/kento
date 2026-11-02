// SPDX-License-Identifier: MIT
//! Plain text and Markdown from the characters PDFium reads off each page.
//!
//! PDFium hands over the characters in content order with its own line breaks (`\r\n`). Plain
//! text keeps those lines; Markdown joins them into paragraphs, using the character boxes to see
//! where extra space, an indent or a jump to another column starts a new one.

/// Between pages in a TXT file: a blank line and a form feed on its own line.
const TXT_PAGE_BREAK: &str = "\n\n\u{c}\n";
const MD_PAGE_BREAK: &str = "\n\n---\n\n";

/// One character as PDFium reports it.
#[derive(Debug, Clone, Copy)]
pub(super) struct Glyph {
    /// A Unicode value, or half of a UTF-16 surrogate pair where PDFium's `wchar_t` is 16 bits.
    pub code: u32,
    /// The loose character box in page space, when asked for.
    pub rect: Option<Rect>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Rect {
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
    pub top: f32,
}

impl Rect {
    pub(super) fn union(self, other: Rect) -> Rect {
        Rect {
            left: self.left.min(other.left),
            bottom: self.bottom.min(other.bottom),
            right: self.right.max(other.right),
            top: self.top.max(other.top),
        }
    }

    pub(super) fn height(&self) -> f32 {
        self.top - self.bottom
    }
}

#[derive(Debug, Default)]
struct Line {
    text: String,
    /// The box around the line's visible characters.
    rect: Option<Rect>,
}

pub(super) fn plain_page(glyphs: &[Glyph]) -> String {
    let lines: Vec<String> = lines(glyphs)
        .into_iter()
        .map(|line| line.text.trim_end().to_owned())
        .collect();
    lines.join("\n").trim_end().to_owned()
}

pub(super) fn markdown_page(glyphs: &[Glyph]) -> String {
    paragraphs(&lines(glyphs))
        .iter()
        .map(|paragraph| escape_markdown(paragraph))
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(super) fn join_plain(pages: &[String]) -> String {
    let mut text = pages.join(TXT_PAGE_BREAK);
    text.push('\n');
    text
}

pub(super) fn join_markdown(pages: &[String]) -> String {
    let mut text = pages.join(MD_PAGE_BREAK);
    text.push('\n');
    text
}

/// The characters with their boxes: surrogate pairs joined (the pair keeps its first half's
/// box), anything that is not a character replaced by U+FFFD.
pub(super) fn decode(glyphs: &[Glyph]) -> Vec<(char, Option<Rect>)> {
    let mut chars = Vec::with_capacity(glyphs.len());
    let mut i = 0;
    while i < glyphs.len() {
        let glyph = glyphs[i];
        i += 1;
        let c = match glyph.code {
            high @ 0xD800..=0xDBFF => match glyphs.get(i).map(|g| g.code) {
                Some(low @ 0xDC00..=0xDFFF) => {
                    i += 1;
                    char::from_u32(0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00))
                }
                _ => None,
            },
            code => char::from_u32(code),
        }
        .unwrap_or(char::REPLACEMENT_CHARACTER);
        chars.push((c, glyph.rect));
    }
    chars
}

/// Characters to lines: surrogate pairs joined, control characters dropped, PDFium's breaks
/// (`\r\n`, a lone `\r` or `\n`) ending lines.
fn lines(glyphs: &[Glyph]) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut line = Line::default();
    let mut after_cr = false;
    for (c, rect) in decode(glyphs) {
        match c {
            '\n' if after_cr => {}
            '\r' | '\n' => lines.push(std::mem::take(&mut line)),
            '\t' => line.text.push('\t'),
            // PDFium marks some line-end hyphens with STX.
            '\u{2}' => line.text.push('-'),
            c if c.is_control() || c == '\u{FFFE}' || c == '\u{FFFF}' => {}
            c => {
                line.text.push(c);
                if !c.is_whitespace() {
                    if let Some(rect) = rect.filter(|r| r.height() > 0.0) {
                        line.rect = Some(line.rect.map_or(rect, |r| r.union(rect)));
                    }
                }
            }
        }
        after_cr = c == '\r';
    }
    if !line.text.is_empty() {
        lines.push(line);
    }
    lines
}

fn paragraphs(lines: &[Line]) -> Vec<String> {
    let mut paragraphs = Vec::new();
    let mut current = String::new();
    let mut previous: Option<&Line> = None;
    for line in lines {
        let text = line.text.trim();
        if text.is_empty() {
            flush(&mut paragraphs, &mut current);
            previous = None;
            continue;
        }
        if previous.is_some_and(|previous| starts_paragraph(previous, line)) {
            flush(&mut paragraphs, &mut current);
        }
        append(&mut current, text);
        previous = Some(line);
    }
    flush(&mut paragraphs, &mut current);
    paragraphs
}

fn flush(paragraphs: &mut Vec<String>, current: &mut String) {
    if !current.is_empty() {
        paragraphs.push(std::mem::take(current));
    }
}

/// Whether `line` starts a new paragraph after `previous`, from their boxes in page space
/// (y grows upwards).
fn starts_paragraph(previous: &Line, line: &Line) -> bool {
    let (Some(a), Some(b)) = (previous.rect, line.rect) else {
        return true;
    };
    let height = a.height().max(b.height()).max(1.0);
    let gap = a.bottom - b.top;
    // More space than the usual leading, a jump back up (a new column or a block placed out of
    // order) or a first-line indent.
    gap > 0.6 * height || b.top > a.top + 0.5 * height || b.left > a.left + height
}

/// Joins a line to its paragraph, mending words hyphenated at the line end.
fn append(paragraph: &mut String, text: &str) {
    if paragraph.is_empty() {
        paragraph.push_str(text);
        return;
    }
    if paragraph.ends_with('\u{AD}') {
        paragraph.pop();
        paragraph.push_str(text);
        return;
    }
    let mut tail = paragraph.chars().rev();
    let hyphenated = tail.next() == Some('-')
        && tail.next().is_some_and(char::is_alphabetic)
        && text.chars().next().is_some_and(char::is_lowercase);
    if hyphenated {
        paragraph.pop();
    } else {
        paragraph.push(' ');
    }
    paragraph.push_str(text);
}

/// Backslash-escapes what Markdown would read as markup, so the text shows as written.
fn escape_markdown(paragraph: &str) -> String {
    let mut out = String::with_capacity(paragraph.len() + 8);
    let mut chars = paragraph.char_indices().peekable();
    // A paragraph that would start a heading, quote, list or rule.
    if let Some(&(_, first)) = chars.peek() {
        if matches!(first, '#' | '>' | '-' | '+' | '=') {
            out.push('\\');
        } else if first.is_ascii_digit() {
            let digits = paragraph.chars().take_while(char::is_ascii_digit).count();
            if matches!(paragraph[digits..].chars().next(), Some('.' | ')')) {
                out.push_str(&paragraph[..digits]);
                out.push('\\');
                chars.nth(digits - 1);
            }
        }
    }
    for (_, c) in chars {
        if matches!(c, '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '~') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Glyphs for lines of text: each line is (text, left, baseline), 10 pt glyphs 5 pt wide.
    fn page(lines: &[(&str, f32, f32)]) -> Vec<Glyph> {
        let mut glyphs = Vec::new();
        for (text, left, base) in lines {
            for (i, c) in text.chars().enumerate() {
                let x = left + i as f32 * 5.0;
                glyphs.push(Glyph {
                    code: u32::from(c),
                    rect: Some(Rect {
                        left: x,
                        bottom: base - 2.0,
                        right: x + 5.0,
                        top: base + 8.0,
                    }),
                });
            }
            glyphs.push(Glyph {
                code: 13,
                rect: None,
            });
            glyphs.push(Glyph {
                code: 10,
                rect: None,
            });
        }
        glyphs
    }

    #[test]
    fn pdf_text_plain_keeps_lines_and_pages() {
        let glyphs = page(&[("First line  ", 72.0, 700.0), ("Second", 72.0, 688.0)]);
        let one = plain_page(&glyphs);
        assert_eq!(one, "First line\nSecond");
        let joined = join_plain(&[one, String::new(), "Third".into()]);
        assert_eq!(
            joined, "First line\nSecond\n\n\u{c}\n\n\n\u{c}\nThird\n",
            "an empty page keeps its place"
        );
    }

    #[test]
    fn pdf_text_markdown_paragraphs() {
        let glyphs = page(&[
            ("A paragraph that is hyphen-", 72.0, 700.0),
            ("ated across two lines.", 72.0, 688.0),
            ("After a gap, a second one", 72.0, 660.0),
            ("with *stars* and [brackets].", 72.0, 648.0),
            ("Indented first line", 100.0, 636.0),
            ("1. not a list", 72.0, 624.0),
        ]);
        let text = markdown_page(&glyphs);
        assert_eq!(
            text,
            "A paragraph that is hyphenated across two lines.\n\n\
             After a gap, a second one with \\*stars\\* and \\[brackets\\].\n\n\
             Indented first line 1. not a list"
        );
        assert_eq!(
            join_markdown(&[text.clone(), "# not a heading".into()]),
            format!("{text}\n\n---\n\n# not a heading\n")
        );
        assert_eq!(escape_markdown("# hash"), "\\# hash");
        assert_eq!(escape_markdown("12) twelve"), "12\\) twelve");
        assert_eq!(escape_markdown("- dash"), "\\- dash");
        assert_eq!(escape_markdown("2024 was a year"), "2024 was a year");
    }

    #[test]
    fn pdf_text_joins_surrogates_and_drops_controls() {
        let glyphs: Vec<Glyph> = [0x4B, 0xD83E, 0xDDEA, 0x0, 0x6F, 0xD800, 0x21]
            .into_iter()
            .map(|code| Glyph { code, rect: None })
            .collect();
        assert_eq!(plain_page(&glyphs), "K🧪o\u{FFFD}!");
    }
}
