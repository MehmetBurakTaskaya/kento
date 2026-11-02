// SPDX-License-Identifier: MIT
//! The global wheel (SPEC 5.2, 5.3). While files are dragged anywhere, pressing a wheel's modifier
//! moves the wheel window under the pointer; the drop on a slice runs the choice. The wheel also
//! opens without a drag ("click mode") for the selection shortcut, Send To and the context menu.
//! The window never takes the focus during a drag: that would break the source's drag loop.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::platform::{self, DragEvent, Modifiers, Point};
use crate::settings::{Key, Wheels};
use crate::AppState;

pub const LABEL: &str = "wheel";

/// Explorer may start Kento once per selected file; launches this close together join one wheel.
const JOIN_LAUNCHES: Duration = Duration::from_millis(400);

/// After the button goes up, how long a drop on the wheel may take to arrive before the wheel
/// closes as "dropped elsewhere".
const DROP_GRACE: Duration = Duration::from_millis(450);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Convert,
    Tools,
    Actions,
    /// The window layouts (SPEC 5.12), for the window that was in front; no files.
    Window,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    Drag,
    Click,
}

/// What the wheel window is showing; sent with every "wheel-open" event.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub kind: Kind,
    pub mode: Mode,
    /// Known up front in click mode; in a drag the page learns them when the drag enters it.
    pub paths: Vec<PathBuf>,
    /// The Window ring: the title of the window it places.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    #[serde(skip)]
    dropped: bool,
    /// Tells a new session from a change of wheel in the same one.
    #[serde(rename = "id")]
    generation: u64,
    #[serde(skip)]
    opened: Option<Instant>,
}

#[derive(Default)]
pub struct WheelState {
    session: Mutex<Option<Session>>,
    watcher: Mutex<Option<platform::DragWatcher>>,
    generation: std::sync::atomic::AtomicU64,
}

impl WheelState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Session>> {
        self.session.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// The wheel a set of held modifiers asks for: exactly one wheel key held. With two held, the
/// wheel already open stays.
pub fn kind_for(modifiers: Modifiers, keys: &Wheels) -> Option<Kind> {
    let held = |key: Key| match key {
        Key::Shift => modifiers.shift,
        Key::Control => modifiers.control,
        Key::Alt => modifiers.alt,
        Key::Command => modifiers.command,
    };
    let mut found = [
        (keys.convert, Kind::Convert),
        (keys.tools, Kind::Tools),
        (keys.actions, Kind::Actions),
    ]
    .into_iter()
    .filter(|(key, _)| held(*key))
    .map(|(_, kind)| kind);
    match (found.next(), found.next()) {
        (Some(kind), None) => Some(kind),
        _ => None,
    }
}

/// Starts or stops watching for drags to match the setting.
pub fn sync_watcher(app: &AppHandle) {
    let state = app.state::<AppState>();
    let wanted = state.settings().wheels.global;
    let mut watcher = state
        .wheel
        .watcher
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    match (wanted, watcher.is_some()) {
        (true, false) => {
            let handle = app.clone();
            match platform::watch_drags(Box::new(move |event| on_drag(&handle, event))) {
                Ok(started) => *watcher = Some(started),
                Err(err) => tracing::warn!("drags cannot be watched here: {err}"),
            }
        }
        (false, true) => *watcher = None,
        _ => {}
    }
}

fn on_drag(app: &AppHandle, event: DragEvent) {
    let state = app.state::<AppState>();
    match event {
        DragEvent::Started { at, modifiers } | DragEvent::Moved { at, modifiers } => {
            let Some(kind) = kind_for(modifiers, &state.settings().wheels) else {
                return;
            };
            let mut session = state.wheel.lock();
            match session.as_mut() {
                Some(open) if open.mode == Mode::Drag && open.kind != kind => {
                    open.kind = kind;
                    emit_open(app, open);
                }
                Some(_) => {}
                None => {
                    let generation = next_generation(&state);
                    let fresh = Session {
                        kind,
                        mode: Mode::Drag,
                        paths: Vec::new(),
                        window: None,
                        dropped: false,
                        generation,
                        opened: None,
                    };
                    show_at(app, at);
                    emit_open(app, &fresh);
                    *session = Some(fresh);
                }
            }
        }
        DragEvent::Escape => {
            if state
                .wheel
                .lock()
                .as_ref()
                .is_some_and(|s| s.mode == Mode::Drag)
            {
                let _ = app.emit_to(LABEL, "wheel-close", ());
            }
        }
        DragEvent::Ended { .. } => {
            let generation = match state.wheel.lock().as_ref() {
                Some(open) if open.mode == Mode::Drag && !open.dropped => open.generation,
                _ => return,
            };
            // The drop event of the wheel's webview may come a moment after the button is up.
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(DROP_GRACE);
                let state = app.state::<AppState>();
                let undropped = state
                    .wheel
                    .lock()
                    .as_ref()
                    .is_some_and(|s| s.generation == generation && !s.dropped);
                if undropped {
                    let _ = app.emit_to(LABEL, "wheel-close", ());
                }
            });
        }
    }
}

fn next_generation(state: &AppState) -> u64 {
    state
        .wheel
        .generation
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1
}

