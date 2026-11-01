// SPDX-License-Identifier: MIT
//! Drag detection by polling `GetAsyncKeyState` and `GetCursorPos`: no hooks (SPEC section 6).
//!
//! Positions are physical pixels: the watcher thread runs as Per-Monitor v2 aware, and in that
//! context `GetCursorPos` reports the raw pixels of each display ("the application seeing the raw
//! pixels of each display", Microsoft Learn, High DPI Desktop Application Development). The
//! thread sets the context itself instead of relying on the process default, because a DPI
//! unaware or system aware thread would get virtualized coordinates.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows::Win32::Foundation::POINT;
use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::HiDpi::{
    GetDpiForMonitor, GetSystemMetricsForDpi, SetThreadDpiAwarenessContext,
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VIRTUAL_KEY, VK_CONTROL, VK_ESCAPE, VK_LBUTTON, VK_LWIN, VK_MENU, VK_RBUTTON,
    VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, SM_CXDRAG, SM_CYDRAG, SM_SWAPBUTTON,
};

use super::super::{DragEvent, Modifiers, PlatformError, Point, Result};

/// While the primary button is up nothing can be dragged, so polling stays light.
const IDLE_INTERVAL: Duration = Duration::from_millis(40);
const PRESSED_INTERVAL: Duration = Duration::from_millis(10);

/// Stops the watcher thread when dropped.
pub struct Watcher {
    stop: Option<Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Watcher {
    fn drop(&mut self) {
        // Dropping the sender wakes the thread out of its wait.
        self.stop.take();
        if let Some(thread) = self.thread.take() {
            // Joining from the watcher's own thread (a callback dropping it) would deadlock.
            if thread.thread().id() != thread::current().id() {
                let _ = thread.join();
            }
        }
    }
}

pub fn watch_drags(on_event: Box<dyn Fn(DragEvent) + Send + 'static>) -> Result<Watcher> {
    let (stop, stopped) = mpsc::channel::<()>();
    let thread = thread::Builder::new()
        .name("kento-drag-watcher".into())
        .spawn(move || {
            use_physical_pixels();
            let mut tracker = DragTracker::default();
            loop {
                if let Some(sample) = read_sample() {
                    tracker.step(sample, drag_threshold, |event| {
                        // A panicking callback must not end drag detection for the session.
                        if catch_unwind(AssertUnwindSafe(|| on_event(event))).is_err() {
                            tracing::error!("the drag event handler panicked");
                        }
                    });
                }
                let interval = if tracker.button_held() {
                    PRESSED_INTERVAL
                } else {
                    IDLE_INTERVAL
                };
                match stopped.recv_timeout(interval) {
                    Err(RecvTimeoutError::Timeout) => {}
                    _ => break,
                }
            }
        })
        .map_err(|err| PlatformError::Failed(format!("the drag watcher could not start: {err}")))?;
    Ok(Watcher {
        stop: Some(stop),
        thread: Some(thread),
    })
}

fn use_physical_pixels() {
    // SAFETY: changes only this thread's DPI context; the thread is ours and never restores it.
    let previous =
        unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    if previous.is_invalid() {
        tracing::warn!("the drag watcher could not use Per-Monitor v2; positions may be scaled");
    }
}

fn key_down(key: VIRTUAL_KEY) -> bool {
    // SAFETY: reads global key state, no pointers involved.
    unsafe { GetAsyncKeyState(i32::from(key.0)) < 0 }
}

fn read_sample() -> Option<Sample> {
    let mut point = POINT::default();
    // SAFETY: `point` is a valid out pointer. It fails on secure desktops; skip those samples.
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some(Sample {
        left: key_down(VK_LBUTTON),
        right: key_down(VK_RBUTTON),
        // SAFETY: reads a system metric.
        swapped: unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0,
        escape: key_down(VK_ESCAPE),
        x: point.x,
        y: point.y,
        modifiers: Modifiers {
            shift: key_down(VK_SHIFT),
            control: key_down(VK_CONTROL),
            alt: key_down(VK_MENU),
            command: key_down(VK_LWIN) || key_down(VK_RWIN),
        },
    })
}

/// The system drag rectangle for the display under the press, so a 200% display gets a
/// threshold twice as wide in physical pixels.
fn drag_threshold(x: i32, y: i32) -> (i32, i32) {
    // SAFETY: plain queries; the DPI out pointers are valid locals.
    let (cx, cy) = unsafe {
        let monitor = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
        let (mut dpi_x, mut dpi_y) = (0u32, 0u32);
        if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y).is_ok() {
            (
                GetSystemMetricsForDpi(SM_CXDRAG, dpi_x),
                GetSystemMetricsForDpi(SM_CYDRAG, dpi_y),
            )
        } else {
            (GetSystemMetrics(SM_CXDRAG), GetSystemMetrics(SM_CYDRAG))
        }
    };
    (cx.max(1), cy.max(1))
}

