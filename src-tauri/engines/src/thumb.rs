// SPDX-License-Identifier: MIT
//! Small previews for the file list and the Library.

use std::io::Cursor;
use std::path::Path;

use ::image::{DynamicImage, ImageFormat};

use crate::{Error, Options, Result};

/// A PNG no larger than `max_px` on its longer side, from an image or the first page of a PDF.
pub fn thumbnail(path: &Path, from: &str, max_px: u32) -> Result<Vec<u8>> {
    let picture = if from == "pdf" {
        DynamicImage::ImageRgba8(crate::pdf::render_page(path, 0, 72)?)
    } else {
        crate::image::decode(path, from, &Options::default())?
    };
    let small = picture.thumbnail(max_px, max_px);
    let mut png = Vec::new();
    small
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|error| Error::Other(error.to_string()))?;
    Ok(png)
}

/// A PNG of one PDF page (0-based) no larger than `max_px`, for the Edit PDF grid.
pub fn pdf_page(path: &Path, index: usize, max_px: u32) -> Result<Vec<u8>> {
    let page = DynamicImage::ImageRgba8(crate::pdf::render_thumbnail(path, index, max_px)?);
    let mut png = Vec::new();
    page.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|error| Error::Other(error.to_string()))?;
    Ok(png)
}
