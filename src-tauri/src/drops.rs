// SPDX-License-Identifier: MIT
//! What a drag over the main window or the floating wheel carries (SPEC 5.2, 5.10): files, or a
//! link out of a browser. Both windows get one stream of "drag" events of the same shape on every
//! system. On Windows Kento's own drop target reads the drag (`platform::accept_drops`), because
//! the webview's hands over files only; the webview's events still come through from any window
//! it kept. On macOS the webview reports a link drag without files, and the address comes from
//! the drag pasteboard.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, WebviewWindow, WindowEvent};

use crate::platform::{self, DragContent, DropEvent, Point};

/// The event the page listens to.
pub const EVENT: &str = "drag";

/// A drag as the page sees it. Positions are physical pixels from the webview's top-left corner;
/// the page turns them into CSS pixels.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Drag {
    Enter {
        paths: Vec<PathBuf>,
        link: Option<String>,
        x: f64,
        y: f64,
    },
    Over {
        x: f64,
        y: f64,
    },
    Drop {
        paths: Vec<PathBuf>,
        link: Option<String>,
        x: f64,
        y: f64,
    },
    Leave,
}

fn split(content: DragContent) -> (Vec<PathBuf>, Option<String>) {
    match content {
        DragContent::Files(paths) => (paths, None),
        DragContent::Link(link) => (Vec::new(), Some(link)),
        DragContent::Other => (Vec::new(), None),
    }
}

impl From<DropEvent> for Drag {
    fn from(event: DropEvent) -> Self {
        match event {
            DropEvent::Enter { content, at } => {
                let (paths, link) = split(content);
                Drag::Enter {
                    paths,
                    link,
                    x: at.x,
                    y: at.y,
                }
            }
            DropEvent::Over { at } => Drag::Over { x: at.x, y: at.y },
            DropEvent::Drop { content, at } => {
                let (paths, link) = split(content);
                Drag::Drop {
                    paths,
                    link,
                    x: at.x,
                    y: at.y,
                }
            }
            DropEvent::Leave => Drag::Leave,
        }
    }
}

/// The webview's own event, with the address the drag carries: `link` reads the drag pasteboard
/// (macOS) when the drag enters and when it drops.
fn from_webview(event: &DragDropEvent, link: impl Fn() -> Option<String>) -> Option<Drag> {
    let at = |position: &tauri::PhysicalPosition<f64>| Point {
        x: position.x,
        y: position.y,
    };
    Some(Drag::from(match event {
        DragDropEvent::Enter { paths, position } => DropEvent::Enter {
            content: DragContent::classify(paths.clone(), link()),
            at: at(position),
        },
        DragDropEvent::Over { position } => DropEvent::Over { at: at(position) },
        DragDropEvent::Drop { paths, position } => DropEvent::Drop {
            content: DragContent::classify(paths.clone(), link()),
            at: at(position),
        },
        DragDropEvent::Leave => DropEvent::Leave,
        _ => return None,
    }))
}

/// Sends the drags over a window to its page.
pub fn watch(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        if let WindowEvent::DragDrop(drop) = event {
            if let Some(drag) = from_webview(drop, platform::dragged_link) {
                send(&app, &label, &drag);
            }
        }
    });
    take_over(window);
}

/// Windows: puts Kento's drop target on the window's webview, so links reach the page too. Safe
/// to repeat: WebView2 may add a window later, and each call covers the windows there are now.
#[cfg(windows)]
pub fn take_over(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as isize;
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let on_event: std::sync::Arc<dyn Fn(DropEvent) + Send + Sync> =
        std::sync::Arc::new(move |event| send(&app, &label, &Drag::from(event)));
    // OLE drop targets belong to the window's thread.
    let placed = window.run_on_main_thread(move || {
        if let Err(err) = platform::accept_drops(hwnd, on_event) {
            tracing::warn!("links dragged onto a window cannot be read: {err}");
        }
    });
    if let Err(err) = placed {
        tracing::warn!("the drop target could not be set: {err}");
    }
}

#[cfg(not(windows))]
pub fn take_over(_window: &WebviewWindow) {}

fn send(app: &AppHandle, label: &str, drag: &Drag) {
    if app.get_webview_window(label).is_some() {
        let _ = app.emit_to(label, EVENT, drag);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::PhysicalPosition;

    #[test]
    fn a_webview_drag_with_files_stays_files() {
        let paths = vec![PathBuf::from("/Users/me/Kapadokya 🎈.heic")];
        let drag = from_webview(
            &DragDropEvent::Enter {
                paths: paths.clone(),
                position: PhysicalPosition::new(120.0, 80.0),
            },
            || None,
        );
        assert_eq!(
            drag,
            Some(Drag::Enter {
                paths,
                link: None,
                x: 120.0,
                y: 80.0
            })
        );
    }

    #[test]
    fn a_webview_drag_without_files_takes_the_dragged_link() {
        let drag = from_webview(
            &DragDropEvent::Drop {
                paths: Vec::new(),
                position: PhysicalPosition::new(10.0, 20.0),
            },
            || Some("https://www.instagram.com/reel/abc/".into()),
        );
        assert_eq!(
            drag,
            Some(Drag::Drop {
                paths: Vec::new(),
                link: Some("https://www.instagram.com/reel/abc/".into()),
                x: 10.0,
                y: 20.0
            })
        );
    }

    #[test]
    fn the_page_gets_a_tagged_event() {
        let json = serde_json::to_value(Drag::Enter {
            paths: Vec::new(),
            link: Some("https://a.org/".into()),
            x: 1.0,
            y: 2.0,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "type": "enter", "paths": [], "link": "https://a.org/", "x": 1.0, "y": 2.0 })
        );
        assert_eq!(
            serde_json::to_value(Drag::Leave).unwrap(),
            serde_json::json!({ "type": "leave" })
        );
    }
}
