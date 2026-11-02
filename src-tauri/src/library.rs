// SPDX-License-Identifier: MIT
//! The Library (SPEC 5.9): the last 50 successful exports and clipboard imports. It lists files,
//! never holds them, and lives in library.json in Kento's data folder.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::catalog;

const KEEP: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Origin {
    Convert,
    Tool,
    Paste,
    /// A web download (SPEC 5.10).
    Download,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: u64,
    pub path: PathBuf,
    pub folder: bool,
    /// The catalog format of a file output.
    pub format: Option<String>,
    /// Unix time in milliseconds.
    pub created: u64,
    pub origin: Origin,
    /// The name of the file it came from, for "photo.heic → photo.jpg".
    pub source: Option<String>,
}

/// An item as the page sees it, with what the disk says now.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(flatten)]
    pub item: Item,
    pub name: String,
    pub category: Option<catalog::Category>,
    /// False once the file has been moved or deleted.
    pub exists: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Stored {
    version: u32,
    items: Vec<Item>,
}

pub struct Library {
    file: PathBuf,
    items: Mutex<Vec<Item>>,
}

impl Library {
    /// Reads library.json; a missing or unreadable file gives an empty Library.
    pub fn load(file: PathBuf) -> Self {
        let items = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok())
            .map(|stored| stored.items)
            .unwrap_or_default();
        Self {
            file,
            items: Mutex::new(items),
        }
    }

    /// Records outputs, newest first, and keeps the last 50.
    pub fn add(&self, origin: Origin, source: Option<&Path>, outputs: &[PathBuf]) -> Vec<Item> {
        let mut items = self.lock();
        let mut id = items.iter().map(|item| item.id).max().unwrap_or(0);
        let created = now_ms();
        let source = source
            .and_then(Path::file_name)
            .map(|name| name.to_string_lossy().into_owned());
        let added: Vec<Item> = outputs
            .iter()
            .map(|path| {
                id += 1;
                let folder = path.is_dir();
                Item {
                    id,
                    path: path.clone(),
                    folder,
                    format: (!folder).then(|| format_of(path)).flatten(),
                    created,
                    origin,
                    source: source.clone(),
                }
            })
            .collect();
        for item in added.iter().rev() {
            items.insert(0, item.clone());
        }
        items.truncate(KEEP);
        self.save(&items);
        added
    }

    pub fn get(&self, id: u64) -> Option<Item> {
        self.lock().iter().find(|item| item.id == id).cloned()
    }

    /// Takes an item off the list; the file stays where it is.
    pub fn remove(&self, id: u64) -> bool {
        let mut items = self.lock();
        let before = items.len();
        items.retain(|item| item.id != id);
        let removed = items.len() != before;
        if removed {
            self.save(&items);
        }
        removed
    }

    pub fn entries(&self) -> Vec<Entry> {
        self.lock()
            .iter()
            .map(|item| {
                let meta = fs::metadata(&item.path).ok();
                Entry {
                    name: item
                        .path
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    category: item
                        .format
                        .as_deref()
                        .and_then(catalog::format)
                        .map(|format| format.category),
                    exists: meta.is_some(),
                    size: meta.filter(|m| m.is_file()).map(|m| m.len()),
                    item: item.clone(),
                }
            })
            .collect()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Item>> {
        self.items.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Writes atomically: a crash mid-write never leaves a broken library.json.
    fn save(&self, items: &[Item]) {
        let stored = Stored {
            version: 1,
            items: items.to_vec(),
        };
        let temp = self.file.with_extension("json.tmp");
        let result = serde_json::to_vec_pretty(&stored)
            .map_err(std::io::Error::other)
            .and_then(|bytes| fs::write(&temp, bytes))
            .and_then(|()| fs::rename(&temp, &self.file));
        if let Err(err) = result {
            tracing::warn!("the library could not be saved: {err}");
        }
    }
}

/// The catalog format of a file name, minding ".tar.gz".
pub fn format_of(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    if name.ends_with(".tar.gz") {
        return Some("tar-gz".into());
    }
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    catalog::formats()
        .iter()
        .find(|format| format.extensions.contains(&extension.as_str()))
        .map(|format| format.id.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_newest_fifty_and_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("library.json");
        let library = Library::load(file.clone());
        let photo = dir.path().join("Kento ğüşıöç 🧪.jpg");
        fs::write(&photo, b"jpg").unwrap();
        for n in 0..55 {
            library.add(
                Origin::Convert,
                None,
                &[dir.path().join(format!("{n}.png"))],
            );
        }
        let added = library.add(
            Origin::Convert,
            Some(Path::new("Kento ğüşıöç 🧪.heic")),
            std::slice::from_ref(&photo),
        );
        let reloaded = Library::load(file);
        let entries = reloaded.entries();
        assert_eq!(entries.len(), 50);
        assert_eq!(entries[0].item, added[0]);
        assert_eq!(entries[0].item.format.as_deref(), Some("jpg"));
        assert!(entries[0].exists && entries[0].size == Some(3));
        assert!(!entries[1].exists, "54.png was never written");
        assert!(reloaded.remove(added[0].id));
        assert!(reloaded.get(added[0].id).is_none());
        assert!(
            photo.exists(),
            "removing from the list never deletes the file"
        );
    }

    #[test]
    fn knows_double_extensions() {
        assert_eq!(format_of(Path::new("a.tar.gz")).as_deref(), Some("tar-gz"));
        assert_eq!(format_of(Path::new("b.JPEG")).as_deref(), Some("jpg"));
        assert_eq!(format_of(Path::new("c.unknown")), None);
    }
}
