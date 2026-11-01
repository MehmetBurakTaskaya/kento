// SPDX-License-Identifier: MIT
//! The drag watcher's decisions and coordinate math, free of AppKit so they can be tested on any
//! system. The watcher feeds one [`Sample`] per poll and reports what [`Tracker::feed`] returns.

use crate::platform::{DragEvent, Modifiers, Point};

/// How far, in points, the pointer travels with the button down before a drag can start.
const DRAG_THRESHOLD: f64 = 4.0;

/// One poll of the system state.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub button_down: bool,
    /// The pointer in points from the top-left of the main screen, for the drag threshold.
    pub points: Point,
    /// The same pointer in Tauri's physical pixels, for the events.
    pub at: Point,
    pub modifiers: Modifiers,
    pub escape: bool,
    /// The drag pasteboard's `changeCount`, which moves when any app starts a drag.
    pub drag_count: isize,
}

#[derive(Debug, Default)]
enum State {
    #[default]
    Up,
    /// The button is down and no drag is known yet.
    Pressed {
        origin: Point,
        drag_count: isize,
        moved: bool,
    },
    /// A drag is under way; holds what was last reported.
    Dragging {
        at: Point,
        modifiers: Modifiers,
        escape: bool,
    },
    /// Esc cancelled the drag while the button stays down.
    Cancelled,
}

#[derive(Debug, Default)]
pub struct Tracker {
    state: State,
    /// The pointer and the drag pasteboard's count at the last poll with the button up: the press
    /// and the start of a quick drag can both fall between two polls.
    before_press: Option<(Point, isize)>,
}

impl Tracker {
    /// Whether the button is down, so the watcher should poll quickly.
    pub fn is_pressed(&self) -> bool {
        !matches!(self.state, State::Up)
    }

    /// A drag starts once the pointer has moved past the threshold and the drag pasteboard has
    /// changed since the press; a click, or a click-and-move such as a selection rectangle, never
    /// writes that pasteboard.
    pub fn feed(&mut self, sample: &Sample) -> Vec<DragEvent> {
        let mut events = Vec::new();
        if !sample.button_down {
            if matches!(self.state, State::Dragging { .. } | State::Cancelled) {
                events.push(DragEvent::Ended { at: sample.at });
            }
            self.state = State::Up;
            self.before_press = Some((sample.points, sample.drag_count));
            return events;
        }
        if matches!(self.state, State::Up) {
            let (origin, drag_count) = self
                .before_press
                .unwrap_or((sample.points, sample.drag_count));
            self.state = State::Pressed {
                origin,
                drag_count,
                moved: false,
            };
        }
        match &mut self.state {
            State::Up | State::Cancelled => {}
            State::Pressed {
                origin,
                drag_count,
                moved,
            } => {
                *moved = *moved || distance(*origin, sample.points) >= DRAG_THRESHOLD;
                if *moved && sample.drag_count != *drag_count {
                    events.push(DragEvent::Started {
                        at: sample.at,
                        modifiers: sample.modifiers,
                    });
                    // An Esc already held is not a new press.
                    self.state = State::Dragging {
                        at: sample.at,
                        modifiers: sample.modifiers,
                        escape: sample.escape,
                    };
                }
            }
            State::Dragging {
                at,
                modifiers,
                escape,
            } => {
                if sample.escape && !*escape {
                    // The system ends the drag session on Esc, so nothing moves until the release.
                    events.push(DragEvent::Escape);
                    self.state = State::Cancelled;
                } else {
                    if sample.at != *at || sample.modifiers != *modifiers {
                        events.push(DragEvent::Moved {
                            at: sample.at,
                            modifiers: sample.modifiers,
                        });
                        *at = sample.at;
                        *modifiers = sample.modifiers;
                    }
                    *escape = sample.escape;
                }
            }
        }
        events
    }
}

fn distance(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}

/// AppKit counts points from the bottom-left of the main screen with y growing upwards; Tauri,
/// like CoreGraphics, counts from its top-left with y growing downwards.
pub fn flip(appkit: Point, main_screen_height: f64) -> Point {
    Point {
        x: appkit.x,
        y: main_screen_height - appkit.y,
    }
}

