// SPDX-License-Identifier: MIT
//! Running yt-dlp: one process per probe or download, in a scratch folder of its own, its
//! output read line by line as it comes, and a kill on cancel that ends the whole tree (yt-dlp
//! starts FFmpeg and Deno; the Windows build also unpacks itself into a child process).

use std::collections::VecDeque;
use std::ffi::OsString;
use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::args::plain;
use super::info::{quality, snap, whole, Direct};
use crate::process::{command, Reap};
use crate::{Codec, Error, Progress, Result, Tools, WebProblem};

/// How often a run looks at the cancel flag while yt-dlp is quiet.
const POLL: Duration = Duration::from_millis(100);

/// How many of yt-dlp's last lines a run keeps for its error message.
const TAIL: usize = 48;

/// How many error and warning lines a run keeps (a post's items may each print some).
const KEEP: usize = 64;

/// One run's corner of the job's scratch folder.
#[derive(Debug, Clone)]
pub(super) struct Dirs {
    /// The working folder.
    pub root: PathBuf,
    /// Finished files (yt-dlp's `home` path).
    pub out: PathBuf,
    /// Partial and intermediate files (yt-dlp's `temp` path).
    pub parts: PathBuf,
    /// The system temporary folder as yt-dlp and Deno see it: the Windows build unpacks itself
    /// there, and a run that is killed leaves that copy behind for the job's clean-up.
    pub tmp: PathBuf,
    /// Deno's cache.
    pub deno: PathBuf,
}

impl Dirs {
    /// A new, empty set of folders in `temp`.
    pub fn new(temp: &Path) -> io::Result<Dirs> {
        fs::create_dir_all(temp)?;
        let mut root = None;
        for n in 1..10_000u32 {
            let path = temp.join(format!("yt-dlp-{n}"));
            match fs::create_dir(&path) {
                Ok(()) => {
                    root = Some(path);
                    break;
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error),
            }
        }
        let root = root.ok_or_else(|| io::Error::other("no free scratch folder for yt-dlp"))?;
        let dirs = Dirs {
            out: root.join("out"),
            parts: root.join("parts"),
            tmp: root.join("tmp"),
            deno: root.join("deno"),
            root,
        };
        for dir in [&dirs.out, &dirs.parts, &dirs.tmp, &dirs.deno] {
            fs::create_dir(dir)?;
        }
        Ok(dirs)
    }
}

/// What yt-dlp printed besides Kento's own lines (it names files and addresses, never their
/// contents).
#[derive(Debug, Default)]
pub(super) struct Log {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub tail: VecDeque<String>,
}

impl Log {
    fn push(&mut self, line: &str) {
        let line = line.trim();
        if line.is_empty() || line.starts_with("kento-") {
            return;
        }
        if line.starts_with("ERROR:") && self.errors.len() < KEEP {
            self.errors.push(line.to_owned());
        } else if line.starts_with("WARNING:") && self.warnings.len() < KEEP {
            self.warnings.push(line.to_owned());
        }
        if self.tail.len() == TAIL {
            self.tail.pop_front();
        }
        self.tail.push_back(line.to_owned());
    }
}

/// What a line asks of the run.
pub(super) enum Flow {
    Go,
    /// Stop yt-dlp now and end with this error.
    Stop(Error),
}

pub(super) struct Job<'a> {
    pub program: &'a Path,
    pub args: &'a [OsString],
    pub dirs: &'a Dirs,
    pub progress: &'a Progress<'a>,
    /// Keep standard output whole (a probe's JSON) instead of reading it as lines.
    pub capture: bool,
    /// A run that takes longer is stopped as a site that does not answer.
    pub timeout: Option<Duration>,
}

#[derive(Debug)]
pub(super) struct Outcome {
    pub status: ExitStatus,
    /// Standard output, when captured.
    pub stdout: Vec<u8>,
    pub log: Log,
}

