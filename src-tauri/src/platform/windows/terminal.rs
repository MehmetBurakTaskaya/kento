// SPDX-License-Identifier: MIT
//! "Open in terminal": Windows Terminal when installed, otherwise Windows PowerShell.
//!
//! The process is started with `CreateProcessW` directly rather than `std::process::Command`:
//! the terminal outlives Kento, so it must not inherit Kento's inheritable handles as std's
//! children do, and a PowerShell window must get its own console even when Kento runs with one
//! (a debug build), where std would hand it Kento's standard handles. The arguments are still an
//! array, quoted by the rules `CommandLineToArgvW` and the C runtime parse.

use std::ffi::{OsStr, OsString};
use std::os::windows::ffi::OsStringExt;
use std::path::{Component, Path, PathBuf, Prefix};

use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
use windows::Win32::System::Threading::{
    CreateProcessW, CREATE_NEW_CONSOLE, CREATE_NO_WINDOW, PROCESS_CREATION_FLAGS,
    PROCESS_INFORMATION, STARTUPINFOW,
};
use windows::Win32::UI::Shell::{FOLDERID_LocalAppData, FOLDERID_System};

use super::{failed, known_folder, wide, wide_nul};
use crate::platform::{PlatformError, Result};

pub fn open_terminal(dir: &Path) -> Result<()> {
    if !dir.is_absolute() {
        return Err(PlatformError::Failed(
            "the folder path must be absolute".into(),
        ));
    }
    let dir = plain_path(dir);
    // A file means its folder: "Open in terminal" on a file opens where it lives.
    let dir = if dir.is_dir() {
        dir
    } else {
        match dir.parent() {
            Some(parent) if parent.is_dir() => parent.to_path_buf(),
            _ => return Err(PlatformError::Failed("the folder does not exist".into())),
        }
    };
    let powershell = known_folder(&FOLDERID_System)?.join(r"WindowsPowerShell\v1.0\powershell.exe");
    let launch = terminal_launch(&dir, windows_terminal(), powershell);
    spawn(&launch, &dir)
}

#[derive(Debug, PartialEq)]
struct Launch {
    program: PathBuf,
    args: Vec<OsString>,
    flags: PROCESS_CREATION_FLAGS,
}

fn terminal_launch(dir: &Path, windows_terminal: Option<PathBuf>, powershell: PathBuf) -> Launch {
    // wt splits its command line at every `;`, so a folder with one goes to PowerShell, whose
    // quoting we control fully.
    let splits_for_wt = wide(dir.as_os_str()).contains(&u16::from(b';'));
    match windows_terminal {
        Some(program) if !splits_for_wt => Launch {
            program,
            args: vec!["-d".into(), dir.as_os_str().to_owned()],
            // wt only hands the folder to Windows Terminal; if it is a console program, it must
            // not flash a console window of its own.
            flags: CREATE_NO_WINDOW,
        },
        _ => {
            let mut command = OsString::from("Set-Location -LiteralPath ");
            command.push(powershell_literal(dir.as_os_str()));
            Launch {
                program: powershell,
                args: vec!["-NoExit".into(), "-Command".into(), command],
                flags: CREATE_NEW_CONSOLE,
            }
        }
    }
}

/// `wt.exe` on PATH, or the app execution alias in `%LOCALAPPDATA%\Microsoft\WindowsApps`.
fn windows_terminal() -> Option<PathBuf> {
    let on_path: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    let apps = known_folder(&FOLDERID_LocalAppData)
        .ok()
        .map(|local| local.join(r"Microsoft\WindowsApps"));
    on_path
        .into_iter()
        .chain(apps)
        // A relative PATH entry would resolve against whatever Kento's current folder is.
        .filter(|folder| folder.is_absolute())
        .map(|folder| folder.join("wt.exe"))
        // The alias is a reparse point that only CreateProcess follows; `metadata` would fail.
        .find(|candidate| std::fs::symlink_metadata(candidate).is_ok_and(|meta| !meta.is_dir()))
}

