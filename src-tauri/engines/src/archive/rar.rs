// SPDX-License-Identifier: MIT
//! Reading RAR archives (never writing them: the UnRAR licence allows extraction only).
//!
//! Entries are decoded in the library's test mode, which hands the data to a callback and never
//! creates files, folders or links itself. The library pushes data while the other readers are
//! pulled, so it runs on a worker thread that streams each entry over a bounded channel.

use std::cell::Cell;
use std::ffi::c_int;
use std::io::{self, Read};
use std::path::Path;
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread;

use unrar_sys as sys;

use super::entry::{self, Entry, Kind};
use super::{carry, Limits, Ticker, Tracked, Visit};
use crate::{Error, Progress, Result};

// UnRAR calls registry, token and crypto functions that `unrar_sys` does not link on its own.
#[cfg(windows)]
#[link(name = "advapi32")]
extern "system" {}

pub(super) fn for_each(
    input: &Path,
    limits: &Limits,
    progress: &Progress,
    visit: &mut Visit,
) -> Result<()> {
    // A clean "not found" rather than the library's generic open error.
    std::fs::File::open(input)?;
    let (entries, bytes) = list(input)?;
    super::read::check_stated(entries, bytes, limits)?;
    let ticker = Ticker::new(progress, bytes);
    thread::scope(|scope| {
        let (sender, receiver) = mpsc::sync_channel(4);
        let worker = scope.spawn(move || decode(input, sender));
        // `consume` drops the receiver when it returns, which stops a worker still sending.
        let result = consume(receiver, progress, &ticker, visit);
        if worker.join().is_err() {
            return Err(Error::Other("the RAR reader stopped unexpectedly".into()));
        }
        result
    })
}

enum Message {
    Entry(Entry),
    Data(Vec<u8>),
    /// The end of an entry, or of the archive when it failed.
    End(Result<()>),
}

fn consume(
    receiver: Receiver<Message>,
    progress: &Progress,
    ticker: &Ticker,
    visit: &mut Visit,
) -> Result<()> {
    while let Ok(message) = receiver.recv() {
        let entry = match message {
            Message::Entry(entry) => entry,
            Message::End(Err(e)) => return Err(e),
            Message::End(Ok(())) | Message::Data(_) => continue,
        };
        progress.check()?;
        let mut stream = Stream {
            receiver: &receiver,
            chunk: Vec::new(),
            pos: 0,
            ended: false,
        };
        if entry.kind == Kind::File {
            visit(
                &entry,
                Some(&mut Tracked::archive(&mut stream, Some(ticker))),
            )?;
        } else {
            visit(&entry, None)?;
        }
        stream.finish()?;
    }
    Ok(())
}

/// One entry's data as it arrives from the worker.
struct Stream<'a> {
    receiver: &'a Receiver<Message>,
    chunk: Vec<u8>,
    pos: usize,
    ended: bool,
}

impl Stream<'_> {
    /// Waits for the end of the entry, so that a decoding error is never missed.
    fn finish(&mut self) -> Result<()> {
        while !self.ended {
            self.next_chunk().map_err(super::uncarry)?;
        }
        Ok(())
    }

    fn next_chunk(&mut self) -> io::Result<()> {
        match self.receiver.recv() {
            Ok(Message::Data(chunk)) => {
                self.chunk = chunk;
                self.pos = 0;
                Ok(())
            }
            Ok(Message::End(Ok(()))) => {
                self.ended = true;
                Ok(())
            }
            Ok(Message::End(Err(e))) => {
                self.ended = true;
                Err(carry(e))
            }
            Ok(Message::Entry(_)) | Err(_) => {
                self.ended = true;
                Err(carry(Error::Unreadable("the RAR entry ended early".into())))
            }
        }
    }
}

impl Read for Stream<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        while self.pos == self.chunk.len() {
            if self.ended {
                return Ok(0);
            }
            self.next_chunk()?;
        }
        let n = buf.len().min(self.chunk.len() - self.pos);
        buf[..n].copy_from_slice(&self.chunk[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }
}

/// Counts the entries and their stated sizes without decoding anything.
fn list(input: &Path) -> Result<(u64, u64)> {
    let mut archive = Archive::open(input, sys::RAR_OM_LIST, None)?;
    let (mut entries, mut bytes) = (0u64, 0u64);
    while let Some(header) = archive.next_header()? {
        if header.flags & sys::RHDF_ENCRYPTED != 0 {
            return Err(Error::Encrypted);
        }
        entries += 1;
        bytes = bytes.saturating_add(unpacked_size(&header));
        archive.process(sys::RAR_SKIP)?;
    }
    Ok((entries, bytes))
}

/// The worker: decodes every file entry in test mode and sends it on.
fn decode(input: &Path, sender: SyncSender<Message>) {
    let session = Session {
        sender,
        stopped: Cell::new(false),
    };
    if let Err(e) = decode_all(input, &session) {
        if !session.stopped.get() {
            let _ = session.sender.send(Message::End(Err(e)));
        }
    }
}

