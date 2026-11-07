// SPDX-License-Identifier: MIT
//! The tools that work on time and sound, for video and audio alike: Cut out, Remove pauses, Add
//! music, Fade and volume, Remove noise, Merge audio and Make a ringtone.
//!
//! Which sound they work on: Cut out parts and Remove pauses cut every audio track of a video
//! (they must stay in step with the picture), and Remove pauses listens to the first one; Fade
//! and volume and Remove noise change every track; Add music mixes the music into the first
//! track and leaves the others out (the result has one sound, as players pick the first);
//! Merge audio and Make a ringtone take the first track of each file.

use std::fs;
use std::path::{Path, PathBuf};

use super::{layout, no_sound, no_video, times, window, Job};
use crate::media::codec::{AudioCodec, Container, VideoCodec};
use crate::media::convert::{Audio, Recipe, Video, EVEN};
use crate::media::probe::{self, Probe, Stream};
use crate::media::run::{self, secs, Cmd, Watch};
use crate::media::{Mix, Pauses, RingFormat, Span, Strength};
use crate::{Error, Progress, Result, Tools};

/// The fade at both sides of every cut, so the sound never clicks where two pieces meet.
const CUT_FADE: f64 = 0.01;
/// Kept pieces shorter than this are cut away with their neighbours: they would only be a blip.
const MIN_PIECE: f64 = 0.02;
/// A pause shorter than this, once its margins are kept, is left alone.
const MIN_PAUSE: f64 = 0.05;
/// Silence that starts or ends this close to an end of the file starts or ends it.
const EDGE: f64 = 0.05;
/// Filter graphs longer than this are read from a file: a long list of cuts would pass the
/// 32,767 characters Windows allows a whole command line.
const INLINE_GRAPH: usize = 16_000;
/// Music up to this long is looped in memory (about 46 MB of stereo at 48 kHz); longer music is
/// read again from the file for each repeat instead.
const LOOP_IN_MEMORY: f64 = 120.0;
/// Add music's levels, in dB.
const LEVEL_MIN: f64 = -30.0;
const LEVEL_MAX: f64 = 6.0;
/// The longest fade of Fade and volume, and its level range in dB.
const FADE_MAX: f64 = 10.0;
const VOLUME_MAX: f64 = 20.0;
/// The longest crossfade of Merge audio.
const CROSSFADE_MAX: f64 = 10.0;
/// The longest ringtone, and its fades.
const RINGTONE_MAX: f64 = 40.0;
const RINGTONE_FADE: f64 = 0.5;
/// A louder result is limited to about -1 dBFS, which leaves lossy encoders room to never clip.
const LIMIT: &str = "alimiter=limit=0.891:level=0:latency=1";

