// SPDX-License-Identifier: MIT
//! Cut out parts, Remove pauses, Add music, Fade and volume, Remove noise, Merge audio and Make a
//! ringtone: their filter graphs as text, then real runs on tones, noise and test pictures that
//! FFmpeg makes at run time, checked by their lengths, streams and levels.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use super::probe::Kind;
use super::{audio_of, contains, copied_x264, near, video_of, Lab, NAME};
use crate::media::tools::sound::{
    crossfade_for, cut_graph, denoise_filter, detect_filter, fade_chain, kept, merge_graph,
    music_graph, pause_spans, repeat, settle_mix, settle_pauses, silences, total, Fades, MusicPlan,
    Repeat,
};
use crate::media::{
    frame, pauses, run_tool, Mix, Pauses, RingFormat, Span, Strength, Tool, ToolRun,
};
use crate::{Error, Progress, Result};

fn span(start: f64, end: f64) -> Span {
    Span { start, end }
}

fn mix() -> Mix {
    Mix {
        music: 0.0,
        original: 0.0,
        replace: false,
        duck: false,
        offset: 0.0,
        repeat: false,
        fade_in: 0.0,
        fade_out: 0.0,
    }
}

// ---------------------------------------------------------------- graphs as text

#[test]
fn keeps_what_lies_between_the_cuts() {
    // Overlapping and touching spans merge; what lies outside the file is ignored.
    let pieces = kept(
        &[
            span(4.0, 5.0),
            span(1.0, 2.0),
            span(1.5, 3.0),
            span(3.0, 3.5),
            span(9.0, 20.0),
            span(-3.0, -1.0),
        ],
        10.0,
    );
    assert_eq!(pieces, [(0.0, 1.0), (3.5, 4.0), (5.0, 9.0)]);
    near(total(&pieces), 5.5, 1e-9);
    // A piece too short to hear goes with the cuts around it.
    assert_eq!(
        kept(&[span(0.0, 2.0), span(2.01, 4.0)], 4.0),
        Vec::<(f64, f64)>::new()
    );
    assert_eq!(kept(&[span(0.005, 10.0)], 10.0), Vec::<(f64, f64)>::new());
    assert_eq!(kept(&[span(f64::NAN, 1.0)], 10.0), [(0.0, 10.0)]);
    assert_eq!(kept(&[span(2.0, 2.0)], 10.0), [(0.0, 10.0)]);
}

#[test]
fn builds_one_graph_for_every_cut() {
    let graph = cut_graph(
        &[(0.0, 1.0), (2.0, 3.5), (5.0, 8.0)],
        Some(0),
        &[1],
        8.0,
        false,
    );
    // Each stream is divided once, at every edge between a piece and a cut.
    let edges = "timestamps=1.000000|2.000000|3.500000|5.000000";
    assert!(graph.starts_with(&format!(
        "[0:0]segment={edges}[sv0][sv1][sv2][sv3][sv4];\
         [0:1]asegment={edges}[sa0_0][sa0_1][sa0_2][sa0_3][sa0_4];"
    )));
    assert!(graph.contains("[sv0]setpts=PTS-STARTPTS[v0];"));
    assert!(graph.contains("[sv1]nullsink;[sa0_1]anullsink;"));
    assert!(graph.contains("[sv2]setpts=PTS-STARTPTS[v1];"));
    assert!(graph.contains("[sv3]nullsink;[sa0_3]anullsink;"));
    assert!(graph.contains("[sv4]setpts=PTS-STARTPTS[v2];"));
    // The sound fades only where it meets a cut.
    assert!(graph.contains("[sa0_0]asetpts=PTS-STARTPTS,afade=t=out:st=0.990000:d=0.010000[a0_0];"));
    assert!(graph.contains(
        "[sa0_2]asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.010000,\
         afade=t=out:st=1.490000:d=0.010000[a1_0];"
    ));
    assert!(graph.contains("[sa0_4]asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.010000[a2_0];"));
    assert!(graph.ends_with("[v0][a0_0][v1][a1_0][v2][a2_0]concat=n=3:v=1:a=1[v][a]"));

    // Every audio track is cut; an odd picture is cropped to even sizes; a piece that ends
    // before the file does is followed by a cut.
    let graph = cut_graph(&[(0.5, 2.0)], Some(0), &[1, 2], 10.0, true);
    assert!(graph.starts_with(
        "[0:0]segment=timestamps=0.500000|2.000000[sv0][sv1][sv2];\
         [0:1]asegment=timestamps=0.500000|2.000000[sa0_0][sa0_1][sa0_2];\
         [0:2]asegment=timestamps=0.500000|2.000000[sa1_0][sa1_1][sa1_2];\
         [sv0]nullsink;[sa0_0]anullsink;[sa1_0]anullsink;\
         [sv1]setpts=PTS-STARTPTS,crop=trunc(iw/2)*2:trunc(ih/2)*2[v0];"
    ));
    assert!(graph.contains("[sa1_1]asetpts=PTS-STARTPTS,afade=t=in"));
    assert!(graph.contains("[sv2]nullsink;[sa0_2]anullsink;[sa1_2]anullsink;"));
    assert!(graph.ends_with("[v0][a0_0][a0_1]concat=n=1:v=1:a=2[v][a][a1]"));

    // Sound alone; a tiny piece gets fades of half its length.
    let graph = cut_graph(&[(1.0, 1.01)], None, &[0], 3.0, false);
    assert!(!graph.contains("[v") && !graph.contains("]segment="));
    assert!(graph.contains("afade=t=in:st=0:d=0.005000,afade=t=out:st=0.005000:d=0.005000"));
    assert!(graph.ends_with("[a0_0]concat=n=1:v=0:a=1[a]"));
}

