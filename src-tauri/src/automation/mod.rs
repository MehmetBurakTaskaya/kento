// SPDX-License-Identifier: MIT
//! Folder automation (SPEC 5.11): rules that watch a folder and handle each new file that passes
//! their filter (convert it, run a tool that needs no choices or a recipe, or move it) into their
//! output folder. Watching starts with Kento for the rules that are on, and every file runs as a
//! normal job in the queue, so it shows on Home, can be cancelled and lands in the Library.
//!
//! - Finished writes: a file is taken once its size has held for a moment (`settle`).
//! - Loop protection (`guard`): nothing Kento wrote, nothing in the rule's own output folder,
//!   nothing it already took unless the file changed; the page warns when the output folder is
//!   inside the watched one.
//! - Pausing: each rule has its own switch, and "Pause all" stops every rule.
//! - Updates: while one waits to install, new jobs are refused, so a finished file is kept and
//!   handed to its rule after the restart (or at once, should the install fail).
//! - The activity log keeps the last entries beside the rules; failures show as the corner card,
//!   or in the main window when it has the focus.

mod guard;
pub mod rules;
mod settle;
mod store;
mod watcher;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::catalog::{self, Category, Format};
use crate::error::{Error, Result};
use crate::jobs::naming::is_writable;
use crate::jobs::{JobInfo, JobState};
use crate::recipes::{self, Recipes};
use crate::work::{self, Context};
use crate::{i18n, AppState};
use guard::Produced;
use kento_engines::recipe;
use rules::{Action, Config, Rule};
use store::{Activity, Held, Log, Outcome};
use watcher::{Timing, Watcher};

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

pub struct Automation {
    file: PathBuf,
    config: Mutex<Config>,
    log: Mutex<Log>,
    /// Every job's outputs, for a while: Kento never takes its own files.
    produced: Arc<Produced>,
    /// Automation's jobs in the queue and their activity entries.
    jobs: Mutex<HashMap<u64, u64>>,
    /// Folders picked in the system's dialog this session; a rule takes only these, or the
    /// folders it already had.
    chosen: Mutex<Vec<PathBuf>>,
    /// Rules whose folder could not be watched, with the reason.
    trouble: Mutex<HashMap<String, String>>,
    watcher: Mutex<Option<Watcher>>,
    /// Files kept while an update waits to install, and the file that keeps them.
    held: Mutex<Vec<Held>>,
    held_file: PathBuf,
}

impl Automation {
    /// Reads automation.json, the log and the kept files beside it.
    pub fn open(file: PathBuf) -> Self {
        let log = Log::load(file.with_file_name("automation-log.json"));
        let held_file = file.with_file_name("automation-held.json");
        Self {
            held: Mutex::new(store::load_held(&held_file)),
            held_file,
            config: Mutex::new(store::load_config(&file)),
            file,
            log: Mutex::new(log),
            produced: Arc::default(),
            jobs: Mutex::default(),
            chosen: Mutex::default(),
            trouble: Mutex::default(),
            watcher: Mutex::default(),
        }
    }

    fn config(&self) -> Config {
        lock(&self.config).clone()
    }

    fn save_log(&self) {
        if let Err(err) = lock(&self.log).save() {
            tracing::warn!("the automation log was not saved: {err}");
        }
    }
}

/// Starts watching for the rules that are on (at app start).
pub fn start(app: &AppHandle) {
    let automation = app.state::<Automation>();
    let on_file = {
        let app = app.clone();
        Box::new(move |rule: &Rule, path: &Path| dispatch(&app, rule, path))
    };
    let on_trouble = {
        let app = app.clone();
        Box::new(move |rule: &Rule, reason: String| {
            let automation = app.state::<Automation>();
            lock(&automation.trouble).insert(rule.id.clone(), reason.clone());
            emit(&app);
            let lang = app.state::<AppState>().lang();
            notify(
                &app,
                display_name(rule),
                i18n::text(&lang, "automation.problem.watch"),
                Some(reason),
            );
        })
    };
    let watcher = Watcher::start(
        automation.config().active(),
        Timing::default(),
        automation.produced.clone(),
        on_file,
        on_trouble,
    );
    *lock(&automation.watcher) = Some(watcher);
    // Files the last run kept for after its update.
    release(app);
}

