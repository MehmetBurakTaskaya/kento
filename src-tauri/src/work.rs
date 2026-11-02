// SPDX-License-Identifier: MIT
//! Conversions and core tools as jobs (SPEC 5.3–5.5). Every path the page sends is checked here
//! before an engine sees it.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use kento_engines::{self as engines, Codec, Error as EngineError, Options};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::catalog::{self, Category, Format, Status, ToolGroup};
use crate::error::{Error, Result};
use crate::jobs::engine::{EngineJob, Explain, Target, Work};
use crate::jobs::naming::{output_dir, OutputDir};
use crate::library::Origin;
use crate::settings::OutputLocation;
use crate::{i18n, AppState};

/// A file or folder as the page lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: PathBuf,
    pub name: String,
    pub folder: bool,
    pub format: Option<String>,
    pub category: Option<Category>,
    pub size: Option<u64>,
}

/// Describes the given paths; paths that do not exist are left out.
#[tauri::command]
pub fn inspect(paths: Vec<PathBuf>) -> Vec<FileEntry> {
    paths.iter().filter_map(|path| entry(path)).collect()
}

pub fn entry(path: &Path) -> Option<FileEntry> {
    let meta = fs::metadata(path).ok()?;
    let format = (!meta.is_dir()).then(|| readable_format(path)).flatten();
    Some(FileEntry {
        path: path.to_path_buf(),
        name: path.file_name()?.to_string_lossy().into_owned(),
        folder: meta.is_dir(),
        format: format.map(|f| f.id.to_string()),
        category: format.map(|f| f.category),
        size: meta.is_file().then_some(meta.len()),
    })
}

/// The format Kento reads this file as; ".tar.gz" reads as GZ.
fn readable_format(path: &Path) -> Option<&'static Format> {
    catalog::format_for_extension(&path.extension()?.to_string_lossy())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertTarget {
    pub to: String,
    pub label: String,
    pub group: ToolGroup,
    pub enhancement: bool,
    pub note: Option<String>,
    /// The tool group to install first, when it is missing (SPEC 5.1: shown dimmed).
    pub needs: Option<ToolGroup>,
}

/// The targets for one category of the selection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetGroup {
    pub category: Category,
    pub count: usize,
    pub targets: Vec<ConvertTarget>,
}

