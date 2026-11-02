// SPDX-License-Identifier: MIT
//! A LibreOffice kept running between office jobs. Starting LibreOffice takes seconds; a
//! document handed to one that already runs takes a fraction of one. The first job (or the
//! warm-up) starts it with Kento's profile, listening on a named pipe of this process (`--accept`
//! with a UNO pipe, never a network socket), and every job gives it its document through Kento's
//! client (`client.rs`).
//!
//! There is one per process. It ends after `IDLE` without a job; when Kento quits (`shutdown`; on
//! Windows its job object also ends it with Kento); when a job is cancelled or runs too long; when
//! it crashes (a crash report in the profile, its process ending, the connection breaking); and
//! when someone else waits for the profile (`profile::wanted`). The next job starts a new one.
//!
//! While it runs it holds the profile's lock file and notes its pipe there. A later holder that
//! finds a note left (Kento ended without tidying up, which on macOS leaves LibreOffice running)
//! first asks that LibreOffice to end: it would take every later start on the profile as its own.
//!
//! When it cannot be used (no pyuno in LibreOffice's Python, a LibreOffice that never opens its
//! pipe) the job runs LibreOffice for itself, as `soffice.rs` always did.

use std::collections::{BTreeSet, HashSet};
use std::ffi::OsString;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError, TryLockError, Weak};
use std::thread;
use std::time::{Duration, Instant};

use super::client::{self, Answer};
use super::profile;
use super::soffice::{
    crash_reports, file_url, forward, program, spawn_error, written, Export, Log, CRASH_LOOK,
    FLAGS, POLL, TIMEOUT,
};
use crate::process::{command, Reap};
use crate::{Codec, Error, Progress};

/// How long LibreOffice waits for the next job.
const IDLE: Duration = Duration::from_secs(5 * 60);

/// How often the idle LibreOffice is looked at.
const WATCH: Duration = Duration::from_secs(1);

/// How long the first request waits for a new LibreOffice to open its pipe: a start with a new
/// profile takes seconds, more on a slow computer.
const START_WAIT: Duration = Duration::from_secs(120);

/// How long a later request waits for the pipe, which is open by then.
const READY_WAIT: Duration = Duration::from_secs(10);

/// The longest the request to a LibreOffice left behind may take.
const ORPHAN_LIMIT: Duration = Duration::from_secs(10);

/// What the client says once it is connected.
const CONNECTED: &str = "kento-office: connected:";

/// Numbers the pipes of this process, so a new LibreOffice never meets the name of one ending.
static PIPES: AtomicU64 = AtomicU64::new(1);

/// The keeper the engines use.
pub(super) fn global() -> Arc<Keeper> {
    static GLOBAL: LazyLock<Arc<Keeper>> = LazyLock::new(|| Keeper::new(IDLE, WATCH));
    GLOBAL.clone()
}

/// One conversion for the kept LibreOffice.
pub(super) struct Request<'a> {
    pub(super) soffice: &'a Path,
    pub(super) profile: &'a Path,
    /// LibreOffice's own Python.
    pub(super) python: &'a Path,
    /// A folder of the job's own for the client script.
    pub(super) scratch: &'a Path,
    pub(super) progress: &'a Progress<'a>,
    pub(super) input: &'a Path,
    pub(super) infilter: Option<&'a str>,
    pub(super) export: &'a Export,
    pub(super) outdir: &'a Path,
}

/// Why a conversion did not come back from the kept LibreOffice.
#[derive(Debug)]
pub(super) enum Miss {
    /// It could not be used this time: the job runs LibreOffice for itself.
    Fallback(String),
    /// The job failed.
    Failed(Error),
}

impl From<Error> for Miss {
    fn from(error: Error) -> Self {
        Miss::Failed(error)
    }
}

pub(super) struct Keeper {
    state: Mutex<State>,
    /// The running LibreOffice's process, reachable while a job holds `state` (for `shutdown`).
    process: Mutex<Option<Arc<Mutex<Reap>>>>,
    /// Pythons that cannot run the client: their jobs run LibreOffice for themselves.
    unusable: Mutex<HashSet<PathBuf>>,
    /// Kento quits: no LibreOffice starts any more.
    closed: AtomicBool,
    idle: Duration,
    watch: Duration,
}

#[derive(Default)]
struct State {
    instance: Option<Instance>,
    /// A watcher thread runs.
    watcher: bool,
}

struct Instance {
    soffice: PathBuf,
    profile: PathBuf,
    pipe: String,
    process: Arc<Mutex<Reap>>,
    /// The process has ended and was waited for.
    exited: bool,
    /// The profile's lock file, held while it runs.
    held: File,
    /// The crash reports from before it started.
    reports: BTreeSet<OsString>,
    /// A client has connected to it.
    ready: bool,
    /// When its last job ended.
    last: Instant,
}

