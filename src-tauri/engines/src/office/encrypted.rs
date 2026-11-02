// SPDX-License-Identifier: MIT
//! Password-protected documents, recognised before LibreOffice is started, so the job can say
//! so (LibreOffice, without anyone to ask for the password, just fails to load them).
//!
//! - An encrypted Word, Excel or PowerPoint 2007+ file is no ZIP package but a compound file
//!   (OLE) holding an `EncryptedPackage` stream; an encrypted PowerPoint 97 file holds an
//!   `EncryptedSummary` stream.
//! - An encrypted OpenDocument file names `encryption-data` in `META-INF/manifest.xml`.
//!
//! Other formats (DOC and XLS with a password, iWork) fail in LibreOffice as unreadable.
//!
//! Packages are checked for their container too: LibreOffice opens what it cannot recognise as
//! plain text, so a damaged XLSX would otherwise turn into a sheet of noise. DOC, XLS and PPT
//! stay with LibreOffice, since files saved as HTML or RTF under those names are common.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use zip::ZipArchive;

use crate::{Error, Result};

const COMPOUND_FILE: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const ZIP: [u8; 4] = *b"PK\x03\x04";
/// Directory entries are 128 bytes, in sectors of 512 or 4096 bytes after a 512-byte header, so
/// each starts at a multiple of 128.
const ENTRY: usize = 128;
const MAX_MANIFEST: u64 = 4 << 20;

pub(super) fn check(path: &Path, from: &str) -> Result<()> {
    let mut head = [0u8; 8];
    let mut file = File::open(path)?;
    let read = file.read(&mut head)?;
    let head = &head[..read];
    let container = match from {
        // An encrypted (or old, renamed) Office file is a compound file.
        "docx" | "xlsx" | "pptx" => head.starts_with(&ZIP) || head == COMPOUND_FILE,
        "odt" | "ods" | "odp" | "pages" | "numbers" | "key" => head.starts_with(&ZIP),
        _ => true,
    };
    if !container {
        return Err(Error::Unreadable(format!(
            "this is not a {} document: it does not start as one",
            from.to_uppercase()
        )));
    }
    let encrypted = if head == COMPOUND_FILE {
        matches!(from, "docx" | "xlsx" | "pptx" | "doc" | "xls" | "ppt")
            && has_stream(file, &["EncryptedPackage", "EncryptedSummary"])?
    } else if head.starts_with(&ZIP) {
        matches!(from, "odt" | "ods" | "odp") && odf_encrypted(path)
    } else {
        false
    };
    if encrypted {
        Err(Error::Encrypted)
    } else {
        Ok(())
    }
}

