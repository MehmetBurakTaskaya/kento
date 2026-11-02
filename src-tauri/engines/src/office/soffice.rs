// SPDX-License-Identifier: MIT
//! Running `soffice` (LibreOffice Help, "Starting LibreOffice Software With Parameters"): one
//! headless conversion per run, arguments as an array, Kento's profile through
//! `-env:UserInstallation`, and a kill on cancel or timeout that ends LibreOffice's own
//! processes too (`soffice` starts `soffice.bin`).

use std::collections::VecDeque;
use std::ffi::OsString;
use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::PoisonError;
use std::thread;
use std::time::{Duration, Instant};

use super::profile;
use crate::process::{command, Reap};
use crate::{Codec, Error, Progress, Result};

/// No window, splash or start center; no check for another instance on the installation and no
/// crash recovery, so a run that was killed leaves nothing to restore in the next one.
const FLAGS: [&str; 6] = [
    "--headless",
    "--invisible",
    "--nologo",
    "--nodefault",
    "--nolockcheck",
    "--norestore",
];

/// A run that takes longer is stopped. Large documents through the PDF import take minutes; a run
/// this long is stuck.
const TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// How often a run looks at the cancel flag.
const POLL: Duration = Duration::from_millis(100);

/// The wait before a run that wrote nothing is tried again.
const RETRY_PAUSE: Duration = Duration::from_secs(1);

/// How many of LibreOffice's last output lines a run keeps for its error message.
const TAIL: usize = 32;

/// Messages that mean the document itself is the problem.
const INPUT_PROBLEMS: &[&str] = &[
    "could not be loaded",
    "General input/output error",
    "Format error",
];

/// `--convert-to <extension>:<filter>[:<options>]`. LibreOffice names its result after the input
/// with this extension.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Export {
    pub(super) extension: &'static str,
    pub(super) filter: String,
}

impl Export {
    pub(super) fn new(extension: &'static str, filter: &str) -> Export {
        Export {
            extension,
            filter: filter.to_owned(),
        }
    }

    fn argument(&self) -> String {
        format!("{}:{}", self.extension, self.filter)
    }
}

/// LibreOffice with one profile.
pub(super) struct Office<'a> {
    soffice: &'a Path,
    profile: &'a Path,
    progress: Progress<'a>,
}

impl<'a> Office<'a> {
    pub(super) fn new(soffice: &'a Path, profile: &'a Path, progress: Progress<'a>) -> Self {
        Office {
            soffice,
            profile,
            progress,
        }
    }

    /// Converts `input` into `outdir` and returns the file LibreOffice wrote. LibreOffice often
    /// ends with success when it could not load or write anything, so only a written file counts.
    pub(super) fn convert(
        &self,
        input: &Path,
        infilter: Option<&str>,
        export: &Export,
        outdir: &Path,
    ) -> Result<PathBuf> {
        let args = arguments(self.profile, infilter, export, outdir, input);
        let stem = input
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut log = self.run(&args, outdir)?;
        if written(outdir, &stem, export.extension).is_none() && !log.input_problem() {
            // A first start may only set a new profile up and end, and a start right after a run
            // that was ended can crash or hand the job to the instance still going away; the
            // second run, a moment later, converts. A document that cannot be loaded is not
            // tried twice.
            std::thread::sleep(RETRY_PAUSE);
            log = self.run(&args, outdir)?;
        }
        match written(outdir, &stem, export.extension) {
            Some(path) => Ok(path),
            None => {
                let error = log.failure();
                tracing::warn!("LibreOffice wrote nothing: {error}");
                Err(error)
            }
        }
    }

