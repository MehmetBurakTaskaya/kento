// SPDX-License-Identifier: MIT
//! `kento --smoke-test`: starts the app without showing it, checks the parts that exist so far and
//! writes a JSON report to the data folder (smoke-test.json), then quits with 0 when all passed.
//! Later phases add the wheel, drag and drop, the editors and exports.

use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::jobs::naming::Reservation;
use crate::jobs::{BoxFuture, Job, JobContext, JobError, JobState};
use crate::{catalog, i18n, settings, window, AppState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Check {
    name: &'static str,
    passed: bool,
    detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    version: String,
    platform: &'static str,
    passed: bool,
    duration_ms: u128,
    checks: Vec<Check>,
}

/// A job that writes one small file through a reservation, the way real jobs will.
struct Probe(PathBuf);

impl Job for Probe {
    fn title(&self) -> String {
        "smoke test".into()
    }

    fn run(self: Box<Self>, ctx: JobContext) -> BoxFuture<Result<Vec<PathBuf>, JobError>> {
        Box::pin(async move {
            let fail = |err: std::io::Error| JobError::Failed(err.to_string());
            let reservation =
                Reservation::claim(&self.0, "Kento ğüşıöç 🧪 probe", "txt").map_err(fail)?;
            ctx.track_temp(reservation.temp_path().to_path_buf());
            reservation
                .create_temp()
                .map_err(fail)?
                .write_all(b"ok")
                .map_err(fail)?;
            ctx.report(Some(1.0), Some(0));
            Ok(vec![reservation.commit().map_err(fail)?])
        })
    }
}

fn check(name: &'static str, result: Result<String, String>) -> Check {
    match result {
        Ok(detail) => Check {
            name,
            passed: true,
            detail,
        },
        Err(detail) => Check {
            name,
            passed: false,
            detail,
        },
    }
}

pub async fn run(app: AppHandle) -> bool {
    let started = Instant::now();
    let state = app.state::<AppState>();
    let mut checks = Vec::new();

    let scratch = state.paths.temp.join("smoke-test");
    checks.push(check(
        "data folder",
        std::fs::create_dir_all(&scratch)
            .map(|_| scratch.display().to_string())
            .map_err(|e| e.to_string()),
    ));

    let file = scratch.join("settings.json");
    let probe = settings::Settings {
        language: "tr".into(),
        ..settings::Settings::default()
    };
    checks.push(check(
        "settings round trip",
        settings::save(&file, &probe)
            .map_err(|e| e.to_string())
            .and_then(|_| {
                if settings::load(&file) == probe {
                    Ok("saved and read back".into())
                } else {
                    Err("differs".into())
                }
            }),
    ));

    let languages: Vec<&str> = i18n::available().iter().map(|l| l.code).collect();
    checks.push(check(
        "languages",
        if languages.contains(&"en") && languages.contains(&"tr") {
            Ok(languages.join(", "))
        } else {
            Err(format!("only {languages:?}"))
        },
    ));

    let problems = catalog::problems();
    let summary = catalog::summary();
    checks.push(check(
        "catalog",
        if problems.is_empty() {
            Ok(format!(
                "{} formats, {} routes, {} tools, {} actions",
                summary.formats, summary.routes, summary.tools, summary.actions
            ))
        } else {
            Err(problems.join("; "))
        },
    ));

    let id = state.queue.submit(Box::new(Probe(scratch.clone())));
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut outcome = Err("timed out".to_string());
    while Instant::now() < deadline {
        if let Some(info) = state
            .queue
            .snapshot()
            .into_iter()
            .find(|info| info.id == id)
        {
            match info.state {
                JobState::Done { outputs } => {
                    let ok = outputs.first().is_some_and(|p| {
                        std::fs::read(p).ok().as_deref() == Some(b"ok".as_slice())
                    });
                    outcome = if ok {
                        Ok("a job wrote its output through a reservation".into())
                    } else {
                        Err("output missing".into())
                    };
                    break;
                }
                JobState::Failed { message } => {
                    outcome = Err(message);
                    break;
                }
                JobState::Cancelled => {
                    outcome = Err("cancelled".into());
                    break;
                }
                _ => {}
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    checks.push(check("job queue and naming", outcome));

    let settings = state.settings();
    checks.push(check(
        "tray",
        if !settings.tray_icon || app.tray_by_id("kento").is_some() {
            Ok(if settings.tray_icon {
                "icon created".into()
            } else {
                "switched off in settings".into()
            })
        } else {
            Err("the icon is missing".into())
        },
    ));

    let _ = window::show_main(&app, Some("hidden"));
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut built = false;
    while Instant::now() < deadline {
        if app.get_webview_window(window::MAIN).is_some() {
            built = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    checks.push(check(
        "main window",
        if built {
            Ok(format!("created hidden; Mica {}", window::supports_mica()))
        } else {
            Err("not created".into())
        },
    ));

    let _ = std::fs::remove_dir_all(&scratch);
    let passed = checks.iter().all(|c| c.passed);
    let report = Report {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        passed,
        duration_ms: started.elapsed().as_millis(),
        checks,
    };
    let path = state.paths.data.join("smoke-test.json");
    match serde_json::to_vec_pretty(&report) {
        Ok(json) => {
            if let Err(err) = std::fs::write(&path, json) {
                tracing::error!("smoke test report not written: {err}");
            }
        }
        Err(err) => tracing::error!("smoke test report not written: {err}"),
    }
    tracing::info!(
        "smoke test {} ({})",
        if passed { "passed" } else { "failed" },
        path.display()
    );
    println!("{}", path.display());
    passed
}
