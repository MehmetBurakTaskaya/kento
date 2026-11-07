// SPDX-License-Identifier: MIT
//! The tools that work on time and sound, for video and audio alike: Cut out, Remove pauses, Add
//! music, Fade and volume, Remove noise, Join audio and Make a ringtone.

use std::path::{Path, PathBuf};

use super::{later, Job};
use crate::media::{Mix, Pauses, RingFormat, Span, Strength};
use crate::{Progress, Result, Tools};

impl Job<'_, '_> {
    pub(super) fn cut_out(&self, _input: &Path, _spans: &[Span]) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn remove_pauses(&self, _input: &Path, _pauses: Pauses) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn add_music(
        &self,
        _input: &Path,
        _music: &Path,
        _mix: Mix,
    ) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn fade(
        &self,
        _input: &Path,
        _fade_in: f64,
        _fade_out: f64,
        _picture: bool,
        _volume: f64,
    ) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn denoise(
        &self,
        _input: &Path,
        _strength: Strength,
        _rumble: bool,
    ) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn merge_audio(&self, _crossfade: f64) -> Result<Vec<PathBuf>> {
        Err(later())
    }

    pub(super) fn ringtone(
        &self,
        _input: &Path,
        _span: Span,
        _fade: bool,
        _format: RingFormat,
    ) -> Result<Vec<PathBuf>> {
        Err(later())
    }
}

/// See `media::pauses`.
pub(in crate::media) fn pauses(
    _tools: &Tools,
    _input: &Path,
    _pauses: Pauses,
    _progress: &Progress,
) -> Result<Vec<Span>> {
    Err(later())
}
