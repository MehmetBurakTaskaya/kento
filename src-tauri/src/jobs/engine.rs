// SPDX-License-Identifier: MIT
//! Jobs that run a local engine (SPEC 5.13, 5.14). The work runs on a blocking thread, writes
//! under a claimed name and takes its final name only when it succeeds; its scratch folder goes
//! when it ends, whatever the outcome.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use kento_engines::{Error, Progress};

use super::naming::{FolderReservation, Reservation};
use super::{BoxFuture, Job, JobContext, JobError, Lane};

/// Where a job's result goes.
#[derive(Debug, Clone)]
pub enum Target {
    File {
        dir: PathBuf,
        stem: String,
        extension: String,
    },
    Folder {
        dir: PathBuf,
        name: String,
    },
}

/// The engine call. It gets the path to write (a file, or an empty folder for `Target::Folder`),
/// a private scratch folder and the progress handle.
pub type Work = Box<dyn FnOnce(&Path, &Path, &Progress) -> kento_engines::Result<()> + Send>;

/// Turns an engine error into a sentence in the interface language.
pub type Explain = Arc<dyn Fn(&Error) -> String + Send + Sync>;

/// Gets the finished outputs (the Library records them).
pub type Done = Box<dyn FnOnce(&[PathBuf]) + Send>;

pub struct EngineJob {
    pub title: String,
    /// Heavy for LibreOffice, which runs one job at a time.
    pub lane: Lane,
    pub target: Target,
    /// The app's temp folder; each job works in its own folder inside.
    pub temp_root: PathBuf,
    pub work: Work,
    pub explain: Explain,
    pub done: Option<Done>,
}

impl Job for EngineJob {
    fn title(&self) -> String {
        self.title.clone()
    }

    fn lane(&self) -> Lane {
        self.lane
    }

    fn run(self: Box<Self>, ctx: JobContext) -> BoxFuture<Result<Vec<PathBuf>, JobError>> {
        Box::pin(async move {
            let explain = self.explain.clone();
            let outcome = tokio::task::spawn_blocking(move || self.run_blocking(&ctx)).await;
            let error = match outcome {
                Ok(Ok(outputs)) => return Ok(outputs),
                Ok(Err(Error::Cancelled)) => return Err(JobError::Cancelled),
                Ok(Err(error)) => error,
                Err(join) => Error::Other(join.to_string()),
            };
            tracing::warn!("job failed: {error}");
            Err(JobError::Explained {
                message: explain(&error),
                details: error.to_string(),
            })
        })
    }
}

impl EngineJob {
    fn run_blocking(self, ctx: &JobContext) -> kento_engines::Result<Vec<PathBuf>> {
        let temp = self.temp_root.join(format!("job-{}", ctx.id));
        fs::create_dir_all(&temp)?;
        let _scratch = RemoveOnDrop(temp.clone());
        let meter = Meter::new(ctx);
        let report = |fraction: Option<f32>| meter.report(fraction);
        let cancelled = || ctx.is_cancelled();
        let progress = Progress::new(&report, &cancelled);
        let outputs = vec![write(self.target, self.work, &temp, &progress)?];
        if let Some(done) = self.done {
            done(&outputs);
        }
        Ok(outputs)
    }
}

/// Runs `work` under a claimed name in `target` and gives the result its final name; on failure
/// or cancellation nothing is left behind. The command line runs its jobs this way too.
pub fn write(
    target: Target,
    work: Work,
    temp: &Path,
    progress: &Progress,
) -> kento_engines::Result<PathBuf> {
    Ok(match target {
        Target::File {
            dir,
            stem,
            extension,
        } => {
            let reservation = Reservation::claim(&dir, &stem, &extension)?;
            work(reservation.temp_path(), temp, progress)?;
            progress.check()?;
            reservation.commit()?
        }
        Target::Folder { dir, name } => {
            let reservation = FolderReservation::claim(&dir, &name)?;
            work(reservation.temp_path(), temp, progress)?;
            progress.check()?;
            reservation.commit()?
        }
    })
}

