// SPDX-License-Identifier: MIT
//! The selection of the foreground File Explorer window through `ShellWindows` (the collection
//! `Shell.Application.Windows()` returns) and each window's top-level browser.
//!
//! Windows 11's tabbed Explorer lists every tab as its own entry with the same top-level window.
//! Only the active tab's browser window (its `ShellTabWindowClass` child) and shell view are
//! visible, so that is how the active tab is told apart.

use std::ffi::c_void;
use std::mem::ManuallyDrop;
use std::path::PathBuf;

use windows::core::Interface;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoCreateInstance, IServiceProvider, CLSCTX_LOCAL_SERVER};
use windows::Win32::System::Variant::{
    InitVariantFromBuffer, VariantClear, VARENUM, VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0,
    VT_BYREF, VT_I4, VT_VARIANT,
};
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, IFolderView, ILFree, ILGetSize, IShellBrowser, IShellItemArray, IShellView,
    IShellWindows, IWebBrowserApp, SHGetKnownFolderIDList, SID_STopLevelBrowser, ShellWindows,
    SIGDN_FILESYSPATH, SVGIO_SELECTION, SWC_DESKTOP, SWFO_NEEDDISPATCH,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, IsWindowVisible,
};

use super::{failed, take_co_string, Com};
use crate::platform::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowKind {
    Explorer,
    Desktop,
    Other,
}

fn window_kind(class: &str) -> WindowKind {
    match class {
        "CabinetWClass" | "ExploreWClass" => WindowKind::Explorer,
        // The desktop's icons live under Progman, or under a WorkerW once the wallpaper has
        // been animated (slideshow, Win+Tab).
        "Progman" | "WorkerW" => WindowKind::Desktop,
        _ => WindowKind::Other,
    }
}

fn class_name(window: HWND) -> String {
    let mut buffer = [0u16; 64];
    // SAFETY: the buffer is a valid, writable slice.
    let len = unsafe { GetClassNameW(window, &mut buffer) };
    String::from_utf16_lossy(&buffer[..usize::try_from(len).unwrap_or(0)])
}

pub fn file_manager_selection() -> Result<Vec<PathBuf>> {
    // SAFETY: no arguments; a null handle is handled below.
    let front = unsafe { GetForegroundWindow() };
    if front.is_invalid() {
        return Ok(Vec::new());
    }
    let kind = window_kind(&class_name(front));
    if kind == WindowKind::Other {
        return Ok(Vec::new());
    }
    let _com = Com::apartment()?;
    if kind == WindowKind::Desktop {
        desktop_selection()
    } else {
        explorer_selection(front)
    }
}

fn shell_windows() -> Result<IShellWindows> {
    // SAFETY: plain COM activation on a thread where COM is initialized.
    unsafe { CoCreateInstance(&ShellWindows, None, CLSCTX_LOCAL_SERVER) }
        .map_err(|err| failed("the Explorer windows could not be listed", err))
}

fn top_level_browser(window: &impl Interface) -> windows::core::Result<IShellBrowser> {
    let provider: IServiceProvider = window.cast()?;
    // SAFETY: the service id is a valid GUID constant.
    unsafe { provider.QueryService(&SID_STopLevelBrowser) }
}

fn explorer_selection(window: HWND) -> Result<Vec<PathBuf>> {
    let windows = shell_windows()?;
    let tabs = tabs_of(&windows, window);
    let active = if tabs.len() == 1 {
        tabs.into_iter().next().map(|(view, _)| view)
    } else {
        tabs.into_iter()
            .find(|(_, shown)| *shown)
            .map(|(view, _)| view)
    };
    match active {
        Some(view) => selected_paths(&view),
        None => {
            tracing::debug!("no active Explorer tab found in the front window");
            Ok(Vec::new())
        }
    }
}

/// The shell view of each tab of `window`, and whether it is the tab on screen.
fn tabs_of(windows: &IShellWindows, window: HWND) -> Vec<(IShellView, bool)> {
    // SAFETY: COM calls on live interfaces; a failing entry is skipped.
    let count = unsafe { windows.Count() }.unwrap_or(0);
    (0..count)
        .filter_map(|index| {
            // SAFETY: as above; the VARIANT holds a plain integer.
            unsafe {
                let entry = windows.Item(&index_variant(index)).ok()?;
                let app: IWebBrowserApp = entry.cast().ok()?;
                if app.HWND().ok()?.0 != window.0 as isize {
                    return None;
                }
                let browser = top_level_browser(&entry).ok()?;
                let view = browser.QueryActiveShellView().ok()?;
                let shown = match (browser.GetWindow(), view.GetWindow()) {
                    (Ok(tab), Ok(pane)) => {
                        IsWindowVisible(tab).as_bool() && IsWindowVisible(pane).as_bool()
                    }
                    _ => false,
                };
                Some((view, shown))
            }
        })
        .collect()
}

