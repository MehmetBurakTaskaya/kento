// SPDX-License-Identifier: MIT
//! Running FFmpeg and ffprobe: one process per pass, arguments as an array (never a shell
//! string), no console window on Windows, progress from `-progress pipe:1`, and a kill on cancel.

use std::collections::VecDeque;
use std::ffi::{OsStr, OsString};
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use crate::{Codec, Error, Progress, Result};

/// How many of the last stderr lines a run keeps for its error message and for filters that
/// print their findings at the end (loudnorm's report is about 15 lines).
const TAIL: usize = 64;

/// How often a run looks at the cancel flag while FFmpeg is quiet.
const POLL: Duration = Duration::from_millis(100);

/// Messages that mean the input itself is the problem.
const INPUT_PROBLEMS: &[&str] = &[
    "Invalid data found when processing input",
    "Error opening input",
    "moov atom not found",
    "could not find codec parameters",
    "does not contain any stream",
    "Invalid NAL unit",
    "error reading header",
    // The file lacks the stream asked for (a picture from a sound file).
    "matches no streams",
];

/// A command for the tools, set up the same way every time.
pub(super) fn command(program: &Path) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: FFmpeg is a console program, and every run would flash a window.
        command.creation_flags(0x0800_0000);
    }
    command
}

pub(super) fn spawn_error(error: io::Error) -> Error {
    if error.kind() == io::ErrorKind::NotFound {
        Error::MissingCodec(Codec::Ffmpeg)
    } else {
        Error::Io(error)
    }
}

/// FFmpeg reads `name:` as a protocol and `-name` as an option. Kento's paths are absolute, so
/// they are neither; a relative one is anchored to be safe.
pub(super) fn media_path(path: &Path) -> OsString {
    if path.is_absolute() {
        path.as_os_str().to_owned()
    } else {
        PathBuf::from(".").join(path).into_os_string()
    }
}

/// Seconds as FFmpeg reads them.
pub(super) fn secs(seconds: f64) -> String {
    format!("{:.6}", seconds.max(0.0))
}

/// The arguments of one FFmpeg run, after the flags every run shares.
#[derive(Debug, Default, Clone)]
pub(super) struct Cmd {
    args: Vec<OsString>,
    /// Some filters (loudnorm, silencedetect) print their findings at the info level.
    info: bool,
    /// Stderr lines with this text are all kept, not only the last ones.
    keep: Option<&'static str>,
}

impl Cmd {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn arg(&mut self, arg: impl AsRef<OsStr>) -> &mut Self {
        self.args.push(arg.as_ref().to_owned());
        self
    }

    pub fn args<I, S>(&mut self, args: I) -> &mut Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.args
            .extend(args.into_iter().map(|arg| arg.as_ref().to_owned()));
        self
    }

    pub fn input(&mut self, path: &Path) -> &mut Self {
        self.arg("-i").arg(media_path(path))
    }

    /// Maps input stream `index` of the first input.
    pub fn map(&mut self, index: usize) -> &mut Self {
        self.arg("-map").arg(format!("0:{index}"))
    }

    /// The output file, always in an explicit format: Kento's file names end in `.kento-part`
    /// while they are written, so FFmpeg cannot guess it.
    pub fn output(&mut self, muxer: &str, path: &Path) -> &mut Self {
        self.arg("-f").arg(muxer).arg(media_path(path))
    }

    /// The output goes to standard output.
    pub fn piped(&mut self, muxer: &str) -> &mut Self {
        self.arg("-f").arg(muxer).arg("pipe:1")
    }

    /// Logs at the info level and keeps every stderr line containing `keep`.
    pub fn verbose(&mut self, keep: Option<&'static str>) -> &mut Self {
        self.info = true;
        self.keep = keep;
        self
    }

    fn command(&self, ffmpeg: &Path, progress: bool) -> Command {
        let mut command = command(ffmpeg);
        // -y: every output is a path Kento reserved for this job (or its scratch folder).
        command
            .args(["-hide_banner", "-nostdin", "-y", "-loglevel"])
            .arg(if self.info { "info" } else { "error" })
            .arg("-nostats");
        if progress {
            command.args(["-progress", "pipe:1"]);
        }
        command
            .args(&self.args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }
}

