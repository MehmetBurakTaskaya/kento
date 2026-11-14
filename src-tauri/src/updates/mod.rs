// SPDX-License-Identifier: MIT
//! Updates (SPEC 5.16). They are mandatory: no version can be skipped or put off. Kento looks for
//! a new version 30 seconds after it starts, every 6 hours and an hour after a check that failed
//! (offline it simply works on); Ctrl+U (⌘U), the tray menu and Settings › Updates look at once.
//! One thread does it all and sleeps on a condition variable in between. A version found
//! downloads in the background, and the updater checks it against the key in tauri.conf.json and
//! the version signed into it (`requireSignedVersion`). From then on the queue refuses new jobs
//! and folder automation keeps its files for after the restart. Once the running and queued jobs
//! are done, no tool is being installed and no dialog holds the user's work, a short notice says
//! Kento restarts, and the update installs.
//!
//! How it installs depends on the copy (`kind`, decision 46): the installer runs quietly and
//! starts Kento again, the portable copy swaps its own files (`portable`), a Mac app bundle
//! replaces itself and restarts. The notes of the version being installed wait for its first
//! start (`notes`). The page has no updater permission; it sees the state through `View`. The
//! version being installed is remembered too (`attempt`): a start that still runs the old version
//! knows the install did not happen and waits to be asked before trying that version again.

mod attempt;
mod kind;
mod notes;
#[cfg_attr(not(windows), allow(dead_code))]
mod portable;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterBuilder, UpdaterExt};

use crate::error::{Error, Result};
use crate::jobs::JobInfo;
use crate::overlay::toast;
use crate::{i18n, window, AppState};
pub use kind::Kind;
pub use notes::Notes;

/// Gives the network time to come up after signing in.
const FIRST_DELAY: Duration = Duration::from_secs(30);
const EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// A failed check (often no network yet) is tried again sooner than the regular one.
const AFTER_FAILURE: Duration = Duration::from_secs(60 * 60);
/// How long reading latest.json may take.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// How long the whole download may take, so a stalled connection never holds updates up for good.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// From the notice to the restart.
const NOTICE: Duration = Duration::from_secs(5);
/// How often the download progress is sent to the page.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// Where an update stands, as Settings › Updates shows it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Status {
    /// No check has run since Kento started.
    #[default]
    Idle,
    Checking,
    UpToDate,
    /// A newer version this copy does not install: a development build, or a Mac app that macOS
    /// runs from a translocation folder.
    Available {
        version: String,
    },
    Downloading {
        version: String,
        received: u64,
        total: Option<u64>,
    },
    /// Downloaded and verified; a Mac app Kento may not change waits for "Update and restart".
    Confirm {
        version: String,
    },
    /// Downloaded and verified; new jobs are refused, and it installs once these are done.
    Waiting {
        version: String,
        /// Jobs queued or running, and whether the queue is paused.
        jobs: usize,
        paused: bool,
        /// A dialog in the main window holds the user's work.
        editing: bool,
        /// A tool is being installed.
        installs: bool,
    },
    /// The notice is up; Kento restarts in a moment.
    Restarting {
        version: String,
    },
    /// Installing this version closed Kento but did not put it in place; Kento waits for Check now
    /// or a newer version before trying again.
    Missed {
        version: String,
    },
    Failed {
        reason: Reason,
    },
}

/// Why the last check, download or install failed, in a word the page explains.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    /// GitHub could not be reached.
    Offline,
    /// The download did not match its signature, or was signed for another version.
    Signature,
    /// Installing failed; this version keeps working.
    Install,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub current: String,
    pub kind: Kind,
    /// When the last check that reached GitHub ended, in Unix milliseconds.
    pub last_check: Option<u64>,
    pub status: Status,
}

/// What wakes the update thread.
#[derive(Debug, Default)]
struct Signal {
    /// A check was asked for.
    check: bool,
    /// Something an update waiting to install depends on changed: a job ended, a dialog closed.
    changed: bool,
}

