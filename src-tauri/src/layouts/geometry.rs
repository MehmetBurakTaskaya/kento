// SPDX-License-Identifier: MIT
//! Where a window goes for a layout: plain arithmetic on rectangles, the same on every system.
//! Windows works in physical pixels of the virtual screen, macOS in points from the top-left corner
//! of the main display; both may have negative coordinates left of or above the main display.

use super::Layout;

/// A rectangle by its top-left corner and size; `width` and `height` are never negative.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, width: i32, height: i32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// From the edges, as Win32's RECT gives them.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn from_edges(left: i32, top: i32, right: i32, bottom: i32) -> Self {
        Self::new(left, top, (right - left).max(0), (bottom - top).max(0))
    }

    pub fn right(&self) -> i32 {
        self.x + self.width
    }

    pub fn bottom(&self) -> i32 {
        self.y + self.height
    }

    // Choosing a screen is done here for macOS only; Windows asks the system (`MonitorFromWindow`).
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn overlap(&self, other: &Rect) -> i64 {
        let width = (self.right().min(other.right()) - self.x.max(other.x)).max(0);
        let height = (self.bottom().min(other.bottom()) - self.y.max(other.y)).max(0);
        i64::from(width) * i64::from(height)
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn distance_to_centre(&self, other: &Rect) -> i64 {
        let dx = i64::from(self.x) * 2 + i64::from(self.width)
            - (i64::from(other.x) * 2 + i64::from(other.width));
        let dy = i64::from(self.y) * 2 + i64::from(self.height)
            - (i64::from(other.y) * 2 + i64::from(other.height));
        dx * dx + dy * dy
    }
}

/// How far a window's outer rectangle reaches past what is drawn of it. On Windows 10 and 11 the
/// resize borders are invisible but still part of the window rectangle (DWM's extended frame
/// bounds give the visible part), so a window placed by its outer rectangle would leave a gap of
/// several pixels beside its neighbour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct Margins {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl Margins {
    /// The margins between a window's outer rectangle and its visible frame inside it.
    pub fn between(outer: Rect, visible: Rect) -> Self {
        Self {
            left: (visible.x - outer.x).max(0),
            top: (visible.y - outer.y).max(0),
            right: (outer.right() - visible.right()).max(0),
            bottom: (outer.bottom() - visible.bottom()).max(0),
        }
    }

    /// The outer rectangle that shows exactly `visible`.
    pub fn outer(&self, visible: Rect) -> Rect {
        Rect::new(
            visible.x - self.left,
            visible.y - self.top,
            visible.width + self.left + self.right,
            visible.height + self.top + self.bottom,
        )
    }
}

/// The part of the work area a layout covers. Halves and quarters split odd sizes so that the
/// two sides meet without a gap or an overlap: the right and bottom parts take the extra pixel.
pub fn region(layout: Layout, work: Rect) -> Rect {
    let half_width = work.width / 2;
    let half_height = work.height / 2;
    let left = Rect::new(work.x, work.y, half_width, work.height);
    let right = Rect::new(
        work.x + half_width,
        work.y,
        work.width - half_width,
        work.height,
    );
    let top = |side: Rect| Rect::new(side.x, side.y, side.width, half_height);
    let bottom = |side: Rect| {
        Rect::new(
            side.x,
            side.y + half_height,
            side.width,
            work.height - half_height,
        )
    };
    match layout {
        Layout::LeftHalf => left,
        Layout::RightHalf => right,
        Layout::TopLeft => top(left),
        Layout::TopRight => top(right),
        Layout::BottomLeft => bottom(left),
        Layout::BottomRight => bottom(right),
        Layout::Center | Layout::FullScreen => work,
    }
}

/// The largest share of the work area a centred window keeps, each way: a window that filled the
/// screen or a half becomes a window in the middle instead of staying where it was.
const CENTRE_SHARE: (i32, i32) = (2, 3);

/// Where the visible frame of a window goes for a layout, inside the work area of its monitor.
/// A window that cannot be resized keeps its size and is centred in the layout's part of the
/// screen, as far as the work area allows.
pub fn target(layout: Layout, work: Rect, current: Rect, resizable: bool) -> Rect {
    let area = region(layout, work);
    if !resizable {
        return keep_inside(centred(area, current.width, current.height), work);
    }
    match layout {
        Layout::Center => {
            let (num, den) = CENTRE_SHARE;
            let width = current.width.min(work.width * num / den).max(1);
            let height = current.height.min(work.height * num / den).max(1);
            centred(work, width, height)
        }
        _ => area,
    }
}