impl Instance {
    fn ended(&mut self) -> bool {
        if !self.exited {
            let mut process = lock(&self.process);
            self.exited = !matches!(process.child.try_wait(), Ok(None));
        }
        self.exited
    }

    fn crashed(&self) -> bool {
        crash_reports(&self.profile)
            .difference(&self.reports)
            .next()
            .is_some()
    }
}

/// How one request went.
enum Outcome {
    Answer(Answer),
    /// LibreOffice ended or left a crash report while it worked.
    Crashed,
    Cancelled,
    TimedOut,
}

impl Keeper {
    pub(super) fn new(idle: Duration, watch: Duration) -> Arc<Keeper> {
        Arc::new(Keeper {
            state: Mutex::default(),
            process: Mutex::default(),
            unusable: Mutex::default(),
            closed: AtomicBool::new(false),
            idle,
            watch,
        })
    }

    /// Converts through the kept LibreOffice, starting one when none runs. A try that wrote
    /// nothing gets one more with a new LibreOffice; a document LibreOffice cannot load does not.
    pub(super) fn convert(self: &Arc<Self>, request: &Request) -> Result<PathBuf, Miss> {
        if self.closed.load(Ordering::Acquire) {
            return Err(Miss::Failed(Error::Cancelled));
        }
        if lock(&self.unusable).contains(request.python) {
            return Err(Miss::Fallback(
                "LibreOffice's Python cannot run Kento's client".into(),
            ));
        }
        let mut state = self.wait_for_state(request.progress)?;
        let script = client::write_script(request.scratch).map_err(Error::from)?;
        let stem = request
            .input
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        let output = request
            .outdir
            .join(format!("{stem}.{}", request.export.extension));
        let mut crashes = 0;
        let mut failure = None;
        for _ in 0..2 {
            request.progress.check()?;
            if self.closed.load(Ordering::Acquire) {
                return Err(Miss::Failed(Error::Cancelled));
            }
            self.ensure(&mut state, request, &script)?;
            let Some(instance) = state.instance.as_mut() else {
                return Err(Miss::Fallback("LibreOffice did not start".into()));
            };
            let wait = if instance.ready {
                READY_WAIT
            } else {
                START_WAIT
            };
            let args = client::convert_arguments(
                &script,
                &instance.pipe,
                wait,
                request.input,
                &output,
                request.infilter,
                request.export,
            );
            let (outcome, connected) = ask(instance, request, &script, &args, TIMEOUT);
            let was_ready = instance.ready;
            instance.ready |= connected;
            match outcome {
                Outcome::Answer(Answer::Done) => {
                    instance.last = Instant::now();
                    if let Some(path) = written(request.outdir, &stem, request.export.extension) {
                        return Ok(path);
                    }
                    failure = Some(Error::Other("LibreOffice wrote nothing".into()));
                    self.end(&mut state, "a conversion wrote nothing");
                }
                Outcome::Answer(Answer::Unreadable(message)) => {
                    instance.last = Instant::now();
                    return Err(Miss::Failed(Error::Unreadable(format!(
                        "LibreOffice: {message}"
                    ))));
                }
                Outcome::Answer(Answer::Unusable(message)) => {
                    lock(&self.unusable).insert(request.python.to_path_buf());
                    self.end(&mut state, "its Python cannot run Kento's client");
                    return Err(Miss::Fallback(format!("LibreOffice's Python: {message}")));
                }
                // A LibreOffice that never opened its pipe, or ended before it did, did not start.
                Outcome::Answer(Answer::NoConnection(_)) | Outcome::Crashed
                    if !was_ready && !connected =>
                {
                    self.end(&mut state, "it did not open its pipe");
                    return Err(Miss::Fallback("LibreOffice did not open its pipe".into()));
                }
                Outcome::Answer(Answer::NoConnection(_) | Answer::Broken(_)) | Outcome::Crashed => {
                    tracing::warn!("the kept LibreOffice crashed");
                    crashes += 1;
                    self.end(&mut state, "it crashed");
                }
                Outcome::Answer(Answer::Failed(message)) => {
                    failure = Some(Error::Other(format!(
                        "LibreOffice wrote nothing: {message}"
                    )));
                    self.end(&mut state, "a conversion failed");
                }
                Outcome::Cancelled => {
                    self.end(&mut state, "its job was cancelled");
                    return Err(Miss::Failed(Error::Cancelled));
                }
                Outcome::TimedOut => {
                    self.end(&mut state, "a conversion took too long");
                    return Err(Miss::Failed(Error::Other(format!(
                        "LibreOffice did not finish within {} minutes",
                        TIMEOUT.as_secs() / 60
                    ))));
                }
            }
        }
        Err(Miss::Failed(if crashes == 2 {
            tracing::warn!("LibreOffice crashed twice on the same document");
            Error::Crashed(Codec::LibreOffice)
        } else {
            failure.unwrap_or_else(|| Error::Other("LibreOffice stopped while converting".into()))
        }))
    }