/// Passes progress on at most every 100 ms or 1 %, with a time-left estimate once the job is a
/// little way in; engines may report per page or per archive entry.
struct Meter<'a> {
    ctx: &'a JobContext,
    started: Instant,
    last: Mutex<(f32, Option<Instant>)>,
}

impl<'a> Meter<'a> {
    fn new(ctx: &'a JobContext) -> Self {
        Self {
            ctx,
            started: Instant::now(),
            last: Mutex::new((0.0, None)),
        }
    }

    fn report(&self, fraction: Option<f32>) {
        let Some(fraction) = fraction else {
            self.ctx.report(None, None);
            return;
        };
        let now = Instant::now();
        let mut last = self.last.lock().unwrap_or_else(|p| p.into_inner());
        let due = last
            .1
            .is_none_or(|at| now.duration_since(at).as_millis() >= 100)
            || fraction - last.0 >= 0.01
            || fraction >= 1.0;
        if !due {
            return;
        }
        *last = (fraction, Some(now));
        drop(last);
        let elapsed = now.duration_since(self.started).as_millis() as f32;
        let eta = ((0.05..1.0).contains(&fraction) && elapsed >= 1000.0)
            .then(|| (elapsed * (1.0 - fraction) / fraction) as u64);
        self.ctx.report(Some(fraction), eta);
    }
}

struct RemoveOnDrop(PathBuf);

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::{JobQueue, JobState};
    use std::sync::mpsc;

    fn queue() -> (JobQueue, mpsc::Receiver<JobState>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let queue = JobQueue::new(
            2,
            Arc::new(|future| {
                tokio::spawn(future);
            }),
            Arc::new(move |info| {
                let _ = tx.lock().unwrap().send(info.state.clone());
            }),
        );
        (queue, rx)
    }

    fn finished(rx: &mpsc::Receiver<JobState>) -> JobState {
        loop {
            let state = rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
            if state.is_finished() {
                return state;
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_file_job_writes_its_output_and_cleans_its_scratch_folder() {
        let dir = tempfile::tempdir().unwrap();
        let temp = dir.path().join("temp");
        let (queue, rx) = queue();
        let (seen_tx, seen_rx) = mpsc::channel();
        queue.submit(Box::new(EngineJob {
            title: "Kento ğüşıöç 🧪.txt → MD".into(),
            lane: Lane::Light,
            target: Target::File {
                dir: dir.path().to_path_buf(),
                stem: "Kento ğüşıöç 🧪".into(),
                extension: "md".into(),
            },
            temp_root: temp.clone(),
            work: Box::new(|dest, scratch, progress| {
                assert!(scratch.is_dir());
                progress.report(0.5);
                fs::write(dest, "# done")?;
                Ok(())
            }),
            explain: Arc::new(|_| "failed".into()),
            done: Some(Box::new(move |outputs| {
                seen_tx.send(outputs.to_vec()).unwrap();
            })),
        }));
        let JobState::Done { outputs } = finished(&rx) else {
            panic!("the job did not finish");
        };
        assert_eq!(outputs[0], dir.path().join("Kento ğüşıöç 🧪.md"));
        assert_eq!(fs::read_to_string(&outputs[0]).unwrap(), "# done");
        assert_eq!(seen_rx.recv().unwrap(), outputs);
        assert_eq!(fs::read_dir(&temp).unwrap().count(), 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_failed_folder_job_explains_itself_and_leaves_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let (queue, rx) = queue();
        queue.submit(Box::new(EngineJob {
            title: "archive.zip".into(),
            lane: Lane::Heavy,
            target: Target::Folder {
                dir: dir.path().to_path_buf(),
                name: "archive".into(),
            },
            temp_root: dir.path().join("temp"),
            work: Box::new(|dest, _, _| {
                fs::write(dest.join("half.txt"), "x")?;
                Err(Error::Encrypted)
            }),
            explain: Arc::new(|error| format!("plain: {error}")),
            done: None,
        }));
        let JobState::Failed { message, details } = finished(&rx) else {
            panic!("the job did not fail");
        };
        assert_eq!(message, "plain: the file is password protected");
        assert_eq!(details.as_deref(), Some("the file is password protected"));
        let left: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("temp")]);
    }
}
