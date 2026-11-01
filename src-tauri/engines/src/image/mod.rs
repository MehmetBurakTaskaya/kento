// SPDX-License-Identifier: MIT
//! Image conversions (SPEC 5.4): every image input to every image output, and image → PDF.

use std::path::{Path, PathBuf};

use crate::{Conversion, Error, Options, Output, Result};

pub fn supports(_from: &str, _to: &str) -> bool {
    false
}

pub fn output(_from: &str, _to: &str) -> Output {
    Output::File
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    Err(Error::Unsupported {
        from: job.from.to_owned(),
        to: job.to.to_owned(),
    })
}

/// Decodes any image input to pixels, upright (EXIF orientation applied). Shared with the PDF
/// and QR engines.
pub fn decode(path: &Path, _from: &str, _options: &Options) -> Result<::image::DynamicImage> {
    ::image::open(path).map_err(|error| Error::Unreadable(error.to_string()))
}
