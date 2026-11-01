// SPDX-License-Identifier: MIT
//! PDFs made of pictures, one page each, written with `lopdf`.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use ::image::{DynamicImage, GenericImageView, ImageFormat};
use flate2::write::ZlibEncoder;
use flate2::Compression;
use lopdf::xref::XrefType;
use lopdf::{dictionary, Document, Object, ObjectId, Stream};

use super::{jpeg, PageImage, PageLayout, PageSize, MAX_PAGES};
use crate::{Error, Options, Progress, Result};

const POINTS_PER_INCH: f32 = 72.0;
const MM_PER_INCH: f32 = 25.4;
const DEFAULT_DPI: f32 = 96.0;
/// The largest page side that common readers accept (ISO 32000-1, annex C.2).
const MAX_PAGE_SIDE: f32 = 14_400.0;
/// Paper sizes in points, portrait.
const A4: (f32, f32) = (595.276, 841.89);
const LETTER: (f32, f32) = (612.0, 792.0);

pub(super) fn images_to_pdf(
    images: Vec<PageImage>,
    layout: &PageLayout,
    dest: &Path,
    progress: &Progress,
) -> Result<()> {
    check_count(images.len())?;
    let total = images.len();
    let mut book = Book::new();
    for (done, image) in images.into_iter().enumerate() {
        progress.check()?;
        book.add(image, layout)?;
        progress.report((done + 1) as f32 / total as f32);
    }
    book.save(dest)
}

/// The "PDF from images" tool: one page per image file, in this order. `inputs` pairs each file
/// with its catalog format id. JPEG files are embedded without re-encoding unless their Exif
/// orientation turns them; every other file goes through the image engine's decoder.
pub fn from_images(
    inputs: &[(PathBuf, String)],
    layout: &PageLayout,
    dest: &Path,
    options: &Options,
    progress: &Progress,
) -> Result<()> {
    check_count(inputs.len())?;
    let mut book = Book::new();
    for (done, (path, format)) in inputs.iter().enumerate() {
        progress.check()?;
        book.add(load(path, format, options)?, layout)?;
        progress.report((done + 1) as f32 / inputs.len() as f32);
    }
    book.save(dest)
}

fn check_count(count: usize) -> Result<()> {
    if count == 0 {
        return Err(Error::Other("there are no images for the PDF".into()));
    }
    if count > MAX_PAGES {
        return Err(Error::Limit(format!("{count} pages; at most {MAX_PAGES}")));
    }
    Ok(())
}

fn load(path: &Path, format: &str, options: &Options) -> Result<PageImage> {
    if matches!(format, "jpg" | "jpeg") {
        let bytes = std::fs::read(path)?;
        // PDF readers ignore Exif, so a turned photo is decoded upright instead.
        if jpeg::read(&bytes).is_some_and(|info| info.orientation == 1) {
            return Ok(PageImage::Jpeg(bytes));
        }
    }
    crate::image::decode(path, format, options).map(PageImage::Pixels)
}

/// A new document that every reader opens: PDF 1.7 with a classic cross-reference table.
pub(super) fn new_document() -> Document {
    let mut doc = Document::new();
    doc.version = "1.7".into();
    doc.reference_table.cross_reference_type = XrefType::CrossReferenceTable;
    doc
}

pub(super) fn save(doc: &mut Document, dest: &Path) -> Result<()> {
    let mut file = BufWriter::new(File::create(dest)?);
    doc.save_to(&mut file)?;
    file.flush()?;
    Ok(())
}

/// A PDF under construction, one page per picture.
struct Book {
    doc: Document,
    pages_id: ObjectId,
    kids: Vec<Object>,
}

impl Book {
    fn new() -> Self {
        let mut doc = new_document();
        let pages_id = doc.new_object_id();
        Self {
            doc,
            pages_id,
            kids: Vec::new(),
        }
    }

