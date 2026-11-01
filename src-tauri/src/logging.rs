// SPDX-License-Identifier: MIT
//! Logs stay on the computer, in the data folder's logs/, one file a day and the last seven kept.
//! They hold events and errors, never the contents of a file.

use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{Builder, Rotation};

/// Starts logging; the guard must live as long as the app so the last lines are written.
pub fn init(dir: &Path) -> Option<WorkerGuard> {
    let appender = Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix("kento")
        .filename_suffix("log")
        .max_log_files(7)
        .build(dir)
        .ok()?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let level = if cfg!(debug_assertions) {
        tracing::Level::DEBUG
    } else {
        tracing::Level::INFO
    };
    tracing_subscriber::fmt()
        .with_writer(writer)
        .with_ansi(false)
        .with_target(false)
        .with_max_level(level)
        .try_init()
        .ok()?;
    Some(guard)
}

/// Shortens text from the page before it reaches a log line.
pub fn clip(text: &str) -> String {
    const MAX: usize = 400;
    match text.char_indices().nth(MAX) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn clips_long_text_on_a_character_boundary() {
        let long = "ğ".repeat(500);
        let clipped = super::clip(&long);
        assert_eq!(clipped.chars().count(), 401);
        assert_eq!(super::clip("short"), "short");
    }
}
