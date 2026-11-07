// SPDX-License-Identifier: MIT
//! Reverse and loop (ARCHITECTURE 56). FFmpeg's `reverse` and `areverse` hold their whole input
//! in memory, so the picture is reversed a few seconds at a time: each piece is read with `-ss` and
//! `-t`, reversed and encoded exactly as the result is, and the concat demuxer joins the pieces in
//! the other order without encoding them again. The sound becomes one PCM file as long as the
//! picture (silence fills a gap, the rest is cut), is reversed in ten-second pieces and is encoded
//! once at the end, so it keeps time with the picture and has no seams.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use crate::media::codec::{AudioCodec, Container};
use crate::media::convert::{Audio, Recipe, Video};
use crate::media::probe::{self, Probe, Stream};
use crate::media::run::{self, secs, Cmd, Watch};
use crate::media::LoopMode;
use crate::{Error, Result};

use super::super::{no_video, Job};

/// The decoded frames one piece may hold, in bytes.
const BUDGET: f64 = 256.0 * 1024.0 * 1024.0;
/// Seconds of picture per piece, at least and at most.
const MIN_PIECE: f64 = 0.2;
const MAX_PIECE: f64 = 10.0;
/// Seconds of sound per piece: whole seconds hold a whole number of samples at every rate.
const SOUND_PIECE: f64 = 10.0;
const MAX_COUNT: u32 = 10;

const PICTURES: &str = "pictures.txt";
const SOUNDS: &str = "sounds.txt";
const SOUND: &str = "sound.wav";

/// A file in the job's folder and the seconds it plays.
#[derive(Debug, Clone)]
struct Part {
    name: String,
    seconds: f64,
}

