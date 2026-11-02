// SPDX-License-Identifier: MIT
//! Fixtures are made here at run time, in temporary folders with Turkish letters and an emoji.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use ::image::codecs::png::PngEncoder;
use ::image::{
    DynamicImage, ExtendedColorType, GenericImageView, ImageBuffer, ImageEncoder, ImageFormat, Rgb,
    RgbImage, RgbaImage,
};
use resvg::usvg;

use super::*;
use crate::image::tests::{fake_profile, rotated_jpeg};

const WIDTH: u32 = 64;
const HEIGHT: u32 = 48;
const RED: [u8; 3] = [230, 30, 30];
const GREEN: [u8; 3] = [30, 200, 60];
const BLUE: [u8; 3] = [30, 60, 220];
const WHITE: [u8; 3] = [255, 255, 255];
const FOLDER: &str = "Kento ğüşıöç 🧪";

fn quadrant(x: u32, y: u32) -> [u8; 3] {
    match (x < WIDTH / 2, y < HEIGHT / 2) {
        (true, true) => RED,
        (false, true) => GREEN,
        (true, false) => BLUE,
        (false, false) => WHITE,
    }
}

fn fixture() -> DynamicImage {
    DynamicImage::ImageRgb8(RgbImage::from_fn(WIDTH, HEIGHT, |x, y| Rgb(quadrant(x, y))))
}

fn plain(width: u32, height: u32, rgb: [u8; 3]) -> DynamicImage {
    DynamicImage::ImageRgb8(RgbImage::from_pixel(width, height, Rgb(rgb)))
}

/// One-pixel black and white squares: detail that a redaction must take away.
fn checkerboard(size: u32, inverse: bool) -> DynamicImage {
    DynamicImage::ImageRgb8(RgbImage::from_fn(size, size, |x, y| {
        let white = ((x + y) % 2 == 0) != inverse;
        Rgb(if white { WHITE } else { [0, 0, 0] })
    }))
}

/// A temporary folder named with Turkish letters and an emoji.
struct Bench {
    _root: tempfile::TempDir,
    folder: PathBuf,
}

impl Bench {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join(FOLDER);
        fs::create_dir(&folder).unwrap();
        Bench {
            _root: root,
            folder,
        }
    }

    fn save(&self, name: &str, image: &DynamicImage) -> PathBuf {
        let path = self.folder.join(name);
        let format = ImageFormat::from_path(&path).unwrap();
        image.save_with_format(&path, format).unwrap();
        path
    }

    fn path(&self, name: &str) -> PathBuf {
        self.folder.join(name)
    }
}

fn run(inputs: &[(&Path, &str)], tool: &ImageTool, dest: &Path) -> Result<DynamicImage> {
    run_with(inputs, tool, dest, &Progress::none())
}

fn run_with(
    inputs: &[(&Path, &str)],
    tool: &ImageTool,
    dest: &Path,
    progress: &Progress,
) -> Result<DynamicImage> {
    // The app claims the destination with an empty placeholder first.
    fs::write(dest, b"").unwrap();
    let inputs: Vec<(PathBuf, String)> = inputs
        .iter()
        .map(|(path, from)| (path.to_path_buf(), from.to_string()))
        .collect();
    let options = Options::default();
    let written = run_tool(&ImageRun {
        inputs: &inputs,
        tool,
        dest,
        temp: dest.parent().unwrap(),
        options: &options,
        progress,
    })?;
    assert_eq!(written, vec![dest.to_path_buf()]);
    let to = dest.extension().unwrap().to_string_lossy().into_owned();
    Ok(read(dest, &to))
}

fn read(path: &Path, from: &str) -> DynamicImage {
    crate::image::decode(path, from, &Options::default())
        .unwrap_or_else(|error| panic!("{} did not decode: {error}", path.display()))
}

/// The tool on one full-size picture, as the preview draws it.
fn draw(tool: &ImageTool, image: DynamicImage) -> Result<RgbaImage> {
    preview(&[Source { image, scale: 1.0 }], tool)
}

fn rgb(image: &RgbaImage, x: u32, y: u32) -> [u8; 3] {
    let pixel = image.get_pixel(x, y);
    [pixel[0], pixel[1], pixel[2]]
}

fn assert_close(actual: [u8; 3], expected: [u8; 3], tolerance: u8, what: &str) {
    for channel in 0..3 {
        assert!(
            actual[channel].abs_diff(expected[channel]) <= tolerance,
            "{what}: got {actual:?}, expected about {expected:?}"
        );
    }
}

fn luma(pixel: [u8; 3]) -> f32 {
    0.2126 * f32::from(pixel[0]) + 0.7152 * f32::from(pixel[1]) + 0.0722 * f32::from(pixel[2])
}

fn area(x: f64, y: f64, width: f64, height: f64) -> Area {
    Area {
        x,
        y,
        width,
        height,
    }
}

fn edit(adjust: Adjust) -> ImageTool {
    ImageTool::EditImage { adjust }
}

fn frame(padding: u32, background: Background, radius: u32, shadow: bool) -> ImageTool {
    ImageTool::Frame {
        frame: FrameStyle {
            padding,
            background,
            radius,
            shadow,
        },
    }
}

fn collage(layout: Layout, spacing: u32, width: u32, fill: bool) -> ImageTool {
    ImageTool::Collage {
        collage: CollageStyle {
            layout,
            spacing,
            background: [0, 0, 0],
            width,
            fill,
        },
    }
}

fn sources(images: &[DynamicImage]) -> Vec<Source> {
    images
        .iter()
        .map(|image| Source {
            image: image.clone(),
            scale: 1.0,
        })
        .collect()
}