impl Job<'_, '_> {
    pub(super) fn cut_out(&self, input: &Path, spans: &[Span]) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let duration = length_of(&probe)?;
        if spans.is_empty() {
            return Err(Error::Other("no part was chosen".into()));
        }
        let pieces = kept(spans, duration);
        if pieces.is_empty() {
            return Err(nothing_left());
        }
        if untouched(&pieces, duration) {
            return Err(Error::Other("there is nothing to cut out".into()));
        }
        let watch = self.watch(total(&pieces));
        self.cut_pieces(input, &probe, &pieces, watch)?;
        Ok(self.dest())
    }

    /// The pauses are found first (a fifth of the bar), then cut out like Cut out parts.
    pub(super) fn remove_pauses(&self, input: &Path, pauses: Pauses) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let duration = length_of(&probe)?;
        let watch = self.watch(duration);
        let spans = find_pauses(
            self.ffmpeg,
            input,
            &probe,
            pauses,
            watch.part(0.0, 0.2, duration),
        )?;
        if spans.is_empty() {
            return Err(Error::Other("no pauses were found".into()));
        }
        let pieces = kept(&spans, duration);
        if pieces.is_empty() {
            return Err(nothing_left());
        }
        let length = total(&pieces);
        self.cut_pieces(input, &probe, &pieces, watch.part(0.2, 1.0, length))?;
        Ok(self.dest())
    }

    /// Keeps `pieces` of the input and joins them in one filter graph (ARCHITECTURE 55): the
    /// picture with the input's codec where Kento has its encoder, every audio track with its
    /// own. Subtitles and chapters are left out, since their times would no longer match.
    fn cut_pieces(
        &self,
        input: &Path,
        probe: &Probe,
        pieces: &[(f64, f64)],
        watch: Watch,
    ) -> Result<()> {
        let container = self.container(input, probe)?;
        let video = probe.video().filter(|_| !container.audio_only());
        let take = if container.audio_only() {
            1
        } else {
            usize::MAX
        };
        let audios: Vec<&Stream> = probe.audios().take(take).collect();
        if video.is_none() && audios.is_empty() {
            return Err(no_sound());
        }
        let picture = video
            .map(|video| {
                VideoCodec::like(&video.codec)
                    .or(container.video())
                    .map(|codec| (video, codec))
                    .ok_or_else(|| Error::Other("this format holds no video".into()))
            })
            .transpose()?;
        let even = picture.is_some_and(|(video, codec)| {
            codec.even() && (video.width % 2 == 1 || video.height % 2 == 1)
        });
        let graph = cut_graph(
            pieces,
            video.map(|video| video.index),
            &audios.iter().map(|audio| audio.index).collect::<Vec<_>>(),
            probe.info.duration,
            even,
        );
        let mut sounds = Vec::new();
        for audio in &audios {
            let codec = AudioCodec::like(&audio.codec, container)
                .or(container.audio())
                .ok_or_else(|| Error::Other("this format holds no sound".into()))?;
            sounds.push((*audio, codec));
        }
        self.run_graph(
            input,
            &graph,
            &|cmd: &mut Cmd| {
                if let Some((_, codec)) = picture {
                    cmd.args(["-map", "[v]"]);
                    codec.push(cmd, container);
                }
                for (k, &(audio, codec)) in sounds.iter().enumerate() {
                    cmd.arg("-map").arg(audio_label(k));
                    codec.push(cmd, k, Some(audio));
                }
                cmd.args(["-map_chapters", "-1"]);
                container.muxer_args(cmd);
                cmd.output(container.muxer(), self.run.dest);
            },
            watch,
        )
    }

    /// Runs FFmpeg on `input` with `graph` as its `-filter_complex`, then `outputs`: the graph
    /// goes on the command line when it is short, otherwise into a file in the job's folder.
    /// FFmpeg 7 and later read that file with `-/filter_complex`; older versions know only
    /// `-filter_complex_script`, which newer ones have dropped, so a refusal of the first is
    /// answered with the second.
    fn run_graph(
        &self,
        input: &Path,
        graph: &str,
        outputs: &dyn Fn(&mut Cmd),
        watch: Watch,
    ) -> Result<()> {
        let build = |option: &str, value: &dyn AsRef<std::ffi::OsStr>| {
            let mut cmd = Cmd::new();
            cmd.input(input).arg(option).arg(value);
            outputs(&mut cmd);
            cmd
        };
        if graph.len() <= INLINE_GRAPH {
            run::run(self.ffmpeg, &build("-filter_complex", &graph), watch)?;
            return Ok(());
        }
        let script = self.run.temp.join("graph.txt");
        fs::write(&script, graph)?;
        match run::run(self.ffmpeg, &build("-/filter_complex", &script), watch) {
            Err(Error::Other(message)) if message.contains("/filter_complex") => {
                run::run(
                    self.ffmpeg,
                    &build("-filter_complex_script", &script),
                    watch,
                )?;
                Ok(())
            }
            other => other.map(|_| ()),
        }
    }

    /// The video's picture is copied and its sound is mixed with the music (or replaced by it),
    /// encoded with the container's own codec. The result lasts as long as the video.
    pub(super) fn add_music(&self, input: &Path, music: &Path, mix: Mix) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        probe.video().ok_or_else(no_video)?;
        let length = length_of(&probe)?;
        let tune = self.probe(music)?;
        let song = tune
            .audio()
            .ok_or_else(|| Error::Other("the music has no sound".into()))?;
        let mix = settle_mix(mix, length);
        let left = tune.info.duration - mix.offset;
        if tune.info.duration > 0.0 && left < MIN_PIECE {
            return Err(Error::Other("the music starts after its end".into()));
        }
        // Without a known length the music plays once, as far as it goes.
        let left = if tune.info.duration > 0.0 {
            left
        } else {
            f64::INFINITY
        };
        let original = probe.audio().filter(|_| !mix.replace);
        let (rate, layout) = match original {
            Some(audio) => (rate_of(audio), layout(audio)),
            None => (
                rate_of(song),
                if song.channels == 1 { "mono" } else { "stereo" }.to_owned(),
            ),
        };
        let plan = MusicPlan {
            length,
            left,
            rate,
            layout,
            music: song.index,
            original: original.map(|audio| audio.index),
            repeat: repeat(&mix, left, length, rate),
            mix,
        };
        let mut cmd = Cmd::new();
        cmd.input(input);
        for _ in 0..plan.repeat.inputs() {
            if mix.offset > 0.0 {
                cmd.args(["-ss", &secs(mix.offset)]);
            }
            cmd.input(music);
        }
        let recipe = Recipe {
            container: self.container(input, &probe)?,
            video: Video::Copy,
            audio: Audio::Graph { keep_codec: false },
            subtitles: true,
            graph: Some(music_graph(&plan)),
        };
        self.encode(cmd, &probe, &recipe, &[], self.run.dest, self.watch(length))?;
        Ok(self.dest())
    }

    /// The picture is re-encoded only when it fades too; the sound of every track is faded and
    /// leveled, with a limiter when it gets louder.
    pub(super) fn fade(
        &self,
        input: &Path,
        fade_in: f64,
        fade_out: f64,
        picture: bool,
        volume: f64,
    ) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let duration = probe.info.duration;
        let container = self.container(input, &probe)?;
        let fades = Fades::new(fade_in, fade_out, duration);
        let volume = finite(volume, 0.0).clamp(-VOLUME_MAX, VOLUME_MAX);
        let has_video = probe.video().is_some() && !container.audio_only();
        let picture = picture && has_video && fades.any();
        let has_sound = probe.audio().is_some();
        let sound_changes = fades.any() || volume.abs() >= 0.05;
        if !has_sound && !picture {
            return Err(no_sound());
        }
        if !picture && !sound_changes {
            return Err(Error::Other("there is nothing to change".into()));
        }
        let video = if picture {
            Video::Encode {
                keep_codec: true,
                filter: Some(fades.chain("fade")),
            }
        } else {
            Video::Copy
        };
        let audio = if has_sound && sound_changes {
            Audio::Encode {
                keep_codec: true,
                filter: Some(fade_chain(&fades, volume)),
            }
        } else {
            Audio::Copy
        };
        self.filter(input, &probe, video, audio, true, duration)
    }

    /// FFmpeg's FFT noise reduction (see `denoise_filter`); the picture is copied.
    pub(super) fn denoise(
        &self,
        input: &Path,
        strength: Strength,
        rumble: bool,
    ) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        probe.audio().ok_or_else(no_sound)?;
        self.filter(
            input,
            &probe,
            Video::Copy,
            Audio::Encode {
                keep_codec: true,
                filter: Some(denoise_filter(strength, rumble)),
            },
            true,
            probe.info.duration,
        )
    }

    /// The files in order, each resampled to the first one's rate and channel layout, joined end
    /// to end or overlapping by an equal-power crossfade. The result has the first file's format
    /// and codec; cover art is left out.
    pub(super) fn merge_audio(&self, crossfade: f64) -> Result<Vec<PathBuf>> {
        let inputs = self.run.inputs;
        if inputs.len() < 2 {
            return Err(Error::Other("joining needs two audio files or more".into()));
        }
        let probes = inputs
            .iter()
            .map(|input| self.probe(input))
            .collect::<Result<Vec<_>>>()?;
        let container = self.container(&inputs[0], &probes[0])?;
        if !container.audio_only() {
            return Err(Error::Other("Merge audio takes audio files".into()));
        }
        let mut streams = Vec::new();
        for (input, probe) in inputs.iter().zip(&probes) {
            let audio = probe.audio().ok_or_else(|| {
                Error::Other(format!(
                    "{} has no sound",
                    input.file_name().unwrap_or_default().to_string_lossy()
                ))
            })?;
            streams.push(audio.index);
        }
        let first = probes[0].audio().ok_or_else(no_sound)?;
        let lengths: Vec<f64> = probes.iter().map(|probe| probe.info.duration).collect();
        let overlap = crossfade_for(crossfade, &lengths);
        let graph = merge_graph(&streams, rate_of(first), &layout(first), overlap);
        let mut cmd = Cmd::new();
        for input in inputs {
            cmd.input(input);
        }
        let recipe = Recipe {
            container,
            video: Video::Copy,
            audio: Audio::Graph { keep_codec: true },
            subtitles: false,
            graph: Some(graph),
        };
        let span = lengths.iter().sum::<f64>() - overlap * (lengths.len() - 1) as f64;
        self.encode(
            cmd,
            &probes[0],
            &recipe,
            &["-map_chapters".into(), "-1".into()],
            self.run.dest,
            self.watch(span),
        )?;
        Ok(self.dest())
    }

    /// At most 40 seconds of the first audio track, faded in and out over half a second, as AAC
    /// in an MPEG-4 file (FFmpeg's `ipod` muxer, chosen by name, since an .m4r name selects
    /// nothing) or as an MP3. Surround becomes stereo.
    pub(super) fn ringtone(
        &self,
        input: &Path,
        span: Span,
        fade: bool,
        format: RingFormat,
    ) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let audio = probe.audio().ok_or_else(no_sound)?;
        let (start, length) = window(span, probe.info.duration)?;
        let length = length.min(RINGTONE_MAX);
        let container = match format {
            RingFormat::M4r => Container::M4a,
            RingFormat::Mp3 => Container::Mp3,
        };
        let mut chain = Vec::new();
        if audio.channels > 2 {
            chain.push("aformat=channel_layouts=stereo".to_owned());
        }
        if fade {
            // A very short ringtone keeps most of its sound.
            let seconds = RINGTONE_FADE.min(length / 4.0);
            chain.push(Fades::new(seconds, seconds, length).chain("afade"));
        }
        let mut cmd = Cmd::new();
        cmd.args(["-ss", &secs(start)]).input(input);
        let recipe = Recipe {
            container,
            video: Video::Copy,
            audio: Audio::Encode {
                keep_codec: false,
                filter: (!chain.is_empty()).then(|| chain.join(",")),
            },
            subtitles: false,
            graph: None,
        };
        self.encode(
            cmd,
            &probe,
            &recipe,
            &[
                "-t".into(),
                secs(length),
                "-map_chapters".into(),
                "-1".into(),
            ],
            self.run.dest,
            self.watch(length),
        )?;
        Ok(self.dest())
    }
}

