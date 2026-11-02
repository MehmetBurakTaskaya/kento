// SPDX-License-Identifier: MIT
//! Every fixture here is made at run time by FFmpeg itself (`testsrc2`, `sine`, `aevalsrc`), tiny
//! and short, under folder and file names with Turkish letters and an emoji. Without FFmpeg the
//! checks are skipped (with a note), unless `KENTO_REQUIRE_FFMPEG=1`.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::probe::{self, Kind, Probe};
use super::*;
use crate::{Codec, Conversion, Error, Options, Progress, Tools};

mod compress;

const NAME: &str = "Kento ğüşıöç 🧪";

/// FFmpeg and ffprobe from `KENTO_FFMPEG`/`KENTO_FFPROBE` or the PATH.
fn find_tools() -> Option<Tools> {
    let find = |var: &str, name: &str| {
        env::var_os(var)
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .or_else(|| {
                let exe = if cfg!(windows) {
                    format!("{name}.exe")
                } else {
                    name.to_owned()
                };
                env::split_paths(&env::var_os("PATH")?)
                    .map(|dir| dir.join(&exe))
                    .find(|path| path.is_file())
            })
    };
    match (
        find("KENTO_FFMPEG", "ffmpeg"),
        find("KENTO_FFPROBE", "ffprobe"),
    ) {
        (Some(ffmpeg), Some(ffprobe)) => Some(Tools {
            ffmpeg: Some(ffmpeg),
            ffprobe: Some(ffprobe),
            exiftool: None,
        }),
        _ => {
            let required = env::var("KENTO_REQUIRE_FFMPEG").is_ok_and(|v| v == "1");
            assert!(
                !required,
                "KENTO_REQUIRE_FFMPEG=1 but FFmpeg or ffprobe is missing"
            );
            eprintln!(
                "skipped the media checks: no FFmpeg (set KENTO_FFMPEG and KENTO_FFPROBE or put \
                 them on the PATH)"
            );
            None
        }
    }
}

/// A scratch folder with Turkish letters and an emoji in its name, and the tools.
struct Lab {
    _dir: tempfile::TempDir,
    root: PathBuf,
    tools: Tools,
}

impl Lab {
    fn new() -> Option<Lab> {
        let tools = find_tools()?;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Klasör ğ 🧪");
        fs::create_dir(&root).unwrap();
        Some(Lab {
            _dir: dir,
            root,
            tools,
        })
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    /// A fresh output path named the way Kento names files while it writes them.
    fn out(&self, name: &str) -> PathBuf {
        self.path(&format!(".{NAME} {name}.kento-part"))
    }

    fn folder(&self, name: &str) -> PathBuf {
        let path = self.path(&format!("{NAME} {name}"));
        fs::create_dir(&path).unwrap();
        path
    }

    fn ffmpeg(&self, args: &[&str], out: &Path) -> PathBuf {
        let status = Command::new(self.tools.ffmpeg.as_ref().unwrap())
            .args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error"])
            .args(args)
            .arg(out)
            .status()
            .unwrap();
        assert!(status.success(), "making {}", out.display());
        out.to_path_buf()
    }

    /// H.264 (x264 at CRF 30, so a copy can be told from Kento's CRF 22) with stereo AAC.
    fn video(&self, name: &str, size: &str, seconds: f64, sound: bool) -> PathBuf {
        let picture = format!("testsrc2=s={size}:r=25:d={seconds}");
        let tone = format!("sine=f=440:r=48000:d={seconds}");
        let mut args = vec!["-f", "lavfi", "-i", &picture];
        if sound {
            args.extend(["-f", "lavfi", "-i", &tone, "-ac", "2", "-c:a", "aac"]);
        }
        args.extend([
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "30",
            "-pix_fmt",
            "yuv420p",
        ]);
        self.ffmpeg(&args, &self.path(name))
    }

    /// VP9 and Opus in WebM or MKV, for the routes that must encode.
    fn vp9(&self, name: &str, size: &str, sound: bool) -> PathBuf {
        let picture = format!("testsrc2=s={size}:r=25:d=2");
        let mut args = vec!["-f", "lavfi", "-i", &picture];
        if sound {
            args.extend([
                "-f",
                "lavfi",
                "-i",
                "sine=f=330:r=48000:d=2",
                "-c:a",
                "libopus",
            ]);
        }
        args.extend([
            "-c:v",
            "libvpx-vp9",
            "-deadline",
            "realtime",
            "-cpu-used",
            "8",
        ]);
        self.ffmpeg(&args, &self.path(name))
    }

    /// Stereo 16-bit WAV: a 440 Hz tone at `volume`.
    fn wav(&self, name: &str, seconds: f64, volume: f64) -> PathBuf {
        let tone = format!(
            "aevalsrc={volume}*sin(2*PI*440*t)|{volume}*sin(2*PI*440*t):s=44100:d={seconds}"
        );
        self.ffmpeg(
            &["-f", "lavfi", "-i", &tone, "-c:a", "pcm_s16le"],
            &self.path(name),
        )
    }

    /// Mono: one second of silence, one second of tone, one second of silence.
    fn gap(&self, name: &str) -> PathBuf {
        self.ffmpeg(
            &[
                "-f",
                "lavfi",
                "-i",
                "aevalsrc='if(between(t,1,2),0.5*sin(2*PI*440*t),0)':s=44100:d=3",
                "-c:a",
                "pcm_s16le",
            ],
            &self.path(name),
        )
    }

    fn probe(&self, path: &Path) -> Probe {
        probe::probe(self.tools.ffprobe.as_ref().unwrap(), path).unwrap()
    }

    fn convert(&self, input: &Path, from: &str, to: &str) -> PathBuf {
        let dest = self.out(&format!("{from}-to.{to}"));
        let progress = Progress::none();
        self.convert_with(input, from, to, &dest, &progress)
            .unwrap();
        dest
    }

    fn convert_with(
        &self,
        input: &Path,
        from: &str,
        to: &str,
        dest: &Path,
        progress: &Progress,
    ) -> crate::Result<Vec<PathBuf>> {
        let temp = tempfile::tempdir().unwrap();
        let options = Options {
            tools: self.tools.clone(),
            ..Options::default()
        };
        crate::convert(&Conversion {
            input,
            from,
            to,
            dest,
            temp: temp.path(),
            options: &options,
            progress,
        })
    }

    fn tool(&self, tool: Tool, inputs: &[PathBuf], dest: &Path) -> crate::Result<Vec<PathBuf>> {
        let temp = tempfile::tempdir().unwrap();
        run_tool(&ToolRun {
            inputs,
            tool: &tool,
            dest,
            temp: temp.path(),
            tools: &self.tools,
            progress: &Progress::none(),
        })
    }

    /// The integrated loudness of a file, by the same first pass Normalize uses.
    fn loudness(&self, path: &Path) -> f64 {
        let output = Command::new(self.tools.ffmpeg.as_ref().unwrap())
            .args(["-hide_banner", "-nostdin", "-nostats", "-i"])
            .arg(path)
            .args(["-af", "ebur128", "-f", "null", "-"])
            .output()
            .unwrap();
        let log = String::from_utf8_lossy(&output.stderr);
        // The summary at the end: "    I:         -16.0 LUFS".
        log.lines()
            .rev()
            .find_map(|line| {
                let value = line.trim().strip_prefix("I:")?;
                value.trim().strip_suffix("LUFS")?.trim().parse().ok()
            })
            .expect("ebur128 summary")
    }
}

fn video_of(probe: &Probe) -> &VideoInfo {
    probe.info.video.as_ref().expect("a video stream")
}

fn audio_of(probe: &Probe) -> &AudioInfo {
    probe.info.audio.as_ref().expect("an audio stream")
}

fn near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{actual} is not within {tolerance} of {expected}"
    );
}

