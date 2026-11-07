// SPDX-License-Identifier: MIT
//! Make vertical, Add text or logo, Erase in Redact video, Rotate video, Reverse and loop, Color and look and Stabilize video, on clips FFmpeg makes at run time.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use ::image::{ImageFormat, Rgb, RgbImage};

use super::{audio_of, near, video_of, Lab, NAME};
use crate::media::{
    frame, run_tool, Area, Fill, Grade, Hide, Layer, LayerSource, Look, LoopMode, Redaction, Span,
    Strength, Tool, ToolRun, Turn,
};
use crate::{Error, Progress, Result};

const RED: [u8; 3] = [255, 0, 0];
const GREEN: [u8; 3] = [0, 255, 0];
const BLUE: [u8; 3] = [0, 0, 255];
const WHITE: [u8; 3] = [255, 255, 255];

/// Runs `tool` on `input` into a fresh output, with a scratch folder under Turkish letters and an
/// emoji, as the job's own folder would be.
fn attempt(
    lab: &Lab,
    tool: Tool,
    input: &Path,
    name: &str,
    progress: &Progress,
) -> (PathBuf, Result<Vec<PathBuf>>) {
    let dest = lab.out(name);
    let temp = lab.path(&format!("iş ğ 🧪 {name}"));
    fs::create_dir_all(&temp).unwrap();
    let result = run_tool(&ToolRun {
        inputs: &[input.to_path_buf()],
        tool: &tool,
        dest: &dest,
        temp: &temp,
        tools: &lab.tools,
        progress,
    });
    (dest, result)
}

fn run(lab: &Lab, tool: Tool, input: &Path, name: &str) -> PathBuf {
    let (dest, result) = attempt(lab, tool, input, name, &Progress::none());
    assert_eq!(result.unwrap(), std::slice::from_ref(&dest));
    dest
}

fn fails(lab: &Lab, tool: Tool, input: &Path, name: &str) -> Error {
    attempt(lab, tool, input, name, &Progress::none())
        .1
        .expect_err("the tool should refuse")
}

/// A video of a still picture, `seconds` long at 25 frames a second, with a stereo tone when
/// `sound`.
fn still(lab: &Lab, name: &str, picture: &RgbImage, seconds: f64, sound: bool) -> PathBuf {
    let png = lab.path(&format!("{name}.png"));
    picture.save_with_format(&png, ImageFormat::Png).unwrap();
    let length = seconds.to_string();
    let tone = format!("sine=f=440:r=48000:d={seconds}");
    let mut args = vec![
        "-loop",
        "1",
        "-framerate",
        "25",
        "-i",
        png.to_str().unwrap(),
    ];
    if sound {
        args.extend(["-f", "lavfi", "-i", &tone, "-ac", "2", "-c:a", "aac"]);
    }
    args.extend([
        "-t",
        &length,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
    ]);
    lab.ffmpeg(&args, &lab.path(&format!("{NAME} {name}.mp4")))
}

/// VP9 and Opus at 333 × 101: VP9 holds odd sizes, which the test pattern would round off.
fn odd_webm(lab: &Lab) -> PathBuf {
    lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=orange:s=333x101:r=25:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=f=330:r=48000:d=1",
            "-c:v",
            "libvpx-vp9",
            "-deadline",
            "realtime",
            "-cpu-used",
            "8",
            "-c:a",
            "libopus",
        ],
        &lab.path(&format!("{NAME} odd.webm")),
    )
}

/// Red on the left half, blue on the right.
fn halves(width: u32, height: u32) -> RgbImage {
    RgbImage::from_fn(width, height, |x, _| {
        Rgb(if x < width / 2 { RED } else { BLUE })
    })
}

/// Red at the top left, green at the top right, blue at the bottom left, white at the bottom
/// right.
fn quarters(width: u32, height: u32) -> RgbImage {
    RgbImage::from_fn(width, height, |x, y| {
        Rgb(match (x < width / 2, y < height / 2) {
            (true, true) => RED,
            (false, true) => GREEN,
            (true, false) => BLUE,
            (false, false) => WHITE,
        })
    })
}

fn pixel(lab: &Lab, video: &Path, at: f64, x: u32, y: u32) -> [u8; 3] {
    let png = frame(&lab.tools, video, at, 0).unwrap();
    ::image::load_from_memory(&png)
        .unwrap()
        .to_rgb8()
        .get_pixel(x, y)
        .0
}

