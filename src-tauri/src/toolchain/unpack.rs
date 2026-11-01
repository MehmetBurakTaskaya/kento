// SPDX-License-Identifier: MIT
//! Takes the needed binaries out of a verified archive. Only the entries the lockfile names are
//! written, each under a file name Kento chooses, so the archive's own paths never decide where
//! anything lands.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use super::manifest::ArchiveKind;
use super::Error;

/// Writes each wanted entry (path inside the archive → destination file) and fails when one is
/// missing.
pub fn extract(
    archive: &Path,
    kind: ArchiveKind,
    wanted: &BTreeMap<String, PathBuf>,
) -> Result<(), Error> {
    match kind {
        ArchiveKind::Zip => extract_zip(archive, wanted),
        ArchiveKind::SevenZ => extract_7z(archive, wanted),
    }
}

fn extract_zip(archive: &Path, wanted: &BTreeMap<String, PathBuf>) -> Result<(), Error> {
    let mut zip = zip::ZipArchive::new(File::open(archive)?).map_err(unpack)?;
    for (inner, dest) in wanted {
        let mut entry = match zip.by_name(inner) {
            Ok(entry) => entry,
            Err(zip::result::ZipError::FileNotFound) => {
                return Err(Error::MissingEntry(inner.clone()))
            }
            Err(err) => return Err(unpack(err)),
        };
        write_to(&mut entry, dest)?;
    }
    Ok(())
}

fn extract_7z(archive: &Path, wanted: &BTreeMap<String, PathBuf>) -> Result<(), Error> {
    let mut reader = sevenz_rust2::ArchiveReader::open(archive, sevenz_rust2::Password::empty())
        .map_err(unpack)?;
    let mut written = BTreeSet::new();
    reader
        .for_each_entries(|entry, data| {
            let name = entry.name().replace('\\', "/");
            if let Some((inner, dest)) = wanted.get_key_value(&name) {
                if !entry.is_directory() {
                    write_to(data, dest)?;
                    written.insert(inner.as_str());
                }
            }
            // Later entries of a solid block would only be decoded to be thrown away.
            Ok(written.len() < wanted.len())
        })
        .map_err(unpack)?;
    match wanted
        .keys()
        .find(|inner| !written.contains(inner.as_str()))
    {
        Some(inner) => Err(Error::MissingEntry(inner.clone())),
        None => Ok(()),
    }
}

fn write_to(data: &mut dyn Read, dest: &Path) -> io::Result<()> {
    let mut out = BufWriter::new(File::create(dest)?);
    io::copy(data, &mut out)?;
    out.flush()?;
    out.into_inner()
        .map_err(io::IntoInnerError::into_error)?
        .sync_all()
}

fn unpack(err: impl std::fmt::Display) -> Error {
    Error::Unpack(err.to_string())
}