#[test]
fn finds_pauses_with_their_margins() {
    let lines = [
        "[silencedetect @ 0x1] silence_start: -0.0213",
        "[silencedetect @ 0x1] silence_end: 0.8 | silence_duration: 0.82",
        "[silencedetect @ 0x1] silence_start: 2",
        "[silencedetect @ 0x1] silence_end: 3 | silence_duration: 1",
        "[silencedetect @ 0x1] silence_start: 3.4",
        "[silencedetect @ 0x1] silence_end: 3.62 | silence_duration: 0.22",
        "[silencedetect @ 0x1] silence_start: 5.0",
    ]
    .map(String::from);
    let found = silences(&lines);
    assert_eq!(found.len(), 4);
    assert_eq!(found[3], (5.0, None));
    // The leading and trailing pauses go entirely up to the file's ends; inner ones keep their
    // margin on both sides, and one too short for its margins stays.
    assert_eq!(
        pause_spans(&found, 6.0, 0.15),
        [span(0.0, 0.65), span(2.15, 2.85), span(5.15, 6.0)]
    );
    assert_eq!(
        pause_spans(&found, 6.0, 0.0),
        [
            span(0.0, 0.8),
            span(2.0, 3.0),
            span(3.4, 3.62),
            span(5.0, 6.0)
        ]
    );
    assert!(pause_spans(&[], 6.0, 0.15).is_empty());

    let settled = settle_pauses(Pauses {
        threshold: f64::NAN,
        min_length: 0.0,
        keep: -1.0,
    });
    assert_eq!(settled.threshold, Pauses::default().threshold);
    assert_eq!((settled.min_length, settled.keep), (0.1, 0.0));
    assert_eq!(
        detect_filter(Pauses::default()),
        "silencedetect=noise=-40dB:d=0.6"
    );
}

fn plan(original: Option<usize>, repeat: Repeat, mix: Mix) -> MusicPlan {
    MusicPlan {
        length: 30.0,
        left: 12.0,
        rate: 48_000,
        layout: "stereo".into(),
        music: 0,
        original,
        repeat,
        mix,
    }
}

#[test]
fn mixes_music_in_one_graph() {
    // Replacing the sound: the music alone, once, as far as it goes, faded out at its own end.
    let quiet = Mix {
        music: -6.0,
        fade_in: 2.0,
        fade_out: 3.0,
        replace: true,
        ..mix()
    };
    let graph = music_graph(&plan(None, Repeat::Once, quiet));
    assert_eq!(
        graph,
        "[1:0]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,\
         atrim=end=30.000000,volume=-6dB,afade=t=in:st=0:d=2.000000,\
         afade=t=out:st=9.000000:d=3.000000[a]"
    );

    // Looped in memory, it plays to the video's end and fades out there.
    let looped = Mix {
        repeat: true,
        fade_out: 3.0,
        ..mix()
    };
    let graph = music_graph(&plan(Some(1), Repeat::Loop { samples: 624_000 }, looped));
    assert!(graph.starts_with(
        "[1:0]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,\
         aloop=loop=-1:size=624000,atrim=end=30.000000,afade=t=out:st=27.000000:d=3.000000[m];"
    ));
    assert!(graph
        .contains("[0:1]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[own];"));
    assert!(graph.ends_with(
        "[own][m]amix=inputs=2:duration=longest:normalize=0,\
         alimiter=limit=0.891:level=0:latency=1[a]"
    ));
    assert!(!graph.contains("volume="), "0 dB leaves the levels");

    // Read again: one input per repeat, joined; ducking listens to the sound before its level.
    let ducked = Mix {
        duck: true,
        original: -3.0,
        repeat: true,
        ..mix()
    };
    let graph = music_graph(&plan(Some(1), Repeat::Inputs(3), ducked));
    assert!(graph.starts_with("[1:0]aformat="));
    assert!(graph.contains("[r0];[2:0]aformat="));
    assert!(graph.contains("[r1];[3:0]aformat="));
    assert!(graph.contains("[r0][r1][r2]concat=n=3:v=0:a=1,atrim=end=30.000000[m];"));
    assert!(graph.contains("asplit=2[o][sc];[o]anull,volume=-3dB[own];"));
    assert!(graph
        .contains("[m][sc]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=500[duck];"));
    assert!(graph.contains("[own][duck]amix=inputs=2:duration=longest:normalize=0"));
}

#[test]
fn repeats_music_in_memory_or_from_the_file() {
    let again = Mix {
        repeat: true,
        ..mix()
    };
    assert_eq!(repeat(&mix(), 10.0, 60.0, 48_000), Repeat::Once);
    assert_eq!(repeat(&again, 90.0, 60.0, 48_000), Repeat::Once);
    assert_eq!(
        repeat(&again, 10.0, 60.0, 44_100),
        Repeat::Loop { samples: 485_100 }
    );
    assert_eq!(repeat(&again, 150.0, 400.0, 48_000), Repeat::Inputs(3));
    assert_eq!(repeat(&again, f64::INFINITY, 400.0, 48_000), Repeat::Once);

    let settled = settle_mix(
        Mix {
            music: 40.0,
            original: -100.0,
            offset: -2.0,
            fade_in: f64::NAN,
            fade_out: 500.0,
            ..mix()
        },
        20.0,
    );
    assert_eq!((settled.music, settled.original), (6.0, -30.0));
    assert_eq!(
        (settled.offset, settled.fade_in, settled.fade_out),
        (0.0, 0.0, 20.0)
    );
}

