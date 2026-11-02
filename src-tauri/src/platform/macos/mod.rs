// SPDX-License-Identifier: MIT
//! macOS: polling for drags, Apple Events for the Finder selection, the share picker, Terminal and
//! trackpad haptics. AppKit work that needs the main thread reports an error, or for the haptic
//! tick does nothing, when called elsewhere.

mod drag;
mod finder;
mod share;
mod tracker;

use std::path::Path;
use std::process::Command;

use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
    NSHapticFeedbackPerformer,
};

use super::{PlatformError, Result};

pub use drag::{dragged_link, watch_drags, Watcher};
pub use finder::file_manager_selection;
pub use share::share;

pub fn open_terminal(dir: &Path) -> Result<()> {
    // Absolute, so `open` cannot read it as an option, and a folder, because Terminal runs a
    // script it is handed.
    let dir = std::fs::canonicalize(dir)
        .map_err(|e| PlatformError::Failed(format!("terminal folder: {e}")))?;
    if !dir.is_dir() {
        return Err(PlatformError::Failed(
            "terminal folder: not a folder".into(),
        ));
    }
    let status = Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .arg(&dir)
        .status()
        .map_err(|e| PlatformError::Failed(format!("open Terminal: {e}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(PlatformError::Failed(format!("open Terminal: {status}")))
    }
}

/// Finder's counterparts (Quick Actions) come later.
pub fn set_send_to(_enabled: bool, _exe: &Path, _name: &str) -> Result<()> {
    Err(PlatformError::Unsupported)
}

pub fn set_context_menu(_enabled: bool, _exe: &Path, _label: &str) -> Result<()> {
    Err(PlatformError::Unsupported)
}

pub fn haptic_tick() {
    if MainThreadMarker::new().is_none() {
        return;
    }
    // Alignment: Apple's pattern for a dragged item snapping into place, here onto a slice.
    NSHapticFeedbackManager::defaultPerformer().performFeedbackPattern_performanceTime(
        NSHapticFeedbackPattern::Alignment,
        NSHapticFeedbackPerformanceTime::Now,
    );
}
