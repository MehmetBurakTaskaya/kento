// SPDX-License-Identifier: MIT
//! Reading QR codes from images and PDF pages (SPEC 5.5, "Read QR codes"), and making them
//! (`make`).

mod make;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use image::imageops::{self, FilterType};
use image::{DynamicImage, GrayImage, Luma};
use rxing::{BarcodeFormat, DecodeHints};
use serde::Serialize;

use crate::{Error, Options, Progress, Result};

pub use make::{
    check, contrast, encode, inverted, make, name_for, pixels, svg, Correction, Modules, Picture,
    Problem, Style, MAX_SIZE, MIN_CONTRAST, MIN_SIZE, QUIET_ZONE,
};

/// Enough for a code a couple of centimetres wide on a printed page, without making a whole
/// page slow to scan.
const PDF_DPI: u16 = 200;

/// Large photos get a second look at this size: the binarizer copes better with modules a few
/// pixels wide than with very large, slightly blurred ones.
const RETRY_SIDE: u32 = 1200;

/// One code found in one file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub file: PathBuf,
    /// 1-based PDF page; `None` for images.
    pub page: Option<usize>,
    pub text: String,
}

/// Every QR code in the picture, each text once, in the order they were found.
pub fn scan(image: &DynamicImage) -> Vec<String> {
    let luma = to_luma(image);
    let found = decode(&luma);
    if !found.is_empty() {
        return found;
    }
    let (width, height) = luma.dimensions();
    let smaller = (width.max(height) > RETRY_SIDE).then(|| {
        let scale = f64::from(RETRY_SIDE) / f64::from(width.max(height));
        let size = |side: u32| ((f64::from(side) * scale).round() as u32).max(1);
        imageops::resize(&luma, size(width), size(height), FilterType::Triangle)
    });
    if let Some(smaller) = &smaller {
        let found = decode(smaller);
        if !found.is_empty() {
            return found;
        }
    }
    // Light codes on a dark background.
    for mut candidate in std::iter::once(luma).chain(smaller) {
        imageops::invert(&mut candidate);
        let found = decode(&candidate);
        if !found.is_empty() {
            return found;
        }
    }
    Vec::new()
}

fn decode(luma: &GrayImage) -> Vec<String> {
    let (width, height) = luma.dimensions();
    if width == 0 || height == 0 {
        return Vec::new();
    }
    let mut hints = DecodeHints {
        PossibleFormats: Some(HashSet::from([BarcodeFormat::QR_CODE])),
        TryHarder: Some(true),
        ..DecodeHints::default()
    };
    let results = rxing::helpers::detect_multiple_in_luma_with_hints(
        luma.as_raw().clone(),
        width,
        height,
        &mut hints,
    )
    .unwrap_or_default();
    let mut seen = HashSet::new();
    results
        .into_iter()
        .map(|result| result.getText().to_owned())
        .filter(|text| seen.insert(text.clone()))
        .collect()
}

/// Gray levels with transparency laid on white, so a dark code on a transparent background reads
/// as it looks.
fn to_luma(image: &DynamicImage) -> GrayImage {
    if !image.color().has_alpha() {
        return image.to_luma8();
    }
    let rgba = image.to_rgba8();
    GrayImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let gray = (u32::from(r) * 299 + u32::from(g) * 587 + u32::from(b) * 114) / 1000;
        let alpha = u32::from(a);
        Luma([((gray * alpha + 255 * (255 - alpha)) / 255) as u8])
    })
}

/// Reads every input (catalog format ids: images, and `pdf` page by page). A file that cannot be
/// read is skipped and logged; only when no file could be read at all is the first error
/// returned, so a missing PDF engine does not look like "no codes".
pub fn read(
    inputs: &[(PathBuf, String)],
    options: &Options,
    progress: &Progress,
) -> Result<Vec<Found>> {
    let mut found = Vec::new();
    let mut first_error = None;
    let mut any_read = false;
    let total = inputs.len().max(1) as f32;
    for (index, (path, format)) in inputs.iter().enumerate() {
        progress.check()?;
        let share = |fraction: f32| progress.report((index as f32 + fraction) / total);
        let result = if format == "pdf" {
            read_pdf(path, progress, &share, &mut found)
        } else {
            crate::image::decode(path, format, options).map(|image| {
                found.extend(scan(&image).into_iter().map(|text| Found {
                    file: path.clone(),
                    page: None,
                    text,
                }));
            })
        };
        match result {
            Ok(()) => any_read = true,
            Err(Error::Cancelled) => return Err(Error::Cancelled),
            Err(error) => {
                tracing::warn!(index, format = format.as_str(), %error, "QR reading skipped a file");
                first_error.get_or_insert(error);
            }
        }
        share(1.0);
    }
    match first_error {
        Some(error) if !any_read => Err(error),
        _ => Ok(found),
    }
}

