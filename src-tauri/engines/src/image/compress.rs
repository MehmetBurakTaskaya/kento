// SPDX-License-Identifier: MIT
//! Compress for images: JPG, WEBP and AVIF by quality, PNG by palette and deflate, each in its
//! own format; a target size by searching the quality, then the size if quality is not enough.
//!
//! - JPG, WEBP, AVIF and HEIC (where this computer writes HEIC): the level is the encoder's
//!   quality, 1 to 100. A share or a size is searched for: the best quality from 25 (AVIF 20) to
//!   95 whose encode fits, by halving the range (about seven encodes, all in memory).
//! - PNG: level 100 is lossless, deflated at the strongest setting, gray pictures stored as gray
//!   and pictures of 256 colours or fewer as an exact palette. Below 100 the picture becomes a
//!   dithered NeuQuant palette of 32 (level 1) to 256 (level 99) colours. A share or a size tries
//!   lossless first, then searches the palette size.
//! - TIFF: lossless, deflated with the horizontal predictor.
//! - When even the smallest setting is too big for a share or a size, the picture is scaled down
//!   (aspect kept) and searched again, until it fits or gets too small.
//!
//! The result must be smaller than the original as well as under the target; otherwise the job
//! ends with `Error::NotSmaller` and writes nothing. Like every output, it carries no EXIF.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

use ::image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
use ::image::imageops::{self, FilterType};
use ::image::{DynamicImage, GenericImageView, ImageEncoder, RgbaImage};
use color_quant::NeuQuant;

use super::decode;
use super::encode::{self, is_gray, profile, without_opaque_alpha};
use super::heic_write_available;
use crate::compress::{CompressRun, Compression};
use crate::{Error, Options, Progress, Result};

/// The quality range searched for a share or a size: lower looks broken, higher rarely shrinks.
const LOWEST_QUALITY: u8 = 25;
const LOWEST_AVIF_QUALITY: u8 = 20;
const HIGHEST_QUALITY: u8 = 95;
/// Palette sizes for PNG; NeuQuant is tuned for 64 colours and more and still fine at 32.
const FEWEST_COLOURS: f64 = 32.0;
const PALETTE_STEPS: usize = 10;
/// NeuQuant samples one pixel in this many: its own suggested balance of speed and quality.
const NEUQUANT_SAMPLING: i32 = 10;
/// Scaling down stops here.
const MIN_SIDE: u32 = 16;
const MAX_ROUNDS: usize = 12;