    /// One run of LibreOffice and what it said.
    fn run(&self, args: &[OsString], cwd: &Path) -> Result<Log> {
        self.progress.check()?;
        // One soffice per profile at a time (SPEC 6): the warm-up may run beside a job.
        let lock = profile::lock(self.profile);
        let _guard = lock.lock().unwrap_or_else(PoisonError::into_inner);
        let _held = profile::hold(self.profile, &self.progress)?;
        profile::prepare(self.profile)?;
        let mut command = command(&program(self.soffice));
        command
            .args(args)
            .current_dir(cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = Reap::spawn_group(command).map_err(spawn_error)?;
        let (sender, lines) = mpsc::channel();
        if let Some(stdout) = child.child.stdout.take() {
            forward(stdout, sender.clone());
        }
        if let Some(stderr) = child.child.stderr.take() {
            forward(stderr, sender);
        }
        let mut log = Log::default();
        let started = Instant::now();
        let status = loop {
            log.take(&lines, POLL);
            if self.progress.is_cancelled() {
                child.kill();
                return Err(Error::Cancelled);
            }
            if started.elapsed() > TIMEOUT {
                child.kill();
                return Err(Error::Other(format!(
                    "LibreOffice did not finish within {} minutes",
                    TIMEOUT.as_secs() / 60
                )));
            }
            if let Some(status) = child.child.try_wait()? {
                break status;
            }
        };
        // What is still in the pipes; a process LibreOffice left behind could keep them open, so
        // this waits only briefly (dropping `child` ends such a process on Windows).
        let grace = Instant::now() + Duration::from_secs(2);
        while Instant::now() < grace && !log.closed {
            log.take(&lines, Duration::from_millis(50));
        }
        if !status.success() {
            tracing::warn!("LibreOffice ended with {status}");
        }
        Ok(log)
    }
}

/// On Windows, `soffice.com` beside `soffice.exe`: the console version, which waits for
/// LibreOffice to finish and passes on what it prints.
pub(super) fn program(soffice: &Path) -> PathBuf {
    if cfg!(windows) {
        let console = soffice.with_extension("com");
        if console.is_file() {
            return console;
        }
    }
    soffice.to_path_buf()
}

fn spawn_error(error: io::Error) -> Error {
    if error.kind() == io::ErrorKind::NotFound {
        Error::MissingCodec(Codec::LibreOffice)
    } else {
        Error::Io(error)
    }
}

/// The arguments of one conversion. Every path is absolute and the input's name is plain ASCII;
/// the profile goes as a percent-encoded file URL, as LibreOffice expects.
pub(super) fn arguments(
    profile: &Path,
    infilter: Option<&str>,
    export: &Export,
    outdir: &Path,
    input: &Path,
) -> Vec<OsString> {
    let mut args: Vec<OsString> =
        vec![format!("-env:UserInstallation={}", file_url(profile)).into()];
    args.extend(FLAGS.iter().map(OsString::from));
    if let Some(filter) = infilter {
        args.push(format!("--infilter={filter}").into());
    }
    args.push("--convert-to".into());
    args.push(export.argument().into());
    args.push("--outdir".into());
    args.push(plain(outdir));
    args.push(plain(input));
    args
}

/// A path without the Windows `\\?\` prefix, which LibreOffice does not read.
fn plain(path: &Path) -> OsString {
    let text = path.to_string_lossy();
    match strip_verbatim(&text) {
        Some(stripped) => stripped.into(),
        None => path.as_os_str().to_owned(),
    }
}

fn strip_verbatim(text: &str) -> Option<String> {
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        Some(format!(r"\\{unc}"))
    } else {
        text.strip_prefix(r"\\?\").map(str::to_owned)
    }
}

/// `file:///C:/Users/…` (Windows), `file:///home/…` or `file://server/share/…`, with every byte
/// outside the unreserved characters percent-encoded as UTF-8.
pub(super) fn file_url(path: &Path) -> String {
    url_of(&path.to_string_lossy(), cfg!(windows))
}

pub(super) fn url_of(path: &str, windows: bool) -> String {
    let path = strip_verbatim(path).unwrap_or_else(|| path.to_owned());
    let path = if windows {
        path.replace('\\', "/")
    } else {
        path
    };
    let (prefix, rest) = match path.strip_prefix("//") {
        Some(unc) => ("file://", unc.to_owned()),
        None if path.starts_with('/') => ("file://", path),
        None => ("file:///", path),
    };
    let mut url = String::from(prefix);
    for byte in rest.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/' | b':') {
            url.push(char::from(byte));
        } else {
            url.push_str(&format!("%{byte:02X}"));
        }
    }
    url
}

/// The file LibreOffice wrote: `<input stem>.<extension>` in `outdir`, or the one file there with
/// that extension. Empty files do not count.
fn written(outdir: &Path, stem: &str, extension: &str) -> Option<PathBuf> {
    let non_empty =
        |path: &Path| fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.len() > 0);
    let expected = outdir.join(format!("{stem}.{extension}"));
    if non_empty(&expected) {
        return Some(expected);
    }
    fs::read_dir(outdir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .find(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
                && non_empty(path)
        })
}

/// Sends every line of a pipe until it closes.
fn forward(pipe: impl Read + Send + 'static, sender: mpsc::Sender<String>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(pipe);
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text = String::from_utf8_lossy(&line).trim().to_owned();
            if !text.is_empty() && sender.send(text).is_err() {
                break;
            }
        }
    });
}

/// What LibreOffice printed (it names files, never their contents).
#[derive(Debug, Default)]
pub(super) struct Log {
    pub(super) tail: VecDeque<String>,
    closed: bool,
}

