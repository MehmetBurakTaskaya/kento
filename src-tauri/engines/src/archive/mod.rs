// SPDX-License-Identifier: MIT
//! Archive extraction and conversion (SPEC 5.4, 5.5): ZIP, TAR, GZ, RAR (read only) and 7Z.
//!
//! Every reader walks its archive entry by entry and hands each file's data over as a stream, so
//! nothing is unpacked to disk first unless a format needs it.

mod entry;
mod rar;
mod read;
mod safe;
mod write;

#[cfg(test)]
mod tests;

use std::cell::Cell;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use crate::{Conversion, Error, Output, Progress, Result};

use entry::{Entry, Kind};

pub use write::create_zip;

/// Safety limits against archive bombs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Limits {
    pub max_entries: u64,
    /// The total size of everything extracted.
    pub max_total_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_entries: 100_000,
            max_total_bytes: 16 << 30,
        }
    }
}

const INPUTS: &[&str] = &["zip", "tar", "gz", "rar", "7z"];
const OUTPUTS: &[&str] = &["zip", "tar", "tar-gz", "7z"];

pub fn supports(from: &str, to: &str) -> bool {
    INPUTS.contains(&from)
        && OUTPUTS.contains(&to)
        && from != to
        && !(from == "gz" && to == "tar-gz")
}

pub fn output(_from: &str, _to: &str) -> Output {
    Output::File
}

/// Repacks every entry into the target format. Symbolic links are skipped; a single gzipped file
/// becomes an archive holding that one file.
pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    if !supports(job.from, job.to) {
        return Err(Error::Unsupported {
            from: job.from.to_owned(),
            to: job.to.to_owned(),
        });
    }
    tracing::debug!(from = job.from, to = job.to, "repacking an archive");
    let mut sink = write::create(job.to, job.dest, job.temp)?;
    let mut budget = Budget::new(&job.options.archive_limits);
    let mut names = Names::default();
    read::for_each(
        job.input,
        job.from,
        &job.options.archive_limits,
        job.progress,
        &mut |entry, data| {
            budget.entry()?;
            let parts = safe::components(&entry.name);
            if parts.is_empty() {
                return Ok(());
            }
            let name = parts.join("/");
            match (entry.kind, data) {
                (Kind::Dir, _) if names.dirs.insert(name.clone()) => sink.dir(&name, entry),
                (Kind::File, Some(data)) => {
                    let name = names.file(&name);
                    sink.file(&name, entry, &mut Metered::new(data, &mut budget))
                }
                _ => Ok(()),
            }
        },
    )?;
    sink.finish()?;
    job.progress.report(1.0);
    Ok(vec![job.dest.to_path_buf()])
}

/// Extracts an archive into `dest_dir`, a new, empty folder, and returns the files written.
///
/// Entry paths never leave `dest_dir` (absolute paths, drives and `..` are neutralised), names
/// this system forbids are replaced, links are never created, and entries that map to the same
/// name are numbered rather than overwritten. Over `limits`, extraction stops with
/// `Error::Limit`, leaving what was written so far.
pub fn extract(
    input: &Path,
    from: &str,
    dest_dir: &Path,
    limits: &Limits,
    progress: &Progress,
) -> Result<Vec<PathBuf>> {
    tracing::debug!(from, "extracting an archive");
    let mut placer = safe::Placer::new(dest_dir);
    let mut budget = Budget::new(limits);
    let mut written = Vec::new();
    read::for_each(input, from, limits, progress, &mut |entry, data| {
        budget.entry()?;
        let parts = safe::local_components(&entry.name);
        if parts.is_empty() {
            return Ok(());
        }
        match (entry.kind, data) {
            (Kind::Dir, _) => placer.dir(&parts).map(drop),
            (Kind::File, Some(data)) => {
                let (path, file) = placer.file(&parts)?;
                match fill(file, &mut Metered::new(data, &mut budget), entry) {
                    Ok(()) => {
                        written.push(path);
                        Ok(())
                    }
                    Err(e) => {
                        // A partial file would look complete.
                        let _ = fs::remove_file(&path);
                        Err(e)
                    }
                }
            }
            _ => Ok(()),
        }
    })?;
    progress.report(1.0);
    Ok(written)
}

/// Writes one extracted file and gives it the entry's time and permissions.
fn fill(file: File, data: &mut dyn Read, entry: &Entry) -> Result<()> {
    let mut out = BufWriter::new(file);
    io::copy(data, &mut out).map_err(uncarry)?;
    let file = flushed(out)?;
    if let Some(time) = entry.mtime.and_then(entry::to_system) {
        file.set_modified(time)?;
    }
    #[cfg(unix)]
    if let Some(mode) = entry.mode {
        use std::os::unix::fs::PermissionsExt;
        // Owner read keeps the file usable; set-id and sticky bits never come from an archive.
        file.set_permissions(fs::Permissions::from_mode((mode & 0o777) | 0o400))?;
    }
    Ok(())
}

/// What a reader calls for every entry: the file's data for `Kind::File`, `None` otherwise.
type Visit<'v> = dyn FnMut(&Entry, Option<&mut dyn Read>) -> Result<()> + 'v;