enum Method {
    /// A format with a quality setting, by its writer's id.
    Quality(&'static str),
    Png,
    Tiff,
}

pub(crate) fn run(run: &CompressRun) -> Result<Vec<PathBuf>> {
    let method = match run.from {
        "jpg" => Method::Quality("jpg"),
        "webp" => Method::Quality("webp"),
        "avif" => Method::Quality("avif"),
        "heic" if heic_write_available() => Method::Quality("heic"),
        "png" => Method::Png,
        "tiff" => Method::Tiff,
        other => {
            return Err(Error::Unsupported {
                from: other.to_owned(),
                to: "compress".to_owned(),
            })
        }
    };
    let original = fs::metadata(run.input)?.len();
    let target = target(run.compression, original)?;
    run.progress.check()?;
    let decoded = decode::load(run.input, run.from, run.options)?;
    run.progress.report(0.1);
    let icc = decoded.icc;
    let image = decoded.image;
    let search = Search {
        target,
        progress: run.progress,
    };
    let data = match (method, run.compression) {
        (Method::Quality(to), Compression::Quality { level }) => {
            lossy(&image, icc, to, level.clamp(1, 100), run.options)?
        }
        (Method::Quality(to), _) => {
            let lowest = if to == "avif" {
                LOWEST_AVIF_QUALITY
            } else {
                LOWEST_QUALITY
            };
            let steps = usize::from(HIGHEST_QUALITY - lowest) + 1;
            search.fit(&image, steps, &|image, step| {
                lossy(image, icc.clone(), to, lowest + step as u8, run.options)
            })?
        }
        (Method::Png, Compression::Quality { level: 100.. }) => png_lossless(&image, icc)?,
        (Method::Png, Compression::Quality { level }) => match exact_palette(&image, icc.clone()) {
            Some(data) => data?,
            None => png_palette(&image, colours_for_level(level), icc)?,
        },
        (Method::Png, _) => search.fit(&image, PALETTE_STEPS + 1, &|image, step| {
            if step == PALETTE_STEPS {
                png_lossless(image, icc.clone())
            } else {
                png_palette(image, colours_for_step(step), icc.clone())
            }
        })?,
        (Method::Tiff, Compression::Quality { .. }) => tiff_deflate(&image, icc)?,
        (Method::Tiff, _) => search.fit(&image, 1, &|image, _| tiff_deflate(image, icc.clone()))?,
    };
    if data.len() as u64 > target {
        return Err(Error::NotSmaller);
    }
    run.progress.check()?;
    fs::write(run.dest, data)?;
    run.progress.report(1.0);
    Ok(vec![run.dest.to_path_buf()])
}

/// The most bytes the result may have: always fewer than the original.
fn target(compression: Compression, original: u64) -> Result<u64> {
    let smaller = original.saturating_sub(1);
    let target = match compression {
        Compression::Quality { .. } => smaller,
        Compression::Ratio { percent } => original * u64::from(percent.clamp(5, 95)) / 100,
        Compression::Size { bytes } => bytes.min(smaller),
    };
    if target == 0 {
        Err(Error::NotSmaller)
    } else {
        Ok(target)
    }
}

struct Search<'a> {
    target: u64,
    progress: &'a Progress<'a>,
}

impl Search<'_> {
    /// The best of `steps` settings (0 the smallest file, `steps - 1` the best picture) whose
    /// encode fits the target; when even step 0 is too big, the same on a smaller picture.
    fn fit(
        &self,
        image: &DynamicImage,
        steps: usize,
        encode_step: &dyn Fn(&DynamicImage, usize) -> Result<Vec<u8>>,
    ) -> Result<Vec<u8>> {
        let fits = |data: &Vec<u8>| data.len() as u64 <= self.target;
        let expected = 2 + steps.next_power_of_two().trailing_zeros() as usize;
        let done = std::cell::Cell::new(0usize);
        let encode = |image: &DynamicImage, step: usize| {
            self.progress.check()?;
            let data = encode_step(image, step)?;
            done.set(done.get() + 1);
            let share = (done.get() as f32 / expected as f32).min(1.0);
            self.progress.report(0.1 + 0.85 * share);
            Ok::<_, Error>(data)
        };

        let (width, height) = image.dimensions();
        let mut factor = 1.0f64;
        let mut smaller: Option<DynamicImage> = None;
        for _ in 0..MAX_ROUNDS {
            let current = smaller.as_ref().unwrap_or(image);
            let best = encode(current, steps - 1)?;
            if fits(&best) {
                return Ok(best);
            }
            let least = if steps > 1 { encode(current, 0)? } else { best };
            if fits(&least) {
                // `low` always fits and `high` is the last step that may.
                let (mut low, mut high, mut found) = (0, steps - 2, least);
                while low < high {
                    let middle = (low + high).div_ceil(2);
                    let data = encode(current, middle)?;
                    if fits(&data) {
                        low = middle;
                        found = data;
                    } else {
                        high = middle - 1;
                    }
                }
                return Ok(found);
            }
            // The file shrinks about as the pixel count does.
            let needed = (self.target as f64 / least.len() as f64).sqrt() * 0.95;
            factor *= needed.clamp(0.5, 0.9);
            let side = |length: u32| (f64::from(length) * factor).round() as u32;
            let (new_width, new_height) = (side(width), side(height));
            if new_width.max(new_height) < MIN_SIDE || new_width.min(new_height) == 0 {
                break;
            }
            tracing::debug!(new_width, new_height, "compress: scaling the picture down");
            smaller = Some(image.resize_exact(new_width, new_height, FilterType::Lanczos3));
        }
        Err(Error::NotSmaller)
    }
}

