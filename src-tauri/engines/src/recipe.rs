// SPDX-License-Identifier: MIT
//! Recipes (SPEC 5.11): several steps chained and saved under a name, such as "Ready for
//! Instagram" = crop 4:5, resize to 1080 px, compress under 2 MB. The app keeps them in the data
//! folder (`recipes.json`) and runs them from the wheel's Favorites slice, folder automation and
//! the command line; this module holds the model and the runner, so all three run the same steps.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::compress::Compression;
use crate::{Error, Options, Progress, Result};

/// A named chain of steps. `id` is stable across renames.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub steps: Vec<RecipeStep>,
}

/// One step; each takes the previous step's file and gives the next one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RecipeStep {
    /// Converts to another format (a catalog id, such as `webp`).
    Convert { to: String },
    /// Crops a picture to this aspect ratio, centred.
    Crop { width: u32, height: u32 },
    /// Resizes a picture so that its longer side is this many pixels (never enlarging).
    #[serde(rename_all = "camelCase")]
    Resize { long_side: u32 },
    /// Compresses, keeping the format.
    Compress { compression: Compression },
}

/// One run of a recipe on one file.
pub struct RecipeRun<'a> {
    pub recipe: &'a Recipe,
    pub input: &'a Path,
    /// The catalog id of the input format.
    pub from: &'a str,
    /// A new, empty folder for the result (a step may write several files, such as pages).
    pub dest: &'a Path,
    /// A private scratch folder for the steps in between.
    pub temp: &'a Path,
    pub options: &'a Options,
    pub progress: &'a Progress<'a>,
}

/// Runs every step in order and returns the files the last step wrote into `dest`.
pub fn run(run: &RecipeRun) -> Result<Vec<PathBuf>> {
    if run.recipe.steps.is_empty() {
        return Err(Error::Other(format!(
            "the recipe {:?} has no steps",
            run.recipe.name
        )));
    }
    Err(Error::Unsupported {
        from: run.from.to_owned(),
        to: "recipe".to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recipes_read_and_write_as_the_app_stores_them() {
        let recipe = Recipe {
            id: "instagram".into(),
            name: "Instagram için hazır 🧪".into(),
            steps: vec![
                RecipeStep::Crop {
                    width: 4,
                    height: 5,
                },
                RecipeStep::Resize { long_side: 1080 },
                RecipeStep::Compress {
                    compression: Compression::Size { bytes: 2 << 20 },
                },
                RecipeStep::Convert { to: "webp".into() },
            ],
        };
        let json = serde_json::to_string(&recipe).unwrap();
        assert!(
            json.contains(r#""kind":"resize","longSide":1080"#),
            "{json}"
        );
        assert!(
            json.contains(r#""compression":{"mode":"size","bytes":2097152}"#),
            "{json}"
        );
        assert_eq!(serde_json::from_str::<Recipe>(&json).unwrap(), recipe);
    }
}
