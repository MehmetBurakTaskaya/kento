// SPDX-License-Identifier: MIT
//! Recipes (SPEC 5.11): several steps chained and saved under a name, such as "Ready for
//! Instagram" = crop 4:5, resize to 1080 px, compress under 2 MB. The app keeps them in the data
//! folder (`recipes.json`) and runs them from the wheel's Favorites slice, folder automation and
//! the command line; this module holds the model and the runner, so all three run the same steps.
//!
//! Each step takes the files the step before it wrote (one file, or the pages of a conversion
//! that writes several) and writes its own into a folder of the run's scratch space; the last
//! step writes into `dest`. A step that would change nothing (a picture already at the ratio, or
//! no larger than the size asked for, or a conversion to the format it already has) hands its
//! file on as it is, so a picture is not encoded again for nothing.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::compress::{self, CompressRun, Compression};
use crate::image::tools::{self as picture, Adjust, ImageRun, ImageTool};
use crate::media::Area;
use crate::{Conversion, Error, Options, Output, Progress, Result};

/// The most steps one recipe holds.
pub const MAX_STEPS: usize = 12;
/// The longest name, in characters.
pub const MAX_NAME: usize = 80;
/// The largest number on either side of a crop's aspect ratio.
pub const MAX_RATIO: u32 = 1_000;
/// The longest side Resize asks for: the image engine's own limit.
pub const MAX_SIDE: u32 = 65_535;

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

impl RecipeStep {
    /// The step's kind as the file names it (`convert`, `crop`, `resize`, `compress`); a step
    /// that does not fit a file is refused as `Error::Unsupported` to this name.
    pub fn kind(&self) -> &'static str {
        match self {
            RecipeStep::Convert { .. } => "convert",
            RecipeStep::Crop { .. } => "crop",
            RecipeStep::Resize { .. } => "resize",
            RecipeStep::Compress { .. } => "compress",
        }
    }
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

/// What a recipe makes of a file of one format, found before anything runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    /// The format each step takes, in order, and last the format of the result: one more entry
    /// than there are steps.
    pub formats: Vec<String>,
    /// `Folder` when a step writes several files (PDF pages as pictures, slides); every later
    /// step then works on each of them.
    pub output: Output,
}

impl Plan {
    /// The catalog id of the result's format.
    pub fn result(&self) -> &str {
        self.formats.last().map(String::as_str).unwrap_or_default()
    }
}

/// Checks a recipe's own values: a name, one to `MAX_STEPS` steps and every setting in its range.
/// The app checks a recipe before saving it; `plan` and `run` check it again.
pub fn check(recipe: &Recipe) -> Result<()> {
    let refuse = |what: String| Err(Error::Other(what));
    let name = recipe.name.trim();
    if name.is_empty() {
        return refuse("the recipe has no name".into());
    }
    if name.chars().count() > MAX_NAME {
        return refuse(format!("the recipe's name is over {MAX_NAME} characters"));
    }
    if recipe.steps.is_empty() {
        return refuse(format!("the recipe {name:?} has no steps"));
    }
    if recipe.steps.len() > MAX_STEPS {
        return refuse(format!("the recipe {name:?} has over {MAX_STEPS} steps"));
    }
    for step in &recipe.steps {
        let fine = match step {
            RecipeStep::Convert { to } => {
                !to.is_empty() && to.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            }
            RecipeStep::Crop { width, height } => {
                (1..=MAX_RATIO).contains(width) && (1..=MAX_RATIO).contains(height)
            }
            RecipeStep::Resize { long_side } => (1..=MAX_SIDE).contains(long_side),
            RecipeStep::Compress { compression } => match *compression {
                Compression::Quality { level } => (1..=100).contains(&level),
                Compression::Ratio { percent } => (5..=95).contains(&percent),
                Compression::Size { bytes } => bytes > 0,
            },
        };
        if !fine {
            return refuse(format!("the step {step:?} of {name:?} is out of range"));
        }
    }
    Ok(())
}

