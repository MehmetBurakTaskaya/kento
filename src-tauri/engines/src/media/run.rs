// SPDX-License-Identifier: MIT
//! Running FFmpeg and ffprobe: one process per pass, arguments as an array (never a shell
//! string), no console window on Windows, progress from `-progress pipe:1`, and a kill on cancel
//! that also ends whatever the program started (package-manager shims start the real FFmpeg).

use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::{OsStr, OsString};
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, OnceLock};
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
            .args(own_encoders(ffmpeg, &self.args))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }
}

/// Builds without libvorbis or libopus (Homebrew's FFmpeg has no libvorbis) still carry FFmpeg's
/// own encoders for those formats, marked experimental. The native Vorbis encoder writes stereo
/// only, so it gets two channels.
fn own_encoders(ffmpeg: &Path, args: &[OsString]) -> Vec<OsString> {
    let wanted = ["libvorbis", "libopus"];
    if !args.iter().any(|arg| wanted.iter().any(|name| arg == name)) {
        return args.to_vec();
    }
    let available = encoders(ffmpeg);
    if available.is_empty() {
        return args.to_vec();
    }
    swap_encoders(args, &available)
}

fn swap_encoders(args: &[OsString], available: &HashSet<String>) -> Vec<OsString> {
    let wanted = ["libvorbis", "libopus"];
    let mut out = Vec::with_capacity(args.len() + 4);
    let mut pairs = args.iter().peekable();
    while let Some(arg) = pairs.next() {
        out.push(arg.clone());
        let Some(stream) = arg.to_str().and_then(|a| a.strip_prefix("-c:a")) else {
            continue;
        };
        let Some(encoder) = pairs.next_if(|next| wanted.iter().any(|name| *next == name)) else {
            continue;
        };
        let encoder = encoder.to_string_lossy();
        if available.contains(encoder.as_ref()) {
            out.push(encoder.as_ref().into());
            continue;
        }
        let native = encoder.trim_start_matches("lib");
        // Output options, so they belong to the same output as the encoder they follow.
        out.extend([native.into(), "-strict".into(), "experimental".into()]);
        if native == "vorbis" {
            out.extend([format!("-ac:a{stream}").into(), "2".into()]);
        }
    }
    out
}

/// The encoders a build has, asked once per program. Empty when the list cannot be read, and then
/// the arguments are left as they are.
fn encoders(ffmpeg: &Path) -> Arc<HashSet<String>> {
    static KNOWN: OnceLock<Mutex<HashMap<PathBuf, Arc<HashSet<String>>>>> = OnceLock::new();
    let known = KNOWN.get_or_init(Mutex::default);
    if let Some(list) = known.lock().ok().and_then(|map| map.get(ffmpeg).cloned()) {
        return list;
    }
    let list = Arc::new(
        command(ffmpeg)
            .args(["-hide_banner", "-encoders"])
            .stderr(Stdio::null())
            .output()
            .map(|output| encoder_names(&String::from_utf8_lossy(&output.stdout)))
            .unwrap_or_default(),
    );
    if let Ok(mut map) = known.lock() {
        map.insert(ffmpeg.to_path_buf(), list.clone());
    }
    list
}

/// The names in `-encoders` output: after the legend, each line is " A....D name  description".
fn encoder_names(text: &str) -> HashSet<String> {
    text.lines()
        .skip_while(|line| !line.trim_start().starts_with("---"))
        .skip(1)
        .filter_map(|line| line.split_whitespace().nth(1).map(str::to_owned))
        .collect()
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

/// Kills the process unless it has ended, so that no early return leaves FFmpeg running. On
/// Windows the process runs in a job object, and the kill ends everything in it.
struct Reap {
    child: Child,
    #[cfg(windows)]
    tree: Option<tree::Tree>,
}

impl Reap {
    fn spawn(mut command: Command) -> Result<Reap> {
        let child = command.spawn().map_err(spawn_error)?;
        Ok(Reap {
            #[cfg(windows)]
            tree: tree::Tree::new(&child),
            child,
        })
    }

    fn kill(&mut self) {
        #[cfg(windows)]
        if let Some(tree) = &self.tree {
            tree.kill();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Reap {
    fn drop(&mut self) {
        if let Ok(None) = self.child.try_wait() {
            self.kill();
        }
    }
}

#[cfg(windows)]
mod tree {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// A job object holding one FFmpeg process and anything it starts. Closing it ends them all,
    /// so a run can never outlive Kento either.
    pub struct Tree(HANDLE);

    // The handle is only used to end the processes; the job object itself is thread-safe.
    unsafe impl Send for Tree {}

    impl Tree {
        /// None when the process cannot be put in a job; the kill then reaches only the process.
        pub fn new(child: &Child) -> Option<Tree> {
            // SAFETY: plain Win32 calls on a handle this function owns, with a correctly sized
            // structure; the child's handle stays valid while `child` lives.
            unsafe {
                let job = Tree(CreateJobObjectW(None, PCWSTR::null()).ok()?);
                let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&raw const limits).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
                .ok()?;
                AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())).ok()?;
                Some(job)
            }
        }

        pub fn kill(&self) {
            // SAFETY: the handle is open until drop.
            unsafe {
                let _ = TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            // SAFETY: closed once, here.
            unsafe {
                let _ = CloseHandle(self.0);
            }
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
    let mut child = Reap::spawn(cmd.command(ffmpeg, true))?;
    let stdout = child.child.stdout.take().expect("stdout is piped");
    let stderr = child.child.stderr.take().expect("stderr is piped");
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
            child.kill();
            let _ = reader.join();
            let _ = log.join();
            return Err(Error::Cancelled);
        }
        if let Some(status) = child.child.try_wait()? {
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
    let mut child = Reap::spawn(cmd.command(ffmpeg, false))?;
    let mut stdout = child.child.stdout.take().expect("stdout is piped");
    let stderr: ChildStderr = child.child.stderr.take().expect("stderr is piped");
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
        child.kill();
    }
    let status = child.child.wait()?;
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
    fn falls_back_to_ffmpegs_own_encoders() {
        let listing = " A....D aac                  AAC (Advanced Audio Coding)\n\
                       A....D libopus              libopus Opus\n";
        assert!(encoder_names(listing).is_empty(), "no legend, no names");
        let listing = format!("Encoders:\n V..... = Video\n ------\n{listing}");
        let found = encoder_names(&listing);
        assert!(found.contains("aac") && found.contains("libopus"));
        let names =
            |list: &[&str]| -> HashSet<String> { list.iter().map(|s| s.to_string()).collect() };

        let args = |list: &[&str]| -> Vec<OsString> { list.iter().map(OsString::from).collect() };
        let input = args(&[
            "-i",
            "in.wav",
            "-c:a:0",
            "libvorbis",
            "-q:a:0",
            "5",
            "out.ogg",
        ]);
        assert_eq!(swap_encoders(&input, &names(&["libvorbis"])), input);
        assert_eq!(
            swap_encoders(&input, &names(&["aac"])),
            args(&[
                "-i",
                "in.wav",
                "-c:a:0",
                "vorbis",
                "-strict",
                "experimental",
                "-ac:a:0",
                "2",
                "-q:a:0",
                "5",
                "out.ogg",
            ])
        );
        let opus = args(&["-i", "in.wav", "-c:a", "libopus", "out.opus"]);
        assert_eq!(
            swap_encoders(&opus, &names(&["aac"])),
            args(&[
                "-i",
                "in.wav",
                "-c:a",
                "opus",
                "-strict",
                "experimental",
                "out.opus"
            ])
        );
    }

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
