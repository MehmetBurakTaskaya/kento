// SPDX-License-Identifier: MIT
//! The containers Kento writes and the encoder settings it uses for each (SPEC 5.4).
//!
//! The defaults aim at files that play everywhere at a sensible size:
//!
//! - MP4 and MOV: H.264 (libx264, CRF 22, preset medium, 8-bit 4:2:0, even sizes) and AAC at
//!   192 kb/s, with the index at the front (`+faststart`) so playback starts before the whole
//!   file has loaded.
//! - MKV: copies every stream it can hold; anything else becomes H.264 and AAC as above.
//! - WEBM: VP9 in constant-quality mode (CRF 32, `-b:v 0`, row multithreading, `cpu-used 2`,
//!   since VP9 at its default speed is very slow) and Opus at 128 kb/s.
//! - AVI: MPEG-4 Part 2 (quantiser 3, the Xvid tag older players look for) and MP3 at a constant
//!   192 kb/s, because variable-rate MP3 confuses AVI players.
//! - WMV: WMV 8 (`wmv2`, quantiser 3) and WMA 2 (`wmav2`) at 192 kb/s.
//! - GIF: see `convert::gif`.
//! - MP3: LAME VBR quality 2 (about 190 kb/s). M4A: AAC 192 kb/s. WAV: 16-bit PCM. FLAC: level 5.
//!   OGG: Vorbis quality 5 (about 160 kb/s). OPUS: 128 kb/s. AIFF: 16-bit big-endian PCM.
//!   WMA: WMA 2 at 192 kb/s.
//!
//! A stream that is already in the codec the target holds natively is copied, not encoded:
//! that is lossless and much faster (`keeps_video`, `keeps_audio`).

use std::path::Path;

use super::probe::Stream;
use super::run::Cmd;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Container {
    Mp4,
    Mov,
    Mkv,
    Webm,
    Avi,
    Wmv,
    Gif,
    Mp3,
    M4a,
    Wav,
    Flac,
    Ogg,
    Opus,
    Aiff,
    Wma,
}

const ALL: [Container; 15] = [
    Container::Mp4,
    Container::Mov,
    Container::Mkv,
    Container::Webm,
    Container::Avi,
    Container::Wmv,
    Container::Gif,
    Container::Mp3,
    Container::M4a,
    Container::Wav,
    Container::Flac,
    Container::Ogg,
    Container::Opus,
    Container::Aiff,
    Container::Wma,
];

const MKV_VIDEO: &[&str] = &[
    "h264",
    "hevc",
    "vp8",
    "vp9",
    "av1",
    "mpeg4",
    "mpeg2video",
    "mpeg1video",
    "theora",
    "prores",
    "ffv1",
];
const MKV_AUDIO: &[&str] = &[
    "aac",
    "mp3",
    "mp2",
    "opus",
    "vorbis",
    "flac",
    "alac",
    "ac3",
    "eac3",
    "dts",
    "truehd",
    "pcm_s16le",
    "pcm_s24le",
    "pcm_s32le",
    "pcm_f32le",
];
/// Subtitles kept as text; bitmap subtitles only survive into MKV.
const TEXT_SUBTITLES: &[&str] = &["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"];
const MKV_SUBTITLES: &[&str] = &[
    "subrip",
    "srt",
    "ass",
    "ssa",
    "webvtt",
    "hdmv_pgs_subtitle",
    "dvd_subtitle",
    "dvb_subtitle",
];
const PCM: &[&str] = &[
    "pcm_s16le",
    "pcm_s16be",
    "pcm_s24le",
    "pcm_s24be",
    "pcm_s32le",
    "pcm_s32be",
    "pcm_f32le",
    "pcm_f32be",
    "pcm_u8",
];

impl Container {
    /// The catalog id, which is also the extension Kento writes.
    pub fn id(self) -> &'static str {
        match self {
            Container::Mp4 => "mp4",
            Container::Mov => "mov",
            Container::Mkv => "mkv",
            Container::Webm => "webm",
            Container::Avi => "avi",
            Container::Wmv => "wmv",
            Container::Gif => "gif",
            Container::Mp3 => "mp3",
            Container::M4a => "m4a",
            Container::Wav => "wav",
            Container::Flac => "flac",
            Container::Ogg => "ogg",
            Container::Opus => "opus",
            Container::Aiff => "aiff",
            Container::Wma => "wma",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        ALL.into_iter().find(|container| container.id() == id)
    }

