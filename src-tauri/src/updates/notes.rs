// SPDX-License-Identifier: MIT
//! Release notes on the first start after an update (SPEC 5.16). Before installing, Kento keeps the
//! notes of the version it installs (the `notes` of latest.json, plain text from the CHANGELOG) in
//! its data folder; the next start takes them once and forgets them, and Home shows them.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const FILE: &str = "update-notes.json";
/// Notes longer than this are cut; a CHANGELOG section is far shorter.
const LIMIT: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Notes {
    pub version: String,
    pub notes: String,
}

fn file(data: &Path) -> PathBuf {
    data.join(FILE)
}

/// Keeps the notes of `version` for its first start; notes that are empty keep nothing, and
/// whatever an earlier update kept goes.
pub fn keep(data: &Path, version: &str, notes: Option<&str>) -> io::Result<()> {
    let path = file(data);
    let notes = notes.map(str::trim).unwrap_or_default();
    if notes.is_empty() {
        return match fs::remove_file(&path) {
            Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
            _ => Ok(()),
        };
    }
    let notes: String = notes.chars().take(LIMIT).collect();
    let kept = Notes {
        version: version.to_string(),
        notes,
    };
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(&kept)?)?;
    fs::rename(&temp, &path)
}

/// The notes of the version now running, once: the file goes whatever it held, and notes kept for
/// another version (an install that did not happen) are dropped.
pub fn take(data: &Path, running: &str) -> Option<Notes> {
    let path = file(data);
    let bytes = fs::read(&path).ok()?;
    if let Err(err) = fs::remove_file(&path) {
        tracing::warn!("the release notes were not removed after reading: {err}");
    }
    serde_json::from_slice::<Notes>(&bytes)
        .ok()
        .filter(|notes| notes.version == running)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_wait_for_their_version_and_show_once() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("Kento ğüş 🧪");
        fs::create_dir(&data).unwrap();
        let text = "Yenilikler\n- Daha hızlı dönüştürme\n- Türkçe dosya adları 🧪";
        keep(&data, "1.2.0", Some(text)).unwrap();

        // The version before the update never sees them, and they are forgotten.
        assert_eq!(take(&data, "1.1.0"), None);
        assert_eq!(take(&data, "1.2.0"), None);

        keep(&data, "1.2.0", Some(text)).unwrap();
        assert_eq!(
            take(&data, "1.2.0"),
            Some(Notes {
                version: "1.2.0".into(),
                notes: text.into()
            })
        );
        assert_eq!(take(&data, "1.2.0"), None, "only once");
        assert!(!data.join(FILE).exists());
    }

    #[test]
    fn an_update_without_notes_forgets_the_old_ones() {
        let dir = tempfile::tempdir().unwrap();
        keep(dir.path(), "1.2.0", Some("eski notlar")).unwrap();
        keep(dir.path(), "1.3.0", Some("  \n ")).unwrap();
        assert!(!dir.path().join(FILE).exists());
        keep(dir.path(), "1.3.0", None).unwrap();
        assert_eq!(take(dir.path(), "1.3.0"), None);

        let long = "ş".repeat(LIMIT + 50);
        keep(dir.path(), "1.4.0", Some(&long)).unwrap();
        assert_eq!(
            take(dir.path(), "1.4.0").unwrap().notes.chars().count(),
            LIMIT
        );
        // A broken file is dropped as well.
        fs::write(dir.path().join(FILE), "{ bozuk").unwrap();
        assert_eq!(take(dir.path(), "1.4.0"), None);
        assert!(!dir.path().join(FILE).exists());
    }
}
