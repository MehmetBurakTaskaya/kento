// SPDX-License-Identifier: MIT
//! Where Kento keeps its own data: %LOCALAPPDATA%\Kento on Windows and
//! ~/Library/Application Support/Kento on macOS. Updates never delete it.

use std::fs;
use std::path::{Path, PathBuf};

pub const APP_DIR: &str = "Kento";

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data: PathBuf,
    pub logs: PathBuf,
    pub temp: PathBuf,
}

impl AppPaths {
    /// The folders under a base such as the platform's local data folder.
    pub fn under(base: &Path) -> Self {
        let data = base.join(APP_DIR);
        Self {
            logs: data.join("logs"),
            temp: data.join("temp"),
            data,
        }
    }

    pub fn settings_file(&self) -> PathBuf {
        self.data.join("settings.json")
    }

    /// LibreOffice's profile for Kento's jobs, apart from the user's own (SPEC 7).
    pub fn office_profile(&self) -> PathBuf {
        self.data.join("office-profile")
    }

    pub fn create(&self) -> std::io::Result<()> {
        for dir in [&self.data, &self.logs, &self.temp] {
            fs::create_dir_all(dir)?;
        }
        Ok(())
    }

    /// Removes what earlier runs left in the temp folder (a job cut short, a forced quit) and
    /// returns how many entries went.
    pub fn clean_temp(&self) -> std::io::Result<usize> {
        let mut removed = 0;
        for entry in fs::read_dir(&self.temp)? {
            let path = entry?.path();
            let gone = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
            if gone.is_ok() {
                removed += 1;
            }
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_the_folders_and_cleans_temp() {
        let base = tempfile::tempdir().unwrap();
        let paths = AppPaths::under(base.path());
        paths.create().unwrap();
        assert!(paths.logs.is_dir() && paths.temp.is_dir());
        fs::write(paths.temp.join("left-over.part"), b"x").unwrap();
        fs::create_dir(paths.temp.join("job-7")).unwrap();
        assert_eq!(paths.clean_temp().unwrap(), 2);
        assert_eq!(fs::read_dir(&paths.temp).unwrap().count(), 0);
        assert_eq!(
            paths.settings_file(),
            base.path().join("Kento").join("settings.json")
        );
    }
}