/// See `media::pauses`.
pub(in crate::media) fn pauses(
    tools: &Tools,
    input: &Path,
    pauses: Pauses,
    progress: &Progress,
) -> Result<Vec<Span>> {
    let ffmpeg = tools.ffmpeg()?;
    let probe = probe::probe(tools.ffprobe()?, input)?;
    let duration = length_of(&probe)?;
    find_pauses(
        ffmpeg,
        input,
        &probe,
        pauses,
        Watch::new(progress, duration),
    )
}

/// `silencedetect` on the first audio track, its silences turned into the spans Remove pauses
/// cuts (see `pause_spans`).
fn find_pauses(
    ffmpeg: &Path,
    input: &Path,
    probe: &Probe,
    pauses: Pauses,
    watch: Watch,
) -> Result<Vec<Span>> {
    let audio = probe.audio().ok_or_else(no_sound)?;
    let pauses = settle_pauses(pauses);
    let mut cmd = Cmd::new();
    cmd.input(input)
        .map(audio.index)
        .arg("-filter:a:0")
        .arg(detect_filter(pauses))
        .args(["-f", "null", "-"])
        .verbose(Some("silence_"));
    let log = run::run(ffmpeg, &cmd, watch)?;
    Ok(pause_spans(
        &silences(&log.kept),
        probe.info.duration,
        pauses.keep,
    ))
}

