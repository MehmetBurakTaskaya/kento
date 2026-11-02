// SPDX-License-Identifier: MIT
//! Commands the page calls. Paths and links are decided here, never taken from the page as is.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::catalog::{self, Summary};
use crate::error::{Error, Result};
use crate::i18n::{self, Language};
use crate::jobs::{JobInfo, JobQueue};
use crate::settings::{self, Settings};
use crate::{logging, tray, window, AppState};

pub const WEBSITE: &str = "https://mehmetburaktaskaya.com";
pub const REPOSITORY: &str = "https://github.com/MehmetBurakTaskaya/kento";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: String,
    pub website: &'static str,
    pub repository: &'static str,
    pub platform: &'static str,
    pub backdrop: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub settings: Settings,
    /// The language in use after resolving "system".
    pub language: String,
    pub languages: Vec<Language>,
    pub system_locale: Option<String>,
    pub app: AppInfo,
    pub catalog: Summary,
    pub jobs: Vec<JobInfo>,
    pub paused: bool,
    pub default_jobs: usize,
}

pub fn app_info(app: &AppHandle) -> AppInfo {
    AppInfo {
        name: "Kento",
        version: app.package_info().version.to_string(),
        website: WEBSITE,
        repository: REPOSITORY,
        platform: if cfg!(windows) {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        },
        backdrop: if window::supports_mica() {
            "mica"
        } else {
            "none"
        },
    }
}

#[tauri::command]
pub fn bootstrap(app: AppHandle, state: State<'_, AppState>) -> Bootstrap {
    let settings = state.settings();
    Bootstrap {
        language: state.lang(),
        settings,
        languages: i18n::available(),
        system_locale: state.system_locale.clone(),
        app: app_info(&app),
        catalog: catalog::summary(),
        jobs: state.queue.snapshot(),
        paused: state.queue.is_paused(),
        default_jobs: JobQueue::default_limit(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub settings: Settings,
    pub language: String,
}

/// Stores the settings and applies what changed: start at sign-in, the tray icon and its menu,
/// the title bar theme and the number of jobs at the same time.
#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Saved> {
    let mut new = settings.normalized();
    // The first-use notice of web downloads, once shown, stays shown, whatever an older copy of
    // the settings in a window says (the wheel's quick download marks it in the core).
    new.web.notice_shown |= state.settings().web.notice_shown;
    let old = state.replace_settings(new.clone());
    settings::save(&state.paths.settings_file(), &new)?;
    if old.launch_at_login != new.launch_at_login {
        crate::sync_autostart(&app, new.launch_at_login);
    }
    if old.tray_icon != new.tray_icon {
        tray::set_visible(&app, new.tray_icon)?;
    }
    if old.language != new.language {
        tray::refresh(&app)?;
    }
    if old.appearance != new.appearance {
        window::apply_theme(&app, new.appearance)?;
    }
    if old.concurrency != new.concurrency {
        state.queue.set_limit(
            new.concurrency
                .map_or_else(JobQueue::default_limit, usize::from),
        );
    }
    if old.wheels.global != new.wheels.global {
        crate::overlay::wheel::sync_watcher(&app);
    }
    if old.wheels.selection_shortcut != new.wheels.selection_shortcut
        || old.web.shortcut != new.web.shortcut
    {
        crate::shortcut::sync(&app);
    } else if old.layouts != new.layouts {
        crate::layouts::sync_shortcuts(&app);
    }
    if old.shell != new.shell {
        crate::sync_shell(&app, &old.shell, &new.shell);
    }
    tracing::info!("settings saved");
    let saved = Saved {
        language: state.lang(),
        settings: new,
    };
    // The wheel, the shelf and the corner card follow the main window.
    let _ = app.emit("settings", &saved);
    Ok(saved)
}

#[tauri::command]
pub fn ui_ready(window: WebviewWindow) -> Result<()> {
    window::reveal(&window)
}

/// Opens Kento's own website or repository; the page cannot open any other address.
#[tauri::command]
pub fn open_link(app: AppHandle, which: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let url = match which.as_str() {
        "website" => WEBSITE,
        "repository" => REPOSITORY,
        other => return Err(Error::Invalid(format!("unknown link {other}"))),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|err| Error::Invalid(err.to_string()))
}

/// Asks for an output folder with the system dialog.
#[tauri::command]
pub async fn choose_folder(app: AppHandle) -> Result<Option<PathBuf>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file();
    if let Some(window) = app.get_webview_window(window::MAIN) {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    let picked = rx
        .await
        .map_err(|_| Error::Invalid("the folder dialog closed unexpectedly".into()))?;
    Ok(picked.and_then(|path| path.into_path().ok()))
}

#[tauri::command]
pub fn set_jobs_paused(app: AppHandle, paused: bool) -> Result<()> {
    tray::set_paused(&app, paused)
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, id: u64) {
    state.queue.cancel(id);
}

/// Lets the page write to the log; the text is shortened and never holds file contents.
#[tauri::command]
pub fn log_message(level: String, message: String) {
    let message = logging::clip(&message);
    match level.as_str() {
        "error" => tracing::error!("page: {message}"),
        "warn" => tracing::warn!("page: {message}"),
        _ => tracing::info!("page: {message}"),
    }
}
