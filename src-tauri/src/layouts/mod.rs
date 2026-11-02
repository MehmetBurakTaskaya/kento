// SPDX-License-Identifier: MIT
//! Window layouts (SPEC 5.12): the window in front, of another app, goes to a half, a quarter, the
//! centre or the whole of the monitor it is on, inside the monitor's work area. A global shortcut
//! places it at once; the wheel's Window ring (the selection shortcut with nothing selected)
//! places the window that was in front when the ring opened. The feature is off until switched on
//! in Settings. Kento's own windows are never moved.
//!
//! Windows moves the window with `SetWindowPos`, minding the invisible resize borders; macOS uses
//! the Accessibility API, which needs the user's permission (asked when the feature is switched on,
//! or at its first use, after Kento has said why).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::overlay::{toast, wheel};
use crate::settings::LayoutSettings;
use crate::shortcut::{change, Change};
use crate::{i18n, AppState};

mod geometry;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as os;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as os;
#[cfg(not(any(windows, target_os = "macos")))]
mod other;
#[cfg(not(any(windows, target_os = "macos")))]
use other as os;

/// The eight layouts, in the order Settings lists them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Layout {
    LeftHalf,
    RightHalf,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
    FullScreen,
}

impl Layout {
    pub const ALL: [Layout; 8] = [
        Layout::LeftHalf,
        Layout::RightHalf,
        Layout::TopLeft,
        Layout::TopRight,
        Layout::BottomLeft,
        Layout::BottomRight,
        Layout::Center,
        Layout::FullScreen,
    ];
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LayoutError {
    /// Nothing to place: the desktop or the taskbar is in front, or a window of Kento's own.
    #[error("no window of another app is in front")]
    NoWindow,
    /// A window Kento may not move: one of an app running as administrator (Windows keeps lower
    /// apps away from it), a hung one, or a full-screen one on macOS. Nothing is shown for it.
    #[error("this window cannot be moved from here")]
    Blocked,
    /// macOS: Kento is not allowed to use the Accessibility API.
    #[error("the Accessibility permission is missing")]
    Permission,
    #[error("{0}")]
    Failed(String),
}

/// Whether placing windows needs a permission, and whether Kento has it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Permission {
    /// Windows needs none.
    NotNeeded,
    Granted,
    Missing,
}

/// A window of another app, remembered until it is placed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Target(os::Target);

