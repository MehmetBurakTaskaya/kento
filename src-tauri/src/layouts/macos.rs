// SPDX-License-Identifier: MIT
//! macOS: the focused window of the frontmost app, moved and sized through the Accessibility API
//! (`AXPosition`, `AXSize`) inside the visible frame of its screen (without the menu bar and the
//! Dock). The API works only for apps the user has allowed in System Settings › Privacy & Security
//! › Accessibility; Kento asks with `AXIsProcessTrustedWithOptions` when the feature is switched on
//! or first used, after saying why.

use std::ffi::c_void;
use std::process::Command;
use std::ptr::NonNull;

use objc2::MainThreadMarker;
use objc2_app_kit::{NSScreen, NSWorkspace};
use objc2_application_services::{
    kAXTrustedCheckOptionPrompt, AXError, AXIsProcessTrusted, AXIsProcessTrustedWithOptions,
    AXUIElement, AXValue, AXValueType,
};
use objc2_core_foundation::{
    CFBoolean, CFDictionary, CFRetained, CFString, CFType, CGPoint, CGSize,
};

use super::geometry::{self, Rect};
use super::{Layout, LayoutError, Permission};

/// The frontmost app, by its process id; its focused window is looked up when it is placed.
pub type Target = i32;

pub struct Screen {
    bounds: Rect,
    work: Rect,
}

pub type Screens = Vec<Screen>;

/// System Settings › Privacy & Security › Accessibility.
const ACCESSIBILITY_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

/// How long Kento waits for an app to answer before giving up on it, instead of the system's
/// default of several seconds.
const ANSWER_TIMEOUT: f32 = 1.0;

pub fn permission() -> Permission {
    // SAFETY: no arguments.
    if unsafe { AXIsProcessTrusted() } {
        Permission::Granted
    } else {
        Permission::Missing
    }
}

/// The system's prompt, which offers to open System Settings; it comes asynchronously.
pub fn ask_permission() {
    // SAFETY: a constant the framework provides for the lifetime of the process.
    let key: &CFString = unsafe { kAXTrustedCheckOptionPrompt };
    let options = CFDictionary::<CFString, CFBoolean>::from_slices(&[key], &[CFBoolean::new(true)]);
    // SAFETY: the options dictionary maps the documented key to a CFBoolean.
    unsafe { AXIsProcessTrustedWithOptions(Some(options.as_opaque())) };
}

pub fn open_permission_settings() -> Result<(), LayoutError> {
    let status = Command::new("/usr/bin/open")
        .arg(ACCESSIBILITY_SETTINGS)
        .status()
        .map_err(|err| LayoutError::Failed(format!("open System Settings: {err}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(LayoutError::Failed(format!(
            "open System Settings: {status}"
        )))
    }
}

/// The frontmost app and its name, unless it is Kento. AppKit work: main thread only.
pub fn front() -> Option<(Target, String)> {
    MainThreadMarker::new()?;
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let pid = app.processIdentifier();
    if pid <= 0 || u32::try_from(pid).ok() == Some(std::process::id()) {
        return None;
    }
    let name = app
        .localizedName()
        .map(|name| name.to_string())
        .unwrap_or_default();
    Some((pid, name))
}

/// Every screen's bounds and visible frame, from the top-left corner of the main screen as the
/// Accessibility API counts. AppKit work: main thread only.
pub fn screens() -> Screens {
    let Some(mtm) = MainThreadMarker::new() else {
        return Vec::new();
    };
    let all = NSScreen::screens(mtm).to_vec();
    // The first screen is the main one, the origin of both coordinate systems.
    let Some(main_height) = all.first().map(|main| main.frame().size.height) else {
        return Vec::new();
    };
    all.iter()
        .map(|screen| {
            let (frame, visible) = (screen.frame(), screen.visibleFrame());
            Screen {
                bounds: geometry::flip(
                    frame.origin.x,
                    frame.origin.y,
                    frame.size.width,
                    frame.size.height,
                    main_height,
                ),
                work: geometry::flip(
                    visible.origin.x,
                    visible.origin.y,
                    visible.size.width,
                    visible.size.height,
                    main_height,
                ),
            }
        })
        .collect()
}

pub fn place(
    pid: Target,
    layout: Layout,
    screens: &Screens,
    activate: bool,
) -> Result<(), LayoutError> {
    if permission() != Permission::Granted {
        return Err(LayoutError::Permission);
    }
    if u32::try_from(pid).ok() == Some(std::process::id()) {
        return Err(LayoutError::NoWindow);
    }
    // SAFETY: a plain constructor for a process id.
    let app = unsafe { AXUIElement::new_application(pid) };
    // SAFETY: a valid element.
    unsafe { app.set_messaging_timeout(ANSWER_TIMEOUT) };
    let window = element(&app, "AXFocusedWindow")
        .or_else(|| element(&app, "AXMainWindow"))
        .ok_or(LayoutError::NoWindow)?;
    // A full-screen window lives in a Space of its own; leaving it is the user's choice.
    if flag(&window, "AXFullScreen") == Some(true) {
        return Err(LayoutError::Blocked);
    }
    if flag(&window, "AXMinimized") == Some(true) {
        set(&window, "AXMinimized", CFBoolean::new(false))?;
    }
    let current = frame(&window)?;
    let bounds: Vec<Rect> = screens.iter().map(|screen| screen.bounds).collect();
    let work = geometry::monitor_for(current, &bounds)
        .and_then(|index| screens.get(index))
        .map(|screen| screen.work)
        .ok_or_else(|| LayoutError::Failed("no screen".into()))?;
    let resizable = settable(&window, "AXSize");
    let goal = geometry::target(layout, work, current, resizable);
    // Moved first, so the new size fits where it goes; moved again in case the system kept the
    // window on its old screen while it grew.
    move_to(&window, goal)?;
    if resizable {
        resize(&window, goal)?;
        move_to(&window, goal)?;
    }
    // A window can refuse a size (its minimum); what it took stays on the screen.
    let placed = frame(&window)?;
    let inside = geometry::keep_inside(placed, work);
    if inside != placed {
        move_to(&window, inside)?;
    }
    if activate {
        // Back from Kento's wheel to the app, with this window in front.
        let _ = set(&app, "AXFrontmost", CFBoolean::new(true));
        // SAFETY: a valid element and a standard action name.
        let _ = unsafe { window.perform_action(&CFString::from_str("AXRaise")) };
    }
    Ok(())
}