fn lossy(
    image: &DynamicImage,
    icc: Option<Vec<u8>>,
    to: &str,
    quality: u8,
    base: &Options,
) -> Result<Vec<u8>> {
    let options = Options {
        jpeg_quality: quality,
        webp_quality: quality,
        avif_quality: quality,
        ..base.clone()
    };
    // Compress always writes WEBP lossy: a lossless WEBP has no quality to give up.
    encode::bytes(image, icc, true, to, &options)
}

/// Level 1 → 32 colours, level 99 → 256, evenly in bits per pixel.
fn colours_for_level(level: u8) -> usize {
    let share = f64::from(level.clamp(1, 99) - 1) / 98.0;
    (FEWEST_COLOURS * 8f64.powf(share)).round() as usize
}

fn colours_for_step(step: usize) -> usize {
    let share = step as f64 / (PALETTE_STEPS - 1) as f64;
    (FEWEST_COLOURS * 8f64.powf(share)).round() as usize
}

/// Gray pictures stored as gray, an alpha channel only where something is see-through, and
/// 16 bits only where the picture has them.
fn reduced(image: &DynamicImage) -> DynamicImage {
    let image = match image {
        DynamicImage::ImageRgb32F(_) => DynamicImage::ImageRgb16(image.to_rgb16()),
        DynamicImage::ImageRgba32F(_) => DynamicImage::ImageRgba16(image.to_rgba16()),
        other => other.clone(),
    };
    let image = without_opaque_alpha(image);
    let gray = match &image {
        DynamicImage::ImageRgb8(buffer) => buffer.pixels().all(|p| p[0] == p[1] && p[1] == p[2]),
        DynamicImage::ImageRgba8(buffer) => buffer.pixels().all(|p| p[0] == p[1] && p[1] == p[2]),
        DynamicImage::ImageRgb16(buffer) => buffer.pixels().all(|p| p[0] == p[1] && p[1] == p[2]),
        DynamicImage::ImageRgba16(buffer) => buffer.pixels().all(|p| p[0] == p[1] && p[1] == p[2]),
        _ => false,
    };
    if !gray {
        return image;
    }
    match image {
        DynamicImage::ImageRgb8(_) => DynamicImage::ImageLuma8(image.to_luma8()),
        DynamicImage::ImageRgba8(_) => DynamicImage::ImageLumaA8(image.to_luma_alpha8()),
        DynamicImage::ImageRgb16(_) => DynamicImage::ImageLuma16(image.to_luma16()),
        _ => DynamicImage::ImageLumaA16(image.to_luma_alpha16()),
    }
}

/// The smaller of the strongest deflate and, for 256 colours or fewer, an exact palette.
fn png_lossless(image: &DynamicImage, icc: Option<Vec<u8>>) -> Result<Vec<u8>> {
    let image = reduced(image);
    let mut data = Vec::new();
    let mut encoder =
        PngEncoder::new_with_quality(&mut data, CompressionType::Level(9), PngFilter::Adaptive);
    if let Some(icc) = profile(icc.clone(), is_gray(&image)) {
        let _ = encoder.set_icc_profile(icc);
    }
    encoder
        .write_image(
            image.as_bytes(),
            image.width(),
            image.height(),
            image.color().into(),
        )
        .map_err(|error| Error::Other(format!("PNG encoding failed: {error}")))?;
    match exact_palette(&image, icc) {
        Some(palette) => {
            let palette = palette?;
            Ok(if palette.len() < data.len() {
                palette
            } else {
                data
            })
        }
        None => Ok(data),
    }
}

