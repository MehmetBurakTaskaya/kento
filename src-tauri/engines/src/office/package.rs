// SPDX-License-Identifier: MIT
//! Apple's package documents (SPEC 5.4 notes): on macOS a PAGES, NUMBERS, KEY or RTFD document
//! can be a folder that Finder shows as one file. LibreOffice opens files only.
//!
//! - RTFD is always a folder holding `TXT.rtf` and its attachments: the RTF is read, the
//!   attachments are lost (best effort). A zipped RTFD, as one arrives from a non-Mac disk or a
//!   download, is read the same way.
//! - An iWork package folder is zipped into a single file, the form iWork itself writes when it
//!   saves one file: `Index.zip` is unpacked into `Index/`, everything else goes in as it is.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Seek, Write};
use std::path::{Path, PathBuf};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::{Error, Progress, Result};

/// A package's files together, and how many there may be.
const MAX_TOTAL: u64 = 2 << 30;
const MAX_FILES: usize = 100_000;
/// The RTF inside an RTFD.
const MAX_RTF: u64 = 256 << 20;
const RTF_NAME: &str = "TXT.rtf";

/// Writes the RTF of an RTFD package (a folder, or a ZIP archive of one) to `dest`.
pub(super) fn rtfd(input: &Path, dest: &Path) -> Result<()> {
    if input.is_dir() {
        let rtf = fs::read_dir(input)?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .find(|path| {
                path.is_file()
                    && path
                        .file_name()
                        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(RTF_NAME))
            })
            .ok_or_else(|| Error::Unreadable("the RTFD package has no TXT.rtf in it".into()))?;
        if fs::metadata(&rtf)?.len() > MAX_RTF {
            return Err(Error::Limit(format!(
                "the RTF is larger than {} MB",
                MAX_RTF >> 20
            )));
        }
        fs::copy(&rtf, dest)?;
        return Ok(());
    }
    let zipped = ZipArchive::new(BufReader::new(File::open(input)?)).map_err(|_| {
        Error::Unreadable(
            "an RTFD document is a folder holding TXT.rtf, and this one is a single file".into(),
        )
    })?;
    rtf_from_zip(zipped, dest)
}

