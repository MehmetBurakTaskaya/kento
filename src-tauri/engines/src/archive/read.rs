// SPDX-License-Identifier: MIT
//! Walking ZIP, TAR, GZ (one gzipped file or a gzipped TAR) and 7Z archives entry by entry.

use std::borrow::Cow;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Cursor, Read};
use std::path::Path;

use flate2::read::MultiGzDecoder;
use sevenz_rust2::{ArchiveEntry, ArchiveReader, Password};
use zip::extra_fields::ExtraField;
use zip::read::ZipFile;
use zip::result::ZipError;
use zip::{System, ZipArchive};

use super::entry::{self, Entry, Kind};
use super::{
    carry, too_many_bytes, too_many_entries, uncarry, unreadable, Limits, Ticker, Tracked, Visit,
};
use crate::{Error, Progress, Result};

/// Calls `visit` for every entry of `input`, whose catalog format is `from`.
pub(super) fn for_each(
    input: &Path,
    from: &str,
    limits: &Limits,
    progress: &Progress,
    visit: &mut Visit,
) -> Result<()> {
    match from {
        "zip" => zip(input, limits, progress, visit),
        "7z" => seven(input, limits, progress, visit),
        "rar" => super::rar::for_each(input, limits, progress, visit),
        "tar" | "gz" | "tar-gz" => stream(input, progress, visit),
        _ => Err(Error::Unsupported {
            from: from.to_owned(),
            to: "folder".to_owned(),
        }),
    }
}

/// Fails early when the archive itself states more than the limits allow; the real counts are
/// still checked while reading.
pub(super) fn check_stated(entries: u64, bytes: u64, limits: &Limits) -> Result<()> {
    if entries > limits.max_entries {
        return Err(too_many_entries(limits));
    }
    if bytes > limits.max_total_bytes {
        return Err(too_many_bytes(limits));
    }
    Ok(())
}

fn zip(input: &Path, limits: &Limits, progress: &Progress, visit: &mut Visit) -> Result<()> {
    let file = File::open(input)?;
    let mut archive = ZipArchive::new(BufReader::new(file)).map_err(zip_error)?;
    // The central directory states every size, also for entries streamed with a data descriptor.
    let total = (0..archive.len()).try_fold(0u64, |sum, index| {
        let size = archive.by_index_data(index).map_err(zip_error)?.size();
        Ok::<_, Error>(sum.saturating_add(size))
    })?;
    check_stated(archive.len() as u64, total, limits)?;
    let ticker = Ticker::new(progress, total);
    for index in 0..archive.len() {
        progress.check()?;
        let mut file = archive.by_index(index).map_err(zip_error)?;
        let entry = zip_entry(&file);
        if entry.kind == Kind::File {
            visit(
                &entry,
                Some(&mut Tracked::archive(&mut file, Some(&ticker))),
            )?;
        } else {
            visit(&entry, None)?;
        }
    }
    Ok(())
}

fn zip_entry<R: Read>(file: &ZipFile<'_, R>) -> Entry {
    let name = match file.name() {
        Ok(name) => name.into_owned(),
        Err(_) => String::from_utf8_lossy(file.name_raw()).into_owned(),
    };
    let kind = if file.is_symlink() {
        Kind::Link
    } else if file.is_dir() {
        Kind::Dir
    } else {
        Kind::File
    };
    Entry {
        name,
        kind,
        size: Some(file.size()),
        mtime: zip_time(file),
        // For entries made elsewhere the crate derives a mode from MS-DOS attributes.
        mode: (file.system() == System::Unix)
            .then(|| file.unix_mode())
            .flatten()
            .map(|mode| mode & 0o7777),
    }
}