    fn add(&mut self, image: PageImage, layout: &PageLayout) -> Result<()> {
        let (xobject, width, height, dpi) = match image {
            PageImage::Jpeg(bytes) => match jpeg::read(&bytes) {
                Some(info) => {
                    let size = (u32::from(info.width), u32::from(info.height));
                    (jpeg_xobject(bytes, &info), size.0, size.1, info.dpi)
                }
                // A JPEG that DCTDecode cannot show as it is (12-bit, odd header): re-encode.
                None => {
                    let image = ::image::load_from_memory_with_format(&bytes, ImageFormat::Jpeg)
                        .map_err(|error| Error::Unreadable(error.to_string()))?;
                    let (width, height) = image.dimensions();
                    (self.pixels_xobject(&image)?, width, height, None)
                }
            },
            PageImage::Pixels(image) => {
                let (width, height) = image.dimensions();
                (self.pixels_xobject(&image)?, width, height, None)
            }
        };
        let image_id = self.doc.add_object(xobject);
        let place = place(
            layout,
            width,
            height,
            dpi.unwrap_or((DEFAULT_DPI, DEFAULT_DPI)),
        );
        let [x, y, w, h] = place.image;
        let content = format!("q {w:.4} 0 0 {h:.4} {x:.4} {y:.4} cm /Im0 Do Q");
        let content_id = self
            .doc
            .add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let page_id = self.doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => self.pages_id,
            "MediaBox" => vec![0.into(), 0.into(), place.page.0.into(), place.page.1.into()],
            "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => image_id } },
            "Contents" => content_id,
        });
        self.kids.push(page_id.into());
        Ok(())
    }

    /// Flate-compressed samples, with the alpha channel as a soft mask when it is not opaque.
    fn pixels_xobject(&mut self, image: &DynamicImage) -> Result<Stream> {
        let (width, height) = image.dimensions();
        if width == 0 || height == 0 {
            return Err(Error::Unreadable("the image is empty".into()));
        }
        let color = image.color();
        let mut stream = if color.has_color() {
            flate_image(width, height, "DeviceRGB", &image.to_rgb8(), 3)?
        } else {
            flate_image(width, height, "DeviceGray", &image.to_luma8(), 1)?
        };
        if color.has_alpha() {
            let alpha: Vec<u8> = image.to_rgba8().pixels().map(|p| p[3]).collect();
            if alpha.iter().any(|&a| a != u8::MAX) {
                let mask = flate_image(width, height, "DeviceGray", &alpha, 1)?;
                stream.dict.set("SMask", self.doc.add_object(mask));
            }
        }
        Ok(stream)
    }

    fn save(mut self, dest: &Path) -> Result<()> {
        let count = self.kids.len() as i64;
        let pages = dictionary! { "Type" => "Pages", "Kids" => self.kids, "Count" => count };
        self.doc.objects.insert(self.pages_id, pages.into());
        let catalog = self.doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => self.pages_id,
        });
        self.doc.trailer.set("Root", catalog);
        save(&mut self.doc, dest)
    }
}

fn jpeg_xobject(bytes: Vec<u8>, info: &jpeg::JpegInfo) -> Stream {
    let space = match info.components {
        1 => "DeviceGray",
        3 => "DeviceRGB",
        _ => "DeviceCMYK",
    };
    let mut dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => info.width,
        "Height" => info.height,
        "ColorSpace" => space,
        "BitsPerComponent" => 8,
        "Filter" => "DCTDecode",
    };
    if info.components == 4 && info.adobe {
        let decode = [1, 0, 1, 0, 1, 0, 1, 0].map(Object::from).to_vec();
        dict.set("Decode", decode);
    }
    Stream::new(dict, bytes).with_compression(false)
}

fn flate_image(
    width: u32,
    height: u32,
    space: &str,
    samples: &[u8],
    channels: usize,
) -> Result<Stream> {
    let filtered = png_filter(samples, width as usize * channels, channels);
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&filtered)?;
    let dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => width,
        "Height" => height,
        "ColorSpace" => space,
        "BitsPerComponent" => 8,
        "Filter" => "FlateDecode",
        "DecodeParms" => dictionary! {
            "Predictor" => 15,
            "Colors" => channels as i64,
            "BitsPerComponent" => 8,
            "Columns" => width,
        },
    };
    Ok(Stream::new(dict, encoder.finish()?).with_compression(false))
}