fn like(actual: [u8; 3], expected: [u8; 3]) -> bool {
    actual
        .iter()
        .zip(expected)
        .all(|(&a, e)| (i16::from(a) - i16::from(e)).abs() <= 40)
}

/// The colours at the middles of a frame's four quarters: top left, top right, bottom left,
/// bottom right.
fn corners(lab: &Lab, video: &Path) -> [[u8; 3]; 4] {
    let png = frame(&lab.tools, video, 0.5, 0).unwrap();
    let image = ::image::load_from_memory(&png).unwrap().to_rgb8();
    let (w, h) = image.dimensions();
    [
        (w / 4, h / 4),
        (3 * w / 4, h / 4),
        (w / 4, 3 * h / 4),
        (3 * w / 4, 3 * h / 4),
    ]
    .map(|(x, y)| image.get_pixel(x, y).0)
}

/// What ffprobe prints about the video streams.
fn streams(lab: &Lab, path: &Path) -> String {
    let output = Command::new(lab.tools.ffprobe.as_ref().unwrap())
        .args(["-v", "error", "-show_streams", "-select_streams", "v"])
        .arg(path)
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// Decodes the whole file and says what FFmpeg complained about (nothing, for a sound file).
fn complaints(lab: &Lab, path: &Path) -> String {
    let output = Command::new(lab.tools.ffmpeg.as_ref().unwrap())
        .args(["-hide_banner", "-nostdin", "-v", "error", "-i"])
        .arg(path)
        .args(["-f", "null", "-"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stderr).into_owned()
}

/// The average loudness of `length` seconds from `start`, in dB.
fn loudness(lab: &Lab, path: &Path, start: f64, length: f64) -> f64 {
    let output = Command::new(lab.tools.ffmpeg.as_ref().unwrap())
        .args([
            "-hide_banner",
            "-nostdin",
            "-ss",
            &start.to_string(),
            "-t",
            &length.to_string(),
            "-i",
        ])
        .arg(path)
        .args(["-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"])
        .output()
        .unwrap();
    let log = String::from_utf8_lossy(&output.stderr);
    log.lines()
        .find_map(|line| {
            let value = line.split("mean_volume:").nth(1)?;
            value.trim().trim_end_matches("dB").trim().parse().ok()
        })
        .unwrap_or(-120.0)
}

/// The number of video frames in a file.
fn frames(lab: &Lab, path: &Path) -> u64 {
    let output = Command::new(lab.tools.ffprobe.as_ref().unwrap())
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-count_packets",
            "-show_entries",
            "stream=nb_read_packets",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .unwrap()
}

#[test]
fn makes_vertical_videos() {
    let Some(lab) = Lab::new() else { return };
    let source = still(&lab, "halves", &halves(320, 180), 2.0, true);
    let vertical = |fill, span, name: &str| {
        let out = run(&lab, Tool::MakeVertical { span, fill }, &source, name);
        let probe = lab.probe(&out);
        let picture = video_of(&probe);
        assert_eq!((picture.width, picture.height), (1080, 1920), "{name}");
        assert_eq!(picture.codec, "h264");
        assert_eq!(picture.pixel_format, "yuv420p");
        assert_eq!(audio_of(&probe).codec, "aac");
        assert!(probe.format.contains("mp4"), "{}", probe.format);
        (out, probe.info.duration)
    };

    let (left, length) = vertical(Fill::Crop { center: 0.0 }, None, "left.mp4");
    near(length, 2.0, 0.1);
    assert!(like(pixel(&lab, &left, 1.0, 540, 960), RED));
    let (right, _) = vertical(Fill::Crop { center: 1.0 }, None, "right.mp4");
    assert!(like(pixel(&lab, &right, 1.0, 540, 960), BLUE));

    let span = Span {
        start: 0.5,
        end: 1.5,
    };
    let (part, length) = vertical(Fill::Crop { center: 0.5 }, Some(span), "part.mp4");
    near(length, 1.0, 0.1);
    assert!(lab.probe(&part).info.audio.is_some());

    let (blurred, _) = vertical(Fill::Blur, None, "blurred.mp4");
    // The picture across the middle, a blurred copy above and below it.
    assert!(like(pixel(&lab, &blurred, 1.0, 270, 960), RED));
    assert!(like(pixel(&lab, &blurred, 1.0, 810, 960), BLUE));
    let above = pixel(&lab, &blurred, 1.0, 100, 200);
    assert!(
        above[0] > 100 && above[2] < 120,
        "a darkened, blurred red: {above:?}"
    );

    let (colored, _) = vertical(Fill::Color { rgb: GREEN }, None, "colored.mp4");
    assert!(like(pixel(&lab, &colored, 1.0, 540, 100), GREEN));
    assert!(like(pixel(&lab, &colored, 1.0, 270, 960), RED));
}

#[test]
fn vertical_keeps_rate_sound_and_shape() {
    let Some(lab) = Lab::new() else { return };
    // 120 frames a second and 5.1 sound become 60 and stereo.
    let fast = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=120:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=f=440:r=48000:d=1",
            "-af",
            "aformat=channel_layouts=5.1",
            "-c:a",
            "aac",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
        ],
        &lab.path(&format!("{NAME} fast.mkv")),
    );
    assert_eq!(audio_of(&lab.probe(&fast)).channels, 6);
    let out = run(
        &lab,
        Tool::MakeVertical {
            span: None,
            fill: Fill::Blur,
        },
        &fast,
        "fast.mp4",
    );
    let probe = lab.probe(&out);
    near(video_of(&probe).fps, 60.0, 0.01);
    assert_eq!(audio_of(&probe).channels, 2);

    // A phone video shown upright (9:16), and one narrower than 9:16 without sound.
    let landscape = lab.video(&format!("{NAME} phone source.mp4"), "320x180", 1.0, true);
    let phone = lab.ffmpeg(
        &[
            "-display_rotation",
            "90",
            "-i",
            landscape.to_str().unwrap(),
            "-c",
            "copy",
        ],
        &lab.path(&format!("{NAME} phone.mp4")),
    );
    let narrow = lab.video(&format!("{NAME} narrow.mp4"), "100x300", 1.0, false);
    // An odd size in VP9 and Opus, which becomes H.264 and AAC like any other.
    let odd = odd_webm(&lab);
    for (input, name, sound) in [
        (&phone, "phone.mp4", true),
        (&narrow, "narrow.mp4", false),
        (&odd, "odd.mp4", true),
    ] {
        let out = run(
            &lab,
            Tool::MakeVertical {
                span: None,
                fill: Fill::Crop { center: 0.5 },
            },
            input,
            name,
        );
        let probe = lab.probe(&out);
        assert_eq!(
            (video_of(&probe).width, video_of(&probe).height),
            (1080, 1920)
        );
        assert_eq!(video_of(&probe).codec, "h264");
        assert!(!streams(&lab, &out).contains("rotation"));
        assert_eq!(probe.info.audio.is_some(), sound, "{name}");
    }
}

