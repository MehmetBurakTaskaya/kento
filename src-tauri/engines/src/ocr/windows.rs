// SPDX-License-Identifier: MIT
//! Windows.Media.Ocr: the recogniser that comes with Windows 10 and 11. It reads the languages
//! whose language pack brings text recognition (Settings › Time & language › Language & region),
//! and pictures up to `OcrEngine::MaxImageDimension` pixels on a side.

use std::sync::OnceLock;

use image::imageops::{self, FilterType};
use image::RgbaImage;
use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;
use windows::Win32::System::Com::CoIncrementMTAUsage;

use crate::{Codec, Error, Result};

/// Small pictures are enlarged up to this side first: the recogniser misses text only a few
/// pixels high, as in a screenshot of small print.
const ENLARGE_BELOW: u32 = 1200;

fn failed(error: windows::core::Error) -> Error {
    Error::Other(format!("Windows text recognition: {}", error.message()))
}

/// Keeps the process's multithreaded apartment alive, once, for as long as Kento runs. Threads
/// without COM of their own (the engine's) then use it, and the recogniser's factories, which
/// `windows` caches for the whole process, never outlive it: a thread that ended its own COM
/// could take the apartment down with them.
fn apartment() -> Result<()> {
    static MTA: OnceLock<std::result::Result<(), String>> = OnceLock::new();
    MTA.get_or_init(|| {
        // SAFETY: a plain call; its cookie is never released, on purpose.
        unsafe { CoIncrementMTAUsage() }
            .map(|_| ())
            .map_err(|error| error.message())
    })
    .clone()
    .map_err(|message| Error::Other(format!("COM: {message}")))
}

pub(super) fn languages() -> Result<Vec<String>> {
    apartment()?;
    let list = OcrEngine::AvailableRecognizerLanguages().map_err(failed)?;
    let mut tags = Vec::new();
    for index in 0..list.Size().map_err(failed)? {
        let language = list.GetAt(index).map_err(failed)?;
        tags.push(language.LanguageTag().map_err(failed)?.to_string_lossy());
    }
    Ok(tags)
}

/// A recogniser for one language, kept for every page of a file.
pub(super) struct Reader {
    engine: OcrEngine,
    max_side: u32,
}

impl Reader {
    pub(super) fn new(tag: &str) -> Result<Self> {
        if !languages()?.iter().any(|have| have == tag) {
            return Err(Error::MissingCodec(Codec::OcrLanguage));
        }
        let language = Language::CreateLanguage(&HSTRING::from(tag)).map_err(failed)?;
        let engine = OcrEngine::TryCreateFromLanguage(&language)
            .map_err(|_| Error::MissingCodec(Codec::OcrLanguage))?;
        let max_side = OcrEngine::MaxImageDimension().map_err(failed)?.max(64);
        Ok(Self { engine, max_side })
    }

    /// The lines of text, top to bottom as the recogniser orders them.
    pub(super) fn read(&self, rgba: &RgbaImage) -> Result<Vec<String>> {
        let picture = self.sized(super::flatten(rgba));
        let (width, height) = picture.dimensions();
        if width == 0 || height == 0 {
            return Ok(Vec::new());
        }
        // SoftwareBitmap wants BGRA.
        let mut bytes = picture.into_raw();
        for pixel in bytes.as_chunks_mut::<4>().0 {
            pixel.swap(0, 2);
        }
        let writer = DataWriter::new().map_err(failed)?;
        writer.WriteBytes(&bytes).map_err(failed)?;
        let buffer = writer.DetachBuffer().map_err(failed)?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            width as i32,
            height as i32,
        )
        .map_err(failed)?;
        let result = self
            .engine
            .RecognizeAsync(&bitmap)
            .and_then(|operation| operation.join())
            .map_err(failed)?;
        let lines = result.Lines().map_err(failed)?;
        let mut out = Vec::new();
        for index in 0..lines.Size().map_err(failed)? {
            let line = lines.GetAt(index).map_err(failed)?;
            out.push(line.Text().map_err(failed)?.to_string_lossy());
        }
        Ok(out)
    }

    /// Inside the recogniser's limit, and small pictures up to twice as large.
    fn sized(&self, picture: RgbaImage) -> RgbaImage {
        let (width, height) = picture.dimensions();
        let longer = width.max(height).max(1);
        let scale = if longer > self.max_side {
            f64::from(self.max_side) / f64::from(longer)
        } else if longer < ENLARGE_BELOW {
            (f64::from(self.max_side) / f64::from(longer)).min(2.0)
        } else {
            return picture;
        };
        let side = |v: u32| ((f64::from(v) * scale).floor() as u32).max(1);
        imageops::resize(&picture, side(width), side(height), FilterType::CatmullRom)
    }
}
