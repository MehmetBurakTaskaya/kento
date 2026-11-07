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
    Color {
        rgb: [u8; 3],
    },
    Blur,
    Pixelate,
    /// Filled in from the pixels around the area (FFmpeg's `delogo`): for a small mark of the
    /// user's own, such as a date stamp or their logo.
    Erase,
}

/// How Make vertical fills its 9:16 frame.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Fill {
    /// A 9:16 window of the picture, its middle at `center` (0 the left edge, 1 the right).
    Crop { center: f64 },
    /// The whole picture across the width, over a blurred, enlarged copy of itself.
    Blur,
    /// The whole picture across the width, over a plain colour.
    Color { rgb: [u8; 3] },
}

/// Where Remove pauses finds pauses: quieter than `threshold` dB for at least `min_length`
/// seconds. `keep` seconds of each pause stay on both sides, so speech does not run together.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pauses {
    pub threshold: f64,
    pub min_length: f64,
    pub keep: f64,
}

impl Default for Pauses {
    fn default() -> Self {
        Self {
            threshold: -40.0,
            min_length: 0.6,
            keep: 0.15,
        }
    }
}

/// How Add music mixes a piece of music with a video.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mix {
    /// The music's level in dB (0 keeps it).
    pub music: f64,
    /// The video's own sound's level in dB (0 keeps it); unused when `replace`.
    pub original: f64,
    /// The music replaces the video's own sound.
    pub replace: bool,
    /// The music steps back while the video's own sound is loud, such as someone speaking.
    pub duck: bool,
    /// Seconds into the music where it starts.
    pub offset: f64,
    /// The music plays again from `offset` when it ends before the video.
    pub repeat: bool,
    /// Seconds of the music's fade in at the start and fade out at the video's end.
    pub fade_in: f64,
    pub fade_out: f64,
}

/// A picture laid over a video by Add text or logo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LayerSource {
    /// A picture file of the user's (PNG, JPG, WEBP…).
    Image { path: PathBuf },
    /// A PNG the page drew (text), as base64.
    Picture { png: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub source: LayerSource,
    /// Where it lies and how large, in the pixels of the displayed video.
    pub area: Area,
    /// 0 to 1.
    pub opacity: f64,
    /// When it shows; the whole video when absent.
    pub span: Option<Span>,
}

/// How strongly Remove noise and Stabilize video work.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Strength {
    Light,
    Medium,
    Strong,
}

/// How Merge videos goes from one clip to the next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TransitionKind {
    /// Straight to the next clip.
    #[default]
    Cut,
    /// The clips blend into each other.
    Fade,
    /// Through black.
    FadeBlack,
    /// The next clip pushes the last one out to the left.
    Slide,
    /// The next clip is uncovered from right to left.
    Wipe,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub kind: TransitionKind,
    /// How long each transition lasts, 0.2 to 2 seconds; the clips overlap that long.
    pub seconds: f64,
}

impl Default for Transition {
    fn default() -> Self {
        Self {
            kind: TransitionKind::Cut,
            seconds: 0.5,
        }
    }
}

/// A quarter turn to the right or left, or a half turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Turn {
    None,
    Right,
    Half,
    Left,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoopMode {
    /// Backwards, sound too.
    Reverse,
    /// Forwards then backwards, `count` times, without sound.
    Boomerang,
    /// The clip `count` times in a row.
    Repeat,
}

/// A ready-made look for Adjust color.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Look {
    None,
    BlackWhite,
    Warm,
    Cool,
    Vivid,
    Faded,
    Vintage,
}

