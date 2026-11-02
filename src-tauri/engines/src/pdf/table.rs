// SPDX-License-Identifier: MIT
//! Tables read off a PDF page's characters, for pdf → xlsx. A best effort that reads the page as
//! someone copying a printed table would:
//!
//! - Characters on a line join into runs until a gap clearly wider than a word space, a tab or
//!   two spaces in a row.
//! - Runs whose boxes share most of their height form a row; rows go top to bottom.
//! - The columns are the x ranges covered by the runs of the page's typical table rows (the most
//!   common number of runs, two or more). Every run then goes to the column it starts in, or
//!   the nearest one; runs that land in the same cell are joined with a space.

use super::text::{decode, Glyph, Rect};

/// A gap wider than this share of the line's height ends a run. A word space is about a quarter
/// of the height of a character's loose box, a gap between table columns usually more than half.
const SPLIT_GAP: f32 = 0.5;

/// Two boxes are on one line, or in one row, when they share at least this share of the lower
/// one's height.
const SAME_LINE: f32 = 0.5;

#[derive(Debug, Clone)]
struct Run {
    text: String,
    rect: Rect,
}

impl Run {
    fn middle_y(&self) -> f32 {
        (self.rect.bottom + self.rect.top) / 2.0
    }
}

/// The page's cells as (row, column, text), 0-based and sorted by row, then column.
pub(super) fn cells(glyphs: &[Glyph]) -> Vec<(u32, u32, String)> {
    let rows = rows(runs(glyphs));
    let bands = columns(&rows);
    let mut cells: Vec<(u32, u32, String)> = Vec::new();
    for (row, runs) in rows.iter().enumerate() {
        let row = row as u32;
        for run in runs {
            let column = column_of(&bands, &run.rect);
            match cells.last_mut() {
                // Runs are in x order, so a second run in a cell follows the first.
                Some((r, c, text)) if *r == row && *c == column => {
                    text.push(' ');
                    text.push_str(&run.text);
                }
                _ => cells.push((row, column, run.text.clone())),
            }
        }
    }
    cells.sort_by_key(|&(row, column, _)| (row, column));
    cells
}

fn overlap(a: &Rect, b: &Rect) -> f32 {
    a.top.min(b.top) - a.bottom.max(b.bottom)
}

fn same_line(a: &Rect, b: &Rect) -> bool {
    overlap(a, b) >= SAME_LINE * a.height().min(b.height())
}

fn runs(glyphs: &[Glyph]) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut current: Option<Run> = None;
    // Whitespace since the last visible character: one space joins words, more split cells.
    let mut spaces = 0;
    let flush = |current: &mut Option<Run>, runs: &mut Vec<Run>| {
        if let Some(run) = current.take() {
            runs.push(run);
        }
    };
    for (c, rect) in decode(glyphs) {
        match c {
            '\r' | '\n' | '\t' => {
                flush(&mut current, &mut runs);
                spaces = 0;
            }
            c if c.is_whitespace() => spaces += 1,
            c if c.is_control() && c != '\u{2}' => {}
            '\u{FFFE}' | '\u{FFFF}' => {}
            c => {
                // PDFium marks some line-end hyphens with STX.
                let c = if c == '\u{2}' { '-' } else { c };
                let rect = rect.filter(|r| r.height() > 0.0 && r.right >= r.left);
                let joins = match (&current, rect) {
                    (Some(_), None) => true,
                    (Some(run), Some(rect)) => {
                        let height = run.rect.height().max(rect.height());
                        let gap = rect.left - run.rect.right;
                        spaces < 2
                            && same_line(&run.rect, &rect)
                            && gap <= SPLIT_GAP * height
                            && gap >= -height
                    }
                    (None, _) => false,
                };
                if joins {
                    let run = current.as_mut().expect("a run to join");
                    if spaces > 0 {
                        run.text.push(' ');
                    }
                    run.text.push(c);
                    if let Some(rect) = rect {
                        run.rect = run.rect.union(rect);
                    }
                } else if let Some(rect) = rect {
                    flush(&mut current, &mut runs);
                    current = Some(Run {
                        text: c.to_string(),
                        rect,
                    });
                }
                spaces = 0;
            }
        }
    }
    flush(&mut current, &mut runs);
    runs
}

/// Runs grouped into rows, top to bottom, each row left to right.
fn rows(mut runs: Vec<Run>) -> Vec<Vec<Run>> {
    // PDF space grows upwards: the top row has the largest y.
    runs.sort_by(|a, b| b.middle_y().total_cmp(&a.middle_y()));
    let mut rows: Vec<(Rect, Vec<Run>)> = Vec::new();
    for run in runs {
        match rows.last_mut() {
            Some((band, row)) if same_line(band, &run.rect) => {
                *band = band.union(run.rect);
                row.push(run);
            }
            _ => rows.push((run.rect, vec![run])),
        }
    }
    rows.into_iter()
        .map(|(_, mut row)| {
            row.sort_by(|a, b| a.rect.left.total_cmp(&b.rect.left));
            row
        })
        .collect()
}

