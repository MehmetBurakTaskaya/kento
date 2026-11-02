// SPDX-License-Identifier: MIT
//! Windows: the foreground window, moved with `SetWindowPos` inside the work area of the monitor it
//! is on. Everything is measured in physical pixels (Per-Monitor v2 on the calling thread for the
//! length of a call), and the window is placed by what DWM draws of it, not by its rectangle with
//! the invisible resize borders, so the visible edges of two halves meet exactly.

use std::ffi::c_void;

use windows::Win32::Foundation::{CloseHandle, E_ACCESSDENIED, HANDLE, HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
    TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, OpenProcess, OpenProcessToken,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::HiDpi::{
    SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextW,
    GetWindowThreadProcessId, IsHungAppWindow, IsIconic, IsWindow, IsZoomed, SetForegroundWindow,
    SetWindowPos, ShowWindow, GWL_STYLE, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    SWP_NOZORDER, SW_RESTORE, WS_THICKFRAME,
};

use super::geometry::{self, Margins, Rect};
use super::{Layout, LayoutError, Permission};

/// A top-level window, by its handle as an integer (an HWND is not `Send`).
pub type Target = isize;

/// Each window's monitor is found from the window itself, so nothing is gathered up front.
#[derive(Debug, Clone, Copy)]
pub struct Screens;

pub fn screens() -> Screens {
    Screens
}

pub fn permission() -> Permission {
    Permission::NotNeeded
}

pub fn ask_permission() {}

pub fn open_permission_settings() -> Result<(), LayoutError> {
    Err(LayoutError::Failed("no permission is needed here".into()))
}

fn hwnd(target: Target) -> HWND {
    HWND(target as *mut c_void)
}

/// The window in front and its title, unless it is Kento's own, the desktop or the taskbar.
pub fn front() -> Option<(Target, String)> {
    // SAFETY: no arguments; a null handle is checked below.
    let window = unsafe { GetForegroundWindow() };
    if window.is_invalid() || own(window) || shell(window) {
        return None;
    }
    Some((window.0 as isize, title(window)))
}

pub fn place(
    target: Target,
    layout: Layout,
    _screens: &Screens,
    activate: bool,
) -> Result<(), LayoutError> {
    let window = hwnd(target);
    // SAFETY: IsWindow takes any value and tells whether it is a window now.
    if !unsafe { IsWindow(Some(window)) }.as_bool() || own(window) || shell(window) {
        return Err(LayoutError::NoWindow);
    }
    // An app running as administrator: Windows keeps Kento's calls away from its windows (User
    // Interface Privilege Isolation), so they are not even tried. A hung window would hold this
    // thread until it answered.
    // SAFETY: plain checks on a window handle.
    if above_us(process_of(window)) || unsafe { IsHungAppWindow(window) }.as_bool() {
        return Err(LayoutError::Blocked);
    }
    place_window(window, layout)?;
    if activate {
        // Kento has the focus (the Window ring), so it may hand it to the window it placed.
        // SAFETY: a valid window handle.
        let _ = unsafe { SetForegroundWindow(window) };
    }
    Ok(())
}

/// Moves and sizes a window for a layout, whoever owns it.
fn place_window(window: HWND, layout: Layout) -> Result<(), LayoutError> {
    let _pixels = PhysicalPixels::new();
    // A maximized window keeps its maximized state when moved; a minimized one is not on screen.
    // SAFETY: plain calls on a valid window handle.
    unsafe {
        if IsZoomed(window).as_bool() || IsIconic(window).as_bool() {
            let _ = ShowWindow(window, SW_RESTORE);
        }
    }
    let work = work_area(window)?;
    let (outer, visible) = frames(window)?;
    let resizable = resizable(window);
    let goal = geometry::target(layout, work, visible, resizable);
    set(
        window,
        Margins::between(outer, visible).outer(goal),
        resizable,
    )?;
    // A window can refuse a size, below its minimum or off its own step (a console keeps whole
    // characters); what it took stays on the screen.
    let (outer, visible) = frames(window)?;
    let inside = geometry::keep_inside(visible, work);
    if inside != visible {
        set(
            window,
            Margins::between(outer, visible).outer(inside),
            false,
        )?;
    }
    Ok(())
}

fn set(window: HWND, outer: Rect, size: bool) -> Result<(), LayoutError> {
    let mut flags = SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE;
    if !size {
        flags |= SWP_NOSIZE;
    }
    // SAFETY: a valid window handle; the flags keep its place in the Z order and its activation.
    unsafe {
        SetWindowPos(
            window,
            None,
            outer.x,
            outer.y,
            outer.width,
            outer.height,
            flags,
        )
    }
    .map_err(|err| {
        if err.code() == E_ACCESSDENIED {
            LayoutError::Blocked
        } else {
            LayoutError::Failed(format!("SetWindowPos: {}", err.message()))
        }
    })
}

fn rect(r: RECT) -> Rect {
    Rect::from_edges(r.left, r.top, r.right, r.bottom)
}

/// The window's outer rectangle and the part of it DWM draws (without the invisible resize
/// borders). A window DWM does not frame has only the outer one.
fn frames(window: HWND) -> Result<(Rect, Rect), LayoutError> {
    let mut outer = RECT::default();
    // SAFETY: a valid window handle and a writable RECT.
    unsafe { GetWindowRect(window, &mut outer) }
        .map_err(|err| LayoutError::Failed(format!("GetWindowRect: {}", err.message())))?;
    let mut visible = RECT::default();
    // SAFETY: DWMWA_EXTENDED_FRAME_BOUNDS writes one RECT of the size given.
    let drawn = unsafe {
        DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut visible as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    };
    let visible = if drawn.is_ok() { visible } else { outer };
    Ok((rect(outer), rect(visible)))
}

/// The work area (without the taskbar) of the monitor the window is on, or nearest to.
fn work_area(window: HWND) -> Result<Rect, LayoutError> {
    // SAFETY: any window handle works; NEAREST always gives a monitor.
    let monitor = unsafe { MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: cbSize is set, as the function requires.
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return Err(LayoutError::Failed("the monitor could not be read".into()));
    }
    Ok(rect(info.rcWork))
}

/// A window without a sizing border (a dialog, a fixed-size tool) keeps its size.
fn resizable(window: HWND) -> bool {
    // SAFETY: reads the style of a valid window.
    let style = unsafe { GetWindowLongPtrW(window, GWL_STYLE) };
    (style as u32) & WS_THICKFRAME.0 != 0
}

fn process_of(window: HWND) -> u32 {
    let mut pid = 0u32;
    // SAFETY: a valid out pointer.
    unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
    pid
}

fn own(window: HWND) -> bool {
    // SAFETY: no arguments.
    process_of(window) == unsafe { GetCurrentProcessId() }
}

/// The desktop and the taskbars are windows too, but not ones to place.
fn shell(window: HWND) -> bool {
    let mut buffer = [0u16; 64];
    // SAFETY: the buffer is a valid, writable slice.
    let len = unsafe { GetClassNameW(window, &mut buffer) };
    let class = String::from_utf16_lossy(&buffer[..usize::try_from(len).unwrap_or(0)]);
    matches!(
        class.as_str(),
        "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
    )
}

fn title(window: HWND) -> String {
    let mut buffer = [0u16; 256];
    // SAFETY: the buffer is a valid, writable slice; the title is truncated to fit.
    let len = unsafe { GetWindowTextW(window, &mut buffer) };
    String::from_utf16_lossy(&buffer[..usize::try_from(len).unwrap_or(0)])
}

/// Whether a process runs at a higher integrity level than Kento, as an app run as administrator
/// does. One whose level cannot be read counts as higher: reading it is refused for exactly those.
fn above_us(pid: u32) -> bool {
    // SAFETY: the pseudo handle of this process needs no closing.
    let Some(ours) = integrity(unsafe { GetCurrentProcess() }) else {
        return false;
    };
    // SAFETY: the handle is closed by the guard.
    let theirs = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
        .ok()
        .map(Handle)
        .and_then(|process| integrity(process.0));
    theirs.is_none_or(|level| level > ours)
}

struct Handle(HANDLE);

impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: a handle this guard owns, closed once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

/// The mandatory integrity level of a process (its token's label RID).
fn integrity(process: HANDLE) -> Option<u32> {
    let mut token = HANDLE::default();
    // SAFETY: a process handle and a writable out handle.
    unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }.ok()?;
    let token = Handle(token);
    let mut size = 0u32;
    // SAFETY: asks for the size only.
    let _ = unsafe { GetTokenInformation(token.0, TokenIntegrityLevel, None, 0, &mut size) };
    if size == 0 {
        return None;
    }
    // Whole u64 cells keep the label's pointer aligned.
    let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
    // SAFETY: the buffer holds `size` bytes.
    unsafe {
        GetTokenInformation(
            token.0,
            TokenIntegrityLevel,
            Some(buffer.as_mut_ptr().cast()),
            size,
            &mut size,
        )
    }
    .ok()?;
    // SAFETY: the buffer now holds a TOKEN_MANDATORY_LABEL whose SID points into the buffer.
    unsafe {
        let label = &*(buffer.as_ptr() as *const TOKEN_MANDATORY_LABEL);
        let sid = label.Label.Sid;
        let count = *GetSidSubAuthorityCount(sid);
        if count == 0 {
            return None;
        }
        Some(*GetSidSubAuthority(sid, u32::from(count) - 1))
    }
}

