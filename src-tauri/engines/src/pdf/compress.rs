// SPDX-License-Identifier: MIT
//! Compress for PDF (an enhancement): the pictures inside are scaled down and stored again as
//! JPEG, and the file is written with compressed object streams.
//!
//! A picture is touched only when Kento reads its pixels the way a reader shows them: 8-bit gray
//! or RGB (device, calibrated or ICC-based) stored as JPEG, or as samples behind lossless filters.
//! CMYK, indexed colours, 1- and 16-bit samples, JBIG2, CCITT and JPEG 2000 pictures, masks (a
//! soft mask stays exactly as it is), pictures with a colour-key mask or a decode array, and
//! inline images are left alone, and so is any picture whose new stream would not be smaller.
//! Besides, streams stored without a filter are compressed, objects nothing refers to are
//! dropped, and the file is written with object and cross-reference streams (PDF 1.5).
//!
//! A quality level picks one of `STEPS`. A share or a size takes the mildest step whose file fits,
//! by binary search over the steps, or no step when the other savings are enough. Pictures never
//! go into object streams, so each step's file size is known from the new pictures alone, before
//! anything is written.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

use ::image::codecs::jpeg::JpegEncoder;
use ::image::imageops::FilterType;
use ::image::{DynamicImage, GrayImage, ImageFormat, RgbImage};
use lopdf::{Document, Object, ObjectId, SaveOptions, Stream};

use super::jpeg;
use super::tools::{deref, load, MAX_STREAM};
use super::MAX_PAGES;
use crate::compress::{CompressRun, Compression};
use crate::{Error, Progress, Result};

/// The longest side in pixels and the JPEG quality, from the mildest step to the strongest.
const STEPS: [(u32, u8); 12] = [
    (3000, 85),
    (2600, 80),
    (2300, 76),
    (2000, 72),
    (1800, 68),
    (1600, 64),
    (1400, 60),
    (1200, 55),
    (1000, 50),
    (850, 45),
    (700, 40),
    (500, 35),
];
/// Pictures with more pixels than this are left as they are.
const MAX_PIXELS: u64 = 64_000_000;
/// What a changed picture's dictionary may grow by (a longer filter name, longer numbers).
const DICT_SLACK: u64 = 64;
/// Filters whose output is the samples themselves.
const LOSSLESS: [&[u8]; 5] = [
    b"FlateDecode",
    b"LZWDecode",
    b"ASCII85Decode",
    b"ASCIIHexDecode",
    b"RunLengthDecode",
];
/// The part of the progress bar the pictures take; writing the file takes the rest.
const PICTURES: f32 = 0.9;

pub(crate) fn run(run: &CompressRun) -> Result<Vec<PathBuf>> {
    let original = fs::metadata(run.input)?.len();
    let mut doc = load(run.input)?;
    let pages = doc.page_iter().count();
    if pages > MAX_PAGES {
        return Err(Error::Limit(format!("{pages} pages; at most {MAX_PAGES}")));
    }
    run.progress.check()?;
    prune(&mut doc);
    compress_streams(&mut doc);
    let pictures = pictures(&doc);
    tracing::debug!(
        pages,
        pictures = pictures.len(),
        compression = ?run.compression,
        "compressing a PDF"
    );
    let smaller = original.saturating_sub(1);
    let (limit, changes) = match run.compression {
        Compression::Quality { level } => {
            let level = usize::from(level.clamp(1, 100));
            let step = ((100 - level) * (STEPS.len() - 1) + 49) / 99;
            let changes = shrink(&doc, &pictures, STEPS[step], run.progress, (0.0, PICTURES))?;
            (smaller, changes)
        }
        Compression::Ratio { percent } => {
            let limit = original.saturating_mul(u64::from(percent.clamp(5, 95))) / 100;
            (limit, search(&mut doc, &pictures, limit, run.progress)?)
        }
        Compression::Size { bytes } => {
            let limit = bytes.min(smaller);
            (limit, search(&mut doc, &pictures, limit, run.progress)?)
        }
    };
    for change in changes {
        doc.objects.insert(change.id, change.object);
    }
    run.progress.check()?;
    write(&mut doc, run.dest)?;
    if fs::metadata(run.dest)?.len() > limit {
        let _ = fs::remove_file(run.dest);
        return Err(Error::NotSmaller);
    }
    run.progress.report(1.0);
    Ok(vec![run.dest.to_path_buf()])
}