fn contains(path: &Path, needle: &[u8]) -> bool {
    fs::read(path)
        .unwrap()
        .windows(needle.len())
        .any(|window| window == needle)
}

/// x264 writes its settings into the stream: a copied stream keeps the fixture's.
fn copied_x264(path: &Path) -> bool {
    contains(path, b"crf=30.0")
}

#[test]
fn routes() {
    assert!(supports("mp4", "webm"));
    assert!(supports("mkv", "mp3"));
    assert!(supports("wmv", "m4a"));
    assert!(supports("avi", "wav"));
    assert!(supports("gif", "mp4"));
    assert!(
        !supports("gif", "mkv"),
        "an animated GIF becomes MP4, WEBM or MOV"
    );
    assert!(!supports("gif", "mp3"));
    assert!(supports("flac", "opus"));
    assert!(supports("wma", "aiff"));
    assert!(!supports("mp4", "mp4"));
    assert!(!supports("mp3", "mp4"));
    assert!(!supports("png", "mp4"));
    assert!(matches!(crate::output("mp4", "gif"), Some(Output::File)));
    for from in ["avi", "mkv", "mov", "mp4", "webm", "wmv"] {
        for to in [
            "mp4", "mov", "mkv", "webm", "avi", "wmv", "gif", "mp3", "m4a", "wav",
        ] {
            assert_eq!(supports(from, to), from != to, "{from} to {to}");
        }
    }
}

#[test]
fn tool_extensions() {
    assert_eq!(Tool::Mute.extension("mkv"), "mkv");
    assert_eq!(
        Tool::AudioToVideo {
            visual: Visual::Waveform
        }
        .extension("mp3"),
        "mp4"
    );
    assert_eq!(Tool::Frames { at: vec![] }.extension("mov"), "png");
    assert_eq!(
        Tool::SplitVideo {
            at: SplitAt::Parts { count: 2 },
            keep: None
        }
        .extension("webm"),
        "webm"
    );
    assert_eq!(Tool::Frames { at: vec![] }.output(), Output::Folder);
}