/// Drops the `\\?\` prefix of verbatim paths, which neither wt nor Windows PowerShell accept.
fn plain_path(path: &Path) -> PathBuf {
    let mut components = path.components();
    match components.next() {
        Some(Component::Prefix(prefix)) => {
            let rest = components.as_path();
            let root = match prefix.kind() {
                Prefix::VerbatimDisk(letter) => format!("{}:\\", char::from(letter)),
                Prefix::VerbatimUNC(server, share) => {
                    let mut unc = OsString::from(r"\\");
                    unc.push(server);
                    unc.push(r"\");
                    unc.push(share);
                    unc.push(r"\");
                    return PathBuf::from(unc).join(rest);
                }
                _ => return path.to_path_buf(),
            };
            PathBuf::from(root).join(rest)
        }
        _ => path.to_path_buf(),
    }
}

/// A PowerShell single-quoted string. PowerShell also takes the typographic single quotes as
/// quote characters (language specification, single-quote-character), so each is doubled too.
fn powershell_literal(text: &OsStr) -> OsString {
    let mut quoted = vec![u16::from(b'\'')];
    for unit in wide(text) {
        if matches!(unit, 0x27 | 0x2018 | 0x2019 | 0x201A | 0x201B) {
            quoted.push(unit);
        }
        quoted.push(unit);
    }
    quoted.push(u16::from(b'\''));
    OsString::from_wide(&quoted)
}

/// Joins a program and its arguments into a command line that splits back into the same array.
fn command_line(program: &Path, args: &[OsString]) -> Vec<u16> {
    // The program name is parsed differently: quotes delimit it and backslashes are literal.
    let mut line = vec![u16::from(b'"')];
    line.extend(wide(program.as_os_str()));
    line.push(u16::from(b'"'));
    for arg in args {
        line.push(u16::from(b' '));
        push_argument(&mut line, &wide(arg));
    }
    line
}

fn push_argument(line: &mut Vec<u16>, arg: &[u16]) {
    const QUOTE: u16 = b'"' as u16;
    const BACKSLASH: u16 = b'\\' as u16;
    let plain = !arg.is_empty()
        && !arg
            .iter()
            .any(|&unit| matches!(unit, 0x20 | 0x09 | 0x0A | 0x0B | QUOTE));
    if plain {
        line.extend_from_slice(arg);
        return;
    }
    line.push(QUOTE);
    let mut backslashes = 0;
    for &unit in arg {
        if unit == BACKSLASH {
            backslashes += 1;
        } else {
            if unit == QUOTE {
                // 2n + 1 backslashes before a quote give n backslashes and a literal quote.
                line.extend(std::iter::repeat_n(BACKSLASH, backslashes + 1));
            }
            backslashes = 0;
        }
        line.push(unit);
    }
    // Backslashes before the closing quote are doubled so they stay literal.
    line.extend(std::iter::repeat_n(BACKSLASH, backslashes));
    line.push(QUOTE);
}

fn spawn(launch: &Launch, dir: &Path) -> Result<()> {
    let mut line = command_line(&launch.program, &launch.args);
    line.push(0);
    let program = HSTRING::from(launch.program.as_path());
    // CreateProcess refuses a working folder longer than MAX_PATH; wt -d and Set-Location
    // still go there.
    let dir = wide_nul(dir.as_os_str());
    let folder = if dir.len() < MAX_PATH as usize {
        PCWSTR(dir.as_ptr())
    } else {
        PCWSTR::null()
    };
    let startup = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as u32,
        ..Default::default()
    };
    let mut process = PROCESS_INFORMATION::default();
    // SAFETY: every string is NUL-terminated and outlives the call; the command line buffer is
    // writable as CreateProcessW requires; the returned handles are closed below.
    unsafe {
        CreateProcessW(
            &program,
            Some(PWSTR(line.as_mut_ptr())),
            None,
            None,
            false,
            launch.flags,
            None,
            folder,
            &startup,
            &mut process,
        )
        .map_err(|err| failed("the terminal could not start", err))?;
        let _ = CloseHandle(process.hThread);
        let _ = CloseHandle(process.hProcess);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::UI::Shell::CommandLineToArgvW;

    /// Splits a command line the way the system does.
    fn split(line: &[u16]) -> Vec<String> {
        let mut line = line.to_vec();
        line.push(0);
        let mut count = 0;
        // SAFETY: a NUL-terminated line; the returned block is read within its count and freed.
        unsafe {
            let argv = CommandLineToArgvW(PCWSTR(line.as_ptr()), &mut count);
            assert!(!argv.is_null());
            let args = (0..count as usize)
                .map(|index| String::from_utf16(argv.add(index).read().as_wide()).unwrap())
                .collect();
            let _ = LocalFree(Some(HLOCAL(argv.cast())));
            args
        }
    }

    #[test]
    fn arguments_survive_the_command_line() {
        let tricky = [
            "plain",
            "",
            "with space",
            r"C:\Users\Burak\",
            r"C:\Program Files\Kento\",
            r#"say "hi""#,
            r#"back\"slash"#,
            r"trailing\\",
            "tab\there",
            "Çalışma Masası ğüşiöç İ",
            "🎉 emoji 📁",
            r"\\server\share\ı ş",
            "a;b&c|d^e%f!g",
            "'single' ‘curly’",
        ];
        let args: Vec<OsString> = tricky.iter().map(OsString::from).collect();
        let program = Path::new(r"C:\Program Files\Some Tool\tool.exe");
        let parsed = split(&command_line(program, &args));
        assert_eq!(parsed[0], program.to_str().unwrap());
        assert_eq!(&parsed[1..], &tricky[..]);
    }

    #[test]
    fn powershell_literals_double_every_quote() {
        let quote = |text: &str| powershell_literal(OsStr::new(text)).into_string().unwrap();
        assert_eq!(quote(r"C:\Users\Burak"), r"'C:\Users\Burak'");
        assert_eq!(quote("Burak's"), "'Burak''s'");
        assert_eq!(quote("‘a’ ‚b‛"), "'‘‘a’’ ‚‚b‛‛'");
        assert_eq!(quote("$HOME `n [x] *"), "'$HOME `n [x] *'");
        assert_eq!(quote("Masaüstü 🎉"), "'Masaüstü 🎉'");
    }

    #[test]
    fn windows_terminal_gets_the_folder_as_its_own_argument() {
        let dir = Path::new(r"C:\Users\Burak\Masaüstü\yeni klasör 🎉");
        let wt = PathBuf::from(r"C:\Users\Burak\AppData\Local\Microsoft\WindowsApps\wt.exe");
        let launch = terminal_launch(dir, Some(wt.clone()), PathBuf::from("powershell.exe"));
        assert_eq!(launch.program, wt);
        assert_eq!(launch.args, vec![OsString::from("-d"), dir.into()]);
        assert_eq!(launch.flags, CREATE_NO_WINDOW);
        let parsed = split(&command_line(&launch.program, &launch.args));
        assert_eq!(parsed[1..], ["-d", dir.to_str().unwrap()]);
    }

    #[test]
    fn powershell_is_the_fallback() {
        let dir = Path::new(r"D:\İş\Burak's ‘files’");
        let ps = PathBuf::from(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
        let launch = terminal_launch(dir, None, ps.clone());
        assert_eq!(launch.program, ps);
        assert_eq!(launch.flags, CREATE_NEW_CONSOLE);
        let parsed = split(&command_line(&launch.program, &launch.args));
        assert_eq!(
            parsed[1..],
            [
                "-NoExit",
                "-Command",
                r"Set-Location -LiteralPath 'D:\İş\Burak''s ‘‘files’’'",
            ]
        );
    }

    #[test]
    fn a_semicolon_in_the_folder_avoids_windows_terminal() {
        let dir = Path::new(r"C:\a;b");
        let launch = terminal_launch(dir, Some("wt.exe".into()), "powershell.exe".into());
        assert_eq!(launch.program, PathBuf::from("powershell.exe"));
    }

    #[test]
    fn verbatim_prefixes_are_dropped() {
        assert_eq!(
            plain_path(Path::new(r"\\?\C:\Users\Burak")),
            PathBuf::from(r"C:\Users\Burak")
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\UNC\server\share\dir")),
            PathBuf::from(r"\\server\share\dir")
        );
        assert_eq!(
            plain_path(Path::new(r"C:\Users\Burak")),
            PathBuf::from(r"C:\Users\Burak")
        );
        assert_eq!(
            plain_path(Path::new(r"\\server\share\x")),
            PathBuf::from(r"\\server\share\x")
        );
    }

    #[test]
    fn an_app_execution_alias_can_be_found_and_started() {
        // winget's alias is a reparse point like wt's; it exits on its own, without a window.
        let Ok(local) = known_folder(&FOLDERID_LocalAppData) else {
            return;
        };
        let alias = local.join(r"Microsoft\WindowsApps\winget.exe");
        if std::fs::symlink_metadata(&alias).is_err() {
            return;
        }
        let launch = Launch {
            program: alias,
            args: vec!["--version".into()],
            flags: CREATE_NO_WINDOW,
        };
        let dir = std::env::temp_dir();
        assert!(spawn(&launch, &dir).is_ok());
    }

    #[test]
    fn missing_folders_are_refused() {
        let missing = std::env::temp_dir()
            .join("kento-no-such-folder-🎉")
            .join("x");
        assert!(open_terminal(&missing).is_err());
        assert!(open_terminal(Path::new("src")).is_err());
    }
}
