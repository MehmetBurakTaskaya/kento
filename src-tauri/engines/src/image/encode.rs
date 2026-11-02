// SPDX-License-Identifier: MIT
//! Writing pixels to every image output.

use std::fs::{self, File};
use std::io::BufWriter;
use std::path::Path;

use ::image::codecs::bmp::BmpEncoder;
use ::image::codecs::gif::GifEncoder;
use ::image::codecs::ico::{IcoEncoder, IcoFrame};
use ::image::codecs::jpeg::JpegEncoder;
use ::image::codecs::png::PngEncoder;
use ::image::codecs::tiff::TiffEncoder;
use ::image::imageops::{self, FilterType};
use ::image::{
    ColorType, DynamicImage, ExtendedColorType, GenericImageView, ImageEncoder, ImageError,
    RgbImage, RgbaImage,
};

use super::decode::Decoded;
use crate::{Error, Options, Result};

/// libwebp's limit for either side.
const WEBP_MAX_SIDE: u32 = 16_383;
/// ICO entries store their size in one byte, 0 meaning 256.
const ICO_MAX_SIDE: u32 = 256;

pub(super) fn write(decoded: Decoded, to: &str, options: &Options, dest: &Path) -> Result<()> {
    let Decoded {
        image, icc, lossy, ..
    } = decoded;
    match to {
        "jpg" | "webp" | "avif" | "heic" => {
            fs::write(dest, bytes(&image, icc, lossy, to, options)?)?;
            Ok(())
        }
        "png" => png(image, icc, dest),
        "bmp" => bmp(&image, options, dest),
        "tiff" => tiff(image, icc, dest),
        "gif" => gif(&image, dest),
        "ico" => ico(&image, &options.ico_sizes, dest),
        other => Err(Error::Other(format!("no image writer for {other}"))),
    }
}

/// The formats with a quality setting, encoded in memory: Compress searches the quality on these.
pub(super) fn bytes(
    image: &DynamicImage,
    icc: Option<Vec<u8>>,
    lossy: bool,
    to: &str,
    options: &Options,
) -> Result<Vec<u8>> {
    match to {
        "jpg" => jpeg(image, icc, options),
        "webp" => webp(image, icc, lossy, options),
        "avif" => avif(image, options),
        "heic" => heic(image, icc, options),
        other => Err(Error::Other(format!(
            "no in-memory image writer for {other}"
        ))),
    }
}

fn encode_error(error: ImageError) -> Error {
    match error {
        ImageError::Limits(error) => Error::Limit(error.to_string()),
        ImageError::IoError(error) => Error::Io(error),
        other => Error::Other(other.to_string()),
    }
}

fn create(dest: &Path) -> Result<BufWriter<File>> {
    Ok(BufWriter::new(File::create(dest)?))
}

fn finish(out: BufWriter<File>) -> Result<()> {
    out.into_inner().map_err(|error| error.into_error())?;
    Ok(())
}

pub(super) fn is_gray(image: &DynamicImage) -> bool {
    matches!(
        image.color(),
        ColorType::L8 | ColorType::L16 | ColorType::La8 | ColorType::La16
    )
}

fn is_opaque(image: &DynamicImage) -> bool {
    match image {
        DynamicImage::ImageLumaA8(buffer) => buffer.pixels().all(|p| p[1] == u8::MAX),
        DynamicImage::ImageRgba8(buffer) => buffer.pixels().all(|p| p[3] == u8::MAX),
        DynamicImage::ImageLumaA16(buffer) => buffer.pixels().all(|p| p[1] == u16::MAX),
        DynamicImage::ImageRgba16(buffer) => buffer.pixels().all(|p| p[3] == u16::MAX),
        DynamicImage::ImageRgba32F(buffer) => buffer.pixels().all(|p| p[3] >= 1.0),
        _ => true,
    }
}

/// An alpha channel in which every pixel is opaque only costs space.
pub(super) fn without_opaque_alpha(image: DynamicImage) -> DynamicImage {
    if !image.has_alpha() || !is_opaque(&image) {
        return image;
    }
    match image {
        DynamicImage::ImageLumaA8(_) => DynamicImage::ImageLuma8(image.to_luma8()),
        DynamicImage::ImageLumaA16(_) => DynamicImage::ImageLuma16(image.to_luma16()),
        DynamicImage::ImageRgba16(_) => DynamicImage::ImageRgb16(image.to_rgb16()),
        DynamicImage::ImageRgba32F(_) => DynamicImage::ImageRgb32F(image.to_rgb32f()),
        _ => DynamicImage::ImageRgb8(image.to_rgb8()),
    }
}

