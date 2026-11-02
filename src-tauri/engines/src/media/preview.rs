// SPDX-License-Identifier: MIT
//! What the media editors need to show a file (SPEC 5.6): whether the WebView plays it, a proxy
//! when it does not, waveform peaks and single frames.

use std::path::Path;

use super::probe;
use super::run::{self, secs, Cmd, Watch};
use super::MediaInfo;
use crate::{Error, Progress, Result, Tools};

/// Whether WebView2 (Chromium) and WebKit both play the file directly: H.264 (8-bit 4:2:0), VP8,
/// VP9 or AV1 with AAC, MP3, Opus or Vorbis in MP4, MOV or WebM, and MP3, WAV (PCM), AAC, FLAC,
/// Ogg (Vorbis, Opus) or Opus audio.
pub(super) fn playable(info: &MediaInfo, format: &str) -> bool {
    let audio_in = |codecs: &[&str]| {
        info.audio
            .as_ref()
            .is_none_or(|audio| codecs.contains(&audio.codec.as_str()))
    };
    match &info.video {
        Some(video) => {
            let codec = video.codec.as_str();
            let h264 =
                codec == "h264" && matches!(video.pixel_format.as_str(), "yuv420p" | "yuvj420p");
            match format {
                "mp4" | "mov" => {
                    (h264 || matches!(codec, "vp9" | "av1")) && audio_in(&["aac", "mp3", "opus"])
                }
                "webm" => matches!(codec, "vp8" | "vp9" | "av1") && audio_in(&["opus", "vorbis"]),
                _ => false,
            }
        }
        None => {
            let Some(audio) = &info.audio else {
                return false;
            };
            let codec = audio.codec.as_str();
            match format {
                "mp3" => codec == "mp3",
                "wav" => matches!(
                    codec,
                    "pcm_u8" | "pcm_s16le" | "pcm_s24le" | "pcm_s32le" | "pcm_f32le"
                ),
                "m4a" | "mp4" | "mov" => matches!(codec, "aac" | "mp3"),
                "flac" => codec == "flac",
                "ogg" => matches!(codec, "vorbis" | "opus"),
                "opus" => codec == "opus",
                "webm" => matches!(codec, "vorbis" | "opus"),
                _ => false,
            }
        }
    }
}

/// A low-resolution H.264/AAC MP4: at most 480 lines, `veryfast`, CRF 28, stereo AAC 128 kb/s.
/// A file without video gets an AAC-only MP4.
pub(super) fn proxy(tools: &Tools, input: &Path, dest: &Path, progress: &Progress) -> Result<()> {
    let ffmpeg = tools.ffmpeg()?;
    let probe = probe::probe(tools.ffprobe()?, input)?;
    let mut cmd = Cmd::new();
    cmd.input(input);
    if let Some(video) = probe.video() {
        cmd.map(video.index)
            .arg("-filter:v:0")
            .arg("scale=w=-2:h='min(480,trunc(ih/2)*2)'")
            .args([
                "-c:v:0",
                "libx264",
                "-preset:v:0",
                "veryfast",
                "-crf:v:0",
                "28",
                "-pix_fmt:v:0",
                "yuv420p",
            ]);
    }
    if let Some(audio) = probe.audio() {
        cmd.map(audio.index)
            .args(["-c:a:0", "aac", "-b:a:0", "128k", "-ac:a:0", "2"]);
    }
    cmd.args(["-movflags", "+faststart"]).output("mp4", dest);
    run::run(ffmpeg, &cmd, Watch::new(progress, probe.info.duration))?;
    Ok(())
}

/// Samples per second the waveform is read at: plenty for a picture, and quick to decode.
const PEAK_RATE: f64 = 8000.0;
/// Samples per block: 10 ms. Blocks are reduced to buckets once the length is known.
const BLOCK: usize = 80;

