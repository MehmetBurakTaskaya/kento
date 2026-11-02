// SPDX-License-Identifier: MIT
//! "Update yt-dlp" (SPEC 4.2). yt-dlp follows the sites it reads, which change often, so it is
//! updated on its own, apart from Kento's updates, and only when the user asks: GitHub is asked for
//! the newest release, its program and its published `SHA2-256SUMS` are downloaded, and the program
//! counts only when its SHA-256 matches. The new copy goes into a version folder of its own beside
//! the pinned one (`tools/media/yt-dlp/<version>/`) and must run before anything else changes;
//! detection then prefers the newest copy that works.

use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::download::{self, Cancel};
use super::manifest::compare_versions;
use super::{blocking, detect, is_partial, lock, name_of, unpack, Error, Source, Toolchain};

/// The tool id.
pub const TOOL: &str = "yt-dlp";
/// The project's repository on GitHub, where its releases are published.
const REPOSITORY: &str = "yt-dlp/yt-dlp";
/// The release file that lists the SHA-256 of every other one.
const SUMS: &str = "SHA2-256SUMS";
/// GitHub's answer about a release is some tens of kilobytes, the checksum list about two.
const METADATA_LIMIT: usize = 1 << 20;
const SUMS_LIMIT: usize = 64 << 10;
/// yt-dlp's programs are 20 to 40 MB; a size far beyond that is not one.
const PROGRAM_LIMIT: u64 = 512 << 20;

/// Where releases are asked for and downloaded from.
#[derive(Debug, Clone)]
pub struct Releases {
    /// GitHub's API: `https://api.github.com`.
    pub api: String,
    /// Where release files lie: `https://github.com`.
    pub downloads: String,
}

impl Releases {
    pub fn github() -> Self {
        Self {
            api: "https://api.github.com".into(),
            downloads: "https://github.com".into(),
        }
    }
}

/// What an update did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The newest release is in place and runs.
    Updated(String),
    /// The copy in use is the newest release already.
    Current(String),
}

/// The part of GitHub's answer about a release that is read.
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
}

/// The folder an update downloads into; it is removed once the update is in place.
pub fn scratch(downloads: &Path) -> PathBuf {
    downloads.join("yt-dlp-update")
}

/// The SHA-256 a checksum list gives for `name`: lines of 64 hex digits, spaces and the file name
/// (a `*` before it marks a file read in binary mode).
pub fn parse_sums(text: &str, name: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (hash, rest) = line.trim_end().split_once(' ')?;
        let file = rest.trim_start();
        let file = file.strip_prefix('*').unwrap_or(file);
        let hex = hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit());
        (hex && file == name).then(|| hash.to_ascii_lowercase())
    })
}

impl Toolchain {
    /// Updates Kento's own yt-dlp to the newest release. A yt-dlp found elsewhere on the computer
    /// is left to whoever installed it, without asking the network anything.
    pub async fn update_ytdlp(&self, releases: &Releases) -> Result<Outcome, Error> {
        let group = self
            .inner
            .lock
            .group_of(TOOL)
            .ok_or_else(|| Error::UnknownTool(TOOL.into()))?;
        // The release file to take is the one this computer's pinned download names.
        let asset = group
            .platform(self.inner.platform)
            .and_then(|platform| {
                platform
                    .files
                    .iter()
                    .find(|file| file.entries.contains_key(TOOL))
            })
            .map(|file| file.file_name().to_string())
            .ok_or_else(|| Error::Unavailable(group.id.clone()))?;
        let cancel = self
            .claim(&group.id)
            .ok_or_else(|| Error::Busy(group.id.clone()))?;
        let result = self.update(&group.id, &asset, releases, &cancel).await;
        lock(&self.inner.running).remove(&group.id);
        result
    }

