// SPDX-License-Identifier: MIT
//! What ffprobe says about a file: its streams as the engine needs them, and the summary the
//! pages get (`MediaInfo`).

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;
use serde_json::Value;

use super::run::{command, media_path, spawn_error};
use super::{AudioInfo, MediaInfo, VideoInfo};
use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    Video,
    Audio,
    Subtitle,
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct Stream {
    /// The stream's index in the file (`-map 0:<index>`).
    pub index: usize,
    pub kind: Kind,
    pub codec: String,
    /// Cover art stored as a one-frame video stream.
    pub cover: bool,
    /// As displayed, after any rotation.
    pub width: u32,
    pub height: u32,
    /// The average frame rate as FFmpeg writes it (`30000/1001`), when known.
    pub rate: Option<String>,
    pub fps: f64,
    pub pixel_format: String,
    pub channels: u32,
    pub layout: String,
    pub sample_rate: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct Probe {
    pub info: MediaInfo,
    /// ffprobe's format name (`mov,mp4,m4a,3gp,3g2,mj2`).
    pub format: String,
    pub streams: Vec<Stream>,
}

impl Probe {
    /// The first video stream that is a picture sequence rather than cover art.
    pub fn video(&self) -> Option<&Stream> {
        self.streams
            .iter()
            .find(|stream| stream.kind == Kind::Video && !stream.cover)
    }

    pub fn audio(&self) -> Option<&Stream> {
        self.audios().next()
    }

    pub fn audios(&self) -> impl Iterator<Item = &Stream> {
        self.streams
            .iter()
            .filter(|stream| stream.kind == Kind::Audio)
    }

    pub fn subtitles(&self) -> impl Iterator<Item = &Stream> {
        self.streams
            .iter()
            .filter(|stream| stream.kind == Kind::Subtitle)
    }
}

pub(super) fn probe(ffprobe: &Path, input: &Path) -> Result<Probe> {
    // A missing file is an I/O error, not a damaged one.
    std::fs::metadata(input)?;
    let output = command(ffprobe)
        .args([
            "-v",
            "error",
            "-hide_banner",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-i",
        ])
        .arg(media_path(input))
        .output()
        .map_err(spawn_error)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let last: Vec<&str> = stderr.lines().filter(|line| !line.is_empty()).collect();
        let detail = last[last.len().saturating_sub(3)..].join(" | ");
        return Err(Error::Unreadable(if detail.is_empty() {
            "ffprobe could not read the file".to_owned()
        } else {
            detail
        }));
    }
    parse(&String::from_utf8_lossy(&output.stdout))
}

#[derive(Debug, Default, Deserialize)]
struct Report {
    #[serde(default)]
    streams: Vec<RawStream>,
    #[serde(default)]
    format: RawFormat,
}

#[derive(Debug, Default, Deserialize)]
struct RawFormat {
    format_name: Option<String>,
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawStream {
    index: usize,
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    pix_fmt: Option<String>,
    sample_rate: Option<String>,
    channels: Option<u32>,
    channel_layout: Option<String>,
    duration: Option<String>,
    #[serde(default)]
    tags: HashMap<String, Value>,
    #[serde(default)]
    side_data_list: Vec<Value>,
    #[serde(default)]
    disposition: HashMap<String, Value>,
}

pub(super) fn parse(json: &str) -> Result<Probe> {
    let report: Report = serde_json::from_str(json)
        .map_err(|error| Error::Unreadable(format!("ffprobe's report: {error}")))?;
    let mut longest = 0.0f64;
    let streams: Vec<Stream> = report
        .streams
        .iter()
        .map(|raw| {
            if let Some(seconds) = raw.duration.as_deref().and_then(seconds) {
                longest = longest.max(seconds);
            }
            stream(raw)
        })
        .collect();
    let duration = report
        .format
        .duration
        .as_deref()
        .and_then(seconds)
        .unwrap_or(longest);
    let probe = Probe {
        info: MediaInfo {
            duration,
            video: None,
            audio: None,
        },
        format: report.format.format_name.unwrap_or_default(),
        streams,
    };
    let video = probe.video().map(|v| VideoInfo {
        width: v.width,
        height: v.height,
        // A still image has no frame rate worth showing.
        fps: if duration > 0.0 { v.fps } else { 0.0 },
        codec: v.codec.clone(),
        pixel_format: v.pixel_format.clone(),
    });
    let audio = probe.audio().map(|a| AudioInfo {
        channels: a.channels,
        sample_rate: a.sample_rate,
        codec: a.codec.clone(),
    });
    if video.is_none() && audio.is_none() {
        return Err(Error::Unreadable("no sound or picture in the file".into()));
    }
    Ok(Probe {
        info: MediaInfo {
            duration,
            video,
            audio,
        },
        ..probe
    })
}

fn stream(raw: &RawStream) -> Stream {
    let kind = match raw.codec_type.as_deref() {
        Some("video") => Kind::Video,
        Some("audio") => Kind::Audio,
        Some("subtitle") => Kind::Subtitle,
        _ => Kind::Other,
    };
    let (mut width, mut height) = (raw.width.unwrap_or(0), raw.height.unwrap_or(0));
    if rotation(raw).rem_euclid(180) == 90 {
        std::mem::swap(&mut width, &mut height);
    }
    let rate = [&raw.avg_frame_rate, &raw.r_frame_rate]
        .into_iter()
        .flatten()
        .find(|rate| ratio(rate).is_some_and(|fps| fps > 0.0 && fps <= 1000.0))
        .cloned();
    let flag = |name: &str| {
        raw.disposition
            .get(name)
            .and_then(Value::as_i64)
            .is_some_and(|value| value != 0)
    };
    Stream {
        index: raw.index,
        kind,
        codec: raw.codec_name.clone().unwrap_or_default(),
        cover: flag("attached_pic") || flag("timed_thumbnails"),
        width,
        height,
        fps: rate.as_deref().and_then(ratio).unwrap_or(0.0),
        rate,
        pixel_format: raw.pix_fmt.clone().unwrap_or_default(),
        channels: raw.channels.unwrap_or(0),
        layout: raw.channel_layout.clone().unwrap_or_default(),
        sample_rate: raw
            .sample_rate
            .as_deref()
            .and_then(|rate| rate.parse().ok())
            .unwrap_or(0),
    }
}

/// The rotation in whole degrees: the display matrix of newer files, or the `rotate` tag that
/// older FFmpeg versions wrote.
fn rotation(raw: &RawStream) -> i64 {
    let matrix = raw
        .side_data_list
        .iter()
        .find_map(|data| data.get("rotation").and_then(Value::as_f64));
    let tag = || {
        raw.tags.get("rotate").and_then(|value| match value {
            Value::String(text) => text.trim().parse::<f64>().ok(),
            other => other.as_f64(),
        })
    };
    matrix
        .or_else(tag)
        .map_or(0, |degrees| degrees.round() as i64)
}

fn seconds(text: &str) -> Option<f64> {
    text.trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value >= 0.0)
}

