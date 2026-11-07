// SPDX-License-Identifier: MIT
//! Redact image: each area is filled with a colour, pixelated or blurred, for good.
//!
//! Pixelation replaces blocks of max(8, a twelfth of the area's shorter side) source pixels,
//! aligned to the area's top left corner, by their average. Blur pixelates first and then blurs
//! the blocks into each other (σ = 0.75 of a block). What is left is a mix of block averages: no
//! filter can bring the detail back, because it is gone rather than smeared.

use ::image::imageops;
use ::image::{DynamicImage, Rgba, RgbaImage};

use super::{Rect, Source};
use crate::media::{Area, Hide};
use crate::{Error, Result};

const MIN_BLOCK: f64 = 8.0;
const BLOCKS_ACROSS: f64 = 12.0;
const BLUR_PER_BLOCK: f32 = 0.75;

pub(super) fn hide(source: Source, areas: &[Area], hide: Hide) -> Result<DynamicImage> {
    let scale = source.scale;
    let mut image = source.image.into_rgba8();
    let size = image.dimensions();
    let rects: Vec<Rect> = areas
        .iter()
        .filter_map(|area| Rect::of(area, scale, size))
        .collect();
    if rects.is_empty() {
        return Err(Error::Other(
            "no area to hide holds pixels of the picture".into(),
        ));
    }
    if hide == Hide::Erase {
        return Err(Error::Other("pictures cannot be erased yet".into()));
    }
    for rect in rects {
        match hide {
            Hide::Color { rgb: [r, g, b] } => fill(&mut image, rect, Rgba([r, g, b, 255])),
            Hide::Pixelate => pixelate(&mut image, rect, block(rect, scale)),
            Hide::Blur => {
                let block = block(rect, scale);
                pixelate(&mut image, rect, block);
                blur(&mut image, rect, BLUR_PER_BLOCK * block as f32);
            }
            // Refused above.
            Hide::Erase => {}
        }
    }
    Ok(DynamicImage::ImageRgba8(image))
}

/// The block side for an area, worked out in source pixels so that a preview shows the same
/// blocks as the result.
fn block(rect: Rect, scale: f64) -> u32 {
    let shorter = f64::from(rect.w.min(rect.h)) / scale;
    ((shorter / BLOCKS_ACROSS).max(MIN_BLOCK) * scale)
        .round()
        .max(1.0) as u32
}

fn fill(image: &mut RgbaImage, rect: Rect, color: Rgba<u8>) {
    for y in rect.y..rect.y + rect.h {
        for x in rect.x..rect.x + rect.w {
            image.put_pixel(x, y, color);
        }
    }
}

fn pixelate(image: &mut RgbaImage, rect: Rect, block: u32) {
    let (right_edge, bottom_edge) = (rect.x + rect.w, rect.y + rect.h);
    for top in (rect.y..bottom_edge).step_by(block as usize) {
        let bottom = (top + block).min(bottom_edge);
        for left in (rect.x..right_edge).step_by(block as usize) {
            let right = (left + block).min(right_edge);
            let mut sum = [0u64; 4];
            for y in top..bottom {
                for x in left..right {
                    let pixel = image.get_pixel(x, y);
                    for (total, value) in sum.iter_mut().zip(pixel.0) {
                        *total += u64::from(value);
                    }
                }
            }
            let count = u64::from((right - left) * (bottom - top));
            let average = Rgba(sum.map(|total| ((total + count / 2) / count) as u8));
            for y in top..bottom {
                for x in left..right {
                    image.put_pixel(x, y, average);
                }
            }
        }
    }
}

fn blur(image: &mut RgbaImage, rect: Rect, sigma: f32) {
    let area = imageops::crop_imm(image, rect.x, rect.y, rect.w, rect.h).to_image();
    let soft = imageops::fast_blur(&area, sigma);
    imageops::replace(image, &soft, i64::from(rect.x), i64::from(rect.y));
}