#[test]
fn fades_and_levels_as_text() {
    let fades = Fades::new(1.5, 2.0, 10.0);
    assert_eq!(
        fades.chain("fade"),
        "fade=t=in:st=0:d=1.500000,fade=t=out:st=8.000000:d=2.000000"
    );
    assert_eq!(fade_chain(&fades, 0.0), fades.chain("afade"));
    assert_eq!(
        fade_chain(&Fades::new(0.0, 0.0, 10.0), -6.0),
        "volume=-6dB",
        "quieter needs no limiter"
    );
    assert_eq!(
        fade_chain(&Fades::new(0.0, 1.0, 10.0), 6.0),
        "afade=t=out:st=9.000000:d=1.000000,volume=6dB,alimiter=limit=0.891:level=0:latency=1"
    );
    // Fades stay within 10 seconds and the length.
    let long = Fades::new(30.0, 30.0, 4.0);
    assert_eq!((long.fade_in, long.fade_out), (4.0, 4.0));
    assert!(!Fades::new(-1.0, f64::NAN, 4.0).any());
}

#[test]
fn denoises_and_crossfades_as_text() {
    assert_eq!(
        denoise_filter(Strength::Light, false),
        "afftdn=nr=10:nf=-50"
    );
    assert_eq!(
        denoise_filter(Strength::Strong, true),
        "highpass=f=80,highpass=f=80,afftdn=nr=30:nf=-30"
    );

    assert_eq!(crossfade_for(3.0, &[10.0, 20.0, 8.0]), 3.0);
    assert_eq!(
        crossfade_for(9.0, &[10.0, 3.0]),
        1.5,
        "half the shortest file"
    );
    assert_eq!(crossfade_for(50.0, &[100.0, 100.0]), 10.0);
    assert_eq!(crossfade_for(f64::NAN, &[10.0, 10.0]), 0.0);

    let joined = merge_graph(&[0, 1, 0], 44_100, "stereo", 0.0);
    assert_eq!(
        joined,
        "[0:0]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[s0];\
         [1:1]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[s1];\
         [2:0]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[s2];\
         [s0][s1][s2]concat=n=3:v=0:a=1[a]"
    );
    let faded = merge_graph(&[0, 0, 0], 48_000, "mono", 2.0);
    assert!(faded.ends_with(
        "[s0][s1]acrossfade=d=2.000000:c1=qsin:c2=qsin[x1];\
         [x1][s2]acrossfade=d=2.000000:c1=qsin:c2=qsin[a]"
    ));
}

// ---------------------------------------------------------------- real runs

/// Runs a tool with its scratch folder under Turkish letters and an emoji.
fn run(
    lab: &Lab,
    tool: Tool,
    inputs: &[PathBuf],
    dest: &Path,
    progress: &Progress,
) -> (PathBuf, Result<Vec<PathBuf>>) {
    let temp = lab.path(&format!("iş ğ 🧪 {}", tool.id()));
    let _ = fs::remove_dir_all(&temp);
    fs::create_dir_all(&temp).unwrap();
    let result = run_tool(&ToolRun {
        inputs,
        tool: &tool,
        dest,
        temp: &temp,
        tools: &lab.tools,
        progress,
    });
    (temp, result)
}

/// A mono WAV of `expr` (FFmpeg's expression language, in `t`).
fn sound(lab: &Lab, name: &str, expr: &str, seconds: f64, rate: u32) -> PathBuf {
    lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            &format!("aevalsrc='{expr}':s={rate}:d={seconds}"),
            "-c:a",
            "pcm_s16le",
        ],
        &lab.path(name),
    )
}

/// A test picture with `expr` as its stereo sound, as H.264 and AAC in an MP4.
fn talking_video(lab: &Lab, name: &str, expr: &str, seconds: f64) -> PathBuf {
    let picture = format!("testsrc2=s=160x90:r=25:d={seconds}");
    let tone = format!("aevalsrc='{expr}':s=48000:d={seconds}");
    lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            &picture,
            "-f",
            "lavfi",
            "-i",
            &tone,
            "-ac",
            "2",
            "-c:a",
            "aac",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "30",
            "-pix_fmt",
            "yuv420p",
        ],
        &lab.path(name),
    )
}

/// What `astats` measures in the first audio track from `start` for `length` seconds, after
/// `filter`: `RMS_level` or `Peak_level`, in dBFS (-200 for digital silence). The file is decoded
/// from its start: an MP3 seeked into begins with a frame of silence.
fn measure(lab: &Lab, path: &Path, what: &str, start: f64, length: f64, filter: &str) -> f64 {
    let chain = if filter.is_empty() {
        String::new()
    } else {
        format!("{filter},")
    };
    let output = Command::new(lab.tools.ffmpeg.as_ref().unwrap())
        .args(["-hide_banner", "-nostdin", "-nostats", "-i"])
        .arg(path)
        .args(["-map", "0:a:0", "-af"])
        .arg(format!(
            "{chain}atrim=start={start}:duration={length},\
             astats=measure_overall={what}:measure_perchannel=none"
        ))
        .args(["-f", "null", "-"])
        .output()
        .unwrap();
    let log = String::from_utf8_lossy(&output.stderr);
    let label = format!("{} level dB:", what.trim_end_matches("_level"));
    log.lines()
        .find_map(|line| {
            let value = line[line.find(&label)? + label.len()..].trim();
            Some(if value.contains("inf") {
                -200.0
            } else {
                value.parse().ok()?
            })
        })
        .unwrap_or_else(|| panic!("no {what} for {}: {log}", path.display()))
}

fn rms(lab: &Lab, path: &Path, start: f64, length: f64, filter: &str) -> f64 {
    measure(lab, path, "RMS_level", start, length, filter)
}

/// Around `hz` only (two band-pass stages: the other test tone lies some 50 dB down).
fn band(hz: u32) -> String {
    format!("bandpass=f={hz}:width_type=q:w=10,bandpass=f={hz}:width_type=q:w=10")
}

/// Everything but `hz`.
fn without(hz: u32) -> String {
    format!("bandreject=f={hz}:width_type=q:w=2,bandreject=f={hz}:width_type=q:w=2")
}