/// Names already used in an archive being written. The formats allow duplicates, but extracting
/// them would overwrite, and ZIP writers refuse them.
#[derive(Default)]
struct Names {
    files: HashSet<String>,
    dirs: HashSet<String>,
}

impl Names {
    fn file(&mut self, name: &str) -> String {
        let mut n = 1;
        loop {
            let candidate = safe::numbered_path(name, n);
            if !self.dirs.contains(&candidate) && self.files.insert(candidate.clone()) {
                return candidate;
            }
            n += 1;
        }
    }
}

/// Counts entries and real bytes against `Limits`.
struct Budget {
    limits: Limits,
    entries: u64,
    bytes: u64,
}

impl Budget {
    fn new(limits: &Limits) -> Self {
        Self {
            limits: limits.clone(),
            entries: 0,
            bytes: 0,
        }
    }

    fn entry(&mut self) -> Result<()> {
        self.entries += 1;
        if self.entries > self.limits.max_entries {
            return Err(too_many_entries(&self.limits));
        }
        Ok(())
    }

    fn take(&mut self, bytes: u64) -> io::Result<()> {
        self.bytes = self.bytes.saturating_add(bytes);
        if self.bytes > self.limits.max_total_bytes {
            return Err(carry(too_many_bytes(&self.limits)));
        }
        Ok(())
    }
}

fn too_many_entries(limits: &Limits) -> Error {
    Error::Limit(format!("more than {} entries", limits.max_entries))
}

fn too_many_bytes(limits: &Limits) -> Error {
    Error::Limit(format!("more than {} bytes", limits.max_total_bytes))
}

/// Entry data counted against the budget as it is read.
struct Metered<'a, R> {
    inner: R,
    budget: &'a mut Budget,
}

impl<'a, R: Read> Metered<'a, R> {
    fn new(inner: R, budget: &'a mut Budget) -> Self {
        Self { inner, budget }
    }
}

impl<R: Read> Read for Metered<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.budget.take(n as u64)?;
        Ok(n)
    }
}

/// Progress and cancellation while bytes flow, checked every megabyte rather than on every read.
struct Ticker<'a> {
    progress: &'a Progress<'a>,
    /// What `done` counts up to; 0 when unknown.
    total: u64,
    done: Cell<u64>,
    next: Cell<u64>,
}

impl<'a> Ticker<'a> {
    const STEP: u64 = 1 << 20;

    fn new(progress: &'a Progress<'a>, total: u64) -> Self {
        Self {
            progress,
            total,
            done: Cell::new(0),
            next: Cell::new(Self::STEP),
        }
    }

    fn advance(&self, bytes: u64) -> io::Result<()> {
        let done = self.done.get().saturating_add(bytes);
        self.done.set(done);
        if done >= self.next.get() {
            self.next.set(done.saturating_add(Self::STEP));
            self.progress.check().map_err(carry)?;
            if self.total > 0 {
                self.progress.report(done as f32 / self.total as f32);
            }
        }
        Ok(())
    }
}

/// A reader that ticks progress and, for archive data, turns read failures into
/// `Error::Unreadable` so that they are not mistaken for failures of the destination.
struct Tracked<'t, R> {
    inner: R,
    ticker: Option<&'t Ticker<'t>>,
    damaged_on_error: bool,
}

impl<'t, R: Read> Tracked<'t, R> {
    fn archive(inner: R, ticker: Option<&'t Ticker<'t>>) -> Self {
        Self {
            inner,
            ticker,
            damaged_on_error: true,
        }
    }

    fn plain(inner: R, ticker: Option<&'t Ticker<'t>>) -> Self {
        Self {
            inner,
            ticker,
            damaged_on_error: false,
        }
    }
}

impl<R: Read> Read for Tracked<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = match self.inner.read(buf) {
            Ok(n) => n,
            Err(e)
                if self.damaged_on_error
                    && e.kind() != io::ErrorKind::Interrupted
                    && !carries(&e) =>
            {
                return Err(carry(Error::Unreadable(e.to_string())));
            }
            Err(e) => return Err(e),
        };
        if let Some(ticker) = self.ticker {
            ticker.advance(n as u64)?;
        }
        Ok(n)
    }
}

/// Sends an engine error through `io::Read`, `io::Write` and the crates' callbacks.
fn carry(error: Error) -> io::Error {
    io::Error::other(error)
}

fn carries(e: &io::Error) -> bool {
    e.get_ref().is_some_and(|inner| inner.is::<Error>())
}

/// Takes back an error sent with `carry`; any other I/O error stays one.
fn uncarry(e: io::Error) -> Error {
    if !carries(&e) {
        return Error::Io(e);
    }
    match e.into_inner().map(|inner| inner.downcast::<Error>()) {
        Some(Ok(error)) => *error,
        Some(Err(other)) => Error::Other(other.to_string()),
        None => Error::Other("an unknown I/O error".into()),
    }
}

/// For failures while reading an archive: it is damaged, unless the error is one of ours.
fn unreadable(e: io::Error) -> Error {
    if carries(&e) {
        uncarry(e)
    } else {
        Error::Unreadable(e.to_string())
    }
}

/// Writes everything and flushes, for writers whose drop would swallow a failed flush.
fn flushed<W: Write>(writer: BufWriter<W>) -> Result<W> {
    writer.into_inner().map_err(|e| Error::Io(e.into_error()))
}