/// Whether the compound file has a directory entry with one of these names. `file` stands just
/// after the first 8 bytes.
fn has_stream(file: File, names: &[&str]) -> Result<bool> {
    let wanted: Vec<Vec<u8>> = names
        .iter()
        .map(|name| name.encode_utf16().flat_map(u16::to_le_bytes).collect())
        .collect();
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    // The rest of the 512-byte header.
    let mut skip = [0u8; 512 - 8];
    if reader.read_exact(&mut skip).is_err() {
        return Ok(false);
    }
    let mut entry = [0u8; ENTRY];
    while reader.read_exact(&mut entry).is_ok() {
        if wanted.iter().any(|name| names_entry(&entry, name)) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// A directory entry: the name in UTF-16LE with a terminating zero, and at byte 64 the name's
/// length in bytes, the zero included.
fn names_entry(entry: &[u8; ENTRY], name: &[u8]) -> bool {
    let length = usize::from(u16::from_le_bytes([entry[64], entry[65]]));
    length == name.len() + 2
        && entry[..name.len()] == *name
        && entry[name.len()..name.len() + 2] == [0, 0]
}

fn odf_encrypted(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let Ok(mut zip) = ZipArchive::new(BufReader::new(file)) else {
        return false;
    };
    let Ok(manifest) = zip.by_name("META-INF/manifest.xml") else {
        return false;
    };
    let mut text = Vec::new();
    if manifest.take(MAX_MANIFEST).read_to_end(&mut text).is_err() {
        return false;
    }
    String::from_utf8_lossy(&text).contains("encryption-data")
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use std::fs;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    /// A compound file with a header sector and one directory sector naming `streams`, then
    /// text that only looks like an entry name (UTF-16 text in a document's own stream).
    pub(crate) fn compound_file(streams: &[&str]) -> Vec<u8> {
        let mut bytes = vec![0u8; 512];
        bytes[..8].copy_from_slice(&COMPOUND_FILE);
        let mut sector = vec![0u8; 512];
        for (i, name) in ["Root Entry"].iter().chain(streams).take(4).enumerate() {
            let entry = &mut sector[i * ENTRY..(i + 1) * ENTRY];
            let units: Vec<u8> = name.encode_utf16().flat_map(u16::to_le_bytes).collect();
            entry[..units.len()].copy_from_slice(&units);
            entry[64..66].copy_from_slice(&((units.len() + 2) as u16).to_le_bytes());
        }
        bytes.extend(sector);
        // "EncryptedPackage" as words of a document, not at an entry's place.
        let mut text = vec![0u8; 512];
        let words: Vec<u8> = "xEncryptedPackage"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        text[3..3 + words.len()].copy_from_slice(&words);
        bytes.extend(text);
        bytes
    }

    fn odf(manifest: &str) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        zip.start_file("mimetype", options).unwrap();
        zip.write_all(b"application/vnd.oasis.opendocument.text")
            .unwrap();
        zip.start_file("META-INF/manifest.xml", options).unwrap();
        zip.write_all(manifest.as_bytes()).unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn office_encrypted_documents_are_recognised() {
        let dir = tempfile::tempdir().unwrap();
        let path = |name: &str, bytes: &[u8]| {
            let path = dir.path().join(name);
            fs::write(&path, bytes).unwrap();
            path
        };
        let locked = path(
            "Şifreli 🧪.docx",
            &compound_file(&["EncryptionInfo", "EncryptedPackage"]),
        );
        assert!(matches!(check(&locked, "docx"), Err(Error::Encrypted)));
        let slides = path("eski.ppt", &compound_file(&["EncryptedSummary"]));
        assert!(matches!(check(&slides, "ppt"), Err(Error::Encrypted)));
        // An ordinary Word 97 file, whose text merely mentions the stream's name.
        let plain = path("düz.doc", &compound_file(&["WordDocument", "1Table"]));
        check(&plain, "doc").unwrap();

        let manifest = |extra: &str| {
            format!(
                "<manifest:manifest xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\">\
                 <manifest:file-entry manifest:full-path=\"content.xml\" manifest:media-type=\"text/xml\">{extra}\
                 </manifest:file-entry></manifest:manifest>"
            )
        };
        let open = path("açık.odt", &odf(&manifest("")));
        check(&open, "odt").unwrap();
        let sealed = path(
            "kilitli.odt",
            &odf(&manifest(
                "<manifest:encryption-data manifest:checksum-type=\"SHA1/1K\"/>",
            )),
        );
        assert!(matches!(check(&sealed, "odt"), Err(Error::Encrypted)));
        // Other kinds pass through to LibreOffice.
        check(&sealed, "docx").unwrap();
    }

    #[test]
    fn office_packages_that_are_no_package_are_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        let path = |name: &str, bytes: &[u8]| {
            let path = dir.path().join(name);
            fs::write(&path, bytes).unwrap();
            path
        };
        let noise = path("gürültü 🧪.xlsx", b"\0\x01\0\x02 not a workbook");
        for from in [
            "xlsx", "docx", "pptx", "ods", "odt", "odp", "pages", "numbers", "key",
        ] {
            assert!(
                matches!(check(&noise, from), Err(Error::Unreadable(_))),
                "{from}"
            );
        }
        assert!(matches!(
            check(&path("kısa.docx", b"PK"), "docx"),
            Err(Error::Unreadable(_))
        ));
        assert!(matches!(
            check(&path("boş.xlsx", b""), "xlsx"),
            Err(Error::Unreadable(_))
        ));
        // A Word 97 file renamed .docx is still a document LibreOffice reads.
        let renamed = path("eski.docx", &compound_file(&["WordDocument", "1Table"]));
        check(&renamed, "docx").unwrap();
        // Legacy names often hold HTML or RTF, and text formats are anything.
        let html = path(
            "tablo.xls",
            b"<html><table><tr><td>1</td></tr></table></html>",
        );
        check(&html, "xls").unwrap();
        check(&noise, "doc").unwrap();
        check(&noise, "csv").unwrap();
    }
}
