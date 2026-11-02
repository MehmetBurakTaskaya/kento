// SPDX-License-Identifier: MIT
//! Installer images (SPEC 4.2): LibreOffice comes as a Windows Installer package and a macOS disk
//! image. Each is opened by the system's own tool, with every argument passed on its own, and only
//! the folders the lockfile names are kept, whole: a program folder with its links and code
//! signature intact.
//!
//! - Windows: an administrative install (`msiexec /a`) unpacks the package into a scratch folder.
//!   It installs and registers nothing and needs no elevation.
//! - macOS: the image is attached read-only and out of sight, its folders are copied out with
//!   `ditto`, and it is always detached again, also when copying fails.

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use super::manifest::ArchiveKind;
#[cfg(windows)]
use super::manifest::IMAGE_ROOT;
use super::Error;

/// Unpacking LibreOffice takes a minute or two; a tool still busy after this is stuck.
const LIMIT: Duration = Duration::from_secs(15 * 60);

/// Opens `image` and moves or copies each kept folder (inside the image → destination) out of it.
/// `scratch` is a folder of Kento's own that this may fill and always removes.
pub fn unpack(
    image: &Path,
    kind: ArchiveKind,
    folders: &BTreeMap<String, PathBuf>,
    scratch: &Path,
) -> Result<(), Error> {
    match kind {
        ArchiveKind::Msi => unpack_msi(image, folders, scratch),
        ArchiveKind::Dmg => unpack_dmg(image, folders, scratch),
        ArchiveKind::Zip | ArchiveKind::SevenZ | ArchiveKind::TarGz => {
            Err(Error::Unpack("not an installer image".into()))
        }
    }
}

#[cfg(windows)]
fn unpack_msi(
    package: &Path,
    folders: &BTreeMap<String, PathBuf>,
    scratch: &Path,
) -> Result<(), Error> {
    if scratch.exists() {
        fs::remove_dir_all(scratch)?;
    }
    fs::create_dir_all(scratch)?;
    let result = admin_install(package, scratch).and_then(|()| {
        for (inner, dest) in folders {
            if inner == IMAGE_ROOT {
                keep_root(scratch, dest)?;
                continue;
            }
            let from = inside(scratch, inner);
            if !from.is_dir() {
                return Err(missing(scratch, inner));
            }
            fs::rename(&from, dest)?;
        }
        Ok(())
    });
    // The rest of the image (the administrative copy of the package, anything not kept) goes.
    if let Err(err) = fs::remove_dir_all(scratch) {
        tracing::warn!("the unpacked installer was not removed: {err}");
    }
    result
}

/// `msiexec /a <package> /qn /norestart TARGETDIR="<target>"`.
#[cfg(windows)]
fn admin_install(package: &Path, target: &Path) -> Result<(), Error> {
    use std::os::windows::process::CommandExt;
    // The system's own copy, never one found next to Kento or on PATH.
    let system = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let mut command = Command::new(system.join("System32").join("msiexec.exe"));
    command.arg("/a").arg(package).args(["/qn", "/norestart"]);
    // msiexec reads a property as `NAME="value"`; the usual quoting would wrap the whole argument
    // and hide the name. A Windows path cannot hold a quote, and this one never ends in a
    // backslash, so the value needs no escaping.
    let mut property = std::ffi::OsString::from("TARGETDIR=\"");
    property.push(target);
    property.push("\"");
    command.raw_arg(property);
    let (status, _) = run(&mut command).map_err(|err| Error::AdminInstall(err.to_string()))?;
    match status.code() {
        // 3010: done, a restart would be needed; an administrative install changes nothing that
        // a restart would finish.
        Some(0 | 3010) => Ok(()),
        // 1618: another installation is running.
        code => Err(Error::AdminInstall(format!("msiexec ended with {code:?}"))),
    }
}

#[cfg(not(windows))]
fn unpack_msi(_: &Path, _: &BTreeMap<String, PathBuf>, _: &Path) -> Result<(), Error> {
    Err(Error::AdminInstall(
        "a Windows Installer package unpacks only on Windows".into(),
    ))
}

