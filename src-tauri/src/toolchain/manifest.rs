// SPDX-License-Identifier: MIT
//! The pinned downloads of the optional tools (SPEC 4.2), read from `src-tauri/toolchain.lock.json`
//! and built into the app: a download can only ever be a file whose size and SHA-256 are listed
//! there.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use serde::Deserialize;

use super::Error;

const EMBEDDED: &str = include_str!("../../toolchain.lock.json");

/// The platform keys a lockfile may use.
pub const PLATFORMS: [&str; 3] = ["windows-x64", "macos-arm64", "macos-x64"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lock {
    pub schema: u32,
    pub groups: Vec<Group>,
}

/// One tool group as the setup wizard offers it: Media, Office or Extras.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Group {
    pub id: String,
    /// False for groups whose phase has not come yet: they are listed but offer nothing.
    pub available: bool,
    /// Names the install folder `<data>/tools/<group>/<version>/`.
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub platforms: BTreeMap<String, Platform>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Platform {
    /// Where the build comes from, for people reading the lockfile.
    pub source: String,
    pub files: Vec<Download>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Download {
    pub url: String,
    pub size: u64,
    /// Lowercase hex.
    pub sha256: String,
    pub archive: ArchiveKind,
    /// Tool id → the path of its binary inside the archive, with `/` between folders.
    pub entries: BTreeMap<String, String>,
    /// A folder inside the archive → the name Kento gives it next to the binaries, for tools that
    /// need files of their own beside them (ExifTool's `exiftool_files` or its Perl `lib`).
    #[serde(default)]
    pub folders: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum ArchiveKind {
    #[serde(rename = "zip")]
    Zip,
    #[serde(rename = "7z")]
    SevenZ,
    #[serde(rename = "tar.gz")]
    TarGz,
}

impl Download {
    /// The last part of the URL, checked by `Lock::parse` to be a plain file name.
    pub fn file_name(&self) -> &str {
        self.url.rsplit('/').next().unwrap_or_default()
    }
}

impl Group {
    /// This computer's downloads, when the group offers any.
    pub fn platform(&self, key: Option<&str>) -> Option<&Platform> {
        if !self.available {
            return None;
        }
        let key = key?;
        // Without an Apple silicon build, the Intel one runs through Rosetta 2, which macOS
        // offers to install on first use.
        self.platforms.get(key).or_else(|| {
            (key == "macos-arm64")
                .then(|| self.platforms.get("macos-x64"))
                .flatten()
        })
    }
}

impl Lock {
    /// The lockfile built into this app.
    pub fn embedded() -> &'static Lock {
        static LOCK: OnceLock<Lock> = OnceLock::new();
        LOCK.get_or_init(|| Lock::parse(EMBEDDED).expect("toolchain.lock.json is checked by tests"))
    }

    pub fn parse(text: &str) -> Result<Lock, Error> {
        let lock: Lock = serde_json::from_str(text)?;
        lock.check().map_err(Error::Lock)?;
        Ok(lock)
    }

    pub fn group(&self, id: &str) -> Option<&Group> {
        self.groups.iter().find(|group| group.id == id)
    }

    /// The group a tool belongs to.
    pub fn group_of(&self, tool: &str) -> Option<&Group> {
        self.groups
            .iter()
            .find(|group| group.tools.iter().any(|t| t == tool))
    }

    /// Everything the install code relies on: HTTPS only, real hashes, plain file and folder
    /// names, and every tool of a group in exactly one download per platform.
    fn check(&self) -> Result<(), String> {
        if self.schema != 1 {
            return Err(format!("unknown schema {}", self.schema));
        }
        let mut ids = BTreeSet::new();
        for group in &self.groups {
            if !ids.insert(group.id.as_str()) || !plain_name(&group.id) {
                return Err(format!("bad or repeated group id {:?}", group.id));
            }
            for tool in &group.tools {
                if !plain_name(tool)
                    || self
                        .groups
                        .iter()
                        .flat_map(|g| &g.tools)
                        .filter(|t| *t == tool)
                        .count()
                        != 1
                {
                    return Err(format!("bad or repeated tool id {tool:?}"));
                }
            }
            if group.available && group.version.as_deref().is_none_or(|v| !plain_name(v)) {
                return Err(format!("{}: an available group needs a version", group.id));
            }
            for (key, platform) in &group.platforms {
                if !PLATFORMS.contains(&key.as_str()) {
                    return Err(format!("{}: unknown platform {key}", group.id));
                }
                check_platform(group, key, platform)?;
            }
        }
        Ok(())
    }
}

fn check_platform(group: &Group, key: &str, platform: &Platform) -> Result<(), String> {
    let at = |what: String| format!("{} {key}: {what}", group.id);
    let mut names = BTreeSet::new();
    let mut covered = Vec::new();
    // Folder names share the install folder with the binaries, whose names come from the tool ids.
    let mut placed: BTreeSet<String> = group
        .tools
        .iter()
        .flat_map(|tool| [tool.clone(), format!("{tool}.exe")])
        .collect();
    for file in &platform.files {
        if !file.url.starts_with("https://") {
            return Err(at(format!("{} is not HTTPS", file.url)));
        }
        if !plain_name(file.file_name()) || !names.insert(file.file_name()) {
            return Err(at(format!("bad or repeated file name in {}", file.url)));
        }
        let hex = file.sha256.len() == 64
            && file
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !hex || file.size == 0 {
            return Err(at(format!("bad size or SHA-256 for {}", file.url)));
        }
        for (tool, inner) in &file.entries {
            if !inner_path(inner) {
                return Err(at(format!("bad entry path {inner:?}")));
            }
            covered.push(tool.as_str());
        }
        for (inner, name) in &file.folders {
            if !inner_path(inner) {
                return Err(at(format!("bad folder path {inner:?}")));
            }
            if !plain_name(name) || !placed.insert(name.clone()) {
                return Err(at(format!("bad or repeated folder name {name:?}")));
            }
        }
    }
    covered.sort_unstable();
    let mut wanted: Vec<&str> = group.tools.iter().map(String::as_str).collect();
    wanted.sort_unstable();
    if covered != wanted {
        return Err(at(format!(
            "downloads give {covered:?}, the group has {wanted:?}"
        )));
    }
    Ok(())
}

/// A path inside an archive: relative, `/` between parts, never leaving the archive's root.
fn inner_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// Letters, digits, `.`, `_` and `-`, not starting with a dot: safe as a file or folder name.
fn plain_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// This computer's key in the lockfile; None where Kento offers no downloads.
pub fn current_platform() -> Option<&'static str> {
    if cfg!(all(windows, target_arch = "x86_64")) {
        Some("windows-x64")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("macos-arm64")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("macos-x64")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_lockfile_parses_and_covers_what_it_claims() {
        let lock = Lock::parse(EMBEDDED).unwrap();
        let ids: Vec<&str> = lock.groups.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, ["media", "office", "extras"]);

        let media = lock.group("media").unwrap();
        assert!(media.available);
        assert_eq!(media.tools, ["ffmpeg", "ffprobe"]);
        assert!(media.platforms.contains_key("windows-x64"));
        for (key, platform) in &media.platforms {
            assert!(PLATFORMS.contains(&key.as_str()));
            assert!(!platform.files.is_empty());
            for file in &platform.files {
                assert!(file.url.contains(media.version.as_deref().unwrap()));
            }
        }
        let windows = &media.platforms["windows-x64"].files[0];
        assert_eq!(windows.archive, ArchiveKind::SevenZ);
        assert_eq!(windows.file_name(), "ffmpeg-9.0.2-essentials_build.7z");
        assert!(windows.entries["ffmpeg"].ends_with("/bin/ffmpeg.exe"));
        assert!(windows.folders.is_empty());

        // ExifTool: the Windows launcher with its Perl folder, the Perl script with its library on
        // every Mac (Perl needs no Rosetta, so Apple silicon has its own entry).
        let extras = lock.group("extras").unwrap();
        assert!(extras.available);
        assert_eq!(extras.tools, ["exiftool"]);
        let version = extras.version.as_deref().unwrap();
        for key in PLATFORMS {
            let platform = &extras.platforms[key];
            assert_eq!(platform.files.len(), 1);
            let file = &platform.files[0];
            assert!(file
                .url
                .starts_with("https://downloads.sourceforge.net/project/exiftool/"));
            assert!(file.url.contains(version));
            assert_eq!(file.folders.len(), 1);
        }
        let windows = &extras.platforms["windows-x64"].files[0];
        assert_eq!(windows.archive, ArchiveKind::Zip);
        assert_eq!(windows.file_name(), "exiftool-13.60_64.zip");
        assert!(windows.entries["exiftool"].ends_with("/exiftool(-k).exe"));
        assert_eq!(
            windows.folders["exiftool-13.60_64/exiftool_files"],
            "exiftool_files"
        );
        let mac = &extras.platforms["macos-arm64"].files[0];
        assert_eq!(mac.archive, ArchiveKind::TarGz);
        assert_eq!(mac.file_name(), "Image-ExifTool-13.60.tar.gz");
        assert_eq!(mac.entries["exiftool"], "Image-ExifTool-13.60/exiftool");
        assert_eq!(mac.folders["Image-ExifTool-13.60/lib"], "lib");
        assert_eq!(
            extras.platform(Some("macos-arm64")).unwrap().files[0].url,
            extras.platforms["macos-x64"].files[0].url
        );

        let office = lock.group("office").unwrap();
        assert!(!office.available);
        assert!(office.platform(current_platform()).is_none());
        assert_eq!(lock.group_of("ffprobe").unwrap().id, "media");
        assert_eq!(lock.group_of("exiftool").unwrap().id, "extras");
        assert!(lock.group_of("soffice").is_none());
        // The embedded copy is the same file.
        assert_eq!(Lock::embedded().groups.len(), 3);
    }

    #[test]
    fn this_platform_is_known() {
        if cfg!(all(windows, target_arch = "x86_64")) {
            for group in ["media", "extras"] {
                let group = Lock::embedded().group(group).unwrap();
                assert!(group.platform(current_platform()).is_some());
            }
        }
        if let Some(key) = current_platform() {
            assert!(PLATFORMS.contains(&key));
        }
    }

    fn lock_with(file: &str) -> String {
        format!(
            r#"{{"schema":1,"groups":[{{"id":"media","available":true,"version":"1.0","tools":["ffmpeg"],
            "platforms":{{"windows-x64":{{"source":"test","files":[{file}]}}}}}}]}}"#
        )
    }

    #[test]
    fn unsafe_entries_are_refused() {
        let good = r#"{"url":"https://example.org/a.zip","size":1,"sha256":"0000000000000000000000000000000000000000000000000000000000000000","archive":"zip","entries":{"ffmpeg":"bin/ffmpeg"}}"#;
        assert!(Lock::parse(&lock_with(good)).is_ok());
        for bad in [
            good.replace("https://", "http://"),
            good.replace("a.zip", ".."),
            good.replace("\"sha256\":\"0", "\"sha256\":\"X"),
            good.replace("\"size\":1", "\"size\":0"),
            good.replace("bin/ffmpeg", "../ffmpeg"),
            good.replace("\"ffmpeg\":", "\"ffprobe\":"),
            good.replace("\"zip\"", "\"rar\""),
            good.replace("bin/ffmpeg", "/bin/ffmpeg"),
            good.replace("bin/ffmpeg", "bin//ffmpeg"),
            good.replace("bin/ffmpeg", "./bin/ffmpeg"),
        ] {
            assert!(Lock::parse(&lock_with(&bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn folders_and_tar_gz_are_read_and_checked() {
        let good = r#"{"url":"https://example.org/a.tar.gz","size":1,"sha256":"0000000000000000000000000000000000000000000000000000000000000000","archive":"tar.gz","entries":{"ffmpeg":"pack/ffmpeg"},"folders":{"pack/lib":"lib"}}"#;
        let lock = Lock::parse(&lock_with(good)).unwrap();
        let file = &lock.groups[0].platforms["windows-x64"].files[0];
        assert_eq!(file.archive, ArchiveKind::TarGz);
        assert_eq!(file.file_name(), "a.tar.gz");
        assert_eq!(file.folders["pack/lib"], "lib");
        for bad in [
            good.replace("\"pack/lib\"", "\"../lib\""),
            good.replace("\"pack/lib\"", "\"pack\\\\lib\""),
            good.replace("\"pack/lib\"", "\"\""),
            good.replace(":\"lib\"", ":\"../lib\""),
            good.replace(":\"lib\"", ":\"l/ib\""),
            good.replace(":\"lib\"", ":\".lib\""),
            // A folder may not take a binary's name.
            good.replace(":\"lib\"", ":\"ffmpeg\""),
            good.replace(":\"lib\"", ":\"ffmpeg.exe\""),
            good.replace(
                "\"folders\":{\"pack/lib\":\"lib\"}",
                "\"folders\":{\"pack/lib\":\"lib\",\"pack/more\":\"lib\"}",
            ),
            good.replace("\"tar.gz\"", "\"tgz\""),
        ] {
            assert!(Lock::parse(&lock_with(&bad)).is_err(), "{bad}");
        }
    }
}