/// Tauri's physical pixels: top-left points times the scale factor of the screen they lie on, the
/// way Tauri scales a window's position by its screen's factor.
pub fn to_physical(points: Point, scale: f64) -> Point {
    Point {
        x: points.x * scale,
        y: points.y * scale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: Modifiers = Modifiers {
        shift: false,
        control: false,
        alt: false,
        command: false,
    };
    const SHIFT: Modifiers = Modifiers {
        shift: true,
        ..NONE
    };

    fn sample(button_down: bool, x: f64, drag_count: isize) -> Sample {
        let points = Point { x, y: 100.0 };
        Sample {
            button_down,
            points,
            at: to_physical(points, 2.0),
            modifiers: NONE,
            escape: false,
            drag_count,
        }
    }

    fn up(x: f64, drag_count: isize) -> Sample {
        sample(false, x, drag_count)
    }

    fn down(x: f64, drag_count: isize) -> Sample {
        sample(true, x, drag_count)
    }

    fn with_escape(sample: Sample) -> Sample {
        Sample {
            escape: true,
            ..sample
        }
    }

    fn feed_all(tracker: &mut Tracker, samples: &[Sample]) -> Vec<DragEvent> {
        samples.iter().flat_map(|s| tracker.feed(s)).collect()
    }

    fn run(samples: &[Sample]) -> Vec<DragEvent> {
        feed_all(&mut Tracker::default(), samples)
    }

    fn physical(x: f64) -> Point {
        Point {
            x: x * 2.0,
            y: 200.0,
        }
    }

    #[test]
    fn a_click_is_not_a_drag() {
        assert_eq!(
            run(&[up(0.0, 5), down(0.0, 5), down(0.0, 5), up(0.0, 5)]),
            []
        );
    }

    #[test]
    fn moving_without_a_drag_pasteboard_change_is_not_a_drag() {
        assert_eq!(
            run(&[up(0.0, 5), down(0.0, 5), down(50.0, 5), up(50.0, 5)]),
            []
        );
    }

    #[test]
    fn a_drag_starts_moves_and_ends() {
        let mut tracker = Tracker::default();
        assert_eq!(
            feed_all(&mut tracker, &[up(0.0, 5), down(0.0, 5), down(10.0, 6)]),
            [DragEvent::Started {
                at: physical(10.0),
                modifiers: NONE
            }]
        );
        assert_eq!(
            tracker.feed(&down(20.0, 6)),
            [DragEvent::Moved {
                at: physical(20.0),
                modifiers: NONE
            }]
        );
        let shifted = Sample {
            modifiers: SHIFT,
            ..down(20.0, 6)
        };
        assert_eq!(
            tracker.feed(&shifted),
            [DragEvent::Moved {
                at: physical(20.0),
                modifiers: SHIFT
            }]
        );
        assert_eq!(tracker.feed(&shifted), []);
        assert_eq!(
            tracker.feed(&up(20.0, 6)),
            [DragEvent::Ended { at: physical(20.0) }]
        );
    }

    #[test]
    fn a_drag_that_began_between_two_polls_still_starts() {
        assert_eq!(
            run(&[up(0.0, 5), down(30.0, 6)]),
            [DragEvent::Started {
                at: physical(30.0),
                modifiers: NONE
            }]
        );
    }

    #[test]
    fn a_pasteboard_change_waits_for_the_threshold() {
        let mut tracker = Tracker::default();
        assert_eq!(
            feed_all(&mut tracker, &[up(0.0, 5), down(0.0, 6), down(3.0, 6)]),
            []
        );
        assert_eq!(
            tracker.feed(&down(5.0, 6)),
            [DragEvent::Started {
                at: physical(5.0),
                modifiers: NONE
            }]
        );
    }

    #[test]
    fn watching_can_start_with_the_button_already_down() {
        assert_eq!(
            run(&[down(0.0, 5), down(10.0, 5), down(10.0, 6)]),
            [DragEvent::Started {
                at: physical(10.0),
                modifiers: NONE
            }]
        );
    }

    #[test]
    fn escape_cancels_once_and_the_release_still_ends() {
        let mut tracker = Tracker::default();
        feed_all(&mut tracker, &[up(0.0, 5), down(10.0, 6)]);
        assert_eq!(
            tracker.feed(&with_escape(down(10.0, 6))),
            [DragEvent::Escape]
        );
        assert_eq!(
            feed_all(
                &mut tracker,
                &[down(40.0, 6), with_escape(down(40.0, 6)), down(50.0, 6)]
            ),
            []
        );
        assert_eq!(
            tracker.feed(&up(50.0, 6)),
            [DragEvent::Ended { at: physical(50.0) }]
        );
    }

    #[test]
    fn an_escape_held_before_the_drag_is_not_reported() {
        let mut tracker = Tracker::default();
        assert_eq!(
            feed_all(&mut tracker, &[up(0.0, 5), with_escape(down(10.0, 6))]),
            [DragEvent::Started {
                at: physical(10.0),
                modifiers: NONE
            }]
        );
        assert_eq!(tracker.feed(&with_escape(down(10.0, 6))), []);
        assert_eq!(tracker.feed(&down(10.0, 6)), []);
        assert_eq!(
            tracker.feed(&with_escape(down(10.0, 6))),
            [DragEvent::Escape]
        );
    }

    #[test]
    fn polls_quickly_only_while_the_button_is_down() {
        let mut tracker = Tracker::default();
        assert!(!tracker.is_pressed());
        tracker.feed(&down(0.0, 5));
        assert!(tracker.is_pressed());
        tracker.feed(&up(0.0, 5));
        assert!(!tracker.is_pressed());
    }

    #[test]
    fn appkit_points_become_top_left_physical_pixels() {
        let main_height = 1080.0;
        let top_left = flip(Point { x: 0.0, y: 1080.0 }, main_height);
        assert_eq!(top_left, Point { x: 0.0, y: 0.0 });
        let bottom = flip(Point { x: 100.0, y: 0.0 }, main_height);
        assert_eq!(
            bottom,
            Point {
                x: 100.0,
                y: 1080.0
            }
        );
        assert_eq!(
            to_physical(Point { x: 100.0, y: 50.0 }, 2.0),
            Point { x: 200.0, y: 100.0 }
        );
        // A screen placed above the main one lies at negative y.
        let above = flip(Point { x: 10.0, y: 1500.0 }, main_height);
        assert_eq!(to_physical(above, 2.0), Point { x: 20.0, y: -840.0 });
    }
}
