// SPDX-License-Identifier: MIT
//! Conversions, tools and recipes from the command line. Every file is checked before anything
//! runs; then the jobs run one after another through the app's own pieces (the outputs and work
//! of `work`, `compress` and `media`, the names of `jobs::naming`, `jobs::engine::write`), so a
//! result is named and written exactly as from the wheel.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use kento_engines::compress::Compression;
use kento_engines::media::{
    Loudness, Pauses, Strength, Tool as MediaTool, Transition, TransitionKind, Turn,
};
use kento_engines::recipe::{self, Recipe, RecipeRun};
use kento_engines::{archive, pdf, qr, Error as EngineError, Options, Progress};
use serde::Serialize;
use serde_json::{json, Value};

use super::{console, format_named, print_json, Exit, Problem, Session, ToolOptions, Usage};
use crate::catalog::{self, Category, Format, Status, ToolGroup};
use crate::jobs::engine::{self, Target, Work};
use crate::jobs::naming::{file_name, is_writable, long_path, output_dir, OutputDir, Reservation};
use crate::work::{
    conversion, error_key, is_document, missing_in, readable_format, stem_of, usable,
};

/// The tools the command line runs: Compress, and those that need no choices made in a window
/// (or only choices an option can say).
pub const TOOLS: [&str; 13] = [
    "compress",
    "mute",
    "normalize",
    "denoise",
    "remove-pauses",
    "stabilize",
    "rotate-video",
    "merge-video",
    "merge-audio",
    "extract",
    "merge-pdf",
    "images-to-pdf",
    "read-qr",
];

/// Compress's quality when no mode is given, as the panel starts.
const QUALITY: u8 = 75;
/// Remove noise and Stabilize video without --strength.
const STRENGTH: Strength = Strength::Medium;

/// One job: the files it reads, where its result goes and the engine call.
struct Job {
    inputs: Vec<PathBuf>,
    target: Target,
    work: Work,
    /// A step once the result has its name: a recipe that made one file gives the file.
    finish: Option<Box<dyn FnOnce(PathBuf) -> io::Result<PathBuf>>>,
}

impl Job {
    fn new(inputs: Vec<PathBuf>, (target, work): (Target, Work)) -> Self {
        Self {
            inputs,
            target,
            work,
            finish: None,
        }
    }
}

/// What became of one job, as `--json` reports it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Outcome {
    inputs: Vec<PathBuf>,
    outputs: Vec<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    codes: Option<Vec<Code>>,
}

/// A QR code as `--json` reports it.
#[derive(Serialize)]
struct Code {
    file: PathBuf,
    page: Option<usize>,
    text: String,
}

pub fn convert(session: &Session, files: &[PathBuf], to: &str, out: Option<&Path>) -> Exit {
    match conversions(session, files, to, out) {
        Ok(jobs) => run(session, jobs),
        Err(problem) => session.fail(&problem),
    }
}

fn conversions(
    session: &Session,
    files: &[PathBuf],
    to: &str,
    out: Option<&Path>,
) -> Result<Vec<Job>, Problem> {
    let target = format_named(to, true)
        .ok_or_else(|| session.problem(Exit::Usage, "cli.format.unknown", &[("format", to)]))?;
    let mut sources = Vec::new();
    let mut groups = Vec::new();
    for path in existing(session, files)? {
        let from = source_format(session, &path)?;
        let route = catalog::routes()
            .iter()
            .find(|route| route.from == from.id && route.to == target.id)
            .filter(|_| usable(from.id, target.id))
            .ok_or_else(|| {
                session.problem(
                    Exit::Unsupported,
                    "cli.route",
                    &[
                        ("file", &name_of(&path)),
                        ("from", from.id),
                        ("to", target.id),
                    ],
                )
            })?;
        groups.push(route.group);
        sources.push((path, from));
    }
    let heic = sources.iter().any(|(_, from)| from.id == "heic");
    let tools = tools_for(session, &groups, heic)?;
    let setting = out_setting(session, out)?;
    session.load_pdfium();
    let options = Options {
        tools,
        office_profile: Some(session.paths().office_profile_cli()),
        ..Options::default()
    };
    Ok(sources
        .into_iter()
        .map(|(path, from)| {
            let dir = dir_for(session, &path, &setting);
            let job = conversion(path.clone(), from, target, dir, options.clone());
            Job::new(vec![path], job)
        })
        .collect())
}