#[test]
fn missing_tools_are_reported() {
    let input = Path::new("x.mp4");
    assert!(matches!(
        probe(&Tools::default(), input),
        Err(Error::MissingCodec(Codec::Ffmpeg))
    ));
    let nowhere = Tools {
        ffmpeg: Some(PathBuf::from("/nowhere/ffmpeg-kento-test")),
        ffprobe: Some(PathBuf::from("/nowhere/ffprobe-kento-test")),
        exiftool: None,
    };
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.mp4");
    fs::write(&file, b"x").unwrap();
    assert!(matches!(
        probe(&nowhere, &file),
        Err(Error::MissingCodec(Codec::Ffmpeg))
    ));
    assert!(matches!(
        run_tool(&ToolRun {
            inputs: std::slice::from_ref(&file),
            tool: &Tool::Mute,
            dest: &dir.path().join("b.mp4"),
            temp: dir.path(),
            tools: &Tools::default(),
            progress: &Progress::none(),
        }),
        Err(Error::MissingCodec(Codec::Ffmpeg))
    ));
}

#[test]
fn probes_video_audio_and_oddities() {
    let Some(lab) = Lab::new() else { return };
    let video = lab.video(&format!("{NAME}.mp4"), "160x90", 2.0, true);
    let info = probe(&lab.tools, &video).unwrap();
    near(info.duration, 2.0, 0.1);
    let picture = info.video.as_ref().unwrap();
    assert_eq!((picture.width, picture.height), (160, 90));
    near(picture.fps, 25.0, 0.01);
    assert_eq!(picture.codec, "h264");
    assert_eq!(picture.pixel_format, "yuv420p");
    let sound = info.audio.as_ref().unwrap();
    assert_eq!((sound.channels, sound.sample_rate), (2, 48000));
    assert_eq!(sound.codec, "aac");

    let wav = lab.wav(&format!("{NAME}.wav"), 1.5, 0.5);
    let info = probe(&lab.tools, &wav).unwrap();
    near(info.duration, 1.5, 0.01);
    assert!(info.video.is_none());
    assert_eq!(info.audio.unwrap().codec, "pcm_s16le");

    // A phone-style rotation flag turns the displayed size.
    let rotated = lab.ffmpeg(
        &[
            "-display_rotation",
            "90",
            "-i",
            video.to_str().unwrap(),
            "-c",
            "copy",
        ],
        &lab.path("rotated.mp4"),
    );
    let picture = probe(&lab.tools, &rotated).unwrap().video.unwrap();
    assert_eq!((picture.width, picture.height), (90, 160));

    let still = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=red:s=33x17:d=1",
            "-frames:v",
            "1",
        ],
        &lab.path("still.png"),
    );
    let info = probe(&lab.tools, &still).unwrap();
    assert_eq!(info.duration, 0.0);
    assert_eq!(info.video.unwrap().width, 33);

    let garbage = lab.path("garbage.mp4");
    fs::write(&garbage, b"this is not a video at all").unwrap();
    assert!(matches!(
        probe(&lab.tools, &garbage),
        Err(Error::Unreadable(_))
    ));
    assert!(matches!(
        probe(&lab.tools, &lab.path("missing.mp4")),
        Err(Error::Io(_))
    ));
}

#[test]
fn converts_video() {
    let Some(lab) = Lab::new() else { return };
    let mp4 = lab.video(&format!("{NAME}.mp4"), "160x90", 2.0, true);

    let webm = lab.probe(&lab.convert(&mp4, "mp4", "webm"));
    assert_eq!(video_of(&webm).codec, "vp9");
    assert_eq!(audio_of(&webm).codec, "opus");
    near(webm.info.duration, 2.0, 0.15);

    // H.264 and AAC fit MKV and MOV as they are: copied, not encoded.
    for to in ["mkv", "mov"] {
        let out = lab.convert(&mp4, "mp4", to);
        assert!(copied_x264(&out), "{to} copies the H.264 stream");
        let probe = lab.probe(&out);
        assert_eq!(video_of(&probe).codec, "h264");
        assert_eq!(audio_of(&probe).codec, "aac");
    }

    let avi = lab.probe(&lab.convert(&mp4, "mp4", "avi"));
    assert_eq!(video_of(&avi).codec, "mpeg4");
    assert_eq!(audio_of(&avi).codec, "mp3");

    let wmv = lab.probe(&lab.convert(&mp4, "mp4", "wmv"));
    assert_eq!(video_of(&wmv).codec, "wmv2");
    assert_eq!(audio_of(&wmv).codec, "wmav2");

    let gif = lab.probe(&lab.convert(&mp4, "mp4", "gif"));
    let picture = video_of(&gif);
    assert_eq!(picture.codec, "gif");
    assert_eq!(picture.width, 160, "small videos keep their width");
    assert!(gif.info.audio.is_none());

    // Sound only, and no cover art or picture.
    let mp3 = lab.probe(&lab.convert(&mp4, "mp4", "mp3"));
    assert_eq!(audio_of(&mp3).codec, "mp3");
    assert!(mp3.streams.iter().all(|s| s.kind == Kind::Audio));
    let m4a = lab.probe(&lab.convert(&mp4, "mp4", "m4a"));
    assert_eq!(audio_of(&m4a).codec, "aac");
    assert!(m4a.streams.iter().all(|s| s.kind == Kind::Audio));
    let wav = lab.probe(&lab.convert(&mp4, "mp4", "wav"));
    assert_eq!(audio_of(&wav).codec, "pcm_s16le");
}

