// SPDX-License-Identifier: MIT
//! Sheets written as CSV or TSV, XLSX (through `rust_xlsxwriter`) and HTML.

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use rust_xlsxwriter::{ExcelDateTime, Format, Workbook, Worksheet, XlsxError};

use super::{infer, Sheet, Stamp, Value};
use crate::{text, Error, Progress, Result};

const XLSX_ROWS: u32 = 1_048_576;
const XLSX_COLUMNS: u32 = 16_384;
const XLSX_TEXT: usize = 32_767;

/// UTF-8 with a BOM, CRLF and RFC 4180 quoting, every row as wide as the widest.
pub(super) fn delimited(
    sheet: Option<&Sheet>,
    delimiter: u8,
    dest: &Path,
    progress: &Progress,
) -> Result<()> {
    let grid = sheet.map(Sheet::grid).transpose()?;
    let mut file = BufWriter::new(File::create(dest)?);
    file.write_all("\u{feff}".as_bytes())?;
    if let Some(grid) = grid {
        let mut writer = csv::WriterBuilder::new()
            .delimiter(delimiter)
            .terminator(csv::Terminator::CRLF)
            .quote_style(csv::QuoteStyle::Necessary)
            .from_writer(&mut file);
        for (index, row) in grid.enumerate() {
            let fields = row
                .iter()
                .map(|cell| cell.map(Value::text).unwrap_or_default());
            writer.write_record(fields).map_err(csv_error)?;
            if index % 4096 == 0 {
                progress.check()?;
            }
        }
        writer.flush()?;
    }
    file.flush()?;
    Ok(())
}

fn csv_error(error: csv::Error) -> Error {
    match error.into_kind() {
        csv::ErrorKind::Io(error) => Error::Io(error),
        other => Error::Other(format!("{other:?}")),
    }
}

struct Formats {
    date: Format,
    time: Format,
    datetime: Format,
    duration: Format,
}

/// Every sheet, values only. With `typing` (the decimal separator), CSV and TSV text becomes a
/// number, boolean or date where it plainly is one.
pub(super) fn xlsx(
    sheets: &[Sheet],
    typing: Option<char>,
    dest: &Path,
    progress: &Progress,
) -> Result<()> {
    let formats = Formats {
        date: Format::new().set_num_format("yyyy-mm-dd"),
        time: Format::new().set_num_format("hh:mm:ss"),
        datetime: Format::new().set_num_format("yyyy-mm-dd hh:mm:ss"),
        duration: Format::new().set_num_format("[h]:mm:ss"),
    };
    let mut workbook = Workbook::new();
    let mut names = HashSet::new();
    for sheet in sheets {
        progress.check()?;
        let worksheet = workbook.add_worksheet();
        worksheet
            .set_name(sheet_name(&sheet.name, &mut names))
            .map_err(xlsx_error)?;
        for (index, (row, column, value)) in sheet.cells.iter().enumerate() {
            if *row >= XLSX_ROWS || *column >= XLSX_COLUMNS {
                return Err(Error::Limit(format!(
                    "XLSX holds at most {XLSX_ROWS} rows and {XLSX_COLUMNS} columns"
                )));
            }
            let inferred;
            let value = match (value, typing) {
                (Value::Text(text), Some(decimal)) => {
                    inferred = infer(text, decimal);
                    &inferred
                }
                (other, _) => other,
            };
            write_cell(worksheet, *row, *column as u16, value, &formats)?;
            if index % 65_536 == 0 {
                progress.check()?;
            }
        }
    }
    if sheets.is_empty() {
        workbook.add_worksheet();
    }
    progress.check()?;
    workbook.save(dest).map_err(xlsx_error)
}

fn write_cell(
    worksheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: &Value,
    formats: &Formats,
) -> Result<()> {
    match value {
        Value::Text(text) | Value::Error(text) => {
            if text.chars().count() > XLSX_TEXT {
                return Err(Error::Limit(format!(
                    "a cell holds more than {XLSX_TEXT} characters, the most XLSX allows"
                )));
            }
            worksheet.write_string(row, column, text)
        }
        Value::Int(number) => worksheet.write_number(row, column, *number as f64),
        Value::Number(number) if number.is_finite() => worksheet.write_number(row, column, *number),
        Value::Number(number) => worksheet.write_string(row, column, number.to_string()),
        Value::Bool(value) => worksheet.write_boolean(row, column, *value),
        Value::Date(stamp) => match excel_datetime(stamp, formats) {
            Some((datetime, format)) => {
                worksheet.write_datetime_with_format(row, column, &datetime, format)
            }
            // Before 1900 or Excel's phantom 1900-02-29: XLSX cannot hold it as a date.
            None => worksheet.write_string(row, column, stamp.iso()),
        },
        Value::Duration(days) => {
            worksheet.write_number_with_format(row, column, *days, &formats.duration)
        }
    }
    .map_err(xlsx_error)?;
    Ok(())
}

