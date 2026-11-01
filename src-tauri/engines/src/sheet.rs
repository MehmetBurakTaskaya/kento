// SPDX-License-Identifier: MIT
//! Spreadsheet conversions that need no office suite: CSV, TSV, XLS, XLSX and ODS to CSV, TSV, XLSX and HTML.

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