#[derive(Default)]
pub struct LayoutState {
    /// The window that was in front when the Window ring opened; the ring acts on it.
    ring: Mutex<Option<Target>>,
    /// The layout shortcuts another app holds, so each is reported once.
    taken: Mutex<Vec<Layout>>,
    /// The permission prompt has been shown in this run (macOS).
    asked: AtomicBool,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

/// The key of each layout, and its modifiers. Ctrl+Alt (⌃⌥⌘ on macOS) with the arrows for the
/// halves, the whole screen (up) and the centre (down); the quarters on four keys that sit as a
/// square: Home, Page Up, End and Page Down on Windows (also numpad 7, 9, 1 and 3 with Num Lock
/// off), U, I, J and K on macOS, whose laptops have no Home or Page keys. Windows Snap keeps the
/// Windows logo key and the arrows; Ctrl+Alt is AltGr on many keyboards, so on Windows no letter
/// or digit is used, only keys that type nothing. macOS keeps Control and the arrows for Spaces
/// and Mission Control, and Control-Option for VoiceOver, so Command joins them there.
fn keys(layout: Layout, mac: bool) -> (Modifiers, Code) {
    let modifiers = if mac {
        Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER
    } else {
        Modifiers::CONTROL | Modifiers::ALT
    };
    let code = match (layout, mac) {
        (Layout::LeftHalf, _) => Code::ArrowLeft,
        (Layout::RightHalf, _) => Code::ArrowRight,
        (Layout::FullScreen, _) => Code::ArrowUp,
        (Layout::Center, _) => Code::ArrowDown,
        (Layout::TopLeft, false) => Code::Home,
        (Layout::TopRight, false) => Code::PageUp,
        (Layout::BottomLeft, false) => Code::End,
        (Layout::BottomRight, false) => Code::PageDown,
        (Layout::TopLeft, true) => Code::KeyU,
        (Layout::TopRight, true) => Code::KeyI,
        (Layout::BottomLeft, true) => Code::KeyJ,
        (Layout::BottomRight, true) => Code::KeyK,
    };
    (modifiers, code)
}

const MAC: bool = cfg!(target_os = "macos");

pub fn shortcut(layout: Layout) -> Shortcut {
    let (modifiers, code) = keys(layout, MAC);
    Shortcut::new(Some(modifiers), code)
}

/// The layout a pressed shortcut stands for.
pub fn for_shortcut(pressed: &Shortcut) -> Option<Layout> {
    Layout::ALL
        .into_iter()
        .find(|layout| shortcut(*layout) == *pressed)
}

/// How a shortcut is written, the way each system writes it: "Ctrl+Alt+←", "⌃⌥⌘←". Key names
/// are not translated, as on the keys themselves.
fn label(layout: Layout, mac: bool) -> String {
    let (_, code) = keys(layout, mac);
    let key = match code {
        Code::ArrowLeft => "←",
        Code::ArrowRight => "→",
        Code::ArrowUp => "↑",
        Code::ArrowDown => "↓",
        Code::Home => "Home",
        Code::PageUp => "Page Up",
        Code::End => "End",
        Code::PageDown => "Page Down",
        Code::KeyU => "U",
        Code::KeyI => "I",
        Code::KeyJ => "J",
        Code::KeyK => "K",
        _ => "?",
    };
    if mac {
        format!("⌃⌥⌘{key}")
    } else {
        format!("Ctrl+Alt+{key}")
    }
}

/// The shortcuts that failed to register now and were not reported before: those are the ones
/// to tell the user about.
fn newly_taken(before: &[Layout], failed: &[Layout]) -> Vec<Layout> {
    failed
        .iter()
        .copied()
        .filter(|layout| !before.contains(layout))
        .collect()
}

/// The layout shortcuts are held only while the feature and its shortcuts are both on.
fn shortcuts_wanted(settings: &LayoutSettings) -> bool {
    settings.enabled && settings.shortcuts
}

/// Registers or releases the layout shortcuts to match the settings. A shortcut another app holds
/// is reported once, in one note for all of them, and shown as taken in Settings.
pub fn sync_shortcuts(app: &AppHandle) {
    let wanted = shortcuts_wanted(&app.state::<AppState>().settings().layouts);
    let shortcuts = app.global_shortcut();
    let mut failed = Vec::new();
    for layout in Layout::ALL {
        let key = shortcut(layout);
        let result = match change(wanted, shortcuts.is_registered(key)) {
            Change::Register => shortcuts.register(key),
            Change::Release => shortcuts.unregister(key),
            Change::Keep => Ok(()),
        };
        if let Err(err) = result {
            tracing::warn!("a window layout shortcut could not be set: {err}");
            if wanted {
                failed.push(layout);
            }
        }
    }
    let state = app.state::<LayoutState>();
    let fresh = {
        let mut taken = lock(&state.taken);
        let fresh = newly_taken(&taken, &failed);
        *taken = failed;
        fresh
    };
    if !fresh.is_empty() {
        let keys: Vec<String> = fresh.iter().map(|layout| label(*layout, MAC)).collect();
        let lang = app.state::<AppState>().lang();
        let message = i18n::text(&lang, "layouts.taken").replace("{keys}", &keys.join(", "));
        toast::note(app, message);
    }
}

fn enabled(app: &AppHandle) -> bool {
    app.state::<AppState>().settings().layouts.enabled
}

/// macOS: whether Kento may use the Accessibility API; at the first use in a run without it,
/// the user reads why Kento asks and then sees the system's prompt. Afterwards a use without it
/// only says where to allow it.
fn allowed(app: &AppHandle) -> bool {
    if os::permission() != Permission::Missing {
        return true;
    }
    let lang = app.state::<AppState>().lang();
    if app
        .state::<LayoutState>()
        .asked
        .swap(true, Ordering::SeqCst)
    {
        toast::note(app, i18n::text(&lang, "layouts.permission.missing"));
    } else {
        toast::note(app, i18n::text(&lang, "layouts.permission.why"));
        os::ask_permission();
    }
    false
}

/// For the selection shortcut, before it opens anything: the window in front, which the Window
/// ring would place, while the feature is on.
pub fn ring_candidate(app: &AppHandle) -> Option<(Target, String)> {
    if enabled(app) {
        front(app)
    } else {
        None
    }
}

/// The window in front and its title, when it belongs to another app. On macOS AppKit answers
/// from the main thread only.
fn front(app: &AppHandle) -> Option<(Target, String)> {
    if cfg!(target_os = "macos") {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(os::front());
        })
        .ok()?;
        rx.recv()
            .ok()
            .flatten()
            .map(|(target, title)| (Target(target), title))
    } else {
        os::front().map(|(target, title)| (Target(target), title))
    }
}

/// A layout shortcut: places the window in front at once.
pub fn apply_front(app: &AppHandle, layout: Layout) {
    if !enabled(app) || !allowed(app) {
        return;
    }
    match front(app) {
        Some((target, _)) => place(app, target, layout, false),
        None => tracing::info!("no window of another app to place"),
    }
}

