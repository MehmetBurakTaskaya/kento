// SPDX-License-Identifier: MIT
//! Compress for video and audio, on clips FFmpeg makes at run time at generous rates, so that
//! every container has room to shrink.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::{audio_of, near, video_of, Lab, NAME};
use crate::compress::{compress, CompressRun, Compression};
use crate::{Codec, Error, FileKind, Options, Progress, Result, Tools};

const VIDEO: &[&str] = &["mp4", "mov", "mkv", "webm", "avi", "wmv"];

/// Compresses `input` into a fresh output, with a scratch folder under Turkish letters and an
/// emoji (the two-pass statistics go there).
fn squeeze(
    lab: &Lab,
    input: &Path,
    from: &str,
    compression: Compression,
    progress: &Progress,
) -> (PathBuf, Result<Vec<PathBuf>>) {
    let label = format!("{from} {compression:?}").replace([':', '{', '}', ' '], "-");
    let dest = lab.out(&format!("{label}.{from}"));
    let temp = lab.path(&format!("iş ğ 🧪 {label}"));
    fs::create_dir_all(&temp).unwrap();
    let options = Options {
        tools: lab.tools.clone(),
        ..Options::default()
    };
    let kind = if VIDEO.contains(&from) {
        FileKind::Video
    } else {
        FileKind::Audio
    };
    let result = compress(&CompressRun {
        input,
        from,
        kind,
        compression,
        dest: &dest,
        temp: &temp,
        options: &options,
        progress,
    });
    (dest, result)
}

fn size(path: &Path) -> u64 {
    fs::metadata(path).unwrap().len()
}

/// A clip with a test picture and a stereo tone in `codecs`.
fn clip(lab: &Lab, ext: &str, size: &str, seconds: f64, codecs: &[&str]) -> PathBuf {
    let picture = format!("testsrc2=s={size}:r=25:d={seconds}");
    let tone = format!("sine=f=440:r=48000:d={seconds}");
    let mut args = vec!["-f", "lavfi", "-i", &picture, "-f", "lavfi", "-i", &tone];
    args.extend(["-ac", "2"]);
    args.extend(codecs);
    lab.ffmpeg(&args, &lab.path(&format!("{NAME} {size}.{ext}")))
}

/// Each video container's own codecs at a high rate, and what Compress writes there.
fn video_sources(ext: &str) -> (&'static [&'static str], &'static str, &'static str) {
    match ext {
        "mp4" | "mov" | "mkv" => (
            &[
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "14",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "256k",
            ],
            "h264",
            "aac",
        ),
        "webm" => (
            &[
                "-c:v",
                "libvpx-vp9",
                "-deadline",
                "realtime",
                "-cpu-used",
                "8",
                "-b:v",
                "3M",
                "-c:a",
                "libopus",
                "-b:a",
                "256k",
            ],
            "vp9",
            "opus",
        ),
        "avi" => (
            &[
                "-c:v",
                "mpeg4",
                "-q:v",
                "2",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "256k",
            ],
            "mpeg4",
            "mp3",
        ),
        "wmv" => (
            &["-c:v", "wmv2", "-q:v", "2", "-c:a", "wmav2", "-b:a", "256k"],
            "wmv2",
            "wmav2",
        ),
        other => panic!("no source for {other}"),
    }
}

/// The audio formats that shrink in their own format, with how their sources are made.
const AUDIO: &[(&str, &[&str], &str)] = &[
    ("mp3", &["-c:a", "libmp3lame", "-b:a", "320k"], "mp3"),
    ("m4a", &["-c:a", "aac", "-b:a", "256k"], "aac"),
    ("ogg", &["-c:a", "libvorbis", "-q:a", "9"], "vorbis"),
    ("opus", &["-c:a", "libopus", "-b:a", "256k"], "opus"),
    ("wma", &["-c:a", "wmav2", "-b:a", "256k"], "wmav2"),
];

/// Two tones and some noise in stereo: variable-rate encoders spend little on a pure tone.
const BUSY: &str = "aevalsrc=0.4*sin(2*PI*440*t)+0.1*sin(2*PI*1250*t)+0.05*(random(0)-0.5)|\
                    0.4*sin(2*PI*330*t)+0.05*(random(1)-0.5):s=44100:d=3";

fn audio_source(lab: &Lab, ext: &str, codecs: &[&str]) -> PathBuf {
    let mut args = vec!["-f", "lavfi", "-i", BUSY];
    args.extend(codecs);
    lab.ffmpeg(&args, &lab.path(&format!("{NAME}.{ext}")))
}

