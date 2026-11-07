// SPDX-License-Identifier: MIT
//! Merge videos with transitions, on clips FFmpeg makes at run time.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::{audio_of, near, video_of, Lab, NAME};
use crate::media::tools::{merge_graph, overlaps, Canvas, Clip};
use crate::media::{frame, run_tool, Tool, ToolRun, Transition, TransitionKind};
use crate::{Error, Progress};

const RED: [u8; 3] = [255, 0, 0];
const GREEN: [u8; 3] = [0, 255, 0];
const BLUE: [u8; 3] = [0, 0, 255];

/// A clip of one colour, `size` at `rate` frames a second, with a stereo tone when `sound` is
/// given (its sample rate, mono for 44.1 kHz so that the layouts differ too).
fn clip(
    lab: &Lab,
    name: &str,
    [r, g, b]: [u8; 3],
    size: &str,
    rate: u32,
    seconds: f64,
    sound: Option<u32>,
) -> PathBuf {
    let picture = format!("color=c=0x{r:02X}{g:02X}{b:02X}:s={size}:r={rate}:d={seconds}");
    let mut args = vec!["-f".to_owned(), "lavfi".into(), "-i".into(), picture];
    if let Some(rate) = sound {
        let channels = if rate == 44_100 { "1" } else { "2" };
        args.extend([
            "-f".into(),
            "lavfi".into(),
            "-i".into(),
            format!("sine=f=440:r={rate}:d={seconds}"),
            "-ac".into(),
            channels.into(),
            "-c:a".into(),
            "aac".into(),
        ]);
    }
    args.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
        ]
        .map(String::from),
    );
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    lab.ffmpeg(&args, &lab.path(&format!("{NAME} {name}.mp4")))
}

fn merge(kind: TransitionKind, seconds: f64) -> Tool {
    Tool::MergeVideos {
        transition: Transition { kind, seconds },
    }
}

/// The colour of a pixel of the result's frame at `at` seconds.
fn pixel(lab: &Lab, video: &Path, at: f64, x: u32, y: u32) -> [u8; 3] {
    let png = frame(&lab.tools, video, at, 0).unwrap();
    image::load_from_memory(&png)
        .unwrap()
        .to_rgb8()
        .get_pixel(x, y)
        .0
}

/// Whether two colours are within `tolerance` in every channel.
fn like(actual: [u8; 3], expected: [u8; 3], tolerance: u8) -> bool {
    actual
        .iter()
        .zip(expected)
        .all(|(a, e)| a.abs_diff(e) <= tolerance)
}

/// The length of each stream (video, audio) by ffprobe.
fn stream_lengths(lab: &Lab, path: &Path) -> Vec<(String, f64)> {
    let output = Command::new(lab.tools.ffprobe.as_ref().unwrap())
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,duration",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let (kind, seconds) = line.trim().split_once(',')?;
            Some((kind.to_owned(), seconds.parse().ok()?))
        })
        .collect()
}

#[test]
fn transitions_fit_between_the_clips() {
    assert_eq!(overlaps(0.5, &[2.0, 2.0, 2.0]), [0.5, 0.5]);
    // 0.2 to 2 seconds, and never more than a third of the shorter neighbour.
    assert_eq!(overlaps(0.05, &[10.0, 10.0]), [0.2]);
    assert_eq!(overlaps(5.0, &[10.0, 10.0]), [2.0]);
    let short = overlaps(1.0, &[10.0, 0.3, 10.0]);
    assert_eq!(short.len(), 2);
    for overlap in short {
        near(overlap, 0.1, 1e-9);
    }
    near(overlaps(2.0, &[3.0, 9.0])[0], 1.0, 1e-9);
    assert_eq!(overlaps(f64::NAN, &[10.0, 10.0]), [0.5]);
    assert!(overlaps(1.0, &[4.0]).is_empty());
}