#[test]
fn odd_sizes_keep_their_codec() {
    let Some(lab) = Lab::new() else { return };
    let odd = odd_webm(&lab);
    let turned = run(
        &lab,
        Tool::RotateVideo {
            turn: Turn::Right,
            mirror: false,
            flip: false,
        },
        &odd,
        "odd turned.webm",
    );
    let probe = lab.probe(&turned);
    assert_eq!(
        (video_of(&probe).width, video_of(&probe).height),
        (101, 333)
    );
    assert_eq!(video_of(&probe).codec, "vp9");
    assert_eq!(audio_of(&probe).codec, "opus");
    let erased = run(
        &lab,
        Tool::RedactVideo {
            areas: vec![Redaction {
                area: Area {
                    x: 300.0,
                    y: 80.0,
                    width: 33.0,
                    height: 21.0,
                },
                span: Span {
                    start: 0.0,
                    end: 9.0,
                },
            }],
            hide: Hide::Erase,
        },
        &odd,
        "odd erased.webm",
    );
    assert_eq!(video_of(&lab.probe(&erased)).width, 333);
    let colored = run(
        &lab,
        Tool::ColorVideo {
            look: Look::Vivid,
            grade: Grade {
                brightness: 0.0,
                contrast: 0.0,
                saturation: 0.0,
                warmth: 0.0,
            },
        },
        &odd,
        "odd vivid.webm",
    );
    assert_eq!(video_of(&lab.probe(&colored)).height, 101);
}

