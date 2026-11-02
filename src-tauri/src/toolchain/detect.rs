// SPDX-License-Identifier: MIT
//! Finding the tools (SPEC 4.2): a path set in Settings, then PATH and the usual install folders,
//! then Kento's own install folder. A candidate counts only when it runs, says it is the tool asked
//! for and is recent enough.

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

/// The oldest FFmpeg release Kento drives.
pub const MIN_MAJOR: u32 = 6;
/// FFmpeg 6.0 shipped libavutil 58; snapshot builds carry no release number, only this.
const MIN_AVUTIL: u32 = 58;
/// The oldest ExifTool Kento drives: 12.0 (2020) reads and writes every image format Kento
/// edits, takes UTF-8 file names from an argument file and writes JSON with group names.
pub const MIN_EXIFTOOL: u32 = 12;
/// A first run of a large static build can be slow while antivirus software scans it.
const PROBE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    System,
    Kento,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub path: PathBuf,
    pub version: String,
    pub source: Source,
}

/// Where to look for tools on this computer.
#[derive(Debug, Clone)]
pub struct Places {
    /// PATH and the usual install folders, in order.
    pub search: Vec<PathBuf>,
    /// Appended to a tool id to give its file name: `.exe` on Windows.
    pub suffix: &'static str,
}

impl Places {
    pub fn system() -> Self {
        let path = std::env::var_os("PATH").unwrap_or_default();
        Self {
            search: search_dirs(&path, extra_dirs()),
            suffix: std::env::consts::EXE_SUFFIX,
        }
    }

    pub fn file_name(&self, tool: &str) -> String {
        format!("{tool}{}", self.suffix)
    }
}

/// PATH first, then the extra folders, without repeats. Relative PATH entries are skipped: they
/// would resolve against whatever folder Kento happens to run in.
fn search_dirs(path: &OsString, extra: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for dir in std::env::split_paths(path).chain(extra) {
        let key = |p: &Path| {
            let text = p
                .to_string_lossy()
                .trim_end_matches(['/', '\\'])
                .to_string();
            if cfg!(windows) {
                text.to_lowercase()
            } else {
                text
            }
        };
        if dir.is_absolute() && !dirs.iter().any(|d| key(d) == key(&dir)) {
            dirs.push(dir);
        }
    }
    dirs
}

/// Folders package managers and manual installs use. Apps started from the Dock or Explorer do not
/// always see the PATH a terminal has, and WinGet's links folder can be added after Kento started.
fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(windows) {
        let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
        if let Some(local) = env("LOCALAPPDATA") {
            dirs.push(local.join("Microsoft").join("WinGet").join("Links"));
        }
        if let Some(home) = env("USERPROFILE") {
            dirs.push(home.join("scoop").join("shims"));
        }
        if let Some(data) = env("ProgramData") {
            dirs.push(data.join("chocolatey").join("bin"));
        }
        // The usual homes of FFmpeg and ExifTool, the latter for everyone or for one user.
        if let Some(programs) = env("ProgramFiles") {
            dirs.push(programs.join("ffmpeg").join("bin"));
            dirs.push(programs.join("ExifTool"));
        }
        if let Some(local) = env("LOCALAPPDATA") {
            dirs.push(local.join("Programs").join("ExifTool"));
        }
        if let Some(mut root) = std::env::var_os("SystemDrive") {
            // `C:` alone means the current folder on drive C, not its root.
            root.push("\\");
            dirs.push(PathBuf::from(root).join("ffmpeg").join("bin"));
        }
    } else if cfg!(target_os = "macos") {
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
            dirs.push(PathBuf::from(dir));
        }
    } else {
        dirs.push(PathBuf::from("/usr/bin"));
    }
    dirs
}