#[test]
fn builds_the_merge_graphs() {
    let canvas = Canvas {
        width: 160,
        height: 90,
        rate: "30000/1001".into(),
        layout: "stereo",
        sound: true,
    };
    let clips = [
        Clip {
            video: 0,
            audio: Some(1),
            length: 2.0,
        },
        Clip {
            video: 0,
            audio: None,
            length: 2.0,
        },
        Clip {
            video: 1,
            audio: Some(0),
            length: 2.0,
        },
    ];
    // A cut is the concat graph Merge videos has always made.
    let (cut, length) = merge_graph(&clips[..2], &canvas, Transition::default());
    assert_eq!(
        cut,
        "[0:0]scale=160:90:force_original_aspect_ratio=decrease:force_divisible_by=2,\
         pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30000/1001,format=yuv420p[v0];\
         [0:1]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0];\
         [1:0]scale=160:90:force_original_aspect_ratio=decrease:force_divisible_by=2,\
         pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30000/1001,format=yuv420p[v1];\
         anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=2.000000[a1];\
         [v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"
    );
    assert_eq!(length, 4.0);

    let (graph, length) = merge_graph(
        &clips,
        &canvas,
        Transition {
            kind: TransitionKind::Fade,
            seconds: 0.5,
        },
    );
    near(length, 5.0, 1e-9);
    for part in [
        "[0:0]scale=160:90:",
        "setsar=1,fps=30000/1001:start_time=0,format=yuv420p,\
         tpad=stop_mode=clone:stop_duration=2.000000,trim=duration=2.000000,settb=AVTB[v0];",
        "[0:1]aresample=48000:async=1:first_pts=0,\
         aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,\
         apad=whole_dur=2.000000,atrim=duration=2.000000[a0];",
        "anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=2.000000[a1];",
        "[2:1]scale=",
        "[2:0]aresample=48000:async=1",
        "[v0][v1]xfade=transition=fade:duration=0.500000:offset=1.500000[x1];",
        "[x1][v2]xfade=transition=fade:duration=0.500000:offset=3.000000[v];",
        "[a0][a1]acrossfade=d=0.500000[y1];",
        "[y1][a2]acrossfade=d=0.500000[a]",
    ] {
        assert!(graph.contains(part), "{part} is not in {graph}");
    }
    assert!(
        !graph.contains("concat") && !graph.ends_with(';'),
        "{graph}"
    );

    // Without sound there is no sound to crossfade, and each kind has its xfade.
    let silent = Canvas {
        sound: false,
        ..canvas.clone()
    };
    for (kind, name) in [
        (TransitionKind::FadeBlack, "fadeblack"),
        (TransitionKind::Slide, "slideleft"),
        (TransitionKind::Wipe, "wipeleft"),
    ] {
        let (graph, length) = merge_graph(&clips[..2], &silent, Transition { kind, seconds: 1.0 });
        near(length, 4.0 - 2.0 / 3.0, 1e-9);
        assert!(
            graph.ends_with(&format!(
                "[v0][v1]xfade=transition={name}:duration=0.666667:offset=1.333333[v]"
            )),
            "{graph}"
        );
        assert!(
            !graph.contains("aresample") && !graph.contains("[a"),
            "{graph}"
        );
    }

    // One clip has nothing to go into.
    let (single, _) = merge_graph(
        &clips[..1],
        &canvas,
        Transition {
            kind: TransitionKind::Wipe,
            seconds: 1.0,
        },
    );
    assert!(single.ends_with("concat=n=1:v=1:a=1[v][a]"), "{single}");
}

#[test]
fn fades_from_clip_to_clip() {
    let Some(lab) = Lab::new() else { return };
    let red = clip(&lab, "red", RED, "160x90", 25, 2.0, Some(48_000));
    let blue = clip(&lab, "blue", BLUE, "160x90", 25, 2.0, Some(48_000));
    let out = lab.out("faded.mp4");
    lab.tool(merge(TransitionKind::Fade, 0.5), &[red, blue], &out)
        .unwrap();
    let probe = lab.probe(&out);
    near(probe.info.duration, 3.5, 0.06);
    assert_eq!((video_of(&probe).width, video_of(&probe).height), (160, 90));
    assert_eq!(audio_of(&probe).channels, 2);
    for (kind, seconds) in stream_lengths(&lab, &out) {
        near(seconds, 3.5, 0.06);
        assert!(kind == "video" || kind == "audio", "{kind}");
    }
    assert!(like(pixel(&lab, &out, 1.0, 80, 45), RED, 24));
    assert!(like(pixel(&lab, &out, 2.5, 80, 45), BLUE, 24));
    // Halfway through the fade the picture is both: neither clip's colour, about their blend.
    let [r, g, b] = pixel(&lab, &out, 1.75, 80, 45);
    assert!(
        (80..=180).contains(&r) && (80..=180).contains(&b) && g < 50,
        "{r} {g} {b}"
    );
}

