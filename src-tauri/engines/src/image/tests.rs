// SPDX-License-Identifier: MIT
//! Fixtures are made here at run time, in temporary folders.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use ::image::codecs::jpeg::JpegEncoder;
use ::image::codecs::png::PngEncoder;
use ::image::codecs::webp::WebPEncoder;
use ::image::{
    DynamicImage, ExtendedColorType, GenericImageView, ImageEncoder, ImageFormat, Rgb, RgbImage,
    Rgba, RgbaImage,
};

use super::{convert, decode, encode, heic_write_available, supports};
use crate::{Conversion, Error, Options, Progress, Result};

const WIDTH: u32 = 64;
const HEIGHT: u32 = 48;
const RED: [u8; 3] = [230, 30, 30];
const GREEN: [u8; 3] = [30, 200, 60];
const BLUE: [u8; 3] = [30, 60, 220];
const WHITE: [u8; 3] = [255, 255, 255];

/// Four flat quadrants survive every codec, lossy and palette ones included.
fn quadrant(x: u32, y: u32) -> [u8; 3] {
    match (x < WIDTH / 2, y < HEIGHT / 2) {
        (true, true) => RED,
        (false, true) => GREEN,
        (true, false) => BLUE,
        (false, false) => WHITE,
    }
}

fn fixture() -> RgbImage {
    RgbImage::from_fn(WIDTH, HEIGHT, |x, y| Rgb(quadrant(x, y)))
}

/// Left half fully transparent, right half opaque green.
fn transparent_fixture() -> RgbaImage {
    RgbaImage::from_fn(WIDTH, HEIGHT, |x, _| {
        if x < WIDTH / 2 {
            Rgba([0, 0, 0, 0])
        } else {
            Rgba([GREEN[0], GREEN[1], GREEN[2], 255])
        }
    })
}

const SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48">
  <rect x="0" y="0" width="32" height="24" fill="#e61e1e"/>
  <rect x="32" y="0" width="32" height="24" fill="#1ec83c"/>
  <rect x="0" y="24" width="32" height="24" fill="#1e3cdc"/>
  <rect x="32" y="24" width="32" height="24" fill="#ffffff"/>
  <text x="52" y="47" font-family="Arial" font-size="7" fill="#000000">K</text>
</svg>"##;

fn write_input(dir: &Path, format: &str) -> PathBuf {
    let path = dir.join(format!("input.{format}"));
    let image = fixture();
    match format {
        "svg" => fs::write(&path, SVG).unwrap(),
        "jpg" => {
            let mut data = Vec::new();
            JpegEncoder::new_with_quality(&mut data, 95)
                .write_image(image.as_raw(), WIDTH, HEIGHT, ExtendedColorType::Rgb8)
                .unwrap();
            fs::write(&path, data).unwrap();
        }
        "webp" => {
            let mut data = Vec::new();
            WebPEncoder::new_lossless(&mut data)
                .write_image(image.as_raw(), WIDTH, HEIGHT, ExtendedColorType::Rgb8)
                .unwrap();
            fs::write(&path, data).unwrap();
        }
        "avif" => fs::write(&path, avif_bytes(&image, ravif::BitDepth::Eight)).unwrap(),
        other => image
            .save_with_format(&path, ImageFormat::from_extension(other).unwrap())
            .unwrap(),
    }
    path
}

fn avif_bytes(image: &RgbImage, depth: ravif::BitDepth) -> Vec<u8> {
    let pixels: Vec<ravif::RGB8> = image
        .pixels()
        .map(|p| ravif::RGB8::new(p[0], p[1], p[2]))
        .collect();
    ravif::Encoder::new()
        .with_quality(90.0)
        .with_speed(10)
        .with_bit_depth(depth)
        .encode_rgb(ravif::Img::new(
            &pixels[..],
            image.width() as usize,
            image.height() as usize,
        ))
        .unwrap()
        .avif_file
}

fn run(input: &Path, from: &str, to: &str, dest: &Path) -> Result<PathBuf> {
    run_with(input, from, to, dest, &Progress::none())
}

