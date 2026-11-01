// SPDX-License-Identifier: MIT
//! Kento's local engines: every conversion and tool that needs no downloaded tool.
//!
//! The crate knows nothing about windows, settings or the job queue. The app hands it paths that
//! it has already claimed (see the app's `jobs::naming`), options and a progress handle, and runs
//! it on a blocking thread. Format ids are the catalog's ids (`jpg`, `tar-gz`, …).

pub mod archive;
mod error;
pub mod image;
pub mod pdf;
pub mod qr;
pub mod sheet;
pub mod subtitle;
pub mod text;
pub mod thumb;

use std::path::{Path, PathBuf};

pub use error::{Codec, Error, Result};

/// What a conversion writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Output {
    /// One file: the caller passes the path to create.
    File,
    /// Several files (pages, extracted entries): the caller passes a new, empty folder.
    Folder,
}

/// Progress and cancellation for one job. Engines call `check` between steps and `report` when
/// they can tell how far they are.
pub struct Progress<'a> {
    report: &'a (dyn Fn(Option<f32>) + Sync),
    cancelled: &'a (dyn Fn() -> bool + Sync),
}

impl<'a> Progress<'a> {
    pub fn new(
        report: &'a (dyn Fn(Option<f32>) + Sync),
        cancelled: &'a (dyn Fn() -> bool + Sync),
    ) -> Self {
        Self { report, cancelled }
    }

    /// For tests and callers that do not track progress.
    pub fn none() -> Progress<'static> {
        Progress {
            report: &|_| {},
            cancelled: &|| false,
        }
    }

    /// 0 to 1.
    pub fn report(&self, fraction: f32) {
        (self.report)(Some(fraction.clamp(0.0, 1.0)));
    }

    pub fn is_cancelled(&self) -> bool {
        (self.cancelled)()
    }

    /// Stops the engine with `Error::Cancelled` once the job is cancelled.
    pub fn check(&self) -> Result<()> {
        if self.is_cancelled() {
            Err(Error::Cancelled)
        } else {
            Ok(())
        }
    }
}

/// Settings that shape the output. The defaults are what the wheel uses.
#[derive(Debug, Clone)]
pub struct Options {
    /// 1 to 100.
    pub jpeg_quality: u8,
    /// 1 to 100; WEBP is written lossy from photos and lossless from PNG, GIF and BMP.
    pub webp_quality: u8,
    /// 1 to 100.
    pub avif_quality: u8,
    /// 1 (slowest, smallest) to 10 (fastest).
    pub avif_speed: u8,
    /// Fills transparent pixels for formats without alpha (JPG, BMP, PDF pages).
    pub background: [u8; 3],
    /// Pixel density for PDF pages turned into images.
    pub page_dpi: u16,
    /// The sizes inside a written ICO.
    pub ico_sizes: Vec<u32>,
    /// Safety limits for archives.
    pub archive_limits: archive::Limits,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            jpeg_quality: 90,
            webp_quality: 85,
            avif_quality: 75,
            avif_speed: 7,
            background: [255, 255, 255],
            page_dpi: 150,
            ico_sizes: vec![16, 24, 32, 48, 64, 128, 256],
            archive_limits: archive::Limits::default(),
        }
    }
}

/// One conversion from the Convert wheel.
pub struct Conversion<'a> {
    pub input: &'a Path,
    /// The catalog id of the input format.
    pub from: &'a str,
    /// The catalog id of the output format.
    pub to: &'a str,
    /// The file to create for `Output::File`, or an empty folder to fill for `Output::Folder`.
    pub dest: &'a Path,
    /// A private scratch folder for this job; the app deletes it when the job ends.
    pub temp: &'a Path,
    pub options: &'a Options,
    pub progress: &'a Progress<'a>,
}

/// Whether the engines can do this route on this platform.
pub fn supports(from: &str, to: &str) -> bool {
    engine_for(from, to).is_some()
}

/// What the route writes; `None` when no engine does the route.
pub fn output(from: &str, to: &str) -> Option<Output> {
    Some(match engine_for(from, to)? {
        Engine::Image => image::output(from, to),
        Engine::Pdf => pdf::output(from, to),
        Engine::Archive => archive::output(from, to),
        Engine::Text => Output::File,
        Engine::Subtitle => Output::File,
        Engine::Sheet => Output::File,
    })
}

/// Runs a conversion and returns the files it wrote: the destination file, or the files inside
/// the destination folder.
pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    let unsupported = || Error::Unsupported {
        from: job.from.to_owned(),
        to: job.to.to_owned(),
    };
    match engine_for(job.from, job.to).ok_or_else(unsupported)? {
        Engine::Image => image::convert(job),
        Engine::Pdf => pdf::convert(job),
        Engine::Archive => archive::convert(job),
        Engine::Text => text::convert(job),
        Engine::Subtitle => subtitle::convert(job),
        Engine::Sheet => sheet::convert(job),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Engine {
    Image,
    Pdf,
    Archive,
    Text,
    Subtitle,
    Sheet,
}

fn engine_for(from: &str, to: &str) -> Option<Engine> {
    // PDF input goes to the PDF engine; image input (including image → PDF) to the image engine.
    [
        (Engine::Pdf, pdf::supports(from, to)),
        (Engine::Image, image::supports(from, to)),
        (Engine::Archive, archive::supports(from, to)),
        (Engine::Text, text::supports(from, to)),
        (Engine::Subtitle, subtitle::supports(from, to)),
        (Engine::Sheet, sheet::supports(from, to)),
    ]
    .into_iter()
    .find_map(|(engine, yes)| yes.then_some(engine))
}
