// SPDX-License-Identifier: MIT
//! Compress for video and audio through FFmpeg, in the input's own container: a quality level, a
//! share of the original size, or a target size from the duration (two passes for video).
//!
//! Each container keeps the encoders `codec` gives it: H.264 and AAC in MP4, MOV and MKV, VP9 and
//! Opus in WEBM, MPEG-4 and MP3 in AVI, WMV 8 and WMA 2 in WMV; MP3, M4A (AAC), OGG (Vorbis), OPUS
//! and WMA files stay what they are.
//!
//! - Quality 1 to 100: x264 CRF 40 to 18, VP9 CRF 50 to 24, an MPEG-4 or WMV quantiser of 20 to 2,
//!   LAME VBR 9 to 0 and Vorbis quality 0 to 8; AAC, Opus and WMA get a bit rate that grows with
//!   the level. The picture keeps its size.
//! - A share of the original or a size: a bit rate from the duration, after what the container
//!   adds around the streams. Video gets two passes and about a tenth of the bits goes to the
//!   sound; a picture that would get too few bits per pixel steps down to 1080, 720, 480, 360 or
//!   240 lines first. A result over the target is encoded again at a lower rate, a few times at
//!   most.
//! - FLAC is written at its highest standard level, which loses nothing. WAV and AIFF hold plain
//!   samples and cannot shrink in their own format.
//!
//! A result that is not smaller than the original, or not under the target, is deleted and the
//! job ends with `Error::NotSmaller`.

use std::fs;
use std::path::{Path, PathBuf};

use super::codec::{AudioCodec, Container, Rate, Subtitle, VideoCodec};
use super::convert::EVEN;
use super::probe::{self, Probe, Stream};
use super::run::{self, Cmd, Watch};
use crate::compress::{CompressRun, Compression};
use crate::{Error, Result};

/// Encodes at most this many times to land under a target.
const ATTEMPTS: i32 = 4;
/// The share of a target the first encode aims at: rate control misses by a few percent.
const HEADROOM: f64 = 0.96;
/// The shorter sides a picture steps down to when its bits run short.
const LADDER: [u32; 5] = [1080, 720, 480, 360, 240];
/// The part of an attempt the first pass takes (x264 makes it quick).
const FIRST_PASS: f64 = 0.3;
/// LAME's constant rates in kb/s: MPEG-1 for 32 kHz and up, MPEG-2 below.
const MP3_RATES: [u32; 14] = [
    32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const MP3_LOW_RATES: [u32; 14] = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
/// libvorbis's nominal rates in kb/s for quality 0 to 10 (stereo, 44.1 kHz). Vorbis is driven by
/// quality even for a size, because FFmpeg's own Vorbis encoder ignores a bit rate.
const VORBIS: [f64; 11] = [
    64.0, 80.0, 96.0, 112.0, 128.0, 160.0, 192.0, 224.0, 256.0, 320.0, 500.0,
];

pub(crate) fn run(run: &CompressRun) -> Result<Vec<PathBuf>> {
    let unsupported = || Error::Unsupported {
        from: run.from.to_owned(),
        to: "compress".to_owned(),
    };
    let container = Container::from_id(run.from)
        .or_else(|| Container::from_path(run.input))
        .filter(|container| *container != Container::Gif)
        .ok_or_else(unsupported)?;
    // WAV and AIFF hold plain samples: anything smaller would be another format.
    if matches!(container.audio(), Some(AudioCodec::Pcm(_))) {
        return Err(unsupported());
    }
    let ffmpeg = run.options.tools.ffmpeg()?;
    let probe = probe::probe(run.options.tools.ffprobe()?, run.input)?;
    let original = fs::metadata(run.input)?.len();
    tracing::debug!(
        from = run.from,
        compression = ?run.compression,
        "compressing media"
    );
    let job = Job {
        ffmpeg,
        run,
        container,
        probe,
        original,
        log: run.temp.join("pass"),
    };
    match run.compression {
        Compression::Quality { level } => job.quality(level.clamp(1, 100)),
        Compression::Ratio { percent } => {
            job.target(original.saturating_mul(u64::from(percent.clamp(5, 95))) / 100)
        }
        Compression::Size { bytes } => job.target(bytes),
    }
}

struct Job<'a, 'b> {
    ffmpeg: &'a Path,
    run: &'a CompressRun<'b>,
    container: Container,
    probe: Probe,
    original: u64,
    /// Where the first pass leaves its statistics for the second.
    log: PathBuf,
}

/// One encode.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Plan {
    video: Rate,
    /// The shorter side of a picture that is scaled down.
    side: Option<u32>,
    /// For every sound stream.
    audio: Rate,
    /// Aims at a size: two passes for the picture, a constant rate for Opus.
    target: bool,
}

