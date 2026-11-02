// SPDX-License-Identifier: MIT
//! The core tools as jobs (SPEC 5.5): Merge PDFs, Split PDF, Edit PDF, PDF from images, Extract
//! archive, Read QR codes and Make a QR code. Tools name their outputs with a translated suffix
//! (SPEC 5.14): "report - merged.pdf".

use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use kento_engines::{archive, pdf, qr, Options};
use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::catalog::{self, Category, Format};
use crate::error::{Error, Result};
use crate::jobs::engine::{Target, Work};
use crate::jobs::naming::{file_name, Reservation};
use crate::library::{Entry, Origin};
use crate::work::{stem_of, Context};
use crate::{i18n, AppState};

/// The files of a request, each with its format, all of the given categories.
fn checked(paths: &[PathBuf], categories: &[Category]) -> Result<Vec<(PathBuf, &'static Format)>> {
    if paths.is_empty() {
        return Err(Error::Invalid("no files".into()));
    }
    paths
        .iter()
        .map(|path| {
            let format = path
                .is_file()
                .then(|| path.extension())
                .flatten()
                .and_then(|ext| catalog::format_for_extension(&ext.to_string_lossy()))
                .filter(|format| categories.contains(&format.category))
                .ok_or_else(|| Error::Invalid("a file of the wrong kind".into()))?;
            Ok((path.clone(), format))
        })
        .collect()
}

/// "Merge PDFs · report.pdf +2".
fn title(ctx: &Context, tool: &str, paths: &[PathBuf]) -> String {
    let first = paths
        .first()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let more = if paths.len() > 1 {
        format!(" +{}", paths.len() - 1)
    } else {
        String::new()
    };
    format!("{} · {first}{more}", ctx.text(&format!("tool.{tool}")))
}

/// "report" and "merged" → "report - merged".
fn suffixed(ctx: &Context, source: &Path, suffix_key: &str) -> String {
    file_name(&stem_of(source), Some(&ctx.text(suffix_key)), "")
}

#[tauri::command]
pub fn merge_pdfs(app: AppHandle, state: State<'_, AppState>, paths: Vec<PathBuf>) -> Result<u64> {
    checked(&paths, &[Category::Pdf])?;
    if paths.len() < 2 {
        return Err(Error::Invalid("merging needs two PDFs or more".into()));
    }
    let ctx = Context::new(&app, &state)?;
    let first = paths[0].clone();
    let target = Target::File {
        dir: ctx.dir_for(&first),
        stem: suffixed(&ctx, &first, "suffix.merged"),
        extension: "pdf".into(),
    };
    let title = title(&ctx, "merge-pdf", &paths);
    let work: Work = Box::new(move |dest, _, progress| pdf::merge(&paths, dest, progress));
    Ok(ctx.submit(title, target, work, Origin::Tool, Some(first)))
}

/// How the page asks to split: `{ "kind": "ranges", "ranges": [[1, 3], [5, 5]] }` (1-based)
/// or `{ "kind": "every", "pages": 2 }`.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SplitHow {
    Ranges { ranges: Vec<(usize, usize)> },
    Every { pages: usize },
}

#[tauri::command]
pub fn split_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    path: PathBuf,
    how: SplitHow,
) -> Result<u64> {
    checked(std::slice::from_ref(&path), &[Category::Pdf])?;
    let how = match how {
        SplitHow::Ranges { ranges } if !ranges.is_empty() => pdf::Split::Ranges(
            ranges
                .into_iter()
                .map(|(a, b)| RangeInclusive::new(a, b))
                .collect(),
        ),
        SplitHow::Every { pages } if pages > 0 => pdf::Split::Every(pages),
        _ => return Err(Error::Invalid("nothing to split by".into())),
    };
    let ctx = Context::new(&app, &state)?;
    let target = Target::Folder {
        dir: ctx.dir_for(&path),
        name: suffixed(&ctx, &path, "suffix.split"),
    };
    let title = title(&ctx, "split-pdf", std::slice::from_ref(&path));
    let input = path.clone();
    let work: Work =
        Box::new(move |dest, _, progress| pdf::split(&input, how, dest, progress).map(|_| ()));
    Ok(ctx.submit(title, target, work, Origin::Tool, Some(path)))
}

#[derive(Debug, Deserialize)]
pub struct PageEditIn {
    index: usize,
    rotate: i32,
}

