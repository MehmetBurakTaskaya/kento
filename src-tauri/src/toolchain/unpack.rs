// SPDX-License-Identifier: MIT
//! Takes the needed binaries out of a verified archive. Only the entries the lockfile names are
//! written, each under a file name Kento chooses, so the archive's own paths never decide where
//! anything lands. A named folder is copied whole into a folder Kento names; inside it every part
//! of every path must be a plain name, and links are refused.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use super::manifest::ArchiveKind;
use super::Error;

/// What to take out of one archive.
#[derive(Debug, Default, Clone)]
pub struct Wanted {
    /// A file inside the archive → the file to write.
    pub files: BTreeMap<String, PathBuf>,
    /// A folder inside the archive → the folder to fill with everything under it.
    pub folders: BTreeMap<String, PathBuf>,
}

/// Where an archive entry goes, if anywhere.
enum Place {
    /// A named binary.
    File(PathBuf),
    /// A file inside a copied folder.
    Inside(PathBuf),
    Folder(PathBuf),
    Skip,
}

impl Wanted {
    /// Where the entry `name` (with `/` between parts) is written; an entry inside a wanted
    /// folder with an unsafe path is an error.
    fn place(&self, name: &str, directory: bool) -> Result<Place, Error> {
        let name = name.trim_end_matches('/');
        if let Some(dest) = self.files.get(name) {
            return Ok(if directory {
                Place::Skip
            } else {
                Place::File(dest.clone())
            });
        }
        for (folder, dest) in &self.folders {
            let Some(rest) = name
                .strip_prefix(folder.as_str())
                .and_then(|rest| rest.strip_prefix('/'))
            else {
                continue;
            };
            if !rest.split('/').all(safe_part) {
                return Err(Error::Unpack(format!("unsafe path {name:?}")));
            }
            let path = rest
                .split('/')
                .fold(dest.clone(), |path, part| path.join(part));
            return Ok(if directory {
                Place::Folder(path)
            } else {
                Place::Inside(path)
            });
        }
        Ok(Place::Skip)
    }
}

/// A file or folder name as it may appear inside a copied folder: letters, digits, `.`, `_`, `-`
/// and `+`, never `.` or `..` alone and never ending in a dot (Windows would drop it).
fn safe_part(part: &str) -> bool {
    !part.is_empty()
        && part != "."
        && part != ".."
        && !part.ends_with('.')
        && part
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'+'))
}

/// Writes each wanted entry and folder, and fails when one is missing.
pub fn extract(archive: &Path, kind: ArchiveKind, wanted: &Wanted) -> Result<(), Error> {
    let mut found = Found::default();
    match kind {
        ArchiveKind::Zip => extract_zip(archive, wanted, &mut found)?,
        ArchiveKind::SevenZ => extract_7z(archive, wanted, &mut found)?,
        ArchiveKind::TarGz => extract_tar_gz(archive, wanted, &mut found)?,
        // An installer image is opened by its system's own tool, in `image.rs`.
        ArchiveKind::Msi | ArchiveKind::Dmg => {
            return Err(Error::Unpack("an installer image is not an archive".into()))
        }
    }
    found.check(wanted)
}

/// The wanted files written and the wanted folders that had something in them.
#[derive(Default)]
struct Found {
    files: BTreeSet<PathBuf>,
    folders: BTreeSet<String>,
}

impl Found {
    fn note(&mut self, wanted: &Wanted, name: &str, place: &Place) {
        if let Place::File(path) = place {
            self.files.insert(path.clone());
        }
        if let Some(folder) = wanted
            .folders
            .keys()
            .find(|folder| name.starts_with(&format!("{folder}/")))
        {
            self.folders.insert(folder.clone());
        }
    }

    /// Whether every wanted file is written; a folder may still fill up with later entries.
    fn files_done(&self, wanted: &Wanted) -> bool {
        wanted.folders.is_empty() && wanted.files.values().all(|path| self.files.contains(path))
    }

    fn check(&self, wanted: &Wanted) -> Result<(), Error> {
        if let Some((inner, _)) = wanted
            .files
            .iter()
            .find(|(_, path)| !self.files.contains(*path))
        {
            return Err(Error::MissingEntry(inner.clone()));
        }
        match wanted
            .folders
            .keys()
            .find(|folder| !self.folders.contains(*folder))
        {
            Some(folder) => Err(Error::MissingEntry(folder.clone())),
            None => Ok(()),
        }
    }
}

