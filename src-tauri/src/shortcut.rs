// SPDX-License-Identifier: MIT
//! The global shortcuts (SPEC 5.2, 5.10): Ctrl+Shift+Space (⌃⇧Space on macOS) opens the wheel at
//! the pointer for the files selected in Explorer or Finder, and Ctrl+Shift+D (⌃⇧D) downloads the
//! link on the clipboard. Each can be switched off in Settings; one another app holds is
//! reported once. The window layout shortcuts are registered here too (`layouts`).

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::layouts;
use crate::overlay::{toast, wheel};
use crate::platform::{self, PlatformError};
use crate::{i18n, AppState};

fn selection() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

fn download() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyD)
}

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let app = app.clone();
            // COM (Explorer), Apple Events (Finder) and the clipboard may take a moment; not on
            // the main thread.
            if *shortcut == selection() {
                std::thread::spawn(move || open_for_selection(&app));
            } else if *shortcut == download() {
                std::thread::spawn(move || crate::web::open_from_clipboard(&app));
            } else if let Some(layout) = layouts::for_shortcut(shortcut) {
                std::thread::spawn(move || layouts::apply_front(&app, layout));
            }
        })
        .build()
}

fn open_for_selection(app: &AppHandle) {
    let lang = app.state::<AppState>().lang();
    // With nothing selected the Window ring may open, for the window in front now, before the
    // wheel takes the focus.
    let front = layouts::ring_candidate(app);
    match read_selection(app) {
        Ok(paths) if !paths.is_empty() => {
            let kind = first_wheel(&crate::work::inspect(paths.clone()));
            wheel::open_for(app, paths, kind)
        }
        Ok(_) if layouts::open_ring(app, front) => {}
        Ok(_) => toast::note(app, i18n::text(&lang, on_this_system("shortcut.nothing"))),
        Err(PlatformError::Permission(_)) => {
            toast::note(app, i18n::text(&lang, "shortcut.permission"))
        }
        Err(err) => {
            tracing::warn!("the selection could not be read: {err}");
            toast::note(
                app,
                i18n::text(&lang, on_this_system("shortcut.unreadable")),
            );
        }
    }
}

/// The text that names this system's file manager: Explorer, or Finder on a Mac.
fn on_this_system(key: &'static str) -> &'static str {
    match key {
        "shortcut.nothing" if cfg!(target_os = "macos") => "shortcut.nothing.mac",
        "shortcut.unreadable" if cfg!(target_os = "macos") => "shortcut.unreadable.mac",
        _ => key,
    }
}

/// The wheel the shortcut opens: Convert, unless nothing selected converts (a program, a folder,
/// an unknown file), when the file actions, which work on everything, open instead of an empty
/// wheel.
fn first_wheel(files: &[crate::work::FileEntry]) -> wheel::Kind {
    if files
        .iter()
        .any(|file| !file.folder && file.format.is_some())
    {
        wheel::Kind::Convert
    } else {
        wheel::Kind::Actions
    }
}

/// Finder answers Apple Events only from the main thread; Explorer's COM is set up per thread.
fn read_selection(app: &AppHandle) -> platform::Result<Vec<std::path::PathBuf>> {
    if cfg!(target_os = "macos") {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(platform::file_manager_selection());
        })
        .map_err(|err| PlatformError::Failed(err.to_string()))?;
        rx.recv().unwrap_or_else(|_| {
            Err(PlatformError::Failed(
                "no answer from the main thread".into(),
            ))
        })
    } else {
        platform::file_manager_selection()
    }
}

/// What to do with a shortcut so that it matches its setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Change {
    Register,
    Release,
    Keep,
}

pub(crate) fn change(wanted: bool, registered: bool) -> Change {
    match (wanted, registered) {
        (true, false) => Change::Register,
        (false, true) => Change::Release,
        _ => Change::Keep,
    }
}

/// Registers or releases each shortcut to match the settings. Registering fails when another app
/// holds the keys; the user then hears which shortcut is taken.
pub fn sync(app: &AppHandle) {
    let settings = app.state::<AppState>().settings();
    apply(
        app,
        selection(),
        settings.wheels.selection_shortcut,
        "shortcut.taken",
    );
    apply(app, download(), settings.web.shortcut, "web.shortcut.taken");
    layouts::sync_shortcuts(app);
}

fn apply(app: &AppHandle, shortcut: Shortcut, wanted: bool, taken: &str) {
    let shortcuts = app.global_shortcut();
    let result = match change(wanted, shortcuts.is_registered(shortcut)) {
        Change::Register => shortcuts.register(shortcut),
        Change::Release => shortcuts.unregister(shortcut),
        Change::Keep => Ok(()),
    };
    if let Err(err) = result {
        tracing::warn!("a global shortcut could not be set: {err}");
        if wanted {
            let lang = app.state::<AppState>().lang();
            toast::note(app, i18n::text(&lang, taken));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_that_convert_open_convert_and_others_the_file_actions() {
        let dir = tempfile::tempdir().unwrap();
        let picture = dir.path().join("fotoğraf 🧪.png");
        let program = dir.path().join("kento.exe");
        let folder = dir.path().join("klasör");
        std::fs::write(&picture, b"png").unwrap();
        std::fs::write(&program, b"MZ").unwrap();
        std::fs::create_dir(&folder).unwrap();
        let entries = |paths: &[&std::path::Path]| {
            crate::work::inspect(paths.iter().map(|p| p.to_path_buf()).collect())
        };
        assert_eq!(first_wheel(&entries(&[&picture])), wheel::Kind::Convert);
        assert_eq!(
            first_wheel(&entries(&[&program, &picture])),
            wheel::Kind::Convert
        );
        assert_eq!(first_wheel(&entries(&[&program])), wheel::Kind::Actions);
        assert_eq!(
            first_wheel(&entries(&[&folder, &program])),
            wheel::Kind::Actions
        );
    }

    #[test]
    fn a_shortcut_follows_its_setting() {
        assert_eq!(change(true, false), Change::Register);
        assert_eq!(change(false, true), Change::Release);
        assert_eq!(change(true, true), Change::Keep);
        assert_eq!(change(false, false), Change::Keep);
    }

    #[test]
    fn the_shortcuts_are_control_shift_space_and_d() {
        let both = Modifiers::CONTROL | Modifiers::SHIFT;
        assert_eq!((selection().mods, selection().key), (both, Code::Space));
        assert_eq!((download().mods, download().key), (both, Code::KeyD));
        // Different keys, so the handler tells them apart and one can be off alone.
        assert_ne!(selection(), download());
        assert_ne!(selection().id(), download().id());
    }
}
