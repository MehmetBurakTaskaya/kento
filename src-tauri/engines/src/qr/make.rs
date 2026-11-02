// SPDX-License-Identifier: MIT
//! Making QR codes (SPEC 5.5, "Make a QR code" [+]): a PNG or an SVG from text or a link. The
//! `qrcode` crate encodes; Kento draws the modules itself, so both files show exactly the same
//! code with the same quiet zone and colours.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use image::{ImageFormat, Rgb, RgbImage};
use qrcode::{Color, EcLevel, QrCode};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// The light margin every reader needs around the code, in modules (ISO/IEC 18004).
pub const QUIET_ZONE: u32 = 4;

/// The side of a PNG, in pixels.
pub const MIN_SIZE: u32 = 64;
pub const MAX_SIZE: u32 = 4096;

/// Below this contrast ratio (WCAG's formula, 1 to 21) phone cameras start to miss codes.
pub const MIN_CONTRAST: f64 = 3.0;

/// How much of the code may be damaged or covered and still read: QR's four levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Correction {
    /// About 7 %.
    Low,
    /// About 15 %.
    Medium,
    /// About 25 %.
    Quartile,
    /// About 30 %.
    High,
}

impl Correction {
    fn level(self) -> EcLevel {
        match self {
            Correction::Low => EcLevel::L,
            Correction::Medium => EcLevel::M,
            Correction::Quartile => EcLevel::Q,
            Correction::High => EcLevel::H,
        }
    }
}

/// The file a code is saved as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Picture {
    Png,
    Svg,
}

impl Picture {
    pub fn extension(self) -> &'static str {
        match self {
            Picture::Png => "png",
            Picture::Svg => "svg",
        }
    }
}

/// How a code looks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub correction: Correction,
    /// The side in pixels, quiet zone included: the PNG's size, and the SVG's size where it is
    /// placed without one of its own.
    pub size: u32,
    /// The modules.
    pub dark: [u8; 3],
    /// The background and the quiet zone.
    pub light: [u8; 3],
}

impl Default for Style {
    fn default() -> Self {
        Self {
            correction: Correction::Medium,
            size: 1024,
            dark: [0, 0, 0],
            light: [255, 255, 255],
        }
    }
}

/// Why a code cannot be made; the page says each one plainly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Problem {
    /// Nothing to encode.
    Empty,
    /// More than a QR code holds at this correction level.
    TooLong,
    /// Under `MIN_CONTRAST`.
    LowContrast,
}

/// The code's modules, quiet zone included, row by row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Modules {
    /// Modules per side, quiet zone included.
    pub side: u32,
    dark: Vec<bool>,
}

impl Modules {
    pub fn is_dark(&self, x: u32, y: u32) -> bool {
        x < self.side && y < self.side && self.dark[(y * self.side + x) as usize]
    }
}

/// Encodes `text` (UTF-8, as every phone reads it) at the smallest version that holds it.
pub fn encode(text: &str, correction: Correction) -> std::result::Result<Modules, Problem> {
    if text.is_empty() {
        return Err(Problem::Empty);
    }
    let code = QrCode::with_error_correction_level(text.as_bytes(), correction.level())
        .map_err(|_| Problem::TooLong)?;
    let width = code.width() as u32;
    let colors = code.to_colors();
    let side = width + 2 * QUIET_ZONE;
    let inner = QUIET_ZONE..QUIET_ZONE + width;
    let dark = (0..side * side)
        .map(|i| {
            let (x, y) = (i % side, i / side);
            inner.contains(&x)
                && inner.contains(&y)
                && colors[((y - QUIET_ZONE) * width + (x - QUIET_ZONE)) as usize] == Color::Dark
        })
        .collect();
    Ok(Modules { side, dark })
}

/// What stops this text and style from making a readable code, if anything.
pub fn check(text: &str, style: &Style) -> std::result::Result<Modules, Problem> {
    if contrast(style.dark, style.light) < MIN_CONTRAST {
        return Err(Problem::LowContrast);
    }
    encode(text, style.correction)
}

