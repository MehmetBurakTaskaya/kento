// SPDX-License-Identifier: MIT
//! The steps around the model, checked without ONNX Runtime; and a real run, where this computer
//! has the runtime and the model (`KENTO_ONNXRUNTIME`, `KENTO_BG_MODEL`). CI installs both with
//! Kento's own installer and sets `KENTO_REQUIRE_BGREMOVE=1`, so there a missing one fails.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use ::image::{
    DynamicImage, GenericImageView, GrayImage, ImageBuffer, Luma, LumaA, Rgb, RgbImage, Rgba,
    RgbaImage,
};

use super::steps::{self, Mask, SIDE};
use super::*;
use crate::{Codec, Tools};

const PLANE: usize = (SIDE * SIDE) as usize;

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 1e-4
}

#[test]
fn the_input_is_the_picture_squeezed_to_the_models_square_and_normalised() {
    // Red on the left half, blue on the right, in a wide picture: the square keeps the halves.
    let picture = RgbImage::from_fn(300, 100, |x, _| {
        if x < 150 {
            Rgb([255, 0, 0])
        } else {
            Rgb([0, 0, 255])
        }
    });
    let input = steps::input(&DynamicImage::ImageRgb8(picture));
    assert_eq!(input.len(), 3 * PLANE);
    assert_eq!(steps::input_shape(), [1, 3, 1024, 1024]);
    let at = |channel: usize, x: usize, y: usize| input[channel * PLANE + y * SIDE as usize + x];
    let normal = |value: f32, channel: usize| {
        (value - [0.485, 0.456, 0.406][channel]) / [0.229, 0.224, 0.225][channel]
    };
    // Channels first: red, green, blue planes, row by row.
    for (x, rgb) in [(10, [1.0, 0.0, 0.0]), (1010, [0.0, 0.0, 1.0])] {
        for y in [0, 500, 1023] {
            for (channel, value) in rgb.into_iter().enumerate() {
                assert!(
                    close(at(channel, x, y), normal(value, channel)),
                    "channel {channel} at {x},{y}: {}",
                    at(channel, x, y)
                );
            }
        }
    }
}

#[test]
fn the_input_drops_alpha_as_the_reference_does() {
    let clear = RgbaImage::from_pixel(8, 8, Rgba([51, 102, 153, 0]));
    let input = steps::input(&DynamicImage::ImageRgba8(clear));
    for (channel, value) in [51.0, 102.0, 153.0].into_iter().enumerate() {
        let expected =
            (value / 255.0 - [0.485, 0.456, 0.406][channel]) / [0.229, 0.224, 0.225][channel];
        assert!(close(input[channel * PLANE + 12345], expected));
    }
}

#[test]
fn the_models_answer_becomes_a_stretched_mask() {
    let values = [0.2, 0.4, 0.6, 0.8, 1.0, 0.2];
    for shape in [&[1, 1, 2, 3][..], &[1, 2, 3], &[2, 3]] {
        let mask = steps::mask(shape, &values).unwrap();
        assert_eq!((mask.width, mask.height), (3, 2), "{shape:?}");
        let expected = [0.0, 0.25, 0.5, 0.75, 1.0, 0.0];
        assert!(mask.values.iter().zip(expected).all(|(a, b)| close(*a, b)));
    }
    for (shape, values) in [
        (&[2, 1, 2, 3][..], &values[..]),
        (&[1, 1, 2, 2], &values),
        (&[1, 1, 0, 6], &values),
        (&[6], &values),
        (&[1, 1, -2, -3], &values),
        (&[1, 1, 2, 3], &values[..5]),
    ] {
        assert!(steps::mask(shape, values).is_err(), "{shape:?}");
    }
}

#[test]
fn a_flat_or_broken_map_stays_within_its_range() {
    let mut flat = vec![0.5; 4];
    steps::stretch(&mut flat);
    assert_eq!(flat, [0.5; 4]);
    let mut over = vec![1.7; 3];
    steps::stretch(&mut over);
    assert_eq!(over, [1.0; 3]);
    // A value that is not a number is background; the rest still spans 0 to 1.
    let mut broken = vec![f32::NAN, 0.1, f32::INFINITY, 0.9];
    steps::stretch(&mut broken);
    assert_eq!(broken[0], 0.0);
    assert_eq!(broken[2], 0.0);
    assert!(close(broken[1], 0.0) && close(broken[3], 1.0));
}

fn mask_of(width: u32, height: u32, values: Vec<f32>) -> Mask {
    Mask {
        width,
        height,
        values,
    }
}

