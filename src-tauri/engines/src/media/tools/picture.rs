// SPDX-License-Identifier: MIT
//! The tools that change a video's picture: Make vertical, Add text or logo, Rotate video,
//! Reverse and loop (in `reverse`), Color and look and Stabilize video.
//!
//! Each keeps the input's format and, where Kento has an encoder for it, its video codec, and
//! copies the sound; Make vertical always writes an H.264/AAC MP4. FFmpeg decodes phone videos
//! upright (it applies their rotation before any filter), so areas and sizes here are those of
//! the picture as it is shown, and the results carry no rotation of their own.

mod base64;
mod color;
mod reverse;

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use ::image::imageops::{self, FilterType};
use ::image::{DynamicImage, ImageFormat};

use super::super::codec::Container;
use super::super::convert::{Audio, Recipe, Video};
use super::super::probe::Kind;
use super::super::run::{self, secs, Cmd};
use super::{even, no_video, times, window, Job, Rect};
use crate::media::{Area, Fill, Grade, Layer, LayerSource, Look, Span, Strength, Turn};
use crate::{Error, Options, Result, Tools};

use color::{ColorMap, LUT_SIDE};

/// Make vertical's frame, and the frame rate it does not go past.
const VERTICAL: (u32, u32) = (1080, 1920);
const MAX_FPS: f64 = 60.0;

/// Names in the job's folder that filters read; FFmpeg runs there, so no path reaches a filter.
const LUT: &str = "look.cube";
const TRANSFORMS: &str = "motion.trf";

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";
/// A layer larger than this many times the frame's side is surely a mistake.
const MAX_LAYER: u32 = 4;

impl Job<'_, '_> {
    /// A 1080 × 1920 H.264/AAC MP4 of `span` (all of it when None), filled as `fill` says, with
    /// the source's frame rate up to 60 and one sound track, stereo at most.
    pub(super) fn make_vertical(
        &self,
        input: &Path,
        span: Option<Span>,
        fill: Fill,
    ) -> Result<Vec<PathBuf>> {
        let mut probe = self.probe(input)?;
        let video = probe.video().ok_or_else(no_video)?.clone();
        let (start, length) = match span {
            Some(span) => window(span, probe.info.duration)?,
            None => (0.0, probe.info.duration),
        };
        let mut chain = Vec::new();
        if video.fps > MAX_FPS {
            chain.push(format!("fps={MAX_FPS}"));
        }
        chain.push(vertical(fill, video.width, video.height));
        // Short-video apps take one sound track; surround is folded to stereo for them.
        let first = probe.audio().map(|audio| audio.index);
        probe
            .streams
            .retain(|stream| stream.kind == Kind::Video || Some(stream.index) == first);
        let fold = probe
            .audio()
            .filter(|audio| audio.channels > 2)
            .map(|_| "aformat=channel_layouts=stereo".to_owned());
        let recipe = Recipe {
            container: Container::Mp4,
            video: Video::Encode {
                keep_codec: false,
                filter: Some(chain.join(",")),
            },
            audio: Audio::Encode {
                keep_codec: false,
                filter: fold,
            },
            subtitles: false,
            graph: None,
        };
        let mut cmd = Cmd::new();
        if start > 0.0 {
            cmd.args(["-ss", &secs(start)]);
        }
        cmd.input(input);
        let after = if span.is_some() {
            vec!["-t".to_owned(), secs(length)]
        } else {
            Vec::new()
        };
        self.encode(
            cmd,
            &probe,
            &recipe,
            &after,
            self.run.dest,
            self.watch(length),
        )?;
        Ok(self.dest())
    }