#[test]
fn ids_and_extensions() {
    let tool = ImageTool::CropImage {
        area: area(0.0, 0.0, 1.0, 1.0),
    };
    for (from, to) in [
        ("jpg", "jpg"),
        ("png", "png"),
        ("webp", "webp"),
        ("avif", "avif"),
        ("bmp", "bmp"),
        ("tiff", "tiff"),
        ("svg", "png"),
        ("gif", "png"),
        ("ico", "png"),
    ] {
        assert_eq!(tool.extension(from), to, "{from}");
    }
    let heic = if heic_write_available() {
        "heic"
    } else {
        "jpg"
    };
    assert_eq!(tool.extension("heic"), heic);
    assert_eq!(tool.output(), Output::File);

    let tools = [
        (edit(Adjust::default()), "edit-image"),
        (tool.clone(), "crop-image"),
        (ImageTool::Markup { marks: vec![] }, "markup"),
        (frame(0, Background::Blurred, 0, false), "frame"),
        (collage(Layout::Row, 0, 10, true), "collage"),
        (
            ImageTool::RedactImage {
                areas: vec![],
                hide: Hide::Blur,
            },
            "redact-image",
        ),
    ];
    for (tool, id) in tools {
        assert_eq!(tool.id(), id);
    }
}

#[test]
fn the_page_and_the_engine_speak_the_same_json() {
    let tool: ImageTool = serde_json::from_str(
        r#"{"tool":"edit-image","adjust":{"turn":"right","flipHorizontal":true,"flipVertical":false,
            "resize":[10,20],"brightness":5,"contrast":-5,"saturation":0}}"#,
    )
    .unwrap();
    assert_eq!(
        tool,
        edit(Adjust {
            turn: Turn::Right,
            flip_horizontal: true,
            resize: Some([10, 20]),
            brightness: 5.0,
            contrast: -5.0,
            ..Adjust::default()
        })
    );
    let tool: ImageTool = serde_json::from_str(
        r#"{"tool":"markup","marks":[{"kind":"arrow","from":[1,2],"to":[3,4],"color":[1,2,3,4],"width":2},
            {"kind":"text","at":[0,0],"text":"a","color":[0,0,0,255],"size":12}]}"#,
    )
    .unwrap();
    assert!(matches!(tool, ImageTool::Markup { ref marks } if marks.len() == 2));
    let tool: ImageTool = serde_json::from_str(
        r#"{"tool":"frame","frame":{"padding":4,"background":{"kind":"gradient","from":[0,0,0],
            "to":[1,1,1],"angle":90},"radius":2,"shadow":true}}"#,
    )
    .unwrap();
    assert_eq!(tool.id(), "frame");
    let tool: ImageTool = serde_json::from_str(
        r#"{"tool":"collage","collage":{"layout":{"kind":"grid","columns":3},"spacing":8,
            "background":[255,255,255],"width":1200,"fill":true}}"#,
    )
    .unwrap();
    assert_eq!(tool, {
        let mut expected = collage(Layout::Grid { columns: 3 }, 8, 1200, true);
        if let ImageTool::Collage { collage } = &mut expected {
            collage.background = [255, 255, 255];
        }
        expected
    });
    let tool: ImageTool = serde_json::from_str(
        r#"{"tool":"redact-image","areas":[{"x":1,"y":2,"width":3,"height":4}],"hide":{"kind":"pixelate"}}"#,
    )
    .unwrap();
    assert_eq!(tool.id(), "redact-image");
}

#[test]
fn edit_turns_flips_and_resizes() {
    let turn = |turn: Turn| {
        draw(
            &edit(Adjust {
                turn,
                ..Adjust::default()
            }),
            fixture(),
        )
        .unwrap()
    };
    // Clockwise: the bottom left corner (blue) comes to the top left, the top left (red) to the
    // top right.
    let right = turn(Turn::Right);
    assert_eq!(right.dimensions(), (HEIGHT, WIDTH));
    assert_eq!(rgb(&right, 2, 2), BLUE);
    assert_eq!(rgb(&right, HEIGHT - 3, 2), RED);
    let left = turn(Turn::Left);
    assert_eq!(left.dimensions(), (HEIGHT, WIDTH));
    assert_eq!(rgb(&left, 2, 2), GREEN);
    let half = turn(Turn::Half);
    assert_eq!(half.dimensions(), (WIDTH, HEIGHT));
    assert_eq!(rgb(&half, 2, 2), WHITE);
    assert_eq!(turn(Turn::None), fixture().into_rgba8());

    let flipped = |flip_horizontal: bool, flip_vertical: bool| {
        let tool = edit(Adjust {
            flip_horizontal,
            flip_vertical,
            ..Adjust::default()
        });
        draw(&tool, fixture()).unwrap()
    };
    assert_eq!(rgb(&flipped(true, false), 2, 2), GREEN);
    assert_eq!(rgb(&flipped(false, true), 2, 2), BLUE);
    assert_eq!(rgb(&flipped(true, true), 2, 2), WHITE);

    let resized = draw(
        &edit(Adjust {
            resize: Some([32, 24]),
            ..Adjust::default()
        }),
        fixture(),
    )
    .unwrap();
    assert_eq!(resized.dimensions(), (32, 24));
    assert_close(rgb(&resized, 6, 5), RED, 12, "resized red quadrant");
    assert_close(rgb(&resized, 26, 18), WHITE, 12, "resized white quadrant");

    // The size is given after turning.
    let turned_and_resized = draw(
        &edit(Adjust {
            turn: Turn::Left,
            resize: Some([24, 32]),
            ..Adjust::default()
        }),
        fixture(),
    )
    .unwrap();
    assert_eq!(turned_and_resized.dimensions(), (24, 32));

    let empty = draw(
        &edit(Adjust {
            resize: Some([0, 10]),
            ..Adjust::default()
        }),
        fixture(),
    );
    assert!(matches!(empty, Err(Error::Other(_))), "{empty:?}");
    let huge = draw(
        &edit(Adjust {
            resize: Some([70_000, 10]),
            ..Adjust::default()
        }),
        fixture(),
    );
    assert!(matches!(huge, Err(Error::Limit(_))), "{huge:?}");
}