/// The selection shortcut found nothing selected: with the feature on, the Window ring opens for
/// `front`, the window that was in front when the shortcut was pressed. Returns whether the
/// shortcut was handled here (the ring opened, or the permission note was shown instead).
pub fn open_ring(app: &AppHandle, front: Option<(Target, String)>) -> bool {
    if !enabled(app) {
        return false;
    }
    let Some((target, title)) = front else {
        return false;
    };
    if !allowed(app) {
        return true;
    }
    *lock(&app.state::<LayoutState>().ring) = Some(target);
    wheel::open_window(app, title);
    true
}

fn place(app: &AppHandle, target: Target, layout: Layout, activate: bool) {
    let result = screens(app).and_then(|screens| os::place(target.0, layout, &screens, activate));
    match result {
        Ok(()) => {}
        // A quiet refusal: nothing the user can change from Kento, and no reason to suggest
        // running anything as administrator.
        Err(err @ (LayoutError::NoWindow | LayoutError::Blocked)) => {
            tracing::info!("the window was left as it was: {err}");
        }
        Err(LayoutError::Permission) => {
            let lang = app.state::<AppState>().lang();
            toast::note(app, i18n::text(&lang, "layouts.permission.missing"));
        }
        Err(LayoutError::Failed(err)) => {
            tracing::warn!("the window could not be placed: {err}");
            let lang = app.state::<AppState>().lang();
            toast::note(app, i18n::text(&lang, "layouts.failed"));
        }
    }
}

