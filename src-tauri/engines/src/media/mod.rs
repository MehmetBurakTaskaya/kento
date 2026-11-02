// SPDX-License-Identifier: MIT
//! Video and audio (SPEC 5.4, 5.5, 5.6) through FFmpeg and ffprobe, which run as processes of
//! their own with arguments as arrays, never a shell string (SPEC 4.2). Progress comes from
//! FFmpeg's `-progress pipe:1`; cancelling kills the process.

mod codec;
pub(crate) mod compress;
mod convert;
mod preview;
pub(crate) mod probe;
pub(crate) mod run;
mod tools;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Conversion, Output, Progress, Result, Tools};

pub fn supports(from: &str, to: &str) -> bool {
    convert::supports(from, to)
}

pub fn output(_from: &str, _to: &str) -> Output {
    Output::File
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    convert::convert(job)
}

/// What ffprobe says about a file.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    /// Seconds; 0 when unknown (a still image or a broken file).
    pub duration: f64,
    pub video: Option<VideoInfo>,
    pub audio: Option<AudioInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    /// As displayed, after any rotation in the file.
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
    /// FFmpeg's name for it (`yuv420p`, `yuv420p10le`, …): the WebView plays 8-bit 4:2:0 H.264
    /// only.
    pub pixel_format: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub channels: u32,
    pub sample_rate: u32,
    pub codec: String,
}

/// Reads the file's streams with ffprobe. A file with neither sound nor picture is
/// `Error::Unreadable`; a still image has a duration of 0.
pub fn probe(tools: &Tools, input: &Path) -> Result<MediaInfo> {
    probe::probe(tools.ffprobe()?, input).map(|probe| probe.info)
}

/// Whether the WebView can play the file as it is; otherwise the editors use a proxy. `format`
/// is the catalog id of the file.
pub fn playable(info: &MediaInfo, format: &str) -> bool {
    preview::playable(info, format)
}

/// A temporary low-resolution H.264/AAC MP4 for previews (SPEC 5.6). Exports always use the
/// original.
pub fn proxy(tools: &Tools, input: &Path, dest: &Path, progress: &Progress) -> Result<()> {
    preview::proxy(tools, input, dest, progress)
}

/// Peak levels for a waveform, `buckets` values from 0 to 1 across the whole file, relative to
/// its loudest moment (a file without sound gives zeros).
pub fn peaks(tools: &Tools, input: &Path, buckets: usize, progress: &Progress) -> Result<Vec<f32>> {
    preview::peaks(tools, input, buckets, progress)
}

/// A still picture (an HEIC photo, say) as PNG bytes at full size, upright. The image engine uses
/// it where the system cannot read the format.
pub fn still(tools: &Tools, input: &Path) -> Result<Vec<u8>> {
    preview::still(tools, input)
}

/// One frame at `at` seconds as PNG bytes, no larger than `max_px` on its longer side (0 keeps
/// the full size). Past the end it gives one of the last frames.
pub fn frame(tools: &Tools, input: &Path, at: f64, max_px: u32) -> Result<Vec<u8>> {
    preview::frame(tools, input, at, max_px)
}

/// Seconds from the start.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start: f64,
    pub end: f64,
}