impl<'b> Job<'_, 'b> {
    /// The picture, which audio containers never hold (cover art is left out there).
    fn video(&self) -> Option<&Stream> {
        if self.container.audio_only() {
            None
        } else {
            self.probe.video()
        }
    }

    /// The sound streams of the result: the first one only in audio containers.
    fn audios(&self) -> impl Iterator<Item = &Stream> {
        let take = if self.container.audio_only() {
            1
        } else {
            usize::MAX
        };
        self.probe.audios().take(take)
    }

    fn video_codec(&self) -> Option<VideoCodec> {
        self.video().and(self.container.video())
    }

    fn audio_codec(&self) -> Option<AudioCodec> {
        self.audios().next().and(self.container.audio())
    }

    /// The channels the sound is encoded with (`AudioCodec::push` makes some encoders stereo).
    fn channels(&self) -> u32 {
        let channels = self
            .audios()
            .next()
            .map_or(2, |audio| audio.channels)
            .clamp(1, 8);
        match self.container.audio() {
            Some(AudioCodec::Mp3 | AudioCodec::Mp3Cbr | AudioCodec::Wmav2 | AudioCodec::Opus) => {
                channels.min(2)
            }
            _ => channels,
        }
    }

    fn sample_rate(&self) -> u32 {
        self.audios()
            .next()
            .map(|audio| audio.sample_rate)
            .filter(|&rate| rate > 0)
            .unwrap_or(44_100)
    }

    fn duration(&self) -> f64 {
        self.probe.info.duration
    }

    fn watch(&self) -> Watch<'b> {
        Watch::new(self.run.progress, self.duration())
    }

    fn quality(&self, level: u8) -> Result<Vec<PathBuf>> {
        let (channels, sample_rate) = (self.channels(), self.sample_rate());
        let plan = Plan {
            video: self
                .video_codec()
                .map_or(Rate::Default, |codec| video_quality(codec, level)),
            side: None,
            audio: self.audio_codec().map_or(Rate::Default, |codec| {
                audio_quality(codec, level, channels, sample_rate)
            }),
            target: false,
        };
        self.write(&plan, None, self.watch())?;
        self.keep_under(self.original.saturating_sub(1))
    }

    fn target(&self, wanted: u64) -> Result<Vec<PathBuf>> {
        let limit = wanted.min(self.original.saturating_sub(1));
        if self.audio_codec() == Some(AudioCodec::Flac) {
            // FLAC loses nothing at any level, so its highest level is all there is to try.
            let plan = Plan {
                video: Rate::Default,
                side: None,
                audio: Rate::Default,
                target: false,
            };
            self.write(&plan, None, self.watch())?;
            return self.keep_under(limit);
        }
        let duration = self.duration();
        if duration <= 0.0 {
            return Err(Error::Other(
                "the length of the file is unknown, so no bit rate fits a size".into(),
            ));
        }
        let bits = (limit as f64 * HEADROOM - self.overhead(duration)) * 8.0 / duration;
        let Some(mut plan) = self.plan(bits) else {
            return self.discard();
        };
        let watch = self.watch();
        let mut analysed = None;
        for attempt in 0..ATTEMPTS {
            // Each attempt gets most of what is left of the bar, so it never runs backwards.
            let (from, to) = (1.0 - 0.2f64.powi(attempt), 1.0 - 0.2f64.powi(attempt + 1));
            let mut write = watch.part(from, to, duration);
            let two_pass = self.two_pass(&plan);
            // The first pass's statistics hold for any rate, but not for another picture size.
            if two_pass && analysed != Some(plan.side) {
                let middle = from + (to - from) * FIRST_PASS;
                self.analyse(&plan, watch.part(from, middle, duration))?;
                analysed = Some(plan.side);
                write = watch.part(middle, to, duration);
            }
            self.write(&plan, two_pass.then_some(2), write)?;
            let size = fs::metadata(self.run.dest)?.len();
            if size <= limit {
                self.run.progress.report(1.0);
                return Ok(vec![self.run.dest.to_path_buf()]);
            }
            tracing::debug!(attempt, "over the target; encoding again at a lower rate");
            match self.lower(&plan, size - limit, limit as f64 / size as f64, duration) {
                Some(next) => plan = next,
                None => break,
            }
        }
        self.discard()
    }

    fn two_pass(&self, plan: &Plan) -> bool {
        plan.target && self.video().is_some()
    }

    /// The first plan for `bits` per second in all; `None` when they are too few for a result
    /// worth keeping.
    fn plan(&self, bits: f64) -> Option<Plan> {
        let (channels, sample_rate) = (self.channels(), self.sample_rate());
        let streams = self.audios().count() as f64;
        let Some(codec) = self.video_codec() else {
            let audio = audio_rate(
                self.audio_codec()?,
                bits / streams.max(1.0),
                channels,
                sample_rate,
            )?;
            return Some(Plan {
                video: Rate::Default,
                side: None,
                audio,
                target: true,
            });
        };
        let (audio, sound) = match self.audio_codec() {
            Some(audio_codec) => {
                let (low, high) = bounds(audio_codec, channels, sample_rate);
                let share = snap(audio_codec, (bits * 0.1).clamp(low, high), sample_rate);
                (Rate::Bitrate(share as u64), share * streams)
            }
            None => (Rate::Default, 0.0),
        };
        let video = bits - sound;
        let side = self.fit(codec, video)?;
        Some(Plan {
            video: Rate::Bitrate(video as u64),
            side,
            audio,
            target: true,
        })
    }

    /// The picture's size for `bits` per second of video: its own (`Some(None)`), the first step
    /// down that gives every pixel enough bits, or `None` when even the smallest does not.
    fn fit(&self, codec: VideoCodec, bits: f64) -> Option<Option<u32>> {
        let video = self.video()?;
        let short = video.width.min(video.height);
        let long = video.width.max(video.height);
        if short == 0 {
            return (bits > 0.0).then_some(None);
        }
        let fps = if video.fps > 0.0 {
            video.fps.min(120.0)
        } else {
            30.0
        };
        // Bits per pixel below which the picture turns to blocks.
        let floor = match codec {
            VideoCodec::H264 | VideoCodec::Hevc => 0.03,
            VideoCodec::Vp9 => 0.025,
            VideoCodec::Mpeg4 | VideoCodec::Wmv2 => 0.06,
        };
        let enough = |side: u32| {
            let pixels = f64::from(side) * f64::from(side) * f64::from(long) / f64::from(short);
            bits >= pixels * fps * floor
        };
        if enough(short) {
            return Some(None);
        }
        LADDER
            .into_iter()
            .filter(|&side| side < short)
            .find(|&side| enough(side))
            .map(Some)
    }

    /// The plan after one whose result was `over` bytes too large (`ratio` is the target over
    /// that size), or `None` when nothing lower is worth trying.
    fn lower(&self, plan: &Plan, over: u64, ratio: f64, duration: f64) -> Option<Plan> {
        if let (Rate::Bitrate(video), Some(codec)) = (plan.video, self.video_codec()) {
            let video = video as f64;
            // The excess and a little more, and a few percent for the rate control's own error.
            let next = video - over as f64 * 8.0 / duration * 1.1 - video * 0.03;
            if next <= 0.0 {
                return None;
            }
            let side = match (plan.side, self.fit(codec, next)?) {
                (Some(old), Some(new)) => Some(old.min(new)),
                (old, new) => old.or(new),
            };
            return Some(Plan {
                video: Rate::Bitrate(next as u64),
                side,
                ..*plan
            });
        }
        let codec = self.audio_codec()?;
        let (channels, sample_rate) = (self.channels(), self.sample_rate());
        let audio = match plan.audio {
            Rate::Bitrate(bits) => {
                let bits = bits as f64;
                let mut next = snap(codec, bits * ratio * 0.97, sample_rate);
                if next >= bits {
                    next = snap(codec, bits - 1000.0, sample_rate);
                }
                if next >= bits || next < bounds(codec, channels, sample_rate).0 {
                    return None;
                }
                Rate::Bitrate(next as u64)
            }
            Rate::Quality(quality) => {
                let bits = vorbis_bits(quality, channels) * ratio * 0.97;
                let next = vorbis_quality(bits, channels).min(quality - 0.5);
                if next < 0.0 {
                    return None;
                }
                Rate::Quality(next)
            }
            Rate::Default => return None,
        };
        Some(Plan { audio, ..*plan })
    }

    /// Bytes the container adds around the streams: headers, tags and each packet's framing.
    fn overhead(&self, duration: f64) -> f64 {
        let frames = self.video().map_or(0.0, |video| {
            if video.fps > 0.0 {
                video.fps.min(120.0)
            } else {
                30.0
            }
        });
        let packets = (frames + 50.0 * self.audios().count() as f64) * duration;
        let framing = match self.container {
            Container::Avi => 24.0,
            // ASF pads its packets to a fixed size.
            Container::Wmv | Container::Wma => 48.0,
            Container::Mp3 | Container::Flac => 0.0,
            _ => 12.0,
        };
        let headers = if self.container.audio_only() {
            1024.0
        } else {
            4096.0
        };
        headers + packets * framing
    }

    /// The first of two passes: the picture alone, into nothing but the statistics.
    fn analyse(&self, plan: &Plan, watch: Watch) -> Result<()> {
        let mut cmd = Cmd::new();
        cmd.input(self.run.input);
        self.picture(&mut cmd, plan, Some(1))?;
        cmd.args(["-f", "null", "-"]);
        run::run(self.ffmpeg, &cmd, watch)?;
        Ok(())
    }

    /// Writes `run.dest`: the picture, every sound stream and the subtitles the container holds.
    /// Tags and chapters follow by FFmpeg's default.
    fn write(&self, plan: &Plan, pass: Option<u8>, watch: Watch) -> Result<()> {
        let mut cmd = Cmd::new();
        cmd.input(self.run.input);
        let mut streams = 0;
        if self.video().is_some() {
            self.picture(&mut cmd, plan, pass)?;
            streams += 1;
        }
        if let Some(codec) = self.container.audio() {
            for (k, audio) in self.audios().enumerate() {
                cmd.map(audio.index);
                codec.push_at(&mut cmd, k, Some(audio), plan.audio);
                match codec {
                    // Level 8 is the highest within the subset that every player reads.
                    AudioCodec::Flac => {
                        cmd.arg(format!("-compression_level:a:{k}"))
                            .arg("8")
                            .arg(format!("-exact_rice_parameters:a:{k}"))
                            .arg("1");
                    }
                    // Opus's variable rate can overshoot a size by half on busy sound.
                    AudioCodec::Opus if plan.target => {
                        cmd.arg(format!("-vbr:a:{k}")).arg("off");
                    }
                    _ => {}
                }
                streams += 1;
            }
        }
        if streams == 0 {
            return Err(Error::Other(
                "the file has no sound or picture to compress".into(),
            ));
        }
        if !self.container.audio_only() {
            let mut k = 0;
            for subtitle in self.probe.subtitles() {
                let encoder = match self.container.subtitle(&subtitle.codec) {
                    Subtitle::Drop => continue,
                    Subtitle::Copy => "copy",
                    Subtitle::Encode(encoder) => encoder,
                };
                cmd.map(subtitle.index)
                    .arg(format!("-c:s:{k}"))
                    .arg(encoder);
                k += 1;
            }
        }
        self.container.muxer_args(&mut cmd);
        cmd.output(self.container.muxer(), self.run.dest);
        run::run(self.ffmpeg, &cmd, watch)?;
        Ok(())
    }

    /// Maps, scales and encodes the picture; `pass` is 1 or 2 of a two-pass encode.
    fn picture(&self, cmd: &mut Cmd, plan: &Plan, pass: Option<u8>) -> Result<()> {
        let (Some(video), Some(codec)) = (self.video(), self.container.video()) else {
            return Err(Error::Other("this format holds no video".into()));
        };
        cmd.map(video.index);
        let odd = video.width % 2 == 1 || video.height % 2 == 1;
        let filter = match plan.side {
            // -2 keeps the shape at an even size.
            Some(side) if video.width >= video.height => Some(format!("scale=-2:{side}")),
            Some(side) => Some(format!("scale={side}:-2")),
            None if codec.even() && odd => Some(EVEN.to_owned()),
            None => None,
        };
        if let Some(filter) = filter {
            cmd.arg("-filter:v:0").arg(filter);
        }
        codec.push_at(cmd, self.container, plan.video);
        // What FFmpeg picks for the container anyway, said out loud so that the first pass (into
        // the null muxer) sees the same frames as the second: AVI and ASF want a constant rate.
        let fps_mode = match self.container {
            Container::Avi | Container::Wmv => "cfr",
            _ => "vfr",
        };
        cmd.arg("-fps_mode:v:0").arg(fps_mode);
        if let Some(pass) = pass {
            cmd.arg("-pass:v:0")
                .arg(pass.to_string())
                .arg("-passlogfile:v:0")
                .arg(&self.log);
        }
        Ok(())
    }

    /// The result when it is at most `limit` bytes; otherwise it is deleted.
    fn keep_under(&self, limit: u64) -> Result<Vec<PathBuf>> {
        if fs::metadata(self.run.dest)?.len() <= limit {
            self.run.progress.report(1.0);
            Ok(vec![self.run.dest.to_path_buf()])
        } else {
            self.discard()
        }
    }

    fn discard(&self) -> Result<Vec<PathBuf>> {
        let _ = fs::remove_file(self.run.dest);
        Err(Error::NotSmaller)
    }
}

