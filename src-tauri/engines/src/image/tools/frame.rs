// SPDX-License-Identifier: MIT
//! Add frame: the picture on a larger, opaque canvas.
//!
//! - The canvas is the picture with `padding` on every side.
//! - A gradient runs through the canvas centre at `angle`, its two colours at the farthest
//!   corners (as a CSS linear gradient does), mixed in sRGB.
//! - The blurred background is the picture scaled to cover the canvas and blurred by 5 % of the
//!   canvas's longer side; transparent parts show white. It is worked out on a copy at most 96
//!   pixels long and stretched back, so it looks the same at every size and costs little.
//! - The picture's corners are rounded by `radius`, at most half its shorter side, with smooth
//!   edges.
//! - The shadow is black at 40 % under the rounded picture, blurred by σ = 30 % of the padding
//!   (at most 6 % of the picture's longer side) and moved down by σ/2, so it stays inside the
//!   padding. Without padding there is no room for it.

use ::image::imageops::{self, FilterType};
use ::image::{DynamicImage, GrayImage, Luma, Rgba, RgbaImage};

use super::{blend, canvas_size, cover, mix, Background, FrameStyle, Source};
use crate::{Progress, Result};

const BLUR_WORK_SIDE: f32 = 96.0;
const BLUR_SHARE: f32 = 0.05;
const SHADOW_OPACITY: f32 = 0.4;
const SHADOW_SHARE_OF_PADDING: f32 = 0.3;
const SHADOW_SHARE_OF_PICTURE: f32 = 0.06;
const WHITE: Rgba<u8> = Rgba([255, 255, 255, 255]);

pub(super) fn add(source: Source, style: &FrameStyle, progress: &Progress) -> Result<DynamicImage> {
    let Source { image, scale } = source;
    let (width, height) = (image.width(), image.height());
    let padding = (f64::from(style.padding) * scale).round() as u32;
    let side =
        |length: u32| u32::try_from(u64::from(length) + 2 * u64::from(padding)).unwrap_or(u32::MAX);
    let (canvas_width, canvas_height) = (side(width), side(height));
    canvas_size(canvas_width, canvas_height, "the framed picture")?;
    let radius = ((f64::from(style.radius) * scale).min(f64::from(width.min(height)) / 2.0)) as f32;

    let mut canvas = match style.background {
        Background::Color { rgb: [r, g, b] } => {
            RgbaImage::from_pixel(canvas_width, canvas_height, Rgba([r, g, b, 255]))
        }
        Background::Gradient { from, to, angle } => {
            gradient(from, to, angle, canvas_width, canvas_height)
        }
        Background::Blurred => blurred(&image, canvas_width, canvas_height),
    };
    progress.check()?;
    if style.shadow {
        shadow(&mut canvas, padding, (width, height), radius);
        progress.check()?;
    }
    let picture = image.into_rgba8();
    blend(&mut canvas, &picture, (padding, padding), |x, y| {
        corner(x, y, width, height, radius)
    });
    for pixel in canvas.pixels_mut() {
        pixel[3] = 255;
    }
    Ok(DynamicImage::ImageRgba8(canvas))
}

fn gradient(from: [u8; 3], to: [u8; 3], angle: f64, width: u32, height: u32) -> RgbaImage {
    let angle = if angle.is_finite() {
        angle.to_radians()
    } else {
        0.0
    };
    let (dx, dy) = (angle.cos(), angle.sin());
    let (w, h) = (f64::from(width), f64::from(height));
    // The length of the gradient line, corner to corner along its direction.
    let length = (w * dx).abs() + (h * dy).abs();
    RgbaImage::from_fn(width, height, |x, y| {
        let along = (f64::from(x) + 0.5 - w / 2.0) * dx + (f64::from(y) + 0.5 - h / 2.0) * dy;
        let t = (along / length + 0.5).clamp(0.0, 1.0);
        let channel = |i: usize| {
            (f64::from(from[i]) + (f64::from(to[i]) - f64::from(from[i])) * t).round() as u8
        };
        Rgba([channel(0), channel(1), channel(2), 255])
    })
}

fn blurred(picture: &DynamicImage, width: u32, height: u32) -> RgbaImage {
    let shrink = (BLUR_WORK_SIDE / width.max(height) as f32).min(1.0);
    let small = |length: u32| ((length as f32 * shrink).round() as u32).max(1);
    let (small_width, small_height) = (small(width), small(height));
    let mut work = cover(picture, small_width, small_height, FilterType::Triangle);
    for pixel in work.pixels_mut() {
        *pixel = mix(WHITE, *pixel, f32::from(pixel[3]) / 255.0);
    }
    let sigma = small_width.max(small_height) as f32 * BLUR_SHARE;
    let soft = imageops::fast_blur(&work, sigma);
    imageops::resize(&soft, width, height, FilterType::CatmullRom)
}

fn shadow(canvas: &mut RgbaImage, padding: u32, (width, height): (u32, u32), radius: f32) {
    let sigma = (padding as f32 * SHADOW_SHARE_OF_PADDING)
        .min(width.max(height) as f32 * SHADOW_SHARE_OF_PICTURE);
    if sigma < 0.5 {
        return;
    }
    let drop = (sigma / 2.0).round() as u32;
    let mut mask = GrayImage::new(canvas.width(), canvas.height());
    for row in 0..height {
        let y = padding + drop + row;
        if y >= mask.height() {
            break;
        }
        for column in 0..width {
            let cover = corner(column, row, width, height, radius);
            mask.put_pixel(padding + column, y, Luma([(cover * 255.0).round() as u8]));
        }
    }
    let mask = imageops::fast_blur(&mask, sigma);
    let black = Rgba([0, 0, 0, 255]);
    for (pixel, shade) in canvas.pixels_mut().zip(mask.pixels()) {
        if shade[0] > 0 {
            *pixel = mix(*pixel, black, SHADOW_OPACITY * f32::from(shade[0]) / 255.0);
        }
    }
}

/// How much of the pixel at (`x`, `y`) lies inside a `width` × `height` rectangle whose corners
/// are rounded by `radius`: 1 inside, 0 outside, the share in between on a corner's edge.
fn corner(x: u32, y: u32, width: u32, height: u32, radius: f32) -> f32 {
    if radius <= 0.0 {
        return 1.0;
    }
    let distance = |position: u32, length: u32| {
        let centre = position as f32 + 0.5;
        if centre < radius {
            radius - centre
        } else if centre > length as f32 - radius {
            centre - (length as f32 - radius)
        } else {
            0.0
        }
    };
    let (dx, dy) = (distance(x, width), distance(y, height));
    if dx == 0.0 || dy == 0.0 {
        return 1.0;
    }
    (radius - dx.hypot(dy) + 0.5).clamp(0.0, 1.0)
}