#[test]
fn encodes_what_does_not_fit() {
    let Some(lab) = Lab::new() else { return };
    // VP9 at an odd size: MP4 gets H.264 at even sizes, and AAC for the Opus.
    let webm = lab.vp9(&format!("{NAME}.webm"), "161x91", true);
    let mp4 = lab.probe(&lab.convert(&webm, "webm", "mp4"));
    let picture = video_of(&mp4);
    assert_eq!(picture.codec, "h264");
    assert_eq!((picture.width, picture.height), (160, 90));
    assert_eq!(picture.pixel_format, "yuv420p");
    assert_eq!(audio_of(&mp4).codec, "aac");
    near(mp4.info.duration, 2.0, 0.15);

    // MKV holds VP9 and Opus: copied.
    let mkv = lab.probe(&lab.convert(&webm, "webm", "mkv"));
    assert_eq!(video_of(&mkv).codec, "vp9");
    assert_eq!(audio_of(&mkv).codec, "opus");

    // An animated GIF becomes a video.
    let gif = lab.ffmpeg(
        &["-f", "lavfi", "-i", "testsrc2=s=61x41:r=10:d=1"],
        &lab.path(&format!("{NAME}.gif")),
    );
    for to in ["mp4", "webm", "mov"] {
        let probe = lab.probe(&lab.convert(&gif, "gif", to));
        let picture = video_of(&probe);
        assert!(picture.width >= 60 && picture.height >= 40, "{to}");
        assert!(probe.info.audio.is_none());
    }

    // H.264 in AVI copies into MP4 even though AVI keeps no presentation times.
    let avi = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:r=25:d=1",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "30",
        ],
        &lab.path("h264.avi"),
    );
    let out = lab.convert(&avi, "avi", "mp4");
    assert!(copied_x264(&out));
    near(lab.probe(&out).info.duration, 1.0, 0.15);
}

#[test]
fn keeps_subtitles_where_they_fit() {
    let Some(lab) = Lab::new() else { return };
    let srt = lab.path("sub.srt");
    fs::write(&srt, "1\n00:00:00,200 --> 00:00:01,500\nMerhaba dünya\n\n").unwrap();
    let mkv = lab.path(&format!("{NAME}.mkv"));
    let status = Command::new(lab.tools.ffmpeg.as_ref().unwrap())
        .args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error"])
        .args(["-f", "lavfi", "-i", "testsrc2=s=160x90:r=25:d=2", "-i"])
        .arg(&srt)
        .args(["-c:v", "libx264", "-preset", "ultrafast", "-c:s", "srt"])
        .arg(&mkv)
        .status()
        .unwrap();
    assert!(status.success());
    let subtitles = |probe: &Probe| {
        probe
            .subtitles()
            .map(|s| s.codec.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        subtitles(&lab.probe(&lab.convert(&mkv, "mkv", "mp4"))),
        ["mov_text"]
    );
    assert_eq!(
        subtitles(&lab.probe(&lab.convert(&mkv, "mkv", "webm"))),
        ["webvtt"]
    );
    assert!(subtitles(&lab.probe(&lab.convert(&mkv, "mkv", "avi"))).is_empty());
}

#[test]
fn converts_audio() {
    let Some(lab) = Lab::new() else { return };
    let wav = lab.wav(&format!("{NAME}.wav"), 1.5, 0.5);
    let cases = [
        ("wav", &wav, "flac", "flac"),
        ("wav", &wav, "ogg", "vorbis"),
        ("wav", &wav, "opus", "opus"),
        ("wav", &wav, "mp3", "mp3"),
        ("wav", &wav, "m4a", "aac"),
        ("wav", &wav, "wma", "wmav2"),
        ("wav", &wav, "aiff", "pcm_s16be"),
    ];
    let mut made = Vec::new();
    for (from, input, to, codec) in cases {
        let out = lab.convert(input, from, to);
        let probe = lab.probe(&out);
        assert_eq!(audio_of(&probe).codec, codec, "{from} to {to}");
        assert_eq!(audio_of(&probe).channels, 2);
        near(probe.info.duration, 1.5, 0.1);
        made.push((to, out));
    }
    // And back: every format reads again.
    for (from, input) in &made {
        let to = if *from == "wav" { "flac" } else { "wav" };
        let probe = lab.probe(&lab.convert(input, from, to));
        near(probe.info.duration, 1.5, 0.1);
    }
}

#[test]
fn progress_reaches_the_end() {
    let Some(lab) = Lab::new() else { return };
    let mp4 = lab.video("progress.mp4", "160x90", 2.0, true);
    let values = Mutex::new(Vec::new());
    let report = |value: Option<f32>| values.lock().unwrap().extend(value);
    let cancelled = || false;
    let progress = Progress::new(&report, &cancelled);
    lab.convert_with(&mp4, "mp4", "webm", &lab.out("progress.webm"), &progress)
        .unwrap();
    let values = values.into_inner().unwrap();
    assert_eq!(values.last(), Some(&1.0));
    assert!(
        values.windows(2).all(|pair| pair[0] <= pair[1]),
        "{values:?}"
    );
}

#[test]
fn cancelling_stops_ffmpeg() {
    let Some(lab) = Lab::new() else { return };
    let long = lab.video(&format!("{NAME} long.mp4"), "640x360", 20.0, false);
    let cancel = AtomicBool::new(false);
    let report = |_: Option<f32>| cancel.store(true, Ordering::Relaxed);
    let cancelled = || cancel.load(Ordering::Relaxed);
    let progress = Progress::new(&report, &cancelled);
    let dest = lab.out("cancelled.webm");
    let started = Instant::now();
    let result = lab.convert_with(&long, "mp4", "webm", &dest, &progress);
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(10));
    // FFmpeg has ended: on Windows a running process would hold the file open.
    if dest.exists() {
        fs::remove_file(&dest).unwrap();
    }
}

