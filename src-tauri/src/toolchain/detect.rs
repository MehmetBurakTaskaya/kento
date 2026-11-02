// SPDX-License-Identifier: MIT
//! Finding the tools (SPEC 4.2): a path set in Settings, then PATH and the usual install folders,
//! then Kento's own install folder. A candidate counts only when it runs, says it is the tool asked
//! for and is recent enough.

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

/// The oldest FFmpeg release Kento drives.
pub const MIN_MAJOR: u32 = 6;
/// FFmpeg 6.0 shipped libavutil 58; snapshot builds carry no release number, only this.
const MIN_AVUTIL: u32 = 58;
/// The oldest ExifTool Kento drives: 12.0 (2020) reads and writes every image format Kento
/// edits, takes UTF-8 file names from an argument file and writes JSON with group names.
pub const MIN_EXIFTOOL: u32 = 12;
/// The oldest LibreOffice Kento drives (7.0, 2020).
pub const MIN_LIBREOFFICE: u32 = 7;
/// The oldest yt-dlp Kento drives: 2025.11.12, the first release that solves YouTube's JavaScript
/// challenges with an external runtime such as Deno.
pub const MIN_YTDLP: [u32; 3] = [2025, 11, 12];
/// The oldest Deno Kento drives: yt-dlp refuses Deno before 2.3 since its 2026.06.09 release.
pub const MIN_DENO: [u32; 2] = [2, 3];
/// A first run of a large static build can be slow while antivirus software scans it.
const PROBE_TIMEOUT: Duration = Duration::from_secs(20);
/// LibreOffice loads far more than one program on its first start from a new folder, and yt-dlp's
/// builds unpack a whole Python before they answer.
const SLOW_TIMEOUT: Duration = Duration::from_secs(60);

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
        // LibreOffice's program folder, 64-bit or 32-bit; it never puts itself on PATH.
        for programs in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(programs) = env(programs) {
                dirs.push(programs.join("LibreOffice").join("program"));
            }
        }
    } else if cfg!(target_os = "macos") {
        // LibreOffice for everyone or for one user, then Homebrew (whose cask links `soffice`).
        let app = Path::new("LibreOffice.app").join("Contents").join("MacOS");
        dirs.push(Path::new("/Applications").join(&app));
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join("Applications").join(&app));
        }
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
            dirs.push(PathBuf::from(dir));
        }
    } else {
        dirs.push(PathBuf::from("/usr/bin"));
    }
    dirs.extend(user_dirs());
    dirs
}

/// Where installers for one user put Deno and yt-dlp: Deno's own installer (`~/.deno/bin`, or
/// `bin` in the folder `DENO_INSTALL` names) and pipx (`~/.local/bin`).
fn user_dirs() -> Vec<PathBuf> {
    let env = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    let mut dirs = Vec::new();
    if let Some(root) = env("DENO_INSTALL") {
        dirs.push(PathBuf::from(root).join("bin"));
    }
    if let Some(home) = env(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        dirs.push(home.join(".deno").join("bin"));
        dirs.push(home.join(".local").join("bin"));
    }
    dirs
}

/// The first working copy of `tool`: the custom path when it works, then the search folders, then
/// Kento's own copies (`kento`: the program in each install folder, newest pinned version first).
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
        .chain(kento.iter().map(|path| (path.clone(), Source::Kento)));
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

/// The first of Kento's own copies of a resource (a library Kento loads, a model it reads) that is
/// there: such a file is never run to be checked, and it was verified against its pinned SHA-256
/// before it was unpacked. Its version is the name of its install folder.
pub fn find_file(kento: &[PathBuf]) -> Option<Found> {
    kento.iter().find_map(|path| {
        let usable = std::fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.len() > 0);
        let version = path.parent()?.file_name()?.to_string_lossy().into_owned();
        usable.then(|| Found {
            path: path.clone(),
            version,
            source: Source::Kento,
        })
    })
}

