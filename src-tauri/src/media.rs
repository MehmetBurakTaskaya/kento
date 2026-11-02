// SPDX-License-Identifier: MIT
//! The media editors' commands (SPEC 5.5, 5.6): what a file holds, a preview the page can play
//! (the original, or a low-resolution proxy for codecs the WebView lacks), waveform peaks, single
//! frames, and the 13 media tools and Burn in subtitles as jobs. Local files reach the page
//! through the asset protocol, opened one file at a time (SPEC section 6).

use std::path::{Path, PathBuf};

use kento_engines::media::{self, MediaInfo, Tool, ToolRun};
use kento_engines::subtitle::{self, Sample};
use kento_engines::Progress;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::catalog::{self, Category, Format};
use crate::error::{Error, Result};
use crate::jobs::engine::{Target, Work};
use crate::jobs::naming::file_name;
use crate::library::Origin;
use crate::work::{engine_tools, stem_of, Context};
use crate::AppState;

fn media_file(path: &Path) -> Result<&'static Format> {
    path.is_file()
        .then(|| path.extension())
        .flatten()
        .and_then(|ext| catalog::format_for_extension(&ext.to_string_lossy()))
        .filter(|format| matches!(format.category, Category::Video | Category::Audio))
        .ok_or_else(|| Error::Invalid("not a video or audio file".into()))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> kento_engines::Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| Error::Invalid(err.to_string()))?
        .map_err(|err| Error::Invalid(err.to_string()))
}

#[tauri::command]
pub async fn media_probe(state: State<'_, AppState>, path: PathBuf) -> Result<MediaInfo> {
    media_file(&path)?;
    let tools = engine_tools(&state);
    blocking(move || media::probe(&tools, &path)).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// The file to play: the original or the proxy. The page turns it into an asset URL.
    pub path: PathBuf,
    pub proxy: bool,
}

/// A file the page can play. A proxy is made once per file and session in the temp folder, which
/// Kento empties at start.
#[tauri::command]
pub async fn media_preview(
    app: AppHandle,
    state: State<'_, AppState>,
    path: PathBuf,
) -> Result<Preview> {
    let format = media_file(&path)?;
    let tools = engine_tools(&state);
    let previews = state.paths.temp.join("previews");
    let source = path.clone();
    let (play, proxy) = blocking(move || {
        let info = media::probe(&tools, &source)?;
        if media::playable(&info, format.id) {
            return Ok((source, false));
        }
        std::fs::create_dir_all(&previews)?;
        let proxy = previews.join(format!("{:016x}.mp4", fingerprint(&source)));
        if !proxy.is_file() {
            let part = proxy.with_extension("part.mp4");
            media::proxy(&tools, &source, &part, &Progress::none())?;
            std::fs::rename(&part, &proxy)?;
        }
        Ok((proxy, true))
    })
    .await?;
    app.asset_protocol_scope()
        .allow_file(&play)
        .map_err(|err| Error::Invalid(err.to_string()))?;
    Ok(Preview { path: play, proxy })
}

/// Names a proxy after the file and its size and time, so an edited file gets a new proxy.
fn fingerprint(path: &Path) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    if let Ok(meta) = std::fs::metadata(path) {
        meta.len().hash(&mut hasher);
        meta.modified().ok().hash(&mut hasher);
    }
    hasher.finish()
}

#[tauri::command]
pub async fn media_peaks(
    state: State<'_, AppState>,
    path: PathBuf,
    buckets: usize,
) -> Result<Vec<f32>> {
    media_file(&path)?;
    let tools = engine_tools(&state);
    let buckets = buckets.clamp(16, 20_000);
    blocking(move || media::peaks(&tools, &path, buckets, &Progress::none())).await
}

#[tauri::command]
pub async fn media_frame(
    state: State<'_, AppState>,
    path: PathBuf,
    at: f64,
    size: u32,
) -> Result<Response> {
    media_file(&path)?;
    let tools = engine_tools(&state);
    let size = size.clamp(32, 1920);
    let png = blocking(move || media::frame(&tools, &path, at.max(0.0), size)).await?;
    Ok(Response::new(png))
}

/// The first subtitle of an SRT or VTT file, for the burn-in preview.
#[tauri::command]
pub async fn subtitle_sample(path: PathBuf) -> Result<Option<Sample>> {
    subtitle_file(&path)?;
    blocking(move || subtitle::sample(&path)).await
}