#[test]
fn mute_trim_crop_and_speed() {
    let Some(lab) = Lab::new() else { return };
    let mp4 = lab.video(&format!("{NAME}.mp4"), "160x90", 3.0, true);

    let muted = lab.out("muted.mp4");
    lab.tool(Tool::Mute, std::slice::from_ref(&mp4), &muted)
        .unwrap();
    let probe = lab.probe(&muted);
    assert!(probe.info.audio.is_none());
    assert!(copied_x264(&muted), "the picture is untouched");

    let trimmed = lab.out("trimmed.mp4");
    let span = Span {
        start: 0.5,
        end: 1.75,
    };
    lab.tool(
        Tool::TrimVideo { span },
        std::slice::from_ref(&mp4),
        &trimmed,
    )
    .unwrap();
    let probe = lab.probe(&trimmed);
    near(probe.info.duration, 1.25, 0.08);
    assert_eq!(video_of(&probe).codec, "h264");
    assert_eq!(audio_of(&probe).codec, "aac");

    let cropped = lab.out("cropped.mp4");
    let area = Area {
        x: 10.5,
        y: 5.0,
        width: 81.0,
        height: 41.0,
    };
    lab.tool(
        Tool::CropVideo { area },
        std::slice::from_ref(&mp4),
        &cropped,
    )
    .unwrap();
    let probe = lab.probe(&cropped);
    let picture = video_of(&probe);
    assert_eq!((picture.width, picture.height), (82, 42));
    assert_eq!(audio_of(&probe).codec, "aac");

    for (factor, expected) in [(2.0, 1.5), (0.5, 6.0), (4.0, 0.75)] {
        let fast = lab.out(&format!("speed {factor}.mp4"));
        lab.tool(Tool::Speed { factor }, std::slice::from_ref(&mp4), &fast)
            .unwrap();
        let probe = lab.probe(&fast);
        near(probe.info.duration, expected, 0.12);
        near(video_of(&probe).fps, 25.0, 0.01);
        assert!(probe.info.audio.is_some());
    }
}

#[test]
fn merges_videos() {
    let Some(lab) = Lab::new() else { return };
    let first = lab.video(&format!("{NAME} 1.mp4"), "160x90", 1.0, true);
    let second = lab.vp9(&format!("{NAME} 2.webm"), "120x120", false);
    let merged = lab.out("merged.mp4");
    lab.tool(Tool::MergeVideos, &[first, second], &merged)
        .unwrap();
    let probe = lab.probe(&merged);
    let picture = video_of(&probe);
    assert_eq!((picture.width, picture.height), (160, 90));
    assert_eq!(picture.codec, "h264");
    let sound = audio_of(&probe);
    assert_eq!((sound.codec.as_str(), sound.channels), ("aac", 2));
    near(probe.info.duration, 3.0, 0.15);
}

#[test]
fn extracts_frames() {
    let Some(lab) = Lab::new() else { return };
    let mp4 = lab.video(&format!("{NAME}.mp4"), "160x90", 2.0, false);
    let folder = lab.folder("frames");
    let files = lab
        .tool(
            Tool::Frames {
                at: vec![0.5, 1.0, 1.0, 99.0],
            },
            &[mp4],
            &folder,
        )
        .unwrap();
    assert_eq!(files.len(), 3, "the same moment twice is one file");
    let names: Vec<String> = files
        .iter()
        .map(|f| f.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names[0], format!("{NAME}-00-00-00.500.png"));
    assert_eq!(names[2], format!("{NAME}-00-00-02.000.png"));
    for file in &files {
        let image = image::open(file).unwrap();
        assert_eq!((image.width(), image.height()), (160, 90));
    }
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 3);
}

