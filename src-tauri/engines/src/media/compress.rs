// SPDX-License-Identifier: MIT
//! Compress for video and audio through FFmpeg, in the input's own container: a quality level, a
//! share of the original size, or a target size from the duration (two passes for video).

use std::path::PathBuf;

use crate::compress::CompressRun;
use crate::{Error, Result};

pub(crate) fn run(run: &CompressRun) -> Result<Vec<PathBuf>> {
    let _ = run;
    Err(Error::Other("media compression is not built yet".into()))
}
