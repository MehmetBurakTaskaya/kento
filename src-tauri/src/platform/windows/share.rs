// SPDX-License-Identifier: MIT
//! The Windows share UI for files (SPEC 5.7), through `IDataTransferManagerInterop`.
//!
//! The caller must run `share` on the thread that owns the window (Tauri's main thread: use
//! `run_on_main_thread`), and that thread must keep pumping messages: the share UI raises
//! `DataRequested` through it after `ShowShareUIForWindow` returns. The handler only sets the
//! title and takes a deferral; the files become `StorageFile`s on a short-lived worker thread
//! so the window's thread never waits on the file system.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use windows::core::{Interface, HSTRING};
use windows::ApplicationModel::DataTransfer::{
    DataRequest, DataRequestDeferral, DataRequestedEventArgs, DataTransferManager,
};
use windows::Foundation::TypedEventHandler;
use windows::Storage::{IStorageItem, StorageFile, StorageFolder};
use windows::Win32::Foundation::{HWND, S_FALSE};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Shell::IDataTransferManagerInterop;
use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindow};
use windows_collections::IIterable;

use super::{failed, Com};
use crate::platform::{PlatformError, Result};

/// The `DataRequested` registration of each window, replaced on every share so an earlier
/// request never answers a later one.
static REGISTRATIONS: Mutex<Vec<(isize, i64)>> = Mutex::new(Vec::new());

pub fn share(paths: &[PathBuf], window: isize) -> Result<()> {
    if paths.is_empty() {
        return Err(PlatformError::Failed("nothing to share".into()));
    }
    if let Some(missing) = paths.iter().find(|path| std::fs::metadata(path).is_err()) {
        tracing::warn!("a file to share is missing");
        return Err(PlatformError::Failed(format!(
            "{} does not exist",
            missing.file_name().unwrap_or_default().to_string_lossy()
        )));
    }
    let hwnd = HWND(window as *mut _);
    // SAFETY: plain queries on a window handle, which may be stale; IsWindow checks that.
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return Err(PlatformError::Failed("the window is gone".into()));
        }
        if GetWindowThreadProcessId(hwnd, None) != GetCurrentThreadId() {
            return Err(PlatformError::Failed(
                "share must run on the thread that owns the window".into(),
            ));
        }
        // The registration below must outlive this call, so COM stays on for the window's
        // thread. Tauri's main thread has it already (S_FALSE), and that call is balanced.
        if CoInitializeEx(None, COINIT_APARTMENTTHREADED) == S_FALSE {
            CoUninitialize();
        }
    }

    let interop = register(paths, hwnd).map_err(open_failed)?;
    // SAFETY: the window belongs to this thread (checked above).
    unsafe { interop.ShowShareUIForWindow(hwnd) }.map_err(open_failed)
}

fn open_failed(err: windows::core::Error) -> PlatformError {
    failed("the share window could not open", err)
}

/// Answers the window's next `DataRequested` with these files. The window must belong to the
/// calling thread.
fn register(paths: &[PathBuf], hwnd: HWND) -> windows::core::Result<IDataTransferManagerInterop> {
    let interop: IDataTransferManagerInterop =
        windows::core::factory::<DataTransferManager, IDataTransferManagerInterop>()?;
    // SAFETY: the caller guarantees the window belongs to this thread.
    let manager: DataTransferManager = unsafe { interop.GetForWindow(hwnd) }?;

    let title = HSTRING::from(share_title(paths));
    let paths: Arc<[PathBuf]> = paths.into();
    let handler =
        TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(move |_, args| {
            let request = args.ok()?.Request()?;
            request.Data()?.Properties()?.SetTitle(&title)?;
            let deferral = request.GetDeferral()?;
            let paths = Arc::clone(&paths);
            let worker = std::thread::Builder::new()
                .name("kento-share".into())
                .spawn(move || {
                    // COM must stop after the request is released, hence the inner function.
                    let _com = Com::multithreaded();
                    fill(request, deferral, &paths);
                });
            if let Err(err) = worker {
                tracing::error!("the share data could not be prepared: {err}");
            }
            Ok(())
        });
    let window = hwnd.0 as isize;
    let mut registrations = REGISTRATIONS.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(index) = registrations.iter().position(|(owner, _)| *owner == window) {
        let (_, token) = registrations.swap_remove(index);
        let _ = manager.RemoveDataRequested(token);
    }
    let token = manager.DataRequested(&handler)?;
    registrations.push((window, token));
    Ok(interop)
}

