// SPDX-License-Identifier: MIT
//! CSV and TSV text, and XLS, XLSX and ODS workbooks (through `calamine`), read into sheets.

use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

use calamine::{
    open_workbook, Data, DataRef, ExcelDateTime, Ods, OdsError, Reader, SheetType, Xls, XlsError,
    Xlsx, XlsxError,
};

use super::{parse_iso, parse_iso_duration, Sheet, Stamp, Value, MAX_CELLS, MAX_INPUT_BYTES};
use crate::{text, Error, Progress, Result};

/// The cells still allowed before a workbook counts as absurd.
pub(super) struct Budget(pub(super) usize);

impl Budget {
    pub(super) fn take(&mut self) -> Result<()> {
        self.0 = self
            .0
            .checked_sub(1)
            .ok_or_else(|| Error::Limit(format!("the workbook has more than {MAX_CELLS} cells")))?;
        Ok(())
    }
}

/// The sheet and the delimiter it was read with.
pub(super) fn delimited(path: &Path, from: &str, progress: &Progress) -> Result<(Sheet, u8)> {
    let bytes = text::read_capped(path, MAX_INPUT_BYTES)?;
    let content = text::decode(&bytes);
    drop(bytes);
    let delimiter = if from == "tsv" {
        b'\t'
    } else {
        sniff_delimiter(&content)
    };
    let backslash = sniff_backslash(&content);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter)
        .double_quote(!backslash)
        .escape(backslash.then_some(b'\\'))
        .from_reader(content.as_bytes());
    let mut budget = Budget(MAX_CELLS);
    let mut cells = Vec::new();
    let mut record = csv::StringRecord::new();
    let mut row: u32 = 0;
    while reader
        .read_record(&mut record)
        .map_err(|error| Error::Unreadable(error.to_string()))?
    {
        for (column, field) in record.iter().enumerate() {
            if !field.is_empty() {
                budget.take()?;
                cells.push((row, column as u32, Value::Text(field.to_owned())));
            }
        }
        row = row
            .checked_add(1)
            .ok_or_else(|| Error::Limit("the file has too many rows".into()))?;
        if row.is_multiple_of(4096) {
            progress.check()?;
        }
    }
    let sheet = Sheet {
        name: text::stem(path),
        cells,
    };
    Ok((sheet, delimiter))
}

/// Picks the delimiter that splits the first records into the same number of fields most often.
pub(super) fn sniff_delimiter(content: &str) -> u8 {
    let mut end = content.len().min(64 * 1024);
    while !content.is_char_boundary(end) {
        end -= 1;
    }
    let sample = &content[..end];
    let complete = end == content.len();
    let mut best = (b',', (0, 0, std::cmp::Reverse(0)));
    for candidate in *b",;\t|" {
        let (counts, between_digits) = field_counts(sample, candidate, complete);
        let mut mode = (0, 0);
        for &count in &counts {
            let frequency = counts.iter().filter(|&&c| c == count).count();
            mode = mode.max((frequency, count));
        }
        // A comma between digits is more often a decimal separator than a delimiter.
        let score = (mode.0, mode.1, std::cmp::Reverse(between_digits));
        if mode.1 > 1 && score > best.1 {
            best = (candidate, score);
        }
    }
    best.0
}

/// Fields per non-empty record in the sample, quote-aware, and how many delimiters sit between
/// two digits.
fn field_counts(sample: &str, delimiter: u8, complete: bool) -> (Vec<usize>, usize) {
    let bytes = sample.as_bytes();
    let mut counts = Vec::new();
    let (mut fields, mut quoted, mut empty_line, mut between_digits) = (1, false, true, 0);
    for (i, &byte) in bytes.iter().enumerate() {
        match byte {
            b'"' => quoted = !quoted,
            b'\n' if !quoted => {
                if !empty_line {
                    counts.push(fields);
                }
                fields = 1;
                empty_line = true;
                if counts.len() == 50 {
                    return (counts, between_digits);
                }
                continue;
            }
            b'\r' => continue,
            _ if byte == delimiter && !quoted => {
                fields += 1;
                let digit = |at: Option<usize>| {
                    at.and_then(|at| bytes.get(at))
                        .is_some_and(u8::is_ascii_digit)
                };
                if digit(i.checked_sub(1)) && digit(Some(i + 1)) {
                    between_digits += 1;
                }
            }
            _ => {}
        }
        empty_line = false;
    }
    if complete && !empty_line {
        counts.push(fields);
    }
    (counts, between_digits)
}