fn run_with(
    input: &Path,
    from: &str,
    to: &str,
    dest: &Path,
    progress: &Progress,
) -> Result<PathBuf> {
    // The app claims the destination with an empty placeholder first.
    fs::write(dest, b"").unwrap();
    let options = Options::default();
    let temp = dest.parent().unwrap();
    let job = Conversion {
        input,
        from,
        to,
        dest,
        temp,
        options: &options,
        progress,
    };
    let written = convert(&job)?;
    assert_eq!(written, vec![dest.to_path_buf()]);
    Ok(dest.to_path_buf())
}

fn read(path: &Path, format: &str) -> DynamicImage {
    decode(path, format, &Options::default())
        .unwrap_or_else(|error| panic!("{} did not decode: {error}", path.display()))
}

fn assert_close(actual: [u8; 3], expected: [u8; 3], tolerance: u8, what: &str) {
    for channel in 0..3 {
        assert!(
            actual[channel].abs_diff(expected[channel]) <= tolerance,
            "{what}: got {actual:?}, expected about {expected:?}"
        );
    }
}

fn rgb_at(image: &DynamicImage, x: u32, y: u32) -> [u8; 3] {
    let pixel = image.get_pixel(x, y);
    [pixel[0], pixel[1], pixel[2]]
}

fn assert_quadrants(image: &DynamicImage, what: &str) {
    assert_eq!(image.dimensions(), (WIDTH, HEIGHT), "{what}: size");
    for (x, y) in [(16, 12), (48, 12), (16, 36), (40, 30)] {
        assert_close(rgb_at(image, x, y), quadrant(x, y), 40, what);
    }
}

#[test]
fn routes() {
    for from in [
        "avif", "bmp", "gif", "heic", "jpg", "png", "svg", "tiff", "webp",
    ] {
        for to in [
            "jpg", "png", "webp", "avif", "bmp", "tiff", "gif", "pdf", "ico",
        ] {
            assert_eq!(supports(from, to), from != to, "{from} → {to}");
        }
        assert!(!supports(from, from));
        assert!(!supports(from, "mp4"));
    }
    assert!(!supports("pdf", "png"));
    assert!(!supports("ico", "png"));
    assert_eq!(supports("png", "heic"), heic_write_available());
    assert!(!supports("heic", "heic"));
    assert_eq!(super::output("png", "jpg"), crate::Output::File);
}

#[test]
fn heic_write_probe_does_not_panic() {
    let first = heic_write_available();
    assert_eq!(first, heic_write_available(), "the probe is cached");
    println!("HEIC writing available: {first}");
}

#[test]
fn every_input_to_every_output() {
    let dir = tempfile::tempdir().unwrap();
    let inputs = ["png", "jpg", "bmp", "gif", "tiff", "webp", "avif", "svg"];
    let outputs = ["jpg", "png", "webp", "avif", "bmp", "tiff", "gif", "ico"];
    for from in inputs {
        let input = write_input(dir.path(), from);
        assert_quadrants(&read(&input, from), &format!("{from} fixture"));
        for to in outputs.into_iter().filter(|&to| to != from) {
            let dest = dir.path().join(format!("{from}-to.{to}"));
            run(&input, from, to, &dest).unwrap_or_else(|error| panic!("{from} → {to}: {error}"));
            let output = read(&dest, to);
            let what = format!("{from} → {to}");
            if to == "ico" {
                // The largest icon (2× the source) holds the picture, centred in a square.
                assert_eq!(output.dimensions(), (128, 128), "{what}: size");
                assert_close(rgb_at(&output, 32, 40), RED, 40, &what);
                assert_close(rgb_at(&output, 96, 88), WHITE, 40, &what);
            } else {
                assert_quadrants(&output, &what);
            }
        }
    }
}

#[test]
fn ten_bit_avif_with_alpha() {
    let dir = tempfile::tempdir().unwrap();
    let png = dir.path().join("alpha.png");
    transparent_fixture().save(&png).unwrap();
    // The writer produces 10-bit AV1, so this reads back through the high-depth path.
    let avif = run(&png, "png", "avif", &dir.path().join("alpha.avif")).unwrap();
    let image = read(&avif, "avif");
    assert!(
        matches!(image, DynamicImage::ImageRgba16(_)),
        "{:?}",
        image.color()
    );
    let image = image.to_rgba8();
    assert!(image.get_pixel(8, 8)[3] < 10, "left half stays transparent");
    let right = image.get_pixel(56, 40);
    assert!(right[3] > 245);
    assert_close([right[0], right[1], right[2]], GREEN, 24, "opaque half");

    let ten_bit = dir.path().join("ten.avif");
    fs::write(&ten_bit, avif_bytes(&fixture(), ravif::BitDepth::Ten)).unwrap();
    assert_quadrants(&read(&ten_bit, "avif"), "10-bit AVIF");
}

