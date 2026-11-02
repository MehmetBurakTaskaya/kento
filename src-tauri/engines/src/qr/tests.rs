// SPDX-License-Identifier: MIT
use image::{GenericImage, Rgba, RgbaImage};

use super::*;

const QUIET: u32 = 4;

/// A code drawn black on white with its quiet zone, `module` pixels per module.
fn render(text: &str, module: u32) -> GrayImage {
    let code = qrcode::QrCode::new(text.as_bytes()).unwrap();
    let width = code.width() as u32;
    let colors = code.to_colors();
    let size = (width + 2 * QUIET) * module;
    GrayImage::from_fn(size, size, |x, y| {
        let (mx, my) = (x / module, y / module);
        let inside = (QUIET..width + QUIET).contains(&mx) && (QUIET..width + QUIET).contains(&my);
        let dark =
            inside && colors[((my - QUIET) * width + (mx - QUIET)) as usize] == qrcode::Color::Dark;
        Luma([if dark { 0 } else { 255 }])
    })
}

fn side_by_side(images: &[GrayImage]) -> GrayImage {
    let gap = 40;
    let width = images.iter().map(|i| i.width() + gap).sum::<u32>() + gap;
    let height = images.iter().map(GrayImage::height).max().unwrap() + 2 * gap;
    let mut canvas = GrayImage::from_pixel(width, height, Luma([255]));
    let mut x = gap;
    for image in images {
        canvas.copy_from(image, x, gap).unwrap();
        x += image.width() + gap;
    }
    canvas
}

const TEXT: &str = "Merhaba ğüşıöç İŞĞ 🧪 https://example.test/?q=1";

#[test]
fn reads_one_code() {
    let image = DynamicImage::ImageLuma8(render(TEXT, 6));
    assert_eq!(scan(&image), [TEXT]);
}

#[test]
fn reads_several_codes_once_each() {
    let image = side_by_side(&[
        render("birinci", 5),
        render("ikinci", 5),
        render("birinci", 5),
    ]);
    let mut found = scan(&DynamicImage::ImageLuma8(image));
    found.sort();
    assert_eq!(found, ["birinci", "ikinci"]);
}

#[test]
fn reads_an_inverted_code() {
    let mut image = render("ters renk", 6);
    imageops::invert(&mut image);
    assert_eq!(scan(&DynamicImage::ImageLuma8(image)), ["ters renk"]);
}

#[test]
fn reads_a_code_on_a_transparent_background() {
    let gray = render("şeffaf", 6);
    let image = RgbaImage::from_fn(gray.width(), gray.height(), |x, y| {
        if gray.get_pixel(x, y).0[0] == 0 {
            Rgba([0, 0, 0, 255])
        } else {
            Rgba([0, 0, 0, 0])
        }
    });
    assert_eq!(scan(&DynamicImage::ImageRgba8(image)), ["şeffaf"]);
}

#[test]
fn reads_a_code_in_a_large_photo() {
    let code = render("büyük fotoğraf", 40);
    let mut canvas = GrayImage::from_pixel(3600, 2400, Luma([235]));
    canvas.copy_from(&code, 900, 300).unwrap();
    assert_eq!(scan(&DynamicImage::ImageLuma8(canvas)), ["büyük fotoğraf"]);
}

#[test]
fn nothing_to_find() {
    let blank = DynamicImage::ImageLuma8(GrayImage::from_pixel(300, 200, Luma([255])));
    assert!(scan(&blank).is_empty());
    let empty = DynamicImage::ImageLuma8(GrayImage::new(0, 0));
    assert!(scan(&empty).is_empty());
}

#[test]
fn read_skips_unreadable_files() {
    let dir = tempfile::tempdir().unwrap();
    let good = dir.path().join("Kento ğüşıöç 🧪.png");
    render(TEXT, 5).save(&good).unwrap();
    let broken = dir.path().join("bozuk.png");
    fs::write(&broken, b"not a png").unwrap();
    let pdf = dir.path().join("belge.pdf");
    fs::write(&pdf, b"%PDF-1.7").unwrap();
    let inputs = vec![
        (broken.clone(), "png".to_owned()),
        (good.clone(), "png".to_owned()),
        (pdf, "pdf".to_owned()),
    ];
    let reports = std::sync::Mutex::new(Vec::new());
    let report = |fraction: Option<f32>| reports.lock().unwrap().push(fraction.unwrap());
    let progress = Progress::new(&report, &|| false);
    let found = read(&inputs, &Options::default(), &progress).unwrap();
    assert_eq!(
        found,
        [Found {
            file: good,
            page: None,
            text: TEXT.to_owned(),
        }]
    );
    let reports = reports.into_inner().unwrap();
    assert_eq!(reports.last().copied(), Some(1.0));
    assert!(reports.windows(2).all(|pair| pair[0] <= pair[1]));

    let only_broken = vec![(broken, "png".to_owned())];
    assert!(read(&only_broken, &Options::default(), &Progress::none()).is_err());
    assert!(read(&[], &Options::default(), &Progress::none())
        .unwrap()
        .is_empty());
}

