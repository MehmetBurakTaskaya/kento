// SPDX-License-Identifier: MIT
//! Remove background (SPEC 5.5 [+]): one job per picture, each writing `<name> - <suffix>.png`, and
//! the panel's preview. The model runs in the queue's heavy lane, one picture at a time: it takes a
//! few seconds and much of the memory and processor each time.

use std::path::{Path, PathBuf};

use kento_engines::bgremove::{self, CutoutRun};
use kento_engines::Options;
use tauri::ipc::Response;
use tauri::{AppHandle, State, WebviewWindow};

use crate::catalog::{self, Category, Format};
use crate::error::{Error, Result};
use crate::jobs::engine::{Target, Work};
use crate::jobs::naming::file_name;
use crate::jobs::Lane;
use crate::library::Origin;
use crate::work::{engine_tools, error_key, stem_of, Context};
use crate::{i18n, AppState};

const TOOL: &str = "remove-background";
/// Previews are drawn no smaller and no larger than this on their longer side.
const PREVIEW_SIDES: (u32, u32) = (64, 2048);

fn picture(path: &Path) -> Result<&'static Format> {
    path.is_file()
        .then(|| path.extension())
        .flatten()
        .and_then(|ext| catalog::format_for_extension(&ext.to_string_lossy()))
        .filter(|format| matches!(format.category, Category::Image))
        .ok_or_else(|| Error::Invalid("not an image Kento can read".into()))
}

/// Removes the background of every picture, one job each, and returns the job ids.
#[tauri::command]
pub fn remove_background(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    paths: Vec<PathBuf>,
) -> Result<Vec<u64>> {
    if paths.is_empty() {
        return Err(Error::Invalid("no pictures".into()));
    }
    let pictures = paths
        .into_iter()
        .map(|path| picture(&path).map(|format| (path, format.id)))
        .collect::<Result<Vec<_>>>()?;
    let ctx = Context::new(&app, &state)?;
    let ids: Vec<u64> = pictures
        .into_iter()
        .map(|(path, from)| submit(&ctx, path, from))
        .collect();
    crate::actions::watch(&window, &state, &ids);
    Ok(ids)
}

fn submit(ctx: &Context, source: PathBuf, from: &'static str) -> u64 {
    let target = Target::File {
        dir: ctx.dir_for(&source),
        stem: file_name(
            &stem_of(&source),
            Some(&ctx.text(&format!("suffix.{TOOL}"))),
            "",
        ),
        extension: "png".into(),
    };
    let title = format!(
        "{} · {}",
        ctx.text(&format!("tool.{TOOL}")),
        source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    let tools = ctx.tools();
    let input = source.clone();
    let work: Work = Box::new(move |dest, _temp, progress| {
        let options = Options {
            tools,
            ..Options::default()
        };
        bgremove::run(&CutoutRun {
            input: &input,
            from,
            dest,
            options: &options,
            progress,
        })
        .map(|_| ())
    });
    ctx.submit_in(Lane::Heavy, title, target, work, Origin::Tool, Some(source))
}

/// The picture with its background removed, no larger than `size` on its longer side, as a PNG.
/// The first call for a picture runs the model, which takes a few seconds; saving it afterwards
/// uses the same result.
#[tauri::command]
pub async fn background_preview(
    state: State<'_, AppState>,
    path: PathBuf,
    size: u32,
) -> Result<Response> {
    let from = picture(&path)?.id;
    let size = size.clamp(PREVIEW_SIDES.0, PREVIEW_SIDES.1);
    let options = Options {
        tools: engine_tools(&state),
        ..Options::default()
    };
    let png = tauri::async_runtime::spawn_blocking(move || {
        bgremove::preview_png(&path, from, &options, size)
    })
    .await
    .map_err(|err| Error::Invalid(err.to_string()))?
    .map_err(|err| {
        // The panel shows the plain message; the technical one goes to the log.
        tracing::warn!("the background-removal preview failed: {err}");
        Error::Invalid(i18n::text(&state.lang(), error_key(&err)))
    })?;
    Ok(Response::new(png))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pictures_of_the_catalog_are_taken() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("Kento ğüşıöç 🧪");
        std::fs::create_dir(&folder).unwrap();
        for (name, ok) in [
            ("foto.JPG", true),
            ("telefon.heic", true),
            ("çizim.svg", true),
            ("belge.pdf", false),
            ("video.mp4", false),
            ("adsız", false),
        ] {
            let path = folder.join(name);
            std::fs::write(&path, b"x").unwrap();
            assert_eq!(picture(&path).is_ok(), ok, "{name}");
        }
        assert!(picture(&folder.join("yok.png")).is_err(), "missing file");
        assert!(picture(&folder).is_err(), "a folder");
    }
}