/// WCAG 2's contrast ratio of two sRGB colours: 1 (the same) to 21 (black on white).
pub fn contrast(a: [u8; 3], b: [u8; 3]) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

/// Whether the modules are lighter than the background. Many readers expect dark on light, so
/// the page warns about it.
pub fn inverted(style: &Style) -> bool {
    luminance(style.dark) > luminance(style.light)
}

fn luminance([r, g, b]: [u8; 3]) -> f64 {
    let linear = |channel: u8| {
        let c = f64::from(channel) / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

fn hex([r, g, b]: [u8; 3]) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// The code as an SVG: one module per user unit, each row's dark runs as one path.
pub fn svg(modules: &Modules, style: &Style) -> String {
    let side = modules.side;
    let size = style.size.clamp(MIN_SIZE, MAX_SIZE);
    let mut path = String::new();
    for y in 0..side {
        let mut x = 0;
        while x < side {
            if !modules.is_dark(x, y) {
                x += 1;
                continue;
            }
            let start = x;
            while x < side && modules.is_dark(x, y) {
                x += 1;
            }
            path.push_str(&format!("M{start} {y}h{}v1h-{}z", x - start, x - start));
        }
    }
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {side} {side}\" width=\"{size}\" \
         height=\"{size}\" shape-rendering=\"crispEdges\">\n\
         <rect width=\"{side}\" height=\"{side}\" fill=\"{}\"/>\n\
         <path fill=\"{}\" d=\"{path}\"/>\n</svg>\n",
        hex(style.light),
        hex(style.dark),
    )
}

/// The code as pixels, `style.size` on a side, but never fewer than two pixels per module.
/// Module edges fall on whole pixels, so nothing is blurred; modules differ by a pixel at most.
pub fn pixels(modules: &Modules, style: &Style) -> RgbImage {
    let side = modules.side;
    let size = style.size.clamp(MIN_SIZE, MAX_SIZE).max(side * 2);
    let module_of: Vec<u32> = (0..size)
        .map(|px| (u64::from(px) * u64::from(side) / u64::from(size)) as u32)
        .collect();
    let (dark, light) = (Rgb(style.dark), Rgb(style.light));
    RgbImage::from_fn(size, size, |x, y| {
        if modules.is_dark(module_of[x as usize], module_of[y as usize]) {
            dark
        } else {
            light
        }
    })
}

/// A file name (without extension) for the code of `text`: a link's site, else the text's first
/// words; "QR" when nothing usable is left.
pub fn name_for(text: &str) -> String {
    const WORDS: usize = 40;
    let base = crate::web::host(text).unwrap_or_else(|| {
        let line = text.trim().lines().next().unwrap_or_default();
        if line.chars().count() <= WORDS {
            return line.to_owned();
        }
        let cut: String = line.chars().take(WORDS).collect();
        // At the last space in the second half, if there is one.
        match cut.rfind(' ').filter(|&at| at >= cut.len() / 2) {
            Some(at) => cut[..at].to_owned(),
            None => cut,
        }
    });
    let name = crate::web::sanitize(&base);
    if name.is_empty() {
        "QR".to_owned()
    } else {
        name
    }
}

/// Writes the code for `text` to `dest` as a PNG or an SVG.
pub fn make(text: &str, style: &Style, picture: Picture, dest: &Path) -> Result<()> {
    let modules = check(text, style).map_err(|problem| {
        Error::Other(match problem {
            Problem::Empty => "there is no text for the QR code".to_owned(),
            Problem::TooLong => "the text is too long for a QR code".to_owned(),
            Problem::LowContrast => "the colours are too close to read".to_owned(),
        })
    })?;
    let mut out = BufWriter::new(File::create(dest)?);
    match picture {
        Picture::Svg => out.write_all(svg(&modules, style).as_bytes())?,
        Picture::Png => pixels(&modules, style)
            .write_to(&mut out, ImageFormat::Png)
            .map_err(|error| Error::Other(error.to_string()))?,
    }
    out.flush()?;
    Ok(())
}
