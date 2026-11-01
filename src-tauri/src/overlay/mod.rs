// SPDX-License-Identifier: MIT
//! Kento's windows outside the main window (SPEC 5.2, 5.8, 5.13): the wheel that opens under the
//! pointer, the shelf at the screen edge and the result card in a corner. They float above other
//! apps, never take the taskbar, and hide by moving off screen: hiding a webview window breaks its
//! drop target and makes it flicker (SPEC section 6).

pub mod shelf;
pub mod toast;
pub mod wheel;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Where hidden windows wait.
const PARKED: PhysicalPosition<i32> = PhysicalPosition {
    x: -20000,
    y: -20000,
};

pub fn park(window: &WebviewWindow) {
    if let Err(err) = window.set_position(PARKED) {
        tracing::warn!("a window could not be moved away: {err}");
    }
}

pub fn is_parked(window: &WebviewWindow) -> bool {
    window
        .outer_position()
        .map(|p| p.x <= PARKED.x / 2)
        .unwrap_or(true)
}

/// The work area (screen without the taskbar or menu bar) of the monitor under a point, in
/// physical pixels: position and size.
fn work_area(
    app: &AppHandle,
    x: f64,
    y: f64,
) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let monitor = app
        .monitor_from_point(x, y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some((area.position, area.size))
}

/// The top-left position that centres a window of `size` on a point, kept inside the work area.
pub fn centred_on(
    area: (PhysicalPosition<i32>, PhysicalSize<u32>),
    size: PhysicalSize<u32>,
    x: f64,
    y: f64,
) -> PhysicalPosition<i32> {
    let (origin, bounds) = area;
    let clamp = |centre: f64, length: u32, start: i32, span: u32| {
        let want = centre.round() as i64 - i64::from(length) / 2;
        let last = i64::from(start) + i64::from(span) - i64::from(length);
        want.clamp(i64::from(start), last.max(i64::from(start))) as i32
    };
    PhysicalPosition {
        x: clamp(x, size.width, origin.x, bounds.width),
        y: clamp(y, size.height, origin.y, bounds.height),
    }
}

/// Moves a window so that it is centred on a point of the screen it is on.
pub fn move_centred(app: &AppHandle, window: &WebviewWindow, x: f64, y: f64) -> tauri::Result<()> {
    let size = window.outer_size()?;
    let Some(area) = work_area(app, x, y) else {
        return window.set_position(PhysicalPosition::new(
            x as i32 - size.width as i32 / 2,
            y as i32 - size.height as i32 / 2,
        ));
    };
    window.set_position(centred_on(area, size, x, y))
}

/// The window for a label, if it exists now.
pub fn window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    app.get_webview_window(label)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_centres_on_the_point_and_stays_on_screen() {
        let area = (PhysicalPosition::new(0, 0), PhysicalSize::new(1920, 1040));
        let size = PhysicalSize::new(520, 520);
        assert_eq!(
            centred_on(area, size, 960.0, 500.0),
            PhysicalPosition::new(700, 240)
        );
        assert_eq!(
            centred_on(area, size, 10.0, 10.0),
            PhysicalPosition::new(0, 0)
        );
        assert_eq!(
            centred_on(area, size, 1915.0, 1035.0),
            PhysicalPosition::new(1400, 520)
        );
        // A second monitor on the left, at negative coordinates.
        let left = (
            PhysicalPosition::new(-2560, 0),
            PhysicalSize::new(2560, 1400),
        );
        assert_eq!(
            centred_on(left, size, -100.0, 700.0),
            PhysicalPosition::new(-520, 440)
        );
    }
}