    async fn update(
        &self,
        group: &str,
        asset: &str,
        releases: &Releases,
        cancel: &Cancel,
    ) -> Result<Outcome, Error> {
        let this = self.clone();
        let current = blocking(move || {
            let status = this.status();
            Ok(status
                .iter()
                .flat_map(|group| &group.tools)
                .find(|tool| tool.id == TOOL && tool.path.is_some())
                .cloned())
        })
        .await?
        .ok_or_else(|| Error::Missing(TOOL.into()))?;
        if current.source != Some(Source::Kento) {
            return Err(Error::Elsewhere(TOOL.into()));
        }
        let in_use = current.version.unwrap_or_default();

        let client = download::client(self.inner.https_only)?;
        let latest = format!("{}/repos/{REPOSITORY}/releases/latest", releases.api);
        let body = download::get(
            &client,
            &latest,
            "application/vnd.github+json",
            METADATA_LIMIT,
            cancel,
        )
        .await?;
        let release: Release =
            serde_json::from_slice(&body).map_err(|err| Error::Release(err.to_string()))?;
        let tag = release.tag_name;
        // The tag names a folder and goes into an address: it must be a yt-dlp version, nothing else.
        if detect::parse_ytdlp(&tag).is_none_or(|(label, _)| label != tag) {
            return Err(Error::Release(format!("unexpected tag {tag:?}")));
        }
        if compare_versions(&tag, &in_use) != Ordering::Greater {
            return Ok(Outcome::Current(in_use));
        }
        let size = |name: &str, limit: u64| {
            release
                .assets
                .iter()
                .find(|file| file.name == name)
                .map(|file| file.size)
                .filter(|size| (1..=limit).contains(size))
                .ok_or_else(|| Error::Release(format!("no usable {name} in {tag}")))
        };
        let program_size = size(asset, PROGRAM_LIMIT)?;
        size(SUMS, SUMS_LIMIT as u64)?;

        let base = format!(
            "{}/{REPOSITORY}/releases/download/{tag}",
            releases.downloads
        );
        let sums = download::get(
            &client,
            &format!("{base}/{SUMS}"),
            "text/plain",
            SUMS_LIMIT,
            cancel,
        )
        .await?;
        let sha256 = parse_sums(&String::from_utf8_lossy(&sums), asset)
            .ok_or_else(|| Error::Release(format!("{SUMS} lists no {asset}")))?;

        let work = scratch(&self.inner.root.join("downloads"));
        fs::create_dir_all(&work)?;
        // Named by the release, so an interrupted download resumes only into the same file.
        let part = work.join(format!("{tag}-{asset}.part"));
        download::fetch(
            &client,
            &format!("{base}/{asset}"),
            &part,
            program_size,
            cancel,
            &mut |_: u64| {},
        )
        .await?;
        let checked = part.clone();
        blocking(move || download::verify(&checked, &sha256)).await?;

        let this = self.clone();
        let group = group.to_string();
        blocking(move || this.put_in_place(&group, &part, &tag)).await
    }