/// A picture that can be stored again as JPEG.
#[derive(Debug)]
struct Picture {
    id: ObjectId,
    width: u32,
    height: u32,
    gray: bool,
    /// Stored as JPEG already, rather than as samples.
    jpeg: bool,
    /// The stream's length now.
    size: u64,
}

/// A picture's new stream.
struct Change {
    id: ObjectId,
    object: Object,
    /// Bytes the file loses with it.
    saved: u64,
}

/// The changes of the mildest step whose file fits in `limit` bytes, none when the file fits
/// without changing a picture. `Error::NotSmaller` when even the strongest step is too large.
fn search(
    doc: &mut Document,
    pictures: &[Picture],
    limit: u64,
    progress: &Progress,
) -> Result<Vec<Change>> {
    let base = measure(doc)?;
    if base <= limit {
        return Ok(Vec::new());
    }
    if pictures.is_empty() {
        return Err(Error::NotSmaller);
    }
    let mut tries = 0;
    let mut evaluate = |step: usize| -> Result<(bool, Vec<Change>)> {
        // Each try takes half of what is left of the bar, since their number is not known.
        let share = |n: i32| PICTURES * (1.0 - 0.5f32.powi(n));
        let span = (share(tries), share(tries + 1));
        tries += 1;
        let changes = shrink(doc, pictures, STEPS[step], progress, span)?;
        let saved: u64 = changes.iter().map(|change| change.saved).sum();
        Ok((base.saturating_sub(saved) <= limit, changes))
    };
    let (mut low, mut high) = (0, STEPS.len() - 1);
    let (fits, mut best) = evaluate(high)?;
    if !fits {
        return Err(Error::NotSmaller);
    }
    while low < high {
        let middle = (low + high) / 2;
        let (fits, changes) = evaluate(middle)?;
        if fits {
            high = middle;
            best = changes;
        } else {
            low = middle + 1;
        }
    }
    tracing::debug!(step = high, "the step that fits");
    Ok(best)
}

/// The new streams of every picture that gets smaller at this step.
fn shrink(
    doc: &Document,
    pictures: &[Picture],
    step: (u32, u8),
    progress: &Progress,
    span: (f32, f32),
) -> Result<Vec<Change>> {
    let mut changes = Vec::new();
    for (done, picture) in pictures.iter().enumerate() {
        progress.check()?;
        if let Some(stream) = smaller(doc, picture, step) {
            changes.push(Change {
                id: picture.id,
                saved: picture.size - stream.content.len() as u64 - DICT_SLACK,
                object: Object::Stream(stream),
            });
        }
        let done = (done + 1) as f32 / pictures.len() as f32;
        progress.report(span.0 + (span.1 - span.0) * done);
    }
    Ok(changes)
}

/// The picture as JPEG at `quality`, no longer than `side` pixels, when that is smaller.
fn smaller(doc: &Document, picture: &Picture, (side, quality): (u32, u8)) -> Option<Stream> {
    let stream = doc.objects.get(&picture.id)?.as_stream().ok()?;
    let Some(image) = decode(stream, picture) else {
        tracing::debug!("a picture could not be read; it stays as it is");
        return None;
    };
    let (width, height) = (image.width(), image.height());
    let longer = width.max(height);
    let image = if longer > side {
        let scale = f64::from(side) / f64::from(longer);
        let fit = |length: u32| ((f64::from(length) * scale).round() as u32).max(1);
        image.resize_exact(fit(width), fit(height), FilterType::CatmullRom)
    } else {
        image
    };
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, quality);
    match &image {
        DynamicImage::ImageLuma8(gray) => encoder.encode_image(gray),
        DynamicImage::ImageRgb8(rgb) => encoder.encode_image(rgb),
        _ => return None,
    }
    .ok()?;
    if bytes.len() as u64 + DICT_SLACK >= picture.size {
        return None;
    }
    let mut dict = stream.dict.clone();
    dict.set("Width", i64::from(image.width()));
    dict.set("Height", i64::from(image.height()));
    dict.set("BitsPerComponent", 8);
    dict.set("Filter", "DCTDecode");
    dict.remove(b"DecodeParms");
    Some(Stream::new(dict, bytes).with_compression(false))
}