/// A PNG file in base64, as the page sends text.
fn base64_png(picture: &RgbImage) -> String {
    let mut bytes = Vec::new();
    picture
        .write_to(&mut std::io::Cursor::new(&mut bytes), ImageFormat::Png)
        .unwrap();
    const DIGITS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut text = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, &b)| n | u32::from(b) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                text.push(DIGITS[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                text.push('=');
            }
        }
    }
    text
}

#[test]
fn adds_text_and_pictures() {
    let Some(lab) = Lab::new() else { return };
    let black = still(&lab, "black", &RgbImage::new(320, 180), 2.0, true);
    let logo = lab.path("Logo ğ 🧪.jpg");
    RgbImage::from_pixel(64, 32, Rgb(GREEN))
        .save_with_format(&logo, ImageFormat::Jpeg)
        .unwrap();
    let text = base64_png(&RgbImage::from_pixel(40, 20, Rgb(WHITE)));
    let area = |x, y, width, height| Area {
        x,
        y,
        width,
        height,
    };
    let layers = vec![
        Layer {
            source: LayerSource::Picture { png: text.clone() },
            area: area(10.0, 10.0, 40.0, 20.0),
            opacity: 1.0,
            span: Some(Span {
                start: 0.5,
                end: 1.5,
            }),
        },
        Layer {
            source: LayerSource::Image { path: logo },
            area: area(200.0, 100.0, 96.0, 48.0),
            opacity: 0.5,
            span: None,
        },
        // Partly off the frame.
        Layer {
            source: LayerSource::Picture {
                png: format!("data:image/png;base64,{text}"),
            },
            area: area(300.0, 160.0, 40.0, 20.0),
            opacity: 1.0,
            span: None,
        },
    ];
    let out = run(
        &lab,
        Tool::AddOverlay {
            layers: layers.clone(),
        },
        &black,
        "layered.mp4",
    );
    let probe = lab.probe(&out);
    assert_eq!(
        (video_of(&probe).width, video_of(&probe).height),
        (320, 180)
    );
    assert_eq!(video_of(&probe).codec, "h264");
    assert_eq!(audio_of(&probe).codec, "aac");
    near(probe.info.duration, 2.0, 0.1);
    assert!(
        like(pixel(&lab, &out, 1.0, 30, 20), WHITE),
        "the text shows in its time"
    );
    assert!(
        like(pixel(&lab, &out, 0.2, 30, 20), [0, 0, 0]),
        "and not before"
    );
    assert!(like(pixel(&lab, &out, 1.8, 30, 20), [0, 0, 0]), "or after");
    let half_green = pixel(&lab, &out, 0.2, 248, 124);
    assert!(
        like(half_green, [0, 128, 0]),
        "the logo at half opacity: {half_green:?}"
    );
    assert!(like(pixel(&lab, &out, 1.0, 310, 170), WHITE));

    let damaged = vec![Layer {
        source: LayerSource::Picture {
            png: "not a picture".into(),
        },
        ..layers[0].clone()
    }];
    assert!(matches!(
        fails(
            &lab,
            Tool::AddOverlay { layers: damaged },
            &black,
            "damaged.mp4"
        ),
        Error::Other(_)
    ));
    let hidden = vec![Layer {
        opacity: 0.0,
        ..layers[0].clone()
    }];
    assert!(matches!(
        fails(
            &lab,
            Tool::AddOverlay { layers: hidden },
            &black,
            "hidden.mp4"
        ),
        Error::Other(_)
    ));
}