    /// Whether a LibreOffice is kept now.
    #[cfg(test)]
    pub(super) fn running(&self) -> bool {
        lock(&self.process).is_some()
    }

    /// Ends the kept LibreOffice unless a job is using it; true when none runs afterwards.
    pub(super) fn stop_idle(&self, why: &str) -> bool {
        match self.state.try_lock() {
            Ok(mut state) => self.end(&mut state, why),
            Err(TryLockError::Poisoned(poisoned)) => self.end(&mut poisoned.into_inner(), why),
            Err(TryLockError::WouldBlock) => return false,
        }
        true
    }

    /// The pipe the kept LibreOffice listens on.
    #[cfg(test)]
    pub(super) fn pipe(&self) -> Option<String> {
        let state = lock(&self.state);
        state
            .instance
            .as_ref()
            .map(|instance| instance.pipe.clone())
    }

    /// Ends the kept LibreOffice, after the job using it.
    #[cfg(test)]
    pub(super) fn stop(&self, why: &str) {
        let mut state = lock(&self.state);
        self.end(&mut state, why);
    }

    /// Ends the kept LibreOffice at once, even under a running job, and starts none any more.
    pub(super) fn shutdown(&self) {
        self.closed.store(true, Ordering::Release);
        let process = lock(&self.process).take();
        if let Some(process) = process {
            let mut process = lock(&process);
            if matches!(process.child.try_wait(), Ok(None)) {
                process.kill();
            }
        }
        self.stop_idle("Kento quits");
    }

    /// Waits for the state, which a job or the warm-up may hold; a cancelled job stops waiting.
    fn wait_for_state(&self, progress: &Progress) -> Result<MutexGuard<'_, State>, Error> {
        loop {
            match self.state.try_lock() {
                Ok(state) => return Ok(state),
                Err(TryLockError::Poisoned(poisoned)) => return Ok(poisoned.into_inner()),
                Err(TryLockError::WouldBlock) => {
                    progress.check()?;
                    thread::sleep(Duration::from_millis(50));
                }
            }
        }
    }

    /// A LibreOffice for this request: the one running when it fits, otherwise a new one.
    fn ensure(
        self: &Arc<Self>,
        state: &mut State,
        request: &Request,
        script: &Path,
    ) -> Result<(), Miss> {
        if let Some(instance) = state.instance.as_mut() {
            let why = if instance.soffice != request.soffice || instance.profile != request.profile
            {
                "another LibreOffice or profile is asked for"
            } else if instance.ended() {
                "it ended"
            } else if instance.crashed() {
                "it crashed"
            } else {
                return Ok(());
            };
            self.end(state, why);
        }
        self.start(state, request, script)
    }

    fn start(
        self: &Arc<Self>,
        state: &mut State,
        request: &Request,
        script: &Path,
    ) -> Result<(), Miss> {
        let mut held = profile::hold(request.profile, request.progress)?;
        if let Some(pipe) = profile::noted(&mut held) {
            stop_orphan(request, script, &pipe);
        }
        profile::prepare(request.profile)?;
        let pipe = format!(
            "kento-{}-office-{}",
            std::process::id(),
            PIPES.fetch_add(1, Ordering::Relaxed)
        );
        let mut command = command(&program(request.soffice));
        command
            .args(instance_arguments(request.profile, &pipe))
            .current_dir(request.profile)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let reports = crash_reports(request.profile);
        let process = Arc::new(Mutex::new(Reap::spawn_group(command).map_err(spawn_error)?));
        if let Err(error) = profile::note(&mut held, Some(&pipe)) {
            tracing::warn!("the profile's lock file does not note the pipe: {error}");
        }
        tracing::info!("LibreOffice starts and stays for office jobs");
        *lock(&self.process) = Some(process.clone());
        state.instance = Some(Instance {
            soffice: request.soffice.to_path_buf(),
            profile: request.profile.to_path_buf(),
            pipe,
            process,
            exited: false,
            held,
            reports,
            ready: false,
            last: Instant::now(),
        });
        if !state.watcher {
            let keeper = Arc::downgrade(self);
            let every = self.watch;
            let spawned = thread::Builder::new()
                .name("office-keeper".into())
                .spawn(move || watch(keeper, every));
            match spawned {
                Ok(_) => state.watcher = true,
                Err(error) => tracing::warn!("the kept LibreOffice is not watched: {error}"),
            }
        }
        Ok(())
    }

    fn end(&self, state: &mut State, why: &str) {
        let Some(mut instance) = state.instance.take() else {
            return;
        };
        tracing::info!("the LibreOffice kept for office jobs ends: {why}");
        // A process already waited for is not signalled again (on Unix its group id may be
        // another's by now); dropping it ends what is left of it on Windows.
        if !instance.ended() {
            lock(&instance.process).kill();
        }
        let mut current = lock(&self.process);
        if current
            .as_ref()
            .is_some_and(|process| Arc::ptr_eq(process, &instance.process))
        {
            *current = None;
        }
        if let Err(error) = profile::note(&mut instance.held, None) {
            tracing::warn!("the profile's lock file keeps an old pipe: {error}");
        }
    }

    /// One look at the kept LibreOffice while no job uses it; false once none is left to watch.
    fn look(&self) -> bool {
        let mut state = match self.state.try_lock() {
            Ok(state) => state,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return true,
        };
        let Some(instance) = state.instance.as_mut() else {
            state.watcher = false;
            return false;
        };
        let why = if instance.ended() {
            "it ended"
        } else if instance.crashed() {
            "it crashed"
        } else if instance.last.elapsed() >= self.idle {
            "no office job came for a while"
        } else if profile::wanted(&instance.profile) {
            "another LibreOffice waits for its profile"
        } else {
            return true;
        };
        self.end(&mut state, why);
        state.watcher = false;
        false
    }
}