pub(super) fn peaks(
    tools: &Tools,
    input: &Path,
    buckets: usize,
    progress: &Progress,
) -> Result<Vec<f32>> {
    let ffmpeg = tools.ffmpeg()?;
    let probe = probe::probe(tools.ffprobe()?, input)?;
    if buckets == 0 {
        return Ok(Vec::new());
    }
    let Some(audio) = probe.audio() else {
        return Ok(vec![0.0; buckets]);
    };
    let mut cmd = Cmd::new();
    cmd.input(input)
        .map(audio.index)
        .args(["-ac", "1", "-ar", "8000", "-c:a", "pcm_f32le"])
        .piped("f32le");
    let expected = probe.info.duration * PEAK_RATE * 4.0;
    let mut blocks = Vec::new();
    let mut peak = 0.0f32;
    let mut count = 0;
    let mut carry: Vec<u8> = Vec::with_capacity(4);
    let mut received = 0.0;
    run::pipe(ffmpeg, &cmd, progress, |chunk| {
        received += chunk.len() as f64;
        let mut bytes = chunk;
        if !carry.is_empty() {
            let need = 4 - carry.len();
            let (head, rest) = bytes.split_at(need.min(bytes.len()));
            carry.extend_from_slice(head);
            bytes = rest;
            if carry.len() < 4 {
                return Ok(());
            }
            let sample = f32::from_le_bytes([carry[0], carry[1], carry[2], carry[3]]);
            carry.clear();
            take(sample, &mut peak, &mut count, &mut blocks);
        }
        // A chunk may end inside a sample; its first bytes wait in `carry`.
        let (samples, rest) = bytes.as_chunks::<4>();
        for sample in samples {
            take(
                f32::from_le_bytes(*sample),
                &mut peak,
                &mut count,
                &mut blocks,
            );
        }
        carry.extend_from_slice(rest);
        if expected > 0.0 {
            progress.report((received / expected) as f32);
        }
        Ok(())
    })?;
    if count > 0 {
        blocks.push(peak);
    }
    progress.report(1.0);
    Ok(reduce(&blocks, buckets))
}

fn take(sample: f32, peak: &mut f32, count: &mut usize, blocks: &mut Vec<f32>) {
    *peak = peak.max(sample.abs());
    *count += 1;
    if *count == BLOCK {
        blocks.push(*peak);
        *peak = 0.0;
        *count = 0;
    }
}

/// The loudest block in each bucket, scaled so that the loudest moment of the file is 1.
fn reduce(blocks: &[f32], buckets: usize) -> Vec<f32> {
    let n = blocks.len();
    if n == 0 {
        return vec![0.0; buckets];
    }
    let mut out: Vec<f32> = (0..buckets)
        .map(|i| {
            let start = (i * n / buckets).min(n - 1);
            let end = ((i + 1) * n / buckets).clamp(start + 1, n);
            blocks[start..end].iter().copied().fold(0.0, f32::max)
        })
        .collect();
    let loudest = out.iter().copied().fold(0.0, f32::max);
    if loudest > 0.0 {
        for value in &mut out {
            *value = (*value / loudest).clamp(0.0, 1.0);
        }
    }
    out
}

pub(super) fn frame(tools: &Tools, input: &Path, at: f64, max_px: u32) -> Result<Vec<u8>> {
    let ffmpeg = tools.ffmpeg()?;
    std::fs::metadata(input)?;
    grab(ffmpeg, input, at, (max_px > 0).then_some(max_px))
}

/// One frame as PNG bytes. `-ss` before the input is frame-accurate here: FFmpeg decodes from
/// the keyframe before and drops what comes before `at`.
pub(super) fn grab(ffmpeg: &Path, input: &Path, at: f64, max_px: Option<u32>) -> Result<Vec<u8>> {
    if !at.is_finite() {
        return Err(Error::Other("not a time in the video".into()));
    }
    let png = grab_once(ffmpeg, input, &["-ss", &secs(at)], max_px)?;
    if !png.is_empty() {
        return Ok(png);
    }
    // Past the last frame nothing comes out: take one from the last quarter second instead.
    let png = grab_once(ffmpeg, input, &["-sseof", "-0.25"], max_px)?;
    if png.is_empty() {
        return Err(Error::Unreadable("the video has no picture to show".into()));
    }
    Ok(png)
}

