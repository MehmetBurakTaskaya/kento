// SPDX-License-Identifier: MIT
//! Make a collage: the pictures in their order on one opaque canvas `width` pixels wide, with
//! `spacing` between the cells and around the edge.
//!
//! - Grid: cells (width − (columns + 1)·spacing) / columns wide and that times the median
//!   height/width ratio of the pictures high, filled row by row.
//! - Row: every picture at one common height, chosen so that the row is exactly `width` wide.
//! - Column: every picture width − 2·spacing wide, one under the other.
//!
//! With `fill` a picture covers its cell, cropped around its centre; otherwise it fits whole
//! inside, centred on the background. Cell edges are rounded to whole pixels, so neighbouring
//! cells never overlap.

use ::image::imageops::FilterType;
use ::image::{DynamicImage, GenericImageView, Rgba, RgbaImage};

use super::{blend, canvas_size, contain, cover, CollageStyle, Layout, Source};
use crate::{Error, Progress, Result};

const FILTER: FilterType = FilterType::CatmullRom;

/// A cell in pixels of the result, before rounding.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Cell {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub(super) fn make(
    sources: Vec<Source>,
    style: &CollageStyle,
    progress: &Progress,
) -> Result<DynamicImage> {
    if sources.len() < 2 {
        return Err(Error::Other("a collage takes two pictures or more".into()));
    }
    let scale = sources
        .iter()
        .map(|source| source.scale)
        .fold(1.0, f64::min);
    let ratios: Vec<f64> = sources
        .iter()
        .map(|source| {
            let (width, height) = source.image.dimensions();
            f64::from(height) / f64::from(width)
        })
        .collect();
    let width = f64::from(style.width) * scale;
    let spacing = f64::from(style.spacing) * scale;
    let (cells, height) = layout(style.layout, width, spacing, &ratios)?;
    let (canvas_width, canvas_height) = (width.round() as u32, height.round() as u32);
    canvas_size(canvas_width, canvas_height, "the collage")?;

    let [r, g, b] = style.background;
    let mut canvas = RgbaImage::from_pixel(canvas_width, canvas_height, Rgba([r, g, b, 255]));
    for (source, cell) in sources.iter().zip(&cells) {
        progress.check()?;
        let (left, top) = (cell.x.round() as u32, cell.y.round() as u32);
        let right = (cell.x + cell.width).round() as u32;
        let bottom = (cell.y + cell.height).round() as u32;
        let (w, h) = (right.saturating_sub(left), bottom.saturating_sub(top));
        if w == 0 || h == 0 {
            continue;
        }
        if style.fill {
            let picture = cover(&source.image, w, h, FILTER);
            blend(&mut canvas, &picture, (left, top), |_, _| 1.0);
        } else {
            let (picture, dx, dy) = contain(&source.image, w, h, FILTER);
            blend(&mut canvas, &picture, (left + dx, top + dy), |_, _| 1.0);
        }
    }
    Ok(DynamicImage::ImageRgba8(canvas))
}

/// The cells for pictures of these height/width `ratios`, and the height of the result.
pub(super) fn layout(
    layout: Layout,
    width: f64,
    spacing: f64,
    ratios: &[f64],
) -> Result<(Vec<Cell>, f64)> {
    let count = ratios.len();
    let no_room = || Error::Other("the spacing leaves no room for the pictures".into());
    match layout {
        Layout::Grid { columns } => {
            let columns = columns.max(1) as usize;
            let cell_width = (width - (columns + 1) as f64 * spacing) / columns as f64;
            if cell_width < 1.0 {
                return Err(no_room());
            }
            let cell_height = cell_width * median(ratios);
            let rows = count.div_ceil(columns);
            let cells = (0..count)
                .map(|index| Cell {
                    x: spacing + (index % columns) as f64 * (cell_width + spacing),
                    y: spacing + (index / columns) as f64 * (cell_height + spacing),
                    width: cell_width,
                    height: cell_height,
                })
                .collect();
            Ok((
                cells,
                rows as f64 * cell_height + (rows + 1) as f64 * spacing,
            ))
        }
        Layout::Row => {
            let inner = width - (count + 1) as f64 * spacing;
            let height = inner / ratios.iter().map(|ratio| 1.0 / ratio).sum::<f64>();
            if inner < count as f64 || height < 1.0 {
                return Err(no_room());
            }
            let mut x = spacing;
            let cells = ratios
                .iter()
                .map(|ratio| {
                    let cell = Cell {
                        x,
                        y: spacing,
                        width: height / ratio,
                        height,
                    };
                    x += cell.width + spacing;
                    cell
                })
                .collect();
            Ok((cells, height + 2.0 * spacing))
        }
        Layout::Column => {
            let inner = width - 2.0 * spacing;
            if inner < 1.0 {
                return Err(no_room());
            }
            let mut y = spacing;
            let cells = ratios
                .iter()
                .map(|ratio| {
                    let cell = Cell {
                        x: spacing,
                        y,
                        width: inner,
                        height: inner * ratio,
                    };
                    y += cell.height + spacing;
                    cell
                })
                .collect();
            Ok((cells, y))
        }
    }
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}