fn centred(area: Rect, width: i32, height: i32) -> Rect {
    Rect::new(
        area.x + (area.width - width) / 2,
        area.y + (area.height - height) / 2,
        width,
        height,
    )
}

/// Moves a rectangle (without resizing it) so that it lies inside `work`; one larger than the work
/// area keeps its top-left corner in it, so the title bar stays reachable.
pub fn keep_inside(rect: Rect, work: Rect) -> Rect {
    let fit = |start: i32, length: i32, area_start: i32, area_length: i32| {
        let last = area_start + area_length - length;
        start.min(last).max(area_start)
    };
    Rect::new(
        fit(rect.x, rect.width, work.x, work.width),
        fit(rect.y, rect.height, work.y, work.height),
        rect.width,
        rect.height,
    )
}

/// The monitor a window is on: the one it overlaps most, or the nearest when it overlaps none
/// (a window dragged almost off screen). `monitors` are their full bounds; None when empty.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn monitor_for(window: Rect, monitors: &[Rect]) -> Option<usize> {
    let best = monitors
        .iter()
        .enumerate()
        .max_by_key(|(index, bounds)| (bounds.overlap(&window), std::cmp::Reverse(*index)))?;
    if best.1.overlap(&window) > 0 {
        return Some(best.0);
    }
    monitors
        .iter()
        .enumerate()
        .min_by_key(|(_, bounds)| bounds.distance_to_centre(&window))
        .map(|(index, _)| index)
}