/// The decoded samples' MD5, to tell a lossless result from the original.
fn pcm_hash(lab: &Lab, path: &Path) -> String {
    let output = Command::new(lab.tools.ffmpeg.as_ref().unwrap())
        .args(["-hide_banner", "-nostdin", "-loglevel", "error", "-i"])
        .arg(path)
        .args(["-map", "0:a", "-f", "hash", "-hash", "md5", "-"])
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

#[test]
fn compress_without_ffmpeg() {
    let dir = tempfile::tempdir().unwrap();
    let run = |name: &str, from: &str, kind: FileKind| {
        let input = dir.path().join(name);
        fs::write(&input, b"x").unwrap();
        compress(&CompressRun {
            input: &input,
            from,
            kind,
            compression: Compression::Quality { level: 50 },
            dest: &dir.path().join(format!("out {name}")),
            temp: dir.path(),
            options: &Options {
                tools: Tools::default(),
                ..Options::default()
            },
            progress: &Progress::none(),
        })
    };
    assert!(matches!(
        run("a.mp4", "mp4", FileKind::Video),
        Err(Error::MissingCodec(Codec::Ffmpeg))
    ));
    assert!(matches!(
        run("a.mp3", "mp3", FileKind::Audio),
        Err(Error::MissingCodec(Codec::Ffmpeg))
    ));
    // Plain samples cannot shrink in their own format, FFmpeg or not.
    for (name, from) in [("a.wav", "wav"), ("a.aiff", "aiff")] {
        assert!(matches!(
            run(name, from, FileKind::Audio),
            Err(Error::Unsupported { .. })
        ));
    }
}

#[test]
fn compress_video_quality_in_every_container() {
    let Some(lab) = Lab::new() else { return };
    for &ext in VIDEO {
        let (codecs, video_codec, audio_codec) = video_sources(ext);
        let input = clip(&lab, ext, "320x180", 2.0, codecs);
        let (dest, result) = squeeze(
            &lab,
            &input,
            ext,
            Compression::Quality { level: 40 },
            &Progress::none(),
        );
        assert_eq!(result.unwrap(), vec![dest.clone()], "{ext}");
        assert!(size(&dest) < size(&input), "{ext} gets smaller");
        let probe = lab.probe(&dest);
        let picture = video_of(&probe);
        assert_eq!(picture.codec, video_codec, "{ext}");
        assert_eq!((picture.width, picture.height), (320, 180), "{ext}");
        assert_eq!(audio_of(&probe).codec, audio_codec, "{ext}");
        near(probe.info.duration, 2.0, 0.15);
    }
}

#[test]
fn compress_video_to_a_target_size() {
    let Some(lab) = Lab::new() else { return };
    for &ext in VIDEO {
        let (codecs, video_codec, _) = video_sources(ext);
        let input = clip(&lab, ext, "320x180", 3.0, codecs);
        let target = size(&input) * 35 / 100;
        let values = Mutex::new(Vec::new());
        let report = |value: Option<f32>| values.lock().unwrap().extend(value);
        let cancelled = || false;
        let (dest, result) = squeeze(
            &lab,
            &input,
            ext,
            Compression::Size { bytes: target },
            &Progress::new(&report, &cancelled),
        );
        result.unwrap_or_else(|error| panic!("{ext}: {error:?}"));
        let written = size(&dest);
        assert!(written <= target, "{ext}: {written} > {target}");
        assert!(written > target / 3, "{ext} uses its budget: {written}");
        let probe = lab.probe(&dest);
        assert_eq!(video_of(&probe).codec, video_codec, "{ext}");
        assert_eq!(video_of(&probe).height, 180, "{ext} has bits enough");
        near(probe.info.duration, 3.0, 0.15);
        let values = values.into_inner().unwrap();
        assert_eq!(values.last(), Some(&1.0), "{ext}");
        assert!(values.windows(2).all(|w| w[0] <= w[1]), "{ext}: {values:?}");
    }

    let mp4 = clip(&lab, "mp4", "320x180", 2.0, video_sources("mp4").0);
    let (dest, result) = squeeze(
        &lab,
        &mp4,
        "mp4",
        Compression::Ratio { percent: 50 },
        &Progress::none(),
    );
    result.unwrap();
    assert!(size(&dest) <= size(&mp4) / 2);
}

#[test]
fn compress_scales_down_when_bits_run_short() {
    let Some(lab) = Lab::new() else { return };
    let input = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=1280x720:r=25:d=2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "14",
        ],
        &lab.path(&format!("{NAME} 720p.mp4")),
    );
    let target = 72_000;
    let (dest, result) = squeeze(
        &lab,
        &input,
        "mp4",
        Compression::Size { bytes: target },
        &Progress::none(),
    );
    result.unwrap();
    assert!(size(&dest) <= target);
    let probe = lab.probe(&dest);
    let picture = video_of(&probe);
    assert!(
        (240..=480).contains(&picture.height),
        "a smaller picture: {}",
        picture.height
    );
    near(
        f64::from(picture.width) / f64::from(picture.height),
        16.0 / 9.0,
        0.02,
    );
}

