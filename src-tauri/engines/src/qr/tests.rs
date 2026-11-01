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
