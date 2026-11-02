// SPDX-License-Identifier: MIT
//! Page rendering and text extraction on the bundled PDFium.
//!
//! PDFium is not thread-safe. `pdfium-render`'s `thread_safe` feature takes one process-wide
//! lock around every call, so jobs on several threads interleave call by call.

use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};

use ::image::codecs::jpeg::{JpegEncoder, PixelDensity};
use ::image::codecs::png::PngEncoder;
use ::image::{ExtendedColorType, ImageEncoder, ImageError, RgbImage, RgbaImage};
use pdfium_render::prelude::*;

use super::table;
use super::text::{self, Glyph, Rect};
use super::MAX_PAGES;
use crate::{Codec, Conversion, Error, Options, Result};

static PDFIUM: OnceLock<Pdfium> = OnceLock::new();

/// Held while the library loads and while a document opens: PDFium reports why an open failed
/// through one process-wide value, which a concurrent open could overwrite.
static OPEN: Mutex<()> = Mutex::new(());

/// Renders stay under these sizes whatever the dpi, so a poster page cannot exhaust memory
/// (64 megapixels is A3 at about 575 dpi; the bitmap is copied once more on the way out).
const MAX_SIDE: f32 = 16_384.0;
const MAX_PIXELS: f32 = 64_000_000.0;
const MAX_THUMBNAIL: u32 = 4_096;
const POINTS_PER_INCH: f32 = 72.0;

pub(super) fn init(library: &Path) -> Result<()> {
    let _open = lock();
    if PDFIUM.get().is_some() {
        return Ok(());
    }
    let file = if library.is_dir() {
        Pdfium::pdfium_platform_library_name_at_path(library)
    } else {
        library.to_path_buf()
    };
    let bindings = Pdfium::bind_to_library(&file).map_err(|error| {
        tracing::warn!(error = ?error, "PDFium could not be loaded");
        Error::MissingCodec(Codec::Pdfium)
    })?;
    // Only this function sets the cell, under the lock, so it is still empty.
    let _ = PDFIUM.set(Pdfium::new(bindings));
    tracing::info!("PDFium loaded");
    Ok(())
}

fn lock() -> MutexGuard<'static, ()> {
    OPEN.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Opens a document that is not encrypted at all. A file with only an owner password opens
/// without one, but is refused too: Kento never works around a document's permissions.
fn open(path: &Path) -> Result<PdfDocument<'static>> {
    let pdfium = PDFIUM.get().ok_or(Error::MissingCodec(Codec::Pdfium))?;
    let file = File::open(path)?;
    let _open = lock();
    let document = pdfium
        .load_pdf_from_reader(file, None)
        .map_err(|error| match error {
            PdfiumError::PdfiumLibraryInternalError(
                PdfiumInternalError::PasswordError | PdfiumInternalError::SecurityError,
            ) => Error::Encrypted,
            PdfiumError::IoError(error) => Error::Io(error),
            other => unreadable(other),
        })?;
    // PDFium reports no security handler only for a file without an /Encrypt dictionary; a
    // revision it does not name (AES-256 is 5 or 6) is an error here, so it counts as encrypted.
    let revision = document.permissions().security_handler_revision();
    if !matches!(revision, Ok(PdfSecurityHandlerRevision::Unprotected)) {
        return Err(Error::Encrypted);
    }
    Ok(document)
}

fn unreadable(error: PdfiumError) -> Error {
    Error::Unreadable(format!("PDFium: {error:?}"))
}

/// The page count of a document that work is about to go through.
fn checked_pages(document: &PdfDocument) -> Result<usize> {
    let count = usize::try_from(document.pages().len()).unwrap_or(0);
    if count == 0 {
        return Err(Error::Unreadable("the document has no pages".into()));
    }
    if count > MAX_PAGES {
        return Err(Error::Limit(format!("{count} pages; at most {MAX_PAGES}")));
    }
    Ok(count)
}

