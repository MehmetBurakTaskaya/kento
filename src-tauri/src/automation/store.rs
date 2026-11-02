// SPDX-License-Identifier: MIT
//! The rules in automation.json and the activity log beside it (automation-log.json), both
//! written through a temporary file. The log keeps the last entries: when, which rule, the file's
//! name and what came of it; never a file's contents. Files that arrive while an update waits to
//! install are kept in automation-held.json for after the restart.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::rules::{Config, VERSION};
use crate::error::Result;

/// How many activity entries are kept.
pub const KEEP: usize = 200;

/// Reads the rules; a missing file gives none, and a broken one is kept aside as
/// automation.invalid.json so nothing the user set up is lost.
pub fn load_config(file: &Path) -> Config {
    let Ok(text) = fs::read_to_string(file) else {
        return Config::default();
    };
    match serde_json::from_str::<Config>(&text) {
        Ok(mut config) => {
            config.version = VERSION;
            config
        }
        Err(err) => {
            tracing::warn!("the automation file is unreadable ({err}); it is kept aside");
            let _ = fs::rename(file, file.with_file_name("automation.invalid.json"));
            Config::default()
        }
    }
}

pub fn save_config(file: &Path, config: &Config) -> Result<()> {
    write(file, &serde_json::to_vec_pretty(config)?)
}

/// What came of a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    /// Waiting in the queue or running.
    Queued,
    Done,
    Failed,
    /// The rule's action does not fit the file (a format it cannot convert, say).
    Skipped,
    /// Cancelled, or cut short when Kento quit.
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: u64,
    /// Unix time in milliseconds.
    pub at: u64,
    /// The rule's id, and its name (or its folder's) when it ran.
    pub rule: String,
    pub rule_name: String,
    /// The file's name.
    pub file: String,
    pub outcome: Outcome,
    /// Why it failed or was skipped, in the interface language.
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub outputs: Vec<PathBuf>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Stored {
    version: u32,
    /// Newest first.
    entries: Vec<Activity>,
}

/// The activity log in memory, newest first, and its file.
#[derive(Debug)]
pub struct Log {
    file: PathBuf,
    entries: VecDeque<Activity>,
    next: u64,
}

impl Log {
    /// Reads the log; entries still queued when Kento last quit count as cut short.
    pub fn load(file: PathBuf) -> Self {
        let mut entries: VecDeque<Activity> = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok())
            .map(|stored| stored.entries.into())
            .unwrap_or_default();
        for entry in &mut entries {
            if entry.outcome == Outcome::Queued {
                entry.outcome = Outcome::Cancelled;
            }
        }
        entries.truncate(KEEP);
        let next = entries.iter().map(|entry| entry.id).max().unwrap_or(0) + 1;
        Self {
            file,
            entries,
            next,
        }
    }

    /// Adds an entry (its id and time are set here) and returns its id.
    pub fn add(&mut self, mut entry: Activity) -> u64 {
        entry.id = self.next;
        entry.at = now_ms();
        self.next += 1;
        self.entries.push_front(entry);
        self.entries.truncate(KEEP);
        self.next - 1
    }

    /// Changes an entry, if it is still kept, and returns it as changed.
    pub fn update(&mut self, id: u64, change: impl FnOnce(&mut Activity)) -> Option<Activity> {
        let entry = self.entries.iter_mut().find(|entry| entry.id == id)?;
        change(entry);
        Some(entry.clone())
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn entries(&self) -> Vec<Activity> {
        self.entries.iter().cloned().collect()
    }

    pub fn save(&self) -> Result<()> {
        let stored = Stored {
            version: 1,
            entries: self.entries(),
        };
        write(&self.file, &serde_json::to_vec_pretty(&stored)?)
    }
}

/// A finished file a rule took while new jobs were refused (an update waits to install); it runs
/// after the restart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Held {
    pub rule: String,
    pub path: PathBuf,
}

