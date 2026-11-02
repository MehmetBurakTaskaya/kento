// SPDX-License-Identifier: MIT
//! Recipes in the app (SPEC 5.11): kept in `recipes.json` in the data folder as a plain JSON array
//! of recipes, the same file the command line reads; the wheel's Favorites slice offers the ones
//! that fit the dragged files, folder automation runs them, and each file is a job of its own.
//!
//! Every change reads the file again first, so a recipe the command line added while Kento was
//! running is not lost; a recipe this version cannot read (a newer kind of step) is kept as it is.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use kento_engines::compress::Compression;
use kento_engines::recipe::{self, Plan, Recipe, RecipeRun, RecipeStep};
use kento_engines::{self as engines, FileKind, Output};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::catalog::{self, Format, ToolGroup};
use crate::error::{Error, Result};
use crate::jobs::engine::{Target, Work};
use crate::jobs::naming::file_name;
use crate::jobs::Lane;
use crate::library::Origin;
use crate::work::{self, stem_of, Context};
use crate::{i18n, AppState};

/// The example recipe's id; its name comes from the locale files when it is first written.
pub const EXAMPLE_ID: &str = "ready-for-instagram";
/// The longest suffix a recipe's name gives an output's name.
const MAX_SUFFIX: usize = 48;

/// "Ready for Instagram": crop 4:5, resize to 1080 px, compress under 2 MB.
pub fn example(lang: &str) -> Recipe {
    Recipe {
        id: EXAMPLE_ID.into(),
        name: i18n::text(lang, "recipes.example.instagram"),
        steps: vec![
            RecipeStep::Crop {
                width: 4,
                height: 5,
            },
            RecipeStep::Resize { long_side: 1080 },
            RecipeStep::Compress {
                compression: Compression::Size { bytes: 2_000_000 },
            },
        ],
    }
}

/// The recipes file, written atomically.
pub struct Recipes {
    file: PathBuf,
    /// Changes from this app one at a time; the file itself is the state.
    lock: Mutex<()>,
}

/// The file's contents: the recipes this version reads, and the entries it does not, kept so that
/// saving never drops them.
#[derive(Debug, Default)]
struct Stored {
    recipes: Vec<Recipe>,
    unknown: Vec<Value>,
}

impl Recipes {
    /// Opens the recipes file. On the first start (no file) it is written with the example
    /// recipe, named in `lang`; a file that is not a JSON array is kept aside first, as
    /// recipes.invalid.json, so nothing the user wrote is lost.
    pub fn open(file: PathBuf, lang: &str) -> Self {
        let recipes = Self {
            file,
            lock: Mutex::new(()),
        };
        // Reading puts a broken file aside, so the example takes its place.
        read(&recipes.file);
        if !recipes.file.exists() {
            let stored = Stored {
                recipes: vec![example(lang)],
                unknown: Vec::new(),
            };
            if let Err(err) = write(&recipes.file, &stored) {
                tracing::warn!("the example recipe was not written: {err}");
            }
        }
        recipes
    }

    pub fn list(&self) -> Vec<Recipe> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        read(&self.file).recipes
    }

    pub fn get(&self, id: &str) -> Option<Recipe> {
        self.list().into_iter().find(|recipe| recipe.id == id)
    }

    fn change(&self, edit: impl FnOnce(&mut Vec<Recipe>) -> Result<()>) -> Result<Vec<Recipe>> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut stored = read(&self.file);
        edit(&mut stored.recipes)?;
        write(&self.file, &stored)?;
        Ok(stored.recipes)
    }

    /// Adds a recipe (an empty or unknown id gets a new one) or replaces the one with its id.
    pub fn save(&self, mut recipe: Recipe) -> Result<Vec<Recipe>> {
        recipe.name = recipe.name.trim().to_owned();
        recipe::check(&recipe).map_err(|err| Error::Invalid(err.to_string()))?;
        self.change(|recipes| {
            match recipes.iter_mut().find(|known| known.id == recipe.id) {
                Some(known) if !recipe.id.is_empty() => *known = recipe,
                _ => {
                    recipe.id = new_id(recipes);
                    recipes.push(recipe);
                }
            }
            Ok(())
        })
    }

    pub fn delete(&self, id: &str) -> Result<Vec<Recipe>> {
        self.change(|recipes| {
            recipes.retain(|recipe| recipe.id != id);
            Ok(())
        })
    }

    /// Puts the recipes in the order of `ids`; any not named keep their order after them.
    pub fn reorder(&self, ids: &[String]) -> Result<Vec<Recipe>> {
        self.change(|recipes| {
            let rank = |recipe: &Recipe| {
                ids.iter()
                    .position(|id| *id == recipe.id)
                    .unwrap_or(ids.len())
            };
            recipes.sort_by_key(rank);
            Ok(())
        })
    }
}

