// SPDX-License-Identifier: MIT
//! The image editors' commands (SPEC 5.5): a picture's size, live previews drawn by the same
//! engine code as the result, and the six image tools as jobs.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use kento_engines::image::tools::{self, ImageRun, ImageTool, Source};
use kento_engines::Options;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, State, WebviewWindow};

use crate::catalog::{self, Category, Format};
use crate::error::{Error, Result};
use crate::jobs::engine::{Target, Work};
use crate::jobs::naming::file_name;
use crate::library::Origin;
use crate::work::{engine_tools, stem_of, Context};
use crate::AppState;

/// Previews are drawn no smaller and no larger than this on their longer side.
const PREVIEW_SIDES: (u32, u32) = (64, 2048);
/// Decoded pictures kept for the next preview; one request may keep more for a moment (a large
/// collage), but never fewer than it uses.
const CACHED_PICTURES: usize = 8;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    /// Upright: after the EXIF orientation.
    pub width: u32,
    pub height: u32,
}

fn image_file(path: &Path) -> Result<&'static Format> {
    path.is_file()
        .then(|| path.extension())
        .flatten()
        .and_then(|ext| catalog::format_for_extension(&ext.to_string_lossy()))
        .filter(|format| matches!(format.category, Category::Image))
        .ok_or_else(|| Error::Invalid("not an image Kento can read".into()))
}

/// Make a collage takes two pictures or more, in order; every other tool exactly one.
fn check_count(tool: &ImageTool, count: usize) -> Result<()> {
    match tool {
        ImageTool::Collage { .. } if count >= 2 => Ok(()),
        ImageTool::Collage { .. } => Err(Error::Invalid(
            "a collage needs two pictures or more".into(),
        )),
        _ if count == 1 => Ok(()),
        _ => Err(Error::Invalid("this tool takes one picture".into())),
    }
}

fn options(state: &AppState) -> Options {
    Options {
        tools: engine_tools(state),
        ..Options::default()
    }
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
pub async fn image_info(state: State<'_, AppState>, path: PathBuf) -> Result<ImageInfo> {
    let format = image_file(&path)?;
    let options = options(&state);
    let [width, height] = blocking(move || tools::size(&path, format.id, &options)).await?;
    Ok(ImageInfo { width, height })
}

/// A PNG of the tool applied to the pictures, no larger than `size` on its longer side; without
/// a tool, the picture itself. Decoded pictures are kept for the next call, so dragging a slider
/// redraws quickly.
#[tauri::command]
pub async fn image_preview(
    state: State<'_, AppState>,
    paths: Vec<PathBuf>,
    tool: Option<ImageTool>,
    size: u32,
) -> Result<Response> {
    let used = match &tool {
        Some(tool) => {
            check_count(tool, paths.len())?;
            paths
        }
        None => paths.into_iter().take(1).collect(),
    };
    if used.is_empty() {
        return Err(Error::Invalid("no picture to show".into()));
    }
    let files = used
        .iter()
        .map(|path| image_file(path).map(|format| (path.clone(), format.id)))
        .collect::<Result<Vec<_>>>()?;
    let size = size.clamp(PREVIEW_SIDES.0, PREVIEW_SIDES.1);
    let options = options(&state);
    let png = blocking(move || {
        let keys = files
            .iter()
            .map(|(path, _)| Key::of(path, size))
            .collect::<std::io::Result<Vec<_>>>()?;
        let mut sources = Vec::with_capacity(files.len());
        for ((path, from), key) in files.iter().zip(&keys) {
            let cached = cache().lock().unwrap_or_else(|p| p.into_inner()).get(key);
            let source = match cached {
                Some(source) => source,
                None => {
                    let source = Arc::new(tools::preview_source(path, from, &options, size)?);
                    cache().lock().unwrap_or_else(|p| p.into_inner()).insert(
                        key.clone(),
                        source.clone(),
                        &keys,
                    );
                    source
                }
            };
            sources.push(source);
        }
        let sources: Vec<&Source> = sources.iter().map(Arc::as_ref).collect();
        tools::preview_png(&sources, tool.as_ref(), size)
    })
    .await?;
    Ok(Response::new(png))
}

/// Runs an image tool: Make a collage takes its pictures in order, every other tool one picture.
#[tauri::command]
pub fn run_image_tool(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    tool: ImageTool,
    paths: Vec<PathBuf>,
) -> Result<Vec<u64>> {
    check_count(&tool, paths.len())?;
    let inputs = paths
        .iter()
        .map(|path| image_file(path).map(|format| (path.clone(), format.id.to_string())))
        .collect::<Result<Vec<_>>>()?;
    let ctx = Context::new(&app, &state)?;
    let ids = vec![submit(&ctx, tool, inputs)];
    crate::actions::watch(&window, &state, &ids);
    Ok(ids)
}

fn submit(ctx: &Context, tool: ImageTool, inputs: Vec<(PathBuf, String)>) -> u64 {
    let (source, from) = inputs[0].clone();
    let name = file_name(
        &stem_of(&source),
        Some(&ctx.text(&format!("suffix.{}", tool.id()))),
        "",
    );
    let target = Target::File {
        dir: ctx.dir_for(&source),
        stem: name,
        extension: tool.extension(&from).to_string(),
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
        let options = Options {
            tools,
            ..Options::default()
        };
        tools::run_tool(&ImageRun {
            inputs: &inputs,
            tool: &tool,
            dest,
            temp,
            options: &options,
            progress,
        })
        .map(|_| ())
    });
    ctx.submit(title, target, work, Origin::Tool, Some(source))
}

