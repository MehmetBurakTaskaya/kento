// SPDX-License-Identifier: MIT
//! Remove background (SPEC 5.5 [+]): a picture with its background made transparent, written as a
//! PNG. The model is BEN2 Base by Prama LLC (MIT), run on the processor by ONNX Runtime (MIT); both
//! are part of the Extras tools, downloaded on request (SPEC 4.2). Only permissively licensed
//! models are used.
//!
//! The picture is decoded upright, the model finds the subject on a 1024 × 1024 copy, and that
//! mask, resized to the picture, becomes its alpha (see `steps`). Previews use the same mask on a
//! smaller copy.

mod runtime;
mod steps;
#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use ::image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
use ::image::{DynamicImage, GenericImageView, ImageEncoder};

use crate::{Error, Options, Progress, Result};

/// The model file the steps are written for, as the Extras tools install it.
pub const MODEL_FILE: &str = "BEN2_Base.onnx";

/// The oldest macOS Microsoft's ONNX Runtime builds run on (their deployment target).
pub const MIN_MACOS: (u32, u32) = (13, 4);

/// Whether this computer can run background removal at all: everywhere but on a Mac older than
/// `MIN_MACOS`, where the tool is hidden (SPEC 5.18).
pub fn supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_version().is_none_or(|version| version >= MIN_MACOS)
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// The running macOS release, from `kern.osproductversion` (`14.6.1` gives 14 and 6).
#[cfg(target_os = "macos")]
fn macos_version() -> Option<(u32, u32)> {
    let mut buffer = [0u8; 32];
    let mut len = buffer.len();
    // SAFETY: the name is a C string, and the buffer and its length describe writable memory.
    let status = unsafe {
        libc::sysctlbyname(
            c"kern.osproductversion".as_ptr(),
            buffer.as_mut_ptr().cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if status != 0 {
        return None;
    }
    let text = std::str::from_utf8(buffer.get(..len)?).ok()?;
    let mut parts = text.trim_end_matches('\0').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().map_or(Some(0), |part| part.parse().ok())?;
    Some((major, minor))
}

/// The ONNX Runtime library and the model from the tools, checked to be the model Kento knows.
fn parts(options: &Options) -> Result<(&Path, &Path)> {
    if !supported() {
        return Err(Error::Other(format!(
            "background removal needs macOS {}.{} or newer",
            MIN_MACOS.0, MIN_MACOS.1
        )));
    }
    let runtime = options.tools.onnxruntime()?;
    let model = options.tools.bg_model()?;
    if model.file_name().is_none_or(|name| name != MODEL_FILE) {
        return Err(Error::Other(format!(
            "{} is not the model background removal is written for ({MODEL_FILE})",
            model.display()
        )));
    }
    Ok((runtime, model))
}

/// One run of Remove background.
pub struct CutoutRun<'a> {
    pub input: &'a Path,
    /// The catalog id of the input's format.
    pub from: &'a str,
    /// The PNG to create.
    pub dest: &'a Path,
    pub options: &'a Options,
    pub progress: &'a Progress<'a>,
}

/// Writes the picture with its background transparent and returns the file written. The colour
/// profile stays; the EXIF orientation is already in the pixels.
pub fn run(job: &CutoutRun) -> Result<Vec<PathBuf>> {
    let (runtime, model) = parts(job.options)?;
    job.progress.check()?;
    let (image, icc) = crate::image::decode_with_profile(job.input, job.from, job.options)?;
    job.progress.report(0.1);
    let mask = runtime::mask_of(runtime, model, job.input, &image, job.progress)?;
    job.progress.check()?;
    let (width, height) = image.dimensions();
    let alpha = steps::alpha(&mask, width, height);
    let cut = steps::cut_out(image, &alpha);
    job.progress.report(0.9);
    job.progress.check()?;
    crate::image::write_png(cut, icc, job.options, job.dest)?;
    job.progress.report(1.0);
    Ok(vec![job.dest.to_path_buf()])
}

/// The picture cut out, no larger than `max_side` on its longer side, as a PNG for the panel. The
/// mask is kept, so saving the same picture afterwards does not run the model again.
pub fn preview_png(input: &Path, from: &str, options: &Options, max_side: u32) -> Result<Vec<u8>> {
    let (runtime, model) = parts(options)?;
    let (image, _) = crate::image::decode_with_profile(input, from, options)?;
    let mask = runtime::mask_of(runtime, model, input, &image, &Progress::none())?;
    let max_side = max_side.max(1);
    let small = if image.width().max(image.height()) > max_side {
        image.thumbnail(max_side, max_side)
    } else {
        image
    };
    let alpha = steps::alpha(&mask, small.width(), small.height());
    let cut = DynamicImage::ImageRgba8(steps::cut_out(small, &alpha).into_rgba8());
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, PngFilter::Adaptive)
        .write_image(
            cut.as_bytes(),
            cut.width(),
            cut.height(),
            cut.color().into(),
        )
        .map_err(|error| Error::Other(format!("the preview could not be encoded: {error}")))?;
    Ok(png)
}