/// Writes one entry where `place` says. Only the binaries are flushed to disk one by one: a
/// folder holds hundreds of small files, and the install becomes visible only when its folder is
/// renamed into place.
fn put(place: &Place, data: &mut dyn Read) -> io::Result<()> {
    match place {
        Place::File(path) => write_to(data, path, true),
        Place::Inside(path) => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            write_to(data, path, false)
        }
        Place::Folder(path) => fs::create_dir_all(path),
        Place::Skip => Ok(()),
    }
}

fn extract_zip(archive: &Path, wanted: &Wanted, found: &mut Found) -> Result<(), Error> {
    let mut zip = zip::ZipArchive::new(File::open(archive)?).map_err(unpack)?;
    if wanted.folders.is_empty() {
        // Only named files: look each one up instead of reading the whole directory.
        for (inner, dest) in &wanted.files {
            let mut entry = match zip.by_name(inner) {
                Ok(entry) => entry,
                Err(zip::result::ZipError::FileNotFound) => {
                    return Err(Error::MissingEntry(inner.clone()))
                }
                Err(err) => return Err(unpack(err)),
            };
            let place = Place::File(dest.clone());
            put(&place, &mut entry)?;
            found.note(wanted, inner, &place);
        }
        return Ok(());
    }
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(unpack)?;
        let name = entry.name().map_err(unpack)?.replace('\\', "/");
        let place = wanted.place(&name, entry.is_dir())?;
        if matches!(place, Place::Skip) {
            continue;
        }
        if entry.is_symlink() {
            return Err(Error::Unpack(format!("{name:?} is a link")));
        }
        put(&place, &mut entry)?;
        found.note(wanted, &name, &place);
    }
    Ok(())
}

fn extract_7z(archive: &Path, wanted: &Wanted, found: &mut Found) -> Result<(), Error> {
    let mut reader = sevenz_rust2::ArchiveReader::open(archive, sevenz_rust2::Password::empty())
        .map_err(unpack)?;
    let mut failed = None;
    reader
        .for_each_entries(|entry, data| {
            let name = entry.name().replace('\\', "/");
            match wanted.place(&name, entry.is_directory()) {
                Ok(Place::Skip) => {}
                Ok(place) => {
                    put(&place, data)?;
                    found.note(wanted, &name, &place);
                }
                Err(err) => {
                    failed = Some(err);
                    return Ok(false);
                }
            }
            // Later entries of a solid block would only be decoded to be thrown away.
            Ok(!found.files_done(wanted))
        })
        .map_err(unpack)?;
    failed.map_or(Ok(()), Err)
}

fn extract_tar_gz(archive: &Path, wanted: &Wanted, found: &mut Found) -> Result<(), Error> {
    let gzip = flate2::read::GzDecoder::new(io::BufReader::new(File::open(archive)?));
    let mut tar = tar::Archive::new(gzip);
    for entry in tar.entries().map_err(unpack)? {
        let mut entry = entry.map_err(unpack)?;
        let name = String::from_utf8_lossy(&entry.path_bytes()).replace('\\', "/");
        let kind = entry.header().entry_type();
        let place = wanted.place(&name, kind.is_dir())?;
        if matches!(place, Place::Skip) {
            continue;
        }
        if !(kind.is_file() || kind.is_dir()) {
            return Err(Error::Unpack(format!("{name:?} is a link or a device")));
        }
        put(&place, &mut entry)?;
        found.note(wanted, &name, &place);
        if found.files_done(wanted) {
            break;
        }
    }
    Ok(())
}

fn write_to(data: &mut dyn Read, dest: &Path, sync: bool) -> io::Result<()> {
    let mut out = BufWriter::new(File::create(dest)?);
    io::copy(data, &mut out)?;
    out.flush()?;
    let file = out.into_inner().map_err(io::IntoInnerError::into_error)?;
    if sync {
        file.sync_all()?;
    }
    Ok(())
}

fn unpack(err: impl std::fmt::Display) -> Error {
    Error::Unpack(err.to_string())
}