/// An indexed PNG with the picture's own colours, when there are 256 or fewer of them (8-bit
/// pictures only: deeper ones would lose precision).
fn exact_palette(image: &DynamicImage, icc: Option<Vec<u8>>) -> Option<Result<Vec<u8>>> {
    if !matches!(
        image,
        DynamicImage::ImageLuma8(_)
            | DynamicImage::ImageLumaA8(_)
            | DynamicImage::ImageRgb8(_)
            | DynamicImage::ImageRgba8(_)
    ) {
        return None;
    }
    let rgba = image.to_rgba8();
    let mut colours: HashMap<[u8; 4], u8> = HashMap::new();
    let mut palette = Vec::new();
    let mut indices = Vec::with_capacity(rgba.as_raw().len() / 4);
    for pixel in rgba.pixels() {
        let next = colours.len();
        let index = match colours.get(&pixel.0) {
            Some(&index) => index,
            None if next < 256 => {
                colours.insert(pixel.0, next as u8);
                palette.extend_from_slice(&pixel.0);
                next as u8
            }
            None => return None,
        };
        indices.push(index);
    }
    Some(indexed_png(
        rgba.width(),
        rgba.height(),
        &indices,
        &palette,
        profile(icc, false),
    ))
}

/// A dithered palette of `colours` (NeuQuant), as an indexed PNG.
fn png_palette(image: &DynamicImage, colours: usize, icc: Option<Vec<u8>>) -> Result<Vec<u8>> {
    let mut rgba: RgbaImage = image.to_rgba8();
    let quantizer = NeuQuant::new(NEUQUANT_SAMPLING, colours, rgba.as_raw());
    imageops::dither(&mut rgba, &quantizer);
    let indices = imageops::index_colors(&rgba, &quantizer);
    indexed_png(
        rgba.width(),
        rgba.height(),
        indices.as_raw(),
        &quantizer.color_map_rgba(),
        profile(icc, false),
    )
}

/// Writes indices into an RGBA palette as an indexed PNG of the smallest bit depth that holds
/// them, with transparency only for the entries that need it.
fn indexed_png(
    width: u32,
    height: u32,
    indices: &[u8],
    palette: &[u8],
    icc: Option<Vec<u8>>,
) -> Result<Vec<u8>> {
    let entries = palette.len() / 4;
    let depth = match entries {
        0..=2 => png::BitDepth::One,
        3..=4 => png::BitDepth::Two,
        5..=16 => png::BitDepth::Four,
        _ => png::BitDepth::Eight,
    };
    let bits = depth as usize;
    let row_bytes = (width as usize * bits).div_ceil(8);
    let mut packed = vec![0u8; row_bytes * height as usize];
    for (row, line) in indices.chunks_exact(width as usize).enumerate() {
        let out = &mut packed[row * row_bytes..(row + 1) * row_bytes];
        for (column, &index) in line.iter().enumerate() {
            let bit = column * bits;
            out[bit / 8] |= index << (8 - bits - bit % 8);
        }
    }
    let colours = palette.as_chunks::<4>().0;
    let rgb: Vec<u8> = colours
        .iter()
        .flat_map(|entry| [entry[0], entry[1], entry[2]])
        .collect();
    let alpha: Vec<u8> = colours.iter().map(|entry| entry[3]).collect();
    let see_through = alpha
        .iter()
        .rposition(|&a| a != 255)
        .map_or(0, |last| last + 1);

    let mut info = png::Info::with_size(width, height);
    info.icc_profile = icc.map(Cow::Owned);
    let mut data = Vec::new();
    let mut encoder = png::Encoder::with_info(&mut data, info).map_err(png_error)?;
    encoder.set_color(png::ColorType::Indexed);
    encoder.set_depth(depth);
    encoder.set_palette(rgb);
    if see_through > 0 {
        encoder.set_trns(alpha[..see_through].to_vec());
    }
    encoder.set_deflate_compression(png::DeflateCompression::Level(9));
    // Filters rarely help palette pictures (the PNG specification suggests none for them).
    encoder.set_filter(png::Filter::NoFilter);
    let mut writer = encoder.write_header().map_err(png_error)?;
    writer.write_image_data(&packed).map_err(png_error)?;
    writer.finish().map_err(png_error)?;
    Ok(data)
}

