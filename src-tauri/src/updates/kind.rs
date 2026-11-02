// SPDX-License-Identifier: MIT
//! What kind of copy is running decides how it updates (decision 46). It is read once, from where
//! the program sits: Tauri's installer leaves `uninstall.exe` beside the program, a release build
//! without one was unpacked from the portable ZIP, and a Mac app is a bundle that macOS may run
//! from a translocation folder or keep in a folder Kento may not write.

use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// Installed by Kento's Windows installer: the update is that installer, run quietly.
    Installed,
    /// Unpacked from the portable ZIP: it swaps its own files for the new version's.
    Portable,
    /// A Mac app bundle Kento may replace: it replaces itself with the update archive.
    Bundle,
    /// A Mac app bundle in a folder Kento may not change: replacing it would ask for an
    /// administrator's password, so it waits until the user asks for the update.
    LockedBundle,
    /// A Mac app that macOS runs from a read-only translocation folder, because it was opened
    /// where it was downloaded: it cannot replace itself until it is moved to Applications.
    Translocated,
    /// A development build, or a program outside any app bundle: it never installs anything.
    Development,
}

/// The release entry the portable copy asks for in latest.json: its ZIP, signed with the update
/// key for that version.
pub const PORTABLE_TARGET: &str = "windows-x86_64-portable";

impl Kind {
    /// The copy running now.
    pub fn detect() -> Self {
        if cfg!(debug_assertions) {
            return Kind::Development;
        }
        let Ok(exe) = std::env::current_exe() else {
            return Kind::Development;
        };
        if built_by_cargo(&exe) {
            return Kind::Development;
        }
        #[cfg(windows)]
        {
            on_windows(&exe)
        }
        #[cfg(target_os = "macos")]
        {
            on_mac(&exe, mac::writable)
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = exe;
            Kind::Development
        }
    }

    /// Whether this copy downloads updates to install them.
    pub fn installs(self) -> bool {
        matches!(
            self,
            Kind::Installed | Kind::Portable | Kind::Bundle | Kind::LockedBundle
        )
    }

    /// Whether a downloaded update installs without the user asking for it.
    pub fn automatic(self) -> bool {
        matches!(self, Kind::Installed | Kind::Portable | Kind::Bundle)
    }

    /// The release entry this copy asks for, when it is not the platform's own.
    pub fn target(self) -> Option<&'static str> {
        (self == Kind::Portable).then_some(PORTABLE_TARGET)
    }
}

/// A release build run where Cargo made it, which leaves its lock file in the profile folder
/// (`target/release`, or a few folders above a Mac bundle made there): a development build, so a
/// published version never replaces the build folder's files.
fn built_by_cargo(exe: &Path) -> bool {
    exe.ancestors()
        .skip(1)
        .take(6)
        .any(|dir| dir.join(".cargo-lock").is_file())
}

/// A Windows release build: installed when Tauri's uninstaller sits beside the program.
#[cfg_attr(not(windows), allow(dead_code))]
fn on_windows(exe: &Path) -> Kind {
    if exe
        .parent()
        .is_some_and(|dir| dir.join("uninstall.exe").is_file())
    {
        Kind::Installed
    } else {
        Kind::Portable
    }
}

/// A macOS release build, from the path of its program (`…/Kento.app/Contents/MacOS/kento`).
/// `writable` says whether Kento may change a folder; the updater renames the bundle inside the
/// folder that holds it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn on_mac(exe: &Path, writable: impl Fn(&Path) -> bool) -> Kind {
    if exe
        .components()
        .any(|part| part.as_os_str() == "AppTranslocation")
    {
        return Kind::Translocated;
    }
    let Some(bundle) = bundle_of(exe) else {
        return Kind::Development;
    };
    if writable(bundle) && bundle.parent().is_some_and(&writable) {
        Kind::Bundle
    } else {
        Kind::LockedBundle
    }
}

