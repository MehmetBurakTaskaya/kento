// SPDX-License-Identifier: MIT
//! The optional external tools (SPEC 4.2, 5.15, 5.17): what is on this computer, and installing
//! the pinned builds on request. The network is used only when the page asks for an install.
//!
//! Layout under the data folder: `tools/paths.json` (paths set in Settings), `tools/downloads/`
//! (`<file>.part` while downloading) and `tools/<group>/<version>/` (the unpacked binaries).

mod custom;
mod detect;
mod download;
mod install;
pub mod manifest;
mod unpack;

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Serialize, Serializer};
use tauri::{AppHandle, Emitter, Manager, State};

pub use detect::Source;
use detect::{Found, Places};
pub use download::Cancel;
use install::Layout;
use manifest::{Download, Group, Lock};

use crate::{i18n, AppState};

/// The event that carries `InstallProgress` to the page.
pub const EVENT: &str = "tools-progress";

/// One group as the page shows it (`ToolGroupStatus` in src/ipc.ts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolGroupStatus {
    pub id: String,
    /// Every tool of the group works, from wherever it was found.
    pub ready: bool,
    pub tools: Vec<ToolStatus>,
    /// Bytes to download for this computer; 0 when nothing is offered.
    pub download: u64,
    pub available: bool,
    /// A tool in use comes from an earlier Kento download than the pinned version.
    pub outdated: bool,
    /// Kento's own downloads of this group are on disk, so Settings can remove them.
    pub downloaded: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: String,
    pub path: Option<PathBuf>,
    pub version: Option<String>,
    pub source: Option<Source>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum InstallState {
    Downloading {
        done: u64,
        total: u64,
    },
    Verifying,
    Unpacking,
    Ready,
    /// Also sent when the install was cancelled, with a message saying so.
    Failed {
        message: String,
    },
}

/// `InstallProgress` in src/ipc.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InstallProgress {
    pub group: String,
    #[serde(flatten)]
    pub state: InstallState,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("toolchain.lock.json: {0}")]
    Lock(String),
    #[error("unknown tool group {0:?}")]
    UnknownGroup(String),
    #[error("unknown tool {0:?}")]
    UnknownTool(String),
    #[error("the {0} group has nothing to download for this computer")]
    Unavailable(String),
    #[error("download: {0}")]
    Network(String),
    #[error("the download does not match its pinned SHA-256")]
    Checksum,
    #[error("the archive has no {0}")]
    MissingEntry(String),
    #[error("unpacking: {0}")]
    Unpack(String),
    #[error("{0} did not run, or is older than Kento needs")]
    NotWorking(String),
    #[error("cancelled")]
    Cancelled,
    #[error("the {0} group is being installed")]
    Busy(String),
    #[error("removing: {0}")]
    Remove(io::Error),
    #[error("file system: {0}")]
    Io(#[from] io::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
}