fn length_of(probe: &Probe) -> Result<f64> {
    let duration = probe.info.duration;
    if duration > 0.0 {
        Ok(duration)
    } else {
        Err(Error::Other("the file has no length to work on".into()))
    }
}

fn nothing_left() -> Error {
    Error::Other("nothing would be left".into())
}

fn finite(value: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

fn rate_of(audio: &Stream) -> u32 {
    if audio.sample_rate > 0 {
        audio.sample_rate
    } else {
        48_000
    }
}

/// The label of a cut's audio output `k`: `[a]` for the first track, `[a1]`… for the others.
fn audio_label(k: usize) -> String {
    if k == 0 {
        "[a]".to_owned()
    } else {
        format!("[a{k}]")
    }
}

/// The pieces a cut keeps, in order: what lies between the spans once they are kept inside the
/// file and those that overlap or touch are merged. Pieces shorter than `MIN_PIECE` go too.
pub(in crate::media) fn kept(spans: &[Span], duration: f64) -> Vec<(f64, f64)> {
    let mut cuts: Vec<(f64, f64)> = spans
        .iter()
        .filter_map(|span| times(*span, duration))
        .collect();
    cuts.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut pieces = Vec::new();
    let mut at = 0.0f64;
    for (start, end) in cuts {
        if start - at >= MIN_PIECE {
            pieces.push((at, start));
        }
        at = at.max(end);
    }
    if duration - at >= MIN_PIECE {
        pieces.push((at, duration));
    }
    pieces
}

/// Whether `pieces` are the whole file, so that nothing would be cut.
fn untouched(pieces: &[(f64, f64)], duration: f64) -> bool {
    matches!(pieces, [(start, end)] if *start <= 0.0 && *end >= duration)
}

pub(in crate::media) fn total(pieces: &[(f64, f64)]) -> f64 {
    pieces.iter().map(|(start, end)| end - start).sum()
}

/// The filter graph of a cut. The picture (stream `video`) and every audio stream in `audios`,
/// from the first input, are divided at each edge between a kept piece and a cut by `segment`
/// (`asegment` for sound, which divides at the exact sample); the cut stretches end in a null
/// sink, and the pieces, each with a short fade on the sound where it meets a cut, are joined by
/// `concat` into `[v]` and `[a]`, `[a1]`…. `even` crops the picture to even sizes for encoders
/// that need them. A piece at the file's end runs to its very end, so a duration that ffprobe
/// gets slightly wrong loses nothing.
///
/// Dividing hands each frame to one piece only. A `trim` per piece (or a `split` into them) gives
/// every frame to every piece, and FFmpeg looks through all of a graph's filters for each frame it
/// passes on, so a cut of a thousand pieces took minutes instead of seconds.
pub(in crate::media) fn cut_graph(
    pieces: &[(f64, f64)],
    video: Option<usize>,
    audios: &[usize],
    duration: f64,
    even: bool,
) -> String {
    // The edges between stretches, and for each stretch the piece it keeps (None: a cut).
    let mut edges: Vec<f64> = Vec::new();
    let mut stretches: Vec<Option<usize>> = Vec::new();
    let mut at = 0.0f64;
    for (i, &(start, end)) in pieces.iter().enumerate() {
        if start > at {
            stretches.push(None);
            edges.push(start);
        }
        stretches.push(Some(i));
        at = end;
        if end < duration {
            edges.push(end);
        }
    }
    if at < duration {
        stretches.push(None);
    }
    let times = edges
        .iter()
        .map(|edge| secs(*edge))
        .collect::<Vec<_>>()
        .join("|");
    let mut graph = String::new();
    // The label stretch `j` of a stream reads from: one of its segment's outputs, or the stream
    // itself when nothing divides it.
    let source = |stream: usize, tag: &str, j: usize| {
        if edges.is_empty() {
            format!("[0:{stream}]")
        } else {
            format!("[{tag}{j}]")
        }
    };
    let outputs = |tag: &str| {
        (0..stretches.len())
            .map(|j| format!("[{tag}{j}]"))
            .collect::<String>()
    };
    if !edges.is_empty() {
        if let Some(index) = video {
            graph.push_str(&format!(
                "[0:{index}]segment=timestamps={times}{};",
                outputs("sv")
            ));
        }
        for (k, index) in audios.iter().enumerate() {
            graph.push_str(&format!(
                "[0:{index}]asegment=timestamps={times}{};",
                outputs(&format!("sa{k}_"))
            ));
        }
    }
    let crop = if even {
        format!(",{EVEN}")
    } else {
        String::new()
    };
    let last = pieces.len().saturating_sub(1);
    let mut pads = String::new();
    for (j, stretch) in stretches.iter().enumerate() {
        let Some(i) = *stretch else {
            if let Some(index) = video {
                graph.push_str(&format!("{}nullsink;", source(index, "sv", j)));
            }
            for (k, index) in audios.iter().enumerate() {
                graph.push_str(&format!(
                    "{}anullsink;",
                    source(*index, &format!("sa{k}_"), j)
                ));
            }
            continue;
        };
        let (start, end) = pieces[i];
        if let Some(index) = video {
            graph.push_str(&format!(
                "{}setpts=PTS-STARTPTS{crop}[v{i}];",
                source(index, "sv", j)
            ));
            pads.push_str(&format!("[v{i}]"));
        }
        let fade = CUT_FADE.min((end - start) / 2.0);
        let mut fades = String::new();
        if start > 0.0 {
            fades.push_str(&format!(",afade=t=in:st=0:d={}", secs(fade)));
        }
        if i < last || end < duration {
            fades.push_str(&format!(
                ",afade=t=out:st={}:d={}",
                secs(end - start - fade),
                secs(fade)
            ));
        }
        for (k, index) in audios.iter().enumerate() {
            graph.push_str(&format!(
                "{}asetpts=PTS-STARTPTS{fades}[a{i}_{k}];",
                source(*index, &format!("sa{k}_"), j)
            ));
            pads.push_str(&format!("[a{i}_{k}]"));
        }
    }
    let labels: String = video
        .map(|_| "[v]".to_owned())
        .into_iter()
        .chain((0..audios.len()).map(audio_label))
        .collect();
    graph.push_str(&format!(
        "{pads}concat=n={}:v={}:a={}{labels}",
        pieces.len(),
        u8::from(video.is_some()),
        audios.len()
    ));
    graph
}

/// The choices within the editor's ranges; nonsense falls back to the defaults.
pub(in crate::media) fn settle_pauses(pauses: Pauses) -> Pauses {
    let fallback = Pauses::default();
    Pauses {
        threshold: finite(pauses.threshold, fallback.threshold).clamp(-90.0, -10.0),
        min_length: finite(pauses.min_length, fallback.min_length).clamp(0.1, 60.0),
        keep: finite(pauses.keep, fallback.keep).clamp(0.0, 5.0),
    }
}

pub(in crate::media) fn detect_filter(pauses: Pauses) -> String {
    format!(
        "silencedetect=noise={}dB:d={}",
        pauses.threshold, pauses.min_length
    )
}

/// The silences in silencedetect's `silence_start` and `silence_end` lines, in seconds; one
/// without an end lasts to the end of the file.
pub(in crate::media) fn silences(lines: &[String]) -> Vec<(f64, Option<f64>)> {
    let value = |line: &str, key: &str| -> Option<f64> {
        let rest = &line[line.find(key)? + key.len()..];
        rest.split(|c: char| c.is_whitespace() || c == '|')
            .find(|word| !word.is_empty())?
            .parse()
            .ok()
    };
    let mut found: Vec<(f64, Option<f64>)> = Vec::new();
    for line in lines {
        if let Some(start) = value(line, "silence_start:") {
            found.push((start, None));
        } else if let Some(end) = value(line, "silence_end:") {
            if let Some(last) = found.last_mut().filter(|last| last.1.is_none()) {
                last.1 = Some(end);
            }
        }
    }
    found
}

/// Each silence as the span Remove pauses cuts: `keep` seconds stay on each side where speech is
/// next to it, so a pause at the very start or end of the file goes entirely up to that end.
/// Times are rounded to the millisecond.
pub(in crate::media) fn pause_spans(
    silences: &[(f64, Option<f64>)],
    duration: f64,
    keep: f64,
) -> Vec<Span> {
    let ms = |seconds: f64| (seconds * 1000.0).round() / 1000.0;
    silences
        .iter()
        .filter_map(|&(start, end)| {
            let start = start.max(0.0);
            let end = end.unwrap_or(duration).min(duration);
            let start = if start <= EDGE { 0.0 } else { start + keep };
            let end = if end >= duration - EDGE {
                duration
            } else {
                end - keep
            };
            (end - start >= MIN_PAUSE).then(|| Span {
                start: ms(start),
                end: ms(end),
            })
        })
        .collect()
}

/// Add music's choices inside their ranges: levels from -30 to +6 dB, the fades within the
/// video's length.
pub(in crate::media) fn settle_mix(mix: Mix, length: f64) -> Mix {
    let level = |value: f64| finite(value, 0.0).clamp(LEVEL_MIN, LEVEL_MAX);
    let seconds = |value: f64| finite(value, 0.0).clamp(0.0, length.max(0.0));
    Mix {
        music: level(mix.music),
        original: level(mix.original),
        offset: finite(mix.offset, 0.0).max(0.0),
        fade_in: seconds(mix.fade_in),
        fade_out: seconds(mix.fade_out),
        ..mix
    }
}

/// How the music fills the video.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::media) enum Repeat {
    /// It plays once, as far as it goes.
    Once,
    /// It is kept in memory and played again from the offset (`aloop`, at most this many
    /// samples).
    Loop { samples: u64 },
    /// The file is opened this many times, each from the offset, and the copies are joined.
    Inputs(usize),
}

