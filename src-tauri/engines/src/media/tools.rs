// SPDX-License-Identifier: MIT
//! The video and audio tools of SPEC 5.5. Each writes `run.dest` (or files inside it, for the
//! folder tools) in the input's own format, re-encoding with the input's codecs where Kento has
//! an encoder for them and with the format's defaults otherwise (see `codec`).

use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use super::codec::Container;
use super::convert::{apply, Audio, Recipe, Video};
use super::preview::grab;
use super::probe::{self, Probe, Stream};
use super::run::{self, secs, Cmd, Watch};
use super::{Area, Channels, Hide, Loudness, Redaction, Span, SplitAt, Tool, ToolRun, Visual};
use crate::{Error, Result};

/// Silence quieter than this counts as silence when trimming it away.
const SILENCE: &str = "-50dB";
/// The shortest part Split video writes, and how close a cut may come to either end.
const MIN_PART: f64 = 0.05;
/// More parts than this is surely a mistake (a tiny interval on a long video).
const MAX_PARTS: usize = 1000;

pub(super) fn run(run: &ToolRun) -> Result<Vec<PathBuf>> {
    let job = Job {
        ffmpeg: run.tools.ffmpeg()?,
        ffprobe: run.tools.ffprobe()?,
        run,
    };
    let input = run
        .inputs
        .first()
        .ok_or_else(|| Error::Other("no input file".into()))?;
    tracing::debug!(
        tool = run.tool.id(),
        inputs = run.inputs.len(),
        "running a media tool"
    );
    match run.tool {
        Tool::Mute => job.mute(input),
        Tool::TrimVideo { span } => job.trim(input, *span),
        Tool::CropVideo { area } => job.crop(input, *area),
        Tool::Speed { factor } => job.speed(input, *factor),
        Tool::MergeVideos => job.merge(),
        Tool::Frames { at } => job.frames(input, at),
        Tool::SplitVideo { at, keep } => job.split(input, at, keep.as_deref()),
        Tool::RedactVideo { areas, hide } => job.redact_video(input, areas, *hide),
        Tool::Normalize { loudness } => job.normalize(input, *loudness),
        Tool::TrimAudio {
            span,
            remove_silence,
        } => job.trim_audio(input, *span, *remove_silence),
        Tool::Channels { channels } => job.channels(input, *channels),
        Tool::RedactAudio { spans, beep } => job.redact_audio(input, spans, *beep),
        Tool::AudioToVideo { visual } => job.audio_to_video(input, visual),
    }
}

struct Job<'a, 'b> {
    ffmpeg: &'a Path,
    ffprobe: &'a Path,
    run: &'a ToolRun<'b>,
}