/// What the recipe makes of a file of format `from` (a catalog id). A step that does not fit
/// the file at that point, such as Crop on a video or Compress on a BMP, is refused as
/// `Error::Unsupported { from, to }` with the format it would get and the step's kind (or, for a
/// conversion, its target).
pub fn plan(recipe: &Recipe, from: &str) -> Result<Plan> {
    check(recipe)?;
    let mut formats = vec![from.to_owned()];
    let mut output = Output::File;
    for step in &recipe.steps {
        let current = formats.last().cloned().unwrap_or_default();
        let unsupported = |to: &str| Error::Unsupported {
            from: current.clone(),
            to: to.to_owned(),
        };
        let next = match step {
            RecipeStep::Convert { to } if *to == current => current.clone(),
            RecipeStep::Convert { to } => {
                if crate::output(&current, to).ok_or_else(|| unsupported(to))? == Output::Folder {
                    output = Output::Folder;
                }
                to.clone()
            }
            RecipeStep::Crop { .. } | RecipeStep::Resize { .. } => {
                if !crate::image::reads(&current) {
                    return Err(unsupported(step.kind()));
                }
                picture_format(&current).to_owned()
            }
            RecipeStep::Compress { .. } => {
                compress::kind(&current).ok_or_else(|| unsupported(step.kind()))?;
                current.clone()
            }
        };
        formats.push(next);
    }
    Ok(Plan { formats, output })
}

/// Runs every step in order and returns the files the last step wrote into `dest`. Nothing runs
/// when a step does not fit the file (see `plan`).
pub fn run(run: &RecipeRun) -> Result<Vec<PathBuf>> {
    let plan = plan(run.recipe, run.from)?;
    let steps = &run.recipe.steps;
    let parent = run.progress;
    let mut files = vec![run.input.to_path_buf()];
    for (index, step) in steps.iter().enumerate() {
        parent.check()?;
        let last = index + 1 == steps.len();
        let out = if last {
            run.dest.to_path_buf()
        } else {
            run.temp.join(format!("step {}", index + 1))
        };
        fs::create_dir_all(&out)?;
        let count = files.len();
        let mut next = Vec::with_capacity(count);
        for (n, file) in files.iter().enumerate() {
            // Each step has an equal share of the bar, split among its files.
            let share = 1.0 / (steps.len() * count) as f32;
            let start = (index * count + n) as f32 * share;
            let report = move |fraction: Option<f32>| {
                if let Some(fraction) = fraction {
                    parent.report(start + fraction.clamp(0.0, 1.0) * share);
                }
            };
            let cancelled = || parent.is_cancelled();
            let progress = Progress::new(&report, &cancelled);
            let temp = run.temp.join(format!("work {}-{}", index + 1, n + 1));
            fs::create_dir_all(&temp)?;
            let work = Step {
                input: file,
                from: &plan.formats[index],
                to: &plan.formats[index + 1],
                out: &out,
                last,
                temp: &temp,
                options: run.options,
                progress: &progress,
            };
            next.extend(work.apply(step)?);
        }
        files = next;
    }
    parent.check()?;
    parent.report(1.0);
    Ok(files)
}

/// Moves the one file a run wrote (a plan whose output is `Output::File`) to `file`, which may be
/// on another volume than the scratch folder.
pub fn into_file(files: Vec<PathBuf>, file: &Path) -> Result<()> {
    let [only] = <[PathBuf; 1]>::try_from(files).map_err(|files| {
        Error::Other(format!("the recipe wrote {} files, not one", files.len()))
    })?;
    move_file(&only, file)
}

/// One step on one file.
struct Step<'a> {
    input: &'a Path,
    /// The format of `input`, and the format the step gives (from the plan).
    from: &'a str,
    to: &'a str,
    /// Where the step's files go: the next step's folder, or the run's `dest`.
    out: &'a Path,
    last: bool,
    /// The step's own scratch folder.
    temp: &'a Path,
    options: &'a Options,
    progress: &'a Progress<'a>,
}