impl Log {
    /// Takes the lines that arrive within `wait`.
    fn take(&mut self, lines: &Receiver<String>, wait: Duration) {
        let mut wait = wait;
        loop {
            match lines.recv_timeout(wait) {
                Ok(line) => {
                    if self.tail.len() == TAIL {
                        self.tail.pop_front();
                    }
                    self.tail.push_back(line);
                    wait = Duration::ZERO;
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    self.closed = true;
                    if wait > Duration::ZERO {
                        thread::sleep(wait);
                    }
                    break;
                }
            }
        }
    }

    /// Whether LibreOffice said it could not load or read the document.
    pub(super) fn input_problem(&self) -> bool {
        self.tail
            .iter()
            .any(|line| INPUT_PROBLEMS.iter().any(|problem| line.contains(problem)))
    }

    /// The error for a run that wrote nothing: `Unreadable` with LibreOffice's message when it
    /// could not load the document, otherwise `Other`.
    pub(super) fn failure(&self) -> Error {
        let last: Vec<&str> = self
            .tail
            .iter()
            .skip(self.tail.len().saturating_sub(4))
            .map(String::as_str)
            .collect();
        let detail = if last.is_empty() {
            "LibreOffice stopped without a message".to_owned()
        } else {
            last.join(" | ")
        };
        if self.input_problem() {
            Error::Unreadable(format!("LibreOffice: {detail}"))
        } else {
            Error::Other(format!("LibreOffice wrote nothing: {detail}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn office_soffice_arguments_are_an_array_in_a_fixed_order() {
        let export = Export::new("csv", "Text - txt - csv (StarCalc):9,34,76");
        let (profile, outdir, input) = if cfg!(windows) {
            (
                r"C:\Kullanıcılar\Şule\Kento\office-profile",
                r"C:\Temp\job-1\office\out",
                r"C:\Temp\job-1\office\in\in.ods",
            )
        } else {
            (
                "/home/şule/Kento/office-profile",
                "/tmp/job-1/office/out",
                "/tmp/job-1/office/in/in.ods",
            )
        };
        let args = arguments(
            Path::new(profile),
            Some("calc8"),
            &export,
            Path::new(outdir),
            Path::new(input),
        );
        let args: Vec<String> = args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let url = if cfg!(windows) {
            "file:///C:/Kullan%C4%B1c%C4%B1lar/%C5%9Eule/Kento/office-profile"
        } else {
            "file:///home/%C5%9Fule/Kento/office-profile"
        };
        assert_eq!(
            args,
            [
                format!("-env:UserInstallation={url}").as_str(),
                "--headless",
                "--invisible",
                "--nologo",
                "--nodefault",
                "--nolockcheck",
                "--norestore",
                "--infilter=calc8",
                "--convert-to",
                "csv:Text - txt - csv (StarCalc):9,34,76",
                "--outdir",
                outdir,
                input,
            ]
        );
        let without = arguments(
            Path::new(profile),
            None,
            &export,
            Path::new(outdir),
            Path::new(input),
        );
        assert!(!without
            .iter()
            .any(|arg| arg.to_string_lossy().starts_with("--infilter")));
    }

    #[test]
    fn office_soffice_file_urls_are_percent_encoded_utf8() {
        assert_eq!(
            url_of(r"C:\Users\Çağrı\AppData\Kento 🧪\profile", true),
            "file:///C:/Users/%C3%87a%C4%9Fr%C4%B1/AppData/Kento%20%F0%9F%A7%AA/profile"
        );
        assert_eq!(
            url_of(r"\\?\C:\very\long\path", true),
            "file:///C:/very/long/path"
        );
        assert_eq!(
            url_of(r"\\?\UNC\server\share\Kento", true),
            "file://server/share/Kento"
        );
        assert_eq!(
            url_of(r"\\server\share\a#b%c", true),
            "file://server/share/a%23b%25c"
        );
        assert_eq!(
            url_of(
                "/Users/şule/Library/Application Support/Kento/office-profile",
                false
            ),
            "file:///Users/%C5%9Fule/Library/Application%20Support/Kento/office-profile"
        );
        // A backslash is an ordinary character in a Unix file name.
        assert_eq!(url_of("/tmp/a\\b", false), "file:///tmp/a%5Cb");
    }

    #[test]
    fn office_soffice_verbatim_paths_lose_their_prefix() {
        assert_eq!(
            strip_verbatim(r"\\?\C:\Temp\x").as_deref(),
            Some(r"C:\Temp\x")
        );
        assert_eq!(
            strip_verbatim(r"\\?\UNC\srv\share").as_deref(),
            Some(r"\\srv\share")
        );
        assert_eq!(strip_verbatim(r"C:\Temp"), None);
    }

    #[test]
    fn office_soffice_the_console_program_is_preferred_on_windows() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("soffice.exe");
        fs::write(&exe, b"").unwrap();
        assert_eq!(program(&exe), exe);
        let com = dir.path().join("soffice.com");
        fs::write(&com, b"").unwrap();
        let expected = if cfg!(windows) { com } else { exe.clone() };
        assert_eq!(program(&exe), expected);
    }

    #[test]
    fn office_soffice_finds_what_libreoffice_wrote() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path();
        assert_eq!(written(out, "in", "pdf"), None);
        fs::write(out.join("in.pdf"), b"").unwrap();
        assert_eq!(written(out, "in", "pdf"), None, "empty files do not count");
        fs::write(out.join("in.pdf"), b"%PDF").unwrap();
        assert_eq!(written(out, "in", "pdf"), Some(out.join("in.pdf")));
        fs::write(out.join("other.CSV"), b"a,b").unwrap();
        assert_eq!(written(out, "in", "csv"), Some(out.join("other.CSV")));
    }

    #[test]
    fn office_soffice_blames_the_document_only_when_libreoffice_does() {
        let mut log = Log::default();
        log.tail
            .push_back("convert /tmp/in/in.docx -> /tmp/out/in.pdf".into());
        log.tail
            .push_back("Error: source file could not be loaded".into());
        let Error::Unreadable(message) = log.failure() else {
            panic!("a document LibreOffice cannot load is unreadable");
        };
        assert!(message.contains("source file could not be loaded"));
        let mut log = Log::default();
        log.tail
            .push_back("Error: no export filter for /tmp/out/in.xyz found, aborting.".into());
        assert!(matches!(log.failure(), Error::Other(_)));
        assert!(matches!(Log::default().failure(), Error::Other(_)));
    }

    /// A stand-in for `soffice`: a shell script with `body` (cmd on Windows, sh elsewhere).
    fn stand_in(dir: &Path, windows: &str, unix: &str) -> PathBuf {
        if cfg!(windows) {
            let path = dir.join("soffice.cmd");
            fs::write(
                &path,
                format!("@echo off\r\n{}\r\n", windows.replace('\n', "\r\n")),
            )
            .unwrap();
            path
        } else {
            let path = dir.join("soffice");
            fs::write(&path, format!("#!/bin/sh\n{unix}\n")).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            }
            path
        }
    }

