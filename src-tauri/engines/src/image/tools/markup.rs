// SPDX-License-Identifier: MIT
//! Mark up: the marks become one SVG, drawn over the picture with resvg. The editor draws the same
//! SVG over its preview, so both follow these rules:
//! - `viewBox="0 0 W H"` is the upright source size; every number is in source pixels;
//! - each mark is a group with `opacity` = alpha / 255 around shapes painted `rgb(r,g,b)`, so the
//!   parts of one mark (an arrow's shaft and head, a filled shape and its stroke) do not darken
//!   where they overlap;
//! - pen: a polyline through the points, no fill, round caps and joins; highlighter: the same
//!   with butt caps, blended normally (the alpha does the see-through);
//! - rectangle and ellipse: the stroke centred on the area's edge, and filled with the same colour
//!   when `filled`; a negative width or height counts back from `x` or `y`;
//! - line: round caps;
//! - arrow: a head of length L = max(4·width, 12) and base 0.75·L, a filled triangle with its tip
//!   at `to`; the shaft runs from `from` to the middle of the base, with round caps; an arrow of
//!   no length draws nothing;
//! - text: one `<text>` per line (split at `\n`) at x = at.x, baseline at.y + size + i·1.25·size,
//!   weight 600, "Segoe UI", "Helvetica Neue", Arial or sans-serif, spaces kept;
//! - numbers are written with at most three decimals and held within ±1 000 000.
//!
//! Text is escaped, and the SVG names no file, URL or image, so a mark cannot reach anything.

use ::image::{DynamicImage, RgbaImage};
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{self, ImageHrefResolver};

use super::{Color, Mark, Source};
use crate::media::Area;
use crate::{Error, Result};

const FONT: &str = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const MAX_NUMBER: f64 = 1_000_000.0;

pub(super) fn draw(source: Source, marks: &[Mark]) -> Result<DynamicImage> {
    if marks.is_empty() {
        return Ok(source.image);
    }
    let scale = source.scale;
    let mut canvas = source.image.into_rgba8();
    let (width, height) = canvas.dimensions();
    let svg = svg(marks, f64::from(width) / scale, f64::from(height) / scale)?;
    let overlay = render(&svg, width, height, scale)?;
    over(&mut canvas, overlay.data());
    Ok(DynamicImage::ImageRgba8(canvas))
}

/// The marks as an SVG document over a source of `width` × `height` pixels.
pub(super) fn svg(marks: &[Mark], width: f64, height: f64) -> Result<String> {
    let (width, height) = (number(width)?, number(height)?);
    let mut out = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">"#
    );
    for mark in marks {
        out.push_str(&element(mark)?);
    }
    out.push_str("</svg>");
    Ok(out)
}

