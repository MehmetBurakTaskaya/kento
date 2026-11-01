// SPDX-License-Identifier: MIT
//! Installing one group: download every pinned file (resuming), verify each SHA-256, then unpack
//! only the needed binaries into `<data>/tools/<group>/<version>/`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::download::{self, Cancel};
use super::manifest::Download;
use super::{Error, InstallState};

/// How often download progress reaches the page.
const PROGRESS_EVERY: Duration = Duration::from_millis(150);

/// Where one install reads and writes.
#[derive(Debug, Clone)]
pub struct Layout {
    /// `<data>/tools/downloads`
    pub downloads: PathBuf,
    /// `<data>/tools/<group>/<version>`
    pub dest: PathBuf,
    /// Tool id → its file name on this platform (`ffmpeg.exe`).
    pub names: BTreeMap<String, String>,
}

pub async fn install(
    client: &reqwest::Client,
    files: &[Download],
    layout: &Layout,
    cancel: &Cancel,
    report: &(dyn Fn(InstallState) + Send + Sync),
) -> Result<(), Error> {
    fs::create_dir_all(&layout.downloads)?;
    let total: u64 = files.iter().map(|file| file.size).sum();
    let mut before = 0;
    let mut archives = Vec::new();
    for file in files {
        cancel.check()?;
        let archive = layout.downloads.join(file.file_name());
        if !verified_already(&archive, file, report).await? {
            let part = layout.downloads.join(format!("{}.part", file.file_name()));
            let mut last: Option<Instant> = None;
            let mut progress = |done: u64| {
                let due = last.is_none_or(|at| at.elapsed() >= PROGRESS_EVERY);
                if due || done == file.size {
                    last = Some(Instant::now());
                    report(InstallState::Downloading {
                        done: before + done,
                        total,
                    });
                }
            };
            download::fetch(client, &file.url, &part, file.size, cancel, &mut progress).await?;
            report(InstallState::Verifying);
            let (checked, sha256) = (part.clone(), file.sha256.clone());
            blocking(move || download::verify(&checked, &sha256)).await?;
            fs::rename(&part, &archive)?;
        }
        before += file.size;
        archives.push((archive, file.clone()));
    }
    cancel.check()?;
    report(InstallState::Unpacking);
    let layout = layout.clone();
    let unpacked = archives.clone();
    blocking(move || unpack_all(&unpacked, &layout)).await?;
    for (archive, _) in archives {
        if let Err(err) = fs::remove_file(&archive) {
            tracing::warn!("a used tool download was not removed: {err}");
        }
    }
    Ok(())
}

/// A finished download from an earlier try that stopped before unpacking. It is hashed again,
/// since it sat on disk in between; a mismatch deletes it and the download starts over.
async fn verified_already(
    archive: &Path,
    file: &Download,
    report: &(dyn Fn(InstallState) + Send + Sync),
) -> Result<bool, Error> {
    if !archive.is_file() {
        return Ok(false);
    }
    report(InstallState::Verifying);
    let (path, sha256) = (archive.to_path_buf(), file.sha256.clone());
    match blocking(move || download::verify(&path, &sha256)).await {
        Ok(()) => Ok(true),
        Err(Error::Checksum) => Ok(false),
        Err(err) => Err(err),
    }
}

