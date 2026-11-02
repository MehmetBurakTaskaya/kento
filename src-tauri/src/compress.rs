// SPDX-License-Identifier: MIT
//! Compress (SPEC 5.5): one job per file, each kept in its own format.

use std::path::PathBuf;

use kento_engines::compress::Compression;
use tauri::{AppHandle, State, WebviewWindow};

use crate::error::{Error, Result};
use crate::AppState;

/// Compresses images, video, audio and PDF files, one job each, and returns the job ids.
#[tauri::command]
pub fn run_compress(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    compression: Compression,
    paths: Vec<PathBuf>,
) -> Result<Vec<u64>> {
    let _ = (app, window, state, compression, paths);
    Err(Error::Invalid("not built yet".into()))
}
