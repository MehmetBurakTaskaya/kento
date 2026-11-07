// SPDX-License-Identifier: MIT
//! The tools that change a video's picture: Make vertical, Add text or logo, Rotate video,
//! Reverse and loop, Adjust color and Stabilize video.

use std::path::{Path, PathBuf};

use super::{later, Job};
use crate::media::{Fill, Grade, Layer, Look, LoopMode, Span, Strength, Turn};
use crate::Result;

impl Job<'_, '_> {
    pub(super) fn make_vertical(
        &self,
        _input: &Path,
        _span: Option<Span>,
        _fill: Fill,
    ) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn add_overlay(&self, _input: &Path, _layers: &[Layer]) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn rotate(
        &self,
        _input: &Path,
        _turn: Turn,
        _mirror: bool,
        _flip: bool,
    ) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn loop_video(
        &self,
        _input: &Path,
        _mode: LoopMode,
        _count: u32,
    ) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn color(&self, _input: &Path, _look: Look, _grade: Grade) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn stabilize(&self, _input: &Path, _strength: Strength) -> Result<Vec<PathBuf>> {
        Err(later())
    }
}