#[test]
fn colour_adjustments() {
    let adjusted = |image: DynamicImage, brightness: f32, contrast: f32, saturation: f32| {
        let tool = edit(Adjust {
            brightness,
            contrast,
            saturation,
            ..Adjust::default()
        });
        rgb(&draw(&tool, image).unwrap(), 0, 0)
    };
    let grey = || plain(4, 4, [128, 128, 128]);
    assert_eq!(adjusted(grey(), 0.0, 0.0, 0.0), [128, 128, 128]);
    assert!(adjusted(grey(), 50.0, 0.0, 0.0)[0] > 150);
    assert!(adjusted(grey(), -50.0, 0.0, 0.0)[0] < 105);
    // Black and white stay where they are when the brightness changes.
    assert_eq!(adjusted(plain(4, 4, [0, 0, 0]), 100.0, 0.0, 0.0), [0, 0, 0]);
    assert_eq!(adjusted(plain(4, 4, WHITE), -100.0, 0.0, 0.0), WHITE);

    let dark = adjusted(plain(4, 4, [64, 64, 64]), 0.0, 50.0, 0.0)[0];
    let light = adjusted(plain(4, 4, [192, 192, 192]), 0.0, 50.0, 0.0)[0];
    assert!(dark < 50 && light > 205, "more contrast: {dark}, {light}");
    let dark = adjusted(plain(4, 4, [64, 64, 64]), 0.0, -100.0, 0.0)[0];
    assert!((dark as i32 - 128).abs() < 20, "flat contrast: {dark}");

    let [r, g, b] = adjusted(plain(4, 4, RED), 0.0, 0.0, -100.0);
    assert!(r == g && g == b, "no saturation is grey: {r} {g} {b}");
    let [r, g, _] = adjusted(plain(4, 4, [150, 100, 100]), 0.0, 0.0, 50.0);
    assert!(r > 150 && g < 100, "more saturation: {r} {g}");

    // 16-bit pictures keep their depth; the alpha channel is left alone.
    let deep = DynamicImage::ImageRgb16(ImageBuffer::from_pixel(2, 2, Rgb([30_000u16; 3])));
    let tool = edit(Adjust {
        brightness: 20.0,
        ..Adjust::default()
    });
    let out = apply(sources(&[deep]), &tool, &Progress::none()).unwrap();
    assert!(matches!(out, DynamicImage::ImageRgb16(_)));
    let see_through = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
        2,
        2,
        ::image::Rgba([100, 100, 100, 77]),
    ));
    assert_eq!(draw(&tool, see_through).unwrap().get_pixel(0, 0)[3], 77);

    let broken = draw(
        &edit(Adjust {
            contrast: f32::NAN,
            ..Adjust::default()
        }),
        grey(),
    );
    assert!(matches!(broken, Err(Error::Other(_))), "{broken:?}");
}

#[test]
fn crop_takes_whole_pixels_inside_the_picture() {
    let crop = |area: Area| draw(&ImageTool::CropImage { area }, fixture());
    // 30.4 → 30 and 40.6 → 41 across; 20.6 → 21 and 28.6 → 29 down.
    let cropped = crop(area(30.4, 20.6, 10.2, 8.0)).unwrap();
    assert_eq!(cropped.dimensions(), (11, 8));
    assert_eq!(rgb(&cropped, 0, 0), RED);
    assert_eq!(rgb(&cropped, 1, 0), RED);
    assert_eq!(rgb(&cropped, 2, 0), GREEN);
    assert_eq!(rgb(&cropped, 5, 5), WHITE);

    assert_eq!(
        crop(area(50.0, 40.0, 100.0, 100.0)).unwrap().dimensions(),
        (14, 8)
    );
    // Drawn from right to left.
    let backwards = crop(area(20.0, 10.0, -10.0, 5.0)).unwrap();
    assert_eq!(backwards.dimensions(), (10, 5));
    assert_eq!(rgb(&backwards, 0, 0), RED);

    for empty in [
        area(70.0, 0.0, 10.0, 10.0),
        area(10.0, 10.0, 0.0, 10.0),
        area(f64::NAN, 0.0, 10.0, 10.0),
        area(0.0, 0.0, 0.2, 10.0),
    ] {
        let result = crop(empty);
        assert!(
            matches!(result, Err(Error::Other(_))),
            "{empty:?}: {result:?}"
        );
    }
}