/// `low` at level 1 to `high` at level 100.
fn lerp(level: u8, low: f64, high: f64) -> f64 {
    low + (high - low) * f64::from(level.clamp(1, 100) - 1) / 99.0
}

fn video_quality(codec: VideoCodec, level: u8) -> Rate {
    let value = match codec {
        VideoCodec::H264 | VideoCodec::Hevc => (lerp(level, 40.0, 18.0) * 10.0).round() / 10.0,
        VideoCodec::Vp9 => lerp(level, 50.0, 24.0).round(),
        VideoCodec::Mpeg4 | VideoCodec::Wmv2 => lerp(level, 20.0, 2.0).round(),
    };
    Rate::Quality(value as f32)
}

fn audio_quality(codec: AudioCodec, level: u8, channels: u32, sample_rate: u32) -> Rate {
    let pairs = (f64::from(channels) / 2.0).max(0.5);
    let kbps = match codec {
        AudioCodec::Mp3 => {
            return Rate::Quality(((lerp(level, 9.0, 0.0) * 10.0).round() / 10.0) as f32)
        }
        AudioCodec::Vorbis => {
            return Rate::Quality(((lerp(level, 0.0, 8.0) * 10.0).round() / 10.0) as f32)
        }
        AudioCodec::Aac => lerp(level, 40.0, 256.0) * pairs,
        AudioCodec::Opus => lerp(level, 24.0, 160.0) * pairs,
        AudioCodec::Mp3Cbr => lerp(level, 64.0, 256.0),
        AudioCodec::Wmav2 => lerp(level, 32.0, 192.0) * pairs,
        AudioCodec::Flac | AudioCodec::Alac | AudioCodec::Pcm(_) => return Rate::Default,
    };
    let (low, high) = bounds(codec, channels, sample_rate);
    Rate::Bitrate(snap(codec, (kbps * 1000.0).clamp(low, high), sample_rate) as u64)
}