pub fn tool(
    session: &Session,
    id: &str,
    files: &[PathBuf],
    out: Option<&Path>,
    options: &ToolOptions,
) -> Exit {
    match tool_jobs(session, id, files, out, options) {
        Ok(Planned::Jobs(jobs)) => run(session, jobs),
        Ok(Planned::Qr(scan)) => read_qr(session, *scan),
        Err(problem) => session.fail(&problem),
    }
}

enum Planned {
    Jobs(Vec<Job>),
    Qr(Box<QrScan>),
}

struct QrScan {
    inputs: Vec<(PathBuf, String)>,
    tools: kento_engines::Tools,
    report: Option<(qr::Report, PathBuf)>,
}

fn tool_jobs(
    session: &Session,
    id: &str,
    files: &[PathBuf],
    out: Option<&Path>,
    options: &ToolOptions,
) -> Result<Planned, Problem> {
    let tool = catalog::tools()
        .iter()
        .find(|tool| tool.id == id)
        .ok_or_else(|| session.problem(Exit::Usage, "cli.tool.unknown", &[("tool", id)]))?;
    let name = session.text(&tool.name_key());
    if tool.status != Status::Ready {
        return Err(session.problem(Exit::Unsupported, "cli.tool.later", &[("tool", &name)]));
    }
    if !TOOLS.contains(&tool.id) {
        return Err(session.problem(Exit::Unsupported, "cli.tool.window", &[("tool", &name)]));
    }
    let takes: &[&str] = match tool.id {
        "compress" => &["--quality", "--ratio", "--target-size"],
        "images-to-pdf" => &["--page", "--margin"],
        "read-qr" => &["--format"],
        "denoise" => &["--strength", "--rumble"],
        "stabilize" => &["--strength"],
        "remove-pauses" => &["--threshold", "--min-length", "--keep"],
        "rotate-video" => &["--turn", "--mirror", "--flip"],
        "merge-video" => &["--transition", "--seconds"],
        "merge-audio" => &["--crossfade"],
        _ => &[],
    };
    if let Some(option) = options.given.iter().find(|option| !takes.contains(option)) {
        return Err(session.usage(&Usage::NotHere(option)));
    }
    let media_tool = media_tool(tool.id, options).map_err(|usage| session.usage(&usage))?;
    let mut sources: Vec<(PathBuf, &'static Format)> = Vec::new();
    for path in existing(session, files)? {
        let format = is_document(&path)
            .then(|| readable_format(&path))
            .flatten()
            .filter(|format| tool.categories.contains(&format.category))
            .ok_or_else(|| {
                session.problem(
                    Exit::Unsupported,
                    "cli.tool.file",
                    &[("tool", &name), ("file", &name_of(&path))],
                )
            })?;
        sources.push((path, format));
    }
    if matches!(tool.id, "merge-pdf" | "merge-video" | "merge-audio") && sources.len() < 2 {
        return Err(session.problem(Exit::Usage, "cli.usage.count", &[("tool", &name)]));
    }
    let media = sources
        .iter()
        .any(|(_, f)| matches!(f.category, Category::Video | Category::Audio));
    let needed = match tool.group {
        ToolGroup::Core if media => vec![ToolGroup::Media],
        ToolGroup::Core => vec![],
        group => vec![group],
    };
    let heic = sources.iter().any(|(_, format)| format.id == "heic");
    let tools = tools_for(session, &needed, heic)?;
    let setting = out_setting(session, out)?;
    session.load_pdfium();

    let first = sources[0].0.clone();
    let suffix = |id: &str| session.text(&format!("suffix.{id}"));
    let jobs = match tool.id {
        "compress" => {
            let compression = options
                .compression
                .unwrap_or(Compression::Quality { level: QUALITY });
            let mut jobs = Vec::new();
            for (path, _) in sources {
                let format_kind = crate::compress::compressible(&path).map_err(|_| {
                    session.problem(
                        Exit::Unsupported,
                        "cli.tool.file",
                        &[("tool", &name), ("file", &name_of(&path))],
                    )
                })?;
                let dir = dir_for(session, &path, &setting);
                let job = crate::compress::job(
                    path.clone(),
                    format_kind,
                    compression,
                    dir,
                    &session.text("suffix.compress"),
                    tools.clone(),
                );
                jobs.push(Job::new(vec![path], job));
            }
            jobs
        }
        // One file each.
        "mute" | "normalize" | "denoise" | "remove-pauses" | "stabilize" | "rotate-video" => {
            let media_tool = media_tool.expect("a media tool");
            sources
                .into_iter()
                .map(|(path, format)| {
                    let dir = dir_for(session, &path, &setting);
                    let job = crate::media::job(
                        media_tool.clone(),
                        vec![path.clone()],
                        format,
                        dir,
                        &suffix(tool.id),
                        tools.clone(),
                    );
                    Job::new(vec![path], job)
                })
                .collect()
        }
        // The files in the order given, into one.
        "merge-video" | "merge-audio" => {
            let format = sources[0].1;
            let paths: Vec<PathBuf> = sources.into_iter().map(|(path, _)| path).collect();
            let dir = dir_for(session, &first, &setting);
            let job = crate::media::job(
                media_tool.expect("a media tool"),
                paths.clone(),
                format,
                dir,
                &suffix(tool.id),
                tools,
            );
            vec![Job::new(paths, job)]
        }
        "extract" => sources
            .into_iter()
            .map(|(path, format)| {
                let target = Target::Folder {
                    dir: dir_for(session, &path, &setting),
                    name: stem_of(&path),
                };
                let (input, from) = (path.clone(), format.id);
                let work: Work = Box::new(move |dest, _, progress| {
                    let limits = Options::default().archive_limits;
                    archive::extract(&input, from, dest, &limits, progress).map(|_| ())
                });
                Job::new(vec![path], (target, work))
            })
            .collect(),
        "merge-pdf" => {
            let paths: Vec<PathBuf> = sources.into_iter().map(|(path, _)| path).collect();
            let target = Target::File {
                dir: dir_for(session, &first, &setting),
                stem: file_name(&stem_of(&first), Some(&suffix("merged")), ""),
                extension: "pdf".into(),
            };
            let inputs = paths.clone();
            let work: Work = Box::new(move |dest, _, progress| pdf::merge(&inputs, dest, progress));
            vec![Job::new(paths, (target, work))]
        }
        "images-to-pdf" => {
            let layout = pdf::PageLayout {
                size: options.page.unwrap_or(pdf::PageSize::FitImage),
                margin_mm: options.margin_mm.unwrap_or(0.0),
            };
            let inputs: Vec<(PathBuf, String)> = sources
                .iter()
                .map(|(path, format)| (path.clone(), format.id.to_string()))
                .collect();
            let target = Target::File {
                dir: dir_for(session, &first, &setting),
                stem: stem_of(&first),
                extension: "pdf".into(),
            };
            let engine_options = Options {
                tools,
                ..Options::default()
            };
            let work: Work = Box::new(move |dest, _, progress| {
                pdf::from_images(&inputs, &layout, dest, &engine_options, progress)
            });
            let paths = sources.into_iter().map(|(path, _)| path).collect();
            vec![Job::new(paths, (target, work))]
        }
        _ => {
            let report = options
                .report
                .map(|report| (report, dir_for(session, &first, &setting)));
            return Ok(Planned::Qr(Box::new(QrScan {
                inputs: sources
                    .into_iter()
                    .map(|(path, format)| (path, format.id.to_string()))
                    .collect(),
                tools,
                report,
            })));
        }
    };
    Ok(Planned::Jobs(jobs))
}

/// The media tool `id` runs with the command line's choices, and the app's own choices where none
/// is given; None for a tool that is not a media tool.
fn media_tool(id: &str, options: &ToolOptions) -> Result<Option<MediaTool>, Usage> {
    Ok(Some(match id {
        "mute" => MediaTool::Mute,
        "normalize" => MediaTool::Normalize {
            loudness: Loudness::default(),
        },
        "denoise" => MediaTool::Denoise {
            strength: options.strength.unwrap_or(STRENGTH),
            rumble: options.rumble,
        },
        "stabilize" => MediaTool::Stabilize {
            strength: options.strength.unwrap_or(STRENGTH),
        },
        "remove-pauses" => {
            let usual = Pauses::default();
            MediaTool::RemovePauses {
                pauses: Pauses {
                    threshold: options.threshold.unwrap_or(usual.threshold),
                    min_length: options.min_length.unwrap_or(usual.min_length),
                    keep: options.keep.unwrap_or(usual.keep),
                },
            }
        }
        "rotate-video" => {
            if options.turn.is_none() && !options.mirror && !options.flip {
                return Err(Usage::NoTurn);
            }
            MediaTool::RotateVideo {
                turn: options.turn.unwrap_or(Turn::None),
                mirror: options.mirror,
                flip: options.flip,
            }
        }
        "merge-video" => {
            let kind = options.transition.unwrap_or_default();
            // A cut takes no time.
            if kind == TransitionKind::Cut && options.seconds.is_some() {
                return Err(Usage::NotHere("--seconds"));
            }
            MediaTool::MergeVideos {
                transition: Transition {
                    kind,
                    seconds: options.seconds.unwrap_or(Transition::default().seconds),
                },
            }
        }
        "merge-audio" => MediaTool::MergeAudio {
            crossfade: options.crossfade.unwrap_or(0.0),
        },
        _ => return Ok(None),
    }))
}

/// Reads the codes; without `--format` they are the result, with it they go into a report next
/// to the first file ("photo - QR codes.txt"), as the panel saves it.
fn read_qr(session: &Session, scan: QrScan) -> Exit {
    let inputs: Vec<PathBuf> = scan.inputs.iter().map(|(path, _)| path.clone()).collect();
    let first = inputs[0].clone();
    let options = Options {
        tools: scan.tools,
        ..Options::default()
    };
    let found = progress(&first, session.quiet(), |progress| {
        qr::read(&scan.inputs, &options, progress)
    });
    let found = match found {
        Ok(found) => found,
        Err(error) => {
            let problem = engine_problem(session, &error);
            session.tell(Some(&first), &problem);
            let outcome = Outcome {
                inputs,
                outputs: vec![],
                error: Some(problem.json()),
                codes: None,
            };
            return finish(session, problem.exit, vec![outcome]);
        }
    };
    if found.is_empty() {
        eprintln!("kento: {}", session.text("cli.qr.none"));
    }
    let mut outputs = Vec::new();
    match &scan.report {
        Some((report, dir)) if !found.is_empty() => {
            let extension = match report {
                qr::Report::Txt => "txt",
                qr::Report::Csv => "csv",
                qr::Report::Json => "json",
            };
            let stem = file_name(&stem_of(&first), Some(&session.text("suffix.qr")), "");
            let written = Reservation::claim(dir, &stem, extension)
                .map_err(EngineError::from)
                .and_then(|reservation| {
                    qr::write_report(&found, *report, reservation.temp_path())?;
                    Ok(reservation.commit()?)
                });
            match written {
                Ok(path) => {
                    if !session.json() {
                        println!("{}", path.display());
                    }
                    outputs.push(path);
                }
                Err(error) => {
                    let problem = engine_problem(session, &error);
                    session.tell(Some(&first), &problem);
                    let outcome = Outcome {
                        inputs,
                        outputs,
                        error: Some(problem.json()),
                        codes: Some(codes(found)),
                    };
                    return finish(session, problem.exit, vec![outcome]);
                }
            }
        }
        Some(_) => {}
        None if !session.json() => {
            let several = inputs.len() > 1 || found.iter().any(|code| code.page.is_some());
            for code in &found {
                if several {
                    let name = code
                        .file
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    match code.page {
                        Some(page) => println!("{name}#page={page}: {}", code.text),
                        None => println!("{name}: {}", code.text),
                    }
                } else {
                    println!("{}", code.text);
                }
            }
        }
        None => {}
    }
    let outcome = Outcome {
        inputs,
        outputs,
        error: None,
        codes: Some(codes(found)),
    };
    finish(session, Exit::Done, vec![outcome])
}

fn codes(found: Vec<qr::Found>) -> Vec<Code> {
    found
        .into_iter()
        .map(|code| Code {
            file: code.file,
            page: code.page,
            text: code.text,
        })
        .collect()
}

pub fn recipe(session: &Session, name: &str, files: &[PathBuf], out: Option<&Path>) -> Exit {
    match recipe_jobs(session, name, files, out) {
        Ok(jobs) => run(session, jobs),
        Err(problem) => session.fail(&problem),
    }
}

/// The recipes saved in the app (`recipes.json`, shared with the wheel and folder automation).
pub fn load_recipes(session: &Session) -> Result<Vec<Recipe>, Problem> {
    let broken = |details: String| Problem {
        exit: Exit::Failed,
        message: session.text("cli.recipe.broken"),
        details: Some(details),
    };
    let text = match fs::read_to_string(session.paths().recipes_file()) {
        Ok(text) => text,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(broken(err.to_string())),
    };
    serde_json::from_str(&text).map_err(|err| broken(err.to_string()))
}

/// A recipe by its id, or by its name in any case.
fn find_recipe<'a>(
    session: &Session,
    recipes: &'a [Recipe],
    name: &str,
) -> Result<&'a Recipe, Problem> {
    if let Some(recipe) = recipes.iter().find(|recipe| recipe.id == name) {
        return Ok(recipe);
    }
    let wanted = name.trim().to_lowercase();
    let named: Vec<&Recipe> = recipes
        .iter()
        .filter(|recipe| recipe.name.trim().to_lowercase() == wanted)
        .collect();
    match named.as_slice() {
        [recipe] => Ok(recipe),
        [] => Err(session.problem(Exit::Usage, "cli.recipe.unknown", &[("recipe", name)])),
        many => {
            let ids: Vec<&str> = many.iter().map(|recipe| recipe.id.as_str()).collect();
            Err(session.problem(
                Exit::Usage,
                "cli.recipe.ambiguous",
                &[("recipe", name), ("ids", &ids.join(", "))],
            ))
        }
    }
}

