// SPDX-License-Identifier: MIT
//! The main window (Home, Library, Settings). It is created on demand and destroyed on close, so
//! Kento keeps little memory while it waits in the tray; Mica is applied once, when it is built.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::Result;
use crate::settings::Appearance;

pub const MAIN: &str = "main";

/// WebView2 cannot finish setting up a webview while the main thread waits in a command or an
/// event handler, so windows are built from a thread of their own.
pub(crate) fn build_apart(
    app: &AppHandle,
    build: impl FnOnce(&AppHandle) -> tauri::Result<()> + Send + 'static,
) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("open-window".into())
        .spawn(move || {
            if let Err(err) = build(&app) {
                tracing::error!("a window could not be created: {err}");
            }
        });
    if let Err(err) = spawned {
        tracing::error!("a window could not be created: {err}");
    }
}

/// Mica needs Windows 11 (build 22000); elsewhere the page paints its own background.
#[cfg(windows)]
pub fn supports_mica() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let mut buffer = [0u16; 16];
    let mut size = (buffer.len() * 2) as u32;
    // SAFETY: the buffer and its size in bytes are passed together.
    let read = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"),
            w!("CurrentBuildNumber"),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    let len = (size as usize / 2).saturating_sub(1).min(buffer.len());
    read.is_ok()
        && String::from_utf16_lossy(&buffer[..len])
            .parse::<u32>()
            .is_ok_and(|build| build >= 22000)
}

#[cfg(not(windows))]
pub fn supports_mica() -> bool {
    false
}

fn window_theme(appearance: Appearance) -> Option<tauri::Theme> {
    match appearance {
        Appearance::Light => Some(tauri::Theme::Light),
        Appearance::Dark => Some(tauri::Theme::Dark),
        Appearance::System => None,
    }
}

/// Brings the main window forward, building it when it is closed. `section` opens a page.
pub fn show_main(app: &AppHandle, section: Option<&'static str>) -> Result<()> {
    if let Some(window) = app.get_webview_window(MAIN) {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
        if let Some(section) = section {
            window.emit("navigate", section)?;
        }
        return Ok(());
    }
    let appearance = app.state::<crate::AppState>().settings().appearance;
    let hidden = section == Some("hidden");
    build_apart(app, move |app| {
        // A hidden window (the smoke test) asks its page not to reveal it.
        let url = match section {
            _ if hidden => "index.html?hidden=1".to_string(),
            Some(section) => format!("index.html?section={section}"),
            None => "index.html".to_string(),
        };
        let mut builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App(url.into()))
            .title("Kento")
            .inner_size(1000.0, 680.0)
            .min_inner_size(760.0, 520.0)
            .center()
            .visible(false)
            .theme(window_theme(appearance));
        if supports_mica() {
            builder = builder
                .transparent(true)
                .effects(
                    tauri::window::EffectsBuilder::new()
                        .effect(tauri::window::Effect::Mica)
                        .build(),
                )
                .initialization_script("document.documentElement.dataset.backdrop = 'mica';");
        }
        let window = builder.build()?;
        // Files and links dropped on Home.
        crate::drops::watch(&window);
        if !hidden {
            // The page shows the window once it has painted (ui_ready); this is the safety net.
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(4));
                if let Some(window) = app.get_webview_window(MAIN) {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                }
            });
        }
        Ok(())
    });
    Ok(())
}

/// Shows the window once its page has painted, so it never flashes white.
pub fn reveal(window: &tauri::WebviewWindow) -> Result<()> {
    if !window.is_visible()? {
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

/// The native title bar follows the appearance setting.
pub fn apply_theme(app: &AppHandle, appearance: Appearance) -> Result<()> {
    if let Some(window) = app.get_webview_window(MAIN) {
        window.set_theme(window_theme(appearance))?;
    }
    Ok(())
}
