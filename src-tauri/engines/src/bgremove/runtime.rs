// SPDX-License-Identifier: MIT
//! ONNX Runtime and the model, kept while they are in use.
//!
//! The runtime is a library loaded into Kento from the path the toolchain gives, once per run of
//! Kento (a loaded library cannot be swapped); its telemetry is switched off. The model's session
//! is made on first use and dropped, with the masks found, after a minute without use, so Kento
//! waits in the tray without the model in memory. Masks are kept by file, so the panel's preview
//! and the saved result share one run of the model.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime};

use ::image::DynamicImage;
use ort::environment::Environment;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::{RunOptions, Session};
use ort::value::TensorRef;

use super::steps::{self, Mask};
use crate::{Error, Progress, Result};

/// How long an unused model stays in memory.
const IDLE: Duration = Duration::from_secs(60);
/// How often a running model is checked for a cancelled job.
const CANCEL_POLL: Duration = Duration::from_millis(100);
/// Masks kept for the next request (4 MB each).
const KEPT_MASKS: usize = 4;

/// A model session and when it was last used.
struct Loaded {
    model: PathBuf,
    session: Session,
    used: Instant,
}

/// One picture as it is now, for one model.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Key {
    model: PathBuf,
    path: PathBuf,
    len: u64,
    modified: Option<SystemTime>,
}

impl Key {
    /// An edited file gets a new key, so a changed picture is never cut out from an old mask.
    fn of(model: &Path, path: &Path) -> Result<Key> {
        let meta = std::fs::metadata(path)?;
        Ok(Key {
            model: model.to_path_buf(),
            path: path.to_path_buf(),
            len: meta.len(),
            modified: meta.modified().ok(),
        })
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Held while the model runs, so pictures go through it one at a time.
static SESSION: Mutex<Option<Loaded>> = Mutex::new(None);
/// The most recently used masks, oldest first.
static MASKS: Mutex<Vec<(Key, Arc<Mask>)>> = Mutex::new(Vec::new());
/// Whether a thread is waiting to let an unused model go.
static RELEASING: AtomicBool = AtomicBool::new(false);

/// The mask of the picture at `path` (decoded as `image`), from the model at `model` run by the
/// runtime at `runtime`: kept from an earlier request, or found now.
pub fn mask_of(
    runtime: &Path,
    model: &Path,
    path: &Path,
    image: &DynamicImage,
    progress: &Progress,
) -> Result<Arc<Mask>> {
    let key = Key::of(model, path)?;
    if let Some(mask) = kept(&key) {
        return Ok(mask);
    }
    let mut session = lock(&SESSION);
    // The preview of the same picture may have found it while this one waited.
    if let Some(mask) = kept(&key) {
        return Ok(mask);
    }
    progress.check()?;
    let loaded = match session.take() {
        Some(loaded) if loaded.model == model => loaded,
        _ => Loaded {
            model: model.to_path_buf(),
            session: open(runtime, model)?,
            used: Instant::now(),
        },
    };
    let loaded = session.insert(loaded);
    let input = steps::input(image);
    progress.report(0.2);
    let result = run(&mut loaded.session, &input, progress);
    loaded.used = Instant::now();
    drop(session);
    release_when_idle();
    let mask = Arc::new(result?);
    keep(key, mask.clone());
    Ok(mask)
}

fn kept(key: &Key) -> Option<Arc<Mask>> {
    let mut masks = lock(&MASKS);
    let index = masks.iter().position(|(k, _)| k == key)?;
    let entry = masks.remove(index);
    let mask = entry.1.clone();
    masks.push(entry);
    Some(mask)
}

fn keep(key: Key, mask: Arc<Mask>) {
    let mut masks = lock(&MASKS);
    masks.retain(|(k, _)| *k != key);
    masks.push((key, mask));
    let extra = masks.len().saturating_sub(KEPT_MASKS);
    masks.drain(..extra);
}

/// The ONNX Runtime environment, made once: a process can have only one, and the library stays
/// loaded anyway.
fn environment(runtime: &Path) -> Result<Environment> {
    static ENVIRONMENT: Mutex<Option<Environment>> = Mutex::new(None);
    let mut environment = lock(&ENVIRONMENT);
    if let Some(environment) = environment.as_ref() {
        return Ok(environment.clone());
    }
    let built = ort::init_from(runtime)
        .map_err(|err| Error::Other(format!("ONNX Runtime could not be loaded: {err}")))?
        .with_name("kento")
        .with_telemetry(false)
        .build()
        .map_err(failed)?;
    // Its messages reach Kento's log; the verbose ones would only fill it.
    built.set_log_level(ort::logging::LogLevel::Warning);
    tracing::info!("ONNX Runtime is loaded");
    Ok(environment.insert(built).clone())
}

/// A session for the model, on the computer's processor.
fn open(runtime: &Path, model: &Path) -> Result<Session> {
    let environment = environment(runtime)?;
    let started = Instant::now();
    let session = Session::builder(&environment)
        .map_err(failed)?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(failed)?
        .commit_from_file(model)
        .map_err(failed)?;
    tracing::info!(
        "the background-removal model is ready in {} ms",
        started.elapsed().as_millis()
    );
    Ok(session)
}

/// Runs the model once. A cancelled job stops it from another thread through its run options.
fn run(session: &mut Session, input: &[f32], progress: &Progress) -> Result<Mask> {
    let options = RunOptions::new().map_err(failed)?;
    let tensor = TensorRef::from_array_view((steps::input_shape(), input)).map_err(failed)?;
    let finished = AtomicBool::new(false);
    let cancelled = AtomicBool::new(false);
    let started = Instant::now();
    let result = std::thread::scope(|scope| {
        scope.spawn(|| {
            while !finished.load(Ordering::Acquire) {
                if progress.is_cancelled() {
                    cancelled.store(true, Ordering::Release);
                    if let Err(err) = options.terminate() {
                        tracing::warn!("the model could not be stopped: {err}");
                    }
                    return;
                }
                std::thread::sleep(CANCEL_POLL);
            }
        });
        let outputs = session.run_with_options(ort::inputs![tensor], &options);
        let result = outputs.map_err(failed).and_then(|outputs| {
            let (shape, values) = outputs[0].try_extract_tensor::<f32>().map_err(failed)?;
            steps::mask(shape, values)
        });
        finished.store(true, Ordering::Release);
        result
    });
    if cancelled.load(Ordering::Acquire) {
        return Err(Error::Cancelled);
    }
    tracing::info!(
        "the background-removal model ran in {} ms",
        started.elapsed().as_millis()
    );
    progress.report(0.85);
    result
}

/// Lets the model and the masks go once nothing has used them for a while, on a thread that ends
/// when it has done so.
fn release_when_idle() {
    if RELEASING.swap(true, Ordering::AcqRel) {
        return;
    }
    let started = std::thread::Builder::new()
        .name("bgremove-release".into())
        .spawn(|| loop {
            std::thread::sleep(IDLE / 4);
            let mut session = lock(&SESSION);
            let idle = session
                .as_ref()
                .is_none_or(|loaded| loaded.used.elapsed() >= IDLE);
            if idle {
                *session = None;
                lock(&MASKS).clear();
                RELEASING.store(false, Ordering::Release);
                tracing::info!("the background-removal model is released");
                return;
            }
        });
    if started.is_err() {
        RELEASING.store(false, Ordering::Release);
    }
}

fn failed<R>(err: ort::Error<R>) -> Error {
    Error::Other(format!("background removal: {err}"))
}