/// PNG row filters (the PDF Flate predictor 15 lets each row pick its own): screenshots and
/// photos shrink far more than with Flate alone. The row with the smallest sum of signed
/// differences wins, the usual PNG heuristic.
fn png_filter(samples: &[u8], stride: usize, bpp: usize) -> Vec<u8> {
    let rows = samples.len().checked_div(stride).unwrap_or(0);
    let mut out = Vec::with_capacity(samples.len() + rows);
    let zero = vec![0u8; stride];
    let mut best = vec![0u8; stride];
    let mut candidate = vec![0u8; stride];
    for r in 0..rows {
        let row = &samples[r * stride..(r + 1) * stride];
        let up = if r == 0 {
            &zero[..]
        } else {
            &samples[(r - 1) * stride..r * stride]
        };
        let mut best_kind = 0;
        let mut best_cost = u64::MAX;
        for kind in 0..5u8 {
            for i in 0..stride {
                let a = if i >= bpp { row[i - bpp] } else { 0 };
                let b = up[i];
                let c = if i >= bpp { up[i - bpp] } else { 0 };
                let predicted = match kind {
                    0 => 0,
                    1 => a,
                    2 => b,
                    3 => ((u16::from(a) + u16::from(b)) / 2) as u8,
                    _ => paeth(a, b, c),
                };
                candidate[i] = row[i].wrapping_sub(predicted);
            }
            let cost = candidate
                .iter()
                .map(|&v| u64::from((v as i8).unsigned_abs()))
                .sum();
            if cost < best_cost {
                best_cost = cost;
                best_kind = kind;
                std::mem::swap(&mut best, &mut candidate);
            }
        }
        out.push(best_kind);
        out.extend_from_slice(&best);
    }
    out
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let p = i16::from(a) + i16::from(b) - i16::from(c);
    let (pa, pb, pc) = (
        (p - i16::from(a)).abs(),
        (p - i16::from(b)).abs(),
        (p - i16::from(c)).abs(),
    );
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

/// Where a picture goes: the page size and the image rectangle, in points.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Place {
    page: (f32, f32),
    /// x, y, width, height.
    image: [f32; 4],
}