#[test]
fn rotates_and_mirrors() {
    let Some(lab) = Lab::new() else { return };
    let source = still(&lab, "quarters", &quarters(160, 90), 1.0, true);
    let cases = [
        (Turn::Right, false, false, [BLUE, RED, WHITE, GREEN]),
        (Turn::Left, false, false, [GREEN, WHITE, RED, BLUE]),
        (Turn::Half, false, false, [WHITE, BLUE, GREEN, RED]),
        (Turn::None, true, false, [GREEN, RED, WHITE, BLUE]),
        (Turn::None, false, true, [BLUE, WHITE, RED, GREEN]),
        (Turn::Right, true, false, [RED, BLUE, GREEN, WHITE]),
    ];
    for (turn, mirror, flip, expected) in cases {
        let name = format!("{turn:?} {mirror} {flip}.mp4");
        let out = run(
            &lab,
            Tool::RotateVideo { turn, mirror, flip },
            &source,
            &name,
        );
        let probe = lab.probe(&out);
        let quarter = matches!(turn, Turn::Right | Turn::Left);
        let size = if quarter { (90, 160) } else { (160, 90) };
        assert_eq!(
            (video_of(&probe).width, video_of(&probe).height),
            size,
            "{name}"
        );
        assert_eq!(audio_of(&probe).codec, "aac");
        let found = corners(&lab, &out);
        for (corner, colour) in found.iter().zip(expected) {
            assert!(like(*corner, colour), "{name}: {found:?}");
        }
    }
    assert!(matches!(
        fails(
            &lab,
            Tool::RotateVideo {
                turn: Turn::Half,
                mirror: true,
                flip: true
            },
            &source,
            "unchanged.mp4"
        ),
        Error::Other(_)
    ));

    // A phone video keeps no rotation of its own, so players do not turn it twice.
    let phone = lab.ffmpeg(
        &[
            "-display_rotation",
            "90",
            "-i",
            source.to_str().unwrap(),
            "-c",
            "copy",
        ],
        &lab.path(&format!("{NAME} phone quarters.mp4")),
    );
    assert!(streams(&lab, &phone).contains("rotation"));
    let out = run(
        &lab,
        Tool::RotateVideo {
            turn: Turn::Left,
            mirror: false,
            flip: false,
        },
        &phone,
        "phone turned.mp4",
    );
    let probe = lab.probe(&out);
    assert_eq!((video_of(&probe).width, video_of(&probe).height), (160, 90));
    assert!(!streams(&lab, &out).contains("rotation"));
}

/// A clip whose picture brightens from black to white over `seconds`, at 64 × 48 and 25 frames
/// a second, with a tone only in its last `tone` seconds.
fn ramp(lab: &Lab, name: &str, seconds: f64, tone: f64) -> PathBuf {
    let picture = format!(
        "nullsrc=s=64x48:r=25:d={seconds},format=yuv420p,geq=lum='16+219*T/{seconds}':cb=128:cr=128"
    );
    let from = seconds - tone;
    let wave = format!("if(gt(t,{from}),0.5*sin(2*PI*440*t),0)");
    let sound = format!("aevalsrc='{wave}|{wave}':s=48000:d={seconds}");
    lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            &picture,
            "-f",
            "lavfi",
            "-i",
            &sound,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-g",
            "50",
            "-c:a",
            "aac",
        ],
        &lab.path(&format!("{NAME} {name}.mp4")),
    )
}

fn brightness(lab: &Lab, video: &Path, at: f64) -> u8 {
    pixel(lab, video, at, 32, 24)[1]
}

#[test]
fn reverses_in_pieces() {
    let Some(lab) = Lab::new() else { return };
    // 25 seconds: three pieces of picture and three of sound.
    let long = ramp(&lab, "ramp", 25.0, 10.0);
    let out = run(
        &lab,
        Tool::LoopVideo {
            mode: LoopMode::Reverse,
            count: 1,
        },
        &long,
        "reversed.mp4",
    );
    let probe = lab.probe(&out);
    near(probe.info.duration, 25.0, 0.1);
    assert_eq!(video_of(&probe).codec, "h264");
    assert_eq!(audio_of(&probe).codec, "aac");
    assert_eq!(frames(&lab, &out), frames(&lab, &long));
    assert_eq!(complaints(&lab, &out), "");
    assert!(brightness(&lab, &out, 0.1) > 200, "the end comes first");
    assert!(brightness(&lab, &out, 12.5) > 100 && brightness(&lab, &out, 12.5) < 160);
    assert!(brightness(&lab, &out, 24.9) < 40);
    assert!(
        loudness(&lab, &out, 1.0, 8.0) > -30.0,
        "the tone comes first too"
    );
    assert!(loudness(&lab, &out, 12.0, 12.0) < -70.0);

    // A WEBM keeps its codecs.
    let webm = lab.vp9(&format!("{NAME}.webm"), "160x90", true);
    let out = run(
        &lab,
        Tool::LoopVideo {
            mode: LoopMode::Reverse,
            count: 1,
        },
        &webm,
        "reversed.webm",
    );
    let probe = lab.probe(&out);
    assert_eq!(video_of(&probe).codec, "vp9");
    assert_eq!(audio_of(&probe).codec, "opus");
    near(probe.info.duration, 2.0, 0.1);
    assert_eq!(complaints(&lab, &out), "");
}

