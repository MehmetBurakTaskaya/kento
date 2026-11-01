// SPDX-License-Identifier: MIT
//! The system share picker, opened next to the pointer inside the window that asked for it.

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{AnyThread, MainThreadMarker};
use objc2_app_kit::{NSEvent, NSSharingServicePicker, NSView, NSWindow};
use objc2_foundation::{NSArray, NSRect, NSRectEdge, NSSize, NSURL};

use crate::platform::{PlatformError, Result};

thread_local! {
    // AppKit does not document that it keeps the picker alive while it is shown.
    static PICKER: RefCell<Option<Retained<NSSharingServicePicker>>> = const { RefCell::new(None) };
}

pub fn share(paths: &[PathBuf], window: isize) -> Result<()> {
    if MainThreadMarker::new().is_none() {
        return Err(PlatformError::Failed(
            "the share picker opens on the main thread".into(),
        ));
    }
    if window == 0 {
        return Err(PlatformError::Failed(
            "no window for the share picker".into(),
        ));
    }
    let urls: Vec<Retained<NSURL>> = paths.iter().filter_map(|path| file_url(path)).collect();
    if urls.is_empty() {
        return Err(PlatformError::Failed("nothing to share".into()));
    }
    // SAFETY: `window` is the `NSWindow` pointer Tauri's `ns_window()` returns for a window that is
    // still open, and this runs on the main thread that owns it, checked above.
    let window = unsafe { &*(window as *const NSWindow) };
    let view = window
        .contentView()
        .ok_or_else(|| PlatformError::Failed("the window has no content view".into()))?;
    let objects: Vec<&AnyObject> = urls.iter().map(|url| as_object(url)).collect();
    let items = NSArray::from_slice(objects.as_slice());
    // SAFETY: every item is a file URL, which the picker accepts (NSURL conforms to
    // NSPasteboardWriting).
    let picker =
        unsafe { NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &items) };
    picker.showRelativeToRect_ofView_preferredEdge(anchor(window, &view), &view, NSRectEdge::MinY);
    PICKER.set(Some(picker));
    Ok(())
}

fn file_url(path: &Path) -> Option<Retained<NSURL>> {
    if path.is_dir() {
        NSURL::from_directory_path(path)
    } else {
        NSURL::from_file_path(path)
    }
}

fn as_object(url: &NSURL) -> &AnyObject {
    url
}

/// A point-sized rectangle under the pointer, or in the middle of the view when the pointer is
/// outside it; the picker opens beside it.
fn anchor(window: &NSWindow, view: &NSView) -> NSRect {
    let bounds = view.bounds();
    let (min, max) = (bounds.min(), bounds.max());
    let pointer = view.convertPoint_fromView(
        window.convertPointFromScreen(NSEvent::mouseLocation()),
        None,
    );
    let inside = (min.x..=max.x).contains(&pointer.x) && (min.y..=max.y).contains(&pointer.y);
    let at = if inside { pointer } else { bounds.mid() };
    NSRect::new(at, NSSize::new(1.0, 1.0))
}
