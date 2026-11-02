// SPDX-License-Identifier: MIT
//! Kento's OLE drop target for the main window and the floating wheel (SPEC 5.2, 5.10).
//!
//! The webview's own target hands over file lists only, and a link dragged out of a browser holds
//! no file, so such a drag never reached the page. Kento puts its own target on the webview's
//! windows instead. It reads the file list (`CF_HDROP`) and the web address a browser puts on a
//! dragged link or picture: "UniformResourceLocatorW", Firefox's "text/x-moz-url", or plain text
//! that is one address. It reads nothing else, and only while a drag is over the window.
//!
//! Like every OLE drop target it runs on the window's own thread, which has OLE set up; the drag
//! source calls it from its drag loop, so it answers at once and leaves the work to the page.

use std::cell::RefCell;
use std::ffi::{c_void, OsString};
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::sync::Arc;

use windows::core::{implement, w, Ref, BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, POINTL};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop, CF_HDROP,
    CF_UNICODETEXT, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_NONE,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

use super::super::{url_line, DragContent, DropEvent, PlatformError, Point, Result};

type Handler = Arc<dyn Fn(DropEvent) + Send + Sync>;

/// Text is read up to this size; a web address is far shorter.
const TEXT_LIMIT: usize = 64 * 1024;

/// Puts Kento's drop target on every window inside `window` (the webview's windows) and returns
/// how many took it.
pub fn accept_drops(window: isize, on_event: Handler) -> Result<usize> {
    let parent = HWND(window as *mut c_void);
    let mut children: Vec<HWND> = Vec::new();
    unsafe extern "system" fn collect(hwnd: HWND, list: LPARAM) -> BOOL {
        // SAFETY: `list` is the vector below, alive for the whole enumeration.
        unsafe { (*(list.0 as *mut Vec<HWND>)).push(hwnd) };
        BOOL(1)
    }
    // SAFETY: the callback only pushes to the vector passed through LPARAM.
    let _ = unsafe {
        EnumChildWindows(
            Some(parent),
            Some(collect),
            LPARAM(&mut children as *mut Vec<HWND> as isize),
        )
    };
    let mut served = 0;
    for hwnd in children {
        let target: IDropTarget = Target {
            hwnd,
            on_event: on_event.clone(),
            entered: RefCell::new(None),
        }
        .into();
        // SAFETY: OLE calls on a window of this thread; OLE keeps its own reference to the
        // target and releases the one it held before.
        unsafe {
            // A window with no target yet is fine; the webview's target goes here.
            let _ = RevokeDragDrop(hwnd);
            if RegisterDragDrop(hwnd, &target).is_ok() {
                served += 1;
            }
        }
    }
    if served == 0 {
        return Err(PlatformError::Failed(
            "no window of the webview took the drop target".into(),
        ));
    }
    Ok(served)
}

#[implement(IDropTarget)]
struct Target {
    /// The window this target serves; positions are given from its top-left corner.
    hwnd: HWND,
    on_event: Handler,
    /// What the drag over the window carries, when Kento takes it.
    entered: RefCell<Option<DragContent>>,
}

impl Target {
    fn position(&self, pt: &POINTL) -> Point {
        let mut point = POINT { x: pt.x, y: pt.y };
        // SAFETY: a valid in/out pointer. Physical pixels, as the webview's own target reports.
        let _ = unsafe { ScreenToClient(self.hwnd, &mut point) };
        Point {
            x: f64::from(point.x),
            y: f64::from(point.y),
        }
    }
}