fn failure(err: AXError) -> LayoutError {
    match err {
        AXError::APIDisabled => LayoutError::Permission,
        // The window does not let itself be moved or sized.
        AXError::AttributeUnsupported | AXError::IllegalArgument => LayoutError::Blocked,
        other => LayoutError::Failed(format!("Accessibility error {}", other.0)),
    }
}

fn attribute(element: &AXUIElement, name: &str) -> Result<CFRetained<CFType>, AXError> {
    let name = CFString::from_str(name);
    let mut value: *const CFType = std::ptr::null();
    // SAFETY: a valid element and out pointer; a value handed back is owned by the caller.
    let err = unsafe { element.copy_attribute_value(&name, NonNull::from(&mut value)) };
    if err != AXError::Success {
        return Err(err);
    }
    NonNull::new(value.cast_mut())
        // SAFETY: the copied value carries a reference that is ours to release.
        .map(|value| unsafe { CFRetained::from_raw(value) })
        .ok_or(AXError::NoValue)
}

fn element(parent: &AXUIElement, name: &str) -> Option<CFRetained<AXUIElement>> {
    attribute(parent, name).ok()?.downcast::<AXUIElement>().ok()
}

fn flag(element: &AXUIElement, name: &str) -> Option<bool> {
    attribute(element, name)
        .ok()?
        .downcast::<CFBoolean>()
        .ok()
        .map(|value| value.as_bool())
}

fn settable(element: &AXUIElement, name: &str) -> bool {
    let name = CFString::from_str(name);
    let mut settable: u8 = 0;
    // SAFETY: a valid element and out pointer.
    let err = unsafe { element.is_attribute_settable(&name, NonNull::from(&mut settable)) };
    err == AXError::Success && settable != 0
}

fn set(element: &AXUIElement, name: &str, value: &CFType) -> Result<(), LayoutError> {
    let name = CFString::from_str(name);
    // SAFETY: a valid element, attribute name and value.
    match unsafe { element.set_attribute_value(&name, value) } {
        AXError::Success => Ok(()),
        err => Err(failure(err)),
    }
}

fn value<T>(element: &AXUIElement, name: &str, kind: AXValueType) -> Result<T, LayoutError>
where
    T: Default,
{
    let value = attribute(element, name)
        .map_err(failure)?
        .downcast::<AXValue>()
        .map_err(|_| LayoutError::Failed(format!("{name} is not a value")))?;
    let mut out = T::default();
    // SAFETY: `out` has the layout of the structure `kind` names.
    if unsafe { value.value(kind, NonNull::from(&mut out).cast::<c_void>()) } {
        Ok(out)
    } else {
        Err(LayoutError::Failed(format!("{name} could not be read")))
    }
}

/// The window's frame in points from the top-left corner of the main screen.
fn frame(window: &AXUIElement) -> Result<Rect, LayoutError> {
    let point: CGPoint = value(window, "AXPosition", AXValueType::CGPoint)?;
    let size: CGSize = value(window, "AXSize", AXValueType::CGSize)?;
    Ok(Rect::new(
        point.x.round() as i32,
        point.y.round() as i32,
        size.width.round() as i32,
        size.height.round() as i32,
    ))
}

fn move_to(window: &AXUIElement, rect: Rect) -> Result<(), LayoutError> {
    let point = CGPoint {
        x: f64::from(rect.x),
        y: f64::from(rect.y),
    };
    // SAFETY: a CGPoint for the CGPoint type.
    let value = unsafe { AXValue::new(AXValueType::CGPoint, NonNull::from(&point).cast()) }
        .ok_or_else(|| LayoutError::Failed("a position could not be made".into()))?;
    set(window, "AXPosition", &value)
}

fn resize(window: &AXUIElement, rect: Rect) -> Result<(), LayoutError> {
    let size = CGSize {
        width: f64::from(rect.width),
        height: f64::from(rect.height),
    };
    // SAFETY: a CGSize for the CGSize type.
    let value = unsafe { AXValue::new(AXValueType::CGSize, NonNull::from(&size).cast()) }
        .ok_or_else(|| LayoutError::Failed("a size could not be made".into()))?;
    set(window, "AXSize", &value)
}