impl Error {
    /// The translation key of the plain message the page shows for this error.
    pub fn message_key(&self) -> &'static str {
        match self {
            Error::Network(_) => "toolchain.failed.network",
            Error::Checksum => "toolchain.failed.checksum",
            Error::MissingEntry(_) | Error::Unpack(_) => "toolchain.failed.unpack",
            Error::Io(_) => "toolchain.failed.disk",
            Error::NotWorking(tool) if tool == "exiftool" => "toolchain.failed.check.exiftool",
            Error::NotWorking(_) => "toolchain.failed.check",
            Error::Cancelled => "toolchain.failed.cancelled",
            Error::Unavailable(_) => "toolchain.failed.unavailable",
            Error::Busy(_) => "toolchain.failed.busy",
            Error::Remove(_) => "toolchain.failed.remove",
            Error::Lock(_) | Error::UnknownGroup(_) | Error::UnknownTool(_) | Error::Json(_) => {
                "error.other"
            }
        }
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// The app's view of the optional tools. Cheap to clone; clones share everything.
#[derive(Clone)]
pub struct Toolchain {
    inner: Arc<Inner>,
}

struct Inner {
    /// `<data>/tools`
    root: PathBuf,
    lock: &'static Lock,
    platform: Option<&'static str>,
    places: Places,
    https_only: bool,
    custom: Mutex<custom::Paths>,
    /// The last detection; None until the first is needed.
    cache: Mutex<Option<Vec<ToolGroupStatus>>>,
    /// Installs under way, by group.
    running: Mutex<HashMap<String, Cancel>>,
}

/// One install handed out by `Toolchain::begin`.
pub struct Job {
    pub group: String,
    files: Vec<Download>,
    layout: Layout,
    cancel: Cancel,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Toolchain {
    /// Reads the custom paths; nothing is detected or downloaded yet.
    pub fn new(data: &Path) -> Self {
        Self::with(
            data.join("tools"),
            Lock::embedded(),
            manifest::current_platform(),
            Places::system(),
            true,
        )
    }

    fn with(
        root: PathBuf,
        lock: &'static Lock,
        platform: Option<&'static str>,
        places: Places,
        https_only: bool,
    ) -> Self {
        let custom = custom::load(&root.join("paths.json"));
        Self {
            inner: Arc::new(Inner {
                root,
                lock,
                platform,
                places,
                https_only,
                custom: Mutex::new(custom),
                cache: Mutex::new(None),
                running: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// Every group, from the cache when there is one. The first call runs each tool found with
    /// `-version`, so call it off the main thread.
    pub fn status(&self) -> Vec<ToolGroupStatus> {
        if let Some(cached) = lock(&self.inner.cache).clone() {
            return cached;
        }
        self.refresh()
    }

    /// Looks for every tool again.
    pub fn refresh(&self) -> Vec<ToolGroupStatus> {
        let custom = lock(&self.inner.custom).clone();
        let status: Vec<ToolGroupStatus> = self
            .inner
            .lock
            .groups
            .iter()
            .map(|group| self.detect(group, &custom))
            .collect();
        *lock(&self.inner.cache) = Some(status.clone());
        status
    }

    fn detect(&self, group: &Group, custom: &custom::Paths) -> ToolGroupStatus {
        let kento = self.kento_dirs(group);
        let places = &self.inner.places;
        // A first run of a large binary can take a while; the tools are probed side by side.
        let found: Vec<Option<Found>> = std::thread::scope(|scope| {
            let probes: Vec<_> = group
                .tools
                .iter()
                .map(|tool| {
                    let custom = custom.get(tool).map(PathBuf::as_path);
                    let kento = &kento;
                    scope.spawn(move || detect::find(tool, places, custom, kento))
                })
                .collect();
            probes
                .into_iter()
                .map(|probe| probe.join().ok().flatten())
                .collect()
        });
        let tools: Vec<ToolStatus> = group
            .tools
            .iter()
            .zip(found)
            .map(|(tool, found)| ToolStatus {
                id: tool.clone(),
                path: found.as_ref().map(|f| f.path.clone()),
                version: found.as_ref().map(|f| f.version.clone()),
                source: found.map(|f| f.source),
            })
            .collect();
        let platform = group.platform(self.inner.platform);
        let current = group
            .version
            .as_ref()
            .map(|version| self.inner.root.join(&group.id).join(version));
        let outdated = platform.is_some()
            && tools.iter().any(|tool| {
                tool.source == Some(Source::Kento)
                    && tool
                        .path
                        .as_ref()
                        .zip(current.as_ref())
                        .is_some_and(|(path, current)| !path.starts_with(current))
            });
        ToolGroupStatus {
            id: group.id.clone(),
            ready: !tools.is_empty() && tools.iter().all(|tool| tool.path.is_some()),
            tools,
            download: platform.map_or(0, |p| p.files.iter().map(|file| file.size).sum()),
            available: platform.is_some(),
            outdated,
            downloaded: kento.iter().any(|dir| dir.is_dir()),
        }
    }

    /// Kento's install folders for a group: the pinned version first, then versions an earlier
    /// Kento installed, so an app update never leaves the user without tools.
    fn kento_dirs(&self, group: &Group) -> Vec<PathBuf> {
        let dir = self.inner.root.join(&group.id);
        let current = group.version.as_ref().map(|version| dir.join(version));
        let mut earlier: Vec<PathBuf> = fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_dir()
                    && Some(path) != current.as_ref()
                    && !path.to_string_lossy().ends_with(".partial")
            })
            .collect();
        earlier.sort_unstable_by(|a, b| b.cmp(a));
        current.into_iter().chain(earlier).collect()
    }

    /// The paths jobs hand to the engines.
    pub fn engine_tools(&self) -> kento_engines::Tools {
        let status = self.status();
        let path = |id: &str| {
            status
                .iter()
                .flat_map(|group| &group.tools)
                .find(|tool| tool.id == id)
                .and_then(|tool| tool.path.clone())
        };
        kento_engines::Tools {
            ffmpeg: path("ffmpeg"),
            ffprobe: path("ffprobe"),
            exiftool: path("exiftool"),
            soffice: path("soffice"),
        }
    }

    /// Sets or clears the path of one tool. A path is kept only when the tool there runs; a
    /// folder stands for the tool's file inside it.
    pub fn set_path(
        &self,
        tool: &str,
        path: Option<PathBuf>,
    ) -> Result<Vec<ToolGroupStatus>, Error> {
        if self.inner.lock.group_of(tool).is_none() {
            return Err(Error::UnknownTool(tool.to_string()));
        }
        let mut paths = lock(&self.inner.custom).clone();
        match path {
            Some(path) => {
                let path = if path.is_dir() {
                    path.join(self.inner.places.file_name(tool))
                } else {
                    path
                };
                if !path.is_absolute() || detect::probe(tool, &path).is_none() {
                    return Err(Error::NotWorking(tool.to_string()));
                }
                paths.insert(tool.to_string(), path);
            }
            None => {
                paths.remove(tool);
            }
        }
        custom::save(&self.inner.root.join("paths.json"), &paths)?;
        *lock(&self.inner.custom) = paths;
        Ok(self.refresh())
    }

    /// Claims the group for an install. None when one is already running: a second request is
    /// ignored.
    pub fn begin(&self, group: &str) -> Result<Option<Job>, Error> {
        let entry = self
            .inner
            .lock
            .group(group)
            .ok_or_else(|| Error::UnknownGroup(group.to_string()))?;
        let platform = entry
            .platform(self.inner.platform)
            .ok_or_else(|| Error::Unavailable(group.to_string()))?;
        let version = entry
            .version
            .as_deref()
            .ok_or_else(|| Error::Lock(format!("{group} has no version")))?;
        let mut running = lock(&self.inner.running);
        if running.contains_key(group) {
            return Ok(None);
        }
        let cancel = Cancel::default();
        running.insert(group.to_string(), cancel.clone());
        let names = entry
            .tools
            .iter()
            .map(|tool| (tool.clone(), self.inner.places.file_name(tool)))
            .collect();
        Ok(Some(Job {
            group: group.to_string(),
            files: platform.files.clone(),
            layout: Layout {
                downloads: self.inner.root.join("downloads"),
                dest: self.inner.root.join(group).join(version),
                names,
            },
            cancel,
        }))
    }

    /// Stops a running install; its partial download stays for the next try.
    pub fn cancel(&self, group: &str) {
        if let Some(cancel) = lock(&self.inner.running).get(group) {
            cancel.cancel();
        }
    }

    /// Deletes Kento's own downloads of a group, every version and any half-finished download,
    /// then looks for the tools again. Tools found elsewhere on the computer are never touched.
    pub fn remove(&self, group: &str) -> Result<Vec<ToolGroupStatus>, Error> {
        let entry = self
            .inner
            .lock
            .group(group)
            .ok_or_else(|| Error::UnknownGroup(group.to_string()))?;
        // Held while deleting, so an install cannot start halfway through.
        let running = lock(&self.inner.running);
        if running.contains_key(group) {
            return Err(Error::Busy(group.to_string()));
        }
        let gone = |result: io::Result<()>| match result {
            Err(err) if err.kind() != io::ErrorKind::NotFound => Err(Error::Remove(err)),
            _ => Ok(()),
        };
        let downloads = self.inner.root.join("downloads");
        let files = entry
            .platform(self.inner.platform)
            .map_or(&[][..], |platform| &platform.files[..]);
        let mut result = gone(fs::remove_dir_all(self.inner.root.join(&entry.id)));
        for file in files {
            for name in [
                file.file_name().to_string(),
                format!("{}.part", file.file_name()),
            ] {
                result = result.and(gone(fs::remove_file(downloads.join(name))));
            }
        }
        drop(running);
        let status = self.refresh();
        result.map(|()| status)
    }

    pub fn is_installing(&self, group: &str) -> bool {
        lock(&self.inner.running).contains_key(group)
    }

    /// Runs an install from `begin` and looks for the tools again. The group is free for another
    /// install once this returns.
    pub async fn run(
        &self,
        job: Job,
        report: &(dyn Fn(InstallState) + Send + Sync),
    ) -> Result<(), Error> {
        let result = self.run_job(&job, report).await;
        lock(&self.inner.running).remove(&job.group);
        result
    }

    async fn run_job(
        &self,
        job: &Job,
        report: &(dyn Fn(InstallState) + Send + Sync),
    ) -> Result<(), Error> {
        let client = download::client(self.inner.https_only)?;
        install::install(&client, &job.files, &job.layout, &job.cancel, report).await?;
        let this = self.clone();
        let layout = job.layout.clone();
        let group = job.group.clone();
        tokio::task::spawn_blocking(move || {
            // The new copies must work themselves, whatever else detection would find.
            let broken = layout
                .names
                .iter()
                .find(|(tool, name)| detect::probe(tool, &layout.dest.join(name)).is_none());
            if let Some((tool, _)) = broken {
                return Err(Error::NotWorking(tool.clone()));
            }
            this.remove_earlier(&group, &layout.dest);
            this.refresh();
            Ok(())
        })
        .await
        .map_err(|err| Error::Unpack(err.to_string()))?
    }

    /// Removes versions an earlier Kento installed once the pinned one works. A copy still in use
    /// by a job stays until next time.
    fn remove_earlier(&self, group: &str, current: &Path) {
        let Ok(entries) = fs::read_dir(self.inner.root.join(group)) else {
            return;
        };
        for path in entries.flatten().map(|entry| entry.path()) {
            if path != current && path.is_dir() && fs::remove_dir_all(&path).is_err() {
                tracing::info!("an earlier {group} install could not be removed yet");
            }
        }
    }
}

/// Fills the engines' tool paths for a job (SPEC 4.2). The first call after start or a change may
/// run the tools with `-version`, so call it from the job's worker thread.
pub fn engine_tools(state: &AppState) -> kento_engines::Tools {
    state.toolchain.engine_tools()
}

fn explain(state: &AppState, err: &Error) -> crate::error::Error {
    crate::error::Error::Invalid(i18n::text(&state.lang(), err.message_key()))
}

#[tauri::command]
pub async fn tools_status(app: AppHandle) -> crate::error::Result<Vec<ToolGroupStatus>> {
    let toolchain = app.state::<AppState>().toolchain.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || toolchain.status()).await?)
}

/// Starts installing a group in the background; progress arrives as `tools-progress` events.
#[tauri::command]
pub fn tools_install(
    app: AppHandle,
    state: State<'_, AppState>,
    group: String,
) -> crate::error::Result<()> {
    let toolchain = state.toolchain.clone();
    let job = match toolchain.begin(&group) {
        Ok(Some(job)) => job,
        Ok(None) => return Ok(()),
        Err(err) => return Err(explain(&state, &err)),
    };
    tauri::async_runtime::spawn(async move {
        let emit = |state: InstallState| {
            let progress = InstallProgress {
                group: group.clone(),
                state,
            };
            if let Err(err) = app.emit(EVENT, progress) {
                tracing::warn!("tool progress not sent: {err}");
            }
        };
        let last = match toolchain.run(job, &emit).await {
            Ok(()) => {
                tracing::info!("the {group} tools are installed");
                InstallState::Ready
            }
            Err(err) => {
                if matches!(err, Error::Cancelled) {
                    tracing::info!("installing the {group} tools was cancelled");
                } else {
                    tracing::warn!("installing the {group} tools failed: {err}");
                }
                let lang = app.state::<AppState>().lang();
                InstallState::Failed {
                    message: i18n::text(&lang, err.message_key()),
                }
            }
        };
        emit(last);
    });
    Ok(())
}

#[tauri::command]
pub fn tools_cancel(state: State<'_, AppState>, group: String) {
    state.toolchain.cancel(&group);
}

/// Settings › Tools › Verify again.
#[tauri::command]
pub async fn tools_refresh(app: AppHandle) -> crate::error::Result<Vec<ToolGroupStatus>> {
    let toolchain = app.state::<AppState>().toolchain.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || toolchain.refresh()).await?)
}