fn recipe_jobs(
    session: &Session,
    name: &str,
    files: &[PathBuf],
    out: Option<&Path>,
) -> Result<Vec<Job>, Problem> {
    let recipes = load_recipes(session)?;
    let recipe = find_recipe(session, &recipes, name)?.clone();
    let mut sources = Vec::new();
    for path in existing(session, files)? {
        let from = source_format(session, &path)?;
        sources.push((path, from));
    }
    // A step may convert to anything, so every group is looked for.
    let tools = session.all_tools();
    let setting = out_setting(session, out)?;
    session.load_pdfium();
    let options = Options {
        tools,
        office_profile: Some(session.paths().office_profile_cli()),
        ..Options::default()
    };
    // Results carry the recipe's name, as tools carry theirs: "photo - Instagram.jpg".
    let suffix = crate::web::safe_name(&recipe.name)
        .or_else(|| crate::web::safe_name(&recipe.id))
        .unwrap_or_default();
    Ok(sources
        .into_iter()
        .map(|(path, from)| {
            let dir = dir_for(session, &path, &setting);
            let name = file_name(&stem_of(&path), Some(&suffix), "");
            let target = Target::Folder {
                dir: dir.clone(),
                name: name.clone(),
            };
            let (recipe, input, options, from) =
                (recipe.clone(), path.clone(), options.clone(), from.id);
            let work: Work = Box::new(move |dest, temp, progress| {
                let written = recipe::run(&RecipeRun {
                    recipe: &recipe,
                    input: &input,
                    from,
                    dest,
                    temp,
                    options: &options,
                    progress,
                })?;
                if written.is_empty() {
                    return Err(EngineError::Other(format!(
                        "the recipe {:?} wrote nothing",
                        recipe.name
                    )));
                }
                Ok(())
            });
            Job {
                inputs: vec![path],
                target,
                work,
                finish: Some(Box::new(move |folder| lone_file(folder, &dir, &name))),
            }
        })
        .collect())
}