#[test]
fn splits_videos() {
    let Some(lab) = Lab::new() else { return };
    let mp4 = lab.video(&format!("{NAME}.mp4"), "160x90", 3.0, true);

    let folder = lab.folder("parts");
    let files = lab
        .tool(
            Tool::SplitVideo {
                at: SplitAt::Parts { count: 3 },
                keep: None,
            },
            std::slice::from_ref(&mp4),
            &folder,
        )
        .unwrap();
    assert_eq!(files.len(), 3);
    for file in &files {
        near(lab.probe(file).info.duration, 1.0, 0.08);
    }
    assert!(files[0].ends_with(format!("{NAME}-01.mp4")));

    let folder = lab.folder("every");
    let files = lab
        .tool(
            Tool::SplitVideo {
                at: SplitAt::Every { seconds: 1.0 },
                keep: Some(vec![true, false, true]),
            },
            std::slice::from_ref(&mp4),
            &folder,
        )
        .unwrap();
    let names: Vec<_> = files.iter().map(|f| f.file_name().unwrap()).collect();
    assert_eq!(
        names,
        [format!("{NAME}-01.mp4"), format!("{NAME}-03.mp4")]
            .map(std::ffi::OsString::from)
            .iter()
            .collect::<Vec<_>>()
    );

    let folder = lab.folder("markers");
    let files = lab
        .tool(
            Tool::SplitVideo {
                at: SplitAt::Markers { at: vec![2.2] },
                keep: None,
            },
            &[mp4],
            &folder,
        )
        .unwrap();
    assert_eq!(files.len(), 2);
    near(lab.probe(&files[0]).info.duration, 2.2, 0.08);
    near(lab.probe(&files[1]).info.duration, 0.8, 0.08);
}

#[test]
fn redacts_video() {
    let Some(lab) = Lab::new() else { return };
    let mp4 = lab.video(&format!("{NAME}.mp4"), "160x90", 2.0, true);
    let areas = vec![
        Redaction {
            area: Area {
                x: 20.0,
                y: 10.0,
                width: 60.0,
                height: 40.0,
            },
            span: Span {
                start: 0.5,
                end: 1.5,
            },
        },
        Redaction {
            area: Area {
                x: 100.0,
                y: 50.0,
                width: 40.0,
                height: 30.0,
            },
            span: Span {
                start: 0.0,
                end: 2.0,
            },
        },
    ];
    for (name, hide) in [
        ("color", Hide::Color { rgb: [255, 0, 0] }),
        ("blur", Hide::Blur),
        ("pixelate", Hide::Pixelate),
    ] {
        let out = lab.out(&format!("redacted {name}.mp4"));
        lab.tool(
            Tool::RedactVideo {
                areas: areas.clone(),
                hide,
            },
            std::slice::from_ref(&mp4),
            &out,
        )
        .unwrap();
        let probe = lab.probe(&out);
        assert_eq!((video_of(&probe).width, video_of(&probe).height), (160, 90));
        assert_eq!(audio_of(&probe).codec, "aac", "the sound is kept");
        near(probe.info.duration, 2.0, 0.1);
        if name == "color" {
            let png = frame(&lab.tools, &out, 1.0, 0).unwrap();
            let image = image::load_from_memory(&png).unwrap().to_rgb8();
            let [r, g, b] = image.get_pixel(50, 30).0;
            assert!(r > 200 && g < 60 && b < 60, "the area is red: {r} {g} {b}");
        }
    }
}

#[test]
fn normalizes_loudness() {
    let Some(lab) = Lab::new() else { return };
    let quiet = lab.wav(&format!("{NAME}.wav"), 4.0, 0.03);
    let before = lab.loudness(&quiet);
    let out = lab.out("loud.wav");
    lab.tool(
        Tool::Normalize {
            loudness: Loudness::default(),
        },
        &[quiet],
        &out,
    )
    .unwrap();
    let after = lab.loudness(&out);
    assert!(before < -30.0, "{before}");
    near(after, -16.0, 1.0);
    let probe = lab.probe(&out);
    let sound = audio_of(&probe);
    assert_eq!(
        (sound.codec.as_str(), sound.sample_rate),
        ("pcm_s16le", 44100),
        "the format and rate stay"
    );

    let silent = lab.wav("silent.wav", 1.0, 0.0);
    assert!(lab
        .tool(
            Tool::Normalize {
                loudness: Loudness::default()
            },
            &[silent],
            &lab.out("silent.wav"),
        )
        .is_err());
}