/// The monitors' work areas where the system gives them only on the main thread (macOS).
fn screens(app: &AppHandle) -> Result<os::Screens, LayoutError> {
    if cfg!(target_os = "macos") {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(os::screens());
        })
        .map_err(|err| LayoutError::Failed(err.to_string()))?;
        rx.recv()
            .map_err(|_| LayoutError::Failed("no answer from the main thread".into()))
    } else {
        Ok(os::screens())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutInfo {
    pub layout: Layout,
    pub keys: String,
    /// Another app holds it.
    pub taken: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutStatus {
    pub permission: Permission,
    pub shortcuts: Vec<ShortcutInfo>,
}

fn status(state: &LayoutState) -> LayoutStatus {
    let taken = lock(&state.taken).clone();
    LayoutStatus {
        permission: os::permission(),
        shortcuts: Layout::ALL
            .into_iter()
            .map(|layout| ShortcutInfo {
                layout,
                keys: label(layout, MAC),
                taken: taken.contains(&layout),
            })
            .collect(),
    }
}

/// For Settings: the shortcuts, which of them another app holds, and the permission.
#[tauri::command]
pub fn layouts_status(state: tauri::State<'_, LayoutState>) -> LayoutStatus {
    status(&state)
}

/// A slice of the Window ring: places the window that was in front when the ring opened, and
/// gives it the focus back from the wheel. Moving a window of another app can wait on that app,
/// so it runs on its own thread.
#[tauri::command]
pub fn layouts_apply(app: AppHandle, state: tauri::State<'_, LayoutState>, layout: Layout) {
    let Some(target) = lock(&state.ring).take() else {
        return;
    };
    std::thread::spawn(move || {
        if allowed(&app) {
            place(&app, target, layout, true);
        }
    });
}

/// Switching the feature on in Settings on macOS, after Kento has said why: the system's prompt
/// for the Accessibility permission. Elsewhere nothing to ask.
#[tauri::command]
pub fn layouts_ask_permission(state: tauri::State<'_, LayoutState>) -> LayoutStatus {
    if os::permission() == Permission::Missing {
        state.asked.store(true, Ordering::SeqCst);
        os::ask_permission();
    }
    status(&state)
}

/// Opens the Accessibility list of System Settings (macOS).
#[tauri::command]
pub fn layouts_open_permission_settings() -> crate::error::Result<()> {
    os::open_permission_settings().map_err(|err| crate::error::Error::Invalid(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_layout_has_its_own_shortcut_on_both_systems() {
        for mac in [false, true] {
            let all: Vec<(Modifiers, Code)> =
                Layout::ALL.into_iter().map(|l| keys(l, mac)).collect();
            for (i, a) in all.iter().enumerate() {
                assert!(all[i + 1..].iter().all(|b| a != b), "{a:?} twice");
            }
        }
    }

    #[test]
    fn the_shortcuts_stay_clear_of_snap_and_of_altgr() {
        // Letters, digits and punctuation: "KeyA", "Digit1", "Comma"…; arrows and Home do not
        // type anything.
        let typing = |code: Code| {
            let name = format!("{code:?}");
            !(name.starts_with("Arrow")
                || matches!(name.as_str(), "Home" | "End" | "PageUp" | "PageDown"))
        };
        for layout in Layout::ALL {
            let (modifiers, code) = keys(layout, false);
            // Windows: never the Windows logo key (Snap and the system own it), and with
            // Ctrl+Alt, which is AltGr on many layouts, never a key that types a character.
            assert_eq!(modifiers, Modifiers::CONTROL | Modifiers::ALT);
            assert!(!typing(code), "{layout:?} uses {code:?}");
            // macOS: Command always joins Control-Option (VoiceOver's keys), and Control alone
            // with the arrows (Spaces, Mission Control) is never used.
            let (modifiers, _) = keys(layout, true);
            assert_eq!(
                modifiers,
                Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER
            );
        }
    }

    #[test]
    fn the_quarters_sit_as_a_square_and_the_arrows_point_the_way() {
        assert_eq!(keys(Layout::LeftHalf, false).1, Code::ArrowLeft);
        assert_eq!(keys(Layout::RightHalf, true).1, Code::ArrowRight);
        assert_eq!(keys(Layout::FullScreen, false).1, Code::ArrowUp);
        assert_eq!(keys(Layout::Center, true).1, Code::ArrowDown);
        let quarters = [
            Layout::TopLeft,
            Layout::TopRight,
            Layout::BottomLeft,
            Layout::BottomRight,
        ];
        let windows: Vec<Code> = quarters.iter().map(|l| keys(*l, false).1).collect();
        let mac: Vec<Code> = quarters.iter().map(|l| keys(*l, true).1).collect();
        assert_eq!(
            windows,
            [Code::Home, Code::PageUp, Code::End, Code::PageDown]
        );
        assert_eq!(mac, [Code::KeyU, Code::KeyI, Code::KeyJ, Code::KeyK]);
    }

    #[test]
    fn a_pressed_shortcut_finds_its_layout() {
        for layout in Layout::ALL {
            assert_eq!(for_shortcut(&shortcut(layout)), Some(layout));
        }
        let selection = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
        assert_eq!(for_shortcut(&selection), None);
        // The same key with other modifiers is not a layout shortcut.
        let plain = Shortcut::new(Some(Modifiers::CONTROL), Code::ArrowLeft);
        assert_eq!(for_shortcut(&plain), None);
    }

    #[test]
    fn shortcuts_are_written_as_each_system_writes_them() {
        assert_eq!(label(Layout::LeftHalf, false), "Ctrl+Alt+←");
        assert_eq!(label(Layout::BottomRight, false), "Ctrl+Alt+Page Down");
        assert_eq!(label(Layout::TopLeft, true), "⌃⌥⌘U");
        assert_eq!(label(Layout::FullScreen, true), "⌃⌥⌘↑");
    }

    #[test]
    fn the_shortcuts_are_held_only_while_the_feature_and_they_are_on() {
        // Off by default: nothing is registered until the user switches the feature on.
        let default = LayoutSettings::default();
        assert!(!shortcuts_wanted(&default));
        assert_eq!(change(shortcuts_wanted(&default), false), Change::Keep);
        let on = LayoutSettings {
            enabled: true,
            ..default.clone()
        };
        assert!(shortcuts_wanted(&on));
        assert_eq!(change(shortcuts_wanted(&on), false), Change::Register);
        // The shortcuts switched off while the feature stays on: the wheel only.
        let wheel_only = LayoutSettings {
            shortcuts: false,
            ..on.clone()
        };
        assert_eq!(change(shortcuts_wanted(&wheel_only), true), Change::Release);
        // The feature switched off releases them whatever the shortcuts switch says.
        assert_eq!(change(shortcuts_wanted(&default), true), Change::Release);
    }

    #[test]
    fn a_taken_shortcut_is_reported_once() {
        let first = [Layout::TopLeft, Layout::Center];
        assert_eq!(newly_taken(&[], &first), first);
        // Trying again at the next change of settings reports nothing new.
        assert!(newly_taken(&first, &first).is_empty());
        // One more taken since: only that one.
        assert_eq!(
            newly_taken(&first, &[Layout::TopLeft, Layout::Center, Layout::LeftHalf]),
            [Layout::LeftHalf]
        );
        // Released and taken again later (the feature switched off and on): reported again.
        assert_eq!(newly_taken(&[], &[Layout::Center]), [Layout::Center]);
    }

    #[test]
    fn layouts_are_named_in_kebab_case_for_the_page() {
        let names: Vec<String> = Layout::ALL
            .into_iter()
            .map(|l| serde_json::to_string(&l).unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "\"left-half\"",
                "\"right-half\"",
                "\"top-left\"",
                "\"top-right\"",
                "\"bottom-left\"",
                "\"bottom-right\"",
                "\"center\"",
                "\"full-screen\""
            ]
        );
    }
}
