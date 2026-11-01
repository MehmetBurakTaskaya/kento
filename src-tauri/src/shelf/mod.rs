// SPDX-License-Identifier: MIT
//! Kento's own shelf (SPEC 5.8): files on their way somewhere. It keeps references to files,
//! notices files that were moved or deleted, and remembers what left it, so the history can be
//! searched. With "keep a copy" on, a shelved file is copied into Kento's data folder first and
//! the shelf points at the copy. It lives in shelf.json.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// How many removed items the history keeps.
const HISTORY: usize = 50;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: u64,
    path: PathBuf,
    /// Unix time in milliseconds.
    added: u64,
    /// The path is Kento's own copy, under the shelf's copies folder.
    copy: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Stored {
    items: Vec<Entry>,
    history: Vec<Entry>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub id: u64,
    pub path: PathBuf,
    pub name: String,
    pub added: u64,
    pub copy: bool,
    /// False once the file was moved or deleted.
    pub present: bool,
    pub category: Option<crate::catalog::Category>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfView {
    pub items: Vec<ShelfItem>,
    pub history: Vec<ShelfItem>,
}

pub struct Shelf {
    file: PathBuf,
    copies: PathBuf,
    state: Mutex<Stored>,
}

impl Shelf {
    /// Reads shelf.json; a missing or broken file gives an empty shelf.
    pub fn load(file: PathBuf, copies: PathBuf) -> Self {
        let state = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok())
            .unwrap_or_default();
        Self {
            file,
            copies,
            state: Mutex::new(state),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Stored> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Adds files and folders that are not on the shelf yet and returns how many were added.
    pub fn add(&self, paths: &[PathBuf], keep_copy: bool) -> std::io::Result<usize> {
        let mut state = self.lock();
        let mut next = next_id(&state);
        let mut added = 0;
        for path in paths {
            if state.items.iter().any(|e| &e.path == path) || !path.exists() {
                continue;
            }
            next += 1;
            let (path, copy) = if keep_copy && path.is_file() {
                (self.copy_in(next, path)?, true)
            } else {
                (path.clone(), false)
            };
            state.items.push(Entry {
                id: next,
                path,
                added: now_ms(),
                copy,
            });
            added += 1;
        }
        self.save(&state);
        Ok(added)
    }

    fn copy_in(&self, id: u64, path: &Path) -> std::io::Result<PathBuf> {
        let dir = self.copies.join(id.to_string());
        fs::create_dir_all(&dir)?;
        let target = dir.join(path.file_name().unwrap_or_default());
        fs::copy(path, &target)?;
        Ok(target)
    }

    pub fn view(&self) -> ShelfView {
        let state = self.lock();
        ShelfView {
            items: state.items.iter().rev().map(item).collect(),
            history: state.history.iter().rev().map(item).collect(),
        }
    }

    pub fn path(&self, id: u64) -> Option<PathBuf> {
        let state = self.lock();
        state
            .items
            .iter()
            .chain(state.history.iter())
            .find(|e| e.id == id)
            .map(|e| e.path.clone())
    }

    /// Takes an item off the shelf into the history; the file stays where it is.
    pub fn remove(&self, id: u64) {
        let mut state = self.lock();
        if let Some(index) = state.items.iter().position(|e| e.id == id) {
            let entry = state.items.remove(index);
            self.retire(&mut state, vec![entry]);
        } else {
            state.history.retain(|e| e.id != id);
        }
        self.save(&state);
    }

    pub fn clear(&self) {
        let mut state = self.lock();
        let all = std::mem::take(&mut state.items);
        self.retire(&mut state, all);
        self.save(&state);
    }

    /// Moves entries into the history and drops the oldest, with their copies.
    fn retire(&self, state: &mut Stored, entries: Vec<Entry>) {
        state.history.extend(entries);
        let extra = state.history.len().saturating_sub(HISTORY);
        for old in state.history.drain(..extra) {
            if old.copy {
                let _ = fs::remove_dir_all(self.copies.join(old.id.to_string()));
            }
        }
    }

    fn save(&self, state: &Stored) {
        let temp = self.file.with_extension("json.tmp");
        let result = serde_json::to_vec_pretty(state)
            .map_err(std::io::Error::other)
            .and_then(|bytes| fs::write(&temp, bytes))
            .and_then(|()| fs::rename(&temp, &self.file));
        if let Err(err) = result {
            tracing::warn!("the shelf could not be saved: {err}");
        }
    }
}

fn next_id(state: &Stored) -> u64 {
    state
        .items
        .iter()
        .chain(state.history.iter())
        .map(|e| e.id)
        .max()
        .unwrap_or(0)
}

fn item(entry: &Entry) -> ShelfItem {
    ShelfItem {
        id: entry.id,
        name: entry
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: entry.path.clone(),
        added: entry.added,
        copy: entry.copy,
        present: entry.path.exists(),
        category: crate::library::format_of(&entry.path)
            .as_deref()
            .and_then(crate::catalog::format)
            .map(|format| format.category),
    }
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
    fn the_shelf_keeps_references_history_and_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("fatura ğüş 🧪.pdf");
        fs::write(&file, b"%PDF").unwrap();
        let store = dir.path().join("shelf.json");
        let copies = dir.path().join("copies");
        let shelf = Shelf::load(store.clone(), copies.clone());
        assert_eq!(
            shelf
                .add(
                    &[file.clone(), file.clone(), dir.path().join("gone.txt")],
                    false
                )
                .unwrap(),
            1
        );
        let first = shelf.view().items[0].clone();
        assert!(first.present && !first.copy && first.path == file);
        fs::remove_file(&file).unwrap();
        assert!(!shelf.view().items[0].present, "a moved file is noticed");
        shelf.remove(first.id);
        let reloaded = Shelf::load(store, copies);
        let view = reloaded.view();
        assert!(view.items.is_empty());
        assert_eq!(view.history[0].id, first.id);
        assert_eq!(reloaded.path(first.id), Some(file));
    }

    #[test]
    fn keep_a_copy_shelves_a_copy_and_its_history_ages_out() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("rapor.txt");
        fs::write(&file, b"kento").unwrap();
        let copies = dir.path().join("copies");
        let shelf = Shelf::load(dir.path().join("shelf.json"), copies.clone());
        shelf.add(std::slice::from_ref(&file), true).unwrap();
        let shelved = shelf.view().items[0].clone();
        assert!(shelved.copy && shelved.path.starts_with(&copies));
        fs::remove_file(&file).unwrap();
        assert_eq!(
            fs::read(&shelved.path).unwrap(),
            b"kento",
            "the copy outlives the original"
        );
        shelf.clear();
        for n in 0..HISTORY {
            let other = dir.path().join(format!("{n}.txt"));
            fs::write(&other, b"x").unwrap();
            shelf.add(&[other], false).unwrap();
            shelf.clear();
        }
        assert_eq!(shelf.view().history.len(), HISTORY);
        assert!(
            !shelved.path.exists(),
            "the oldest copy goes with its history entry"
        );
    }
}