/// For outputs without alpha: transparent pixels are composited onto the background, and
/// everything becomes 8-bit RGB (or gray when the source is gray and opaque).
fn flatten(image: &DynamicImage, background: [u8; 3]) -> DynamicImage {
    if !image.has_alpha() || is_opaque(image) {
        return if is_gray(image) {
            DynamicImage::ImageLuma8(image.to_luma8())
        } else {
            DynamicImage::ImageRgb8(image.to_rgb8())
        };
    }
    let rgba = image.to_rgba8();
    let mut out = RgbImage::new(rgba.width(), rgba.height());
    for (source, target) in rgba.pixels().zip(out.pixels_mut()) {
        let alpha = u32::from(source[3]);
        for channel in 0..3 {
            let over = u32::from(source[channel]) * alpha;
            let under = u32::from(background[channel]) * (255 - alpha);
            target[channel] = ((over + under + 127) / 255) as u8;
        }
    }
    DynamicImage::ImageRgb8(out)
}

/// A profile is kept only when it describes the channels written (RGB or gray); a CMYK JPEG's
/// profile, for one, no longer fits its RGB pixels.
pub(super) fn profile(icc: Option<Vec<u8>>, gray: bool) -> Option<Vec<u8>> {
    let icc = icc?;
    let wanted: &[u8] = if gray { b"GRAY" } else { b"RGB " };
    (icc.len() >= 128 && icc.get(16..20) == Some(wanted)).then_some(icc)
}

fn jpeg(image: &DynamicImage, icc: Option<Vec<u8>>, options: &Options) -> Result<Vec<u8>> {
    let flat = flatten(image, options.background);
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, options.jpeg_quality.clamp(1, 100));
    if let Some(icc) = profile(icc, is_gray(&flat)) {
        // Encoders that cannot embed a profile still write the pixels.
        let _ = encoder.set_icc_profile(icc);
    }
    let (width, height) = flat.dimensions();
    encoder
        .write_image(flat.as_bytes(), width, height, flat.color().into())
        .map_err(encode_error)?;
    Ok(out)
}

fn png(image: DynamicImage, icc: Option<Vec<u8>>, dest: &Path) -> Result<()> {
    let image = match image {
        DynamicImage::ImageRgb32F(_) => DynamicImage::ImageRgb16(image.to_rgb16()),
        DynamicImage::ImageRgba32F(_) => DynamicImage::ImageRgba16(image.to_rgba16()),
        other => other,
    };
    let image = without_opaque_alpha(image);
    let mut out = create(dest)?;
    let mut encoder = PngEncoder::new(&mut out);
    if let Some(icc) = profile(icc, is_gray(&image)) {
        let _ = encoder.set_icc_profile(icc);
    }
    let (width, height) = image.dimensions();
    encoder
        .write_image(image.as_bytes(), width, height, image.color().into())
        .map_err(encode_error)?;
    finish(out)
}

fn webp(
    image: &DynamicImage,
    icc: Option<Vec<u8>>,
    lossy: bool,
    options: &Options,
) -> Result<Vec<u8>> {
    let (width, height) = image.dimensions();
    if width > WEBP_MAX_SIDE || height > WEBP_MAX_SIDE {
        return Err(Error::Limit(format!(
            "WEBP holds at most {WEBP_MAX_SIDE}×{WEBP_MAX_SIDE} pixels; this image is {width}×{height}"
        )));
    }
    let alpha = image.has_alpha() && !is_opaque(image);
    let (pixels, layout) = if alpha {
        (image.to_rgba8().into_raw(), webp::PixelLayout::Rgba)
    } else {
        (image.to_rgb8().into_raw(), webp::PixelLayout::Rgb)
    };
    let mut config =
        webp::WebPConfig::new().map_err(|()| Error::Other("libwebp could not be set up".into()))?;
    config.lossless = i32::from(!lossy);
    if lossy {
        config.quality = f32::from(options.webp_quality.clamp(1, 100));
    }
    let encoded = webp::Encoder::new(&pixels, layout, width, height)
        .encode_advanced(&config)
        .map_err(|error| Error::Other(format!("WEBP encoding failed: {error:?}")))?;
    Ok(match profile(icc, false) {
        Some(icc) => with_icc_profile(&encoded, &icc, width, height, alpha),
        None => encoded.to_vec(),
    })
}

