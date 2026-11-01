// SPDX-License-Identifier: MIT
//! Text conversions (SPEC 5.4): TXT, MD and HTML to each other, and TEXTCLIPPING to TXT.

use std::path::PathBuf;

use crate::{Conversion, Error, Result};

pub fn supports(_from: &str, _to: &str) -> bool {
    false
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    Err(Error::Unsupported {
        from: job.from.to_owned(),
        to: job.to.to_owned(),
    })
}
