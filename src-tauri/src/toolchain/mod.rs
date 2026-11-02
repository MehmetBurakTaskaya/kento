// SPDX-License-Identifier: MIT
//! The optional external tools (SPEC 4.2, 5.15, 5.17): what is on this computer, and installing
//! the pinned builds on request. The network is used only when the page asks for an install or
//! for a newer yt-dlp.
//!
//! Layout under the data folder: `tools/paths.json` (paths set in Settings), `tools/downloads/`
//! (`<file>.part` while downloading, `<file>.image` while an installer image is open),
//! `tools/<group>/<version>/` (the unpacked binaries, or the program folder a tool runs from) and
//! `tools/<group>/<tool>/<version>/` for a tool pinned at a version of its own (yt-dlp, Deno),
//! which is installed, updated and found on its own.

mod custom;
mod detect;
mod download;
mod image;
mod install;
pub mod manifest;
mod unpack;
pub mod ytdlp;

use std::cmp::Ordering as Order;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Serialize, Serializer};
use tauri::{AppHandle, Emitter, Manager, State};

pub use detect::Source;
use detect::{Found, Places};
pub use download::Cancel;
use install::{Layout, Unit};
use manifest::{compare_versions, Group, Lock};

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
    /// Bytes to download for this computer: only the downloads of tools missing or outdated, so
    /// 0 when nothing is offered or nothing is needed.
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
    #[error("the administrative install of the package failed: {0}")]
    AdminInstall(String),
    /// Windows Installer runs one installation at a time.
    #[error("another installation is running")]
    InstallerBusy,
    #[error("the disk image: {0}")]
    DiskImage(String),
    #[error("{0} did not run, or is older than Kento needs")]
    NotWorking(String),
    #[error("{0} is not installed")]
    Missing(String),
    #[error("{0} was not installed by Kento; it is updated where it came from")]
    Elsewhere(String),
    #[error("the newest release: {0}")]
    Release(String),
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
            Error::AdminInstall(_) => "toolchain.failed.msi",
            Error::InstallerBusy => "toolchain.failed.msi.busy",
            Error::DiskImage(_) => "toolchain.failed.dmg",
            Error::Io(_) => "toolchain.failed.disk",
            Error::NotWorking(tool) if tool == "exiftool" => "toolchain.failed.check.exiftool",
            Error::NotWorking(tool) if tool == "soffice" => "toolchain.failed.check.soffice",
            Error::NotWorking(tool) if tool == "yt-dlp" => "toolchain.failed.check.ytdlp",
            Error::NotWorking(tool) if tool == "deno" => "toolchain.failed.check.deno",
            // A resource is never run: when it is not there after an install, the unpacking failed.
            Error::NotWorking(tool)
                if Lock::embedded()
                    .group_of(tool)
                    .is_some_and(|group| group.is_resource(tool)) =>
            {
                "toolchain.failed.unpack"
            }
            Error::NotWorking(_) => "toolchain.failed.check",
            Error::Missing(_) => "toolchain.ytdlp.missing",
            Error::Elsewhere(_) => "toolchain.ytdlp.elsewhere",
            Error::Release(_) => "toolchain.failed.release",
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
    /// Every install folder this computer can download for the group; the run fills only those
    /// with a tool that is missing or outdated.
    units: Vec<Unit>,
    cancel: Cancel,
}

/// Whether a folder is an unpack that never finished.
fn is_partial(path: &Path) -> bool {
    path.to_string_lossy().ends_with(".partial")
}

