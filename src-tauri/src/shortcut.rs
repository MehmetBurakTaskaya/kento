// SPDX-License-Identifier: MIT
//! The global shortcuts (SPEC 5.2, 5.10): Ctrl+Shift+Space (⌃⇧Space on macOS) opens the wheel at
//! the pointer for the files selected in Explorer or Finder, and Ctrl+Shift+D (⌃⇧D) downloads the
//! link on the clipboard. Each can be switched off in Settings; one another app holds is
//! reported once.

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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
            }
        })
        .build()
}

fn open_for_selection(app: &AppHandle) {
    let lang = app.state::<AppState>().lang();
    match read_selection(app) {
        Ok(paths) if !paths.is_empty() => wheel::open_for(app, paths, wheel::Kind::Convert),
        Ok(_) => toast::note(app, i18n::text(&lang, "shortcut.nothing")),
        Err(PlatformError::Permission(_)) => {
            toast::note(app, i18n::text(&lang, "shortcut.permission"))
        }
        Err(err) => tracing::warn!("the selection could not be read: {err}"),
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
enum Change {
    Register,
    Release,
    Keep,
}

fn change(wanted: bool, registered: bool) -> Change {
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