pub struct Updates {
    kind: Kind,
    data: PathBuf,
    status: Mutex<Status>,
    last_check: Mutex<Option<u64>>,
    signal: Mutex<Signal>,
    wake: Condvar,
    /// A dialog in the main window holds the user's work.
    editing: AtomicBool,
    /// "Update and restart" was pressed.
    confirmed: AtomicBool,
    /// The notes of the version this start installed, until the main window takes them.
    news: Mutex<Option<Notes>>,
    /// The version an earlier start was installing when it did not install.
    missed: Mutex<Option<String>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

impl Updates {
    /// The state for this copy; `data` is Kento's data folder.
    pub fn new(data: PathBuf) -> Self {
        Self {
            kind: Kind::detect(),
            data,
            status: Mutex::default(),
            last_check: Mutex::default(),
            signal: Mutex::default(),
            wake: Condvar::new(),
            editing: AtomicBool::new(false),
            confirmed: AtomicBool::new(false),
            news: Mutex::default(),
            missed: Mutex::default(),
        }
    }

    /// Sleeps until `until` (None: for as long as it takes) or until a signal makes `stop` true;
    /// returns what was signalled, which no longer waits.
    fn wait(&self, until: Option<Instant>, stop: impl Fn(&Signal) -> bool) -> Signal {
        let mut signal = lock(&self.signal);
        while !stop(&signal) {
            signal = match until {
                None => self.wake.wait(signal).unwrap_or_else(|p| p.into_inner()),
                Some(until) => {
                    let Some(left) = until.checked_duration_since(Instant::now()) else {
                        break;
                    };
                    self.wake
                        .wait_timeout(signal, left)
                        .map(|(signal, _)| signal)
                        .unwrap_or_else(|p| p.into_inner().0)
                }
            };
        }
        std::mem::take(&mut *signal)
    }

    fn signal(&self, change: impl FnOnce(&mut Signal)) {
        change(&mut lock(&self.signal));
        self.wake.notify_all();
    }
}

/// When the next check is due: 30 seconds after start, then 6 hours after a check that reached
/// GitHub, or an hour after one that did not. A check the user asks for counts the same, so the
/// next one is timed from it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Schedule {
    due: Instant,
}

impl Schedule {
    fn starting(now: Instant) -> Self {
        Self {
            due: now + FIRST_DELAY,
        }
    }

    fn checked(&mut self, reached: bool, now: Instant) {
        self.due = now + if reached { EVERY } else { AFTER_FAILURE };
    }
}

/// What a downloaded update waits for.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Busy {
    jobs: usize,
    paused: bool,
    editing: bool,
    installs: bool,
}

impl Busy {
    fn free(&self) -> bool {
        self.jobs == 0 && !self.editing && !self.installs
    }
}

/// What a downloaded update does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Step {
    /// Wait for "Update and restart"; new jobs still start.
    Confirm,
    /// Refuse new jobs and wait for the work under way.
    Wait,
    /// Show the notice and install.
    Restart,
}

fn step(kind: Kind, confirmed: bool, busy: Busy) -> Step {
    if !kind.automatic() && !confirmed {
        Step::Confirm
    } else if busy.free() {
        Step::Restart
    } else {
        Step::Wait
    }
}

/// A downloaded update whose signature has been checked.
struct Ready {
    update: Update,
    bytes: Vec<u8>,
}