fn mean_brightness(lab: &Lab, video: &Path, at: f64) -> f64 {
    let png = frame(&lab.tools, video, at, 0).unwrap();
    let image = image::load_from_memory(&png).unwrap().to_luma8();
    image
        .pixels()
        .map(|pixel| f64::from(pixel.0[0]))
        .sum::<f64>()
        / image.pixels().len() as f64
}

fn streams(lab: &Lab, path: &Path, kind: Kind) -> usize {
    lab.probe(path)
        .streams
        .iter()
        .filter(|stream| stream.kind == kind)
        .count()
}

#[test]
fn cuts_out_parts_of_video_and_audio() {
    let Some(lab) = Lab::new() else { return };
    let mp4 = lab.video(&format!("{NAME}.mp4"), "160x90", 4.0, true);
    let before = fs::read(&mp4).unwrap();
    let out = lab.out("cut.mp4");
    let (_, result) = run(
        &lab,
        Tool::CutOut {
            spans: vec![span(1.0, 2.0), span(1.5, 2.5)],
        },
        std::slice::from_ref(&mp4),
        &out,
        &Progress::none(),
    );
    assert_eq!(result.unwrap(), std::slice::from_ref(&out));
    let probe = lab.probe(&out);
    near(probe.info.duration, 2.5, 0.08);
    assert_eq!(video_of(&probe).codec, "h264");
    assert_eq!(audio_of(&probe).codec, "aac");
    assert!(!copied_x264(&out), "the picture is encoded again");
    assert_eq!(fs::read(&mp4).unwrap(), before, "the input is untouched");
    // The tone runs on across the cut.
    assert!(rms(&lab, &out, 0.9, 0.2, "") > -25.0);

    let wav = lab.wav(&format!("{NAME}.wav"), 3.0, 0.5);
    let out = lab.out("cut.wav");
    lab.tool(
        Tool::CutOut {
            spans: vec![span(0.0, 0.5), span(2.0, 2.4)],
        },
        std::slice::from_ref(&wav),
        &out,
    )
    .unwrap();
    let probe = lab.probe(&out);
    near(probe.info.duration, 2.1, 0.01);
    let sound = audio_of(&probe);
    assert_eq!(
        (sound.codec.as_str(), sound.sample_rate, sound.channels),
        ("pcm_s16le", 44100, 2),
        "the format stays"
    );
    // The cut falls between two zero crossings; without its fades it would click, which shows
    // as sound high above the tone.
    let joint = lab.out("joint.wav");
    lab.tool(
        Tool::CutOut {
            spans: vec![span(1.0013, 2.0029)],
        },
        std::slice::from_ref(&wav),
        &joint,
    )
    .unwrap();
    let clicks = "highpass=f=4000,highpass=f=4000,highpass=f=4000";
    assert!(rms(&lab, &joint, 0.9, 0.2, clicks) < -60.0, "no click");

    // Every audio format keeps its codec.
    for (ext, codec) in [
        ("m4a", "aac"),
        ("mp3", "mp3"),
        ("flac", "flac"),
        ("ogg", "vorbis"),
        ("opus", "opus"),
    ] {
        let converted = lab.convert(&wav, "wav", ext);
        let named = lab.path(&format!("{NAME}.{ext}"));
        fs::rename(&converted, &named).unwrap();
        let out = lab.out(&format!("cut.{ext}"));
        lab.tool(
            Tool::CutOut {
                spans: vec![span(0.5, 1.0)],
            },
            std::slice::from_ref(&named),
            &out,
        )
        .unwrap();
        let probe = lab.probe(&out);
        near(probe.info.duration, 2.5, 0.08);
        assert_eq!(audio_of(&probe).codec, codec, "{ext}");
    }
    // And so does every video format.
    for (name, video) in [
        (
            "mov",
            lab.video(&format!("{NAME}.mov"), "160x90", 2.0, true),
        ),
        ("webm", lab.vp9(&format!("{NAME}.webm"), "160x90", true)),
    ] {
        let out = lab.out(&format!("cut.{name}"));
        lab.tool(
            Tool::CutOut {
                spans: vec![span(0.5, 1.0)],
            },
            std::slice::from_ref(&video),
            &out,
        )
        .unwrap();
        let probe = lab.probe(&out);
        near(probe.info.duration, 1.5, 0.08);
        let source = lab.probe(&video);
        assert_eq!(video_of(&probe).codec, video_of(&source).codec, "{name}");
        assert_eq!(audio_of(&probe).codec, audio_of(&source).codec, "{name}");
    }

    for (spans, why) in [
        (vec![], "no span"),
        (vec![span(0.0, 3.0)], "nothing left"),
        (vec![span(5.0, 6.0)], "nothing to cut"),
    ] {
        let result = lab.tool(
            Tool::CutOut { spans },
            std::slice::from_ref(&wav),
            &lab.out("none.wav"),
        );
        assert!(matches!(result, Err(Error::Other(_))), "{why}: {result:?}");
    }
}