/// The Convert wheel's slices: per category in the selection, the targets valid for every file
/// of that category (SPEC 5.3, smart filter). Only routes that work in this version are offered.
#[tauri::command]
pub fn targets(state: State<'_, AppState>, paths: Vec<PathBuf>) -> Vec<TargetGroup> {
    let mut groups: Vec<(Category, Vec<&'static str>)> = Vec::new();
    for path in &paths {
        let Some(format) = path.is_file().then(|| readable_format(path)).flatten() else {
            continue;
        };
        match groups.iter_mut().find(|(c, _)| *c == format.category) {
            Some((_, ids)) => ids.push(format.id),
            None => groups.push((format.category, vec![format.id])),
        }
    }
    groups
        .into_iter()
        .map(|(category, ids)| {
            let targets = catalog::routes()
                .iter()
                .filter(|route| route.from == ids[0] && usable(route.from, route.to))
                .filter(|route| ids.iter().all(|id| usable(id, route.to)))
                .filter_map(|route| {
                    Some(ConvertTarget {
                        to: route.to.to_string(),
                        label: catalog::format(route.to)?.label.to_string(),
                        group: route.group,
                        enhancement: route.enhancement,
                        note: route.note.map(str::to_string),
                        needs: missing(&state, route.group),
                    })
                })
                .collect();
            TargetGroup {
                category,
                count: ids.len(),
                targets,
            }
        })
        .collect()
}

/// The tools found or installed for the engines (SPEC 4.2).
pub(crate) fn engine_tools(state: &AppState) -> engines::Tools {
    crate::toolchain::engine_tools(state)
}

/// The tool group a route or tool still needs, or None when it is ready to run.
fn missing(state: &AppState, group: ToolGroup) -> Option<ToolGroup> {
    let tools = engine_tools(state);
    let ready = match group {
        ToolGroup::Core => true,
        ToolGroup::Media => tools.ffmpeg.is_some() && tools.ffprobe.is_some(),
        ToolGroup::Extras => tools.exiftool.is_some(),
        ToolGroup::Office => false,
    };
    (!ready).then_some(group)
}

/// A route this version can run: in the catalog, not planned, and supported by an engine here.
fn usable(from: &str, to: &str) -> bool {
    let routed = catalog::routes()
        .iter()
        .any(|r| r.from == from && r.to == to && r.status != Status::Planned);
    routed && engines::supports(from, to)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntry {
    pub id: String,
    pub icon: String,
    pub group: ToolGroup,
    pub enhancement: bool,
    /// The tool group to install first, when it is missing (SPEC 5.1: shown dimmed).
    pub needs: Option<ToolGroup>,
}

/// The Tools wheel's slices for the selection: the tools that work in this version and fit the
/// files (how many, of which kinds).
#[tauri::command]
pub fn tools(state: State<'_, AppState>, paths: Vec<PathBuf>) -> Vec<ToolEntry> {
    let categories: Vec<Option<Category>> = paths
        .iter()
        .map(|path| readable_format(path).map(|f| f.category))
        .collect();
    let count = categories.len();
    let all = |wanted: &[Category]| {
        count > 0
            && categories
                .iter()
                .all(|c| c.is_some_and(|c| wanted.contains(&c)))
    };
    catalog::tools()
        .iter()
        .filter(|tool| tool.status == Status::Ready)
        .filter(|tool| match tool.id {
            "split-pdf" | "edit-pdf" => count == 1 && all(&[Category::Pdf]),
            "merge-pdf" => count >= 2 && all(&[Category::Pdf]),
            "images-to-pdf" => all(&[Category::Image]),
            "read-qr" => all(&[Category::Image, Category::Pdf]),
            "extract" => all(&[Category::Archive]),
            // Remove audio needs no choices, so it takes several videos at once.
            "mute" => all(&[Category::Video]),
            "merge-video" => count >= 2 && all(&[Category::Video]),
            "trim-video" | "crop-video" | "speed" | "frames" | "split-video" | "redact-video" => {
                count == 1 && all(&[Category::Video])
            }
            "normalize" | "trim-audio" | "channels" | "redact-audio" | "audio-to-video" => {
                count == 1 && all(&[Category::Audio])
            }
            "edit-image" | "crop-image" | "markup" | "frame" | "redact-image" => {
                count == 1 && all(&[Category::Image])
            }
            "collage" => count >= 2 && all(&[Category::Image]),
            "metadata" => count == 1 && all(tool.categories),
            _ => all(tool.categories),
        })
        .map(|tool| ToolEntry {
            id: tool.id.to_string(),
            icon: tool.icon.to_string(),
            group: tool.group,
            enhancement: tool.enhancement,
            needs: needs(&state, tool, &categories),
        })
        .collect()
}

/// What a tool still needs for these files. Compress and Metadata take several kinds of file, and
/// each kind has its own engine: video and audio need the Media tools, image metadata ExifTool.
fn needs(
    state: &AppState,
    tool: &catalog::Tool,
    categories: &[Option<Category>],
) -> Option<ToolGroup> {
    let has = |wanted: Category| categories.contains(&Some(wanted));
    let media = has(Category::Video) || has(Category::Audio);
    match tool.id {
        "compress" if media => missing(state, ToolGroup::Media),
        "compress" => None,
        "metadata" if media => missing(state, ToolGroup::Media),
        "metadata" if has(Category::Image) => missing(state, ToolGroup::Extras),
        "metadata" => None,
        _ => missing(state, tool.group),
    }
}

/// Converts every file to `to`, one job per file (batch conversion, SPEC 5.3), and returns the
/// job ids.
#[tauri::command]
pub fn convert(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    paths: Vec<PathBuf>,
    to: String,
) -> Result<Vec<u64>> {
    let target = catalog::format(&to)
        .filter(|f| f.write)
        .ok_or_else(|| Error::Invalid(format!("unknown target {to}")))?;
    let mut sources = Vec::new();
    for path in paths {
        let format = path
            .is_file()
            .then(|| readable_format(&path))
            .flatten()
            .ok_or_else(|| Error::Invalid("not a file Kento can read".into()))?;
        if !usable(format.id, target.id) {
            return Err(Error::Invalid(format!(
                "{} to {} is not available",
                format.id, target.id
            )));
        }
        sources.push((path, format));
    }
    let ctx = Context::new(&app, &state)?;
    let ids: Vec<u64> = sources
        .into_iter()
        .map(|(path, format)| ctx.submit_conversion(path, format, target))
        .collect();
    crate::actions::watch(&window, &state, &ids);
    Ok(ids)
}

/// What every job of one request shares.
pub(crate) struct Context {
    app: AppHandle,
    lang: String,
    output: OutputDir,
    fallback: PathBuf,
    temp: PathBuf,
    tools: engines::Tools,
}

impl Context {
    pub(crate) fn new(app: &AppHandle, state: &AppState) -> Result<Self> {
        let settings = state.settings();
        let output = match (settings.output.location, settings.output.folder) {
            (OutputLocation::Folder, Some(folder)) => OutputDir::Folder(folder),
            _ => OutputDir::NextToSource,
        };
        let fallback = app.path().download_dir()?.join(crate::paths::APP_DIR);
        fs::create_dir_all(&fallback)?;
        Ok(Self {
            app: app.clone(),
            lang: state.lang(),
            output,
            fallback,
            temp: state.paths.temp.clone(),
            tools: engine_tools(state),
        })
    }

    pub(crate) fn tools(&self) -> engines::Tools {
        self.tools.clone()
    }

    pub(crate) fn text(&self, key: &str) -> String {
        i18n::text(&self.lang, key)
    }

    /// Where outputs for `source` go (SPEC 5.14).
    pub(crate) fn dir_for(&self, source: &Path) -> PathBuf {
        output_dir(source, &self.output, &self.fallback)
    }

    fn submit_conversion(&self, path: PathBuf, from: &'static Format, to: &'static Format) -> u64 {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let stem = stem_of(&path);
        let dir = self.dir_for(&path);
        let target = match engines::output(from.id, to.id) {
            Some(engines::Output::Folder) => Target::Folder { dir, name: stem },
            _ => Target::File {
                dir,
                stem,
                extension: to.extensions[0].to_string(),
            },
        };
        let (from_id, to_id) = (from.id, to.id);
        let tools = self.tools.clone();
        let input = path.clone();
        let work: Work = Box::new(move |dest, temp, progress| {
            let options = Options {
                tools,
                ..Options::default()
            };
            engines::convert(&engines::Conversion {
                input: &input,
                from: from_id,
                to: to_id,
                dest,
                temp,
                options: &options,
                progress,
            })
            .map(|_| ())
        });
        self.submit(
            format!("{name} → {}", to.label),
            target,
            work,
            Origin::Convert,
            Some(path),
        )
    }

    pub(crate) fn submit(
        &self,
        title: String,
        target: Target,
        work: Work,
        origin: Origin,
        source: Option<PathBuf>,
    ) -> u64 {
        self.submit_then(title, target, work, origin, source, None)
    }

    /// Like `submit`, with a step that runs once the output has its final name (a move removes
    /// the original only then).
    pub(crate) fn submit_then(
        &self,
        title: String,
        target: Target,
        work: Work,
        origin: Origin,
        source: Option<PathBuf>,
        after: Option<Box<dyn FnOnce() + Send>>,
    ) -> u64 {
        let app = self.app.clone();
        let state = self.app.state::<AppState>();
        state.queue.submit(Box::new(EngineJob {
            title,
            target,
            temp_root: self.temp.clone(),
            work,
            explain: explainer(&self.lang),
            done: Some(Box::new(move |outputs| {
                if let Some(after) = after {
                    after();
                }
                let state = app.state::<AppState>();
                state.library.add(origin, source.as_deref(), outputs);
                let _ = app.emit("library", ());
            })),
        }))
    }
}

/// "photo.heic" → "photo"; "backup.tar.gz" → "backup".
pub(crate) fn stem_of(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let lower = name.to_lowercase();
    let cut = [".tar.gz", ".tgz"]
        .iter()
        .find_map(|ext| lower.ends_with(ext).then(|| name.len() - ext.len()))
        .or_else(|| name.rfind('.').filter(|&i| i > 0));
    match cut {
        Some(i) => name[..i].to_string(),
        None => name,
    }
}

/// Plain-language messages for engine errors (SPEC 5.13); the technical text goes to details.
pub(crate) fn explainer(lang: &str) -> Explain {
    let lang = lang.to_string();
    Arc::new(move |error| {
        let key = match error {
            // Compress keeps the format, and some formats cannot get smaller in themselves.
            EngineError::Unsupported { to, .. } if to == "compress" => "error.compress.unsupported",
            EngineError::Unsupported { .. } => "error.unsupported",
            EngineError::Unreadable(_) => "error.unreadable",
            EngineError::Encrypted => "error.encrypted",
            EngineError::MissingCodec(Codec::Heif) if cfg!(target_os = "macos") => {
                "error.codec.heif.mac"
            }
            EngineError::MissingCodec(Codec::Heif) => "error.codec.heif.windows",
            EngineError::MissingCodec(Codec::Pdfium) => "error.codec.pdfium",
            EngineError::MissingCodec(Codec::Ffmpeg) => "error.codec.ffmpeg",
            EngineError::MissingCodec(Codec::ExifTool) => "error.codec.exiftool",
            EngineError::NotSmaller => "error.not-smaller",
            EngineError::Limit(_) => "error.limit",
            EngineError::Io(_) => "error.io",
            EngineError::Cancelled | EngineError::Other(_) => "error.other",
        };
        i18n::text(&lang, key)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stems_drop_one_extension_or_a_tarball_pair() {
        assert_eq!(stem_of(Path::new("photo.heic")), "photo");
        assert_eq!(stem_of(Path::new("yedek.tar.gz")), "yedek");
        assert_eq!(
            stem_of(Path::new("Kento ğüşıöç 🧪.v2.pdf")),
            "Kento ğüşıöç 🧪.v2"
        );
        assert_eq!(stem_of(Path::new(".hidden")), ".hidden");
    }

    /// The catalog and the engines agree: what the catalog calls ready, an engine runs, and an
    /// engine runs nothing the catalog does not list.
    #[test]
    fn ready_routes_and_engines_agree() {
        for route in catalog::routes() {
            let heic_out = route.to == "heic";
            if route.status == Status::Ready || (route.status == Status::Preview && !heic_out) {
                assert!(
                    engines::supports(route.from, route.to),
                    "{} → {} is {:?} but no engine runs it",
                    route.from,
                    route.to,
                    route.status
                );
            }
        }
        for from in catalog::formats().iter().filter(|f| f.read) {
            for to in catalog::formats().iter().filter(|f| f.write) {
                if engines::supports(from.id, to.id) {
                    assert!(
                        catalog::routes().iter().any(|r| r.from == from.id
                            && r.to == to.id
                            && r.status != Status::Planned),
                        "an engine runs {} → {} but the catalog does not offer it",
                        from.id,
                        to.id
                    );
                }
            }
        }
    }
}