fn element(mark: &Mark) -> Result<String> {
    let (color, body) = match mark {
        Mark::Pen {
            points,
            color,
            width,
        } => (color, polyline(points, color, *width, "round")?),
        Mark::Highlighter {
            points,
            color,
            width,
        } => (color, polyline(points, color, *width, "butt")?),
        Mark::Rectangle {
            area,
            color,
            width,
            filled,
        } => {
            let [x, y, w, h] = bounds(area)?;
            let shape = format!(r#"<rect x="{x}" y="{y}" width="{w}" height="{h}""#);
            (color, shape + &paint(color, *width, *filled)?)
        }
        Mark::Ellipse {
            area,
            color,
            width,
            filled,
        } => {
            let [x, y, w, h] = bounds(area)?;
            let shape = format!(
                r#"<ellipse cx="{}" cy="{}" rx="{}" ry="{}""#,
                number(x + w / 2.0)?,
                number(y + h / 2.0)?,
                number(w / 2.0)?,
                number(h / 2.0)?
            );
            (color, shape + &paint(color, *width, *filled)?)
        }
        Mark::Line {
            from,
            to,
            color,
            width,
        } => (color, line(*from, *to, color, *width)?),
        Mark::Arrow {
            from,
            to,
            color,
            width,
        } => (color, arrow(*from, *to, color, *width)?),
        Mark::Text {
            at,
            text,
            color,
            size,
        } => (color, lines(*at, text, color, *size)?),
    };
    if body.is_empty() || color[3] == 0 {
        return Ok(String::new());
    }
    Ok(format!(
        r#"<g opacity="{}">{body}</g>"#,
        number(f64::from(color[3]) / 255.0)?
    ))
}

/// A number for the SVG: finite, within reach, and short.
fn number(value: f64) -> Result<String> {
    if !value.is_finite() {
        return Err(Error::Other(
            "a mark holds a value that is not a number".into(),
        ));
    }
    let text = format!("{:.3}", value.clamp(-MAX_NUMBER, MAX_NUMBER));
    let text = text.trim_end_matches('0').trim_end_matches('.');
    Ok(match text {
        "" | "-" | "-0" => "0".to_string(),
        other => other.to_string(),
    })
}

fn rgb(color: &Color) -> String {
    format!("rgb({},{},{})", color[0], color[1], color[2])
}

/// A stroke width: none below zero.
fn stroke_width(width: f64) -> Result<String> {
    number(width.max(0.0))
}

/// The left, top, width and height of an area, whichever way it was drawn.
fn bounds(area: &Area) -> Result<[f64; 4]> {
    for value in [area.x, area.y, area.width, area.height] {
        number(value)?;
    }
    Ok([
        area.x.min(area.x + area.width),
        area.y.min(area.y + area.height),
        area.width.abs(),
        area.height.abs(),
    ]
    .map(|value| value.clamp(-MAX_NUMBER, MAX_NUMBER)))
}

/// The end of a rectangle or ellipse element: its fill and its stroke.
fn paint(color: &Color, width: f64, filled: bool) -> Result<String> {
    let fill = if filled { rgb(color) } else { "none".into() };
    Ok(format!(
        r#" fill="{fill}" stroke="{}" stroke-width="{}"/>"#,
        rgb(color),
        stroke_width(width)?
    ))
}

fn polyline(points: &[[f64; 2]], color: &Color, width: f64, cap: &str) -> Result<String> {
    if points.is_empty() {
        return Ok(String::new());
    }
    let list = points
        .iter()
        .map(|[x, y]| Ok(format!("{},{}", number(*x)?, number(*y)?)))
        .collect::<Result<Vec<_>>>()?
        .join(" ");
    Ok(format!(
        r#"<polyline points="{list}" fill="none" stroke="{}" stroke-width="{}" stroke-linecap="{cap}" stroke-linejoin="round"/>"#,
        rgb(color),
        stroke_width(width)?
    ))
}

fn line(from: [f64; 2], to: [f64; 2], color: &Color, width: f64) -> Result<String> {
    Ok(format!(
        r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="{}" stroke-linecap="round"/>"#,
        number(from[0])?,
        number(from[1])?,
        number(to[0])?,
        number(to[1])?,
        rgb(color),
        stroke_width(width)?
    ))
}

fn arrow(from: [f64; 2], to: [f64; 2], color: &Color, width: f64) -> Result<String> {
    for value in from.iter().chain(&to).chain([&width]) {
        number(*value)?;
    }
    let (dx, dy) = (to[0] - from[0], to[1] - from[1]);
    let length = dx.hypot(dy);
    if length <= f64::EPSILON {
        return Ok(String::new());
    }
    let (ux, uy) = (dx / length, dy / length);
    let head = (4.0 * width.max(0.0)).max(12.0);
    let half_base = 0.375 * head;
    let base = [to[0] - ux * head, to[1] - uy * head];
    let left = [base[0] - uy * half_base, base[1] + ux * half_base];
    let right = [base[0] + uy * half_base, base[1] - ux * half_base];
    let point = |p: [f64; 2]| Ok::<_, Error>(format!("{},{}", number(p[0])?, number(p[1])?));
    Ok(format!(
        r#"{}<polygon points="{} {} {}" fill="{}"/>"#,
        line(from, base, color, width)?,
        point(to)?,
        point(left)?,
        point(right)?,
        rgb(color)
    ))
}

fn lines(at: [f64; 2], text: &str, color: &Color, size: f64) -> Result<String> {
    let (x, top) = (number(at[0])?, at[1]);
    number(top)?;
    number(size)?;
    let size = size.min(MAX_NUMBER);
    if size <= 0.0 {
        return Ok(String::new());
    }
    let mut out = String::new();
    for (index, line) in text.split('\n').enumerate() {
        let line = escape(line);
        if line.is_empty() {
            continue;
        }
        let baseline = top + size + index as f64 * 1.25 * size;
        out.push_str(&format!(
            r#"<text x="{x}" y="{}" font-family="{FONT}" font-weight="600" font-size="{}" fill="{}" xml:space="preserve">{line}</text>"#,
            number(baseline)?,
            number(size)?,
            rgb(color)
        ));
    }
    Ok(out)
}

/// Text for XML: the five special characters as entities, and the characters XML 1.0 cannot hold
/// (controls other than tab, U+FFFE, U+FFFF) left out.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\t' => out.push(c),
            c if c < ' ' || c == '\u{FFFE}' || c == '\u{FFFF}' => {}
            c => out.push(c),
        }
    }
    out
}

/// The SVG drawn on a transparent `width` × `height` pixmap at `scale`, with the system fonts and
/// no way to load an image.
fn render(svg: &str, width: u32, height: u32, scale: f64) -> Result<Pixmap> {
    let options = usvg::Options {
        fontdb: super::super::svg::fonts(),
        image_href_resolver: ImageHrefResolver {
            resolve_data: Box::new(|_, _, _| None),
            resolve_string: Box::new(|_, _| None),
        },
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_str(svg, &options)
        .map_err(|error| Error::Other(format!("the marks could not be drawn: {error}")))?;
    let mut pixmap = Pixmap::new(width, height)
        .ok_or_else(|| Error::Limit(format!("a canvas of {width}×{height} pixels")))?;
    let scale = scale as f32;
    resvg::render(
        &tree,
        Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    Ok(pixmap)
}

/// Lays premultiplied overlay pixels over the straight-alpha canvas. Where the overlay is empty,
/// the picture stays exactly as it was.
fn over(canvas: &mut RgbaImage, overlay: &[u8]) {
    let pixels = canvas.as_chunks_mut::<4>().0.iter_mut();
    for (pixel, top) in pixels.zip(overlay.as_chunks::<4>().0) {
        if top[3] == 0 {
            continue;
        }
        let top_alpha = f32::from(top[3]) / 255.0;
        let under = f32::from(pixel[3]) / 255.0 * (1.0 - top_alpha);
        let alpha = top_alpha + under;
        for channel in 0..3 {
            let value = (f32::from(top[channel]) + f32::from(pixel[channel]) * under) / alpha;
            pixel[channel] = value.round().clamp(0.0, 255.0) as u8;
        }
        pixel[3] = (alpha * 255.0).round().clamp(0.0, 255.0) as u8;
    }
}