impl Repeat {
    /// How many times the music file is an input.
    fn inputs(self) -> usize {
        match self {
            Repeat::Inputs(count) => count,
            _ => 1,
        }
    }
}

/// `left`: seconds of music after the offset; `length`: the video's.
pub(in crate::media) fn repeat(mix: &Mix, left: f64, length: f64, rate: u32) -> Repeat {
    if !mix.repeat || left >= length {
        Repeat::Once
    } else if left <= LOOP_IN_MEMORY {
        // Room for a second more than ffprobe says, in case it says too little.
        Repeat::Loop {
            samples: ((left + 1.0) * f64::from(rate)).ceil() as u64,
        }
    } else {
        Repeat::Inputs((length / left).ceil().max(1.0) as usize)
    }
}

/// What Add music's graph is made of: the video is input 0, the music input 1 (and the next ones
/// for `Repeat::Inputs`).
pub(in crate::media) struct MusicPlan {
    /// Seconds of video.
    pub length: f64,
    /// Seconds of music after the offset (infinite when unknown).
    pub left: f64,
    pub rate: u32,
    pub layout: String,
    /// The music's audio stream.
    pub music: usize,
    /// The video's own sound, unless the music replaces it or there is none.
    pub original: Option<usize>,
    pub repeat: Repeat,
    pub mix: Mix,
}