/// The picture's pixels, gray or RGB as its colour space says.
fn decode(stream: &Stream, picture: &Picture) -> Option<DynamicImage> {
    if picture.jpeg {
        let info = jpeg::read(&stream.content)?;
        let components = if picture.gray { 1 } else { 3 };
        let pixels = u64::from(info.width) * u64::from(info.height);
        if info.components != components || pixels > MAX_PIXELS {
            return None;
        }
        let image =
            ::image::load_from_memory_with_format(&stream.content, ImageFormat::Jpeg).ok()?;
        return Some(if picture.gray {
            DynamicImage::ImageLuma8(image.to_luma8())
        } else {
            DynamicImage::ImageRgb8(image.to_rgb8())
        });
    }
    let channels = if picture.gray { 1 } else { 3 };
    let expected = picture.width as usize * picture.height as usize * channels;
    let limit = expected.saturating_add(expected / 8 + 4096).min(MAX_STREAM);
    let mut samples = stream.decompressed_content_with_limit(limit).ok()?;
    if samples.len() < expected {
        return None;
    }
    samples.truncate(expected);
    let (width, height) = (picture.width, picture.height);
    if picture.gray {
        GrayImage::from_raw(width, height, samples).map(DynamicImage::ImageLuma8)
    } else {
        RgbImage::from_raw(width, height, samples).map(DynamicImage::ImageRgb8)
    }
}

/// Every picture that can be stored again as JPEG.
fn pictures(doc: &Document) -> Vec<Picture> {
    // Soft masks and stencil masks belong to another picture and keep their exact values.
    let mut masks = HashSet::new();
    for object in doc.objects.values() {
        if let Object::Stream(stream) = object {
            for key in [b"SMask".as_slice(), b"Mask"] {
                if let Ok(id) = stream.dict.get(key).and_then(Object::as_reference) {
                    masks.insert(id);
                }
            }
        }
    }
    doc.objects
        .iter()
        .filter(|(id, _)| !masks.contains(*id))
        .filter_map(|(&id, object)| picture(doc, id, object.as_stream().ok()?))
        .collect()
}

fn picture(doc: &Document, id: ObjectId, stream: &Stream) -> Option<Picture> {
    let dict = &stream.dict;
    let value = |key: &[u8]| deref(doc, dict.get(key).ok());
    if value(b"Subtype")?.as_name().ok()? != b"Image" {
        return None;
    }
    if value(b"ImageMask").is_some_and(|mask| mask.as_bool().unwrap_or(false)) {
        return None;
    }
    // A decode array or a colour-key mask works on the exact sample values.
    if dict.has(b"Decode") || value(b"Mask").is_some_and(|mask| mask.as_array().is_ok()) {
        return None;
    }
    let number = |key: &[u8]| value(key).and_then(|v| v.as_i64().ok());
    let length = |key: &[u8]| {
        number(key)
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| (1..=u32::from(u16::MAX)).contains(n))
    };
    let (width, height) = (length(b"Width")?, length(b"Height")?);
    if u64::from(width) * u64::from(height) > MAX_PIXELS || number(b"BitsPerComponent")? != 8 {
        return None;
    }
    let gray = match components(doc, value(b"ColorSpace")?)? {
        1 => true,
        3 => false,
        _ => return None,
    };
    let filters = if dict.has(b"Filter") {
        stream.filters().ok()?
    } else {
        Vec::new()
    };
    let jpeg = match filters.as_slice() {
        // DecodeParms on a JPEG can turn its colour transform off.
        [only] if *only == b"DCTDecode" && !dict.has(b"DecodeParms") => true,
        all if all.iter().all(|filter| LOSSLESS.contains(filter)) => false,
        _ => return None,
    };
    Some(Picture {
        id,
        width,
        height,
        gray,
        jpeg,
        size: stream.content.len() as u64,
    })
}