/// The rate for `bits` per second of sound alone; `None` below what the encoder can do.
fn audio_rate(codec: AudioCodec, bits: f64, channels: u32, sample_rate: u32) -> Option<Rate> {
    let (low, high) = bounds(codec, channels, sample_rate);
    let bits = bits.min(high);
    match codec {
        // A Vorbis quality's real rate depends on the sound (simple sound takes far less than
        // the nominal rate), so even the lowest quality is worth a try.
        AudioCodec::Vorbis => Some(Rate::Quality(vorbis_quality(bits, channels))),
        _ if bits < low => None,
        _ => Some(Rate::Bitrate(snap(codec, bits, sample_rate) as u64)),
    }
}

/// The bit rates (per second) an encoder works between for this sound.
fn bounds(codec: AudioCodec, channels: u32, sample_rate: u32) -> (f64, f64) {
    let channels = f64::from(channels.max(1));
    let pairs = (channels / 2.0).max(0.5);
    let (low, high) = match codec {
        // FFmpeg's AAC encoder spends about this much per channel however low it is asked to go.
        AudioCodec::Aac => (16.0 * channels, 160.0 * channels),
        AudioCodec::Opus => (8.0 * channels, 128.0 * channels),
        AudioCodec::Mp3 | AudioCodec::Mp3Cbr if sample_rate >= 32_000 => (32.0, 320.0),
        AudioCodec::Mp3 | AudioCodec::Mp3Cbr => (8.0, 160.0),
        // WMA 2 refuses less than about 24 kb/s for stereo at 44.1 kHz.
        AudioCodec::Wmav2 => (24.0, 256.0),
        AudioCodec::Vorbis => (VORBIS[0] * pairs, VORBIS[10] * pairs),
        AudioCodec::Flac | AudioCodec::Alac | AudioCodec::Pcm(_) => (0.0, f64::MAX / 1000.0),
    };
    (low * 1000.0, high * 1000.0)
}