/// `30000/1001` as a number; `0/0` and other nonsense give `None`.
fn ratio(text: &str) -> Option<f64> {
    let (num, den) = text.split_once('/').unwrap_or((text, "1"));
    let (num, den) = (
        num.trim().parse::<f64>().ok()?,
        den.trim().parse::<f64>().ok()?,
    );
    (den != 0.0)
        .then(|| num / den)
        .filter(|value| value.is_finite())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROTATED: &str = r#"{
        "streams": [
            {"index": 0, "codec_type": "video", "codec_name": "h264", "width": 1920,
             "height": 1080, "avg_frame_rate": "30000/1001", "r_frame_rate": "30000/1001",
             "pix_fmt": "yuv420p",
             "side_data_list": [{"side_data_type": "Display Matrix", "rotation": -90}],
             "disposition": {"attached_pic": 0}},
            {"index": 1, "codec_type": "audio", "codec_name": "aac", "sample_rate": "48000",
             "channels": 2, "channel_layout": "stereo"},
            {"index": 2, "codec_type": "data", "codec_name": "bin_data"}
        ],
        "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "12.500000"}
    }"#;

    #[test]
    fn reads_rotation_rate_and_streams() {
        let probe = parse(ROTATED).unwrap();
        let video = probe.info.video.as_ref().unwrap();
        assert_eq!((video.width, video.height), (1080, 1920));
        assert!((video.fps - 29.97).abs() < 0.01);
        assert_eq!(probe.info.duration, 12.5);
        let audio = probe.info.audio.as_ref().unwrap();
        assert_eq!((audio.channels, audio.sample_rate), (2, 48000));
        assert_eq!(probe.streams[2].kind, Kind::Other);
        assert_eq!(probe.video().unwrap().rate.as_deref(), Some("30000/1001"));
    }

    #[test]
    fn reads_the_old_rotate_tag() {
        let json = r#"{"streams": [{"index": 0, "codec_type": "video", "codec_name": "h264",
            "width": 640, "height": 480, "tags": {"rotate": "270"}}],
            "format": {"duration": "1.0"}}"#;
        let video = parse(json).unwrap().info.video.unwrap();
        assert_eq!((video.width, video.height), (480, 640));
    }

    #[test]
    fn cover_art_is_not_video() {
        let json = r#"{"streams": [
            {"index": 0, "codec_type": "audio", "codec_name": "mp3", "sample_rate": "44100",
             "channels": 2},
            {"index": 1, "codec_type": "video", "codec_name": "mjpeg", "width": 500,
             "height": 500, "disposition": {"attached_pic": 1}}],
            "format": {"duration": "3.0"}}"#;
        let probe = parse(json).unwrap();
        assert!(probe.info.video.is_none());
        assert!(probe.video().is_none());
    }

    #[test]
    fn a_still_image_has_no_duration() {
        let json = r#"{"streams": [{"index": 0, "codec_type": "video", "codec_name": "png",
            "width": 32, "height": 16, "avg_frame_rate": "0/0", "r_frame_rate": "25/1"}],
            "format": {"format_name": "png_pipe", "duration": "N/A"}}"#;
        let info = parse(json).unwrap().info;
        assert_eq!(info.duration, 0.0);
        assert_eq!(info.video.unwrap().fps, 0.0);
    }

    #[test]
    fn nothing_to_play_is_unreadable() {
        assert!(matches!(
            parse(r#"{"streams": [], "format": {}}"#),
            Err(Error::Unreadable(_))
        ));
        assert!(matches!(parse("not json"), Err(Error::Unreadable(_))));
    }
}
