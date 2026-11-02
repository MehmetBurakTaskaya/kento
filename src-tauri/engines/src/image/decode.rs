// SPDX-License-Identifier: MIT
//! Reading every image input into upright pixels.

use std::fs::File;
use std::io::{self, BufRead, BufReader, Cursor, Read, Seek, SeekFrom};
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;

use ::image::metadata::Orientation;
use ::image::{
    DynamicImage, ExtendedColorType, ImageDecoder, ImageError, ImageFormat, ImageReader, Limits,
};

use super::{avif, check_size, svg, MAX_ALLOC, MAX_SIDE};
use crate::{Codec, Error, Options, Result};

pub(super) struct Decoded {
    pub image: DynamicImage,
    /// The embedded colour profile, kept by the outputs that can carry one.
    pub icc: Option<Vec<u8>>,
    /// The source was lossy (JPEG, HEIC, AVIF, lossy WEBP), so WEBP output stays lossy too.
    pub lossy: bool,
    /// An upright RGB or gray JPEG that can go into a PDF without re-encoding.
    pub jpeg_as_is: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Raster(ImageFormat),
    Svg,
    Avif,
    Heic,
}

pub(super) fn load(path: &Path, from: &str, options: &Options) -> Result<Decoded> {
    let kind = sniff(path, from)?;
    tracing::debug!(from, ?kind, "decoding an image");
    // Damaged files should come back as errors, but some parsers assert instead (avif-parse does
    // in debug builds). Where panics unwind, that still ends as an unreadable file.
    panic::catch_unwind(AssertUnwindSafe(|| match kind {
        Kind::Raster(format) => raster(path, format),
        Kind::Svg => svg::decode(path),
        Kind::Avif => avif::decode(path),
        Kind::Heic => heic(path, options),
    }))
    .unwrap_or_else(|_| Err(Error::Unreadable("the decoder stopped on this file".into())))
}

/// The upright size. Raster formats are read only as far as their header; the others are decoded.
pub(super) fn size(path: &Path, from: &str, options: &Options) -> Result<[u32; 2]> {
    let Kind::Raster(format) = sniff(path, from)? else {
        let image = load(path, from, options)?.image;
        return Ok([image.width(), image.height()]);
    };
    panic::catch_unwind(AssertUnwindSafe(|| {
        let mut reader = ImageReader::with_format(BufReader::new(File::open(path)?), format);
        reader.limits(limits());
        let mut decoder = reader.into_decoder().map_err(read_error)?;
        let (width, height) = decoder.dimensions();
        check_size(width, height)?;
        let turned = matches!(
            decoder.orientation().unwrap_or(Orientation::NoTransforms),
            Orientation::Rotate90
                | Orientation::Rotate270
                | Orientation::Rotate90FlipH
                | Orientation::Rotate270FlipH
        );
        Ok(if turned {
            [height, width]
        } else {
            [width, height]
        })
    }))
    .unwrap_or_else(|_| Err(Error::Unreadable("the decoder stopped on this file".into())))
}

/// The content decides, not the extension: phones and websites often save one format under
/// another's name.
fn sniff(path: &Path, from: &str) -> Result<Kind> {
    let mut head = Vec::with_capacity(64);
    File::open(path)?.take(64).read_to_end(&mut head)?;
    if let Some(kind) = iso_brand(&head) {
        return Ok(kind);
    }
    if let Ok(format) = ::image::guess_format(&head) {
        match format {
            ImageFormat::Png
            | ImageFormat::Jpeg
            | ImageFormat::Gif
            | ImageFormat::Bmp
            | ImageFormat::Tiff
            | ImageFormat::WebP => return Ok(Kind::Raster(format)),
            ImageFormat::Avif => return Ok(Kind::Avif),
            _ => {}
        }
    }
    Ok(match from {
        "svg" => Kind::Svg,
        "avif" => Kind::Avif,
        "heic" => Kind::Heic,
        other => Kind::Raster(
            ImageFormat::from_extension(other)
                .ok_or_else(|| Error::Unreadable(format!("not a {other} image")))?,
        ),
    })
}