#[test]
fn cuts_every_track_and_drops_subtitles() {
    let Some(lab) = Lab::new() else { return };
    let srt = lab.path("altyazı.srt");
    fs::write(&srt, "1\n00:00:00,500 --> 00:00:02,500\nMerhaba\n").unwrap();
    // Two sound tracks, one of them 5.1, and a subtitle track in an MKV.
    let mkv = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:r=25:d=3",
            "-f",
            "lavfi",
            "-i",
            "sine=f=440:r=48000:d=3",
            "-f",
            "lavfi",
            "-i",
            "sine=f=660:r=44100:d=3",
            "-i",
            srt.to_str().unwrap(),
            "-map",
            "0",
            "-map",
            "1",
            "-map",
            "2",
            "-map",
            "3",
            "-ac:a:0",
            "6",
            "-c:a",
            "aac",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:s",
            "srt",
        ],
        &lab.path(&format!("{NAME}.mkv")),
    );
    assert_eq!(streams(&lab, &mkv, Kind::Subtitle), 1);
    let out = lab.out("cut.mkv");
    lab.tool(
        Tool::CutOut {
            spans: vec![span(1.0, 2.0)],
        },
        std::slice::from_ref(&mkv),
        &out,
    )
    .unwrap();
    let probe = lab.probe(&out);
    near(probe.info.duration, 2.0, 0.08);
    let audios: Vec<_> = probe.audios().collect();
    assert_eq!(audios.len(), 2, "both tracks are cut");
    assert_eq!((audios[0].channels, audios[1].channels), (6, 1));
    assert_eq!(audios[1].sample_rate, 44100);
    assert_eq!(streams(&lab, &out, Kind::Subtitle), 0);
}

#[test]
fn reads_a_long_list_of_cuts_from_a_file() {
    let Some(lab) = Lab::new() else { return };
    let wav = sound(
        &lab,
        &format!("{NAME} uzun.wav"),
        "0.3*sin(2*PI*440*t)",
        30.0,
        22050,
    );
    let spans: Vec<Span> = (0..200)
        .map(|i| span(f64::from(i) * 0.15, f64::from(i) * 0.15 + 0.05))
        .collect();
    let out = lab.out("many cuts.wav");
    let (temp, result) = run(
        &lab,
        Tool::CutOut { spans },
        std::slice::from_ref(&wav),
        &out,
        &Progress::none(),
    );
    result.unwrap();
    assert!(
        fs::metadata(temp.join("graph.txt")).unwrap().len() > 16_000,
        "the graph was too long for the command line"
    );
    near(lab.probe(&out).info.duration, 20.0, 0.02);
}

/// Mono: silence, tone 0.8–2, silence, tone 3–3.4, a short gap, tone 3.7–5, silence to 6.
const TALK: &str = "0.5*sin(2*PI*440*t)*(between(t,0.8,2)+between(t,3,3.4)+between(t,3.7,5))";

#[test]
fn finds_and_removes_pauses() {
    let Some(lab) = Lab::new() else { return };
    let wav = sound(&lab, &format!("{NAME}.wav"), TALK, 6.0, 44100);
    let found = pauses(&lab.tools, &wav, Pauses::default(), &Progress::none()).unwrap();
    assert_eq!(found.len(), 3, "{found:?}");
    let expected = [span(0.0, 0.65), span(2.15, 2.85), span(5.15, 6.0)];
    for (found, expected) in found.iter().zip(expected) {
        near(found.start, expected.start, 0.02);
        near(found.end, expected.end, 0.02);
    }

    let values = Mutex::new(Vec::new());
    let report = |value: Option<f32>| values.lock().unwrap().extend(value);
    let cancelled = || false;
    let out = lab.out("no pauses.wav");
    let (_, result) = run(
        &lab,
        Tool::RemovePauses {
            pauses: Pauses::default(),
        },
        std::slice::from_ref(&wav),
        &out,
        &Progress::new(&report, &cancelled),
    );
    result.unwrap();
    near(lab.probe(&out).info.duration, 3.8, 0.03);
    let values = values.into_inner().unwrap();
    assert_eq!(values.last(), Some(&1.0));
    assert!(
        values.windows(2).all(|pair| pair[0] <= pair[1]),
        "{values:?}"
    );
    assert!(
        values.iter().any(|value| *value > 0.0 && *value <= 0.2),
        "the search has its share: {values:?}"
    );

    // A video loses the same pauses, picture and sound together.
    let mp4 = talking_video(&lab, &format!("{NAME}.mp4"), TALK, 6.0);
    let out = lab.out("no pauses.mp4");
    lab.tool(
        Tool::RemovePauses {
            pauses: Pauses::default(),
        },
        std::slice::from_ref(&mp4),
        &out,
    )
    .unwrap();
    let probe = lab.probe(&out);
    near(probe.info.duration, 3.8, 0.1);
    assert_eq!(video_of(&probe).codec, "h264");
    assert_eq!(audio_of(&probe).channels, 2);

    // Nothing to find, and nothing to listen to.
    let steady = lab.wav("steady.wav", 2.0, 0.5);
    assert!(lab
        .tool(
            Tool::RemovePauses {
                pauses: Pauses::default()
            },
            &[steady],
            &lab.out("steady.wav"),
        )
        .is_err());
    let silent_video = lab.video("silent.mp4", "160x90", 1.0, false);
    assert!(pauses(
        &lab.tools,
        &silent_video,
        Pauses::default(),
        &Progress::none()
    )
    .is_err());
}

#[test]
fn removing_pauses_cancels() {
    let Some(lab) = Lab::new() else { return };
    let long = sound(&lab, &format!("{NAME} long.wav"), TALK, 600.0, 48000);
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let report = |_: Option<f32>| cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    let cancelled = || cancel.load(std::sync::atomic::Ordering::Relaxed);
    let (_, result) = run(
        &lab,
        Tool::RemovePauses {
            pauses: Pauses::default(),
        },
        std::slice::from_ref(&long),
        &lab.out("cancelled.wav"),
        &Progress::new(&report, &cancelled),
    );
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
}