/// Makes an unpacked binary ready to run. On Windows that removes a Mark-of-the-Web stream should
/// one exist. On macOS it sets the execute bits, removes `com.apple.quarantine` (Gatekeeper would
/// otherwise stop the first run) and, when a compiled binary carries no valid signature, signs it
/// ad hoc with `codesign --force --sign -`: Apple silicon runs no unsigned arm64 code, and an
/// ad-hoc signature claims no identity, it only seals the verified bytes. A script (ExifTool is
/// Perl) runs through its interpreter and needs no signature.
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
        let signed = !is_mach_o(binary)?
            || quiet(
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

/// Whether a file is compiled macOS code (thin or universal), by its first four bytes.
#[cfg(target_os = "macos")]
fn is_mach_o(path: &Path) -> io::Result<bool> {
    let mut magic = [0u8; 4];
    let mut file = File::open(path)?;
    if file.read_exact(&mut magic).is_err() {
        return Ok(false);
    }
    Ok(matches!(
        u32::from_be_bytes(magic),
        0xfeed_face | 0xfeed_facf | 0xcefa_edfe | 0xcffa_edfe | 0xcafe_babe | 0xbeba_feca
    ))
}

/// Does for a copied folder what `prepare` does for a binary, minus the execute bits and the
/// signature: its files are read by the tool, never started on their own.
pub fn prepare_folder(dir: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        let mut pending = vec![dir.to_path_buf()];
        while let Some(folder) = pending.pop() {
            for entry in fs::read_dir(&folder)? {
                let entry = entry?;
                if entry.file_type()?.is_dir() {
                    pending.push(entry.path());
                } else {
                    let mut stream = entry.path().into_os_string();
                    stream.push(":Zone.Identifier");
                    let _ = fs::remove_file(PathBuf::from(stream));
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::{Command, Stdio};
        // Fails harmlessly when no file carries the attribute.
        let _ = Command::new("/usr/bin/xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = dir;
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

    /// A gzip-compressed tar holding `files` (path → bytes), a file nobody asked for, and links
    /// named `links` (path → target).
    pub(crate) fn tar_gz_of(files: &[(&str, &[u8])], links: &[(&str, &str)]) -> Vec<u8> {
        let gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        let mut tar = tar::Builder::new(gzip);
        for (name, bytes) in files.iter().chain([&("doc/readme.txt", &b"read me"[..])]) {
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            tar.append_data(&mut header, name, *bytes).unwrap();
        }
        for (name, target) in links {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Symlink);
            header.set_size(0);
            tar.append_link(&mut header, name, target).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap()
    }

    fn wanted(dir: &Path, pairs: &[(&str, &str)]) -> Wanted {
        Wanted {
            files: pairs
                .iter()
                .map(|(inner, name)| (inner.to_string(), dir.join(name)))
                .collect(),
            folders: BTreeMap::new(),
        }
    }

    /// Every file under `dir`, as `a/b` paths with their contents.
    fn tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut found = BTreeMap::new();
        let mut pending = vec![dir.to_path_buf()];
        while let Some(folder) = pending.pop() {
            for entry in fs::read_dir(&folder).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    pending.push(path);
                } else {
                    let name = path.strip_prefix(dir).unwrap().to_string_lossy();
                    found.insert(name.replace('\\', "/"), fs::read(&path).unwrap());
                }
            }
        }
        found
    }

    /// The layout of the ExifTool downloads: a binary to rename and a folder to copy whole.
    fn exiftool_like(out: &Path) -> Wanted {
        let mut wanted = wanted(out, &[("pack/exiftool(-k).exe", "exiftool.exe")]);
        wanted
            .folders
            .insert("pack/exiftool_files".into(), out.join("exiftool_files"));
        wanted
    }

    const EXIFTOOL_LIKE: &[(&str, &[u8])] = &[
        ("pack/exiftool(-k).exe", b"launcher"),
        ("pack/exiftool_files/perl.exe", b"perl"),
        ("pack/exiftool_files/lib/Image/ExifTool.pm", b"module"),
        ("pack/exiftool_files/libstdc++-6.dll", b"runtime"),
        ("pack/other/ignored.txt", b"no"),
    ];

    fn assert_exiftool_like(out: &Path) {
        let files = tree(out);
        let names: Vec<&str> = files.keys().map(String::as_str).collect();
        assert_eq!(
            names,
            [
                "exiftool.exe",
                "exiftool_files/lib/Image/ExifTool.pm",
                "exiftool_files/libstdc++-6.dll",
                "exiftool_files/perl.exe",
            ]
        );
        assert_eq!(files["exiftool.exe"], b"launcher");
        assert_eq!(files["exiftool_files/lib/Image/ExifTool.pm"], b"module");
    }

    #[test]
    fn copies_a_named_folder_out_of_a_zip_and_a_tar_gz() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("tools ğ 🧪.zip");
        fs::write(&zip, zip_of(EXIFTOOL_LIKE)).unwrap();
        let out = dir.path().join("zip out");
        fs::create_dir(&out).unwrap();
        extract(&zip, ArchiveKind::Zip, &exiftool_like(&out)).unwrap();
        assert_exiftool_like(&out);

        let tar = dir.path().join("tools ğ 🧪.tar.gz");
        fs::write(&tar, tar_gz_of(EXIFTOOL_LIKE, &[])).unwrap();
        let out = dir.path().join("tar out");
        fs::create_dir(&out).unwrap();
        extract(&tar, ArchiveKind::TarGz, &exiftool_like(&out)).unwrap();
        assert_exiftool_like(&out);

        // A folder the archive lacks is as missing as a file.
        let none = dir.path().join("none");
        fs::create_dir(&none).unwrap();
        let mut missing = exiftool_like(&none);
        missing
            .folders
            .insert("pack/nothing".into(), dir.path().join("x"));
        for (archive, kind) in [(&zip, ArchiveKind::Zip), (&tar, ArchiveKind::TarGz)] {
            let result = extract(archive, kind, &missing);
            assert!(
                matches!(&result, Err(Error::MissingEntry(name)) if name == "pack/nothing"),
                "{result:?}"
            );
        }
    }

    #[test]
    fn copies_a_named_folder_out_of_a_7z() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        for (name, bytes) in EXIFTOOL_LIKE {
            let path = source.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, bytes).unwrap();
        }
        let archive = dir.path().join("tools.7z");
        sevenz_rust2::compress_to_path(&source, &archive).unwrap();
        let out = dir.path().join("out");
        fs::create_dir(&out).unwrap();
        extract(&archive, ArchiveKind::SevenZ, &exiftool_like(&out)).unwrap();
        assert_exiftool_like(&out);
    }

    #[test]
    fn takes_a_single_binary_out_of_a_tar_gz() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("tools.tar.gz");
        fs::write(&archive, tar_gz_of(&[("pack/exiftool", b"#!perl")], &[])).unwrap();
        let out = dir.path().join("out");
        fs::create_dir(&out).unwrap();
        extract(
            &archive,
            ArchiveKind::TarGz,
            &wanted(&out, &[("pack/exiftool", "exiftool")]),
        )
        .unwrap();
        assert_eq!(fs::read(out.join("exiftool")).unwrap(), b"#!perl");
        let missing = wanted(&out, &[("pack/nothing", "nothing")]);
        let result = extract(&archive, ArchiveKind::TarGz, &missing);
        assert!(matches!(result, Err(Error::MissingEntry(_))), "{result:?}");
    }

    #[test]
    fn links_and_odd_names_inside_a_copied_folder_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out");
        fs::create_dir(&out).unwrap();
        let linked = dir.path().join("linked.tar.gz");
        fs::write(
            &linked,
            tar_gz_of(
                EXIFTOOL_LIKE,
                &[("pack/exiftool_files/lib/escape", "../../../../outside")],
            ),
        )
        .unwrap();
        let result = extract(&linked, ArchiveKind::TarGz, &exiftool_like(&out));
        assert!(matches!(result, Err(Error::Unpack(_))), "{result:?}");
        // A link outside the wanted folders is never looked at.
        let elsewhere = dir.path().join("elsewhere.tar.gz");
        fs::write(
            &elsewhere,
            tar_gz_of(EXIFTOOL_LIKE, &[("pack/other/link", "/etc/passwd")]),
        )
        .unwrap();
        let clean = dir.path().join("clean");
        fs::create_dir(&clean).unwrap();
        extract(&elsewhere, ArchiveKind::TarGz, &exiftool_like(&clean)).unwrap();
        assert_exiftool_like(&clean);

        for odd in [
            "pack/exiftool_files/a b.pm",
            "pack/exiftool_files/C:x",
            "pack/exiftool_files/name.",
            "pack/exiftool_files/ğ.pm",
        ] {
            let archive = dir.path().join("odd.zip");
            let mut files = EXIFTOOL_LIKE.to_vec();
            files.push((odd, b"x"));
            fs::write(&archive, zip_of(&files)).unwrap();
            let result = extract(&archive, ArchiveKind::Zip, &exiftool_like(&out));
            assert!(matches!(result, Err(Error::Unpack(_))), "{odd}: {result:?}");
        }
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