/// The share UI needs a title; the file names are data, not interface text to translate.
fn share_title(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|path| {
            path.file_name()
                .unwrap_or(path.as_os_str())
                .to_string_lossy()
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn fill(request: DataRequest, deferral: DataRequestDeferral, paths: &[PathBuf]) {
    let result = match storage_items(paths) {
        Ok(items) => request
            .Data()
            .and_then(|data| data.SetStorageItemsReadOnly(&items)),
        // The system's own (localized) message, shown in the share window.
        Err(err) => request.FailWithDisplayText(&HSTRING::from(err.message())),
    };
    if let Err(err) = result {
        tracing::warn!("the share data could not be set: {}", err.message());
    }
    let _ = deferral.Complete();
}

/// The files that could be opened; an error only when none could.
fn storage_items(paths: &[PathBuf]) -> windows::core::Result<IIterable<IStorageItem>> {
    let mut items = Vec::with_capacity(paths.len());
    let mut last_error = None;
    for path in paths {
        match storage_item(path) {
            Ok(item) => items.push(Some(item)),
            Err(err) => last_error = Some(err),
        }
    }
    match last_error {
        Some(err) if items.is_empty() => Err(err),
        _ => Ok(IIterable::from(items)),
    }
}

fn storage_item(path: &Path) -> windows::core::Result<IStorageItem> {
    let path = HSTRING::from(path);
    if std::fs::metadata(path.to_os_string()).is_ok_and(|meta| meta.is_dir()) {
        StorageFolder::GetFolderFromPathAsync(&path)?.join()?.cast()
    } else {
        StorageFile::GetFileFromPathAsync(&path)?.join()?.cast()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_title_lists_the_file_names() {
        let paths = [
            PathBuf::from(r"C:\a\Fotoğraf 1.jpg"),
            PathBuf::from(r"D:\b\rapor 🎉.pdf"),
        ];
        assert_eq!(share_title(&paths), "Fotoğraf 1.jpg, rapor 🎉.pdf");
        assert_eq!(share_title(&[PathBuf::from(r"C:\")]), r"C:\");
    }

    #[test]
    fn bad_requests_are_refused_before_any_ui() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let paths = [file.path().to_path_buf()];
        assert!(share(&[], 0).is_err());
        assert!(share(&[PathBuf::from(r"C:\no\such\file.txt")], 0).is_err());
        // Not a window.
        assert!(share(&paths, 0).is_err());
    }

    #[test]
    fn files_and_folders_reach_a_data_package() {
        use windows::ApplicationModel::DataTransfer::DataPackage;
        use windows::Storage::StorageItemTypes;

        let _com = Com::multithreaded().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("Çalışma 🎉.txt");
        std::fs::write(&file, b"kento").unwrap();
        let missing = folder.path().join("gone.txt");
        let items =
            storage_items(&[file.clone(), folder.path().to_path_buf(), missing.clone()]).unwrap();

        let package = DataPackage::new().unwrap();
        package.SetStorageItemsReadOnly(&items).unwrap();
        let shared = package
            .GetView()
            .unwrap()
            .GetStorageItemsAsync()
            .unwrap()
            .join()
            .unwrap();
        assert_eq!(shared.Size().unwrap(), 2, "the missing file is left out");
        let first = shared.GetAt(0).unwrap();
        assert!(first.IsOfType(StorageItemTypes::File).unwrap());
        assert_eq!(first.Name().unwrap(), "Çalışma 🎉.txt");
        assert!(shared
            .GetAt(1)
            .unwrap()
            .IsOfType(StorageItemTypes::Folder)
            .unwrap());

        assert!(storage_items(&[missing]).is_err());
    }

    #[test]
    fn a_window_of_this_thread_can_take_share_requests() {
        use windows::core::{w, PCWSTR};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, FindWindowW, WINDOW_EX_STYLE, WS_OVERLAPPEDWINDOW,
        };

        // The share broker belongs to the interactive shell; a session without one (some CI
        // machines) has nothing to register with.
        // SAFETY: a plain window lookup.
        if unsafe { FindWindowW(w!("Progman"), PCWSTR::null()) }.is_err() {
            return;
        }
        // A hidden window: registering shows nothing; only ShowShareUIForWindow would.
        std::thread::spawn(|| {
            let _com = Com::apartment().unwrap();
            let file = tempfile::NamedTempFile::new().unwrap();
            let paths = [file.path().to_path_buf()];
            // SAFETY: a plain hidden window owned and destroyed by this thread.
            unsafe {
                let window = CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("STATIC"),
                    w!(""),
                    WS_OVERLAPPEDWINDOW,
                    0,
                    0,
                    100,
                    100,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap();
                // Twice: the second registration replaces the first.
                register(&paths, window).unwrap();
                register(&paths, window).unwrap();
                let key = window.0 as isize;
                let count = REGISTRATIONS
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|(owner, _)| *owner == key)
                    .count();
                assert_eq!(count, 1);
                let _ = DestroyWindow(window);
            }
        })
        .join()
        .unwrap();
    }
}