#[test]
fn read_stops_when_cancelled() {
    let dir = tempfile::tempdir().unwrap();
    let good = dir.path().join("kod.png");
    render("x", 4).save(&good).unwrap();
    let progress = Progress::new(&|_| {}, &|| true);
    let result = read(&[(good, "png".to_owned())], &Options::default(), &progress);
    assert!(matches!(result, Err(Error::Cancelled)));
}

fn sample() -> Vec<Found> {
    vec![
        Found {
            file: PathBuf::from("C:/Kento ğüşıöç 🧪.png"),
            page: None,
            text: "https://example.test".into(),
        },
        Found {
            file: PathBuf::from("C:/Kento ğüşıöç 🧪.png"),
            page: None,
            text: "WIFI:S:Ev, \"ağ\";;".into(),
        },
        Found {
            file: PathBuf::from("C:/belge.pdf"),
            page: Some(2),
            text: "satır bir\nsatır iki".into(),
        },
    ]
}

#[test]
fn txt_report() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("rapor.txt");
    write_report(&sample(), Report::Txt, &dest).unwrap();
    let newline = if cfg!(windows) { "\r\n" } else { "\n" };
    let expected = format!(
        "{}\n- https://example.test\n- WIFI:S:Ev, \"ağ\";;\n\n{}#page=2\n- satır bir\n  satır iki\n",
        Path::new("C:/Kento ğüşıöç 🧪.png").display(),
        Path::new("C:/belge.pdf").display(),
    )
    .replace('\n', newline);
    assert_eq!(fs::read_to_string(&dest).unwrap(), expected);
}

#[test]
fn csv_report() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("rapor.csv");
    write_report(&sample(), Report::Csv, &dest).unwrap();
    let text = fs::read_to_string(&dest).unwrap();
    let body = text.strip_prefix('\u{feff}').unwrap();
    let mut reader = csv::ReaderBuilder::new().from_reader(body.as_bytes());
    assert_eq!(reader.headers().unwrap(), vec!["file", "page", "text"]);
    let rows: Vec<csv::StringRecord> = reader.records().map(|row| row.unwrap()).collect();
    assert_eq!(rows.len(), 3);
    assert_eq!(
        &rows[0][0],
        Path::new("C:/Kento ğüşıöç 🧪.png").display().to_string()
    );
    assert_eq!(&rows[0][1], "");
    assert_eq!(&rows[1][2], "WIFI:S:Ev, \"ağ\";;");
    assert_eq!(&rows[2][1], "2");
    assert_eq!(&rows[2][2], "satır bir\nsatır iki");
    assert!(body.contains("\r\n"));
}

#[test]
fn json_report() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("rapor.json");
    write_report(&sample(), Report::Json, &dest).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&dest).unwrap()).unwrap();
    let items = value.as_array().unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(items[0]["page"], serde_json::Value::Null);
    assert_eq!(items[0]["text"], "https://example.test");
    assert_eq!(items[2]["page"], 2);
    assert_eq!(items[2]["text"], "satır bir\nsatır iki");
    assert_eq!(
        items[2]["file"],
        Path::new("C:/belge.pdf").display().to_string()
    );

    write_report(&[], Report::Json, &dest).unwrap();
    assert_eq!(fs::read_to_string(&dest).unwrap(), "[]\n");
}

const NAME: &str = "Kento ğüşıöç 🧪";

/// Reads back what `make` wrote: a PNG as it is, an SVG drawn by resvg at its own size.
fn read_back(dest: &Path, picture: Picture) -> Vec<String> {
    let image = match picture {
        Picture::Png => image::open(dest).unwrap(),
        Picture::Svg => {
            let svg = fs::read_to_string(dest).unwrap();
            let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default()).unwrap();
            let size = tree.size().to_int_size();
            let mut pixmap = resvg::tiny_skia::Pixmap::new(size.width(), size.height()).unwrap();
            resvg::render(
                &tree,
                resvg::tiny_skia::Transform::default(),
                &mut pixmap.as_mut(),
            );
            let rgba =
                RgbaImage::from_raw(size.width(), size.height(), pixmap.data().to_vec()).unwrap();
            DynamicImage::ImageRgba8(rgba)
        }
    };
    scan(&image)
}

