// SPDX-License-Identifier: MIT
//! Spreadsheet conversions that need no office suite: CSV, TSV, XLS, XLSX and ODS to CSV, TSV,
//! XLSX and HTML.
//!
//! - CSV and TSV outputs hold one sheet: the first one with any value. They are UTF-8 with a BOM
//!   (so Excel picks the encoding), CRLF line endings and RFC 4180 quoting; dates are ISO 8601.
//! - XLSX output holds every sheet, values only: numbers, booleans, text, and dates and times as
//!   real dates with a number format. Formulas, styles, merged cells and charts are not carried.
//!   CSV and TSV values are typed the way a spreadsheet would type them when typed in; a file
//!   delimited by `;` is taken to write decimals with a comma, as the locales that use `;` do.
//! - HTML output is one page with a table per sheet, each under its sheet name.

mod read;
#[cfg(test)]
mod tests;
mod write;

/// LibreOffice's CSV import gets the delimiter this engine would read (`office`).
pub(crate) use read::sniff_delimiter;

use std::path::{Path, PathBuf};

use crate::{Conversion, Error, Progress, Result};

const INPUTS: [&str; 5] = ["csv", "tsv", "xls", "xlsx", "ods"];
const OUTPUTS: [&str; 4] = ["csv", "tsv", "xlsx", "html"];

/// Inputs over this size are refused.
const MAX_INPUT_BYTES: u64 = 256 << 20;
/// Non-empty cells across all sheets.
const MAX_CELLS: usize = 10_000_000;
/// Rows × columns written to CSV, TSV or HTML, where empty cells take room too.
const MAX_GRID: u64 = 50_000_000;

pub fn supports(from: &str, to: &str) -> bool {
    INPUTS.contains(&from) && OUTPUTS.contains(&to) && from != to
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    if !supports(job.from, job.to) {
        return Err(Error::Unsupported {
            from: job.from.to_owned(),
            to: job.to.to_owned(),
        });
    }
    job.progress.check()?;
    let delimited = matches!(job.from, "csv" | "tsv");
    let (sheets, typing) = if delimited {
        let (sheet, delimiter) = read::delimited(job.input, job.from, job.progress)?;
        let decimal = if delimiter == b';' { ',' } else { '.' };
        (vec![sheet], Some(decimal))
    } else {
        (read::workbook(job.input, job.from, job.progress)?, None)
    };
    job.progress.report(0.5);
    job.progress.check()?;
    let title = crate::text::stem(job.input);
    match job.to {
        "csv" | "tsv" => {
            let delimiter = if job.to == "tsv" { b'\t' } else { b',' };
            let sheet = sheets.iter().find(|sheet| !sheet.cells.is_empty());
            write::delimited(sheet, delimiter, job.dest, job.progress)?;
        }
        "xlsx" => write::xlsx(&sheets, typing, job.dest, job.progress)?,
        _ => write::html(&sheets, &title, !delimited, job.dest, job.progress)?,
    }
    job.progress.report(1.0);
    Ok(vec![job.dest.to_path_buf()])
}

/// A sheet's name and its cells as (row, column, text).
pub(crate) type TextSheet = (String, Vec<(u32, u32, String)>);

/// A workbook from text read off another document (the tables of a PDF): one sheet per
/// `(name, cells)`, the cells as (row, column, text) sorted by row, then column. Text that is
/// plainly a number becomes one, with the decimal separator most of the numbers use; unlike CSV,
/// thousands separators and accounting negatives in parentheses are read as printed tables
/// write them.
pub(crate) fn xlsx_from_text(
    sheets: Vec<TextSheet>,
    dest: &Path,
    progress: &Progress,
) -> Result<()> {
    let decimal = decimal_of(
        sheets
            .iter()
            .flat_map(|(_, cells)| cells.iter().map(|(_, _, text)| text.as_str())),
    );
    let sheets: Vec<Sheet> = sheets
        .into_iter()
        .map(|(name, cells)| Sheet {
            name,
            cells: cells
                .into_iter()
                .map(|(row, column, text)| (row, column, printed(&text, decimal)))
                .collect(),
        })
        .collect();
    write::xlsx(&sheets, None, dest, progress)
}