fn png_error(error: png::EncodingError) -> Error {
    Error::Other(format!("PNG encoding failed: {error}"))
}

fn tiff_deflate(image: &DynamicImage, icc: Option<Vec<u8>>) -> Result<Vec<u8>> {
    use tiff::encoder::colortype::{Gray16, Gray8, RGB16, RGB8, RGBA16, RGBA8};
    use tiff::encoder::{Compression as TiffCompression, DeflateLevel, Predictor, TiffEncoder};

    // The TIFF writer has no gray-with-alpha layout, and floats skip the predictor's gain.
    let image = match without_opaque_alpha(image.clone()) {
        image @ DynamicImage::ImageLumaA8(_) => DynamicImage::ImageRgba8(image.to_rgba8()),
        image @ (DynamicImage::ImageLumaA16(_) | DynamicImage::ImageRgba32F(_)) => {
            DynamicImage::ImageRgba16(image.to_rgba16())
        }
        image @ DynamicImage::ImageRgb32F(_) => DynamicImage::ImageRgb16(image.to_rgb16()),
        other => other,
    };
    let icc = profile(icc, is_gray(&image));
    let (width, height) = image.dimensions();
    let mut data = Cursor::new(Vec::new());
    {
        let mut encoder = TiffEncoder::new(&mut data)
            .map_err(tiff_error)?
            .with_compression(TiffCompression::Deflate(DeflateLevel::Best))
            .with_predictor(Predictor::Horizontal);
        macro_rules! put {
            ($layout:ty, $samples:expr) => {{
                let mut out = encoder
                    .new_image::<$layout>(width, height)
                    .map_err(tiff_error)?;
                if let Some(icc) = &icc {
                    out.encoder()
                        .write_tag(tiff::tags::Tag::IccProfile, icc.as_slice())
                        .map_err(tiff_error)?;
                }
                out.write_data($samples).map_err(tiff_error)?;
            }};
        }
        match &image {
            DynamicImage::ImageLuma8(buffer) => put!(Gray8, buffer.as_raw()),
            DynamicImage::ImageRgb8(buffer) => put!(RGB8, buffer.as_raw()),
            DynamicImage::ImageRgba8(buffer) => put!(RGBA8, buffer.as_raw()),
            DynamicImage::ImageLuma16(buffer) => put!(Gray16, buffer.as_raw()),
            DynamicImage::ImageRgb16(buffer) => put!(RGB16, buffer.as_raw()),
            DynamicImage::ImageRgba16(buffer) => put!(RGBA16, buffer.as_raw()),
            other => put!(RGBA8, other.to_rgba8().as_raw()),
        }
    }
    Ok(data.into_inner())
}