fn grab_once(ffmpeg: &Path, input: &Path, seek: &[&str], max_px: Option<u32>) -> Result<Vec<u8>> {
    let mut cmd = Cmd::new();
    // 0:V is video that is not cover art.
    cmd.args(seek)
        .input(input)
        .args(["-map", "0:V:0", "-frames:v", "1"]);
    if let Some(max) = max_px {
        cmd.arg("-filter:v:0").arg(format!(
            "scale=w='min(iw,{max})':h='min(ih,{max})':force_original_aspect_ratio=decrease"
        ));
    }
    cmd.args(["-c:v", "png"]).piped("image2pipe");
    let mut png = Vec::new();
    run::pipe(ffmpeg, &cmd, &Progress::none(), |chunk| {
        png.extend_from_slice(chunk);
        Ok(())
    })?;
    Ok(png)
}

#[cfg(test)]
mod tests {
    use super::super::{AudioInfo, VideoInfo};
    use super::*;

    fn video(codec: &str, pixel_format: &str, audio: Option<&str>) -> MediaInfo {
        MediaInfo {
            duration: 1.0,
            video: Some(VideoInfo {
                width: 16,
                height: 16,
                fps: 25.0,
                codec: codec.into(),
                pixel_format: pixel_format.into(),
            }),
            audio: audio.map(|codec| AudioInfo {
                channels: 2,
                sample_rate: 48000,
                codec: codec.into(),
            }),
        }
    }

    fn sound(codec: &str) -> MediaInfo {
        MediaInfo {
            duration: 1.0,
            video: None,
            audio: Some(AudioInfo {
                channels: 2,
                sample_rate: 44100,
                codec: codec.into(),
            }),
        }
    }

    #[test]
    fn knows_what_the_webview_plays() {
        assert!(playable(&video("h264", "yuv420p", Some("aac")), "mp4"));
        assert!(playable(&video("h264", "yuv420p", None), "mov"));
        assert!(playable(&video("vp9", "yuv420p", Some("opus")), "webm"));
        assert!(!playable(&video("h264", "yuv420p10le", Some("aac")), "mp4"));
        assert!(!playable(&video("hevc", "yuv420p", Some("aac")), "mp4"));
        assert!(!playable(&video("h264", "yuv420p", Some("ac3")), "mp4"));
        assert!(!playable(&video("h264", "yuv420p", Some("aac")), "mkv"));
        assert!(!playable(&video("mpeg4", "yuv420p", Some("mp3")), "avi"));
        assert!(!playable(&video("wmv2", "yuv420p", Some("wmav2")), "wmv"));
        assert!(playable(&sound("mp3"), "mp3"));
        assert!(playable(&sound("pcm_s16le"), "wav"));
        assert!(playable(&sound("aac"), "m4a"));
        assert!(playable(&sound("flac"), "flac"));
        assert!(playable(&sound("vorbis"), "ogg"));
        assert!(playable(&sound("opus"), "opus"));
        assert!(!playable(&sound("alac"), "m4a"));
        assert!(!playable(&sound("pcm_s16be"), "aiff"));
        assert!(!playable(&sound("wmav2"), "wma"));
    }

    #[test]
    fn reduces_blocks_to_buckets() {
        assert_eq!(reduce(&[], 3), vec![0.0; 3]);
        assert_eq!(
            reduce(&[0.1, 0.2, 0.5, 0.25], 2),
            vec![0.4, 1.0],
            "the maxima, relative to the loudest"
        );
        // Fewer blocks than buckets repeat the nearest block.
        assert_eq!(reduce(&[0.5, 1.0], 4), vec![0.5, 0.5, 1.0, 1.0]);
        assert_eq!(reduce(&[0.0, 0.0], 2), vec![0.0, 0.0]);
    }
}
