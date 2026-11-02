// SPDX-License-Identifier: MIT
//! Kento's engines: every conversion and tool. Most need nothing outside Kento; media runs FFmpeg,
//! image metadata ExifTool and office documents LibreOffice, each downloaded on request or found
//! on the computer, and background removal loads ONNX Runtime and its model, downloaded on request.
//!
//! The crate knows nothing about windows, settings or the job queue. The app hands it paths that
//! it has already claimed (see the app's `jobs::naming`), options and a progress handle, and runs
//! it on a blocking thread. Format ids are the catalog's ids (`jpg`, `tar-gz`, …).

pub mod archive;
pub mod bgremove;
pub mod compress;
mod error;
pub mod image;
pub mod media;
pub mod metadata;
pub mod ocr;
pub mod office;
pub mod pdf;
mod process;
pub mod qr;
pub mod recipe;
pub mod sheet;
pub mod subtitle;
pub mod text;
pub mod thumb;
pub mod web;

use std::path::{Path, PathBuf};

pub use error::{Codec, Error, Result, WebProblem};

/// The kinds of file the tools that take several kinds tell apart (Compress, Metadata).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Image,
    Video,
    Audio,
    Pdf,
}

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
    /// Video → GIF: the widest the picture gets, in pixels (a narrower video keeps its width)...
    pub gif_width: u32,
    /// ...and its frames a second.
    pub gif_fps: u32,
    /// The bit rate of the sound written by a conversion, in kbit/s. None keeps each encoder's
    /// usual rate (MP3 at LAME's variable quality 2, about 190 kbit/s; AAC at 192 kbit/s) and
    /// copies sound the output holds as it is.
    pub audio_kbps: Option<u32>,
    /// The sizes inside a written ICO.
    pub ico_sizes: Vec<u32>,
    /// Safety limits for archives.
    pub archive_limits: archive::Limits,
    /// The external tools found or installed on this computer.
    pub tools: Tools,
    /// LibreOffice's user profile, kept between jobs so only the first start is slow. Office jobs
    /// run one at a time, so they can share it; without one each job makes its own in `temp`.
    pub office_profile: Option<PathBuf>,
    /// Keeps LibreOffice running between office jobs with `office_profile` (the app, which ends it
    /// with `office::shutdown` as it quits); otherwise each job starts and ends it (the command
    /// line). Without a profile it is never kept.
    pub keep_office: bool,
}

/// Where the external tools are (SPEC 4.2): downloaded on request or found on the system. Engines
/// that need a missing one fail with `Error::MissingCodec`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tools {
    pub ffmpeg: Option<PathBuf>,
    pub ffprobe: Option<PathBuf>,
    pub exiftool: Option<PathBuf>,
    /// LibreOffice's `soffice` program (`soffice.exe` on Windows).
    pub soffice: Option<PathBuf>,
    /// yt-dlp, for web downloads (`yt-dlp.exe` on Windows, `yt-dlp_macos` installed as `yt-dlp`).
    pub ytdlp: Option<PathBuf>,
    /// Deno, the JavaScript runtime yt-dlp needs for YouTube.
    pub deno: Option<PathBuf>,
    /// ONNX Runtime's library (`onnxruntime.dll`, `libonnxruntime.<version>.dylib`), loaded into
    /// Kento for background removal.
    pub onnxruntime: Option<PathBuf>,
    /// The background-removal model (`bgremove::MODEL_FILE`).
    pub bg_model: Option<PathBuf>,
}

impl Tools {
    pub fn ffmpeg(&self) -> Result<&Path> {
        self.ffmpeg
            .as_deref()
            .ok_or(Error::MissingCodec(Codec::Ffmpeg))
    }

    pub fn ffprobe(&self) -> Result<&Path> {
        self.ffprobe
            .as_deref()
            .ok_or(Error::MissingCodec(Codec::Ffmpeg))
    }

    pub fn exiftool(&self) -> Result<&Path> {
        self.exiftool
            .as_deref()
            .ok_or(Error::MissingCodec(Codec::ExifTool))
    }

    pub fn ytdlp(&self) -> Result<&Path> {
        self.ytdlp
            .as_deref()
            .ok_or(Error::MissingCodec(Codec::YtDlp))
    }

    pub fn deno(&self) -> Result<&Path> {
        self.deno
            .as_deref()
            .ok_or(Error::MissingCodec(Codec::YtDlp))
    }

    pub fn soffice(&self) -> Result<&Path> {
        self.soffice
            .as_deref()
            .ok_or(Error::MissingCodec(Codec::LibreOffice))
    }

    pub fn onnxruntime(&self) -> Result<&Path> {
        self.onnxruntime
            .as_deref()
            .ok_or(Error::MissingCodec(Codec::BackgroundRemoval))
    }

    pub fn bg_model(&self) -> Result<&Path> {
        self.bg_model
            .as_deref()
            .ok_or(Error::MissingCodec(Codec::BackgroundRemoval))
    }
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
            gif_width: 480,
            gif_fps: 12,
            audio_kbps: None,
            ico_sizes: vec![16, 24, 32, 48, 64, 128, 256],
            archive_limits: archive::Limits::default(),
            tools: Tools::default(),
            office_profile: None,
            keep_office: false,
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
        Engine::Media => media::output(from, to),
        Engine::Office => office::output(from, to),
    })
}

/// Whether the route runs LibreOffice, which the job queue runs one job at a time (SPEC 5.13).
pub fn heavy(from: &str, to: &str) -> bool {
    engine_for(from, to) == Some(Engine::Office)
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
        Engine::Media => media::convert(job),
        Engine::Office => office::convert(job),
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
    Media,
    Office,
}

fn engine_for(from: &str, to: &str) -> Option<Engine> {
    // PDF input goes to the PDF engine; image input (including image → PDF) to the image engine.
    // LibreOffice comes last: it takes only what no engine inside Kento does.
    [
        (Engine::Pdf, pdf::supports(from, to)),
        (Engine::Image, image::supports(from, to)),
        (Engine::Archive, archive::supports(from, to)),
        (Engine::Text, text::supports(from, to)),
        (Engine::Subtitle, subtitle::supports(from, to)),
        (Engine::Sheet, sheet::supports(from, to)),
        (Engine::Media, media::supports(from, to)),
        (Engine::Office, office::supports(from, to)),
    ]
    .into_iter()
    .find_map(|(engine, yes)| yes.then_some(engine))
}
