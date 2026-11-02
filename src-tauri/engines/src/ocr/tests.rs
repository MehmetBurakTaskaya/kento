// SPDX-License-Identifier: MIT
//! The pictures are drawn at run time: resvg sets the text in the system's own sans-serif font,
//! and the system's recogniser reads it back. A computer without the language a check needs
//! skips that check, with a note.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use image::{DynamicImage, Rgba, RgbaImage};
use resvg::usvg::{self, fontdb};

use super::*;
use crate::{Codec, Error, Options, Progress};

const NAME: &str = "Kento ğüşıöç 🧪";

fn fonts() -> Arc<fontdb::Database> {
    static FONTS: OnceLock<Arc<fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut fonts = fontdb::Database::new();
            fonts.load_system_fonts();
            Arc::new(fonts)
        })
        .clone()
}

/// Dark lines of text on white, 40 px high, the way a screenshot or a scan shows them.
fn page(lines: &[&str]) -> DynamicImage {
    let (width, height) = (1400, 120 + 80 * lines.len() as u32);
    let mut body = String::new();
    for (i, line) in lines.iter().enumerate() {
        body.push_str(&format!(
            r##"<text x="60" y="{}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="40" fill="#1a1a1a">{line}</text>"##,
            110 + 80 * i
        ));
    }
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><rect width="100%" height="100%" fill="#fff"/>{body}</svg>"##
    );
    let options = usvg::Options {
        fontdb: fonts(),
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_str(&svg, &options).unwrap();
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height).unwrap();
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::default(),
        &mut pixmap.as_mut(),
    );
    DynamicImage::ImageRgba8(RgbaImage::from_raw(width, height, pixmap.data().to_vec()).unwrap())
}

/// The language for a check, or None (with a note) when this computer cannot read it.
fn language(code: &str) -> Option<String> {
    let available = match languages() {
        Ok(found) => found,
        Err(error) => {
            eprintln!("skipped the text recognition checks: {error}");
            return None;
        }
    };
    let found = choose(&[code], &available);
    if found.is_none() {
        eprintln!(
            "skipped a text recognition check: no {code} recogniser here (installed: {})",
            available.join(", ")
        );
    }
    found
}

/// English when this computer reads it, else any language it reads: the words of the file checks
/// are in plain Latin letters, which every recogniser reads.
fn any_language() -> Option<String> {
    let available = languages().ok()?;
    let found = choose(&["en"], &available).or_else(|| available.first().cloned());
    if found.is_none() {
        eprintln!("skipped a text recognition check: no recogniser installed");
    }
    found
}

/// Lower case, letters and digits only, so a check does not depend on how the recogniser
/// spaces or punctuates a line.
fn words(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect()
}

fn has_all(text: &str, wanted: &[&str]) {
    let found = words(text);
    for word in wanted {
        assert!(
            found.split_whitespace().any(|w| w == *word),
            "{word:?} is missing from {text:?}"
        );
    }
}

#[test]
fn chooses_the_language_or_its_nearest_tag() {
    let have = |tags: &[&str]| tags.iter().map(|t| t.to_string()).collect::<Vec<_>>();
    let windows = have(&["en-US", "tr", "de-DE", "zh-Hans-CN"]);
    assert_eq!(choose(&["tr-TR"], &windows).as_deref(), Some("tr"));
    assert_eq!(choose(&["en"], &windows).as_deref(), Some("en-US"));
    assert_eq!(choose(&["en-GB"], &windows).as_deref(), Some("en-US"));
    assert_eq!(choose(&["de_DE"], &windows).as_deref(), Some("de-DE"));
    assert_eq!(choose(&["fr", "tr"], &windows).as_deref(), Some("tr"));
    assert_eq!(choose(&["fr"], &windows), None);
    let mac = have(&["en-US", "fr-FR", "zh-Hans", "zh-Hant", "pt-BR"]);
    assert_eq!(choose(&["zh-Hant"], &mac).as_deref(), Some("zh-Hant"));
    assert_eq!(choose(&["zh"], &mac).as_deref(), Some("zh-Hans"));
    assert_eq!(choose(&["pt-PT"], &mac).as_deref(), Some("pt-BR"));
    assert_eq!(choose(&[], &mac), None);
}