/// The first working copy of `tool`: the custom path when it works, then the search folders, then
/// Kento's install folders (newest pinned version first).
pub fn find(
    tool: &str,
    places: &Places,
    custom: Option<&Path>,
    kento: &[PathBuf],
) -> Option<Found> {
    if let Some(path) = custom {
        if let Some(version) = probe(tool, path) {
            return Some(Found {
                path: path.to_path_buf(),
                version,
                source: Source::Custom,
            });
        }
        tracing::warn!("the {tool} set in Settings did not run; looking elsewhere");
    }
    let name = places.file_name(tool);
    let candidates = places
        .search
        .iter()
        .map(|dir| (dir.join(&name), Source::System))
        .chain(kento.iter().map(|dir| (dir.join(&name), Source::Kento)));
    for (path, source) in candidates {
        if !path.is_file() {
            continue;
        }
        if let Some(version) = probe(tool, &path) {
            return Some(Found {
                path,
                version,
                source,
            });
        }
    }
    None
}

/// Runs `<path> -version` (ExifTool: `-ver`) and returns the version to show when the output is
/// `tool`'s and the version is supported.
pub fn probe(tool: &str, path: &Path) -> Option<String> {
    if tool == "exiftool" {
        let (label, major) = parse_exiftool(&run_version(path, "-ver")?)?;
        if major >= MIN_EXIFTOOL {
            return Some(label);
        }
        tracing::info!("ExifTool {label} is older than {MIN_EXIFTOOL}; not used");
        return None;
    }
    let output = run_version(path, "-version")?;
    let version = parse_version(tool, &output)?;
    if version.supported() {
        Some(version.label)
    } else {
        tracing::info!(
            "{tool} {} is older than {MIN_MAJOR}; not used",
            version.label
        );
        None
    }
}

/// ExifTool's `-ver` prints its version alone, `13.60`; anything else is another program.
pub fn parse_exiftool(output: &str) -> Option<(String, u32)> {
    let mut lines = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let line = lines.next()?;
    if lines.next().is_some() {
        return None;
    }
    let (major, minor) = line.split_once('.')?;
    let numeric = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    if !numeric(major) || !numeric(minor) {
        return None;
    }
    Some((line.to_string(), major.parse().ok()?))
}

fn run_version(path: &Path, flag: &str) -> Option<String> {
    let mut command = Command::new(path);
    command
        .arg(flag)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: a console tool would otherwise flash a window.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().ok()?;
    // Read on another thread so a full pipe never stalls the child while we wait for it.
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.by_ref().take(1 << 20).read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + PROBE_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(15));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                tracing::warn!("a tool did not answer -version in time");
                return None;
            }
        }
    };
    let bytes = reader.join().ok()?;
    status
        .success()
        .then(|| String::from_utf8_lossy(&bytes).into_owned())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    /// What Settings shows: `9.0.2` for a release, the build name for a snapshot.
    pub label: String,
    pub major: Option<u32>,
    pub avutil: Option<u32>,
}

impl Version {
    pub fn supported(&self) -> bool {
        match self.major {
            Some(major) => major >= MIN_MAJOR,
            None => self.avutil.is_some_and(|avutil| avutil >= MIN_AVUTIL),
        }
    }
}

/// Reads `ffmpeg version 9.0.2-essentials_build-www.gyan.dev Copyright …` and the `libavutil`
/// line. None when the first line is not `tool`'s.
pub fn parse_version(tool: &str, output: &str) -> Option<Version> {
    let first = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let token = first
        .strip_prefix(tool)?
        .strip_prefix(" version ")?
        .split_whitespace()
        .next()?;
    let release = release_number(token);
    let avutil = output.lines().find_map(|line| {
        let mut words = line.split_whitespace();
        if words.next()? != "libavutil" {
            return None;
        }
        words.next()?.trim_end_matches('.').parse().ok()
    });
    Some(Version {
        label: release.map_or(token, |(text, _)| text).to_string(),
        major: release.map(|(_, major)| major),
        avutil,
    })
}