/// The graph of Add music, ending in `[a]`: the music, from its offset (the input seeks there),
/// repeated if asked, cut to the video's length, at its level and faded in at the start and out
/// at the end (the video's end, or the music's own when it stops sooner). Then it replaces the
/// video's sound or is mixed with it at the sound's own level, stepping back under it while it
/// is loud when ducking: a sidechain compressor listens to the video's sound before its level
/// changes and lowers the music by about 12 dB under speech at -20 dBFS (threshold -34 dBFS,
/// ratio 6, 20 ms attack, half a second's release). A limiter keeps the sum from clipping.
pub(in crate::media) fn music_graph(plan: &MusicPlan) -> String {
    let MusicPlan {
        length,
        left,
        rate,
        ref layout,
        music,
        original,
        repeat,
        mix,
    } = *plan;
    let format = format!("aformat=sample_fmts=fltp:sample_rates={rate}:channel_layouts={layout}");
    let mut graph = String::new();
    let mut chain = match repeat {
        Repeat::Once => format!("[1:{music}]{format}"),
        Repeat::Loop { samples } => format!("[1:{music}]{format},aloop=loop=-1:size={samples}"),
        Repeat::Inputs(count) => {
            let mut pads = String::new();
            for k in 0..count {
                graph.push_str(&format!("[{}:{music}]{format}[r{k}];", k + 1));
                pads.push_str(&format!("[r{k}]"));
            }
            format!("{pads}concat=n={count}:v=0:a=1")
        }
    };
    let played = match repeat {
        Repeat::Once => left.min(length),
        _ => length,
    };
    chain.push_str(&format!(",atrim=end={}", secs(length)));
    if mix.music != 0.0 {
        chain.push_str(&format!(",volume={}dB", mix.music));
    }
    let fades = Fades::new(mix.fade_in, mix.fade_out, played);
    if fades.any() {
        chain.push(',');
        chain.push_str(&fades.chain("afade"));
    }
    let Some(original) = original else {
        graph.push_str(&chain);
        graph.push_str("[a]");
        return graph;
    };
    let level = if mix.original != 0.0 {
        format!(",volume={}dB", mix.original)
    } else {
        String::new()
    };
    if mix.duck {
        graph.push_str(&format!(
            "{chain}[m];[0:{original}]{format},asplit=2[o][sc];[o]anull{level}[own];\
             [m][sc]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=500[duck];\
             [own][duck]amix=inputs=2:duration=longest:normalize=0,{LIMIT}[a]"
        ));
    } else {
        graph.push_str(&format!(
            "{chain}[m];[0:{original}]{format}{level}[own];\
             [own][m]amix=inputs=2:duration=longest:normalize=0,{LIMIT}[a]"
        ));
    }
    graph
}

