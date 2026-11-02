// SPDX-License-Identifier: MIT
//! The tray icon (the menu bar icon on macOS) and its menu: Home, Shelf, pause or resume jobs,
//! Settings, Check for updates and Quit. The menu follows the interface language.

use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::error::Result;
use crate::{i18n, window, AppState};

const TRAY_ID: &str = "kento";

/// The picture closest to Windows' small-icon size at the current display scaling.
#[cfg(not(target_os = "macos"))]
fn picture() -> &'static [u8] {
    const SIZES: [(u32, &[u8]); 4] = [
        (16, include_bytes!("../icons/tray/tray-16.png")),
        (20, include_bytes!("../icons/tray/tray-20.png")),
        (24, include_bytes!("../icons/tray/tray-24.png")),
        (32, include_bytes!("../icons/tray/tray-32.png")),
    ];
    let want = small_icon_size();
    SIZES
        .iter()
        .find(|(size, _)| *size >= want)
        .unwrap_or(&SIZES[SIZES.len() - 1])
        .1
}

/// The macOS menu bar takes a template picture, which it tints for light and dark menu bars.
#[cfg(target_os = "macos")]
fn picture() -> &'static [u8] {
    include_bytes!("../icons/tray/tray-mac.png")
}

#[cfg(windows)]
fn small_icon_size() -> u32 {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSMICON};
    // SAFETY: no pointers; the size follows the display scaling Kento started with.
    let size = unsafe { GetSystemMetrics(SM_CXSMICON) };
    u32::try_from(size).unwrap_or(16)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn small_icon_size() -> u32 {
    32
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<AppState>();
    let lang = state.lang();
    let t = |key: &str| i18n::text(&lang, key);
    let paused = state.queue.is_paused();
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "home", t("nav.home"), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "shelf", t("tray.shelf"), true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "pause",
                t(if paused { "tray.resume" } else { "tray.pause" }),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, "settings", t("nav.settings"), true, None::<&str>)?,
            &MenuItem::with_id(app, "updates", t("tray.updates"), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", t("tray.quit"), true, None::<&str>)?,
        ],
    )
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    let result = match event.id().as_ref() {
        "home" => window::show_main(app, Some("home")),
        "settings" => window::show_main(app, Some("settings")),
        "shelf" => {
            crate::overlay::shelf::show(app);
            Ok(())
        }
        // Looks at once, with Settings › Updates open to show what it finds.
        "updates" => {
            crate::updates::check_now(app);
            window::show_main(app, Some("updates"))
        }
        "pause" => set_paused(app, !app.state::<AppState>().queue.is_paused()),
        "quit" => {
            app.exit(0);
            Ok(())
        }
        _ => Ok(()),
    };
    if let Err(err) = result {
        tracing::error!("tray menu: {err}");
    }
}

/// Pauses or resumes the job queue and tells the menu and the page.
pub fn set_paused(app: &AppHandle, paused: bool) -> Result<()> {
    app.state::<AppState>().queue.set_paused(paused);
    // An update waiting for the jobs says whether they are paused.
    crate::updates::changed(app);
    app.emit("jobs-paused", paused)?;
    refresh(app)
}

pub fn create(app: &AppHandle) -> Result<()> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return refresh(app);
    }
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(picture())?)
        .tooltip("Kento")
        .menu(&menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(err) = window::show_main(tray.app_handle(), None) {
                    tracing::error!("could not open Kento: {err}");
                }
            }
        })
        .build(app)?;
    #[cfg(target_os = "macos")]
    tray.set_icon_as_template(true)?;
    let _ = tray;
    Ok(())
}

/// Rebuilds the menu, for example after the language changed.
pub fn refresh(app: &AppHandle) -> Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu(app)?))?;
    }
    Ok(())
}

/// Shows or removes the icon to match the setting.
pub fn set_visible(app: &AppHandle, visible: bool) -> Result<()> {
    if visible {
        create(app)
    } else {
        app.remove_tray_by_id(TRAY_ID);
        Ok(())
    }
}