#[test]
fn adds_music_to_a_video() {
    let Some(lab) = Lab::new() else { return };
    let mp4 = lab.video(&format!("{NAME}.mp4"), "160x90", 3.0, true);
    let music = sound(
        &lab,
        &format!("{NAME} müzik.wav"),
        "0.3*sin(2*PI*1000*t)",
        1.0,
        44100,
    );
    let add = |name: &str, mix: Mix| {
        let out = lab.out(name);
        lab.tool(
            Tool::AddMusic {
                music: music.clone(),
                mix,
            },
            std::slice::from_ref(&mp4),
            &out,
        )
        .unwrap();
        let probe = lab.probe(&out);
        near(probe.info.duration, 3.0, 0.1);
        assert!(copied_x264(&out), "the picture is copied");
        assert_eq!(audio_of(&probe).codec, "aac");
        out
    };

    // Replaced and repeated: the music to the end, the video's own tone gone.
    let out = add(
        "replaced.mp4",
        Mix {
            replace: true,
            repeat: true,
            ..mix()
        },
    );
    assert!(rms(&lab, &out, 2.2, 0.6, &band(1000)) > -25.0);
    assert!(rms(&lab, &out, 0.2, 0.6, &band(440)) < -50.0);

    // Mixed once, 6 dB down: both tones at first, the video's alone after the music ends.
    let out = add(
        "mixed.mp4",
        Mix {
            music: -6.0,
            ..mix()
        },
    );
    let early = rms(&lab, &out, 0.2, 0.6, &band(1000));
    assert!(early > -32.0 && early < -18.0, "{early}");
    assert!(rms(&lab, &out, 0.2, 0.6, &band(440)) > -35.0);
    assert!(rms(&lab, &out, 2.0, 0.8, &band(1000)) < -50.0);

    // Faded: quiet at the start, full in the middle.
    let out = add(
        "faded.mp4",
        Mix {
            repeat: true,
            fade_in: 1.0,
            fade_out: 1.0,
            ..mix()
        },
    );
    let start = rms(&lab, &out, 0.0, 0.1, &band(1000));
    let middle = rms(&lab, &out, 1.4, 0.2, &band(1000));
    assert!(middle - start > 12.0, "{start} → {middle}");

    // From an offset past its end there is no music.
    assert!(lab
        .tool(
            Tool::AddMusic {
                music: music.clone(),
                mix: Mix {
                    offset: 5.0,
                    ..mix()
                },
            },
            std::slice::from_ref(&mp4),
            &lab.out("late.mp4"),
        )
        .is_err());

    // A video without sound simply gets the music; a WebM gets Opus.
    let silent = lab.video("sessiz.mp4", "160x90", 2.0, false);
    let out = lab.out("music only.mp4");
    lab.tool(
        Tool::AddMusic {
            music: music.clone(),
            mix: Mix {
                repeat: true,
                ..mix()
            },
        },
        std::slice::from_ref(&silent),
        &out,
    )
    .unwrap();
    assert_eq!(audio_of(&lab.probe(&out)).channels, 1);
    let webm = lab.vp9(&format!("{NAME}.webm"), "160x90", true);
    let out = lab.out("music.webm");
    lab.tool(
        Tool::AddMusic {
            music: music.clone(),
            mix: mix(),
        },
        std::slice::from_ref(&webm),
        &out,
    )
    .unwrap();
    let probe = lab.probe(&out);
    assert_eq!(audio_of(&probe).codec, "opus");
    assert_eq!(video_of(&probe).codec, "vp9");
}

#[test]
fn music_steps_back_while_someone_speaks() {
    let Some(lab) = Lab::new() else { return };
    // Speech stands in as a tone in the first and last second.
    let mp4 = talking_video(
        &lab,
        &format!("{NAME}.mp4"),
        "0.5*sin(2*PI*440*t)*(between(t,0,1)+between(t,2,3))",
        3.0,
    );
    let music = sound(&lab, "müzik.wav", "0.3*sin(2*PI*1000*t)", 3.0, 48000);
    let mut dips = Vec::new();
    for duck in [false, true] {
        let out = lab.out(&format!("duck {duck}.mp4"));
        lab.tool(
            Tool::AddMusic {
                music: music.clone(),
                mix: Mix { duck, ..mix() },
            },
            std::slice::from_ref(&mp4),
            &out,
        )
        .unwrap();
        let speaking = rms(&lab, &out, 0.3, 0.6, &band(1000));
        let quiet = rms(&lab, &out, 1.6, 0.35, &band(1000));
        dips.push(quiet - speaking);
    }
    assert!(dips[0].abs() < 1.0, "no ducking: {dips:?}");
    assert!(dips[1] > 6.0, "ducking: {dips:?}");
}

#[test]
fn repeats_long_music_from_the_file() {
    let Some(lab) = Lab::new() else { return };
    let video = lab.video(&format!("{NAME}.mp4"), "32x18", 130.0, false);
    let music = lab.wav("uzun müzik.wav", 125.0, 0.3);
    let out = lab.out("long music.mp4");
    lab.tool(
        Tool::AddMusic {
            music,
            mix: Mix {
                repeat: true,
                ..mix()
            },
        },
        std::slice::from_ref(&video),
        &out,
    )
    .unwrap();
    near(lab.probe(&out).info.duration, 130.0, 0.2);
    assert!(rms(&lab, &out, 127.0, 2.0, "") > -30.0, "it plays again");
}