/// A bit rate the encoder takes, at most `bits` where it can be: LAME's constant rates come from
/// a fixed list, the others are whole kb/s.
fn snap(codec: AudioCodec, bits: f64, sample_rate: u32) -> f64 {
    match codec {
        AudioCodec::Mp3 | AudioCodec::Mp3Cbr => {
            let rates = if sample_rate >= 32_000 {
                &MP3_RATES
            } else {
                &MP3_LOW_RATES
            };
            let kbps = rates
                .iter()
                .rev()
                .find(|&&kbps| f64::from(kbps) * 1000.0 <= bits)
                .unwrap_or(&rates[0]);
            f64::from(*kbps) * 1000.0
        }
        _ => (bits / 1000.0).floor() * 1000.0,
    }
}

/// The Vorbis quality whose nominal rate is about `bits` per second.
fn vorbis_quality(bits: f64, channels: u32) -> f32 {
    let pairs = (f64::from(channels) / 2.0).max(0.5);
    let kbps = bits / 1000.0 / pairs;
    let quality = match VORBIS.iter().position(|&rate| rate > kbps) {
        Some(0) => 0.0,
        Some(i) => (i - 1) as f64 + (kbps - VORBIS[i - 1]) / (VORBIS[i] - VORBIS[i - 1]),
        None => 10.0,
    };
    ((quality * 10.0).floor() / 10.0) as f32
}

