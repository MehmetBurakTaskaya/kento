// SPDX-License-Identifier: MIT
//! The image editors of SPEC 5.5: Edit image, Crop image, Mark up, Add frame, Make a collage and
//! Redact image. Every coordinate is in pixels of the upright source (EXIF orientation applied),
//! so a preview at any scale and the full-size result come from the same steps.
//!
//! Results carry no EXIF: the orientation is already in the pixels, and the camera's other fields
//! stay with the original. The colour profile is kept where the output format holds one.

mod adjust;
mod collage;
mod frame;
mod markup;
mod redact;
#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use ::image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
use ::image::imageops::FilterType;
use ::image::{DynamicImage, GenericImageView, ImageEncoder, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

use super::decode::{self, Decoded};
use super::{encode, heic_write_available};
use crate::media::{Area, Hide};
use crate::{Error, Options, Output, Progress, Result};

/// Quarter turns clockwise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Turn {
    #[default]
    None,
    Right,
    Half,
    Left,
}

/// Edit image. The steps run in this order: turn, flip, resize, then the colour adjustments.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adjust {
    pub turn: Turn,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
    /// Width and height after turning; None keeps the size.
    pub resize: Option<[u32; 2]>,
    /// -100 to 100; 0 leaves the picture as it is.
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
}

/// Red, green, blue and alpha, 0 to 255.
pub type Color = [u8; 4];

/// One mark of Mark up, in source pixels. Widths and font sizes are in source pixels too.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Mark {
    Pen {
        points: Vec<[f64; 2]>,
        color: Color,
        width: f64,
    },
    /// A wide stroke that tints what is under it without hiding it.
    Highlighter {
        points: Vec<[f64; 2]>,
        color: Color,
        width: f64,
    },
    Rectangle {
        area: Area,
        color: Color,
        width: f64,
        filled: bool,
    },
    Ellipse {
        area: Area,
        color: Color,
        width: f64,
        filled: bool,
    },
    Line {
        from: [f64; 2],
        to: [f64; 2],
        color: Color,
        width: f64,
    },
    /// The head is at `to`.
    Arrow {
        from: [f64; 2],
        to: [f64; 2],
        color: Color,
        width: f64,
    },
    /// `at` is the top left corner of the first line; lines break at `\n`.
    Text {
        at: [f64; 2],
        text: String,
        color: Color,
        size: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Background {
    Color {
        rgb: [u8; 3],
    },
    /// `angle` in degrees: 0 runs from left to right, 90 from top to bottom.
    Gradient {
        from: [u8; 3],
        to: [u8; 3],
        angle: f64,
    },
    /// The picture itself, blurred and stretched to fill.
    Blurred,
}

/// Add frame.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameStyle {
    /// The space around the picture, in source pixels.
    pub padding: u32,
    pub background: Background,
    /// The picture's corner radius, in source pixels.
    pub radius: u32,
    /// A soft shadow under the picture.
    pub shadow: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Layout {
    /// Rows of `columns` cells, filled in order.
    Grid { columns: u32 },
    /// One row.
    Row,
    /// One column.
    Column,
}

/// Make a collage, from the inputs in their order.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollageStyle {
    pub layout: Layout,
    /// Between the cells and around the edge, in pixels of the result.
    pub spacing: u32,
    pub background: [u8; 3],
    /// The width of the result in pixels, the spacing at the edges included (in every layout).
    pub width: u32,
    /// True: each picture fills its cell and is cropped to it. False: it fits whole inside.
    pub fill: bool,
}

/// The image editors and their choices (SPEC 5.5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tool", rename_all = "kebab-case")]
pub enum ImageTool {
    EditImage { adjust: Adjust },
    CropImage { area: Area },
    Markup { marks: Vec<Mark> },
    Frame { frame: FrameStyle },
    Collage { collage: CollageStyle },
    RedactImage { areas: Vec<Area>, hide: Hide },
}

