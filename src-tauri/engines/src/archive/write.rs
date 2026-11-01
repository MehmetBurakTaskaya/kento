// SPDX-License-Identifier: MIT
//! Writing ZIP, TAR, TAR.GZ and 7Z archives entry by entry, and the "Archive (ZIP)" action.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Seek, Write};
use std::path::{Path, PathBuf};

use flate2::write::GzEncoder;
use flate2::Compression;
use sevenz_rust2::{ArchiveEntry, ArchiveWriter, NtTime};
use tar::{EntryType, Header};
use zip::result::ZipError;
use zip::write::{ExtendedFileOptions, FileOptions};
use zip::{CompressionMethod, DateTime, System, ZipWriter};

use super::entry::{self, Entry, Kind};
use super::{carry, flushed, safe, uncarry, Ticker, Tracked};
use crate::{Error, Progress, Result};

/// Receives the entries of the archive being written. Names are clean `/`-separated relative
/// paths, unique within the archive.
pub(super) trait Sink {
    fn dir(&mut self, name: &str, entry: &Entry) -> Result<()>;
    fn file(&mut self, name: &str, entry: &Entry, data: &mut dyn Read) -> Result<()>;
    fn finish(self: Box<Self>) -> Result<()>;
}

/// A writer for the catalog format `to`, over `dest`; `temp` holds spooled entries.
pub(super) fn create<'a>(to: &str, dest: &Path, temp: &'a Path) -> Result<Box<dyn Sink + 'a>> {
    let out = BufWriter::new(File::create(dest)?);
    Ok(match to {
        "zip" => Box::new(ZipSink::new(out)),
        "tar" => Box::new(TarSink::new(out, temp)),
        "tar-gz" => Box::new(TarSink::new(
            GzEncoder::new(out, Compression::default()),
            temp,
        )),
        "7z" => Box::new(SevenSink::new(out)?),
        _ => {
            return Err(Error::Unsupported {
                from: "archive".to_owned(),
                to: to.to_owned(),
            })
        }
    })
}

/// Packs files and folders into a new ZIP at `dest`, each stored under its own name (relative to
/// its parent folder). Symbolic links are skipped, never followed.
pub fn create_zip(inputs: &[PathBuf], dest: &Path, progress: &Progress) -> Result<()> {
    let mut items = Vec::new();
    let mut top = HashSet::new();
    for input in inputs {
        let meta = fs::symlink_metadata(input)?;
        if meta.file_type().is_symlink() {
            continue;
        }
        let base = input
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "folder".to_owned());
        // Two inputs with the same name (from different folders) must both fit.
        let mut n = 1;
        let name = loop {
            let candidate = safe::numbered(&base, n);
            if top.insert(candidate.to_lowercase()) {
                break candidate;
            }
            n += 1;
        };
        collect(input, name, &meta, &mut items)?;
    }
    let total = items.iter().fold(0u64, |sum, item| {
        sum.saturating_add(item.entry.size.unwrap_or(0))
    });
    let ticker = Ticker::new(progress, total);
    let mut sink = ZipSink::new(BufWriter::new(File::create(dest)?));
    for item in &items {
        progress.check()?;
        if item.entry.kind == Kind::Dir {
            sink.dir(&item.entry.name, &item.entry)?;
        } else {
            let mut data = Tracked::plain(File::open(&item.path)?, Some(&ticker));
            sink.file(&item.entry.name, &item.entry, &mut data)?;
        }
    }
    Box::new(sink).finish()?;
    progress.report(1.0);
    Ok(())
}

struct Item {
    path: PathBuf,
    entry: Entry,
}

