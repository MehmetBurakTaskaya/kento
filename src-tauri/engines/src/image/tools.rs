// SPDX-License-Identifier: MIT
//! The image editors of SPEC 5.5: Edit image, Crop image, Mark up, Add frame, Make a collage and
//! Redact image. Every coordinate is in pixels of the upright source (EXIF orientation applied),
//! so a preview at any scale and the full-size result come from the same steps.

use std::path::{Path, PathBuf};

use ::image::{DynamicImage, RgbaImage};
use serde::{Deserialize, Serialize};

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
    /// The width of the result in pixels (Column: the width of each picture).
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
        let _ = from;
        "png"
    }
}

/// One picture for a preview: the source scaled down to `scale` (at most 1) of its upright size.
pub struct Source {
    pub image: DynamicImage,
    pub scale: f64,
}

/// The tool applied to scaled-down copies of its inputs, for the editor's live preview. The same
/// steps as `run_tool`, with every coordinate multiplied by the source's scale.
pub fn preview(sources: &[Source], tool: &ImageTool) -> Result<RgbaImage> {
    let _ = (sources, tool);
    Err(Error::Other("the image editors are not built yet".into()))
}

/// The upright size of an image in pixels.
pub fn size(path: &Path, from: &str, options: &Options) -> Result<[u32; 2]> {
    let _ = (path, from, options);
    Err(Error::Other("the image editors are not built yet".into()))
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
    let _ = run;
    Err(Error::Other("the image editors are not built yet".into()))
}