impl Step<'_> {
    fn apply(&self, step: &RecipeStep) -> Result<Vec<PathBuf>> {
        match step {
            RecipeStep::Convert { .. } if self.from == self.to => self.keep(),
            RecipeStep::Convert { .. } => self.convert(),
            RecipeStep::Crop { width, height } => self.picture(|size| {
                centred(size, *width, *height).map(|area| ImageTool::CropImage { area })
            }),
            RecipeStep::Resize { long_side } => self.picture(|size| {
                smaller(size, *long_side).map(|resize| ImageTool::EditImage {
                    adjust: Adjust {
                        resize: Some(resize),
                        ..Adjust::default()
                    },
                })
            }),
            RecipeStep::Compress { compression } => self.compress(*compression),
        }
    }

    /// Hands the input on as it is: it stays where it is between steps and is copied into `dest`
    /// by the last one.
    fn keep(&self) -> Result<Vec<PathBuf>> {
        if !self.last {
            return Ok(vec![self.input.to_path_buf()]);
        }
        let dest = free_name(self.out, &stem(self.input), extension(self.from));
        fs::copy(self.input, &dest)?;
        Ok(vec![dest])
    }

    fn convert(&self) -> Result<Vec<PathBuf>> {
        let scratch = self.temp.join("scratch");
        fs::create_dir_all(&scratch)?;
        let convert = |dest: &Path| {
            crate::convert(&Conversion {
                input: self.input,
                from: self.from,
                to: self.to,
                dest,
                temp: &scratch,
                options: self.options,
                progress: self.progress,
            })
        };
        if crate::output(self.from, self.to) != Some(Output::Folder) {
            let dest = free_name(self.out, &stem(self.input), extension(self.to));
            convert(&dest)?;
            return Ok(vec![dest]);
        }
        // Pages and slides come out in a folder of their own, then join the step's other files.
        let pages = self.temp.join("pages");
        fs::create_dir_all(&pages)?;
        let mut written = convert(&pages)?;
        written.sort();
        written
            .into_iter()
            .map(|page| {
                let ext = page
                    .extension()
                    .map(|ext| ext.to_string_lossy().into_owned())
                    .unwrap_or_else(|| extension(self.to).to_owned());
                let dest = free_name(self.out, &stem(&page), &ext);
                move_file(&page, &dest)?;
                Ok(dest)
            })
            .collect()
    }

    /// Crop or Resize: `tool` gets the picture's upright size and gives the change, or None when
    /// the picture already fits.
    fn picture(&self, tool: impl FnOnce([u32; 2]) -> Option<ImageTool>) -> Result<Vec<PathBuf>> {
        let size = picture::size(self.input, self.from, self.options)?;
        let tool = match tool(size) {
            Some(tool) => tool,
            None if self.to == self.from => return self.keep(),
            // The picture fits but its format is not one the editors write (SVG, GIF): it still
            // goes through them unchanged, so the result has the format the plan said.
            None => ImageTool::EditImage {
                adjust: Adjust::default(),
            },
        };
        let dest = free_name(self.out, &stem(self.input), extension(self.to));
        picture::run_tool(&ImageRun {
            inputs: &[(self.input.to_path_buf(), self.from.to_owned())],
            tool: &tool,
            dest: &dest,
            temp: self.temp,
            options: self.options,
            progress: self.progress,
        })
    }

    fn compress(&self, compression: Compression) -> Result<Vec<PathBuf>> {
        let kind = compress::kind(self.from).ok_or_else(|| Error::Unsupported {
            from: self.from.to_owned(),
            to: "compress".to_owned(),
        })?;
        // A file already under the size asked for keeps its quality: "under 2 MB" is met.
        if let Compression::Size { bytes } = compression {
            if fs::metadata(self.input)?.len() <= bytes {
                return self.keep();
            }
        }
        let dest = free_name(self.out, &stem(self.input), extension(self.from));
        let result = compress::compress(&CompressRun {
            input: self.input,
            from: self.from,
            kind,
            compression,
            dest: &dest,
            temp: self.temp,
            options: self.options,
            progress: self.progress,
        });
        match result {
            // A quality level is a wish, not a limit: a file that cannot get smaller goes on.
            Err(Error::NotSmaller) if matches!(compression, Compression::Quality { .. }) => {
                let _ = fs::remove_file(&dest);
                self.keep()
            }
            other => other,
        }
    }
}

/// The format the image editors write for a picture of this format (SVG and GIF become PNG).
fn picture_format(from: &str) -> &'static str {
    ImageTool::EditImage {
        adjust: Adjust::default(),
    }
    .extension(from)
}