/// An area of the frame in the pixels of the displayed (rotated) video.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Hide {
    Color { rgb: [u8; 3] },
    Blur,
    Pixelate,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Redaction {
    pub area: Area,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SplitAt {
    /// At these seconds.
    Markers { at: Vec<f64> },
    /// Into this many equal parts.
    Parts { count: u32 },
    /// Every this many seconds.
    Every { seconds: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Channels {
    Mono,
    Stereo,
    /// Left and right levels from 0 to 2 (1 keeps the level).
    Levels {
        left: f32,
        right: f32,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Visual {
    Waveform,
    Spectrum,
    Bars,
    Image { path: PathBuf },
}

/// EBU R128 targets for two-pass loudness normalisation.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    /// Integrated loudness, LUFS (default -16).
    pub target: f64,
    /// Loudness range, LU (default 11).
    pub range: f64,
    /// True peak, dBTP (default -1.5).
    pub peak: f64,
}

impl Default for Loudness {
    fn default() -> Self {
        Self {
            target: -16.0,
            range: 11.0,
            peak: -1.5,
        }
    }
}

/// Where burned-in subtitles sit on the picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Position {
    Bottom,
    Top,
}

/// The 13 media tools of SPEC 5.5, with their choices, and Burn in subtitles [+].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tool", rename_all = "kebab-case")]
pub enum Tool {
    /// Remove audio: a silent copy, the video stream untouched.
    Mute,
    TrimVideo {
        span: Span,
    },
    CropVideo {
        area: Area,
    },
    /// 0.25 to 4; the audio follows with its pitch kept.
    Speed {
        factor: f64,
    },
    /// The first input sets the size, frame rate and sound layout of the result.
    MergeVideos,
    /// PNG frames at these seconds, in a folder.
    Frames {
        at: Vec<f64>,
    },
    /// Parts in a folder; `keep` (one flag per part, all when absent) drops the unwanted ones.
    SplitVideo {
        at: SplitAt,
        keep: Option<Vec<bool>>,
    },
    RedactVideo {
        areas: Vec<Redaction>,
        hide: Hide,
    },
    Normalize {
        loudness: Loudness,
    },
    TrimAudio {
        span: Span,
        remove_silence: bool,
    },
    Channels {
        channels: Channels,
    },
    /// The ranges become a beep, or silence.
    RedactAudio {
        spans: Vec<Span>,
        beep: bool,
    },
    AudioToVideo {
        visual: Visual,
    },
    /// The second input, an SRT or VTT file, drawn into the picture of the first. `size` is a
    /// percentage of the usual subtitle size (a line about 5.5 % of the picture's height),
    /// from 50 to 250.
    BurnSubtitles {
        size: f64,
        position: Position,
    },
}

impl Tool {
    /// The catalog id of the tool.
    pub fn id(&self) -> &'static str {
        match self {
            Tool::Mute => "mute",
            Tool::TrimVideo { .. } => "trim-video",
            Tool::CropVideo { .. } => "crop-video",
            Tool::Speed { .. } => "speed",
            Tool::MergeVideos => "merge-video",
            Tool::Frames { .. } => "frames",
            Tool::SplitVideo { .. } => "split-video",
            Tool::RedactVideo { .. } => "redact-video",
            Tool::Normalize { .. } => "normalize",
            Tool::TrimAudio { .. } => "trim-audio",
            Tool::Channels { .. } => "channels",
            Tool::RedactAudio { .. } => "redact-audio",
            Tool::AudioToVideo { .. } => "audio-to-video",
            Tool::BurnSubtitles { .. } => "burn-subtitles",
        }
    }

    pub fn output(&self) -> Output {
        match self {
            Tool::Frames { .. } | Tool::SplitVideo { .. } => Output::Folder,
            _ => Output::File,
        }
    }

    /// The extension of the result for an input of format `from` (a catalog id): most tools keep
    /// the input's own format; Audio to video makes an MP4; Extract frames fills its folder with
    /// PNG files; Split video's parts keep the input's format.
    pub fn extension(&self, from: &str) -> String {
        match self {
            Tool::AudioToVideo { .. } => "mp4".to_owned(),
            Tool::Frames { .. } => "png".to_owned(),
            _ => from.trim_start_matches('.').to_ascii_lowercase(),
        }
    }
}

/// One run of a media tool.
pub struct ToolRun<'a> {
    /// One file, several for Merge videos (in order), or the video and then its subtitles for
    /// Burn in subtitles.
    pub inputs: &'a [PathBuf],
    pub tool: &'a Tool,
    /// The file to create, or an empty folder for `Tool::output() == Output::Folder`.
    pub dest: &'a Path,
    pub temp: &'a Path,
    pub tools: &'a Tools,
    pub progress: &'a Progress<'a>,
}

/// Runs a media tool and returns the files it wrote: `run.dest`, or the files inside it for the
/// folder tools. Scratch files go to `run.temp` only.
pub fn run_tool(run: &ToolRun) -> Result<Vec<PathBuf>> {
    tools::run(run)
}