/// The `.app` folder the program runs from, if it runs from one.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn bundle_of(exe: &Path) -> Option<&Path> {
    let macos = exe.parent().filter(|dir| dir.ends_with("MacOS"))?;
    let contents = macos.parent().filter(|dir| dir.ends_with("Contents"))?;
    contents.parent().filter(|bundle| {
        bundle
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
    })
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    /// Whether this user may change the folder; the check reads only the permissions.
    pub fn writable(path: &Path) -> bool {
        CString::new(path.as_os_str().as_bytes()).is_ok_and(|path| {
            // SAFETY: a NUL-terminated path that lives through the call, which only reads it.
            unsafe { libc::access(path.as_ptr(), libc::W_OK) == 0 }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn an_installed_windows_copy_has_the_uninstaller_beside_it() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("Kento ğüş");
        fs::create_dir(&folder).unwrap();
        let exe = folder.join("Kento.exe");
        fs::write(&exe, "program").unwrap();
        assert_eq!(on_windows(&exe), Kind::Portable);
        fs::write(folder.join("uninstall.exe"), "uninstaller").unwrap();
        assert_eq!(on_windows(&exe), Kind::Installed);
        assert_eq!(Kind::Portable.target(), Some("windows-x86_64-portable"));
        assert_eq!(Kind::Installed.target(), None);
    }

    #[test]
    fn a_release_build_where_cargo_made_it_never_updates() {
        let dir = tempfile::tempdir().unwrap();
        let release = dir.path().join("kento ğüş").join("target").join("release");
        let bundle = release.join("bundle/macos/Kento.app/Contents/MacOS");
        fs::create_dir_all(&bundle).unwrap();
        let exe = release.join("kento.exe");
        let app = bundle.join("kento");
        assert!(!built_by_cargo(&exe));
        assert!(!built_by_cargo(&app));
        fs::write(release.join(".cargo-lock"), "").unwrap();
        assert!(built_by_cargo(&exe));
        assert!(built_by_cargo(&app));
        // The portable copy unpacked anywhere else has no lock file near it.
        let portable = dir.path().join("Kento").join("Kento.exe");
        assert!(!built_by_cargo(&portable));
    }

    #[test]
    fn a_mac_app_updates_itself_only_where_it_may() {
        let exe = PathBuf::from("/Applications/Kento.app/Contents/MacOS/kento");
        assert_eq!(on_mac(&exe, |_| true), Kind::Bundle);
        assert_eq!(on_mac(&exe, |_| false), Kind::LockedBundle);
        // The bundle may be writable while the folder holding it is not.
        assert_eq!(
            on_mac(&exe, |path| path.ends_with("Kento.app")),
            Kind::LockedBundle
        );
        let translocated = PathBuf::from(
            "/private/var/folders/x1/T/AppTranslocation/0C6F-41D2/d/Kento.app/Contents/MacOS/kento",
        );
        assert_eq!(on_mac(&translocated, |_| true), Kind::Translocated);
        // A release build run from the build folder is in no bundle.
        let loose = PathBuf::from("/Users/ayşe/kento/src-tauri/target/release/kento");
        assert_eq!(on_mac(&loose, |_| true), Kind::Development);
    }

    #[test]
    fn only_copies_that_can_replace_themselves_download() {
        for kind in [
            Kind::Installed,
            Kind::Portable,
            Kind::Bundle,
            Kind::LockedBundle,
        ] {
            assert!(kind.installs(), "{kind:?}");
        }
        assert!(!Kind::Translocated.installs());
        assert!(!Kind::Development.installs());
        assert!(!Kind::LockedBundle.automatic());
        assert!(Kind::Bundle.automatic());
        // Test binaries are debug builds.
        assert_eq!(Kind::detect(), Kind::Development);
        assert_eq!(
            serde_json::to_value(Kind::LockedBundle).unwrap(),
            "lockedBundle"
        );
    }
}
