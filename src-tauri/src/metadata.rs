// SPDX-License-Identifier: MIT
//! Metadata (SPEC 5.5): what a file carries, and a copy with the fields changed or removed.

use std::path::PathBuf;

use kento_engines::metadata::{MetadataChange, MetadataInfo};
use tauri::{AppHandle, State, WebviewWindow};

use crate::error::{Error, Result};
use crate::AppState;

#[tauri::command]
pub async fn metadata_read(app: AppHandle, path: PathBuf) -> Result<MetadataInfo> {
    let _ = (app, path);
    Err(Error::Invalid("not built yet".into()))
}

/// Writes a copy of the file with the change applied; returns the job id.
#[tauri::command]
pub fn run_metadata(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: PathBuf,
    change: MetadataChange,
) -> Result<Vec<u64>> {
    let _ = (app, window, state, path, change);
    Err(Error::Invalid("not built yet".into()))
}