#[tauri::command]
pub async fn tools_remove(
    app: AppHandle,
    group: String,
) -> crate::error::Result<Vec<ToolGroupStatus>> {
    let toolchain = app.state::<AppState>().toolchain.clone();
    let result = tauri::async_runtime::spawn_blocking(move || toolchain.remove(&group)).await?;
    result.map_err(|err| explain(&app.state::<AppState>(), &err))
}

/// Settings › Tools › Choose: the program is picked in the system's file dialog, so the page can
/// never hand Kento something to run. None when the dialog was closed.
#[tauri::command]
pub async fn tools_choose(
    app: AppHandle,
    tool: String,
) -> crate::error::Result<Option<Vec<ToolGroupStatus>>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file();
    if let Some(window) = app.get_webview_window(crate::window::MAIN) {
        dialog = dialog.set_parent(&window);
    }
    if cfg!(windows) {
        dialog = dialog.add_filter(&tool, &["exe"]);
    }
    dialog.pick_file(move |file| {
        let _ = tx.send(file);
    });
    let Some(path) = rx
        .await
        .ok()
        .flatten()
        .and_then(|file| file.into_path().ok())
    else {
        return Ok(None);
    };
    set_path(app, tool, Some(path)).await.map(Some)
}

/// Settings › Tools › Find automatically: forgets the chosen program.
#[tauri::command]
pub async fn tools_clear_path(
    app: AppHandle,
    tool: String,
) -> crate::error::Result<Vec<ToolGroupStatus>> {
    set_path(app, tool, None).await
}

