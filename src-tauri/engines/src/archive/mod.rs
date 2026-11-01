// SPDX-License-Identifier: MIT
//! Archive extraction and conversion (SPEC 5.4, 5.5): ZIP, TAR, GZ, RAR (read only) and 7Z.

use std::path::PathBuf;

use crate::{Conversion, Error, Output, Result};

/// Safety limits against archive bombs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Limits {
    pub max_entries: u64,
    /// The total size of everything extracted.
    pub max_total_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_entries: 100_000,
            max_total_bytes: 16 << 30,
        }
    }
}

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
