// SPDX-License-Identifier: MIT
//! PDF conversions and tools (SPEC 5.4, 5.5) on the bundled PDFium and `lopdf`.

use std::path::{Path, PathBuf};

use crate::{Codec, Conversion, Error, Output, Progress, Result};

pub fn supports(_from: &str, _to: &str) -> bool {
    false
}

pub fn output(_from: &str, to: &str) -> Output {
    if matches!(to, "jpg" | "png") {
        Output::Folder
    } else {
        Output::File
    }
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    Err(Error::Unsupported {
        from: job.from.to_owned(),
        to: job.to.to_owned(),
    })
}

/// Loads the PDFium library once. Until it is loaded, PDF work fails with
/// `Error::MissingCodec(Codec::Pdfium)`.
pub fn init(_library: &Path) -> Result<()> {
    Err(Error::MissingCodec(Codec::Pdfium))
}

pub fn page_count(_path: &Path) -> Result<usize> {
    Err(Error::MissingCodec(Codec::Pdfium))
}

/// Renders one page (0-based) for previews and QR scanning.
pub fn render_page(_path: &Path, _index: usize, _dpi: u16) -> Result<::image::RgbaImage> {
    Err(Error::MissingCodec(Codec::Pdfium))
}

/// One page's picture for `images_to_pdf`.
pub enum PageImage {
    /// A JPEG file's bytes, embedded as they are, without re-encoding.
    Jpeg(Vec<u8>),
    Pixels(::image::DynamicImage),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PageSize {
    /// Each page is the size of its image (at 96 dpi when the image has no density).
    FitImage,
    A4,
    Letter,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageLayout {
    pub size: PageSize,
    pub margin_mm: f32,
}

impl Default for PageLayout {
    fn default() -> Self {
        Self {
            size: PageSize::FitImage,
            margin_mm: 0.0,
        }
    }
}

/// Writes one page per image. Shared by image → PDF and the "PDF from images" tool.
pub fn images_to_pdf(
    _images: Vec<PageImage>,
    _layout: &PageLayout,
    _dest: &Path,
    _progress: &Progress,
) -> Result<()> {
    Err(Error::Other("not implemented".into()))
}