#[test]
fn alpha_survives_where_the_format_has_it() {
    let dir = tempfile::tempdir().unwrap();
    let png = dir.path().join("alpha.png");
    transparent_fixture().save(&png).unwrap();
    for to in ["webp", "tiff", "gif", "ico"] {
        let dest = run(&png, "png", to, &dir.path().join(format!("alpha.{to}"))).unwrap();
        let image = read(&dest, to).to_rgba8();
        let (width, height) = image.dimensions();
        assert!(
            image.get_pixel(width / 8, height / 2)[3] < 10,
            "{to}: transparent"
        );
        assert!(
            image.get_pixel(width * 7 / 8, height / 2)[3] > 245,
            "{to}: opaque"
        );
    }
}

#[test]
fn alpha_is_flattened_onto_white() {
    let dir = tempfile::tempdir().unwrap();
    let png = dir.path().join("alpha.png");
    transparent_fixture().save(&png).unwrap();
    for to in ["jpg", "bmp"] {
        let dest = run(&png, "png", to, &dir.path().join(format!("flat.{to}"))).unwrap();
        let image = read(&dest, to);
        assert!(!image.has_alpha(), "{to} has no alpha");
        assert_close(rgb_at(&image, 8, 24), WHITE, 6, to);
        assert_close(rgb_at(&image, 56, 24), GREEN, 24, to);
    }
}

/// A JPEG whose EXIF says "rotate 90° clockwise to display" (orientation 6).
fn rotated_jpeg() -> Vec<u8> {
    // Stored 40×20: red on the left, blue on the right.
    let stored = RgbImage::from_fn(40, 20, |x, _| Rgb(if x < 20 { RED } else { BLUE }));
    let mut plain = Vec::new();
    JpegEncoder::new_with_quality(&mut plain, 95)
        .write_image(stored.as_raw(), 40, 20, ExtendedColorType::Rgb8)
        .unwrap();
    let mut tiff = b"II\x2a\x00\x08\x00\x00\x00".to_vec();
    tiff.extend_from_slice(&1u16.to_le_bytes());
    tiff.extend_from_slice(&0x0112u16.to_le_bytes()); // Orientation
    tiff.extend_from_slice(&3u16.to_le_bytes()); // SHORT
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&[6, 0, 0, 0]);
    tiff.extend_from_slice(&0u32.to_le_bytes());
    let mut app1 = b"Exif\0\0".to_vec();
    app1.extend_from_slice(&tiff);
    let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE1];
    jpeg.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
    jpeg.extend_from_slice(&app1);
    jpeg.extend_from_slice(&plain[2..]);
    jpeg
}

#[test]
fn exif_orientation_is_applied() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rotated.jpg");
    fs::write(&path, rotated_jpeg()).unwrap();
    let image = read(&path, "jpg");
    assert_eq!(image.dimensions(), (20, 40));
    assert_close(rgb_at(&image, 10, 5), RED, 40, "top after turning");
    assert_close(rgb_at(&image, 10, 35), BLUE, 40, "bottom after turning");

    let decoded = super::decode::load(&path, "jpg", &Options::default()).unwrap();
    assert!(!decoded.jpeg_as_is, "a turned JPEG is re-encoded for PDF");
    let upright = write_input(dir.path(), "jpg");
    let decoded = super::decode::load(&upright, "jpg", &Options::default()).unwrap();
    assert!(decoded.jpeg_as_is, "an upright JPEG goes into PDF as it is");

    // The output is upright and carries no orientation of its own.
    let png = run(&path, "jpg", "png", &dir.path().join("rotated.png")).unwrap();
    assert_eq!(read(&png, "png").dimensions(), (20, 40));
}

fn ico_sizes(path: &Path) -> Vec<u32> {
    let data = fs::read(path).unwrap();
    assert_eq!(&data[0..4], &[0, 0, 1, 0], "ICONDIR header");
    let count = u16::from_le_bytes([data[4], data[5]]) as usize;
    (0..count)
        .map(|index| {
            let entry = &data[6 + 16 * index..];
            assert_eq!(entry[0], entry[1], "icons are square");
            if entry[0] == 0 {
                256
            } else {
                u32::from(entry[0])
            }
        })
        .collect()
}