#[test]
fn three_clips_meet_with_each_kind() {
    let Some(lab) = Lab::new() else { return };
    // Different sizes, frame rates and sound: stereo at 48 kHz, none, mono at 44.1 kHz.
    let clips = [
        clip(&lab, "red", RED, "160x90", 25, 2.0, Some(48_000)),
        clip(&lab, "green", GREEN, "120x120", 30, 2.0, None),
        clip(&lab, "blue", BLUE, "320x240", 24, 2.0, Some(44_100)),
    ];
    for kind in [
        TransitionKind::Fade,
        TransitionKind::FadeBlack,
        TransitionKind::Slide,
        TransitionKind::Wipe,
    ] {
        let out = lab.out(&format!("three {kind:?}.mp4"));
        lab.tool(merge(kind, 0.6), &clips, &out).unwrap();
        let probe = lab.probe(&out);
        // n·d − (n−1)·t
        near(probe.info.duration, 3.0 * 2.0 - 2.0 * 0.6, 0.06);
        let picture = video_of(&probe);
        assert_eq!((picture.width, picture.height), (160, 90), "{kind:?}");
        near(picture.fps, 25.0, 0.01);
        let sound = audio_of(&probe);
        assert_eq!((sound.channels, sound.sample_rate), (2, 48_000), "{kind:?}");
        for (_, seconds) in stream_lengths(&lab, &out) {
            near(seconds, 4.8, 0.06);
        }
        // Between the transitions each clip shows on its own (the green square is padded to
        // the middle of the frame).
        assert!(like(pixel(&lab, &out, 0.7, 80, 45), RED, 24), "{kind:?}");
        assert!(like(pixel(&lab, &out, 2.1, 80, 45), GREEN, 24), "{kind:?}");
        assert!(like(pixel(&lab, &out, 4.2, 80, 45), BLUE, 24), "{kind:?}");
        // Halfway through each transition: from 1.4 to 2.0 and from 2.8 to 3.4 seconds. A
        // slide moves the old clip to the left, so its middle is further left than with a
        // wipe, which uncovers the new clip where it stands (the green square spans 35 to 125,
        // the blue picture 20 to 140).
        let (x0, x1) = if kind == TransitionKind::Slide {
            (20, 140)
        } else {
            (50, 112)
        };
        for (at, from, to) in [(1.7, RED, GREEN), (3.1, GREEN, BLUE)] {
            let (left, right) = (pixel(&lab, &out, at, x0, 45), pixel(&lab, &out, at, x1, 45));
            match kind {
                // The new clip comes in from the right; the old one leaves to the left.
                TransitionKind::Slide | TransitionKind::Wipe => {
                    assert!(like(left, from, 24), "{kind:?} {at}: {left:?}");
                    assert!(like(right, to, 24), "{kind:?} {at}: {right:?}");
                }
                TransitionKind::FadeBlack => {
                    assert!(left.iter().all(|c| *c < 90), "{kind:?} {at}: {left:?}");
                }
                _ => {
                    assert!(!like(left, from, 40) && !like(left, to, 40), "{left:?}");
                    // The same across the frame, give or take the encoder.
                    assert!(like(left, right, 12), "{left:?} {right:?}");
                }
            }
        }
    }
}

