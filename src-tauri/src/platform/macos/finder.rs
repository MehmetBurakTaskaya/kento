// SPDX-License-Identifier: MIT
//! The Finder selection through Apple Events. The first use makes macOS ask the user for the
//! Automation permission (the app needs `NSAppleEventsUsageDescription` in its Info.plist).

use std::path::PathBuf;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{msg_send, AnyThread, MainThreadMarker};
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{
    NSAppleEventDescriptor, NSAppleScript, NSAppleScriptErrorNumber, NSDictionary, NSNumber,
    NSString,
};

use crate::platform::{PlatformError, Result};

const FINDER: &str = "com.apple.finder";

/// POSIX paths of the selected items; `as alias list` keeps a single item a list.
const SELECTION_SCRIPT: &str = r#"
tell application "Finder" to set selectedItems to selection as alias list
set selectedPaths to {}
repeat with selectedItem in selectedItems
    set end of selectedPaths to POSIX path of (contents of selectedItem)
end repeat
return selectedPaths"#;

/// `errAEEventNotPermitted`: the user refused Automation access to Finder.
const NOT_PERMITTED: isize = -1743;
/// `errAEEventWouldRequireUserConsent`.
const NEEDS_CONSENT: isize = -1744;

pub fn file_manager_selection() -> Result<Vec<PathBuf>> {
    // Apple lists NSAppleScript among the classes to use from the main thread only.
    if MainThreadMarker::new().is_none() {
        return Err(PlatformError::Failed(
            "the Finder selection is read on the main thread".into(),
        ));
    }
    // Checked first so that no Apple Event, and no permission prompt, happens outside Finder.
    if !finder_is_frontmost() {
        return Ok(Vec::new());
    }
    let script = NSAppleScript::initWithSource(
        NSAppleScript::alloc(),
        &NSString::from_str(SELECTION_SCRIPT),
    )
    .ok_or_else(|| PlatformError::Failed("could not create the Finder script".into()))?;
    let mut error: Option<Retained<NSDictionary<NSString, AnyObject>>> = None;
    // SAFETY: `executeAndReturnError:` takes a nullable `NSDictionary **` out-parameter and
    // returns nil on failure, which the generated binding would turn into a panic; this runs on
    // the main thread, checked above.
    let result: Option<Retained<NSAppleEventDescriptor>> =
        unsafe { msg_send![&*script, executeAndReturnError: Some(&mut error)] };
    let Some(list) = result else {
        return Err(script_error(error.as_deref()));
    };
    // AppleScript lists count from 1.
    let paths = (1..=list.numberOfItems())
        .filter_map(|index| list.descriptorAtIndex(index)?.stringValue())
        .map(|path| PathBuf::from(path.to_string()))
        .collect();
    Ok(paths)
}

fn finder_is_frontmost() -> bool {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .and_then(|app| app.bundleIdentifier())
        .is_some_and(|id| id.to_string() == FINDER)
}

fn script_error(info: Option<&NSDictionary<NSString, AnyObject>>) -> PlatformError {
    // SAFETY: a constant Foundation provides for the lifetime of the process.
    let key = unsafe { NSAppleScriptErrorNumber };
    let code = info
        .and_then(|info| info.objectForKey(key))
        .and_then(|value| value.downcast_ref::<NSNumber>().map(|n| n.integerValue()));
    match code {
        Some(NOT_PERMITTED | NEEDS_CONSENT) => {
            PlatformError::Permission("Automation access to Finder".into())
        }
        Some(code) => PlatformError::Failed(format!("Finder selection failed ({code})")),
        None => PlatformError::Failed("Finder selection failed".into()),
    }
}
