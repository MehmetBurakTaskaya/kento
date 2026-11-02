// SPDX-License-Identifier: MIT
//! Kento: drag a file, press a modifier key, drop it on the wheel. This crate holds the app's core
//! (catalog, jobs, settings, languages) and its desktop shell (window, tray, single instance).

pub mod actions;
pub mod catalog;
pub mod commands;
pub mod compress;
mod drops;
pub mod error;
pub mod files;
pub mod i18n;
pub mod images;
pub mod jobs;
pub mod layouts;
pub mod library;
pub mod logging;
pub mod media;
pub mod metadata;
pub mod overlay;
pub mod paths;
pub mod platform;
pub mod settings;
pub mod shelf;
mod shortcut;
mod smoke;
pub mod toolchain;
pub mod tools;
mod tray;
pub mod web;
mod window;
pub mod work;

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tracing_appender::non_blocking::WorkerGuard;

use crate::jobs::{JobInfo, JobQueue, Listener, Spawner};
use crate::library::Library;
use crate::paths::AppPaths;
use crate::settings::Settings;
use crate::shelf::Shelf;

pub struct AppState {
    pub paths: AppPaths,
    settings: Mutex<Settings>,
    pub system_locale: Option<String>,
    pub queue: JobQueue,
    pub shelf: Shelf,
    pub library: Library,
    /// The optional external tools: detection, custom paths and installs.
    pub toolchain: toolchain::Toolchain,
    pub wheel: overlay::wheel::WheelState,
    pub toasts: overlay::toast::ToastState,
    /// A tool panel the main window should open once it is ready (from the global wheel).
    pub pending_tool: Mutex<Option<(String, Vec<std::path::PathBuf>)>>,
    /// Web downloads: recent probes, chosen folders, the link for the dialog.
    pub web: web::WebState,
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
        Some(Ok(())) => {}
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
        overlay::toast::on_job(&handle, info);
    });
    let library = Library::load(paths.data.join("library.json"));
    let toolchain = toolchain::Toolchain::new(&paths.data);
    let shelf = Shelf::load(paths.data.join("shelf.json"), paths.data.join("shelf"));
    let launch = launch_request(&std::env::args().collect::<Vec<_>>());
    load_pdfium(app);
    let launch_at_login = settings.launch_at_login;
    let tray_icon = settings.tray_icon;
    app.manage(AppState {
        paths,
        settings: Mutex::new(settings),
        system_locale: i18n::system_locale(),
        queue: JobQueue::new(limit, spawn, listener),
        shelf,
        library,
        toolchain,
        wheel: Default::default(),
        toasts: Default::default(),
        pending_tool: Mutex::new(None),
        web: Default::default(),
        _log: log,
    });
    app.manage(layouts::LayoutState::default());
    tracing::info!("Kento {} started", app.package_info().version);

    if !smoke_test {
        sync_autostart(app, launch_at_login);
    }
    if tray_icon {
        tray::create(app)?;
    }
    // The window position in tauri.conf.json is not always honoured at creation; the floating
    // wheel must never wait on screen, where its transparent area would swallow clicks.
    if let Some(wheel) = app.get_webview_window(overlay::wheel::LABEL) {
        overlay::park(&wheel);
        // The wheel learns what a drag carries, files or a link, when the drag enters it.
        drops::watch(&wheel);
    }
    // Finding the tools runs each candidate once; the first wheel should not wait for it. A
    // LibreOffice that has never run with Kento's profile is then started once, so the first
    // office job does not wait for the profile either (the hidden test run leaves it alone).
    let handle = app.clone();
    std::thread::spawn(move || {
        let state = handle.state::<AppState>();
        let tools = toolchain::engine_tools(&state);
        if !smoke_test && tools.soffice.is_some() && !state.paths.office_profile().exists() {
            toolchain::warm_up_office(&handle);
        }
    });
    if !smoke_test {
        overlay::wheel::sync_watcher(app);
        shortcut::sync(app);
    }
    if let Some(paths) = launch {
        overlay::wheel::open_for(app, paths, overlay::wheel::Kind::Convert);
        return Ok(());
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

/// Adds or removes Kento in Explorer's Send To menu and context menu to match the settings.
pub(crate) fn sync_shell(app: &AppHandle, old: &settings::Shell, new: &settings::Shell) {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let label = i18n::text(&app.state::<AppState>().lang(), "shell.menu");
    if old.send_to != new.send_to {
        if let Err(err) = platform::set_send_to(new.send_to, &exe, "Kento") {
            tracing::warn!("Send To could not be changed: {err}");
        }
    }
    if old.context_menu != new.context_menu {
        if let Err(err) = platform::set_context_menu(new.context_menu, &exe, &label) {
            tracing::warn!("the context menu could not be changed: {err}");
        }
    }
}

/// Files handed over by Explorer: `--send-to <files>` from Send To, `--wheel <files>` from the
/// context menu. Both open the wheel at the pointer.
fn launch_request(args: &[String]) -> Option<Vec<std::path::PathBuf>> {
    let at = args
        .iter()
        .position(|arg| arg == "--send-to" || arg == "--wheel")?;
    let paths: Vec<std::path::PathBuf> = args[at + 1..]
        .iter()
        .filter(|arg| !arg.starts_with("--"))
        .map(std::path::PathBuf::from)
        .collect();
    (!paths.is_empty()).then_some(paths)
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let smoke_test = args.iter().any(|arg| arg == "--smoke-test");
    let autostarted = args.iter().any(|arg| arg == "--autostart");

    let mut builder = tauri::Builder::default();
    if !smoke_test {
        // A second launch brings the running Kento forward instead of starting another.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(paths) = launch_request(&args) {
                overlay::wheel::open_for(app, paths, overlay::wheel::Kind::Convert);
                return;
            }
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(shortcut::plugin())
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
            actions::actions,
            actions::run_action,
            actions::open_tool,
            actions::open_setup,
            actions::take_pending_tool,
            overlay::wheel::wheel_session,
            overlay::wheel::wheel_dropped,
            overlay::wheel::wheel_switch,
            overlay::wheel::wheel_closed,
            overlay::wheel::wheel_haptic,
            media::media_probe,
            media::media_preview,
            media::media_peaks,
            media::media_frame,
            media::run_media_tool,
            images::image_info,
            images::image_preview,
            images::run_image_tool,
            compress::run_compress,
            metadata::metadata_read,
            metadata::run_metadata,
            toolchain::tools_status,
            toolchain::tools_install,
            toolchain::tools_cancel,
            toolchain::tools_refresh,
            toolchain::tools_remove,
            toolchain::tools_choose,
            toolchain::tools_clear_path,
            toolchain::tools_update_ytdlp,
            overlay::toast::toast_cards,
            overlay::toast::toast_layout,
            overlay::toast::toast_dismiss,
            overlay::shelf::shelf_view,
            overlay::shelf::shelf_add,
            overlay::shelf::shelf_remove,
            overlay::shelf::shelf_clear,
            overlay::shelf::shelf_hide,
            overlay::shelf::shelf_reveal,
            overlay::shelf::shelf_to_wheel,
            overlay::shelf::shelf_drag,
            tools::merge_pdfs,
            tools::split_pdf,
            tools::edit_pdf,
            tools::images_to_pdf,
            tools::extract_archives,
            tools::pdf_pages,
            tools::pdf_thumbnail,
            tools::scan_qr,
            tools::save_qr_report,
            web::web_needs,
            web::web_probe,
            web::web_preview,
            web::web_default_folder,
            web::web_choose_folder,
            web::web_download,
            web::web_open,
            web::web_take_pending,
            layouts::layouts_status,
            layouts::layouts_apply,
            layouts::layouts_ask_permission,
            layouts::layouts_open_permission_settings,
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