/// The largest centred area of `width`:`height` in a picture of `size`, or None when the picture
/// already has that ratio.
fn centred([w, h]: [u32; 2], width: u32, height: u32) -> Option<Area> {
    let (w64, h64) = (u64::from(w), u64::from(h));
    let (crop_w, crop_h) = if w64 * u64::from(height) > h64 * u64::from(width) {
        // Wider than the ratio: the full height, a narrower width.
        let cw = (h64 * u64::from(width)) as f64 / f64::from(height);
        ((cw.round() as u32).clamp(1, w), h)
    } else {
        let ch = (w64 * u64::from(height)) as f64 / f64::from(width);
        (w, (ch.round() as u32).clamp(1, h))
    };
    if (crop_w, crop_h) == (w, h) {
        return None;
    }
    Some(Area {
        x: f64::from((w - crop_w) / 2),
        y: f64::from((h - crop_h) / 2),
        width: f64::from(crop_w),
        height: f64::from(crop_h),
    })
}

/// The size with the longer side at `long_side`, aspect kept, or None when the picture is no
/// larger than that already (a recipe never enlarges).
fn smaller([w, h]: [u32; 2], long_side: u32) -> Option<[u32; 2]> {
    let longer = w.max(h);
    if longer <= long_side {
        return None;
    }
    let scale = f64::from(long_side) / f64::from(longer);
    let side = |length: u32| ((f64::from(length) * scale).round() as u32).max(1);
    Some(if w >= h {
        [long_side, side(h)]
    } else {
        [side(w), long_side]
    })
}

/// The extension Kento writes for a format id: the id itself, but for TAR.GZ.
fn extension(format: &str) -> &str {
    match format {
        "tar-gz" => "tar.gz",
        other => other,
    }
}

/// "photo.heic" → "photo"; "backup.tar.gz" → "backup".
fn stem(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let lower = name.to_lowercase();
    let cut = [".tar.gz", ".tgz"]
        .iter()
        .find_map(|ext| lower.ends_with(ext).then(|| name.len() - ext.len()))
        .or_else(|| name.rfind('.').filter(|&at| at > 0));
    match cut {
        Some(at) => name[..at].to_owned(),
        None => name,
    }
}

/// The first name in `dir` that is free: "photo.jpg", then "photo (2).jpg".
fn free_name(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let name = |n: u32| {
        let stem = if n == 1 {
            stem.to_owned()
        } else {
            format!("{stem} ({n})")
        };
        if extension.is_empty() {
            stem
        } else {
            format!("{stem}.{extension}")
        }
    };
    (1..)
        .map(|n| dir.join(name(n)))
        .find(|path| !path.exists())
        .unwrap_or_else(|| dir.join(name(1)))
}