/// Makes an unpacked binary ready to run. On Windows that removes a Mark-of-the-Web stream should
/// one exist. On macOS it sets the execute bits, removes `com.apple.quarantine` (Gatekeeper would
/// otherwise stop the first run) and, when the binary carries no valid signature, signs it ad hoc
/// with `codesign --force --sign -`: Apple silicon runs no unsigned arm64 code, and an ad-hoc
/// signature claims no identity, it only seals the verified bytes.
pub fn prepare(binary: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        let mut stream = binary.as_os_str().to_owned();
        stream.push(":Zone.Identifier");
        let _ = fs::remove_file(PathBuf::from(stream));
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::PermissionsExt;
        use std::process::{Command, Stdio};
        fs::set_permissions(binary, fs::Permissions::from_mode(0o755))?;
        let quiet = |command: &mut Command| {
            command
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
        };
        // Fails harmlessly when the attribute is not there.
        let _ = quiet(
            Command::new("/usr/bin/xattr")
                .args(["-d", "com.apple.quarantine"])
                .arg(binary),
        );
        let signed = quiet(
            Command::new("/usr/bin/codesign")
                .arg("--verify")
                .arg(binary),
        )
        .is_ok_and(|status| status.success());
        if !signed {
            let status = quiet(
                Command::new("/usr/bin/codesign")
                    .args(["--force", "--sign", "-"])
                    .arg(binary),
            )?;
            if !status.success() {
                return Err(io::Error::other("ad-hoc signing failed"));
            }
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(binary, fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A zip holding `files` (path → bytes) plus a file nobody asked for.
    pub(crate) fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in files.iter().chain([&("doc/readme.txt", &b"read me"[..])]) {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn wanted(dir: &Path, pairs: &[(&str, &str)]) -> BTreeMap<String, PathBuf> {
        pairs
            .iter()
            .map(|(inner, name)| (inner.to_string(), dir.join(name)))
            .collect()
    }

    #[test]
    fn takes_only_the_named_entries_out_of_a_zip() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("tools.zip");
        fs::write(
            &archive,
            zip_of(&[
                ("pack/bin/ffmpeg.exe", b"ffmpeg!"),
                ("pack/bin/ffprobe.exe", b"ffprobe!"),
            ]),
        )
        .unwrap();
        let out = dir.path().join("out");
        fs::create_dir(&out).unwrap();
        let wanted = wanted(
            &out,
            &[
                ("pack/bin/ffmpeg.exe", "ffmpeg.exe"),
                ("pack/bin/ffprobe.exe", "ffprobe.exe"),
            ],
        );
        extract(&archive, ArchiveKind::Zip, &wanted).unwrap();
        assert_eq!(fs::read(out.join("ffmpeg.exe")).unwrap(), b"ffmpeg!");
        assert_eq!(fs::read(out.join("ffprobe.exe")).unwrap(), b"ffprobe!");
        assert_eq!(fs::read_dir(&out).unwrap().count(), 2);

        let missing = self::wanted(&out, &[("pack/bin/ffplay.exe", "ffplay.exe")]);
        let result = extract(&archive, ArchiveKind::Zip, &missing);
        assert!(matches!(result, Err(Error::MissingEntry(_))), "{result:?}");
    }

    #[test]
    fn takes_only_the_named_entries_out_of_a_7z() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        fs::create_dir_all(source.join("pack").join("bin")).unwrap();
        fs::write(
            source.join("pack").join("bin").join("ffmpeg.exe"),
            b"ffmpeg!",
        )
        .unwrap();
        fs::write(
            source.join("pack").join("bin").join("ffprobe.exe"),
            b"ffprobe!",
        )
        .unwrap();
        fs::write(source.join("pack").join("readme.txt"), b"read me").unwrap();
        let archive = dir.path().join("tools.7z");
        sevenz_rust2::compress_to_path(&source, &archive).unwrap();

        let out = dir.path().join("out");
        fs::create_dir(&out).unwrap();
        let wanted = wanted(
            &out,
            &[
                ("pack/bin/ffmpeg.exe", "ffmpeg.exe"),
                ("pack/bin/ffprobe.exe", "ffprobe.exe"),
            ],
        );
        extract(&archive, ArchiveKind::SevenZ, &wanted).unwrap();
        assert_eq!(fs::read(out.join("ffmpeg.exe")).unwrap(), b"ffmpeg!");
        assert_eq!(fs::read(out.join("ffprobe.exe")).unwrap(), b"ffprobe!");
        assert_eq!(fs::read_dir(&out).unwrap().count(), 2);

        let missing = self::wanted(&out, &[("pack/bin/ffplay.exe", "ffplay.exe")]);
        let result = extract(&archive, ArchiveKind::SevenZ, &missing);
        assert!(matches!(result, Err(Error::MissingEntry(_))), "{result:?}");
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn prepare_keeps_the_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("tool");
        fs::write(&binary, b"bytes").unwrap();
        prepare(&binary).unwrap();
        assert_eq!(fs::read(&binary).unwrap(), b"bytes");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn prepare_signs_an_unsigned_binary_so_it_runs() {
        use std::process::Command;
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("tool");
        fs::copy("/usr/bin/true", &binary).unwrap();
        let stripped = Command::new("/usr/bin/codesign")
            .arg("--remove-signature")
            .arg(&binary)
            .status()
            .is_ok_and(|status| status.success());
        if !stripped {
            eprintln!("could not make an unsigned copy; skipped");
            return;
        }
        prepare(&binary).unwrap();
        let verified = Command::new("/usr/bin/codesign")
            .arg("--verify")
            .arg(&binary)
            .status()
            .unwrap();
        assert!(verified.success());
        assert!(Command::new(&binary).status().unwrap().success());
    }
}