    /// Pictures over the video: the page's text as PNG files and the user's own pictures, each
    /// written into the job's folder at its size on the frame and laid over it there.
    pub(super) fn add_overlay(&self, input: &Path, layers: &[Layer]) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let video = probe.video().ok_or_else(no_video)?;
        let frame = (video.width, video.height);
        let mut placed = Vec::new();
        for layer in layers {
            self.run.progress.check()?;
            let Some(place) = Placement::of(layer, frame, probe.info.duration) else {
                continue;
            };
            let name = format!("layer-{}.png", placed.len() + 1);
            picture_into(
                &layer.source,
                (place.w, place.h),
                &self.run.temp.join(&name),
                self.run.tools,
            )?;
            placed.push((name, place));
        }
        if placed.is_empty() {
            return Err(Error::Other(
                "there is nothing to lay over the video".into(),
            ));
        }
        let recipe = Recipe {
            container: self.container(input, &probe)?,
            video: Video::Encode {
                keep_codec: true,
                filter: Some(overlays(&placed)),
            },
            audio: Audio::Copy,
            subtitles: true,
            graph: None,
        };
        let mut cmd = Cmd::new();
        cmd.in_dir(self.run.temp).input(input);
        self.encode(
            cmd,
            &probe,
            &recipe,
            &[],
            self.run.dest,
            self.watch(probe.info.duration),
        )?;
        Ok(self.dest())
    }

    pub(super) fn rotate(
        &self,
        input: &Path,
        turn: Turn,
        mirror: bool,
        flip: bool,
    ) -> Result<Vec<PathBuf>> {
        let filter = orientation(turn, mirror, flip)
            .ok_or_else(|| Error::Other("the picture would stay as it is".into()))?;
        let probe = self.probe(input)?;
        probe.video().ok_or_else(no_video)?;
        self.filter(
            input,
            &probe,
            Video::Encode {
                keep_codec: true,
                filter: Some(filter.to_owned()),
            },
            Audio::Copy,
            true,
            probe.info.duration,
        )
    }

    /// The look and the sliders as one colour map, applied through a LUT the job writes.
    pub(super) fn color(&self, input: &Path, look: Look, grade: Grade) -> Result<Vec<PathBuf>> {
        let map = ColorMap::of(look, grade);
        if map.is_identity() {
            return Err(Error::Other("the colours would stay as they are".into()));
        }
        let probe = self.probe(input)?;
        probe.video().ok_or_else(no_video)?;
        fs::write(self.run.temp.join(LUT), map.cube(LUT_SIDE))?;
        let recipe = Recipe {
            container: self.container(input, &probe)?,
            video: Video::Encode {
                keep_codec: true,
                filter: Some(format!("lut3d=file={LUT}:interp=tetrahedral")),
            },
            audio: Audio::Copy,
            subtitles: true,
            graph: None,
        };
        let mut cmd = Cmd::new();
        cmd.in_dir(self.run.temp).input(input);
        self.encode(
            cmd,
            &probe,
            &recipe,
            &[],
            self.run.dest,
            self.watch(probe.info.duration),
        )?;
        Ok(self.dest())
    }

    /// Two passes of vid.stab (ARCHITECTURE 57): the first measures the shake into a file in the
    /// job's folder, the second smooths the camera's path and zooms in just enough that the
    /// moving edges stay out of the picture. Without vid.stab, FFmpeg's own `deshake` with a
    /// fixed zoom of the same purpose.
    pub(super) fn stabilize(&self, input: &Path, strength: Strength) -> Result<Vec<PathBuf>> {
        let probe = self.probe(input)?;
        let video = probe.video().ok_or_else(no_video)?;
        let duration = probe.info.duration;
        let watch = self.watch(duration);
        let vidstab = run::has_filter(self.ffmpeg, "vidstabdetect")
            && run::has_filter(self.ffmpeg, "vidstabtransform");
        let (filter, write) = if vidstab {
            let mut cmd = Cmd::new();
            cmd.in_dir(self.run.temp)
                .input(input)
                .map(video.index)
                .arg("-filter:v:0")
                .arg(detect(strength))
                .args(["-f", "null", "-"]);
            run::run(self.ffmpeg, &cmd, watch.part(0.0, 0.45, duration))?;
            (transform(strength), watch.part(0.45, 1.0, duration))
        } else {
            (deshake(strength, video.width, video.height), watch)
        };
        let recipe = Recipe {
            container: self.container(input, &probe)?,
            video: Video::Encode {
                keep_codec: true,
                filter: Some(filter),
            },
            audio: Audio::Copy,
            subtitles: true,
            graph: None,
        };
        let mut cmd = Cmd::new();
        cmd.in_dir(self.run.temp).input(input);
        self.encode(cmd, &probe, &recipe, &[], self.run.dest, write)?;
        Ok(self.dest())
    }
}