impl ImageTool {
    /// The catalog id of the tool.
    pub fn id(&self) -> &'static str {
        match self {
            ImageTool::EditImage { .. } => "edit-image",
            ImageTool::CropImage { .. } => "crop-image",
            ImageTool::Markup { .. } => "markup",
            ImageTool::Frame { .. } => "frame",
            ImageTool::Collage { .. } => "collage",
            ImageTool::RedactImage { .. } => "redact-image",
        }
    }

    pub fn output(&self) -> Output {
        Output::File
    }

    /// The extension of the result for an input of format `from` (a catalog id; for a collage,
    /// the first picture's). Formats Kento writes stay as they are; SVG, GIF and ICO become PNG
    /// (the result is pixels, one frame); HEIC stays HEIC where an encoder exists, else JPG.
    pub fn extension(&self, from: &str) -> &'static str {
        match from {
            "jpg" => "jpg",
            "png" => "png",
            "webp" => "webp",
            "avif" => "avif",
            "bmp" => "bmp",
            "tiff" => "tiff",
            "heic" if heic_write_available() => "heic",
            "heic" => "jpg",
            _ => "png",
        }
    }
}

/// One picture for a preview: the source scaled down to `scale` (at most 1) of its upright size.
pub struct Source {
    pub image: DynamicImage,
    pub scale: f64,
}

/// The tool applied to scaled-down copies of its inputs, for the editor's live preview. The same
/// steps as `run_tool`, with every coordinate multiplied by the source's scale.
///
/// A collage is laid out at the smallest scale among its sources: its width and spacing are in
/// pixels of the result, not of any one picture.
pub fn preview(sources: &[Source], tool: &ImageTool) -> Result<RgbaImage> {
    let sources: Vec<&Source> = sources.iter().collect();
    Ok(apply(copies(&sources)?, tool, &Progress::none())?.into_rgba8())
}

/// A picture for previews: decoded upright and scaled down to at most `max_side` on its longer
/// side, with the scale it was taken at.
pub fn preview_source(path: &Path, from: &str, options: &Options, max_side: u32) -> Result<Source> {
    let image = decode::load(path, from, options)?.image;
    let (width, height) = image.dimensions();
    if width.max(height) <= max_side {
        return Ok(Source { image, scale: 1.0 });
    }
    // An area average: quick on a large photo and good enough for a screen.
    let small = image.thumbnail(max_side, max_side);
    let scale = (f64::from(small.width()) / f64::from(width))
        .min(f64::from(small.height()) / f64::from(height));
    Ok(Source {
        image: small,
        scale,
    })
}

/// The editor's preview as a PNG no larger than `max_side` on its longer side: the tool applied
/// to the sources or, without a tool, the first picture as it is. It is shown, not kept, so it is
/// compressed quickly rather than well.
pub fn preview_png(
    sources: &[&Source],
    tool: Option<&ImageTool>,
    max_side: u32,
) -> Result<Vec<u8>> {
    let image = match tool {
        Some(tool) => apply(copies(sources)?, tool, &Progress::none())?,
        None => sources
            .first()
            .ok_or_else(|| Error::Other("no picture to show".into()))?
            .image
            .clone(),
    };
    let max_side = max_side.max(1);
    // A frame, a collage or a larger size can come out bigger than the sources.
    let image = if image.width().max(image.height()) > max_side {
        image.resize(max_side, max_side, FilterType::Triangle)
    } else {
        image
    };
    let image = encode::without_opaque_alpha(DynamicImage::ImageRgba8(image.into_rgba8()));
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, PngFilter::Adaptive)
        .write_image(
            image.as_bytes(),
            image.width(),
            image.height(),
            image.color().into(),
        )
        .map_err(|error| Error::Other(format!("the preview could not be encoded: {error}")))?;
    Ok(png)
}