/// One poll of the input state, raw: `left` and `right` are the physical buttons.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Sample {
    left: bool,
    right: bool,
    /// The user swapped the buttons, so the primary one is the physical right button.
    swapped: bool,
    escape: bool,
    x: i32,
    y: i32,
    modifiers: Modifiers,
}

impl Sample {
    fn primary(&self) -> bool {
        if self.swapped {
            self.right
        } else {
            self.left
        }
    }

    fn at(&self) -> (i32, i32) {
        (self.x, self.y)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// The button may be down from before we looked, so where it went down is unknown.
    Unknown,
    Up,
    Pressed {
        origin: (i32, i32),
        threshold: (i32, i32),
    },
    Dragging {
        at: (i32, i32),
        modifiers: Modifiers,
    },
}

/// Turns samples into drag events. Pure, so it is tested without a mouse.
#[derive(Debug)]
struct DragTracker {
    phase: Phase,
    escape_down: bool,
}

impl Default for DragTracker {
    fn default() -> Self {
        Self {
            phase: Phase::Unknown,
            // An Esc held when watching starts is not a fresh press.
            escape_down: true,
        }
    }
}

impl DragTracker {
    fn button_held(&self) -> bool {
        matches!(self.phase, Phase::Pressed { .. } | Phase::Dragging { .. })
    }