#[test]
fn reads_english_lines() {
    let Some(english) = language("en") else {
        return;
    };
    let reader = Reader::new(&english).unwrap();
    let text = reader
        .read(&page(&[
            "Kento reads this sentence",
            "Second line with numbers 2026",
        ]))
        .unwrap();
    has_all(
        &text,
        &[
            "kento", "reads", "this", "sentence", "second", "numbers", "2026",
        ],
    );
    assert!(text.lines().count() >= 2, "{text:?}");
}

#[test]
fn reads_turkish_letters() {
    let Some(turkish) = language("tr") else {
        return;
    };
    let reader = Reader::new(&turkish).unwrap();
    let text = reader
        .read(&page(&["Güzel bir gün", "Işık çiçek dağ öğrenci"]))
        .unwrap();
    has_all(&text, &["güzel", "gün", "çiçek", "dağ", "öğrenci"]);
}

#[test]
fn a_missing_language_is_explained() {
    if languages().is_err() {
        return;
    }
    // "qaa" is reserved for local use: no system has a recogniser for it.
    assert!(matches!(
        Reader::new("qaa"),
        Err(Error::MissingCodec(Codec::OcrLanguage))
    ));
}

/// The test PDFs need PDFium from `KENTO_PDFIUM` or `src-tauri/resources/pdfium`.
fn pdfium() -> bool {
    let path = env::var_os("KENTO_PDFIUM")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../resources/pdfium")
                .join(pdfium_render::prelude::Pdfium::pdfium_platform_library_name())
        });
    if !path.is_file() {
        let required = env::var("KENTO_REQUIRE_PDFIUM").is_ok_and(|v| v == "1");
        assert!(!required, "KENTO_REQUIRE_PDFIUM=1 but PDFium is missing");
        eprintln!("skipped the text recognition checks on PDF pages: no PDFium");
        return false;
    }
    crate::pdf::init(&path).expect("PDFium loads");
    true
}

#[test]
fn extracts_a_scanned_pdf_page_by_page_and_an_image() {
    let Some(english) = any_language() else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("Klasör ğ 🧪");
    fs::create_dir(&root).unwrap();
    let first = root.join(format!("{NAME} 1.png"));
    let second = root.join(format!("{NAME} 2.png"));
    page(&["First page says hello"]).save(&first).unwrap();
    page(&["Second page says goodbye"]).save(&second).unwrap();
    let options = Options::default();
    let progress = Progress::none();

    // An image on its own.
    let txt = root.join(format!(".{NAME} image.kento-part"));
    extract(&OcrJob {
        input: &first,
        format: "png",
        language: &english,
        dest: &txt,
        options: &options,
        progress: &progress,
    })
    .unwrap();
    let text = fs::read_to_string(&txt).unwrap();
    has_all(&text, &["first", "page", "says", "hello"]);
    assert!(text.ends_with('\n'));

    if !pdfium() {
        return;
    }
    let pdf = root.join(format!("{NAME}.pdf"));
    crate::pdf::from_images(
        &[(first, "png".into()), (second, "png".into())],
        &crate::pdf::PageLayout {
            size: crate::pdf::PageSize::A4,
            margin_mm: 10.0,
        },
        &pdf,
        &options,
        &progress,
    )
    .unwrap();
    let txt = root.join(format!(".{NAME} pdf.kento-part"));
    extract(&OcrJob {
        input: &pdf,
        format: "pdf",
        language: &english,
        dest: &txt,
        options: &options,
        progress: &progress,
    })
    .unwrap();
    let text = fs::read_to_string(&txt).unwrap();
    let pages: Vec<&str> = text.split('\u{c}').collect();
    assert_eq!(
        pages.len(),
        2,
        "pages are separated as PDF → TXT does: {text:?}"
    );
    has_all(pages[0], &["first", "hello"]);
    has_all(pages[1], &["second", "goodbye"]);
}

#[test]
fn a_picture_without_text_is_no_text() {
    let Some(english) = any_language() else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let blank = dir.path().join("boş.png");
    RgbaImage::from_pixel(800, 600, Rgba([255, 255, 255, 255]))
        .save(&blank)
        .unwrap();
    let result = extract(&OcrJob {
        input: &blank,
        format: "png",
        language: &english,
        dest: &dir.path().join("boş.txt"),
        options: &Options::default(),
        progress: &Progress::none(),
    });
    assert!(matches!(result, Err(Error::NoText)), "{result:?}");
    assert!(!dir.path().join("boş.txt").exists());
}
