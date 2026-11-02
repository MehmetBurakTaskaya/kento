// SPDX-License-Identifier: MIT
//! The pinned downloads of the optional tools (SPEC 4.2), read from `src-tauri/toolchain.lock.json`
//! and built into the app: a download can only ever be a file whose size and SHA-256 are listed
//! there.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::Deserialize;

use super::Error;

const EMBEDDED: &str = include_str!("../../toolchain.lock.json");

/// The platform keys a lockfile may use.
pub const PLATFORMS: [&str; 3] = ["windows-x64", "macos-arm64", "macos-x64"];

/// A kept folder named so is the whole image: an administrative install unpacks LibreOffice's
/// folders (`program`, `share`, …) at the top of the image, with no folder around them.
pub const IMAGE_ROOT: &str = "/";

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
    /// Tool id → the path of its binary inside the archive, with `/` between folders. The binary is
    /// copied out next to the others, unless it lies inside one of `folders`: then it stays there.
    pub entries: BTreeMap<String, String>,
    /// A folder inside the archive → the name Kento gives it next to the binaries, for tools that
    /// need files of their own beside them (ExifTool's `exiftool_files` or its Perl `lib`), or that
    /// must run from inside their own program folder (LibreOffice).
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
    /// A Windows Installer package, unpacked by an administrative install (`msiexec /a`): nothing
    /// is installed or registered, and no elevation is needed.
    #[serde(rename = "msi")]
    Msi,
    /// A macOS disk image, attached read-only while its folders are copied out with `ditto`.
    #[serde(rename = "dmg")]
    Dmg,
}

impl ArchiveKind {
    /// An installer image is unpacked by the system's own tool, whole: Kento keeps folders of it
    /// (with their links and code signatures) and never copies single files out.
    pub fn is_image(self) -> bool {
        matches!(self, ArchiveKind::Msi | ArchiveKind::Dmg)
    }

    /// Whether a lockfile platform may use this kind: an image only unpacks on its own system.
    fn allowed_on(self, platform: &str) -> bool {
        match self {
            ArchiveKind::Msi => platform.starts_with("windows-"),
            ArchiveKind::Dmg => platform.starts_with("macos-"),
            ArchiveKind::Zip | ArchiveKind::SevenZ | ArchiveKind::TarGz => true,
        }
    }
}

impl Download {
    /// The last part of the URL, checked by `Lock::parse` to be a plain file name.
    pub fn file_name(&self) -> &str {
        self.url.rsplit('/').next().unwrap_or_default()
    }

    /// For an entry inside one of the kept folders: the name Kento gives that folder and the rest
    /// of the entry's path inside it. Such a tool runs from where it lies in the folder.
    pub fn kept<'a>(&'a self, inner: &'a str) -> Option<(&'a str, &'a str)> {
        self.folders.iter().find_map(|(folder, name)| {
            let rest = if folder == IMAGE_ROOT {
                inner
            } else {
                inner.strip_prefix(folder.as_str())?.strip_prefix('/')?
            };
            Some((name.as_str(), rest))
        })
    }
}

