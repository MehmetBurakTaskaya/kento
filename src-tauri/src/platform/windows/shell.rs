// SPDX-License-Identifier: MIT
//! Explorer integration: the Send To shortcut and the classic context menu entries (SPEC 5.2).
//! Both live in the user's profile and HKCU only, so no administrator rights are needed.

use std::ffi::{OsStr, OsString};
use std::path::Path;

use windows::core::{w, Interface, HSTRING, PCWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, WIN32_ERROR};
use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
    KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
};
use windows::Win32::UI::Shell::{FOLDERID_SendTo, IShellLinkW, ShellLink};

use super::{failed, known_folder, wide_nul, Com};
use crate::platform::{PlatformError, Result};

/// Explorer appends the chosen files after these arguments.
const SEND_TO_ARGUMENT: PCWSTR = w!("--send-to");
const VERB: &str = "Kento";
/// Every file, and every folder.
const VERB_PARENTS: [&str; 2] = [r"*\shell", r"Directory\shell"];

pub fn set_send_to(enabled: bool, exe: &Path, name: &str) -> Result<()> {
    let _com = Com::apartment()?;
    let folder = known_folder(&FOLDERID_SendTo)?;
    write_send_to(&folder, enabled, exe, name)
}

pub fn set_context_menu(enabled: bool, exe: &Path, label: &str) -> Result<()> {
    write_context_menu(HKEY_CURRENT_USER, r"Software\Classes", enabled, exe, label)
}

fn check_exe(exe: &Path) -> Result<()> {
    if exe.is_absolute() {
        Ok(())
    } else {
        Err(PlatformError::Failed(
            "the program path must be absolute".into(),
        ))
    }
}

/// A shortcut name is a file name: nothing Windows forbids there, and no path tricks.
fn check_name(name: &str) -> Result<()> {
    let forbidden = |c: char| c.is_control() || r#"<>:"/\|?*"#.contains(c);
    if name.trim().is_empty() || name.ends_with(['.', ' ']) || name.contains(forbidden) {
        Err(PlatformError::Failed(
            "the shortcut name is not a valid file name".into(),
        ))
    } else {
        Ok(())
    }
}

/// Needs COM on the calling thread.
fn write_send_to(folder: &Path, enabled: bool, exe: &Path, name: &str) -> Result<()> {
    check_name(name)?;
    let link = folder.join(format!("{name}.lnk"));
    if !enabled {
        return match std::fs::remove_file(&link) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(PlatformError::Failed(format!(
                "the Send To shortcut could not be removed: {err}"
            ))),
        };
    }
    check_exe(exe)?;
    let fail = |err| failed("the Send To shortcut could not be written", err);
    let exe_path = HSTRING::from(exe);
    // SAFETY: COM calls on an object created here; every string outlives its call.
    unsafe {
        let shortcut: IShellLinkW =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(fail)?;
        shortcut.SetPath(&exe_path).map_err(fail)?;
        shortcut.SetArguments(SEND_TO_ARGUMENT).map_err(fail)?;
        shortcut.SetIconLocation(&exe_path, 0).map_err(fail)?;
        if let Some(dir) = exe.parent() {
            shortcut
                .SetWorkingDirectory(&HSTRING::from(dir))
                .map_err(fail)?;
        }
        // Saving over an existing shortcut replaces it, which keeps enabling idempotent and
        // picks up a moved program.
        let file: IPersistFile = shortcut.cast().map_err(fail)?;
        file.Save(&HSTRING::from(link.as_path()), true)
            .map_err(fail)?;
    }
    Ok(())
}