    /// Puts a verified download into its version folder once it runs as that release, then lets
    /// go of the copies earlier updates made. The pinned copy stays, as a fallback.
    fn put_in_place(&self, group: &str, download: &Path, tag: &str) -> Result<Outcome, Error> {
        let entry = self
            .inner
            .lock
            .group(group)
            .ok_or_else(|| Error::UnknownGroup(group.to_string()))?;
        let dir = self.tool_dir(entry, TOOL);
        let program = self.programs(entry)[TOOL].clone();
        let stage = dir.join(format!("{tag}.partial"));
        if stage.exists() {
            fs::remove_dir_all(&stage)?;
        }
        let staged = stage.join(&program);
        fs::create_dir_all(staged.parent().unwrap_or(&stage))?;
        let copied = fs::copy(download, &staged)
            .and_then(|_| unpack::prepare(&staged))
            .map_err(Error::from);
        let runs = copied.is_ok() && detect::probe(TOOL, &staged).as_deref() == Some(tag);
        if let Err(err) = fs::remove_file(download) {
            tracing::warn!("the yt-dlp download was not removed: {err}");
        }
        if !runs {
            if let Err(err) = fs::remove_dir_all(&stage) {
                tracing::warn!("a yt-dlp that did not run was not removed: {err}");
            }
            copied?;
            return Err(Error::NotWorking(TOOL.into()));
        }
        let dest = dir.join(tag);
        if dest.exists() {
            fs::remove_dir_all(&dest)?;
        }
        fs::rename(&stage, &dest)?;

        let downloads = self.inner.root.join("downloads");
        if let Err(err) = fs::remove_dir_all(scratch(&downloads)) {
            tracing::info!("the yt-dlp update folder was not removed: {err}");
        }
        let pinned = entry.version_of(TOOL).unwrap_or_default();
        for path in fs::read_dir(&dir)?.flatten().map(|entry| entry.path()) {
            let name = name_of(&path);
            let older = is_partial(&path) || compare_versions(&name, tag) == Ordering::Less;
            if path.is_dir() && path != dest && name != pinned && older {
                // One still running in a job stays until next time.
                if fs::remove_dir_all(&path).is_err() {
                    tracing::info!("an earlier yt-dlp update could not be removed yet");
                }
            }
        }
        self.refresh();
        Ok(Outcome::Updated(tag.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::toolchain::detect::tests::{fake_tool, fake_ytdlp, ytdlp_script, FAKE_SUFFIX};
    use crate::toolchain::detect::Places;
    use crate::toolchain::download::tests::{serve_routes, sha256, Routes};
    use crate::toolchain::manifest::Lock;
    use serde_json::json;

    const PINNED: &str = "2026.10.26";
    const NEWER: &str = "2026.11.01";

    /// A Media group with FFmpeg under its version and yt-dlp pinned at a version of its own.
    fn media_lock() -> &'static Lock {
        let text = json!({
            "schema": 1,
            "groups": [{
                "id": "media", "available": true, "version": "9.0.2",
                "tools": ["ffmpeg", "yt-dlp"], "versions": { "yt-dlp": PINNED },
                "platforms": { "windows-x64": { "source": "test", "files": [
                    {
                        "url": "https://example.org/tool.zip", "size": 1,
                        "sha256": sha256(b"zip"), "archive": "zip",
                        "entries": { "ffmpeg": "bin/ffmpeg.exe" }
                    },
                    {
                        "url": format!("https://example.org/{PINNED}/yt-dlp.exe"), "size": 1,
                        "sha256": sha256(b"exe"), "archive": "file",
                        "entries": { "yt-dlp": "yt-dlp.exe" }
                    }
                ]}}
            }]
        });
        Box::leak(Box::new(Lock::parse(&text.to_string()).unwrap()))
    }

    fn nowhere(base: &Path) -> Places {
        Places {
            search: vec![base.join("empty")],
            suffix: FAKE_SUFFIX,
        }
    }

    /// The toolchain with Kento's pinned yt-dlp in place, found nowhere else.
    fn with_pinned(base: &Path) -> (Toolchain, PathBuf, PathBuf) {
        let root = base.join("tools ğ 🧪");
        let (pinned, _) = fake_ytdlp(&root.join("media").join("yt-dlp").join(PINNED), PINNED);
        let chain = Toolchain::with(
            root.clone(),
            media_lock(),
            Some("windows-x64"),
            nowhere(base),
            false,
        );
        (chain, root, pinned)
    }

    /// GitHub as far as an update sees it: the newest release's metadata, its checksum list and
    /// its Windows program.
    fn github(tag: &str, program: &[u8], sums: String) -> (Routes, Releases) {
        let release = json!({
            "tag_name": tag,
            "assets": [
                { "name": "yt-dlp.exe", "size": program.len() },
                { "name": "yt-dlp_macos", "size": 9 },
                { "name": SUMS, "size": sums.len() }
            ]
        });
        let base = format!("/{REPOSITORY}/releases/download/{tag}");
        let server = serve_routes(vec![
            (
                format!("/repos/{REPOSITORY}/releases/latest"),
                release.to_string().into_bytes(),
            ),
            (format!("{base}/{SUMS}"), sums.into_bytes()),
            (format!("{base}/yt-dlp.exe"), program.to_vec()),
        ]);
        let releases = Releases {
            api: server.base.clone(),
            downloads: server.base.clone(),
        };
        (server, releases)
    }

    fn sums_for(program: &[u8]) -> String {
        format!(
            "{}  yt-dlp\n{}  yt-dlp.exe\n{}  yt-dlp_macos\n",
            sha256(b"zipimport"),
            sha256(program),
            sha256(b"mac")
        )
    }

    fn ytdlp_in_use(chain: &Toolchain) -> (PathBuf, String) {
        let status = chain.refresh();
        let tool = status[0].tools.iter().find(|tool| tool.id == TOOL).unwrap();
        assert_eq!(tool.source, Some(Source::Kento));
        (tool.path.clone().unwrap(), tool.version.clone().unwrap())
    }

    #[test]
    fn reads_the_published_checksum_list() {
        let program = sha256(b"program");
        let text = format!(
            "{}  yt-dlp\n{}  yt-dlp.exe\r\n{} *yt-dlp_macos\n",
            sha256(b"other"),
            program.to_uppercase(),
            sha256(b"mac")
        );
        assert_eq!(parse_sums(&text, "yt-dlp.exe"), Some(program));
        assert_eq!(parse_sums(&text, "yt-dlp_macos"), Some(sha256(b"mac")));
        assert_eq!(parse_sums(&text, "yt-dlp"), Some(sha256(b"other")));
        for missing in ["yt-dlp_x86.exe", "exe", ""] {
            assert_eq!(parse_sums(&text, missing), None, "{missing:?}");
        }
        assert_eq!(parse_sums("abc  yt-dlp.exe", "yt-dlp.exe"), None);
    }

    #[tokio::test]
    async fn an_update_is_checked_put_beside_the_pinned_copy_and_used() {
        let base = tempfile::tempdir().unwrap();
        let (chain, root, pinned) = with_pinned(base.path());
        assert_eq!(ytdlp_in_use(&chain), (pinned.clone(), PINNED.to_string()));

        let program = ytdlp_script(NEWER).into_bytes();
        let (server, releases) = github(NEWER, &program, sums_for(&program));
        let outcome = chain.update_ytdlp(&releases).await.unwrap();
        assert_eq!(outcome, Outcome::Updated(NEWER.into()));

        let updated = root
            .join("media")
            .join(TOOL)
            .join(NEWER)
            .join(format!("yt-dlp{FAKE_SUFFIX}"));
        assert_eq!(ytdlp_in_use(&chain), (updated.clone(), NEWER.to_string()));
        assert_eq!(chain.engine_tools().ytdlp, Some(updated));
        // The pinned copy stays as a fallback, and a newer copy is not an outdated one.
        assert!(pinned.is_file());
        assert!(!chain.status()[0].outdated);
        assert!(!scratch(&root.join("downloads")).exists());
        assert!(!chain.is_installing("media"));

        // Asked again, it finds nothing newer and downloads nothing.
        server.asked.lock().unwrap().clear();
        let again = chain.update_ytdlp(&releases).await.unwrap();
        assert_eq!(again, Outcome::Current(NEWER.into()));
        assert_eq!(
            *server.asked.lock().unwrap(),
            [format!("/repos/{REPOSITORY}/releases/latest")]
        );
    }

    #[tokio::test]
    async fn a_download_that_fails_its_hash_or_does_not_run_changes_nothing() {
        let base = tempfile::tempdir().unwrap();
        let (chain, root, pinned) = with_pinned(base.path());
        let program = ytdlp_script(NEWER).into_bytes();
        let folder = root.join("media").join(TOOL);
        let left = || {
            let mut names: Vec<String> = fs::read_dir(&folder)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        };

        // The checksum list names another file's hash.
        let (_server, releases) = github(NEWER, &program, sums_for(b"something else"));
        let result = chain.update_ytdlp(&releases).await;
        assert!(matches!(result, Err(Error::Checksum)), "{result:?}");
        assert_eq!(left(), [PINNED]);
        assert_eq!(ytdlp_in_use(&chain), (pinned.clone(), PINNED.to_string()));
        let work = scratch(&root.join("downloads"));
        assert_eq!(fs::read_dir(&work).unwrap().count(), 0);

        // The hash matches, but the program is not that release.
        let wrong = ytdlp_script("2026.10.30").into_bytes();
        let (_server, releases) = github(NEWER, &wrong, sums_for(&wrong));
        let result = chain.update_ytdlp(&releases).await;
        assert!(
            matches!(&result, Err(Error::NotWorking(tool)) if tool == TOOL),
            "{result:?}"
        );
        assert_eq!(left(), [PINNED]);
        assert_eq!(ytdlp_in_use(&chain), (pinned, PINNED.to_string()));
        assert_eq!(
            Error::NotWorking(TOOL.into()).message_key(),
            "toolchain.failed.check.ytdlp"
        );

        // A tag that is not a yt-dlp version never becomes a folder.
        let (_server, releases) = github("../../evil", &program, sums_for(&program));
        let result = chain.update_ytdlp(&releases).await;
        assert!(matches!(result, Err(Error::Release(_))), "{result:?}");
        assert_eq!(left(), [PINNED]);
    }

    #[tokio::test]
    async fn a_ytdlp_kento_did_not_install_is_not_updated_and_nothing_goes_online() {
        let base = tempfile::tempdir().unwrap();
        // Nothing listens here: a request would fail with a network error.
        let offline = Releases {
            api: "http://127.0.0.1:9".into(),
            downloads: "http://127.0.0.1:9".into(),
        };
        let (_, places) = fake_ytdlp(&base.path().join("system ğ 🧪"), PINNED);
        let chain = Toolchain::with(
            base.path().join("tools"),
            media_lock(),
            Some("windows-x64"),
            places,
            false,
        );
        let result = chain.update_ytdlp(&offline).await;
        assert!(
            matches!(&result, Err(Error::Elsewhere(tool)) if tool == TOOL),
            "{result:?}"
        );
        assert_eq!(
            result.unwrap_err().message_key(),
            "toolchain.ytdlp.elsewhere"
        );

        let (_, places) = fake_tool(&base.path().join("ffmpeg only"), "ffmpeg", "9.0");
        let chain = Toolchain::with(
            base.path().join("tools 2"),
            media_lock(),
            Some("windows-x64"),
            places,
            false,
        );
        let result = chain.update_ytdlp(&offline).await;
        assert!(matches!(result, Err(Error::Missing(_))), "{result:?}");

        // Not while the group is being installed.
        let (chain, _, _) = with_pinned(&base.path().join("busy"));
        let job = chain.begin("media").unwrap().unwrap();
        let result = chain.update_ytdlp(&offline).await;
        assert!(matches!(result, Err(Error::Busy(_))), "{result:?}");
        chain.cancel("media");
        drop(job);
    }

    /// The pinned download points at the project's own releases, which the update asks about.
    #[test]
    fn the_pinned_ytdlp_comes_from_the_repository_the_update_asks() {
        let media = Lock::embedded().group_of(TOOL).unwrap();
        for (key, platform) in &media.platforms {
            let file = platform
                .files
                .iter()
                .find(|file| file.entries.contains_key(TOOL))
                .unwrap();
            let version = media.version_of(TOOL).unwrap();
            assert_eq!(
                file.url,
                format!(
                    "https://github.com/{REPOSITORY}/releases/download/{version}/{}",
                    file.file_name()
                ),
                "{key}"
            );
        }
    }
}