impl<'b> Job<'_, 'b> {
    fn probe(&self, input: &Path) -> Result<Probe> {
        probe::probe(self.ffprobe, input)
    }

    /// The input's own format, which the result keeps.
    fn container(&self, input: &Path, probe: &Probe) -> Result<Container> {
        Container::from_path(input)
            .or_else(|| Container::from_format(&probe.format))
            .filter(|container| *container != Container::Gif)
            .ok_or_else(|| Error::Unsupported {
                from: input
                    .extension()
                    .map(|ext| ext.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                to: self.run.tool.id().to_owned(),
            })
    }

    fn watch(&self, span: f64) -> Watch<'b> {
        Watch::new(self.run.progress, span)
    }

    fn dest(&self) -> Vec<PathBuf> {
        vec![self.run.dest.to_path_buf()]
    }

    /// Finishes `cmd` (which has its inputs) with the streams of `recipe` and runs it.
    fn encode(
        &self,
        mut cmd: Cmd,
        probe: &Probe,
        recipe: &Recipe,
        after: &[String],
        dest: &Path,
        watch: Watch,
    ) -> Result<()> {
        apply(&mut cmd, probe, recipe)?;
        cmd.args(after);
        recipe.container.muxer_args(&mut cmd);
        cmd.output(recipe.container.muxer(), dest);
        run::run(self.ffmpeg, &cmd, watch)?;
        Ok(())
    }

    /// One pass over the whole input, with a filter on the picture or the sound.
    fn filter(
        &self,
        input: &Path,
        probe: &Probe,
        video: Video,
        audio: Audio,
        subtitles: bool,
        span: f64,
    ) -> Result<Vec<PathBuf>> {
        let recipe = Recipe {
            container: self.container(input, probe)?,
            video,
            audio,
            subtitles,
            graph: None,
        };
        let mut cmd = Cmd::new();
        cmd.input(input);
        self.encode(cmd, probe, &recipe, &[], self.run.dest, self.watch(span))?;
        Ok(self.dest())
    }

    /// The span from `start`, `length` seconds long, re-encoded so that it starts and ends on
    /// the exact frame. `-ss` before the input seeks fast and, since FFmpeg decodes from the
    /// keyframe before and drops everything ahead of `start`, accurately.
    #[allow(clippy::too_many_arguments)]
    fn cut(
        &self,
        input: &Path,
        probe: &Probe,
        container: Container,
        start: f64,
        length: f64,
        dest: &Path,
        watch: Watch,
    ) -> Result<()> {
        let mut cmd = Cmd::new();
        cmd.args(["-ss", &secs(start)]).input(input);
        let recipe = Recipe {
            container,
            video: Video::Encode {
                keep_codec: true,
                filter: None,
            },
            audio: Audio::Encode {
                keep_codec: true,
                filter: None,
            },
            subtitles: true,
            graph: None,
        };
        self.encode(
            cmd,
            probe,
            &recipe,
            &["-t".into(), secs(length)],
            dest,
            watch,
        )
    }

    fn mute(&self, input: &Path) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        probe.video().ok_or_else(no_video)?;
        self.filter(
            input,
            &probe,
            Video::Copy,
            Audio::Drop,
            true,
            probe.info.duration,
        )
    }

    fn trim(&self, input: &Path, span: Span) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let container = self.container(input, &probe)?;
        let (start, length) = window(span, probe.info.duration)?;
        self.cut(
            input,
            &probe,
            container,
            start,
            length,
            self.run.dest,
            self.watch(length),
        )?;
        Ok(self.dest())
    }

    fn crop(&self, input: &Path, area: Area) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let video = probe.video().ok_or_else(no_video)?;
        let rect = Rect::fit(area, video.width, video.height)
            .ok_or_else(|| Error::Other("the crop area is outside the picture".into()))?;
        let filter = format!("crop={}:{}:{}:{}", rect.w, rect.h, rect.x, rect.y);
        self.filter(
            input,
            &probe,
            Video::Encode {
                keep_codec: true,
                filter: Some(filter),
            },
            Audio::Copy,
            true,
            probe.info.duration,
        )
    }

    fn speed(&self, input: &Path, factor: f64) -> Result<Vec<PathBuf>> {
        if !factor.is_finite() || factor <= 0.0 {
            return Err(Error::Other("the speed must be between 0.25 and 4".into()));
        }
        let factor = factor.clamp(0.25, 4.0);
        let probe = self.probe(input)?;
        let mut picture = format!("setpts=PTS/{factor}");
        // Keeps the frame rate: a faster video drops frames, a slower one repeats them.
        if let Some(rate) = probe.video().and_then(|video| video.rate.as_deref()) {
            picture.push_str(&format!(",fps={rate}"));
        }
        // Subtitles would keep their old times, so they are left out.
        self.filter(
            input,
            &probe,
            Video::Encode {
                keep_codec: true,
                filter: Some(picture),
            },
            Audio::Encode {
                keep_codec: true,
                filter: Some(atempo(factor)),
            },
            false,
            probe.info.duration / factor,
        )
    }

    /// The first input sets the size (others are scaled to fit and padded, keeping their
    /// shape), the frame rate and mono or stereo; the sound is resampled to 48 kHz, and inputs
    /// without sound get silence. The result has the first input's format with that format's
    /// encoders.
    fn merge(&self) -> Result<Vec<PathBuf>> {
        let inputs = self.run.inputs;
        let probes = inputs
            .iter()
            .map(|input| self.probe(input))
            .collect::<Result<Vec<_>>>()?;
        let container = self.container(&inputs[0], &probes[0])?;
        let first = probes[0].video().ok_or_else(no_video)?;
        let (w, h) = (
            even(first.width as f64).max(2),
            even(first.height as f64).max(2),
        );
        let rate = first
            .rate
            .clone()
            .filter(|_| first.fps <= 240.0)
            .unwrap_or_else(|| "30".to_owned());
        let sound = probes.iter().any(|probe| probe.audio().is_some());
        let layout = match probes[0].audio() {
            Some(audio) if audio.channels == 1 => "mono",
            _ => "stereo",
        };
        let mut graph = String::new();
        let mut pads = String::new();
        for (i, probe) in probes.iter().enumerate() {
            let video = probe.video().ok_or_else(|| {
                Error::Other(format!(
                    "{} has no video",
                    inputs[i].file_name().unwrap_or_default().to_string_lossy()
                ))
            })?;
            graph.push_str(&format!(
                "[{i}:{}]scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2,\
                 pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={rate},format=yuv420p[v{i}];",
                video.index
            ));
            pads.push_str(&format!("[v{i}]"));
            if sound {
                match probe.audio() {
                    Some(audio) => graph.push_str(&format!(
                        "[{i}:{}]aresample=48000,\
                         aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts={layout}[a{i}];",
                        audio.index
                    )),
                    None => graph.push_str(&format!(
                        "anullsrc=channel_layout={layout}:sample_rate=48000,\
                         atrim=duration={}[a{i}];",
                        secs(probe.info.duration)
                    )),
                }
                pads.push_str(&format!("[a{i}]"));
            }
        }
        graph.push_str(&format!(
            "{pads}concat=n={}:v=1:a={}[v]{}",
            probes.len(),
            u8::from(sound),
            if sound { "[a]" } else { "" }
        ));
        let mut cmd = Cmd::new();
        for input in inputs {
            cmd.input(input);
        }
        let recipe = Recipe {
            container,
            video: Video::Graph,
            audio: if sound {
                Audio::Graph { keep_codec: false }
            } else {
                Audio::Drop
            },
            subtitles: false,
            graph: Some(graph),
        };
        let span = probes.iter().map(|probe| probe.info.duration).sum();
        self.encode(
            cmd,
            &probes[0],
            &recipe,
            &[],
            self.run.dest,
            self.watch(span),
        )?;
        Ok(self.dest())
    }

    /// PNG files named `<name>-<hh-mm-ss.mmm>.png`; the same moment twice gives one file.
    fn frames(&self, input: &Path, at: &[f64]) -> Result<Vec<PathBuf>> {
        if at.is_empty() {
            return Err(Error::Other("no moment was chosen".into()));
        }
        let probe = self.probe(input)?;
        probe.video().ok_or_else(no_video)?;
        let duration = probe.info.duration;
        let mut seen = HashSet::new();
        let mut written = Vec::new();
        for (i, &time) in at.iter().enumerate() {
            self.run.progress.check()?;
            if !time.is_finite() {
                continue;
            }
            let time = if duration > 0.0 {
                time.clamp(0.0, duration)
            } else {
                time.max(0.0)
            };
            let suffix = format!("-{}.png", stamp(time));
            if !seen.insert(suffix.clone()) {
                continue;
            }
            let png = grab(self.ffmpeg, input, time, None)?;
            let path = self.run.dest.join(named(input, &suffix));
            fs::write(&path, png)?;
            written.push(path);
            self.run.progress.report((i + 1) as f32 / at.len() as f32);
        }
        if written.is_empty() {
            return Err(Error::Other("no moment was chosen".into()));
        }
        Ok(written)
    }

    /// Parts `<name>-<n>.<ext>`, numbered from 1 with zeros in front so they sort, and with
    /// their numbers kept when parts are dropped. Every cut is frame-accurate (see `cut`).
    fn split(&self, input: &Path, at: &SplitAt, keep: Option<&[bool]>) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let container = self.container(input, &probe)?;
        let duration = probe.info.duration;
        if duration <= 0.0 {
            return Err(Error::Other("the video has no length to split".into()));
        }
        let parts = parts(at, duration)?;
        let kept: Vec<usize> = (0..parts.len())
            .filter(|&i| keep.is_none_or(|keep| keep.get(i).copied().unwrap_or(true)))
            .collect();
        if kept.is_empty() {
            return Err(Error::Other("every part was left out".into()));
        }
        let width = parts.len().to_string().len().max(2);
        let ext = input
            .extension()
            .map(|ext| ext.to_string_lossy().into_owned())
            .unwrap_or_else(|| container.id().to_owned());
        let total: f64 = kept.iter().map(|&i| parts[i].1 - parts[i].0).sum();
        let watch = self.watch(total);
        let mut done = 0.0;
        let mut written = Vec::new();
        for i in kept {
            let (start, end) = parts[i];
            let length = end - start;
            let path = self
                .run
                .dest
                .join(named(input, &format!("-{:0width$}.{ext}", i + 1)));
            let part = watch.part(done / total, (done + length) / total, length);
            self.cut(input, &probe, container, start, length, &path, part)?;
            done += length;
            written.push(path);
        }
        Ok(written)
    }

    fn redact_video(&self, input: &Path, areas: &[Redaction], hide: Hide) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let video = probe.video().ok_or_else(no_video)?;
        let boxes: Vec<(Rect, f64, f64)> = areas
            .iter()
            .filter_map(|redaction| {
                let rect = Rect::fit(redaction.area, video.width, video.height)?;
                let (start, end) = times(redaction.span, probe.info.duration)?;
                Some((rect, start, end))
            })
            .collect();
        if boxes.is_empty() {
            return Err(Error::Other("there is nothing to hide".into()));
        }
        self.filter(
            input,
            &probe,
            Video::Encode {
                keep_codec: true,
                filter: Some(redaction(&boxes, hide)),
            },
            Audio::Copy,
            true,
            probe.info.duration,
        )
    }

    /// EBU R128 in two passes: the first measures, the second applies a linear gain with the
    /// measured values (loudnorm falls back to its dynamic mode only when the target range is
    /// narrower than the file's). loudnorm works at 192 kHz, so the result is resampled back.
    /// The first audio track is measured; a video with several tracks gets its gain on each.
    fn normalize(&self, input: &Path, loudness: Loudness) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let audio = probe.audio().ok_or_else(no_sound)?;
        let target = target(loudness);
        let duration = probe.info.duration;
        let watch = self.watch(duration);
        let measured = self.measure(input, audio, &target, watch.part(0.0, 0.5, duration))?;
        let rate = if audio.sample_rate > 0 {
            audio.sample_rate
        } else {
            48_000
        };
        let filter = format!(
            "loudnorm=I={}:LRA={}:TP={}:measured_I={}:measured_LRA={}:measured_TP={}:\
             measured_thresh={}:offset={}:linear=true,aresample={rate}",
            target.target,
            target.range,
            target.peak,
            measured.i,
            measured.lra,
            measured.tp,
            measured.thresh,
            measured.offset
        );
        let recipe = Recipe {
            container: self.container(input, &probe)?,
            video: Video::Copy,
            audio: Audio::Encode {
                keep_codec: true,
                filter: Some(filter),
            },
            subtitles: true,
            graph: None,
        };
        let mut cmd = Cmd::new();
        cmd.input(input);
        self.encode(
            cmd,
            &probe,
            &recipe,
            &[],
            self.run.dest,
            watch.part(0.5, 1.0, duration),
        )?;
        Ok(self.dest())
    }

    fn measure(
        &self,
        input: &Path,
        audio: &Stream,
        target: &Loudness,
        watch: Watch,
    ) -> Result<Measured> {
        let mut cmd = Cmd::new();
        cmd.input(input)
            .map(audio.index)
            .arg("-filter:a:0")
            .arg(format!(
                "loudnorm=I={}:LRA={}:TP={}:print_format=json",
                target.target, target.range, target.peak
            ))
            .args(["-f", "null", "-"])
            .verbose(None);
        let log = run::run(self.ffmpeg, &cmd, watch)?;
        Measured::parse(&log.tail)
    }

    fn trim_audio(&self, input: &Path, span: Span, remove_silence: bool) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let audio = probe.audio().ok_or_else(no_sound)?;
        let container = self.container(input, &probe)?;
        let (mut start, mut length) = window(span, probe.info.duration)?;
        let watch = self.watch(length);
        let mut write = watch;
        if remove_silence {
            let (lead, tail) =
                self.sound(input, audio, start, length, watch.part(0.0, 0.3, length))?;
            if tail - lead < 0.01 {
                return Err(Error::Other("the selection is silent".into()));
            }
            start += lead;
            length = tail - lead;
            write = watch.part(0.3, 1.0, length);
        }
        self.cut(
            input,
            &probe,
            container,
            start,
            length,
            self.run.dest,
            write,
        )?;
        Ok(self.dest())
    }

    /// Where the sound begins and ends inside the span, by `silencedetect`, in seconds from
    /// `start`.
    fn sound(
        &self,
        input: &Path,
        audio: &Stream,
        start: f64,
        length: f64,
        watch: Watch,
    ) -> Result<(f64, f64)> {
        let mut cmd = Cmd::new();
        cmd.args(["-ss", &secs(start)])
            .input(input)
            .map(audio.index)
            .args(["-t", &secs(length)])
            .arg("-filter:a:0")
            .arg(format!("silencedetect=noise={SILENCE}:duration=0.05"))
            .args(["-f", "null", "-"])
            .verbose(Some("silence_"));
        let log = run::run(self.ffmpeg, &cmd, watch)?;
        Ok(sound_bounds(&log.kept, length))
    }

    fn channels(&self, input: &Path, channels: Channels) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let audio = probe.audio().ok_or_else(no_sound)?;
        let filter = match channels {
            Channels::Mono => "aformat=channel_layouts=mono".to_owned(),
            Channels::Stereo => "aformat=channel_layouts=stereo".to_owned(),
            Channels::Levels { left, right } => {
                let (l, r) = (level(left), level(right));
                if audio.channels == 1 {
                    format!("pan=stereo|c0={l:.3}*c0|c1={r:.3}*c0")
                } else {
                    // Surround is folded to stereo first, so left and right mean what they say.
                    let fold = if audio.channels > 2 {
                        "aformat=channel_layouts=stereo,"
                    } else {
                        ""
                    };
                    format!("{fold}pan=stereo|c0={l:.3}*c0|c1={r:.3}*c1")
                }
            }
        };
        self.filter(
            input,
            &probe,
            Video::Copy,
            Audio::Encode {
                keep_codec: true,
                filter: Some(filter),
            },
            true,
            probe.info.duration,
        )
    }

    /// Silence: the volume drops to 0 in the spans. Beep: a 1 kHz tone at -12 dBFS (the `sine`
    /// source plays at 1/8 of full scale, doubled here), gated to the spans, is mixed over the
    /// silenced sound.
    fn redact_audio(&self, input: &Path, spans: &[Span], beep: bool) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let audio = probe.audio().ok_or_else(no_sound)?;
        let duration = probe.info.duration;
        let gate = spans
            .iter()
            .filter_map(|span| times(*span, duration))
            .map(|(start, end)| format!("between(t,{start:.3},{end:.3})"))
            .collect::<Vec<_>>()
            .join("+");
        if gate.is_empty() {
            return Err(Error::Other("there is nothing to hide".into()));
        }
        let mute = format!("volume=volume=0:enable='{gate}'");
        if !beep {
            return self.filter(
                input,
                &probe,
                Video::Copy,
                Audio::Encode {
                    keep_codec: true,
                    filter: Some(mute),
                },
                true,
                duration,
            );
        }
        let rate = if audio.sample_rate > 0 {
            audio.sample_rate
        } else {
            48_000
        };
        let length = if duration > 0.0 {
            format!(":duration={}", secs(duration + 1.0))
        } else {
            String::new()
        };
        let graph = format!(
            "[0:{index}]{mute}[muted];\
             sine=frequency=1000:sample_rate={rate}{length},volume=volume=2,\
             volume=volume=0:enable='not({gate})',\
             aformat=sample_rates={rate}:channel_layouts={layout}[tone];\
             [muted][tone]amix=inputs=2:duration=first:normalize=0[a]",
            index = audio.index,
            layout = layout(audio),
        );
        let recipe = Recipe {
            container: self.container(input, &probe)?,
            video: Video::Copy,
            audio: Audio::Graph { keep_codec: true },
            subtitles: true,
            graph: Some(graph),
        };
        let mut cmd = Cmd::new();
        cmd.input(input);
        self.encode(
            cmd,
            &probe,
            &recipe,
            &[],
            self.run.dest,
            self.watch(duration),
        )?;
        Ok(self.dest())
    }

    /// An H.264/AAC MP4: the waveform, a scrolling spectrum or frequency bars at 1280×720 and 30
    /// frames a second, or a still image (at most 1920 pixels a side, even, 5 frames a second,
    /// which is plenty for a picture that does not move).
    fn audio_to_video(&self, input: &Path, visual: &Visual) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let audio = probe.audio().ok_or_else(no_sound)?;
        let a = audio.index;
        let mut cmd = Cmd::new();
        cmd.input(input);
        let mut after: Vec<String> = Vec::new();
        let graph = match visual {
            Visual::Waveform => format!(
                "[0:{a}]aformat=channel_layouts=mono,\
                 showwaves=s=1280x720:mode=cline:rate=30:colors=0xE8EAED,format=yuv420p[v]"
            ),
            Visual::Spectrum => format!(
                "[0:{a}]showspectrum=s=1280x720:mode=combined:slide=scroll:color=intensity,\
                 fps=30,format=yuv420p[v]"
            ),
            // showfreqs sets its own rate: its frame times do not suit the `fps` filter.
            Visual::Bars => format!(
                "[0:{a}]aformat=channel_layouts=mono,\
                 showfreqs=s=1280x720:rate=30:mode=bar:ascale=log:fscale=log:colors=0xE8EAED,\
                 format=yuv420p[v]"
            ),
            Visual::Image { path } => {
                fs::metadata(path)?;
                // The looped picture is cut to the sound's length: `-shortest` alone may run on
                // for as long as FFmpeg buffers (10 s by default).
                if probe.info.duration > 0.0 {
                    cmd.args(["-t", &secs(probe.info.duration)]);
                }
                // `pattern_type none`: a `%` in the name is a character, not a number pattern.
                cmd.args([
                    "-f",
                    "image2",
                    "-pattern_type",
                    "none",
                    "-loop",
                    "1",
                    "-framerate",
                    "5",
                ])
                .input(path);
                after.extend(["-shortest", "-tune:v:0", "stillimage"].map(String::from));
                "[1:v]scale=w='min(iw,1920)':h='min(ih,1920)':\
                 force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p[v]"
                    .to_owned()
            }
        };
        let recipe = Recipe {
            container: Container::Mp4,
            video: Video::Graph,
            audio: Audio::Fit,
            subtitles: false,
            graph: Some(graph),
        };
        self.encode(
            cmd,
            &probe,
            &recipe,
            &after,
            self.run.dest,
            self.watch(probe.info.duration),
        )?;
        Ok(self.dest())
    }
}