#[test]
fn ico_holds_the_requested_sizes() {
    let dir = tempfile::tempdir().unwrap();
    let big = dir.path().join("big.png");
    RgbImage::from_pixel(300, 200, Rgb(BLUE))
        .save(&big)
        .unwrap();
    let ico = run(&big, "png", "ico", &dir.path().join("big.ico")).unwrap();
    assert_eq!(ico_sizes(&ico), vec![16, 24, 32, 48, 64, 128, 256]);

    let small = dir.path().join("small.png");
    RgbImage::from_pixel(10, 10, Rgb(RED)).save(&small).unwrap();
    let ico = run(&small, "png", "ico", &dir.path().join("small.ico")).unwrap();
    assert_eq!(ico_sizes(&ico), vec![16], "no more than 2× upscaling");

    let tiny = dir.path().join("tiny.png");
    RgbImage::from_pixel(5, 5, Rgb(RED)).save(&tiny).unwrap();
    let ico = run(&tiny, "png", "ico", &dir.path().join("tiny.ico")).unwrap();
    assert_eq!(
        ico_sizes(&ico),
        vec![5],
        "the source's own size as a last resort"
    );

    assert_eq!(
        encode::icon_sizes(&[512, 48, 16, 48], 1000, 10),
        vec![16, 48]
    );
    assert_eq!(encode::icon_sizes(&[], 40, 30), vec![40]);
    assert_eq!(encode::icon_sizes(&[], 900, 30), vec![256]);
}

#[test]
fn webp_is_lossy_only_from_photos() {
    let dir = tempfile::tempdir().unwrap();
    let first_chunk = |path: &Path| fs::read(path).unwrap()[12..16].to_vec();
    let jpg = write_input(dir.path(), "jpg");
    let from_photo = run(&jpg, "jpg", "webp", &dir.path().join("photo.webp")).unwrap();
    assert_eq!(first_chunk(&from_photo), b"VP8 ");
    let png = write_input(dir.path(), "png");
    let from_graphic = run(&png, "png", "webp", &dir.path().join("graphic.webp")).unwrap();
    assert_eq!(first_chunk(&from_graphic), b"VP8L");
}

/// A stand-in RGB display profile: only the header fields the writers look at are real.
fn fake_profile() -> Vec<u8> {
    let mut icc = vec![0u8; 256];
    icc[0..4].copy_from_slice(&256u32.to_be_bytes());
    icc[12..16].copy_from_slice(b"mntr");
    icc[16..20].copy_from_slice(b"RGB ");
    icc[20..24].copy_from_slice(b"XYZ ");
    icc[36..40].copy_from_slice(b"acsp");
    icc
}

#[test]
fn colour_profiles_are_kept() {
    let dir = tempfile::tempdir().unwrap();
    let png = dir.path().join("tagged.png");
    let mut data = Vec::new();
    let mut encoder = PngEncoder::new(Cursor::new(&mut data));
    encoder.set_icc_profile(fake_profile()).unwrap();
    encoder
        .write_image(fixture().as_raw(), WIDTH, HEIGHT, ExtendedColorType::Rgb8)
        .unwrap();
    fs::write(&png, data).unwrap();

    for to in ["jpg", "webp", "tiff"] {
        let dest = run(&png, "png", to, &dir.path().join(format!("tagged.{to}"))).unwrap();
        let decoded = super::decode::load(&dest, to, &Options::default()).unwrap();
        assert_eq!(decoded.icc.as_deref(), Some(&fake_profile()[..]), "{to}");
        assert_quadrants(&decoded.image, to);
    }
}

#[test]
fn svg_text_uses_system_fonts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.svg");
    fs::write(
        &path,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40">
             <rect width="160" height="40" fill="white"/>
             <text x="8" y="30" font-family="Arial, Helvetica, sans-serif" font-size="28">Kento</text>
           </svg>"#,
    )
    .unwrap();
    let image = read(&path, "svg").to_rgba8();
    assert_eq!(image.dimensions(), (160, 40));
    let ink = image.pixels().filter(|p| p[0] < 100).count();
    assert!(ink > 100, "the text was drawn ({ink} dark pixels)");
}

