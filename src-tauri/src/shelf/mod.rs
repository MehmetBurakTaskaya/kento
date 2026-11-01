// SPDX-License-Identifier: MIT
//! The shelf behind one interface (SPEC 5.8). Kento's own shelf and the bridge to Pano both
//! implement `ShelfProvider`, so whichever model Phase 3 settles on, the rest of the app
//! stays the same. The shelf keeps references to files, never copies.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;

use crate::settings::ShelfModel;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub id: u64,
    pub path: PathBuf,
    /// False once the file was moved or deleted.
    pub present: bool,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ShelfError {
    #[error("the shelf is not available")]
    Unavailable,
}

pub trait ShelfProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn is_available(&self) -> bool;
    fn add(&self, paths: &[PathBuf]) -> Result<(), ShelfError>;
    fn items(&self) -> Vec<ShelfItem>;
    fn remove(&self, id: u64);
    fn clear(&self);
}

/// Kento's own shelf. Its window arrives in Phase 3; the list and its rules exist now.
#[derive(Default)]
pub struct LocalShelf {
    items: Mutex<Vec<(u64, PathBuf)>>,
    next: AtomicU64,
}

impl ShelfProvider for LocalShelf {
    fn id(&self) -> &'static str {
        "local"
    }

    fn is_available(&self) -> bool {
        true
    }

    fn add(&self, paths: &[PathBuf]) -> Result<(), ShelfError> {
        let mut items = self.items.lock().unwrap_or_else(|p| p.into_inner());
        for path in paths {
            if items.iter().any(|(_, existing)| existing == path) {
                continue;
            }
            let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
            items.push((id, path.clone()));
        }
        Ok(())
    }

    fn items(&self) -> Vec<ShelfItem> {
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

    fn remove(&self, id: u64) {
        self.items
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .retain(|(item, _)| *item != id);
    }

    fn clear(&self) {
        self.items.lock().unwrap_or_else(|p| p.into_inner()).clear();
    }
}

/// Hands files to Pano. How Kento finds Pano and talks to it is written down in
/// docs/integrations/pano.md in Phase 3; until then Pano counts as not installed.
#[derive(Default)]
pub struct PanoBridge;

impl ShelfProvider for PanoBridge {
    fn id(&self) -> &'static str {
        "pano"
    }

    fn is_available(&self) -> bool {
        false
    }

    fn add(&self, _paths: &[PathBuf]) -> Result<(), ShelfError> {
        Err(ShelfError::Unavailable)
    }

    fn items(&self) -> Vec<ShelfItem> {
        Vec::new()
    }

    fn remove(&self, _id: u64) {}

    fn clear(&self) {}
}

/// The provider behind "Put on shelf" for a model, given whether Pano is installed.
pub fn select(model: ShelfModel, pano_installed: bool) -> Box<dyn ShelfProvider> {
    match model {
        ShelfModel::PanoOnly => Box::new(PanoBridge),
        ShelfModel::PanoFirst if pano_installed => Box::new(PanoBridge),
        ShelfModel::PanoFirst | ShelfModel::LocalPlusPano | ShelfModel::LocalOnly => {
            Box::<LocalShelf>::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_model_picks_the_provider() {
        assert_eq!(select(ShelfModel::LocalOnly, true).id(), "local");
        assert_eq!(select(ShelfModel::LocalPlusPano, true).id(), "local");
        assert_eq!(select(ShelfModel::PanoFirst, true).id(), "pano");
        assert_eq!(select(ShelfModel::PanoFirst, false).id(), "local");
        assert_eq!(select(ShelfModel::PanoOnly, false).id(), "pano");
    }

    #[test]
    fn the_local_shelf_keeps_references_and_notices_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("fatura.pdf");
        std::fs::write(&file, b"%PDF").unwrap();
        let shelf = LocalShelf::default();
        shelf
            .add(&[file.clone(), file.clone(), dir.path().join("gone.txt")])
            .unwrap();
        let items = shelf.items();
        assert_eq!(items.len(), 2);
        assert!(items[0].present && !items[1].present);
        shelf.remove(items[1].id);
        assert_eq!(shelf.items().len(), 1);
        std::fs::remove_file(&file).unwrap();
        assert!(!shelf.items()[0].present);
        shelf.clear();
        assert!(shelf.items().is_empty());
        assert_eq!(PanoBridge.add(&[file]), Err(ShelfError::Unavailable));
    }
}