#[test]
fn the_mask_is_resized_bilinearly_to_the_picture() {
    // The left column is background, the right one subject.
    let mask = mask_of(2, 2, vec![0.0, 1.0, 0.0, 1.0]);
    let same = steps::alpha(&mask, 2, 2);
    assert_eq!(same.into_raw(), [0, 255, 0, 255]);

    let wide = steps::alpha(&mask, 8, 3);
    assert_eq!(wide.dimensions(), (8, 3));
    for row in 0..3 {
        let line: Vec<u8> = (0..8).map(|x| wide.get_pixel(x, row)[0]).collect();
        assert_eq!(line[0], 0, "{line:?}");
        assert_eq!(line[7], 255, "{line:?}");
        // A smooth edge in between, never going back.
        assert!(line.windows(2).all(|pair| pair[0] <= pair[1]), "{line:?}");
        assert!(
            line.iter().any(|&value| value > 0 && value < 255),
            "{line:?}"
        );
    }
    // A preview smaller than the model's square.
    let big = mask_of(16, 16, vec![1.0; 256]);
    assert!(steps::alpha(&big, 5, 3).pixels().all(|p| p[0] == 255));
}

#[test]
fn the_cut_out_keeps_depth_and_gray_and_multiplies_alpha() {
    let alpha = GrayImage::from_raw(2, 1, vec![255, 0]).unwrap();
    let colour = steps::cut_out(
        DynamicImage::ImageRgb8(RgbImage::from_pixel(2, 1, Rgb([200, 100, 50]))),
        &alpha,
    );
    let DynamicImage::ImageRgba8(colour) = colour else {
        panic!("8-bit colour stays 8-bit colour");
    };
    assert_eq!(colour.get_pixel(0, 0), &Rgba([200, 100, 50, 255]));
    assert_eq!(colour.get_pixel(1, 0), &Rgba([200, 100, 50, 0]));

    // Transparency the picture had stays: half by the picture, half by the mask, a quarter left.
    let half = GrayImage::from_pixel(1, 1, Luma([128]));
    let DynamicImage::ImageRgba8(seen) = steps::cut_out(
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(1, 1, Rgba([9, 9, 9, 128]))),
        &half,
    ) else {
        panic!("RGBA stays RGBA");
    };
    assert_eq!(seen.get_pixel(0, 0)[3], 64);

    let gray = steps::cut_out(
        DynamicImage::ImageLuma8(ImageBuffer::from_pixel(2, 1, Luma([77]))),
        &alpha,
    );
    let DynamicImage::ImageLumaA8(gray) = gray else {
        panic!("gray stays gray");
    };
    assert_eq!(gray.get_pixel(0, 0), &LumaA([77, 255]));
    assert_eq!(gray.get_pixel(1, 0), &LumaA([77, 0]));

    let deep = steps::cut_out(
        DynamicImage::ImageRgb16(ImageBuffer::from_pixel(2, 1, Rgb([60000, 2, 3]))),
        &GrayImage::from_raw(2, 1, vec![255, 128]).unwrap(),
    );
    let DynamicImage::ImageRgba16(deep) = deep else {
        panic!("16-bit colour keeps its depth");
    };
    assert_eq!(deep.get_pixel(0, 0)[3], 65535);
    assert_eq!(deep.get_pixel(1, 0)[0], 60000);
    assert_eq!(deep.get_pixel(1, 0)[3], 32896);
}

#[test]
fn every_computer_ci_runs_on_can_remove_backgrounds() {
    // Windows always; CI's Macs are newer than the runtime's oldest macOS.
    #[cfg(target_os = "macos")]
    {
        let version = macos_version().expect("the macOS release is readable");
        eprintln!("macOS {}.{}", version.0, version.1);
        assert!(version >= (11, 0));
    }
    assert!(supported());
}

#[test]
fn without_the_runtime_or_the_model_the_extras_tools_are_asked_for() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("foto ğ 🧪.png");
    RgbImage::from_pixel(4, 4, Rgb([1, 2, 3]))
        .save(&input)
        .unwrap();
    let dest = dir.path().join("out.png");
    let model = dir.path().join(MODEL_FILE);
    for tools in [
        Tools::default(),
        Tools {
            onnxruntime: Some(dir.path().join("onnxruntime.dll")),
            ..Tools::default()
        },
        Tools {
            bg_model: Some(model.clone()),
            ..Tools::default()
        },
    ] {
        let options = Options {
            tools,
            ..Options::default()
        };
        let result = run(&CutoutRun {
            input: &input,
            from: "png",
            dest: &dest,
            options: &options,
            progress: &Progress::none(),
        });
        assert!(
            matches!(result, Err(Error::MissingCodec(Codec::BackgroundRemoval))),
            "{result:?}"
        );
        assert!(matches!(
            preview_png(&input, "png", &options, 256),
            Err(Error::MissingCodec(Codec::BackgroundRemoval))
        ));
    }
    // Another model is refused before anything is loaded.
    let options = Options {
        tools: Tools {
            onnxruntime: Some(dir.path().join("onnxruntime.dll")),
            bg_model: Some(dir.path().join("other.onnx")),
            ..Tools::default()
        },
        ..Options::default()
    };
    let result = preview_png(&input, "png", &options, 256);
    assert!(
        matches!(&result, Err(Error::Other(text)) if text.contains(MODEL_FILE)),
        "{result:?}"
    );
    assert!(!dest.exists());
}