#[test]
fn trims_audio_and_silence() {
    let Some(lab) = Lab::new() else { return };
    let gap = lab.gap(&format!("{NAME}.wav"));
    let out = lab.out("trimmed.wav");
    lab.tool(
        Tool::TrimAudio {
            span: Span {
                start: 0.5,
                end: 2.5,
            },
            remove_silence: false,
        },
        std::slice::from_ref(&gap),
        &out,
    )
    .unwrap();
    near(lab.probe(&out).info.duration, 2.0, 0.01);

    let out = lab.out("no silence.wav");
    lab.tool(
        Tool::TrimAudio {
            span: Span {
                start: 0.0,
                end: 3.0,
            },
            remove_silence: true,
        },
        &[gap],
        &out,
    )
    .unwrap();
    near(lab.probe(&out).info.duration, 1.0, 0.06);

    let mp3 = lab.convert(&lab.wav("tone.wav", 2.0, 0.5), "wav", "mp3");
    let mp3 = {
        let named = lab.path(&format!("{NAME}.mp3"));
        fs::rename(&mp3, &named).unwrap();
        named
    };
    let out = lab.out("trimmed.mp3");
    lab.tool(
        Tool::TrimAudio {
            span: Span {
                start: 0.25,
                end: 1.25,
            },
            remove_silence: false,
        },
        &[mp3],
        &out,
    )
    .unwrap();
    let probe = lab.probe(&out);
    assert_eq!(audio_of(&probe).codec, "mp3");
    near(probe.info.duration, 1.0, 0.08);
}

#[test]
fn changes_channels() {
    let Some(lab) = Lab::new() else { return };
    let stereo = lab.wav(&format!("{NAME}.wav"), 1.0, 0.5);
    let mono = lab.out("mono.wav");
    lab.tool(
        Tool::Channels {
            channels: Channels::Mono,
        },
        std::slice::from_ref(&stereo),
        &mono,
    )
    .unwrap();
    assert_eq!(audio_of(&lab.probe(&mono)).channels, 1);

    let mono_input = lab.path("mono input.wav");
    fs::copy(&mono, &mono_input).unwrap();
    let back = lab.out("stereo.wav");
    lab.tool(
        Tool::Channels {
            channels: Channels::Stereo,
        },
        std::slice::from_ref(&mono_input),
        &back,
    )
    .unwrap();
    assert_eq!(audio_of(&lab.probe(&back)).channels, 2);

    for input in [stereo, mono_input] {
        let levels = lab.out("levels.wav");
        lab.tool(
            Tool::Channels {
                channels: Channels::Levels {
                    left: 0.0,
                    right: 1.5,
                },
            },
            &[input],
            &levels,
        )
        .unwrap();
        assert_eq!(audio_of(&lab.probe(&levels)).channels, 2);
        // The left channel alone is silent now.
        let left = lab.out("left.wav");
        lab.ffmpeg(
            &[
                "-i",
                levels.to_str().unwrap(),
                "-af",
                "pan=mono|c0=c0",
                "-f",
                "wav",
            ],
            &left,
        );
        let peaks = peaks(&lab.tools, &left, 4, &Progress::none()).unwrap();
        assert_eq!(peaks, vec![0.0; 4]);
        fs::remove_file(&levels).unwrap();
    }
}

#[test]
fn redacts_audio() {
    let Some(lab) = Lab::new() else { return };
    let tone = lab.wav(&format!("{NAME}.wav"), 3.0, 0.5);
    let spans = vec![Span {
        start: 1.0,
        end: 2.0,
    }];
    for beep in [false, true] {
        let out = lab.out(&format!("redacted {beep}.wav"));
        lab.tool(
            Tool::RedactAudio {
                spans: spans.clone(),
                beep,
            },
            std::slice::from_ref(&tone),
            &out,
        )
        .unwrap();
        let probe = lab.probe(&out);
        near(probe.info.duration, 3.0, 0.02);
        assert_eq!(audio_of(&probe).channels, 2);
        let peaks = peaks(&lab.tools, &out, 30, &Progress::none()).unwrap();
        let inside = peaks[12..18].iter().copied().fold(0.0, f32::max);
        let outside = peaks[2..8].iter().copied().fold(0.0, f32::max);
        assert!(outside > 0.5, "{peaks:?}");
        if beep {
            assert!(inside > 0.1, "a beep sounds: {peaks:?}");
        } else {
            assert_eq!(inside, 0.0, "silence: {peaks:?}");
        }
    }
}

#[test]
fn audio_becomes_video() {
    let Some(lab) = Lab::new() else { return };
    let tone = lab.wav(&format!("{NAME}.wav"), 2.0, 0.5);
    let picture = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=teal:s=101x51:d=1",
            "-frames:v",
            "1",
        ],
        &lab.path(&format!("{NAME} 100% kapak.png")),
    );
    for (name, visual, size) in [
        ("waveform", Visual::Waveform, (1280, 720)),
        ("spectrum", Visual::Spectrum, (1280, 720)),
        ("bars", Visual::Bars, (1280, 720)),
        ("image", Visual::Image { path: picture }, (100, 50)),
    ] {
        let out = lab.out(&format!("{name}.mp4"));
        lab.tool(
            Tool::AudioToVideo { visual },
            std::slice::from_ref(&tone),
            &out,
        )
        .unwrap();
        let probe = lab.probe(&out);
        let video = video_of(&probe);
        assert_eq!(video.codec, "h264", "{name}");
        assert_eq!((video.width, video.height), size, "{name}");
        assert_eq!(audio_of(&probe).codec, "aac");
        near(probe.info.duration, 2.0, 0.25);
    }
}

