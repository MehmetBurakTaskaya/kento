// SPDX-License-Identifier: MIT
//! The version an update is installing, remembered across the restart (SPEC 5.16). On Windows Kento
//! ends before its installer runs, and an installer that cannot put the new version in place
//! starts the old one again. That start sees the version it was installing above its own: the
//! update did not happen, and Kento does not try that version again until it is asked to (Check
//! now) or a newer one comes out, so a failing install never closes Kento at every start.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const FILE: &str = "update-attempt.json";

#[derive(Debug, Serialize, Deserialize)]
struct Attempt {
    version: String,
}

fn file(data: &Path) -> PathBuf {
    data.join(FILE)
}

/// Remembers that Kento is about to install `version`.
pub fn remember(data: &Path, version: &str) -> io::Result<()> {
    let path = file(data);
    let temp = path.with_extension("json.tmp");
    let attempt = Attempt {
        version: version.to_string(),
    };
    fs::write(&temp, serde_json::to_vec_pretty(&attempt)?)?;
    fs::rename(&temp, &path)
}

/// The version an earlier update was installing when the version `running` is older than it: that
/// install did not happen. Once `running` has reached it (or the file is unreadable), the file
/// goes and the answer is None.
pub fn missed(data: &Path, running: &str) -> Option<String> {
    let path = file(data);
    let bytes = fs::read(&path).ok()?;
    let attempt = serde_json::from_slice::<Attempt>(&bytes).ok();
    match attempt {
        Some(attempt) if newer(&attempt.version, running) => Some(attempt.version),
        _ => {
            if let Err(err) = fs::remove_file(&path) {
                tracing::warn!("the record of the last update was not removed: {err}");
            }
            None
        }
    }
}

/// Whether version `a` comes after `b`: their numbers compared in turn (1.10.0 after 1.9.2); a
/// version that is not numbers never does.
pub fn newer(a: &str, b: &str) -> bool {
    let numbers = |v: &str| -> Option<Vec<u64>> {
        v.split(['-', '+'])
            .next()?
            .split('.')
            .map(|part| part.parse().ok())
            .collect()
    };
    match (numbers(a), numbers(b)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_by_their_numbers() {
        assert!(newer("1.2.1", "1.2.0"));
        assert!(newer("1.10.0", "1.9.2"));
        assert!(newer("2.0.0", "1.99.99"));
        assert!(!newer("1.2.0", "1.2.0"));
        assert!(!newer("1.2.0", "1.2.1"));
        assert!(!newer("next", "1.2.0"));
    }

    #[test]
    fn an_install_that_did_not_happen_is_remembered_until_kento_reaches_it() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("Kento ğüş 🧪");
        fs::create_dir(&data).unwrap();
        assert_eq!(missed(&data, "1.2.0"), None);

        remember(&data, "1.2.1").unwrap();
        // The old version started again: the install did not happen, and every start knows it.
        assert_eq!(missed(&data, "1.2.0").as_deref(), Some("1.2.1"));
        assert_eq!(missed(&data, "1.2.0").as_deref(), Some("1.2.1"));
        // The new version started: the record goes.
        assert_eq!(missed(&data, "1.2.1"), None);
        assert!(!file(&data).exists());

        // A newer version installed by hand also ends it.
        remember(&data, "1.2.1").unwrap();
        assert_eq!(missed(&data, "1.3.0"), None);
        assert!(!file(&data).exists());

        // A record that cannot be read goes.
        fs::write(file(&data), b"{").unwrap();
        assert_eq!(missed(&data, "1.2.0"), None);
        assert!(!file(&data).exists());
    }
}
