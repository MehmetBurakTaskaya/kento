// SPDX-License-Identifier: MIT
//! Video and audio (SPEC 5.4, 5.5, 5.6) through FFmpeg and ffprobe, which run as processes of
//! their own with arguments as arrays, never a shell string (SPEC 4.2). Progress comes from
//! FFmpeg's `-progress pipe:1`; cancelling kills the process.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Codec, Conversion, Error, Output, Progress, Result, Tools};

pub fn supports(_from: &str, _to: &str) -> bool {
    false
}

pub fn output(_from: &str, _to: &str) -> Output {
    Output::File
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    Err(Error::Unsupported {
        from: job.from.to_owned(),
        to: job.to.to_owned(),
    })
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
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub channels: u32,
    pub sample_rate: u32,
    pub codec: String,
}

pub fn probe(tools: &Tools, _input: &Path) -> Result<MediaInfo> {
    tools.ffprobe()?;
    Err(Error::Other("not implemented".into()))
}

/// Whether the WebView can play the file as it is; otherwise the editors use a proxy.
pub fn playable(_info: &MediaInfo, _format: &str) -> bool {
    false
}

/// A temporary low-resolution H.264/AAC MP4 for previews (SPEC 5.6). Exports always use the
/// original.
pub fn proxy(tools: &Tools, _input: &Path, _dest: &Path, _progress: &Progress) -> Result<()> {
    tools.ffmpeg()?;
    Err(Error::Other("not implemented".into()))
}

/// Peak levels for a waveform, `buckets` values from 0 to 1 across the whole file.
pub fn peaks(
    tools: &Tools,
    _input: &Path,
    _buckets: usize,
    _progress: &Progress,
) -> Result<Vec<f32>> {
    tools.ffmpeg()?;
    Err(Error::Other("not implemented".into()))
}

/// One frame at `at` seconds as PNG bytes, no larger than `max_px` on its longer side.
pub fn frame(tools: &Tools, _input: &Path, _at: f64, _max_px: u32) -> Result<Vec<u8>> {
    tools.ffmpeg()?;
    Err(Error::Other("not implemented".into()))
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

/// The 13 media tools of SPEC 5.5, with their choices.
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
        }
    }

    pub fn output(&self) -> Output {
        match self {
            Tool::Frames { .. } | Tool::SplitVideo { .. } => Output::Folder,
            _ => Output::File,
        }
    }

    /// The extension of the result for an input of format `from` (a catalog id): most tools keep
    /// the input's own format; Audio to video makes an MP4.
    pub fn extension(&self, _from: &str) -> String {
        String::new()
    }
}

/// One run of a media tool.
pub struct ToolRun<'a> {
    /// One file, or several for Merge videos (in order).
    pub inputs: &'a [PathBuf],
    pub tool: &'a Tool,
    /// The file to create, or an empty folder for `Tool::output() == Output::Folder`.
    pub dest: &'a Path,
    pub temp: &'a Path,
    pub tools: &'a Tools,
    pub progress: &'a Progress<'a>,
}

pub fn run_tool(run: &ToolRun) -> Result<Vec<PathBuf>> {
    run.tools.ffmpeg()?;
    Err(Error::MissingCodec(Codec::Ffmpeg))
}