/// A rename, or a copy and delete across volumes.
fn move_file(from: &Path, to: &Path) -> Result<()> {
    if fs::rename(from, to).is_err() {
        fs::copy(from, to)?;
        fs::remove_file(from)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    use ::image::{DynamicImage, GenericImageView, ImageFormat, Rgb, RgbImage};

    use super::*;

    /// A temporary folder named with Turkish letters and an emoji.
    struct Bench {
        _root: tempfile::TempDir,
        folder: PathBuf,
        dest: PathBuf,
        temp: PathBuf,
    }

    impl Bench {
        fn new() -> Self {
            let root = tempfile::tempdir().unwrap();
            let folder = root.path().join("Tarifler ğüşıöç İ 🧪");
            let dest = folder.join("sonuç 📦");
            let temp = root.path().join("geçici ✂️");
            for dir in [&folder, &dest, &temp] {
                fs::create_dir_all(dir).unwrap();
            }
            Self {
                _root: root,
                folder,
                dest,
                temp,
            }
        }

        /// A picture with a gradient and some noise, so encoders have something to keep.
        fn picture(&self, name: &str, width: u32, height: u32) -> PathBuf {
            let path = self.folder.join(name);
            let image = RgbImage::from_fn(width, height, |x, y| {
                let noise = ((x * 7919 + y * 104_729) % 37) as u8;
                Rgb([
                    (x * 255 / width) as u8,
                    (y * 255 / height) as u8,
                    noise.wrapping_mul(6),
                ])
            });
            DynamicImage::ImageRgb8(image)
                .save_with_format(&path, ImageFormat::from_path(&path).unwrap())
                .unwrap();
            path
        }

        fn run(&self, recipe: &Recipe, input: &Path, from: &str) -> Result<Vec<PathBuf>> {
            run(&RecipeRun {
                recipe,
                input,
                from,
                dest: &self.dest,
                temp: &self.temp,
                options: &Options::default(),
                progress: &Progress::none(),
            })
        }

        fn left_in_dest(&self) -> usize {
            fs::read_dir(&self.dest).unwrap().count()
        }
    }

    fn recipe(steps: Vec<RecipeStep>) -> Recipe {
        Recipe {
            id: "deneme".into(),
            name: "Deneme tarifi 🍳".into(),
            steps,
        }
    }

    fn instagram() -> Recipe {
        Recipe {
            id: "ready-for-instagram".into(),
            name: "Instagram için hazır".into(),
            steps: vec![
                RecipeStep::Crop {
                    width: 4,
                    height: 5,
                },
                RecipeStep::Resize { long_side: 200 },
                RecipeStep::Compress {
                    compression: Compression::Size { bytes: 2_000_000 },
                },
            ],
        }
    }

    fn dimensions(path: &Path) -> (u32, u32) {
        ::image::open(path).unwrap().dimensions()
    }

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

    #[test]
    fn ready_for_instagram_crops_resizes_and_keeps_a_small_file() {
        let bench = Bench::new();
        let input = bench.picture("Kapadokya balon 🎈 ğ.jpg", 400, 300);
        let files = bench.run(&instagram(), &input, "jpg").unwrap();
        assert_eq!(files.len(), 1);
        let result = &files[0];
        assert_eq!(result.parent().unwrap(), bench.dest);
        assert_eq!(
            result.file_name().unwrap().to_string_lossy(),
            "Kapadokya balon 🎈 ğ.jpg"
        );
        // 400 × 300 cropped to 4:5 is 240 × 300, then 160 × 200 on its longer side.
        assert_eq!(dimensions(result), (160, 200));
        assert_eq!(
            dimensions(&input),
            (400, 300),
            "the original is never touched"
        );
    }

    #[test]
    fn a_tall_picture_is_cropped_from_its_middle() {
        assert_eq!(
            centred([300, 600], 4, 5),
            Some(Area {
                x: 0.0,
                y: 112.0,
                width: 300.0,
                height: 375.0
            })
        );
        assert_eq!(
            centred([400, 300], 4, 5),
            Some(Area {
                x: 80.0,
                y: 0.0,
                width: 240.0,
                height: 300.0
            })
        );
        assert_eq!(centred([1080, 1350], 4, 5), None);
        assert_eq!(centred([500, 500], 1, 1), None);
        assert_eq!(smaller([4032, 3024], 1080), Some([1080, 810]));
        assert_eq!(smaller([3024, 4032], 1080), Some([810, 1080]));
        assert_eq!(smaller([1080, 1350], 1350), None);
        assert_eq!(smaller([1, 9000], 10), Some([1, 10]));
    }

    #[test]
    fn steps_chain_through_conversions_and_picture_tools() {
        let bench = Bench::new();
        let input = bench.picture("Ekran görüntüsü İ 🖼️.png", 120, 80);
        let chain = recipe(vec![
            RecipeStep::Convert { to: "webp".into() },
            RecipeStep::Crop {
                width: 1,
                height: 1,
            },
            RecipeStep::Convert { to: "jpg".into() },
        ]);
        let plan = plan(&chain, "png").unwrap();
        assert_eq!(plan.formats, ["png", "webp", "webp", "jpg"]);
        assert_eq!((plan.result(), plan.output), ("jpg", Output::File));
        let files = bench.run(&chain, &input, "png").unwrap();
        assert_eq!(
            files[0].file_name().unwrap().to_string_lossy(),
            "Ekran görüntüsü İ 🖼️.jpg"
        );
        assert_eq!(&fs::read(&files[0]).unwrap()[..3], &[0xFF, 0xD8, 0xFF]);
        assert_eq!(dimensions(&files[0]), (80, 80));
        assert_eq!(bench.left_in_dest(), 1, "steps in between stay in temp");
    }

    #[test]
    fn a_step_that_changes_nothing_hands_the_file_on_untouched() {
        let bench = Bench::new();
        let input = bench.picture("küçük ş.png", 64, 48);
        let chain = recipe(vec![
            RecipeStep::Convert { to: "png".into() },
            RecipeStep::Resize { long_side: 1080 },
            RecipeStep::Crop {
                width: 4,
                height: 3,
            },
        ]);
        let files = bench.run(&chain, &input, "png").unwrap();
        assert_eq!(fs::read(&files[0]).unwrap(), fs::read(&input).unwrap());
        assert!(input.exists(), "the original is never touched");
    }

    #[test]
    fn pictures_the_editors_do_not_write_take_the_format_the_plan_says() {
        let bench = Bench::new();
        let input = bench.folder.join("çizim 🎨.svg");
        fs::write(
            &input,
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#2a4ea6"/></svg>"##,
        )
        .unwrap();
        let chain = recipe(vec![RecipeStep::Resize { long_side: 100 }]);
        assert_eq!(plan(&chain, "svg").unwrap().result(), "png");
        let files = bench.run(&chain, &input, "svg").unwrap();
        assert_eq!(
            files[0].file_name().unwrap().to_string_lossy(),
            "çizim 🎨.png"
        );
        assert_eq!(dimensions(&files[0]), (40, 20));
    }

    #[test]
    fn compress_makes_a_file_smaller_or_says_why_not() {
        let bench = Bench::new();
        let input = bench.picture("büyük foto ı.jpg", 256, 256);
        let original = fs::metadata(&input).unwrap().len();
        let quality = recipe(vec![RecipeStep::Compress {
            compression: Compression::Quality { level: 40 },
        }]);
        let files = bench.run(&quality, &input, "jpg").unwrap();
        assert!(fs::metadata(&files[0]).unwrap().len() < original);

        // Under a size the file cannot reach: the recipe fails and leaves nothing behind.
        let bench = Bench::new();
        let input = bench.picture("büyük foto ı.png", 256, 256);
        let tiny = recipe(vec![RecipeStep::Compress {
            compression: Compression::Size { bytes: 10 },
        }]);
        assert!(matches!(
            bench.run(&tiny, &input, "png"),
            Err(Error::NotSmaller)
        ));
        assert_eq!(bench.left_in_dest(), 0);
    }

    #[test]
    fn steps_that_do_not_fit_are_refused_before_anything_runs() {
        let bench = Bench::new();
        let refused = |chain: Recipe, from: &str| match plan(&chain, from) {
            Err(Error::Unsupported { from, to }) => (from, to),
            other => panic!("{other:?}"),
        };
        let crop = || RecipeStep::Crop {
            width: 1,
            height: 1,
        };
        assert_eq!(
            refused(recipe(vec![crop()]), "mp4"),
            ("mp4".into(), "crop".into())
        );
        assert_eq!(
            refused(recipe(vec![RecipeStep::Resize { long_side: 100 }]), "pdf"),
            ("pdf".into(), "resize".into())
        );
        assert_eq!(
            refused(
                recipe(vec![RecipeStep::Compress {
                    compression: Compression::Quality { level: 50 }
                }]),
                "bmp"
            ),
            ("bmp".into(), "compress".into())
        );
        assert_eq!(
            refused(
                recipe(vec![RecipeStep::Convert { to: "mp3".into() }]),
                "png"
            ),
            ("png".into(), "mp3".into())
        );
        // A conversion earlier in the chain changes what fits later.
        let chain = recipe(vec![RecipeStep::Convert { to: "pdf".into() }, crop()]);
        assert_eq!(refused(chain.clone(), "png"), ("pdf".into(), "crop".into()));
        let input = bench.picture("çok adımlı 🧩.png", 30, 30);
        assert!(matches!(
            bench.run(&chain, &input, "png"),
            Err(Error::Unsupported { .. })
        ));
        assert_eq!(bench.left_in_dest(), 0);
        assert_eq!(fs::read_dir(&bench.temp).unwrap().count(), 0);
    }

    #[test]
    fn recipes_out_of_range_are_refused() {
        let bad = [
            recipe(vec![]),
            recipe(vec![RecipeStep::Resize { long_side: 0 }]),
            recipe(vec![RecipeStep::Crop {
                width: 0,
                height: 5,
            }]),
            recipe(vec![RecipeStep::Compress {
                compression: Compression::Ratio { percent: 99 },
            }]),
            recipe(vec![RecipeStep::Convert {
                to: "../jpg".into(),
            }]),
            recipe(vec![RecipeStep::Resize { long_side: 10 }; MAX_STEPS + 1]),
            Recipe {
                name: "   ".into(),
                ..instagram()
            },
            Recipe {
                name: "ı".repeat(MAX_NAME + 1),
                ..instagram()
            },
        ];
        for recipe in &bad {
            assert!(matches!(check(recipe), Err(Error::Other(_))), "{recipe:?}");
            assert!(plan(recipe, "jpg").is_err());
        }
        assert!(check(&instagram()).is_ok());
    }

    #[test]
    fn progress_climbs_to_the_end_and_cancelling_stops_the_run() {
        let bench = Bench::new();
        let input = bench.picture("ilerleme ö.png", 90, 60);
        let seen = Mutex::new(Vec::new());
        let report = |fraction: Option<f32>| seen.lock().unwrap().extend(fraction);
        let never = || false;
        let progress = Progress::new(&report, &never);
        let chain = recipe(vec![
            RecipeStep::Crop {
                width: 1,
                height: 1,
            },
            RecipeStep::Convert { to: "webp".into() },
        ]);
        run(&RecipeRun {
            recipe: &chain,
            input: &input,
            from: "png",
            dest: &bench.dest,
            temp: &bench.temp,
            options: &Options::default(),
            progress: &progress,
        })
        .unwrap();
        let seen = seen.into_inner().unwrap();
        assert!(seen.windows(2).all(|pair| pair[0] <= pair[1]), "{seen:?}");
        assert_eq!(seen.last(), Some(&1.0));

        let bench = Bench::new();
        let input = bench.picture("iptal ç.png", 90, 60);
        let stop = AtomicBool::new(false);
        let report = |_: Option<f32>| stop.store(true, Ordering::SeqCst);
        let cancelled = || stop.load(Ordering::SeqCst);
        let progress = Progress::new(&report, &cancelled);
        let result = run(&RecipeRun {
            recipe: &chain,
            input: &input,
            from: "png",
            dest: &bench.dest,
            temp: &bench.temp,
            options: &Options::default(),
            progress: &progress,
        });
        assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    }

    #[test]
    fn one_result_moves_to_the_claimed_file() {
        let bench = Bench::new();
        let input = bench.picture("tek dosya ğ.png", 40, 40);
        let files = bench
            .run(
                &recipe(vec![RecipeStep::Convert { to: "bmp".into() }]),
                &input,
                "png",
            )
            .unwrap();
        let claimed = bench.folder.join("tek dosya ğ - tarif 🍳.bmp");
        into_file(files, &claimed).unwrap();
        assert_eq!(dimensions(&claimed), (40, 40));
        assert_eq!(bench.left_in_dest(), 0);
        assert!(into_file(Vec::new(), &claimed).is_err());
    }

    #[test]
    fn pages_go_through_the_later_steps_one_by_one() {
        if !crate::pdf::fixtures::pdfium() {
            return;
        }
        let bench = Bench::new();
        let picture = bench.picture("sayfa ğ.png", 300, 200);
        let pdf = bench.folder.join("Rapor İ 📄.pdf");
        crate::convert(&Conversion {
            input: &picture,
            from: "png",
            to: "pdf",
            dest: &pdf,
            temp: &bench.temp,
            options: &Options::default(),
            progress: &Progress::none(),
        })
        .unwrap();
        let chain = recipe(vec![
            RecipeStep::Convert { to: "png".into() },
            RecipeStep::Resize { long_side: 50 },
        ]);
        let plan = plan(&chain, "pdf").unwrap();
        assert_eq!((plan.result(), plan.output), ("png", Output::Folder));
        let files = bench.run(&chain, &pdf, "pdf").unwrap();
        assert!(!files.is_empty());
        for file in &files {
            assert_eq!(file.parent().unwrap(), bench.dest);
            let (w, h) = dimensions(file);
            assert_eq!(w.max(h), 50, "{}", file.display());
        }
    }
}