#[test]
fn reverses_sound_that_runs_past_the_picture() {
    let Some(lab) = Lab::new() else { return };
    // Two seconds of picture, three of sound (loud in its last second).
    let source = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "nullsrc=s=64x48:r=25:d=2,format=yuv420p,geq=lum='16+100*T':cb=128:cr=128",
            "-f",
            "lavfi",
            "-i",
            "aevalsrc='if(gt(t,2),0.5*sin(2*PI*440*t),0)':s=48000:d=3",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
        ],
        &lab.path(&format!("{NAME} long sound.mp4")),
    );
    let out = run(
        &lab,
        Tool::LoopVideo {
            mode: LoopMode::Reverse,
            count: 1,
        },
        &source,
        "long sound reversed.mp4",
    );
    // The sound follows the picture: what played past its end is gone.
    let probe = lab.probe(&out);
    near(probe.info.duration, 2.0, 0.1);
    assert!(loudness(&lab, &out, 0.0, 2.0) < -70.0);
    assert!(brightness(&lab, &out, 0.1) > 180);
}

#[test]
fn boomerangs_and_repeats() {
    let Some(lab) = Lab::new() else { return };
    let short = ramp(&lab, "short ramp", 2.0, 1.0);
    let out = run(
        &lab,
        Tool::LoopVideo {
            mode: LoopMode::Boomerang,
            count: 2,
        },
        &short,
        "boomerang.mp4",
    );
    let probe = lab.probe(&out);
    near(probe.info.duration, 8.0, 0.15);
    assert!(probe.info.audio.is_none(), "a boomerang has no sound");
    assert_eq!(complaints(&lab, &out), "");
    for (at, bright) in [
        (0.1, false),
        (1.9, true),
        (2.1, true),
        (3.9, false),
        (4.1, false),
        (5.9, true),
    ] {
        let value = brightness(&lab, &out, at);
        assert_eq!(value > 128, bright, "{value} at {at}");
    }

    let out = run(
        &lab,
        Tool::LoopVideo {
            mode: LoopMode::Repeat,
            count: 3,
        },
        &short,
        "repeated.mp4",
    );
    let probe = lab.probe(&out);
    near(probe.info.duration, 6.0, 0.15);
    assert_eq!(audio_of(&probe).codec, "aac");
    assert_eq!(complaints(&lab, &out), "");
    for start in [0.0, 2.0, 4.0] {
        assert!(brightness(&lab, &out, start + 0.1) < 60);
        assert!(
            loudness(&lab, &out, start + 0.1, 0.7) < -70.0,
            "silent at {start}"
        );
        assert!(
            loudness(&lab, &out, start + 1.2, 0.7) > -30.0,
            "the tone at {start}"
        );
    }
    // At most ten times.
    let out = run(
        &lab,
        Tool::LoopVideo {
            mode: LoopMode::Repeat,
            count: 99,
        },
        &short,
        "repeated ten.mp4",
    );
    near(lab.probe(&out).info.duration, 20.0, 0.3);
}