impl Drop for Keeper {
    fn drop(&mut self) {
        let mut state = std::mem::take(&mut *lock(&self.state));
        self.end(&mut state, "its keeper is gone");
    }
}

fn watch(keeper: Weak<Keeper>, every: Duration) {
    loop {
        thread::sleep(every);
        let Some(keeper) = keeper.upgrade() else {
            return;
        };
        if !keeper.look() {
            return;
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// LibreOffice listening for Kento's client: the same profile and flags as a conversion, with a
/// UNO pipe instead of a document (LibreOffice Help, "Starting LibreOffice Software With
/// Parameters", `--accept`).
pub(super) fn instance_arguments(profile: &Path, pipe: &str) -> Vec<OsString> {
    let mut args: Vec<OsString> =
        vec![format!("-env:UserInstallation={}", file_url(profile)).into()];
    args.extend(FLAGS.iter().map(OsString::from));
    args.push(format!("--accept=pipe,name={pipe};urp;").into());
    args
}

/// Runs the client for one request while watching the job and LibreOffice; also tells whether the
/// client got connected.
fn ask(
    instance: &mut Instance,
    request: &Request,
    script: &Path,
    args: &[OsString],
    limit: Duration,
) -> (Outcome, bool) {
    let mut child = match Reap::spawn_group(client::command(request.python, script, args)) {
        Ok(child) => child,
        Err(error) => return (Outcome::Answer(Answer::Unusable(error.to_string())), false),
    };
    let (sender, lines) = mpsc::channel();
    if let Some(stderr) = child.child.stderr.take() {
        forward(stderr, sender);
    }
    let mut log = Log::default();
    let mut connected = false;
    let started = Instant::now();
    let mut looked = Instant::now();
    let outcome = loop {
        log.take(&lines, POLL);
        connected |= log.tail.iter().any(|line| line.starts_with(CONNECTED));
        match child.child.try_wait() {
            Ok(Some(status)) => {
                // What is still in the pipe.
                let grace = Instant::now() + Duration::from_secs(1);
                while Instant::now() < grace && !log.closed {
                    log.take(&lines, Duration::from_millis(20));
                }
                connected |= log.tail.iter().any(|line| line.starts_with(CONNECTED));
                break Outcome::Answer(client::answer(status.code(), &log));
            }
            Ok(None) => {}
            Err(error) => {
                child.kill();
                break Outcome::Answer(Answer::Failed(error.to_string()));
            }
        }
        if request.progress.is_cancelled() {
            child.kill();
            break Outcome::Cancelled;
        }
        if instance.ended() {
            child.kill();
            break Outcome::Crashed;
        }
        // A crash leaves a report in the profile, and LibreOffice may then never end.
        if looked.elapsed() >= CRASH_LOOK {
            looked = Instant::now();
            if instance.crashed() {
                child.kill();
                break Outcome::Crashed;
            }
        }
        if started.elapsed() > limit {
            child.kill();
            break Outcome::TimedOut;
        }
    };
    (outcome, connected)
}

/// Asks the LibreOffice an earlier holder of the profile kept, and left running, to end. Nothing
/// happens when none listens on its pipe any more.
fn stop_orphan(request: &Request, script: &Path, pipe: &str) {
    if !is_kento_pipe(pipe) {
        return;
    }
    let args = client::stop_arguments(script, pipe, Duration::ZERO);
    let Ok(mut child) = Reap::spawn_group(client::command(request.python, script, &args)) else {
        return;
    };
    let deadline = Instant::now() + ORPHAN_LIMIT;
    loop {
        match child.child.try_wait() {
            Ok(Some(status)) => {
                if status.code() == Some(client::code::OK) {
                    tracing::info!("a LibreOffice an earlier Kento left running was ended");
                    // It lets go of the profile as it ends.
                    thread::sleep(Duration::from_secs(1));
                }
                return;
            }
            Ok(None) if Instant::now() < deadline && !request.progress.is_cancelled() => {
                thread::sleep(POLL);
            }
            _ => {
                child.kill();
                return;
            }
        }
    }
}

/// `kento-<process>-office-<n>`, the only names Kento gives its pipes.
fn is_kento_pipe(name: &str) -> bool {
    let number = |part: Option<&str>| {
        part.is_some_and(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
    };
    let mut parts = name.split('-');
    parts.next() == Some("kento")
        && number(parts.next())
        && parts.next() == Some("office")
        && number(parts.next())
        && parts.next().is_none()
}

#[cfg(test)]
mod tests {
    //! The instance's life with stand-ins for LibreOffice and its Python: shell scripts (cmd on
    //! Windows, sh elsewhere). The LibreOffice stand-in notes each start in its folder, the profile,
    //! and then waits as a listening LibreOffice would; the Python stand-in plays one answer of the
    //! client, noting its arguments in `runs.txt`.

    use super::*;
    use std::fs;

    fn script(dir: &Path, name: &str, windows: &str, unix: &str) -> PathBuf {
        if cfg!(windows) {
            let path = dir.join(format!("{name}.cmd"));
            let body = format!("@echo off\r\n{}\r\n", windows.replace('\n', "\r\n"));
            fs::write(&path, body).unwrap();
            path
        } else {
            let path = dir.join(name);
            fs::write(&path, format!("#!/bin/sh\n{unix}\n")).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            }
            path
        }
    }

    /// A job's folders side by side (the clients run in `client` and write to `../out`), the
    /// profile beside them, and the LibreOffice stand-in.
    struct Bench {
        _dir: tempfile::TempDir,
        root: PathBuf,
        profile: PathBuf,
        soffice: PathBuf,
        input: PathBuf,
        out: PathBuf,
        client: PathBuf,
    }

    impl Bench {
        fn new() -> Bench {
            Bench::with_office(
                "echo start>> starts.txt\nping -n 600 127.0.0.1 >nul",
                "echo start >> starts.txt\necho $$ > soffice.pid\nexec sleep 600",
            )
        }

        fn with_office(windows: &str, unix: &str) -> Bench {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().to_path_buf();
            let input = root.join("in").join("in.docx");
            fs::create_dir_all(input.parent().unwrap()).unwrap();
            fs::write(&input, b"PK").unwrap();
            let out = root.join("out");
            fs::create_dir_all(&out).unwrap();
            Bench {
                soffice: script(&root, "soffice", windows, unix),
                profile: root.join("profile"),
                client: root.join("client"),
                input,
                out,
                root,
                _dir: dir,
            }
        }

        /// A Python stand-in that notes its arguments, then runs `windows` or `unix`.
        fn python(&self, name: &str, windows: &str, unix: &str) -> PathBuf {
            script(
                &self.root,
                name,
                &format!(">>..\\runs.txt echo %*\n{windows}"),
                &format!("echo \"$*\" >> ../runs.txt\n{unix}"),
            )
        }

        /// One that converts: it connects and writes the PDF.
        fn converting(&self) -> PathBuf {
            self.python(
                "converts",
                "echo kento-office: connected: p 1>&2\nif \"%4\"==\"convert\" echo %%PDF-1.7> ..\\out\\in.pdf",
                "echo 'kento-office: connected: p' >&2\nif [ \"$4\" = convert ]; then printf '%%PDF-1.7' > ../out/in.pdf; fi",
            )
        }

        fn convert(
            &self,
            keeper: &Arc<Keeper>,
            python: &Path,
            progress: &Progress,
        ) -> Result<PathBuf, Miss> {
            let _ = fs::remove_file(self.out.join("in.pdf"));
            let export = Export::new("pdf", "writer_pdf_Export");
            keeper.convert(&Request {
                soffice: &self.soffice,
                profile: &self.profile,
                python,
                scratch: &self.client,
                progress,
                input: &self.input,
                infilter: None,
                export: &export,
                outdir: &self.out,
            })
        }

        fn starts(&self) -> usize {
            fs::read_to_string(self.profile.join("starts.txt"))
                .map_or(0, |text| text.lines().count())
        }

        fn runs(&self) -> Vec<String> {
            fs::read_to_string(self.root.join("runs.txt"))
                .unwrap_or_default()
                .lines()
                .map(str::to_owned)
                .collect()
        }

        /// Waits until the LibreOffice stand-in no longer runs, then clears the profile folder.
        fn gone(&self) {
            let deadline = Instant::now() + Duration::from_secs(30);
            #[cfg(windows)]
            {
                // A process still running in the profile folder would hold it.
                while self.profile.exists() && fs::remove_dir_all(&self.profile).is_err() {
                    assert!(Instant::now() < deadline, "LibreOffice still runs");
                    thread::sleep(Duration::from_millis(100));
                }
            }
            #[cfg(unix)]
            for pid in fs::read_to_string(self.profile.join("soffice.pid"))
                .unwrap_or_default()
                .lines()
            {
                let pid: libc::pid_t = pid.trim().parse().unwrap();
                // SAFETY: signal 0 only asks whether the process exists.
                while unsafe { libc::kill(pid, 0) } == 0 {
                    assert!(Instant::now() < deadline, "LibreOffice still runs");
                    thread::sleep(Duration::from_millis(100));
                }
            }
            let _ = deadline;
            let _ = fs::remove_dir_all(&self.profile);
        }
    }

    fn keeper(idle: Duration) -> Arc<Keeper> {
        Keeper::new(idle, Duration::from_millis(100))
    }

    fn until(what: &str, done: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(30);
        while !done() {
            assert!(Instant::now() < deadline, "{what}");
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn office_kept_one_libreoffice_serves_job_after_job_and_ends_when_idle() {
        let bench = Bench::new();
        let keeper = keeper(Duration::from_millis(1500));
        let python = bench.converting();
        for _ in 0..3 {
            let written = bench.convert(&keeper, &python, &Progress::none()).unwrap();
            assert_eq!(written, bench.out.join("in.pdf"));
            assert!(keeper.running());
        }
        assert_eq!(bench.starts(), 1, "one LibreOffice for the three jobs");
        let runs = bench.runs();
        assert_eq!(runs.len(), 3, "{runs:?}");
        assert!(runs.iter().all(|run| run.contains("convert")
            && run.contains("--pipe=kento-")
            && run.contains("--load=MacroExecutionMode:short:0")));
        // The first request waits for LibreOffice to open its pipe; later ones find it open.
        assert!(runs[0].contains("--wait=120.0"), "{}", runs[0]);
        assert!(runs[1].contains("--wait=10.0"), "{}", runs[1]);
        until("the idle LibreOffice ends", || !keeper.running());
        bench.gone();
        // The profile is free again, and its lock file no longer names a pipe.
        let mut held = profile::hold(&bench.profile, &Progress::none()).unwrap();
        assert_eq!(profile::noted(&mut held), None);
        drop(held);
        // The next job starts a new one.
        bench.convert(&keeper, &python, &Progress::none()).unwrap();
        assert_eq!(bench.starts(), 1, "a new profile folder, a new count");
        keeper.stop("the check is over");
    }

    #[test]
    fn office_kept_a_broken_connection_starts_a_new_libreoffice() {
        let bench = Bench::new();
        let keeper = keeper(IDLE);
        // The first request loses LibreOffice halfway, as when it crashes.
        let python = bench.python(
            "breaks",
            "if exist ..\\broke (echo %%PDF-1.7> ..\\out\\in.pdf) else (echo.> ..\\broke & echo kento-office: connected: p 1>&2 & echo kento-office: broken: Binary URP bridge disposed 1>&2 & exit /b 6)",
            "if [ -e ../broke ]; then printf '%%PDF-1.7' > ../out/in.pdf; else : > ../broke; echo 'kento-office: connected: p' >&2; echo 'kento-office: broken: Binary URP bridge disposed' >&2; exit 6; fi",
        );
        bench.convert(&keeper, &python, &Progress::none()).unwrap();
        assert_eq!(bench.starts(), 2, "a new LibreOffice for the second try");
        assert_eq!(bench.runs().len(), 2);
        keeper.stop("the check is over");
        bench.gone();

        // Twice in a row is a crash.
        let bench = Bench::new();
        let python = bench.python(
            "always-breaks",
            "echo kento-office: connected: p 1>&2\nexit /b 6",
            "echo 'kento-office: connected: p' >&2\nexit 6",
        );
        let result = bench.convert(&keeper, &python, &Progress::none());
        assert!(
            matches!(
                result,
                Err(Miss::Failed(Error::Crashed(Codec::LibreOffice)))
            ),
            "{result:?}"
        );
        assert!(!keeper.running());
        bench.gone();
    }

    #[test]
    fn office_kept_a_crash_report_ends_a_libreoffice_that_hangs() {
        let bench = Bench::new();
        let keeper = keeper(IDLE);
        fs::create_dir_all(bench.profile.join("crash")).unwrap();
        // An old report from before is not this run's crash.
        fs::write(bench.profile.join("crash").join("earlier.dmp"), b"").unwrap();
        let python = bench.python(
            "hangs",
            "if exist ..\\hung (echo %%PDF-1.7> ..\\out\\in.pdf & exit /b 0)\necho.> ..\\hung\necho kento-office: connected: p 1>&2\necho.> ..\\profile\\crash\\run.dmp\nping -n 600 127.0.0.1 >nul",
            "if [ -e ../hung ]; then printf '%%PDF-1.7' > ../out/in.pdf; exit 0; fi\n: > ../hung\necho 'kento-office: connected: p' >&2\n: > ../profile/crash/run.dmp\nsleep 600",
        );
        let started = Instant::now();
        bench.convert(&keeper, &python, &Progress::none()).unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(60),
            "it waited: {:?}",
            started.elapsed()
        );
        assert_eq!(bench.starts(), 2);
        keeper.stop("the check is over");
        bench.gone();
    }

    #[test]
    fn office_kept_cancelling_ends_libreoffice_and_the_next_job_starts_one() {
        let bench = Bench::new();
        let keeper = keeper(IDLE);
        let python = bench.python(
            "slow",
            "echo kento-office: connected: p 1>&2\nping -n 600 127.0.0.1 >nul",
            "echo 'kento-office: connected: p' >&2\nsleep 600",
        );
        let started = Instant::now();
        let cancelled = || started.elapsed() > Duration::from_millis(1500);
        let progress = Progress::new(&|_| {}, &cancelled);
        let result = bench.convert(&keeper, &python, &progress);
        assert!(
            matches!(result, Err(Miss::Failed(Error::Cancelled))),
            "{result:?}"
        );
        assert!(started.elapsed() < Duration::from_secs(60));
        assert!(!keeper.running());
        // The client's folder is free: nothing of it runs.
        let deadline = Instant::now() + Duration::from_secs(30);
        while fs::remove_dir_all(&bench.client).is_err() {
            assert!(Instant::now() < deadline, "the client still runs");
            thread::sleep(Duration::from_millis(100));
        }
        bench.gone();
        bench
            .convert(&keeper, &bench.converting(), &Progress::none())
            .unwrap();
        assert_eq!(
            bench.starts(),
            1,
            "a new LibreOffice in a new profile folder"
        );
        keeper.stop("the check is over");
    }

    #[test]
    fn office_kept_without_pyuno_jobs_run_libreoffice_themselves() {
        let bench = Bench::new();
        let keeper = keeper(IDLE);
        let python = bench.python(
            "no-uno",
            "echo kento-office: no-uno: No module named 'uno' 1>&2\nexit /b 3",
            "echo \"kento-office: no-uno: No module named 'uno'\" >&2\nexit 3",
        );
        for _ in 0..2 {
            let result = bench.convert(&keeper, &python, &Progress::none());
            assert!(matches!(result, Err(Miss::Fallback(_))), "{result:?}");
            assert!(!keeper.running());
        }
        assert_eq!(bench.runs().len(), 1, "that Python is not asked again");
        bench.gone();
        // A Python that does not start at all is no client either.
        let missing = bench.root.join("nowhere").join("python");
        let result = bench.convert(&keeper, &missing, &Progress::none());
        assert!(matches!(result, Err(Miss::Fallback(_))), "{result:?}");
        assert!(!keeper.running());
        bench.gone();
    }

    #[test]
    fn office_kept_a_document_libreoffice_cannot_load_is_not_tried_again() {
        let bench = Bench::new();
        let keeper = keeper(IDLE);
        let python = bench.python(
            "unreadable",
            "echo kento-office: connected: p 1>&2\necho kento-office: unreadable: could not be loaded: General Error 1>&2\nexit /b 5",
            "echo 'kento-office: connected: p' >&2\necho 'kento-office: unreadable: could not be loaded: General Error' >&2\nexit 5",
        );
        let result = bench.convert(&keeper, &python, &Progress::none());
        let Err(Miss::Failed(Error::Unreadable(message))) = result else {
            panic!("expected an unreadable document, got {result:?}");
        };
        assert!(message.contains("General Error"), "{message}");
        assert_eq!(bench.runs().len(), 1);
        assert!(keeper.running(), "LibreOffice itself is fine");
        keeper.stop("the check is over");
        bench.gone();
    }

    #[test]
    fn office_kept_a_libreoffice_that_never_listens_leaves_the_job_to_the_old_way() {
        // Nothing listens on the pipe.
        let bench = Bench::new();
        let keeper = keeper(IDLE);
        let python = bench.python(
            "no-pipe",
            "echo kento-office: no-connection: Connector : couldn't connect to pipe 1>&2\nexit /b 4",
            "echo 'kento-office: no-connection: Connector : cannot connect to pipe' >&2\nexit 4",
        );
        let result = bench.convert(&keeper, &python, &Progress::none());
        assert!(matches!(result, Err(Miss::Fallback(_))), "{result:?}");
        assert!(!keeper.running());
        bench.gone();
        // LibreOffice ends before it listens (it handed itself to another, say): the job does
        // not wait for the client's whole wait.
        let bench = Bench::with_office(
            "echo start>> starts.txt\nexit /b 1",
            "echo start >> starts.txt\nexit 1",
        );
        let python = bench.python("waits", "ping -n 600 127.0.0.1 >nul", "sleep 600");
        let started = Instant::now();
        let result = bench.convert(&keeper, &python, &Progress::none());
        assert!(matches!(result, Err(Miss::Fallback(_))), "{result:?}");
        assert!(started.elapsed() < Duration::from_secs(60));
        assert!(!keeper.running());
    }

    #[test]
    fn office_kept_someone_waiting_for_the_profile_ends_it() {
        let bench = Bench::new();
        let keeper = keeper(IDLE);
        bench
            .convert(&keeper, &bench.converting(), &Progress::none())
            .unwrap();
        assert!(keeper.running());
        // Another process (here another handle) wants the profile: it gets it within moments,
        // not after the idle time.
        let started = Instant::now();
        let held = profile::hold(&bench.profile, &Progress::none()).unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "{:?}",
            started.elapsed()
        );
        assert!(!keeper.running());
        drop(held);
        bench.gone();
    }

    #[test]
    fn office_kept_a_libreoffice_left_behind_is_asked_to_end_first() {
        let bench = Bench::new();
        let keeper = keeper(IDLE);
        // An earlier Kento ended without clearing its note.
        fs::write(bench.root.join("profile.lock"), "kento-4242-office-7").unwrap();
        bench
            .convert(&keeper, &bench.converting(), &Progress::none())
            .unwrap();
        let runs = bench.runs();
        assert_eq!(runs.len(), 2, "{runs:?}");
        assert!(
            runs[0].contains("stop") && runs[0].contains("--pipe=kento-4242-office-7"),
            "{}",
            runs[0]
        );
        assert!(runs[1].contains("convert"), "{}", runs[1]);
        keeper.stop("the check is over");
        assert_eq!(
            fs::read_to_string(bench.root.join("profile.lock")).unwrap(),
            ""
        );
        bench.gone();
        // Anything else in the lock file is never taken for a pipe.
        fs::write(bench.root.join("profile.lock"), "kento-x-office-7").unwrap();
        bench
            .convert(&keeper, &bench.converting(), &Progress::none())
            .unwrap();
        assert_eq!(bench.runs().len(), 3);
        keeper.stop("the check is over");
        bench.gone();
    }

    #[test]
    fn office_kept_shutdown_ends_it_and_starts_no_other() {
        let bench = Bench::new();
        let keeper = keeper(IDLE);
        let python = bench.converting();
        bench.convert(&keeper, &python, &Progress::none()).unwrap();
        keeper.shutdown();
        assert!(!keeper.running());
        bench.gone();
        let result = bench.convert(&keeper, &python, &Progress::none());
        assert!(
            matches!(result, Err(Miss::Failed(Error::Cancelled))),
            "{result:?}"
        );
        assert_eq!(bench.starts(), 0, "no LibreOffice after Kento quits");
    }

    #[test]
    fn office_kept_libreoffice_listens_on_a_pipe_with_kentos_profile() {
        let profile = if cfg!(windows) {
            r"C:\Users\Şule\AppData\Local\Kento\office-profile"
        } else {
            "/Users/şule/Library/Application Support/Kento/office-profile"
        };
        let args: Vec<String> = instance_arguments(Path::new(profile), "kento-7-office-1")
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let url = if cfg!(windows) {
            "file:///C:/Users/%C5%9Eule/AppData/Local/Kento/office-profile"
        } else {
            "file:///Users/%C5%9Fule/Library/Application%20Support/Kento/office-profile"
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
                "--accept=pipe,name=kento-7-office-1;urp;",
            ]
        );
        assert!(is_kento_pipe("kento-7-office-1"));
        assert!(is_kento_pipe("kento-123456-office-42"));
        for name in [
            "",
            "kento--office-1",
            "kento-7-office-",
            "kento-7-office-1-2",
            "other-7-office-1",
            "kento-7-office-1;urp;",
            "kento-x-office-1",
        ] {
            assert!(!is_kento_pipe(name), "{name}");
        }
    }
}