impl Job<'_, '_> {
    pub(in crate::media::tools) fn loop_video(
        &self,
        input: &Path,
        mode: LoopMode,
        count: u32,
    ) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let container = self.container(input, &probe)?;
        let video = probe.video().ok_or_else(no_video)?.clone();
        let duration = probe.info.duration;
        if duration <= 0.0 {
            return Err(Error::Other("the video has no length".into()));
        }
        let count = count.clamp(1, MAX_COUNT) as usize;
        let audio = probe
            .audio()
            .cloned()
            .filter(|_| mode != LoopMode::Boomerang);
        // Rough shares of the work: encoding the picture is most of it.
        let watch = self.watch(duration);
        match mode {
            LoopMode::Reverse => {
                let (pictures, length) = self.loop_reversed(
                    input,
                    &probe,
                    container,
                    &video,
                    watch.part(0.0, 0.85, duration),
                )?;
                let sounds = match &audio {
                    Some(stream) => {
                        let sound =
                            self.loop_sound(input, stream, length, watch.part(0.85, 0.9, length))?;
                        Some(self.loop_reversed_sound(&sound, watch.part(0.9, 0.94, length))?)
                    }
                    None => None,
                };
                let sounds: Option<Vec<&Part>> = sounds.as_ref().map(|list| list.iter().collect());
                self.loop_join(
                    &pictures.iter().collect::<Vec<_>>(),
                    sounds.as_deref(),
                    container,
                    audio.as_ref(),
                    watch.part(0.94, 1.0, length),
                )
            }
            LoopMode::Boomerang => {
                let forward =
                    self.loop_forward(input, &probe, container, watch.part(0.0, 0.45, duration))?;
                let (backward, _) = self.loop_reversed(
                    input,
                    &probe,
                    container,
                    &video,
                    watch.part(0.45, 0.92, duration),
                )?;
                let once: Vec<&Part> = std::iter::once(&forward).chain(&backward).collect();
                let pictures: Vec<&Part> = (0..count).flat_map(|_| once.iter().copied()).collect();
                let length = 2.0 * forward.seconds * count as f64;
                self.loop_join(
                    &pictures,
                    None,
                    container,
                    None,
                    watch.part(0.92, 1.0, length),
                )
            }
            LoopMode::Repeat => {
                let forward =
                    self.loop_forward(input, &probe, container, watch.part(0.0, 0.85, duration))?;
                let sound = match &audio {
                    Some(stream) => Some(self.loop_sound(
                        input,
                        stream,
                        forward.seconds,
                        watch.part(0.85, 0.9, forward.seconds),
                    )?),
                    None => None,
                };
                let pictures = vec![&forward; count];
                let sounds = sound.as_ref().map(|sound| vec![sound; count]);
                let length = forward.seconds * count as f64;
                self.loop_join(
                    &pictures,
                    sounds.as_deref(),
                    container,
                    audio.as_ref(),
                    watch.part(0.9, 1.0, length),
                )
            }
        }
    }

    /// The picture once, forwards, encoded as the reversed pieces are, so that the concat demuxer
    /// can join them without encoding again.
    fn loop_forward(
        &self,
        input: &Path,
        probe: &Probe,
        container: Container,
        watch: Watch,
    ) -> Result<Part> {
        let name = format!("forward.{}", container.id());
        let mut cmd = Cmd::new();
        cmd.input(input);
        self.encode(
            cmd,
            probe,
            &picture_only(container, None),
            &[],
            &self.run.temp.join(&name),
            watch,
        )?;
        let seconds = self.loop_length(&name).ok_or_else(no_video)?;
        Ok(Part { name, seconds })
    }

    /// The picture in reversed pieces, in the order they play (the end of the video first), and
    /// how long they play together.
    fn loop_reversed(
        &self,
        input: &Path,
        probe: &Probe,
        container: Container,
        video: &Stream,
        watch: Watch,
    ) -> Result<(Vec<Part>, f64)> {
        let duration = probe.info.duration;
        let piece = piece_length(video);
        let pieces = (duration / piece - 1e-9).ceil().max(1.0) as usize;
        let mut parts = Vec::with_capacity(pieces);
        let mut end = None;
        let mut done = 0.0;
        for k in (0..pieces).rev() {
            let start = k as f64 * piece;
            let length = (duration - start).min(piece);
            if length <= 0.0 {
                continue;
            }
            let name = format!("picture-{k:05}.{}", container.id());
            let mut cmd = Cmd::new();
            cmd.args(["-ss", &secs(start), "-t", &secs(length)])
                .input(input);
            self.encode(
                cmd,
                probe,
                &picture_only(container, Some("reverse")),
                &[],
                &self.run.temp.join(&name),
                watch.part(done / duration, (done + length) / duration, length),
            )?;
            done += length;
            // The picture's real end decides the length; the last pieces hold no frame at all when
            // the sound runs on past it.
            if end.is_none() {
                match self.loop_length(&name) {
                    Some(seconds) => end = Some(start + seconds),
                    None => continue,
                }
            }
            parts.push(Part {
                name,
                seconds: length,
            });
        }
        let end = end.ok_or_else(no_video)?;
        Ok((parts, end))
    }

    /// The first sound track as 32-bit float PCM, starting with the picture and exactly `length`
    /// seconds long.
    fn loop_sound(&self, input: &Path, audio: &Stream, length: f64, watch: Watch) -> Result<Part> {
        let mut cmd = Cmd::new();
        cmd.input(input)
            .map(audio.index)
            .arg("-filter:a:0")
            .arg("aresample=async=1:first_pts=0,apad")
            .args(["-t", &secs(length), "-c:a:0", "pcm_f32le"]);
        Container::Wav.muxer_args(&mut cmd);
        cmd.output(Container::Wav.muxer(), &self.run.temp.join(SOUND));
        run::run(self.ffmpeg, &cmd, watch)?;
        Ok(Part {
            name: SOUND.to_owned(),
            seconds: length,
        })
    }

    /// `sound` in reversed pieces, the end first.
    fn loop_reversed_sound(&self, sound: &Part, watch: Watch) -> Result<Vec<Part>> {
        let pieces = (sound.seconds / SOUND_PIECE - 1e-9).ceil().max(1.0) as usize;
        let source = self.run.temp.join(&sound.name);
        let mut parts = Vec::with_capacity(pieces);
        let mut done = 0.0;
        for k in (0..pieces).rev() {
            let start = k as f64 * SOUND_PIECE;
            let length = (sound.seconds - start).min(SOUND_PIECE);
            if length <= 0.0 {
                continue;
            }
            let name = format!("sound-{k:05}.wav");
            let mut cmd = Cmd::new();
            cmd.args(["-ss", &secs(start), "-t", &secs(length)])
                .input(&source)
                .args(["-filter:a:0", "areverse", "-c:a:0", "pcm_f32le"]);
            Container::Wav.muxer_args(&mut cmd);
            cmd.output(Container::Wav.muxer(), &self.run.temp.join(&name));
            let span = sound.seconds;
            run::run(
                self.ffmpeg,
                &cmd,
                watch.part(done / span, (done + length) / span, length),
            )?;
            done += length;
            parts.push(Part {
                name,
                seconds: length,
            });
        }
        Ok(parts)
    }

    /// The pictures one after another, copied as they are, with the sounds encoded once in the
    /// input's sound codec.
    fn loop_join(
        &self,
        pictures: &[&Part],
        sounds: Option<&[&Part]>,
        container: Container,
        audio: Option<&Stream>,
        watch: Watch,
    ) -> Result<Vec<PathBuf>> {
        let dir = self.run.temp;
        fs::write(dir.join(PICTURES), concat_list(pictures))?;
        let mut cmd = Cmd::new();
        cmd.args(["-f", "concat"]).input(&dir.join(PICTURES));
        let sound = sounds.zip(audio);
        if let Some((sounds, _)) = sound {
            fs::write(dir.join(SOUNDS), concat_list(sounds))?;
            cmd.args(["-f", "concat"]).input(&dir.join(SOUNDS));
        }
        cmd.args(["-map", "0:v:0", "-c:v:0", "copy"]);
        if let Some((_, audio)) = sound {
            if let Some(codec) = AudioCodec::like(&audio.codec, container).or(container.audio()) {
                cmd.args(["-map", "1:a:0"]);
                codec.push(&mut cmd, 0, Some(audio));
            }
        }
        container.muxer_args(&mut cmd);
        cmd.output(container.muxer(), self.run.dest);
        run::run(self.ffmpeg, &cmd, watch)?;
        Ok(self.dest())
    }

    /// The seconds a file of the job's folder plays; None when it has no picture.
    fn loop_length(&self, name: &str) -> Option<f64> {
        let probe = probe::probe(self.ffprobe, &self.run.temp.join(name)).ok()?;
        probe.video()?;
        (probe.info.duration > 0.0).then_some(probe.info.duration)
    }
}