/// `,` when more numbers end in a comma part that cannot be a thousands group than in such a
/// dot part, `.` otherwise.
fn decimal_of<'a>(texts: impl Iterator<Item = &'a str>) -> char {
    let (mut commas, mut dots) = (0usize, 0usize);
    for text in texts {
        let text = text.trim();
        let numeric = !text.is_empty()
            && text.chars().any(|c| c.is_ascii_digit())
            && text
                .chars()
                .all(|c| c.is_ascii_digit() || matches!(c, '.' | ',' | ' ' | '-' | '(' | ')'));
        let Some(at) = numeric.then(|| text.rfind(['.', ','])).flatten() else {
            continue;
        };
        let digits = text[at + 1..]
            .chars()
            .take_while(char::is_ascii_digit)
            .count();
        if digits != 3 && digits > 0 {
            if text[at..].starts_with(',') {
                commas += 1;
            } else {
                dots += 1;
            }
        }
    }
    if commas > dots {
        ','
    } else {
        '.'
    }
}

/// A printed table's cell: a number with thousands separators, a sign (also U+2212) or
/// parentheses for a negative, then whatever `infer` makes of it.
fn printed(text: &str, decimal: char) -> Value {
    let trimmed = text.trim();
    let (negative, body) = match trimmed.strip_prefix('(').and_then(|t| t.strip_suffix(')')) {
        Some(inner) => (true, inner.trim()),
        None => (false, trimmed),
    };
    let number = ungrouped(body, decimal)
        .map(|plain| infer(&plain, decimal))
        .filter(|value| matches!(value, Value::Int(_) | Value::Number(_)));
    match (number, negative) {
        (Some(Value::Int(int)), true) => Value::Int(-int),
        (Some(Value::Number(number)), true) => Value::Number(-number),
        (Some(number), false) => number,
        (_, true) => Value::Text(trimmed.to_owned()),
        (None, false) => infer(trimmed, decimal),
    }
}

/// `1,234,567.89` → `1234567.89` (with `.` as the decimal separator): groups of three after the
/// first, one separator throughout. None when the text is not such a number.
fn ungrouped(text: &str, decimal: char) -> Option<String> {
    let (sign, rest) = match text.chars().next()? {
        '-' | '\u{2212}' => ("-", &text[text.chars().next()?.len_utf8()..]),
        '+' => ("", &text[1..]),
        _ => ("", text),
    };
    let (whole, fraction) = match rest.split_once(decimal) {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (rest, None),
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let is_group =
        |c: char| c != decimal && matches!(c, '.' | ',' | ' ' | '\'' | '\u{a0}' | '\u{202f}');
    let mut separators = whole.chars().filter(|&c| is_group(c));
    if let Some(first) = separators.next() {
        if separators.any(|c| c != first) {
            return None;
        }
        let groups: Vec<&str> = whole.split(first).collect();
        let (head, tail) = groups.split_first()?;
        if !digits(head) || head.len() > 3 || tail.iter().any(|g| g.len() != 3 || !digits(g)) {
            return None;
        }
    } else if !digits(whole) {
        return None;
    }
    if fraction.is_some_and(|f| !digits(f)) {
        return None;
    }
    let mut plain: String = sign.to_owned();
    plain.extend(whole.chars().filter(|&c| !is_group(c)));
    if let Some(fraction) = fraction {
        plain.push(decimal);
        plain.push_str(fraction);
    }
    Some(plain)
}

/// One worksheet's non-empty cells, in row order.
#[derive(Debug, Clone, PartialEq)]
struct Sheet {
    name: String,
    /// (row, column, value), 0-based from A1, sorted by row then column.
    cells: Vec<(u32, u32, Value)>,
}

impl Sheet {
    fn rows(&self) -> u32 {
        self.cells.last().map_or(0, |&(row, _, _)| row + 1)
    }

    fn columns(&self) -> u32 {
        self.cells
            .iter()
            .map(|&(_, col, _)| col + 1)
            .max()
            .unwrap_or(0)
    }

    /// Rows of cells with the gaps filled, for formats that write every cell.
    fn grid(&self) -> Result<Grid<'_>> {
        let (rows, columns) = (self.rows(), self.columns());
        if u64::from(rows) * u64::from(columns) > MAX_GRID {
            return Err(Error::Limit(format!(
                "the sheet spans {rows} rows × {columns} columns"
            )));
        }
        Ok(Grid {
            cells: &self.cells,
            next: 0,
            row: 0,
            rows,
            columns,
        })
    }
}

struct Grid<'a> {
    cells: &'a [(u32, u32, Value)],
    next: usize,
    row: u32,
    rows: u32,
    columns: u32,
}