/// Make vertical's filters for a picture of `width` × `height` (as shown).
fn vertical(fill: Fill, width: u32, height: u32) -> String {
    let (w, h) = VERTICAL;
    let fit = format!(
        "scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos"
    );
    match fill {
        Fill::Crop { center } => {
            let Rect { x, y, w: cw, h: ch } = portrait(center, width, height);
            format!("crop={cw}:{ch}:{x}:{y},scale={w}:{h}:flags=lanczos,setsar=1")
        }
        // The background is blurred small (a quarter of the size) and enlarged: much faster than
        // a blur of the same strength at full size, and as smooth.
        Fill::Blur => {
            let (bw, bh) = (w / 4, h / 4);
            format!(
                "split=2[back][front];\
                 [back]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},\
                 gblur=sigma=10,eq=brightness=-0.08,scale={w}:{h},setsar=1[blurred];\
                 [front]{fit},setsar=1[picture];\
                 [blurred][picture]overlay=x=(W-w)/2:y=(H-h)/2"
            )
        }
        Fill::Color { rgb: [r, g, b] } => {
            format!("{fit},pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x{r:02X}{g:02X}{b:02X},setsar=1")
        }
    }
}

/// The 9:16 window of Make vertical's crop on even pixels: the full height with its middle at
/// `center` of the width (0 the left edge, 1 the right), or on a picture narrower than 9:16 the
/// full width in the middle of the height.
fn portrait(center: f64, width: u32, height: u32) -> Rect {
    let (fw, fh) = (f64::from(width), f64::from(height));
    if fw * 16.0 > fh * 9.0 {
        let w = even(fh * 9.0 / 16.0).max(2);
        let center = if center.is_finite() {
            center.clamp(0.0, 1.0)
        } else {
            0.5
        };
        let left = (center * fw - f64::from(w) / 2.0).clamp(0.0, fw - f64::from(w));
        Rect {
            x: even(left),
            y: 0,
            w,
            h: even(fh).max(2),
        }
    } else {
        let h = even(fw * 16.0 / 9.0).clamp(2, even(fh).max(2));
        Rect {
            x: 0,
            y: even((fh - f64::from(h)) / 2.0),
            w: even(fw).max(2),
            h,
        }
    }
}

/// Where a layer goes on the frame, in whole pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Placement {
    x: i64,
    y: i64,
    w: u32,
    h: u32,
    opacity: f64,
    span: Option<(f64, f64)>,
}

impl Placement {
    /// None for a layer that would not show: off the frame, invisible or outside the video's
    /// time.
    fn of(layer: &Layer, (width, height): (u32, u32), duration: f64) -> Option<Placement> {
        let Area {
            x,
            y,
            width: w,
            height: h,
        } = layer.area;
        if ![x, y, w, h, layer.opacity].iter().all(|v| v.is_finite()) {
            return None;
        }
        let largest = |side: u32| f64::from(side.max(1) * MAX_LAYER);
        let w = w.round().clamp(0.0, largest(width)) as u32;
        let h = h.round().clamp(0.0, largest(height)) as u32;
        let (x, y) = (x.round() as i64, y.round() as i64);
        let inside = w > 0
            && h > 0
            && x < i64::from(width)
            && y < i64::from(height)
            && x + i64::from(w) > 0
            && y + i64::from(h) > 0;
        let opacity = layer.opacity.clamp(0.0, 1.0);
        let span = match layer.span {
            Some(span) => Some(times(span, duration)?),
            None => None,
        };
        (inside && opacity >= 0.005).then_some(Placement {
            x,
            y,
            w,
            h,
            opacity,
            span,
        })
    }
}

/// Writes a layer's picture as a PNG of `size` pixels, upright.
fn picture_into(
    source: &LayerSource,
    (w, h): (u32, u32),
    dest: &Path,
    tools: &Tools,
) -> Result<()> {
    let damaged = || Error::Other("a text layer's picture is damaged".into());
    let picture: DynamicImage = match source {
        LayerSource::Picture { png } => {
            let bytes = base64::decode(png).ok_or_else(damaged)?;
            if !bytes.starts_with(PNG) {
                return Err(damaged());
            }
            ::image::load_from_memory_with_format(&bytes, ImageFormat::Png)
                .map_err(|_| damaged())?
        }
        LayerSource::Image { path } => {
            let from = path
                .extension()
                .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
                .map(|ext| match ext.as_str() {
                    "jpeg" | "jpe" => "jpg".to_owned(),
                    "tif" => "tiff".to_owned(),
                    _ => ext,
                })
                .unwrap_or_default();
            let options = Options {
                tools: tools.clone(),
                ..Options::default()
            };
            crate::image::decode(path, &from, &options)?
        }
    };
    let rgba = picture.into_rgba8();
    let sized = if rgba.dimensions() == (w, h) {
        rgba
    } else {
        imageops::resize(&rgba, w, h, FilterType::Lanczos3)
    };
    sized
        .save_with_format(dest, ImageFormat::Png)
        .map_err(|error| Error::Other(format!("a layer could not be written: {error}")))
}

