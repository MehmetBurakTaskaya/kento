// SPDX-License-Identifier: MIT
//! Metadata (SPEC 5.5): what a file carries, and a copy with the fields changed or removed.

use std::path::{Path, PathBuf};

use kento_engines::metadata::{self, MetadataChange, MetadataInfo, MetadataRun};
use kento_engines::FileKind;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::catalog::{self, Category, Format};
use crate::error::{Error, Result};
use crate::jobs::engine::{Target, Work};
use crate::jobs::naming::file_name;
use crate::library::Origin;
use crate::work::{stem_of, Context};
use crate::AppState;

/// The file's catalog format and the kind of metadata it carries; only pictures, PDFs, video and
/// audio have any Kento reads.
fn metadata_file(path: &Path) -> Result<(&'static Format, FileKind)> {
    let format = path
        .is_file()
        .then(|| path.extension())
        .flatten()
        .and_then(|ext| catalog::format_for_extension(&ext.to_string_lossy()))
        .ok_or_else(|| Error::Invalid("not a file with metadata".into()))?;
    let kind = match format.category {
        Category::Image => FileKind::Image,
        Category::Pdf => FileKind::Pdf,
        Category::Video => FileKind::Video,
        Category::Audio => FileKind::Audio,
        _ => return Err(Error::Invalid("not a file with metadata".into())),
    };
    Ok((format, kind))
}

/// Reads every field of a picture, PDF, video or audio file. A missing tool is the engine's
/// `MissingCodec`, explained in the page's language.
#[tauri::command]
pub async fn metadata_read(app: AppHandle, path: PathBuf) -> Result<MetadataInfo> {
    let (format, kind) = metadata_file(&path)?;
    let state = app.state::<AppState>();
    let explain = crate::work::explainer(&state.lang());
    let toolchain = state.toolchain.clone();
    // Finding the tools may run them once, and ExifTool or ffprobe reads the file: both off the
    // main thread.
    let read = tauri::async_runtime::spawn_blocking(move || {
        metadata::read(&path, format.id, kind, &toolchain.engine_tools())
    })
    .await?;
    read.map_err(|err| {
        tracing::info!("metadata could not be read: {err}");
        Error::Invalid(explain(&err))
    })
}

/// Writes a copy of the file with the change applied; returns the job id.
#[tauri::command]
pub fn run_metadata(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: PathBuf,
    change: MetadataChange,
) -> Result<Vec<u64>> {
    let (format, kind) = metadata_file(&path)?;
    let ctx = Context::new(&app, &state)?;
    let name = file_name(&stem_of(&path), Some(&ctx.text("suffix.metadata")), "");
    let extension = path
        .extension()
        .map(|ext| ext.to_string_lossy().into_owned())
        .unwrap_or_else(|| format.extensions[0].to_string());
    let target = Target::File {
        dir: ctx.dir_for(&path),
        stem: name,
        extension,
    };
    let title = format!(
        "{} · {}",
        ctx.text("tool.metadata"),
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    // ExifTool for pictures, FFmpeg and ffprobe for video and audio; lopdf needs nothing.
    let tools = ctx.tools();
    let input = path.clone();
    let work: Work = Box::new(move |dest, temp, progress| {
        metadata::write(&MetadataRun {
            input: &input,
            from: format.id,
            kind,
            change: &change,
            dest,
            temp,
            tools: &tools,
            progress,
        })
        .map(|_| ())
    });
    let ids = vec![ctx.submit(title, target, work, Origin::Tool, Some(path))];
    crate::actions::watch(&window, &state, &ids);
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pictures_pdfs_video_and_audio_have_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let file = |name: &str| {
            let path = dir.path().join(name);
            std::fs::write(&path, b"x").unwrap();
            path
        };
        for (name, kind, id) in [
            ("Fotoğraf 🎈.JPEG", FileKind::Image, "jpg"),
            ("Çizim.heif", FileKind::Image, "heic"),
            ("Belge ğ.pdf", FileKind::Pdf, "pdf"),
            ("Video ş.m4v", FileKind::Video, "mp4"),
            ("Ses ı.aif", FileKind::Audio, "aiff"),
        ] {
            let (format, found) = metadata_file(&file(name)).unwrap();
            assert_eq!((found, format.id), (kind, id), "{name}");
        }
        for name in ["Not.txt", "Arşiv.zip", "Tablo.xlsx", "uzantısız"] {
            assert!(metadata_file(&file(name)).is_err(), "{name}");
        }
        assert!(metadata_file(&dir.path().join("yok.jpg")).is_err());
    }
}
