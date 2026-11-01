// SPDX-License-Identifier: MIT
//! Kento's own shelf (SPEC 5.8): files on their way somewhere. It keeps references to files,
//! never copies, and notices files that were moved or deleted.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub id: u64,
    pub path: PathBuf,
    /// False once the file was moved or deleted.
    pub present: bool,
}

#[derive(Default)]
pub struct Shelf {
    items: Mutex<Vec<(u64, PathBuf)>>,
    next: AtomicU64,
}

impl Shelf {
    /// Adds files that are not on the shelf yet.
    pub fn add(&self, paths: &[PathBuf]) {
        let mut items = self.items.lock().unwrap_or_else(|p| p.into_inner());
        for path in paths {
            if items.iter().any(|(_, existing)| existing == path) {
                continue;
            }
            let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
            items.push((id, path.clone()));
        }
    }

    pub fn items(&self) -> Vec<ShelfItem> {
        let items = self.items.lock().unwrap_or_else(|p| p.into_inner());
        items
            .iter()
            .map(|(id, path)| ShelfItem {
                id: *id,
                path: path.clone(),
                present: path.exists(),
            })
            .collect()
    }

    pub fn remove(&self, id: u64) {
        self.items
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .retain(|(item, _)| *item != id);
    }

    pub fn clear(&self) {
        self.items.lock().unwrap_or_else(|p| p.into_inner()).clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shelf_keeps_references_and_notices_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("fatura.pdf");
        std::fs::write(&file, b"%PDF").unwrap();
        let shelf = Shelf::default();
        shelf.add(&[file.clone(), file.clone(), dir.path().join("gone.txt")]);
        let items = shelf.items();
        assert_eq!(items.len(), 2);
        assert!(items[0].present && !items[1].present);
        shelf.remove(items[1].id);
        assert_eq!(shelf.items().len(), 1);
        std::fs::remove_file(&file).unwrap();
        assert!(!shelf.items()[0].present);
        shelf.clear();
        assert!(shelf.items().is_empty());
    }
}