/// Writes or removes `<classes>\*\shell\Kento` and `<classes>\Directory\shell\Kento` under
/// `root`. The entries are rewritten from scratch each time, so repeating a call is harmless.
fn write_context_menu(
    root: HKEY,
    classes: &str,
    enabled: bool,
    exe: &Path,
    label: &str,
) -> Result<()> {
    if enabled {
        check_exe(exe)?;
    }
    let mut icon = exe.as_os_str().to_owned();
    icon.push(",0");
    let mut command = OsString::from("\"");
    command.push(exe);
    command.push("\" --wheel \"%1\"");
    for parent in VERB_PARENTS {
        let verb = format!(r"{classes}\{parent}\{VERB}");
        delete_tree(root, &verb)?;
        if !enabled {
            continue;
        }
        let key = Key::create(root, &verb)?;
        key.set(None, OsStr::new(label))?;
        key.set(Some("Icon"), &icon)?;
        // The verb accepts any number of selected items, so it stays on the menu for large
        // selections (up to 100 for a command verb, where the default model stops at 15).
        key.set(Some("MultiSelectModel"), OsStr::new("Player"))?;
        Key::create(root, &format!(r"{verb}\command"))?.set(None, &command)?;
    }
    Ok(())
}

fn registry(context: &str, code: WIN32_ERROR) -> Result<()> {
    code.ok().map_err(|err| failed(context, err))
}

fn delete_tree(root: HKEY, path: &str) -> Result<()> {
    let path = HSTRING::from(path);
    // SAFETY: a NUL-terminated key path under an open root key.
    let code = unsafe { RegDeleteTreeW(root, &path) };
    if code == ERROR_FILE_NOT_FOUND {
        return Ok(());
    }
    registry("the context menu entry could not be removed", code)
}

struct Key(HKEY);

impl Key {
    fn create(root: HKEY, path: &str) -> Result<Self> {
        let path = HSTRING::from(path);
        let mut key = HKEY::default();
        // SAFETY: a NUL-terminated path and a valid out pointer; the key is closed in Drop.
        let code = unsafe {
            RegCreateKeyExW(
                root,
                &path,
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut key,
                None,
            )
        };
        registry("the context menu entry could not be written", code)?;
        Ok(Self(key))
    }