fn place(layout: &PageLayout, width: u32, height: u32, dpi: (f32, f32)) -> Place {
    let natural = (
        width as f32 * POINTS_PER_INCH / dpi.0,
        height as f32 * POINTS_PER_INCH / dpi.1,
    );
    let margin = if layout.margin_mm.is_finite() {
        layout.margin_mm.max(0.0) * POINTS_PER_INCH / MM_PER_INCH
    } else {
        0.0
    };
    match layout.size {
        PageSize::FitImage => {
            let margin = margin.min(MAX_PAGE_SIDE / 4.0);
            let room = MAX_PAGE_SIDE - 2.0 * margin;
            let scale = (room / natural.0).min(room / natural.1).min(1.0);
            let (w, h) = (natural.0 * scale, natural.1 * scale);
            Place {
                page: (w + 2.0 * margin, h + 2.0 * margin),
                image: [margin, margin, w, h],
            }
        }
        PageSize::A4 | PageSize::Letter => {
            let (short, long) = if layout.size == PageSize::A4 {
                A4
            } else {
                LETTER
            };
            let page = if natural.0 > natural.1 {
                (long, short)
            } else {
                (short, long)
            };
            // However wide the margin, a tenth of the paper is left for the picture.
            let margin = margin.min(short * 0.45);
            let room = (page.0 - 2.0 * margin, page.1 - 2.0 * margin);
            let scale = (room.0 / natural.0).min(room.1 / natural.1);
            let (w, h) = (natural.0 * scale, natural.1 * scale);
            Place {
                page,
                image: [(page.0 - w) / 2.0, (page.1 - h) / 2.0, w, h],
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::fixtures;
    use crate::pdf::jpeg::tests::{adobe_cmyk_header, gray_jpeg, rgb_jpeg, with_orientation};
    use ::image::{Rgba, RgbaImage};

    fn image_of(doc: &Document, page: ObjectId) -> &Stream {
        let resources = doc
            .get_dictionary(page)
            .unwrap()
            .get(b"Resources")
            .unwrap()
            .as_dict()
            .unwrap();
        let xobjects = resources.get(b"XObject").unwrap().as_dict().unwrap();
        let id = xobjects.get(b"Im0").unwrap().as_reference().unwrap();
        doc.get_object(id).unwrap().as_stream().unwrap()
    }

    fn media_box(doc: &Document, page: ObjectId) -> Vec<f32> {
        let page = doc.get_dictionary(page).unwrap();
        let values = page.get(b"MediaBox").unwrap().as_array().unwrap();
        values.iter().map(|v| v.as_float().unwrap()).collect()
    }

    fn name<'a>(stream: &'a Stream, key: &[u8]) -> &'a [u8] {
        stream.dict.get(key).unwrap().as_name().unwrap()
    }

    fn alpha_png() -> DynamicImage {
        DynamicImage::ImageRgba8(RgbaImage::from_fn(64, 32, |x, _| {
            Rgba([200, 30, 30, if x < 32 { 255 } else { 0 }])
        }))
    }

    #[test]
    fn pdf_images_to_pdf_embeds_jpeg_and_masks_alpha() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("pictures.pdf");
        let rgb = rgb_jpeg(96, 48, None);
        let images = vec![
            PageImage::Jpeg(rgb.clone()),
            PageImage::Jpeg(gray_jpeg(30, 60)),
            PageImage::Pixels(alpha_png()),
        ];
        images_to_pdf(images, &PageLayout::default(), &dest, &Progress::none()).unwrap();

        let doc = Document::load(&dest).unwrap();
        let pages: Vec<ObjectId> = doc.page_iter().collect();
        assert_eq!(pages.len(), 3);

        let first = image_of(&doc, pages[0]);
        assert_eq!(name(first, b"Filter"), b"DCTDecode");
        assert_eq!(name(first, b"ColorSpace"), b"DeviceRGB");
        assert_eq!(first.content, rgb, "the JPEG is embedded as it is");
        // 96 px at the default 96 dpi is one inch.
        assert_eq!(media_box(&doc, pages[0]), vec![0.0, 0.0, 72.0, 36.0]);

        let second = image_of(&doc, pages[1]);
        assert_eq!(name(second, b"ColorSpace"), b"DeviceGray");

        let third = image_of(&doc, pages[2]);
        assert_eq!(name(third, b"Filter"), b"FlateDecode");
        assert_eq!(name(third, b"ColorSpace"), b"DeviceRGB");
        let mask = third.dict.get(b"SMask").unwrap().as_reference().unwrap();
        let mask = doc.get_object(mask).unwrap().as_stream().unwrap();
        assert_eq!(name(mask, b"ColorSpace"), b"DeviceGray");
        // The predictor round-trips: the decoded mask is the alpha channel.
        let samples = decode_predicted(&mask.content, 64);
        assert_eq!(samples.len(), 64 * 32);
        assert_eq!((samples[0], samples[63]), (255, 0));

        if fixtures::pdfium() {
            assert_eq!(crate::pdf::page_count(&dest).unwrap(), 3);
            let page = crate::pdf::render_page(&dest, 2, 72).unwrap();
            let left = page.get_pixel(5, 5);
            let right = page.get_pixel(page.width() - 5, 5);
            assert!(left[0] > 150 && left[1] < 90, "red where opaque: {left:?}");
            assert!(
                right[0] > 240 && right[1] > 240,
                "white where clear: {right:?}"
            );
        }
    }

    fn decode_predicted(data: &[u8], stride: usize) -> Vec<u8> {
        use std::io::Read;
        let mut raw = Vec::new();
        flate2::read::ZlibDecoder::new(data)
            .read_to_end(&mut raw)
            .unwrap();
        let mut out: Vec<u8> = Vec::new();
        for (r, row) in raw.chunks(stride + 1).enumerate() {
            let (kind, row) = (row[0], &row[1..]);
            for (i, &v) in row.iter().enumerate() {
                let a = if i >= 1 { out[r * stride + i - 1] } else { 0 };
                let b = if r > 0 { out[(r - 1) * stride + i] } else { 0 };
                let c = if r > 0 && i >= 1 {
                    out[(r - 1) * stride + i - 1]
                } else {
                    0
                };
                let predicted = match kind {
                    0 => 0,
                    1 => a,
                    2 => b,
                    3 => ((u16::from(a) + u16::from(b)) / 2) as u8,
                    _ => paeth(a, b, c),
                };
                out.push(v.wrapping_add(predicted));
            }
        }
        out
    }

    #[test]
    fn pdf_images_to_pdf_page_sizes() {
        let a4 = PageLayout {
            size: PageSize::A4,
            margin_mm: 10.0,
        };
        // A landscape picture turns the paper.
        let wide = place(&a4, 2000, 1000, (96.0, 96.0));
        assert_eq!(wide.page, (A4.1, A4.0));
        let margin = 10.0 * 72.0 / 25.4;
        let [x, y, w, h] = wide.image;
        assert!((x - margin).abs() < 0.01, "fills the width: {x}");
        assert!((w / h - 2.0).abs() < 0.001, "keeps the aspect");
        assert!((y - (A4.0 - h) / 2.0).abs() < 0.01, "centred");

        let letter = PageLayout {
            size: PageSize::Letter,
            margin_mm: 0.0,
        };
        let tall = place(&letter, 100, 400, (96.0, 96.0));
        assert_eq!(tall.page, LETTER);
        assert!(
            (tall.image[3] - 792.0).abs() < 0.01,
            "small pictures grow to fit"
        );

        let fit = PageLayout {
            size: PageSize::FitImage,
            margin_mm: 25.4,
        };
        let dense = place(&fit, 600, 300, (300.0, 300.0));
        assert_eq!(dense.page, (144.0 + 144.0, 72.0 + 144.0));
        assert_eq!(dense.image, [72.0, 72.0, 144.0, 72.0]);
    }

    #[test]
    fn pdf_images_to_pdf_cmyk_jpeg_gets_inverted_decode() {
        let header = adobe_cmyk_header();
        let info = jpeg::read(&header).unwrap();
        let stream = jpeg_xobject(header, &info);
        assert_eq!(name(&stream, b"ColorSpace"), b"DeviceCMYK");
        let decode = stream.dict.get(b"Decode").unwrap().as_array().unwrap();
        assert_eq!(decode.len(), 8);
        assert_eq!(decode[0].as_i64().unwrap(), 1);
    }

    #[test]
    fn pdf_from_images_keeps_upright_jpegs_and_decodes_turned_ones() {
        let dir = tempfile::tempdir().unwrap();
        let upright = dir.path().join("upright ğüş.jpg");
        let turned = dir.path().join("turned.jpg");
        let png = dir.path().join("clear.png");
        let upright_bytes = rgb_jpeg(40, 20, Some(150));
        std::fs::write(&upright, &upright_bytes).unwrap();
        std::fs::write(&turned, with_orientation(&rgb_jpeg(40, 20, None), 6)).unwrap();
        alpha_png().save(&png).unwrap();
        let inputs = vec![
            (upright, "jpg".to_owned()),
            (turned, "jpg".to_owned()),
            (png, "png".to_owned()),
        ];
        let dest = dir.path().join("Kento ğüşıöç 🧪.pdf");
        from_images(
            &inputs,
            &PageLayout::default(),
            &dest,
            &Options::default(),
            &Progress::none(),
        )
        .unwrap();

        let doc = Document::load(&dest).unwrap();
        let pages: Vec<ObjectId> = doc.page_iter().collect();
        assert_eq!(pages.len(), 3);
        assert_eq!(image_of(&doc, pages[0]).content, upright_bytes);
        // 40 px at 150 dpi.
        assert_eq!(media_box(&doc, pages[0])[2], 40.0 * 72.0 / 150.0);
        assert_eq!(name(image_of(&doc, pages[1]), b"Filter"), b"FlateDecode");
        assert!(image_of(&doc, pages[2]).dict.has(b"SMask"));
    }

    #[test]
    fn pdf_from_images_refuses_an_empty_list() {
        let dir = tempfile::tempdir().unwrap();
        let result = from_images(
            &[],
            &PageLayout::default(),
            &dir.path().join("none.pdf"),
            &Options::default(),
            &Progress::none(),
        );
        assert!(matches!(result, Err(Error::Other(_))));
    }
}
