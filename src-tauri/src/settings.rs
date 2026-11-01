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
}

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
        }
    }
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
        if self.output.location == OutputLocation::Folder && self.output.folder.is_none() {
            self.output.location = OutputLocation::NextToSource;
        }
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
}