    /// By the file's extension (`.m4v` is MP4, `.aif` is AIFF, …).
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "m4v" => Some(Container::Mp4),
            "asf" => Some(Container::Wmv),
            "oga" => Some(Container::Ogg),
            "aif" | "aifc" => Some(Container::Aiff),
            other => Self::from_id(other),
        }
    }

    /// By ffprobe's format name, for a file whose extension says nothing.
    pub fn from_format(name: &str) -> Option<Self> {
        let first = name.split(',').next().unwrap_or_default();
        match first {
            "mov" => Some(Container::Mp4),
            "matroska" => Some(Container::Mkv),
            "asf" => Some(Container::Wmv),
            other => Self::from_id(other),
        }
    }

    pub fn muxer(self) -> &'static str {
        match self {
            Container::Mp4 => "mp4",
            Container::Mov => "mov",
            Container::Mkv => "matroska",
            Container::Webm => "webm",
            Container::Avi => "avi",
            Container::Wmv | Container::Wma => "asf",
            Container::Gif => "gif",
            Container::Mp3 => "mp3",
            // FFmpeg's M4A flavour of MP4.
            Container::M4a => "ipod",
            Container::Wav => "wav",
            Container::Flac => "flac",
            Container::Ogg => "ogg",
            Container::Opus => "opus",
            Container::Aiff => "aiff",
        }
    }

    pub fn audio_only(self) -> bool {
        matches!(
            self,
            Container::Mp3
                | Container::M4a
                | Container::Wav
                | Container::Flac
                | Container::Ogg
                | Container::Opus
                | Container::Aiff
                | Container::Wma
        )
    }

    /// The video encoder for this container; `None` for audio and GIF.
    pub fn video(self) -> Option<VideoCodec> {
        match self {
            Container::Mp4 | Container::Mov | Container::Mkv => Some(VideoCodec::H264),
            Container::Webm => Some(VideoCodec::Vp9),
            Container::Avi => Some(VideoCodec::Mpeg4),
            Container::Wmv => Some(VideoCodec::Wmv2),
            _ => None,
        }
    }

    pub fn audio(self) -> Option<AudioCodec> {
        Some(match self {
            Container::Mp4 | Container::Mov | Container::Mkv | Container::M4a => AudioCodec::Aac,
            Container::Webm | Container::Opus => AudioCodec::Opus,
            Container::Avi => AudioCodec::Mp3Cbr,
            Container::Wmv | Container::Wma => AudioCodec::Wmav2,
            Container::Mp3 => AudioCodec::Mp3,
            Container::Wav => AudioCodec::Pcm("pcm_s16le"),
            Container::Flac => AudioCodec::Flac,
            Container::Ogg => AudioCodec::Vorbis,
            Container::Aiff => AudioCodec::Pcm("pcm_s16be"),
            Container::Gif => return None,
        })
    }

    /// Whether a video stream in `codec` is copied as it is.
    pub fn keeps_video(self, codec: &str) -> bool {
        let fits: &[&str] = match self {
            Container::Mp4 | Container::Mov => &["h264"],
            Container::Mkv => MKV_VIDEO,
            Container::Webm => &["vp8", "vp9", "av1"],
            Container::Avi => &["mpeg4"],
            Container::Wmv => &["wmv1", "wmv2", "wmv3", "vc1"],
            _ => &[],
        };
        fits.contains(&codec)
    }

    /// Whether an audio stream in `codec` is copied as it is.
    pub fn keeps_audio(self, codec: &str) -> bool {
        let fits: &[&str] = match self {
            Container::Mp4 | Container::Mov => &["aac"],
            Container::Mkv => MKV_AUDIO,
            Container::Webm => &["opus", "vorbis"],
            Container::Avi | Container::Mp3 => &["mp3"],
            Container::Wmv | Container::Wma => &["wmav1", "wmav2"],
            Container::M4a => &["aac", "alac"],
            Container::Wav => &["pcm_s16le"],
            Container::Flac => &["flac"],
            Container::Ogg => &["vorbis"],
            Container::Opus => &["opus"],
            Container::Aiff => &["pcm_s16be"],
            Container::Gif => &[],
        };
        fits.contains(&codec)
    }

    /// What happens to a subtitle stream: MP4 and MOV hold text as `mov_text`, WEBM as WebVTT,
    /// MKV almost anything; the other containers drop subtitles.
    pub fn subtitle(self, codec: &str) -> Subtitle {
        let text = TEXT_SUBTITLES.contains(&codec);
        match self {
            Container::Mkv if MKV_SUBTITLES.contains(&codec) => Subtitle::Copy,
            Container::Mkv if text => Subtitle::Encode("srt"),
            Container::Mp4 | Container::Mov if codec == "mov_text" => Subtitle::Copy,
            Container::Mp4 | Container::Mov if text => Subtitle::Encode("mov_text"),
            Container::Webm if codec == "webvtt" => Subtitle::Copy,
            Container::Webm if text => Subtitle::Encode("webvtt"),
            _ => Subtitle::Drop,
        }
    }

    /// Options of the muxer itself.
    pub fn muxer_args(self, cmd: &mut Cmd) {
        match self {
            Container::Mp4 | Container::Mov | Container::M4a => {
                cmd.args(["-movflags", "+faststart"]);
            }
            // ID3v2.3 is what Windows and most car stereos read.
            Container::Mp3 => {
                cmd.args(["-id3v2_version", "3"]);
            }
            // RF64 only when the file passes 4 GB, which a plain WAV header cannot describe.
            Container::Wav => {
                cmd.args(["-rf64", "auto"]);
            }
            Container::Gif => {
                cmd.args(["-loop", "0"]);
            }
            _ => {}
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Subtitle {
    Copy,
    Encode(&'static str),
    Drop,
}

/// How an encoder spends its bits: the defaults above, or what Compress asks for.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Rate {
    Default,
    /// The encoder's own scale: CRF for x264, x265 and VP9, the quantiser for MPEG-4 and WMV, VBR
    /// quality for LAME and Vorbis. Encoders that only take a bit rate keep their default.
    Quality(f32),
    /// Bits per second.
    Bitrate(u64),
}

impl Rate {
    /// The option and its value: `scale` with `default` for `Default`, `b` for a bit rate.
    fn option(self, scale: &'static str, default: &str) -> (&'static str, String) {
        match self {
            Rate::Default => (scale, default.to_owned()),
            Rate::Quality(value) => (scale, value.to_string()),
            Rate::Bitrate(bits) => ("b", bits.to_string()),
        }
    }

    /// For encoders that only take a bit rate.
    fn bitrate(self, default: &str) -> (&'static str, String) {
        match self {
            Rate::Bitrate(bits) => ("b", bits.to_string()),
            _ => ("b", default.to_owned()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VideoCodec {
    H264,
    Hevc,
    Vp9,
    Mpeg4,
    Wmv2,
}

impl VideoCodec {
    /// The encoder that writes `codec` again, for tools that keep the input's codecs.
    pub fn like(codec: &str) -> Option<Self> {
        match codec {
            "h264" => Some(VideoCodec::H264),
            "hevc" => Some(VideoCodec::Hevc),
            "vp8" | "vp9" => Some(VideoCodec::Vp9),
            "mpeg4" | "msmpeg4v2" | "msmpeg4v3" => Some(VideoCodec::Mpeg4),
            "wmv1" | "wmv2" | "wmv3" | "vc1" => Some(VideoCodec::Wmv2),
            _ => None,
        }
    }

    /// 4:2:0 encoders need even sizes (VP9 copes with odd ones).
    pub fn even(self) -> bool {
        self != VideoCodec::Vp9
    }

    /// Adds the encoder options for output video stream 0.
    pub fn push(self, cmd: &mut Cmd, container: Container) {
        self.push_at(cmd, container, Rate::Default);
    }

    /// Like `push`, at this rate.
    pub fn push_at(self, cmd: &mut Cmd, container: Container, rate: Rate) {
        let rate_args = |cmd: &mut Cmd, scale: &'static str, default: &str| {
            let (name, value) = rate.option(scale, default);
            cmd.arg(format!("-{name}:v:0")).arg(value);
        };
        match self {
            VideoCodec::H264 => {
                cmd.args(["-c:v:0", "libx264", "-preset:v:0", "medium"]);
                rate_args(cmd, "crf", "22");
                cmd.args(["-pix_fmt:v:0", "yuv420p"]);
            }
            VideoCodec::Hevc => {
                // The pixel format follows the source, so 10-bit video stays 10-bit.
                cmd.args(["-c:v:0", "libx265", "-preset:v:0", "medium"]);
                rate_args(cmd, "crf", "24");
                cmd.args(["-x265-params:v:0", "log-level=error"]);
                if matches!(container, Container::Mp4 | Container::Mov) {
                    // Apple's players want the hvc1 tag.
                    cmd.args(["-tag:v:0", "hvc1"]);
                }
            }
            VideoCodec::Vp9 => {
                cmd.args(["-c:v:0", "libvpx-vp9"]);
                rate_args(cmd, "crf", "32");
                // Constant quality needs a bit rate of 0; a bit rate alone is an average.
                if !matches!(rate, Rate::Bitrate(_)) {
                    cmd.args(["-b:v:0", "0"]);
                }
                cmd.args([
                    "-row-mt:v:0",
                    "1",
                    "-deadline:v:0",
                    "good",
                    "-cpu-used:v:0",
                    "2",
                    "-pix_fmt:v:0",
                    "yuv420p",
                ]);
            }
            VideoCodec::Mpeg4 => {
                cmd.args(["-c:v:0", "mpeg4"]);
                rate_args(cmd, "q", "3");
                cmd.args(["-pix_fmt:v:0", "yuv420p"]);
                if container == Container::Avi {
                    cmd.args(["-tag:v:0", "XVID"]);
                }
            }
            VideoCodec::Wmv2 => {
                cmd.args(["-c:v:0", "wmv2"]);
                rate_args(cmd, "q", "3");
                cmd.args(["-pix_fmt:v:0", "yuv420p"]);
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AudioCodec {
    Aac,
    /// Variable rate, for MP3 files.
    Mp3,
    /// Constant rate, for AVI.
    Mp3Cbr,
    Opus,
    Vorbis,
    Flac,
    Alac,
    Pcm(&'static str),
    Wmav2,
}

impl AudioCodec {
    /// The encoder that writes `codec` again, for tools that keep the input's codecs.
    pub fn like(codec: &str, container: Container) -> Option<Self> {
        Some(match codec {
            "aac" => AudioCodec::Aac,
            "mp3" if container == Container::Avi => AudioCodec::Mp3Cbr,
            "mp3" => AudioCodec::Mp3,
            "opus" => AudioCodec::Opus,
            "vorbis" => AudioCodec::Vorbis,
            "flac" => AudioCodec::Flac,
            "alac" => AudioCodec::Alac,
            "wmav1" | "wmav2" => AudioCodec::Wmav2,
            pcm => AudioCodec::Pcm(PCM.iter().find(|name| **name == pcm)?),
        })
    }

    /// Adds the encoder options for output audio stream `k`, made from `source`.
    pub fn push(self, cmd: &mut Cmd, k: usize, source: Option<&Stream>) {
        self.push_at(cmd, k, source, Rate::Default);
    }

    /// Like `push`, at this rate (lossless and PCM encoders have none).
    pub fn push_at(self, cmd: &mut Cmd, k: usize, source: Option<&Stream>, rate: Rate) {
        let option = |name: &str| format!("-{name}:a:{k}");
        let (encoder, rate): (&str, Option<(&str, String)>) = match self {
            AudioCodec::Aac => ("aac", Some(rate.bitrate("192k"))),
            // A bit rate makes LAME write a constant rate, which lands closest to a size.
            AudioCodec::Mp3 => ("libmp3lame", Some(rate.option("q", "2"))),
            AudioCodec::Mp3Cbr => ("libmp3lame", Some(rate.bitrate("192k"))),
            AudioCodec::Opus => ("libopus", Some(rate.bitrate("128k"))),
            AudioCodec::Vorbis => ("libvorbis", Some(rate.option("q", "5"))),
            AudioCodec::Flac => ("flac", None),
            AudioCodec::Alac => ("alac", None),
            AudioCodec::Pcm(name) => (name, None),
            AudioCodec::Wmav2 => ("wmav2", Some(rate.bitrate("192k"))),
        };
        cmd.arg(option("c")).arg(encoder);
        if let Some((name, value)) = rate {
            cmd.arg(option(name)).arg(value);
        }
        let channels = source.map_or(0, |stream| stream.channels);
        // LAME and WMA hold at most two channels; Opus surround needs a channel mapping that not
        // every layout has, so it gets stereo too.
        let stereo_only = matches!(
            self,
            AudioCodec::Mp3 | AudioCodec::Mp3Cbr | AudioCodec::Wmav2 | AudioCodec::Opus
        );
        if stereo_only && channels > 2 {
            cmd.arg(option("ac")).arg("2");
        }
        let sample_rate = source.map_or(0, |stream| stream.sample_rate);
        if self == AudioCodec::Wmav2 && sample_rate > 48_000 {
            cmd.arg(option("ar")).arg("48000");
        }
    }
}