fn tiff_error(error: tiff::TiffError) -> Error {
    Error::Other(format!("TIFF encoding failed: {error}"))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use ::image::codecs::jpeg::JpegEncoder;
    use ::image::{ImageFormat, Rgb, RgbImage};

    use super::*;
    use crate::compress::compress;
    use crate::FileKind;

    /// Smooth colour with a little grain, like a photo: lossy encoders have something to give up.
    fn photo(width: u32, height: u32) -> RgbImage {
        let mut seed = 0x2545_F491_4F6C_DD1Du64;
        RgbImage::from_fn(width, height, |x, y| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let grain = (seed % 25) as i32 - 12;
            let shade = |value: u32| (value as i32 + grain).clamp(0, 255) as u8;
            Rgb([
                shade(x * 255 / width),
                shade(y * 255 / height),
                shade((x + y) * 128 / (width + height) + 64),
            ])
        })
    }

    /// A temporary folder named with Turkish letters and an emoji.
    struct Bench {
        _root: tempfile::TempDir,
        folder: PathBuf,
    }

    impl Bench {
        fn new() -> Self {
            let root = tempfile::tempdir().unwrap();
            let folder = root.path().join("Kento ğüşıöç 🧪");
            fs::create_dir(&folder).unwrap();
            Bench {
                _root: root,
                folder,
            }
        }

        fn save(&self, name: &str, image: &DynamicImage) -> PathBuf {
            let path = self.folder.join(name);
            image
                .save_with_format(&path, ImageFormat::from_path(&path).unwrap())
                .unwrap();
            path
        }

        fn jpeg(&self, name: &str, image: &RgbImage, quality: u8) -> PathBuf {
            let path = self.folder.join(name);
            let mut data = Vec::new();
            JpegEncoder::new_with_quality(&mut data, quality)
                .write_image(
                    image.as_raw(),
                    image.width(),
                    image.height(),
                    ::image::ExtendedColorType::Rgb8,
                )
                .unwrap();
            fs::write(&path, data).unwrap();
            path
        }
    }

    fn compress_with(
        input: &Path,
        from: &str,
        compression: Compression,
        progress: &Progress,
    ) -> Result<PathBuf> {
        let name = input.file_stem().unwrap().to_string_lossy();
        let extension = input.extension().unwrap().to_string_lossy();
        let dest = input.with_file_name(format!("{name} - compressed.{extension}"));
        let options = Options::default();
        let written = compress(&CompressRun {
            input,
            from,
            kind: FileKind::Image,
            compression,
            dest: &dest,
            temp: input.parent().unwrap(),
            options: &options,
            progress,
        })?;
        assert_eq!(written, vec![dest.clone()]);
        Ok(dest)
    }

    fn squeeze(input: &Path, from: &str, compression: Compression) -> Result<PathBuf> {
        compress_with(input, from, compression, &Progress::none())
    }

    fn len(path: &Path) -> u64 {
        fs::metadata(path).unwrap().len()
    }

    fn read(path: &Path, from: &str) -> DynamicImage {
        crate::image::decode(path, from, &Options::default()).unwrap()
    }

    /// The colour type byte of a PNG's header: 3 is a palette.
    fn png_colour_type(path: &Path) -> u8 {
        fs::read(path).unwrap()[25]
    }

    #[test]
    fn targets() {
        assert_eq!(
            target(Compression::Quality { level: 50 }, 1000).unwrap(),
            999
        );
        assert_eq!(
            target(Compression::Ratio { percent: 40 }, 1000).unwrap(),
            400
        );
        assert_eq!(target(Compression::Ratio { percent: 1 }, 1000).unwrap(), 50);
        assert_eq!(
            target(Compression::Ratio { percent: 100 }, 1000).unwrap(),
            950
        );
        assert_eq!(target(Compression::Size { bytes: 300 }, 1000).unwrap(), 300);
        // Under 25 MB for a 1 kB file still means smaller than the original.
        assert_eq!(
            target(Compression::Size { bytes: 25 << 20 }, 1000).unwrap(),
            999
        );
        assert!(matches!(
            target(Compression::Size { bytes: 0 }, 1000),
            Err(Error::NotSmaller)
        ));
        assert_eq!(colours_for_level(1), 32);
        assert_eq!(colours_for_level(99), 256);
        assert_eq!(colours_for_level(100), 256);
        assert_eq!(colours_for_step(0), 32);
        assert_eq!(colours_for_step(PALETTE_STEPS - 1), 256);
    }

    #[test]
    fn jpeg_by_quality_ratio_and_size() {
        let bench = Bench::new();
        let input = bench.jpeg("fotoğraf 🧪.jpg", &photo(320, 240), 95);
        let original = len(&input);

        let dest = squeeze(&input, "jpg", Compression::Quality { level: 40 }).unwrap();
        assert!(len(&dest) < original);
        assert_eq!(&fs::read(&dest).unwrap()[..2], &[0xFF, 0xD8]);
        assert_eq!(read(&dest, "jpg").dimensions(), (320, 240));
        fs::remove_file(&dest).unwrap();

        let dest = squeeze(&input, "jpg", Compression::Ratio { percent: 40 }).unwrap();
        assert!(
            len(&dest) <= original * 40 / 100,
            "{} of {original}",
            len(&dest)
        );
        assert_eq!(read(&dest, "jpg").dimensions(), (320, 240));
        fs::remove_file(&dest).unwrap();

        // Too small for any quality: the picture is scaled down, its shape kept.
        let dest = squeeze(&input, "jpg", Compression::Size { bytes: 2500 }).unwrap();
        assert!(len(&dest) <= 2500, "{}", len(&dest));
        let (width, height) = read(&dest, "jpg").dimensions();
        assert!(width < 320 && height < 240);
        let shape = f64::from(width) / f64::from(height);
        assert!((shape - 4.0 / 3.0).abs() < 0.05, "{width}×{height}");
    }

    #[test]
    fn nothing_is_written_when_nothing_smaller_comes_out() {
        let bench = Bench::new();
        let input = bench.jpeg("küçük 🧪.jpg", &photo(64, 48), 10);
        let dest = bench.folder.join("küçük 🧪 - compressed.jpg");
        let result = squeeze(&input, "jpg", Compression::Quality { level: 100 });
        assert!(matches!(result, Err(Error::NotSmaller)), "{result:?}");
        assert!(!dest.exists());
        let result = squeeze(&input, "jpg", Compression::Size { bytes: 10 });
        assert!(matches!(result, Err(Error::NotSmaller)), "{result:?}");
        assert!(!dest.exists());
    }

    #[test]
    fn png_palette_and_lossless() {
        let bench = Bench::new();
        let picture = DynamicImage::ImageRgb8(photo(240, 180));
        let input = bench.save("ekran 🧪.png", &picture);
        let original = len(&input);

        let dest = squeeze(&input, "png", Compression::Quality { level: 100 }).unwrap();
        assert!(len(&dest) < original);
        assert_eq!(read(&dest, "png").to_rgb8(), picture.to_rgb8(), "lossless");
        fs::remove_file(&dest).unwrap();

        let dest = squeeze(&input, "png", Compression::Quality { level: 60 }).unwrap();
        assert!(len(&dest) < original);
        assert_eq!(png_colour_type(&dest), 3, "a palette");
        let out = read(&dest, "png").to_rgb8();
        assert_eq!(out.dimensions(), (240, 180));
        let near = |x: u32, y: u32| {
            let (a, b) = (
                out.get_pixel(x, y),
                picture.to_rgb8().get_pixel(x, y).to_owned(),
            );
            (0..3).all(|c| a[c].abs_diff(b[c]) < 60)
        };
        assert!(near(120, 90) && near(10, 10) && near(230, 170));
        fs::remove_file(&dest).unwrap();

        let dest = squeeze(&input, "png", Compression::Ratio { percent: 50 }).unwrap();
        assert!(len(&dest) <= original / 2);
    }

    #[test]
    fn png_with_few_colours_stays_exact() {
        let bench = Bench::new();
        let picture = DynamicImage::ImageRgb8(RgbImage::from_fn(64, 48, |x, y| {
            Rgb(match (x < 32, y < 24) {
                (true, true) => [230, 30, 30],
                (false, true) => [30, 200, 60],
                (true, false) => [30, 60, 220],
                (false, false) => [255, 255, 255],
            })
        }));
        let input = bench.save("dört renk 🧪.png", &picture);
        let dest = squeeze(&input, "png", Compression::Quality { level: 30 }).unwrap();
        assert_eq!(png_colour_type(&dest), 3);
        assert_eq!(read(&dest, "png").to_rgb8(), picture.to_rgb8());

        // Gray pictures are stored as gray (or as a palette of grays), without loss.
        let gray = DynamicImage::ImageRgb8(RgbImage::from_fn(200, 100, |x, y| {
            Rgb([((x * 7 + y * 13) % 256) as u8; 3])
        }));
        let input = bench.save("gri 🧪.png", &gray);
        let dest = squeeze(&input, "png", Compression::Quality { level: 100 }).unwrap();
        assert!([0, 3].contains(&png_colour_type(&dest)));
        assert_eq!(read(&dest, "png").to_rgb8(), gray.to_rgb8());
    }

    #[test]
    fn tiff_is_deflated_without_loss() {
        let bench = Bench::new();
        let picture = DynamicImage::ImageRgb8(photo(160, 120));
        let input = bench.save("tarama 🧪.tiff", &picture);
        let dest = squeeze(&input, "tiff", Compression::Quality { level: 50 }).unwrap();
        assert!(len(&dest) < len(&input));
        assert_eq!(read(&dest, "tiff").to_rgb8(), picture.to_rgb8());
    }

    #[test]
    fn webp_and_avif_by_quality() {
        let bench = Bench::new();
        let picture = DynamicImage::ImageRgb8(photo(160, 120));
        let webp = bench.save("ağ 🧪.webp", &picture);
        let dest = squeeze(&webp, "webp", Compression::Quality { level: 50 }).unwrap();
        assert!(len(&dest) < len(&webp));
        assert_eq!(read(&dest, "webp").dimensions(), (160, 120));

        let avif = bench.folder.join("av1 🧪.avif");
        let pixels: Vec<ravif::RGB8> = photo(96, 72)
            .pixels()
            .map(|p| ravif::RGB8::new(p[0], p[1], p[2]))
            .collect();
        let encoded = ravif::Encoder::new()
            .with_quality(95.0)
            .with_speed(10)
            .encode_rgb(ravif::Img::new(&pixels[..], 96, 72))
            .unwrap();
        fs::write(&avif, encoded.avif_file).unwrap();
        let dest = squeeze(&avif, "avif", Compression::Quality { level: 30 }).unwrap();
        assert!(len(&dest) < len(&avif));
        assert_eq!(read(&dest, "avif").dimensions(), (96, 72));
    }

    #[test]
    fn other_formats_are_not_compressed() {
        let bench = Bench::new();
        let bmp = bench.save("eski 🧪.bmp", &DynamicImage::ImageRgb8(photo(32, 32)));
        for from in ["bmp", "gif", "ico", "svg"] {
            let result = squeeze(&bmp, from, Compression::Quality { level: 50 });
            assert!(matches!(result, Err(Error::Unsupported { .. })), "{from}");
        }
        if !heic_write_available() {
            let result = squeeze(&bmp, "heic", Compression::Quality { level: 50 });
            assert!(matches!(result, Err(Error::Unsupported { .. })));
        }
    }

    #[test]
    fn cancelling_and_progress() {
        let bench = Bench::new();
        let input = bench.jpeg("iptal 🧪.jpg", &photo(160, 120), 95);
        let cancelled = Progress::new(&|_| {}, &|| true);
        let result = compress_with(
            &input,
            "jpg",
            Compression::Ratio { percent: 50 },
            &cancelled,
        );
        assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");

        use std::sync::Mutex;
        let seen = Mutex::new(Vec::new());
        let report = |fraction: Option<f32>| seen.lock().unwrap().push(fraction.unwrap_or(-1.0));
        let progress = Progress::new(&report, &|| false);
        compress_with(&input, "jpg", Compression::Ratio { percent: 50 }, &progress).unwrap();
        let seen = seen.into_inner().unwrap();
        assert_eq!(seen.last(), Some(&1.0));
        assert!(seen.windows(2).all(|pair| pair[0] <= pair[1]), "{seen:?}");
    }
}