/// `9.0.2` from `9.0.2-essentials_build…`, `7.1` from `n7.1-…`; None for snapshot builds such as
/// `N-117000-g…` or `2026-01-01-git-…`, which have no release number.
fn release_number(token: &str) -> Option<(&str, u32)> {
    let text = token.strip_prefix('n').unwrap_or(token);
    let end = text
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(text.len());
    let number = text[..end].trim_end_matches('.');
    let mut parts = number.split('.');
    let major = parts.next()?.parse().ok()?;
    parts.next()?.parse::<u32>().ok()?;
    Some((number, major))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    const GYAN: &str = "ffmpeg version 9.0.2-essentials_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers\r\n\
        built with gcc 15.2.0 (Rev8, Built by MSYS2 project)\r\n\
        configuration: --enable-gpl --enable-version3 --enable-static\r\n\
        libavutil      61.  3.100 / 61.  3.100\r\n";

    #[test]
    fn reads_release_and_snapshot_versions() {
        let gyan = parse_version("ffmpeg", GYAN).unwrap();
        assert_eq!(gyan.label, "9.0.2");
        assert_eq!(gyan.major, Some(9));
        assert_eq!(gyan.avutil, Some(61));
        assert!(gyan.supported());

        let tagged =
            parse_version("ffprobe", "ffprobe version n7.1-2-g1234 Copyright (c)").unwrap();
        assert_eq!((tagged.label.as_str(), tagged.major), ("7.1", Some(7)));
        assert!(tagged.supported());

        let distro = parse_version("ffmpeg", "ffmpeg version 6.1.1-3ubuntu5 Copyright").unwrap();
        assert_eq!(distro.label, "6.1.1");
        assert!(distro.supported());

        let old = parse_version(
            "ffmpeg",
            "ffmpeg version 5.1.4 Copyright\nlibavutil 57. 28.100",
        )
        .unwrap();
        assert_eq!(old.major, Some(5));
        assert!(!old.supported());

        let snapshot =
            "ffmpeg version N-117000-gabcdef0 Copyright\n  libavutil      59. 39.100 / 59. 39.100";
        let snapshot = parse_version("ffmpeg", snapshot).unwrap();
        assert_eq!(snapshot.label, "N-117000-gabcdef0");
        assert_eq!((snapshot.major, snapshot.avutil), (None, Some(59)));
        assert!(snapshot.supported());

        let dated = "ffmpeg version 2022-01-01-git-1234-full_build-www.gyan.dev Copyright\nlibavutil 57. 13.100";
        let dated = parse_version("ffmpeg", dated).unwrap();
        assert_eq!(dated.major, None);
        assert!(!dated.supported());

        assert!(parse_version("ffmpeg", "N-1 without a libavutil line").is_none());
        assert!(!parse_version("ffmpeg", "ffmpeg version N-1 Copyright")
            .unwrap()
            .supported());
    }

    #[test]
    fn output_of_another_program_is_refused() {
        assert!(parse_version("ffprobe", GYAN).is_none());
        assert!(parse_version("ffmpeg", "Microsoft Windows [Version 10.0.26200]").is_none());
        assert!(parse_version("ffmpeg", "").is_none());
    }

    #[test]
    fn search_folders_keep_order_and_skip_relative_and_repeated_ones() {
        let base = tempfile::tempdir().unwrap();
        let (a, b) = (base.path().join("a"), base.path().join("b"));
        let path =
            std::env::join_paths([a.clone(), PathBuf::from("relative"), b.clone(), a.clone()])
                .unwrap();
        let dirs = search_dirs(&path, vec![b.clone(), base.path().join("c")]);
        assert_eq!(dirs, [a, b, base.path().join("c")]);
    }

    /// The file name suffix of the stand-in tools.
    pub(crate) const FAKE_SUFFIX: &str = if cfg!(windows) { ".cmd" } else { "" };

    /// A stand-in for a tool: a batch file on Windows, a shell script elsewhere.
    pub(crate) fn fake_tool(dir: &Path, tool: &str, version: &str) -> (PathBuf, Places) {
        std::fs::create_dir_all(dir).unwrap();
        let line =
            format!("{tool} version {version} Copyright (c) 2000-2026 the FFmpeg developers");
        let avutil = "libavutil      59. 39.100 / 59. 39.100";
        let suffix = FAKE_SUFFIX;
        let text = if cfg!(windows) {
            format!("@echo off\r\necho {line}\r\necho {avutil}\r\n")
        } else {
            format!("#!/bin/sh\necho '{line}'\necho '{avutil}'\n")
        };
        let path = dir.join(format!("{tool}{suffix}"));
        std::fs::write(&path, text).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let places = Places {
            search: vec![dir.to_path_buf()],
            suffix,
        };
        (path, places)
    }

    #[test]
    fn finds_a_working_tool_and_prefers_a_working_custom_path() {
        let base = tempfile::tempdir().unwrap();
        let (system, places) = fake_tool(&base.path().join("system"), "ffmpeg", "7.1.1");
        let found = find("ffmpeg", &places, None, &[]).unwrap();
        assert_eq!(found.path, system);
        assert_eq!(found.version, "7.1.1");
        assert_eq!(found.source, Source::System);

        let (custom, _) = fake_tool(&base.path().join("custom"), "ffmpeg", "8.0");
        let found = find("ffmpeg", &places, Some(&custom), &[]).unwrap();
        assert_eq!(
            (found.source, found.version.as_str()),
            (Source::Custom, "8.0")
        );

        // A custom path that does not run gives way to the next copy.
        let broken = base.path().join("missing").join("ffmpeg.exe");
        let found = find("ffmpeg", &places, Some(&broken), &[]).unwrap();
        assert_eq!(found.source, Source::System);

        // Too old, and a different tool under the right name, are both passed over.
        let (_, old) = fake_tool(&base.path().join("old"), "ffmpeg", "5.1");
        assert!(find("ffmpeg", &old, None, &[]).is_none());
        let (wrong, _) = fake_tool(&base.path().join("wrong"), "ffprobe", "9.0");
        std::fs::rename(
            &wrong,
            base.path().join("wrong").join(old.file_name("ffmpeg")),
        )
        .unwrap();
        let wrong_places = Places {
            search: vec![base.path().join("wrong")],
            suffix: old.suffix,
        };
        assert!(find("ffmpeg", &wrong_places, None, &[]).is_none());

        // Kento's own copy comes after the system's.
        let (_, kento) = fake_tool(&base.path().join("kento"), "ffmpeg", "9.0.2");
        let empty = Places {
            search: vec![base.path().join("nothing")],
            suffix: kento.suffix,
        };
        let found = find("ffmpeg", &empty, None, &kento.search).unwrap();
        assert_eq!(
            (found.source, found.version.as_str()),
            (Source::Kento, "9.0.2")
        );
        let found = find("ffmpeg", &places, None, &kento.search).unwrap();
        assert_eq!(found.source, Source::System);
    }

    #[test]
    fn reads_exiftool_versions() {
        assert_eq!(parse_exiftool("13.60\r\n"), Some(("13.60".into(), 13)));
        assert_eq!(parse_exiftool("\n12.40\n"), Some(("12.40".into(), 12)));
        for other in [
            "",
            "13",
            "13.60.1",
            "v13.60",
            "13.6a",
            "13.60\nsomething else",
            "ffmpeg version 9.0.2 Copyright",
        ] {
            assert_eq!(parse_exiftool(other), None, "{other:?}");
        }
    }

    /// A stand-in for ExifTool that prints `version` for `-ver`.
    pub(crate) fn fake_exiftool(dir: &Path, version: &str) -> (PathBuf, Places) {
        std::fs::create_dir_all(dir).unwrap();
        let text = if cfg!(windows) {
            format!("@echo off\r\necho {version}\r\n")
        } else {
            format!("#!/bin/sh\necho '{version}'\n")
        };
        let path = dir.join(format!("exiftool{FAKE_SUFFIX}"));
        std::fs::write(&path, text).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let places = Places {
            search: vec![dir.to_path_buf()],
            suffix: FAKE_SUFFIX,
        };
        (path, places)
    }

    #[test]
    fn finds_exiftool_and_passes_over_old_ones_and_other_programs() {
        let base = tempfile::tempdir().unwrap();
        let (system, places) = fake_exiftool(&base.path().join("system ğ 🧪"), "13.60");
        let found = find("exiftool", &places, None, &[]).unwrap();
        assert_eq!(found.path, system);
        assert_eq!(
            (found.version.as_str(), found.source),
            ("13.60", Source::System)
        );

        let (_, old) = fake_exiftool(&base.path().join("old"), "11.88");
        assert!(find("exiftool", &old, None, &[]).is_none());

        // FFmpeg under ExifTool's name is not ExifTool, and the other way round.
        let (wrong, _) = fake_tool(&base.path().join("wrong"), "ffmpeg", "9.0");
        let renamed = base.path().join("wrong").join(old.file_name("exiftool"));
        std::fs::rename(&wrong, &renamed).unwrap();
        assert!(probe("exiftool", &renamed).is_none());
        assert!(probe("ffmpeg", &system).is_none());

        // A custom path first, Kento's own copy last.
        let (custom, _) = fake_exiftool(&base.path().join("custom"), "12.40");
        let found = find("exiftool", &places, Some(&custom), &[]).unwrap();
        assert_eq!(
            (found.version.as_str(), found.source),
            ("12.40", Source::Custom)
        );
        let (_, kento) = fake_exiftool(&base.path().join("kento"), "13.60");
        let nowhere = Places {
            search: vec![base.path().join("nothing")],
            suffix: FAKE_SUFFIX,
        };
        let found = find("exiftool", &nowhere, None, &kento.search).unwrap();
        assert_eq!(found.source, Source::Kento);
    }

    /// Where PATH has a recent ExifTool, detection must find it.
    #[test]
    fn finds_exiftool_on_this_computer_when_path_has_one() {
        let places = Places::system();
        let on_path = places
            .search
            .iter()
            .map(|dir| dir.join(places.file_name("exiftool")))
            .find(|path| path.is_file() && probe("exiftool", path).is_some());
        let Some(expected) = on_path else {
            eprintln!("no ExifTool {MIN_EXIFTOOL}+ on PATH; skipped");
            return;
        };
        let found = find("exiftool", &places, None, &[]).unwrap();
        assert_eq!(found.path, expected);
        eprintln!(
            "found ExifTool {} at {}",
            found.version,
            found.path.display()
        );
    }

    /// The author's machine has FFmpeg from WinGet; CI machines may not. Where PATH has a recent
    /// FFmpeg, detection must find it.
    #[test]
    fn finds_ffmpeg_on_this_computer_when_path_has_one() {
        let places = Places::system();
        let on_path = places
            .search
            .iter()
            .map(|dir| dir.join(places.file_name("ffmpeg")))
            .find(|path| path.is_file() && probe("ffmpeg", path).is_some());
        let Some(expected) = on_path else {
            eprintln!("no FFmpeg {MIN_MAJOR}+ on PATH; skipped");
            return;
        };
        let found = find("ffmpeg", &places, None, &[]).unwrap();
        assert_eq!(found.path, expected);
        assert_eq!(found.source, Source::System);
        let version =
            parse_version("ffmpeg", &run_version(&found.path, "-version").unwrap()).unwrap();
        assert!(version.major.is_none_or(|major| major >= MIN_MAJOR));
        eprintln!("found FFmpeg {} at {}", found.version, found.path.display());
    }
}