fn decode_all(input: &Path, session: &Session) -> Result<()> {
    let mut archive = Archive::open(input, sys::RAR_OM_EXTRACT, Some(session))?;
    while let Some(header) = archive.next_header()? {
        if header.flags & sys::RHDF_ENCRYPTED != 0 {
            return Err(Error::Encrypted);
        }
        let entry = to_entry(&header);
        let file = entry.kind == Kind::File;
        if session.sender.send(Message::Entry(entry)).is_err() {
            return Ok(());
        }
        archive.process(if file { sys::RAR_TEST } else { sys::RAR_SKIP })?;
        if session.sender.send(Message::End(Ok(()))).is_err() {
            return Ok(());
        }
    }
    Ok(())
}

fn to_entry(header: &sys::HeaderDataEx) -> Entry {
    const REPARSE_POINT: u32 = 0x400;
    const TYPE_MASK: u32 = 0o170_000;
    // RAR 4 names the system that wrote the entry; RAR 5 reports Windows (2) or Unix (3).
    let unix = matches!(header.host_os, 3..=5);
    let attributes = header.file_attr;
    let file_type = attributes & TYPE_MASK;
    let link = header.redir_type != 0
        || if unix {
            file_type == 0o120_000
        } else {
            attributes & REPARSE_POINT != 0
        };
    let kind = if link {
        Kind::Link
    } else if header.flags & sys::RHDF_DIRECTORY != 0 {
        Kind::Dir
    } else if unix && !matches!(file_type, 0 | 0o100_000) {
        Kind::Other
    } else {
        Kind::File
    };
    let filetime = (u64::from(header.mtime_high) << 32) | u64::from(header.mtime_low);
    Entry {
        name: from_wide(&header.filename_w),
        kind,
        size: Some(unpacked_size(header)),
        mtime: entry::from_filetime(filetime).or_else(|| entry::from_dos(header.file_time)),
        mode: unix.then_some(attributes & 0o7777),
    }
}

fn unpacked_size(header: &sys::HeaderDataEx) -> u64 {
    (u64::from(header.unp_size_high) << 32) | u64::from(header.unp_size)
}

/// What the callback needs; it lives on the worker's stack while the archive is open.
struct Session {
    sender: SyncSender<Message>,
    /// The reading side went away, so the worker stops quietly.
    stopped: Cell<bool>,
}

extern "C" fn callback(
    message: sys::UINT,
    user_data: sys::LPARAM,
    p1: sys::LPARAM,
    p2: sys::LPARAM,
) -> c_int {
    match message {
        sys::UCM_PROCESSDATA if user_data != 0 => {
            // SAFETY: `user_data` is the `Session` passed to `Archive::open`, which outlives the
            // archive handle, and only shared references to it exist.
            let session = unsafe { &*(user_data as *const Session) };
            let len = usize::try_from(p2).unwrap_or(0);
            let data = if p1 == 0 || len == 0 {
                Vec::new()
            } else {
                // SAFETY: UnRAR passes `p2` readable bytes at `p1` for the duration of the call.
                unsafe { std::slice::from_raw_parts(p1 as *const u8, len) }.to_vec()
            };
            if session.sender.send(Message::Data(data)).is_err() {
                session.stopped.set(true);
                return -1;
            }
            1
        }
        // The next volume is missing: stop rather than wait for it.
        sys::UCM_CHANGEVOLUME | sys::UCM_CHANGEVOLUMEW if p2 == sys::RAR_VOL_ASK => -1,
        sys::UCM_CHANGEVOLUME | sys::UCM_CHANGEVOLUMEW => 1,
        // No password is ever given; the library then reports the archive as locked.
        sys::UCM_NEEDPASSWORD | sys::UCM_NEEDPASSWORDW => -1,
        sys::UCM_PROCESSDATA => -1,
        _ => 0,
    }
}

/// An open archive handle, closed on drop.
struct Archive {
    handle: *const sys::Handle,
}

impl Archive {
    fn open(path: &Path, mode: u32, session: Option<&Session>) -> Result<Self> {
        let name = NativeName::new(path)?;
        let mut data = sys::OpenArchiveDataEx {
            archive_name: name.narrow(),
            archive_name_w: name.wide(),
            open_mode: mode,
            open_result: 0,
            comment_buffer: std::ptr::null_mut(),
            comment_buffer_size: 0,
            comment_size: 0,
            comment_state: 0,
            flags: 0,
            callback: Some(callback),
            user_data: session.map_or(0, |session| session as *const Session as sys::LPARAM),
            op_flags: 0,
            comment_buffer_w: std::ptr::null_mut(),
            reserved: [0; 25],
        };
        // SAFETY: `data` and the name it points to are valid for the call; UnRAR copies the name
        // and writes only `open_result` and `flags`.
        let handle = unsafe { sys::RAROpenArchiveEx(&raw mut data) };
        let archive = Self { handle };
        if handle.is_null() || data.open_result != 0 {
            return Err(code_error(data.open_result as c_int));
        }
        Ok(archive)
    }