#[tauri::command]
pub fn edit_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    path: PathBuf,
    pages: Vec<PageEditIn>,
) -> Result<u64> {
    checked(std::slice::from_ref(&path), &[Category::Pdf])?;
    if pages.is_empty() {
        return Err(Error::Invalid("a PDF needs at least one page".into()));
    }
    let pages: Vec<pdf::PageEdit> = pages
        .into_iter()
        .map(|page| pdf::PageEdit {
            index: page.index,
            rotate: page.rotate,
        })
        .collect();
    let ctx = Context::new(&app, &state)?;
    let target = Target::File {
        dir: ctx.dir_for(&path),
        stem: suffixed(&ctx, &path, "suffix.edited"),
        extension: "pdf".into(),
    };
    let title = title(&ctx, "edit-pdf", std::slice::from_ref(&path));
    let input = path.clone();
    let work: Work = Box::new(move |dest, _, progress| pdf::edit(&input, &pages, dest, progress));
    Ok(ctx.submit(title, target, work, Origin::Tool, Some(path)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageLayoutIn {
    size: String,
    margin_mm: f32,
}

#[tauri::command]
pub fn images_to_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<PathBuf>,
    layout: PageLayoutIn,
) -> Result<u64> {
    let inputs: Vec<(PathBuf, String)> = checked(&paths, &[Category::Image])?
        .into_iter()
        .map(|(path, format)| (path, format.id.to_string()))
        .collect();
    let layout = pdf::PageLayout {
        size: match layout.size.as_str() {
            "a4" => pdf::PageSize::A4,
            "letter" => pdf::PageSize::Letter,
            _ => pdf::PageSize::FitImage,
        },
        margin_mm: layout.margin_mm.clamp(0.0, 50.0),
    };
    let ctx = Context::new(&app, &state)?;
    let first = paths[0].clone();
    let target = Target::File {
        dir: ctx.dir_for(&first),
        stem: stem_of(&first),
        extension: "pdf".into(),
    };
    let title = title(&ctx, "images-to-pdf", &paths);
    let options = Options {
        tools: ctx.tools(),
        ..Options::default()
    };
    let work: Work = Box::new(move |dest, _, progress| {
        pdf::from_images(&inputs, &layout, dest, &options, progress)
    });
    Ok(ctx.submit(title, target, work, Origin::Tool, Some(first)))
}

/// Extracts each archive into a new folder named after it, one job per archive.
#[tauri::command]
pub fn extract_archives(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    paths: Vec<PathBuf>,
) -> Result<Vec<u64>> {
    let archives = checked(&paths, &[Category::Archive])?;
    let ctx = Context::new(&app, &state)?;
    let ids: Vec<u64> = archives
        .into_iter()
        .map(|(path, format)| {
            let target = Target::Folder {
                dir: ctx.dir_for(&path),
                name: stem_of(&path),
            };
            let title = title(&ctx, "extract", std::slice::from_ref(&path));
            let (input, from) = (path.clone(), format.id);
            let work: Work = Box::new(move |dest, _, progress| {
                let options = Options::default();
                archive::extract(&input, from, dest, &options.archive_limits, progress).map(|_| ())
            });
            ctx.submit(title, target, work, Origin::Tool, Some(path))
        })
        .collect();
    crate::actions::watch(&window, &state, &ids);
    Ok(ids)
}

#[tauri::command]
pub async fn pdf_pages(path: PathBuf) -> Result<usize> {
    checked(std::slice::from_ref(&path), &[Category::Pdf])?;
    blocking(move || pdf::page_count(&path)).await
}

/// A page preview for the Edit PDF grid.
#[tauri::command]
pub async fn pdf_thumbnail(path: PathBuf, index: usize, size: u32) -> Result<Response> {
    checked(std::slice::from_ref(&path), &[Category::Pdf])?;
    let size = size.clamp(32, 1024);
    let png = blocking(move || kento_engines::thumb::pdf_page(&path, index, size)).await?;
    Ok(Response::new(png))
}

/// One QR code as the page sends it back for a report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoundCode {
    file: PathBuf,
    page: Option<usize>,
    text: String,
}

/// Reads QR codes in images and PDF pages; the panel shows them before any report is saved.
#[tauri::command]
pub async fn scan_qr(state: State<'_, AppState>, paths: Vec<PathBuf>) -> Result<Vec<FoundCode>> {
    let tools = crate::work::engine_tools(&state);
    let inputs: Vec<(PathBuf, String)> = checked(&paths, &[Category::Image, Category::Pdf])?
        .into_iter()
        .map(|(path, format)| (path, format.id.to_string()))
        .collect();
    let found = blocking(move || {
        let options = Options {
            tools,
            ..Options::default()
        };
        qr::read(&inputs, &options, &kento_engines::Progress::none())
    })
    .await?;
    Ok(found
        .into_iter()
        .map(|code| FoundCode {
            file: code.file,
            page: code.page,
            text: code.text,
        })
        .collect())
}

/// Saves the codes as "photo - QR codes.txt" (or .csv, .json) next to the first scanned file.
#[tauri::command]
pub fn save_qr_report(
    app: AppHandle,
    state: State<'_, AppState>,
    found: Vec<FoundCode>,
    report: String,
) -> Result<Entry> {
    let (kind, extension) = match report.as_str() {
        "csv" => (qr::Report::Csv, "csv"),
        "json" => (qr::Report::Json, "json"),
        _ => (qr::Report::Txt, "txt"),
    };
    let first = found
        .first()
        .map(|code| code.file.clone())
        .ok_or_else(|| Error::Invalid("no codes to save".into()))?;
    let ctx = Context::new(&app, &state)?;
    let reservation = Reservation::claim(
        &ctx.dir_for(&first),
        &suffixed(&ctx, &first, "suffix.qr"),
        extension,
    )?;
    let codes: Vec<qr::Found> = found
        .into_iter()
        .map(|code| qr::Found {
            file: code.file,
            page: code.page,
            text: code.text,
        })
        .collect();
    qr::write_report(&codes, kind, reservation.temp_path())
        .map_err(|err| Error::Invalid(err.to_string()))?;
    let path = reservation.commit()?;
    let item = state
        .library
        .add(Origin::Tool, Some(&first), std::slice::from_ref(&path));
    let _ = app.emit("library", ());
    let id = item.first().map(|item| item.id).unwrap_or_default();
    state
        .library
        .entries()
        .into_iter()
        .find(|entry| entry.item.id == id)
        .ok_or_else(|| Error::Invalid(i18n::text(&state.lang(), "error.other")))
}

/// More than any QR code holds (2953 bytes at its lowest correction): the preview says so without
/// encoding a whole pasted book.
const QR_TEXT_LIMIT: usize = 4096;

/// What the Make a QR code panel shows while the text and the style change.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPreview {
    /// The code as an SVG, when it can be made.
    svg: Option<String>,
    /// Why it cannot.
    problem: Option<qr::Problem>,
    /// WCAG's ratio of the two colours, 1 to 21.
    contrast: f64,
    /// Light modules on a dark background, which some readers miss.
    inverted: bool,
}