/// Some exporters escape quotes with a backslash instead of doubling them.
fn sniff_backslash(content: &str) -> bool {
    let mut end = content.len().min(64 * 1024);
    while !content.is_char_boundary(end) {
        end -= 1;
    }
    let sample = &content[..end];
    sample.contains("\\\"") && !sample.contains("\"\"")
}

#[derive(Debug, Clone, Copy)]
enum Kind {
    Xlsx,
    Xls,
    Ods,
}

pub(super) fn workbook(path: &Path, from: &str, progress: &Progress) -> Result<Vec<Sheet>> {
    if std::fs::metadata(path)?.len() > MAX_INPUT_BYTES {
        return Err(Error::Limit(format!(
            "the file is larger than {} MB",
            MAX_INPUT_BYTES >> 20
        )));
    }
    let mut magic = Vec::with_capacity(8);
    File::open(path)?.take(8).read_to_end(&mut magic)?;
    // The content decides, not the extension: a renamed XLSX still opens, and an encrypted
    // XLSX is a compound file like XLS.
    let kinds = if magic.starts_with(b"PK\x03\x04") {
        if from == "ods" {
            [Kind::Ods, Kind::Xlsx]
        } else {
            [Kind::Xlsx, Kind::Ods]
        }
    } else if magic == [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] {
        [Kind::Xls, Kind::Xlsx]
    } else {
        return Err(Error::Unreadable(
            "this is not an Excel or OpenDocument workbook; it may be a web page or XML saved \
             with a spreadsheet extension"
                .into(),
        ));
    };
    match open(path, kinds[0], progress) {
        Err(Error::Unreadable(first)) => match open(path, kinds[1], progress) {
            Err(Error::Unreadable(_)) => Err(Error::Unreadable(first)),
            other => other,
        },
        result => result,
    }
}

fn open(path: &Path, kind: Kind, progress: &Progress) -> Result<Vec<Sheet>> {
    let mut budget = Budget(MAX_CELLS);
    match kind {
        Kind::Xlsx => {
            let mut workbook: Xlsx<_> = open_workbook(path).map_err(xlsx_error)?;
            let names = worksheet_names(&workbook);
            let mut sheets = Vec::with_capacity(names.len());
            for (index, name) in names.iter().enumerate() {
                progress.check()?;
                // Streaming the cells, unlike `worksheet_range`, never allocates the whole
                // rectangle, which a single far-away cell can make enormous.
                let mut reader = workbook.worksheet_cells_reader(name).map_err(xlsx_error)?;
                let mut cells = Vec::new();
                while let Some(cell) = reader.next_cell().map_err(xlsx_error)? {
                    if let Some(value) = from_ref(cell.get_value()) {
                        budget.take()?;
                        let (row, column) = cell.get_position();
                        cells.push((row, column, value));
                        if cells.len() % 65_536 == 0 {
                            progress.check()?;
                        }
                    }
                }
                cells.sort_by_key(|&(row, column, _)| (row, column));
                sheets.push(Sheet {
                    name: name.clone(),
                    cells,
                });
                progress.report(0.5 * (index + 1) as f32 / names.len() as f32);
            }
            Ok(sheets)
        }
        Kind::Xls => {
            let mut workbook: Xls<_> = open_workbook(path).map_err(xls_error)?;
            from_ranges(&mut workbook, xls_error, &mut budget, progress)
        }
        Kind::Ods => {
            let mut workbook: Ods<_> = open_workbook(path).map_err(ods_error)?;
            from_ranges(&mut workbook, ods_error, &mut budget, progress)
        }
    }
}