#[test]
fn fades_and_changes_the_level() {
    let Some(lab) = Lab::new() else { return };
    let wav = lab.wav(&format!("{NAME}.wav"), 3.0, 0.5);
    let fade = |name: &str, fade_in, fade_out, volume| {
        let out = lab.out(name);
        lab.tool(
            Tool::Fade {
                fade_in,
                fade_out,
                picture: false,
                volume,
            },
            std::slice::from_ref(&wav),
            &out,
        )
        .unwrap();
        out
    };
    let out = fade("faded.wav", 1.0, 1.0, 0.0);
    let probe = lab.probe(&out);
    near(probe.info.duration, 3.0, 0.01);
    assert_eq!(audio_of(&probe).codec, "pcm_s16le");
    let start = rms(&lab, &out, 0.0, 0.1, "");
    let middle = rms(&lab, &out, 1.4, 0.2, "");
    let end = rms(&lab, &out, 2.9, 0.1, "");
    assert!(
        middle - start > 15.0 && middle - end > 15.0,
        "{start} {middle} {end}"
    );

    let quieter = fade("quieter.wav", 0.0, 0.0, -6.0);
    near(lab.loudness(&quieter), lab.loudness(&wav) - 6.0, 0.5);
    // 12 dB louder would pass full scale; the limiter holds it under -1 dBFS.
    let louder = fade("louder.wav", 0.0, 0.0, 12.0);
    let peak = measure(&lab, &louder, "Peak_level", 0.0, 3.0, "");
    assert!(peak < -0.5 && peak > -3.0, "{peak}");
    assert!(lab.loudness(&louder) > lab.loudness(&wav) + 3.0);

    assert!(lab
        .tool(
            Tool::Fade {
                fade_in: 0.0,
                fade_out: 0.0,
                picture: false,
                volume: 0.0
            },
            std::slice::from_ref(&wav),
            &lab.out("same.wav"),
        )
        .is_err());

    // The picture stays copied unless it fades too.
    let mp4 = lab.video(&format!("{NAME}.mp4"), "160x90", 3.0, true);
    let out = lab.out("sound faded.mp4");
    lab.tool(
        Tool::Fade {
            fade_in: 1.0,
            fade_out: 0.0,
            picture: false,
            volume: 0.0,
        },
        std::slice::from_ref(&mp4),
        &out,
    )
    .unwrap();
    assert!(copied_x264(&out));
    let silent = lab.video("sessiz.mp4", "160x90", 3.0, false);
    let out = lab.out("picture faded.mp4");
    lab.tool(
        Tool::Fade {
            fade_in: 1.0,
            fade_out: 1.0,
            picture: true,
            volume: 0.0,
        },
        std::slice::from_ref(&silent),
        &out,
    )
    .unwrap();
    assert!(!copied_x264(&out));
    assert!(mean_brightness(&lab, &out, 0.0) < 8.0);
    assert!(mean_brightness(&lab, &out, 1.5) > 40.0);
    assert!(lab.probe(&out).info.audio.is_none());
    assert!(
        lab.tool(
            Tool::Fade {
                fade_in: 1.0,
                fade_out: 1.0,
                picture: false,
                volume: 0.0,
            },
            std::slice::from_ref(&silent),
            &lab.out("no sound.mp4"),
        )
        .is_err(),
        "only the sound would fade, and there is none"
    );
}

#[test]
fn removes_noise_and_rumble() {
    let Some(lab) = Lab::new() else { return };
    // A tone at -21 dBFS in white noise at about -45 dBFS.
    let noisy = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=f=440:r=48000:d=4",
            "-f",
            "lavfi",
            "-i",
            "anoisesrc=r=48000:a=0.01:c=white:d=4:seed=7",
            "-filter_complex",
            "[0:a]volume=2[t];[t][1:a]amix=inputs=2:normalize=0",
            "-c:a",
            "pcm_s16le",
        ],
        &lab.path(&format!("{NAME} gürültülü.wav")),
    );
    let noise_before = rms(&lab, &noisy, 0.5, 3.0, &without(440));
    let tone_before = rms(&lab, &noisy, 0.5, 3.0, &band(440));
    let mut reductions = Vec::new();
    for strength in [Strength::Light, Strength::Medium, Strength::Strong] {
        let out = lab.out(&format!("clean {strength:?}.wav"));
        lab.tool(
            Tool::Denoise {
                strength,
                rumble: false,
            },
            std::slice::from_ref(&noisy),
            &out,
        )
        .unwrap();
        near(lab.probe(&out).info.duration, 4.0, 0.01);
        near(rms(&lab, &out, 0.5, 3.0, &band(440)), tone_before, 1.0);
        reductions.push(noise_before - rms(&lab, &out, 0.5, 3.0, &without(440)));
    }
    assert!(
        reductions[1] > 8.0 && reductions[2] > reductions[1] && reductions[1] > reductions[0],
        "{reductions:?}"
    );

    let rumbling = sound(
        &lab,
        "uğultu.wav",
        "0.3*sin(2*PI*40*t)+0.3*sin(2*PI*440*t)",
        3.0,
        44100,
    );
    let out = lab.out("no rumble.wav");
    lab.tool(
        Tool::Denoise {
            strength: Strength::Light,
            rumble: true,
        },
        std::slice::from_ref(&rumbling),
        &out,
    )
    .unwrap();
    let low = "lowpass=f=60,lowpass=f=60";
    assert!(rms(&lab, &rumbling, 0.5, 2.0, low) - rms(&lab, &out, 0.5, 2.0, low) > 15.0);
    near(
        rms(&lab, &out, 0.5, 2.0, &band(440)),
        rms(&lab, &rumbling, 0.5, 2.0, &band(440)),
        1.0,
    );

    // A video keeps its picture.
    let mp4 = lab.video(&format!("{NAME}.mp4"), "160x90", 2.0, true);
    let out = lab.out("clean.mp4");
    lab.tool(
        Tool::Denoise {
            strength: Strength::Medium,
            rumble: true,
        },
        std::slice::from_ref(&mp4),
        &out,
    )
    .unwrap();
    assert!(copied_x264(&out));
    assert_eq!(audio_of(&lab.probe(&out)).codec, "aac");
    let silent = lab.video("sessiz.mp4", "160x90", 1.0, false);
    assert!(lab
        .tool(
            Tool::Denoise {
                strength: Strength::Light,
                rumble: false
            },
            &[silent],
            &lab.out("nothing.mp4"),
        )
        .is_err());
}

