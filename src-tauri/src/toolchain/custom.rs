// SPDX-License-Identifier: MIT
//! Tool paths set by hand in Settings, kept in `<data>/tools/paths.json` as `{ "ffmpeg": "…" }`.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub type Paths = BTreeMap<String, PathBuf>;

/// A missing file means no custom paths; a broken one is set aside as `paths.invalid.json`.
pub fn load(file: &Path) -> Paths {
    let Ok(text) = fs::read_to_string(file) else {
        return Paths::new();
    };
    match serde_json::from_str(&text) {
        Ok(paths) => paths,
        Err(err) => {
            tracing::warn!("tool paths unreadable ({err}); ignored");
            let _ = fs::rename(file, file.with_file_name("paths.invalid.json"));
            Paths::new()
        }
    }
}

/// Writes through a temporary file, so a crash never leaves half a file.
pub fn save(file: &Path, paths: &Paths) -> io::Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let temp = file.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(paths)?)?;
    fs::rename(&temp, file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_survives_a_broken_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("tools").join("paths.json");
        assert!(load(&file).is_empty());

        let mut paths = Paths::new();
        paths.insert(
            "ffmpeg".into(),
            dir.path().join("my ffmpeg ğü").join("ffmpeg.exe"),
        );
        save(&file, &paths).unwrap();
        assert_eq!(load(&file), paths);

        fs::write(&file, "{ not json").unwrap();
        assert!(load(&file).is_empty());
        assert!(dir
            .path()
            .join("tools")
            .join("paths.invalid.json")
            .is_file());
    }
}