#[test]
fn previews() {
    let Some(lab) = Lab::new() else { return };
    let webm = lab.vp9(&format!("{NAME}.mkv"), "160x90", true);
    let info = probe(&lab.tools, &webm).unwrap();
    assert!(!playable(&info, "mkv"));

    let proxy_path = lab.out("proxy.mp4");
    let values = Mutex::new(Vec::new());
    let report = |value: Option<f32>| values.lock().unwrap().extend(value);
    let cancelled = || false;
    proxy(
        &lab.tools,
        &webm,
        &proxy_path,
        &Progress::new(&report, &cancelled),
    )
    .unwrap();
    assert_eq!(values.into_inner().unwrap().last(), Some(&1.0));
    let info = probe(&lab.tools, &proxy_path).unwrap();
    assert!(playable(&info, "mp4"));
    let video = info.video.as_ref().unwrap();
    assert_eq!((video.codec.as_str(), video.height), ("h264", 90));

    let png = frame(&lab.tools, &webm, 1.0, 64).unwrap();
    assert!(png.starts_with(b"\x89PNG"));
    let image = image::load_from_memory(&png).unwrap();
    assert_eq!((image.width(), image.height()), (64, 36));
    let last = frame(&lab.tools, &webm, 500.0, 0).unwrap();
    assert_eq!(image::load_from_memory(&last).unwrap().width(), 160);

    let gap = lab.gap(&format!("{NAME} gap.wav"));
    let peaks = peaks(&lab.tools, &gap, 30, &Progress::none()).unwrap();
    assert_eq!(peaks.len(), 30);
    assert!(peaks[..9].iter().all(|&p| p == 0.0), "{peaks:?}");
    assert!(peaks[11..19].iter().all(|&p| p > 0.9), "{peaks:?}");
    assert!(peaks[21..].iter().all(|&p| p == 0.0), "{peaks:?}");
    let mute = lab.video("silent.mp4", "32x32", 1.0, false);
    assert_eq!(
        super::peaks(&lab.tools, &mute, 5, &Progress::none()).unwrap(),
        vec![0.0; 5]
    );
    // A sound file has no picture to show.
    assert!(matches!(
        frame(&lab.tools, &gap, 0.5, 64),
        Err(Error::Unreadable(_))
    ));

    // WMA does not play in the WebView: its proxy is AAC in MP4, without a picture.
    let wma = lab.convert(&gap, "wav", "wma");
    let info = probe(&lab.tools, &wma).unwrap();
    assert!(!playable(&info, "wma"));
    let audio_proxy = lab.out("audio proxy.mp4");
    proxy(&lab.tools, &wma, &audio_proxy, &Progress::none()).unwrap();
    let info = probe(&lab.tools, &audio_proxy).unwrap();
    assert!(info.video.is_none());
    assert_eq!(info.audio.as_ref().unwrap().codec, "aac");
    assert!(playable(&info, "mp4"));
}

#[test]
fn keeps_hevc_when_trimming() {
    let Some(lab) = Lab::new() else { return };
    let hevc = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:r=25:d=2",
            "-c:v",
            "libx265",
            "-preset",
            "ultrafast",
            "-x265-params",
            "log-level=error",
            "-tag:v",
            "hvc1",
        ],
        &lab.path(&format!("{NAME} hevc.mov")),
    );
    let out = lab.out("hevc trimmed.mov");
    lab.tool(
        Tool::TrimVideo {
            span: Span {
                start: 0.4,
                end: 1.4,
            },
        },
        &[hevc],
        &out,
    )
    .unwrap();
    let probe = lab.probe(&out);
    assert_eq!(video_of(&probe).codec, "hevc");
    near(probe.info.duration, 1.0, 0.08);
    assert!(contains(&out, b"hvc1"));
}

#[test]
fn reads_still_pictures() {
    use ::image::GenericImageView;
    let Some(lab) = Lab::new() else { return };
    let png = lab.ffmpeg(
        &["-f", "lavfi", "-i", "testsrc2=s=96x64", "-frames:v", "1"],
        &lab.path(&format!("{NAME}.png")),
    );
    let picture = ::image::load_from_memory(&still(&lab.tools, &png).unwrap()).unwrap();
    assert_eq!(picture.dimensions(), (96, 64));
    assert!(matches!(
        still(&Tools::default(), &png),
        Err(Error::MissingCodec(Codec::Ffmpeg))
    ));

    // An HEIC photo the way the image engine reads it without the system's decoder.
    if !crate::image::heic_write_available() {
        eprintln!("note: no HEIC encoder here, so no HEIC still");
        return;
    }
    let heic = lab.path(&format!("{NAME}.heic"));
    crate::convert(&Conversion {
        input: &png,
        from: "png",
        to: "heic",
        dest: &heic,
        temp: &lab.root,
        options: &Options::default(),
        progress: &Progress::none(),
    })
    .unwrap();
    let picture = ::image::load_from_memory(&still(&lab.tools, &heic).unwrap()).unwrap();
    assert_eq!(picture.dimensions(), (96, 64));
}