#[test]
fn merges_audio_files() {
    let Some(lab) = Lab::new() else { return };
    let wav = lab.wav(&format!("{NAME} 1.wav"), 1.0, 0.5);
    let cover = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=teal:s=64x64:d=1",
            "-frames:v",
            "1",
        ],
        &lab.path("kapak.png"),
    );
    let mp3 = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=f=660:r=48000:d=1.5",
            "-i",
            cover.to_str().unwrap(),
            "-map",
            "0",
            "-map",
            "1",
            "-c:a",
            "libmp3lame",
            "-c:v",
            "mjpeg",
            "-disposition:v:0",
            "attached_pic",
            "-id3v2_version",
            "3",
        ],
        &lab.path(&format!("{NAME} 2.mp3")),
    );
    let flac = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=f=880:r=32000:d=1",
            "-ac",
            "6",
            "-c:a",
            "flac",
        ],
        &lab.path(&format!("{NAME} 3.flac")),
    );
    let merge = |name: &str, inputs: &[PathBuf], crossfade: f64| {
        let out = lab.out(name);
        lab.tool(Tool::MergeAudio { crossfade }, inputs, &out)
            .unwrap();
        out
    };
    let all = [wav.clone(), mp3.clone(), flac.clone()];
    let out = merge("joined.wav", &all, 0.0);
    let probe = lab.probe(&out);
    near(probe.info.duration, 3.5, 0.06);
    let first = audio_of(&probe);
    assert_eq!(
        (first.codec.as_str(), first.sample_rate, first.channels),
        ("pcm_s16le", 44100, 2),
        "the first file sets the format"
    );
    near(
        lab.probe(&merge("crossfaded.wav", &all, 0.4)).info.duration,
        2.7,
        0.06,
    );
    // Never more than half the shortest file.
    near(
        lab.probe(&merge("capped.wav", &all, 9.0)).info.duration,
        2.5,
        0.06,
    );

    // The MP3 first: mono MP3 at 48 kHz, without its cover.
    let out = merge("joined.mp3", &[mp3.clone(), wav.clone()], 0.0);
    let probe = lab.probe(&out);
    near(probe.info.duration, 2.5, 0.08);
    let first = audio_of(&probe);
    assert_eq!(
        (first.codec.as_str(), first.sample_rate, first.channels),
        ("mp3", 48000, 1)
    );
    assert_eq!(streams(&lab, &mp3, Kind::Video), 1);
    assert_eq!(streams(&lab, &out, Kind::Video), 0, "no cover art");

    // Opus and Vorbis keep their codecs.
    let opus = lab.ffmpeg(
        &["-i", wav.to_str().unwrap(), "-c:a", "libopus"],
        &lab.path(&format!("{NAME}.opus")),
    );
    let out = merge("joined.opus", &[opus, flac.clone()], 0.2);
    assert_eq!(audio_of(&lab.probe(&out)).codec, "opus");
    let ogg = lab.ffmpeg(
        &["-i", wav.to_str().unwrap(), "-c:a", "libvorbis"],
        &lab.path(&format!("{NAME}.ogg")),
    );
    let out = merge("joined.ogg", &[ogg, wav.clone()], 0.0);
    assert_eq!(audio_of(&lab.probe(&out)).codec, "vorbis");

    assert!(lab
        .tool(
            Tool::MergeAudio { crossfade: 0.0 },
            &[wav],
            &lab.out("one.wav")
        )
        .is_err());
}

#[test]
fn makes_ringtones() {
    let Some(lab) = Lab::new() else { return };
    let mp4 = lab.video(&format!("{NAME}.mp4"), "160x90", 3.0, true);
    let out = lab.out("ringtone.m4r");
    lab.tool(
        Tool::Ringtone {
            span: span(0.5, 2.5),
            fade: true,
            format: RingFormat::M4r,
        },
        std::slice::from_ref(&mp4),
        &out,
    )
    .unwrap();
    let probe = lab.probe(&out);
    near(probe.info.duration, 2.0, 0.06);
    assert!(probe.info.video.is_none());
    assert_eq!(audio_of(&probe).codec, "aac");
    assert!(probe.format.contains("mp4"), "{}", probe.format);
    assert!(contains(&out, b"ftypM4A "), "an MPEG-4 audio file");
    let start = rms(&lab, &out, 0.0, 0.05, "");
    let middle = rms(&lab, &out, 1.0, 0.05, "");
    assert!(middle - start > 10.0, "faded in: {start} {middle}");

    // At most 40 seconds, as an MP3, surround folded to stereo.
    let long = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=f=440:r=48000:d=50",
            "-ac",
            "6",
            "-c:a",
            "flac",
        ],
        &lab.path(&format!("{NAME} şarkı.flac")),
    );
    let out = lab.out("ringtone.mp3");
    lab.tool(
        Tool::Ringtone {
            span: span(2.0, 49.0),
            fade: false,
            format: RingFormat::Mp3,
        },
        std::slice::from_ref(&long),
        &out,
    )
    .unwrap();
    let probe = lab.probe(&out);
    near(probe.info.duration, 40.0, 0.1);
    let sound = audio_of(&probe);
    assert_eq!((sound.codec.as_str(), sound.channels), ("mp3", 2));
    let start = rms(&lab, &out, 0.0, 0.05, "");
    let middle = rms(&lab, &out, 20.0, 0.05, "");
    assert!((middle - start).abs() < 3.0, "not faded: {start} {middle}");

    let silent = lab.video("sessiz.mp4", "160x90", 1.0, false);
    assert!(lab
        .tool(
            Tool::Ringtone {
                span: span(0.0, 1.0),
                fade: true,
                format: RingFormat::M4r
            },
            &[silent],
            &lab.out("nothing.m4r"),
        )
        .is_err());
}
