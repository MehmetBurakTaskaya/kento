// SPDX-License-Identifier: MIT
//! The selection shortcut (SPEC 5.2): Ctrl+Shift+Space on Windows, ⌃⇧Space on macOS, opens the
//! wheel at the pointer for the files selected in Explorer or Finder.

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::overlay::{toast, wheel};
use crate::platform::{self, PlatformError};
use crate::{i18n, AppState};

fn selection() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state != ShortcutState::Pressed || *shortcut != selection() {
                return;
            }
            let app = app.clone();
            // COM (Explorer) and Apple Events (Finder) may take a moment; not on the main thread.
            std::thread::spawn(move || open_for_selection(&app));
        })
        .build()
}

fn open_for_selection(app: &AppHandle) {
    let lang = app.state::<AppState>().lang();
    match platform::file_manager_selection() {
        Ok(paths) if !paths.is_empty() => wheel::open_for(app, paths, wheel::Kind::Convert),
        Ok(_) => toast::note(app, i18n::text(&lang, "shortcut.nothing")),
        Err(PlatformError::Permission(_)) => {
            toast::note(app, i18n::text(&lang, "shortcut.permission"))
        }
        Err(err) => tracing::warn!("the selection could not be read: {err}"),
    }
}

/// Registers or releases the shortcut to match the setting; a shortcut another app holds is
/// reported once.
pub fn sync(app: &AppHandle) {
    let wanted = app.state::<AppState>().settings().wheels.selection_shortcut;
    let shortcuts = app.global_shortcut();
    let registered = shortcuts.is_registered(selection());
    let result = match (wanted, registered) {
        (true, false) => shortcuts.register(selection()),
        (false, true) => shortcuts.unregister(selection()),
        _ => Ok(()),
    };
    if let Err(err) = result {
        tracing::warn!("the selection shortcut could not be set: {err}");
        if wanted {
            let lang = app.state::<AppState>().lang();
            toast::note(app, i18n::text(&lang, "shortcut.taken"));
        }
    }
}
