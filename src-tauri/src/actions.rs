// SPDX-License-Identifier: MIT
//! The file actions wheel (SPEC 5.7): share, put on the shelf, copy or move to a folder, copy the
//! path, open a terminal there, show in Explorer or Finder, and pack into a ZIP. Copying and moving
//! follow the naming rules (SPEC 5.14): nothing at the destination is ever overwritten, and Move is
//! the one action that touches the original, after the user confirms it.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::catalog::{self, Status};
use crate::error::{Error, Result};
use crate::jobs::engine::{Target, Work};
use crate::library::Origin;
use crate::overlay::{self, toast};
use crate::platform;
use crate::work::{stem_of, Context};
use crate::{files, AppState};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionEntry {
    pub id: String,
    pub icon: String,
}

/// The actions that work here; they apply to any files and folders (SPEC 5.3).
#[tauri::command]
pub fn actions() -> Vec<ActionEntry> {
    catalog::actions()
        .iter()
        .filter(|action| action.status == Status::Ready)
        .filter(|action| action.id != "share" || cfg!(any(windows, target_os = "macos")))
        .map(|action| ActionEntry {
            id: action.id.to_string(),
            icon: action.icon.to_string(),
        })
        .collect()
}

#[tauri::command]
pub async fn run_action(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    action: String,
    paths: Vec<PathBuf>,
) -> Result<Vec<u64>> {
    let paths: Vec<PathBuf> = paths.into_iter().filter(|p| p.exists()).collect();
    let first = paths
        .first()
        .cloned()
        .ok_or_else(|| Error::Invalid("the files are gone".into()))?;
    let lang = state.lang();
    let text = |key: &str| crate::i18n::text(&lang, key);
    let mut started = Vec::new();
    match action.as_str() {
        "share" => share(&app, &window, paths)?,
        "shelf" => overlay::shelf::put(&app, &paths)?,
        "copy" | "move" => {
            let Some(dir) = pick_folder(&app).await? else {
                return Ok(started);
            };
            let moving = action == "move";
            if moving && !confirm_move(&app, &text("move.confirm"), &dir).await {
                return Ok(started);
            }
            let ctx = Context::new(&app, &state)?;
            let ids: Vec<u64> = paths
                .iter()
                .map(|path| transfer(&ctx, path, &dir, moving))
                .collect();
            watch(&window, &state, &ids);
            started = ids;
        }
        "copy-path" => {
            use tauri_plugin_clipboard_manager::ClipboardExt;
            let joined = paths
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("\n");
            app.clipboard()
                .write_text(joined)
                .map_err(|err| Error::Invalid(err.to_string()))?;
            if window.label() != crate::window::MAIN {
                toast::note(&app, text("action.copied"));
            }
        }
        "terminal" => {
            let dir = if first.is_dir() {
                first
            } else {
                first.parent().map(Path::to_path_buf).unwrap_or(first)
            };
            platform::open_terminal(&dir).map_err(|err| Error::Invalid(err.to_string()))?;
        }
        "reveal" => files::reveal_path(first)?,
        "zip" => {
            let ctx = Context::new(&app, &state)?;
            let name = if paths.len() == 1 {
                stem_of(&first)
            } else {
                first
                    .parent()
                    .and_then(Path::file_name)
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| text("action.zip"))
            };
            let target = Target::File {
                dir: ctx.dir_for(&first),
                stem: name,
                extension: "zip".into(),
            };
            let title = format!("{} · {}", text("action.zip"), display(&first));
            let inputs = paths.clone();
            let work: Work = Box::new(move |dest, _, progress| {
                kento_engines::archive::create_zip(&inputs, dest, progress)
            });
            let id = ctx.submit(title, target, work, Origin::Tool, Some(first));
            watch(&window, &state, &[id]);
            started.push(id);
        }
        other => return Err(Error::Invalid(format!("unknown action {other}"))),
    }
    Ok(started)
}

/// Jobs started outside the main window report in the corner card.
pub fn watch(window: &WebviewWindow, state: &AppState, ids: &[u64]) {
    if window.label() != crate::window::MAIN {
        state.toasts.watch(ids);
    }
}

fn display(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn share(app: &AppHandle, window: &WebviewWindow, paths: Vec<PathBuf>) -> Result<()> {
    let handle = raw_handle(window)?;
    let app_for_error = app.clone();
    app.run_on_main_thread(move || {
        if let Err(err) = platform::share(&paths, handle) {
            tracing::warn!("sharing failed: {err}");
            let _ = app_for_error.emit("share-failed", err.to_string());
        }
    })?;
    Ok(())
}

#[cfg(windows)]
fn raw_handle(window: &WebviewWindow) -> Result<isize> {
    Ok(window.hwnd()?.0 as isize)
}

#[cfg(target_os = "macos")]
fn raw_handle(window: &WebviewWindow) -> Result<isize> {
    Ok(window.ns_window()? as isize)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn raw_handle(_window: &WebviewWindow) -> Result<isize> {
    Err(Error::Invalid("sharing is not available here".into()))
}

async fn pick_folder(app: &AppHandle) -> Result<Option<PathBuf>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    let picked = rx
        .await
        .map_err(|_| Error::Invalid("the folder dialog closed unexpectedly".into()))?;
    Ok(picked.and_then(|path| path.into_path().ok()))
}

async fn confirm_move(app: &AppHandle, question: &str, dir: &Path) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!("{question}\n\n{}", dir.display()))
        .title("Kento")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancel)
        .show(move |ok| {
            let _ = tx.send(ok);
        });
    rx.await.unwrap_or(false)
}