/// A recipe that made one file gives that file, named like its folder ("photo - Instagram.jpg");
/// one that made several (pages) keeps them in the folder.
fn lone_file(folder: PathBuf, dir: &Path, name: &str) -> io::Result<PathBuf> {
    let entries = fs::read_dir(long_path(&folder))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<io::Result<Vec<_>>>()?;
    let [file] = entries.as_slice() else {
        return Ok(folder);
    };
    if !file.is_file() {
        return Ok(folder);
    }
    let extension = file
        .extension()
        .map(|ext| ext.to_string_lossy().into_owned())
        .unwrap_or_default();
    let reservation = Reservation::claim(dir, name, &extension)?;
    fs::rename(long_path(file), long_path(reservation.temp_path()))?;
    let path = reservation.commit()?;
    fs::remove_dir(long_path(&folder))?;
    Ok(path)
}

/// Runs the jobs one after another; a failed job does not stop the next, Ctrl+C does.
fn run(session: &Session, jobs: Vec<Job>) -> Exit {
    let scratch = Scratch(
        session
            .paths()
            .temp
            .join(format!("cli-{}", std::process::id())),
    );
    let mut outcomes = Vec::new();
    let mut exit = Exit::Done;
    for (n, job) in jobs.into_iter().enumerate() {
        if console::cancelled() {
            exit = Exit::Cancelled;
            break;
        }
        let first = job.inputs[0].clone();
        let Job {
            inputs,
            target,
            work,
            finish: after,
        } = job;
        let result = scratch.folder(n).and_then(|temp| {
            let result = progress(&first, session.quiet(), |progress| {
                engine::write(target, work, &temp, progress)
            });
            let _ = fs::remove_dir_all(&temp);
            result
        });
        match result {
            Ok(path) => {
                let output = match after {
                    Some(after) => after(path.clone()).unwrap_or(path),
                    None => path,
                };
                if !session.json() {
                    println!("{}", output.display());
                }
                outcomes.push(Outcome {
                    inputs,
                    outputs: vec![output],
                    error: None,
                    codes: None,
                });
            }
            Err(error) => {
                let problem = engine_problem(session, &error);
                session.tell(Some(&first), &problem);
                if problem.exit == Exit::Cancelled || exit == Exit::Done {
                    exit = problem.exit;
                }
                outcomes.push(Outcome {
                    inputs,
                    outputs: vec![],
                    error: Some(problem.json()),
                    codes: None,
                });
                if problem.exit == Exit::Cancelled {
                    break;
                }
            }
        }
    }
    finish(session, exit, outcomes)
}

