// SPDX-License-Identifier: MIT
//! Compress (SPEC 5.5): images, video, audio and PDF (the PDF part is an enhancement), each kept
//! in its own format. Three modes: a quality level, a size relative to the original, or a target
//! size reached by searching for the best quality that fits.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{FileKind, Options, Progress, Result};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum Compression {
    /// 1 (smallest file) to 100 (best picture or sound).
    Quality { level: u8 },
    /// The result's size as a percentage of the original, 5 to 95.
    Ratio { percent: u8 },
    /// At most this many bytes ("under 25 MB").
    Size { bytes: u64 },
}

/// One file to compress.
pub struct CompressRun<'a> {
    pub input: &'a Path,
    /// The catalog id of the input format; the result keeps it.
    pub from: &'a str,
    pub kind: FileKind,
    pub compression: Compression,
    /// The file to create, with the input's extension.
    pub dest: &'a Path,
    pub temp: &'a Path,
    pub options: &'a Options,
    pub progress: &'a Progress<'a>,
}

/// The kind of file Compress takes in this format (a catalog id), or None when the format cannot
/// get smaller in itself (BMP, GIF, WAV, AIFF…) or is not one Compress takes at all.
pub fn kind(from: &str) -> Option<FileKind> {
    if crate::image::compress::takes(from) {
        Some(FileKind::Image)
    } else if from == "pdf" {
        Some(FileKind::Pdf)
    } else {
        crate::media::compress::kind(from)
    }
}

/// Compresses one file. When nothing smaller than the original (or under the target size) comes
/// out, the job ends with `Error::NotSmaller` and writes nothing.
pub fn compress(run: &CompressRun) -> Result<Vec<PathBuf>> {
    match run.kind {
        FileKind::Image => crate::image::compress::run(run),
        FileKind::Video | FileKind::Audio => crate::media::compress::run(run),
        FileKind::Pdf => crate::pdf::compress::run(run),
    }
}
