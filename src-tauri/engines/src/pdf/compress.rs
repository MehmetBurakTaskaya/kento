// SPDX-License-Identifier: MIT
//! Compress for PDF (an enhancement): the pictures inside are scaled down and stored again as
//! JPEG, and the file is written with compressed object streams.

use std::path::PathBuf;

use crate::compress::CompressRun;
use crate::{Error, Result};

pub(crate) fn run(run: &CompressRun) -> Result<Vec<PathBuf>> {
    let _ = run;
    Err(Error::Other("PDF compression is not built yet".into()))
}