/// Where a run's position goes on the job's progress bar.
#[derive(Clone, Copy)]
pub(super) struct Watch<'a> {
    progress: &'a Progress<'a>,
    /// Seconds of media the run writes; 0 when unknown.
    span: f64,
    from: f32,
    to: f32,
}

impl<'a> Watch<'a> {
    pub fn new(progress: &'a Progress<'a>, span: f64) -> Self {
        Self {
            progress,
            span,
            from: 0.0,
            to: 1.0,
        }
    }

    /// The share from `a` to `b` (fractions of this watch) for a run of `span` seconds.
    pub fn part(self, a: f64, b: f64, span: f64) -> Self {
        let width = self.to - self.from;
        Self {
            progress: self.progress,
            span,
            from: self.from + width * a.clamp(0.0, 1.0) as f32,
            to: self.from + width * b.clamp(0.0, 1.0) as f32,
        }
    }

    fn at(&self, seconds: f64) {
        if self.span > 0.0 {
            let done = (seconds / self.span).clamp(0.0, 1.0) as f32;
            self.progress
                .report(self.from + (self.to - self.from) * done);
        }
    }

    fn done(&self) {
        self.progress.report(self.to);
    }
}

/// What FFmpeg said on stderr.
#[derive(Debug, Default)]
pub(super) struct Log {
    pub tail: VecDeque<String>,
    /// Every line with the `keep` text of the run.
    pub kept: Vec<String>,
}

impl Log {
    fn read(stderr: impl Read, keep: Option<&str>) -> Self {
        let mut log = Log::default();
        let mut reader = BufReader::new(stderr);
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text = String::from_utf8_lossy(&line).trim_end().to_owned();
            if text.is_empty() {
                continue;
            }
            if keep.is_some_and(|keep| text.contains(keep)) {
                log.kept.push(text.clone());
            }
            if log.tail.len() == TAIL {
                log.tail.pop_front();
            }
            log.tail.push_back(text);
        }
        log
    }

    /// The error for a failed run: `Unreadable` when FFmpeg blamed the input, otherwise
    /// `Other` with FFmpeg's last few lines (its messages name files, never their contents).
    pub fn failure(&self) -> Error {
        let last: Vec<&str> = self
            .tail
            .iter()
            .skip(self.tail.len().saturating_sub(4))
            .map(String::as_str)
            .collect();
        let detail = if last.is_empty() {
            "FFmpeg stopped without a message".to_owned()
        } else {
            last.join(" | ")
        };
        let input = self
            .tail
            .iter()
            .any(|line| INPUT_PROBLEMS.iter().any(|problem| line.contains(problem)));
        if input {
            Error::Unreadable(detail)
        } else {
            Error::Other(format!("FFmpeg failed: {detail}"))
        }
    }
}

/// Kills the process unless it has ended, so that no early return leaves FFmpeg running.
struct Reap(Child);