/// libwebp's simple API writes no colour profile, so the file is rebuilt as an extended WEBP:
/// `VP8X` with the ICC flag, then `ICCP`, then the encoder's own chunks.
fn with_icc_profile(encoded: &[u8], icc: &[u8], width: u32, height: u32, alpha: bool) -> Vec<u8> {
    let mut chunks = Vec::new();
    let mut rest = encoded.get(12..).unwrap_or_default();
    while rest.len() >= 8 {
        let size = u32::from_le_bytes([rest[4], rest[5], rest[6], rest[7]]) as usize;
        let Some(payload) = rest.get(8..8 + size) else {
            return encoded.to_vec();
        };
        chunks.push((&rest[0..4], payload));
        rest = rest.get(8 + size + (size & 1)..).unwrap_or_default();
    }
    let mut header = vec![if alpha { 0x30 } else { 0x20 }, 0, 0, 0];
    header.extend_from_slice(&(width - 1).to_le_bytes()[..3]);
    header.extend_from_slice(&(height - 1).to_le_bytes()[..3]);

    let mut body = b"WEBP".to_vec();
    push_chunk(&mut body, b"VP8X", &header);
    push_chunk(&mut body, b"ICCP", icc);
    for (kind, payload) in chunks {
        if kind != b"VP8X" {
            push_chunk(&mut body, kind, payload);
        }
    }
    let mut file = b"RIFF".to_vec();
    file.extend_from_slice(&(body.len() as u32).to_le_bytes());
    file.extend_from_slice(&body);
    file
}

fn push_chunk(out: &mut Vec<u8>, kind: &[u8], payload: &[u8]) {
    out.extend_from_slice(kind);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    if payload.len() % 2 == 1 {
        out.push(0);
    }
}

fn avif(image: &DynamicImage, options: &Options) -> Result<Vec<u8>> {
    let (width, height) = (image.width() as usize, image.height() as usize);
    let quality = f32::from(options.avif_quality.clamp(1, 100));
    let encoder = ravif::Encoder::new()
        .with_quality(quality)
        .with_alpha_quality(quality)
        .with_speed(options.avif_speed.clamp(1, 10));
    let encoded = if image.has_alpha() && !is_opaque(image) {
        let pixels: Vec<ravif::RGBA8> = image
            .to_rgba8()
            .pixels()
            .map(|p| ravif::RGBA8::new(p[0], p[1], p[2], p[3]))
            .collect();
        encoder.encode_rgba(ravif::Img::new(&pixels[..], width, height))
    } else {
        let pixels: Vec<ravif::RGB8> = image
            .to_rgb8()
            .pixels()
            .map(|p| ravif::RGB8::new(p[0], p[1], p[2]))
            .collect();
        encoder.encode_rgb(ravif::Img::new(&pixels[..], width, height))
    }
    .map_err(|error| Error::Other(format!("AVIF encoding failed: {error}")))?;
    Ok(encoded.avif_file)
}

fn bmp(image: &DynamicImage, options: &Options, dest: &Path) -> Result<()> {
    let flat = flatten(image, options.background);
    let (width, height) = flat.dimensions();
    let mut out = create(dest)?;
    BmpEncoder::new(&mut out)
        .encode(flat.as_bytes(), width, height, flat.color().into())
        .map_err(encode_error)?;
    finish(out)
}

fn tiff(image: DynamicImage, icc: Option<Vec<u8>>, dest: &Path) -> Result<()> {
    // The TIFF writer has no gray-with-alpha layout.
    let image = match without_opaque_alpha(image) {
        image @ DynamicImage::ImageLumaA8(_) => DynamicImage::ImageRgba8(image.to_rgba8()),
        image @ DynamicImage::ImageLumaA16(_) => DynamicImage::ImageRgba16(image.to_rgba16()),
        other => other,
    };
    let (width, height) = image.dimensions();
    let mut out = create(dest)?;
    let mut encoder = TiffEncoder::new(&mut out);
    if let Some(icc) = profile(icc, is_gray(&image)) {
        let _ = encoder.set_icc_profile(icc);
    }
    encoder
        .write_image(image.as_bytes(), width, height, image.color().into())
        .map_err(encode_error)?;
    finish(out)
}