/// The filters that lay the PNG files over the picture, the first at the bottom. Each is read by
/// a `movie` source by its plain name in the job's folder.
fn overlays(layers: &[(String, Placement)]) -> String {
    let mut graph = String::new();
    for (i, (name, place)) in layers.iter().enumerate() {
        let _ = write!(graph, "movie={name},format=rgba");
        if place.opacity < 0.999 {
            let _ = write!(graph, ",colorchannelmixer=aa={:.3}", place.opacity);
        }
        let _ = write!(graph, "[l{i}];");
    }
    for (i, (_, place)) in layers.iter().enumerate() {
        let below = if i == 0 {
            "[in]".to_owned()
        } else {
            format!("[o{i}]")
        };
        let _ = write!(
            graph,
            "{below}[l{i}]overlay=x={}:y={}:format=auto",
            place.x, place.y
        );
        if let Some((start, end)) = place.span {
            let _ = write!(graph, ":enable='between(t,{start:.3},{end:.3})'");
        }
        // The last overlay's output is the graph's, so a filter after it simply follows.
        if i + 1 < layers.len() {
            let _ = write!(graph, "[o{}];", i + 1);
        }
    }
    graph
}

/// A turn, then a mirror (left and right swap), then a flip (upside down), as the filters that
/// do all of them at once; None when they cancel out.
fn orientation(turn: Turn, mirror: bool, flip: bool) -> Option<&'static str> {
    // Where a point (x, y) of the picture goes, on screen axes (y down): (ax + by, cx + dy) for
    // [[a, b], [c, d]].
    type Matrix = [[i8; 2]; 2];
    fn then(first: Matrix, next: Matrix) -> Matrix {
        let mut out = [[0; 2]; 2];
        for (i, row) in out.iter_mut().enumerate() {
            for (j, cell) in row.iter_mut().enumerate() {
                *cell = next[i][0] * first[0][j] + next[i][1] * first[1][j];
            }
        }
        out
    }
    const MIRROR: Matrix = [[-1, 0], [0, 1]];
    const FLIP: Matrix = [[1, 0], [0, -1]];
    let mut matrix: Matrix = match turn {
        Turn::None => [[1, 0], [0, 1]],
        Turn::Right => [[0, -1], [1, 0]],
        Turn::Half => [[-1, 0], [0, -1]],
        Turn::Left => [[0, 1], [-1, 0]],
    };
    if mirror {
        matrix = then(matrix, MIRROR);
    }
    if flip {
        matrix = then(matrix, FLIP);
    }
    match matrix {
        [[0, -1], [1, 0]] => Some("transpose=clock"),
        [[0, 1], [-1, 0]] => Some("transpose=cclock"),
        [[-1, 0], [0, -1]] => Some("hflip,vflip"),
        [[-1, 0], [0, 1]] => Some("hflip"),
        [[1, 0], [0, -1]] => Some("vflip"),
        // Across the diagonals: the matrix transpose, and the other one.
        [[0, 1], [1, 0]] => Some("transpose=cclock_flip"),
        [[0, -1], [-1, 0]] => Some("transpose=clock_flip"),
        _ => None,
    }
}

/// vid.stab's settings: how shaky the video is taken to be, and over how many frames on each
/// side the camera's path is smoothed.
fn vidstab_settings(strength: Strength) -> (u8, u16) {
    match strength {
        Strength::Light => (4, 10),
        Strength::Medium => (6, 20),
        Strength::Strong => (9, 40),
    }
}

fn detect(strength: Strength) -> String {
    let (shakiness, _) = vidstab_settings(strength);
    format!("vidstabdetect=shakiness={shakiness}:accuracy=15:result={TRANSFORMS}")
}

/// `optzoom=1` zooms in once, as little as keeps every moving edge out of the picture; the
/// light sharpening makes up for the resampling, as vid.stab's authors suggest.
fn transform(strength: Strength) -> String {
    let (_, smoothing) = vidstab_settings(strength);
    format!(
        "vidstabtransform=input={TRANSFORMS}:smoothing={smoothing}:optzoom=1:interpol=bicubic,\
         unsharp=5:5:0.6:3:3:0.3"
    )
}