/// The last part of a path, as text.
fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
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
        let programs = self.programs(group);
        let places = &self.inner.places;
        let kento: Vec<Vec<PathBuf>> = group
            .tools
            .iter()
            .map(|tool| self.kento_dirs(group, tool))
            .collect();
        // A first run of a large binary can take a while; the tools are probed side by side.
        let found: Vec<Option<Found>> = std::thread::scope(|scope| {
            let probes: Vec<_> = group
                .tools
                .iter()
                .zip(&kento)
                .map(|(tool, dirs)| {
                    let custom = custom.get(tool).map(PathBuf::as_path);
                    let own: Vec<PathBuf> =
                        dirs.iter().map(|dir| dir.join(&programs[tool])).collect();
                    let resource = group.is_resource(tool);
                    scope.spawn(move || {
                        if resource {
                            detect::find_file(&own)
                        } else {
                            detect::find(tool, places, custom, &own)
                        }
                    })
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
        // Only the downloads of what is missing or outdated: a working FFmpeg is not fetched again
        // to add yt-dlp.
        let download = platform.map_or(0, |platform| {
            platform
                .files
                .iter()
                .filter(|file| self.needs(group, &tools, group.own_tool(file)))
                .map(|file| file.size)
                .sum()
        });
        ToolGroupStatus {
            id: group.id.clone(),
            ready: !tools.is_empty() && tools.iter().all(|tool| tool.path.is_some()),
            outdated: platform.is_some() && tools.iter().any(|tool| self.outdated(group, tool)),
            tools,
            download,
            available: platform.is_some(),
            downloaded: kento.iter().flatten().any(|dir| dir.is_dir()),
        }
    }

    /// The folder that holds the version folders of a tool: the group's own, or for a tool with a
    /// version of its own a folder named after it inside the group's.
    fn tool_dir(&self, group: &Group, tool: &str) -> PathBuf {
        let dir = self.inner.root.join(&group.id);
        if group.versions.contains_key(tool) {
            dir.join(tool)
        } else {
            dir
        }
    }

    /// The pinned install folder of a tool.
    fn pinned_dir(&self, group: &Group, tool: &str) -> Option<PathBuf> {
        group
            .version_of(tool)
            .map(|version| self.tool_dir(group, tool).join(version))
    }

    /// Kento's install folders that may hold a tool, in the order they are tried. Under the
    /// group's version: the pinned version first, then versions an earlier Kento installed, so an
    /// app update never leaves the user without tools. A tool with a version of its own: the newest
    /// first, so a yt-dlp updated in Settings comes before the pinned one.
    fn kento_dirs(&self, group: &Group, tool: &str) -> Vec<PathBuf> {
        let dir = self.tool_dir(group, tool);
        let own = group.versions.contains_key(tool);
        let mut found: Vec<PathBuf> = fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                // Beside the group's version folders lie the folders of tools with their own.
                path.is_dir()
                    && !is_partial(path)
                    && (own || !group.versions.contains_key(&name_of(path)))
            })
            .collect();
        if own {
            found.sort_by(|a, b| compare_versions(&name_of(b), &name_of(a)));
            return found;
        }
        let current = self.pinned_dir(group, tool);
        found.retain(|path| Some(path) != current.as_ref());
        found.sort_unstable_by(|a, b| b.cmp(a));
        current.into_iter().chain(found).collect()
    }

    /// A tool in use is Kento's copy from a download older than the pinned one. A copy newer than
    /// the pinned one (yt-dlp updated in Settings) is not.
    fn outdated(&self, group: &Group, tool: &ToolStatus) -> bool {
        let (Some(Source::Kento), Some(path), Some(pinned)) =
            (tool.source, tool.path.as_ref(), group.version_of(&tool.id))
        else {
            return false;
        };
        let dir = self.tool_dir(group, &tool.id);
        let folder = path
            .strip_prefix(&dir)
            .ok()
            .and_then(|rest| rest.components().next())
            .map(|part| part.as_os_str().to_string_lossy().into_owned());
        match folder {
            Some(folder) if group.versions.contains_key(&tool.id) => {
                compare_versions(&folder, pinned) == Order::Less
            }
            Some(folder) => folder != pinned,
            None => true,
        }
    }

    /// Whether the downloads of an install folder are needed: one of its tools (those under the
    /// group's version for `own == None`, else that one tool) is missing or outdated.
    fn needs(&self, group: &Group, tools: &[ToolStatus], own: Option<&str>) -> bool {
        tools
            .iter()
            .filter(|tool| match own {
                Some(own) => tool.id == own,
                None => !group.versions.contains_key(&tool.id),
            })
            .any(|tool| tool.path.is_none() || self.outdated(group, tool))
    }

    /// Where each tool of a group lies in one of Kento's install folders: next to the others
    /// (`ffmpeg.exe`), inside the program folder it runs from, as this computer's pinned download
    /// lays it out (`LibreOffice/program/soffice.exe`), or for a resource under its own name
    /// (`BEN2_Base.onnx`).
    fn programs(&self, group: &Group) -> BTreeMap<String, PathBuf> {
        let file_name = |tool: &str| self.inner.places.file_name(tool);
        let mut programs = group
            .platform(self.inner.platform)
            .map(|platform| group.programs(platform, file_name))
            .unwrap_or_default();
        for tool in &group.tools {
            programs
                .entry(tool.clone())
                .or_insert_with(|| PathBuf::from(file_name(tool)));
        }
        programs
    }

    /// The paths jobs hand to the engines.
    pub fn engine_tools(&self) -> kento_engines::Tools {
        Self::tools_in(&self.status())
    }

    /// The paths of the tools of some groups only (`media`, `office`, `extras`), looked for
    /// afresh and not cached: the command line runs only what one command needs.
    pub fn engine_tools_of(&self, groups: &[&str]) -> kento_engines::Tools {
        let custom = lock(&self.inner.custom).clone();
        let status: Vec<ToolGroupStatus> = self
            .inner
            .lock
            .groups
            .iter()
            .filter(|group| groups.contains(&group.id.as_str()))
            .map(|group| self.detect(group, &custom))
            .collect();
        Self::tools_in(&status)
    }

    fn tools_in(status: &[ToolGroupStatus]) -> kento_engines::Tools {
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
            ytdlp: path("yt-dlp"),
            deno: path("deno"),
            onnxruntime: path("onnxruntime"),
            bg_model: path("bg-model"),
        }
    }

    /// Sets or clears the path of one tool. A path is kept only when the tool there runs; a
    /// folder stands for the tool's file inside it (for LibreOffice also its install folder or
    /// `LibreOffice.app`). Resources are Kento's own downloads only, so they take no path.
    pub fn set_path(
        &self,
        tool: &str,
        path: Option<PathBuf>,
    ) -> Result<Vec<ToolGroupStatus>, Error> {
        if self
            .inner
            .lock
            .group_of(tool)
            .is_none_or(|group| group.is_resource(tool))
        {
            return Err(Error::UnknownTool(tool.to_string()));
        }
        let mut paths = lock(&self.inner.custom).clone();
        match path {
            Some(path) => {
                let path = detect::resolve(tool, &path, &self.inner.places);
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
        let programs = self.programs(entry);
        // One install folder per version: the group's, and each tool's own.
        let mut units: Vec<(Option<&str>, Unit)> = Vec::new();
        for file in &platform.files {
            let own = entry.own_tool(file);
            if let Some((_, unit)) = units.iter_mut().find(|(key, _)| *key == own) {
                unit.files.push(file.clone());
                continue;
            }
            let tool = own.or_else(|| file.entries.keys().next().map(String::as_str));
            let dest = tool
                .and_then(|tool| self.pinned_dir(entry, tool))
                .ok_or_else(|| Error::Lock(format!("{group} has no version")))?;
            let tools: Vec<&String> = match own {
                Some(own) => entry.tools.iter().filter(|t| *t == own).collect(),
                None => entry
                    .tools
                    .iter()
                    .filter(|t| !entry.versions.contains_key(*t))
                    .collect(),
            };
            let layout = Layout {
                downloads: self.inner.root.join("downloads"),
                dest,
                programs: tools
                    .into_iter()
                    .map(|tool| (tool.clone(), programs[tool].clone()))
                    .collect(),
            };
            units.push((
                own,
                Unit {
                    files: vec![file.clone()],
                    layout,
                },
            ));
        }
        let Some(cancel) = self.claim(group) else {
            return Ok(None);
        };
        Ok(Some(Job {
            group: group.to_string(),
            units: units.into_iter().map(|(_, unit)| unit).collect(),
            cancel,
        }))
    }

    /// Marks the group busy for an install, an update or a removal; None when it already is.
    fn claim(&self, group: &str) -> Option<Cancel> {
        let mut running = lock(&self.inner.running);
        if running.contains_key(group) {
            return None;
        }
        let cancel = Cancel::default();
        running.insert(group.to_string(), cancel.clone());
        Some(cancel)
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
            // An installer image left open by an install that never finished; a disk image still
            // attached there cannot be deleted, and is no reason to fail.
            let scratch = install::image_scratch(&downloads, file);
            if file.archive.is_image() && scratch.exists() {
                if let Err(err) = fs::remove_dir_all(&scratch) {
                    tracing::warn!("a left-over installer image was not removed: {err}");
                }
            }
        }
        if entry.tools.iter().any(|tool| tool == ytdlp::TOOL) {
            result = result.and(gone(fs::remove_dir_all(ytdlp::scratch(&downloads))));
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
        let this = self.clone();
        let (group, units) = (job.group.clone(), job.units.clone());
        let needed = blocking(move || Ok(this.needed(&group, units))).await?;
        if !needed.is_empty() {
            let client = download::client(self.inner.https_only)?;
            install::install(&client, &needed, &job.cancel, report).await?;
        }
        let this = self.clone();
        let group = job.group.clone();
        let entry = self.inner.lock.group(&job.group);
        let resources = entry.map(|g| g.resources.clone()).unwrap_or_default();
        blocking(move || {
            // The new copies must work themselves, whatever else detection would find. A resource
            // is not run: its file, verified before unpacking, must be there.
            for layout in needed.iter().map(|unit| &unit.layout) {
                let broken = layout.programs.iter().find(|(tool, program)| {
                    let path = layout.dest.join(program);
                    if resources.contains(*tool) {
                        detect::find_file(std::slice::from_ref(&path)).is_none()
                    } else {
                        detect::probe(tool, &path).is_none()
                    }
                });
                if let Some((tool, _)) = broken {
                    return Err(Error::NotWorking(tool.clone()));
                }
            }
            for layout in needed.iter().map(|unit| &unit.layout) {
                this.remove_earlier(&group, layout);
            }
            this.refresh();
            Ok(())
        })
        .await
    }

    /// The install folders of a job with a tool missing or outdated, as detection last saw them
    /// (the page showed the same when the user chose to install).
    fn needed(&self, group: &str, units: Vec<Unit>) -> Vec<Unit> {
        let Some(entry) = self.inner.lock.group(group) else {
            return Vec::new();
        };
        let status = self.status();
        let Some(tools) = status.iter().find(|g| g.id == group).map(|g| &g.tools) else {
            return units;
        };
        units
            .into_iter()
            .filter(|unit| {
                let own = unit
                    .layout
                    .programs
                    .keys()
                    .find(|tool| entry.versions.contains_key(*tool));
                self.needs(entry, tools, own.map(String::as_str))
            })
            .collect()
    }

    /// Once a pinned install works, removes what it replaces: under the group's version, the
    /// versions an earlier Kento installed (never the folders of tools with their own); for a tool
    /// with a version of its own, its older versions (a newer copy, made by "Update yt-dlp", stays).
    /// A copy still in use by a job stays until next time.
    fn remove_earlier(&self, group: &str, layout: &Layout) {
        let Some(entry) = self.inner.lock.group(group) else {
            return;
        };
        let current = &layout.dest;
        let own = layout
            .programs
            .keys()
            .any(|tool| entry.versions.contains_key(tool));
        let Some(dir) = current.parent() else {
            return;
        };
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        let version = name_of(current);
        for path in entries.flatten().map(|entry| entry.path()) {
            if path == *current || !path.is_dir() {
                continue;
            }
            let name = name_of(&path);
            let keep = if own {
                !is_partial(&path) && compare_versions(&name, &version) != Order::Less
            } else {
                entry.versions.contains_key(&name)
            };
            if !keep && fs::remove_dir_all(&path).is_err() {
                tracing::info!("an earlier {group} install could not be removed yet");
            }
        }
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, Error> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| Error::Unpack(err.to_string()))?
}

/// Fills the engines' tool paths for a job (SPEC 4.2). The first call after start or a change may
/// run the tools with `-version`, so call it from the job's worker thread.
pub fn engine_tools(state: &AppState) -> kento_engines::Tools {
    state.toolchain.engine_tools()
}

/// Starts LibreOffice once with Kento's profile, so the first office job does not wait while the
/// profile is made (SPEC 7: its first start is slow). Runs on a thread of its own; a call while
/// one runs does nothing, and a failure is only logged.
pub fn warm_up_office(app: &AppHandle) {
    static RUNNING: AtomicBool = AtomicBool::new(false);
    /// Frees the flag however the warm-up ends.
    struct Done;
    impl Drop for Done {
        fn drop(&mut self) {
            RUNNING.store(false, Ordering::Release);
        }
    }
    if RUNNING.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    let started = std::thread::Builder::new()
        .name("office-warm-up".into())
        .spawn(move || {
            let _done = Done;
            let state = app.state::<AppState>();
            let tools = state.toolchain.engine_tools();
            match kento_engines::office::warm_up(&tools, &state.paths.office_profile()) {
                Ok(()) => tracing::info!("LibreOffice is warmed up"),
                Err(err) => tracing::warn!("warming up LibreOffice failed: {err}"),
            }
        });
    if let Err(err) = started {
        RUNNING.store(false, Ordering::Release);
        tracing::warn!("the LibreOffice warm-up did not start: {err}");
    }
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
                if group == "office" {
                    warm_up_office(&app);
                }
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

/// What "Update yt-dlp" did (`YtDlpUpdate` in src/ipc.ts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpUpdate {
    /// `updated`, or `current` when the copy in use is the newest release already.
    pub outcome: &'static str,
    pub version: String,
    pub status: Vec<ToolGroupStatus>,
}

/// Settings › Tools › Update yt-dlp: the only time Kento asks GitHub about yt-dlp.
#[tauri::command]
pub async fn tools_update_ytdlp(app: AppHandle) -> crate::error::Result<YtDlpUpdate> {
    let toolchain = app.state::<AppState>().toolchain.clone();
    let (outcome, version) = match toolchain.update_ytdlp(&ytdlp::Releases::github()).await {
        Ok(ytdlp::Outcome::Updated(version)) => {
            tracing::info!("yt-dlp is updated to {version}");
            ("updated", version)
        }
        Ok(ytdlp::Outcome::Current(version)) => ("current", version),
        Err(err) => {
            tracing::warn!("updating yt-dlp failed: {err}");
            return Err(explain(&app.state::<AppState>(), &err));
        }
    };
    let status = tauri::async_runtime::spawn_blocking(move || toolchain.status()).await?;
    Ok(YtDlpUpdate {
        outcome,
        version,
        status,
    })
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
    use crate::toolchain::detect::tests::{
        fake_deno, fake_exiftool, fake_soffice, fake_tool, fake_ytdlp, ytdlp_script, FAKE_SUFFIX,
    };
    use crate::toolchain::download::tests::{serve, serve_routes, sha256, Mode};
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
        for (group, tools) in [(&status[0], 4), (&status[1], 1), (&status[2], 3)] {
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
        // LibreOffice is the largest download: show it, so the page can say so up front. Media is
        // FFmpeg, yt-dlp and Deno.
        if manifest::current_platform() == Some("windows-x64") {
            assert_eq!(status[1].download, 375_934_976);
            assert_eq!(status[0].download, 35_430_500 + 23_575_744 + 42_917_472);
        }
        assert_eq!(chain.engine_tools(), kento_engines::Tools::default());
    }

    #[test]
    fn exiftool_is_found_and_handed_to_the_engines() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("tools");
        let (system, places) = fake_exiftool(&base.path().join("system ğ 🧪"), "13.60");
        let chain = toolchain(&root, places.clone());
        let extras = &chain.status()[2];
        assert_eq!(extras.tools[0].version.as_deref(), Some("13.60"));
        assert_eq!(chain.engine_tools().exiftool, Some(system));
        // Background removal is still missing, and only its downloads are offered.
        assert!(!extras.ready);
        assert!(extras.tools[1..].iter().all(|tool| tool.path.is_none()));
        if let Some(pinned) = Lock::embedded()
            .group("extras")
            .unwrap()
            .platform(manifest::current_platform())
        {
            let sizes: u64 = pinned.files[1..].iter().map(|file| file.size).sum();
            assert_eq!(extras.download, sizes);
        }

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
        let (system_ytdlp, _) = fake_ytdlp(&base.path().join("system"), "2026.10.26");
        let (system_deno, _) = fake_deno(&base.path().join("system"), "2.9.8");
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
            chain.set_path("ffplay", None),
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
                ytdlp: Some(system_ytdlp),
                deno: Some(system_deno),
                ..kento_engines::Tools::default()
            }
        );
        // Nothing of Media is downloaded while every tool of it works.
        assert_eq!(media.download, 0);

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
        // A computer Kento pins nothing for.
        let elsewhere = Toolchain::with(
            base.path().join("elsewhere"),
            Lock::embedded(),
            None,
            nowhere(base.path()),
            false,
        );
        assert!(matches!(
            elsewhere.begin("office"),
            Err(Error::Unavailable(_))
        ));
        // LibreOffice runs from inside its program folder, as each platform's download lays it out.
        if let Some(job) = chain.begin("office").ok().flatten() {
            assert_eq!(job.units.len(), 1);
            let layout = &job.units[0].layout;
            let program = &layout.programs["soffice"];
            let expected: PathBuf = match manifest::current_platform() {
                Some("windows-x64") => ["LibreOffice", "program", "soffice.exe"].iter().collect(),
                _ => ["LibreOffice.app", "Contents", "MacOS", "soffice"]
                    .iter()
                    .collect(),
            };
            assert_eq!(program, &expected);
            assert!(layout.dest.ends_with(Path::new("office").join("26.8.2")));
            chain.cancel("office");
        }
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
        // FFmpeg under the group's version; yt-dlp and Deno each in a folder of their own.
        let dests: Vec<&Path> = job
            .units
            .iter()
            .map(|unit| unit.layout.dest.as_path())
            .collect();
        assert_eq!(dests.len(), 3);
        assert!(dests[0].ends_with(Path::new("media").join("9.0.2")));
        assert!(dests[1].ends_with(Path::new("media").join("yt-dlp").join("2026.10.26")));
        assert!(dests[2].ends_with(Path::new("media").join("deno").join("2.9.8")));
        let tools: Vec<Vec<&String>> = job
            .units
            .iter()
            .map(|unit| unit.layout.programs.keys().collect())
            .collect();
        assert_eq!(
            tools,
            [vec!["ffmpeg", "ffprobe"], vec!["yt-dlp"], vec!["deno"]]
        );
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

    /// The pinned Media downloads in small: FFmpeg and ffprobe in one zip under the group's
    /// version, yt-dlp as a plain program and Deno in a zip, each at a version of its own.
    struct MediaFiles {
        ffmpeg: Vec<u8>,
        ytdlp: Vec<u8>,
        deno: Vec<u8>,
    }

    impl MediaFiles {
        fn new(base: &Path) -> Self {
            let built = base.join("built");
            let (ffmpeg, _) = fake_tool(&built, "ffmpeg", "9.0.2");
            let (ffprobe, _) = fake_tool(&built, "ffprobe", "9.0.2");
            let (deno, _) = fake_deno(&built, "2.9.8");
            Self {
                ffmpeg: zip_of(&[
                    (
                        format!("pack/ffmpeg{FAKE_SUFFIX}").as_str(),
                        fs::read(ffmpeg).unwrap().as_slice(),
                    ),
                    (
                        format!("pack/ffprobe{FAKE_SUFFIX}").as_str(),
                        fs::read(ffprobe).unwrap().as_slice(),
                    ),
                ]),
                ytdlp: ytdlp_script("2026.10.26").into_bytes(),
                deno: zip_of(&[(
                    format!("deno{FAKE_SUFFIX}").as_str(),
                    fs::read(deno).unwrap().as_slice(),
                )]),
            }
        }

        /// A local server with the three files, and a lockfile that pins them there.
        fn serve(&self) -> (crate::toolchain::download::tests::Routes, &'static Lock) {
            let server = serve_routes(vec![
                ("/tool.zip".into(), self.ffmpeg.clone()),
                ("/yt-dlp.exe".into(), self.ytdlp.clone()),
                ("/deno.zip".into(), self.deno.clone()),
            ]);
            let file = |name: &str, bytes: &[u8], archive: &str, entries: serde_json::Value| {
                json!({
                    "url": format!("https://example.org/{name}"), "size": bytes.len(),
                    "sha256": sha256(bytes), "archive": archive, "entries": entries
                })
            };
            let text = json!({
                "schema": 1,
                "groups": [{
                    "id": "media", "available": true, "version": "9.0.2",
                    "tools": ["ffmpeg", "ffprobe", "yt-dlp", "deno"],
                    "versions": { "yt-dlp": "2026.10.26", "deno": "2.9.8" },
                    "platforms": { "windows-x64": { "source": "test", "files": [
                        file("tool.zip", &self.ffmpeg, "zip", json!({
                            "ffmpeg": format!("pack/ffmpeg{FAKE_SUFFIX}"),
                            "ffprobe": format!("pack/ffprobe{FAKE_SUFFIX}")
                        })),
                        file("yt-dlp.exe", &self.ytdlp, "file", json!({ "yt-dlp": "yt-dlp.exe" })),
                        file("deno.zip", &self.deno, "zip", json!({ "deno": format!("deno{FAKE_SUFFIX}") }))
                    ]}}
                }]
            });
            let mut lock = Lock::parse(&text.to_string()).unwrap();
            let platform = lock.groups[0].platforms.get_mut("windows-x64").unwrap();
            for file in &mut platform.files {
                file.url = format!("{}/{}", server.base, file.file_name());
            }
            (server, Box::leak(Box::new(lock)))
        }
    }

    /// The paths asked of a test server, sorted.
    fn asked(server: &crate::toolchain::download::tests::Routes) -> Vec<String> {
        let mut asked = server.asked.lock().unwrap().clone();
        asked.sort();
        asked
    }

    #[tokio::test]
    async fn only_what_is_missing_is_downloaded_and_a_working_ffmpeg_stays() {
        let base = tempfile::tempdir().unwrap();
        let files = MediaFiles::new(base.path());
        let (server, lock) = files.serve();
        // The computer has FFmpeg already, older than the pinned one but good enough.
        let system = base.path().join("system ğ 🧪");
        let (ffmpeg, places) = fake_tool(&system, "ffmpeg", "8.0");
        fake_tool(&system, "ffprobe", "8.0");
        let root = base.path().join("tools ğ 🧪");
        let chain = Toolchain::with(root.clone(), lock, Some("windows-x64"), places, false);

        let before = &chain.status()[0];
        assert!(!before.ready && !before.outdated && !before.downloaded);
        assert_eq!(
            before.download,
            (files.ytdlp.len() + files.deno.len()) as u64
        );

        let job = chain.begin("media").unwrap().unwrap();
        let states = Mutex::new(Vec::new());
        chain
            .run(job, &|state| states.lock().unwrap().push(state))
            .await
            .unwrap();
        assert_eq!(asked(&server), ["/deno.zip", "/yt-dlp.exe"]);
        // The progress counts only what was downloaded.
        let total = before.download;
        assert!(states
            .into_inner()
            .unwrap()
            .contains(&InstallState::Downloading { done: total, total }));

        let media = &chain.status()[0];
        assert!(media.ready && media.downloaded && !media.outdated);
        assert_eq!(media.download, 0);
        assert_eq!(media.tools[0].path.as_deref(), Some(ffmpeg.as_path()));
        assert_eq!(media.tools[0].source, Some(Source::System));
        let own = |tool: &str, version: &str| {
            root.join("media")
                .join(tool)
                .join(version)
                .join(format!("{tool}{FAKE_SUFFIX}"))
        };
        for (tool, version) in [("yt-dlp", "2026.10.26"), ("deno", "2.9.8")] {
            let status = media.tools.iter().find(|t| t.id == tool).unwrap();
            assert_eq!(status.path, Some(own(tool, version)), "{tool}");
            assert_eq!(status.version.as_deref(), Some(version));
            assert_eq!(status.source, Some(Source::Kento));
        }
        assert!(!root.join("media").join("9.0.2").exists());
        let tools = chain.engine_tools();
        assert_eq!(tools.ytdlp, Some(own("yt-dlp", "2026.10.26")));
        assert_eq!(tools.deno, Some(own("deno", "2.9.8")));
        assert_eq!(tools.ffmpeg, Some(ffmpeg));

        // Nothing left to do: a second install asks the network nothing.
        server.asked.lock().unwrap().clear();
        let job = chain.begin("media").unwrap().unwrap();
        chain.run(job, &|_| {}).await.unwrap();
        assert!(asked(&server).is_empty());
    }

    #[tokio::test]
    async fn kentos_own_tools_are_replaced_one_folder_at_a_time() {
        let base = tempfile::tempdir().unwrap();
        let files = MediaFiles::new(base.path());
        let (server, lock) = files.serve();
        let root = base.path().join("tools ğ 🧪");
        let media = root.join("media");
        // An earlier Kento's FFmpeg and yt-dlp, the pinned Deno, and a yt-dlp newer than the pinned
        // one, made by "Update yt-dlp".
        fake_tool(&media.join("8.0"), "ffmpeg", "8.0");
        fake_tool(&media.join("8.0"), "ffprobe", "8.0");
        fake_ytdlp(&media.join("yt-dlp").join("2026.01.05"), "2026.01.05");
        let (deno, _) = fake_deno(&media.join("deno").join("2.9.8"), "2.9.8");
        let chain = Toolchain::with(
            root.clone(),
            lock,
            Some("windows-x64"),
            nowhere(base.path()),
            false,
        );
        let before = &chain.status()[0];
        assert!(before.ready && before.outdated && before.downloaded);
        assert_eq!(
            before.download,
            (files.ffmpeg.len() + files.ytdlp.len()) as u64
        );

        let job = chain.begin("media").unwrap().unwrap();
        chain.run(job, &|_| {}).await.unwrap();
        assert_eq!(asked(&server), ["/tool.zip", "/yt-dlp.exe"]);
        let after = &chain.status()[0];
        assert!(after.ready && !after.outdated);
        assert!(after.tools[0]
            .path
            .as_ref()
            .unwrap()
            .starts_with(media.join("9.0.2")));
        // The replaced versions are gone; the folders of the other tools are untouched.
        assert!(!media.join("8.0").exists());
        assert!(!media.join("yt-dlp").join("2026.01.05").exists());
        assert!(media.join("yt-dlp").join("2026.10.26").is_dir());
        assert!(deno.is_file());
        assert_eq!(after.tools[3].path.as_deref(), Some(deno.as_path()));

        // A copy newer than the pinned one is used first, and is not outdated.
        let (newer, _) = fake_ytdlp(&media.join("yt-dlp").join("2026.11.01"), "2026.11.01");
        let status = &chain.refresh()[0];
        assert_eq!(status.tools[2].path.as_deref(), Some(newer.as_path()));
        assert!(!status.outdated);
        assert_eq!(status.download, 0);
        // A broken one is passed over for the next.
        fs::write(&newer, b"").unwrap();
        let status = &chain.refresh()[0];
        assert_eq!(status.tools[2].version.as_deref(), Some("2026.10.26"));
    }

    /// The Extras downloads in small, served by a local server: ExifTool in a zip under the group's
    /// version, then ONNX Runtime's library in a zip and the model as a plain file, both resources
    /// at versions of their own.
    fn extras_served(base: &Path) -> (crate::toolchain::download::tests::Routes, &'static Lock) {
        let (exiftool, _) = fake_exiftool(&base.join("built"), "13.60");
        let exiftool = zip_of(&[(
            format!("pack/exiftool{FAKE_SUFFIX}").as_str(),
            fs::read(exiftool).unwrap().as_slice(),
        )]);
        let runtime = zip_of(&[
            ("onnxruntime-1.23.2/lib/onnxruntime.dll", b"runtime library"),
            (
                "onnxruntime-1.23.2/lib/onnxruntime.pdb",
                b"symbols, not wanted",
            ),
        ]);
        let model = b"model weights".to_vec();
        let server = serve_routes(vec![
            ("/exiftool.zip".into(), exiftool.clone()),
            ("/runtime.zip".into(), runtime.clone()),
            ("/BEN2_Base.onnx".into(), model.clone()),
        ]);
        let file = |name: &str, bytes: &[u8], archive: &str, entries: serde_json::Value| {
            json!({
                "url": format!("https://example.org/{name}"), "size": bytes.len(),
                "sha256": sha256(bytes), "archive": archive, "entries": entries
            })
        };
        let text = json!({
            "schema": 1,
            "groups": [{
                "id": "extras", "available": true, "version": "13.60",
                "tools": ["exiftool", "onnxruntime", "bg-model"],
                "versions": { "onnxruntime": "1.23.2", "bg-model": "1.0" },
                "resources": ["onnxruntime", "bg-model"],
                "platforms": { "windows-x64": { "source": "test", "files": [
                    file("exiftool.zip", &exiftool, "zip",
                        json!({ "exiftool": format!("pack/exiftool{FAKE_SUFFIX}") })),
                    file("runtime.zip", &runtime, "zip",
                        json!({ "onnxruntime": "onnxruntime-1.23.2/lib/onnxruntime.dll" })),
                    file("BEN2_Base.onnx", &model, "file", json!({ "bg-model": "BEN2_Base.onnx" }))
                ]}}
            }]
        });
        let mut lock = Lock::parse(&text.to_string()).unwrap();
        let platform = lock.groups[0].platforms.get_mut("windows-x64").unwrap();
        for file in &mut platform.files {
            file.url = format!("{}/{}", server.base, file.file_name());
        }
        (server, Box::leak(Box::new(lock)))
    }

    #[tokio::test]
    async fn background_removal_installs_beside_a_working_exiftool_under_its_own_names() {
        let base = tempfile::tempdir().unwrap();
        let (server, lock) = extras_served(base.path());
        // ExifTool is on the computer already, and files named like the resources lie on its
        // folder too: resources are only ever Kento's own copies.
        let system = base.path().join("system ğ 🧪");
        let (exiftool, places) = fake_exiftool(&system, "13.60");
        for name in [
            "onnxruntime.dll",
            "BEN2_Base.onnx",
            "bg-model.cmd",
            "onnxruntime.cmd",
        ] {
            fs::write(system.join(name), b"not Kento's").unwrap();
        }
        let root = base.path().join("tools ğ 🧪");
        let chain = Toolchain::with(root.clone(), lock, Some("windows-x64"), places, false);
        let before = &chain.status()[0];
        assert!(!before.ready);
        assert_eq!(before.tools[0].path.as_deref(), Some(exiftool.as_path()));
        assert!(before.tools[1..].iter().all(|tool| tool.path.is_none()));

        let job = chain.begin("extras").unwrap().unwrap();
        let dests: Vec<&Path> = job.units.iter().map(|u| u.layout.dest.as_path()).collect();
        assert!(dests[1].ends_with(Path::new("extras").join("onnxruntime").join("1.23.2")));
        assert!(dests[2].ends_with(Path::new("extras").join("bg-model").join("1.0")));
        chain.run(job, &|_| {}).await.unwrap();
        // ExifTool is not downloaded again.
        assert_eq!(asked(&server), ["/BEN2_Base.onnx", "/runtime.zip"]);

        let extras = &chain.status()[0];
        assert!(extras.ready && extras.downloaded && !extras.outdated);
        assert_eq!(extras.download, 0);
        let library = root
            .join("extras")
            .join("onnxruntime")
            .join("1.23.2")
            .join("onnxruntime.dll");
        let model = root
            .join("extras")
            .join("bg-model")
            .join("1.0")
            .join("BEN2_Base.onnx");
        for (status, path, version) in [
            (&extras.tools[1], &library, "1.23.2"),
            (&extras.tools[2], &model, "1.0"),
        ] {
            assert_eq!(status.path.as_ref(), Some(path));
            assert_eq!(status.version.as_deref(), Some(version));
            assert_eq!(status.source, Some(Source::Kento));
        }
        // Only the library comes out of its archive.
        assert_eq!(fs::read_dir(library.parent().unwrap()).unwrap().count(), 1);
        assert_eq!(fs::read(&model).unwrap(), b"model weights");
        let tools = chain.engine_tools();
        assert_eq!(tools.onnxruntime, Some(library));
        assert_eq!(tools.bg_model, Some(model.clone()));
        assert_eq!(tools.exiftool, Some(exiftool));

        // No path can be chosen for a resource.
        assert!(matches!(
            chain.set_path("bg-model", Some(system.join("BEN2_Base.onnx"))),
            Err(Error::UnknownTool(_))
        ));
        assert!(matches!(
            chain.set_path("onnxruntime", None),
            Err(Error::UnknownTool(_))
        ));
        // A model that went missing is missing again, and only it is offered.
        fs::remove_file(&model).unwrap();
        let after = &chain.refresh()[0];
        assert!(!after.ready);
        assert_eq!(after.download, b"model weights".len() as u64);
    }

    /// A lockfile with one Office download for Windows: an installer image (`msi`) or, for the
    /// tests that install, a zip shaped like it, the program inside its kept folder.
    fn office_lock(url: &str, archive: &[u8], kind: &str) -> &'static Lock {
        let program = format!("pack/LibreOffice/program/soffice{FAKE_SUFFIX}");
        let (entry, folder) = if kind == "msi" {
            (&program["pack/".len()..], "LibreOffice")
        } else {
            (program.as_str(), "pack/LibreOffice")
        };
        let text = json!({
            "schema": 1,
            "groups": [{
                "id": "office", "available": true, "version": "26.8.2", "tools": ["soffice"],
                "platforms": { "windows-x64": { "source": "test", "files": [{
                    "url": "https://example.org/LibreOffice_26.8.2_Win_x86-64.msi",
                    "size": archive.len(), "sha256": sha256(archive), "archive": kind,
                    "entries": { "soffice": entry },
                    "folders": { folder: "LibreOffice" }
                }]}}
            }]
        });
        let mut lock = Lock::parse(&text.to_string()).unwrap();
        lock.groups[0]
            .platforms
            .get_mut("windows-x64")
            .unwrap()
            .files[0]
            .url = url.to_string();
        Box::leak(Box::new(lock))
    }

    #[tokio::test]
    async fn an_office_install_keeps_the_program_folder_and_runs_soffice_inside_it() {
        let base = tempfile::tempdir().unwrap();
        let (built, _) = fake_soffice(&base.path().join("built"), "LibreOffice 26.8.2.2 0e5b4a3c");
        let archive = zip_of(&[
            (
                format!("pack/LibreOffice/program/soffice{FAKE_SUFFIX}").as_str(),
                fs::read(&built).unwrap().as_slice(),
            ),
            ("pack/LibreOffice/share/registry/main.xcd", b"<xcd/>"),
        ]);
        let server = serve(archive.clone(), Mode::Ranges);
        let lock = office_lock(&server.url, &archive, "zip");
        let root = base.path().join("tools ğ 🧪");
        let chain = Toolchain::with(
            root.clone(),
            lock,
            Some("windows-x64"),
            nowhere(base.path()),
            false,
        );
        let job = chain.begin("office").unwrap().unwrap();
        chain.run(job, &|_| {}).await.unwrap();

        let program = root
            .join("office")
            .join("26.8.2")
            .join("LibreOffice")
            .join("program")
            .join(format!("soffice{FAKE_SUFFIX}"));
        let office = &chain.status()[0];
        assert!(office.ready && office.downloaded && !office.outdated);
        assert_eq!(office.tools[0].path.as_deref(), Some(program.as_path()));
        assert_eq!(office.tools[0].version.as_deref(), Some("26.8.2"));
        assert_eq!(office.tools[0].source, Some(Source::Kento));
        assert_eq!(chain.engine_tools().soffice, Some(program.clone()));
        assert!(root
            .join("office")
            .join("26.8.2")
            .join("LibreOffice")
            .join("share")
            .join("registry")
            .join("main.xcd")
            .is_file());

        // A newer Kento finds it again from the lockfile's layout alone.
        let again = Toolchain::with(
            root.clone(),
            lock,
            Some("windows-x64"),
            nowhere(base.path()),
            false,
        );
        assert_eq!(
            again.status()[0].tools[0].path.as_deref(),
            Some(program.as_path())
        );
    }

    #[test]
    fn removing_office_deletes_only_kentos_copy() {
        let base = tempfile::tempdir().unwrap();
        let lock = office_lock(
            "https://example.org/LibreOffice_26.8.2_Win_x86-64.msi",
            b"msi",
            "msi",
        );
        let root = base.path().join("tools ğ 🧪");
        let (system, places) = fake_soffice(
            &base
                .path()
                .join("Program Files")
                .join("LibreOffice")
                .join("program"),
            "LibreOffice 25.8.2.2 0123",
        );
        // Kento's copy, a half download and the scratch folder of an install that never finished.
        let own = root
            .join("office")
            .join("26.8.2")
            .join("LibreOffice")
            .join("program");
        fake_soffice(&own, "LibreOffice 26.8.2.2 0e5b");
        let downloads = root.join("downloads");
        let scratch = downloads.join("LibreOffice_26.8.2_Win_x86-64.msi.image");
        fs::create_dir_all(scratch.join("LibreOffice").join("program")).unwrap();
        fs::write(
            downloads.join("LibreOffice_26.8.2_Win_x86-64.msi.part"),
            b"half",
        )
        .unwrap();
        // Another group's download stays.
        fs::write(downloads.join("tool.zip.part"), b"other").unwrap();

        let chain = Toolchain::with(root.clone(), lock, Some("windows-x64"), places, false);
        let before = &chain.status()[0];
        assert!(before.downloaded);
        assert_eq!(before.tools[0].path.as_deref(), Some(system.as_path()));

        let office = &chain.remove("office").unwrap()[0];
        assert!(!office.downloaded);
        assert!(!root.join("office").exists());
        assert!(!scratch.exists());
        let left: Vec<String> = fs::read_dir(&downloads)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, ["tool.zip.part"]);
        // The LibreOffice on the computer is untouched and still used.
        assert!(system.is_file());
        assert!(office.ready);
        assert_eq!(office.tools[0].source, Some(Source::System));
    }

    #[test]
    fn a_chosen_libreoffice_install_folder_is_kept_as_its_program() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("tools");
        let chain = toolchain(&root, nowhere(base.path()));
        let install = base.path().join("Uygulamalar ğ 🧪").join("LibreOffice");
        let (program, _) = fake_soffice(&install.join("program"), "LibreOffice 24.8.7.2 abc");
        let status = chain.set_path("soffice", Some(install)).unwrap();
        let office = status.iter().find(|g| g.id == "office").unwrap();
        assert!(office.ready);
        assert_eq!(office.tools[0].path.as_deref(), Some(program.as_path()));
        assert_eq!(office.tools[0].source, Some(Source::Custom));
        assert_eq!(office.tools[0].version.as_deref(), Some("24.8.7"));
        assert_eq!(chain.engine_tools().soffice, Some(program));

        // An old LibreOffice, or another program, is refused with LibreOffice's own message.
        let (old, _) = fake_soffice(&base.path().join("old"), "LibreOffice 6.4.7.2 abc");
        let refused = chain.set_path("soffice", Some(old)).unwrap_err();
        assert!(matches!(&refused, Error::NotWorking(tool) if tool == "soffice"));
        assert_eq!(refused.message_key(), "toolchain.failed.check.soffice");
    }

    /// The real thing: installs the pinned Media builds for this computer (FFmpeg and ffprobe,
    /// yt-dlp, Deno) into a temporary folder and runs each. `KENTO_TOOLCHAIN_DOWNLOADS` may name a
    /// folder that already holds the pinned files (they are still verified); otherwise they are
    /// downloaded.
    #[tokio::test]
    #[ignore = "downloads the pinned FFmpeg, yt-dlp and Deno builds; run with --ignored"]
    async fn installs_the_pinned_build_for_this_computer() {
        install_pinned("media").await;
    }

    /// The same for the Extras group: ExifTool with its Perl folder (Windows) or library (macOS),
    /// then ONNX Runtime's library and the background-removal model, which then remove the
    /// background of a drawn picture.
    #[tokio::test]
    #[ignore = "downloads the pinned ExifTool, ONNX Runtime and model (about 300 MB); run with --ignored"]
    async fn installs_the_pinned_extras_for_this_computer() {
        let (tools, _installed) = install_pinned("extras").await;
        if tools.onnxruntime.is_some() {
            remove_a_background(tools);
        }
    }

    /// Runs the installed background removal on a red disk on light gray: the disk must stay and
    /// the corners must go.
    fn remove_a_background(tools: kento_engines::Tools) {
        use kento_engines::bgremove::{self, CutoutRun};
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("daire ğ.svg");
        fs::write(
            &input,
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
            <rect width="400" height="300" fill="#ebebe8"/>
            <circle cx="200" cy="150" r="90" fill="#c81e28"/></svg>"##,
        )
        .unwrap();
        let dest = dir.path().join("daire ğ - arka plansız.png");
        let options = kento_engines::Options {
            tools,
            ..kento_engines::Options::default()
        };
        bgremove::run(&CutoutRun {
            input: &input,
            from: "svg",
            dest: &dest,
            options: &options,
            progress: &kento_engines::Progress::none(),
        })
        .unwrap();
        let result = kento_engines::image::decode(&dest, "png", &options)
            .unwrap()
            .to_rgba8();
        assert!(result.get_pixel(200, 150)[3] > 200, "the subject stays");
        for (x, y) in [(3, 3), (396, 3), (3, 296), (396, 296)] {
            assert!(
                result.get_pixel(x, y)[3] < 60,
                "the background goes at {x},{y}"
            );
        }
        eprintln!("the background of a test picture was removed");
    }

    /// The same for the Office group: LibreOffice's Windows package unpacked by `msiexec /a`, or
    /// LibreOffice.app copied out of its disk image, then run from Kento's folder.
    #[tokio::test]
    #[ignore = "downloads the pinned LibreOffice (about 300 MB); run with --ignored"]
    async fn installs_the_pinned_libreoffice_for_this_computer() {
        install_pinned("office").await;
    }

    /// Installs a group's pinned downloads for this computer and returns the tools as the engines
    /// get them, with the temporary folder they are in: the tools last as long as it is kept.
    /// `KENTO_TOOLCHAIN_ROOT` may name a folder to install into and keep (CI caches the Extras
    /// tools so); otherwise the temporary one is used.
    async fn install_pinned(group: &str) -> (kento_engines::Tools, tempfile::TempDir) {
        let base = tempfile::tempdir().unwrap();
        // ExifTool's Windows launcher finds its Perl through the system code page, so it cannot
        // start from a folder whose name has letters outside it (an emoji always is).
        let root = std::env::var_os("KENTO_TOOLCHAIN_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| base.path().join("tools"));
        let places = Places {
            search: Vec::new(),
            suffix: std::env::consts::EXE_SUFFIX,
        };
        let platform = manifest::current_platform();
        let chain = Toolchain::with(root.clone(), Lock::embedded(), platform, places, true);
        let Some(job) = chain.begin(group).ok().flatten() else {
            eprintln!("nothing pinned for this computer; skipped");
            return (kento_engines::Tools::default(), base);
        };
        if let Some(cached) = std::env::var_os("KENTO_TOOLCHAIN_DOWNLOADS") {
            for unit in &job.units {
                fs::create_dir_all(&unit.layout.downloads).unwrap();
                for file in &unit.files {
                    let name = file.file_name();
                    fs::copy(
                        Path::new(&cached).join(name),
                        unit.layout.downloads.join(name),
                    )
                    .unwrap();
                }
            }
        }
        chain
            .run(job, &|state| eprintln!("{state:?}"))
            .await
            .unwrap();
        let pinned = Lock::embedded().group(group).unwrap();
        let status = chain.status();
        let installed = status.iter().find(|g| g.id == group).unwrap();
        assert!(installed.ready, "{installed:?}");
        // Every tool of the group, each at its own pinned version.
        let ids: Vec<&str> = installed
            .tools
            .iter()
            .map(|tool| tool.id.as_str())
            .collect();
        assert_eq!(ids, pinned.tools);
        for tool in &installed.tools {
            assert_eq!(tool.source, Some(Source::Kento));
            assert_eq!(tool.version.as_deref(), pinned.version_of(&tool.id));
            eprintln!(
                "{} {} runs from {}",
                tool.id,
                tool.version.as_deref().unwrap_or_default(),
                tool.path.as_ref().unwrap().display()
            );
        }
        (chain.engine_tools(), base)
    }

    #[test]
    fn every_failure_has_a_message_key() {
        for err in [
            Error::Network("x".into()),
            Error::Checksum,
            Error::Unpack("x".into()),
            Error::Io(io::Error::other("x")),
            Error::NotWorking("ffmpeg".into()),
            Error::NotWorking("soffice".into()),
            Error::NotWorking("yt-dlp".into()),
            Error::NotWorking("deno".into()),
            Error::Release("x".into()),
            Error::AdminInstall("x".into()),
            Error::InstallerBusy,
            Error::DiskImage("x".into()),
            Error::Cancelled,
            Error::Unavailable("office".into()),
            Error::Busy("media".into()),
            Error::Remove(io::Error::other("x")),
        ] {
            assert!(err.message_key().starts_with("toolchain.failed."));
        }
        assert_eq!(
            Error::AdminInstall("x".into()).message_key(),
            "toolchain.failed.msi"
        );
        assert_eq!(
            Error::InstallerBusy.message_key(),
            "toolchain.failed.msi.busy"
        );
        assert_eq!(
            Error::DiskImage("x".into()).message_key(),
            "toolchain.failed.dmg"
        );
        assert_eq!(Error::UnknownGroup("x".into()).message_key(), "error.other");
        assert_eq!(
            Error::NotWorking("deno".into()).message_key(),
            "toolchain.failed.check.deno"
        );
        for resource in ["onnxruntime", "bg-model"] {
            assert_eq!(
                Error::NotWorking(resource.into()).message_key(),
                "toolchain.failed.unpack"
            );
        }
        for err in [
            Error::Missing("yt-dlp".into()),
            Error::Elsewhere("yt-dlp".into()),
        ] {
            assert!(err.message_key().starts_with("toolchain.ytdlp."));
        }
    }
}