/// Fades in from the start and out to the end of `length` seconds, each at most as long as the
/// whole.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::media) struct Fades {
    pub fade_in: f64,
    pub fade_out: f64,
    pub length: f64,
}

impl Fades {
    pub fn new(fade_in: f64, fade_out: f64, length: f64) -> Self {
        let length = finite(length, 0.0).max(0.0);
        let seconds = |value: f64| finite(value, 0.0).clamp(0.0, FADE_MAX).min(length);
        Self {
            fade_in: seconds(fade_in),
            fade_out: seconds(fade_out),
            length,
        }
    }

    pub fn any(&self) -> bool {
        self.fade_in > 0.0 || self.fade_out > 0.0
    }

    /// The fades as `fade` (the picture, from and to black) or `afade` filters.
    pub fn chain(&self, filter: &str) -> String {
        let mut parts = Vec::new();
        if self.fade_in > 0.0 {
            parts.push(format!("{filter}=t=in:st=0:d={}", secs(self.fade_in)));
        }
        if self.fade_out > 0.0 {
            parts.push(format!(
                "{filter}=t=out:st={}:d={}",
                secs(self.length - self.fade_out),
                secs(self.fade_out)
            ));
        }
        parts.join(",")
    }
}

/// The sound of Fade and volume: the fades, the level, and a limiter when it is louder.
pub(in crate::media) fn fade_chain(fades: &Fades, volume: f64) -> String {
    let mut parts = Vec::new();
    if fades.any() {
        parts.push(fades.chain("afade"));
    }
    if volume.abs() >= 0.05 {
        parts.push(format!("volume={volume}dB"));
    }
    if volume >= 0.05 {
        parts.push(LIMIT.to_owned());
    }
    parts.join(",")
}