/// The code for the text as it stands, drawn by the same code that writes the file.
#[tauri::command]
pub fn qr_preview(text: String, style: qr::Style) -> QrPreview {
    let found = if text.len() > QR_TEXT_LIMIT {
        Err(qr::Problem::TooLong)
    } else {
        qr::check(&text, &style)
    };
    QrPreview {
        svg: found.as_ref().ok().map(|modules| qr::svg(modules, &style)),
        problem: found.err(),
        contrast: qr::contrast(style.dark, style.light),
        inverted: qr::inverted(&style),
    }
}

/// Saves the code as "example.com - QR code.png" (or .svg) in the default folder, or one the
/// user picked in the folder dialog.
#[tauri::command]
pub fn make_qr(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    text: String,
    style: qr::Style,
    picture: qr::Picture,
    folder: Option<PathBuf>,
) -> Result<u64> {
    if text.len() > QR_TEXT_LIMIT {
        return Err(Error::Invalid("the text is too long for a QR code".into()));
    }
    if let Err(problem) = qr::check(&text, &style) {
        return Err(Error::Invalid(format!("no QR code: {problem:?}")));
    }
    let dir = crate::web::output_folder(&app, &state, folder.as_deref())?;
    let ctx = Context::new(&app, &state)?;
    let stem = file_name(&qr::name_for(&text), Some(&ctx.text("suffix.make-qr")), "");
    let title = format!("{} · {stem}", ctx.text("tool.make-qr"));
    let target = Target::File {
        dir,
        stem,
        extension: picture.extension().into(),
    };
    let work: Work = Box::new(move |dest, _, _| qr::make(&text, &style, picture, dest));
    let id = ctx.submit(title, target, work, Origin::Tool, None);
    crate::actions::watch(&window, &state, &[id]);
    Ok(id)
}

/// Text for the Make a QR code panel, handed from the floating wheel's link ring to the main
/// window, which takes it once it is ready.
static QR_PENDING: Mutex<Option<String>> = Mutex::new(None);

/// Opens Make a QR code in the main window for a link dropped on the wheel's QR slice.
#[tauri::command]
pub fn qr_open(app: AppHandle, text: String) -> Result<()> {
    if text.trim().is_empty() || text.len() > QR_TEXT_LIMIT {
        return Err(Error::Invalid("no text for a QR code".into()));
    }
    *QR_PENDING.lock().unwrap_or_else(|p| p.into_inner()) = Some(text);
    crate::window::show_main(&app, None)?;
    let _ = app.emit_to(crate::window::MAIN, "qr-open", ());
    Ok(())
}

/// The text the main window should open Make a QR code with, once.
#[tauri::command]
pub fn qr_take_pending() -> Option<String> {
    QR_PENDING.lock().unwrap_or_else(|p| p.into_inner()).take()
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> kento_engines::Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| Error::Invalid(err.to_string()))?
        .map_err(|err| Error::Invalid(err.to_string()))
}