fn worksheet_names<RS: Read + Seek, R: Reader<RS>>(workbook: &R) -> Vec<String> {
    workbook
        .sheets_metadata()
        .iter()
        .filter(|sheet| sheet.typ == SheetType::WorkSheet)
        .map(|sheet| sheet.name.clone())
        .collect()
}

fn from_ranges<R: Reader<BufReader<File>>>(
    workbook: &mut R,
    error: fn(R::Error) -> Error,
    budget: &mut Budget,
    progress: &Progress,
) -> Result<Vec<Sheet>> {
    let names = worksheet_names(workbook);
    let mut sheets = Vec::with_capacity(names.len());
    for (index, name) in names.iter().enumerate() {
        progress.check()?;
        let range = workbook.worksheet_range(name).map_err(error)?;
        let (top, left) = range.start().unwrap_or((0, 0));
        let mut cells = Vec::new();
        for (row, column, data) in range.used_cells() {
            if let Some(value) = from_data(data) {
                budget.take()?;
                cells.push((top + row as u32, left + column as u32, value));
            }
        }
        sheets.push(Sheet {
            name: name.clone(),
            cells,
        });
        progress.report(0.5 * (index + 1) as f32 / names.len() as f32);
    }
    Ok(sheets)
}

fn from_ref(data: &DataRef) -> Option<Value> {
    Some(match data {
        DataRef::Empty => return None,
        DataRef::String(text) if text.is_empty() => return None,
        DataRef::SharedString("") => return None,
        DataRef::String(text) => Value::Text(text.clone()),
        DataRef::SharedString(text) => Value::Text((*text).to_owned()),
        DataRef::Int(number) => Value::Int(*number),
        DataRef::Float(number) => Value::Number(*number),
        DataRef::Bool(value) => Value::Bool(*value),
        DataRef::DateTime(datetime) => excel_datetime(datetime),
        DataRef::DateTimeIso(text) => iso_datetime(text),
        DataRef::DurationIso(text) => iso_duration(text),
        DataRef::Error(error) => Value::Error(error.to_string()),
    })
}

fn from_data(data: &Data) -> Option<Value> {
    Some(match data {
        Data::Empty => return None,
        Data::String(text) if text.is_empty() => return None,
        Data::String(text) => Value::Text(text.clone()),
        Data::Int(number) => Value::Int(*number),
        Data::Float(number) => Value::Number(*number),
        Data::Bool(value) => Value::Bool(*value),
        Data::DateTime(datetime) => excel_datetime(datetime),
        Data::DateTimeIso(text) => iso_datetime(text),
        Data::DurationIso(text) => iso_duration(text),
        Data::Error(error) => Value::Error(error.to_string()),
    })
}

fn excel_datetime(datetime: &ExcelDateTime) -> Value {
    if datetime.is_duration() {
        return Value::Duration(datetime.as_f64());
    }
    // Spreadsheets do not say whether a cell is a date, a time or both; the value does. Day 0
    // is no real date, so a value under 1 is a time of day.
    let (year, month, day, hour, minute, second, ms) = datetime.to_ymd_hms_milli();
    let has_date = datetime.as_f64() >= 1.0;
    let time = (hour, minute, second, ms);
    let has_time = time != (0, 0, 0, 0);
    Value::Date(Stamp {
        date: has_date.then_some((year, month, day)),
        time: (has_time || !has_date).then_some(time),
    })
}

fn iso_datetime(text: &str) -> Value {
    parse_iso(text).map_or_else(|| Value::Text(text.to_owned()), Value::Date)
}

fn iso_duration(text: &str) -> Value {
    parse_iso_duration(text).map_or_else(|| Value::Text(text.to_owned()), Value::Duration)
}

fn xlsx_error(error: XlsxError) -> Error {
    match error {
        XlsxError::Password => Error::Encrypted,
        other => Error::Unreadable(other.to_string()),
    }
}

fn xls_error(error: XlsError) -> Error {
    match error {
        XlsError::Password => Error::Encrypted,
        other => Error::Unreadable(other.to_string()),
    }
}

fn ods_error(error: OdsError) -> Error {
    match error {
        OdsError::Password => Error::Encrypted,
        other => Error::Unreadable(other.to_string()),
    }
}