/// The columns' x ranges, left to right, from the rows with the most common number of runs
/// (two or more; ties go to the wider rows). Empty when no row has two runs.
fn columns(rows: &[Vec<Run>]) -> Vec<(f32, f32)> {
    let mut counts: Vec<(usize, usize)> = Vec::new();
    for row in rows.iter().filter(|row| row.len() >= 2) {
        match counts.iter_mut().find(|(len, _)| *len == row.len()) {
            Some((_, seen)) => *seen += 1,
            None => counts.push((row.len(), 1)),
        }
    }
    let Some(&(typical, _)) = counts.iter().max_by_key(|&&(len, seen)| (seen, len)) else {
        return Vec::new();
    };
    let mut spans: Vec<(f32, f32)> = rows
        .iter()
        .filter(|row| row.len() == typical)
        .flatten()
        .map(|run| (run.rect.left, run.rect.right))
        .collect();
    spans.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut bands: Vec<(f32, f32)> = Vec::new();
    for (left, right) in spans {
        match bands.last_mut() {
            Some(band) if left <= band.1 => band.1 = band.1.max(right),
            _ => bands.push((left, right)),
        }
    }
    bands
}

/// The first column the run overlaps (a run that spans several starts in the first), or else
/// the nearest one to its middle.
fn column_of(bands: &[(f32, f32)], rect: &Rect) -> u32 {
    if let Some(index) = bands
        .iter()
        .position(|&(left, right)| rect.left < right && rect.right > left)
    {
        return index as u32;
    }
    let middle = (rect.left + rect.right) / 2.0;
    let distance = |&(left, right): &(f32, f32)| {
        if middle < left {
            left - middle
        } else {
            (middle - right).max(0.0)
        }
    };
    bands
        .iter()
        .enumerate()
        .min_by(|a, b| distance(a.1).total_cmp(&distance(b.1)))
        .map_or(0, |(index, _)| index as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Glyphs for pieces of text: each is (text, left, baseline), 10 pt boxes 4 pt wide per
    /// character, with a line break after each piece as PDFium gives between text objects.
    fn page(pieces: &[(&str, f32, f32)]) -> Vec<Glyph> {
        let mut glyphs = Vec::new();
        for (text, left, base) in pieces {
            for (i, c) in text.chars().enumerate() {
                let x = left + i as f32 * 4.0;
                glyphs.push(Glyph {
                    code: u32::from(c),
                    rect: Some(Rect {
                        left: x,
                        bottom: base - 2.0,
                        right: x + 4.0,
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

    fn text(cells: &[(u32, u32, String)]) -> Vec<(u32, u32, &str)> {
        cells.iter().map(|(r, c, t)| (*r, *c, t.as_str())).collect()
    }

    #[test]
    fn pdf_table_rows_and_columns_from_separate_pieces() {
        // Out of order on purpose: PDFium gives content order, which need not be reading order.
        let glyphs = page(&[
            ("Price", 300.0, 700.0),
            ("Name", 72.0, 700.0),
            ("Qty", 200.0, 700.0),
            ("Pear", 72.0, 686.0),
            ("12", 205.0, 686.0),
            ("1.50", 300.0, 686.0),
            ("Kiwi ğüş", 72.0, 672.0),
            ("3", 210.0, 672.0),
            ("0.25", 300.0, 672.0),
            ("Monthly fruit order", 72.0, 740.0),
        ]);
        assert_eq!(
            text(&cells(&glyphs)),
            vec![
                (0, 0, "Monthly fruit order"),
                (1, 0, "Name"),
                (1, 1, "Qty"),
                (1, 2, "Price"),
                (2, 0, "Pear"),
                (2, 1, "12"),
                (2, 2, "1.50"),
                (3, 0, "Kiwi ğüş"),
                (3, 1, "3"),
                (3, 2, "0.25"),
            ]
        );
    }

    #[test]
    fn pdf_table_splits_one_line_at_wide_gaps_and_double_spaces() {
        // One text object per row, as reports often write them: words keep their single
        // spaces, the columns are two spaces or a wide gap apart.
        let mut glyphs = page(&[("Total               42", 72.0, 700.0)]);
        glyphs.extend(page(&[("Net price", 72.0, 686.0)]));
        // "Net price" and "40" on one line, far apart.
        glyphs.pop();
        glyphs.pop();
        glyphs.extend(page(&[("40", 152.0, 686.0)]));
        assert_eq!(
            text(&cells(&glyphs)),
            vec![
                (0, 0, "Total"),
                (0, 1, "42"),
                (1, 0, "Net price"),
                (1, 1, "40"),
            ]
        );
    }

    #[test]
    fn pdf_table_spanning_and_stray_runs_find_a_column() {
        let glyphs = page(&[
            ("A", 72.0, 700.0),
            ("B", 200.0, 700.0),
            ("C", 72.0, 686.0),
            ("D", 200.0, 686.0),
            // Starts in the first column and runs across the second.
            ("a note that runs across both of the columns", 72.0, 672.0),
            // Starts in the gap, nearer the second column.
            ("x", 180.0, 658.0),
        ]);
        assert_eq!(
            text(&cells(&glyphs)),
            vec![
                (0, 0, "A"),
                (0, 1, "B"),
                (1, 0, "C"),
                (1, 1, "D"),
                (2, 0, "a note that runs across both of the columns"),
                (3, 1, "x"),
            ]
        );
    }

    #[test]
    fn pdf_table_plain_text_stays_in_one_column() {
        let glyphs = page(&[
            ("Just a paragraph of words", 72.0, 700.0),
            ("and its second line.", 72.0, 686.0),
        ]);
        assert_eq!(
            text(&cells(&glyphs)),
            vec![
                (0, 0, "Just a paragraph of words"),
                (1, 0, "and its second line."),
            ]
        );
        assert!(cells(&[]).is_empty());
    }
}
