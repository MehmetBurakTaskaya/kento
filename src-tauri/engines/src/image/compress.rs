// SPDX-License-Identifier: MIT
//! Compress for images: JPG, WEBP and AVIF by quality, PNG by palette and deflate, each in its
//! own format; a target size by searching the quality, then the size if quality is not enough.

use std::path::PathBuf;

use crate::compress::CompressRun;
use crate::{Error, Result};

pub(crate) fn run(run: &CompressRun) -> Result<Vec<PathBuf>> {
    let _ = run;
    Err(Error::Other("image compression is not built yet".into()))
}