fn read_pdf(
    path: &Path,
    progress: &Progress,
    share: &dyn Fn(f32),
    found: &mut Vec<Found>,
) -> Result<()> {
    let pages = crate::pdf::page_count(path)?;
    let mut first_error = None;
    let mut any_page = pages == 0;
    for page in 0..pages {
        progress.check()?;
        match crate::pdf::render_page(path, page, PDF_DPI) {
            Ok(pixels) => {
                any_page = true;
                let image = DynamicImage::ImageRgba8(pixels);
                found.extend(scan(&image).into_iter().map(|text| Found {
                    file: path.to_path_buf(),
                    page: Some(page + 1),
                    text,
                }));
            }
            Err(Error::Cancelled) => return Err(Error::Cancelled),
            Err(error) => {
                tracing::warn!(page = page + 1, %error, "QR reading skipped a PDF page");
                first_error.get_or_insert(error);
            }
        }
        share((page + 1) as f32 / pages as f32);
    }
    match first_error {
        Some(error) if !any_page => Err(error),
        _ => Ok(()),
    }
}

/// The file `write_report` writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Report {
    /// Each file (with `#page=N` for PDF pages, as PDF links write it), then its codes.
    Txt,
    /// Columns `file`, `page`, `text`; UTF-8 with a BOM, CRLF, RFC 4180 quoting.
    Csv,
    /// An array of `{ "file", "page", "text" }` objects; `page` is null for images.
    Json,
}

pub fn write_report(found: &[Found], report: Report, dest: &Path) -> Result<()> {
    let bytes = match report {
        Report::Txt => txt_report(found).into_bytes(),
        Report::Csv => csv_report(found)?,
        Report::Json => json_report(found)?,
    };
    fs::write(dest, bytes)?;
    Ok(())
}

fn location(found: &Found) -> String {
    match found.page {
        Some(page) => format!("{}#page={page}", found.file.display()),
        None => found.file.display().to_string(),
    }
}

fn txt_report(found: &[Found]) -> String {
    let newline = if cfg!(windows) { "\r\n" } else { "\n" };
    let mut out = String::new();
    let mut last: Option<(&Path, Option<usize>)> = None;
    for item in found {
        if last != Some((item.file.as_path(), item.page)) {
            if last.is_some() {
                out.push_str(newline);
            }
            out.push_str(&location(item));
            out.push_str(newline);
            last = Some((item.file.as_path(), item.page));
        }
        let text = crate::text::normalize_newlines(&item.text);
        for (i, line) in text.split('\n').enumerate() {
            out.push_str(if i == 0 { "- " } else { "  " });
            out.push_str(line);
            out.push_str(newline);
        }
    }
    out
}

fn csv_report(found: &[Found]) -> Result<Vec<u8>> {
    let mut out = "\u{feff}".as_bytes().to_vec();
    {
        let mut writer = csv::WriterBuilder::new()
            .terminator(csv::Terminator::CRLF)
            .quote_style(csv::QuoteStyle::Necessary)
            .from_writer(&mut out);
        let failed = |error: csv::Error| Error::Other(error.to_string());
        writer
            .write_record(["file", "page", "text"])
            .map_err(failed)?;
        for item in found {
            let page = item.page.map(|page| page.to_string()).unwrap_or_default();
            let file = item.file.display().to_string();
            writer
                .write_record([file.as_str(), page.as_str(), item.text.as_str()])
                .map_err(failed)?;
        }
        writer.flush()?;
    }
    Ok(out)
}

#[derive(Serialize)]
struct Entry<'a> {
    file: String,
    page: Option<usize>,
    text: &'a str,
}

fn json_report(found: &[Found]) -> Result<Vec<u8>> {
    let entries: Vec<Entry> = found
        .iter()
        .map(|item| Entry {
            file: item.file.display().to_string(),
            page: item.page,
            text: &item.text,
        })
        .collect();
    let mut out =
        serde_json::to_vec_pretty(&entries).map_err(|error| Error::Other(error.to_string()))?;
    out.push(b'\n');
    Ok(out)
}

#[cfg(test)]
mod tests;