async fn set_path(
    app: AppHandle,
    tool: String,
    path: Option<PathBuf>,
) -> crate::error::Result<Vec<ToolGroupStatus>> {
    let toolchain = app.state::<AppState>().toolchain.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || toolchain.set_path(&tool, path)).await?;
    result.map_err(|err| explain(&app.state::<AppState>(), &err))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::toolchain::detect::tests::{fake_exiftool, fake_tool, FAKE_SUFFIX};
    use crate::toolchain::download::tests::{serve, sha256, Mode};
    use crate::toolchain::unpack::tests::zip_of;
    use serde_json::json;

    fn toolchain(root: &Path, places: Places) -> Toolchain {
        Toolchain::with(
            root.to_path_buf(),
            Lock::embedded(),
            manifest::current_platform(),
            places,
            false,
        )
    }

    fn nowhere(base: &Path) -> Places {
        Places {
            search: vec![base.join("empty")],
            suffix: FAKE_SUFFIX,
        }
    }

    #[test]
    fn progress_and_status_match_the_page_contract() {
        let progress = |state| {
            serde_json::to_value(InstallProgress {
                group: "media".into(),
                state,
            })
            .unwrap()
        };
        assert_eq!(
            progress(InstallState::Downloading { done: 5, total: 9 }),
            json!({ "group": "media", "state": "downloading", "done": 5, "total": 9 })
        );
        assert_eq!(
            progress(InstallState::Verifying),
            json!({ "group": "media", "state": "verifying" })
        );
        assert_eq!(
            progress(InstallState::Unpacking),
            json!({ "group": "media", "state": "unpacking" })
        );
        assert_eq!(
            progress(InstallState::Ready),
            json!({ "group": "media", "state": "ready" })
        );
        assert_eq!(
            progress(InstallState::Failed {
                message: "No".into()
            }),
            json!({ "group": "media", "state": "failed", "message": "No" })
        );

        let status = ToolGroupStatus {
            id: "media".into(),
            ready: false,
            tools: vec![
                ToolStatus {
                    id: "ffmpeg".into(),
                    path: Some(PathBuf::from("ffmpeg")),
                    version: Some("9.0.2".into()),
                    source: Some(Source::Kento),
                },
                ToolStatus {
                    id: "ffprobe".into(),
                    path: None,
                    version: None,
                    source: None,
                },
            ],
            download: 42,
            available: true,
            outdated: false,
            downloaded: true,
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            json!({
                "id": "media",
                "ready": false,
                "tools": [
                    { "id": "ffmpeg", "path": "ffmpeg", "version": "9.0.2", "source": "kento" },
                    { "id": "ffprobe", "path": null, "version": null, "source": null }
                ],
                "download": 42,
                "available": true,
                "outdated": false,
                "downloaded": true
            })
        );
        for (source, text) in [(Source::System, "system"), (Source::Custom, "custom")] {
            assert_eq!(serde_json::to_value(source).unwrap(), json!(text));
        }
    }

    #[test]
    fn status_lists_every_group_and_what_this_computer_can_download() {
        let base = tempfile::tempdir().unwrap();
        let chain = toolchain(&base.path().join("tools"), nowhere(base.path()));
        let status = chain.status();
        let ids: Vec<&str> = status.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, ["media", "office", "extras"]);
        for (group, tools) in [(&status[0], 2), (&status[2], 1)] {
            assert!(!group.ready);
            assert_eq!(group.tools.len(), tools);
            assert!(group
                .tools
                .iter()
                .all(|t| t.path.is_none() && t.source.is_none()));
            let pinned = Lock::embedded()
                .group(&group.id)
                .unwrap()
                .platform(manifest::current_platform());
            assert_eq!(group.available, pinned.is_some());
            assert_eq!(
                group.download,
                pinned.map_or(0, |p| p.files.iter().map(|f| f.size).sum())
            );
        }
        let office = &status[1];
        assert!(!office.ready && !office.available);
        assert_eq!(office.download, 0);
        assert_eq!(chain.engine_tools(), kento_engines::Tools::default());
    }

    #[test]
    fn exiftool_is_found_and_handed_to_the_engines() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("tools");
        let (system, places) = fake_exiftool(&base.path().join("system ğ 🧪"), "13.60");
        let chain = toolchain(&root, places.clone());
        let extras = &chain.status()[2];
        assert!(extras.ready);
        assert_eq!(extras.tools[0].version.as_deref(), Some("13.60"));
        assert_eq!(chain.engine_tools().exiftool, Some(system));

        // A chosen ExifTool must be one; FFmpeg is not.
        let (ffmpeg, _) = fake_tool(&base.path().join("ffmpeg"), "ffmpeg", "9.0");
        assert!(matches!(
            chain.set_path("exiftool", Some(ffmpeg)),
            Err(Error::NotWorking(tool)) if tool == "exiftool"
        ));
        let (custom, _) = fake_exiftool(&base.path().join("custom"), "12.40");
        let status = chain
            .set_path("exiftool", Some(custom.parent().unwrap().to_path_buf()))
            .unwrap();
        assert_eq!(status[2].tools[0].source, Some(Source::Custom));
        assert_eq!(chain.engine_tools().exiftool, Some(custom));
        assert_eq!(
            Error::NotWorking("exiftool".into()).message_key(),
            "toolchain.failed.check.exiftool"
        );
    }

    #[test]
    fn a_custom_path_is_checked_kept_and_used() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("tools");
        let (system_ffprobe, places) = fake_tool(&base.path().join("system"), "ffprobe", "7.1");
        let (custom, _) = fake_tool(&base.path().join("my tools ğ"), "ffmpeg", "8.0.1");
        let chain = toolchain(&root, places.clone());

        // A path that does not run is refused and nothing is written.
        let broken = base.path().join("nothing").join("ffmpeg.exe");
        assert!(matches!(
            chain.set_path("ffmpeg", Some(broken)),
            Err(Error::NotWorking(_))
        ));
        assert!(matches!(
            chain.set_path("ffprobe", Some(custom.clone())),
            Err(Error::NotWorking(_))
        ));
        assert!(matches!(
            chain.set_path("soffice", None),
            Err(Error::UnknownTool(_))
        ));
        assert!(!root.join("paths.json").exists());

        // A folder stands for the tool inside it.
        let status = chain
            .set_path("ffmpeg", Some(custom.parent().unwrap().to_path_buf()))
            .unwrap();
        let media = &status[0];
        assert!(media.ready);
        assert_eq!(media.tools[0].path.as_deref(), Some(custom.as_path()));
        assert_eq!(media.tools[0].source, Some(Source::Custom));
        assert_eq!(media.tools[0].version.as_deref(), Some("8.0.1"));
        assert_eq!(media.tools[1].source, Some(Source::System));
        assert_eq!(
            chain.engine_tools(),
            kento_engines::Tools {
                ffmpeg: Some(custom.clone()),
                ffprobe: Some(system_ffprobe),
                exiftool: None,
                soffice: None,
            }
        );

        // Kept across restarts.
        let again = toolchain(&root, places.clone());
        assert_eq!(again.status()[0].tools[0].source, Some(Source::Custom));

        let cleared = again.set_path("ffmpeg", None).unwrap();
        assert!(!cleared[0].ready);
        assert_eq!(cleared[0].tools[0].path, None);
        assert!(toolchain(&root, places).status()[0].tools[0].path.is_none());
    }

    #[test]
    fn one_install_per_group_and_only_where_something_is_offered() {
        let base = tempfile::tempdir().unwrap();
        let chain = toolchain(&base.path().join("tools"), nowhere(base.path()));
        assert!(matches!(chain.begin("nope"), Err(Error::UnknownGroup(_))));
        assert!(matches!(chain.begin("office"), Err(Error::Unavailable(_))));
        let media = Lock::embedded().group("media").unwrap();
        if media.platform(manifest::current_platform()).is_none() {
            assert!(matches!(chain.begin("media"), Err(Error::Unavailable(_))));
            return;
        }
        let job = chain.begin("media").unwrap().unwrap();
        assert!(chain.is_installing("media"));
        assert!(chain.begin("media").unwrap().is_none());
        chain.cancel("media");
        assert!(job.cancel.is_cancelled());
        assert!(job.layout.dest.ends_with(Path::new("media").join("9.0.2")));
    }

    #[tokio::test]
    async fn an_install_puts_working_tools_in_kentos_folder() {
        let base = tempfile::tempdir().unwrap();
        let (ffmpeg, places) = fake_tool(&base.path().join("built"), "ffmpeg", "9.0.2");
        let (ffprobe, _) = fake_tool(&base.path().join("built"), "ffprobe", "9.0.2");
        let names = (places.file_name("ffmpeg"), places.file_name("ffprobe"));
        let archive = zip_of(&[
            (
                format!("pack/{}", names.0).as_str(),
                fs::read(&ffmpeg).unwrap().as_slice(),
            ),
            (
                format!("pack/{}", names.1).as_str(),
                fs::read(&ffprobe).unwrap().as_slice(),
            ),
        ]);
        let server = serve(archive.clone(), Mode::Ranges);
        let text = json!({
            "schema": 1,
            "groups": [{
                "id": "media", "available": true, "version": "9.0.2", "tools": ["ffmpeg", "ffprobe"],
                "platforms": { "windows-x64": { "source": "test", "files": [{
                    "url": "https://example.org/tool.zip",
                    "size": archive.len(), "sha256": sha256(&archive), "archive": "zip",
                    "entries": { "ffmpeg": format!("pack/{}", names.0), "ffprobe": format!("pack/{}", names.1) }
                }]}}
            }]
        });
        let mut lock = Lock::parse(&text.to_string()).unwrap();
        // The lockfile only takes HTTPS; the test server speaks plain HTTP.
        lock.groups[0]
            .platforms
            .get_mut("windows-x64")
            .unwrap()
            .files[0]
            .url = server.url.clone();
        let lock: &'static Lock = Box::leak(Box::new(lock));

        let root = base.path().join("tools");
        let empty = Places {
            search: vec![base.path().join("empty")],
            suffix: places.suffix,
        };
        let chain = Toolchain::with(root.clone(), lock, Some("windows-x64"), empty, false);
        // An earlier Kento's download works but is not the pinned version.
        let earlier = root.join("media").join("8.0");
        fake_tool(&earlier, "ffmpeg", "8.0");
        fake_tool(&earlier, "ffprobe", "8.0");
        let before = &chain.status()[0];
        assert!(before.ready && before.outdated && before.downloaded);

        let job = chain.begin("media").unwrap().unwrap();
        let states = Mutex::new(Vec::new());
        chain
            .run(job, &|state| states.lock().unwrap().push(state))
            .await
            .unwrap();
        assert!(!chain.is_installing("media"));
        assert_eq!(
            states.into_inner().unwrap().last(),
            Some(&InstallState::Unpacking)
        );

        let media = &chain.status()[0];
        assert!(media.ready);
        for tool in &media.tools {
            assert_eq!(tool.source, Some(Source::Kento));
            assert_eq!(tool.version.as_deref(), Some("9.0.2"));
            assert!(tool
                .path
                .as_ref()
                .unwrap()
                .starts_with(root.join("media").join("9.0.2")));
        }
        assert!(!media.outdated && media.downloaded);
        assert!(!earlier.exists());
        assert_eq!(fs::read_dir(root.join("downloads")).unwrap().count(), 0);

        // Removing deletes only Kento's own folder, and not while an install runs.
        let job = chain.begin("media").unwrap().unwrap();
        assert!(matches!(chain.remove("media"), Err(Error::Busy(_))));
        chain.cancel("media");
        let _ = chain.run(job, &|_| {}).await;
        fs::write(root.join("downloads").join("tool.zip.part"), b"half").unwrap();
        let media = &chain.remove("media").unwrap()[0];
        assert!(!media.ready && !media.downloaded);
        assert!(!root.join("media").exists());
        assert!(ffmpeg.is_file());
        assert_eq!(fs::read_dir(root.join("downloads")).unwrap().count(), 0);
    }

    /// The real thing: installs the pinned Media build for this computer into a temporary folder
    /// and runs it. `KENTO_TOOLCHAIN_DOWNLOADS` may name a folder that already holds the pinned
    /// files (they are still verified); otherwise they are downloaded.
    #[tokio::test]
    #[ignore = "downloads the pinned FFmpeg build; run with --ignored"]
    async fn installs_the_pinned_build_for_this_computer() {
        install_pinned("media").await;
    }

    /// The same for the Extras group: ExifTool with its Perl folder (Windows) or library (macOS).
    #[tokio::test]
    #[ignore = "downloads the pinned ExifTool; run with --ignored"]
    async fn installs_the_pinned_exiftool_for_this_computer() {
        install_pinned("extras").await;
    }

    async fn install_pinned(group: &str) {
        let base = tempfile::tempdir().unwrap();
        // ExifTool's Windows launcher finds its Perl through the system code page, so it cannot
        // start from a folder whose name has letters outside it (an emoji always is).
        let root = base.path().join("tools");
        let places = Places {
            search: Vec::new(),
            suffix: std::env::consts::EXE_SUFFIX,
        };
        let platform = manifest::current_platform();
        let chain = Toolchain::with(root.clone(), Lock::embedded(), platform, places, true);
        let Some(job) = chain.begin(group).ok().flatten() else {
            eprintln!("nothing pinned for this computer; skipped");
            return;
        };
        if let Some(cached) = std::env::var_os("KENTO_TOOLCHAIN_DOWNLOADS") {
            fs::create_dir_all(&job.layout.downloads).unwrap();
            for file in &job.files {
                let name = file.file_name();
                fs::copy(
                    Path::new(&cached).join(name),
                    job.layout.downloads.join(name),
                )
                .unwrap();
            }
        }
        chain
            .run(job, &|state| eprintln!("{state:?}"))
            .await
            .unwrap();
        let pinned = Lock::embedded().group(group).unwrap().version.clone();
        let status = chain.status();
        let installed = status.iter().find(|g| g.id == group).unwrap();
        assert!(installed.ready, "{installed:?}");
        for tool in &installed.tools {
            assert_eq!(tool.source, Some(Source::Kento));
            assert_eq!(tool.version, pinned);
            eprintln!(
                "{} {} runs from {}",
                tool.id,
                tool.version.as_deref().unwrap_or_default(),
                tool.path.as_ref().unwrap().display()
            );
        }
    }

    #[test]
    fn every_failure_has_a_message_key() {
        for err in [
            Error::Network("x".into()),
            Error::Checksum,
            Error::Unpack("x".into()),
            Error::Io(io::Error::other("x")),
            Error::NotWorking("ffmpeg".into()),
            Error::Cancelled,
            Error::Unavailable("office".into()),
            Error::Busy("media".into()),
            Error::Remove(io::Error::other("x")),
        ] {
            assert!(err.message_key().starts_with("toolchain.failed."));
        }
        assert_eq!(Error::UnknownGroup("x".into()).message_key(), "error.other");
    }
}