/// Adjust color's sliders, each -100 to 100 (0 leaves it).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Grade {
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub warmth: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RingFormat {
    /// AAC in an MPEG-4 file with the .m4r extension.
    M4r,
    Mp3,
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

/// The media tools of SPEC 5.5, with their choices. Their fields are camelCase in JSON, as the
/// page writes them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "tool",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
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
    /// The first input sets the size, frame rate and sound layout of the result; the clips meet
    /// with `transition`.
    MergeVideos {
        #[serde(default)]
        transition: Transition,
    },
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
    /// A 1080×1920 H.264/AAC MP4 for short-video apps, from `span` (the whole video when
    /// absent).
    MakeVertical {
        span: Option<Span>,
        fill: Fill,
    },
    /// Video or audio without these spans; the rest is joined.
    CutOut {
        spans: Vec<Span>,
    },
    /// Video or audio without its pauses (see `Pauses`).
    RemovePauses {
        pauses: Pauses,
    },
    /// A piece of music (`music`, any audio file) mixed into a video or replacing its sound.
    AddMusic {
        music: PathBuf,
        mix: Mix,
    },
    /// Text (drawn by the page) and pictures over a video, each in its area and time.
    AddOverlay {
        layers: Vec<Layer>,
    },
    /// Fades the sound (and with `picture`, a video's picture from and to black) in and out
    /// over these seconds, and changes the level by `volume` dB.
    Fade {
        fade_in: f64,
        fade_out: f64,
        picture: bool,
        volume: f64,
    },
    /// Less hiss and background noise in video or audio; `rumble` also takes away the lowest
    /// hum and rumble.
    Denoise {
        strength: Strength,
        rumble: bool,
    },
    /// Turned and mirrored (`mirror`: left to right, `flip`: upside down).
    RotateVideo {
        turn: Turn,
        mirror: bool,
        flip: bool,
    },
    /// Backwards, a boomerang, or repeated `count` times (1 to 10).
    LoopVideo {
        mode: LoopMode,
        count: u32,
    },
    /// A ready-made look and the sliders, applied in that order.
    ColorVideo {
        look: Look,
        grade: Grade,
    },
    /// Audio files one after another, overlapping by `crossfade` seconds (0 for none, at most
    /// 10). The first sets the format, rate and layout.
    MergeAudio {
        crossfade: f64,
    },
    /// The sound of `span` (at most 40 seconds) as a ringtone, faded in and out when `fade`.
    Ringtone {
        span: Span,
        fade: bool,
        format: RingFormat,
    },
    /// A steadier picture: two passes of vid.stab where the FFmpeg has it, FFmpeg's own
    /// `deshake` otherwise.
    Stabilize {
        strength: Strength,
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
            Tool::MergeVideos { .. } => "merge-video",
            Tool::Frames { .. } => "frames",
            Tool::SplitVideo { .. } => "split-video",
            Tool::RedactVideo { .. } => "redact-video",
            Tool::Normalize { .. } => "normalize",
            Tool::TrimAudio { .. } => "trim-audio",
            Tool::Channels { .. } => "channels",
            Tool::RedactAudio { .. } => "redact-audio",
            Tool::AudioToVideo { .. } => "audio-to-video",
            Tool::BurnSubtitles { .. } => "burn-subtitles",
            Tool::MakeVertical { .. } => "make-vertical",
            Tool::CutOut { .. } => "cut-out",
            Tool::RemovePauses { .. } => "remove-pauses",
            Tool::AddMusic { .. } => "add-music",
            Tool::AddOverlay { .. } => "add-overlay",
            Tool::Fade { .. } => "fade",
            Tool::Denoise { .. } => "denoise",
            Tool::RotateVideo { .. } => "rotate-video",
            Tool::LoopVideo { .. } => "loop-video",
            Tool::ColorVideo { .. } => "color-video",
            Tool::MergeAudio { .. } => "merge-audio",
            Tool::Ringtone { .. } => "ringtone",
            Tool::Stabilize { .. } => "stabilize",
        }
    }

    pub fn output(&self) -> Output {
        match self {
            Tool::Frames { .. } | Tool::SplitVideo { .. } => Output::Folder,
            _ => Output::File,
        }
    }

    /// The extension of the result for an input of format `from` (a catalog id): most tools keep
    /// the input's own format; Audio to video and Make vertical make an MP4; Extract frames fills
    /// its folder with PNG files; Split video's parts keep the input's format; a ringtone is an
    /// M4R or an MP3.
    pub fn extension(&self, from: &str) -> String {
        match self {
            Tool::AudioToVideo { .. } | Tool::MakeVertical { .. } => "mp4".to_owned(),
            Tool::Frames { .. } => "png".to_owned(),
            Tool::Ringtone { format, .. } => match format {
                RingFormat::M4r => "m4r",
                RingFormat::Mp3 => "mp3",
            }
            .to_owned(),
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

/// The pauses Remove pauses would take out of `input`, in order, as the spans it cuts (each
/// pause less `keep` at both ends). The editor shows them before anything is written.
pub fn pauses(
    tools: &Tools,
    input: &Path,
    pauses: Pauses,
    progress: &Progress,
) -> Result<Vec<Span>> {
    tools::sound::pauses(tools, input, pauses, progress)
}

#[cfg(test)]
mod json {
    use super::*;

    /// The page writes every field in camelCase (src/ipc.ts).
    #[test]
    fn reads_tools_as_the_page_writes_them() {
        let tool: Tool = serde_json::from_str(
            r#"{"tool":"trim-audio","span":{"start":0,"end":1},"removeSilence":true}"#,
        )
        .unwrap();
        assert_eq!(
            tool,
            Tool::TrimAudio {
                span: Span {
                    start: 0.0,
                    end: 1.0
                },
                remove_silence: true
            }
        );
    }
}