/// `deshake` searching `reach` pixels each way, then the edges it moves trimmed off and the rest
/// enlarged back to the frame.
fn deshake(strength: Strength, width: u32, height: u32) -> String {
    let reach: u32 = match strength {
        Strength::Light => 16,
        Strength::Medium => 32,
        Strength::Strong => 64,
    };
    let margin = even(f64::from(reach.min(width / 10).min(height / 10)));
    let mut filter = format!("deshake=rx={reach}:ry={reach}:edge=mirror");
    if margin >= 2 {
        let _ = write!(
            filter,
            ",crop={}:{}:{margin}:{margin},scale={width}:{height}:flags=bicubic,setsar=1",
            width - 2 * margin,
            height - 2 * margin
        );
    }
    filter
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crops_a_portrait_window() {
        // A 1920 × 1080 picture: a window 606 wide at full height.
        let at = |center| portrait(center, 1920, 1080);
        assert_eq!(
            at(0.5),
            Rect {
                x: 656,
                y: 0,
                w: 606,
                h: 1080
            }
        );
        assert_eq!(at(0.0).x, 0);
        assert_eq!(at(1.0).x, 1920 - 606);
        assert_eq!(at(f64::NAN), at(0.5));
        // Already 9:16, and narrower than that.
        assert_eq!(
            portrait(0.2, 1080, 1920),
            Rect {
                x: 0,
                y: 0,
                w: 1080,
                h: 1920
            }
        );
        assert_eq!(
            portrait(0.2, 1080, 2400),
            Rect {
                x: 0,
                y: 240,
                w: 1080,
                h: 1920
            }
        );
        // Odd sizes stay on even pixels inside the frame.
        let odd = portrait(1.0, 333, 101);
        assert_eq!((odd.w, odd.h), (56, 100));
        assert!(odd.x.is_multiple_of(2) && odd.x + odd.w <= 333);
    }

    #[test]
    fn builds_vertical_graphs() {
        assert_eq!(
            vertical(Fill::Crop { center: 0.5 }, 1920, 1080),
            "crop=606:1080:656:0,scale=1080:1920:flags=lanczos,setsar=1"
        );
        let blur = vertical(Fill::Blur, 1920, 1080);
        assert!(blur.starts_with("split=2[back][front];[back]scale=270:480"));
        assert!(blur.contains("gblur=sigma=10"));
        assert!(blur.ends_with("[blurred][picture]overlay=x=(W-w)/2:y=(H-h)/2"));
        assert_eq!(
            vertical(Fill::Color { rgb: [255, 8, 0] }, 1920, 1080),
            "scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2:\
             flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0xFF0800,setsar=1"
        );
    }

    #[test]
    fn places_layers_on_the_frame() {
        let layer = |x, y, width, height, opacity, span| Layer {
            source: LayerSource::Picture { png: String::new() },
            area: Area {
                x,
                y,
                width,
                height,
            },
            opacity,
            span,
        };
        let frame = (320, 180);
        assert_eq!(
            Placement::of(&layer(10.4, -5.6, 100.5, 40.0, 0.5, None), frame, 3.0),
            Some(Placement {
                x: 10,
                y: -6,
                w: 101,
                h: 40,
                opacity: 0.5,
                span: None
            })
        );
        let late = Span {
            start: 1.0,
            end: 9.0,
        };
        assert_eq!(
            Placement::of(&layer(0.0, 0.0, 10.0, 10.0, 2.0, Some(late)), frame, 3.0)
                .map(|place| (place.opacity, place.span)),
            Some((1.0, Some((1.0, 3.0))))
        );
        // Off the frame, invisible, after the end, nonsense.
        assert_eq!(
            Placement::of(&layer(320.0, 0.0, 10.0, 10.0, 1.0, None), frame, 3.0),
            None
        );
        assert_eq!(
            Placement::of(&layer(-10.0, 0.0, 10.0, 10.0, 1.0, None), frame, 3.0),
            None
        );
        assert_eq!(
            Placement::of(&layer(0.0, 0.0, 10.0, 10.0, 0.0, None), frame, 3.0),
            None
        );
        let after = Span {
            start: 4.0,
            end: 5.0,
        };
        assert_eq!(
            Placement::of(&layer(0.0, 0.0, 10.0, 10.0, 1.0, Some(after)), frame, 3.0),
            None
        );
        assert_eq!(
            Placement::of(&layer(0.0, 0.0, f64::INFINITY, 10.0, 1.0, None), frame, 3.0),
            None
        );
        let huge = Placement::of(&layer(0.0, 0.0, 1e9, 1e9, 1.0, None), frame, 3.0).unwrap();
        assert_eq!((huge.w, huge.h), (1280, 720));
    }

    #[test]
    fn builds_overlay_graphs() {
        let place = |x, y, opacity, span| Placement {
            x,
            y,
            w: 10,
            h: 10,
            opacity,
            span,
        };
        let graph = overlays(&[
            ("layer-1.png".into(), place(5, -3, 1.0, None)),
            ("layer-2.png".into(), place(20, 30, 0.25, Some((1.0, 2.5)))),
        ]);
        assert_eq!(
            graph,
            "movie=layer-1.png,format=rgba[l0];\
             movie=layer-2.png,format=rgba,colorchannelmixer=aa=0.250[l1];\
             [in][l0]overlay=x=5:y=-3:format=auto[o1];\
             [o1][l1]overlay=x=20:y=30:format=auto:enable='between(t,1.000,2.500)'"
        );
    }

    #[test]
    fn turns_with_the_fewest_filters() {
        use Turn::*;
        assert_eq!(orientation(None, false, false), Option::None);
        assert_eq!(orientation(Right, false, false), Some("transpose=clock"));
        assert_eq!(orientation(Left, false, false), Some("transpose=cclock"));
        assert_eq!(orientation(Half, false, false), Some("hflip,vflip"));
        assert_eq!(orientation(None, true, false), Some("hflip"));
        assert_eq!(orientation(None, false, true), Some("vflip"));
        // A half turn is a mirror and a flip, so all three cancel out.
        assert_eq!(orientation(Half, true, true), Option::None);
        assert_eq!(orientation(None, true, true), Some("hflip,vflip"));
        assert_eq!(
            orientation(Right, true, false),
            Some("transpose=cclock_flip")
        );
        assert_eq!(orientation(Left, true, false), Some("transpose=clock_flip"));
        assert_eq!(
            orientation(Right, false, true),
            Some("transpose=clock_flip")
        );
        assert_eq!(orientation(Right, true, true), Some("transpose=cclock"));
    }

    #[test]
    fn stabilizes_in_three_strengths() {
        assert_eq!(
            detect(Strength::Medium),
            "vidstabdetect=shakiness=6:accuracy=15:result=motion.trf"
        );
        assert!(transform(Strength::Strong)
            .starts_with("vidstabtransform=input=motion.trf:smoothing=40:optzoom=1"));
        assert_eq!(
            deshake(Strength::Light, 1920, 1080),
            "deshake=rx=16:ry=16:edge=mirror,crop=1888:1048:16:16,scale=1920:1080:flags=bicubic,\
             setsar=1"
        );
        // A small picture loses no more than a tenth of each side.
        assert!(deshake(Strength::Strong, 320, 180).contains("crop=284:144:18:18"));
        assert_eq!(
            deshake(Strength::Light, 16, 16),
            "deshake=rx=16:ry=16:edge=mirror"
        );
    }

    /// FFmpeg from `KENTO_FFMPEG` or the PATH, as the media checks find it.
    fn ffmpeg() -> Option<PathBuf> {
        let exe = if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        };
        let found = std::env::var_os("KENTO_FFMPEG")
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .or_else(|| {
                std::env::split_paths(&std::env::var_os("PATH")?)
                    .map(|dir| dir.join(exe))
                    .find(|path| path.is_file())
            });
        let required = std::env::var("KENTO_REQUIRE_FFMPEG").is_ok_and(|v| v == "1");
        assert!(
            found.is_some() || !required,
            "KENTO_REQUIRE_FFMPEG=1 but FFmpeg is missing"
        );
        found
    }

    /// A build with vid.stab never takes the other way, so its filters run here on their own, on
    /// an odd size and with the even crop the encoders add after them.
    #[test]
    fn deshake_runs_where_vidstab_is_missing() {
        let Some(ffmpeg) = ffmpeg() else { return };
        for strength in [Strength::Light, Strength::Medium, Strength::Strong] {
            let filter = format!(
                "{},{}",
                deshake(strength, 321, 181),
                super::super::super::convert::EVEN
            );
            let output = std::process::Command::new(&ffmpeg)
                .args([
                    "-hide_banner",
                    "-nostdin",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                ])
                .arg("testsrc2=s=321x181:r=25:d=1")
                .args(["-vf", &filter, "-f", "null", "-"])
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{strength:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
}