fn subtitle_file(path: &Path) -> Result<()> {
    path.is_file()
        .then(|| path.extension())
        .flatten()
        .and_then(|ext| catalog::format_for_extension(&ext.to_string_lossy()))
        .filter(|format| format.category == Category::Subtitle)
        .map(|_| ())
        .ok_or_else(|| Error::Invalid("not a subtitle file".into()))
}

/// Burn in subtitles takes one video and one subtitle file, in either order; the engine gets the
/// video first.
fn video_and_subtitles(paths: &[PathBuf]) -> Result<(PathBuf, &'static Format, PathBuf)> {
    let pair = || Error::Invalid("this tool takes a video and its subtitles".into());
    let [first, second] = paths else {
        return Err(pair());
    };
    let (video, subtitles) = if subtitle_file(second).is_ok() {
        (first, second)
    } else {
        (second, first)
    };
    subtitle_file(subtitles)?;
    let format = media_file(video)
        .ok()
        .filter(|format| format.category == Category::Video)
        .ok_or_else(pair)?;
    Ok((video.clone(), format, subtitles.clone()))
}

/// Runs a media tool. Remove audio takes several videos, one job each; Merge videos takes its
/// files in order; Burn in subtitles a video and its subtitles; every other tool takes one file.
#[tauri::command]
pub fn run_media_tool(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    tool: Tool,
    paths: Vec<PathBuf>,
) -> Result<Vec<u64>> {
    if let Tool::BurnSubtitles { .. } = tool {
        let (video, format, subtitles) = video_and_subtitles(&paths)?;
        let ctx = Context::new(&app, &state)?;
        let id = submit(&ctx, tool, vec![video, subtitles], format);
        crate::actions::watch(&window, &state, &[id]);
        return Ok(vec![id]);
    }
    let files = paths
        .iter()
        .map(|path| media_file(path).map(|format| (path.clone(), format)))
        .collect::<Result<Vec<_>>>()?;
    let (first, format) = files
        .first()
        .cloned()
        .ok_or_else(|| Error::Invalid("no files".into()))?;
    let ctx = Context::new(&app, &state)?;
    let batches: Vec<Vec<PathBuf>> = match tool {
        Tool::Mute => paths.iter().map(|p| vec![p.clone()]).collect(),
        Tool::MergeVideos if paths.len() >= 2 => vec![paths.clone()],
        Tool::MergeVideos => return Err(Error::Invalid("merging needs two videos or more".into())),
        _ if paths.len() == 1 => vec![paths.clone()],
        _ => return Err(Error::Invalid("this tool takes one file".into())),
    };
    let ids: Vec<u64> = batches
        .into_iter()
        .map(|inputs| {
            let source = inputs[0].clone();
            let from = if source == first {
                format
            } else {
                media_file(&source).unwrap_or(format)
            };
            submit(&ctx, tool.clone(), inputs, from)
        })
        .collect();
    crate::actions::watch(&window, &state, &ids);
    Ok(ids)
}

fn submit(ctx: &Context, tool: Tool, inputs: Vec<PathBuf>, from: &'static Format) -> u64 {
    let source = inputs[0].clone();
    let name = file_name(
        &stem_of(&source),
        Some(&ctx.text(&format!("suffix.{}", tool.id()))),
        "",
    );
    let dir = ctx.dir_for(&source);
    let target = match tool.output() {
        kento_engines::Output::Folder => Target::Folder { dir, name },
        kento_engines::Output::File => {
            let extension = Some(tool.extension(from.id))
                .filter(|ext| !ext.is_empty())
                .unwrap_or_else(|| {
                    source
                        .extension()
                        .map(|ext| ext.to_string_lossy().into_owned())
                        .unwrap_or_default()
                });
            Target::File {
                dir,
                stem: name,
                extension,
            }
        }
    };
    let more = if inputs.len() > 1 {
        format!(" +{}", inputs.len() - 1)
    } else {
        String::new()
    };
    let title = format!(
        "{} · {}{more}",
        ctx.text(&format!("tool.{}", tool.id())),
        source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    let tools = ctx.tools();
    let work: Work = Box::new(move |dest, temp, progress| {
        media::run_tool(&ToolRun {
            inputs: &inputs,
            tool: &tool,
            dest,
            temp,
            tools: &tools,
            progress,
        })
        .map(|_| ())
    });
    ctx.submit(title, target, work, Origin::Tool, Some(source))
}