/// The upright size of an image in pixels.
pub fn size(path: &Path, from: &str, options: &Options) -> Result<[u32; 2]> {
    decode::size(path, from, options)
}

/// One run of an image tool.
pub struct ImageRun<'a> {
    /// Each input with its catalog format id: one picture, or the collage's in order.
    pub inputs: &'a [(PathBuf, String)],
    pub tool: &'a ImageTool,
    /// The file to create.
    pub dest: &'a Path,
    pub temp: &'a Path,
    pub options: &'a Options,
    pub progress: &'a Progress<'a>,
}

/// Runs an image tool on the full-size inputs and returns the file it wrote.
pub fn run_tool(run: &ImageRun) -> Result<Vec<PathBuf>> {
    let (_, first_from) = run
        .inputs
        .first()
        .ok_or_else(|| Error::Other("no picture to edit".into()))?;
    let count = run.inputs.len();
    let mut sources = Vec::with_capacity(count);
    let mut icc = None;
    let mut lossy = false;
    let mut one_profile = true;
    for (index, (path, from)) in run.inputs.iter().enumerate() {
        run.progress.check()?;
        let decoded = decode::load(path, from, run.options)?;
        if index == 0 {
            icc = decoded.icc;
            lossy = decoded.lossy;
        } else if decoded.icc != icc {
            // Pictures in different colour spaces share one canvas; no one profile fits them all.
            one_profile = false;
        }
        sources.push(Source {
            image: decoded.image,
            scale: 1.0,
        });
        run.progress.report(0.6 * (index + 1) as f32 / count as f32);
    }
    run.progress.check()?;
    let image = apply(sources, run.tool, run.progress)?;
    run.progress.report(0.8);
    run.progress.check()?;
    let decoded = Decoded {
        image,
        icc: icc.filter(|_| one_profile),
        lossy,
        jpeg_as_is: false,
    };
    encode::write(
        decoded,
        run.tool.extension(first_from),
        run.options,
        run.dest,
    )?;
    run.progress.report(1.0);
    Ok(vec![run.dest.to_path_buf()])
}

/// The steps of every tool, shared by the preview and the result.
fn apply(sources: Vec<Source>, tool: &ImageTool, progress: &Progress) -> Result<DynamicImage> {
    if let ImageTool::Collage { collage } = tool {
        return collage::make(sources, collage, progress);
    }
    let [source] = <[Source; 1]>::try_from(sources)
        .map_err(|_| Error::Other("this tool takes one picture".into()))?;
    match tool {
        ImageTool::EditImage { adjust } => adjust::edit(source, adjust, progress),
        ImageTool::CropImage { area } => adjust::crop(&source, area),
        ImageTool::Markup { marks } => markup::draw(source, marks),
        ImageTool::Frame { frame } => frame::add(source, frame, progress),
        ImageTool::RedactImage { areas, hide } => redact::hide(source, areas, *hide),
        ImageTool::Collage { .. } => unreachable!("a collage is made above"),
    }
}

/// Owned copies for the steps, which work in place; a preview's sources are small.
fn copies(sources: &[&Source]) -> Result<Vec<Source>> {
    sources
        .iter()
        .map(|source| {
            if source.scale.is_finite() && source.scale > 0.0 && source.scale <= 1.0 {
                Ok(Source {
                    image: source.image.clone(),
                    scale: source.scale,
                })
            } else {
                Err(Error::Other(format!(
                    "a preview scale of {} is not above 0 and at most 1",
                    source.scale
                )))
            }
        })
        .collect()
}

/// An area of the picture in whole pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Rect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