fn desktop_selection() -> Result<Vec<PathBuf>> {
    let view = desktop_view()?;
    selected_paths(&view)
}

/// The desktop's shell view, found by its location (the empty ID list of the namespace root),
/// as `FindWindowSW` documents: an absolute PIDL in a `VT_VARIANT | VT_BYREF` VARIANT.
fn desktop_view() -> Result<IShellView> {
    let windows = shell_windows()?;
    let fail = |err| failed("the desktop could not be read", err);
    // SAFETY: the ID list is freed after it was copied into the VARIANT, the inner VARIANT
    // outlives the by-reference one that points at it, and it is cleared once.
    unsafe {
        let root = SHGetKnownFolderIDList(&FOLDERID_Desktop, 0, None).map_err(fail)?;
        let location = InitVariantFromBuffer(root as *const c_void, ILGetSize(Some(root)));
        ILFree(Some(root));
        let mut location = location.map_err(fail)?;
        let by_ref = variant(
            VT_VARIANT | VT_BYREF,
            VARIANT_0_0_0 {
                pvarVal: &mut location,
            },
        );
        let mut window = 0i32;
        let found = windows.FindWindowSW(
            &by_ref,
            &VARIANT::default(),
            SWC_DESKTOP,
            &mut window,
            SWFO_NEEDDISPATCH,
        );
        let _ = VariantClear(&mut location);
        let browser = top_level_browser(&found.map_err(fail)?).map_err(fail)?;
        browser.QueryActiveShellView().map_err(fail)
    }
}

fn variant(vt: VARENUM, value: VARIANT_0_0_0) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt,
                Anonymous: value,
                ..Default::default()
            }),
        },
    }
}

fn index_variant(index: i32) -> VARIANT {
    variant(VT_I4, VARIANT_0_0_0 { lVal: index })
}

fn selected_paths(view: &IShellView) -> Result<Vec<PathBuf>> {
    let folder: IFolderView = view
        .cast()
        .map_err(|err| failed("the Explorer view could not be read", err))?;
    // SAFETY: COM calls on live interfaces; returned strings are freed by take_co_string.
    unsafe {
        if folder.ItemCount(SVGIO_SELECTION).unwrap_or(0) <= 0 {
            return Ok(Vec::new());
        }
        let items: IShellItemArray = folder
            .Items(SVGIO_SELECTION)
            .map_err(|err| failed("the Explorer selection could not be read", err))?;
        let count = items.GetCount().unwrap_or(0);
        let mut paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let Ok(item) = items.GetItemAt(index) else {
                continue;
            };
            // Items outside the file system (This PC, Control Panel, inside a ZIP) have no path.
            if let Ok(path) = item.GetDisplayName(SIGDN_FILESYSPATH) {
                paths.push(PathBuf::from(take_co_string(path)));
            }
        }
        Ok(paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::{w, PCWSTR};
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, FindWindowW};

    const NO_TITLE: PCWSTR = PCWSTR::null();

    #[test]
    fn window_classes_map_to_kinds() {
        assert_eq!(window_kind("CabinetWClass"), WindowKind::Explorer);
        assert_eq!(window_kind("ExploreWClass"), WindowKind::Explorer);
        assert_eq!(window_kind("Progman"), WindowKind::Desktop);
        assert_eq!(window_kind("WorkerW"), WindowKind::Desktop);
        assert_eq!(window_kind("Shell_TrayWnd"), WindowKind::Other);
        assert_eq!(window_kind("ShellTabWindowClass"), WindowKind::Other);
        assert_eq!(window_kind(""), WindowKind::Other);
    }

    #[test]
    fn the_foreground_selection_never_fails() {
        // Whatever is in front while the tests run (a terminal, usually) gives Ok.
        assert!(file_manager_selection().is_ok());
    }

    #[test]
    fn every_open_explorer_window_can_be_read() {
        // SAFETY: plain window lookups.
        let mut next = unsafe { FindWindowExW(None, None, w!("CabinetWClass"), NO_TITLE) };
        let _com = Com::apartment().expect("COM");
        let mut seen = 0;
        while let Ok(window) = next {
            assert!(explorer_selection(window).is_ok());
            seen += 1;
            // SAFETY: as above.
            next = unsafe { FindWindowExW(None, Some(window), w!("CabinetWClass"), NO_TITLE) };
        }
        eprintln!("read the selection of {seen} Explorer windows");
    }

    #[test]
    fn the_desktop_view_is_found_when_explorer_is_the_shell() {
        // SAFETY: a plain window lookup.
        if unsafe { FindWindowW(w!("Progman"), NO_TITLE) }.is_err() {
            return;
        }
        let _com = Com::apartment().expect("COM");
        assert!(desktop_view().is_ok());
        assert!(desktop_selection().is_ok());
    }
}
