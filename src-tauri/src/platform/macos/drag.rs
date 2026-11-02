// SPDX-License-Identifier: MIT
//! Polls the pointer, the modifier keys and the drag pasteboard from a background thread. No event
//! tap, so neither the Accessibility nor the Input Monitoring permission is involved.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use objc2::rc::autoreleasepool;
use objc2_app_kit::{
    NSEvent, NSEventModifierFlags, NSPasteboard, NSPasteboardNameDrag, NSPasteboardTypeString,
    NSPasteboardTypeURL,
};
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGDisplayCopyDisplayMode, CGDisplayMode, CGError,
    CGEventSource, CGEventSourceStateID, CGGetDisplaysWithPoint, CGMainDisplayID,
};
use objc2_foundation::NSPoint;

use super::tracker::{flip, to_physical, Sample, Tracker};
use crate::platform::{DragEvent, Modifiers, PlatformError, Point, Result};

const IDLE_POLL: Duration = Duration::from_millis(40);
const PRESSED_POLL: Duration = Duration::from_millis(10);
/// Bit 0 of `pressedMouseButtons` is the primary button.
const PRIMARY_BUTTON: usize = 1;
/// `kVK_Escape` among the HIToolbox virtual key codes.
const ESCAPE_KEY: u16 = 0x35;

pub struct Watcher {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.thread.take() {
            // Dropped from inside `on_event`, the thread cannot wait for itself; it stops at its
            // next poll instead.
            if handle.thread().id() != thread::current().id() {
                let _ = handle.join();
            }
        }
    }
}

pub fn watch_drags(on_event: Box<dyn Fn(DragEvent) + Send + 'static>) -> Result<Watcher> {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let thread = thread::Builder::new()
        .name("kento-drag-watch".into())
        .spawn(move || poll(on_event, &flag))
        .map_err(|e| PlatformError::Failed(format!("drag watcher thread: {e}")))?;
    Ok(Watcher {
        stop,
        thread: Some(thread),
    })
}

fn poll(on_event: impl Fn(DragEvent), stop: &AtomicBool) {
    // SAFETY: a constant AppKit provides for the lifetime of the process.
    let name = unsafe { NSPasteboardNameDrag };
    let board = autoreleasepool(|_| NSPasteboard::pasteboardWithName(name));
    let mut tracker = Tracker::default();
    while !stop.load(Ordering::Relaxed) {
        // This thread has no run loop to drain autoreleased objects.
        let sample = autoreleasepool(|_| read_sample(&board));
        for event in tracker.feed(&sample) {
            on_event(event);
        }
        thread::sleep(if tracker.is_pressed() {
            PRESSED_POLL
        } else {
            IDLE_POLL
        });
    }
}

/// The web address on the drag pasteboard: a link or a picture dragged out of a browser puts it
/// there as `public.url`, and selected text that is one address as plain text. The webview hands
/// such a drag over without files, so the wheel and Home ask here when it enters them.
pub fn dragged_link() -> Option<String> {
    autoreleasepool(|_| {
        // SAFETY: constants AppKit provides for the lifetime of the process.
        let (name, url, text) = unsafe {
            (
                NSPasteboardNameDrag,
                NSPasteboardTypeURL,
                NSPasteboardTypeString,
            )
        };
        let board = NSPasteboard::pasteboardWithName(name);
        let texts = [url, text]
            .into_iter()
            .filter_map(|kind| board.stringForType(kind))
            .map(|found| found.to_string());
        match crate::platform::DragContent::classify(Vec::new(), texts) {
            crate::platform::DragContent::Link(link) => Some(link),
            _ => None,
        }
    })
}

/// NSEvent's class methods report the current hardware state and are meant for polling outside
/// the event stream.
fn read_sample(board: &NSPasteboard) -> Sample {
    let location = NSEvent::mouseLocation();
    let main_height = CGDisplayBounds(CGMainDisplayID()).size.height;
    let points = flip(
        Point {
            x: location.x,
            y: location.y,
        },
        main_height,
    );
    let flags = NSEvent::modifierFlags_class();
    Sample {
        button_down: (NSEvent::pressedMouseButtons() & PRIMARY_BUTTON) != 0,
        points,
        at: to_physical(points, scale_at(points)),
        modifiers: Modifiers {
            shift: flags.contains(NSEventModifierFlags::Shift),
            control: flags.contains(NSEventModifierFlags::Control),
            alt: flags.contains(NSEventModifierFlags::Option),
            command: flags.contains(NSEventModifierFlags::Command),
        },
        escape: CGEventSource::key_state(CGEventSourceStateID::HIDSystemState, ESCAPE_KEY),
        drag_count: board.changeCount(),
    }
}

/// The backing scale factor of the display under `at` (top-left points): its mode's width in
/// pixels over its width in points. CoreGraphics, not `NSScreen`, because `NSScreen` is
/// main-thread only and this runs on the watcher's thread; both describe the same displays.
fn scale_at(at: Point) -> f64 {
    let mut display: CGDirectDisplayID = 0;
    let mut found: u32 = 0;
    // SAFETY: both out-pointers are live locals, and room for exactly one display is announced.
    let error =
        unsafe { CGGetDisplaysWithPoint(NSPoint::new(at.x, at.y), 1, &mut display, &mut found) };
    if error != CGError::Success || found == 0 {
        display = CGMainDisplayID();
    }
    let Some(mode) = CGDisplayCopyDisplayMode(display) else {
        return 1.0;
    };
    let points = CGDisplayMode::width(Some(&*mode));
    let pixels = CGDisplayMode::pixel_width(Some(&*mode));
    if points == 0 || pixels == 0 {
        1.0
    } else {
        pixels as f64 / points as f64
    }
}