impl Rect {
    /// `area` (source pixels) at `scale`, clamped to a picture of `size` and rounded to whole
    /// pixels; None when nothing of it is left. A negative width or height counts back from `x`
    /// or `y`, as a drag up or to the left gives.
    fn of(area: &Area, scale: f64, (width, height): (u32, u32)) -> Option<Rect> {
        let span = |start: f64, length: f64, limit: u32| {
            if !start.is_finite() || !length.is_finite() {
                return None;
            }
            let (low, high) = if length < 0.0 {
                (start + length, start)
            } else {
                (start, start + length)
            };
            let limit = f64::from(limit);
            let low = (low * scale).clamp(0.0, limit).round() as u32;
            let high = (high * scale).clamp(0.0, limit).round() as u32;
            (high > low).then_some((low, high - low))
        };
        let (x, w) = span(area.x, area.width, width)?;
        let (y, h) = span(area.y, area.height, height)?;
        Some(Rect { x, y, w, h })
    }
}

/// A length in source pixels at the scale of a preview: at least one pixel.
fn scaled(length: u32, scale: f64) -> u32 {
    ((f64::from(length) * scale).round() as u32).max(1)
}

/// The picture scaled to cover `width` × `height` and cropped to it, centred.
fn cover(image: &DynamicImage, width: u32, height: u32, filter: FilterType) -> RgbaImage {
    let (source_width, source_height) = image.dimensions();
    let factor = (f64::from(width) / f64::from(source_width))
        .max(f64::from(height) / f64::from(source_height));
    let crop_width = ((f64::from(width) / factor).round() as u32).clamp(1, source_width);
    let crop_height = ((f64::from(height) / factor).round() as u32).clamp(1, source_height);
    let x = (source_width - crop_width) / 2;
    let y = (source_height - crop_height) / 2;
    image
        .crop_imm(x, y, crop_width, crop_height)
        .resize_exact(width, height, filter)
        .into_rgba8()
}

/// The picture scaled to fit inside `width` × `height`, with the offset that centres it there.
fn contain(
    image: &DynamicImage,
    width: u32,
    height: u32,
    filter: FilterType,
) -> (RgbaImage, u32, u32) {
    let (source_width, source_height) = image.dimensions();
    let factor = (f64::from(width) / f64::from(source_width))
        .min(f64::from(height) / f64::from(source_height));
    let fit_width = ((f64::from(source_width) * factor).round() as u32).clamp(1, width);
    let fit_height = ((f64::from(source_height) * factor).round() as u32).clamp(1, height);
    let fitted = image
        .resize_exact(fit_width, fit_height, filter)
        .into_rgba8();
    (fitted, (width - fit_width) / 2, (height - fit_height) / 2)
}

/// Lays `top` over the opaque `canvas` at (`x`, `y`), each pixel by its alpha times `coverage`.
fn blend(
    canvas: &mut RgbaImage,
    top: &RgbaImage,
    (x, y): (u32, u32),
    coverage: impl Fn(u32, u32) -> f32,
) {
    for (column, row, pixel) in top.enumerate_pixels() {
        let (cx, cy) = (x + column, y + row);
        if cx >= canvas.width() || cy >= canvas.height() {
            continue;
        }
        let amount = f32::from(pixel[3]) / 255.0 * coverage(column, row);
        if amount > 0.0 {
            let under = canvas.get_pixel_mut(cx, cy);
            *under = mix(*under, *pixel, amount);
        }
    }
}

/// `under` moved towards `over` by `amount` (0 to 1); the result is opaque.
fn mix(under: Rgba<u8>, over: Rgba<u8>, amount: f32) -> Rgba<u8> {
    let channel = |index: usize| {
        let value =
            f32::from(under[index]) + (f32::from(over[index]) - f32::from(under[index])) * amount;
        value.round().clamp(0.0, 255.0) as u8
    };
    Rgba([channel(0), channel(1), channel(2), 255])
}

/// A canvas a tool is about to make, held to the decoder's limits.
fn canvas_size(width: u32, height: u32, what: &str) -> Result<()> {
    if width == 0 || height == 0 {
        return Err(Error::Other(format!("{what} would have no pixels")));
    }
    super::check_size(width, height)
}