/// The runtime and the model from `KENTO_ONNXRUNTIME` and `KENTO_BG_MODEL`.
fn installed() -> Option<Tools> {
    let path = |name: &str| {
        std::env::var_os(name)
            .map(PathBuf::from)
            .filter(|path| path.is_file())
    };
    let tools = Tools {
        onnxruntime: path("KENTO_ONNXRUNTIME"),
        bg_model: path("KENTO_BG_MODEL"),
        ..Tools::default()
    };
    if tools.onnxruntime.is_some() && tools.bg_model.is_some() {
        return Some(tools);
    }
    assert!(
        std::env::var_os("KENTO_REQUIRE_BGREMOVE").is_none_or(|v| v != "1"),
        "KENTO_REQUIRE_BGREMOVE is set, but KENTO_ONNXRUNTIME and KENTO_BG_MODEL do not both name files"
    );
    eprintln!("no ONNX Runtime and background-removal model given; skipped");
    None
}

/// A plain subject on a plain background: a red disk in the middle of a light gray picture.
fn disk(width: u32, height: u32) -> RgbImage {
    let (cx, cy) = (width as f32 / 2.0, height as f32 / 2.0);
    let radius = width.min(height) as f32 * 0.3;
    RgbImage::from_fn(width, height, |x, y| {
        let (dx, dy) = (x as f32 - cx, y as f32 - cy);
        if dx * dx + dy * dy <= radius * radius {
            Rgb([200, 30, 40])
        } else {
            Rgb([235, 235, 232])
        }
    })
}

#[test]
fn removes_the_background_with_the_real_model() {
    let Some(tools) = installed() else {
        return;
    };
    let options = Options {
        tools,
        ..Options::default()
    };
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("Kırmızı daire ğüşıöç 🧪.png");
    disk(640, 480).save(&input).unwrap();
    let dest = dir.path().join("Kırmızı daire - arka plansız.png");

    // The preview runs the model; the result reuses its mask.
    let started = Instant::now();
    let preview = preview_png(&input, "png", &options, 200).unwrap();
    eprintln!("preview in {} ms", started.elapsed().as_millis());
    let preview = ::image::load_from_memory(&preview).unwrap();
    assert_eq!(preview.dimensions(), (200, 150));

    let reports = std::sync::Mutex::new(Vec::new());
    let report = |fraction: Option<f32>| reports.lock().unwrap().push(fraction);
    let progress = Progress::new(&report, &|| false);
    let started = Instant::now();
    let written = run(&CutoutRun {
        input: &input,
        from: "png",
        dest: &dest,
        options: &options,
        progress: &progress,
    })
    .unwrap();
    eprintln!("result in {} ms", started.elapsed().as_millis());
    assert_eq!(written, std::slice::from_ref(&dest));
    assert_eq!(reports.lock().unwrap().last(), Some(&Some(1.0)));

    let result = ::image::open(&dest).unwrap();
    assert_eq!(result.dimensions(), (640, 480));
    let result = result.into_rgba8();
    let centre = result.get_pixel(320, 240);
    assert!(centre[3] > 200, "the subject stays: {centre:?}");
    assert_eq!(&centre.0[..3], &[200, 30, 40]);
    for (x, y) in [(5, 5), (634, 5), (5, 474), (634, 474)] {
        let corner = result.get_pixel(x, y);
        assert!(corner[3] < 60, "the background goes: {corner:?} at {x},{y}");
    }
    let preview = preview.into_rgba8();
    assert!(preview.get_pixel(100, 75)[3] > 200);
    assert!(preview.get_pixel(2, 2)[3] < 60);

    // A cancelled job stops the model while it runs and writes nothing.
    let other = dir.path().join("başka.png");
    disk(500, 500).save(&other).unwrap();
    let cancelled_dest = dir.path().join("başka - arka plansız.png");
    let since = Instant::now();
    let flag = AtomicBool::new(false);
    let cancelled = || {
        if since.elapsed() > Duration::from_millis(300) {
            flag.store(true, Ordering::Relaxed);
        }
        flag.load(Ordering::Relaxed)
    };
    let progress = Progress::new(&|_| {}, &cancelled);
    let result = run(&CutoutRun {
        input: &other,
        from: "png",
        dest: &cancelled_dest,
        options: &options,
        progress: &progress,
    });
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(!cancelled_dest.exists());
    eprintln!("cancelled after {} ms", since.elapsed().as_millis());
}