#[test]
fn svg_is_capped_and_local_only() {
    let dir = tempfile::tempdir().unwrap();
    let huge = dir.path().join("huge.svg");
    fs::write(
        &huge,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="100"><rect width="20000" height="100" fill="red"/></svg>"#,
    )
    .unwrap();
    assert_eq!(read(&huge, "svg").dimensions(), (8192, 41));

    // A linked image outside the SVG's folder is not loaded; one beside it is.
    let outside = dir.path().join("secret.png");
    RgbImage::from_pixel(4, 4, Rgb(BLUE))
        .save(&outside)
        .unwrap();
    let folder = dir.path().join("drawing");
    fs::create_dir(&folder).unwrap();
    RgbImage::from_pixel(4, 4, Rgb(GREEN))
        .save(folder.join("beside.png"))
        .unwrap();
    let svg = folder.join("links.svg");
    let absolute = outside.display().to_string().replace('\\', "/");
    fs::write(
        &svg,
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="10">
                 <image x="0" y="0" width="10" height="10" xlink:href="beside.png"/>
                 <image x="10" y="0" width="10" height="10" xlink:href="../secret.png"/>
                 <image x="10" y="0" width="10" height="10" xlink:href="{absolute}"/>
               </svg>"#
        ),
    )
    .unwrap();
    let image = read(&svg, "svg").to_rgba8();
    assert_close(
        [
            image.get_pixel(5, 5)[0],
            image.get_pixel(5, 5)[1],
            image.get_pixel(5, 5)[2],
        ],
        GREEN,
        10,
        "the image beside the SVG",
    );
    assert_eq!(image.get_pixel(15, 5)[3], 0, "nothing loaded from outside");
}

#[test]
fn limits_stop_decompression_bombs() {
    let dir = tempfile::tempdir().unwrap();
    // A BMP header claiming 60000×60000 pixels, with no pixels behind it.
    let mut bmp = b"BM".to_vec();
    bmp.extend_from_slice(&54u32.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&54u32.to_le_bytes());
    bmp.extend_from_slice(&40u32.to_le_bytes());
    bmp.extend_from_slice(&60_000i32.to_le_bytes());
    bmp.extend_from_slice(&60_000i32.to_le_bytes());
    bmp.extend_from_slice(&1u16.to_le_bytes());
    bmp.extend_from_slice(&24u16.to_le_bytes());
    bmp.extend_from_slice(&[0; 24]);
    let bomb = dir.path().join("bomb.bmp");
    fs::write(&bomb, bmp).unwrap();
    let result = run(&bomb, "bmp", "png", &dir.path().join("bomb.png"));
    assert!(matches!(result, Err(Error::Limit(_))), "{result:?}");

    let wide = dir.path().join("wide.png");
    ::image::GrayImage::new(70_000, 1).save(&wide).unwrap();
    let result = run(&wide, "png", "jpg", &dir.path().join("wide.jpg"));
    assert!(matches!(result, Err(Error::Limit(_))), "{result:?}");

    assert!(matches!(
        super::check_size(1 << 15, 1 << 14),
        Err(Error::Limit(_))
    ));
    assert!(super::check_size(1 << 14, 1 << 14).is_ok());
}

#[test]
fn damaged_files_are_unreadable() {
    let dir = tempfile::tempdir().unwrap();
    let png = write_input(dir.path(), "png");
    let mut data = fs::read(&png).unwrap();
    data.truncate(data.len() / 2);
    let broken = dir.path().join("broken.png");
    fs::write(&broken, data).unwrap();
    let result = run(&broken, "png", "jpg", &dir.path().join("broken.jpg"));
    assert!(matches!(result, Err(Error::Unreadable(_))), "{result:?}");

    let avif = dir.path().join("broken.avif");
    fs::write(&avif, b"\0\0\0\x18ftypavif\0\0\0\0avifmif1 not really").unwrap();
    let result = run(&avif, "avif", "png", &dir.path().join("broken-avif.png"));
    assert!(matches!(result, Err(Error::Unreadable(_))), "{result:?}");

    let svg = dir.path().join("broken.svg");
    fs::write(&svg, "<svg><rect").unwrap();
    let result = run(&svg, "svg", "png", &dir.path().join("broken-svg.png"));
    assert!(matches!(result, Err(Error::Unreadable(_))), "{result:?}");
}