#[test]
fn markup_draws_over_the_picture() {
    let marks = vec![
        Mark::Pen {
            points: vec![[10.0, 40.0], [50.0, 40.0], [90.0, 40.0]],
            color: [255, 0, 0, 255],
            width: 6.0,
        },
        Mark::Highlighter {
            points: vec![[10.0, 60.0], [90.0, 60.0]],
            color: [255, 255, 0, 128],
            width: 10.0,
        },
        Mark::Rectangle {
            area: area(5.0, 5.0, 20.0, 10.0),
            color: [0, 0, 255, 255],
            width: 2.0,
            filled: true,
        },
        Mark::Ellipse {
            area: area(30.0, 2.0, 20.0, 16.0),
            color: [0, 128, 0, 255],
            width: 2.0,
            filled: false,
        },
        Mark::Arrow {
            from: [10.0, 25.0],
            to: [80.0, 25.0],
            color: [0, 0, 0, 255],
            width: 2.0,
        },
        Mark::Text {
            at: [55.0, 70.0],
            text: "Kg".into(),
            color: [0, 0, 0, 255],
            size: 20.0,
        },
    ];
    let canvas = plain(100, 100, WHITE);
    let marked = draw(&ImageTool::Markup { marks }, canvas).unwrap();
    assert_eq!(marked.dimensions(), (100, 100));
    assert_eq!(rgb(&marked, 50, 40), [255, 0, 0], "pen");
    assert_close(
        rgb(&marked, 50, 60),
        [255, 255, 127],
        2,
        "half-strong highlighter",
    );
    assert_eq!(rgb(&marked, 15, 10), [0, 0, 255], "filled rectangle");
    assert_eq!(rgb(&marked, 40, 10), WHITE, "inside the ellipse's stroke");
    assert_close(
        rgb(&marked, 30, 10),
        [0, 128, 0],
        40,
        "the ellipse's stroke",
    );
    assert_eq!(rgb(&marked, 75, 25), [0, 0, 0], "arrow head");
    // The head (12 long, 9 wide at its base at x = 68) is wider than the shaft.
    assert_close(rgb(&marked, 71, 27), [0, 0, 0], 60, "arrow head's width");
    assert_eq!(rgb(&marked, 40, 28), WHITE, "beside the shaft");
    let text_pixels = (55..100)
        .flat_map(|x| (68..100).map(move |y| (x, y)))
        .filter(|&(x, y)| luma(rgb(&marked, x, y)) < 128.0)
        .count();
    assert!(
        text_pixels > 20,
        "text drawn with the system fonts: {text_pixels} dark pixels"
    );
    // Untouched pixels stay exactly as they were.
    assert_eq!(
        *marked.get_pixel(99, 99),
        ::image::Rgba([255, 255, 255, 255])
    );
    assert_eq!(rgb(&marked, 2, 75), WHITE);

    let nothing = draw(&ImageTool::Markup { marks: vec![] }, fixture()).unwrap();
    assert_eq!(nothing, fixture().into_rgba8());
}