fn no_video() -> Error {
    Error::Other("the file has no video".into())
}

fn no_sound() -> Error {
    Error::Other("the file has no sound".into())
}

/// `input`'s file name without its extension, followed by `suffix`.
fn named(input: &Path, suffix: &str) -> OsString {
    let mut name = input
        .file_stem()
        .map(|stem| stem.to_os_string())
        .unwrap_or_else(|| OsString::from("media"));
    name.push(suffix);
    name
}

/// `hh-mm-ss.mmm`, a time that can be part of a file name.
fn stamp(seconds: f64) -> String {
    let ms = (seconds.max(0.0) * 1000.0).round() as u64;
    format!(
        "{:02}-{:02}-{:02}.{:03}",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}

/// The start and length of a selection, inside the file.
fn window(span: Span, duration: f64) -> Result<(f64, f64)> {
    let (start, end) = times(span, duration)
        .filter(|(start, end)| end - start >= 0.01)
        .ok_or_else(|| Error::Other("the selection is empty".into()))?;
    Ok((start, end - start))
}

/// The start and end of a span, inside the file; `None` when nothing of it is left.
fn times(span: Span, duration: f64) -> Option<(f64, f64)> {
    if !span.start.is_finite() || !span.end.is_finite() {
        return None;
    }
    let start = span.start.max(0.0);
    let end = if duration > 0.0 {
        span.end.min(duration)
    } else {
        span.end
    };
    (end > start).then_some((start, end))
}

/// An area of the picture on even pixels, inside the frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Rect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

impl Rect {
    fn fit(area: Area, width: u32, height: u32) -> Option<Rect> {
        let values = [area.x, area.y, area.width, area.height];
        if values.iter().any(|value| !value.is_finite()) {
            return None;
        }
        let (fw, fh) = (f64::from(width), f64::from(height));
        let x = even(area.x.clamp(0.0, fw));
        let y = even(area.y.clamp(0.0, fh));
        let right = (area.x + area.width).clamp(0.0, fw).round();
        let bottom = (area.y + area.height).clamp(0.0, fh).round();
        let w = even(right - f64::from(x));
        let h = even(bottom - f64::from(y));
        (w >= 2 && h >= 2).then_some(Rect { x, y, w, h })
    }
}

/// Down to an even whole number, 0 at least.
fn even(value: f64) -> u32 {
    (value.max(0.0) as u32) / 2 * 2
}

/// The filters that hide `boxes` (each with its start and end) on the picture.
fn redaction(boxes: &[(Rect, f64, f64)], hide: Hide) -> String {
    if let Hide::Color { rgb: [r, g, b] } = hide {
        return boxes
            .iter()
            .map(|(rect, start, end)| {
                format!(
                    "drawbox=x={}:y={}:w={}:h={}:color=0x{r:02X}{g:02X}{b:02X}:t=fill:\
                     enable='between(t,{start:.3},{end:.3})'",
                    rect.x, rect.y, rect.w, rect.h
                )
            })
            .collect::<Vec<_>>()
            .join(",");
    }
    // Each area: a copy of the frame is cropped to it, blurred or pixelated, and laid back over
    // the frame while its span lasts.
    let mut graph = String::new();
    for (i, (rect, start, end)) in boxes.iter().enumerate() {
        if i > 0 {
            graph.push_str(&format!("[m{i}]"));
        }
        let effect = if hide == Hide::Blur {
            blur(rect)
        } else {
            pixelate(rect)
        };
        let Rect { x, y, w, h } = *rect;
        graph.push_str(&format!(
            "split[k{i}][c{i}];[c{i}]crop={w}:{h}:{x}:{y},{effect}[e{i}];\
             [k{i}][e{i}]overlay={x}:{y}:enable='between(t,{start:.3},{end:.3})'"
        ));
        if i + 1 < boxes.len() {
            graph.push_str(&format!("[m{}];", i + 1));
        }
    }
    graph
}

/// A strong box blur. The radii stay below what boxblur allows for the area (half its shorter
/// side for brightness, a quarter for the half-size colour planes).
fn blur(rect: &Rect) -> String {
    let side = rect.w.min(rect.h);
    let luma = (side / 2).saturating_sub(1).min(40);
    let chroma = (side / 4).saturating_sub(1).min(20);
    format!("boxblur=luma_radius={luma}:luma_power=3:chroma_radius={chroma}:chroma_power=3")
}

/// Blocks of about a twelfth of the area's longer side, 4 pixels at least.
fn pixelate(rect: &Rect) -> String {
    let block = (rect.w.max(rect.h) / 12).max(4);
    let (small_w, small_h) = (rect.w.div_ceil(block).max(1), rect.h.div_ceil(block).max(1));
    format!(
        "scale={small_w}:{small_h}:flags=area,scale={}:{}:flags=neighbor",
        rect.w, rect.h
    )
}

/// The cut points of Split video, as `(start, end)` parts covering the whole file.
fn parts(at: &SplitAt, duration: f64) -> Result<Vec<(f64, f64)>> {
    let too_many = || Error::Other(format!("more than {MAX_PARTS} parts"));
    let mut cuts: Vec<f64> = match at {
        SplitAt::Markers { at } => at.iter().copied().filter(|t| t.is_finite()).collect(),
        SplitAt::Parts { count } => {
            let count = (*count).max(1) as usize;
            if count > MAX_PARTS {
                return Err(too_many());
            }
            (1..count)
                .map(|i| duration * i as f64 / count as f64)
                .collect()
        }
        SplitAt::Every { seconds } => {
            if !seconds.is_finite() || *seconds < 0.1 {
                return Err(Error::Other("the interval is too short".into()));
            }
            let count = (duration / seconds).ceil() as usize;
            if count > MAX_PARTS {
                return Err(too_many());
            }
            (1..count).map(|i| i as f64 * seconds).collect()
        }
    };
    cuts.retain(|t| *t >= MIN_PART && *t <= duration - MIN_PART);
    cuts.sort_by(f64::total_cmp);
    cuts.dedup_by(|a, b| (*a - *b).abs() < MIN_PART);
    if cuts.len() >= MAX_PARTS {
        return Err(too_many());
    }
    let mut edges = vec![0.0];
    edges.extend(cuts);
    edges.push(duration);
    Ok(edges.windows(2).map(|pair| (pair[0], pair[1])).collect())
}

/// `atempo` stages, each within 0.5 to 2 so that every stage keeps the pitch cleanly.
fn atempo(mut factor: f64) -> String {
    let mut stages = Vec::new();
    while factor > 2.0 {
        stages.push(2.0);
        factor /= 2.0;
    }
    while factor < 0.5 {
        stages.push(0.5);
        factor /= 0.5;
    }
    stages.push(factor);
    stages
        .iter()
        .map(|stage| format!("atempo={stage}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// The targets within loudnorm's ranges; nonsense falls back to the defaults.
fn target(loudness: Loudness) -> Loudness {
    let fallback = Loudness::default();
    let pick = |value: f64, default: f64, min: f64, max: f64| {
        if value.is_finite() {
            value.clamp(min, max)
        } else {
            default
        }
    };
    Loudness {
        target: pick(loudness.target, fallback.target, -70.0, -5.0),
        range: pick(loudness.range, fallback.range, 1.0, 50.0),
        peak: pick(loudness.peak, fallback.peak, -9.0, 0.0),
    }
}

fn level(value: f32) -> f64 {
    if value.is_finite() {
        f64::from(value).clamp(0.0, 2.0)
    } else {
        1.0
    }
}

/// The channel layout of a stream, as the filters name it.
fn layout(audio: &Stream) -> String {
    if !audio.layout.is_empty() {
        return audio.layout.clone();
    }
    match audio.channels {
        0 | 2 => "stereo".to_owned(),
        1 => "mono".to_owned(),
        n => format!("{n}c"),
    }
}

/// What loudnorm's first pass measured.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Measured {
    i: f64,
    tp: f64,
    lra: f64,
    thresh: f64,
    offset: f64,
}

impl Measured {
    /// Reads loudnorm's JSON report, the last `{ … }` block of the log.
    fn parse(lines: &VecDeque<String>) -> Result<Measured> {
        let unreadable = || Error::Other("loudnorm gave no measurement".into());
        let open = lines
            .iter()
            .rposition(|line| line.trim_end().ends_with('{'))
            .ok_or_else(unreadable)?;
        let close = lines
            .iter()
            .skip(open)
            .position(|line| line.trim() == "}")
            .ok_or_else(unreadable)?
            + open;
        let mut json = String::from("{");
        for line in lines.range(open + 1..=close) {
            json.push_str(line);
            json.push('\n');
        }
        let report: HashMap<String, String> =
            serde_json::from_str(&json).map_err(|_| unreadable())?;
        let value = |key: &str| {
            report
                .get(key)
                .and_then(|value| value.trim().parse::<f64>().ok())
                .ok_or_else(unreadable)
        };
        let measured = Measured {
            i: value("input_i")?,
            tp: value("input_tp")?,
            lra: value("input_lra")?,
            thresh: value("input_thresh")?,
            offset: value("target_offset")?,
        };
        let finite = [
            measured.i,
            measured.tp,
            measured.lra,
            measured.thresh,
            measured.offset,
        ]
        .iter()
        .all(|value| value.is_finite());
        if !finite {
            return Err(Error::Other("the sound is silent".into()));
        }
        Ok(measured)
    }
}

/// Where the sound starts and ends within `length` seconds, from silencedetect's
/// `silence_start` and `silence_end` lines; silence at the very start or end is cut away.
fn sound_bounds(lines: &[String], length: f64) -> (f64, f64) {
    const EDGE: f64 = 0.05;
    let value = |line: &str, key: &str| -> Option<f64> {
        let rest = &line[line.find(key)? + key.len()..];
        rest.split(|c: char| c.is_whitespace() || c == '|')
            .find(|word| !word.is_empty())?
            .parse()
            .ok()
    };
    let mut silences: Vec<(f64, Option<f64>)> = Vec::new();
    for line in lines {
        if let Some(start) = value(line, "silence_start:") {
            silences.push((start, None));
        } else if let Some(end) = value(line, "silence_end:") {
            if let Some(last) = silences.last_mut() {
                last.1 = Some(end);
            }
        }
    }
    let mut lead = 0.0;
    let mut tail = length;
    if let Some(&(start, end)) = silences.first() {
        if start <= EDGE {
            lead = end.unwrap_or(length);
        }
    }
    if let Some(&(start, end)) = silences.last() {
        if end.is_none_or(|end| end >= length - EDGE) && start > EDGE {
            tail = start;
        }
    }
    (lead.min(length), tail.max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chains_atempo_within_its_range() {
        assert_eq!(atempo(1.5), "atempo=1.5");
        assert_eq!(atempo(4.0), "atempo=2,atempo=2");
        assert_eq!(atempo(3.0), "atempo=2,atempo=1.5");
        assert_eq!(atempo(0.25), "atempo=0.5,atempo=0.5");
        assert_eq!(atempo(0.3), "atempo=0.5,atempo=0.6");
    }

    #[test]
    fn cuts_into_parts() {
        let parts_of = |at: SplitAt| parts(&at, 10.0).unwrap();
        assert_eq!(
            parts_of(SplitAt::Parts { count: 4 }),
            [(0.0, 2.5), (2.5, 5.0), (5.0, 7.5), (7.5, 10.0)]
        );
        assert_eq!(
            parts_of(SplitAt::Every { seconds: 4.0 }),
            [(0.0, 4.0), (4.0, 8.0), (8.0, 10.0)]
        );
        assert_eq!(parts_of(SplitAt::Every { seconds: 5.0 }).len(), 2);
        assert_eq!(
            parts_of(SplitAt::Markers {
                at: vec![7.0, 3.0, 3.01, -1.0, 0.0, 10.0, f64::NAN, 12.0]
            }),
            [(0.0, 3.0), (3.0, 7.0), (7.0, 10.0)]
        );
        assert_eq!(parts_of(SplitAt::Markers { at: vec![] }), [(0.0, 10.0)]);
        assert!(parts(&SplitAt::Every { seconds: 0.0 }, 10.0).is_err());
        assert!(parts(&SplitAt::Every { seconds: 0.1 }, 1e6).is_err());
    }

    #[test]
    fn fits_areas_on_even_pixels() {
        let area = |x, y, width, height| Area {
            x,
            y,
            width,
            height,
        };
        assert_eq!(
            Rect::fit(area(11.6, 3.0, 50.9, 21.0), 160, 90),
            Some(Rect {
                x: 10,
                y: 2,
                w: 52,
                h: 22
            })
        );
        assert_eq!(
            Rect::fit(area(-20.0, 80.0, 400.0, 400.0), 160, 90),
            Some(Rect {
                x: 0,
                y: 80,
                w: 160,
                h: 10
            })
        );
        assert_eq!(Rect::fit(area(200.0, 0.0, 10.0, 10.0), 160, 90), None);
        assert_eq!(Rect::fit(area(0.0, 0.0, f64::NAN, 10.0), 160, 90), None);
    }

    #[test]
    fn names_frames_by_time() {
        assert_eq!(stamp(0.0), "00-00-00.000");
        assert_eq!(stamp(3723.4567), "01-02-03.457");
        assert_eq!(
            named(Path::new("C:/a/Kento ğüşıöç 🧪.mp4"), "-01.mp4"),
            OsString::from("Kento ğüşıöç 🧪-01.mp4")
        );
    }

    #[test]
    fn keeps_selections_inside_the_file() {
        let span = |start, end| Span { start, end };
        assert_eq!(window(span(-1.0, 2.0), 10.0).unwrap(), (0.0, 2.0));
        assert_eq!(window(span(8.0, 20.0), 10.0).unwrap(), (8.0, 2.0));
        assert!(window(span(5.0, 5.0), 10.0).is_err());
        assert!(window(span(12.0, 20.0), 10.0).is_err());
        assert!(window(span(f64::NAN, 1.0), 10.0).is_err());
    }

    #[test]
    fn reads_loudnorm_and_silencedetect() {
        let log: VecDeque<String> = [
            "[Parsed_loudnorm_0 @ 0000021f] ",
            "{",
            "\t\"input_i\" : \"-27.61\",",
            "\t\"input_tp\" : \"-24.08\",",
            "\t\"input_lra\" : \"0.00\",",
            "\t\"input_thresh\" : \"-37.61\",",
            "\t\"output_i\" : \"-16.04\",",
            "\t\"normalization_type\" : \"linear\",",
            "\t\"target_offset\" : \"0.04\"",
            "}",
            "[out#0/null @ 0000021f] video:0KiB audio:1KiB",
        ]
        .map(String::from)
        .into();
        let measured = Measured::parse(&log).unwrap();
        assert_eq!(measured.i, -27.61);
        assert_eq!(measured.offset, 0.04);

        let silent: VecDeque<String> = [
            "{",
            "\"input_i\" : \"-inf\",",
            "\"input_tp\" : \"-inf\",",
            "\"input_lra\" : \"0.00\",",
            "\"input_thresh\" : \"-inf\",",
            "\"target_offset\" : \"inf\"",
            "}",
        ]
        .map(String::from)
        .into();
        assert!(matches!(Measured::parse(&silent), Err(Error::Other(_))));

        let lines = [
            "[silencedetect @ 0x1] silence_start: 0",
            "[silencedetect @ 0x1] silence_end: 1.2 | silence_duration: 1.2",
            "[silencedetect @ 0x1] silence_start: 2.5",
            "[silencedetect @ 0x1] silence_end: 2.8 | silence_duration: 0.3",
            "[silencedetect @ 0x1] silence_start: 4.1",
        ]
        .map(String::from);
        assert_eq!(sound_bounds(&lines, 5.0), (1.2, 4.1));
        assert_eq!(sound_bounds(&lines[..4], 5.0), (1.2, 5.0));
        assert_eq!(sound_bounds(&[], 5.0), (0.0, 5.0));
        let all = ["silence_start: 0".to_owned()];
        let (lead, tail) = sound_bounds(&all, 5.0);
        assert!(tail <= lead);
    }

    #[test]
    fn builds_redaction_graphs() {
        let rect = Rect {
            x: 10,
            y: 20,
            w: 40,
            h: 30,
        };
        let color = redaction(&[(rect, 1.0, 2.0)], Hide::Color { rgb: [255, 0, 16] });
        assert!(color.contains("drawbox=x=10:y=20:w=40:h=30:color=0xFF0010:t=fill"));
        let blurred = redaction(&[(rect, 1.0, 2.0), (rect, 3.0, 4.0)], Hide::Blur);
        assert!(blurred.starts_with("split[k0][c0]"));
        assert!(blurred.contains("[m1];[m1]split[k1][c1]"));
        assert!(blurred.contains("boxblur=luma_radius=14:luma_power=3:chroma_radius=6"));
        assert!(
            !blurred.ends_with(']'),
            "the last overlay is the graph's output"
        );
        let pixelated = redaction(&[(rect, 0.0, 1.0)], Hide::Pixelate);
        assert!(pixelated.contains("scale=10:8:flags=area,scale=40:30:flags=neighbor"));
    }
}