    fn next_header(&mut self) -> Result<Option<Box<sys::HeaderDataEx>>> {
        let mut header = Box::<sys::HeaderDataEx>::default();
        // SAFETY: the handle is open and `header` is a zeroed `RARHeaderDataEx` whose `RedirName`
        // buffer is null, so UnRAR writes only inside the struct.
        let code = unsafe { sys::RARReadHeaderEx(self.handle, &raw mut *header) };
        match code {
            sys::ERAR_SUCCESS => Ok(Some(header)),
            sys::ERAR_END_ARCHIVE => Ok(None),
            code => Err(code_error(code)),
        }
    }

    fn process(&mut self, operation: c_int) -> Result<()> {
        // SAFETY: the handle is open and a header was just read; with no destination given,
        // test and skip write nothing to disk.
        let code = unsafe {
            sys::RARProcessFileW(self.handle, operation, std::ptr::null(), std::ptr::null())
        };
        match code {
            sys::ERAR_SUCCESS => Ok(()),
            code => Err(code_error(code)),
        }
    }
}

impl Drop for Archive {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            // SAFETY: the handle came from `RAROpenArchiveEx` and is closed only here.
            unsafe { sys::RARCloseArchive(self.handle) };
        }
    }
}

fn code_error(code: c_int) -> Error {
    match code {
        sys::ERAR_MISSING_PASSWORD | sys::ERAR_BAD_PASSWORD => Error::Encrypted,
        sys::ERAR_NO_MEMORY => Error::Other("not enough memory for this RAR archive".into()),
        sys::ERAR_BAD_DATA => Error::Unreadable("the RAR data is damaged".into()),
        sys::ERAR_BAD_ARCHIVE | sys::ERAR_UNKNOWN_FORMAT => {
            Error::Unreadable("not a RAR archive this reader supports".into())
        }
        sys::ERAR_EOPEN => Error::Unreadable("a RAR volume could not be opened".into()),
        code => Error::Unreadable(format!("UnRAR stopped with code {code}")),
    }
}

/// The archive path in the form UnRAR wants on this system.
struct NativeName {
    #[cfg(any(windows, target_os = "macos"))]
    wide: Vec<sys::WCHAR>,
    #[cfg(not(any(windows, target_os = "macos")))]
    narrow: std::ffi::CString,
}

impl NativeName {
    #[cfg(windows)]
    fn new(path: &Path) -> Result<Self> {
        use std::os::windows::ffi::OsStrExt;
        let mut wide: Vec<sys::WCHAR> = path.as_os_str().encode_wide().collect();
        if wide.contains(&0) {
            return Err(Error::Other("the path contains a NUL character".into()));
        }
        wide.push(0);
        Ok(Self { wide })
    }

    #[cfg(target_os = "macos")]
    fn new(path: &Path) -> Result<Self> {
        let text = path
            .to_str()
            .ok_or_else(|| Error::Other("the path is not valid Unicode".into()))?;
        let mut wide: Vec<sys::WCHAR> = text.chars().map(|c| c as sys::WCHAR).collect();
        if wide.contains(&0) {
            return Err(Error::Other("the path contains a NUL character".into()));
        }
        wide.push(0);
        Ok(Self { wide })
    }

    // Elsewhere UnRAR converts wide names with the current locale, so the raw bytes are safer.
    #[cfg(not(any(windows, target_os = "macos")))]
    fn new(path: &Path) -> Result<Self> {
        let narrow = std::ffi::CString::new(path.as_os_str().as_encoded_bytes())
            .map_err(|_| Error::Other("the path contains a NUL character".into()))?;
        Ok(Self { narrow })
    }

    #[cfg(any(windows, target_os = "macos"))]
    fn wide(&self) -> *const sys::WCHAR {
        self.wide.as_ptr()
    }

    #[cfg(any(windows, target_os = "macos"))]
    fn narrow(&self) -> *const std::ffi::c_char {
        std::ptr::null()
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    fn wide(&self) -> *const sys::WCHAR {
        std::ptr::null()
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    fn narrow(&self) -> *const std::ffi::c_char {
        self.narrow.as_ptr()
    }
}

/// A NUL-terminated name from UnRAR: UTF-16 on Windows.
#[cfg(windows)]
fn from_wide(buffer: &[sys::WCHAR]) -> String {
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

/// A NUL-terminated name from UnRAR: UTF-32 outside Windows.
#[cfg(not(windows))]
fn from_wide(buffer: &[sys::WCHAR]) -> String {
    buffer
        .iter()
        .take_while(|&&c| c != 0)
        .map(|&c| char::from_u32(c as u32).unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}
