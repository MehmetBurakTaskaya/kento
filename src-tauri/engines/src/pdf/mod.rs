// SPDX-License-Identifier: MIT
//! PDF conversions and tools (SPEC 5.4, 5.5) on the bundled PDFium and `lopdf`.
//!
//! PDFium renders pages and reads text; `lopdf` writes every PDF (merge, split, edit, images).

pub(crate) mod compress;
#[cfg(test)]
pub(crate) mod fixtures;
mod jpeg;
mod pdfium;
mod table;
mod text;
mod tools;
mod write;

use std::path::{Path, PathBuf};

use crate::{Conversion, Error, Output, Progress, Result};

pub use tools::{edit, merge, split, PageEdit, Split};
pub use write::from_images;

/// Pages of text joined as the PDF → TXT conversion joins them (text recognition uses it too).
pub(crate) use text::join_plain as join_text_pages;

/// Documents with more pages than this are refused with `Error::Limit`, and so are outputs that
/// would have more.
pub const MAX_PAGES: usize = 10_000;

pub fn supports(from: &str, to: &str) -> bool {
    from == "pdf" && matches!(to, "jpg" | "png" | "txt" | "md" | "xlsx")
}

pub fn output(_from: &str, to: &str) -> Output {
    if matches!(to, "jpg" | "png") {
        Output::Folder
    } else {
        Output::File
    }
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    match (job.from, job.to) {
        ("pdf", "jpg" | "png") => pdfium::to_images(job),
        ("pdf", "txt" | "md") => pdfium::to_text(job).map(|()| vec![job.dest.to_path_buf()]),
        ("pdf", "xlsx") => pdfium::to_xlsx(job).map(|()| vec![job.dest.to_path_buf()]),
        _ => Err(Error::Unsupported {
            from: job.from.to_owned(),
            to: job.to.to_owned(),
        }),
    }
}

/// Loads the PDFium library once: `library` is the library file or the folder that holds it.
/// Until it is loaded, PDF work that needs PDFium fails with `Error::MissingCodec(Codec::Pdfium)`.
pub fn init(library: &Path) -> Result<()> {
    pdfium::init(library)
}

pub fn page_count(path: &Path) -> Result<usize> {
    pdfium::page_count(path)
}

/// Renders one page (0-based) for previews and QR scanning, on an opaque white background.
pub fn render_page(path: &Path, index: usize, dpi: u16) -> Result<::image::RgbaImage> {
    pdfium::render_page(path, index, dpi)
}

/// Renders one page (0-based) for the page grid: its longer side is `max_px` pixels, on an
/// opaque white background.
pub fn render_thumbnail(path: &Path, index: usize, max_px: u32) -> Result<::image::RgbaImage> {
    pdfium::render_thumbnail(path, index, max_px)
}

/// One page's picture for `images_to_pdf`.
pub enum PageImage {
    /// A JPEG file's bytes, embedded as they are, without re-encoding (a JPEG that PDF readers
    /// cannot show as it is, such as a 12-bit one, is decoded and stored as pixels).
    Jpeg(Vec<u8>),
    Pixels(::image::DynamicImage),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PageSize {
    /// Each page is the size of its image (at 96 dpi when the image has no density).
    FitImage,
    /// A4 paper, turned to landscape for a landscape image.
    A4,
    /// US Letter paper, turned to landscape for a landscape image.
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
    images: Vec<PageImage>,
    layout: &PageLayout,
    dest: &Path,
    progress: &Progress,
) -> Result<()> {
    write::images_to_pdf(images, layout, dest, progress)
}
