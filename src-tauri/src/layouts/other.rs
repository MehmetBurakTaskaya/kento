// SPDX-License-Identifier: MIT
//! Other systems: no window is ever placed.

use super::{Layout, LayoutError, Permission};

pub type Target = ();
#[derive(Debug, Clone, Copy)]
pub struct Screens;

pub fn screens() -> Screens {
    Screens
}

pub fn permission() -> Permission {
    Permission::NotNeeded
}

pub fn ask_permission() {}

pub fn open_permission_settings() -> Result<(), LayoutError> {
    Err(LayoutError::Failed("not available on this system".into()))
}

pub fn front() -> Option<(Target, String)> {
    None
}

pub fn place(
    _target: Target,
    _layout: Layout,
    _screens: &Screens,
    _activate: bool,
) -> Result<(), LayoutError> {
    Err(LayoutError::NoWindow)
}