#[test]
fn cancelling_stops_between_pieces() {
    let Some(lab) = Lab::new() else { return };
    let long = ramp(&lab, "cancelled ramp", 25.0, 10.0);
    let cancel = AtomicBool::new(false);
    let report = |_: Option<f32>| cancel.store(true, Ordering::Relaxed);
    let cancelled = || cancel.load(Ordering::Relaxed);
    let progress = Progress::new(&report, &cancelled);
    let started = Instant::now();
    let (_, result) = attempt(
        &lab,
        Tool::LoopVideo {
            mode: LoopMode::Reverse,
            count: 1,
        },
        &long,
        "cancelled.mp4",
        &progress,
    );
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[test]
fn colors_with_looks_and_sliders() {
    let Some(lab) = Lab::new() else { return };
    let source = still(&lab, "colour quarters", &quarters(160, 90), 1.0, true);
    let gray = still(
        &lab,
        "gray",
        &RgbImage::from_pixel(160, 90, Rgb([128; 3])),
        1.0,
        false,
    );
    let flat = Grade {
        brightness: 0.0,
        contrast: 0.0,
        saturation: 0.0,
        warmth: 0.0,
    };
    let out = run(
        &lab,
        Tool::ColorVideo {
            look: Look::BlackWhite,
            grade: flat,
        },
        &source,
        "black white.mp4",
    );
    let probe = lab.probe(&out);
    assert_eq!(video_of(&probe).codec, "h264");
    assert_eq!(audio_of(&probe).codec, "aac");
    for [r, g, b] in corners(&lab, &out) {
        assert!(
            r.abs_diff(g) < 12 && g.abs_diff(b) < 12,
            "no colour left: {r} {g} {b}"
        );
    }

    let out = run(
        &lab,
        Tool::ColorVideo {
            look: Look::Warm,
            grade: flat,
        },
        &gray,
        "warm.mp4",
    );
    let [r, _, b] = pixel(&lab, &out, 0.5, 80, 45);
    assert!(r > b + 20, "warmer: {r} against {b}");

    let darker = Grade {
        brightness: -100.0,
        ..flat
    };
    let out = run(
        &lab,
        Tool::ColorVideo {
            look: Look::None,
            grade: darker,
        },
        &gray,
        "darker.mp4",
    );
    for value in pixel(&lab, &out, 0.5, 80, 45) {
        assert!(value.abs_diff(64) <= 6, "half as bright: {value}");
    }

    assert!(matches!(
        fails(
            &lab,
            Tool::ColorVideo {
                look: Look::None,
                grade: flat
            },
            &gray,
            "unchanged.mp4"
        ),
        Error::Other(_)
    ));
}

#[test]
fn stabilizes_a_shaky_clip() {
    let Some(lab) = Lab::new() else { return };
    // A window that wobbles over a larger test picture.
    let shaky = lab.ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=400x260:r=25:d=2,crop=320:180:'40+30*sin(t*11)':'40+30*cos(t*7)'",
            "-f",
            "lavfi",
            "-i",
            "sine=f=440:r=48000:d=2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
        ],
        &lab.path(&format!("{NAME} shaky.mp4")),
    );
    for strength in [Strength::Light, Strength::Strong] {
        let out = run(
            &lab,
            Tool::Stabilize { strength },
            &shaky,
            &format!("{strength:?}.mp4"),
        );
        let probe = lab.probe(&out);
        assert_eq!(
            (video_of(&probe).width, video_of(&probe).height),
            (320, 180)
        );
        assert_eq!(audio_of(&probe).codec, "aac");
        near(probe.info.duration, 2.0, 0.1);
    }
}

#[test]
fn erases_marks_inside_the_frame() {
    let Some(lab) = Lab::new() else { return };
    // A white mark on blue.
    let marked = RgbImage::from_fn(320, 180, |x, y| {
        Rgb(if (140..180).contains(&x) && (70..110).contains(&y) {
            WHITE
        } else {
            BLUE
        })
    });
    let source = still(&lab, "marked", &marked, 2.0, true);
    let redaction = |x, y, width, height| Redaction {
        area: Area {
            x,
            y,
            width,
            height,
        },
        span: Span {
            start: 0.0,
            end: 2.0,
        },
    };
    let out = run(
        &lab,
        Tool::RedactVideo {
            areas: vec![redaction(136.0, 66.0, 48.0, 48.0)],
            hide: Hide::Erase,
        },
        &source,
        "erased.mp4",
    );
    let probe = lab.probe(&out);
    assert_eq!(audio_of(&probe).codec, "aac");
    near(probe.info.duration, 2.0, 0.1);
    assert!(
        like(pixel(&lab, &out, 1.0, 160, 90), BLUE),
        "the mark is gone"
    );

    // Areas at the edges and over the whole frame are kept inside its border.
    let out = run(
        &lab,
        Tool::RedactVideo {
            areas: vec![
                redaction(0.0, 0.0, 60.0, 40.0),
                redaction(280.0, 150.0, 40.0, 30.0),
                redaction(-10.0, -10.0, 400.0, 400.0),
            ],
            hide: Hide::Erase,
        },
        &source,
        "erased edges.mp4",
    );
    let probe = lab.probe(&out);
    assert_eq!(
        (video_of(&probe).width, video_of(&probe).height),
        (320, 180)
    );
    near(probe.info.duration, 2.0, 0.1);
}
