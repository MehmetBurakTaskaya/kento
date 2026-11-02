// SPDX-License-Identifier: MIT
//! Other systems: nothing is available.

use std::path::{Path, PathBuf};

use super::{DragEvent, PlatformError, Result};

pub struct Watcher;

pub fn watch_drags(_on_event: Box<dyn Fn(DragEvent) + Send + 'static>) -> Result<Watcher> {
    Err(PlatformError::Unsupported)
}

pub fn file_manager_selection() -> Result<Vec<PathBuf>> {
    Err(PlatformError::Unsupported)
}

pub fn share(_paths: &[PathBuf], _window: isize) -> Result<()> {
    Err(PlatformError::Unsupported)
}

pub fn open_terminal(_dir: &Path) -> Result<()> {
    Err(PlatformError::Unsupported)
}

pub fn set_send_to(_enabled: bool, _exe: &Path, _name: &str) -> Result<()> {
    Err(PlatformError::Unsupported)
}

pub fn set_context_menu(_enabled: bool, _exe: &Path, _label: &str) -> Result<()> {
    Err(PlatformError::Unsupported)
}

pub fn haptic_tick() {}

pub fn dragged_link() -> Option<String> {
    None
}
