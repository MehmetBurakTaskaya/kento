// SPDX-License-Identifier: MIT
//! Extracting text (SPEC 5.5, "Extract text (OCR)" [+]) with the system's own recogniser, all on
//! the computer: Windows.Media.Ocr on Windows and Apple's Vision on macOS. Each system reads only
//! the languages it has: Windows those whose language pack brings text recognition, macOS those
//! Vision supports on that version. Images are read as they are; PDF pages are drawn by PDFium
//! first. The result is a TXT, with PDF pages separated as the PDF → TXT conversion does.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(test)]
mod tests;
#[cfg(windows)]
mod windows;

use std::fs;
use std::path::Path;

use image::DynamicImage;

use crate::{Error, Options, Progress, Result};

/// PDF pages are drawn at this density: ordinary body text comes out 25 to 30 pixels high, which
/// both recognisers read well, and an A4 or Letter page stays inside Windows' size limit.
const PDF_DPI: u16 = 220;

/// The languages this computer reads text in, as BCP 47 tags ("en-US", "tr", "zh-Hans").
pub fn languages() -> Result<Vec<String>> {
    #[cfg(windows)]
    {
        windows::languages()
    }
    #[cfg(target_os = "macos")]
    {
        macos::languages()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Err(unsupported())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn unsupported() -> Error {
    Error::Unsupported {
        from: "image".into(),
        to: "ocr".into(),
    }
}

/// The first of `wanted` (tags or bare language codes, most wanted first) that one of the
/// `available` tags reads: the same tag, else the same language ("tr" for "tr-TR", "en-GB" for
/// "en-US"). Scripts count as part of the language, so "zh-Hant" never reads as "zh-Hans".
pub fn choose(wanted: &[&str], available: &[String]) -> Option<String> {
    let base = |tag: &str| -> String {
        let mut parts = tag.split(['-', '_']);
        let language = parts.next().unwrap_or_default().to_ascii_lowercase();
        // A script subtag (four letters) stays with the language.
        match parts.next() {
            Some(script) if script.len() == 4 => format!("{language}-{}", script.to_lowercase()),
            _ => language,
        }
    };
    wanted.iter().find_map(|tag| {
        let tag = tag.replace('_', "-");
        available
            .iter()
            .find(|have| have.eq_ignore_ascii_case(&tag))
            .or_else(|| available.iter().find(|have| base(have) == base(&tag)))
            .or_else(|| {
                // A bare "zh" means Simplified Chinese, as the interface languages do.
                (base(&tag) == "zh")
                    .then(|| available.iter().find(|have| base(have) == "zh-hans"))
                    .flatten()
            })
            .cloned()
    })
}

/// The system's recogniser for one language, kept for every page of a file.
pub struct Reader {
    #[cfg(windows)]
    inner: windows::Reader,
    #[cfg(target_os = "macos")]
    inner: macos::Reader,
}

impl Reader {
    /// A reader for `language` (one of `languages()`); `Error::MissingCodec(OcrLanguage)` when
    /// the system cannot read it.
    pub fn new(language: &str) -> Result<Self> {
        #[cfg(windows)]
        {
            windows::Reader::new(language).map(|inner| Self { inner })
        }
        #[cfg(target_os = "macos")]
        {
            macos::Reader::new(language).map(|inner| Self { inner })
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = language;
            Err(unsupported())
        }
    }

    /// The text in one picture, line by line.
    pub fn read(&self, image: &DynamicImage) -> Result<String> {
        #[cfg(any(windows, target_os = "macos"))]
        {
            Ok(self.inner.read(&image.to_rgba8())?.join("\n"))
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = image;
            Err(unsupported())
        }
    }
}

/// One file to read.
pub struct OcrJob<'a> {
    pub input: &'a Path,
    /// The catalog id of the input: an image format, or `pdf`.
    pub format: &'a str,
    /// One of `languages()`.
    pub language: &'a str,
    /// The TXT to write.
    pub dest: &'a Path,
    pub options: &'a Options,
    pub progress: &'a Progress<'a>,
}

/// Reads the file and writes its text. A file without any text is `Error::NoText`, so the user
/// never gets an empty file without a word.
pub fn extract(job: &OcrJob) -> Result<()> {
    job.progress.check()?;
    tracing::debug!(
        format = job.format,
        language = job.language,
        "extracting text"
    );
    let reader = Reader::new(job.language)?;
    let text = if job.format == "pdf" {
        read_pdf(job, &reader)?
    } else {
        let image = crate::image::decode(job.input, job.format, job.options)?;
        job.progress.check()?;
        let mut text = reader.read(&image)?;
        job.progress.report(1.0);
        text.push('\n');
        text
    };
    if text.trim().is_empty() {
        return Err(Error::NoText);
    }
    fs::write(job.dest, text)?;
    Ok(())
}

fn read_pdf(job: &OcrJob, reader: &Reader) -> Result<String> {
    let count = crate::pdf::page_count(job.input)?;
    let mut pages = Vec::with_capacity(count);
    for index in 0..count {
        job.progress.check()?;
        let page = crate::pdf::render_page(job.input, index, PDF_DPI)?;
        pages.push(reader.read(&DynamicImage::ImageRgba8(page))?);
        job.progress.report((index + 1) as f32 / count as f32);
    }
    Ok(crate::pdf::join_text_pages(&pages))
}

/// Pixels as an opaque picture: transparency laid on white, as a page would show it. Both
/// recognisers read dark text on light paper best.
#[cfg(any(windows, target_os = "macos"))]
fn flatten(rgba: &image::RgbaImage) -> image::RgbaImage {
    let mut out = rgba.clone();
    for pixel in out.pixels_mut() {
        let [r, g, b, a] = pixel.0;
        let over = |c: u8| ((u32::from(c) * u32::from(a) + 255 * (255 - u32::from(a))) / 255) as u8;
        pixel.0 = [over(r), over(g), over(b), 255];
    }
    out
}