/// Starts the update thread. Notes kept by the update that started this version wait for Home;
/// when Kento starts without its window, a corner card says it was updated.
pub fn start(app: &AppHandle, window_shown: bool) {
    let updates = app.state::<Updates>();
    let version = app.package_info().version.to_string();
    if let Some(news) = notes::take(&updates.data, &version) {
        tracing::info!("this start follows the update to {version}");
        if !window_shown {
            let lang = app.state::<AppState>().lang();
            let text = i18n::text(&lang, "updates.notice.updated").replace("{version}", &version);
            toast::note(app, text);
        }
        *lock(&updates.news) = Some(news);
    }
    if let Some(missed) = attempt::missed(&updates.data, &version) {
        tracing::warn!("the update to {missed} did not install; Kento {version} goes on");
        let lang = app.state::<AppState>().lang();
        toast::note(
            app,
            i18n::text(&lang, "updates.notice.missed").replace("{version}", &missed),
        );
        set(
            app,
            Status::Missed {
                version: missed.clone(),
            },
        );
        *lock(&updates.missed) = Some(missed);
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("kento-updates".into())
        .spawn(move || run(&app));
    if let Err(err) = spawned {
        tracing::error!("update checks could not start: {err}");
    }
}

fn run(app: &AppHandle) {
    let updates = app.state::<Updates>();
    let mut schedule = Schedule::starting(Instant::now());
    let mut tidied = false;
    loop {
        // A check the user asked for, rather than one that came due.
        let asked = updates
            .wait(Some(schedule.due), |signal| signal.check)
            .check;
        if !tidied {
            // The program an earlier update set aside has stopped by now.
            tidied = true;
            tidy(&updates);
        }
        let looked = look(app, asked);
        schedule.checked(looked.is_ok(), Instant::now());
        let ready = match looked {
            Ok(Some(ready)) => ready,
            Ok(None) => continue,
            Err(reason) => {
                set(app, Status::Failed { reason });
                continue;
            }
        };
        let reason = install_when_free(app, ready);
        // This version keeps working: new jobs start again, and the next check finds the update
        // once more.
        updates.confirmed.store(false, Ordering::SeqCst);
        app.state::<AppState>().queue.reopen();
        crate::automation::release(app);
        set(app, Status::Failed { reason });
        schedule.checked(false, Instant::now());
    }
}

fn tidy(updates: &Updates) {
    if updates.kind != Kind::Portable {
        return;
    }
    if let Ok(exe) = std::env::current_exe() {
        portable::tidy(&exe, &updates.data);
    }
}

/// One check, and for a copy that installs, the download of what it found; a version that did not
/// install before downloads only when the user asked (`asked`).
fn look(app: &AppHandle, asked: bool) -> std::result::Result<Option<Ready>, Reason> {
    let updates = app.state::<Updates>();
    set(app, Status::Checking);
    let found =
        tauri::async_runtime::block_on(async { updater(app, updates.kind).build()?.check().await });
    let mut update = match found {
        Ok(found) => {
            *lock(&updates.last_check) = Some(now_ms());
            match found {
                Some(update) => update,
                None => {
                    set(app, Status::UpToDate);
                    return Ok(None);
                }
            }
        }
        Err(err) => {
            tracing::warn!("the update check failed: {err}");
            return Err(reason(&err));
        }
    };
    let version = update.version.clone();
    tracing::info!("Kento {version} is available");
    if !updates.kind.installs() {
        set(app, Status::Available { version });
        return Ok(None);
    }
    if !asked && lock(&updates.missed).as_deref() == Some(version.as_str()) {
        set(app, Status::Missed { version });
        return Ok(None);
    }
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    set(
        app,
        Status::Downloading {
            version: version.clone(),
            received: 0,
            total: None,
        },
    );
    let mut received = 0u64;
    let mut shown = Instant::now();
    // The bytes come back only once they match the update's signature.
    let downloaded = tauri::async_runtime::block_on(update.download(
        |chunk, total| {
            received += chunk as u64;
            if shown.elapsed() >= PROGRESS_EVERY {
                shown = Instant::now();
                let version = version.clone();
                set(
                    app,
                    Status::Downloading {
                        version,
                        received,
                        total,
                    },
                );
            }
        },
        || {},
    ));
    match downloaded {
        Ok(bytes) => {
            tracing::info!("Kento {version} is downloaded and its signature checked");
            Ok(Some(Ready { update, bytes }))
        }
        Err(err) => {
            tracing::warn!("the update did not download: {err}");
            Err(reason(&err))
        }
    }
}

fn reason(err: &tauri_plugin_updater::Error) -> Reason {
    use tauri_plugin_updater::Error as E;
    match err {
        E::Reqwest(_) | E::Network(_) => Reason::Offline,
        E::Minisign(_)
        | E::Base64(_)
        | E::SignatureUtf8(_)
        | E::SignedVersionMismatch { .. }
        | E::MissingSignedVersion => Reason::Signature,
        _ => Reason::Other,
    }
}

/// The updater for a kind of copy: the portable one asks for its own entry of latest.json.
pub fn updater<R: Runtime>(app: &AppHandle<R>, kind: Kind) -> UpdaterBuilder {
    let exiting = app.clone();
    let builder = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        // On Windows the installer ends this process at once: do what a normal exit would.
        .on_before_exit(move || {
            kento_engines::office::shutdown();
            exiting.cleanup_before_exit();
        });
    match kind.target() {
        Some(target) => builder.target(target),
        None => builder,
    }
}

/// Waits until the update may install, installs it and restarts; returns only when installing
/// failed.
fn install_when_free(app: &AppHandle, ready: Ready) -> Reason {
    let updates = app.state::<Updates>();
    let version = ready.update.version.clone();
    let say = |key: &str| {
        let lang = app.state::<AppState>().lang();
        toast::note(app, i18n::text(&lang, key).replace("{version}", &version));
    };
    let mut told = false;
    loop {
        let work = busy(app);
        match step(updates.kind, updates.confirmed.load(Ordering::SeqCst), work) {
            Step::Confirm => {
                set(
                    app,
                    Status::Confirm {
                        version: version.clone(),
                    },
                );
                if !std::mem::replace(&mut told, true) {
                    say("updates.notice.confirm");
                }
            }
            Step::Wait => {
                refuse_jobs(app);
                set(
                    app,
                    Status::Waiting {
                        version: version.clone(),
                        jobs: work.jobs,
                        paused: work.paused,
                        editing: work.editing,
                        installs: work.installs,
                    },
                );
                if !std::mem::replace(&mut told, true) {
                    say("updates.notice.waiting");
                }
            }
            Step::Restart => {
                refuse_jobs(app);
                set(
                    app,
                    Status::Restarting {
                        version: version.clone(),
                    },
                );
                say("updates.notice.restarting");
                // A dialog opened during the notice puts the restart off again.
                let deadline = Instant::now() + NOTICE;
                while Instant::now() < deadline && busy(app).free() {
                    updates.wait(Some(deadline), |signal| signal.changed);
                }
                if busy(app).free() {
                    match install(app, &ready) {
                        Ok(()) => app.restart(),
                        Err(reason) => return reason,
                    }
                }
                continue;
            }
        }
        updates.wait(None, |signal| signal.changed);
    }
}

fn busy(app: &AppHandle) -> Busy {
    let state = app.state::<AppState>();
    Busy {
        jobs: state.queue.unfinished(),
        paused: state.queue.is_paused(),
        editing: app.state::<Updates>().editing.load(Ordering::SeqCst),
        installs: state.toolchain.is_busy(),
    }
}

fn refuse_jobs(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.queue.refusal().is_none() {
        state
            .queue
            .close(i18n::text(&state.lang(), "updates.refused"));
    }
}

/// Keeps the release notes for the next start and puts the new version in place. The installer
/// ends Kento itself (Windows); the portable copy and a Mac app restart once this returns.
fn install(app: &AppHandle, ready: &Ready) -> std::result::Result<(), Reason> {
    let updates = app.state::<Updates>();
    let update = &ready.update;
    if let Err(err) = notes::keep(&updates.data, &update.version, update.body.as_deref()) {
        tracing::warn!("the release notes were not kept: {err}");
    }
    if let Err(err) = attempt::remember(&updates.data, &update.version) {
        tracing::warn!("the update being installed was not recorded: {err}");
    }
    tracing::info!("installing Kento {}", update.version);
    let installed = match updates.kind {
        Kind::Portable => std::env::current_exe()
            .map_err(|err| err.to_string())
            .and_then(|exe| install_portable(update, &ready.bytes, &exe))
            .map(|leftovers| {
                if let Err(err) = portable::remember(&updates.data, &leftovers) {
                    tracing::warn!("the old files of the update were not listed: {err}");
                }
            }),
        _ => update.install(&ready.bytes).map_err(|err| err.to_string()),
    };
    installed.map_err(|err| {
        tracing::error!("the update could not be installed: {err}");
        Reason::Install
    })
}

/// Checks the portable ZIP once more, just before Kento's own files change, and swaps the files
/// beside the program at `exe` for its own. Returns what stepped aside and is still there.
pub fn install_portable(
    update: &Update,
    bytes: &[u8],
    exe: &Path,
) -> std::result::Result<Vec<PathBuf>, String> {
    update.verify(bytes).map_err(|err| err.to_string())?;
    portable::replace(exe, bytes).map_err(|err| err.to_string())
}

fn set(app: &AppHandle, status: Status) {
    *lock(&app.state::<Updates>().status) = status;
    if let Err(err) = app.emit("updates", view(app)) {
        tracing::warn!("the update state was not sent: {err}");
    }
}

pub fn view(app: &AppHandle) -> View {
    let updates = app.state::<Updates>();
    let last_check = *lock(&updates.last_check);
    let status = lock(&updates.status).clone();
    View {
        current: app.package_info().version.to_string(),
        kind: updates.kind,
        last_check,
        status,
    }
}

/// Looks for a new version now (Ctrl+U, the tray menu, "Check now").
pub fn check_now(app: &AppHandle) {
    app.state::<Updates>().signal(|signal| signal.check = true);
}

/// Something a downloaded update waits for changed: a tool install ended, jobs were paused or
/// resumed.
pub fn changed(app: &AppHandle) {
    if let Some(updates) = app.try_state::<Updates>() {
        updates.signal(|signal| signal.changed = true);
    }
}

/// Every job change; an update waiting for the jobs looks again when one ends.
pub fn on_job(app: &AppHandle, info: &JobInfo) {
    if info.state.is_finished() {
        changed(app);
    }
}

/// The main window closed, and its dialogs with it.
pub fn window_closed(app: &AppHandle) {
    if let Some(updates) = app.try_state::<Updates>() {
        updates.editing.store(false, Ordering::SeqCst);
        updates.signal(|signal| signal.changed = true);
    }
}

/// Refuses new work while an update waits to install. The main window's page shows the message
/// itself; anywhere else (the floating wheel, the shelf, Explorer) it comes as the corner card.
pub(crate) fn admit(app: &AppHandle, state: &AppState) -> Result<()> {
    let Some(message) = state.queue.refusal() else {
        return Ok(());
    };
    let focused = app.get_webview_window(window::MAIN).is_some_and(|main| {
        main.is_visible().unwrap_or(false) && main.is_focused().unwrap_or(false)
    });
    if !focused {
        toast::note(app, message.clone());
    }
    Err(Error::Invalid(message))
}

#[tauri::command]
pub fn updates_view(app: AppHandle) -> View {
    view(&app)
}

/// Looks for a new version now; `show` opens Settings › Updates in the main window.
#[tauri::command]
pub fn updates_check(app: AppHandle, show: bool) -> Result<()> {
    check_now(&app);
    if show {
        window::show_main(&app, Some("updates"))?;
    }
    Ok(())
}

/// "Update and restart": a Mac app Kento may not change on its own installs once the user asks,
/// and the system then asks for an administrator's password.
#[tauri::command]
pub fn updates_install(updates: State<'_, Updates>) {
    if matches!(*lock(&updates.status), Status::Confirm { .. }) {
        updates.confirmed.store(true, Ordering::SeqCst);
        updates.signal(|signal| signal.changed = true);
    }
}

/// Whether a dialog in the main window holds the user's work.
#[tauri::command]
pub fn updates_editing(updates: State<'_, Updates>, editing: bool) {
    updates.editing.store(editing, Ordering::SeqCst);
    updates.signal(|signal| signal.changed = true);
}

/// The notes of the version this start installed, once.
#[tauri::command]
pub fn updates_news(updates: State<'_, Updates>) -> Option<Notes> {
    lock(&updates.news).take()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn checks_are_timed_from_start_and_from_the_last_check() {
        let start = Instant::now();
        let mut schedule = Schedule::starting(start);
        assert_eq!(schedule.due, start + Duration::from_secs(30));
        let later = start + Duration::from_secs(31);
        schedule.checked(true, later);
        assert_eq!(schedule.due, later + Duration::from_secs(6 * 3600));
        // Offline: an hour, not six.
        schedule.checked(false, later);
        assert_eq!(schedule.due, later + Duration::from_secs(3600));
        // A check asked for between the regular ones moves the next one.
        let asked = later + Duration::from_secs(600);
        schedule.checked(true, asked);
        assert_eq!(schedule.due, asked + EVERY);
    }

    #[test]
    fn the_thread_sleeps_until_due_or_asked() {
        let updates = Updates::new(PathBuf::new());
        // Nothing asked: it wakes when due, with nothing signalled.
        let due = Instant::now() + Duration::from_millis(30);
        let signal = updates.wait(Some(due), |signal| signal.check);
        assert!(Instant::now() >= due);
        assert!(!signal.check && !signal.changed);
        // A change alone does not start a check, but it is not lost either.
        updates.signal(|signal| signal.changed = true);
        let signal = updates.wait(Some(Instant::now()), |signal| signal.check);
        assert!(signal.changed);
        // Asked from another thread: it wakes at once.
        let updates = std::sync::Arc::new(updates);
        let asker = updates.clone();
        let started = Instant::now();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            asker.signal(|signal| signal.check = true);
        });
        let signal = updates.wait(Some(started + Duration::from_secs(30)), |s| s.check);
        assert!(signal.check);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn a_downloaded_update_waits_for_the_work_under_way() {
        let free = Busy::default();
        assert_eq!(step(Kind::Installed, false, free), Step::Restart);
        assert_eq!(step(Kind::Portable, false, free), Step::Restart);
        assert_eq!(step(Kind::Bundle, false, free), Step::Restart);
        for busy in [
            Busy { jobs: 2, ..free },
            Busy {
                jobs: 1,
                paused: true,
                ..free
            },
            Busy {
                editing: true,
                ..free
            },
            Busy {
                installs: true,
                ..free
            },
        ] {
            assert_eq!(step(Kind::Installed, false, busy), Step::Wait, "{busy:?}");
        }
        // A paused queue with nothing in it holds nothing up.
        assert_eq!(
            step(
                Kind::Portable,
                false,
                Busy {
                    paused: true,
                    ..free
                }
            ),
            Step::Restart
        );
        // A Mac app Kento may not change waits for the user, then for the work.
        assert_eq!(step(Kind::LockedBundle, false, free), Step::Confirm);
        assert_eq!(step(Kind::LockedBundle, true, free), Step::Restart);
        assert_eq!(
            step(Kind::LockedBundle, true, Busy { jobs: 1, ..free }),
            Step::Wait
        );
    }

    #[test]
    fn status_matches_the_page_types() {
        let json = |status: Status| serde_json::to_value(status).unwrap();
        assert_eq!(json(Status::Idle), json!({ "state": "idle" }));
        assert_eq!(json(Status::UpToDate), json!({ "state": "upToDate" }));
        assert_eq!(
            json(Status::Missed {
                version: "1.2.1".into()
            }),
            json!({ "state": "missed", "version": "1.2.1" })
        );
        assert_eq!(
            json(Status::Downloading {
                version: "1.2.0".into(),
                received: 3,
                total: None
            }),
            json!({ "state": "downloading", "version": "1.2.0", "received": 3, "total": null })
        );
        assert_eq!(
            json(Status::Waiting {
                version: "1.2.0".into(),
                jobs: 2,
                paused: false,
                editing: true,
                installs: false
            }),
            json!({ "state": "waiting", "version": "1.2.0", "jobs": 2, "paused": false,
                    "editing": true, "installs": false })
        );
        assert_eq!(
            json(Status::Failed {
                reason: Reason::Offline
            }),
            json!({ "state": "failed", "reason": "offline" })
        );
    }

    /// The updater block of tauri.conf.json.
    fn configured() -> serde_json::Value {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        conf["plugins"]["updater"].clone()
    }

    #[test]
    fn the_updater_takes_the_configuration_as_written() {
        let block = configured();
        // The plugin skips keys it does not know without a word, so a misspelt one would be lost.
        let known = [
            "pubkey",
            "endpoints",
            "requireSignedVersion",
            "allowDowngrades",
            "windows",
            "dangerousInsecureTransportProtocol",
            "dangerousAcceptInvalidCerts",
            "dangerousAcceptInvalidHostnames",
        ];
        for key in block.as_object().unwrap().keys() {
            assert!(known.contains(&key.as_str()), "the updater ignores {key}");
        }
        for key in block["windows"].as_object().unwrap().keys() {
            assert!(
                ["installMode", "installerArgs"].contains(&key.as_str()),
                "the updater ignores windows.{key}"
            );
        }
        let config: tauri_plugin_updater::Config = serde_json::from_value(block).unwrap();
        assert!(config.require_signed_version);
        assert!(!config.allow_downgrades && !config.dangerous_insecure_transport_protocol);
        assert_eq!(
            config.endpoints[0].as_str(),
            "https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/latest.json"
        );
        let windows = config.windows.unwrap();
        assert_eq!(windows.install_mode.to_string(), "quiet");
        assert_eq!(windows.install_mode.nsis_args(), ["/S"]);
    }
}