#[test]
fn the_content_wins_over_the_extension() {
    let dir = tempfile::tempdir().unwrap();
    let png = write_input(dir.path(), "png");
    let misnamed = dir.path().join("photo.jpg");
    fs::copy(&png, &misnamed).unwrap();
    let dest = run(&misnamed, "jpg", "bmp", &dir.path().join("photo.bmp")).unwrap();
    assert_quadrants(&read(&dest, "bmp"), "PNG named .jpg");
}

#[test]
fn unicode_file_names() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("Kento ğüşıöç 🧪.png");
    fixture()
        .save_with_format(&input, ImageFormat::Png)
        .unwrap();
    let dest = dir.path().join("Kento ğüşıöç 🧪.jpg");
    run(&input, "png", "jpg", &dest).unwrap();
    assert_quadrants(&read(&dest, "jpg"), "unicode name");
}

#[test]
fn cancelled_jobs_stop() {
    let dir = tempfile::tempdir().unwrap();
    let png = write_input(dir.path(), "png");
    let progress = Progress::new(&|_| {}, &|| true);
    let result = run_with(&png, "png", "jpg", &dir.path().join("c.jpg"), &progress);
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
}

#[test]
fn progress_reaches_the_end() {
    use std::sync::Mutex;
    let dir = tempfile::tempdir().unwrap();
    let png = write_input(dir.path(), "png");
    let seen = Mutex::new(Vec::new());
    let report = |fraction: Option<f32>| seen.lock().unwrap().push(fraction.unwrap_or(-1.0));
    let progress = Progress::new(&report, &|| false);
    run_with(&png, "png", "gif", &dir.path().join("p.gif"), &progress).unwrap();
    assert_eq!(*seen.lock().unwrap(), vec![0.5, 1.0]);
}

fn iso_box(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut out = ((body.len() + 8) as u32).to_be_bytes().to_vec();
    out.extend_from_slice(kind);
    out.extend_from_slice(body);
    out
}

#[test]
fn avif_container_transforms() {
    let pitm = iso_box(b"pitm", &[0, 0, 0, 0, 0, 1]);
    let ipco = [
        iso_box(b"irot", &[1]),
        iso_box(b"imir", &[0]),
        iso_box(
            b"colr",
            &[b"nclx".as_slice(), &[0, 1, 0, 13, 0, 1, 0x80]].concat(),
        ),
    ]
    .concat();
    // Item 1 → properties 1, 2 and 3 (one-byte indices).
    let ipma = [0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 3, 1, 2, 3];
    let iprp = iso_box(
        b"iprp",
        &[iso_box(b"ipco", &ipco), iso_box(b"ipma", &ipma)].concat(),
    );
    let meta = iso_box(b"meta", &[&[0, 0, 0, 0][..], &pitm, &iprp].concat());
    let file = [iso_box(b"ftyp", b"avif\0\0\0\0avifmif1"), meta].concat();

    let found = super::avif::Properties::read(&file);
    assert_eq!(
        (found.rotation, found.mirror, found.nclx),
        (1, Some(0), Some((1, true)))
    );

    // 90° anticlockwise puts the top-left pixel bottom-left; swapping left and right then
    // moves it bottom-right.
    let mut source = RgbImage::from_pixel(4, 2, Rgb(BLUE));
    source.put_pixel(0, 0, Rgb(RED));
    let turned = found.orient(DynamicImage::ImageRgb8(source));
    assert_eq!(turned.dimensions(), (2, 4));
    assert_eq!(rgb_at(&turned, 1, 3), RED);
}