/// The nominal bit rate of a Vorbis quality.
fn vorbis_bits(quality: f32, channels: u32) -> f64 {
    let pairs = (f64::from(channels) / 2.0).max(0.5);
    let quality = f64::from(quality).clamp(0.0, 10.0);
    let i = (quality.floor() as usize).min(9);
    let kbps = VORBIS[i] + (VORBIS[i + 1] - VORBIS[i]) * (quality - i as f64);
    kbps * 1000.0 * pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_levels_map_onto_each_scale() {
        assert_eq!(video_quality(VideoCodec::H264, 1), Rate::Quality(40.0));
        assert_eq!(video_quality(VideoCodec::H264, 100), Rate::Quality(18.0));
        assert_eq!(video_quality(VideoCodec::Vp9, 100), Rate::Quality(24.0));
        assert_eq!(video_quality(VideoCodec::Mpeg4, 1), Rate::Quality(20.0));
        assert_eq!(video_quality(VideoCodec::Wmv2, 100), Rate::Quality(2.0));
        assert_eq!(
            audio_quality(AudioCodec::Mp3, 100, 2, 44_100),
            Rate::Quality(0.0)
        );
        assert_eq!(
            audio_quality(AudioCodec::Vorbis, 1, 2, 44_100),
            Rate::Quality(0.0)
        );
        assert_eq!(
            audio_quality(AudioCodec::Aac, 100, 2, 48_000),
            Rate::Bitrate(256_000)
        );
        // Mono gets half, and never less than the encoder takes.
        assert_eq!(
            audio_quality(AudioCodec::Wmav2, 1, 1, 44_100),
            Rate::Bitrate(24_000)
        );
        assert_eq!(
            audio_quality(AudioCodec::Flac, 50, 2, 44_100),
            Rate::Default
        );
    }

    #[test]
    fn bit_rates_snap_to_what_encoders_take() {
        assert_eq!(snap(AudioCodec::Mp3, 100_000.0, 44_100), 96_000.0);
        assert_eq!(snap(AudioCodec::Mp3Cbr, 10_000.0, 44_100), 32_000.0);
        assert_eq!(snap(AudioCodec::Mp3, 20_000.0, 22_050), 16_000.0);
        assert_eq!(snap(AudioCodec::Aac, 95_500.0, 48_000), 95_000.0);
        assert!(audio_rate(AudioCodec::Mp3, 20_000.0, 2, 44_100).is_none());
        assert_eq!(
            audio_rate(AudioCodec::Opus, 1_000_000.0, 2, 48_000),
            Some(Rate::Bitrate(256_000))
        );
    }

    #[test]
    fn vorbis_quality_follows_the_nominal_rates() {
        assert_eq!(vorbis_quality(128_000.0, 2), 4.0);
        assert_eq!(vorbis_quality(144_000.0, 2), 4.5);
        assert_eq!(vorbis_quality(30_000.0, 2), 0.0);
        assert_eq!(vorbis_quality(64_000.0, 1), 4.0);
        assert_eq!(vorbis_bits(4.5, 2), 144_000.0);
        assert_eq!(vorbis_bits(10.0, 2), 500_000.0);
    }
}