fn gif(image: &DynamicImage, dest: &Path) -> Result<()> {
    let rgba = image.to_rgba8();
    let mut out = create(dest)?;
    {
        // Speed 10 of 30: the palette search stays quick on photos at little cost in quality.
        let mut encoder = GifEncoder::new_with_speed(&mut out, 10);
        encoder
            .encode(
                rgba.as_raw(),
                rgba.width(),
                rgba.height(),
                ExtendedColorType::Rgba8,
            )
            .map_err(encode_error)?;
        // The encoder writes the GIF trailer when it is dropped, here.
    }
    finish(out)
}

/// The icon sizes to write: requested sizes up to 256, without stretching a small source more
/// than twice; never empty, as the source's own size is kept as a last resort.
pub(super) fn icon_sizes(wanted: &[u32], width: u32, height: u32) -> Vec<u32> {
    let side = width.max(height);
    let mut sizes: Vec<u32> = wanted
        .iter()
        .copied()
        .filter(|&size| (1..=ICO_MAX_SIDE).contains(&size) && size <= side.saturating_mul(2))
        .collect();
    sizes.sort_unstable();
    sizes.dedup();
    if sizes.is_empty() {
        sizes.push(side.clamp(1, ICO_MAX_SIDE));
    }
    sizes
}

fn ico(image: &DynamicImage, wanted: &[u32], dest: &Path) -> Result<()> {
    let (width, height) = image.dimensions();
    let sizes = icon_sizes(wanted, width, height);
    // Every size comes from one moderate copy rather than from a huge photo each time.
    let base = if width.max(height) > 1024 {
        image.resize(1024, 1024, FilterType::Lanczos3)
    } else {
        image.clone()
    };
    let frames = sizes
        .iter()
        .map(|&size| {
            let square = square_icon(&base, size);
            IcoFrame::as_png(square.as_raw(), size, size, ExtendedColorType::Rgba8)
        })
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(encode_error)?;
    let mut out = create(dest)?;
    IcoEncoder::new(&mut out)
        .encode_images(&frames)
        .map_err(encode_error)?;
    finish(out)
}

/// The image fitted into a transparent square, centred.
fn square_icon(image: &DynamicImage, size: u32) -> RgbaImage {
    let (width, height) = image.dimensions();
    let scale = f64::from(size) / f64::from(width.max(height));
    let fit = |length: u32| ((f64::from(length) * scale).round() as u32).clamp(1, size);
    let (fitted_width, fitted_height) = (fit(width), fit(height));
    let fitted = image
        .resize_exact(fitted_width, fitted_height, FilterType::Lanczos3)
        .to_rgba8();
    let mut canvas = RgbaImage::new(size, size);
    let x = i64::from((size - fitted_width) / 2);
    let y = i64::from((size - fitted_height) / 2);
    imageops::replace(&mut canvas, &fitted, x, y);
    canvas
}

/// HEIC is written without alpha: the system encoders differ in how they treat it.
fn heic(image: &DynamicImage, icc: Option<Vec<u8>>, options: &Options) -> Result<Vec<u8>> {
    let flat = flatten(image, options.background).to_rgb8();
    let icc = profile(icc, false);
    let quality = f32::from(options.jpeg_quality.clamp(1, 100)) / 100.0;
    heic_bytes(&flat, icc.as_deref(), quality)
}

#[cfg(windows)]
fn heic_bytes(image: &RgbImage, icc: Option<&[u8]>, quality: f32) -> Result<Vec<u8>> {
    super::heif_windows::encode(image, icc, quality)
}

#[cfg(target_os = "macos")]
fn heic_bytes(image: &RgbImage, icc: Option<&[u8]>, quality: f32) -> Result<Vec<u8>> {
    super::heif_macos::encode(image, icc, quality)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn heic_bytes(_image: &RgbImage, _icc: Option<&[u8]>, _quality: f32) -> Result<Vec<u8>> {
    Err(Error::MissingCodec(crate::Codec::Heif))
}