/// AppKit measures screens from the bottom-left corner of the main display, upwards; the
/// Accessibility API places windows from its top-left corner, downwards. `main_height` is the
/// height of the main display (the first screen).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn flip(x: f64, y: f64, width: f64, height: f64, main_height: f64) -> Rect {
    let top = main_height - (y + height);
    Rect::new(
        x.round() as i32,
        top.round() as i32,
        width.round() as i32,
        height.round() as i32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1920 x 1080 with a 48-pixel taskbar at the bottom.
    const WORK: Rect = Rect::new(0, 0, 1920, 1032);

    #[test]
    fn halves_and_quarters_tile_the_work_area_exactly() {
        assert_eq!(region(Layout::LeftHalf, WORK), Rect::new(0, 0, 960, 1032));
        assert_eq!(
            region(Layout::RightHalf, WORK),
            Rect::new(960, 0, 960, 1032)
        );
        assert_eq!(region(Layout::TopLeft, WORK), Rect::new(0, 0, 960, 516));
        assert_eq!(region(Layout::TopRight, WORK), Rect::new(960, 0, 960, 516));
        assert_eq!(
            region(Layout::BottomLeft, WORK),
            Rect::new(0, 516, 960, 516)
        );
        assert_eq!(
            region(Layout::BottomRight, WORK),
            Rect::new(960, 516, 960, 516)
        );
        assert_eq!(region(Layout::FullScreen, WORK), WORK);
    }

    #[test]
    fn odd_sizes_leave_no_gap_and_no_overlap() {
        // A taskbar on the left of a 1366 x 768 screen leaves an odd work area.
        let work = Rect::new(62, 0, 1305, 767);
        let left = region(Layout::LeftHalf, work);
        let right = region(Layout::RightHalf, work);
        assert_eq!(left.right(), right.x);
        assert_eq!(left.x, work.x);
        assert_eq!(right.right(), work.right());
        let top = region(Layout::TopRight, work);
        let bottom = region(Layout::BottomRight, work);
        assert_eq!(top.bottom(), bottom.y);
        assert_eq!(bottom.bottom(), work.bottom());
        assert_eq!(top.width, right.width);
    }

    #[test]
    fn a_monitor_at_negative_coordinates_works_the_same() {
        // A second monitor left of and above the main one, its taskbar at the top.
        let work = Rect::new(-2560, -400, 2560, 1392);
        assert_eq!(
            region(Layout::LeftHalf, work),
            Rect::new(-2560, -400, 1280, 1392)
        );
        assert_eq!(
            region(Layout::BottomRight, work),
            Rect::new(-1280, 296, 1280, 696)
        );
        let full = target(Layout::FullScreen, work, Rect::new(-900, 0, 300, 200), true);
        assert_eq!(full, work);
        let centre = target(Layout::Center, work, Rect::new(-900, 0, 800, 600), true);
        assert_eq!(centre, Rect::new(-1680, -4, 800, 600));
    }

    #[test]
    fn the_invisible_borders_are_added_back_so_visible_edges_meet() {
        // Windows 11 at 100 %: 7 invisible pixels left, right and below, none above.
        let outer = Rect::from_edges(93, 100, 907, 707);
        let visible = Rect::from_edges(100, 100, 900, 700);
        let margins = Margins::between(outer, visible);
        assert_eq!(
            margins,
            Margins {
                left: 7,
                top: 0,
                right: 7,
                bottom: 7
            }
        );
        let left = region(Layout::LeftHalf, WORK);
        let right = region(Layout::RightHalf, WORK);
        let (outer_left, outer_right) = (margins.outer(left), margins.outer(right));
        assert_eq!(outer_left, Rect::new(-7, 0, 974, 1039));
        assert_eq!(outer_right, Rect::new(953, 0, 974, 1039));
        // The outer rectangles overlap by the invisible borders; what shows meets exactly.
        assert_eq!(outer_left.x + margins.left + left.width, right.x);
        // A window without invisible borders (macOS, or a borderless window) is placed as is.
        assert_eq!(Margins::default().outer(left), left);
    }

    #[test]
    fn a_window_that_cannot_be_resized_keeps_its_size_and_is_centred() {
        let dialog = Rect::new(10, 10, 400, 300);
        assert_eq!(
            target(Layout::LeftHalf, WORK, dialog, false),
            Rect::new(280, 366, 400, 300)
        );
        assert_eq!(
            target(Layout::BottomRight, WORK, dialog, false),
            Rect::new(1240, 624, 400, 300)
        );
        assert_eq!(
            target(Layout::FullScreen, WORK, dialog, false),
            Rect::new(760, 366, 400, 300)
        );
        // Wider than a half: centred on the half, then kept on screen.
        let wide = Rect::new(0, 0, 1200, 300);
        assert_eq!(
            target(Layout::LeftHalf, WORK, wide, false),
            Rect::new(0, 366, 1200, 300)
        );
        // Larger than the screen: its top-left corner stays in the work area.
        let huge = Rect::new(0, 0, 2500, 1500);
        assert_eq!(
            target(Layout::Center, WORK, huge, false),
            Rect::new(0, 0, 2500, 1500)
        );
    }

    #[test]
    fn centre_keeps_the_size_up_to_two_thirds_of_the_screen() {
        let small = Rect::new(0, 0, 800, 600);
        assert_eq!(
            target(Layout::Center, WORK, small, true),
            Rect::new(560, 216, 800, 600)
        );
        // A window that filled a half keeps its width and loses height.
        let half = region(Layout::LeftHalf, WORK);
        assert_eq!(
            target(Layout::Center, WORK, half, true),
            Rect::new(480, 172, 960, 688)
        );
        assert_eq!(
            target(Layout::Center, WORK, WORK, true),
            Rect::new(320, 172, 1280, 688)
        );
    }

    #[test]
    fn keeping_inside_moves_without_resizing() {
        assert_eq!(
            keep_inside(Rect::new(1800, 900, 400, 300), WORK),
            Rect::new(1520, 732, 400, 300)
        );
        assert_eq!(
            keep_inside(Rect::new(-50, -20, 400, 300), WORK),
            Rect::new(0, 0, 400, 300)
        );
        let inside = Rect::new(100, 100, 400, 300);
        assert_eq!(keep_inside(inside, WORK), inside);
    }

    #[test]
    fn the_monitor_is_the_one_the_window_overlaps_most() {
        let monitors = [
            Rect::new(0, 0, 1920, 1080),
            Rect::new(-2560, -400, 2560, 1440),
            Rect::new(1920, 0, 1920, 1080),
        ];
        assert_eq!(
            monitor_for(Rect::new(100, 100, 400, 300), &monitors),
            Some(0)
        );
        assert_eq!(
            monitor_for(Rect::new(-700, 0, 1000, 500), &monitors),
            Some(1)
        );
        assert_eq!(
            monitor_for(Rect::new(1800, 0, 500, 500), &monitors),
            Some(2)
        );
        // Off every screen: the nearest one.
        assert_eq!(
            monitor_for(Rect::new(4200, 100, 200, 200), &monitors),
            Some(2)
        );
        assert_eq!(monitor_for(Rect::new(0, 0, 10, 10), &[]), None);
    }

    #[test]
    fn appkit_rectangles_turn_into_top_left_ones() {
        // The main display is 1440 x 900 points; the menu bar takes 25 and the Dock 70 below.
        assert_eq!(
            flip(0.0, 70.0, 1440.0, 805.0, 900.0),
            Rect::new(0, 25, 1440, 805)
        );
        // A display above the main one has negative top-left coordinates.
        assert_eq!(
            flip(-200.0, 900.0, 1920.0, 1080.0, 900.0),
            Rect::new(-200, -1080, 1920, 1080)
        );
    }
}