/// Unpacks into a fresh `<version>.partial` folder and renames it into place at the end, so a
/// crash never leaves a half-written install that detection would pick up.
fn unpack_all(archives: &[(PathBuf, Download)], layout: &Layout) -> Result<(), Error> {
    let mut stage = layout.dest.clone().into_os_string();
    stage.push(".partial");
    let stage = PathBuf::from(stage);
    if stage.exists() {
        fs::remove_dir_all(&stage)?;
    }
    fs::create_dir_all(&stage)?;
    for (archive, file) in archives {
        let mut wanted = BTreeMap::new();
        for (tool, inner) in &file.entries {
            let name = layout
                .names
                .get(tool)
                .ok_or_else(|| Error::UnknownTool(tool.clone()))?;
            wanted.insert(inner.clone(), stage.join(name));
        }
        super::unpack::extract(archive, file.archive, &wanted)?;
        for dest in wanted.values() {
            super::unpack::prepare(dest)?;
        }
    }
    if layout.dest.exists() {
        fs::remove_dir_all(&layout.dest)?;
    }
    fs::rename(&stage, &layout.dest)?;
    Ok(())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, Error> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| Error::Unpack(err.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::toolchain::download::tests::{sample, serve, sha256, Mode};
    use crate::toolchain::manifest::ArchiveKind;
    use crate::toolchain::unpack::tests::zip_of;
    use std::sync::Mutex;

    fn layout(base: &Path) -> Layout {
        Layout {
            downloads: base.join("downloads"),
            dest: base.join("media").join("1.0"),
            names: [("ffmpeg", "ffmpeg.exe"), ("ffprobe", "ffprobe.exe")]
                .into_iter()
                .map(|(tool, name)| (tool.to_string(), name.to_string()))
                .collect(),
        }
    }

    fn pinned(url: &str, archive: &[u8], sha256: String) -> Download {
        Download {
            url: url.to_string(),
            size: archive.len() as u64,
            sha256,
            archive: ArchiveKind::Zip,
            entries: [
                ("ffmpeg", "pack/bin/ffmpeg.exe"),
                ("ffprobe", "pack/bin/ffprobe.exe"),
            ]
            .into_iter()
            .map(|(tool, inner)| (tool.to_string(), inner.to_string()))
            .collect(),
        }
    }

    fn archive() -> Vec<u8> {
        let ffmpeg = sample(200_000);
        zip_of(&[
            ("pack/bin/ffmpeg.exe", &ffmpeg),
            ("pack/bin/ffprobe.exe", b"ffprobe!"),
        ])
    }

    #[tokio::test]
    async fn downloads_verifies_and_unpacks_only_the_binaries() {
        let archive = archive();
        let server = serve(archive.clone(), Mode::Ranges);
        let base = tempfile::tempdir().unwrap();
        let layout = layout(base.path());
        let file = pinned(&server.url, &archive, sha256(&archive));
        // Half of it came down in an earlier try.
        fs::create_dir_all(&layout.downloads).unwrap();
        fs::write(
            layout.downloads.join("tool.zip.part"),
            &archive[..archive.len() / 2],
        )
        .unwrap();

        let states = Mutex::new(Vec::new());
        let client = download::client(false).unwrap();
        install(&client, &[file], &layout, &Cancel::default(), &|state| {
            states.lock().unwrap().push(state)
        })
        .await
        .unwrap();

        assert_eq!(
            *server.ranges.lock().unwrap(),
            [Some(format!("bytes={}-", archive.len() / 2))]
        );
        assert_eq!(
            fs::read(layout.dest.join("ffmpeg.exe")).unwrap(),
            sample(200_000)
        );
        assert_eq!(
            fs::read(layout.dest.join("ffprobe.exe")).unwrap(),
            b"ffprobe!"
        );
        assert_eq!(fs::read_dir(&layout.dest).unwrap().count(), 2);
        assert_eq!(fs::read_dir(&layout.downloads).unwrap().count(), 0);
        assert!(!base.path().join("media").join("1.0.partial").exists());

        let states = states.into_inner().unwrap();
        let total = archive.len() as u64;
        assert_eq!(
            states.first(),
            Some(&InstallState::Downloading {
                done: total / 2,
                total
            })
        );
        assert!(states.contains(&InstallState::Downloading { done: total, total }));
        assert_eq!(
            states[states.len() - 2..],
            [InstallState::Verifying, InstallState::Unpacking]
        );
    }

    #[tokio::test]
    async fn a_download_that_fails_its_hash_is_deleted_and_never_unpacked() {
        let archive = archive();
        let server = serve(archive.clone(), Mode::Ranges);
        let base = tempfile::tempdir().unwrap();
        let layout = layout(base.path());
        let file = pinned(&server.url, &archive, sha256(b"some other file"));
        let client = download::client(false).unwrap();
        let result = install(&client, &[file], &layout, &Cancel::default(), &|_| {}).await;
        assert!(matches!(result, Err(Error::Checksum)), "{result:?}");
        assert_eq!(fs::read_dir(&layout.downloads).unwrap().count(), 0);
        assert!(!layout.dest.exists());
        assert!(!base.path().join("media").join("1.0.partial").exists());
    }

    #[tokio::test]
    async fn a_verified_download_left_from_an_earlier_try_is_used_without_the_network() {
        let archive = archive();
        let base = tempfile::tempdir().unwrap();
        let layout = layout(base.path());
        fs::create_dir_all(&layout.downloads).unwrap();
        fs::write(layout.downloads.join("tool.zip"), &archive).unwrap();
        // Nothing listens on this port: a request would fail.
        let file = pinned("http://127.0.0.1:9/tool.zip", &archive, sha256(&archive));
        let client = download::client(false).unwrap();
        install(&client, &[file], &layout, &Cancel::default(), &|_| {})
            .await
            .unwrap();
        assert_eq!(
            fs::read(layout.dest.join("ffprobe.exe")).unwrap(),
            b"ffprobe!"
        );
    }

    #[tokio::test]
    async fn a_cancelled_install_stops_before_the_network() {
        let archive = archive();
        let base = tempfile::tempdir().unwrap();
        let layout = layout(base.path());
        let file = pinned("http://127.0.0.1:9/tool.zip", &archive, sha256(&archive));
        let cancel = Cancel::default();
        cancel.cancel();
        let client = download::client(false).unwrap();
        let result = install(&client, &[file], &layout, &cancel, &|_| {}).await;
        assert!(matches!(result, Err(Error::Cancelled)));
        assert!(!layout.dest.exists());
    }
}