fn collect(path: &Path, name: String, meta: &fs::Metadata, items: &mut Vec<Item>) -> Result<()> {
    let kind = if meta.is_dir() {
        Kind::Dir
    } else if meta.is_file() {
        Kind::File
    } else {
        return Ok(());
    };
    #[cfg(unix)]
    let mode = {
        use std::os::unix::fs::PermissionsExt;
        Some(meta.permissions().mode() & 0o7777)
    };
    #[cfg(not(unix))]
    let mode = None;
    items.push(Item {
        path: path.to_path_buf(),
        entry: Entry {
            name: name.clone(),
            kind,
            size: (kind == Kind::File).then_some(meta.len()),
            mtime: meta.modified().ok().and_then(entry::from_system),
            mode,
        },
    });
    if kind == Kind::Dir {
        let mut children = fs::read_dir(path)?.collect::<io::Result<Vec<_>>>()?;
        children.sort_by_key(|child| child.file_name());
        for child in children {
            let child_path = child.path();
            let child_meta = fs::symlink_metadata(&child_path)?;
            if child_meta.file_type().is_symlink() {
                continue;
            }
            let child_name = format!("{name}/{}", child.file_name().to_string_lossy());
            collect(&child_path, child_name, &child_meta, items)?;
        }
    }
    Ok(())
}

/// Entries this close to 4 GiB get ZIP64 sizes, leaving room for Deflate's worst-case growth.
const ZIP64_FROM: u64 = 0xFFFF_FFFF - (64 << 20);

struct ZipSink<W: Write + Seek> {
    zip: ZipWriter<W>,
}

impl<W: Write + Seek> ZipSink<W> {
    fn new(out: W) -> Self {
        Self {
            zip: ZipWriter::new(out),
        }
    }

    fn options(entry: &Entry) -> Result<FileOptions<'static, 'static, ExtendedFileOptions>> {
        let large = entry.size.is_none_or(|size| size >= ZIP64_FROM);
        let mut options = FileOptions::<ExtendedFileOptions>::default()
            .compression_method(CompressionMethod::Deflated)
            .large_file(large);
        if let Some(mode) = entry.mode {
            // Marked as made on Unix, or readers take the attributes for MS-DOS ones.
            options = options.unix_permissions(mode).system(System::Unix);
        }
        if let Some(time) = entry.mtime {
            // MS-DOS times have no zone: UTC here, plus the exact UTC time in an Info-ZIP
            // extended timestamp that most tools prefer.
            let (year, month, day, hour, min, sec) = entry::to_civil(time);
            let dos = u16::try_from(year).ok().and_then(|year| {
                DateTime::from_date_and_time(
                    year,
                    month as u8,
                    day as u8,
                    hour as u8,
                    min as u8,
                    sec as u8,
                )
                .ok()
            });
            if let Some(dos) = dos {
                options = options.last_modified_time(dos);
            }
            if let Ok(stamp) = u32::try_from(time) {
                let mut field = vec![1u8];
                field.extend_from_slice(&stamp.to_le_bytes());
                options
                    .add_extra_field(0x5455, field, false)
                    .map_err(zip_write_error)?;
            }
        }
        Ok(options)
    }
}

impl<W: Write + Seek> Sink for ZipSink<W> {
    fn dir(&mut self, name: &str, entry: &Entry) -> Result<()> {
        let options = Self::options(entry)?.large_file(false);
        self.zip
            .add_directory(name, options)
            .map_err(zip_write_error)
    }

    fn file(&mut self, name: &str, entry: &Entry, data: &mut dyn Read) -> Result<()> {
        self.zip
            .start_file(name, Self::options(entry)?)
            .map_err(zip_write_error)?;
        io::copy(data, &mut self.zip).map_err(uncarry)?;
        Ok(())
    }

    fn finish(self: Box<Self>) -> Result<()> {
        self.zip.finish().map_err(zip_write_error)?.flush()?;
        Ok(())
    }
}

fn zip_write_error(e: ZipError) -> Error {
    match e {
        ZipError::Io(e) => uncarry(e),
        other => Error::Other(other.to_string()),
    }
}

/// How each TAR stream is completed: a gzip stream needs its trailer.
trait Close: Write {
    fn close(self) -> Result<()>;
}