/// Reads the recipes; a missing file holds none.
fn read(file: &Path) -> Stored {
    let Ok(text) = fs::read_to_string(file) else {
        return Stored::default();
    };
    let entries = match serde_json::from_str::<Vec<Value>>(&text) {
        Ok(entries) => entries,
        Err(err) => {
            tracing::warn!("the recipes file is unreadable ({err}); it is kept aside");
            let _ = fs::rename(file, file.with_file_name("recipes.invalid.json"));
            return Stored::default();
        }
    };
    let mut stored = Stored::default();
    for entry in entries {
        match serde_json::from_value::<Recipe>(entry.clone()) {
            Ok(recipe) => stored.recipes.push(recipe),
            Err(err) => {
                tracing::warn!("a recipe this version cannot read is kept as it is: {err}");
                stored.unknown.push(entry);
            }
        }
    }
    stored
}

/// Writes the recipes through a temporary file, so a crash never leaves half a file.
fn write(file: &Path, stored: &Stored) -> Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut entries = stored
        .recipes
        .iter()
        .map(serde_json::to_value)
        .collect::<serde_json::Result<Vec<Value>>>()?;
    entries.extend(stored.unknown.iter().cloned());
    let temp = file.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(&entries)?)?;
    fs::rename(&temp, file)?;
    Ok(())
}

/// A short id no recipe has yet.
fn new_id(recipes: &[Recipe]) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    loop {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or_default();
        let id = format!(
            "r{now:x}{:x}",
            COUNTER.fetch_add(1, Ordering::Relaxed) % 0x1000
        );
        if !recipes.iter().any(|recipe| recipe.id == id) {
            return id;
        }
    }
}

/// The plan for a file of format `from`, when every step fits it and every conversion on the
/// way is one this version offers.
pub fn plan_for(recipe: &Recipe, from: &str) -> Option<Plan> {
    let plan = recipe::plan(recipe, from).ok()?;
    let offered = recipe.steps.iter().enumerate().all(|(index, step)| {
        let from = &plan.formats[index];
        match step {
            RecipeStep::Convert { to } => from == to || work::usable(from, to),
            _ => true,
        }
    });
    offered.then_some(plan)
}

/// The tool group a plan still needs on this computer: a conversion's own, or the Media tools to
/// compress video and audio.
fn needs(state: &AppState, recipe: &Recipe, plan: &Plan) -> Option<ToolGroup> {
    recipe.steps.iter().enumerate().find_map(|(index, step)| {
        let from = plan.formats[index].as_str();
        let group = match step {
            RecipeStep::Convert { to } if from != to => catalog::routes()
                .iter()
                .find(|route| route.from == from && route.to == to)
                .map(|route| route.group)?,
            RecipeStep::Compress { .. } => match engines::compress::kind(from) {
                Some(FileKind::Video | FileKind::Audio) => ToolGroup::Media,
                _ => return None,
            },
            _ => return None,
        };
        work::missing(state, group)
    })
}