    /// A job folder like the app's, with Turkish letters and an emoji in its path.
    fn job() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("İş ğüşıöç 🧪");
        let out = root.join("out");
        fs::create_dir_all(&out).unwrap();
        let input = root.join("in.docx");
        fs::write(&input, b"PK").unwrap();
        let profile = root.join("profile");
        (dir, out, input, profile)
    }

    #[test]
    fn office_soffice_a_run_returns_what_the_program_wrote() {
        let (dir, out, input, profile) = job();
        let program = stand_in(
            dir.path(),
            "echo convert done\necho %%PDF-1.7> in.pdf",
            "echo convert done\nprintf '%%PDF-1.7' > in.pdf",
        );
        let office = Office::new(&program, &profile, Progress::none());
        let export = Export::new("pdf", "writer_pdf_Export");
        let written = office.convert(&input, None, &export, &out).unwrap();
        assert_eq!(written, out.join("in.pdf"));
        assert!(fs::read(&written).unwrap().starts_with(b"%PDF-1.7"));
        assert!(profile
            .join("user")
            .join("registrymodifications.xcu")
            .is_file());

        let program = stand_in(
            dir.path(),
            "echo Error: source file could not be loaded 1>&2",
            "echo 'Error: source file could not be loaded' >&2",
        );
        fs::remove_file(&written).unwrap();
        let office = Office::new(&program, &profile, Progress::none());
        let result = office.convert(&input, None, &export, &out);
        let Err(Error::Unreadable(message)) = result else {
            panic!("expected an unreadable document, got {result:?}");
        };
        assert!(
            message.contains("source file could not be loaded"),
            "{message}"
        );
    }

    #[test]
    fn office_soffice_a_run_that_wrote_nothing_gets_one_more() {
        let (dir, out, input, profile) = job();
        // The stand-in only "sets the profile up" the first time, as a first start may.
        let program = stand_in(
            dir.path(),
            "if exist seen (echo %%PDF-1.7> in.pdf) else (echo.> seen)",
            "if [ -e seen ]; then printf '%%PDF-1.7' > in.pdf; else : > seen; fi",
        );
        let office = Office::new(&program, &profile, Progress::none());
        let export = Export::new("pdf", "writer_pdf_Export");
        assert_eq!(
            office.convert(&input, None, &export, &out).unwrap(),
            out.join("in.pdf")
        );
        // A profile in use gets it too, but only one: a program that never writes runs twice.
        fs::remove_file(out.join("in.pdf")).unwrap();
        fs::create_dir_all(profile.join("user").join("config")).unwrap();
        let program = stand_in(dir.path(), "echo run>> runs.txt", "echo run >> runs.txt");
        let office = Office::new(&program, &profile, Progress::none());
        assert!(office.convert(&input, None, &export, &out).is_err());
        let runs = fs::read_to_string(out.join("runs.txt")).unwrap();
        assert_eq!(runs.lines().count(), 2, "{runs:?}");
    }

    #[test]
    fn office_soffice_a_crash_gets_a_second_run_and_a_bad_document_does_not() {
        let (dir, out, input, profile) = job();
        fs::create_dir_all(profile.join("user").join("config")).unwrap();
        // The stand-in crashes the first time, as LibreOffice can right after a run was ended.
        let program = stand_in(
            dir.path(),
            "if exist seen (echo %%PDF-1.7> in.pdf) else (echo.> seen & exit /b 134)",
            "if [ -e seen ]; then printf '%%PDF-1.7' > in.pdf; else : > seen; exit 134; fi",
        );
        let office = Office::new(&program, &profile, Progress::none());
        let export = Export::new("pdf", "writer_pdf_Export");
        assert_eq!(
            office.convert(&input, None, &export, &out).unwrap(),
            out.join("in.pdf")
        );
        // A document LibreOffice cannot load is not tried twice.
        fs::remove_file(out.join("in.pdf")).unwrap();
        fs::remove_file(out.join("seen")).unwrap();
        let program = stand_in(
            dir.path(),
            "if exist seen (echo %%PDF-1.7> in.pdf) else (echo.> seen & echo Error: source file could not be loaded & exit /b 1)",
            "if [ -e seen ]; then printf '%%PDF-1.7' > in.pdf; else : > seen; echo 'Error: source file could not be loaded'; exit 1; fi",
        );
        let office = Office::new(&program, &profile, Progress::none());
        assert!(matches!(
            office.convert(&input, None, &export, &out),
            Err(Error::Unreadable(_))
        ));
    }

    #[test]
    fn office_soffice_cancelling_ends_every_process_it_started() {
        let (dir, out, input, profile) = job();
        // The stand-in starts a child of its own that would run for a minute.
        let program = stand_in(
            dir.path(),
            "ping -n 60 127.0.0.1 >nul",
            "sleep 60 &\necho $! > child.pid\nwait",
        );
        let started = Instant::now();
        let cancelled = || started.elapsed() > Duration::from_millis(1500);
        let progress = Progress::new(&|_| {}, &cancelled);
        let office = Office::new(&program, &profile, progress);
        let result = office.convert(&input, None, &Export::new("pdf", "writer_pdf_Export"), &out);
        assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
        assert!(started.elapsed() < Duration::from_secs(20));
        let deadline = Instant::now() + Duration::from_secs(10);
        #[cfg(windows)]
        {
            // A process still running there would hold the folder it runs in.
            while fs::remove_dir_all(&out).is_err() {
                assert!(Instant::now() < deadline, "the child still runs");
                thread::sleep(Duration::from_millis(100));
            }
        }
        #[cfg(unix)]
        {
            let pid: libc::pid_t = fs::read_to_string(out.join("child.pid"))
                .unwrap()
                .trim()
                .parse()
                .unwrap();
            // SAFETY: signal 0 only asks whether the process exists.
            while unsafe { libc::kill(pid, 0) } == 0 {
                assert!(Instant::now() < deadline, "the child still runs");
                thread::sleep(Duration::from_millis(100));
            }
        }
        let _ = deadline;
    }

    #[test]
    fn office_soffice_a_missing_program_is_a_missing_codec() {
        let dir = tempfile::tempdir().unwrap();
        let profile = dir.path().join("profile");
        let office = Office::new(
            Path::new("/nowhere/kento-test/soffice"),
            &profile,
            Progress::none(),
        );
        let input = dir.path().join("in.txt");
        fs::write(&input, "x").unwrap();
        let result = office.convert(
            &input,
            None,
            &Export::new("pdf", "writer_pdf_Export"),
            dir.path(),
        );
        assert!(
            matches!(result, Err(Error::MissingCodec(Codec::LibreOffice))),
            "{result:?}"
        );
    }
}
