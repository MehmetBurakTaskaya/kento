// SPDX-License-Identifier: MIT
//! User settings, stored as JSON in the data folder. Unknown or broken values fall back to the
//! defaults, so an older or hand-edited file never stops the app from starting.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::i18n;

pub const VERSION: u32 = 1;
pub const WHEEL_SIZES: std::ops::RangeInclusive<u16> = 300..=440;
pub const MAX_JOBS: u8 = 16;
pub const THEMES: [&str; 1] = ["steel"];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Motion {
    #[default]
    System,
    On,
    Off,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum OutputLocation {
    #[default]
    NextToSource,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Sound {
    pub enabled: bool,
    /// 0 to 1; the default is low.
    pub volume: f32,
}

impl Default for Sound {
    fn default() -> Self {
        Self {
            enabled: true,
            volume: 0.3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Output {
    pub location: OutputLocation,
    pub folder: Option<PathBuf>,
}

/// The modifier key that opens a wheel while files are dragged (SPEC 5.2). `Command` is ⌘ on
/// macOS and the Windows key elsewhere.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Key {
    Shift,
    Control,
    Alt,
    Command,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Wheels {
    /// The wheel opens while files are dragged anywhere on screen.
    pub global: bool,
    pub convert: Key,
    pub tools: Key,
    pub actions: Key,
    /// Ctrl+Shift+Space (⌃⇧Space on macOS) opens the wheel for the files selected in Explorer or
    /// Finder.
    pub selection_shortcut: bool,
}

impl Default for Wheels {
    fn default() -> Self {
        let mac = cfg!(target_os = "macos");
        Self {
            global: true,
            convert: Key::Shift,
            tools: if mac { Key::Command } else { Key::Control },
            actions: if mac { Key::Control } else { Key::Alt },
            selection_shortcut: true,
        }
    }
}

/// Kento in Explorer (Windows): Send To and the classic context menu, off until switched on.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Shell {
    pub send_to: bool,
    pub context_menu: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ShelfSettings {
    /// Keeps a copy of each shelved file, so moving or deleting the original loses nothing.
    pub keep_copy: bool,
}

/// Web media download (SPEC 5.10).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WebSettings {
    /// Ctrl+Shift+D (⌃⇧D on macOS) downloads the link on the clipboard.
    pub shortcut: bool,
    /// The first-use notice ("only download what you have the right to") has been shown.
    pub notice_shown: bool,
}

impl Default for WebSettings {
    fn default() -> Self {
        Self {
            shortcut: true,
            notice_shown: false,
        }
    }
}

/// Window layouts are off until the user switches them on (SPEC 5.12).
pub const LAYOUTS_ON_BY_DEFAULT: bool = false;

/// Window layouts (SPEC 5.12): the Window ring and, while it is on, the global shortcuts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutSettings {
    pub enabled: bool,
    /// The layout shortcuts, while the feature is on; the Window ring works without them.
    pub shortcuts: bool,
}

impl Default for LayoutSettings {
    fn default() -> Self {
        Self {
            enabled: LAYOUTS_ON_BY_DEFAULT,
            shortcuts: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub appearance: Appearance,
    pub theme: String,
    /// "system" or a language code.
    pub language: String,
    pub sound: Sound,
    pub haptics: bool,
    pub reduced_motion: Motion,
    pub launch_at_login: bool,
    pub tray_icon: bool,
    pub output: Output,
    /// Jobs at the same time; None picks a number from the processor.
    pub concurrency: Option<u8>,
    pub wheel_size: u16,
    pub wheels: Wheels,
    pub shell: Shell,
    pub shelf: ShelfSettings,
    pub web: WebSettings,
    pub layouts: LayoutSettings,
    /// The folders last chosen for Copy and Move, newest first (the wheel offers them). Kept by
    /// the core: a window's older copy of the settings never replaces them.
    pub recent_folders: Vec<PathBuf>,
}

/// How many folders Copy and Move remember.
pub const RECENT_FOLDERS: usize = 5;

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: VERSION,
            appearance: Appearance::System,
            theme: THEMES[0].to_string(),
            language: "system".to_string(),
            sound: Sound::default(),
            haptics: true,
            reduced_motion: Motion::System,
            launch_at_login: false,
            tray_icon: true,
            output: Output::default(),
            concurrency: None,
            wheel_size: 360,
            wheels: Wheels::default(),
            shell: Shell::default(),
            shelf: ShelfSettings::default(),
            web: WebSettings::default(),
            layouts: LayoutSettings::default(),
            recent_folders: Vec::new(),
        }
    }
}

/// Whether two paths name the same folder: Windows and macOS compare names without case.
pub fn same_folder(a: &Path, b: &Path) -> bool {
    let plain = |path: &Path| {
        let text = path.to_string_lossy();
        let text = text.trim_end_matches(['\\', '/']);
        if cfg!(any(windows, target_os = "macos")) {
            text.to_lowercase()
        } else {
            text.to_owned()
        }
    };
    plain(a) == plain(b)
}

/// The recent folders with `folder` first, each once, at most `RECENT_FOLDERS`.
pub fn with_recent_folder(recent: &[PathBuf], folder: &Path) -> Vec<PathBuf> {
    std::iter::once(folder.to_path_buf())
        .chain(
            recent
                .iter()
                .filter(|known| !same_folder(known, folder))
                .cloned(),
        )
        .take(RECENT_FOLDERS)
        .collect()
}

impl Settings {
    /// Brings every value into its allowed range.
    pub fn normalized(mut self) -> Self {
        self.version = VERSION;
        if !THEMES.contains(&self.theme.as_str()) {
            self.theme = THEMES[0].to_string();
        }
        let known = i18n::is_pseudo(&self.language)
            || i18n::available()
                .iter()
                .any(|lang| lang.code == self.language);
        if self.language != "system" && !known {
            self.language = "system".to_string();
        }
        self.sound.volume = if self.sound.volume.is_finite() {
            self.sound.volume.clamp(0.0, 1.0)
        } else {
            0.3
        };
        self.wheel_size = self
            .wheel_size
            .clamp(*WHEEL_SIZES.start(), *WHEEL_SIZES.end());
        self.concurrency = self.concurrency.map(|n| n.clamp(1, MAX_JOBS));
        let keys = [self.wheels.convert, self.wheels.tools, self.wheels.actions];
        if keys[0] == keys[1] || keys[0] == keys[2] || keys[1] == keys[2] {
            let defaults = Wheels::default();
            (self.wheels.convert, self.wheels.tools, self.wheels.actions) =
                (defaults.convert, defaults.tools, defaults.actions);
        }
        if self.output.location == OutputLocation::Folder && self.output.folder.is_none() {
            self.output.location = OutputLocation::NextToSource;
        }
        let mut folders: Vec<PathBuf> = Vec::new();
        for folder in std::mem::take(&mut self.recent_folders) {
            if folder.is_absolute() && !folders.iter().any(|known| same_folder(known, &folder)) {
                folders.push(folder);
            }
        }
        folders.truncate(RECENT_FOLDERS);
        self.recent_folders = folders;
        self
    }
}

/// Reads the settings; a missing file gives the defaults, and a broken one is kept aside as
/// settings.invalid.json so nothing the user wrote is lost.
pub fn load(path: &Path) -> Settings {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => return Settings::default(),
    };
    match serde_json::from_str::<Settings>(&text) {
        Ok(settings) => settings.normalized(),
        Err(err) => {
            tracing::warn!("settings file unreadable ({err}); using the defaults");
            let _ = fs::rename(path, path.with_file_name("settings.invalid.json"));
            Settings::default()
        }
    }
}

/// Writes the settings through a temporary file, so a crash never leaves half a file.
pub fn save(path: &Path, settings: &Settings) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(settings)?)?;
    fs::rename(&temp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_gives_defaults_and_saving_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        assert_eq!(load(&path), Settings::default());
        let settings = Settings {
            language: "tr".into(),
            appearance: Appearance::Dark,
            sound: Sound {
                enabled: true,
                volume: 0.5,
            },
            ..Settings::default()
        };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
        let json = fs::read_to_string(&path).unwrap();
        assert!(json.contains("\"reducedMotion\": \"system\"") && !json.contains("shelfModel"));
    }

    #[test]
    fn broken_file_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(load(&path), Settings::default());
        assert!(dir.path().join("settings.invalid.json").exists());
    }

    #[test]
    fn values_are_clamped_and_unknown_fields_ignored() {
        let json = r#"{"theme":"neon","language":"xx","sound":{"volume":7},"wheelSize":90,"concurrency":99,
                       "output":{"location":"folder"},"somethingNew":true}"#;
        let settings: Settings = serde_json::from_str::<Settings>(json).unwrap().normalized();
        assert_eq!(settings.theme, "steel");
        assert_eq!(settings.language, "system");
        assert_eq!(settings.sound.volume, 1.0);
        assert_eq!(settings.wheel_size, 300);
        assert_eq!(settings.concurrency, Some(MAX_JOBS));
        assert_eq!(settings.output.location, OutputLocation::NextToSource);
    }

    #[test]
    fn the_download_shortcut_is_on_and_the_notice_unseen_until_saved() {
        let settings = Settings::default();
        assert!(settings.web.shortcut && !settings.web.notice_shown);
        // A file from before web downloads gets the defaults; a saved choice is kept.
        let old: Settings = serde_json::from_str(r#"{"language":"tr"}"#).unwrap();
        assert_eq!(old.web, WebSettings::default());
        let saved: Settings =
            serde_json::from_str(r#"{"web":{"shortcut":false,"noticeShown":true}}"#).unwrap();
        assert!(!saved.web.shortcut && saved.web.notice_shown);
    }

    #[test]
    fn copy_and_move_remember_five_folders_newest_first() {
        let root = std::env::temp_dir();
        let folder = |name: &str| root.join(name);
        let mut recent = Vec::new();
        for name in ["a", "b", "c", "d", "e", "f"] {
            recent = with_recent_folder(&recent, &folder(name));
        }
        assert_eq!(recent, ["f", "e", "d", "c", "b"].map(folder));
        // Choosing a known folder again moves it to the front, once.
        recent = with_recent_folder(&recent, &folder("c"));
        assert_eq!(recent, ["c", "f", "e", "d", "b"].map(folder));
        if cfg!(any(windows, target_os = "macos")) {
            recent = with_recent_folder(&recent, &folder("D"));
            assert_eq!(recent.len(), 5);
            assert!(same_folder(&recent[0], &folder("d")));
        }

        // A file from before has none; a hand-edited one keeps five absolute folders, each once.
        let old: Settings = serde_json::from_str(r#"{"language":"tr"}"#).unwrap();
        assert!(old.recent_folders.is_empty());
        let edited = Settings {
            recent_folders: ["a", "a", "b", "c", "d", "e", "f"]
                .map(folder)
                .into_iter()
                .chain([PathBuf::from("relative")])
                .collect(),
            ..Settings::default()
        }
        .normalized();
        assert_eq!(edited.recent_folders, ["a", "b", "c", "d", "e"].map(folder));
        let json = serde_json::to_string(&edited).unwrap();
        assert!(json.contains("\"recentFolders\""));
    }

    #[test]
    fn window_layouts_are_off_until_switched_on() {
        assert!(!Settings::default().layouts.enabled);
        assert!(Settings::default().layouts.shortcuts);
        let old: Settings = serde_json::from_str(r#"{"language":"tr"}"#).unwrap();
        assert_eq!(old.layouts, LayoutSettings::default());
        let saved: Settings =
            serde_json::from_str(r#"{"layouts":{"enabled":true,"shortcuts":false}}"#).unwrap();
        assert!(saved.layouts.enabled && !saved.layouts.shortcuts);
    }
}