#[test]
fn compress_says_when_nothing_smaller_comes_out() {
    let Some(lab) = Lab::new() else { return };
    let (codecs, _, _) = video_sources("mp4");
    let input = clip(&lab, "mp4", "320x180", 2.0, codecs);
    let (dest, result) = squeeze(
        &lab,
        &input,
        "mp4",
        Compression::Size { bytes: 2_000 },
        &Progress::none(),
    );
    assert!(matches!(result, Err(Error::NotSmaller)), "{result:?}");
    assert!(!dest.exists());

    // A clip already squeezed hard grows at the best quality, so nothing is kept.
    let poor = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=25:d=2",
            "-c:v",
            "libx264",
            "-crf",
            "51",
        ],
        &lab.path(&format!("{NAME} poor.mp4")),
    );
    let (dest, result) = squeeze(
        &lab,
        &poor,
        "mp4",
        Compression::Quality { level: 100 },
        &Progress::none(),
    );
    assert!(matches!(result, Err(Error::NotSmaller)), "{result:?}");
    assert!(!dest.exists());
}

#[test]
fn compress_audio_in_its_own_format() {
    let Some(lab) = Lab::new() else { return };
    let wav = lab.wav(&format!("{NAME}.wav"), 3.0, 0.5);
    for &(ext, codecs, codec) in AUDIO {
        let input = audio_source(&lab, ext, codecs);
        let (dest, result) = squeeze(
            &lab,
            &input,
            ext,
            Compression::Quality { level: 30 },
            &Progress::none(),
        );
        result.unwrap_or_else(|error| panic!("{ext}: {error:?}"));
        assert!(size(&dest) < size(&input), "{ext} gets smaller");
        let probe = lab.probe(&dest);
        assert_eq!(audio_of(&probe).codec, codec, "{ext}");
        assert_eq!(audio_of(&probe).channels, 2, "{ext}");
        near(probe.info.duration, 3.0, 0.1);

        let target = size(&input) * 40 / 100;
        let (dest, result) = squeeze(
            &lab,
            &input,
            ext,
            Compression::Ratio { percent: 40 },
            &Progress::none(),
        );
        result.unwrap_or_else(|error| panic!("{ext}: {error:?}"));
        assert!(size(&dest) <= target, "{ext}: {} > {target}", size(&dest));
        assert_eq!(audio_of(&lab.probe(&dest)).codec, codec, "{ext}");
    }

    let (dest, result) = squeeze(
        &lab,
        &wav,
        "wav",
        Compression::Quality { level: 50 },
        &Progress::none(),
    );
    assert!(matches!(result, Err(Error::Unsupported { .. })));
    assert!(!dest.exists());
}

#[test]
fn compress_flac_without_loss() {
    let Some(lab) = Lab::new() else { return };
    let flac = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            BUSY,
            "-c:a",
            "flac",
            "-compression_level",
            "0",
        ],
        &lab.path(&format!("{NAME}.flac")),
    );
    let (dest, result) = squeeze(
        &lab,
        &flac,
        "flac",
        Compression::Quality { level: 10 },
        &Progress::none(),
    );
    result.unwrap();
    assert!(size(&dest) < size(&flac));
    assert_eq!(audio_of(&lab.probe(&dest)).codec, "flac");
    assert_eq!(
        pcm_hash(&lab, &dest),
        pcm_hash(&lab, &flac),
        "nothing is lost"
    );

    // Lossless coding cannot halve this sound.
    let (dest, result) = squeeze(
        &lab,
        &flac,
        "flac",
        Compression::Ratio { percent: 50 },
        &Progress::none(),
    );
    assert!(matches!(result, Err(Error::NotSmaller)), "{result:?}");
    assert!(!dest.exists());
}

#[test]
fn compress_cancels_ffmpeg() {
    let Some(lab) = Lab::new() else { return };
    let long = lab.video(&format!("{NAME} long.mp4"), "640x360", 20.0, false);
    let cancel = AtomicBool::new(false);
    let report = |_: Option<f32>| cancel.store(true, Ordering::Relaxed);
    let cancelled = || cancel.load(Ordering::Relaxed);
    let progress = Progress::new(&report, &cancelled);
    let started = Instant::now();
    let (dest, result) = squeeze(
        &lab,
        &long,
        "mp4",
        Compression::Ratio { percent: 50 },
        &progress,
    );
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(10));
    // FFmpeg has ended: on Windows a running process would hold its files open.
    if dest.exists() {
        fs::remove_file(&dest).unwrap();
    }
}
