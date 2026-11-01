// SPDX-License-Identifier: MIT
//! What Kento needs from the operating system for the global wheel and the shell (SPEC 5.2, 5.7,
//! section 6): seeing a drag anywhere on screen and the modifier keys held during it, the file
//! manager's selection, sharing, a terminal, and the Send To and context menu entries. Positions
//! are physical pixels in virtual-screen coordinates, the same as Tauri's.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

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
// The macOS drag logic is plain Rust; its tests run on every system.
#[cfg(all(test, not(target_os = "macos")))]
#[path = "macos/tracker.rs"]
mod macos_tracker;
#[cfg(not(any(windows, target_os = "macos")))]
use other as os;

#[derive(Debug, thiserror::Error)]
pub enum PlatformError {
    #[error("not available on this system")]
    Unsupported,
    /// The user has not allowed it yet (macOS Automation for the Finder selection).
    #[error("permission needed: {0}")]
    Permission(String),
    #[error("{0}")]
    Failed(String),
}

pub type Result<T> = std::result::Result<T, PlatformError>;

/// The modifier keys held at a moment. `command` is ⌘ on macOS and the Windows key elsewhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Modifiers {
    pub shift: bool,
    pub control: bool,
    pub alt: bool,
    pub command: bool,
}

impl Modifiers {
    pub fn any(self) -> bool {
        self.shift || self.control || self.alt || self.command
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// What the drag watcher reports, from its own thread.
#[derive(Debug, Clone, PartialEq)]
pub enum DragEvent {
    /// The primary button went down and the pointer moved past the system's drag threshold.
    /// Whether a file is being dragged is unknown until it reaches one of Kento's windows.
    Started { at: Point, modifiers: Modifiers },
    /// During a drag: the pointer moved or the modifiers changed.
    Moved { at: Point, modifiers: Modifiers },
    /// Esc during a drag.
    Escape,
    /// The primary button went up.
    Ended { at: Point },
}

/// Stops watching when dropped.
pub struct DragWatcher(#[allow(dead_code)] os::Watcher);

/// Watches for drags anywhere on screen without hooking the keyboard (SPEC section 6): polling
/// that is light while the button is up. `on_event` is called from the watcher's thread.
pub fn watch_drags(on_event: Box<dyn Fn(DragEvent) + Send + 'static>) -> Result<DragWatcher> {
    os::watch_drags(on_event).map(DragWatcher)
}

/// The files and folders selected in the front File Explorer window (its active tab) or Finder
/// window, for the selection shortcut (SPEC 5.2).
pub fn file_manager_selection() -> Result<Vec<PathBuf>> {
    os::file_manager_selection()
}

/// The system's share sheet for these files, attached to a window (raw handle as an integer:
/// an HWND on Windows, an NSWindow pointer on macOS).
pub fn share(paths: &[PathBuf], window: isize) -> Result<()> {
    os::share(paths, window)
}

/// Opens a terminal in `dir`: Windows Terminal when present, otherwise PowerShell; Terminal on
/// macOS.
pub fn open_terminal(dir: &Path) -> Result<()> {
    os::open_terminal(dir)
}

/// Adds or removes Kento in Explorer's Send To menu, launching `exe` with the files.
pub fn set_send_to(enabled: bool, exe: &Path, name: &str) -> Result<()> {
    os::set_send_to(enabled, exe, name)
}

/// Adds or removes "Open with Kento's wheel" in the classic context menu of files and folders
/// (Windows), launching `exe` with the file.
pub fn set_context_menu(enabled: bool, exe: &Path, label: &str) -> Result<()> {
    os::set_context_menu(enabled, exe, label)
}

/// A light haptic tick on macOS trackpads; nothing elsewhere.
pub fn haptic_tick() {
    os::haptic_tick()
}