/// Runs yt-dlp to the end, handing every output line to `on_line`.
pub(super) fn run(job: &Job, mut on_line: impl FnMut(&str) -> Flow) -> Result<Outcome> {
    job.progress.check()?;
    let mut child = Reap::spawn_group(command_for(job)).map_err(spawn_error)?;
    let (sender, lines) = mpsc::channel();
    let (whole_sender, whole) = mpsc::channel();
    if let Some(stdout) = child.child.stdout.take() {
        if job.capture {
            thread::spawn(move || {
                let mut buffer = Vec::new();
                let _ = BufReader::new(stdout).read_to_end(&mut buffer);
                let _ = whole_sender.send(buffer);
            });
        } else {
            forward(stdout, sender.clone());
        }
    }
    if let Some(stderr) = child.child.stderr.take() {
        forward(stderr, sender);
    }
    let mut log = Log::default();
    let started = Instant::now();
    let status = loop {
        let taken = take(&lines, POLL, &mut log, &mut on_line);
        if let Some(error) = taken.stop {
            child.kill();
            return Err(error);
        }
        if job.progress.is_cancelled() {
            child.kill();
            return Err(Error::Cancelled);
        }
        if job.timeout.is_some_and(|limit| started.elapsed() > limit) {
            child.kill();
            return Err(Error::Web(WebProblem::Network));
        }
        if let Some(status) = child.child.try_wait()? {
            break status;
        }
    };
    // What is still in the pipes; a process yt-dlp left behind could hold them open, so this
    // waits only briefly (dropping `child` ends such a process).
    let grace = Instant::now() + Duration::from_secs(2);
    while Instant::now() < grace {
        let taken = take(&lines, Duration::from_millis(50), &mut log, &mut on_line);
        if let Some(error) = taken.stop {
            return Err(error);
        }
        if taken.closed {
            break;
        }
    }
    let stdout = if job.capture {
        whole
            .recv_timeout(Duration::from_secs(10))
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    drop(child);
    Ok(Outcome {
        status,
        stdout,
        log,
    })
}

/// The JSON document a probe printed: the whole output, or its last line that is one (a
/// build may print a notice first).
pub(super) fn json(stdout: &[u8]) -> Option<Value> {
    let text = String::from_utf8_lossy(stdout);
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    serde_json::from_str::<Value>(text)
        .ok()
        .or_else(|| {
            text.lines()
                .rev()
                .map(str::trim)
                .filter(|line| line.starts_with('{'))
                .find_map(|line| serde_json::from_str(line).ok())
        })
        .filter(Value::is_object)
}

/// yt-dlp with its arguments and an environment that keeps it to the job: its temporary files
/// and Deno's cache in the scratch folder, UTF-8 output, no colours, no update check by Deno
/// and no Python path from the user's setup (yt-dlp loads plugins found there).
fn command_for(job: &Job) -> Command {
    let dirs = job.dirs;
    let mut command = command(job.program);
    command
        .args(job.args)
        .current_dir(&dirs.root)
        .env("PYTHONIOENCODING", "utf-8")
        .env_remove("PYTHONPATH")
        .env_remove("PYTHONSTARTUP")
        .env("TMP", plain(&dirs.tmp))
        .env("TEMP", plain(&dirs.tmp))
        .env("TMPDIR", plain(&dirs.tmp))
        .env("DENO_DIR", plain(&dirs.deno))
        .env("DENO_NO_UPDATE_CHECK", "1")
        .env("DENO_NO_PROMPT", "1")
        .env("NO_COLOR", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

fn spawn_error(error: io::Error) -> Error {
    if error.kind() == io::ErrorKind::NotFound {
        Error::MissingCodec(Codec::YtDlp)
    } else {
        Error::Io(error)
    }
}

/// Sends every line of a pipe until it closes.
fn forward(pipe: impl Read + Send + 'static, sender: Sender<String>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(pipe);
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text = String::from_utf8_lossy(&line)
                .trim_end_matches(['\r', '\n'])
                .to_owned();
            if sender.send(text).is_err() {
                break;
            }
        }
    });
}

struct Taken {
    stop: Option<Error>,
    /// Every pipe has closed.
    closed: bool,
}