/// The end of a run: the JSON document, or a count when some of several files failed.
fn finish(session: &Session, exit: Exit, outcomes: Vec<Outcome>) -> Exit {
    if session.json() {
        print_json(&json!({
            "ok": exit == Exit::Done,
            "exitCode": exit.code(),
            "results": outcomes,
        }));
    } else {
        let failed = outcomes.iter().filter(|o| o.error.is_some()).count();
        if outcomes.len() > 1 && failed > 0 {
            let done = (outcomes.len() - failed).to_string();
            let failed = failed.to_string();
            eprintln!(
                "kento: {}",
                session.say("cli.summary", &[("done", &done), ("failed", &failed)])
            );
        }
    }
    exit
}

/// The command's own scratch folder in Kento's temp folder, removed at the end (and by the app's
/// next start if the command was killed).
struct Scratch(PathBuf);

impl Scratch {
    fn folder(&self, n: usize) -> kento_engines::Result<PathBuf> {
        let dir = self.0.join(n.to_string());
        fs::create_dir_all(&dir)?;
        Ok(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Runs an engine call with a progress line for `file` and Ctrl+C as its cancel.
fn progress<T>(
    file: &Path,
    quiet: bool,
    run: impl FnOnce(&Progress) -> kento_engines::Result<T>,
) -> kento_engines::Result<T> {
    let label = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let meter = console::Meter::new(&label, quiet);
    let report = |fraction: Option<f32>| meter.report(fraction);
    let cancelled = console::cancelled;
    let result = run(&Progress::new(&report, &cancelled));
    meter.clear();
    result
}

/// An engine error in plain language (the app's own messages), with its exit code.
fn engine_problem(session: &Session, error: &EngineError) -> Problem {
    if console::cancelled() || matches!(error, EngineError::Cancelled) {
        return session.problem(Exit::Cancelled, "cli.cancelled", &[]);
    }
    let exit = match error {
        EngineError::MissingCodec(_) => Exit::MissingTool,
        EngineError::Unsupported { .. } => Exit::Unsupported,
        _ => Exit::Failed,
    };
    Problem {
        exit,
        message: session.text(error_key(error)),
        details: Some(error.to_string()),
    }
}

/// The tools a command needs, looked for once; a missing group stops it before any job. HEIC
/// photos also look for the media tools, which read them where the system cannot.
fn tools_for(
    session: &Session,
    needed: &[ToolGroup],
    heic: bool,
) -> Result<kento_engines::Tools, Problem> {
    let mut groups = needed.to_vec();
    if heic {
        groups.push(ToolGroup::Media);
    }
    groups.sort();
    groups.dedup();
    let tools = session.tools(&groups);
    match needed.iter().find_map(|group| missing_in(&tools, *group)) {
        Some(group) => Err(session.missing(group)),
        None => Ok(tools),
    }
}

/// The format a file is read as; a folder is not a file, except an Apple package document.
fn source_format(session: &Session, path: &Path) -> Result<&'static Format, Problem> {
    is_document(path)
        .then(|| readable_format(path))
        .flatten()
        .ok_or_else(|| {
            session.problem(
                Exit::Unsupported,
                "cli.file.unreadable",
                &[("file", &name_of(path))],
            )
        })
}

/// The files named on the command line, made absolute, with wildcards expanded on Windows (its
/// shells pass `*.heic` on as it is). A name that is not there stops the command.
fn existing(session: &Session, files: &[PathBuf]) -> Result<Vec<PathBuf>, Problem> {
    let mut found = Vec::new();
    for file in files {
        for path in expand(file) {
            let path = std::path::absolute(&path).unwrap_or(path);
            if !path.exists() {
                return Err(session.problem(
                    Exit::Usage,
                    "cli.usage.missing",
                    &[("file", &shown(file))],
                ));
            }
            found.push(path);
        }
    }
    Ok(found)
}

fn expand(path: &Path) -> Vec<PathBuf> {
    let pattern = path.file_name().and_then(|name| name.to_str());
    let wild = pattern.is_some_and(|name| name.contains(['*', '?']));
    if !cfg!(windows) || !wild || path.exists() {
        return vec![path.to_path_buf()];
    }
    let pattern: Vec<char> = pattern.unwrap_or_default().to_lowercase().chars().collect();
    let dir = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut matches: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry.file_name().to_str().is_some_and(|name| {
                let name: Vec<char> = name.to_lowercase().chars().collect();
                wildcard(&pattern, &name)
            })
        })
        .map(|entry| dir.join(entry.file_name()))
        .collect();
    matches.sort();
    if matches.is_empty() {
        vec![path.to_path_buf()]
    } else {
        matches
    }
}

