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

/// What a drag over one of Kento's windows carries (SPEC 5.2, 5.10).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DragContent {
    Files(Vec<PathBuf>),
    /// One web address: a link, or a picture or video card dragged out of a browser.
    Link(String),
    /// Anything else, such as a piece of text.
    Other,
}

impl DragContent {
    /// Files and a web address can come together: a browser may add a temporary copy of a
    /// dragged picture to its address, while a file manager never names a web address for the
    /// files it drags. So the address wins, and the drag offers downloading it. `texts` are what
    /// the drag holds as text, the URL formats first; only one http or https address counts.
    pub fn classify(paths: Vec<PathBuf>, texts: impl IntoIterator<Item = String>) -> Self {
        if let Some(link) = texts
            .into_iter()
            .map(|text| text.trim().trim_end_matches('\0').trim().to_string())
            .find(|text| kento_engines::web::is_link(text))
        {
            return DragContent::Link(link);
        }
        if paths.is_empty() {
            DragContent::Other
        } else {
            DragContent::Files(paths)
        }
    }

    /// Kento's windows take files and links; anything else is refused.
    pub fn accepted(&self) -> bool {
        !matches!(self, DragContent::Other)
    }
}

/// The address in a URL format: its first line that is not a comment. Firefox's
/// "text/x-moz-url" puts the page title on the second line, and a URI list may hold comments.
pub fn url_line(text: &str) -> Option<&str> {
    text.lines()
        .map(|line| line.trim().trim_end_matches('\0'))
        .find(|line| !line.is_empty() && !line.starts_with('#'))
}

/// A drag over a window whose drops Kento reads itself. Positions are physical pixels from the
/// top-left corner of the webview.
#[derive(Debug, Clone, PartialEq)]
pub enum DropEvent {
    Enter { content: DragContent, at: Point },
    Over { at: Point },
    Leave,
    Drop { content: DragContent, at: Point },
}

/// Windows: replaces the webview's drop target in a window (raw HWND as an integer) with one
/// that reads links as well as files, and returns how many of the webview's windows it now
/// serves. The webview's own target hands over files only, so a link dragged from a browser
/// would never reach the page. Must run on the window's thread, which has OLE set up.
#[cfg(windows)]
pub fn accept_drops(
    window: isize,
    on_event: std::sync::Arc<dyn Fn(DropEvent) + Send + Sync>,
) -> Result<usize> {
    os::accept_drops(window, on_event)
}

/// The web address a drag in progress carries, read from the system's drag pasteboard (macOS),
/// for a drag the webview reports without files. Windows reads it in Kento's own drop target
/// instead, so there it is always None.
pub fn dragged_link() -> Option<String> {
    os::dragged_link()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(list: &[&str]) -> Vec<String> {
        list.iter().map(|text| text.to_string()).collect()
    }

    #[test]
    fn a_file_manager_drag_is_files() {
        let paths = vec![PathBuf::from(r"C:\Users\me\Kapadokya 🎈.heic")];
        assert_eq!(
            DragContent::classify(paths.clone(), Vec::new()),
            DragContent::Files(paths.clone())
        );
        // A file's own address is not a web address.
        assert_eq!(
            DragContent::classify(paths.clone(), texts(&["file:///C:/Users/me/a.heic"])),
            DragContent::Files(paths)
        );
    }

    #[test]
    fn a_browser_link_is_a_link_even_with_a_temporary_copy() {
        let link = "https://www.youtube.com/watch?v=abc";
        assert_eq!(
            DragContent::classify(Vec::new(), texts(&[link])),
            DragContent::Link(link.into())
        );
        let copy = vec![PathBuf::from(r"C:\Users\me\AppData\Local\Temp\image.jpg")];
        assert_eq!(
            DragContent::classify(
                copy,
                texts(&["https://cdn.example.org/image.jpg\0", "image.jpg"])
            ),
            DragContent::Link("https://cdn.example.org/image.jpg".into())
        );
    }

    #[test]
    fn the_first_text_that_is_one_address_counts() {
        assert_eq!(
            DragContent::classify(
                Vec::new(),
                texts(&["", "see https://a.org/x", "  https://b.org/y \r\n"])
            ),
            DragContent::Link("https://b.org/y".into())
        );
    }

    #[test]
    fn text_that_is_not_one_address_is_refused() {
        for other in [
            texts(&["a quote from a page"]),
            texts(&["https://a.org/x https://b.org/y"]),
            texts(&["ftp://example.org/file"]),
            Vec::new(),
        ] {
            let content = DragContent::classify(Vec::new(), other);
            assert_eq!(content, DragContent::Other);
            assert!(!content.accepted());
        }
    }

    #[test]
    fn url_formats_give_their_first_address_line() {
        assert_eq!(
            url_line("https://a.org/watch\r\nA video title"),
            Some("https://a.org/watch")
        );
        assert_eq!(
            url_line("# a comment\n\nhttps://b.org/\n"),
            Some("https://b.org/")
        );
        assert_eq!(url_line("https://c.org/\0"), Some("https://c.org/"));
        assert_eq!(url_line(" \n# only a comment"), None);
    }
}
