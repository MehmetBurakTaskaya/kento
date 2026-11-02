// SPDX-License-Identifier: MIT
//! Compress (SPEC 5.5): one job per file, each kept in its own format.

use std::path::{Path, PathBuf};

use kento_engines::compress::{self, CompressRun, Compression};
use kento_engines::{FileKind, Options};
use tauri::{AppHandle, State, WebviewWindow};

use crate::catalog::{self, Category, Format};
use crate::error::{Error, Result};
use crate::jobs::engine::{Target, Work};
use crate::jobs::naming::file_name;
use crate::library::Origin;
use crate::work::{stem_of, Context};
use crate::AppState;

/// Compresses images, video, audio and PDF files, one job each, and returns the job ids.
#[tauri::command]
pub fn run_compress(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    compression: Compression,
    paths: Vec<PathBuf>,
) -> Result<Vec<u64>> {
    check(compression)?;
    if paths.is_empty() {
        return Err(Error::Invalid("no files".into()));
    }
    let files = paths
        .into_iter()
        .map(|path| compressible(&path).map(|(format, kind)| (path, format, kind)))
        .collect::<Result<Vec<_>>>()?;
    let ctx = Context::new(&app, &state)?;
    let ids: Vec<u64> = files
        .into_iter()
        .map(|(path, format, kind)| submit(&ctx, compression, path, format, kind))
        .collect();
    crate::actions::watch(&window, &state, &ids);
    Ok(ids)
}

/// The ranges the page offers; anything else is refused before a job starts.
fn check(compression: Compression) -> Result<()> {
    let fine = match compression {
        Compression::Quality { level } => (1..=100).contains(&level),
        Compression::Ratio { percent } => (5..=95).contains(&percent),
        Compression::Size { bytes } => bytes > 0,
    };
    if fine {
        Ok(())
    } else {
        Err(Error::Invalid(format!("{compression:?} is out of range")))
    }
}

/// The catalog format and the engine's kind of a file Compress takes.
pub(crate) fn compressible(path: &Path) -> Result<(&'static Format, FileKind)> {
    let format = path
        .is_file()
        .then(|| path.extension())
        .flatten()
        .and_then(|ext| catalog::format_for_extension(&ext.to_string_lossy()))
        .ok_or_else(|| Error::Invalid("not a file Kento can read".into()))?;
    let kind = match format.category {
        Category::Image => FileKind::Image,
        Category::Video => FileKind::Video,
        Category::Audio => FileKind::Audio,
        Category::Pdf => FileKind::Pdf,
        _ => {
            return Err(Error::Invalid(
                "Compress takes images, video, audio and PDF".into(),
            ))
        }
    };
    Ok((format, kind))
}

fn submit(
    ctx: &Context,
    compression: Compression,
    source: PathBuf,
    format: &'static Format,
    kind: FileKind,
) -> u64 {
    let title = format!(
        "{} · {}",
        ctx.text("tool.compress"),
        source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    let (target, work) = job(
        source.clone(),
        (format, kind),
        compression,
        ctx.dir_for(&source),
        &ctx.text("suffix.compress"),
        ctx.tools(),
    );
    ctx.submit(title, target, work, Origin::Tool, Some(source))
}

/// One file's output in `dir` ("clip - compressed.mp4", with the suffix in the interface
/// language) and its work, for the job queue and the command line alike.
pub(crate) fn job(
    source: PathBuf,
    (format, kind): (&'static Format, FileKind),
    compression: Compression,
    dir: PathBuf,
    suffix: &str,
    tools: kento_engines::Tools,
) -> (Target, Work) {
    // The result keeps the input's own extension (`.m4v` stays `.m4v`).
    let extension = source
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| format.extensions[0].to_owned());
    let target = Target::File {
        dir,
        stem: file_name(&stem_of(&source), Some(suffix), ""),
        extension,
    };
    let from = format.id;
    let work: Work = Box::new(move |dest, temp, progress| {
        let options = Options {
            tools,
            ..Options::default()
        };
        compress::compress(&CompressRun {
            input: &source,
            from,
            kind,
            compression,
            dest,
            temp,
            options: &options,
            progress,
        })
        .map(|_| ())
    });
    (target, work)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_outside_the_offered_ranges_are_refused() {
        assert!(check(Compression::Quality { level: 1 }).is_ok());
        assert!(check(Compression::Quality { level: 100 }).is_ok());
        assert!(check(Compression::Quality { level: 0 }).is_err());
        assert!(check(Compression::Quality { level: 101 }).is_err());
        assert!(check(Compression::Ratio { percent: 5 }).is_ok());
        assert!(check(Compression::Ratio { percent: 96 }).is_err());
        assert!(check(Compression::Size { bytes: 25 << 20 }).is_ok());
        assert!(check(Compression::Size { bytes: 0 }).is_err());
    }

    #[test]
    fn takes_images_video_audio_and_pdf_only() {
        let dir = tempfile::tempdir().unwrap();
        let file = |name: &str| {
            let path = dir.path().join(name);
            std::fs::write(&path, b"x").unwrap();
            path
        };
        let kind = |name: &str| compressible(&file(name)).map(|(format, kind)| (format.id, kind));
        assert_eq!(
            kind("Kento ğüşıöç 🧪.JPG").unwrap(),
            ("jpg", FileKind::Image)
        );
        assert_eq!(kind("klip.m4v").unwrap(), ("mp4", FileKind::Video));
        assert_eq!(kind("ses.flac").unwrap(), ("flac", FileKind::Audio));
        assert_eq!(kind("belge.pdf").unwrap(), ("pdf", FileKind::Pdf));
        assert!(kind("arşiv.zip").is_err());
        assert!(kind("metin.docx").is_err());
        assert!(compressible(&dir.path().join("missing.mp4")).is_err());
    }
}