#[cfg(target_os = "macos")]
fn unpack_dmg(
    image: &Path,
    folders: &BTreeMap<String, PathBuf>,
    mount: &Path,
) -> Result<(), Error> {
    if mount.exists() {
        // Left by a run that never finished, perhaps still attached.
        if fs::read_dir(mount).is_ok_and(|mut entries| entries.next().is_some()) {
            detach(mount);
        }
        let _ = fs::remove_dir(mount);
    }
    fs::create_dir_all(mount)?;
    let attached = Attached::attach(image, mount)?;
    for (inner, dest) in folders {
        let from = inside(mount, inner);
        if !from.is_dir() {
            return Err(missing(mount, inner));
        }
        // ditto keeps links, permissions and the code signature; the copy is not quarantined.
        let (status, errors) = run(Command::new("/usr/bin/ditto")
            .arg("--noqtn")
            .arg(&from)
            .arg(dest))
        .map_err(|err| Error::DiskImage(err.to_string()))?;
        if !status.success() {
            return Err(Error::DiskImage(format!("ditto: {errors}")));
        }
    }
    drop(attached);
    Ok(())
}

/// An attached disk image, detached when dropped (also when a copy fails or panics).
#[cfg(target_os = "macos")]
struct Attached<'a> {
    mount: &'a Path,
}

#[cfg(target_os = "macos")]
impl<'a> Attached<'a> {
    fn attach(image: &Path, mount: &'a Path) -> Result<Self, Error> {
        let (status, errors) = run(Command::new("/usr/bin/hdiutil")
            .args([
                "attach",
                "-nobrowse",
                "-readonly",
                "-noautoopen",
                "-mountpoint",
            ])
            .arg(mount)
            .arg(image))
        .map_err(|err| Error::DiskImage(err.to_string()))?;
        if status.success() {
            Ok(Self { mount })
        } else {
            let _ = fs::remove_dir(mount);
            Err(Error::DiskImage(format!("hdiutil attach: {errors}")))
        }
    }
}

#[cfg(target_os = "macos")]
impl Drop for Attached<'_> {
    fn drop(&mut self) {
        detach(self.mount);
        if let Err(err) = fs::remove_dir(self.mount) {
            tracing::warn!("the disk image's mount folder was not removed: {err}");
        }
    }
}

/// Detaches the image at `mount`, by force when something still holds it open.
#[cfg(target_os = "macos")]
fn detach(mount: &Path) {
    let detached = |force: bool| {
        let mut command = Command::new("/usr/bin/hdiutil");
        command.arg("detach");
        if force {
            command.arg("-force");
        }
        run(command.arg(mount)).is_ok_and(|(status, _)| status.success())
    };
    if !detached(false) && !detached(true) {
        tracing::warn!("the LibreOffice disk image could not be detached");
    }
}

#[cfg(not(target_os = "macos"))]
fn unpack_dmg(_: &Path, _: &BTreeMap<String, PathBuf>, _: &Path) -> Result<(), Error> {
    Err(Error::DiskImage("a disk image opens only on macOS".into()))
}

/// Moves everything at the top of an unpacked image into `dest`, except the administrative copy
/// of the package that `msiexec /a` leaves there.
#[cfg_attr(not(windows), allow(dead_code))]
fn keep_root(root: &Path, dest: &Path) -> Result<(), Error> {
    fs::create_dir_all(dest)?;
    let mut kept = 0;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let package = entry.file_type()?.is_file()
            && path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("msi"));
        if !package {
            fs::rename(&path, dest.join(entry.file_name()))?;
            kept += 1;
        }
    }
    if kept == 0 {
        return Err(Error::MissingEntry("anything besides the package".into()));
    }
    Ok(())
}

/// The path of `inner` (with `/` between parts, checked by the lockfile) under `root`.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn inside(root: &Path, inner: &str) -> PathBuf {
    inner
        .split('/')
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