fn excel_datetime<'a>(stamp: &Stamp, formats: &'a Formats) -> Option<(ExcelDateTime, &'a Format)> {
    match (stamp.date, stamp.time) {
        (Some((year, month, day)), None) => ExcelDateTime::from_ymd(year, month, day)
            .ok()
            .map(|date| (date, &formats.date)),
        (None, Some((hour, minute, second, ms))) => {
            ExcelDateTime::from_hms_milli(u16::from(hour), minute, second, ms)
                .ok()
                .map(|time| (time, &formats.time))
        }
        (Some((year, month, day)), Some((hour, minute, second, ms))) => {
            ExcelDateTime::from_ymd(year, month, day)
                .and_then(|date| date.and_hms_milli(u16::from(hour), minute, second, ms))
                .ok()
                .map(|datetime| (datetime, &formats.datetime))
        }
        (None, None) => None,
    }
}

/// A name Excel accepts: at most 31 characters, none of `[]:*?/\`, no apostrophe at either
/// end, unique regardless of case, and not the reserved "History".
pub(super) fn sheet_name(name: &str, used: &mut HashSet<String>) -> String {
    let clean: String = name
        .chars()
        .map(|c| {
            if matches!(c, '[' | ']' | ':' | '*' | '?' | '/' | '\\') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let fit = |text: &str, room: usize| -> String {
        let cut: String = text.chars().take(room).collect();
        cut.trim_matches('\'').trim().to_owned()
    };
    let mut base = fit(&clean, 31);
    if base.is_empty() {
        base = "Sheet".to_owned();
    }
    let mut candidate = base.clone();
    let mut number = 2;
    while used.contains(&candidate.to_lowercase()) || candidate.eq_ignore_ascii_case("history") {
        let suffix = format!(" ({number})");
        candidate = format!("{}{suffix}", fit(&base, 31 - suffix.len()));
        number += 1;
    }
    used.insert(candidate.to_lowercase());
    candidate
}

fn xlsx_error(error: XlsxError) -> Error {
    match error {
        XlsxError::IoError(error) => Error::Io(error),
        other => Error::Other(other.to_string()),
    }
}

const HTML_STYLE: &str = "body{font-family:system-ui,sans-serif;margin:2em}\n\
table{border-collapse:collapse;margin-bottom:2em}\n\
td{border:1px solid #8888;padding:.25em .5em;vertical-align:top;white-space:pre-wrap}\n\
td.n{text-align:end;white-space:nowrap}\n";

/// One page, a table per sheet; `headings` puts each table under its sheet name.
pub(super) fn html(
    sheets: &[Sheet],
    title: &str,
    headings: bool,
    dest: &Path,
    progress: &Progress,
) -> Result<()> {
    let grids = sheets.iter().map(Sheet::grid).collect::<Result<Vec<_>>>()?;
    let mut file = BufWriter::new(File::create(dest)?);
    file.write_all(text::html_open(title, HTML_STYLE).as_bytes())?;
    for (sheet, grid) in sheets.iter().zip(grids) {
        progress.check()?;
        if headings {
            writeln!(file, "<h2>{}</h2>", text::escape_html(&sheet.name))?;
        }
        file.write_all(b"<table>\n")?;
        for (index, row) in grid.enumerate() {
            let mut line = String::from("<tr>");
            for cell in row {
                match cell {
                    Some(value) if value.is_numeric() => line.push_str("<td class=\"n\">"),
                    _ => line.push_str("<td>"),
                }
                if let Some(value) = cell {
                    line.push_str(&text::escape_html(&value.text()));
                }
                line.push_str("</td>");
            }
            line.push_str("</tr>\n");
            file.write_all(line.as_bytes())?;
            if index % 4096 == 0 {
                progress.check()?;
            }
        }
        file.write_all(b"</table>\n")?;
    }
    file.write_all(text::HTML_CLOSE.as_bytes())?;
    file.flush()?;
    Ok(())
}