#[cfg(any(windows, target_os = "macos"))]
#[test]
fn heic_through_the_system_codec() {
    use crate::Codec;
    let dir = tempfile::tempdir().unwrap();
    // Only the brand is real: with the codec installed this is damaged, without it missing.
    let fake = dir.path().join("fake.heic");
    fs::write(&fake, b"\0\0\0\x18ftypheic\0\0\0\0mif1heic garbage garbage").unwrap();
    match decode(&fake, "heic", &Options::default()) {
        Err(Error::MissingCodec(Codec::Heif)) => {
            println!(
                "note: no HEIF decoder here (on Windows: the HEIF Image Extensions are missing)"
            );
            return;
        }
        Err(Error::Unreadable(_)) => {}
        other => panic!("a damaged HEIC: {other:?}"),
    }
    if !heic_write_available() {
        println!("note: the HEIF decoder is present but no HEIC encoder, so no round trip");
        return;
    }
    let png = dir.path().join("Kento ğüşıöç 🧪.png");
    fixture().save(&png).unwrap();
    let heic = run(
        &png,
        "png",
        "heic",
        &dir.path().join("Kento ğüşıöç 🧪.heic"),
    )
    .unwrap();
    assert_quadrants(&read(&heic, "heic"), "PNG → HEIC → pixels");
    let jpg = run(&heic, "heic", "jpg", &dir.path().join("back.jpg")).unwrap();
    assert_quadrants(&read(&jpg, "jpg"), "HEIC → JPG");

    // A phone photo stores its turn as `irot`; it must come out turned exactly once.
    let Some(turned) = with_irot(&fs::read(&heic).unwrap(), 1) else {
        println!("note: this HEIC layout is not the one the test can edit, rotation not checked");
        return;
    };
    let turned_path = dir.path().join("turned.heic");
    fs::write(&turned_path, turned).unwrap();
    let image = read(&turned_path, "heic");
    assert_eq!(image.dimensions(), (HEIGHT, WIDTH), "90° anticlockwise");
    assert_close(rgb_at(&image, 4, 4), GREEN, 40, "top-left after turning");
    assert_close(
        rgb_at(&image, 4, WIDTH - 4),
        RED,
        40,
        "bottom-left after turning",
    );
}

/// Adds an `irot` property to the primary item of a single-item HEIF. The `free` box after
/// `meta` gives up the bytes `meta` gains, so the media data stays where `iloc` says it is.
#[cfg(any(windows, target_os = "macos"))]
fn with_irot(file: &[u8], quarter_turns: u8) -> Option<Vec<u8>> {
    use super::avif::boxes;
    let top: Vec<([u8; 4], &[u8])> = boxes(file).collect();
    let meta_at = top.iter().position(|(kind, _)| kind == b"meta")?;
    let (free_kind, free_body) = top.get(meta_at + 1)?;
    let meta = top[meta_at].1;
    let mut children = Vec::new();
    for (kind, body) in boxes(&meta[4..]) {
        if &kind != b"iprp" {
            children.push(iso_box(&kind, body));
            continue;
        }
        let mut properties = Vec::new();
        for (kind, body) in boxes(body) {
            match &kind {
                b"ipco" => {
                    let index = boxes(body).count() as u8 + 1;
                    let ipco = [body, &iso_box(b"irot", &[quarter_turns])].concat();
                    properties.push((iso_box(b"ipco", &ipco), index));
                }
                b"ipma" => properties.push((iso_box(b"ipma", body), 0)),
                _ => properties.push((iso_box(&kind, body), 0)),
            }
        }
        let index = properties.iter().map(|(_, index)| *index).max()?;
        let mut iprp = Vec::new();
        for (part, _) in properties {
            if &part[4..8] == b"ipma" {
                // One item, one-byte indices: version and flags, count, id, n, indices.
                let body = &part[8..];
                if body[1..4] != [0, 0, 0] || body[4..8] != [0, 0, 0, 1] || body[0] != 0 {
                    return None;
                }
                let mut ipma = body[..10].to_vec();
                ipma.push(body[10] + 1);
                ipma.extend_from_slice(&body[11..]);
                ipma.push(index);
                iprp.extend(iso_box(b"ipma", &ipma));
            } else {
                iprp.extend(part);
            }
        }
        children.push(iso_box(b"iprp", &iprp));
    }
    let meta = iso_box(b"meta", &[&meta[..4], &children.concat()].concat());
    let grown = meta.len() - (top[meta_at].1.len() + 8);
    if free_kind != b"free" || free_body.len() < grown {
        return None;
    }
    let mut out = Vec::new();
    for (position, (kind, body)) in top.iter().enumerate() {
        match position {
            p if p == meta_at => out.extend_from_slice(&meta),
            p if p == meta_at + 1 => out.extend(iso_box(kind, &body[grown..])),
            _ => out.extend(iso_box(kind, body)),
        }
    }
    Some(out)
}