    /// A REG_SZ value; `None` is the key's default value.
    fn set(&self, name: Option<&str>, value: &OsStr) -> Result<()> {
        let owned_name = name.map(HSTRING::from);
        let name = owned_name
            .as_ref()
            .map_or(PCWSTR::null(), |name| PCWSTR(name.as_ptr()));
        let data: Vec<u8> = wide_nul(value)
            .into_iter()
            .flat_map(u16::to_le_bytes)
            .collect();
        // SAFETY: the name is NUL-terminated or null; the data is a NUL-terminated UTF-16
        // string with its exact byte length.
        let code = unsafe { RegSetValueExW(self.0, name, None, REG_SZ, Some(&data)) };
        registry("the context menu entry could not be written", code)
    }
}

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: the key was opened by RegCreateKeyExW and is closed once.
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;
    use windows::Win32::System::Com::STGM_READ;
    use windows::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    use windows::Win32::UI::Shell::{ILFree, SHGetPathFromIDListW};

    fn read_value(path: &str, name: Option<&str>) -> Option<String> {
        let path = HSTRING::from(path);
        let owned_name = name.map(HSTRING::from);
        let name = owned_name
            .as_ref()
            .map_or(PCWSTR::null(), |name| PCWSTR(name.as_ptr()));
        let mut buffer = vec![0u16; 1024];
        let mut size = (buffer.len() * 2) as u32;
        // SAFETY: the buffer and its size in bytes are passed together.
        let code = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &path,
                name,
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        code.ok().ok()?;
        let len = (size as usize / 2).saturating_sub(1);
        Some(String::from_utf16(&buffer[..len]).unwrap())
    }

    /// A throwaway key under HKCU\Software, removed when dropped.
    struct TestRoot(String);

    impl TestRoot {
        fn new() -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            Self(format!(
                r"Software\KentoPlatformTest-{}-{nanos}",
                std::process::id()
            ))
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = delete_tree(HKEY_CURRENT_USER, &self.0);
        }
    }

    #[test]
    fn context_menu_entries_are_written_and_removed() {
        let root = TestRoot::new();
        let classes = format!(r"{}\Classes", root.0);
        let exe = Path::new(r"C:\Users\Burak\AppData\Local\Kento Çalışma\kento.exe");
        let label = "Kento ile aç 🎡";
        for _ in 0..2 {
            write_context_menu(HKEY_CURRENT_USER, &classes, true, exe, label).unwrap();
        }
        for parent in VERB_PARENTS {
            let verb = format!(r"{classes}\{parent}\Kento");
            assert_eq!(read_value(&verb, None).as_deref(), Some(label));
            assert_eq!(
                read_value(&verb, Some("Icon")).as_deref(),
                Some(r"C:\Users\Burak\AppData\Local\Kento Çalışma\kento.exe,0")
            );
            assert_eq!(
                read_value(&verb, Some("MultiSelectModel")).as_deref(),
                Some("Player")
            );
            assert_eq!(
                read_value(&format!(r"{verb}\command"), None).as_deref(),
                Some(r#""C:\Users\Burak\AppData\Local\Kento Çalışma\kento.exe" --wheel "%1""#)
            );
        }
        for _ in 0..2 {
            write_context_menu(HKEY_CURRENT_USER, &classes, false, exe, label).unwrap();
        }
        for parent in VERB_PARENTS {
            let verb = format!(r"{classes}\{parent}\Kento");
            assert_eq!(read_value(&verb, None), None);
            assert_eq!(read_value(&format!(r"{verb}\command"), None), None);
        }
    }

    #[test]
    fn a_relative_program_is_refused() {
        let root = TestRoot::new();
        let classes = format!(r"{}\Classes", root.0);
        let relative = Path::new("kento.exe");
        assert!(write_context_menu(HKEY_CURRENT_USER, &classes, true, relative, "x").is_err());
        assert!(write_context_menu(HKEY_CURRENT_USER, &classes, false, relative, "x").is_ok());
    }

    fn read_shortcut(link: &Path) -> (PathBuf, String) {
        // SAFETY: COM calls on an object created here; the buffers are valid slices.
        unsafe {
            let shortcut: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
            let file: IPersistFile = shortcut.cast().unwrap();
            file.Load(&HSTRING::from(link), STGM_READ).unwrap();
            let target_id = shortcut.GetIDList().unwrap();
            let mut target = [0u16; 260];
            assert!(SHGetPathFromIDListW(target_id, &mut target).as_bool());
            ILFree(Some(target_id));
            let mut args = vec![0u16; 1024];
            shortcut.GetArguments(&mut args).unwrap();
            let until_nul = |buffer: &[u16]| {
                let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
                buffer[..end].to_vec()
            };
            (
                PathBuf::from(OsString::from_wide(&until_nul(&target))),
                String::from_utf16(&until_nul(&args)).unwrap(),
            )
        }
    }

    #[test]
    fn the_send_to_shortcut_is_written_and_removed() {
        let _com = Com::apartment().unwrap();
        let folder = tempfile::tempdir().unwrap();
        // The target need not exist for the shortcut, but a real file keeps GetPath exact.
        let program_dir = tempfile::tempdir().unwrap();
        let exe = program_dir.path().join("Kento Çalış 🎡.exe");
        std::fs::write(&exe, b"").unwrap();
        let link = folder.path().join("Kento.lnk");
        for _ in 0..2 {
            write_send_to(folder.path(), true, &exe, "Kento").unwrap();
        }
        assert!(link.is_file());
        let (target, args) = read_shortcut(&link);
        assert_eq!(
            std::fs::canonicalize(target).unwrap(),
            std::fs::canonicalize(&exe).unwrap()
        );
        assert_eq!(args, "--send-to");
        for _ in 0..2 {
            write_send_to(folder.path(), false, &exe, "Kento").unwrap();
        }
        assert!(!link.exists());
    }

    #[test]
    fn shortcut_names_must_be_file_names() {
        let folder = tempfile::tempdir().unwrap();
        let exe = Path::new(r"C:\Kento\kento.exe");
        for name in ["", " ", r"..\Kento", "a/b", "Kento.", "a:b", "x\u{1}"] {
            assert!(
                write_send_to(folder.path(), false, exe, name).is_err(),
                "{name:?}"
            );
        }
        assert!(check_name("Kento").is_ok());
        assert!(check_name("Kento ile aç 🎡").is_ok());
    }

    #[test]
    fn the_send_to_folder_is_known() {
        let _com = Com::apartment().unwrap();
        assert!(known_folder(&FOLDERID_SendTo).unwrap().is_absolute());
    }
}
