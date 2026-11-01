// SPDX-License-Identifier: MIT
//! Subtitle conversions (SPEC 5.4): SRT and VTT to each other and to TXT.

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