impl<'a> Iterator for Grid<'a> {
    type Item = Vec<Option<&'a Value>>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.row >= self.rows {
            return None;
        }
        let mut row = vec![None; self.columns as usize];
        while let Some((r, c, value)) = self.cells.get(self.next) {
            if *r != self.row {
                break;
            }
            row[*c as usize] = Some(value);
            self.next += 1;
        }
        self.row += 1;
        Some(row)
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Value {
    Text(String),
    Int(i64),
    Number(f64),
    Bool(bool),
    Date(Stamp),
    /// Days, as spreadsheets count durations.
    Duration(f64),
    /// A formula error such as `#DIV/0!`.
    Error(String),
}

/// A calendar date, a time of day, or both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
    date: Option<(u16, u8, u8)>,
    /// Hours, minutes, seconds, milliseconds.
    time: Option<(u8, u8, u8, u16)>,
}

impl Value {
    /// The value as text in CSV, TSV and HTML.
    fn text(&self) -> String {
        match self {
            Value::Text(text) | Value::Error(text) => text.clone(),
            Value::Int(number) => number.to_string(),
            Value::Number(number) => number_text(*number),
            Value::Bool(true) => "TRUE".to_owned(),
            Value::Bool(false) => "FALSE".to_owned(),
            Value::Date(stamp) => stamp.iso(),
            Value::Duration(days) => duration_text(*days),
        }
    }

    fn is_numeric(&self) -> bool {
        matches!(
            self,
            Value::Int(_) | Value::Number(_) | Value::Date(_) | Value::Duration(_)
        )
    }
}

impl Stamp {
    /// ISO 8601: `2024-01-31`, `13:05:00` or `2024-01-31T13:05:00.250`.
    fn iso(&self) -> String {
        let date = self.date.map(|(y, m, d)| format!("{y:04}-{m:02}-{d:02}"));
        let time = self.time.map(|(h, m, s, ms)| {
            if ms == 0 {
                format!("{h:02}:{m:02}:{s:02}")
            } else {
                format!("{h:02}:{m:02}:{s:02}.{ms:03}")
            }
        });
        match (date, time) {
            (Some(date), Some(time)) => format!("{date}T{time}"),
            (Some(date), None) => date,
            (None, Some(time)) => time,
            (None, None) => String::new(),
        }
    }
}

/// Spreadsheets keep 15 significant digits; anything past that is binary noise (0.1 + 0.2).
fn number_text(number: f64) -> String {
    if !number.is_finite() {
        return number.to_string();
    }
    let rounded: f64 = format!("{number:.14e}").parse().unwrap_or(number);
    if rounded == 0.0 {
        "0".to_owned()
    } else {
        rounded.to_string()
    }
}

/// `[h]:mm:ss`, the way spreadsheets show durations.
fn duration_text(days: f64) -> String {
    let total_ms = (days.abs() * 86_400_000.0).round() as u64;
    let sign = if days < 0.0 && total_ms > 0 { "-" } else { "" };
    let (hours, rest) = (total_ms / 3_600_000, total_ms % 3_600_000);
    let (minutes, seconds, ms) = (rest / 60_000, rest % 60_000 / 1000, rest % 1000);
    if ms == 0 {
        format!("{sign}{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{sign}{hours}:{minutes:02}:{seconds:02}.{ms:03}")
    }
}