/// The program a path chosen in Settings stands for. A folder means the tool inside it; for
/// LibreOffice that may also be its install folder (`program\soffice.exe` inside) or
/// `LibreOffice.app`, and `soffice.com`, its console twin on Windows, means the program beside it.
/// A folder holding yt-dlp's macOS program under its download name, `yt-dlp_macos`, means that.
pub fn resolve(tool: &str, path: &Path, places: &Places) -> PathBuf {
    let name = places.file_name(tool);
    if tool == "yt-dlp" && path.is_dir() && !path.join(&name).is_file() {
        let download = path.join("yt-dlp_macos");
        if download.is_file() {
            return download;
        }
    }
    if tool == "soffice" {
        if path.is_dir() {
            let inside = [
                path.join("program").join(&name),
                path.join("Contents").join("MacOS").join(&name),
                path.join("LibreOffice.app")
                    .join("Contents")
                    .join("MacOS")
                    .join(&name),
            ];
            if let Some(program) = inside.into_iter().find(|program| program.is_file()) {
                return program;
            }
        } else if path
            .file_name()
            .is_some_and(|file| file.eq_ignore_ascii_case("soffice.com"))
        {
            return path.with_file_name(&name);
        }
    }
    if path.is_dir() {
        path.join(name)
    } else {
        path.to_path_buf()
    }
}

