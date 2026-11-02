// SPDX-License-Identifier: MIT
//! Conversions between video and audio formats (SPEC 5.4), and the stream mapping the tools
//! share with them (`Recipe`).

use std::path::PathBuf;

use super::codec::{AudioCodec, Container, Subtitle, VideoCodec};
use super::probe::{self, Probe};
use super::run::{self, Cmd, Watch};
use crate::{Conversion, Error, Result};

const VIDEO_IN: &[&str] = &["avi", "mkv", "mov", "mp4", "webm", "wmv"];
/// MP4 to MP3 and the [+] M4A and WAV take the sound only.
const VIDEO_OUT: &[&str] = &[
    "mp4", "mov", "mkv", "webm", "avi", "wmv", "gif", "mp3", "m4a", "wav",
];
/// An animated GIF has no sound, so it becomes a video only.
const GIF_OUT: &[&str] = &["mp4", "webm", "mov"];
const AUDIO: &[&str] = &["aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"];

/// Keeps a 4:2:0 picture at even sizes by dropping its last odd row or column.
pub(super) const EVEN: &str = "crop=trunc(iw/2)*2:trunc(ih/2)*2";

pub(super) fn supports(from: &str, to: &str) -> bool {
    from != to
        && ((VIDEO_IN.contains(&from) && VIDEO_OUT.contains(&to))
            || (from == "gif" && GIF_OUT.contains(&to))
            || (AUDIO.contains(&from) && AUDIO.contains(&to)))
}

pub(super) fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    let unsupported = || Error::Unsupported {
        from: job.from.to_owned(),
        to: job.to.to_owned(),
    };
    if !supports(job.from, job.to) {
        return Err(unsupported());
    }
    let target = Container::from_id(job.to).ok_or_else(unsupported)?;
    let ffmpeg = job.options.tools.ffmpeg()?;
    let probe = probe::probe(job.options.tools.ffprobe()?, job.input)?;
    tracing::debug!(from = job.from, to = job.to, "converting media");

    let mut cmd = Cmd::new();
    cmd.input(job.input);
    if target == Container::Gif {
        gif(&mut cmd, &probe)?;
    } else {
        apply(
            &mut cmd,
            &probe,
            &Recipe {
                container: target,
                video: Video::Fit,
                audio: Audio::Fit,
                subtitles: true,
                graph: None,
            },
        )?;
    }
    target.muxer_args(&mut cmd);
    cmd.output(target.muxer(), job.dest);
    run::run(ffmpeg, &cmd, Watch::new(job.progress, probe.info.duration))?;
    Ok(vec![job.dest.to_path_buf()])
}

/// An optimised GIF: a palette made from the clip itself (`palettegen`) and applied in the same
/// graph (`paletteuse`), at 12 frames a second and at most 480 pixels wide, scaled with Lanczos.
fn gif(cmd: &mut Cmd, probe: &Probe) -> Result<()> {
    let video = probe
        .video()
        .ok_or_else(|| Error::Other("the file has no video to turn into a GIF".into()))?;
    cmd.map(video.index)
        .arg("-filter:v:0")
        .arg(
            "fps=12,scale=w='min(480,iw)':h=-1:flags=lanczos,\
             split[a][b];[a]palettegen[p];[b][p]paletteuse",
        )
        .args(["-c:v:0", "gif"]);
    Ok(())
}

/// How the picture reaches the output (audio containers never get one).
#[derive(Debug, Clone)]
pub(super) enum Video {
    Copy,
    /// Copied when the container holds its codec natively, otherwise encoded with the
    /// container's encoder.
    Fit,
    /// Encoded through `filter`, with the input's codec when `keep_codec` and Kento has an
    /// encoder for it, otherwise the container's.
    Encode {
        keep_codec: bool,
        filter: Option<String>,
    },
    /// The `[v]` output of the recipe's graph, with the container's encoder.
    Graph,
}

/// How the sound reaches the output: like `Video`, for every audio stream (the first only in
/// audio containers).
#[derive(Debug, Clone)]
pub(super) enum Audio {
    Drop,
    Copy,
    Fit,
    Encode {
        keep_codec: bool,
        filter: Option<String>,
    },
    /// The `[a]` output of the recipe's graph, with the first audio stream's codec when
    /// `keep_codec`.
    Graph {
        keep_codec: bool,
    },
}