/// The format Kento reads a file as.
fn format_of(path: &Path) -> Option<&'static Format> {
    work::entry(path)
        .filter(|entry| !entry.folder)
        .and_then(|entry| entry.format)
        .and_then(|id| catalog::format(&id))
}

/// A recipe on the wheel's Favorites ring.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeEntry {
    #[serde(flatten)]
    pub recipe: Recipe,
    /// The tool group to install first, when it is missing (shown dimmed, like other slices).
    pub needs: Option<ToolGroup>,
}

#[tauri::command]
pub fn recipes_list(recipes: State<'_, Recipes>) -> Vec<Recipe> {
    recipes.list()
}

#[tauri::command]
pub fn recipes_save(
    app: AppHandle,
    recipes: State<'_, Recipes>,
    recipe: Recipe,
) -> Result<Vec<Recipe>> {
    let saved = recipes.save(recipe)?;
    let _ = app.emit("recipes", ());
    Ok(saved)
}

#[tauri::command]
pub fn recipes_delete(
    app: AppHandle,
    recipes: State<'_, Recipes>,
    id: String,
) -> Result<Vec<Recipe>> {
    let saved = recipes.delete(&id)?;
    let _ = app.emit("recipes", ());
    Ok(saved)
}

#[tauri::command]
pub fn recipes_reorder(
    app: AppHandle,
    recipes: State<'_, Recipes>,
    ids: Vec<String>,
) -> Result<Vec<Recipe>> {
    let saved = recipes.reorder(&ids)?;
    let _ = app.emit("recipes", ());
    Ok(saved)
}

/// The recipes that fit every one of the files, in the user's order (the Favorites ring).
#[tauri::command]
pub fn recipes_for(
    state: State<'_, AppState>,
    recipes: State<'_, Recipes>,
    paths: Vec<PathBuf>,
) -> Vec<RecipeEntry> {
    let formats: Option<Vec<&'static Format>> = paths.iter().map(|path| format_of(path)).collect();
    let Some(formats) = formats.filter(|formats| !formats.is_empty()) else {
        return Vec::new();
    };
    recipes
        .list()
        .into_iter()
        .filter_map(|recipe| {
            let plans: Option<Vec<Plan>> = formats
                .iter()
                .map(|format| plan_for(&recipe, format.id))
                .collect();
            let needs = plans?.iter().find_map(|plan| needs(&state, &recipe, plan));
            Some(RecipeEntry { recipe, needs })
        })
        .collect()
}

/// Runs a recipe on each file, one job per file, and returns the job ids.
#[tauri::command]
pub fn run_recipe(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    recipes: State<'_, Recipes>,
    id: String,
    paths: Vec<PathBuf>,
) -> Result<Vec<u64>> {
    let recipe = recipes
        .get(&id)
        .ok_or_else(|| Error::Invalid(i18n::text(&state.lang(), "recipes.gone")))?;
    if paths.is_empty() {
        return Err(Error::Invalid("no files".into()));
    }
    let files = paths
        .into_iter()
        .map(|path| {
            let format = format_of(&path)
                .ok_or_else(|| Error::Invalid("not a file Kento can read".into()))?;
            let plan = plan_for(&recipe, format.id).ok_or_else(|| {
                Error::Invalid(format!("{} does not fit {}", recipe.name, format.id))
            })?;
            Ok((path, format, plan))
        })
        .collect::<Result<Vec<_>>>()?;
    let ctx = Context::new(&app, &state)?;
    let ids: Vec<u64> = files
        .into_iter()
        .map(|(path, format, plan)| submit(&ctx, &recipe, path, format, plan))
        .collect();
    crate::actions::watch(&window, &state, &ids);
    Ok(ids)
}