/// Physical pixels on this thread while the guard lives, so window rectangles, DWM bounds and
/// work areas agree on every monitor whatever its scale.
struct PhysicalPixels(DPI_AWARENESS_CONTEXT);

impl PhysicalPixels {
    fn new() -> Self {
        // SAFETY: changes this thread's DPI context only; the guard puts the old one back.
        Self(unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) })
    }
}

impl Drop for PhysicalPixels {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            // SAFETY: restores the context this thread had before.
            unsafe { SetThreadDpiAwarenessContext(self.0) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, SW_MAXIMIZE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE,
        WINDOW_STYLE, WS_CAPTION, WS_EX_TOOLWINDOW, WS_OVERLAPPED, WS_OVERLAPPEDWINDOW, WS_SYSMENU,
    };

    /// A plain top-level window of the test's own, shown without taking the focus. The system's
    /// STATIC class needs no window procedure of ours; its frame comes from the style.
    struct TestWindow(HWND);

    impl TestWindow {
        fn new(style: WINDOW_STYLE) -> Self {
            // Created in Per-Monitor v2, so the system never scales it behind the test's back.
            let _pixels = PhysicalPixels::new();
            // SAFETY: a system class, no parent, no extra data.
            let window = unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE(WS_EX_TOOLWINDOW.0),
                    w!("STATIC"),
                    w!("Kento layout test"),
                    style,
                    120,
                    90,
                    640,
                    420,
                    None,
                    None,
                    None,
                    None,
                )
            }
            .expect("a test window");
            // SAFETY: the window just created.
            let _ = unsafe { ShowWindow(window, SW_SHOWNOACTIVATE) };
            Self(window)
        }

        fn visible(&self) -> Rect {
            let _pixels = PhysicalPixels::new();
            frames(self.0).expect("frames").1
        }

        fn work(&self) -> Rect {
            let _pixels = PhysicalPixels::new();
            work_area(self.0).expect("work area")
        }
    }

    impl Drop for TestWindow {
        fn drop(&mut self) {
            // SAFETY: the window this guard created, on the same thread.
            let _ = unsafe { DestroyWindow(self.0) };
        }
    }

    #[test]
    fn a_real_window_fills_each_half_by_its_visible_edges() {
        let window = TestWindow::new(WS_OVERLAPPEDWINDOW);
        let work = window.work();
        place_window(window.0, Layout::LeftHalf).expect("placed");
        let left = window.visible();
        assert_eq!(left, geometry::region(Layout::LeftHalf, work));
        place_window(window.0, Layout::RightHalf).expect("placed");
        let right = window.visible();
        assert_eq!(right, geometry::region(Layout::RightHalf, work));
        // What shows of the two halves meets without a gap, although the window rectangles,
        // with their invisible borders, overlap.
        assert_eq!(left.right(), right.x);
        place_window(window.0, Layout::FullScreen).expect("placed");
        assert_eq!(window.visible(), work);
    }

    #[test]
    fn a_maximized_window_is_restored_and_then_placed_in_a_quarter() {
        let window = TestWindow::new(WS_OVERLAPPEDWINDOW);
        // SAFETY: the test's own window.
        unsafe {
            let _ = ShowWindow(window.0, SW_MAXIMIZE);
            assert!(IsZoomed(window.0).as_bool());
        }
        let work = window.work();
        place_window(window.0, Layout::BottomRight).expect("placed");
        // SAFETY: the test's own window.
        assert!(!unsafe { IsZoomed(window.0) }.as_bool());
        assert_eq!(
            window.visible(),
            geometry::region(Layout::BottomRight, work)
        );
    }

    #[test]
    fn a_window_that_cannot_be_resized_is_only_centred() {
        let window = TestWindow::new(WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU);
        assert!(!resizable(window.0));
        let before = window.visible();
        let work = window.work();
        place_window(window.0, Layout::LeftHalf).expect("placed");
        let after = window.visible();
        assert_eq!((after.width, after.height), (before.width, before.height));
        assert_eq!(
            after,
            geometry::target(Layout::LeftHalf, work, before, false)
        );
    }

    #[test]
    fn kentos_own_windows_are_never_placed() {
        let window = TestWindow::new(WS_OVERLAPPEDWINDOW);
        let before = window.visible();
        assert_eq!(
            place(window.0 .0 as isize, Layout::LeftHalf, &Screens, false),
            Err(LayoutError::NoWindow)
        );
        assert_eq!(window.visible(), before);
        assert_eq!(
            place(0, Layout::LeftHalf, &Screens, false),
            Err(LayoutError::NoWindow)
        );
    }

    #[test]
    fn this_process_is_not_above_itself() {
        // SAFETY: the pseudo handle of this process.
        assert!(integrity(unsafe { GetCurrentProcess() }).is_some());
        // SAFETY: no arguments.
        assert!(!above_us(unsafe { GetCurrentProcessId() }));
        // A process that does not exist cannot be read, so it is left alone.
        assert!(above_us(u32::MAX - 3));
    }
}