impl Platform {
    /// Where each tool's program lands, relative to the install folder: `file_name(tool)` for a
    /// binary copied out, its place inside its kept folder otherwise.
    pub fn programs(&self, file_name: impl Fn(&str) -> String) -> BTreeMap<String, PathBuf> {
        self.files
            .iter()
            .flat_map(|file| {
                file.entries.iter().map(|(tool, inner)| {
                    let path = match file.kept(inner) {
                        Some((folder, rest)) => rest
                            .split('/')
                            .fold(PathBuf::from(folder), |path, part| path.join(part)),
                        None => PathBuf::from(file_name(tool)),
                    };
                    (tool.clone(), path)
                })
            })
            .collect()
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
        if !file.archive.allowed_on(key) {
            return Err(at(format!("{} cannot be unpacked here", file.url)));
        }
        for (tool, inner) in &file.entries {
            if !inner_path(inner) {
                return Err(at(format!("bad entry path {inner:?}")));
            }
            if file.archive.is_image() && file.kept(inner).is_none() {
                return Err(at(format!(
                    "{inner:?} must lie in a kept folder of the image"
                )));
            }
            covered.push(tool.as_str());
        }
        for (inner, name) in &file.folders {
            if inner == IMAGE_ROOT {
                if file.archive != ArchiveKind::Msi || file.folders.len() > 1 {
                    return Err(at(format!(
                        "only an installer package keeps its whole image, as its one folder ({})",
                        file.url
                    )));
                }
            } else if !inner_path(inner) {
                return Err(at(format!("bad folder path {inner:?}")));
            }
            if !plain_name(name) || !placed.insert(name.clone()) {
                return Err(at(format!("bad or repeated folder name {name:?}")));
            }
            // A folder inside another would be taken twice.
            if file
                .folders
                .keys()
                .any(|other| inner.starts_with(&format!("{other}/")))
            {
                return Err(at(format!("{inner:?} lies inside another kept folder")));
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

        // LibreOffice: the official installers, each unpacked by its own system's tool, the
        // program running from inside its kept folder.
        let office = lock.group("office").unwrap();
        assert!(office.available);
        assert_eq!(office.tools, ["soffice"]);
        assert_eq!(office.license.as_deref(), Some("MPL-2.0"));
        let version = office.version.as_deref().unwrap();
        for key in PLATFORMS {
            let platform = &office.platforms[key];
            assert_eq!(platform.files.len(), 1);
            let file = &platform.files[0];
            assert!(file.url.starts_with(&format!(
                "https://download.documentfoundation.org/libreoffice/stable/{version}/"
            )));
            assert!(file
                .file_name()
                .starts_with(&format!("LibreOffice_{version}_")));
            assert!(file.archive.is_image());
            assert!(file.kept(&file.entries["soffice"]).is_some());
        }
        let windows = &office.platforms["windows-x64"];
        assert_eq!(windows.files[0].archive, ArchiveKind::Msi);
        assert_eq!(
            windows.files[0].file_name(),
            "LibreOffice_26.8.2_Win_x86-64.msi"
        );
        assert_eq!(
            windows.programs(|tool| format!("{tool}.exe"))["soffice"],
            ["LibreOffice", "program", "soffice.exe"]
                .iter()
                .collect::<PathBuf>()
        );
        for (key, name) in [
            ("macos-arm64", "LibreOffice_26.8.2_MacOS_aarch64.dmg"),
            ("macos-x64", "LibreOffice_26.8.2_MacOS_x86-64.dmg"),
        ] {
            let mac = &office.platforms[key];
            assert_eq!(mac.files[0].archive, ArchiveKind::Dmg);
            assert_eq!(mac.files[0].file_name(), name);
            assert_eq!(
                mac.programs(|tool| tool.to_string())["soffice"],
                ["LibreOffice.app", "Contents", "MacOS", "soffice"]
                    .iter()
                    .collect::<PathBuf>()
            );
        }
        // Apple silicon has its own build, not Rosetta.
        assert_ne!(
            office.platform(Some("macos-arm64")).unwrap().files[0].url,
            office.platforms["macos-x64"].files[0].url
        );

        assert_eq!(lock.group_of("ffprobe").unwrap().id, "media");
        assert_eq!(lock.group_of("exiftool").unwrap().id, "extras");
        assert_eq!(lock.group_of("soffice").unwrap().id, "office");
        // The embedded copy is the same file.
        assert_eq!(Lock::embedded().groups.len(), 3);
    }

    #[test]
    fn this_platform_is_known() {
        if cfg!(all(windows, target_arch = "x86_64")) {
            for group in ["media", "office", "extras"] {
                let group = Lock::embedded().group(group).unwrap();
                assert!(group.platform(current_platform()).is_some());
            }
        }
        if let Some(key) = current_platform() {
            assert!(PLATFORMS.contains(&key));
        }
    }

    fn lock_with(file: &str) -> String {
        lock_on("windows-x64", file)
    }

    fn lock_on(platform: &str, file: &str) -> String {
        format!(
            r#"{{"schema":1,"groups":[{{"id":"media","available":true,"version":"1.0","tools":["ffmpeg"],
            "platforms":{{"{platform}":{{"source":"test","files":[{file}]}}}}}}]}}"#
        )
    }

    const NO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

    #[test]
    fn installer_images_are_read_and_kept_to_their_own_platform() {
        let msi = format!(
            r#"{{"url":"https://example.org/Office.msi","size":1,"sha256":"{NO_HASH}","archive":"msi",
            "entries":{{"ffmpeg":"Office/program/ffmpeg.exe"}},"folders":{{"Office":"Office"}}}}"#
        );
        let lock = Lock::parse(&lock_on("windows-x64", &msi)).unwrap();
        let file = &lock.groups[0].platforms["windows-x64"].files[0];
        assert_eq!(file.archive, ArchiveKind::Msi);
        assert!(file.archive.is_image());
        assert_eq!(
            file.kept("Office/program/ffmpeg.exe"),
            Some(("Office", "program/ffmpeg.exe"))
        );
        assert_eq!(file.kept("Other/ffmpeg.exe"), None);
        assert_eq!(file.kept("Office"), None);

        let dmg = msi
            .replace(".msi", ".dmg")
            .replace("\"msi\"", "\"dmg\"")
            .replace(
                "Office/program/ffmpeg.exe",
                "Office.app/Contents/MacOS/ffmpeg",
            )
            .replace("{\"Office\":\"Office\"}", "{\"Office.app\":\"Office.app\"}");
        for key in ["macos-arm64", "macos-x64"] {
            let lock = Lock::parse(&lock_on(key, &dmg)).unwrap();
            let platform = &lock.groups[0].platforms[key];
            assert_eq!(platform.files[0].archive, ArchiveKind::Dmg);
            assert_eq!(
                platform.programs(|tool| tool.to_string())["ffmpeg"],
                ["Office.app", "Contents", "MacOS", "ffmpeg"]
                    .iter()
                    .collect::<PathBuf>()
            );
        }

        // An administrative install has no folder around its own: the package keeps the whole
        // image, as its one kept folder, and its programs lie anywhere in it.
        let whole = msi
            .replace("\"Office/program/ffmpeg.exe\"", "\"program/ffmpeg.exe\"")
            .replace("{\"Office\":\"Office\"}", "{\"/\":\"Office\"}");
        let lock = Lock::parse(&lock_on("windows-x64", &whole)).unwrap();
        assert_eq!(
            lock.groups[0].platforms["windows-x64"].programs(|tool| format!("{tool}.exe"))
                ["ffmpeg"],
            ["Office", "program", "ffmpeg.exe"]
                .iter()
                .collect::<PathBuf>()
        );
        assert!(Lock::parse(&lock_on(
            "windows-x64",
            &whole.replace(
                "{\"/\":\"Office\"}",
                "{\"/\":\"Office\",\"share\":\"share\"}"
            )
        ))
        .is_err());
        assert!(Lock::parse(&lock_on(
            "macos-arm64",
            &dmg.replace("{\"Office.app\":\"Office.app\"}", "{\"/\":\"Office.app\"}")
                .replace("\"Office.app/Contents", "\"Contents")
        ))
        .is_err());

        // Each image only on its own system.
        assert!(Lock::parse(&lock_on("macos-arm64", &msi)).is_err());
        assert!(Lock::parse(&lock_on("macos-x64", &msi)).is_err());
        assert!(Lock::parse(&lock_on("windows-x64", &dmg)).is_err());
        for bad in [
            // An image keeps folders; its programs stay inside them.
            msi.replace("Office/program/ffmpeg.exe", "setup/ffmpeg.exe"),
            msi.replace(",\"folders\":{\"Office\":\"Office\"}", ""),
            // A kept folder inside another would be taken twice.
            msi.replace(
                "{\"Office\":\"Office\"}",
                "{\"Office\":\"Office\",\"Office/program\":\"program\"}",
            ),
            msi.replace("\"msi\"", "\"MSI\""),
        ] {
            assert!(Lock::parse(&lock_on("windows-x64", &bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_tool_inside_a_kept_folder_of_an_archive_stays_there() {
        let zip = format!(
            r#"{{"url":"https://example.org/a.zip","size":1,"sha256":"{NO_HASH}","archive":"zip",
            "entries":{{"ffmpeg":"pack/Tool/bin/ffmpeg.exe"}},"folders":{{"pack/Tool":"Tool"}}}}"#
        );
        let lock = Lock::parse(&lock_with(&zip)).unwrap();
        let platform = &lock.groups[0].platforms["windows-x64"];
        assert_eq!(
            platform.programs(|tool| format!("{tool}.exe"))["ffmpeg"],
            ["Tool", "bin", "ffmpeg.exe"].iter().collect::<PathBuf>()
        );
        // Outside its folders a binary is copied out under the name Kento gives it.
        let copied = zip.replace("pack/Tool/bin/ffmpeg.exe", "pack/bin/ffmpeg.exe");
        let lock = Lock::parse(&lock_with(&copied)).unwrap();
        assert_eq!(
            lock.groups[0].platforms["windows-x64"].programs(|tool| format!("{tool}.exe"))
                ["ffmpeg"],
            PathBuf::from("ffmpeg.exe")
        );
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