    /// `threshold` gives the drag rectangle's half-size for a press at a point.
    fn step(
        &mut self,
        sample: Sample,
        threshold: impl FnOnce(i32, i32) -> (i32, i32),
        mut emit: impl FnMut(DragEvent),
    ) {
        let primary = sample.primary();
        let escape_pressed = sample.escape && !self.escape_down;
        self.escape_down = sample.escape;
        let at = sample.at();
        self.phase = match self.phase {
            Phase::Unknown | Phase::Up if !primary => Phase::Up,
            Phase::Unknown => Phase::Unknown,
            Phase::Up => Phase::Pressed {
                origin: at,
                threshold: threshold(at.0, at.1),
            },
            Phase::Pressed { .. } if !primary => Phase::Up,
            Phase::Pressed { origin, threshold } => {
                let moved_x = (at.0 - origin.0).abs() > threshold.0;
                let moved_y = (at.1 - origin.1).abs() > threshold.1;
                if moved_x || moved_y {
                    emit(DragEvent::Started {
                        at: point(at),
                        modifiers: sample.modifiers,
                    });
                    Phase::Dragging {
                        at,
                        modifiers: sample.modifiers,
                    }
                } else {
                    Phase::Pressed { origin, threshold }
                }
            }
            Phase::Dragging {
                at: last,
                modifiers,
            } => {
                if escape_pressed {
                    emit(DragEvent::Escape);
                }
                if !primary {
                    emit(DragEvent::Ended { at: point(at) });
                    Phase::Up
                } else {
                    if at != last || sample.modifiers != modifiers {
                        emit(DragEvent::Moved {
                            at: point(at),
                            modifiers: sample.modifiers,
                        });
                    }
                    Phase::Dragging {
                        at,
                        modifiers: sample.modifiers,
                    }
                }
            }
        };
    }
}

fn point((x, y): (i32, i32)) -> Point {
    Point {
        x: f64::from(x),
        y: f64::from(y),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const THRESHOLD: (i32, i32) = (4, 4);

    fn up(x: i32, y: i32) -> Sample {
        Sample {
            x,
            y,
            ..Sample::default()
        }
    }

    fn down(x: i32, y: i32) -> Sample {
        Sample {
            left: true,
            ..up(x, y)
        }
    }

    fn run(tracker: &mut DragTracker, samples: &[Sample]) -> Vec<DragEvent> {
        let mut events = Vec::new();
        for sample in samples {
            tracker.step(*sample, |_, _| THRESHOLD, |event| events.push(event));
        }
        events
    }

    fn started() -> DragTracker {
        let mut tracker = DragTracker::default();
        let events = run(&mut tracker, &[up(0, 0), down(0, 0), down(10, 0)]);
        assert_eq!(events.len(), 1);
        tracker
    }

    #[test]
    fn small_moves_are_a_click_not_a_drag() {
        let mut tracker = DragTracker::default();
        let events = run(
            &mut tracker,
            &[up(0, 0), down(100, 100), down(104, 96), up(104, 96)],
        );
        assert!(events.is_empty());
    }

    #[test]
    fn passing_the_threshold_starts_a_drag() {
        let mut tracker = DragTracker::default();
        let shift = Modifiers {
            shift: true,
            ..Modifiers::default()
        };
        let events = run(
            &mut tracker,
            &[
                up(0, 0),
                down(100, 100),
                Sample {
                    modifiers: shift,
                    ..down(100, 105)
                },
            ],
        );
        assert_eq!(
            events,
            vec![DragEvent::Started {
                at: Point { x: 100.0, y: 105.0 },
                modifiers: shift,
            }]
        );
        assert!(tracker.button_held());
    }

    #[test]
    fn the_threshold_is_measured_per_axis_from_the_press() {
        let mut tracker = DragTracker::default();
        let mut events = Vec::new();
        let mut asked = None;
        tracker.step(up(0, 0), |_, _| (2, 6), |e| events.push(e));
        tracker.step(
            down(50, 60),
            |x, y| {
                asked = Some((x, y));
                (2, 6)
            },
            |e| events.push(e),
        );
        assert_eq!(asked, Some((50, 60)));
        tracker.step(down(52, 66), |_, _| (2, 6), |e| events.push(e));
        assert!(events.is_empty(), "exactly on the edge is still inside");
        tracker.step(down(53, 60), |_, _| (2, 6), |e| events.push(e));
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn moves_and_modifier_changes_are_reported_once_each() {
        let mut tracker = started();
        let ctrl = Modifiers {
            control: true,
            ..Modifiers::default()
        };
        let events = run(
            &mut tracker,
            &[
                down(10, 0),
                down(12, 3),
                Sample {
                    modifiers: ctrl,
                    ..down(12, 3)
                },
                Sample {
                    modifiers: ctrl,
                    ..down(12, 3)
                },
                down(12, 3),
            ],
        );
        assert_eq!(
            events,
            vec![
                DragEvent::Moved {
                    at: Point { x: 12.0, y: 3.0 },
                    modifiers: Modifiers::default(),
                },
                DragEvent::Moved {
                    at: Point { x: 12.0, y: 3.0 },
                    modifiers: ctrl,
                },
                DragEvent::Moved {
                    at: Point { x: 12.0, y: 3.0 },
                    modifiers: Modifiers::default(),
                },
            ]
        );
    }

    #[test]
    fn every_modifier_is_seen() {
        let all = Modifiers {
            shift: true,
            control: true,
            alt: true,
            command: true,
        };
        let mut tracker = started();
        let events = run(
            &mut tracker,
            &[Sample {
                modifiers: all,
                ..down(10, 0)
            }],
        );
        assert_eq!(
            events,
            vec![DragEvent::Moved {
                at: Point { x: 10.0, y: 0.0 },
                modifiers: all,
            }]
        );
    }

    #[test]
    fn release_ends_the_drag_where_the_button_went_up() {
        let mut tracker = started();
        let events = run(&mut tracker, &[up(20, 30), up(40, 40)]);
        assert_eq!(
            events,
            vec![DragEvent::Ended {
                at: Point { x: 20.0, y: 30.0 },
            }]
        );
        assert!(!tracker.button_held());
    }

    #[test]
    fn escape_is_reported_once_per_press_during_a_drag() {
        let mut tracker = started();
        let esc = |x| Sample {
            escape: true,
            ..down(x, 0)
        };
        let events = run(
            &mut tracker,
            &[esc(10), esc(10), down(10, 0), esc(10), up(10, 0)],
        );
        assert_eq!(
            events,
            vec![
                DragEvent::Escape,
                DragEvent::Escape,
                DragEvent::Ended {
                    at: Point { x: 10.0, y: 0.0 },
                },
            ]
        );
    }

    #[test]
    fn escape_outside_a_drag_or_held_from_before_is_ignored() {
        let mut tracker = DragTracker::default();
        let esc_up = Sample {
            escape: true,
            ..up(0, 0)
        };
        let esc_down = |x| Sample {
            escape: true,
            ..down(x, 0)
        };
        // Held since before the drag started: not a fresh press.
        let events = run(
            &mut tracker,
            &[esc_up, esc_down(0), esc_down(10), esc_down(12)],
        );
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], DragEvent::Started { .. }));
        assert!(matches!(events[1], DragEvent::Moved { .. }));
    }