fn page<'a>(document: &PdfDocument<'a>, index: usize) -> Result<PdfPage<'a>> {
    let pages = document.pages();
    let position = PdfPageIndex::try_from(index)
        .ok()
        .filter(|&i| i < pages.len())
        .ok_or_else(|| Error::Other(format!("there is no page {}", index + 1)))?;
    pages.get(position).map_err(unreadable)
}

pub(super) fn page_count(path: &Path) -> Result<usize> {
    let document = open(path)?;
    Ok(usize::try_from(document.pages().len()).unwrap_or(0))
}

pub(super) fn render_page(path: &Path, index: usize, dpi: u16) -> Result<RgbaImage> {
    let document = open(path)?;
    let page = page(&document, index)?;
    render(&page, f32::from(dpi.max(1)) / POINTS_PER_INCH, Paper::White)
}

pub(super) fn render_thumbnail(path: &Path, index: usize, max_px: u32) -> Result<RgbaImage> {
    let document = open(path)?;
    let page = page(&document, index)?;
    let longer = page.width().value.max(page.height().value).max(1.0);
    let scale = max_px.clamp(1, MAX_THUMBNAIL) as f32 / longer;
    render(&page, scale, Paper::White)
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Paper {
    White,
    /// Transparent where the page paints nothing (white underneath, for readers that drop alpha).
    Clear,
}

fn render(page: &PdfPage, scale: f32, paper: Paper) -> Result<RgbaImage> {
    let width = page.width().value.max(1.0);
    let height = page.height().value.max(1.0);
    let scale = scale
        .min(MAX_SIDE / width)
        .min(MAX_SIDE / height)
        .min((MAX_PIXELS / (width * height)).sqrt())
        // At least one pixel across, however thin the page.
        .max(1.0 / width.min(height));
    let clear = match paper {
        Paper::White => PdfColor::WHITE,
        Paper::Clear => PdfColor::new(255, 255, 255, 0),
    };
    let config = PdfRenderConfig::new()
        .scale_page_by_factor(scale)
        .set_format(PdfBitmapFormat::BGRA)
        .set_clear_color(clear);
    let bitmap = page.render_with_config(&config).map_err(unreadable)?;
    let (w, h) = (bitmap.width().max(0) as u32, bitmap.height().max(0) as u32);
    // The library is asked to write RGBA order (reversed byte order), so no swizzle is needed.
    let bytes = bitmap.as_rgba_bytes();
    let row = w as usize * 4;
    let stride = bytes.len().checked_div(h as usize).unwrap_or(row);
    let pixels = if stride == row {
        bytes
    } else if stride > row {
        bytes
            .chunks(stride)
            .flat_map(|line| &line[..row])
            .copied()
            .collect()
    } else {
        return Err(Error::Other("PDFium returned a short bitmap".into()));
    };
    RgbaImage::from_raw(w, h, pixels)
        .ok_or_else(|| Error::Other("PDFium returned a short bitmap".into()))
}

/// pdf → jpg, png: one file per page in the destination folder.
pub(super) fn to_images(job: &Conversion) -> Result<Vec<PathBuf>> {
    let document = open(job.input)?;
    let count = checked_pages(&document)?;
    let digits = count.to_string().len();
    let stem = job.input.file_stem().unwrap_or(OsStr::new("page"));
    let scale = f32::from(job.options.page_dpi.max(1)) / POINTS_PER_INCH;
    let mut written = Vec::with_capacity(count);
    for index in 0..count {
        job.progress.check()?;
        let image = render(&page(&document, index)?, scale, Paper::Clear)?;
        let mut name = stem.to_os_string();
        name.push(format!("-{:0digits$}.{}", index + 1, job.to));
        let path = job.dest.join(name);
        if job.to == "jpg" {
            write_jpeg(&image, &path, job.options)?;
        } else {
            write_png(&image, &path)?;
        }
        written.push(path);
        job.progress.report((index + 1) as f32 / count as f32);
    }
    Ok(written)
}

fn write_png(image: &RgbaImage, path: &Path) -> Result<()> {
    let mut file = BufWriter::new(File::create(path)?);
    PngEncoder::new(&mut file)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )
        .map_err(encode_error)?;
    file.flush()?;
    Ok(())
}

