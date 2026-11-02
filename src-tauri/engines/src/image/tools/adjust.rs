// SPDX-License-Identifier: MIT
//! Edit image (turn, flip, resize, colour) and Crop image.
//!
//! The colour adjustments work on the stored sRGB values, each from -100 to 100:
//! - brightness `b` bends the tone curve, `v' = v^(2^-b)`: black and white stay where they are,
//!   the middle tones rise (b > 0) or fall (b < 0) without clipping;
//! - contrast `c` steepens or flattens around middle grey, `v' = 0.5 + (v - 0.5) · 4^c`;
//! - saturation `s` scales the distance from the pixel's luma (Rec. 709 weights),
//!   `v' = Y + (v - Y) · (1 + s)`: -100 gives grey, 100 doubles the colour.
//!
//! with `b`, `c`, `s` the settings divided by 100, and the steps in that order.

use ::image::imageops::FilterType;
use ::image::metadata::Orientation;
use ::image::{DynamicImage, GenericImageView};

use super::{canvas_size, scaled, Adjust, Rect, Source, Turn};
use crate::media::Area;
use crate::{Error, Progress, Result};

pub(super) fn edit(source: Source, adjust: &Adjust, progress: &Progress) -> Result<DynamicImage> {
    let Source { image, scale } = source;
    let mut image = match adjust.turn {
        Turn::None => image,
        Turn::Right => image.rotate90(),
        Turn::Half => image.rotate180(),
        Turn::Left => image.rotate270(),
    };
    if adjust.flip_horizontal {
        image.apply_orientation(Orientation::FlipHorizontal);
    }
    if adjust.flip_vertical {
        image.apply_orientation(Orientation::FlipVertical);
    }
    if let Some([width, height]) = adjust.resize {
        if width == 0 || height == 0 {
            return Err(Error::Other("the new size has no pixels".into()));
        }
        let (width, height) = (scaled(width, scale), scaled(height, scale));
        canvas_size(width, height, "the resized picture")?;
        if (width, height) != image.dimensions() {
            progress.check()?;
            image = image.resize_exact(width, height, FilterType::Lanczos3);
        }
    }
    progress.check()?;
    colours(image, adjust)
}

pub(super) fn crop(source: &Source, area: &Area) -> Result<DynamicImage> {
    let Rect { x, y, w, h } = Rect::of(area, source.scale, source.image.dimensions())
        .ok_or_else(|| Error::Other("the crop area holds no pixels of the picture".into()))?;
    Ok(source.image.crop_imm(x, y, w, h))
}

/// One setting as a share of its full range, -1 to 1.
fn setting(value: f32, what: &str) -> Result<f32> {
    if value.is_finite() {
        Ok(value.clamp(-100.0, 100.0) / 100.0)
    } else {
        Err(Error::Other(format!("the {what} is not a number")))
    }
}

fn colours(image: DynamicImage, adjust: &Adjust) -> Result<DynamicImage> {
    let brightness = setting(adjust.brightness, "brightness")?;
    let contrast = setting(adjust.contrast, "contrast")?;
    let saturation = setting(adjust.saturation, "saturation")?;
    if brightness == 0.0 && contrast == 0.0 && saturation == 0.0 {
        return Ok(image);
    }
    let gamma = 2f32.powf(-brightness);
    let slope = 4f32.powf(contrast);
    let tone = |value: f32| (0.5 + (value.powf(gamma) - 0.5) * slope).clamp(0.0, 1.0);
    let chroma = 1.0 + saturation;
    // 8-bit pictures stay 8-bit and deeper ones become 16-bit. Gray ones are written as RGB,
    // which keeps the steps to two layouts.
    Ok(match image {
        DynamicImage::ImageRgb8(mut buffer) => {
            tint(&mut buffer, 3, &tone, chroma);
            DynamicImage::ImageRgb8(buffer)
        }
        DynamicImage::ImageRgba8(mut buffer) => {
            tint(&mut buffer, 4, &tone, chroma);
            DynamicImage::ImageRgba8(buffer)
        }
        DynamicImage::ImageRgb16(mut buffer) => {
            tint(&mut buffer, 3, &tone, chroma);
            DynamicImage::ImageRgb16(buffer)
        }
        DynamicImage::ImageRgba16(mut buffer) => {
            tint(&mut buffer, 4, &tone, chroma);
            DynamicImage::ImageRgba16(buffer)
        }
        DynamicImage::ImageLuma8(_) => {
            let mut buffer = image.to_rgb8();
            tint(&mut buffer, 3, &tone, chroma);
            DynamicImage::ImageRgb8(buffer)
        }
        DynamicImage::ImageLumaA8(_) => {
            let mut buffer = image.to_rgba8();
            tint(&mut buffer, 4, &tone, chroma);
            DynamicImage::ImageRgba8(buffer)
        }
        other if other.has_alpha() => {
            let mut buffer = other.to_rgba16();
            tint(&mut buffer, 4, &tone, chroma);
            DynamicImage::ImageRgba16(buffer)
        }
        other => {
            let mut buffer = other.to_rgb16();
            tint(&mut buffer, 3, &tone, chroma);
            DynamicImage::ImageRgb16(buffer)
        }
    })
}

/// A stored sample, 8 or 16 bits.
trait Sample: Copy {
    const MAX: u16;
    fn index(self) -> usize;
    fn from_unit(value: f32) -> Self;
}

impl Sample for u8 {
    const MAX: u16 = 255;
    fn index(self) -> usize {
        usize::from(self)
    }
    fn from_unit(value: f32) -> Self {
        (value * 255.0).round() as u8
    }
}

impl Sample for u16 {
    const MAX: u16 = u16::MAX;
    fn index(self) -> usize {
        usize::from(self)
    }
    fn from_unit(value: f32) -> Self {
        (value * 65535.0).round() as u16
    }
}

/// Brightness and contrast through a table of every sample value, then saturation per pixel. The
/// alpha channel, when there is one, is left as it is.
fn tint<T: Sample>(samples: &mut [T], channels: usize, tone: &dyn Fn(f32) -> f32, chroma: f32) {
    let max = f32::from(T::MAX);
    let table: Vec<f32> = (0..=T::MAX)
        .map(|value| tone(f32::from(value) / max))
        .collect();
    for pixel in samples.chunks_exact_mut(channels) {
        let [r, g, b] = [0, 1, 2].map(|channel| table[pixel[channel].index()]);
        let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        for (sample, value) in pixel.iter_mut().zip([r, g, b]) {
            *sample = T::from_unit((luma + (value - luma) * chroma).clamp(0.0, 1.0));
        }
    }
}
