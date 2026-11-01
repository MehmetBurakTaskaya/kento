// SPDX-License-Identifier: MIT
//! The shelf window (SPEC 5.8): a narrow panel at the right edge of the screen under the pointer.
//! Files are dropped on it and dragged out of it into Explorer or Finder. It is made on first use
//! and moves away when closed.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

use crate::error::{Error, Result};
use crate::shelf::ShelfView;
use crate::AppState;

pub const LABEL: &str = "shelf";
const WIDTH: f64 = 300.0;
const HEIGHT: f64 = 480.0;

/// Puts files on the shelf and shows it.
pub fn put(app: &AppHandle, paths: &[PathBuf]) -> Result<()> {
    let state = app.state::<AppState>();
    let keep = state.settings().shelf.keep_copy;
    state.shelf.add(paths, keep)?;
    show(app);
    let _ = app.emit_to(LABEL, "shelf", ());
    Ok(())
}

/// Brings the shelf to the right edge of the screen under the pointer, making it if needed.
pub fn show(app: &AppHandle) {
    if let Some(window) = super::window(app, LABEL) {
        place(app, &window);
        return;
    }
    crate::window::build_apart(app, |app| {
        let window = WebviewWindowBuilder::new(
            app,
            LABEL,
            WebviewUrl::App("index.html?surface=shelf".into()),
        )
        .title("Kento")
        .inner_size(WIDTH, HEIGHT)
        .position(-20000.0, -20000.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(true)
        .build()?;
        place(app, &window);
        Ok(())
    });
}

fn place(app: &AppHandle, window: &tauri::WebviewWindow) {
    let at = app.cursor_position().unwrap_or_default();
    let Some(monitor) = app.monitor_from_point(at.x, at.y).ok().flatten() else {
        return;
    };
    let area = monitor.work_area();
    let Ok(size) = window.outer_size() else {
        return;
    };
    let margin = (12.0 * monitor.scale_factor()) as i32;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + (area.size.height as i32 - size.height as i32) / 2;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[tauri::command]
pub fn shelf_view(state: tauri::State<'_, AppState>) -> ShelfView {
    state.shelf.view()
}

/// Files dropped on the shelf window.
#[tauri::command]
pub fn shelf_add(app: AppHandle, paths: Vec<PathBuf>) -> Result<()> {
    put(&app, &paths)
}

#[tauri::command]
pub fn shelf_remove(app: AppHandle, state: tauri::State<'_, AppState>, id: u64) {
    state.shelf.remove(id);
    let _ = app.emit_to(LABEL, "shelf", ());
}

#[tauri::command]
pub fn shelf_clear(app: AppHandle, state: tauri::State<'_, AppState>) {
    state.shelf.clear();
    let _ = app.emit_to(LABEL, "shelf", ());
}

#[tauri::command]
pub fn shelf_hide(app: AppHandle) {
    if let Some(window) = super::window(&app, LABEL) {
        super::park(&window);
    }
}

#[tauri::command]
pub fn shelf_reveal(state: tauri::State<'_, AppState>, id: u64) -> Result<()> {
    let path = state
        .shelf
        .path(id)
        .ok_or_else(|| Error::Invalid("not on the shelf".into()))?;
    crate::files::reveal_path(path)
}

/// Opens the wheel for shelved files.
#[tauri::command]
pub fn shelf_to_wheel(app: AppHandle, state: tauri::State<'_, AppState>, ids: Vec<u64>) {
    let paths: Vec<PathBuf> = ids.iter().filter_map(|id| state.shelf.path(*id)).collect();
    super::wheel::open_for(&app, paths, super::wheel::Kind::Convert);
}

/// Starts a system drag of shelved files out of the shelf window (OLE on Windows, a dragging
/// session on macOS). It must run on the main thread.
#[tauri::command]
pub fn shelf_drag(app: AppHandle, state: tauri::State<'_, AppState>, ids: Vec<u64>) -> Result<()> {
    let paths: Vec<PathBuf> = ids
        .iter()
        .filter_map(|id| state.shelf.path(*id))
        .filter(|path| path.exists())
        .collect();
    if paths.is_empty() {
        return Ok(());
    }
    let window =
        super::window(&app, LABEL).ok_or_else(|| Error::Invalid("no shelf window".into()))?;
    let icon = include_bytes!("../../icons/32x32.png").to_vec();
    app.run_on_main_thread(move || {
        let started = drag::start_drag(
            &window,
            drag::DragItem::Files(paths),
            drag::Image::Raw(icon),
            |result, _| tracing::debug!("drag out of the shelf: {result:?}"),
            drag::Options::default(),
        );
        if let Err(err) = started {
            tracing::warn!("the drag out of the shelf did not start: {err}");
        }
    })?;
    Ok(())
}