#[derive(Debug, Clone)]
pub(super) struct Recipe {
    pub container: Container,
    pub video: Video,
    pub audio: Audio,
    /// Keeps subtitles where the container can hold them.
    pub subtitles: bool,
    /// A `-filter_complex` graph for `Video::Graph` and `Audio::Graph`.
    pub graph: Option<String>,
}

/// Adds the stream maps, filters and encoders of `recipe` for an input described by `probe`.
/// Audio containers never get a video stream, so cover art is dropped there.
pub(super) fn apply(cmd: &mut Cmd, probe: &Probe, recipe: &Recipe) -> Result<()> {
    let container = recipe.container;
    let mut streams = 0;
    if let Some(graph) = &recipe.graph {
        cmd.arg("-filter_complex").arg(graph);
    }

    if !container.audio_only() {
        let encoder = container.video();
        match (&recipe.video, probe.video()) {
            (Video::Graph, _) => {
                let codec = encoder.ok_or_else(no_video_encoder)?;
                cmd.args(["-map", "[v]"]);
                codec.push(cmd, container);
                streams += 1;
            }
            (_, None) => {}
            (rule, Some(video)) => {
                cmd.map(video.index);
                let copy = match rule {
                    Video::Copy => true,
                    Video::Fit => container.keeps_video(&video.codec),
                    _ => false,
                };
                if copy {
                    cmd.args(["-c:v:0", "copy"]);
                } else {
                    let (keep_codec, filter) = match rule {
                        Video::Encode { keep_codec, filter } => (*keep_codec, filter.clone()),
                        _ => (false, None),
                    };
                    let codec = keep_codec
                        .then(|| VideoCodec::like(&video.codec))
                        .flatten()
                        .or(encoder)
                        .ok_or_else(no_video_encoder)?;
                    let mut chain: Vec<String> = filter.into_iter().collect();
                    if codec.even() && (video.width % 2 == 1 || video.height % 2 == 1) {
                        chain.push(EVEN.to_owned());
                    }
                    if !chain.is_empty() {
                        cmd.arg("-filter:v:0").arg(chain.join(","));
                    }
                    codec.push(cmd, container);
                }
                streams += 1;
            }
        }
    }

    let encoder = container.audio();
    let first_audio = probe.audio();
    match &recipe.audio {
        Audio::Drop => {}
        Audio::Graph { keep_codec } => {
            let codec = keep_codec
                .then(|| first_audio.and_then(|a| AudioCodec::like(&a.codec, container)))
                .flatten()
                .or(encoder)
                .ok_or_else(no_audio_encoder)?;
            cmd.args(["-map", "[a]"]);
            codec.push(cmd, 0, first_audio);
            streams += 1;
        }
        rule => {
            let take = if container.audio_only() {
                1
            } else {
                usize::MAX
            };
            for (k, audio) in probe.audios().take(take).enumerate() {
                cmd.map(audio.index);
                let copy = match rule {
                    Audio::Copy => true,
                    Audio::Fit => container.keeps_audio(&audio.codec),
                    _ => false,
                };
                if copy {
                    cmd.arg(format!("-c:a:{k}")).arg("copy");
                } else {
                    let (keep_codec, filter) = match rule {
                        Audio::Encode { keep_codec, filter } => (*keep_codec, filter.as_deref()),
                        _ => (false, None),
                    };
                    let codec = keep_codec
                        .then(|| AudioCodec::like(&audio.codec, container))
                        .flatten()
                        .or(encoder)
                        .ok_or_else(no_audio_encoder)?;
                    if let Some(filter) = filter {
                        cmd.arg(format!("-filter:a:{k}")).arg(filter);
                    }
                    codec.push(cmd, k, Some(audio));
                }
                streams += 1;
            }
        }
    }

    if recipe.subtitles && !container.audio_only() {
        let mut k = 0;
        for subtitle in probe.subtitles() {
            let encoder = match container.subtitle(&subtitle.codec) {
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

    if streams == 0 {
        return Err(if container.audio_only() {
            Error::Other("the file has no sound".into())
        } else {
            Error::Other("the file has nothing this format can hold".into())
        });
    }
    Ok(())
}

fn no_video_encoder() -> Error {
    Error::Other("this format holds no video".into())
}

fn no_audio_encoder() -> Error {
    Error::Other("this format holds no sound".into())
}