impl Close for BufWriter<File> {
    fn close(self) -> Result<()> {
        flushed(self)?;
        Ok(())
    }
}

impl Close for GzEncoder<BufWriter<File>> {
    fn close(self) -> Result<()> {
        flushed(self.finish()?)?;
        Ok(())
    }
}

/// GNU TAR: long names go in GNU long-name records, which every common reader understands.
struct TarSink<'a, W: Close> {
    builder: tar::Builder<W>,
    /// Where an entry of unknown size is spooled, since a TAR header states the size first.
    temp: &'a Path,
}

impl<'a, W: Close> TarSink<'a, W> {
    fn new(out: W, temp: &'a Path) -> Self {
        Self {
            builder: tar::Builder::new(out),
            temp,
        }
    }

    fn header(entry: &Entry, kind: EntryType, size: u64, default_mode: u32) -> Header {
        let mut header = Header::new_gnu();
        header.set_entry_type(kind);
        header.set_size(size);
        header.set_mode(entry.mode.unwrap_or(default_mode));
        header.set_uid(0);
        header.set_gid(0);
        header.set_mtime(entry.mtime.map_or(0, |time| time.max(0) as u64));
        header
    }

    fn append(&mut self, mut header: Header, name: &str, data: &mut dyn Read) -> Result<()> {
        let bytes = name.as_bytes();
        let field_len = header.as_old().name.len();
        if bytes.len() > field_len {
            let mut long = Header::new_gnu();
            long.as_old_mut().name[..13].copy_from_slice(b"././@LongLink");
            long.set_entry_type(EntryType::GNULongName);
            long.set_mode(0o644);
            long.set_uid(0);
            long.set_gid(0);
            long.set_mtime(0);
            long.set_size(bytes.len() as u64 + 1);
            long.set_cksum();
            self.builder
                .append(&long, bytes.chain(&[0u8][..]))
                .map_err(uncarry)?;
        }
        // The header keeps as much of the name as fits, cut on a character boundary.
        let mut cut = bytes.len().min(field_len);
        while !name.is_char_boundary(cut) {
            cut -= 1;
        }
        header.as_old_mut().name[..cut].copy_from_slice(&bytes[..cut]);
        header.set_cksum();
        self.builder.append(&header, data).map_err(uncarry)
    }
}

impl<W: Close> Sink for TarSink<'_, W> {
    fn dir(&mut self, name: &str, entry: &Entry) -> Result<()> {
        let header = Self::header(entry, EntryType::Directory, 0, 0o755);
        self.append(header, &format!("{name}/"), &mut io::empty())
    }

    fn file(&mut self, name: &str, entry: &Entry, data: &mut dyn Read) -> Result<()> {
        let Some(size) = entry.size else {
            let spool_path = self.temp.join("spooled-entry");
            let result = self.spooled(name, entry, data, &spool_path);
            let _ = fs::remove_file(&spool_path);
            return result;
        };
        let header = Self::header(entry, EntryType::Regular, size, 0o644);
        self.append(header, name, &mut Exact::new(&mut *data, size))?;
        ensure_end(data)
    }

    fn finish(self: Box<Self>) -> Result<()> {
        self.builder.into_inner()?.close()
    }
}

impl<W: Close> TarSink<'_, W> {
    fn spooled(
        &mut self,
        name: &str,
        entry: &Entry,
        data: &mut dyn Read,
        spool_path: &Path,
    ) -> Result<()> {
        let spool = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(spool_path)?;
        let mut spool = BufWriter::new(spool);
        let size = io::copy(data, &mut spool).map_err(uncarry)?;
        let mut spool = flushed(spool)?;
        spool.rewind()?;
        let header = Self::header(entry, EntryType::Regular, size, 0o644);
        let mut exact = Exact::new(io::BufReader::new(spool), size);
        self.append(header, name, &mut exact)
    }
}