fn write_jpeg(image: &RgbaImage, path: &Path, options: &Options) -> Result<()> {
    let background = options.background;
    let flat = RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let pixel = image.get_pixel(x, y);
        let alpha = u32::from(pixel[3]);
        ::image::Rgb(std::array::from_fn(|c| {
            let over = u32::from(pixel[c]) * alpha + u32::from(background[c]) * (255 - alpha);
            ((over + 127) / 255) as u8
        }))
    });
    let mut file = BufWriter::new(File::create(path)?);
    let mut encoder = JpegEncoder::new_with_quality(&mut file, options.jpeg_quality.clamp(1, 100));
    encoder.set_pixel_density(PixelDensity::dpi(options.page_dpi.max(1)));
    encoder.encode_image(&flat).map_err(encode_error)?;
    file.flush()?;
    Ok(())
}

fn encode_error(error: ImageError) -> Error {
    match error {
        ImageError::IoError(error) => Error::Io(error),
        other => Error::Other(other.to_string()),
    }
}

/// pdf → txt, md.
pub(super) fn to_text(job: &Conversion) -> Result<()> {
    let document = open(job.input)?;
    let count = checked_pages(&document)?;
    let markdown = job.to == "md";
    let mut pages = Vec::with_capacity(count);
    for index in 0..count {
        job.progress.check()?;
        let glyphs = glyphs(&page(&document, index)?, markdown)?;
        pages.push(if markdown {
            text::markdown_page(&glyphs)
        } else {
            text::plain_page(&glyphs)
        });
        job.progress.report((index + 1) as f32 / count as f32);
    }
    let out = if markdown {
        text::join_markdown(&pages)
    } else {
        text::join_plain(&pages)
    };
    fs::write(job.dest, out)?;
    Ok(())
}

/// pdf → xlsx: one sheet per page, named by its number, holding the table read off the page's
/// characters (best effort; a page without text gives an empty sheet).
pub(super) fn to_xlsx(job: &Conversion) -> Result<()> {
    let document = open(job.input)?;
    let count = checked_pages(&document)?;
    let mut sheets = Vec::with_capacity(count);
    for index in 0..count {
        job.progress.check()?;
        let glyphs = glyphs(&page(&document, index)?, true)?;
        sheets.push(((index + 1).to_string(), table::cells(&glyphs)));
        job.progress.report((index + 1) as f32 / count as f32 * 0.9);
    }
    drop(document);
    crate::sheet::xlsx_from_text(sheets, job.dest, job.progress)
}