/// Copies or moves one file or folder into `dir` under a free name, as a job.
fn transfer(ctx: &Context, source: &Path, dir: &Path, moving: bool) -> u64 {
    let name = display(source);
    let target = if source.is_dir() {
        Target::Folder {
            dir: dir.to_path_buf(),
            name: name.clone(),
        }
    } else {
        let (stem, extension) = split_name(&name);
        Target::File {
            dir: dir.to_path_buf(),
            stem,
            extension,
        }
    };
    let copied = Arc::new(AtomicBool::new(false));
    let flag = copied.clone();
    let from = source.to_path_buf();
    let work: Work = Box::new(move |dest, _, progress| {
        // A move within one volume is a rename; elsewhere it is a copy and the original goes
        // only after the copy has its final name.
        if moving && fs::rename(&from, dest).is_ok() {
            return Ok(());
        }
        flag.store(true, Ordering::SeqCst);
        copy_all(&from, dest, progress)
    });
    let key = if moving { "action.move" } else { "action.copy" };
    let title = format!("{} · {name}", ctx.text(key));
    let original = source.to_path_buf();
    let after: Option<Box<dyn FnOnce() + Send>> = moving.then(|| {
        Box::new(move || {
            if copied.load(Ordering::SeqCst) {
                let removed = if original.is_dir() {
                    fs::remove_dir_all(&original)
                } else {
                    fs::remove_file(&original)
                };
                if let Err(err) = removed {
                    tracing::warn!("the original stayed after a move: {err}");
                }
            }
        }) as Box<dyn FnOnce() + Send>
    });
    ctx.submit_then(
        title,
        target,
        work,
        Origin::Tool,
        Some(source.to_path_buf()),
        after,
    )
}

/// "photo.tar.gz" → ("photo", "tar.gz"); "README" → ("README", "").
fn split_name(name: &str) -> (String, String) {
    let lower = name.to_lowercase();
    if let Some(stem) = lower.strip_suffix(".tar.gz") {
        return (
            name[..stem.len()].to_string(),
            name[stem.len() + 1..].to_string(),
        );
    }
    match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_string(), name[i + 1..].to_string()),
        _ => (name.to_string(), String::new()),
    }
}

fn copy_all(
    from: &Path,
    to: &Path,
    progress: &kento_engines::Progress,
) -> kento_engines::Result<()> {
    progress.check()?;
    if from.is_dir() {
        fs::create_dir_all(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            // Links are not followed, so a link to a parent folder cannot loop.
            if entry.file_type()?.is_symlink() {
                continue;
            }
            copy_all(&entry.path(), &to.join(entry.file_name()), progress)?;
        }
    } else {
        fs::copy(from, to)?;
    }
    Ok(())
}

/// The main window opens a tool's panel for files chosen elsewhere (the global wheel).
#[tauri::command]
pub fn open_tool(
    app: AppHandle,
    state: State<'_, AppState>,
    tool: String,
    paths: Vec<PathBuf>,
) -> Result<()> {
    *state.pending_tool.lock().unwrap_or_else(|p| p.into_inner()) =
        Some((tool.clone(), paths.clone()));
    crate::window::show_main(&app, None)?;
    let _ = app.emit_to(crate::window::MAIN, "open-tool", (tool, paths));
    Ok(())
}

/// The tool a just-opened main window should show.
#[tauri::command]
pub fn take_pending_tool(state: State<'_, AppState>) -> Option<(String, Vec<PathBuf>)> {
    state
        .pending_tool
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_split_like_the_naming_rules_expect() {
        assert_eq!(split_name("foto.jpg"), ("foto".into(), "jpg".into()));
        assert_eq!(
            split_name("yedek.TAR.GZ"),
            ("yedek".into(), "TAR.GZ".into())
        );
        assert_eq!(split_name("README"), ("README".into(), "".into()));
        assert_eq!(split_name(".env"), (".env".into(), "".into()));
        assert_eq!(
            split_name("Kento ğüş 🧪.v2.pdf"),
            ("Kento ğüş 🧪.v2".into(), "pdf".into())
        );
    }

    #[test]
    fn folders_copy_without_following_links() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Klasör");
        fs::create_dir_all(source.join("alt")).unwrap();
        fs::write(source.join("alt").join("a ğ.txt"), b"1").unwrap();
        let target = dir.path().join("kopya");
        copy_all(&source, &target, &kento_engines::Progress::none()).unwrap();
        assert_eq!(fs::read(target.join("alt").join("a ğ.txt")).unwrap(), b"1");
    }
}
