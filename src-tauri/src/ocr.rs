// SPDX-License-Identifier: MIT
//! Extract text (SPEC 5.5, OCR [+]): the languages the system reads, the one to suggest, and one
//! job per image or PDF writing "photo - text.txt". The recogniser is the system's own
//! (`kento_engines::ocr`): Windows.Media.Ocr or Apple's Vision.

use std::path::PathBuf;

use kento_engines::{ocr, Options};
use serde::Serialize;
use tauri::{AppHandle, State, WebviewWindow};

use crate::catalog::{self, Category};
use crate::error::{Error, Result};
use crate::jobs::engine::{Target, Work};
use crate::jobs::naming::file_name;
use crate::library::Origin;
use crate::work::{stem_of, Context};
use crate::AppState;

/// What the panel offers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLanguages {
    /// The tags the system reads text in.
    available: Vec<String>,
    /// The interface language when the system reads it, else the system's language, else the
    /// first one available.
    suggested: Option<String>,
    /// The interface language ("tr"), named when the system cannot read it.
    interface: String,
    /// The system's language ("tr-TR"), offered too even when missing, so its absence is said.
    system: Option<String>,
}

#[tauri::command]
pub async fn ocr_languages(state: State<'_, AppState>) -> Result<OcrLanguages> {
    let interface = state.lang();
    let system = sys_locale::get_locale();
    let available = tauri::async_runtime::spawn_blocking(ocr::languages)
        .await
        .map_err(|err| Error::Invalid(err.to_string()))?
        .map_err(|err| Error::Invalid(err.to_string()))?;
    let mut wanted = vec![interface.as_str()];
    wanted.extend(system.as_deref());
    let suggested = ocr::choose(&wanted, &available).or_else(|| available.first().cloned());
    Ok(OcrLanguages {
        available,
        suggested,
        interface,
        system,
    })
}

/// Reads each image or PDF in `language` (one of `ocr_languages`' tags), one job per file.
#[tauri::command]
pub fn run_ocr(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    paths: Vec<PathBuf>,
    language: String,
) -> Result<Vec<u64>> {
    if paths.is_empty() {
        return Err(Error::Invalid("no files".into()));
    }
    let files = paths
        .into_iter()
        .map(|path| {
            let format = path
                .is_file()
                .then(|| path.extension())
                .flatten()
                .and_then(|ext| catalog::format_for_extension(&ext.to_string_lossy()))
                .filter(|format| matches!(format.category, Category::Image | Category::Pdf))
                .ok_or_else(|| Error::Invalid("not an image or a PDF".into()))?;
            Ok((path, format.id))
        })
        .collect::<Result<Vec<_>>>()?;
    let ctx = Context::new(&app, &state)?;
    let ids: Vec<u64> = files
        .into_iter()
        .map(|(path, format)| {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let target = Target::File {
                dir: ctx.dir_for(&path),
                stem: file_name(&stem_of(&path), Some(&ctx.text("suffix.ocr")), ""),
                extension: "txt".into(),
            };
            let title = format!("{} · {name}", ctx.text("tool.ocr"));
            let (input, language, tools) = (path.clone(), language.clone(), ctx.tools());
            let work: Work = Box::new(move |dest, _, progress| {
                let options = Options {
                    tools,
                    ..Options::default()
                };
                ocr::extract(&ocr::OcrJob {
                    input: &input,
                    format,
                    language: &language,
                    dest,
                    options: &options,
                    progress,
                })
            });
            ctx.submit(title, target, work, Origin::Tool, Some(path))
        })
        .collect();
    crate::actions::watch(&window, &state, &ids);
    Ok(ids)
}