#[test]
fn makes_codes_that_read_back_at_every_level() {
    let dir = tempfile::tempdir().unwrap();
    for correction in [
        Correction::Low,
        Correction::Medium,
        Correction::Quartile,
        Correction::High,
    ] {
        for picture in [Picture::Png, Picture::Svg] {
            let style = Style {
                correction,
                size: 512,
                ..Style::default()
            };
            let dest = dir
                .path()
                .join(format!("{NAME} {correction:?}.{}", picture.extension()));
            make(TEXT, &style, picture, &dest).unwrap();
            assert_eq!(
                read_back(&dest, picture),
                [TEXT],
                "{correction:?} {picture:?}"
            );
        }
    }
}

#[test]
fn makes_coloured_codes_and_checks_their_contrast() {
    let dir = tempfile::tempdir().unwrap();
    let style = Style {
        correction: Correction::Quartile,
        size: 640,
        dark: [0x1d, 0x3a, 0x8a],
        light: [0xff, 0xf4, 0xd6],
    };
    assert!(contrast(style.dark, style.light) > 7.0);
    assert!(!inverted(&style));
    for picture in [Picture::Png, Picture::Svg] {
        let dest = dir.path().join(format!("renkli.{}", picture.extension()));
        make("https://example.test/menü", &style, picture, &dest).unwrap();
        assert_eq!(read_back(&dest, picture), ["https://example.test/menü"]);
    }

    assert!((contrast([0, 0, 0], [255, 255, 255]) - 21.0).abs() < 1e-9);
    assert!((contrast([90, 90, 90], [90, 90, 90]) - 1.0).abs() < 1e-9);
    let pale = Style {
        dark: [0xbb, 0xbb, 0xbb],
        ..Style::default()
    };
    assert_eq!(check("soluk", &pale), Err(Problem::LowContrast));
    assert!(make("soluk", &pale, Picture::Png, &dir.path().join("soluk.png")).is_err());
    let swapped = Style {
        dark: [255, 255, 255],
        light: [0, 0, 0],
        ..Style::default()
    };
    assert!(inverted(&swapped) && check("ters", &swapped).is_ok());
}

#[test]
fn refuses_what_a_code_cannot_hold() {
    assert_eq!(encode("", Correction::Low), Err(Problem::Empty));
    // Version 40 holds 2953 bytes at level L and 1273 at level H.
    let long = "ğ".repeat(1400);
    assert!(encode(&long, Correction::Low).is_ok());
    assert_eq!(encode(&long, Correction::High), Err(Problem::TooLong));
    assert_eq!(
        encode(&"x".repeat(3000), Correction::Low),
        Err(Problem::TooLong)
    );
}

#[test]
fn names_a_code_after_its_site_or_its_first_words() {
    assert_eq!(
        name_for("https://www.example.test/menü?q=1"),
        "example.test"
    );
    assert_eq!(
        name_for("  Merhaba: dünya\nikinci satır"),
        "Merhaba - dünya"
    );
    assert_eq!(
        name_for("WIFI:S:Ev ağı;T:WPA;P:gizli parola 123;H:false;;"),
        "WIFI-S-Ev ağı;T-WPA;P-gizli parola"
    );
    assert_eq!(name_for("???"), "QR");
    assert_eq!(name_for("\n"), "QR");
}

#[test]
fn pixels_fill_the_chosen_size_with_whole_modules() {
    let modules = encode("https://example.test", Correction::Medium).unwrap();
    // Version 2 at level M: 25 modules and the quiet zone.
    assert_eq!(modules.side, 25 + 2 * QUIET_ZONE);
    assert!(!modules.is_dark(0, 0) && modules.is_dark(QUIET_ZONE, QUIET_ZONE));
    let style = Style {
        size: 300,
        ..Style::default()
    };
    let image = pixels(&modules, &style);
    assert_eq!(image.dimensions(), (300, 300));
    assert_eq!(image.get_pixel(0, 0).0, [255, 255, 255]);
    // Every pixel is one of the two colours: no smoothing at module edges.
    assert!(image
        .pixels()
        .all(|p| p.0 == [0, 0, 0] || p.0 == [255, 255, 255]));
    // Too small for its modules: two pixels each, at least.
    let tiny = Style {
        size: MIN_SIZE,
        ..Style::default()
    };
    let big = encode(&"k".repeat(500), Correction::Low).unwrap();
    assert_eq!(pixels(&big, &tiny).width(), big.side * 2);
    let drawing = svg(&modules, &style);
    assert!(drawing.contains("viewBox=\"0 0 33 33\"") && drawing.contains("width=\"300\""));
}