/// The UTC times other tools add (NTFS, Info-ZIP) come first; the MS-DOS time has no zone and
/// is read as UTC, which is how `write` stores it.
fn zip_time<R: Read>(file: &ZipFile<'_, R>) -> Option<i64> {
    for field in file.extra_data_fields() {
        match field {
            ExtraField::Ntfs(ntfs) => {
                if let Some(time) = entry::from_filetime(ntfs.mtime()) {
                    return Some(time);
                }
            }
            ExtraField::ExtendedTimestamp(stamp) => {
                if let Some(time) = stamp.mod_time() {
                    return Some(i64::from(time));
                }
            }
            _ => {}
        }
    }
    let dos = file.last_modified()?;
    Some(entry::from_civil(
        i64::from(dos.year()),
        u32::from(dos.month()),
        u32::from(dos.day()),
        u32::from(dos.hour()),
        u32::from(dos.minute()),
        u32::from(dos.second()),
    ))
}

fn zip_error(e: ZipError) -> Error {
    match e {
        ZipError::UnsupportedArchive(message) if message == ZipError::PASSWORD_REQUIRED => {
            Error::Encrypted
        }
        ZipError::InvalidPassword => Error::Encrypted,
        ZipError::Io(e) => unreadable(e),
        other => Error::Unreadable(other.to_string()),
    }
}

/// TAR, gzipped TAR and single gzipped files, told apart by their content.
fn stream(input: &Path, progress: &Progress, visit: &mut Visit) -> Result<()> {
    let file = File::open(input)?;
    let ticker = Ticker::new(progress, file.metadata()?.len());
    let mut raw = BufReader::new(Tracked::plain(file, Some(&ticker)));
    let gzipped = raw.fill_buf().map_err(uncarry)?.starts_with(&[0x1F, 0x8B]);
    if !gzipped {
        return tar(raw, progress, visit);
    }
    let mut gz = MultiGzDecoder::new(raw);
    let mut head = Vec::with_capacity(512);
    gz.by_ref()
        .take(512)
        .read_to_end(&mut head)
        .map_err(unreadable)?;
    if looks_like_tar(&head) {
        return tar(Cursor::new(head).chain(gz), progress, visit);
    }
    let mtime = gz
        .header()
        .map(|header| header.mtime())
        .filter(|&time| time > 0)
        .map(i64::from)
        .or_else(|| {
            fs::metadata(input)
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(entry::from_system)
        });
    let entry = Entry {
        name: gz_name(input),
        kind: Kind::File,
        size: None,
        mtime,
        mode: None,
    };
    let mut data = Tracked::archive(Cursor::new(head).chain(gz), None);
    visit(&entry, Some(&mut data))
}

/// A TAR header block: the POSIX magic, or else a valid header checksum (pre-POSIX archives).
fn looks_like_tar(block: &[u8]) -> bool {
    if block.len() < 512 {
        return false;
    }
    if &block[257..262] == b"ustar" {
        return true;
    }
    let stored = std::str::from_utf8(&block[148..156])
        .ok()
        .map(|field| field.trim_matches([' ', '\0']))
        .and_then(|field| u32::from_str_radix(field, 8).ok());
    let sum: u32 = block[..512]
        .iter()
        .enumerate()
        .map(|(i, &b)| {
            if (148..156).contains(&i) {
                u32::from(b' ')
            } else {
                u32::from(b)
            }
        })
        .sum();
    stored == Some(sum)
}

/// `notes.txt.gz` holds `notes.txt`.
fn gz_name(input: &Path) -> String {
    let name = input
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let lower = name.to_ascii_lowercase();
    let stem = [".gz", ".gzip", ".tgz"]
        .iter()
        .find(|ext| lower.ends_with(*ext))
        .map_or(name.as_str(), |ext| &name[..name.len() - ext.len()]);
    if stem.is_empty() {
        "file".to_owned()
    } else {
        stem.to_owned()
    }
}

