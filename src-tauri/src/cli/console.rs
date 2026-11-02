// SPDX-License-Identifier: MIT
//! The terminal around a command: Ctrl+C cancels the running job, so it removes what it started
//! writing (SPEC 5.13) instead of being killed half-way, and progress goes to standard error as a
//! percentage line.

use std::io::{IsTerminal, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

static CANCELLED: AtomicBool = AtomicBool::new(false);

/// Ctrl+C (or the console closing) was pressed: the job stops at its next check.
pub fn cancelled() -> bool {
    CANCELLED.load(Ordering::SeqCst)
}

/// Turns Ctrl+C into a cancel. A second Ctrl+C ends the program at once.
pub fn watch() {
    #[cfg(windows)]
    win::watch();
    #[cfg(target_os = "macos")]
    posix::watch();
}

#[cfg(windows)]
mod win {
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};

    use windows::core::BOOL;
    use windows::Win32::System::Console::{SetConsoleCtrlHandler, CTRL_BREAK_EVENT, CTRL_C_EVENT};
    use windows::Win32::System::Threading::ExitProcess;

    use super::CANCELLED;

    unsafe extern "system" fn handler(kind: u32) -> BOOL {
        let again = CANCELLED.swap(true, Ordering::SeqCst);
        if kind == CTRL_C_EVENT || kind == CTRL_BREAK_EVENT {
            if again {
                // SAFETY: ends this process now, as a second Ctrl+C asks.
                unsafe { ExitProcess(130) };
            }
            return BOOL(1);
        }
        // The console closes, the user signs out or the system shuts down: the process ends when
        // this returns, so the job gets a moment to stop and remove its partial output.
        let until = Instant::now() + Duration::from_secs(4);
        while Instant::now() < until && !super::FINISHED.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(50));
        }
        BOOL(0)
    }

    pub fn watch() {
        // SAFETY: the handler only touches atomics, sleeps and ends the process.
        if let Err(err) = unsafe { SetConsoleCtrlHandler(Some(handler), true) } {
            tracing::warn!("Ctrl+C will end jobs without clean-up: {err}");
        }
    }
}

#[cfg(target_os = "macos")]
mod posix {
    use std::sync::atomic::Ordering;

    use super::CANCELLED;

    extern "C" fn handler(_: libc::c_int) {
        if CANCELLED.swap(true, Ordering::SeqCst) {
            // SAFETY: _exit is async-signal-safe; a second Ctrl+C asks to end now.
            unsafe { libc::_exit(130) };
        }
    }

    pub fn watch() {
        let handler = handler as extern "C" fn(libc::c_int);
        for signal in [libc::SIGINT, libc::SIGTERM] {
            // SAFETY: the handler only touches an atomic and may call _exit.
            unsafe { libc::signal(signal, handler as libc::sighandler_t) };
        }
    }
}

/// Writing into a pipe that was closed (`kento formats | head`) ends the program quietly, as it
/// does other command-line tools, instead of failing on the next line.
pub fn quiet_pipes() {
    #[cfg(target_os = "macos")]
    // SAFETY: restores the system's default action, which Rust's runtime sets to ignore.
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_DFL);
    }
}

/// Set when the command is over, so a closing console does not wait for nothing.
static FINISHED: AtomicBool = AtomicBool::new(false);

pub fn finished() {
    FINISHED.store(true, Ordering::SeqCst);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Off,
    /// A terminal: one line, rewritten in place.
    Line,
    /// A file or a pipe: a line at every tenth.
    Steps,
}

/// The progress of one job on standard error: "  42%  photo.heic".
pub struct Meter {
    label: String,
    mode: Mode,
    /// The last percentage shown, when it was shown, and the width of the line on screen.
    shown: Mutex<(Option<u32>, Option<Instant>, usize)>,
}

impl Meter {
    pub fn new(label: &str, quiet: bool) -> Self {
        let mode = if quiet {
            Mode::Off
        } else if std::io::stderr().is_terminal() {
            Mode::Line
        } else {
            Mode::Steps
        };
        Self {
            label: shorten(label, 60),
            mode,
            shown: Mutex::new((None, None, 0)),
        }
    }

    /// Engines that cannot tell how far they are report nothing, and nothing is shown.
    pub fn report(&self, fraction: Option<f32>) {
        let Some(fraction) = fraction else {
            return;
        };
        let percent = (fraction.clamp(0.0, 1.0) * 100.0).floor() as u32;
        let mut shown = self.shown.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        match self.mode {
            Mode::Off => {}
            Mode::Line => {
                let due = shown
                    .1
                    .is_none_or(|at| now - at >= Duration::from_millis(100));
                if shown.0 == Some(percent) || !(due || percent == 100) {
                    return;
                }
                let line = format!("{percent:>4}%  {}", self.label);
                let width = columns(&line);
                let pad = " ".repeat(shown.2.saturating_sub(width));
                let mut err = std::io::stderr().lock();
                let _ = write!(err, "\r{line}{pad}");
                let _ = err.flush();
                *shown = (Some(percent), Some(now), width);
            }
            Mode::Steps => {
                let step = percent / 10;
                if shown.0.is_some_and(|last| last / 10 >= step) {
                    return;
                }
                eprintln!("{percent:>4}%  {}", self.label);
                *shown = (Some(percent), Some(now), 0);
            }
        }
    }

    /// Removes the line from the terminal before the result is printed.
    pub fn clear(&self) {
        let shown = self.shown.lock().unwrap_or_else(|p| p.into_inner());
        if self.mode == Mode::Line && shown.2 > 0 {
            let mut err = std::io::stderr().lock();
            let _ = write!(err, "\r{}\r", " ".repeat(shown.2));
            let _ = err.flush();
        }
    }
}

/// The columns a line takes in a terminal: wide East Asian characters and emoji take two,
/// combining marks and variation selectors none.
fn columns(text: &str) -> usize {
    text.chars()
        .map(|c| match c as u32 {
            0x0300..=0x036F | 0x200B..=0x200F | 0xFE00..=0xFE0F => 0,
            0x1100..=0x115F
            | 0x2E80..=0xA4CF
            | 0xAC00..=0xD7A3
            | 0xF900..=0xFAFF
            | 0xFE30..=0xFE4F
            | 0xFF00..=0xFF60
            | 0xFFE0..=0xFFE6
            | 0x1F300..=0x1FAFF
            | 0x20000..=0x3FFFD => 2,
            _ => 1,
        })
        .sum()
}

/// Keeps the end of a long name ("…ğüş 🧪.heic"), so the line fits a terminal.
fn shorten(text: &str, limit: usize) -> String {
    if columns(text) <= limit {
        return text.to_string();
    }
    let mut kept: Vec<char> = Vec::new();
    let mut width = 1;
    for c in text.chars().rev() {
        width += columns(c.encode_utf8(&mut [0; 4]));
        if width > limit {
            break;
        }
        kept.push(c);
    }
    std::iter::once('…').chain(kept.into_iter().rev()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widths_count_wide_characters_twice() {
        assert_eq!(columns("photo.png"), 9);
        assert_eq!(columns("ğüşıöç"), 6);
        assert_eq!(columns("🧪"), 2);
        assert_eq!(columns("写真"), 4);
    }

    #[test]
    fn long_names_keep_their_end() {
        assert_eq!(shorten("kısa.png", 60), "kısa.png");
        let long = format!("{} son 🧪.heic", "a".repeat(80));
        let short = shorten(&long, 20);
        assert!(
            short.starts_with('…') && short.ends_with("son 🧪.heic"),
            "{short}"
        );
        assert!(columns(&short) <= 20);
    }
}