/// FFmpeg's `afftdn` at a fixed noise floor and reduction for each strength: Light assumes a
/// quiet hiss (floor -50 dB, up to 10 dB less of it), Medium a fan or traffic (-40 dB, 18 dB),
/// Strong loud noise (-30 dB, 30 dB). Each strength leaves sound well above its floor as it was;
/// Strong also takes away very quiet sound, which is why it may thin voices. `rumble` first
/// takes away what lies under about 80 Hz, with two second-order high-pass stages (24 dB an
/// octave), so the noise floor is not set by the rumble.
pub(in crate::media) fn denoise_filter(strength: Strength, rumble: bool) -> String {
    let (reduction, floor) = match strength {
        Strength::Light => (10, -50),
        Strength::Medium => (18, -40),
        Strength::Strong => (30, -30),
    };
    let high_pass = if rumble {
        "highpass=f=80,highpass=f=80,"
    } else {
        ""
    };
    format!("{high_pass}afftdn=nr={reduction}:nf={floor}")
}

/// The crossfade of Merge audio: 0 to 10 seconds, and never more than half the shortest file, so
/// that a file overlaps at most its whole length with its two neighbours.
pub(in crate::media) fn crossfade_for(crossfade: f64, lengths: &[f64]) -> f64 {
    let shortest = lengths.iter().copied().fold(f64::INFINITY, f64::min);
    let seconds = finite(crossfade, 0.0)
        .clamp(0.0, CROSSFADE_MAX)
        .min(shortest / 2.0);
    if seconds >= 0.01 {
        (seconds * 1000.0).round() / 1000.0
    } else {
        0.0
    }
}

/// The graph of Merge audio, ending in `[a]`: each input's stream `streams[i]` at the first one's
/// rate and layout, joined by `concat` or by a chain of `acrossfade`s (quarter-sine curves on
/// both sides, so the loudness holds through the overlap).
pub(in crate::media) fn merge_graph(
    streams: &[usize],
    rate: u32,
    layout: &str,
    crossfade: f64,
) -> String {
    let mut graph = String::new();
    for (i, index) in streams.iter().enumerate() {
        graph.push_str(&format!(
            "[{i}:{index}]aformat=sample_fmts=fltp:sample_rates={rate}:channel_layouts={layout}[s{i}];"
        ));
    }
    if crossfade <= 0.0 {
        for i in 0..streams.len() {
            graph.push_str(&format!("[s{i}]"));
        }
        graph.push_str(&format!("concat=n={}:v=0:a=1[a]", streams.len()));
        return graph;
    }
    let mut last = "s0".to_owned();
    for i in 1..streams.len() {
        let next = if i + 1 == streams.len() {
            "a".to_owned()
        } else {
            format!("x{i}")
        };
        graph.push_str(&format!(
            "[{last}][s{i}]acrossfade=d={}:c1=qsin:c2=qsin[{next}]",
            secs(crossfade)
        ));
        if i + 1 < streams.len() {
            graph.push(';');
        }
        last = next;
    }
    graph
}
