// SPDX-License-Identifier: MIT
//! The image editors' commands (SPEC 5.5): a picture's size, live previews drawn by the same
//! engine code as the result, and the six image tools as jobs.

use std::path::PathBuf;

use kento_engines::image::tools::ImageTool;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, State, WebviewWindow};

use crate::error::{Error, Result};
use crate::AppState;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    /// Upright: after the EXIF orientation.
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn image_info(path: PathBuf) -> Result<ImageInfo> {
    let _ = path;
    Err(Error::Invalid("not built yet".into()))
}

/// A PNG of the tool applied to the pictures, no larger than `size` on its longer side; without
/// a tool, the picture itself. Decoded pictures are kept for the next call, so dragging a slider
/// redraws quickly.
#[tauri::command]
pub async fn image_preview(
    paths: Vec<PathBuf>,
    tool: Option<ImageTool>,
    size: u32,
) -> Result<Response> {
    let _ = (paths, tool, size);
    Err(Error::Invalid("not built yet".into()))
}

/// Runs an image tool: Make a collage takes its pictures in order, every other tool one picture.
#[tauri::command]
pub fn run_image_tool(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    tool: ImageTool,
    paths: Vec<PathBuf>,
) -> Result<Vec<u64>> {
    let _ = (app, window, state, tool, paths);
    Err(Error::Invalid("not built yet".into()))
}
