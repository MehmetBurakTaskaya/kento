// SPDX-License-Identifier: MIT
//! Windows: polling for drags, COM for the Explorer selection, the share UI and shell links,
//! HKCU for the context menu.
//!
//! Threads: `watch_drags` runs its own thread. `file_manager_selection`, `set_send_to` and
//! `set_context_menu` may run on any thread; they make COM apartment-threaded on the calling
//! thread for the length of the call (an MTA thread works too) and may block for some tens of
//! milliseconds, so a worker thread suits them better than the UI thread. `share` must run on the
//! thread that owns the window (see `share.rs`).

use std::ffi::{OsStr, OsString};
use std::marker::PhantomData;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::PathBuf;

use windows::core::{GUID, HRESULT, PWSTR};
use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT, COINIT_APARTMENTTHREADED,
    COINIT_DISABLE_OLE1DDE, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};

use super::{PlatformError, Result};

mod drag;
mod explorer;
mod share;
mod shell;
mod terminal;

pub use drag::{watch_drags, Watcher};
pub use explorer::file_manager_selection;
pub use share::share;
pub use shell::{set_context_menu, set_send_to};
pub use terminal::open_terminal;

pub fn haptic_tick() {}

fn failed(context: &str, err: windows::core::Error) -> PlatformError {
    PlatformError::Failed(format!("{context}: {}", err.message()))
}

/// COM on the current thread for as long as the guard lives. Not `Send`: COM is per thread.
struct Com {
    initialized: bool,
    _thread: PhantomData<*const ()>,
}

impl Com {
    fn apartment() -> Result<Self> {
        Self::init(COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)
    }

    fn multithreaded() -> Result<Self> {
        Self::init(COINIT_MULTITHREADED)
    }

    fn init(model: COINIT) -> Result<Self> {
        // SAFETY: balanced by CoUninitialize in Drop on this same thread (the guard is not Send).
        let hr: HRESULT = unsafe { CoInitializeEx(None, model) };
        if hr.is_ok() {
            Ok(Self {
                initialized: true,
                _thread: PhantomData,
            })
        } else if hr == RPC_E_CHANGED_MODE {
            // The thread already has the other model; COM works there all the same.
            Ok(Self {
                initialized: false,
                _thread: PhantomData,
            })
        } else {
            Err(failed("COM could not start", hr.into()))
        }
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.initialized {
            // SAFETY: matches the successful CoInitializeEx of this guard, on the same thread.
            unsafe { CoUninitialize() };
        }
    }
}

fn wide(text: &OsStr) -> Vec<u16> {
    text.encode_wide().collect()
}

fn wide_nul(text: &OsStr) -> Vec<u16> {
    text.encode_wide().chain(std::iter::once(0)).collect()
}

/// Takes ownership of a string the shell allocated with CoTaskMemAlloc.
///
/// # Safety
/// `text` must be a valid, NUL-terminated string from CoTaskMemAlloc, or null.
unsafe fn take_co_string(text: PWSTR) -> OsString {
    if text.is_null() {
        return OsString::new();
    }
    // SAFETY: the caller guarantees a valid NUL-terminated string, freed once here.
    unsafe {
        let value = OsString::from_wide(text.as_wide());
        CoTaskMemFree(Some(text.0 as *const _));
        value
    }
}

fn known_folder(id: &GUID) -> Result<PathBuf> {
    // SAFETY: the returned string is taken and freed by take_co_string.
    unsafe {
        let path = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None)
            .map_err(|err| failed("a system folder could not be found", err))?;
        Ok(PathBuf::from(take_co_string(path)))
    }
}