/// Handles the lines that arrive within `wait`.
fn take(
    lines: &Receiver<String>,
    wait: Duration,
    log: &mut Log,
    on_line: &mut impl FnMut(&str) -> Flow,
) -> Taken {
    let mut wait = wait;
    loop {
        match lines.recv_timeout(wait) {
            Ok(line) => {
                log.push(&line);
                if let Flow::Stop(error) = on_line(&line) {
                    return Taken {
                        stop: Some(error),
                        closed: false,
                    };
                }
                wait = Duration::ZERO;
            }
            Err(RecvTimeoutError::Timeout) => {
                return Taken {
                    stop: None,
                    closed: false,
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                if wait > Duration::ZERO {
                    thread::sleep(wait);
                }
                return Taken {
                    stop: None,
                    closed: true,
                };
            }
        }
    }
}

/// The quality of a plain media file on a web server, read by ffprobe from the file's header.
/// Only web protocols are allowed, so an address from a page can never make it read a local
/// file. None when ffprobe is missing, fails or takes too long.
pub(super) fn direct_height(tools: &Tools, direct: &Direct, progress: &Progress) -> Option<u32> {
    let ffprobe = tools.ffprobe.as_deref()?;
    let mut probe = command(ffprobe);
    probe.args([
        "-v",
        "error",
        "-hide_banner",
        "-protocol_whitelist",
        "http,https,tcp,tls,httpproxy",
        "-rw_timeout",
        "15000000",
    ]);
    if let Some(agent) = &direct.user_agent {
        probe.arg("-user_agent").arg(agent);
    }
    if let Some(referer) = &direct.referer {
        probe.arg("-referer").arg(referer);
    }
    probe
        .args([
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            "-i",
        ])
        .arg(&direct.url)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let output = quick(probe, progress, Duration::from_secs(30))?;
    let report: Value = serde_json::from_slice(&output).ok()?;
    let stream = report.get("streams")?.as_array()?.first()?;
    quality(whole(stream, "width"), whole(stream, "height")).map(snap)
}

/// A short run whose standard output is wanted whole; None on failure, cancel or timeout.
fn quick(command: Command, progress: &Progress, limit: Duration) -> Option<Vec<u8>> {
    let mut child = Reap::spawn(command).ok()?;
    let stdout = child.child.stdout.take()?;
    let (sender, output) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = BufReader::new(stdout).read_to_end(&mut buffer);
        let _ = sender.send(buffer);
    });
    let started = Instant::now();
    loop {
        match output.recv_timeout(POLL) {
            Ok(buffer) => {
                let status = child.child.wait().ok()?;
                return status.success().then_some(buffer);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return None,
        }
        if progress.is_cancelled() || started.elapsed() > limit {
            child.kill();
            return None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_run_gets_fresh_folders() {
        let dir = tempfile::tempdir().unwrap();
        let temp = dir.path().join("İş ğüşıöç");
        let first = Dirs::new(&temp).unwrap();
        let second = Dirs::new(&temp).unwrap();
        assert_ne!(first.root, second.root);
        for dirs in [&first, &second] {
            for dir in [&dirs.out, &dirs.parts, &dirs.tmp, &dirs.deno] {
                assert!(dir.is_dir());
                assert!(dir.starts_with(&temp));
            }
        }
    }

    #[test]
    fn the_log_keeps_errors_warnings_and_the_last_lines() {
        let mut log = Log::default();
        log.push("kento-progress\tdownloading\t1\t2");
        log.push("  ");
        log.push("WARNING: [generic] Falling back on generic information extractor");
        log.push("ERROR: Unsupported URL: https://example.org/");
        for n in 0..100 {
            log.push(&format!("line {n}"));
        }
        assert_eq!(log.errors, ["ERROR: Unsupported URL: https://example.org/"]);
        assert_eq!(log.warnings.len(), 1);
        assert_eq!(log.tail.len(), TAIL);
        assert_eq!(log.tail.back().map(String::as_str), Some("line 99"));
        assert!(!log.tail.iter().any(|line| line.starts_with("kento-")));
    }

    #[test]
    fn reads_the_json_a_probe_printed() {
        assert_eq!(json(b""), None);
        assert_eq!(json(b"not json"), None);
        assert_eq!(json(b"[1, 2]"), None);
        let value = json(b"{\"title\": \"\\u00c7a\\u011fr\\u0131\"}\r\n").unwrap();
        assert_eq!(value["title"], "Çağrı");
        let value = json(b"Deprecated feature notice\n{\"id\": \"a\"}\n").unwrap();
        assert_eq!(value["id"], "a");
    }
}