/// The page's characters in content order, PDFium's line breaks included.
fn glyphs(page: &PdfPage, with_boxes: bool) -> Result<Vec<Glyph>> {
    let text = page.text().map_err(unreadable)?;
    let chars = text.chars();
    let glyphs = chars
        .iter()
        .map(|c| Glyph {
            code: c.unicode_value(),
            rect: with_boxes
                .then(|| c.loose_bounds().ok())
                .flatten()
                .map(|r| Rect {
                    left: r.left().value,
                    bottom: r.bottom().value,
                    right: r.right().value,
                    top: r.top().value,
                }),
        })
        .collect();
    Ok(glyphs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::fixtures::{self, Fixture};
    use crate::Progress;

    fn convert(input: &Path, to: &str, dest: &Path, options: &Options) -> Result<Vec<PathBuf>> {
        let temp = tempfile::tempdir().unwrap();
        let progress = Progress::none();
        crate::convert(&Conversion {
            input,
            from: "pdf",
            to,
            dest,
            temp: temp.path(),
            options,
            progress: &progress,
        })
    }

    #[test]
    fn pdf_pdfium_missing_library_is_a_missing_codec() {
        let dir = tempfile::tempdir().unwrap();
        // Another test may have loaded the library already, which makes `init` a no-op.
        let result = init(dir.path());
        assert!(
            matches!(result, Err(Error::MissingCodec(Codec::Pdfium))) || PDFIUM.get().is_some()
        );
    }

    #[test]
    fn pdf_pdfium_renders_pages_to_png_and_jpg() {
        if !fixtures::pdfium() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("Kento ğüşıöç 🧪.pdf");
        Fixture::pages(12).write(&input);
        assert_eq!(crate::pdf::page_count(&input).unwrap(), 12);

        let options = Options {
            page_dpi: 36,
            background: [0, 0, 255],
            ..Options::default()
        };
        let pngs = dir.path().join("png");
        fs::create_dir(&pngs).unwrap();
        let written = convert(&input, "png", &pngs, &options).unwrap();
        assert_eq!(written.len(), 12);
        assert_eq!(
            written[0].file_name().unwrap(),
            "Kento ğüşıöç 🧪-01.png",
            "page numbers padded to the page count"
        );
        assert_eq!(written[11].file_name().unwrap(), "Kento ğüşıöç 🧪-12.png");
        let png = ::image::open(&written[0]).unwrap().to_rgba8();
        // A Letter page at 36 dpi.
        assert_eq!((png.width(), png.height()), (306, 396));
        assert_eq!(
            png.get_pixel(300, 390)[3],
            0,
            "clear where nothing is painted"
        );
        // Black text, antialiased over transparency.
        assert!(
            png.pixels().any(|p| p[3] > 128 && p[0] < 80),
            "the text is drawn"
        );

        let jpgs = dir.path().join("jpg");
        fs::create_dir(&jpgs).unwrap();
        let written = convert(&input, "jpg", &jpgs, &options).unwrap();
        assert_eq!(written.len(), 12);
        let jpg = ::image::open(&written[3]).unwrap().to_rgb8();
        let corner = jpg.get_pixel(300, 390);
        assert!(
            corner[2] > 200 && corner[0] < 60,
            "flattened onto the background: {corner:?}"
        );

        let thumb = crate::pdf::render_thumbnail(&input, 0, 100).unwrap();
        assert_eq!(thumb.height(), 100);
        assert_eq!(thumb.get_pixel(1, 1)[3], 255, "thumbnails are opaque");
        assert!(matches!(
            crate::pdf::render_page(&input, 12, 72),
            Err(Error::Other(_))
        ));
    }

    #[test]
    fn pdf_pdfium_extracts_text_and_markdown() {
        if !fixtures::pdfium() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("text.pdf");
        Fixture::pages(3).write(&input);
        let options = Options::default();

        let txt = dir.path().join("out.txt");
        assert_eq!(
            convert(&input, "txt", &txt, &options).unwrap(),
            vec![txt.clone()]
        );
        let text = fs::read_to_string(&txt).unwrap();
        assert!(text.contains("Kento page 1 says hello"), "{text:?}");
        assert!(text.contains("Kento page 3 says hello"));
        assert_eq!(
            text.matches('\u{c}').count(),
            2,
            "a form feed between pages"
        );

        let md = dir.path().join("out.md");
        convert(&input, "md", &md, &options).unwrap();
        let markdown = fs::read_to_string(&md).unwrap();
        assert_eq!(markdown.matches("\n---\n").count(), 2, "{markdown:?}");
        assert!(markdown.contains("Kento page 2 says hello"));
        // The fixture's two body lines sit close together: one paragraph.
        assert!(
            markdown.contains("first line of the body second line of the body"),
            "{markdown:?}"
        );
    }

    #[test]
    fn pdf_pdfium_reads_tables_into_xlsx() {
        use calamine::{open_workbook, Data, Reader, Xlsx};
        if !fixtures::pdfium() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("Kento ğüşıöç 🧪.pdf");
        let table: &[(&str, u32, u32, u32)] = &[
            ("Fruit order", 16, 72, 740),
            ("Name", 11, 72, 700),
            ("Qty", 11, 250, 700),
            ("Price", 11, 350, 700),
            ("Pear", 11, 72, 684),
            ("1,200", 11, 250, 684),
            ("1.50", 11, 350, 684),
            ("Kiwi", 11, 72, 668),
            ("3", 11, 250, 668),
            ("(0.25)", 11, 350, 668),
        ];
        let prose: &[(&str, u32, u32, u32)] = &[("Only a line of text here", 12, 72, 700)];
        fixtures::placed(&input, &[table, prose]);
        let dest = dir.path().join("out.xlsx");
        convert(&input, "xlsx", &dest, &Options::default()).unwrap();

        let mut book: Xlsx<_> = open_workbook(&dest).unwrap();
        assert_eq!(book.sheet_names(), vec!["1", "2"]);
        let first = book.worksheet_range("1").unwrap();
        let cell = |row: u32, column: u32| first.get_value((row, column)).cloned();
        assert_eq!(cell(0, 0), Some(Data::String("Fruit order".into())));
        assert_eq!(cell(1, 1), Some(Data::String("Qty".into())));
        assert_eq!(cell(2, 0), Some(Data::String("Pear".into())));
        assert_eq!(cell(2, 1), Some(Data::Float(1200.0)));
        assert_eq!(cell(2, 2), Some(Data::Float(1.5)));
        assert_eq!(cell(3, 2), Some(Data::Float(-0.25)));
        let second = book.worksheet_range("2").unwrap();
        assert_eq!(
            second.get_value((0, 0)).cloned(),
            Some(Data::String("Only a line of text here".into()))
        );
    }

    #[test]
    fn pdf_pdfium_reports_encrypted_and_damaged_files() {
        if !fixtures::pdfium() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let locked = dir.path().join("locked.pdf");
        fixtures::encrypted(&locked, "secret");
        let owner_only = dir.path().join("owner only.pdf");
        fixtures::encrypted(&owner_only, "");
        let library = PDFIUM.get().unwrap();
        assert!(
            library.load_pdf_from_file(&owner_only, None).is_ok(),
            "the fixture opens without a password"
        );
        let options = Options::default();
        for encrypted in [&locked, &owner_only] {
            let encrypted = encrypted.as_path();
            assert!(matches!(
                crate::pdf::page_count(encrypted),
                Err(Error::Encrypted)
            ));
            assert!(matches!(
                crate::pdf::render_page(encrypted, 0, 72),
                Err(Error::Encrypted)
            ));
            assert!(matches!(
                crate::pdf::render_thumbnail(encrypted, 0, 64),
                Err(Error::Encrypted)
            ));
            let images = dir.path().join("images");
            fs::create_dir_all(&images).unwrap();
            for to in ["png", "jpg"] {
                assert!(matches!(
                    convert(encrypted, to, &images, &options),
                    Err(Error::Encrypted)
                ));
            }
            assert_eq!(fs::read_dir(&images).unwrap().count(), 0);
            for to in ["txt", "md"] {
                let dest = dir.path().join(format!("out.{to}"));
                assert!(matches!(
                    convert(encrypted, to, &dest, &options),
                    Err(Error::Encrypted)
                ));
                assert!(!dest.exists());
            }
        }

        let damaged = dir.path().join("damaged.pdf");
        fs::write(&damaged, b"%PDF-1.7\nthis is not a PDF body").unwrap();
        assert!(matches!(
            crate::pdf::page_count(&damaged),
            Err(Error::Unreadable(_))
        ));
        let txt = dir.path().join("out.txt");
        assert!(matches!(
            convert(&damaged, "txt", &txt, &Options::default()),
            Err(Error::Unreadable(_))
        ));
    }
}