#[test]
fn markup_svg_is_escaped_and_self_contained() {
    let marks = [
        Mark::Text {
            at: [0.0, 0.0],
            text: "<a href=\"x\">&'\u{0}\u{1}b</a>\nline two".into(),
            color: [10, 20, 30, 255],
            size: 12.0,
        },
        Mark::Arrow {
            from: [5.0, 5.0],
            to: [5.0, 5.0],
            color: [0, 0, 0, 255],
            width: 3.0,
        },
        Mark::Pen {
            points: vec![[1.0, 1.0], [2.0, 2.0]],
            color: [0, 0, 0, 0],
            width: 3.0,
        },
    ];
    let svg = markup::svg(&marks, 100.0, 50.0).unwrap();
    assert!(svg.starts_with(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">"#
    ));
    assert!(svg.contains("&lt;a href=&quot;x&quot;&gt;&amp;&apos;b&lt;/a&gt;"));
    assert!(!svg.contains("<a "));
    assert!(!svg.contains('\u{0}') && !svg.contains('\u{1}'));
    assert!(!svg.contains("<image") && !svg.contains("url(") && !svg.contains("xlink"));
    // Line i has its baseline at at.y + size + i·1.25·size.
    assert!(
        svg.contains(r#"y="12""#) && svg.contains(r#"y="27""#),
        "{svg}"
    );
    assert!(svg.contains(r#"font-weight="600""#));
    // An arrow of no length and a see-through pen draw nothing.
    assert!(
        !svg.contains("<polygon") && !svg.contains("<polyline"),
        "{svg}"
    );
    usvg::Tree::from_str(&svg, &usvg::Options::default()).unwrap();

    let arrow = markup::svg(
        &[Mark::Arrow {
            from: [0.0, 10.0],
            to: [100.0, 10.0],
            color: [255, 0, 0, 51],
            width: 5.0,
        }],
        200.0,
        20.0,
    )
    .unwrap();
    // L = max(4·5, 12) = 20, base 15: the shaft ends at x = 80, the base runs from y 2.5 to 17.5.
    assert!(arrow.contains(r#"<g opacity="0.2">"#), "{arrow}");
    assert!(arrow.contains(r#"x2="80""#), "{arrow}");
    assert!(
        arrow.contains(r#"points="100,10 80,17.5 80,2.5""#),
        "{arrow}"
    );

    let not_a_number = markup::svg(
        &[Mark::Pen {
            points: vec![[f64::NAN, 0.0]],
            color: [0, 0, 0, 255],
            width: 1.0,
        }],
        10.0,
        10.0,
    );
    assert!(matches!(not_a_number, Err(Error::Other(_))));
}

#[test]
fn frame_pads_rounds_and_shadows() {
    let background = [10, 20, 30];
    let colour = Background::Color { rgb: background };
    let framed = draw(&frame(10, colour, 0, false), fixture()).unwrap();
    assert_eq!(framed.dimensions(), (WIDTH + 20, HEIGHT + 20));
    assert_eq!(rgb(&framed, 0, 0), background);
    assert_eq!(rgb(&framed, 9, 30), background);
    assert_eq!(rgb(&framed, 10, 10), RED);
    assert_eq!(rgb(&framed, 10 + WIDTH - 1, 10 + HEIGHT - 1), WHITE);
    assert_eq!(rgb(&framed, WIDTH + 19, HEIGHT + 19), background);
    assert!(framed.pixels().all(|pixel| pixel[3] == 255), "opaque");

    let rounded = draw(&frame(10, colour, 12, false), fixture()).unwrap();
    assert_eq!(
        rgb(&rounded, 10, 10),
        background,
        "outside the rounded corner"
    );
    assert_eq!(rgb(&rounded, 16, 16), RED, "inside the rounded corner");
    assert_eq!(rgb(&rounded, 30, 10), RED, "a straight edge");

    // The shadow falls below the picture, not above it.
    let shadowed = draw(
        &frame(20, Background::Color { rgb: WHITE }, 0, true),
        fixture(),
    )
    .unwrap();
    let below = luma(rgb(&shadowed, 20 + WIDTH / 2, 20 + HEIGHT + 3));
    let above = luma(rgb(&shadowed, 20 + WIDTH / 2, 17));
    assert!(below < 235.0, "shadow below: {below}");
    assert!(
        above > below,
        "lighter above ({above}) than below ({below})"
    );
    assert_eq!(rgb(&shadowed, 0, 0), WHITE);

    let gradient = |angle: f64| {
        let background = Background::Gradient {
            from: [0, 0, 0],
            to: WHITE,
            angle,
        };
        draw(&frame(10, background, 0, false), fixture()).unwrap()
    };
    let across = gradient(0.0);
    assert!(rgb(&across, 0, 40)[0] < 10 && rgb(&across, WIDTH + 19, 40)[0] > 245);
    assert!(rgb(&across, 3, 40)[0] < rgb(&across, 6, 40)[0]);
    let down = gradient(90.0);
    assert!(rgb(&down, 40, 0)[0] < 10 && rgb(&down, 40, HEIGHT + 19)[0] > 245);

    let blurred = draw(&frame(16, Background::Blurred, 6, true), fixture()).unwrap();
    assert_eq!(blurred.dimensions(), (WIDTH + 32, HEIGHT + 32));
    assert!(blurred.pixels().all(|pixel| pixel[3] == 255), "opaque");
    // The background is the picture's colours, softened: red to the top left, white to the
    // bottom right.
    let [r, g, _] = rgb(&blurred, 1, 1);
    assert!(r > g, "red-ish top left: {:?}", rgb(&blurred, 1, 1));

    let huge = draw(&frame(u32::MAX, colour, 0, false), fixture());
    assert!(matches!(huge, Err(Error::Limit(_))), "{huge:?}");
}

#[test]
fn collage_places_pictures_in_cells() {
    let pictures = [plain(40, 30, RED), plain(30, 30, BLUE)];
    let make = |tool: &ImageTool| {
        let out = apply(sources(&pictures), tool, &Progress::none()).unwrap();
        out.into_rgba8()
    };
    // Cells (200 − 3·10) / 2 = 85 wide and 85 × 0.875 (the median ratio) = 74.375 high.
    let grid = make(&collage(Layout::Grid { columns: 2 }, 10, 200, true));
    assert_eq!(grid.dimensions(), (200, 94));
    assert_eq!(rgb(&grid, 5, 5), [0, 0, 0], "spacing around the edge");
    assert_eq!(rgb(&grid, 10, 10), RED);
    assert_eq!(rgb(&grid, 94, 83), RED);
    assert_eq!(rgb(&grid, 95, 47), [0, 0, 0], "spacing between the cells");
    assert_eq!(rgb(&grid, 105, 10), BLUE);
    assert_eq!(rgb(&grid, 189, 83), BLUE);
    assert_eq!(rgb(&grid, 190, 47), [0, 0, 0]);
    assert_eq!(rgb(&grid, 50, 85), [0, 0, 0]);

    // Fitted whole: the red picture (85 × 64) sits in the middle of its 85 × 74 cell.
    let fitted = make(&collage(Layout::Grid { columns: 2 }, 10, 200, false));
    assert_eq!(rgb(&fitted, 50, 12), [0, 0, 0]);
    assert_eq!(rgb(&fitted, 50, 47), RED);
    assert_eq!(rgb(&fitted, 50, 80), [0, 0, 0]);

    // One row exactly 200 wide: a common height of 170 / (4/3 + 1) ≈ 72.9.
    let row = make(&collage(Layout::Row, 10, 200, true));
    assert_eq!(row.dimensions(), (200, 93));
    assert_eq!(rgb(&row, 10, 46), RED);
    assert_eq!(rgb(&row, 106, 46), RED);
    assert_eq!(rgb(&row, 108, 46), [0, 0, 0]);
    assert_eq!(rgb(&row, 118, 46), BLUE);
    assert_eq!(rgb(&row, 189, 46), BLUE);
    assert_eq!(rgb(&row, 190, 46), [0, 0, 0]);

    // One column: each picture 180 wide, 135 and 180 high.
    let column = make(&collage(Layout::Column, 10, 200, true));
    assert_eq!(column.dimensions(), (200, 345));
    assert_eq!(rgb(&column, 100, 10), RED);
    assert_eq!(rgb(&column, 100, 144), RED);
    assert_eq!(rgb(&column, 100, 150), [0, 0, 0]);
    assert_eq!(rgb(&column, 100, 155), BLUE);

    // More columns than pictures leave empty cells.
    let wide = make(&collage(Layout::Grid { columns: 4 }, 0, 400, true));
    assert_eq!(wide.dimensions(), (400, 88));
    assert_eq!(rgb(&wide, 250, 40), [0, 0, 0]);

    let one = apply(
        sources(&pictures[..1]),
        &collage(Layout::Row, 0, 100, true),
        &Progress::none(),
    );
    assert!(matches!(one, Err(Error::Other(_))), "{one:?}");
    let cramped = apply(
        sources(&pictures),
        &collage(Layout::Grid { columns: 2 }, 50, 100, true),
        &Progress::none(),
    );
    assert!(matches!(cramped, Err(Error::Other(_))), "{cramped:?}");
    let huge = apply(
        sources(&pictures),
        &collage(Layout::Column, 0, 100_000, true),
        &Progress::none(),
    );
    assert!(matches!(huge, Err(Error::Limit(_))), "{huge:?}");
}

#[test]
fn collage_rows_are_exactly_as_wide_as_asked() {
    let ratios = [0.5, 1.5, 1.0, 0.75];
    let (cells, height) = collage::layout(Layout::Row, 1000.0, 12.0, &ratios).unwrap();
    let last = cells.last().unwrap();
    assert!((last.x + last.width + 12.0 - 1000.0).abs() < 1e-9);
    assert!(cells
        .iter()
        .all(|cell| (cell.height - cells[0].height).abs() < 1e-9));
    assert!((height - cells[0].height - 24.0).abs() < 1e-9);
    for (cell, ratio) in cells.iter().zip(ratios) {
        assert!((cell.height / cell.width - ratio).abs() < 1e-9);
    }
    // An even count takes the mean of the two middle ratios.
    let (cells, _) = collage::layout(Layout::Grid { columns: 2 }, 100.0, 0.0, &ratios).unwrap();
    assert!((cells[0].height - 50.0 * 0.875).abs() < 1e-9);
    assert_eq!(cells[2].x, 0.0);
    assert!((cells[2].y - 50.0 * 0.875).abs() < 1e-9);
}

#[test]
fn redaction_cannot_be_undone() {
    let hide = |image: DynamicImage, hide: Hide| {
        let tool = ImageTool::RedactImage {
            areas: vec![area(16.0, 16.0, 48.0, 48.0)],
            hide,
        };
        draw(&tool, image).unwrap()
    };
    let original = checkerboard(96, false).into_rgba8();
    let inside = |x: u32, y: u32| (16..64).contains(&x) && (16..64).contains(&y);
    let untouched_outside = |result: &RgbaImage| {
        result
            .enumerate_pixels()
            .filter(|(x, y, _)| !inside(*x, *y))
            .all(|(x, y, pixel)| pixel == original.get_pixel(x, y))
    };

    let coloured = hide(checkerboard(96, false), Hide::Color { rgb: [200, 0, 0] });
    assert!(coloured
        .enumerate_pixels()
        .filter(|(x, y, _)| inside(*x, *y))
        .all(|(_, _, pixel)| pixel.0 == [200, 0, 0, 255]));
    assert!(untouched_outside(&coloured));

    // Blocks of max(8, 48 / 12) = 8 pixels, each its average.
    let pixelated = hide(checkerboard(96, false), Hide::Pixelate);
    assert!(untouched_outside(&pixelated));
    for (x, y, pixel) in pixelated
        .enumerate_pixels()
        .filter(|(x, y, _)| inside(*x, *y))
    {
        let block_corner = pixelated.get_pixel(16 + (x - 16) / 8 * 8, 16 + (y - 16) / 8 * 8);
        assert_eq!(pixel, block_corner, "one colour per block at {x},{y}");
        assert_close(
            [pixel[0], pixel[1], pixel[2]],
            [128, 128, 128],
            1,
            "block average",
        );
    }

    let blurred = hide(checkerboard(96, false), Hide::Blur);
    assert!(untouched_outside(&blurred));
    assert!(blurred
        .enumerate_pixels()
        .filter(|(x, y, _)| inside(*x, *y))
        .all(|(_, _, pixel)| pixel[0].abs_diff(128) <= 2));

    // Two different pictures with the same block averages come out the same inside the area:
    // what was there cannot be read back.
    let redacted = |image: DynamicImage, method: Hide| {
        let result = hide(image, method);
        ::image::imageops::crop_imm(&result, 16, 16, 48, 48).to_image()
    };
    for method in [Hide::Pixelate, Hide::Blur] {
        assert_eq!(
            redacted(checkerboard(96, false), method),
            redacted(checkerboard(96, true), method),
            "{method:?}"
        );
    }

    // Blocks grow with the area: a twelfth of its shorter side.
    let big = ImageTool::RedactImage {
        areas: vec![area(0.0, 0.0, 240.0, 240.0)],
        hide: Hide::Pixelate,
    };
    let ramp = RgbImage::from_fn(240, 240, |x, y| Rgb([x as u8, y as u8, 0]));
    let big = draw(&big, DynamicImage::ImageRgb8(ramp)).unwrap();
    assert_eq!(big.get_pixel(0, 0), big.get_pixel(19, 19));
    assert_ne!(big.get_pixel(0, 0), big.get_pixel(20, 20));

    let outside = ImageTool::RedactImage {
        areas: vec![area(500.0, 500.0, 10.0, 10.0)],
        hide: Hide::Blur,
    };
    assert!(matches!(draw(&outside, fixture()), Err(Error::Other(_))));
}

/// Every tool, as the page might send it.
fn every_tool() -> Vec<ImageTool> {
    vec![
        edit(Adjust {
            turn: Turn::Right,
            flip_horizontal: true,
            flip_vertical: false,
            resize: Some([40, 50]),
            brightness: 20.0,
            contrast: 15.0,
            saturation: -30.0,
        }),
        ImageTool::CropImage {
            area: area(5.5, 4.0, 40.0, 30.25),
        },
        ImageTool::Markup {
            marks: vec![
                Mark::Pen {
                    points: vec![[2.0, 2.0], [30.0, 20.0], [60.0, 4.0]],
                    color: [255, 0, 0, 200],
                    width: 3.0,
                },
                Mark::Text {
                    at: [4.0, 20.0],
                    text: "Çığ".into(),
                    color: [0, 0, 0, 255],
                    size: 12.0,
                },
            ],
        },
        frame(12, Background::Blurred, 8, true),
        ImageTool::RedactImage {
            areas: vec![area(10.0, 10.0, 30.0, 20.0)],
            hide: Hide::Blur,
        },
    ]
}

#[test]
fn preview_at_full_scale_matches_the_result() {
    let bench = Bench::new();
    let input = bench.save("Kento ğüşıöç 🧪.png", &fixture());
    for tool in every_tool() {
        let dest = bench.path(&format!("result {}.png", tool.id()));
        let result = run(&[(&input, "png")], &tool, &dest).unwrap().into_rgba8();
        let preview = preview(
            &[Source {
                image: read(&input, "png"),
                scale: 1.0,
            }],
            &tool,
        )
        .unwrap();
        assert_eq!(preview, result, "{}", tool.id());
    }

    let second = bench.save("ikinci 🧪.png", &plain(30, 40, BLUE));
    let tool = collage(Layout::Grid { columns: 2 }, 6, 150, false);
    let result = run(
        &[(&input, "png"), (&second, "png")],
        &tool,
        &bench.path("result collage.png"),
    )
    .unwrap()
    .into_rgba8();
    let both = [read(&input, "png"), read(&second, "png")];
    let preview = preview(&sources(&both), &tool).unwrap();
    assert_eq!(preview, result);
}

#[test]
fn previews_scale_every_length() {
    let half = |tool: &ImageTool| {
        let source = Source {
            image: fixture().resize_exact(WIDTH / 2, HEIGHT / 2, FilterType::Triangle),
            scale: 0.5,
        };
        preview(&[source], tool).unwrap()
    };
    let crop = ImageTool::CropImage {
        area: area(30.0, 20.0, 10.0, 8.0),
    };
    assert_eq!(half(&crop).dimensions(), (5, 4));
    let framed = half(&frame(10, Background::Color { rgb: WHITE }, 4, true));
    assert_eq!(framed.dimensions(), (WIDTH / 2 + 10, HEIGHT / 2 + 10));
    let resized = half(&edit(Adjust {
        resize: Some([100, 60]),
        ..Adjust::default()
    }));
    assert_eq!(resized.dimensions(), (50, 30));
    let marked = half(&ImageTool::Markup {
        marks: vec![Mark::Rectangle {
            area: area(40.0, 30.0, 20.0, 16.0),
            color: [0, 0, 0, 255],
            width: 1.0,
            filled: true,
        }],
    });
    assert_eq!(rgb(&marked, 25, 19), [0, 0, 0]);
    assert_close(rgb(&marked, 8, 6), RED, 20, "outside the mark");

    // A collage is laid out at its sources' smallest scale.
    let pictures = [
        Source {
            image: plain(20, 20, RED),
            scale: 0.5,
        },
        Source {
            image: plain(10, 10, BLUE),
            scale: 0.25,
        },
    ];
    let tool = collage(Layout::Row, 8, 400, true);
    assert_eq!(preview(&pictures, &tool).unwrap().width(), 100);

    let zero = Source {
        image: fixture(),
        scale: 0.0,
    };
    assert!(matches!(preview(&[zero], &crop), Err(Error::Other(_))));
}

#[test]
fn preview_pictures_fit_the_requested_size() {
    let bench = Bench::new();
    let input = bench.save("büyük 🧪.png", &fixture());
    let source = preview_source(&input, "png", &Options::default(), 32).unwrap();
    assert_eq!(source.image.dimensions(), (32, 24));
    assert!((source.scale - 0.5).abs() < 1e-9);
    let whole = preview_source(&input, "png", &Options::default(), 500).unwrap();
    assert_eq!(whole.image.dimensions(), (WIDTH, HEIGHT));
    assert_eq!(whole.scale, 1.0);

    let png = preview_png(&[&source], None, 64).unwrap();
    let shown = ::image::load_from_memory_with_format(&png, ImageFormat::Png).unwrap();
    assert_eq!(shown.dimensions(), (32, 24));
    // A frame grows past the sources; the PNG still fits the size asked for.
    let tool = frame(40, Background::Color { rgb: WHITE }, 0, false);
    let png = preview_png(&[&whole], Some(&tool), 64).unwrap();
    let shown = ::image::load_from_memory_with_format(&png, ImageFormat::Png).unwrap();
    assert_eq!(shown.width().max(shown.height()), 64);
    assert!(preview_png(&[], None, 64).is_err());
}

#[test]
fn size_is_upright_and_read_from_the_header() {
    let bench = Bench::new();
    let png = bench.save("boyut 🧪.png", &fixture());
    assert_eq!(
        size(&png, "png", &Options::default()).unwrap(),
        [WIDTH, HEIGHT]
    );
    let turned = bench.path("döndürülmüş 🧪.jpg");
    fs::write(&turned, rotated_jpeg()).unwrap();
    assert_eq!(size(&turned, "jpg", &Options::default()).unwrap(), [20, 40]);
    let svg = bench.path("çizim 🧪.svg");
    fs::write(
        &svg,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="30" height="12"/>"#,
    )
    .unwrap();
    assert_eq!(size(&svg, "svg", &Options::default()).unwrap(), [30, 12]);
    let broken = bench.path("bozuk 🧪.png");
    fs::write(&broken, b"not a picture at all").unwrap();
    assert!(matches!(
        size(&broken, "png", &Options::default()),
        Err(Error::Unreadable(_))
    ));
}

#[test]
fn results_are_upright_and_keep_the_profile() {
    let bench = Bench::new();
    let turned = bench.path("telefon 🧪.jpg");
    fs::write(&turned, rotated_jpeg()).unwrap();
    let dest = bench.path("telefon 🧪 - edited.jpg");
    let tool = edit(Adjust {
        brightness: 1.0,
        ..Adjust::default()
    });
    let result = run(&[(&turned, "jpg")], &tool, &dest).unwrap();
    assert_eq!(
        result.dimensions(),
        (20, 40),
        "the orientation is in the pixels"
    );
    let data = fs::read(&dest).unwrap();
    assert!(
        !data.windows(6).any(|window| window == b"Exif\0\0"),
        "no EXIF in the result"
    );

    let tagged = bench.path("profilli 🧪.png");
    let mut data = Vec::new();
    let mut encoder = PngEncoder::new(Cursor::new(&mut data));
    encoder.set_icc_profile(fake_profile()).unwrap();
    let pixels = fixture().into_rgb8();
    encoder
        .write_image(pixels.as_raw(), WIDTH, HEIGHT, ExtendedColorType::Rgb8)
        .unwrap();
    fs::write(&tagged, data).unwrap();
    let dest = bench.path("profilli 🧪 - cropped.png");
    let crop = ImageTool::CropImage {
        area: area(0.0, 0.0, 10.0, 10.0),
    };
    run(&[(&tagged, "png")], &crop, &dest).unwrap();
    let decoded = super::super::decode::load(&dest, "png", &Options::default()).unwrap();
    assert_eq!(decoded.icc.as_deref(), Some(&fake_profile()[..]));
}

#[test]
fn every_format_comes_out_in_its_own_kind() {
    let bench = Bench::new();
    let tool = ImageTool::CropImage {
        area: area(16.0, 12.0, 32.0, 24.0),
    };
    for from in ["png", "jpg", "bmp", "tiff", "webp", "gif"] {
        let input = bench.save(&format!("kaynak {from}.{from}"), &fixture());
        let to = tool.extension(from);
        let dest = bench.path(&format!("sonuç {from} - cropped.{to}"));
        let result = run(&[(&input, from)], &tool, &dest).unwrap();
        assert_eq!(result.dimensions(), (32, 24), "{from}");
        assert_close(
            [
                result.get_pixel(4, 4)[0],
                result.get_pixel(4, 4)[1],
                result.get_pixel(4, 4)[2],
            ],
            RED,
            40,
            from,
        );
    }
    let svg = bench.path("vektör 🧪.svg");
    fs::write(
        &svg,
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#1e3cdc"/></svg>"##,
    )
    .unwrap();
    let dest = bench.path("vektör 🧪 - cropped.png");
    let result = run(&[(&svg, "svg")], &tool, &dest).unwrap();
    assert_eq!(result.dimensions(), (32, 24));
}

#[test]
fn bad_inputs_and_cancelling() {
    let bench = Bench::new();
    let input = bench.save("girdi 🧪.png", &fixture());
    let tool = ImageTool::CropImage {
        area: area(0.0, 0.0, 8.0, 8.0),
    };
    let not_an_image = bench.path("metin 🧪.png");
    fs::write(&not_an_image, b"hello").unwrap();
    let result = run(&[(&not_an_image, "png")], &tool, &bench.path("a.png"));
    assert!(matches!(result, Err(Error::Unreadable(_))), "{result:?}");

    let result = run(&[], &tool, &bench.path("b.png"));
    assert!(matches!(result, Err(Error::Other(_))), "{result:?}");
    let result = run(
        &[(&input, "png"), (&input, "png")],
        &tool,
        &bench.path("c.png"),
    );
    assert!(matches!(result, Err(Error::Other(_))), "{result:?}");

    let cancelled = Progress::new(&|_| {}, &|| true);
    let result = run_with(&[(&input, "png")], &tool, &bench.path("d.png"), &cancelled);
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");

    // A small file that claims a huge canvas stops at the decoder's limits.
    let wide = bench.path("geniş 🧪.png");
    ::image::GrayImage::new(70_000, 1).save(&wide).unwrap();
    let result = run(&[(&wide, "png")], &tool, &bench.path("e.png"));
    assert!(matches!(result, Err(Error::Limit(_))), "{result:?}");

    use std::sync::Mutex;
    let seen = Mutex::new(Vec::new());
    let report = |fraction: Option<f32>| seen.lock().unwrap().push(fraction.unwrap_or(-1.0));
    let progress = Progress::new(&report, &|| false);
    run_with(&[(&input, "png")], &tool, &bench.path("f.png"), &progress).unwrap();
    let seen = seen.into_inner().unwrap();
    assert_eq!(seen.last(), Some(&1.0));
    assert!(seen.windows(2).all(|pair| pair[0] <= pair[1]), "{seen:?}");
}
