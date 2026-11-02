// SPDX-License-Identifier: MIT
//! `kento --smoke-test`: starts the app without showing it, checks the parts that exist so far and
//! writes a JSON report to the data folder (smoke-test.json), then quits with 0 when all passed.
//! The media check runs only where FFmpeg is installed or found, the office check only where
//! LibreOffice is.

use std::io::Write;
use std::path::{Path, PathBuf};
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

/// A second of silence written as a WAV by hand, converted to MP3 and probed back, when the media
/// tools are installed or found.
fn media(dir: &Path, tools: kento_engines::Tools) -> Result<String, String> {
    use kento_engines as e;
    let rate: u32 = 8000;
    let data = vec![0u8; rate as usize * 2];
    // 16-bit mono PCM: the RIFF header, the format chunk, then the samples.
    let mut wav = Vec::with_capacity(44 + data.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
    wav.extend_from_slice(&data);
    let input = dir.join("sessiz ğüş 🧪.wav");
    std::fs::write(&input, &wav).map_err(|err| err.to_string())?;
    let output = dir.join("sessiz.mp3");
    let options = e::Options {
        tools: tools.clone(),
        ..e::Options::default()
    };
    e::convert(&e::Conversion {
        input: &input,
        from: "wav",
        to: "mp3",
        dest: &output,
        temp: dir,
        options: &options,
        progress: &e::Progress::none(),
    })
    .map_err(|err| format!("wav → mp3: {err}"))?;
    let info = e::media::probe(&tools, &output).map_err(|err| err.to_string())?;
    if info.audio.is_none() || !(0.8..1.5).contains(&info.duration) {
        return Err(format!("unexpected result: {info:?}"));
    }
    Ok("wav → mp3 with FFmpeg, probed back".into())
}

/// A short text turned into a Word document and that into a PDF by LibreOffice, then read back
/// with PDFium, when the Office tools are installed or found. The profile is the one jobs use,
/// so this also makes it ready.
fn office(dir: &Path, tools: kento_engines::Tools, profile: PathBuf) -> Result<String, String> {
    use kento_engines as e;
    let options = e::Options {
        tools,
        office_profile: Some(profile),
        ..e::Options::default()
    };
    let run = |input: &Path, from: &str, to: &str, dest: &Path| {
        e::convert(&e::Conversion {
            input,
            from,
            to,
            dest,
            temp: dir,
            options: &options,
            progress: &e::Progress::none(),
        })
        .map_err(|err| format!("{from} → {to}: {err}"))
    };
    let txt = dir.join("mektup ğüş 🧪.txt");
    std::fs::write(&txt, "Kento çark\n").map_err(|err| err.to_string())?;
    let docx = dir.join("mektup.docx");
    run(&txt, "txt", "docx", &docx)?;
    let pdf = dir.join("mektup.pdf");
    run(&docx, "docx", "pdf", &pdf)?;
    let pages = e::pdf::page_count(&pdf).map_err(|err| err.to_string())?;
    if pages != 1 {
        return Err(format!("{pages} pages from one line of text"));
    }
    let back = dir.join("geri.txt");
    run(&pdf, "pdf", "txt", &back)?;
    let text = std::fs::read_to_string(&back).map_err(|err| err.to_string())?;
    if !text.contains("Kento çark") {
        return Err(format!("the PDF reads {text:?}"));
    }
    Ok("txt → docx → pdf with LibreOffice, read back with PDFium".into())
}

/// The image editors, Compress and Metadata on files made here: a picture drawn from SVG, cropped
/// and marked up with text (which needs the system's fonts), a JPG compressed, and a PDF's title
/// written and read back.
fn image_tools(dir: &Path) -> Result<String, String> {
    use kento_engines as e;
    use kento_engines::image::tools::{ImageRun, ImageTool, Mark};
    use kento_engines::media::Area;
    let options = e::Options::default();
    let progress = e::Progress::none();
    let io = |err: std::io::Error| err.to_string();
    let svg = dir.join("Kento ğüşıöç 🧪.svg");
    std::fs::write(
        &svg,
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><defs><linearGradient id="g"><stop offset="0" stop-color="#2a4ea6"/><stop offset="1" stop-color="#e8b04a"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><circle cx="160" cy="120" r="70" fill="#fff" opacity="0.6"/></svg>"##,
    )
    .map_err(io)?;
    let convert = |input: &Path, from: &str, to: &str, dest: &Path| {
        e::convert(&e::Conversion {
            input,
            from,
            to,
            dest,
            temp: dir,
            options: &options,
            progress: &progress,
        })
        .map_err(|err| format!("{from} → {to}: {err}"))
    };
    let png = dir.join("resim.png");
    convert(&svg, "svg", "png", &png)?;
    let tool = |tool: ImageTool, dest: &Path| {
        e::image::tools::run_tool(&ImageRun {
            inputs: &[(png.clone(), "png".into())],
            tool: &tool,
            dest,
            temp: dir,
            options: &options,
            progress: &progress,
        })
        .map_err(|err| format!("{}: {err}", tool.id()))
    };
    let area = Area {
        x: 40.0,
        y: 20.0,
        width: 200.0,
        height: 150.0,
    };
    let cropped = dir.join("kırpılmış.png");
    tool(ImageTool::CropImage { area }, &cropped)?;
    let marked = dir.join("işaretli.png");
    let text = Mark::Text {
        at: [20.0, 20.0],
        text: "Çark ğüş".into(),
        color: [200, 30, 30, 255],
        size: 32.0,
    };
    tool(ImageTool::Markup { marks: vec![text] }, &marked)?;
    let jpg = dir.join("foto.jpg");
    convert(&png, "png", "jpg", &jpg)?;
    let small = dir.join("foto küçük.jpg");
    e::compress::compress(&e::compress::CompressRun {
        input: &jpg,
        from: "jpg",
        kind: e::FileKind::Image,
        compression: e::compress::Compression::Quality { level: 30 },
        dest: &small,
        temp: dir,
        options: &options,
        progress: &progress,
    })
    .map_err(|err| format!("compress: {err}"))?;
    let pdf = dir.join("belge.pdf");
    convert(&png, "png", "pdf", &pdf)?;
    let titled = dir.join("belge başlıklı.pdf");
    let change = e::metadata::MetadataChange {
        set: [("title".to_string(), "Kento ğüş 🧪".to_string())].into(),
        ..Default::default()
    };
    e::metadata::write(&e::metadata::MetadataRun {
        input: &pdf,
        from: "pdf",
        kind: e::FileKind::Pdf,
        change: &change,
        dest: &titled,
        temp: dir,
        tools: &options.tools,
        progress: &progress,
    })
    .map_err(|err| format!("metadata: {err}"))?;
    let info = e::metadata::read(&titled, "pdf", e::FileKind::Pdf, &options.tools)
        .map_err(|err| format!("metadata read: {err}"))?;
    let titled_back = info
        .fields
        .iter()
        .any(|field| field.key == "title" && field.value == "Kento ğüş 🧪");
    let size = |path: &Path| std::fs::metadata(path).map(|m| m.len()).map_err(io);
    if size(&small)? >= size(&jpg)? || !titled_back {
        return Err("compress or metadata gave an unexpected result".into());
    }
    let same = std::fs::read(&marked).map_err(io)? == std::fs::read(&png).map_err(io)?;
    if same || size(&cropped)? == 0 {
        return Err("crop or mark up changed nothing".into());
    }
    Ok("crop, mark up with text, JPG compress, PDF title written and read back".into())
}

/// Runs a chain of real conversions through the engines: an SVG drawn to PNG, then JPG and PDF,
/// the PDF's page back to PNG (this needs the bundled PDFium), Markdown to HTML, and a ZIP made
/// and extracted. Names carry Turkish letters and an emoji (SPEC 5.14).
fn engines(dir: &Path) -> Result<String, String> {
    use kento_engines as e;
    let options = e::Options::default();
    let progress = e::Progress::none();
    let run = |input: &Path, from: &str, to: &str, dest: &Path| {
        e::convert(&e::Conversion {
            input,
            from,
            to,
            dest,
            temp: dir,
            options: &options,
            progress: &progress,
        })
        .map_err(|err| format!("{from} → {to}: {err}"))
    };
    let io = |err: std::io::Error| err.to_string();
    let svg = dir.join("Kento ğüşıöç 🧪.svg");
    std::fs::write(
        &svg,
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#2a4ea6"/></svg>"##,
    )
    .map_err(io)?;
    let png = dir.join("logo.png");
    run(&svg, "svg", "png", &png)?;
    run(&png, "png", "jpg", &dir.join("logo.jpg"))?;
    let pdf = dir.join("logo.pdf");
    run(&png, "png", "pdf", &pdf)?;
    let pages = dir.join("sayfalar");
    std::fs::create_dir(&pages).map_err(io)?;
    let shots = run(&pdf, "pdf", "png", &pages)?;
    let md = dir.join("not ğüş.md");
    std::fs::write(&md, "# Kento\n\n- çark\n").map_err(io)?;
    let html = dir.join("not ğüş.html");
    run(&md, "md", "html", &html)?;
    if !std::fs::read_to_string(&html).map_err(io)?.contains("<h1>") {
        return Err("md → html lost the heading".into());
    }
    let zip = dir.join("paket.zip");
    e::archive::create_zip(&[md, png], &zip, &progress).map_err(|err| err.to_string())?;
    let out = dir.join("açılan");
    std::fs::create_dir(&out).map_err(io)?;
    let files = e::archive::extract(&zip, "zip", &out, &options.archive_limits, &progress)
        .map_err(|err| err.to_string())?;
    if shots.len() != 1 || files.len() != 2 {
        return Err(format!(
            "{} page images, {} extracted files",
            shots.len(),
            files.len()
        ));
    }
    Ok("svg → png → jpg and pdf, pdf → png with PDFium, md → html, zip made and extracted".into())
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
                JobState::Failed { message, .. } => {
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

    let dir = scratch.join("engines");
    let engine_result = match std::fs::create_dir_all(&dir) {
        Ok(()) => tauri::async_runtime::spawn_blocking(move || engines(&dir))
            .await
            .unwrap_or_else(|err| Err(err.to_string())),
        Err(err) => Err(err.to_string()),
    };
    checks.push(check("engines", engine_result));

    let dir = scratch.join("image tools");
    let image_result = match std::fs::create_dir_all(&dir) {
        Ok(()) => tauri::async_runtime::spawn_blocking(move || image_tools(&dir))
            .await
            .unwrap_or_else(|err| Err(err.to_string())),
        Err(err) => Err(err.to_string()),
    };
    checks.push(check("image tools", image_result));

    let tools = crate::toolchain::engine_tools(&state);
    let dir = scratch.join("media");
    let media_result = match (tools.ffmpeg.is_some(), std::fs::create_dir_all(&dir)) {
        (false, _) => Ok("skipped: no media tools on this computer".into()),
        (true, Ok(())) => tauri::async_runtime::spawn_blocking(move || media(&dir, tools))
            .await
            .unwrap_or_else(|err| Err(err.to_string())),
        (true, Err(err)) => Err(err.to_string()),
    };
    checks.push(check("media", media_result));

    let tools = crate::toolchain::engine_tools(&state);
    let profile = state.paths.office_profile();
    let dir = scratch.join("office");
    let office_result = match (tools.soffice.is_some(), std::fs::create_dir_all(&dir)) {
        (false, _) => Ok("skipped: no Office tools on this computer".into()),
        (true, Ok(())) => {
            tauri::async_runtime::spawn_blocking(move || office(&dir, tools, profile))
                .await
                .unwrap_or_else(|err| Err(err.to_string()))
        }
        (true, Err(err)) => Err(err.to_string()),
    };
    checks.push(check("office", office_result));

    checks.push(check(
        "floating wheel",
        match app.get_webview_window(crate::overlay::wheel::LABEL) {
            Some(wheel) if crate::overlay::is_parked(&wheel) => Ok("ready off screen".into()),
            Some(_) => Err("on screen while idle".into()),
            None => Err("the window is missing".into()),
        },
    ));

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
