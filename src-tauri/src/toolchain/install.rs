// SPDX-License-Identifier: MIT
//! Installing one group: download every pinned file (resuming), verify each SHA-256, then unpack
//! only the needed binaries (and the folders a tool needs beside it or runs from) into
//! `<data>/tools/<group>/<version>/`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::download::{self, Cancel};
use super::manifest::Download;
use super::unpack::Wanted;
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
    /// Tool id → its program relative to `dest`: `ffmpeg.exe`, or
    /// `LibreOffice/program/soffice.exe` for a tool that runs inside its kept folder.
    pub programs: BTreeMap<String, PathBuf>,
}

/// The folder an installer image is unpacked or attached in while its folders are taken out:
/// beside the download, so detection never sees a half-unpacked image.
pub fn image_scratch(downloads: &Path, file: &Download) -> PathBuf {
    downloads.join(format!("{}.image", file.file_name()))
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
/// crash never leaves a half-written install that detection would pick up. A failure removes the
/// partial folder: LibreOffice alone is about a gigabyte unpacked.
fn unpack_all(archives: &[(PathBuf, Download)], layout: &Layout) -> Result<(), Error> {
    let mut stage = layout.dest.clone().into_os_string();
    stage.push(".partial");
    let stage = PathBuf::from(stage);
    if stage.exists() {
        fs::remove_dir_all(&stage)?;
    }
    fs::create_dir_all(&stage)?;
    let result = archives
        .iter()
        .try_for_each(|(archive, file)| unpack_one(archive, file, &stage, layout))
        .and_then(|()| {
            if layout.dest.exists() {
                fs::remove_dir_all(&layout.dest)?;
            }
            Ok(fs::rename(&stage, &layout.dest)?)
        });
    if result.is_err() {
        if let Err(err) = fs::remove_dir_all(&stage) {
            tracing::warn!("a half-unpacked tool folder was not removed: {err}");
        }
    }
    result
}

fn unpack_one(archive: &Path, file: &Download, stage: &Path, layout: &Layout) -> Result<(), Error> {
    let program = |tool: &String| {
        layout
            .programs
            .get(tool)
            .map(|path| stage.join(path))
            .ok_or_else(|| Error::UnknownTool(tool.clone()))
    };
    let folders: BTreeMap<String, PathBuf> = file
        .folders
        .iter()
        .map(|(inner, name)| (inner.clone(), stage.join(name)))
        .collect();
    if file.archive.is_image() {
        let scratch = image_scratch(&layout.downloads, file);
        super::image::unpack(archive, file.archive, &folders, &scratch)?;
    } else {
        let mut wanted = Wanted {
            folders: folders.clone(),
            ..Wanted::default()
        };
        // A tool inside a kept folder comes out with its folder.
        for (tool, inner) in &file.entries {
            if file.kept(inner).is_none() {
                wanted.files.insert(inner.clone(), program(tool)?);
            }
        }
        super::unpack::extract(archive, file.archive, &wanted)?;
    }
    for dest in folders.values() {
        super::unpack::prepare_folder(dest)?;
    }
    for (tool, inner) in &file.entries {
        let path = program(tool)?;
        if !path.is_file() {
            return Err(Error::MissingEntry(inner.clone()));
        }
        // An image's programs keep the signature they came with.
        if !file.archive.is_image() {
            super::unpack::prepare(&path)?;
        }
    }
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
    use crate::toolchain::unpack::tests::{tar_gz_of, zip_of};
    use std::sync::Mutex;

    fn layout(base: &Path) -> Layout {
        Layout {
            downloads: base.join("downloads"),
            dest: base.join("media").join("1.0"),
            programs: [("ffmpeg", "ffmpeg.exe"), ("ffprobe", "ffprobe.exe")]
                .into_iter()
                .map(|(tool, name)| (tool.to_string(), PathBuf::from(name)))
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
            folders: BTreeMap::new(),
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
    async fn a_tar_gz_with_a_folder_installs_the_binary_and_the_folder_beside_it() {
        let archive = tar_gz_of(
            &[
                ("Image-ExifTool-1.0/exiftool", b"#!/usr/bin/perl"),
                ("Image-ExifTool-1.0/lib/Image/ExifTool.pm", b"1;"),
                ("Image-ExifTool-1.0/html/index.html", b"docs"),
            ],
            &[],
        );
        let server = serve(archive.clone(), Mode::Ranges);
        let base = tempfile::tempdir().unwrap();
        let layout = Layout {
            downloads: base.path().join("downloads"),
            dest: base.path().join("extras ğ 🧪").join("1.0"),
            programs: [("exiftool".to_string(), PathBuf::from("exiftool"))].into(),
        };
        let file = Download {
            url: server.url.replace("tool.zip", "Image-ExifTool-1.0.tar.gz"),
            size: archive.len() as u64,
            sha256: sha256(&archive),
            archive: ArchiveKind::TarGz,
            entries: [("exiftool".into(), "Image-ExifTool-1.0/exiftool".into())].into(),
            folders: [("Image-ExifTool-1.0/lib".into(), "lib".into())].into(),
        };
        let client = download::client(false).unwrap();
        install(&client, &[file], &layout, &Cancel::default(), &|_| {})
            .await
            .unwrap();
        assert_eq!(
            fs::read(layout.dest.join("exiftool")).unwrap(),
            b"#!/usr/bin/perl"
        );
        assert_eq!(
            fs::read(layout.dest.join("lib").join("Image").join("ExifTool.pm")).unwrap(),
            b"1;"
        );
        assert_eq!(fs::read_dir(&layout.dest).unwrap().count(), 2);
        assert_eq!(fs::read_dir(&layout.downloads).unwrap().count(), 0);
    }

    /// LibreOffice's shape in an ordinary archive: the program must stay inside its folder, which
    /// is kept whole.
    fn kept_folder(url: &str, archive: &[u8]) -> Download {
        Download {
            url: url.to_string(),
            size: archive.len() as u64,
            sha256: sha256(archive),
            archive: ArchiveKind::Zip,
            entries: [("soffice".into(), "pack/Office/program/soffice.exe".into())].into(),
            folders: [("pack/Office".into(), "Office".into())].into(),
        }
    }

    fn office_layout(base: &Path) -> Layout {
        Layout {
            downloads: base.join("downloads"),
            dest: base.join("office ğ 🧪").join("1.0"),
            programs: [(
                "soffice".to_string(),
                Path::new("Office").join("program").join("soffice.exe"),
            )]
            .into(),
        }
    }

    #[tokio::test]
    async fn a_tool_inside_a_kept_folder_stays_there() {
        let archive = zip_of(&[
            ("pack/Office/program/soffice.exe", b"soffice"),
            ("pack/Office/program/soffice.com", b"console"),
            ("pack/Office/share/registry/main.xcd", b"<xcd/>"),
            ("pack/setup.exe", b"not wanted"),
        ]);
        let server = serve(archive.clone(), Mode::Ranges);
        let base = tempfile::tempdir().unwrap();
        let layout = office_layout(base.path());
        let client = download::client(false).unwrap();
        install(
            &client,
            &[kept_folder(&server.url, &archive)],
            &layout,
            &Cancel::default(),
            &|_| {},
        )
        .await
        .unwrap();
        let program = layout.dest.join("Office").join("program");
        assert_eq!(fs::read(program.join("soffice.exe")).unwrap(), b"soffice");
        assert_eq!(fs::read(program.join("soffice.com")).unwrap(), b"console");
        assert!(layout
            .dest
            .join("Office")
            .join("share")
            .join("registry")
            .join("main.xcd")
            .is_file());
        // Nothing is copied out next to the folder.
        assert_eq!(fs::read_dir(&layout.dest).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn a_failed_unpack_leaves_no_partial_folder() {
        // The kept folder is there, the program the lockfile names is not.
        let archive = zip_of(&[("pack/Office/program/other.exe", b"x")]);
        let base = tempfile::tempdir().unwrap();
        let layout = office_layout(base.path());
        fs::create_dir_all(&layout.downloads).unwrap();
        fs::write(layout.downloads.join("tool.zip"), &archive).unwrap();
        let file = kept_folder("http://127.0.0.1:9/tool.zip", &archive);
        let client = download::client(false).unwrap();
        let result = install(&client, &[file], &layout, &Cancel::default(), &|_| {}).await;
        assert!(
            matches!(&result, Err(Error::MissingEntry(inner)) if inner == "pack/Office/program/soffice.exe"),
            "{result:?}"
        );
        assert!(!layout.dest.exists());
        assert_eq!(
            fs::read_dir(layout.dest.parent().unwrap()).unwrap().count(),
            0
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