/// The held files; a missing or broken file holds none.
pub fn load_held(file: &Path) -> Vec<Held> {
    fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Stores the held files; with none, the file goes.
pub fn save_held(file: &Path, held: &[Held]) -> Result<()> {
    if held.is_empty() {
        return match fs::remove_file(file) {
            Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
            _ => Ok(()),
        };
    }
    write(file, &serde_json::to_vec_pretty(held)?)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

/// Writes through a temporary file, so a crash never leaves half a file.
fn write(file: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let temp = file.with_extension("json.tmp");
    fs::write(&temp, bytes)?;
    fs::rename(&temp, file)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::rules::{Action, Filter, Rule};

    fn entry(file: &str) -> Activity {
        Activity {
            id: 0,
            at: 0,
            rule: "k1".into(),
            rule_name: "Ekran görüntüleri 🖼️".into(),
            file: file.into(),
            outcome: Outcome::Queued,
            message: None,
            outputs: Vec::new(),
        }
    }

    #[test]
    fn rules_round_trip_and_a_broken_file_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Kento ğüş 🧪").join("automation.json");
        assert_eq!(load_config(&file), Config::default());
        let config = Config {
            version: VERSION,
            paused: true,
            rules: vec![Rule {
                id: "k1".into(),
                name: "Ekran görüntüleri → WEBP".into(),
                enabled: false,
                folder: PathBuf::from("/Kullanıcılar/ayşe/Ekran Görüntüleri"),
                subfolders: true,
                filter: Filter {
                    extensions: vec!["png".into()],
                    pattern: "Ekran*".into(),
                    min_size: Some(1),
                    max_size: None,
                },
                action: Action::Convert { to: "webp".into() },
                output: PathBuf::from("/Kullanıcılar/ayşe/Optimize 📦"),
            }],
        };
        save_config(&file, &config).unwrap();
        assert_eq!(load_config(&file), config);
        fs::write(&file, "{ bozuk").unwrap();
        assert_eq!(load_config(&file), Config::default());
        assert!(file.with_file_name("automation.invalid.json").exists());
    }

    #[test]
    fn held_files_wait_in_their_own_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("automation-held.json");
        assert!(load_held(&file).is_empty());
        let held = vec![Held {
            rule: "k1".into(),
            path: PathBuf::from("/Kullanıcılar/ayşe/İndirilenler/çizim 🖼️.png"),
        }];
        save_held(&file, &held).unwrap();
        assert_eq!(load_held(&file), held);
        save_held(&file, &[]).unwrap();
        assert!(!file.exists());
        save_held(&file, &[]).unwrap();
    }

    #[test]
    fn the_log_keeps_the_last_entries_and_never_more() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("automation-log.json");
        let mut log = Log::load(file.clone());
        let first = log.add(entry("ilk ğ.png"));
        let done = log
            .update(first, |entry| {
                entry.outcome = Outcome::Done;
                entry.outputs = vec![PathBuf::from("/Çıktı/ilk ğ.webp")];
            })
            .unwrap();
        assert_eq!(done.outcome, Outcome::Done);
        let queued = log.add(entry("ikinci.png"));
        log.save().unwrap();

        let mut again = Log::load(file.clone());
        let entries = again.entries();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].file, "ikinci.png", "newest first");
        assert_eq!(entries[0].id, queued);
        assert_eq!(
            entries[0].outcome,
            Outcome::Cancelled,
            "cut short by quitting"
        );
        assert_eq!(entries[1], done);
        assert!(entries[0].at > 0);

        for n in 0..KEEP + 20 {
            again.add(entry(&format!("{n}.png")));
        }
        assert_eq!(again.entries().len(), KEEP);
        assert!(again.update(first, |_| {}).is_none(), "the oldest went");
        again.clear();
        again.save().unwrap();
        assert!(Log::load(file).entries().is_empty());
    }
}