fn show_at(app: &AppHandle, at: Point) {
    let Some(window) = super::window(app, LABEL) else {
        tracing::error!("the wheel window is missing");
        return;
    };
    // WebView2 may have added a window since the start; the drop target covers it before the
    // wheel moves under the drag.
    crate::drops::take_over(&window);
    if let Err(err) = super::move_centred(app, &window, at.x, at.y) {
        tracing::warn!("the wheel could not be placed: {err}");
    }
    let _ = window.set_always_on_top(true);
}

fn emit_open(app: &AppHandle, session: &Session) {
    if let Err(err) = app.emit_to(LABEL, "wheel-open", session) {
        tracing::warn!("the wheel could not be opened: {err}");
    }
}

/// Opens the wheel at the pointer for files that are already known (the selection shortcut, Send
/// To, the context menu). Here the wheel may take the focus, so the keyboard works.
pub fn open_for(app: &AppHandle, paths: Vec<PathBuf>, kind: Kind) {
    let files: Vec<PathBuf> = paths.into_iter().filter(|p| p.exists()).collect();
    if files.is_empty() {
        return;
    }
    let state = app.state::<AppState>();
    {
        let mut session = state.wheel.lock();
        if let Some(open) = session.as_mut().filter(|s| {
            s.mode == Mode::Click && s.opened.is_some_and(|at| at.elapsed() < JOIN_LAUNCHES)
        }) {
            for path in files {
                if !open.paths.contains(&path) {
                    open.paths.push(path);
                }
            }
            emit_open(app, open);
            return;
        }
    }
    let session = Session {
        kind,
        mode: Mode::Click,
        paths: files,
        window: None,
        dropped: false,
        generation: next_generation(&state),
        opened: Some(Instant::now()),
    };
    open_click(app, session);
}

/// Opens the Window ring at the pointer for the window titled `title`, which `layouts` keeps.
pub fn open_window(app: &AppHandle, title: String) {
    let state = app.state::<AppState>();
    let session = Session {
        kind: Kind::Window,
        mode: Mode::Click,
        paths: Vec::new(),
        window: Some(title),
        dropped: false,
        generation: next_generation(&state),
        opened: Some(Instant::now()),
    };
    open_click(app, session);
}

fn open_click(app: &AppHandle, session: Session) {
    let at = app
        .cursor_position()
        .map(|p| Point { x: p.x, y: p.y })
        .unwrap_or(Point { x: 0.0, y: 0.0 });
    show_at(app, at);
    emit_open(app, &session);
    *app.state::<AppState>().wheel.lock() = Some(session);
    if let Some(window) = super::window(app, LABEL) {
        let _ = window.set_focus();
    }
}

/// The page asks what to show, for example after it reloads.
#[tauri::command]
pub fn wheel_session(state: tauri::State<'_, AppState>) -> Option<Session> {
    state.wheel.lock().clone()
}

/// The page saw the drop, so the end of the drag does not close the wheel.
#[tauri::command]
pub fn wheel_dropped(state: tauri::State<'_, AppState>) {
    if let Some(session) = state.wheel.lock().as_mut() {
        session.dropped = true;
    }
}

/// The page switches wheels in click mode (pressing a wheel key while the wheel has the focus).
#[tauri::command]
pub fn wheel_switch(app: AppHandle, state: tauri::State<'_, AppState>, kind: Kind) {
    let mut session = state.wheel.lock();
    // The Window ring has no files for another wheel to act on.
    if let Some(open) = session.as_mut().filter(|s| s.kind != Kind::Window) {
        if open.kind != kind {
            open.kind = kind;
            emit_open(&app, open);
        }
    }
}

/// A light tap on a Force Touch trackpad when the wheel turns to a slice (macOS; SPEC 5.3).
#[tauri::command]
pub fn wheel_haptic(app: AppHandle, state: tauri::State<'_, AppState>) {
    if cfg!(target_os = "macos") && state.settings().haptics {
        let _ = app.run_on_main_thread(platform::haptic_tick);
    }
}

/// The wheel finished closing: it moves away and forgets the session.
#[tauri::command]
pub fn wheel_closed(app: AppHandle, state: tauri::State<'_, AppState>) {
    *state.wheel.lock() = None;
    if let Some(window) = super::window(&app, LABEL) {
        super::park(&window);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mods(shift: bool, control: bool, alt: bool, command: bool) -> Modifiers {
        Modifiers {
            shift,
            control,
            alt,
            command,
        }
    }

    #[test]
    fn one_held_wheel_key_picks_its_wheel() {
        let keys = Wheels {
            convert: Key::Shift,
            tools: Key::Control,
            actions: Key::Alt,
            ..Wheels::default()
        };
        assert_eq!(
            kind_for(mods(true, false, false, false), &keys),
            Some(Kind::Convert)
        );
        assert_eq!(
            kind_for(mods(false, true, false, false), &keys),
            Some(Kind::Tools)
        );
        assert_eq!(
            kind_for(mods(false, false, true, false), &keys),
            Some(Kind::Actions)
        );
        assert_eq!(kind_for(mods(true, true, false, false), &keys), None);
        assert_eq!(kind_for(mods(false, false, false, true), &keys), None);
        assert_eq!(kind_for(Modifiers::default(), &keys), None);
    }
}