/// Hands every kept file to its rule, while the rule still watches and still wants the file.
pub fn release(app: &AppHandle) {
    let Some(automation) = app.try_state::<Automation>() else {
        return;
    };
    let held = std::mem::take(&mut *lock(&automation.held));
    if held.is_empty() {
        return;
    }
    if let Err(err) = store::save_held(&automation.held_file, &[]) {
        tracing::warn!("the kept automation files were not cleared: {err}");
    }
    let rules = automation.config().active();
    for kept in held {
        match rules.iter().find(|rule| rule.id == kept.rule) {
            Some(rule) if kept.path.is_file() && watcher::wants(rule, &kept.path) => {
                dispatch(app, rule, &kept.path)
            }
            _ => tracing::info!("a kept automation file no longer fits its rule"),
        }
    }
}

/// Keeps a finished file for after the update's restart.
fn hold(automation: &Automation, rule: &Rule, path: &Path) {
    let mut held = lock(&automation.held);
    let kept = Held {
        rule: rule.id.clone(),
        path: path.to_path_buf(),
    };
    if !held.contains(&kept) {
        held.push(kept);
    }
    if let Err(err) = store::save_held(&automation.held_file, &held) {
        tracing::warn!("a file kept for after the update was not saved: {err}");
    }
}

/// Hands the active rules to the watcher after a change; the folders that failed are tried again.
fn sync(app: &AppHandle) {
    let automation = app.state::<Automation>();
    lock(&automation.trouble).clear();
    if let Some(watcher) = lock(&automation.watcher).as_ref() {
        watcher.set_rules(automation.config().active());
    }
    emit(app);
}

fn emit(app: &AppHandle) {
    let _ = app.emit("automation", ());
}

/// The rule's name, or its folder's when it has none.
fn display_name(rule: &Rule) -> String {
    let name = rule.name.trim();
    if !name.is_empty() {
        return name.to_owned();
    }
    rule.folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| rule.folder.display().to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Failure {
    title: String,
    message: String,
    details: Option<String>,
}

/// A failure shows in the main window when it has the focus, else as the corner card.
fn notify(app: &AppHandle, title: String, message: String, details: Option<String>) {
    let focused = app
        .get_webview_window(crate::window::MAIN)
        .is_some_and(|window| {
            window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false)
        });
    if focused {
        let failure = Failure {
            title,
            message,
            details,
        };
        let _ = app.emit_to(crate::window::MAIN, "automation-failed", failure);
    } else {
        crate::overlay::toast::alert(app, title, message, details);
    }
}