/// Exactly `left` bytes: a shorter stream is a damaged archive, since the size is already
/// written in the header.
struct Exact<R> {
    inner: R,
    left: u64,
}

impl<R: Read> Exact<R> {
    fn new(inner: R, left: u64) -> Self {
        Self { inner, left }
    }
}

impl<R: Read> Read for Exact<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.left == 0 {
            return Ok(0);
        }
        let want = buf
            .len()
            .min(usize::try_from(self.left).unwrap_or(usize::MAX));
        let n = self.inner.read(&mut buf[..want])?;
        if n == 0 {
            return Err(carry(Error::Unreadable(
                "an entry is shorter than the archive states".into(),
            )));
        }
        self.left -= n as u64;
        Ok(n)
    }
}

/// Reads past the stated end, which also lets the source verify its checksum.
fn ensure_end(data: &mut dyn Read) -> Result<()> {
    let mut probe = [0u8; 1];
    loop {
        match data.read(&mut probe) {
            Ok(0) => return Ok(()),
            Ok(_) => {
                return Err(Error::Unreadable(
                    "an entry is longer than the archive states".into(),
                ))
            }
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(uncarry(e)),
        }
    }
}

/// Non-solid 7Z with the crate's default LZMA2, one entry streamed at a time.
struct SevenSink<W: Write + Seek> {
    writer: ArchiveWriter<W>,
}

impl<W: Write + Seek> SevenSink<W> {
    fn new(out: W) -> Result<Self> {
        Ok(Self {
            writer: ArchiveWriter::new(out).map_err(seven_write_error)?,
        })
    }

    fn entry(name: &str, entry: &Entry, dir: bool) -> ArchiveEntry {
        const DIRECTORY: u32 = 0x10;
        const ARCHIVE: u32 = 0x20;
        // 7-Zip's convention for Unix modes: a flag bit and the full st_mode in the high 16 bits.
        const UNIX_EXTENSION: u32 = 0x8000;
        let mut item = if dir {
            ArchiveEntry::new_directory(name)
        } else {
            ArchiveEntry::new_file(name)
        };
        if let Some(time) = entry.mtime.and_then(entry::to_filetime) {
            item.last_modified_date = NtTime::from(time);
            item.has_last_modified_date = true;
        }
        let base = if dir { DIRECTORY } else { ARCHIVE };
        item.windows_attributes = match entry.mode {
            Some(mode) => {
                let file_type = if dir { 0o040_000 } else { 0o100_000 };
                base | UNIX_EXTENSION | (((mode & 0o7777) | file_type) << 16)
            }
            None => base,
        };
        item.has_windows_attributes = true;
        item
    }
}

impl<W: Write + Seek> Sink for SevenSink<W> {
    fn dir(&mut self, name: &str, entry: &Entry) -> Result<()> {
        self.writer
            .push_archive_entry::<&[u8]>(Self::entry(name, entry, true), None)
            .map_err(seven_write_error)?;
        Ok(())
    }

    fn file(&mut self, name: &str, entry: &Entry, data: &mut dyn Read) -> Result<()> {
        let item = Self::entry(name, entry, false);
        if entry.size == Some(0) {
            // An empty file is stored without a stream, as 7-Zip does.
            self.writer
                .push_archive_entry::<&[u8]>(item, None)
                .map_err(seven_write_error)?;
            return ensure_end(data);
        }
        self.writer
            .push_archive_entry(item, Some(data))
            .map_err(seven_write_error)?;
        Ok(())
    }

    fn finish(self: Box<Self>) -> Result<()> {
        self.writer.finish().map_err(uncarry)?.flush()?;
        Ok(())
    }
}

fn seven_write_error(e: sevenz_rust2::Error) -> Error {
    match e {
        sevenz_rust2::Error::Io(e, _) | sevenz_rust2::Error::FileOpen(e, _) => uncarry(e),
        other => Error::Other(other.to_string()),
    }
}