fn tar<R: Read>(reader: R, progress: &Progress, visit: &mut Visit) -> Result<()> {
    let mut archive = tar::Archive::new(reader);
    for item in archive.entries().map_err(unreadable)? {
        progress.check()?;
        let mut item = item.map_err(unreadable)?;
        let header = item.header();
        let kind_byte = header.entry_type();
        let kind = match kind_byte {
            tar::EntryType::Regular | tar::EntryType::Continuous | tar::EntryType::GNUSparse => {
                Kind::File
            }
            tar::EntryType::Directory => Kind::Dir,
            tar::EntryType::Symlink | tar::EntryType::Link => Kind::Link,
            _ => Kind::Other,
        };
        let entry = Entry {
            name: String::from_utf8_lossy(&item.path_bytes()).into_owned(),
            kind,
            // A sparse file's stated size is what is stored, not what it unpacks to.
            size: (kind_byte != tar::EntryType::GNUSparse).then(|| item.size()),
            mtime: header
                .mtime()
                .ok()
                .and_then(|time| i64::try_from(time).ok()),
            mode: header.mode().ok().map(|mode| mode & 0o7777),
        };
        if kind == Kind::File {
            visit(&entry, Some(&mut Tracked::archive(&mut item, None)))?;
        } else {
            visit(&entry, None)?;
        }
    }
    Ok(())
}

fn seven(input: &Path, limits: &Limits, progress: &Progress, visit: &mut Visit) -> Result<()> {
    if !input.is_file() {
        // A clean "not found" rather than the crate's wrapped one.
        File::open(input)?;
    }
    let mut reader = ArchiveReader::open(input, Password::empty()).map_err(seven_error)?;
    let files = &reader.archive().files;
    let total = files
        .iter()
        .fold(0u64, |sum, file| sum.saturating_add(file.size));
    check_stated(files.len() as u64, total, limits)?;
    let ticker = Ticker::new(progress, total);
    reader
        .for_each_entries(|item, data| {
            progress.check().map_err(seven_stop)?;
            let entry = seven_entry(item);
            let result = if entry.kind == Kind::File {
                visit(&entry, Some(&mut Tracked::archive(data, Some(&ticker))))
            } else {
                visit(&entry, None)
            };
            result.map(|()| true).map_err(seven_stop)
        })
        .map_err(seven_error)
}

/// 7-Zip stores Windows attributes; `0x8000` marks Unix mode bits in the high 16 bits.
fn seven_entry(item: &ArchiveEntry) -> Entry {
    const REPARSE_POINT: u32 = 0x400;
    const UNIX_EXTENSION: u32 = 0x8000;
    const TYPE_MASK: u32 = 0o170_000;
    const SYMLINK: u32 = 0o120_000;
    let attributes = item
        .has_windows_attributes
        .then_some(item.windows_attributes);
    let unix = attributes
        .filter(|attributes| attributes & UNIX_EXTENSION != 0)
        .map(|attributes| attributes >> 16);
    let link = attributes.is_some_and(|attributes| attributes & REPARSE_POINT != 0)
        || unix.is_some_and(|mode| mode & TYPE_MASK == SYMLINK);
    let kind = if item.is_anti_item {
        Kind::Other
    } else if link {
        Kind::Link
    } else if item.is_directory {
        Kind::Dir
    } else {
        Kind::File
    };
    Entry {
        name: item.name.clone(),
        kind,
        size: Some(item.size),
        mtime: item
            .has_last_modified_date
            .then(|| entry::from_filetime(u64::from(item.last_modified_date)))
            .flatten(),
        mode: unix.map(|mode| mode & 0o7777),
    }
}

/// Stops the crate's walk with one of our errors, to be taken back by `seven_error`.
fn seven_stop(error: Error) -> sevenz_rust2::Error {
    sevenz_rust2::Error::Io(carry(error), Cow::Borrowed("stopped"))
}

fn seven_error(e: sevenz_rust2::Error) -> Error {
    use sevenz_rust2::Error as E;
    match e {
        E::PasswordRequired | E::MaybeBadPassword(_) => Error::Encrypted,
        E::Io(e, _) => unreadable(e),
        E::FileOpen(e, _) => Error::Io(e),
        other => Error::Unreadable(other.to_string()),
    }
}
