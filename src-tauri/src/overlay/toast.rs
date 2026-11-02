// SPDX-License-Identifier: MIT
//! The result card in a corner (SPEC 5.13) for jobs started from the global wheel, the shelf or
//! Explorer, when the main window may not be open. The window is made on first use, sits in the
//! bottom corner of the screen under the pointer and moves away when its last card goes.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

use crate::jobs::{JobInfo, JobState};
use crate::AppState;

pub const LABEL: &str = "toast";
const WIDTH: f64 = 400.0;
const MARGIN: i32 = 16;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Card {
    #[serde(rename_all = "camelCase")]
    Done {
        id: u64,
        title: String,
        outputs: Vec<PathBuf>,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        id: u64,
        title: String,
        message: String,
        details: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Info { id: u64, message: String },
}

impl Card {
    fn id(&self) -> u64 {
        match self {
            Card::Done { id, .. } | Card::Failed { id, .. } | Card::Info { id, .. } => *id,
        }
    }
}

#[derive(Default)]
pub struct ToastState {
    cards: Mutex<Vec<Card>>,
    /// Jobs whose end shows a card here rather than in the main window.
    jobs: Mutex<std::collections::HashSet<u64>>,
    next: std::sync::atomic::AtomicU64,
}

impl ToastState {
    /// Marks jobs started outside the main window.
    pub fn watch(&self, ids: &[u64]) {
        self.jobs
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .extend(ids.iter().copied());
    }

    fn id(&self) -> u64 {
        self.next.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
    }
}

/// Called for every job change; a watched job's end becomes a card.
pub fn on_job(app: &AppHandle, info: &JobInfo) {
    let state = app.state::<AppState>();
    if !info.state.is_finished() {
        return;
    }
    let watched = state
        .toasts
        .jobs
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(&info.id);
    if !watched {
        return;
    }
    let id = state.toasts.id();
    let card = match &info.state {
        JobState::Done { outputs } => Card::Done {
            id,
            title: info.title.clone(),
            outputs: outputs.clone(),
        },
        JobState::Failed { message, details } => Card::Failed {
            id,
            title: info.title.clone(),
            message: message.clone(),
            details: details.clone(),
        },
        _ => return,
    };
    show(app, card);
}

/// A failure no window started, such as a folder automation rule's.
pub fn alert(app: &AppHandle, title: String, message: String, details: Option<String>) {
    let id = app.state::<AppState>().toasts.id();
    show(
        app,
        Card::Failed {
            id,
            title,
            message,
            details,
        },
    );
}

/// A short note, for example "Copied the path".
pub fn note(app: &AppHandle, message: String) {
    let id = app.state::<AppState>().toasts.id();
    show(app, Card::Info { id, message });
}

fn show(app: &AppHandle, card: Card) {
    {
        let state = app.state::<AppState>();
        let mut cards = state.toasts.cards.lock().unwrap_or_else(|p| p.into_inner());
        cards.push(card.clone());
        let extra = cards.len().saturating_sub(4);
        cards.drain(..extra);
    }
    if super::window(app, LABEL).is_some() {
        let _ = app.emit_to(LABEL, "toast", card);
        return;
    }
    crate::window::build_apart(app, |app| {
        WebviewWindowBuilder::new(
            app,
            LABEL,
            WebviewUrl::App("index.html?surface=toast".into()),
        )
        .title("Kento")
        .inner_size(WIDTH, 120.0)
        .position(-20000.0, -20000.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(true)
        .build()?;
        Ok(())
    });
}

/// The cards to show; the page asks when it loads.
#[tauri::command]
pub fn toast_cards(state: tauri::State<'_, AppState>) -> Vec<Card> {
    state
        .toasts
        .cards
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

/// The page measured its cards: the window takes that height in the corner, or moves away when
/// there is nothing left.
#[tauri::command]
pub fn toast_layout(app: AppHandle, height: f64) {
    let Some(window) = super::window(&app, LABEL) else {
        return;
    };
    if height < 1.0 {
        super::park(&window);
        return;
    }
    let _ = window.set_size(tauri::LogicalSize::new(WIDTH, height));
    let at = app.cursor_position().unwrap_or_default();
    let Some(monitor) = app.monitor_from_point(at.x, at.y).ok().flatten() else {
        return;
    };
    let area = monitor.work_area();
    let Ok(size) = window.outer_size() else {
        return;
    };
    let margin = (f64::from(MARGIN) * monitor.scale_factor()) as i32;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - margin;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[tauri::command]
pub fn toast_dismiss(app: AppHandle, state: tauri::State<'_, AppState>, id: u64) {
    let mut cards = state.toasts.cards.lock().unwrap_or_else(|p| p.into_inner());
    cards.retain(|card| card.id() != id);
    if cards.is_empty() {
        if let Some(window) = super::window(&app, LABEL) {
            super::park(&window);
        }
    }
}
