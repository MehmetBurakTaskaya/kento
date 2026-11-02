// SPDX-License-Identifier: MIT
//! What happens around the model, without ONNX Runtime: the picture made into the model's input,
//! the model's answer made into a mask, and the mask laid on the picture as its alpha.
//!
//! The steps follow the model authors' own inference code for BEN2 Base: the picture is resized to
//! 1024 × 1024 (squeezed, not cropped) with Lanczos, its channels scaled to 0–1 and normalised
//! with the ImageNet mean and deviation, channels first. The network ends in a sigmoid, so it gives
//! one 1024 × 1024 map of 0–1; that map is stretched to the full 0–1 range, resized bilinearly to
//! the picture and becomes its alpha. The stretch happens on the model's map rather than after the
//! resize, so one mask serves the preview and the result at any size; a bilinear resize never goes
//! beyond the values it starts from, so the outcome is the same.

use ::image::imageops::{self, FilterType};
use ::image::{DynamicImage, GrayImage, ImageBuffer, Luma, Pixel};

use crate::{Error, Result};

/// The side of the square the model takes and gives.
pub const SIDE: u32 = 1024;
/// The ImageNet mean and standard deviation of red, green and blue, as the model was trained.
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const DEVIATION: [f32; 3] = [0.229, 0.224, 0.225];
/// A map flatter than this has no foreground to stretch; it is used as it is.
const FLAT: f32 = 1e-6;

/// The model's answer for one picture: how sure it is, from 0 to 1, that each point belongs to the
/// subject, on the model's own square.
#[derive(Debug, Clone, PartialEq)]
pub struct Mask {
    pub width: u32,
    pub height: u32,
    /// Row by row, `width × height` values.
    pub values: Vec<f32>,
}

/// The model's input for a picture: `[1, 3, SIDE, SIDE]` values, channels first. Any alpha is
/// dropped first, as the authors' code converts to RGB.
pub fn input(image: &DynamicImage) -> Vec<f32> {
    let square = image
        .resize_exact(SIDE, SIDE, FilterType::Lanczos3)
        .into_rgb8();
    let plane = (SIDE * SIDE) as usize;
    let mut values = vec![0.0; 3 * plane];
    for (index, pixel) in square.pixels().enumerate() {
        for channel in 0..3 {
            let value = f32::from(pixel[channel]) / 255.0;
            values[channel * plane + index] = (value - MEAN[channel]) / DEVIATION[channel];
        }
    }
    values
}

/// The shape of `input`'s values, as ONNX Runtime takes it.
pub fn input_shape() -> [usize; 4] {
    [1, 3, SIDE as usize, SIDE as usize]
}

/// Reads the model's output, `[1, 1, H, W]` (or with fewer leading ones), into a stretched mask.
pub fn mask(shape: &[i64], values: &[f32]) -> Result<Mask> {
    let bad = || Error::Other(format!("the model answered with a {shape:?} tensor"));
    let (rows, columns) = match shape {
        [.., rows, columns] if shape[..shape.len() - 2].iter().all(|&one| one == 1) => {
            (*rows, *columns)
        }
        _ => return Err(bad()),
    };
    let (Ok(height), Ok(width)) = (u32::try_from(rows), u32::try_from(columns)) else {
        return Err(bad());
    };
    if width == 0 || height == 0 || values.len() != width as usize * height as usize {
        return Err(bad());
    }
    let mut values = values.to_vec();
    stretch(&mut values);
    Ok(Mask {
        width,
        height,
        values,
    })
}

/// Stretches the values to the full 0–1 range, as the authors' code does; a value that is not a
/// number counts as background. A flat map is only kept within 0–1.
pub fn stretch(values: &mut [f32]) {
    let finite = values.iter().copied().filter(|value| value.is_finite());
    let (low, high) = finite.fold((f32::INFINITY, f32::NEG_INFINITY), |(low, high), value| {
        (low.min(value), high.max(value))
    });
    let range = high - low;
    for value in values.iter_mut() {
        *value = if !value.is_finite() {
            0.0
        } else if range > FLAT {
            (*value - low) / range
        } else {
            value.clamp(0.0, 1.0)
        };
    }
}

/// The mask at `width × height`, resized bilinearly, as alpha from 0 to 255.
pub fn alpha(mask: &Mask, width: u32, height: u32) -> GrayImage {
    let map: ImageBuffer<Luma<f32>, Vec<f32>> =
        ImageBuffer::from_raw(mask.width, mask.height, mask.values.clone())
            .expect("a mask holds width × height values");
    let sized = if (mask.width, mask.height) == (width, height) {
        map
    } else {
        imageops::resize(&map, width.max(1), height.max(1), FilterType::Triangle)
    };
    let pixels = sized
        .into_raw()
        .into_iter()
        .map(|value| (value.clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect();
    GrayImage::from_raw(width.max(1), height.max(1), pixels).expect("the resized mask fits")
}

/// The picture with `alpha` as its transparency, multiplied into any it had. Gray stays gray and
/// 16-bit pictures keep their depth, so the PNG holds what the source held.
pub fn cut_out(image: DynamicImage, alpha: &GrayImage) -> DynamicImage {
    let deep = matches!(
        image,
        DynamicImage::ImageLuma16(_)
            | DynamicImage::ImageLumaA16(_)
            | DynamicImage::ImageRgb16(_)
            | DynamicImage::ImageRgba16(_)
            | DynamicImage::ImageRgb32F(_)
            | DynamicImage::ImageRgba32F(_)
    );
    let gray = matches!(
        image,
        DynamicImage::ImageLuma8(_)
            | DynamicImage::ImageLumaA8(_)
            | DynamicImage::ImageLuma16(_)
            | DynamicImage::ImageLumaA16(_)
    );
    match (deep, gray) {
        (false, true) => DynamicImage::ImageLumaA8(masked(image.into_luma_alpha8(), alpha)),
        (false, false) => DynamicImage::ImageRgba8(masked(image.into_rgba8(), alpha)),
        (true, true) => DynamicImage::ImageLumaA16(masked(image.into_luma_alpha16(), alpha)),
        (true, false) => DynamicImage::ImageRgba16(masked(image.into_rgba16(), alpha)),
    }
}

/// Multiplies the last channel (alpha) of every pixel by the mask, at the buffer's own depth.
fn masked<P>(
    mut buffer: ImageBuffer<P, Vec<P::Subpixel>>,
    alpha: &GrayImage,
) -> ImageBuffer<P, Vec<P::Subpixel>>
where
    P: Pixel,
    P::Subpixel: Into<u32> + TryFrom<u32>,
{
    for (pixel, mask) in buffer.pixels_mut().zip(alpha.pixels()) {
        let channels = pixel.channels_mut();
        let last = channels.len() - 1;
        let kept = (channels[last].into() * u32::from(mask[0]) + 127) / 255;
        if let Ok(value) = P::Subpixel::try_from(kept) {
            channels[last] = value;
        }
    }
    buffer
}