/// `*` stands for any run of characters, `?` for one.
fn wildcard(pattern: &[char], name: &[char]) -> bool {
    let (mut p, mut n) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while n < name.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
            p += 1;
            n += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, n));
            p += 1;
        } else if let Some((at, from)) = star {
            p = at + 1;
            n = from + 1;
            star = Some((at, from + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}

/// Where results go: the `--out` folder (made when missing), else next to each file.
fn out_setting(session: &Session, out: Option<&Path>) -> Result<OutputDir, Problem> {
    let Some(dir) = out else {
        return Ok(OutputDir::NextToSource);
    };
    let dir = std::path::absolute(dir).unwrap_or_else(|_| dir.to_path_buf());
    if fs::create_dir_all(long_path(&dir)).is_err() || !is_writable(&dir) {
        return Err(session.problem(Exit::Usage, "cli.usage.out", &[("folder", &shown(&dir))]));
    }
    Ok(OutputDir::Folder(dir))
}

/// The folder for one file's result (SPEC 5.14): Downloads/Kento when the file's own folder
/// cannot be written to.
fn dir_for(session: &Session, source: &Path, setting: &OutputDir) -> PathBuf {
    let fallback = session.fallback();
    let dir = output_dir(source, setting, &fallback);
    if dir == fallback {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

/// A path as the command line gave it.
fn shown(path: &Path) -> String {
    path.display().to_string()
}

/// A file's name, for messages about one file of several.
fn name_of(path: &Path) -> String {
    path.file_name()
        .map_or_else(|| shown(path), |name| name.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matches(pattern: &str, name: &str) -> bool {
        let chars = |text: &str| text.chars().collect::<Vec<_>>();
        wildcard(&chars(pattern), &chars(name))
    }

    /// The tool and its choices from a command line, as `tool` would run them.
    fn tool_of(args: &[&str]) -> Result<Option<MediaTool>, Usage> {
        let mut all = vec!["tool"];
        all.extend(args);
        let invocation = super::super::parse(all.into_iter().map(std::ffi::OsString::from))?;
        let super::super::Command::Tool { tool, options, .. } = invocation.command else {
            panic!("not a tool");
        };
        media_tool(&tool, &options)
    }

    #[test]
    fn media_tools_get_the_apps_choices_unless_told() {
        assert_eq!(
            tool_of(&["denoise", "a.wav"]),
            Ok(Some(MediaTool::Denoise {
                strength: Strength::Medium,
                rumble: false
            }))
        );
        assert_eq!(
            tool_of(&["stabilize", "a.mp4", "--strength", "light"]),
            Ok(Some(MediaTool::Stabilize {
                strength: Strength::Light
            }))
        );
        assert_eq!(
            tool_of(&["remove-pauses", "a.mp4", "--keep", "0.3"]),
            Ok(Some(MediaTool::RemovePauses {
                pauses: Pauses {
                    keep: 0.3,
                    ..Pauses::default()
                }
            }))
        );
        assert_eq!(
            tool_of(&["rotate-video", "a.mp4", "--turn", "left", "--mirror"]),
            Ok(Some(MediaTool::RotateVideo {
                turn: Turn::Left,
                mirror: true,
                flip: false
            }))
        );
        assert_eq!(
            tool_of(&["rotate-video", "a.mp4", "--flip"]),
            Ok(Some(MediaTool::RotateVideo {
                turn: Turn::None,
                mirror: false,
                flip: true
            }))
        );
        assert_eq!(tool_of(&["rotate-video", "a.mp4"]), Err(Usage::NoTurn));
        // Merge videos joins with a cut, as before, unless a transition is named; its length is
        // the app's half second unless given.
        assert_eq!(
            tool_of(&["merge-video", "a.mp4", "b.mp4"]),
            Ok(Some(MediaTool::MergeVideos {
                transition: Transition::default()
            }))
        );
        assert_eq!(
            tool_of(&["merge-video", "a.mp4", "b.mp4", "--transition", "slide"]),
            Ok(Some(MediaTool::MergeVideos {
                transition: Transition {
                    kind: TransitionKind::Slide,
                    seconds: 0.5
                }
            }))
        );
        assert_eq!(
            tool_of(&[
                "merge-video",
                "a.mp4",
                "b.mp4",
                "--transition",
                "wipe",
                "--seconds",
                "2"
            ]),
            Ok(Some(MediaTool::MergeVideos {
                transition: Transition {
                    kind: TransitionKind::Wipe,
                    seconds: 2.0
                }
            }))
        );
        assert_eq!(
            tool_of(&[
                "merge-video",
                "a.mp4",
                "b.mp4",
                "--transition",
                "cut",
                "--seconds",
                "1"
            ]),
            Err(Usage::NotHere("--seconds"))
        );
        assert_eq!(
            tool_of(&["merge-audio", "a.mp3", "b.mp3"]),
            Ok(Some(MediaTool::MergeAudio { crossfade: 0.0 }))
        );
        assert_eq!(tool_of(&["extract", "a.zip"]), Ok(None));
        // Every media tool the command line names is one the app knows by that id.
        for id in TOOLS {
            let options = ToolOptions {
                turn: Some(Turn::Right),
                ..ToolOptions::default()
            };
            if let Some(tool) = media_tool(id, &options).unwrap() {
                assert_eq!(tool.id(), id);
            }
        }
    }

    #[test]
    fn wildcards_match_like_the_windows_shells() {
        assert!(matches("*.heic", "fotoğraf 🧪.heic"));
        assert!(matches("*", "a"));
        assert!(matches("img_??.png", "img_01.png"));
        assert!(matches("*a*b*", "xxaYYbzz"));
        assert!(!matches("*.heic", "photo.heic.jpg"));
        assert!(!matches("img_?.png", "img_01.png"));
        assert!(matches("*.*", "a.b"));
    }

    #[cfg(windows)]
    #[test]
    fn wildcards_expand_in_their_folder_in_order() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["b ğ.HEIC", "a 🧪.heic", "c.png"] {
            fs::write(dir.path().join(name), b"x").unwrap();
        }
        let found = expand(&dir.path().join("*.heic"));
        let names: Vec<String> = found
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["a 🧪.heic", "b ğ.HEIC"]);
        let none = dir.path().join("*.mp4");
        assert_eq!(expand(&none), [none]);
    }

    #[test]
    fn a_lone_recipe_result_leaves_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("foto - Instagram");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("x.webp"), b"webp").unwrap();
        fs::write(dir.path().join("foto - Instagram.webp"), b"old").unwrap();
        let out = lone_file(folder.clone(), dir.path(), "foto - Instagram").unwrap();
        assert_eq!(out, dir.path().join("foto - Instagram (2).webp"));
        assert_eq!(fs::read(&out).unwrap(), b"webp");
        assert!(!folder.exists());
        let pages = dir.path().join("belge - Sayfalar");
        fs::create_dir(&pages).unwrap();
        fs::write(pages.join("1.png"), b"1").unwrap();
        fs::write(pages.join("2.png"), b"2").unwrap();
        assert_eq!(
            lone_file(pages.clone(), dir.path(), "belge - Sayfalar").unwrap(),
            pages
        );
    }
}