#[test]
fn merges_silent_and_very_short_clips() {
    let Some(lab) = Lab::new() else { return };
    let red = clip(&lab, "red", RED, "160x90", 25, 2.0, None);
    let blue = clip(&lab, "blue", BLUE, "160x90", 25, 2.0, None);
    let out = lab.out("silent.mp4");
    lab.tool(
        merge(TransitionKind::Slide, 1.0),
        &[red.clone(), blue.clone()],
        &out,
    )
    .unwrap();
    let probe = lab.probe(&out);
    assert!(probe.info.audio.is_none(), "no clip has sound");
    near(probe.info.duration, 4.0 - 2.0 / 3.0, 0.06);

    // A clip of a third of a second between two longer ones: the transitions shrink to a third
    // of it, so it still shows.
    let short = clip(&lab, "short", GREEN, "160x90", 25, 0.3, Some(48_000));
    let out = lab.out("short.mp4");
    lab.tool(merge(TransitionKind::Fade, 1.0), &[red, short, blue], &out)
        .unwrap();
    let probe = lab.probe(&out);
    near(probe.info.duration, 4.3 - 0.2, 0.06);
    assert!(like(pixel(&lab, &out, 2.12, 80, 45), GREEN, 40));
}

#[test]
fn transitions_report_progress_and_cancel() {
    let Some(lab) = Lab::new() else { return };
    let a = clip(&lab, "a", RED, "320x180", 25, 4.0, Some(48_000));
    let b = clip(&lab, "b", BLUE, "320x180", 25, 4.0, Some(48_000));
    let values = Mutex::new(Vec::new());
    let report = |value: Option<f32>| values.lock().unwrap().extend(value);
    let cancelled = || false;
    let progress = Progress::new(&report, &cancelled);
    let temp = tempfile::tempdir().unwrap();
    let out = lab.out("progress.mp4");
    run_tool(&ToolRun {
        inputs: &[a, b],
        tool: &merge(TransitionKind::Fade, 2.0),
        dest: &out,
        temp: temp.path(),
        tools: &lab.tools,
        progress: &progress,
    })
    .unwrap();
    let values = values.into_inner().unwrap();
    assert_eq!(values.last(), Some(&1.0));
    assert!(values.windows(2).all(|p| p[0] <= p[1]), "{values:?}");
    // The bar follows the result's 6 seconds, not the clips' 8: FFmpeg's last position is near
    // the end of the bar before it is filled.
    let before = values.iter().rev().nth(1).copied().unwrap_or_default();
    assert!(before > 0.9, "{values:?}");
    assert_eq!(
        fs::read_dir(temp.path()).unwrap().count(),
        0,
        "nothing in temp"
    );

    let long = [
        clip(&lab, "long a", RED, "640x360", 25, 20.0, Some(48_000)),
        clip(&lab, "long b", BLUE, "640x360", 25, 20.0, None),
    ];
    let cancel = AtomicBool::new(false);
    let report = |_: Option<f32>| cancel.store(true, Ordering::Relaxed);
    let cancelled = || cancel.load(Ordering::Relaxed);
    let progress = Progress::new(&report, &cancelled);
    let dest = lab.out("cancelled.mp4");
    let started = Instant::now();
    let result = run_tool(&ToolRun {
        inputs: &long,
        tool: &merge(TransitionKind::Wipe, 1.0),
        dest: &dest,
        temp: temp.path(),
        tools: &lab.tools,
        progress: &progress,
    });
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(10));
    // FFmpeg has ended: on Windows a running process would hold the file open.
    if dest.exists() {
        fs::remove_file(&dest).unwrap();
    }
}

#[test]
fn a_clip_without_a_length_takes_no_transition() {
    let Some(lab) = Lab::new() else { return };
    let red = clip(&lab, "red", RED, "160x90", 25, 1.0, None);
    // A still picture has no length.
    let still = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=white:s=64x64:d=0.04",
            "-frames:v",
            "1",
        ],
        &lab.path(&format!("{NAME} still.png")),
    );
    let out = lab.out("still.mp4");
    let result = lab.tool(merge(TransitionKind::Fade, 0.5), &[red, still], &out);
    assert!(matches!(result, Err(Error::Other(_))), "{result:?}");
    assert!(!out.exists());
}