/// The recipe's name as a file name suffix ("photo - Ready for Instagram.jpg"): characters file
/// systems refuse become spaces, and a long name is shortened.
fn suffix(name: &str) -> Option<String> {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let short: String = joined.chars().take(MAX_SUFFIX).collect();
    let trimmed = short.trim_matches(|c: char| c == '.' || c.is_whitespace());
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// The result keeps the original's own extension when it keeps its format (`.jpeg` stays
/// `.jpeg`); otherwise it takes the format's usual one.
fn extension(source: &Path, from: &Format, result: &str) -> String {
    let own = source
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase());
    match own {
        Some(own) if result == from.id => own,
        _ => catalog::format(result)
            .map(|format| format.extensions[0].to_owned())
            .unwrap_or_else(|| result.to_owned()),
    }
}

/// One job: the recipe on one file, named "photo - <recipe>.ext" (SPEC 5.14), or a folder of that
/// name when a step writes several files.
pub(crate) fn submit(
    ctx: &Context,
    recipe: &Recipe,
    source: PathBuf,
    from: &'static Format,
    plan: Plan,
) -> u64 {
    let suffix = suffix(&recipe.name).unwrap_or_else(|| ctx.text("suffix.recipe"));
    let name = file_name(&stem_of(&source), Some(&suffix), "");
    let dir = ctx.dir_for(&source);
    let target = match plan.output {
        Output::Folder => Target::Folder { dir, name },
        Output::File => Target::File {
            dir,
            stem: name,
            extension: extension(&source, from, plan.result()),
        },
    };
    let heavy = recipe.steps.iter().enumerate().any(|(index, step)| {
        matches!(step, RecipeStep::Convert { to } if engines::heavy(&plan.formats[index], to))
    });
    let title = format!(
        "{} · {}",
        recipe.name,
        source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    let options = ctx.options();
    let recipe = recipe.clone();
    let input = source.clone();
    let output = plan.output;
    let work: Work = Box::new(move |dest, temp, progress| {
        let steps = temp.join("steps");
        let run = |dest: &Path| {
            recipe::run(&RecipeRun {
                recipe: &recipe,
                input: &input,
                from: from.id,
                dest,
                temp: &steps,
                options: &options,
                progress,
            })
        };
        match output {
            Output::Folder => run(dest).map(|_| ()),
            Output::File => {
                let result = temp.join("result");
                fs::create_dir_all(&result)?;
                recipe::into_file(run(&result)?, dest)
            }
        }
    });
    let lane = if heavy { Lane::Heavy } else { Lane::Light };
    ctx.enqueue(lane, title, target, work, Origin::Tool, Some(source), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Recipes) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Kento ğüş 🧪").join("recipes.json");
        let recipes = Recipes::open(file, "tr");
        (dir, recipes)
    }

    fn resize(name: &str, long_side: u32) -> Recipe {
        Recipe {
            id: String::new(),
            name: name.into(),
            steps: vec![RecipeStep::Resize { long_side }],
        }
    }

    #[test]
    fn the_first_start_writes_the_example_in_the_interface_language() {
        let (_dir, recipes) = store();
        let list = recipes.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, EXAMPLE_ID);
        assert_eq!(list[0].name, i18n::text("tr", "recipes.example.instagram"));
        assert_ne!(list[0].name, i18n::text("en", "recipes.example.instagram"));
        // The file is a plain array of recipes, as the command line reads it.
        let json = fs::read_to_string(&recipes.file).unwrap();
        let plain: Vec<Recipe> = serde_json::from_str(&json).unwrap();
        assert_eq!(plain, list);
        assert!(json.contains(r#""kind": "crop""#), "{json}");
        // Deleting the example does not bring it back.
        recipes.delete(EXAMPLE_ID).unwrap();
        let reopened = Recipes::open(recipes.file.clone(), "en");
        assert!(reopened.list().is_empty());
    }

    #[test]
    fn saving_adds_replaces_reorders_and_deletes() {
        let (_dir, recipes) = store();
        let list = recipes.save(resize("  Küçült 🐜 ", 640)).unwrap();
        assert_eq!(list.len(), 2);
        let added = list[1].clone();
        assert_eq!(added.name, "Küçült 🐜");
        assert!(!added.id.is_empty() && added.id != EXAMPLE_ID);
        let list = recipes
            .save(Recipe {
                name: "Küçült 🐜 daha".into(),
                ..added.clone()
            })
            .unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].name, "Küçült 🐜 daha");
        let list = recipes.reorder(std::slice::from_ref(&added.id)).unwrap();
        assert_eq!(list[0].id, added.id);
        assert_eq!(list[1].id, EXAMPLE_ID);
        let list = recipes.delete(&added.id).unwrap();
        assert_eq!(list.len(), 1);
        assert!(recipes.save(resize("", 640)).is_err());
        assert!(recipes.save(resize("Sıfır", 0)).is_err());
        assert_eq!(recipes.list().len(), 1);
    }

    #[test]
    fn a_broken_file_is_kept_aside_and_unknown_recipes_survive_saving() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("recipes.json");
        fs::write(&file, "{ not an array").unwrap();
        let recipes = Recipes::open(file.clone(), "en");
        assert!(dir.path().join("recipes.invalid.json").exists());
        assert_eq!(recipes.list().len(), 1, "the example comes back");

        // A recipe from a newer version (a step this one does not know) stays in the file.
        let newer = r#"[{"id":"yeni","name":"Yeni 🚀","steps":[{"kind":"sharpen","amount":3}]}]"#;
        fs::write(&file, newer).unwrap();
        assert!(recipes.list().is_empty());
        recipes.save(resize("Eski", 100)).unwrap();
        let json = fs::read_to_string(&file).unwrap();
        assert!(json.contains("sharpen") && json.contains("Eski"), "{json}");
    }

    #[test]
    fn changes_by_the_command_line_are_not_lost() {
        let (_dir, recipes) = store();
        let mut on_disk = recipes.list();
        on_disk.push(Recipe {
            id: "cli".into(),
            ..resize("Komut satırından", 300)
        });
        fs::write(&recipes.file, serde_json::to_vec(&on_disk).unwrap()).unwrap();
        let list = recipes.save(resize("Uygulamadan", 200)).unwrap();
        let ids: Vec<&str> = list.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids.len(), 3);
        assert!(ids.contains(&"cli"));
    }

    #[test]
    fn plans_fit_pictures_and_refuse_other_files() {
        let recipe = example("en");
        assert_eq!(plan_for(&recipe, "jpg").unwrap().result(), "jpg");
        assert_eq!(plan_for(&recipe, "png").unwrap().result(), "png");
        assert!(plan_for(&recipe, "mp4").is_none());
        assert!(plan_for(&recipe, "pdf").is_none());
        let webp = Recipe {
            steps: vec![RecipeStep::Convert { to: "webp".into() }],
            ..recipe
        };
        assert!(plan_for(&webp, "png").is_some());
        assert!(plan_for(&webp, "webp").is_some(), "already WEBP: kept");
        assert!(plan_for(&webp, "docx").is_none());
    }

    #[test]
    fn names_become_safe_suffixes() {
        assert_eq!(
            suffix("Instagram için hazır").as_deref(),
            Some("Instagram için hazır")
        );
        assert_eq!(suffix("a/b:c*d?").as_deref(), Some("a b c d"));
        assert_eq!(suffix("  ...  ").as_deref(), None);
        assert_eq!(suffix(&"ğ".repeat(90)).unwrap().chars().count(), MAX_SUFFIX);
        let jpg = catalog::format("jpg").unwrap();
        assert_eq!(extension(Path::new("a.JPEG"), jpg, "jpg"), "jpeg");
        assert_eq!(extension(Path::new("a.jpeg"), jpg, "webp"), "webp");
        let tiff = catalog::format("tiff").unwrap();
        assert_eq!(extension(Path::new("tarama.TIF"), tiff, "tiff"), "tif");
        let png = catalog::format("png").unwrap();
        assert_eq!(extension(Path::new("a.png"), png, "tiff"), "tif");
    }
}
