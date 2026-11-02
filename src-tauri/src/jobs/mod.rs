// SPDX-License-Identifier: MIT
//! The job queue (SPEC 5.13). Light jobs run side by side up to a limit; heavy jobs (LibreOffice)
//! run one at a time. Every job can be cancelled, and a failed or cancelled job's temporary files
//! are deleted. Pausing stops new jobs from starting; running ones finish. Closing (an update waits
//! to install, SPEC 5.16) refuses new jobs; running and queued ones finish.

pub mod engine;
pub mod naming;

use std::collections::{BTreeMap, VecDeque};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tokio::sync::Notify;

pub type JobId = u64;
pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;
/// Runs a future on the app's async runtime.
pub type Spawner = Arc<dyn Fn(BoxFuture<()>) + Send + Sync>;
/// Hears every change of a job.
pub type Listener = Arc<dyn Fn(&JobInfo) + Send + Sync>;

/// How many finished jobs the queue remembers.
const KEEP_FINISHED: usize = 50;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Lane {
    Light,
    Heavy,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum JobState {
    Queued,
    #[serde(rename_all = "camelCase")]
    Running {
        /// 0 to 1, or None while the job cannot tell.
        progress: Option<f32>,
        eta_ms: Option<u64>,
    },
    Done {
        outputs: Vec<PathBuf>,
    },
    Failed {
        /// Plain language, in the interface language.
        message: String,
        /// The technical reason, for "Copy details".
        details: Option<String>,
    },
    Cancelled,
}

impl JobState {
    pub fn is_finished(&self) -> bool {
        matches!(
            self,
            Self::Done { .. } | Self::Failed { .. } | Self::Cancelled
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub id: JobId,
    pub title: String,
    pub lane: Lane,
    #[serde(flatten)]
    pub state: JobState,
}

#[derive(Debug, thiserror::Error)]
pub enum JobError {
    #[error("cancelled")]
    Cancelled,
    #[error("{0}")]
    Failed(String),
    #[error("{message} ({details})")]
    Explained { message: String, details: String },
}

/// A unit of work. `run` gets a context for progress, cancellation and temporary files.
pub trait Job: Send + 'static {
    fn title(&self) -> String;
    fn lane(&self) -> Lane {
        Lane::Light
    }
    fn run(self: Box<Self>, ctx: JobContext) -> BoxFuture<Result<Vec<PathBuf>, JobError>>;
}

#[derive(Clone, Default)]
pub struct CancelToken(Arc<(AtomicBool, Notify)>);

impl CancelToken {
    pub fn cancel(&self) {
        self.0 .0.store(true, Ordering::SeqCst);
        self.0 .1.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.0 .0.load(Ordering::SeqCst)
    }

    /// Resolves once the job is cancelled.
    pub async fn cancelled(&self) {
        loop {
            let notified = self.0 .1.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Clone)]
pub struct JobContext {
    pub id: JobId,
    cancel: CancelToken,
    queue: JobQueue,
    temps: Arc<Mutex<Vec<PathBuf>>>,
}

impl JobContext {
    pub fn is_cancelled(&self) -> bool {
        self.cancel.is_cancelled()
    }

    pub async fn cancelled(&self) {
        self.cancel.cancelled().await
    }

    /// Reports progress (0 to 1) and, when known, the time left.
    pub fn report(&self, fraction: Option<f32>, eta_ms: Option<u64>) {
        let progress = fraction.map(|f| f.clamp(0.0, 1.0));
        self.queue
            .update(self.id, JobState::Running { progress, eta_ms });
    }

    /// Registers a file to delete if the job fails or is cancelled.
    pub fn track_temp(&self, path: PathBuf) {
        lock(&self.temps).push(path);
    }
}

struct Entry {
    info: JobInfo,
    cancel: CancelToken,
}

struct State {
    next_id: JobId,
    waiting: VecDeque<(JobId, Box<dyn Job>)>,
    jobs: BTreeMap<JobId, Entry>,
    running_light: usize,
    running_heavy: usize,
    limit: usize,
    paused: bool,
    /// Why new jobs are refused, in the interface language; None while the queue takes them.
    refusal: Option<String>,
}

struct Shared {
    state: Mutex<State>,
    spawn: Spawner,
    listener: Listener,
}

#[derive(Clone)]
pub struct JobQueue(Arc<Shared>);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl JobQueue {
    pub fn new(limit: usize, spawn: Spawner, listener: Listener) -> Self {
        Self(Arc::new(Shared {
            state: Mutex::new(State {
                next_id: 1,
                waiting: VecDeque::new(),
                jobs: BTreeMap::new(),
                running_light: 0,
                running_heavy: 0,
                limit: limit.max(1),
                paused: false,
                refusal: None,
            }),
            spawn,
            listener,
        }))
    }

    /// Half the processor's threads, between 1 and 4: converters such as FFmpeg use several
    /// threads each.
    pub fn default_limit() -> usize {
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(2);
        (threads / 2).clamp(1, 4)
    }

    /// Queues a job. A closed queue records it as failed with the reason instead, and never runs
    /// it.
    pub fn submit(&self, job: Box<dyn Job>) -> JobId {
        let info = {
            let mut state = lock(&self.0.state);
            let id = state.next_id;
            state.next_id += 1;
            let refused = state.refusal.clone().map(|message| JobState::Failed {
                message,
                details: None,
            });
            let info = JobInfo {
                id,
                title: job.title(),
                lane: job.lane(),
                state: refused.unwrap_or(JobState::Queued),
            };
            state.jobs.insert(
                id,
                Entry {
                    info: info.clone(),
                    cancel: CancelToken::default(),
                },
            );
            if info.state.is_finished() {
                prune(&mut state);
            } else {
                state.waiting.push_back((id, job));
            }
            info
        };
        (self.0.listener)(&info);
        self.pump();
        info.id
    }

    /// Refuses every new job from now on, with `message` as the reason; running and queued jobs
    /// go on.
    pub fn close(&self, message: String) {
        lock(&self.0.state).refusal = Some(message);
    }

    /// Takes new jobs again.
    pub fn reopen(&self) {
        lock(&self.0.state).refusal = None;
    }

    /// Why new jobs are refused, or None while the queue takes them.
    pub fn refusal(&self) -> Option<String> {
        lock(&self.0.state).refusal.clone()
    }

    /// How many jobs are queued or running.
    pub fn unfinished(&self) -> usize {
        let state = lock(&self.0.state);
        state.waiting.len() + state.running_light + state.running_heavy
    }

    /// Cancels a queued or running job; a finished job is left as it is.
    pub fn cancel(&self, id: JobId) {
        let removed = {
            let mut state = lock(&self.0.state);
            let position = state.waiting.iter().position(|(waiting, _)| *waiting == id);
            match position {
                Some(index) => {
                    state.waiting.remove(index);
                    true
                }
                None => {
                    if let Some(entry) = state.jobs.get(&id) {
                        entry.cancel.cancel();
                    }
                    false
                }
            }
        };
        if removed {
            self.update(id, JobState::Cancelled);
        }
    }

    pub fn set_paused(&self, paused: bool) {
        lock(&self.0.state).paused = paused;
        if !paused {
            self.pump();
        }
    }

    pub fn is_paused(&self) -> bool {
        lock(&self.0.state).paused
    }

    pub fn set_limit(&self, limit: usize) {
        lock(&self.0.state).limit = limit.max(1);
        self.pump();
    }

    pub fn snapshot(&self) -> Vec<JobInfo> {
        lock(&self.0.state)
            .jobs
            .values()
            .map(|entry| entry.info.clone())
            .collect()
    }

    fn update(&self, id: JobId, new_state: JobState) {
        let info = {
            let mut state = lock(&self.0.state);
            let Some(entry) = state.jobs.get_mut(&id) else {
                return;
            };
            if entry.info.state.is_finished() {
                return;
            }
            entry.info.state = new_state;
            let info = entry.info.clone();
            if info.state.is_finished() {
                prune(&mut state);
            }
            info
        };
        (self.0.listener)(&info);
    }

    /// Starts every waiting job that has room in its lane.
    fn pump(&self) {
        loop {
            let started = {
                let mut state = lock(&self.0.state);
                if state.paused {
                    return;
                }
                let (light, heavy, limit) = (state.running_light, state.running_heavy, state.limit);
                let next = state.waiting.iter().position(|(_, job)| match job.lane() {
                    Lane::Light => light < limit,
                    Lane::Heavy => heavy < 1,
                });
                let Some(index) = next else { return };
                let Some((id, job)) = state.waiting.remove(index) else {
                    return;
                };
                let lane = job.lane();
                match lane {
                    Lane::Light => state.running_light += 1,
                    Lane::Heavy => state.running_heavy += 1,
                }
                let cancel = state
                    .jobs
                    .get(&id)
                    .map(|entry| entry.cancel.clone())
                    .unwrap_or_default();
                (id, job, lane, cancel)
            };
            let (id, job, lane, cancel) = started;
            self.update(
                id,
                JobState::Running {
                    progress: None,
                    eta_ms: None,
                },
            );
            let ctx = JobContext {
                id,
                cancel,
                queue: self.clone(),
                temps: Arc::default(),
            };
            let queue = self.clone();
            (self.0.spawn)(Box::pin(async move {
                let temps = ctx.temps.clone();
                let token = ctx.cancel.clone();
                let result = job.run(ctx).await;
                let final_state = match result {
                    Ok(outputs) if !token.is_cancelled() => JobState::Done { outputs },
                    Ok(_) | Err(JobError::Cancelled) => JobState::Cancelled,
                    Err(JobError::Failed(message)) => JobState::Failed {
                        message,
                        details: None,
                    },
                    Err(JobError::Explained { message, details }) => JobState::Failed {
                        message,
                        details: Some(details),
                    },
                };
                if !matches!(final_state, JobState::Done { .. }) {
                    for path in lock(&temps).drain(..) {
                        let _ = std::fs::remove_file(&path);
                    }
                }
                {
                    let mut state = lock(&queue.0.state);
                    match lane {
                        Lane::Light => state.running_light -= 1,
                        Lane::Heavy => state.running_heavy -= 1,
                    }
                }
                queue.update(id, final_state);
                queue.pump();
            }));
        }
    }
}

/// Forgets the oldest finished jobs beyond the ones the queue keeps.
fn prune(state: &mut State) {
    let finished: Vec<JobId> = state
        .jobs
        .iter()
        .filter(|(_, entry)| entry.info.state.is_finished())
        .map(|(id, _)| *id)
        .collect();
    if finished.len() > KEEP_FINISHED {
        for id in &finished[..finished.len() - KEEP_FINISHED] {
            state.jobs.remove(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::time::Duration;
    use tokio::sync::mpsc;

    /// Waits a while (or until cancelled) and counts how many run at once.
    struct Sleepy {
        lane: Lane,
        ms: u64,
        now: Arc<AtomicUsize>,
        peak: Arc<AtomicUsize>,
        temp: Option<PathBuf>,
    }

    impl Job for Sleepy {
        fn title(&self) -> String {
            "sleepy".into()
        }
        fn lane(&self) -> Lane {
            self.lane
        }
        fn run(self: Box<Self>, ctx: JobContext) -> BoxFuture<Result<Vec<PathBuf>, JobError>> {
            Box::pin(async move {
                let running = self.now.fetch_add(1, Ordering::SeqCst) + 1;
                self.peak.fetch_max(running, Ordering::SeqCst);
                if let Some(temp) = &self.temp {
                    std::fs::write(temp, b"partial").unwrap();
                    ctx.track_temp(temp.clone());
                }
                ctx.report(Some(0.5), Some(self.ms / 2));
                let outcome = tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(self.ms)) => Ok(vec![]),
                    _ = ctx.cancelled() => Err(JobError::Cancelled),
                };
                self.now.fetch_sub(1, Ordering::SeqCst);
                outcome
            })
        }
    }

    struct Harness {
        queue: JobQueue,
        events: mpsc::UnboundedReceiver<JobInfo>,
        now: Arc<AtomicUsize>,
        peak: Arc<AtomicUsize>,
    }

    fn harness(limit: usize) -> Harness {
        let (tx, events) = mpsc::unbounded_channel();
        let spawn: Spawner = Arc::new(|future| {
            tokio::spawn(future);
        });
        let listener: Listener = Arc::new(move |info| {
            let _ = tx.send(info.clone());
        });
        Harness {
            queue: JobQueue::new(limit, spawn, listener),
            events,
            now: Arc::default(),
            peak: Arc::default(),
        }
    }

    impl Harness {
        fn job(&self, lane: Lane, ms: u64) -> Box<dyn Job> {
            Box::new(Sleepy {
                lane,
                ms,
                now: self.now.clone(),
                peak: self.peak.clone(),
                temp: None,
            })
        }

        /// Collects final states until `count` jobs have finished.
        async fn finished(&mut self, count: usize) -> Vec<JobInfo> {
            let mut done = Vec::new();
            while done.len() < count {
                let info = tokio::time::timeout(Duration::from_secs(5), self.events.recv())
                    .await
                    .expect("jobs finish in time")
                    .expect("queue alive");
                if info.state.is_finished() {
                    done.push(info);
                }
            }
            done
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn light_jobs_respect_the_limit() {
        let mut h = harness(2);
        for _ in 0..6 {
            h.queue.submit(h.job(Lane::Light, 40));
        }
        let done = h.finished(6).await;
        assert!(done
            .iter()
            .all(|info| matches!(info.state, JobState::Done { .. })));
        assert_eq!(h.peak.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn heavy_jobs_run_one_at_a_time_beside_light_ones() {
        let mut h = harness(4);
        let heavy_peak = Arc::new(AtomicUsize::new(0));
        let heavy_now = Arc::new(AtomicUsize::new(0));
        for _ in 0..3 {
            h.queue.submit(Box::new(Sleepy {
                lane: Lane::Heavy,
                ms: 30,
                now: heavy_now.clone(),
                peak: heavy_peak.clone(),
                temp: None,
            }));
        }
        h.queue.submit(h.job(Lane::Light, 30));
        h.finished(4).await;
        assert_eq!(heavy_peak.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn cancelling_a_running_job_deletes_its_temp_file() {
        let mut h = harness(1);
        let dir = tempfile::tempdir().unwrap();
        let temp = dir.path().join(".out.kento-part");
        let id = h.queue.submit(Box::new(Sleepy {
            lane: Lane::Light,
            ms: 5_000,
            now: h.now.clone(),
            peak: h.peak.clone(),
            temp: Some(temp.clone()),
        }));
        let queued = h.queue.submit(h.job(Lane::Light, 10));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(temp.exists());
        h.queue.cancel(queued);
        h.queue.cancel(id);
        let done = h.finished(2).await;
        assert!(done.iter().all(|info| info.state == JobState::Cancelled));
        assert!(!temp.exists());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn pausing_holds_new_jobs_until_resumed() {
        let mut h = harness(2);
        h.queue.set_paused(true);
        h.queue.submit(h.job(Lane::Light, 10));
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert!(h
            .queue
            .snapshot()
            .iter()
            .all(|info| info.state == JobState::Queued));
        h.queue.set_paused(false);
        let done = h.finished(1).await;
        assert!(matches!(done[0].state, JobState::Done { .. }));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_closed_queue_refuses_new_jobs_and_finishes_the_others() {
        let mut h = harness(1);
        h.queue.submit(h.job(Lane::Light, 60));
        h.queue.submit(h.job(Lane::Light, 10));
        assert_eq!(h.queue.unfinished(), 2);
        h.queue.close("Kento güncelleniyor".into());
        let refused = h.queue.submit(h.job(Lane::Light, 10));
        let snapshot = h.queue.snapshot();
        let info = snapshot.iter().find(|info| info.id == refused).unwrap();
        assert_eq!(
            info.state,
            JobState::Failed {
                message: "Kento güncelleniyor".into(),
                details: None
            }
        );
        assert_eq!(h.queue.unfinished(), 2, "the refused job never waits");
        let done = h.finished(3).await;
        assert_eq!(
            done.iter()
                .filter(|info| matches!(info.state, JobState::Done { .. }))
                .count(),
            2,
            "the running and the queued job finish"
        );
        assert_eq!(h.queue.unfinished(), 0);
        assert_eq!(h.peak.load(Ordering::SeqCst), 1);

        h.queue.reopen();
        assert_eq!(h.queue.refusal(), None);
        h.queue.submit(h.job(Lane::Light, 10));
        let done = h.finished(1).await;
        assert!(matches!(done[0].state, JobState::Done { .. }));
    }

    #[test]
    fn job_info_serializes_flat_for_the_page() {
        let info = JobInfo {
            id: 3,
            title: "photo.heic".into(),
            lane: Lane::Light,
            state: JobState::Running {
                progress: Some(0.5),
                eta_ms: Some(1200),
            },
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["state"], "running");
        assert_eq!(json["etaMs"], 1200);
        assert_eq!(json["lane"], "light");
    }
}