/// Reads the effects the source allows and answers with the one Kento takes.
///
/// # Safety
/// `effect` is null or the pointer OLE passes to a drop target.
unsafe fn answer(effect: *mut DROPEFFECT, content: Option<&DragContent>) {
    // SAFETY: the caller's promise.
    if let Some(effect) = unsafe { effect.as_mut() } {
        *effect = content.map_or(DROPEFFECT_NONE, |content| effect_for(content, *effect));
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for Target_Impl {
    fn DragEnter(
        &self,
        data: Ref<IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let content = data.as_ref().map_or(DragContent::Other, read);
        let taken = content.accepted().then(|| content.clone());
        // SAFETY: OLE's pointer.
        unsafe { answer(effect, taken.as_ref()) };
        *self.entered.borrow_mut() = taken;
        // Refused content is reported too: the wheel closes when it holds nothing to offer.
        (self.on_event)(DropEvent::Enter {
            content,
            at: self.position(pt),
        });
        Ok(())
    }

    fn DragOver(
        &self,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let taken = self.entered.borrow().clone();
        // SAFETY: OLE's pointer.
        unsafe { answer(effect, taken.as_ref()) };
        if taken.is_some() {
            (self.on_event)(DropEvent::Over {
                at: self.position(pt),
            });
        }
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        let taken = self.entered.borrow_mut().take();
        if taken.is_some() {
            (self.on_event)(DropEvent::Leave);
        }
        Ok(())
    }

    fn Drop(
        &self,
        data: Ref<IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let Some(entered) = self.entered.borrow_mut().take() else {
            // SAFETY: OLE's pointer.
            unsafe { answer(effect, None) };
            return Ok(());
        };
        // The data is complete now; what entered stands in when it cannot be read again.
        let content = data
            .as_ref()
            .map(read)
            .filter(DragContent::accepted)
            .unwrap_or(entered);
        // SAFETY: OLE's pointer.
        unsafe { answer(effect, Some(&content)) };
        (self.on_event)(DropEvent::Drop {
            content,
            at: self.position(pt),
        });
        Ok(())
    }
}

/// Kento copies a file or reads a link; it never answers Move, which would let the source delete
/// the original once the drop is done.
fn effect_for(content: &DragContent, allowed: DROPEFFECT) -> DROPEFFECT {
    if !content.accepted() {
        return DROPEFFECT_NONE;
    }
    [DROPEFFECT_COPY, DROPEFFECT_LINK]
        .into_iter()
        .find(|wanted| allowed.0 & wanted.0 != 0)
        .unwrap_or(DROPEFFECT_NONE)
}

/// The files and the web address a drag carries.
fn read(data: &IDataObject) -> DragContent {
    let mut texts = Vec::new();
    for name in [w!("UniformResourceLocatorW"), w!("text/x-moz-url")] {
        if let Some(text) = registered(name).and_then(|format| text(data, format)) {
            texts.extend(url_line(&text).map(str::to_string));
        }
    }
    texts.extend(text(data, CF_UNICODETEXT.0));
    DragContent::classify(files(data), texts)
}

/// The number of a format registered by name; browsers register the URL formats the same way.
fn registered(name: PCWSTR) -> Option<u16> {
    // SAFETY: a NUL-terminated constant.
    let format = unsafe { RegisterClipboardFormatW(name) };
    u16::try_from(format).ok().filter(|&format| format != 0)
}

fn spec(format: u16) -> FORMATETC {
    FORMATETC {
        cfFormat: format,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    }
}

/// UTF-16 text in global memory, up to its first NUL.
fn text(data: &IDataObject, format: u16) -> Option<String> {
    // SAFETY: the medium comes from GetData and is released once, after its memory is copied.
    unsafe {
        let mut medium = data.GetData(&spec(format)).ok()?;
        let mut units = Vec::new();
        if medium.tymed == TYMED_HGLOBAL.0 as u32 {
            let global = medium.u.hGlobal;
            let start = GlobalLock(global) as *const u16;
            if !start.is_null() {
                let len = (GlobalSize(global) / 2).min(TEXT_LIMIT);
                units.extend_from_slice(std::slice::from_raw_parts(start, len));
                let _ = GlobalUnlock(global);
            }
        }
        ReleaseStgMedium(&mut medium);
        Some(utf16_text(&units))
    }
}

fn utf16_text(units: &[u16]) -> String {
    let end = units
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(units.len());
    String::from_utf16_lossy(&units[..end])
}

/// The paths of a file drag.
fn files(data: &IDataObject) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    // SAFETY: the medium comes from GetData and is released once, after the names are copied.
    unsafe {
        let Ok(mut medium) = data.GetData(&spec(CF_HDROP.0)) else {
            return paths;
        };
        if medium.tymed == TYMED_HGLOBAL.0 as u32 {
            let drop = HDROP(medium.u.hGlobal.0);
            let count = DragQueryFileW(drop, u32::MAX, None);
            for index in 0..count {
                let len = DragQueryFileW(drop, index, None) as usize;
                let mut name = vec![0u16; len + 1];
                let written = DragQueryFileW(drop, index, Some(&mut name)) as usize;
                if written > 0 {
                    paths.push(PathBuf::from(OsString::from_wide(
                        &name[..written.min(len)],
                    )));
                }
            }
        }
        ReleaseStgMedium(&mut medium);
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::STGMEDIUM;
    use windows::Win32::System::Memory::{GlobalAlloc, GMEM_MOVEABLE};
    use windows::Win32::UI::Shell::{SHCreateDataObject, DROPFILES};

    use super::super::Com;

    /// A data object as a drag source would offer it, holding the given formats.
    fn offered(formats: &[(u16, Vec<u8>)]) -> IDataObject {
        // SAFETY: an empty shell data object; each block of memory is handed over with SetData.
        unsafe {
            let data: IDataObject = SHCreateDataObject(None, None, None).expect("data object");
            for (format, bytes) in formats {
                let global = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).expect("memory");
                let start = GlobalLock(global) as *mut u8;
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), start, bytes.len());
                let _ = GlobalUnlock(global);
                let medium = STGMEDIUM {
                    tymed: TYMED_HGLOBAL.0 as u32,
                    u: windows::Win32::System::Com::STGMEDIUM_0 {
                        hGlobal: HGLOBAL(global.0),
                    },
                    pUnkForRelease: std::mem::ManuallyDrop::new(None),
                };
                data.SetData(&spec(*format), &medium, true)
                    .expect("set data");
            }
            data
        }
    }

    fn wide(text: &str) -> Vec<u8> {
        text.encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(u16::to_le_bytes)
            .collect()
    }

    /// The CF_HDROP block Explorer writes: a DROPFILES header, then wide names, each ended by a
    /// NUL, and one more NUL at the end.
    fn drop_files(paths: &[&str]) -> Vec<u8> {
        let header = DROPFILES {
            pFiles: std::mem::size_of::<DROPFILES>() as u32,
            fWide: BOOL(1),
            ..Default::default()
        };
        // SAFETY: DROPFILES is plain old data.
        let mut bytes = unsafe {
            std::slice::from_raw_parts(
                &header as *const DROPFILES as *const u8,
                std::mem::size_of::<DROPFILES>(),
            )
        }
        .to_vec();
        for path in paths {
            bytes.extend(wide(path));
        }
        bytes.extend([0, 0]);
        bytes
    }

    #[test]
    fn a_browser_link_is_read_from_its_url_format() {
        let _com = Com::apartment().unwrap();
        let url = registered(w!("UniformResourceLocatorW")).unwrap();
        let data = offered(&[
            (url, wide("https://www.youtube.com/watch?v=abc")),
            (
                CF_UNICODETEXT.0,
                wide("https://www.youtube.com/watch?v=abc"),
            ),
        ]);
        assert_eq!(
            read(&data),
            DragContent::Link("https://www.youtube.com/watch?v=abc".into())
        );
    }

    #[test]
    fn firefox_puts_the_title_after_the_address() {
        let _com = Com::apartment().unwrap();
        let moz = registered(w!("text/x-moz-url")).unwrap();
        let data = offered(&[(moz, wide("https://www.instagram.com/p/xyz/\nA post"))]);
        assert_eq!(
            read(&data),
            DragContent::Link("https://www.instagram.com/p/xyz/".into())
        );
    }

    #[test]
    fn explorer_files_are_read_with_their_names_intact() {
        let _com = Com::apartment().unwrap();
        let names = [
            r"C:\Users\me\Kapadokya 🎈.heic",
            r"D:\Belgeler\Rapor ğüşıöç.pdf",
        ];
        let data = offered(&[(CF_HDROP.0, drop_files(&names))]);
        assert_eq!(
            read(&data),
            DragContent::Files(names.iter().map(PathBuf::from).collect())
        );
    }

    #[test]
    fn text_that_is_not_a_link_is_refused() {
        let _com = Com::apartment().unwrap();
        let data = offered(&[(CF_UNICODETEXT.0, wide("a sentence from a page"))]);
        assert_eq!(read(&data), DragContent::Other);
    }

    #[test]
    fn kento_copies_or_links_and_never_moves() {
        let files = DragContent::Files(vec![PathBuf::from(r"C:\a.txt")]);
        let link = DragContent::Link("https://a.org/".into());
        let all = DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_LINK.0 | 2);
        assert_eq!(effect_for(&files, all), DROPEFFECT_COPY);
        assert_eq!(effect_for(&link, DROPEFFECT_LINK), DROPEFFECT_LINK);
        // Move only: refused rather than letting the source delete its file.
        assert_eq!(effect_for(&files, DROPEFFECT(2)), DROPEFFECT_NONE);
        assert_eq!(effect_for(&DragContent::Other, all), DROPEFFECT_NONE);
    }

    #[test]
    fn text_ends_at_its_first_nul() {
        let units: Vec<u16> = "https://a.org/\0garbage".encode_utf16().collect();
        assert_eq!(utf16_text(&units), "https://a.org/");
        assert_eq!(utf16_text(&[]), "");
    }
}