/// AVIF and HEIC share the ISO base media container; its `ftyp` brands tell them apart.
fn iso_brand(head: &[u8]) -> Option<Kind> {
    if head.len() < 16 || &head[4..8] != b"ftyp" {
        return None;
    }
    let size = u32::from_be_bytes(head[0..4].try_into().ok()?) as usize;
    let size = size.clamp(16, head.len());
    let brands: Vec<&[u8]> = std::iter::once(&head[8..12])
        .chain(
            head[16..size]
                .as_chunks::<4>()
                .0
                .iter()
                .map(|brand| brand.as_slice()),
        )
        .collect();
    if brands
        .iter()
        .any(|brand| *brand == b"avif" || *brand == b"avis")
    {
        return Some(Kind::Avif);
    }
    const HEIF: [&[u8]; 8] = [
        b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1",
    ];
    brands
        .iter()
        .any(|brand| HEIF.contains(brand))
        .then_some(Kind::Heic)
}

fn raster(path: &Path, format: ImageFormat) -> Result<Decoded> {
    let lossy = match format {
        ImageFormat::Jpeg => true,
        ImageFormat::WebP => webp_is_lossy(path)?,
        _ => false,
    };
    pixels(BufReader::new(File::open(path)?), format, lossy)
}

fn pixels(source: impl BufRead + Seek, format: ImageFormat, lossy: bool) -> Result<Decoded> {
    let mut reader = ImageReader::with_format(source, format);
    reader.limits(limits());
    let mut decoder = reader.into_decoder().map_err(read_error)?;
    let (width, height) = decoder.dimensions();
    check_size(width, height)?;
    if decoder.total_bytes() > MAX_ALLOC {
        return Err(Error::Limit(format!("an image of {width}×{height} pixels")));
    }
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let icc = decoder.icc_profile().ok().flatten();
    let original = decoder.original_color_type();
    let mut image = DynamicImage::from_decoder(decoder).map_err(read_error)?;
    let upright = orientation == Orientation::NoTransforms;
    image.apply_orientation(orientation);
    Ok(Decoded {
        image,
        icc,
        lossy,
        jpeg_as_is: format == ImageFormat::Jpeg
            && upright
            && matches!(original, ExtendedColorType::Rgb8 | ExtendedColorType::L8),
    })
}

fn limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_ALLOC);
    limits
}

fn read_error(error: ImageError) -> Error {
    match error {
        ImageError::Limits(error) => Error::Limit(error.to_string()),
        ImageError::IoError(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
            Error::Unreadable(error.to_string())
        }
        ImageError::IoError(error) => Error::Io(error),
        other => Error::Unreadable(other.to_string()),
    }
}

/// Walks the RIFF chunks to the first bitstream: `VP8 ` is lossy, `VP8L` lossless.
fn webp_is_lossy(path: &Path) -> Result<bool> {
    let mut file = File::open(path)?;
    let mut header = [0u8; 12];
    if file.read_exact(&mut header).is_err()
        || &header[0..4] != b"RIFF"
        || &header[8..12] != b"WEBP"
    {
        return Ok(false);
    }
    let mut offset = 12u64;
    for _ in 0..64 {
        let mut chunk = [0u8; 8];
        file.seek(SeekFrom::Start(offset))?;
        if file.read_exact(&mut chunk).is_err() {
            break;
        }
        let size = u64::from(u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]));
        match &chunk[0..4] {
            b"VP8 " => return Ok(true),
            b"VP8L" => return Ok(false),
            // An animation frame: 16 bytes of placement, then the frame's own chunks.
            b"ANMF" => offset += 8 + 16,
            _ => offset += 8 + size + (size & 1),
        }
    }
    Ok(false)
}

/// The system's HEIF decoder first. Where it is missing (Windows without the HEIF Image
/// Extensions), FFmpeg reads the photo when the media tools are there.
fn heic(path: &Path, options: &Options) -> Result<Decoded> {
    match system_heic(path) {
        Err(Error::MissingCodec(Codec::Heif)) if options.tools.ffmpeg.is_some() => {
            let png = crate::media::still(&options.tools, path)?;
            pixels(Cursor::new(png), ImageFormat::Png, true)
        }
        other => other,
    }
}

#[cfg(windows)]
fn system_heic(path: &Path) -> Result<Decoded> {
    super::heif_windows::decode(path)
}

#[cfg(target_os = "macos")]
fn system_heic(path: &Path) -> Result<Decoded> {
    super::heif_macos::decode(path)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn system_heic(_path: &Path) -> Result<Decoded> {
    Err(Error::MissingCodec(Codec::Heif))
}