/// A decoded preview picture: which file, as it is now, at which size.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Key {
    path: PathBuf,
    len: u64,
    modified: Option<SystemTime>,
    size: u32,
}

impl Key {
    /// An edited file gets a new key, so a changed picture is never shown from the cache.
    fn of(path: &Path, size: u32) -> std::io::Result<Key> {
        let meta = std::fs::metadata(path)?;
        Ok(Key {
            path: path.to_path_buf(),
            len: meta.len(),
            modified: meta.modified().ok(),
            size,
        })
    }
}

/// The most recently used pictures, oldest first.
struct Cache<V> {
    entries: Vec<(Key, V)>,
    capacity: usize,
}

impl<V: Clone> Cache<V> {
    const fn new(capacity: usize) -> Self {
        Cache {
            entries: Vec::new(),
            capacity,
        }
    }

    fn get(&mut self, key: &Key) -> Option<V> {
        let index = self.entries.iter().position(|(k, _)| k == key)?;
        let entry = self.entries.remove(index);
        let value = entry.1.clone();
        self.entries.push(entry);
        Some(value)
    }

    /// Adds a picture and lets the oldest go, except those the current request (`keep`) uses.
    fn insert(&mut self, key: Key, value: V, keep: &[Key]) {
        self.entries.retain(|(k, _)| *k != key);
        self.entries.push((key, value));
        while self.entries.len() > self.capacity {
            match self.entries.iter().position(|(k, _)| !keep.contains(k)) {
                Some(oldest) => {
                    self.entries.remove(oldest);
                }
                None => break,
            }
        }
    }
}

fn cache() -> &'static Mutex<Cache<Arc<Source>>> {
    static CACHE: OnceLock<Mutex<Cache<Arc<Source>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Cache::new(CACHED_PICTURES)))
}

#[cfg(test)]
mod tests {
    use kento_engines::image::tools::{Adjust, CollageStyle, Layout};
    use kento_engines::media::Area;

    use super::*;

    fn collage() -> ImageTool {
        ImageTool::Collage {
            collage: CollageStyle {
                layout: Layout::Row,
                spacing: 0,
                background: [0, 0, 0],
                width: 100,
                fill: true,
            },
        }
    }

    #[test]
    fn collages_take_two_pictures_or_more_and_the_rest_one() {
        assert!(check_count(&collage(), 2).is_ok());
        assert!(check_count(&collage(), 7).is_ok());
        assert!(check_count(&collage(), 1).is_err());
        assert!(check_count(&collage(), 0).is_err());
        let crop = ImageTool::CropImage {
            area: Area {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
        };
        let edit = ImageTool::EditImage {
            adjust: Adjust::default(),
        };
        for tool in [crop, edit] {
            assert!(check_count(&tool, 1).is_ok());
            assert!(check_count(&tool, 0).is_err());
            assert!(check_count(&tool, 2).is_err());
        }
    }

    #[test]
    fn only_images_of_the_catalog_are_taken() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("Kento ğüşıöç 🧪");
        std::fs::create_dir(&folder).unwrap();
        for (name, ok) in [
            ("foto.JPG", true),
            ("çizim.svg", true),
            ("telefon.heic", true),
            ("simge.ico", false),
            ("belge.pdf", false),
            ("video.mp4", false),
            ("adsız", false),
        ] {
            let path = folder.join(name);
            std::fs::write(&path, b"x").unwrap();
            assert_eq!(image_file(&path).is_ok(), ok, "{name}");
        }
        assert!(image_file(&folder.join("yok.png")).is_err(), "missing file");
        assert!(image_file(&folder).is_err(), "a folder");
    }

    #[test]
    fn keys_follow_the_file_and_the_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("önizleme 🧪.png");
        std::fs::write(&path, b"one").unwrap();
        let first = Key::of(&path, 512).unwrap();
        assert_eq!(first, Key::of(&path, 512).unwrap());
        assert_ne!(first, Key::of(&path, 1024).unwrap());
        std::fs::write(&path, b"longer content").unwrap();
        assert_ne!(first, Key::of(&path, 512).unwrap(), "an edited file");
        assert!(Key::of(&dir.path().join("yok.png"), 512).is_err());
    }

    #[test]
    fn the_cache_keeps_the_latest_and_what_a_request_uses() {
        let key = |n: u32| Key {
            path: PathBuf::from(format!("{n}.png")),
            len: 1,
            modified: None,
            size: 512,
        };
        let mut cache = Cache::new(2);
        cache.insert(key(1), 1, &[key(1)]);
        cache.insert(key(2), 2, &[key(2)]);
        assert_eq!(cache.get(&key(1)), Some(1));
        // 2 is now the oldest.
        cache.insert(key(3), 3, &[key(3)]);
        assert_eq!(cache.get(&key(2)), None);
        assert_eq!(cache.get(&key(1)), Some(1));
        assert_eq!(cache.get(&key(3)), Some(3));

        // A request for four pictures keeps all four, then the next one trims back.
        let request: Vec<Key> = (10..14).map(key).collect();
        for (n, k) in (10..14).zip(&request) {
            cache.insert(k.clone(), n, &request);
        }
        assert_eq!(cache.entries.len(), 4);
        assert!((10..14).all(|n| cache.get(&key(n)) == Some(n)));
        cache.insert(key(20), 20, &[key(20)]);
        assert_eq!(cache.entries.len(), 2);
        assert_eq!(cache.get(&key(20)), Some(20));

        // The same key again replaces the picture.
        cache.insert(key(20), 21, &[key(20)]);
        assert_eq!(cache.get(&key(20)), Some(21));
        assert_eq!(cache.entries.len(), 2);
    }
}