/// Why a finished file did not become a job.
enum Refusal {
    /// The action does not fit the file: a message key.
    Skip(&'static str),
    /// Something is wrong with the rule: a message and the details.
    Fail(String, Option<String>),
}

/// A finished file for a rule: a job, or an entry that says why not.
fn dispatch(app: &AppHandle, rule: &Rule, path: &Path) {
    let automation = app.state::<Automation>();
    let state = app.state::<AppState>();
    // An update waits to install and refuses new jobs: the file waits for the restart.
    if state.queue.refusal().is_some() {
        hold(&automation, rule, path);
        return;
    }
    let lang = state.lang();
    let mut entry = Activity {
        id: 0,
        at: 0,
        rule: rule.id.clone(),
        rule_name: display_name(rule),
        file: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        outcome: Outcome::Queued,
        message: None,
        outputs: Vec::new(),
    };
    // Held while the job is queued, so its end cannot be heard before it is known here.
    let mut jobs = lock(&automation.jobs);
    match start_job(app, &state, rule, path) {
        Ok(job) => {
            let id = lock(&automation.log).add(entry);
            jobs.insert(job, id);
        }
        Err(Refusal::Skip(key)) => {
            entry.outcome = Outcome::Skipped;
            entry.message = Some(i18n::text(&lang, key));
            lock(&automation.log).add(entry);
        }
        Err(Refusal::Fail(message, details)) => {
            let title = format!("{} · {}", entry.rule_name, entry.file);
            entry.outcome = Outcome::Failed;
            entry.message = Some(message.clone());
            lock(&automation.log).add(entry);
            notify(app, title, message, details);
        }
    }
    drop(jobs);
    automation.save_log();
    emit(app);
}

/// The job a rule's action makes of a file of a format.
#[derive(Debug)]
enum Work {
    Move,
    Convert(&'static Format, &'static Format),
    Extract(&'static Format),
    Mute(&'static Format),
    /// A media tool with its usual choices, on a video or a sound.
    Media(kento_engines::media::Tool, &'static Format),
    Recipe(Box<recipe::Recipe>, &'static Format, recipe::Plan),
}

/// Whether the rule's action fits a file of `format` (None: a kind Kento does not read).
fn decide(
    action: &Action,
    format: Option<&'static Format>,
    recipe: impl FnOnce(&str) -> Option<recipe::Recipe>,
    lang: &str,
) -> std::result::Result<Work, Refusal> {
    let unsupported = Refusal::Skip("automation.skipped.unsupported");
    let of_kind = |category: Category| {
        format
            .filter(|format| format.category == category)
            .ok_or(Refusal::Skip("automation.skipped.unsupported"))
    };
    Ok(match action {
        Action::Move => Work::Move,
        Action::Convert { to } => {
            let from = format.ok_or(unsupported)?;
            let target = catalog::format(to)
                .filter(|target| target.write)
                .ok_or(Refusal::Skip("automation.skipped.unsupported"))?;
            if from.id == target.id {
                return Err(Refusal::Skip("automation.skipped.already"));
            }
            if !work::usable(from.id, target.id) {
                return Err(Refusal::Skip("automation.skipped.unsupported"));
            }
            Work::Convert(from, target)
        }
        Action::Tool { tool } if tool == "extract" => Work::Extract(of_kind(Category::Archive)?),
        Action::Tool { tool } if tool == "mute" => Work::Mute(of_kind(Category::Video)?),
        Action::Tool { tool } if tool == "denoise" || tool == "remove-pauses" => {
            use kento_engines::media::{Pauses, Strength, Tool};
            let from = format
                .filter(|format| matches!(format.category, Category::Video | Category::Audio))
                .ok_or(unsupported)?;
            let tool = if tool == "denoise" {
                Tool::Denoise {
                    strength: Strength::Medium,
                    rumble: false,
                }
            } else {
                Tool::RemovePauses {
                    pauses: Pauses::default(),
                }
            };
            Work::Media(tool, from)
        }
        Action::Tool { .. } => return Err(unsupported),
        Action::Recipe { recipe: id } => {
            let recipe = recipe(id).ok_or_else(|| {
                Refusal::Fail(i18n::text(lang, "automation.problem.recipe"), None)
            })?;
            let from = format.ok_or(Refusal::Skip("automation.skipped.recipe"))?;
            let plan = recipes::plan_for(&recipe, from.id)
                .ok_or(Refusal::Skip("automation.skipped.recipe"))?;
            Work::Recipe(Box::new(recipe), from, plan)
        }
    })
}

fn start_job(
    app: &AppHandle,
    state: &AppState,
    rule: &Rule,
    path: &Path,
) -> std::result::Result<u64, Refusal> {
    let lang = state.lang();
    let format: Option<&'static Format> = work::entry(path)
        .filter(|entry| !entry.folder)
        .and_then(|entry| entry.format)
        .and_then(|id| catalog::format(&id));
    let work = decide(
        &rule.action,
        format,
        |id| app.state::<Recipes>().get(id),
        &lang,
    )?;
    if !is_writable(&rule.output) {
        return Err(Refusal::Fail(
            i18n::text(&lang, "automation.failed.output"),
            Some(rule.output.display().to_string()),
        ));
    }
    let ctx = Context::new(app, state)
        .map_err(|err| Refusal::Fail(i18n::text(&lang, "error.other"), Some(err.to_string())))?
        .into_folder(rule.output.clone());
    let source = path.to_path_buf();
    Ok(match work {
        Work::Move => crate::actions::transfer(&ctx, path, &rule.output, true),
        Work::Convert(from, to) => ctx.submit_conversion(source, from, to),
        Work::Extract(from) => crate::tools::submit_extract(&ctx, source, from),
        Work::Mute(from) => {
            crate::media::submit(&ctx, kento_engines::media::Tool::Mute, vec![source], from)
        }
        Work::Media(tool, from) => crate::media::submit(&ctx, tool, vec![source], from),
        Work::Recipe(recipe, from, plan) => recipes::submit(&ctx, &recipe, source, from, plan),
    })
}

/// Hears every job change: remembers what Kento wrote, and closes automation's own entries.
pub fn on_job(app: &AppHandle, info: &JobInfo) {
    if !info.state.is_finished() {
        return;
    }
    let Some(automation) = app.try_state::<Automation>() else {
        return;
    };
    if let JobState::Done { outputs } = &info.state {
        automation.produced.remember(outputs, Instant::now());
    }
    let Some(entry) = lock(&automation.jobs).remove(&info.id) else {
        return;
    };
    let (outcome, message, details, outputs) = match &info.state {
        JobState::Done { outputs } => (Outcome::Done, None, None, outputs.clone()),
        JobState::Failed { message, details } => (
            Outcome::Failed,
            Some(message.clone()),
            details.clone(),
            Vec::new(),
        ),
        _ => (Outcome::Cancelled, None, None, Vec::new()),
    };
    let updated = lock(&automation.log).update(entry, |activity| {
        activity.outcome = outcome;
        activity.message = message.clone();
        activity.outputs = outputs;
    });
    automation.save_log();
    emit(app);
    if let (Outcome::Failed, Some(activity)) = (outcome, updated) {
        notify(
            app,
            format!("{} · {}", activity.rule_name, activity.file),
            message.unwrap_or_default(),
            details,
        );
    }
}

/// A rule as the page lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleView {
    #[serde(flatten)]
    pub rule: Rule,
    /// The output folder is inside the watched folder (a warning).
    pub output_inside: bool,
    /// What stops the rule now, as a message key: a folder or the recipe is gone, or the folder
    /// cannot be watched.
    pub problem: Option<String>,
}

/// A format a rule or a recipe step can convert to.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub label: String,
    pub category: Category,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub paused: bool,
    pub rules: Vec<RuleView>,
    /// Newest first.
    pub activity: Vec<Activity>,
    pub targets: Vec<Target>,
    pub tools: Vec<String>,
}

fn view(automation: &Automation, recipes: &Recipes) -> View {
    let config = automation.config();
    let trouble = lock(&automation.trouble).clone();
    let known: Vec<String> = recipes.list().into_iter().map(|recipe| recipe.id).collect();
    let rules = config
        .rules
        .into_iter()
        .map(|rule| {
            let problem = if !rule.folder.is_dir() {
                Some("automation.problem.folder")
            } else if !rule.output.is_dir() {
                Some("automation.problem.output")
            } else if matches!(&rule.action, Action::Recipe { recipe } if !known.contains(recipe)) {
                Some("automation.problem.recipe")
            } else if trouble.contains_key(&rule.id) {
                Some("automation.problem.watch")
            } else {
                None
            };
            RuleView {
                output_inside: rules::output_inside(&rule),
                problem: problem.map(str::to_owned),
                rule,
            }
        })
        .collect();
    View {
        paused: config.paused,
        rules,
        activity: lock(&automation.log).entries(),
        targets: targets(),
        tools: rules::TOOLS.iter().map(|tool| tool.to_string()).collect(),
    }
}

/// Every format some file converts to in this version.
fn targets() -> Vec<Target> {
    catalog::formats()
        .iter()
        .filter(|format| {
            format.write
                && catalog::routes()
                    .iter()
                    .any(|route| route.to == format.id && work::usable(route.from, route.to))
        })
        .map(|format| Target {
            id: format.id.to_owned(),
            label: format.label.to_owned(),
            category: format.category,
        })
        .collect()
}

/// A short id no rule has yet.
fn new_id(rules: &[Rule]) -> String {
    (1..)
        .map(|n| format!("rule-{:x}-{n}", store::now_ms()))
        .find(|id| !rules.iter().any(|rule| rule.id == *id))
        .unwrap_or_default()
}

/// Changes the rules, saves them and hands the active ones to the watcher.
fn change(
    app: &AppHandle,
    automation: &Automation,
    edit: impl FnOnce(&mut Config) -> Result<()>,
) -> Result<()> {
    {
        let mut config = lock(&automation.config);
        let mut next = config.clone();
        edit(&mut next)?;
        store::save_config(&automation.file, &next)?;
        *config = next;
    }
    sync(app);
    Ok(())
}

#[tauri::command]
pub fn automation_view(automation: State<'_, Automation>, recipes: State<'_, Recipes>) -> View {
    view(&automation, &recipes)
}

/// A folder picked in the system's dialog; Kento remembers it, so the page can only save a rule
/// with folders the user chose.
#[tauri::command]
pub async fn automation_choose_folder(
    app: AppHandle,
    automation: State<'_, Automation>,
) -> Result<Option<PathBuf>> {
    let picked = crate::commands::choose_folder(app).await?;
    if let Some(folder) = &picked {
        let mut chosen = lock(&automation.chosen);
        if !chosen.contains(folder) {
            chosen.push(folder.clone());
        }
    }
    Ok(picked)
}

/// Adds a rule (no id) or replaces the one with its id.
#[tauri::command]
pub fn automation_save_rule(
    app: AppHandle,
    state: State<'_, AppState>,
    automation: State<'_, Automation>,
    recipes: State<'_, Recipes>,
    rule: Rule,
) -> Result<View> {
    let lang = state.lang();
    let refuse = |key: &str| Error::Invalid(i18n::text(&lang, key));
    let mut rule = Rule {
        name: rule.name.trim().to_owned(),
        filter: rule.filter.normalized(),
        ..rule
    };
    let old = automation
        .config()
        .rules
        .into_iter()
        .find(|known| !rule.id.is_empty() && known.id == rule.id);
    {
        let chosen = lock(&automation.chosen);
        let allowed = |path: &Path, before: Option<&PathBuf>| {
            before.is_some_and(|before| before == path) || chosen.iter().any(|c| c == path)
        };
        if !allowed(&rule.folder, old.as_ref().map(|old| &old.folder)) {
            return Err(refuse("automation.error.folder"));
        }
        if !allowed(&rule.output, old.as_ref().map(|old| &old.output)) {
            return Err(refuse("automation.error.output"));
        }
    }
    rules::check(&rule).map_err(refuse)?;
    if let Action::Recipe { recipe } = &rule.action {
        if recipes.get(recipe).is_none() {
            return Err(refuse("automation.problem.recipe"));
        }
    }
    change(&app, &automation, |config| {
        match config.rules.iter_mut().find(|known| known.id == rule.id) {
            Some(known) if old.is_some() => *known = rule,
            _ => {
                rule.id = new_id(&config.rules);
                config.rules.push(rule);
            }
        }
        Ok(())
    })?;
    Ok(view(&automation, &recipes))
}

#[tauri::command]
pub fn automation_delete_rule(
    app: AppHandle,
    automation: State<'_, Automation>,
    recipes: State<'_, Recipes>,
    id: String,
) -> Result<View> {
    change(&app, &automation, |config| {
        config.rules.retain(|rule| rule.id != id);
        Ok(())
    })?;
    Ok(view(&automation, &recipes))
}

/// One rule on or off.
#[tauri::command]
pub fn automation_set_enabled(
    app: AppHandle,
    automation: State<'_, Automation>,
    recipes: State<'_, Recipes>,
    id: String,
    enabled: bool,
) -> Result<View> {
    change(&app, &automation, |config| {
        let rule = config
            .rules
            .iter_mut()
            .find(|rule| rule.id == id)
            .ok_or_else(|| Error::Invalid("no such rule".into()))?;
        rule.enabled = enabled;
        Ok(())
    })?;
    Ok(view(&automation, &recipes))
}

/// Pause all, or resume.
#[tauri::command]
pub fn automation_set_paused(
    app: AppHandle,
    automation: State<'_, Automation>,
    recipes: State<'_, Recipes>,
    paused: bool,
) -> Result<View> {
    change(&app, &automation, |config| {
        config.paused = paused;
        Ok(())
    })?;
    Ok(view(&automation, &recipes))
}

#[tauri::command]
pub fn automation_clear_activity(
    app: AppHandle,
    automation: State<'_, Automation>,
    recipes: State<'_, Recipes>,
) -> Result<View> {
    {
        let mut log = lock(&automation.log);
        log.clear();
        log.save()?;
    }
    emit(&app);
    Ok(view(&automation, &recipes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_without_a_name_go_by_their_folder() {
        let rule = Rule {
            id: "k".into(),
            name: "  ".into(),
            enabled: true,
            folder: PathBuf::from("/Kullanıcılar/ayşe/Ekran Görüntüleri 🖼️"),
            subfolders: false,
            filter: rules::Filter::default(),
            action: Action::Move,
            output: PathBuf::from("/Arşiv"),
        };
        assert_eq!(display_name(&rule), "Ekran Görüntüleri 🖼️");
        let named = Rule {
            name: " Ekranlar ".into(),
            ..rule
        };
        assert_eq!(display_name(&named), "Ekranlar");
    }

    #[test]
    fn new_ids_do_not_clash() {
        let first = new_id(&[]);
        assert!(first.starts_with("rule-"));
        let rule = Rule {
            id: first.clone(),
            name: String::new(),
            enabled: true,
            folder: PathBuf::from("/a"),
            subfolders: false,
            filter: rules::Filter::default(),
            action: Action::Move,
            output: PathBuf::from("/b"),
        };
        assert_ne!(new_id(std::slice::from_ref(&rule)), first);
    }

    fn skipped(result: std::result::Result<Work, Refusal>) -> &'static str {
        match result {
            Err(Refusal::Skip(key)) => key,
            Err(Refusal::Fail(message, _)) => panic!("failed: {message}"),
            Ok(work) => panic!("took it: {work:?}"),
        }
    }

    #[test]
    fn actions_take_the_files_they_fit_and_skip_the_rest() {
        let format = |id: &str| catalog::format(id);
        let none = |_: &str| None;
        let webp = Action::Convert { to: "webp".into() };
        assert!(matches!(
            decide(&webp, format("png"), none, "en"),
            Ok(Work::Convert(from, to)) if from.id == "png" && to.id == "webp"
        ));
        assert_eq!(
            skipped(decide(&webp, format("webp"), none, "en")),
            "automation.skipped.already"
        );
        assert_eq!(
            skipped(decide(&webp, format("docx"), none, "en")),
            "automation.skipped.unsupported"
        );
        assert_eq!(
            skipped(decide(&webp, None, none, "en")),
            "automation.skipped.unsupported"
        );
        assert!(matches!(
            decide(&Action::Move, None, none, "en"),
            Ok(Work::Move)
        ));
        let extract = Action::Tool {
            tool: "extract".into(),
        };
        assert!(matches!(
            decide(&extract, format("zip"), none, "en"),
            Ok(Work::Extract(_))
        ));
        assert_eq!(
            skipped(decide(&extract, format("png"), none, "en")),
            "automation.skipped.unsupported"
        );
        let mute = Action::Tool {
            tool: "mute".into(),
        };
        assert!(matches!(
            decide(&mute, format("mp4"), none, "en"),
            Ok(Work::Mute(_))
        ));
        assert_eq!(
            skipped(decide(&mute, format("mp3"), none, "en")),
            "automation.skipped.unsupported"
        );
    }

    #[test]
    fn noise_and_pauses_go_with_their_usual_choices() {
        use kento_engines::media::{Pauses, Strength, Tool};
        let format = |id: &str| catalog::format(id);
        let none = |_: &str| None;
        let denoise = Action::Tool {
            tool: "denoise".into(),
        };
        for id in ["mp4", "mp3"] {
            assert!(matches!(
                decide(&denoise, format(id), none, "en"),
                Ok(Work::Media(Tool::Denoise { strength: Strength::Medium, rumble: false }, from))
                    if from.id == id
            ));
        }
        let pauses = Action::Tool {
            tool: "remove-pauses".into(),
        };
        assert!(matches!(
            decide(&pauses, format("wav"), none, "en"),
            Ok(Work::Media(Tool::RemovePauses { pauses }, _)) if pauses == Pauses::default()
        ));
        assert_eq!(
            skipped(decide(&pauses, format("png"), none, "en")),
            "automation.skipped.unsupported"
        );
        assert_eq!(
            skipped(decide(&denoise, None, none, "en")),
            "automation.skipped.unsupported"
        );
    }

    #[test]
    fn a_recipe_rule_needs_its_recipe_and_a_file_it_fits() {
        let format = |id: &str| catalog::format(id);
        let action = Action::Recipe {
            recipe: recipes::EXAMPLE_ID.into(),
        };
        let example = |id: &str| (id == recipes::EXAMPLE_ID).then(|| recipes::example("tr"));
        assert!(matches!(
            decide(&action, format("jpg"), example, "tr"),
            Ok(Work::Recipe(_, from, plan)) if from.id == "jpg" && plan.result() == "jpg"
        ));
        assert_eq!(
            skipped(decide(&action, format("mp3"), example, "tr")),
            "automation.skipped.recipe"
        );
        match decide(&action, format("jpg"), |_| None, "tr") {
            Err(Refusal::Fail(message, _)) => {
                assert_eq!(message, i18n::text("tr", "automation.problem.recipe"))
            }
            _ => panic!("a rule without its recipe fails"),
        }
    }

    #[test]
    fn conversion_targets_are_formats_kento_writes() {
        let ids: Vec<String> = targets().into_iter().map(|t| t.id).collect();
        assert!(ids.contains(&"webp".to_string()) && ids.contains(&"pdf".to_string()));
        assert!(
            !ids.contains(&"svg".to_string()),
            "SVG is read, never written"
        );
    }
}