    #[test]
    fn swapped_buttons_use_the_right_button() {
        let mut tracker = DragTracker::default();
        let right = |x| Sample {
            right: true,
            swapped: true,
            ..up(x, 0)
        };
        let left = |x| Sample {
            left: true,
            swapped: true,
            ..up(x, 0)
        };
        assert!(run(&mut tracker, &[up(0, 0), left(0), left(50)]).is_empty());
        let events = run(&mut tracker, &[up(50, 0), right(50), right(60)]);
        assert!(matches!(events[..], [DragEvent::Started { .. }]));
        // Only the physical right button counts while swapped.
        let events = run(&mut tracker, &[right(61)]);
        assert!(matches!(events[..], [DragEvent::Moved { .. }]));
    }

    #[test]
    fn the_right_button_alone_never_drags() {
        let mut tracker = DragTracker::default();
        let right = |x| Sample {
            right: true,
            ..up(x, 0)
        };
        assert!(run(&mut tracker, &[up(0, 0), right(0), right(50), up(50, 0)]).is_empty());
    }

    #[test]
    fn a_button_already_down_when_watching_starts_is_ignored() {
        let mut tracker = DragTracker::default();
        assert!(run(&mut tracker, &[down(0, 0), down(100, 0), down(200, 0)]).is_empty());
        assert!(!tracker.button_held());
        let events = run(&mut tracker, &[up(200, 0), down(200, 0), down(210, 0)]);
        assert!(matches!(events[..], [DragEvent::Started { .. }]));
    }

    #[test]
    fn a_new_drag_can_follow_a_finished_one() {
        let mut tracker = started();
        let events = run(
            &mut tracker,
            &[up(10, 0), down(500, 500), down(500, 520), up(500, 520)],
        );
        assert_eq!(events.len(), 3);
        assert!(matches!(events[0], DragEvent::Ended { .. }));
        assert!(matches!(events[1], DragEvent::Started { .. }));
        assert!(matches!(events[2], DragEvent::Ended { .. }));
    }

    #[test]
    fn the_watcher_starts_and_stops() {
        let watcher = watch_drags(Box::new(|_| {})).expect("watcher");
        drop(watcher);
    }

    #[test]
    fn the_cursor_is_read_in_physical_pixels() {
        use windows::Win32::UI::WindowsAndMessaging::GetPhysicalCursorPos;
        let checked = thread::spawn(|| {
            use_physical_pixels();
            // Several tries in case the pointer moves between the two reads.
            (0..5).any(|_| {
                let (mut logical, mut physical) = (POINT::default(), POINT::default());
                // SAFETY: valid out pointers.
                unsafe {
                    if GetCursorPos(&mut logical).is_err()
                        || GetPhysicalCursorPos(&mut physical).is_err()
                    {
                        // No interactive desktop (a service session): nothing to compare.
                        return true;
                    }
                }
                logical == physical
            })
        })
        .join()
        .expect("thread");
        assert!(checked);
    }

    #[test]
    fn the_system_drag_threshold_is_positive() {
        let (cx, cy) = drag_threshold(0, 0);
        assert!(cx >= 1 && cy >= 1);
    }
}
