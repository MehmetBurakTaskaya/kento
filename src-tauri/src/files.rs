// SPDX-License-Identifier: MIT
//! Files into and out of the main window (SPEC 5.2, 5.9): choosing, pasting, previews and the
//! Library. The clipboard is read only when the user pastes; nothing watches it.

use std::io::Write;
use std::path::PathBuf;

use tauri::ipc::{Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{Error, Result};
use crate::jobs::naming::Reservation;
use crate::library::{Entry, Origin};
use crate::work::{entry, Context, FileEntry};
use crate::{window, AppState};

/// Ctrl+O and "Choose files": the system's file dialog.
#[tauri::command]
pub async fn pick_files(app: AppHandle) -> Result<Vec<PathBuf>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file();
    if let Some(window) = app.get_webview_window(window::MAIN) {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_files(move |files| {
        let _ = tx.send(files);
    });
    let picked = rx
        .await
        .map_err(|_| Error::Invalid("the file dialog closed unexpectedly".into()))?;
    Ok(picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .collect())
}

/// The files on the clipboard (copied in Explorer or Finder), if any.
#[tauri::command]
pub fn paste_files() -> Vec<PathBuf> {
    clipboard_files()
        .into_iter()
        .filter(|path| path.exists())
        .collect()
}

/// Pasted text becomes a UTF-8 .txt (SPEC 5.2).
#[tauri::command]
pub fn import_text(app: AppHandle, state: State<'_, AppState>, text: String) -> Result<FileEntry> {
    if text.trim().is_empty() {
        return Err(Error::Invalid("nothing to paste".into()));
    }
    import(&app, &state, "paste.text", "txt", text.as_bytes())
}

/// A pasted image arrives as PNG bytes from the page and is kept as a lossless .png.
#[tauri::command]
pub fn import_image(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Request<'_>,
) -> Result<FileEntry> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(Error::Invalid("expected image bytes".into()));
    };
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(Error::Invalid("the pasted image is not a PNG".into()));
    }
    import(&app, &state, "paste.image", "png", bytes)
}

fn import(
    app: &AppHandle,
    state: &AppState,
    name_key: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<FileEntry> {
    let ctx = Context::new(app, state)?;
    // There is no source folder: the output folder setting, else Downloads/Kento.
    let dir = ctx.dir_for(std::path::Path::new(""));
    let reservation = Reservation::claim(&dir, &ctx.text(name_key), extension)?;
    reservation.create_temp()?.write_all(bytes)?;
    let path = reservation.commit()?;
    state
        .library
        .add(Origin::Paste, None, std::slice::from_ref(&path));
    let _ = app.emit("library", ());
    entry(&path).ok_or_else(|| Error::Invalid("the pasted file vanished".into()))
}

/// A small PNG preview of an image or the first page of a PDF, for the file list and the Library.
#[tauri::command]
pub async fn thumbnail(path: PathBuf, size: u32) -> Result<Response> {
    let format = entry(&path)
        .and_then(|e| e.format)
        .ok_or_else(|| Error::Invalid("no preview for this file".into()))?;
    let size = size.clamp(16, 512);
    let png = tauri::async_runtime::spawn_blocking(move || {
        kento_engines::thumb::thumbnail(&path, &format, size)
    })
    .await
    .map_err(|err| Error::Invalid(err.to_string()))?
    .map_err(|err| Error::Invalid(err.to_string()))?;
    Ok(Response::new(png))
}

/// Shows a file the user added in Explorer or Finder.
#[tauri::command]
pub fn reveal_path(path: PathBuf) -> Result<()> {
    if !path.exists() {
        return Err(Error::Invalid("the file is gone".into()));
    }
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|err| Error::Invalid(err.to_string()))
}

#[tauri::command]
pub fn library_list(state: State<'_, AppState>) -> Vec<Entry> {
    state.library.entries()
}

#[tauri::command]
pub fn library_remove(app: AppHandle, state: State<'_, AppState>, id: u64) {
    if state.library.remove(id) {
        let _ = app.emit("library", ());
    }
}

#[tauri::command]
pub fn library_reveal(state: State<'_, AppState>, id: u64) -> Result<()> {
    let item = state
        .library
        .get(id)
        .ok_or_else(|| Error::Invalid("not in the Library".into()))?;
    reveal_path(item.path)
}

/// Opens a Library item with its default app. Only what Kento itself wrote can be opened this
/// way, so the page cannot launch arbitrary files.
#[tauri::command]
pub fn library_open(app: AppHandle, state: State<'_, AppState>, id: u64) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let item = state
        .library
        .get(id)
        .filter(|item| item.path.exists())
        .ok_or_else(|| Error::Invalid("the file is gone".into()))?;
    app.opener()
        .open_path(item.path.to_string_lossy(), None::<&str>)
        .map_err(|err| Error::Invalid(err.to_string()))
}

/// The Library items of a finished job's outputs, so the success card can show and open them.
#[tauri::command]
pub fn library_find(state: State<'_, AppState>, paths: Vec<PathBuf>) -> Vec<Entry> {
    state
        .library
        .entries()
        .into_iter()
        .filter(|entry| paths.contains(&entry.item.path))
        .collect()
}

#[cfg(windows)]
fn clipboard_files() -> Vec<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

    let format = u32::from(CF_HDROP.0);
    // SAFETY: the clipboard is opened and closed here, and the HDROP is only read while it is open.
    unsafe {
        if IsClipboardFormatAvailable(format).is_err() {
            return Vec::new();
        }
        // Another program may hold the clipboard for a moment.
        let opened = (0..5).any(|attempt| {
            if attempt > 0 {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            OpenClipboard(None).is_ok()
        });
        if !opened {
            return Vec::new();
        }
        let mut files = Vec::new();
        if let Ok(handle) = GetClipboardData(format) {
            let drop = HDROP(handle.0);
            for index in 0..DragQueryFileW(drop, u32::MAX, None) {
                let len = DragQueryFileW(drop, index, None) as usize;
                let mut buffer = vec![0u16; len + 1];
                let got = DragQueryFileW(drop, index, Some(&mut buffer)) as usize;
                files.push(PathBuf::from(OsString::from_wide(&buffer[..got])));
            }
        }
        let _ = CloseClipboard();
        files
    }
}

#[cfg(target_os = "macos")]
fn clipboard_files() -> Vec<PathBuf> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
    use objc2_foundation::NSURL;

    let board = NSPasteboard::generalPasteboard();
    let Some(items) = board.pasteboardItems() else {
        return Vec::new();
    };
    // SAFETY: a constant AppKit provides for the lifetime of the process.
    let file_url = unsafe { NSPasteboardTypeFileURL };
    (0..items.count())
        .filter_map(|index| {
            let text = items.objectAtIndex(index).stringForType(file_url)?;
            let url = NSURL::URLWithString(&text)?;
            Some(PathBuf::from(url.path()?.to_string()))
        })
        .collect()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn clipboard_files() -> Vec<PathBuf> {
    Vec::new()
}