/// Runs `<path> -version` (ExifTool: `-ver`; LibreOffice, yt-dlp and Deno: `--version`) and
/// returns the version to show when the output is `tool`'s and the version is supported.
pub fn probe(tool: &str, path: &Path) -> Option<String> {
    if tool == "yt-dlp" {
        let (label, parts) = parse_ytdlp(&run_version(path, &["--version"], &[], SLOW_TIMEOUT)?)?;
        if parts[..] >= MIN_YTDLP[..] {
            return Some(label);
        }
        tracing::info!("yt-dlp {label} cannot use Deno; not used");
        return None;
    }
    if tool == "deno" {
        // Deno may look online for a newer release; Kento goes online only when asked.
        let quiet = [("DENO_NO_UPDATE_CHECK", "1")];
        let (label, release) =
            parse_deno(&run_version(path, &["--version"], &quiet, PROBE_TIMEOUT)?)?;
        if release >= MIN_DENO {
            return Some(label);
        }
        tracing::info!("Deno {label} is older than yt-dlp accepts; not used");
        return None;
    }
    if tool == "exiftool" {
        let (label, major) = parse_exiftool(&run_version(path, &["-ver"], &[], PROBE_TIMEOUT)?)?;
        if major >= MIN_EXIFTOOL {
            return Some(label);
        }
        tracing::info!("ExifTool {label} is older than {MIN_EXIFTOOL}; not used");
        return None;
    }
    if tool == "soffice" {
        let (label, major) = parse_libreoffice(&soffice_version(path)?)?;
        if major >= MIN_LIBREOFFICE {
            return Some(label);
        }
        tracing::info!("LibreOffice {label} is older than {MIN_LIBREOFFICE}; not used");
        return None;
    }
    let output = run_version(path, &["-version"], &[], PROBE_TIMEOUT)?;
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

/// yt-dlp's `--version` prints its release alone, a date: `2026.10.26`, a fix the same day
/// `2022.06.22.1`, a nightly build `2026.10.27.012345`. The numbers come back for comparing.
/// Anything else is another program.
pub fn parse_ytdlp(output: &str) -> Option<(String, Vec<u32>)> {
    let mut lines = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let line = lines.next()?;
    if lines.next().is_some() {
        return None;
    }
    let parts: Vec<&str> = line.split('.').collect();
    let digits = |part: &&str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    if !(3..=4).contains(&parts.len())
        || !parts.iter().all(digits)
        || parts[0].len() != 4
        || parts[1].len() != 2
        || parts[2].len() != 2
    {
        return None;
    }
    let numbers: Vec<u32> = parts
        .iter()
        .map(|part| part.parse().ok())
        .collect::<Option<_>>()?;
    let date = (1..=12).contains(&numbers[1]) && (1..=31).contains(&numbers[2]);
    date.then(|| (line.to_string(), numbers))
}

/// Deno's `--version` starts with `deno 2.9.8 (stable, release, x86_64-pc-windows-msvc)` (a canary
/// build: `deno 2.9.8+1a2b3c4 (canary, …)`). The number shown is the release, `2.9.8`; its major
/// and minor come back for comparing. Anything else is another program.
pub fn parse_deno(output: &str) -> Option<(String, [u32; 2])> {
    let first = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let mut words = first.split_whitespace();
    if words.next()? != "deno" {
        return None;
    }
    let release = words.next()?.split(['+', '-']).next()?;
    let parts: Vec<u32> = release
        .split('.')
        .map(|part| {
            (!part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
                .then(|| part.parse().ok())
                .flatten()
        })
        .collect::<Option<_>>()?;
    (parts.len() == 3).then(|| (release.to_string(), [parts[0], parts[1]]))
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

/// LibreOffice's `--version` prints `LibreOffice 26.8.2.2 <build hash>` (a development build:
/// `LibreOfficeDev 26.8.0.0.alpha1 …`). The number shown is the release, `26.8.2`, without the
/// build. Anything else is another program.
pub fn parse_libreoffice(output: &str) -> Option<(String, u32)> {
    output.lines().find_map(|line| {
        let mut words = line.split_whitespace();
        if !matches!(words.next()?, "LibreOffice" | "LibreOfficeDev") {
            return None;
        }
        let parts: Vec<&str> = words
            .next()?
            .split('.')
            .take_while(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
            .collect();
        if parts.len() < 2 {
            return None;
        }
        Some((
            parts[..parts.len().min(3)].join("."),
            parts[0].parse().ok()?,
        ))
    })
}

/// Asks LibreOffice for its version without touching a LibreOffice the user has open: the probe
/// runs with a profile folder of its own, removed afterwards, so it can never hand itself over to
/// a running copy, which listens under the user's profile. On Windows `soffice.exe` is a window
/// program that prints nothing; its console twin `soffice.com` beside it answers instead.
fn soffice_version(path: &Path) -> Option<String> {
    static PROBES: AtomicU32 = AtomicU32::new(0);
    let program = version_program(path)?;
    let profile = std::env::temp_dir().join(format!(
        "kento-soffice-probe-{}-{}",
        std::process::id(),
        PROBES.fetch_add(1, Ordering::Relaxed)
    ));
    let isolated = format!("-env:UserInstallation={}", file_url(&profile));
    let output = run_version(&program, &[&isolated, "--version"], &[], SLOW_TIMEOUT);
    if profile.exists() {
        let _ = std::fs::remove_dir_all(&profile);
    }
    output
}

/// The file to run for `--version`: `soffice.com` beside a Windows `soffice.exe`, which must be
/// there; otherwise the program itself.
fn version_program(path: &Path) -> Option<PathBuf> {
    let windows_program = cfg!(windows)
        && path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
    if !windows_program {
        return Some(path.to_path_buf());
    }
    let console = path.with_extension("com");
    console.is_file().then_some(console)
}

/// A `file:` URL for a local folder, as LibreOffice's `-env:` settings take it: `/` between parts
/// and every byte outside the plain ASCII set percent-encoded, so Turkish letters, emoji and spaces
/// in a user name survive.
fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let mut url = String::from("file://");
    if !text.starts_with('/') {
        // `C:/…` becomes `file:///C:/…`.
        url.push('/');
    }
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"/-._~:".contains(&byte) {
            url.push(char::from(byte));
        } else {
            url.push_str(&format!("%{byte:02X}"));
        }
    }
    url
}

fn run_version(
    path: &Path,
    args: &[&str],
    env: &[(&str, &str)],
    limit: Duration,
) -> Option<String> {
    let mut command = Command::new(path);
    command
        .args(args)
        .envs(env.iter().copied())
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
    let deadline = Instant::now() + limit;
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
        let (own, kento) = fake_tool(&base.path().join("kento"), "ffmpeg", "9.0.2");
        let empty = Places {
            search: vec![base.path().join("nothing")],
            suffix: kento.suffix,
        };
        let found = find("ffmpeg", &empty, None, std::slice::from_ref(&own)).unwrap();
        assert_eq!(
            (found.source, found.version.as_str()),
            (Source::Kento, "9.0.2")
        );
        let found = find("ffmpeg", &places, None, &[own]).unwrap();
        assert_eq!(found.source, Source::System);
    }

    #[test]
    fn a_resource_is_kentos_first_copy_that_is_there() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("araçlar ğ 🧪").join("bg-model");
        let (newer, older) = (dir.join("2.0"), dir.join("1.0"));
        std::fs::create_dir_all(&newer).unwrap();
        std::fs::create_dir_all(&older).unwrap();
        let (empty, file) = (newer.join("Model.onnx"), older.join("Model.onnx"));
        std::fs::write(&empty, b"").unwrap();
        std::fs::write(&file, b"model").unwrap();
        // An empty file is a broken copy; a missing one is skipped too.
        let found = find_file(&[dir.join("3.0").join("Model.onnx"), empty, file.clone()]).unwrap();
        assert_eq!(
            (found.path, found.version.as_str(), found.source),
            (file, "1.0", Source::Kento)
        );
        assert!(find_file(&[]).is_none());
        assert!(
            find_file(std::slice::from_ref(&older)).is_none(),
            "a folder is not the file"
        );
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
        let (own, _) = fake_exiftool(&base.path().join("kento"), "13.60");
        let nowhere = Places {
            search: vec![base.path().join("nothing")],
            suffix: FAKE_SUFFIX,
        };
        let found = find("exiftool", &nowhere, None, &[own]).unwrap();
        assert_eq!(found.source, Source::Kento);
    }

    #[test]
    fn reads_libreoffice_versions() {
        for (output, label, major) in [
            (
                "LibreOffice 26.8.2.2 0e5b4a3c2d1f00112233445566778899aabbccdd\n",
                "26.8.2",
                26,
            ),
            (
                "\r\nLibreOffice 7.6.4.1 e19e193f88cd6c0525a17fb7a176ed8e6a3e2aa1\r\n",
                "7.6.4",
                7,
            ),
            ("LibreOfficeDev 26.8.0.0.alpha1 abcdef", "26.8.0", 26),
            ("LibreOffice 24.2 x", "24.2", 24),
            // A warning on standard output before the version line.
            (
                "Warning: failed to launch javaldx\nLibreOffice 25.8.2.2 1234",
                "25.8.2",
                25,
            ),
        ] {
            assert_eq!(
                parse_libreoffice(output),
                Some((label.to_string(), major)),
                "{output:?}"
            );
        }
        for other in [
            "",
            "LibreOffice",
            "LibreOffice 26",
            "LibreOffice x.y.z",
            "Collabora Office 24.04.5.2 abcdef",
            "OpenOffice 4.1.15 abcdef",
            "ffmpeg version 9.0.2 Copyright",
            "13.60",
        ] {
            assert_eq!(parse_libreoffice(other), None, "{other:?}");
        }
    }

    /// A stand-in for LibreOffice that prints `line` for `--version`. Where a shell script can
    /// check its arguments, it insists on a profile of the probe's own, as the real probe passes.
    pub(crate) fn fake_soffice(dir: &Path, line: &str) -> (PathBuf, Places) {
        std::fs::create_dir_all(dir).unwrap();
        let text = if cfg!(windows) {
            format!("@echo off\r\necho {line}\r\n")
        } else {
            format!(
                "#!/bin/sh\ncase \"$1\" in -env:UserInstallation=file:///*) ;; *) exit 1 ;; esac\n\
                 [ \"$2\" = --version ] || exit 1\necho '{line}'\n"
            )
        };
        let path = dir.join(format!("soffice{FAKE_SUFFIX}"));
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
    fn finds_libreoffice_and_passes_over_old_ones_and_other_suites() {
        let base = tempfile::tempdir().unwrap();
        let (system, places) = fake_soffice(
            &base
                .path()
                .join("Program Files ğ 🧪")
                .join("LibreOffice")
                .join("program"),
            "LibreOffice 25.8.2.2 0123456789abcdef",
        );
        let found = find("soffice", &places, None, &[]).unwrap();
        assert_eq!(found.path, system);
        assert_eq!(
            (found.version.as_str(), found.source),
            ("25.8.2", Source::System)
        );

        let (_, old) = fake_soffice(&base.path().join("old"), "LibreOffice 6.4.7.2 abcdef");
        assert!(find("soffice", &old, None, &[]).is_none());
        let (_, other) = fake_soffice(&base.path().join("other"), "Collabora Office 24.04.5.2 ab");
        assert!(find("soffice", &other, None, &[]).is_none());
        // FFmpeg under LibreOffice's name is not LibreOffice, and the other way round.
        let (ffmpeg, _) = fake_tool(&base.path().join("wrong"), "ffmpeg", "9.0");
        let renamed = base.path().join("wrong").join(old.file_name("soffice"));
        std::fs::rename(&ffmpeg, &renamed).unwrap();
        assert!(probe("soffice", &renamed).is_none());
        assert!(probe("ffmpeg", &system).is_none());

        // A custom path first; Kento's own copy, inside its kept folder, last.
        let (custom, _) = fake_soffice(&base.path().join("custom"), "LibreOffice 7.0.0.3 ab");
        let found = find("soffice", &places, Some(&custom), &[]).unwrap();
        assert_eq!(
            (found.version.as_str(), found.source),
            ("7.0.0", Source::Custom)
        );
        let (own, _) = fake_soffice(
            &base
                .path()
                .join("26.8.2")
                .join("LibreOffice")
                .join("program"),
            "LibreOffice 26.8.2.2 0e5b4a3c",
        );
        let nowhere = Places {
            search: vec![base.path().join("nothing")],
            suffix: FAKE_SUFFIX,
        };
        let found = find("soffice", &nowhere, None, std::slice::from_ref(&own)).unwrap();
        assert_eq!((found.path, found.source), (own, Source::Kento));
    }

    #[test]
    fn a_chosen_libreoffice_folder_or_bundle_means_the_program_inside() {
        let base = tempfile::tempdir().unwrap();
        let places = Places {
            search: Vec::new(),
            suffix: FAKE_SUFFIX,
        };
        let name = places.file_name("soffice");
        let install = base.path().join("LibreOffice ğ 🧪");
        let program = install.join("program");
        fake_soffice(&program, "LibreOffice 26.8.2.2 ab");
        // The install folder, the program folder, the program, its console twin.
        assert_eq!(resolve("soffice", &install, &places), program.join(&name));
        assert_eq!(resolve("soffice", &program, &places), program.join(&name));
        assert_eq!(
            resolve("soffice", &program.join(&name), &places),
            program.join(&name)
        );
        assert_eq!(
            resolve("soffice", &program.join("soffice.com"), &places),
            program.join(&name)
        );

        // LibreOffice.app, or the folder that holds it.
        let apps = base.path().join("Applications ğ");
        let bundle = apps.join("LibreOffice.app");
        let macos = bundle.join("Contents").join("MacOS");
        fake_soffice(&macos, "LibreOffice 26.8.2.2 ab");
        assert_eq!(resolve("soffice", &bundle, &places), macos.join(&name));
        assert_eq!(resolve("soffice", &apps, &places), macos.join(&name));

        // Other tools keep the plain rule, and a folder without LibreOffice gives a path that
        // then fails its check.
        assert_eq!(
            resolve("ffmpeg", &install, &places),
            install.join(places.file_name("ffmpeg"))
        );
        let empty = base.path().join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(resolve("soffice", &empty, &places), empty.join(&name));
        assert!(probe("soffice", &resolve("soffice", &empty, &places)).is_none());
    }

    #[test]
    fn the_probe_profile_is_a_file_url_that_survives_any_name() {
        if cfg!(windows) {
            assert_eq!(
                file_url(Path::new(
                    r"C:\Users\Ayşe Yılmaz\AppData\Local\Temp\kento 🧪"
                )),
                "file:///C:/Users/Ay%C5%9Fe%20Y%C4%B1lmaz/AppData/Local/Temp/kento%20%F0%9F%A7%AA"
            );
        } else {
            assert_eq!(
                file_url(Path::new("/Users/ayşe/Library/Caches/kento 🧪")),
                "file:///Users/ay%C5%9Fe/Library/Caches/kento%20%F0%9F%A7%AA"
            );
        }
    }

    #[test]
    fn windows_asks_the_console_twin_for_the_version() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("program ğ");
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("soffice.exe");
        std::fs::write(&exe, b"").unwrap();
        if cfg!(windows) {
            // Without soffice.com nothing is run.
            assert_eq!(version_program(&exe), None);
            std::fs::write(dir.join("soffice.com"), b"").unwrap();
            assert_eq!(version_program(&exe), Some(dir.join("soffice.com")));
        } else {
            assert_eq!(version_program(&exe), Some(exe.clone()));
        }
        let script = dir.join("soffice.cmd");
        assert_eq!(version_program(&script), Some(script.clone()));
    }

    /// Where this computer has LibreOffice in one of the usual places, detection must find it and
    /// read its version. CI installs it and sets `KENTO_REQUIRE_SOFFICE=1`, so there a LibreOffice
    /// that is missing or does not answer fails the test.
    #[test]
    fn finds_libreoffice_on_this_computer_when_it_is_installed() {
        let places = Places::system();
        let installed = places
            .search
            .iter()
            .map(|dir| dir.join(places.file_name("soffice")))
            .find(|path| path.is_file() && probe("soffice", path).is_some());
        let Some(expected) = installed else {
            assert!(
                std::env::var_os("KENTO_REQUIRE_SOFFICE").is_none_or(|v| v != "1"),
                "KENTO_REQUIRE_SOFFICE is set, but no LibreOffice {MIN_LIBREOFFICE}+ answered in {:?}",
                places.search
            );
            eprintln!("no LibreOffice in the usual places; skipped");
            return;
        };
        let found = find("soffice", &places, None, &[]).unwrap();
        assert_eq!(found.path, expected);
        assert_eq!(found.source, Source::System);
        eprintln!(
            "found LibreOffice {} at {}",
            found.version,
            found.path.display()
        );
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
        let version = parse_version(
            "ffmpeg",
            &run_version(&found.path, &["-version"], &[], PROBE_TIMEOUT).unwrap(),
        )
        .unwrap();
        assert!(version.major.is_none_or(|major| major >= MIN_MAJOR));
        eprintln!("found FFmpeg {} at {}", found.version, found.path.display());
    }

    #[test]
    fn reads_ytdlp_versions() {
        for (output, label, numbers) in [
            ("2026.10.26\n", "2026.10.26", vec![2026, 10, 26]),
            ("\r\n2025.11.12\r\n", "2025.11.12", vec![2025, 11, 12]),
            ("2022.06.22.1", "2022.06.22.1", vec![2022, 6, 22, 1]),
            (
                "2026.10.27.012345",
                "2026.10.27.012345",
                vec![2026, 10, 27, 12345],
            ),
        ] {
            assert_eq!(
                parse_ytdlp(output),
                Some((label.to_string(), numbers)),
                "{output:?}"
            );
        }
        for other in [
            "",
            "13.60",
            "2026.10",
            "26.10.26",
            "2026.1.26",
            "2026.13.01",
            "2026.10.32",
            "v2026.10.26",
            "2026.10.26 extra",
            "2026.10.26.1.2",
            "2026.10.26\n2026.10.27",
            "ffmpeg version 9.0.2 Copyright",
            "deno 2.9.8 (stable, release, x86_64-pc-windows-msvc)",
        ] {
            assert_eq!(parse_ytdlp(other), None, "{other:?}");
        }
    }

    #[test]
    fn reads_deno_versions() {
        for (output, label, release) in [
            (
                "deno 2.9.8 (stable, release, x86_64-pc-windows-msvc)\r\nv8 14.7.173.20-rusty\r\ntypescript 5.9.2\r\n",
                "2.9.8",
                [2, 9],
            ),
            (
                "deno 2.3.0 (stable, release, aarch64-apple-darwin)",
                "2.3.0",
                [2, 3],
            ),
            ("deno 2.10.1+1a2b3c4 (canary, release, x86_64)", "2.10.1", [2, 10]),
            ("\ndeno 1.46.3 (release, x86_64-apple-darwin)", "1.46.3", [1, 46]),
        ] {
            assert_eq!(
                parse_deno(output),
                Some((label.to_string(), release)),
                "{output:?}"
            );
        }
        for other in [
            "",
            "deno",
            "deno 2.9",
            "deno x.y.z",
            "Deno 2.9.8",
            "denox 2.9.8",
            "v22.11.0",
            "node v22.11.0",
            "2026.10.26",
            "ffmpeg version 9.0.2 Copyright",
        ] {
            assert_eq!(parse_deno(other), None, "{other:?}");
        }
    }

    /// Writes a stand-in program: a batch file on Windows, a shell script elsewhere.
    fn script(path: &Path, windows: &str, unix: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let text = if cfg!(windows) {
            format!("@echo off\r\n{}", windows.replace('\n', "\r\n"))
        } else {
            format!("#!/bin/sh\n{unix}")
        };
        std::fs::write(path, text).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    /// The text of a stand-in for yt-dlp that prints `version` for `--version`.
    pub(crate) fn ytdlp_script(version: &str) -> String {
        if cfg!(windows) {
            format!("@echo off\r\nif not \"%~1\"==\"--version\" exit /b 1\r\necho {version}\r\n")
        } else {
            format!("#!/bin/sh\n[ \"$1\" = --version ] || exit 1\necho '{version}'\n")
        }
    }

    /// A stand-in for yt-dlp in `dir`.
    pub(crate) fn fake_ytdlp(dir: &Path, version: &str) -> (PathBuf, Places) {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(format!("yt-dlp{FAKE_SUFFIX}"));
        std::fs::write(&path, ytdlp_script(version)).unwrap();
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

    /// A stand-in for Deno that answers `--version` only when the probe has turned off its update
    /// check.
    pub(crate) fn fake_deno(dir: &Path, version: &str) -> (PathBuf, Places) {
        let path = dir.join(format!("deno{FAKE_SUFFIX}"));
        let line = format!("deno {version} (stable, release, x86_64-pc-windows-msvc)");
        script(
            &path,
            &format!(
                "if not \"%DENO_NO_UPDATE_CHECK%\"==\"1\" exit /b 1\n\
                 echo {line}\necho v8 14.7.173.20-rusty\necho typescript 5.9.2\n"
            ),
            &format!(
                "[ \"$DENO_NO_UPDATE_CHECK\" = 1 ] || exit 1\n[ \"$1\" = --version ] || exit 1\n\
                 echo '{line}'\necho 'v8 14.7.173.20-rusty'\necho 'typescript 5.9.2'\n"
            ),
        );
        let places = Places {
            search: vec![dir.to_path_buf()],
            suffix: FAKE_SUFFIX,
        };
        (path, places)
    }

    #[test]
    fn finds_ytdlp_and_deno_and_passes_over_old_ones_and_other_programs() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("araçlar ğ 🧪");
        let (ytdlp, places) = fake_ytdlp(&dir, "2026.10.26");
        let (deno, _) = fake_deno(&dir, "2.9.8");
        let found = find("yt-dlp", &places, None, &[]).unwrap();
        assert_eq!(
            (found.path, found.version.as_str(), found.source),
            (ytdlp.clone(), "2026.10.26", Source::System)
        );
        let found = find("deno", &places, None, &[]).unwrap();
        assert_eq!(
            (found.path, found.version.as_str()),
            (deno.clone(), "2.9.8")
        );

        // The first yt-dlp that runs Deno, and the first Deno today's yt-dlp accepts.
        let (_, old) = fake_ytdlp(&base.path().join("old ytdlp"), "2025.10.22");
        assert!(find("yt-dlp", &old, None, &[]).is_none());
        let (edge, _) = fake_ytdlp(&base.path().join("edge ytdlp"), "2025.11.12");
        assert_eq!(probe("yt-dlp", &edge).as_deref(), Some("2025.11.12"));
        let (_, old) = fake_deno(&base.path().join("old deno"), "2.2.12");
        assert!(find("deno", &old, None, &[]).is_none());
        let (edge, _) = fake_deno(&base.path().join("edge deno"), "2.3.0");
        assert_eq!(probe("deno", &edge).as_deref(), Some("2.3.0"));

        // Each under the other's name, or another tool under theirs, is not it.
        assert!(probe("yt-dlp", &deno).is_none());
        assert!(probe("deno", &ytdlp).is_none());
        let (exiftool, _) = fake_exiftool(&base.path().join("exif"), "13.60");
        assert!(probe("yt-dlp", &exiftool).is_none());
        let (ffmpeg, _) = fake_tool(&base.path().join("ffmpeg"), "ffmpeg", "9.0");
        assert!(probe("deno", &ffmpeg).is_none());
        assert!(probe("ffmpeg", &deno).is_none());

        // Kento's own copies come last, the first that works winning.
        let nowhere = Places {
            search: vec![base.path().join("nothing")],
            suffix: FAKE_SUFFIX,
        };
        let (newer, _) = fake_ytdlp(&base.path().join("kento").join("2026.11.01"), "2026.11.01");
        let found = find("yt-dlp", &nowhere, None, &[newer.clone(), ytdlp.clone()]).unwrap();
        assert_eq!((found.path, found.source), (newer, Source::Kento));
    }

    #[test]
    fn a_chosen_folder_with_ytdlps_mac_download_means_that_program() {
        let base = tempfile::tempdir().unwrap();
        let places = Places {
            search: Vec::new(),
            suffix: FAKE_SUFFIX,
        };
        let folder = base.path().join("İndirilenler 🧪");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("yt-dlp_macos"), b"program").unwrap();
        assert_eq!(
            resolve("yt-dlp", &folder, &places),
            folder.join("yt-dlp_macos")
        );
        // Its own name wins, and other tools keep the plain rule.
        fake_ytdlp(&folder, "2026.10.26");
        assert_eq!(
            resolve("yt-dlp", &folder, &places),
            folder.join(places.file_name("yt-dlp"))
        );
        assert_eq!(
            resolve("deno", &folder, &places),
            folder.join(places.file_name("deno"))
        );
    }

    #[test]
    fn denos_own_install_folder_is_searched() {
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
        let Some(home) = home.filter(|home| !home.is_empty()) else {
            return;
        };
        let deno = PathBuf::from(home).join(".deno").join("bin");
        assert!(extra_dirs().contains(&deno));
        let path = std::env::join_paths([PathBuf::from("/nowhere")]).unwrap();
        assert!(search_dirs(&path, extra_dirs()).contains(&deno));
    }

    /// A tool from an environment variable (`KENTO_YTDLP`, `KENTO_DENO`), or else from PATH and the
    /// usual folders.
    fn installed(tool: &str, variable: &str) -> Option<Found> {
        let places = Places::system();
        let custom = std::env::var_os(variable).map(PathBuf::from);
        find(tool, &places, custom.as_deref(), &[])
    }

    /// Where this computer has yt-dlp and Deno, detection must find them and read their versions.
    /// CI installs both and sets `KENTO_REQUIRE_YTDLP=1`, so there a missing or old one fails.
    #[test]
    fn finds_ytdlp_and_deno_on_this_computer_when_installed() {
        let required = std::env::var("KENTO_REQUIRE_YTDLP").is_ok_and(|v| v == "1");
        for (tool, variable) in [("yt-dlp", "KENTO_YTDLP"), ("deno", "KENTO_DENO")] {
            match installed(tool, variable) {
                Some(found) => eprintln!(
                    "found {tool} {} at {} ({:?})",
                    found.version,
                    found.path.display(),
                    found.source
                ),
                None => {
                    assert!(
                        !required,
                        "KENTO_REQUIRE_YTDLP is set, but no {tool} Kento accepts answered \
                         (set {variable} or put it on PATH)"
                    );
                    eprintln!("no {tool} Kento accepts on this computer; skipped");
                }
            }
        }
    }
}