/// Reads `2024-01-31`, `2024-01-31T13:05`, `2024-01-31 13:05:00.5` or `13:05:00`; a trailing zone
/// (`Z`, `+03:00`) is ignored because spreadsheet dates have none.
fn parse_iso(text: &str) -> Option<Stamp> {
    let text = text.trim();
    let digits = |s: &str, len: usize| -> Option<u32> {
        (s.len() == len && s.bytes().all(|b| b.is_ascii_digit()))
            .then(|| s.parse().ok())
            .flatten()
    };
    let (date_part, time_part) = if text.len() >= 10 && text.as_bytes().get(4) == Some(&b'-') {
        let rest = text.get(10..)?;
        let time = rest.strip_prefix(['T', ' ']);
        if time.is_none() && !rest.is_empty() {
            return None;
        }
        (Some(text.get(..10)?), time)
    } else {
        (None, Some(text))
    };
    let date = match date_part {
        Some(date) => {
            let year = digits(date.get(0..4)?, 4)?;
            let month = digits(date.get(5..7)?, 2)?;
            let day = digits(date.get(8..10)?, 2)?;
            if date.as_bytes()[7] != b'-' || !(1..=12).contains(&month) || day == 0 {
                return None;
            }
            if day > days_in_month(year, month) {
                return None;
            }
            Some((year as u16, month as u8, day as u8))
        }
        None => None,
    };
    let time = match time_part {
        Some(time) => {
            let time = time.trim_end_matches('Z');
            let time = match time.find(['+', '-']) {
                Some(zone) if zone >= 5 => &time[..zone],
                _ => time,
            };
            let (clock, fraction) = time.split_once(['.', ',']).unwrap_or((time, ""));
            let mut parts = clock.split(':');
            let hour = digits(parts.next()?, 2)?;
            let minute = digits(parts.next()?, 2)?;
            let second = match parts.next() {
                Some(second) => digits(second, 2)?,
                // A bare `13:05` reads as a ratio or a score more often than as a time.
                None if date.is_none() => return None,
                None => 0,
            };
            if parts.next().is_some()
                || hour > 23
                || minute > 59
                || second > 59
                || !fraction.bytes().all(|b| b.is_ascii_digit())
            {
                return None;
            }
            let ms = fraction
                .bytes()
                .chain(std::iter::repeat(b'0'))
                .take(3)
                .fold(0u16, |ms, b| ms * 10 + u16::from(b - b'0'));
            Some((hour as u8, minute as u8, second as u8, ms))
        }
        None => None,
    };
    (date.is_some() || time.is_some()).then_some(Stamp { date, time })
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400)) => {
            29
        }
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// ISO 8601 durations as OpenDocument writes them (`PT36H15M00S`, `-P1DT2H`), in days.
fn parse_iso_duration(text: &str) -> Option<f64> {
    let (negative, text) = match text.trim().strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text.trim()),
    };
    let body = text.strip_prefix('P')?;
    let (date, time) = body.split_once('T').unwrap_or((body, ""));
    let mut seconds = 0.0;
    let mut any = false;
    for (part, units) in [
        (date, &[('W', 604_800.0), ('D', 86_400.0)][..]),
        (time, &[('H', 3600.0), ('M', 60.0), ('S', 1.0)][..]),
    ] {
        let mut rest = part;
        while !rest.is_empty() {
            let end = rest.find(|c: char| c.is_ascii_alphabetic())?;
            let unit = rest[end..].chars().next()?;
            let factor = units.iter().find(|(u, _)| *u == unit)?.1;
            let amount: f64 = rest[..end].replace(',', ".").parse().ok()?;
            seconds += amount * factor;
            any = true;
            rest = &rest[end + 1..];
        }
    }
    let days = seconds / 86_400.0;
    any.then_some(if negative { -days } else { days })
}

/// A CSV or TSV field as a spreadsheet would read it when typed in: plain numbers (with `decimal`
/// as the decimal separator, no thousands separators), TRUE/FALSE and ISO dates. Numbers with
/// leading zeros or more than 15 digits stay text (codes, phone and account numbers).
fn infer(text: &str, decimal: char) -> Value {
    let number = if decimal == ',' && !text.contains('.') {
        plain_number(&text.replacen(',', ".", 1))
    } else if decimal == '.' && !text.contains(',') {
        plain_number(text)
    } else {
        None
    };
    if let Some(number) = number {
        return number;
    }
    if text.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if text.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if let Some(stamp) = parse_iso(text) {
        return Value::Date(stamp);
    }
    Value::Text(text.to_owned())
}

fn plain_number(text: &str) -> Option<Value> {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let (mantissa, exponent) = match unsigned.find(['e', 'E']) {
        Some(at) => (&unsigned[..at], Some(&unsigned[at + 1..])),
        None => (unsigned, None),
    };
    let (whole, fraction) = match mantissa.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (mantissa, None),
    };
    let all_digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !all_digits(whole)
        || (whole.len() > 1 && whole.starts_with('0'))
        || fraction.is_some_and(|f| !all_digits(f))
        || exponent.is_some_and(|e| !all_digits(e.strip_prefix(['+', '-']).unwrap_or(e)))
    {
        return None;
    }
    let significant = whole.trim_start_matches('0').len() + fraction.map_or(0, str::len);
    if significant > 15 {
        return None;
    }
    if fraction.is_none() && exponent.is_none() {
        if let Ok(int) = text.parse::<i64>() {
            return Some(Value::Int(int));
        }
    }
    text.parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
        .map(Value::Number)
}