fn rtf_from_zip<R: Read + Seek>(mut zip: ZipArchive<R>, dest: &Path) -> Result<()> {
    // `TXT.rtf` at the top or inside the package's own folder (`Note.rtfd/TXT.rtf`).
    let name = zip
        .file_names()
        .filter_map(|name| name.ok())
        .filter(|name| {
            let parts: Vec<&str> = name.split('/').collect();
            parts.len() <= 2
                && parts
                    .last()
                    .is_some_and(|last| last.eq_ignore_ascii_case(RTF_NAME))
        })
        .min_by_key(|name| name.len())
        .map(|name| name.into_owned())
        .ok_or_else(|| Error::Unreadable("the RTFD archive has no TXT.rtf in it".into()))?;
    let mut entry = zip
        .by_name(&name)
        .map_err(|error| Error::Unreadable(error.to_string()))?;
    let mut bytes = Vec::new();
    (&mut entry).take(MAX_RTF + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_RTF {
        return Err(Error::Limit(format!(
            "the RTF is larger than {} MB",
            MAX_RTF >> 20
        )));
    }
    fs::write(dest, bytes)?;
    Ok(())
}

/// Writes a PAGES, NUMBERS or KEY document to `dest` as one file: a package folder zipped, a file
/// copied.
pub(super) fn iwork(input: &Path, dest: &Path, progress: &Progress) -> Result<()> {
    if input.is_dir() {
        zip_package(input, dest, progress)
    } else {
        fs::copy(input, dest)?;
        Ok(())
    }
}

fn zip_package(folder: &Path, dest: &Path, progress: &Progress) -> Result<()> {
    let files = list(folder)?;
    let mut zip = ZipWriter::new(BufWriter::new(File::create(dest)?));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut left = MAX_TOTAL;
    let mut take = |size: u64| -> Result<()> {
        left = left.checked_sub(size).ok_or_else(|| {
            Error::Limit(format!(
                "the package holds more than {} GB",
                MAX_TOTAL >> 30
            ))
        })?;
        Ok(())
    };
    for (path, name) in files {
        progress.check()?;
        if name == "Index.zip" {
            let mut index = ZipArchive::new(BufReader::new(File::open(&path)?))
                .map_err(|error| Error::Unreadable(format!("Index.zip: {error}")))?;
            for i in 0..index.len() {
                let mut entry = index
                    .by_index(i)
                    .map_err(|error| Error::Unreadable(format!("Index.zip: {error}")))?;
                if entry.is_dir() {
                    continue;
                }
                let Some(inner) = entry.enclosed_name() else {
                    continue;
                };
                let inner = inner.to_string_lossy().replace('\\', "/");
                let inner = if inner.starts_with("Index/") {
                    inner
                } else {
                    format!("Index/{inner}")
                };
                take(entry.size())?;
                zip.start_file(inner, options).map_err(zip_error)?;
                copy_capped(&mut entry, &mut zip, MAX_TOTAL)?;
            }
            continue;
        }
        take(fs::metadata(&path)?.len())?;
        zip.start_file(name, options).map_err(zip_error)?;
        copy_capped(&mut File::open(&path)?, &mut zip, MAX_TOTAL)?;
    }
    zip.finish().map_err(zip_error)?.flush()?;
    Ok(())
}

fn copy_capped(from: &mut impl Read, to: &mut impl Write, max: u64) -> Result<()> {
    let copied = io::copy(&mut from.take(max + 1), to)?;
    if copied > max {
        return Err(Error::Limit("a file in the package is too large".into()));
    }
    Ok(())
}

fn zip_error(error: zip::result::ZipError) -> Error {
    match error {
        zip::result::ZipError::Io(error) => Error::Io(error),
        other => Error::Other(other.to_string()),
    }
}

/// The package's files with their names inside it ("Data/a.png"), sorted; links are not followed.
fn list(folder: &Path) -> Result<Vec<(PathBuf, String)>> {
    let mut files = Vec::new();
    let mut pending = vec![(folder.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = pending.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            let name = format!("{prefix}{}", entry.file_name().to_string_lossy());
            if kind.is_dir() {
                pending.push((entry.path(), format!("{name}/")));
            } else if kind.is_file() {
                files.push((entry.path(), name));
                if files.len() > MAX_FILES {
                    return Err(Error::Limit(format!(
                        "the package holds more than {MAX_FILES} files"
                    )));
                }
            }
        }
    }
    files.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn names(path: &Path) -> Vec<String> {
        let zip = ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut names: Vec<String> = zip
            .file_names()
            .map(|name| name.unwrap().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn office_package_rtfd_folders_give_their_rtf() {
        let dir = tempfile::tempdir().unwrap();
        let package = dir.path().join("Notlar ğüşıöç 🧪.rtfd");
        fs::create_dir(&package).unwrap();
        fs::write(package.join("TXT.rtf"), b"{\\rtf1 Merhaba}").unwrap();
        fs::write(package.join("resim.png"), b"\x89PNG").unwrap();
        let dest = dir.path().join("in.rtf");
        rtfd(&package, &dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"{\\rtf1 Merhaba}");

        let empty = dir.path().join("Boş.rtfd");
        fs::create_dir(&empty).unwrap();
        assert!(matches!(
            rtfd(&empty, &dir.path().join("x.rtf")),
            Err(Error::Unreadable(_))
        ));
        let single = dir.path().join("Tek.rtfd");
        fs::write(&single, b"{\\rtf1 x}").unwrap();
        assert!(matches!(
            rtfd(&single, &dir.path().join("y.rtf")),
            Err(Error::Unreadable(_))
        ));
    }

    #[test]
    fn office_package_zipped_rtfd_gives_its_rtf() {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        zip.start_file("Not.rtfd/resim.png", options).unwrap();
        zip.write_all(b"x").unwrap();
        zip.start_file("Not.rtfd/TXT.rtf", options).unwrap();
        zip.write_all(b"{\\rtf1 Zip}").unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Not.rtfd");
        fs::write(&path, &bytes).unwrap();
        let dest = dir.path().join("in.rtf");
        rtfd(&path, &dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"{\\rtf1 Zip}");
    }

    #[test]
    fn office_package_iwork_folders_become_one_file() {
        let dir = tempfile::tempdir().unwrap();
        let package = dir.path().join("Sunum ğ 🧪.key");
        fs::create_dir_all(package.join("Data")).unwrap();
        fs::create_dir_all(package.join("Metadata")).unwrap();
        fs::write(package.join("Data").join("resim-ş.png"), b"\x89PNG").unwrap();
        fs::write(package.join("Metadata").join("Properties.plist"), b"plist").unwrap();
        fs::write(package.join("preview.jpg"), b"jpg").unwrap();
        let mut index = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        index.start_file("Index/Document.iwa", options).unwrap();
        index.write_all(b"document").unwrap();
        index.start_file("Metadata.iwa", options).unwrap();
        index.write_all(b"metadata").unwrap();
        fs::write(
            package.join("Index.zip"),
            index.finish().unwrap().into_inner(),
        )
        .unwrap();

        let dest = dir.path().join("in.key");
        iwork(&package, &dest, &Progress::none()).unwrap();
        assert_eq!(
            names(&dest),
            [
                "Data/resim-ş.png",
                "Index/Document.iwa",
                "Index/Metadata.iwa",
                "Metadata/Properties.plist",
                "preview.jpg",
            ]
        );
        let mut zip = ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        let mut text = String::new();
        zip.by_name("Index/Document.iwa")
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        assert_eq!(text, "document");

        // A single-file document is copied as it is.
        let file = dir.path().join("Tek.pages");
        fs::write(&file, b"PK\x03\x04 rest").unwrap();
        let copy = dir.path().join("in.pages");
        iwork(&file, &copy, &Progress::none()).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), b"PK\x03\x04 rest");
    }
}