/// The picture alone, through `filter`, in the input's codec where Kento has an encoder for it.
fn picture_only(container: Container, filter: Option<&str>) -> Recipe {
    Recipe {
        container,
        video: Video::Encode {
            keep_codec: true,
            filter: filter.map(str::to_owned),
        },
        audio: Audio::Drop,
        subtitles: false,
        graph: None,
    }
}

/// Seconds of picture per reversed piece: as many frames as fit in `BUDGET` once decoded.
fn piece_length(video: &Stream) -> f64 {
    let pixels = f64::from(video.width.max(1)) * f64::from(video.height.max(1));
    let fps = if video.fps > 0.0 { video.fps } else { 30.0 };
    (BUDGET / (pixels * bytes_per_pixel(&video.pixel_format)) / fps).clamp(MIN_PIECE, MAX_PIECE)
}

/// What one pixel takes once decoded, by FFmpeg's name for the pixel format.
fn bytes_per_pixel(format: &str) -> f64 {
    let samples =
        if format.contains("444") || format.starts_with("rgb") || format.starts_with("gbr") {
            3.0
        } else if format.contains("422") {
            2.0
        } else {
            1.5
        };
    let deep = ["9", "10", "12", "14", "16"].iter().any(|depth| {
        format.contains(&format!("p{depth}")) || format.contains(&format!("{depth}le"))
    });
    samples * if deep { 2.0 } else { 1.0 }
}

/// A concat demuxer script naming files beside it; their names are plain, so nothing needs
/// quoting beyond the quotes themselves.
fn concat_list(parts: &[&Part]) -> String {
    let mut text = String::from("ffconcat version 1.0\n");
    for part in parts {
        let _ = writeln!(text, "file '{}'", part.name);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::probe::Kind;

    fn stream(width: u32, height: u32, fps: f64, pixel_format: &str) -> Stream {
        Stream {
            index: 0,
            kind: Kind::Video,
            codec: "h264".into(),
            cover: false,
            width,
            height,
            rate: None,
            fps,
            pixel_format: pixel_format.into(),
            channels: 0,
            layout: String::new(),
            sample_rate: 0,
        }
    }

    #[test]
    fn pieces_fit_the_memory_budget() {
        // 1080p at 30 frames a second: a little under three seconds a piece.
        let hd = piece_length(&stream(1920, 1080, 30.0, "yuv420p"));
        assert!((2.8..2.95).contains(&hd), "{hd}");
        // 10-bit takes twice the memory, so half the length.
        let deep = piece_length(&stream(1920, 1080, 30.0, "yuv420p10le"));
        assert!((deep - hd / 2.0).abs() < 1e-9);
        assert_eq!(piece_length(&stream(64, 48, 25.0, "yuv420p")), MAX_PIECE);
        assert_eq!(
            piece_length(&stream(7680, 4320, 120.0, "yuv444p")),
            MIN_PIECE
        );
        assert_eq!(bytes_per_pixel("yuv422p"), 2.0);
        assert_eq!(bytes_per_pixel("gbrp12le"), 6.0);
    }

    #[test]
    fn lists_parts_for_the_concat_demuxer() {
        let part = |name: &str| Part {
            name: name.into(),
            seconds: 1.0,
        };
        let (a, b) = (part("picture-00001.mp4"), part("picture-00000.mp4"));
        assert_eq!(
            concat_list(&[&a, &b]),
            "ffconcat version 1.0\nfile 'picture-00001.mp4'\nfile 'picture-00000.mp4'\n"
        );
    }
}