/// A kept folder the image lacks. The error names what the image holds at its top, so a release
/// that changed its layout can be pinned again from the log alone.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn missing(root: &Path, inner: &str) -> Error {
    let mut names: Vec<String> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort_unstable();
    Error::MissingEntry(format!("{inner} (the image holds {})", names.join(", ")))
}

/// Runs a system tool to its end with nothing on standard input and returns how it ended and the
/// start of what it wrote to standard error; a tool still running after `LIMIT` is ended.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn run(command: &mut Command) -> io::Result<(ExitStatus, String)> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stderr = child.stderr.take();
    // Read on another thread so a full pipe never stalls the tool while we wait for it.
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = stderr.take(64 * 1024).read_to_end(&mut bytes);
        }
        bytes
    });
    let deadline = Instant::now() + LIMIT;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "the tool did not finish in time",
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let bytes = reader.join().unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes);
    let first: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(3)
        .collect();
    Ok((status, first.join(" ")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_installer_images_are_taken_here() {
        let dir = tempfile::tempdir().unwrap();
        let result = unpack(
            &dir.path().join("a.zip"),
            ArchiveKind::Zip,
            &BTreeMap::new(),
            &dir.path().join("scratch"),
        );
        assert!(matches!(result, Err(Error::Unpack(_))), "{result:?}");
        // Each image opens only on its own system.
        let other = if cfg!(windows) {
            ArchiveKind::Dmg
        } else {
            ArchiveKind::Msi
        };
        let result = unpack(
            &dir.path().join("image"),
            other,
            &BTreeMap::new(),
            &dir.path().join("scratch"),
        );
        assert!(
            matches!(result, Err(Error::AdminInstall(_) | Error::DiskImage(_))),
            "{result:?}"
        );
    }

    #[test]
    fn a_missing_folder_names_what_the_image_holds() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("image ğ 🧪");
        fs::create_dir_all(root.join("program")).unwrap();
        fs::write(root.join("setup.msi"), b"x").unwrap();
        assert_eq!(
            inside(&root, "LibreOffice/program"),
            root.join("LibreOffice").join("program")
        );
        let err = missing(&root, "LibreOffice");
        assert!(
            matches!(&err, Error::MissingEntry(text) if text == "LibreOffice (the image holds program, setup.msi)"),
            "{err:?}"
        );
    }

    #[test]
    fn a_whole_image_is_kept_without_its_package() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("image ğ 🧪");
        fs::create_dir_all(root.join("program")).unwrap();
        fs::write(root.join("program").join("soffice.exe"), b"x").unwrap();
        fs::create_dir_all(root.join("share")).unwrap();
        fs::write(root.join("LibreOffice_26.8.2_Win_x86-64.msi"), b"package").unwrap();
        fs::write(root.join("readme.txt"), b"r").unwrap();
        let dest = dir.path().join("26.8.2.partial").join("LibreOffice");
        keep_root(&root, &dest).unwrap();
        let mut names: Vec<String> = fs::read_dir(&dest)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort_unstable();
        assert_eq!(names, ["program", "readme.txt", "share"]);
        assert!(dest.join("program").join("soffice.exe").is_file());
        // Only the package is left behind, for the scratch folder to go with.
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);

        let empty = dir.path().join("empty");
        fs::create_dir_all(&empty).unwrap();
        fs::write(empty.join("setup.MSI"), b"package").unwrap();
        assert!(matches!(
            keep_root(&empty, &dir.path().join("nothing")),
            Err(Error::MissingEntry(_))
        ));
    }

    #[test]
    fn a_tool_that_fails_is_reported_with_its_errors() {
        let mut command = if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args(["/d", "/c", "echo first>&2 & echo second>&2 & exit 3"]);
            command
        } else {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "echo first >&2; echo second >&2; exit 3"]);
            command
        };
        let (status, errors) = run(&mut command).unwrap();
        assert_eq!(status.code(), Some(3));
        assert_eq!(errors, "first second");
    }
}