/// 1 or 3 for the gray and RGB families; `None` for every other colour space.
fn components(doc: &Document, space: &Object) -> Option<u8> {
    match space {
        Object::Name(name) => match name.as_slice() {
            b"DeviceGray" => Some(1),
            b"DeviceRGB" => Some(3),
            _ => None,
        },
        Object::Array(items) => match items.first()?.as_name().ok()? {
            b"CalGray" => Some(1),
            b"CalRGB" => Some(3),
            b"ICCBased" => {
                let profile = deref(doc, items.get(1))?.as_stream().ok()?;
                match deref(doc, profile.dict.get(b"N").ok())?.as_i64().ok()? {
                    1 => Some(1),
                    3 => Some(3),
                    _ => None,
                }
            }
            _ => None,
        },
        _ => None,
    }
}

/// Drops objects nothing refers to, such as what earlier edits left behind.
fn prune(doc: &mut Document) {
    // Without a catalog everything would look unused.
    if doc.catalog().is_err() {
        return;
    }
    let mut seen = HashSet::new();
    let mut stack: Vec<&Object> = doc.trailer.iter().map(|(_, value)| value).collect();
    while let Some(object) = stack.pop() {
        match object {
            Object::Reference(id) => {
                if seen.insert(*id) {
                    stack.extend(doc.objects.get(id));
                }
            }
            Object::Array(items) => stack.extend(items),
            Object::Dictionary(dict) => stack.extend(dict.iter().map(|(_, value)| value)),
            Object::Stream(stream) => stack.extend(stream.dict.iter().map(|(_, value)| value)),
            _ => {}
        }
    }
    let before = doc.objects.len();
    doc.objects.retain(|id, _| seen.contains(id));
    tracing::debug!(
        dropped = before - doc.objects.len(),
        "dropped unused objects"
    );
}

/// Compresses the streams stored without a filter. XMP metadata stays readable as it is, as
/// archiving rules ask.
fn compress_streams(doc: &mut Document) {
    for object in doc.objects.values_mut() {
        if let Object::Stream(stream) = object {
            let metadata = stream
                .dict
                .get(b"Type")
                .and_then(Object::as_name)
                .is_ok_and(|name| name == b"Metadata");
            if stream.allows_compression && !metadata {
                // A stream that does not compress is kept as it is.
                let _ = stream.compress();
            }
        }
    }
}

/// Object streams and a cross-reference stream, packed as tightly as zlib goes.
fn save_options() -> SaveOptions {
    SaveOptions::builder()
        .use_object_streams(true)
        .use_xref_streams(true)
        .compression_level(9)
        .build()
}

/// The size of the file `write` would make.
fn measure(doc: &mut Document) -> Result<u64> {
    let mut counter = Counter(0);
    let max_id = doc.max_id;
    let written = doc.save_with_options(&mut counter, save_options());
    // Writing numbers the new object streams; the real write numbers them again from here.
    doc.max_id = max_id;
    written?;
    Ok(counter.0)
}

fn write(doc: &mut Document, dest: &Path) -> Result<()> {
    let mut file = BufWriter::new(File::create(dest)?);
    doc.save_with_options(&mut file, save_options())?;
    file.flush()?;
    Ok(())
}

/// Counts what is written to it.
struct Counter(u64);

