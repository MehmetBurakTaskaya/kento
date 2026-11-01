// SPDX-License-Identifier: MIT
//! Kento: drag a file, press a modifier key, drop it on the wheel. This crate holds the app's core
//! (catalog, jobs, settings, languages) and its desktop shell (window, tray, single instance).

pub mod catalog;
pub mod commands;
pub mod error;
pub mod files;
pub mod i18n;
pub mod jobs;
pub mod library;
pub mod logging;
pub mod paths;
pub mod settings;
pub mod shelf;
mod smoke;
pub mod tools;
mod tray;
mod window;
pub mod work;

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tracing_appender::non_blocking::WorkerGuard;

use crate::jobs::{JobInfo, JobQueue, Listener, Spawner};
use crate::library::Library;
use crate::paths::AppPaths;
use crate::settings::Settings;
use crate::shelf::ShelfProvider;

pub struct AppState {
    pub paths: AppPaths,
    settings: Mutex<Settings>,
    pub system_locale: Option<String>,
    pub queue: JobQueue,
    pub shelf: Mutex<Box<dyn ShelfProvider>>,
    pub library: Library,
    _log: Option<WorkerGuard>,
}

impl AppState {
    pub fn settings(&self) -> Settings {
        self.settings
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// Replaces the settings and returns the previous ones.
    pub fn replace_settings(&self, new: Settings) -> Settings {
        std::mem::replace(
            &mut *self.settings.lock().unwrap_or_else(|p| p.into_inner()),
            new,
        )
    }

    /// The interface language in use.
    pub fn lang(&self) -> String {
        i18n::resolve(&self.settings().language, self.system_locale.as_deref())
    }
}

/// Matches the sign-in item to the setting.
pub(crate) fn sync_autostart(app: &AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let result = match (enabled, launcher.is_enabled().unwrap_or(false)) {
        (true, false) => launcher.enable(),
        (false, true) => launcher.disable(),
        _ => Ok(()),
    };
    if let Err(err) = result {
        tracing::warn!("start at sign-in could not be changed: {err}");
    }
}

/// Loads the bundled PDFium (SPEC 4.1). Without it PDF work fails with a plain message; the rest
/// of Kento runs on.
fn load_pdfium(app: &AppHandle) {
    let name = if cfg!(windows) {
        "pdfium.dll"
    } else {
        "libpdfium.dylib"
    };
    let bundled = app
        .path()
        .resource_dir()
        .map(|dir| dir.join("pdfium").join(name));
    // A development build runs from target/, next to the fetched copy.
    let fetched = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("pdfium")
        .join(name);
    let library = bundled
        .ok()
        .filter(|path| path.is_file())
        .or_else(|| (cfg!(debug_assertions) && fetched.is_file()).then_some(fetched));
    match library.map(|path| kento_engines::pdf::init(&path)) {
        Some(Ok(())) => tracing::info!("PDFium loaded"),
        Some(Err(err)) => tracing::error!("PDFium could not be loaded: {err}"),
        None => tracing::error!("PDFium is missing"),
    }
}

fn setup(
    app: &AppHandle,
    smoke_test: bool,
    autostarted: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let paths = AppPaths::under(&app.path().local_data_dir()?);
    paths.create()?;
    let log = logging::init(&paths.logs);
    match paths.clean_temp() {
        Ok(0) => {}
        Ok(n) => tracing::info!("removed {n} left-over temporary entries"),
        Err(err) => tracing::warn!("temp folder not cleaned: {err}"),
    }
    let settings = settings::load(&paths.settings_file());
    let limit = settings
        .concurrency
        .map_or_else(JobQueue::default_limit, usize::from);
    let spawn: Spawner = Arc::new(|future| {
        tauri::async_runtime::spawn(future);
    });
    let handle = app.clone();
    let listener: Listener = Arc::new(move |info: &JobInfo| {
        let _ = handle.emit("job", info);
    });
    let shelf = shelf::select(settings.shelf_model, false);
    let library = Library::load(paths.data.join("library.json"));
    load_pdfium(app);
    let launch_at_login = settings.launch_at_login;
    let tray_icon = settings.tray_icon;
    app.manage(AppState {
        paths,
        settings: Mutex::new(settings),
        system_locale: i18n::system_locale(),
        queue: JobQueue::new(limit, spawn, listener),
        shelf: Mutex::new(shelf),
        library,
        _log: log,
    });
    tracing::info!("Kento {} started", app.package_info().version);

    if !smoke_test {
        sync_autostart(app, launch_at_login);
    }
    if tray_icon {
        tray::create(app)?;
    }
    if smoke_test {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let passed = smoke::run(app.clone()).await;
            app.exit(if passed { 0 } else { 1 });
        });
    } else if !autostarted {
        window::show_main(app, None)?;
    }
    Ok(())
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let smoke_test = args.iter().any(|arg| arg == "--smoke-test");
    let autostarted = args.iter().any(|arg| arg == "--autostart");

    let mut builder = tauri::Builder::default();
    if !smoke_test {
        // A second launch brings the running Kento forward instead of starting another.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(err) = window::show_main(app, None) {
                tracing::error!("could not open Kento: {err}");
            }
        }));
    }
    builder
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| setup(app.handle(), smoke_test, autostarted))
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::save_settings,
            commands::ui_ready,
            commands::open_link,
            commands::choose_folder,
            commands::set_jobs_paused,
            commands::cancel_job,
            commands::log_message,
            work::inspect,
            work::targets,
            work::tools,
            work::convert,
            files::pick_files,
            files::paste_files,
            files::import_text,
            files::import_image,
            files::thumbnail,
            files::reveal_path,
            files::library_list,
            files::library_remove,
            files::library_reveal,
            files::library_open,
            files::library_find,
            tools::merge_pdfs,
            tools::split_pdf,
            tools::edit_pdf,
            tools::images_to_pdf,
            tools::extract_archives,
            tools::pdf_pages,
            tools::pdf_thumbnail,
            tools::scan_qr,
            tools::save_qr_report,
        ])
        .build(tauri::generate_context!())
        .expect("Kento could not start")
        .run(|app, event| {
            // With the tray icon on, closing the window keeps Kento running in the tray.
            if let RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                let keep = app
                    .try_state::<AppState>()
                    .is_some_and(|state| state.settings().tray_icon);
                if keep {
                    api.prevent_exit();
                }
            }
        });
}