impl Drop for Reap {
    fn drop(&mut self) {
        if let Ok(None) = self.0.try_wait() {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

/// The position in `out_time_us=…` (or the older `out_time_ms=…`, which FFmpeg also writes in
/// microseconds), in seconds.
fn out_time(line: &str) -> Option<f64> {
    let value = line
        .strip_prefix("out_time_us=")
        .or_else(|| line.strip_prefix("out_time_ms="))?;
    value
        .trim()
        .parse::<f64>()
        .ok()
        .map(|us| (us / 1e6).max(0.0))
}

/// Runs FFmpeg to the end, reporting its position, and returns what it logged.
pub(super) fn run(ffmpeg: &Path, cmd: &Cmd, watch: Watch) -> Result<Log> {
    watch.progress.check()?;
    let mut child = Reap(cmd.command(ffmpeg, true).spawn().map_err(spawn_error)?);
    let stdout = child.0.stdout.take().expect("stdout is piped");
    let stderr = child.0.stderr.take().expect("stderr is piped");
    let keep = cmd.keep;
    let log = thread::spawn(move || Log::read(stderr, keep));
    let (sender, positions) = mpsc::channel();
    // Reads to the end whatever comes, so FFmpeg never waits on a full pipe.
    let reader = thread::spawn(move || {
        let mut stdout = BufReader::new(stdout);
        let mut line = Vec::new();
        loop {
            line.clear();
            match stdout.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if let Some(seconds) = out_time(String::from_utf8_lossy(&line).trim_end()) {
                let _ = sender.send(seconds);
            }
        }
    });

    let mut open = true;
    let status = loop {
        if open {
            match positions.recv_timeout(POLL) {
                Ok(seconds) => watch.at(seconds),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => open = false,
            }
        } else {
            thread::sleep(POLL / 2);
        }
        if watch.progress.is_cancelled() {
            let _ = child.0.kill();
            let _ = child.0.wait();
            let _ = reader.join();
            let _ = log.join();
            return Err(Error::Cancelled);
        }
        if let Some(status) = child.0.try_wait()? {
            break status;
        }
    };
    let _ = reader.join();
    let log = log.join().unwrap_or_default();
    if !status.success() {
        return Err(log.failure());
    }
    watch.done();
    Ok(log)
}

/// Runs FFmpeg with its output on stdout, handing each chunk to `sink`.
pub(super) fn pipe(
    ffmpeg: &Path,
    cmd: &Cmd,
    progress: &Progress,
    mut sink: impl FnMut(&[u8]) -> Result<()>,
) -> Result<Log> {
    progress.check()?;
    let mut child = Reap(cmd.command(ffmpeg, false).spawn().map_err(spawn_error)?);
    let mut stdout = child.0.stdout.take().expect("stdout is piped");
    let stderr: ChildStderr = child.0.stderr.take().expect("stderr is piped");
    let keep = cmd.keep;
    let log = thread::spawn(move || Log::read(stderr, keep));
    let mut buffer = vec![0; 64 * 1024];
    let outcome = loop {
        if progress.is_cancelled() {
            break Err(Error::Cancelled);
        }
        match stdout.read(&mut buffer) {
            Ok(0) => break Ok(()),
            Ok(n) => {
                if let Err(error) = sink(&buffer[..n]) {
                    break Err(error);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => break Err(error.into()),
        }
    };
    if outcome.is_err() {
        let _ = child.0.kill();
    }
    let status = child.0.wait()?;
    let log = log.join().unwrap_or_default();
    outcome?;
    if !status.success() {
        return Err(log.failure());
    }
    Ok(log)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_position() {
        assert_eq!(out_time("out_time_us=1500000"), Some(1.5));
        assert_eq!(out_time("out_time_ms=250000"), Some(0.25));
        assert_eq!(out_time("out_time_us=N/A"), None);
        assert_eq!(out_time("out_time_us=-23220"), Some(0.0));
        assert_eq!(out_time("progress=end"), None);
    }

    #[test]
    fn blames_the_input_only_when_ffmpeg_does() {
        let mut log = Log::default();
        log.tail
            .push_back("x.mp4: Invalid data found when processing input".into());
        assert!(matches!(log.failure(), Error::Unreadable(_)));
        let mut log = Log::default();
        log.tail.push_back("Unknown encoder 'nope'".into());
        let Error::Other(message) = log.failure() else {
            panic!("an encoder problem is not the input's fault");
        };
        assert!(message.contains("Unknown encoder"));
    }

    #[test]
    fn anchors_relative_paths() {
        let path = media_path(Path::new("-y.mp4"));
        assert!(Path::new(&path).starts_with("."));
    }
}