impl Write for Counter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0 += buf.len() as u64;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::fixtures::{self, Fixture};
    use crate::pdf::jpeg::tests::{adobe_cmyk_header, gray_jpeg};
    use crate::pdf::{images_to_pdf, PageImage, PageLayout};
    use crate::{FileKind, Options};
    use ::image::{Rgb, Rgba, RgbaImage};
    use lopdf::dictionary;

    const NAME: &str = "Kento ğüşıöç 🧪";

    /// Smooth colours under fine noise, like a photo: JPEG at a high quality keeps it large.
    fn photo(width: u32, height: u32) -> RgbImage {
        let mut seed = 0x2545_f491_u32;
        RgbImage::from_fn(width, height, |x, y| {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let noise = (seed % 32) as u8;
            Rgb([
                (x * 200 / width) as u8 + noise,
                (y * 200 / height) as u8 + noise,
                ((x + y) % 200) as u8 + noise,
            ])
        })
    }

    fn jpeg_of(image: &RgbImage, quality: u8) -> Vec<u8> {
        let mut bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut bytes, quality)
            .encode_image(image)
            .unwrap();
        bytes
    }

    /// Four pages: a large JPEG, an RGB picture in Flate samples, a small gray JPEG and a
    /// picture with a soft mask.
    fn pictures_pdf(dir: &Path, large: (u32, u32)) -> PathBuf {
        let path = dir.join(format!("{NAME}.pdf"));
        let colours = photo(240, 120);
        let clear = RgbaImage::from_fn(240, 120, |x, y| {
            let [r, g, b] = colours.get_pixel(x, y).0;
            Rgba([r, g, b, if x < 120 { 255 } else { 40 }])
        });
        images_to_pdf(
            vec![
                PageImage::Jpeg(jpeg_of(&photo(large.0, large.1), 95)),
                PageImage::Pixels(DynamicImage::ImageRgb8(photo(480, 300))),
                PageImage::Jpeg(gray_jpeg(300, 200)),
                PageImage::Pixels(DynamicImage::ImageRgba8(clear)),
            ],
            &PageLayout::default(),
            &path,
            &Progress::none(),
        )
        .unwrap();
        path
    }

    fn compress(input: &Path, compression: Compression, dest: &Path) -> Result<Vec<PathBuf>> {
        let temp = tempfile::tempdir().unwrap();
        crate::compress::compress(&CompressRun {
            input,
            from: "pdf",
            kind: FileKind::Pdf,
            compression,
            dest,
            temp: temp.path(),
            options: &Options::default(),
            progress: &Progress::none(),
        })
    }

    fn page_image(doc: &Document, page: usize) -> &Stream {
        let page = fixtures::pages(doc)[page];
        let resources = doc.get_dictionary(page).unwrap().get(b"Resources").unwrap();
        let xobjects = resources.as_dict().unwrap().get(b"XObject").unwrap();
        let id = xobjects
            .as_dict()
            .unwrap()
            .get(b"Im0")
            .unwrap()
            .as_reference()
            .unwrap();
        doc.get_object(id).unwrap().as_stream().unwrap()
    }

    fn name<'a>(stream: &'a Stream, key: &[u8]) -> &'a [u8] {
        stream.dict.get(key).unwrap().as_name().unwrap()
    }

    fn number(stream: &Stream, key: &[u8]) -> i64 {
        stream.dict.get(key).unwrap().as_i64().unwrap()
    }

    #[test]
    fn pdf_compress_shrinks_pictures_and_still_opens() {
        let dir = tempfile::tempdir().unwrap();
        let input = pictures_pdf(dir.path(), (1500, 1000));
        let before = Document::load(&input).unwrap();
        let dest = dir.path().join(format!(".{NAME} small.pdf.kento-part"));
        let written = compress(&input, Compression::Quality { level: 50 }, &dest).unwrap();
        assert_eq!(written, vec![dest.clone()]);
        let (old, new) = (
            fs::metadata(&input).unwrap().len(),
            fs::metadata(&dest).unwrap().len(),
        );
        assert!(new < old / 2, "{new} is not much smaller than {old}");

        let doc = Document::load(&dest).unwrap();
        assert_eq!(fixtures::pages(&doc).len(), 4);
        // Level 50 is the step of 1400 pixels.
        let large = page_image(&doc, 0);
        assert_eq!(name(large, b"Filter"), b"DCTDecode");
        assert_eq!(
            (number(large, b"Width"), number(large, b"Height")),
            (1400, 933)
        );
        let flate = page_image(&doc, 1);
        assert_eq!(name(flate, b"Filter"), b"DCTDecode");
        assert!(!flate.dict.has(b"DecodeParms"));
        assert_eq!(number(flate, b"Width"), 480);
        assert_eq!(name(flate, b"ColorSpace"), b"DeviceRGB");
        let decoded = ::image::load_from_memory(&flate.content).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (480, 300));

        // The soft mask is the very same stream.
        let mask_of = |doc: &Document| {
            let picture = page_image(doc, 3);
            let id = picture.dict.get(b"SMask").unwrap().as_reference().unwrap();
            doc.get_object(id)
                .unwrap()
                .as_stream()
                .unwrap()
                .content
                .clone()
        };
        assert_eq!(mask_of(&doc), mask_of(&before));
        assert_eq!(name(page_image(&doc, 3), b"Filter"), b"DCTDecode");

        if fixtures::pdfium() {
            assert_eq!(crate::pdf::page_count(&dest).unwrap(), 4);
            // Dark where the picture is opaque, nearly white where it is almost clear.
            let page = crate::pdf::render_page(&dest, 3, 72).unwrap();
            let opaque = page.get_pixel(10, 10);
            let clear = page.get_pixel(page.width() - 10, 10);
            assert!(opaque.0[..3].iter().all(|&c| c < 120), "{opaque:?}");
            assert!(clear.0[..3].iter().all(|&c| c > 180), "{clear:?}");
        }
    }

    #[test]
    fn pdf_compress_reaches_a_target_size() {
        let dir = tempfile::tempdir().unwrap();
        let input = pictures_pdf(dir.path(), (1000, 700));
        let original = fs::metadata(&input).unwrap().len();
        let target = original * 30 / 100;
        let dest = dir.path().join("target.pdf");
        compress(&input, Compression::Size { bytes: target }, &dest).unwrap();
        let written = fs::metadata(&dest).unwrap().len();
        assert!(written <= target, "{written} > {target}");
        // The mildest step that fits, not the strongest.
        assert!(written > target / 2, "{written} is far under {target}");
        assert_eq!(fixtures::pages(&Document::load(&dest).unwrap()).len(), 4);
        if fixtures::pdfium() {
            assert_eq!(crate::pdf::page_count(&dest).unwrap(), 4);
        }

        let dest = dir.path().join("ratio.pdf");
        compress(&input, Compression::Ratio { percent: 60 }, &dest).unwrap();
        assert!(fs::metadata(&dest).unwrap().len() <= original * 60 / 100);

        let dest = dir.path().join("impossible.pdf");
        let result = compress(&input, Compression::Size { bytes: 3_000 }, &dest);
        assert!(matches!(result, Err(Error::NotSmaller)), "{result:?}");
        assert!(!dest.exists());
    }

    #[test]
    fn pdf_compress_without_pictures() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join(format!("{NAME} text.pdf"));
        Fixture::pages(30).write(&input);
        let dest = dir.path().join("text.pdf");
        compress(&input, Compression::Quality { level: 80 }, &dest).unwrap();
        assert!(fs::metadata(&dest).unwrap().len() < fs::metadata(&input).unwrap().len());
        let doc = Document::load(&dest).unwrap();
        let pages = fixtures::pages(&doc);
        assert_eq!(pages.len(), 30);
        let text = doc.get_page_content(pages[29]);
        assert!(String::from_utf8_lossy(&text).contains("Kento page 30 says hello"));
        if fixtures::pdfium() {
            assert_eq!(crate::pdf::page_count(&dest).unwrap(), 30);
        }

        let dest = dir.path().join("too small.pdf");
        let result = compress(&input, Compression::Ratio { percent: 5 }, &dest);
        assert!(matches!(result, Err(Error::NotSmaller)), "{result:?}");
        assert!(!dest.exists());
    }

    #[test]
    fn pdf_compress_refuses_encrypted_files() {
        let dir = tempfile::tempdir().unwrap();
        for password in ["", "gizli"] {
            let input = dir.path().join(format!("{NAME} locked {password}.pdf"));
            fixtures::encrypted(&input, password);
            let dest = dir.path().join("out.pdf");
            let result = compress(&input, Compression::Quality { level: 50 }, &dest);
            assert!(matches!(result, Err(Error::Encrypted)), "{result:?}");
            assert!(!dest.exists());
        }
    }

    /// A 4 × 2 RGB picture, with `extra` added to or replacing its entries.
    fn image(doc: &mut Document, extra: lopdf::Dictionary, content: Vec<u8>) -> ObjectId {
        let mut dict = dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => 4,
            "Height" => 2,
            "BitsPerComponent" => 8,
            "ColorSpace" => "DeviceRGB",
        };
        for (key, value) in extra {
            dict.set(key, value);
        }
        doc.add_object(Stream::new(dict, content))
    }

    #[test]
    fn pdf_compress_takes_only_pictures_it_reads_exactly() {
        let mut doc = Document::with_version("1.7");
        let rgb = image(&mut doc, dictionary! {}, vec![0; 24]);
        let mask = image(
            &mut doc,
            dictionary! { "ColorSpace" => "DeviceGray" },
            vec![0; 8],
        );
        let masked = image(&mut doc, dictionary! { "SMask" => mask }, vec![0; 24]);
        let cmyk = image(
            &mut doc,
            dictionary! { "ColorSpace" => "DeviceCMYK", "Filter" => "DCTDecode" },
            adobe_cmyk_header(),
        );
        let palette = Object::string_literal(vec![0u8; 6]);
        let indexed = image(
            &mut doc,
            dictionary! {
                "ColorSpace" => vec!["Indexed".into(), "DeviceRGB".into(), 1.into(), palette],
            },
            vec![0; 8],
        );
        let deep = image(
            &mut doc,
            dictionary! { "BitsPerComponent" => 16 },
            vec![0; 48],
        );
        let stencil = image(
            &mut doc,
            dictionary! { "ImageMask" => true, "BitsPerComponent" => 1 },
            vec![0; 2],
        );
        let inverted = [1, 0, 1, 0, 1, 0].map(Object::from).to_vec();
        let decoded = image(&mut doc, dictionary! { "Decode" => inverted }, vec![0; 24]);
        let jpx = image(
            &mut doc,
            dictionary! { "Filter" => "JPXDecode" },
            vec![0; 10],
        );
        let rgb_profile = doc.add_object(Stream::new(dictionary! { "N" => 3 }, vec![0; 10]));
        let icc = image(
            &mut doc,
            dictionary! {
                "ColorSpace" => vec!["ICCBased".into(), rgb_profile.into()],
                "Filter" => "FlateDecode",
            },
            vec![0; 10],
        );
        let cmyk_profile = doc.add_object(Stream::new(dictionary! { "N" => 4 }, vec![0; 10]));
        let cmyk_icc = image(
            &mut doc,
            dictionary! { "ColorSpace" => vec!["ICCBased".into(), cmyk_profile.into()] },
            vec![0; 32],
        );
        let gray_jpeg_id = image(
            &mut doc,
            dictionary! {
                "Width" => 8,
                "Height" => 8,
                "ColorSpace" => "DeviceGray",
                "Filter" => vec![Object::from("DCTDecode")],
            },
            gray_jpeg(8, 8),
        );
        let found = pictures(&doc);
        let ids: Vec<ObjectId> = found.iter().map(|picture| picture.id).collect();
        assert_eq!(ids, vec![rgb, masked, icc, gray_jpeg_id]);
        for skipped in [mask, cmyk, indexed, deep, stencil, decoded, jpx, cmyk_icc] {
            assert!(!ids.contains(&skipped));
        }
        let gray = found.iter().find(|p| p.id == gray_jpeg_id).unwrap();
        assert!(gray.jpeg && gray.gray);
        assert!(!found[0].jpeg && !found[0].gray);
    }

    #[test]
    fn pdf_compress_drops_unused_objects() {
        let mut doc = Fixture::pages(2).document();
        let orphan = doc.add_object(dictionary! { "Kento" => "unused" });
        let count = doc.objects.len();
        prune(&mut doc);
        assert_eq!(doc.objects.len(), count - 1);
        assert!(!doc.objects.contains_key(&orphan));
        assert_eq!(fixtures::pages(&doc).len(), 2);
    }
}
