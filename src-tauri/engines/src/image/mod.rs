// SPDX-License-Identifier: MIT
//! Image conversions (SPEC 5.4): every image input to every image output, and image → PDF.

mod avif;
pub(crate) mod compress;
mod decode;
mod encode;
#[cfg(target_os = "macos")]
mod heif_macos;
#[cfg(windows)]
mod heif_windows;
mod svg;
#[cfg(test)]
mod tests;
pub mod tools;

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::pdf::{self, PageImage, PageLayout};
use crate::{Conversion, Error, Options, Output, Result};

/// The system's fonts, loaded once; burned-in subtitles take theirs from here too.
pub(crate) use svg::fonts as system_fonts;

const INPUTS: &[&str] = &[
    "avif", "bmp", "gif", "heic", "jpg", "png", "svg", "tiff", "webp",
];
const OUTPUTS: &[&str] = &[
    "jpg", "png", "webp", "avif", "bmp", "tiff", "gif", "pdf", "ico",
];

// A small file can claim a huge canvas; decoding stops above these.
const MAX_SIDE: u32 = 65_535;
const MAX_PIXELS: u64 = 1 << 28;
const MAX_ALLOC: u64 = 2 << 30;
/// Inputs read into memory whole (AVIF, HEIC, SVG).
const MAX_FILE: u64 = 512 << 20;
/// SVG is drawn at its own size, scaled down to this longest side.
const MAX_SVG_SIDE: f32 = 8192.0;

pub fn supports(from: &str, to: &str) -> bool {
    if from == to || !INPUTS.contains(&from) {
        return false;
    }
    if to == "heic" {
        return heic_write_available();
    }
    OUTPUTS.contains(&to)
}

pub fn output(_from: &str, _to: &str) -> Output {
    Output::File
}

/// Whether this computer can write HEIC. The answer comes from a small test encode through the
/// system codec, made once per run.
pub fn heic_write_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        #[cfg(windows)]
        let available = heif_windows::encoder_available();
        #[cfg(target_os = "macos")]
        let available = heif_macos::encoder_available();
        #[cfg(not(any(windows, target_os = "macos")))]
        let available = false;
        tracing::info!(available, "HEIC encoder probe");
        available
    })
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    if !supports(job.from, job.to) {
        return Err(Error::Unsupported {
            from: job.from.to_owned(),
            to: job.to.to_owned(),
        });
    }
    job.progress.check()?;
    let decoded = decode::load(job.input, job.from, job.options)?;
    job.progress.report(0.5);
    job.progress.check()?;
    if job.to == "pdf" {
        let page = if decoded.jpeg_as_is {
            PageImage::Jpeg(std::fs::read(job.input)?)
        } else {
            PageImage::Pixels(decoded.image)
        };
        pdf::images_to_pdf(vec![page], &PageLayout::default(), job.dest, job.progress)?;
    } else {
        encode::write(decoded, job.to, job.options, job.dest)?;
    }
    job.progress.report(1.0);
    Ok(vec![job.dest.to_path_buf()])
}

/// Decodes any image input to pixels, upright (EXIF orientation applied). Shared with the PDF
/// and QR engines.
pub fn decode(path: &Path, from: &str, options: &Options) -> Result<::image::DynamicImage> {
    decode::load(path, from, options).map(|decoded| decoded.image)
}

/// Decodes any image input upright, with its embedded colour profile (background removal).
pub(crate) fn decode_with_profile(
    path: &Path,
    from: &str,
    options: &Options,
) -> Result<(::image::DynamicImage, Option<Vec<u8>>)> {
    decode::load(path, from, options).map(|decoded| (decoded.image, decoded.icc))
}

/// Writes pixels as a PNG, with the colour profile when it suits them (background removal).
pub(crate) fn write_png(
    image: ::image::DynamicImage,
    icc: Option<Vec<u8>>,
    options: &Options,
    dest: &Path,
) -> Result<()> {
    let decoded = decode::Decoded {
        image,
        icc,
        lossy: false,
        jpeg_as_is: false,
    };
    encode::write(decoded, "png", options, dest)
}

fn check_size(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 {
        return Err(Error::Unreadable("the image has no pixels".into()));
    }
    if width > MAX_SIDE || height > MAX_SIDE || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(Error::Limit(format!("an image of {width}×{height} pixels")));
    }
    Ok(())
}

fn read_input(path: &Path) -> Result<Vec<u8>> {
    let len = std::fs::metadata(path)?.len();
    if len > MAX_FILE {
        return Err(Error::Limit(format!("a {} MB image file", len >> 20)));
    }
    Ok(std::fs::read(path)?)
}

/// Premultiplied RGBA (what renderers draw into) to straight alpha.
fn unpremultiply(pixels: &mut [u8]) {
    for pixel in pixels.as_chunks_mut::<4>().0 {
        let alpha = u16::from(pixel[3]);
        if alpha != 0 && alpha != 255 {
            for channel in &mut pixel[..3] {
                *channel = ((u16::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
}
