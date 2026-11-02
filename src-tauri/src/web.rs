// SPDX-License-Identifier: MIT
//! Web media download, the app's side (SPEC 5.10): what a link holds (a probe off the main
//! thread), the download as a job into a new folder, the folder it goes to, the pictures of a
//! photo post for the picker, and the download dialog opened from the wheel or the shortcut.
//! Links and folders are checked here; yt-dlp itself runs in the engines (`kento_engines::web`).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, Once};
use std::time::Duration;

use kento_engines::web::{self as engine, WebChoice, WebInfo, WebRun};
use kento_engines::{Error as EngineError, Options, Progress, Tools, WebProblem};
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::catalog::ToolGroup;
use crate::commands::Saved;
use crate::error::{Error, Result};
use crate::jobs::engine::{Target, Work};
use crate::jobs::naming::is_writable;
use crate::library::Origin;
use crate::overlay::toast;
use crate::settings::{Output, OutputLocation};
use crate::work::{engine_tools, error_key, Context};
use crate::{i18n, AppState};

/// How many probes are kept, for the folder name and the picture previews.
const REMEMBER: usize = 16;
/// A preview is small; anything larger is not one.
const PREVIEW_LIMIT: usize = 4 * 1024 * 1024;
/// Folder names are cut to this many characters, leaving room for the files inside.
const NAME_LIMIT: usize = 80;

#[derive(Default)]
pub struct WebState {
    /// The last probes, newest first, under the link as Kento took it.
    probes: Mutex<VecDeque<(String, WebInfo)>>,
    /// Folders picked in the system's dialog this session; only these, or the default folder,
    /// take a download.
    chosen: Mutex<Vec<PathBuf>>,
    /// A link the main window opens the dialog for once it is ready.
    pending: Mutex<Option<String>>,
    probes_run: AtomicU64,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

impl WebState {
    fn remember(&self, url: &str, info: WebInfo) {
        let mut probes = lock(&self.probes);
        probes.retain(|(known, _)| known != url);
        probes.push_front((url.to_string(), info));
        probes.truncate(REMEMBER);
    }

    fn probed(&self, url: &str) -> Option<WebInfo> {
        lock(&self.probes)
            .iter()
            .find(|(known, _)| known == url)
            .map(|(_, info)| info.clone())
    }
}

/// Why a link cannot be used, for the dialog: the key of the plain-language message, and the
/// technical details for "Copy details".
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WebError {
    pub key: &'static str,
    pub details: String,
}

impl WebError {
    fn of(error: &EngineError) -> Self {
        Self {
            key: error_key(error),
            details: error.to_string(),
        }
    }
}

/// The link as Kento takes it: one http or https address, trimmed.
fn link(url: &str) -> std::result::Result<String, WebError> {
    let url = url.trim();
    if engine::is_link(url) {
        Ok(url.to_string())
    } else {
        Err(WebError::of(&EngineError::Web(WebProblem::NotALink)))
    }
}

fn invalid_link(error: WebError) -> Error {
    Error::Invalid(error.details)
}

/// The tool group web downloads still need: yt-dlp and Deno, and FFmpeg for joining video and
/// sound and for MP3, all in the Media group (SPEC 4.2).
pub fn needs(tools: &Tools) -> Option<ToolGroup> {
    let ready = tools.ytdlp.is_some()
        && tools.deno.is_some()
        && tools.ffmpeg.is_some()
        && tools.ffprobe.is_some();
    (!ready).then_some(ToolGroup::Media)
}

/// Whether downloading works now; the wheel dims its download slices and the dialog offers the
/// setup otherwise.
#[tauri::command]
pub fn web_needs(state: State<'_, AppState>) -> Option<ToolGroup> {
    needs(&engine_tools(&state))
}

/// What the link holds, for the dialog. yt-dlp runs on a blocking thread with a scratch folder of
/// its own, which goes when the probe ends.
#[tauri::command]
pub async fn web_probe(
    state: State<'_, AppState>,
    url: String,
) -> std::result::Result<WebInfo, WebError> {
    let url = link(&url)?;
    let tools = engine_tools(&state);
    let run = state.web.probes_run.fetch_add(1, Ordering::Relaxed);
    let scratch = state.paths.temp.join(format!("probe-{run}"));
    let address = url.clone();
    let probed = tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&scratch)?;
        let found = engine::probe(&tools, &address, &scratch, &Progress::none());
        let _ = std::fs::remove_dir_all(&scratch);
        found
    })
    .await
    .map_err(|err| WebError {
        key: "error.other",
        details: err.to_string(),
    })?;
    match probed {
        Ok(info) => {
            state.web.remember(&url, info.clone());
            Ok(info)
        }
        Err(err) => {
            let problem = WebError::of(&err);
            // The link and yt-dlp's words stay out of the log; the kind of problem is enough.
            tracing::info!("a link could not be read ({})", problem.key);
            Err(problem)
        }
    }
}

/// The preview of one picture of a probed photo post. Kento fetches it, so the page needs no
/// network access; only the https address the probe reported is fetched, and only a picture.
#[tauri::command]
pub async fn web_preview(
    state: State<'_, AppState>,
    url: String,
    index: usize,
) -> Result<Response> {
    let address = state
        .web
        .probed(url.trim())
        .and_then(|info| info.images.into_iter().find(|image| image.index == index))
        .and_then(|image| image.preview)
        .filter(|preview| {
            preview
                .get(..8)
                .is_some_and(|s| s.eq_ignore_ascii_case("https://"))
        })
        .filter(|preview| engine::is_link(preview))
        .ok_or_else(|| Error::Invalid("no preview for this picture".into()))?;
    Ok(Response::new(fetch_preview(&address).await?))
}

fn network(err: reqwest::Error) -> Error {
    Error::Invalid(format!("preview: {err}"))
}

async fn fetch_preview(address: &str) -> Result<Vec<u8>> {
    static PROVIDER: Once = Once::new();
    PROVIDER.call_once(|| {
        // Fails only when a provider is installed already, which is just as good.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    let client = reqwest::Client::builder()
        .user_agent(concat!("Kento/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(network)?;
    let mut response = client
        .get(address)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(network)?;
    let picture = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|kind| kind.to_str().ok())
        .is_some_and(|kind| kind.trim_start().to_ascii_lowercase().starts_with("image/"));
    if !picture {
        return Err(Error::Invalid("the preview is not a picture".into()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > PREVIEW_LIMIT {
            return Err(Error::Invalid("the preview is too large".into()));
        }
    }
    Ok(bytes)
}

/// Where a download goes unless the user picks another folder: the fixed output folder of
/// Settings when one is set, else Downloads/Kento. A link has no folder of its own to go next to
/// (SPEC 5.14).
pub fn default_folder(output: &Output, downloads: &Path) -> PathBuf {
    match (output.location, &output.folder) {
        (OutputLocation::Folder, Some(folder)) if is_writable(folder) => folder.clone(),
        _ => downloads.to_path_buf(),
    }
}

fn downloads(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().download_dir()?.join(crate::paths::APP_DIR))
}

/// The folder the dialog shows before the user picks one.
#[tauri::command]
pub fn web_default_folder(app: AppHandle, state: State<'_, AppState>) -> Result<PathBuf> {
    Ok(default_folder(&state.settings().output, &downloads(&app)?))
}

/// Another folder, picked in the system's dialog; Kento remembers it, so the page can only send
/// back a folder the user chose.
#[tauri::command]
pub async fn web_choose_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<PathBuf>> {
    let picked = crate::commands::choose_folder(app).await?;
    if let Some(folder) = &picked {
        let mut chosen = lock(&state.web.chosen);
        if !chosen.contains(folder) {
            chosen.push(folder.clone());
        }
    }
    Ok(picked)
}

/// Where an output without a source file goes (a QR code): the folder the user picked in
/// `web_choose_folder` this session, else the default one the dialog shows.
pub(crate) fn output_folder(
    app: &AppHandle,
    state: &AppState,
    requested: Option<&Path>,
) -> Result<PathBuf> {
    let downloads = downloads(app)?;
    std::fs::create_dir_all(&downloads)?;
    let default = default_folder(&state.settings().output, &downloads);
    target_folder(requested, &lock(&state.web.chosen), &default)
}

/// The folder a download goes to: the default, or one the user picked this session. Any other
/// folder the page names is refused.
fn target_folder(requested: Option<&Path>, chosen: &[PathBuf], default: &Path) -> Result<PathBuf> {
    let Some(folder) = requested else {
        return Ok(default.to_path_buf());
    };
    if folder != default && !chosen.iter().any(|known| known == folder) {
        return Err(Error::Invalid("this folder was not chosen in Kento".into()));
    }
    if !is_writable(folder) {
        return Err(Error::Invalid("this folder cannot be written to".into()));
    }
    Ok(folder.to_path_buf())
}

/// The choice as the engine gets it, or an error for one the dialog and the wheel never make:
/// pictures of a photo post are taken in the post's order, each once.
fn checked(choice: WebChoice) -> Result<WebChoice> {
    let fine = match &choice {
        WebChoice::Video { max_height } => max_height.is_none_or(|h| (144..=8640).contains(&h)),
        WebChoice::Images { indexes } => !indexes.is_empty() && indexes.len() <= 1000,
        WebChoice::Audio | WebChoice::Thumbnail | WebChoice::Original => true,
    };
    if !fine {
        return Err(Error::Invalid(format!("{choice:?} is not offered")));
    }
    Ok(match choice {
        WebChoice::Images { mut indexes } => {
            indexes.sort_unstable();
            indexes.dedup();
            WebChoice::Images { indexes }
        }
        other => other,
    })
}

/// The download's folder name: the title of the probe when there was one, else the site's name
/// ("youtube.com"), else `fallback`; always a valid folder name on Windows and macOS.
fn folder_name(title: Option<&str>, url: &str, fallback: &str) -> String {
    title
        .and_then(safe_name)
        .or_else(|| site(url).as_deref().and_then(safe_name))
        .or_else(|| safe_name(fallback))
        .unwrap_or_else(|| "Kento".to_string())
}

/// "https://www.youtube.com:443/watch?v=…" → "youtube.com".
fn site(url: &str) -> Option<String> {
    let rest = url.trim().split_once("://")?.1;
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit('@').next()?;
    let host = host.split(':').next()?.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    (!host.is_empty()).then_some(host)
}

/// A title made a folder name: characters Windows forbids become spaces, runs of space shrink,
/// the end loses dots and spaces (Windows drops them) and the start its dots (hidden on macOS),
/// device names get a leading "_", and the length stays modest.
pub(crate) fn safe_name(text: &str) -> Option<String> {
    let cleaned: String = text
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = joined.chars().take(NAME_LIMIT).collect();
    let mut name = cut.trim_matches(['.', ' ']).to_string();
    if name.is_empty() {
        return None;
    }
    if reserved(&name) {
        name.insert(0, '_');
    }
    Some(name)
}

/// Device names Windows reserves in every folder, also with an extension.
fn reserved(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
}

/// Downloads from a link as a job: into a new folder, named after the title, in the chosen or
/// the default folder, with progress, cancel and a Library entry like every job.
#[tauri::command]
pub fn web_download(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    url: String,
    choice: WebChoice,
    folder: Option<PathBuf>,
) -> Result<u64> {
    let url = link(&url).map_err(invalid_link)?;
    let choice = checked(choice)?;
    let downloads = downloads(&app)?;
    std::fs::create_dir_all(&downloads)?;
    let default = default_folder(&state.settings().output, &downloads);
    let dir = target_folder(folder.as_deref(), &lock(&state.web.chosen), &default)?;
    let ctx = Context::new(&app, &state)?;
    let title = state.web.probed(&url).map(|info| info.title);
    let name = folder_name(title.as_deref(), &url, &ctx.text("web.folder"));
    let job = format!("{} · {name}", ctx.text("web.job"));
    let tools = ctx.tools();
    let work: Work = Box::new(move |dest, temp, progress| {
        let options = Options {
            tools,
            ..Options::default()
        };
        engine::download(&WebRun {
            url: &url,
            choice: &choice,
            dest,
            temp,
            options: &options,
            progress,
        })
        .map(|_| ())
    });
    let id = ctx.submit(
        job,
        Target::Folder { dir, name },
        work,
        Origin::Download,
        None,
    );
    crate::actions::watch(&window, &state, &[id]);
    // The dialog shows the first-use notice itself; a quick download from the wheel shows it in
    // the corner card.
    if window.label() != crate::window::MAIN {
        first_use(&app, &state);
    }
    Ok(id)
}

/// "Only download content you have the right to download", once ever (SPEC 5.10).
fn first_use(app: &AppHandle, state: &AppState) {
    let mut settings = state.settings();
    if settings.web.notice_shown {
        return;
    }
    settings.web.notice_shown = true;
    state.replace_settings(settings.clone());
    if let Err(err) = crate::settings::save(&state.paths.settings_file(), &settings) {
        tracing::warn!("settings not saved: {err}");
    }
    let lang = state.lang();
    let _ = app.emit(
        "settings",
        Saved {
            settings,
            language: lang.clone(),
        },
    );
    toast::note(app, i18n::text(&lang, "web.notice"));
}

/// Opens the download dialog in the main window for a link.
pub fn open_dialog(app: &AppHandle, url: String) -> Result<()> {
    *lock(&app.state::<AppState>().web.pending) = Some(url);
    crate::window::show_main(app, None)?;
    // A window that is open takes the link at once; a new one asks when it is ready.
    let _ = app.emit_to(crate::window::MAIN, "web-open", ());
    Ok(())
}

/// The wheel's More…: the dialog in the main window, with every choice.
#[tauri::command]
pub fn web_open(app: AppHandle, url: String) -> Result<()> {
    let url = link(&url).map_err(invalid_link)?;
    open_dialog(&app, url)
}

/// The link the main window should open the dialog for, once.
#[tauri::command]
pub fn web_take_pending(state: State<'_, AppState>) -> Option<String> {
    lock(&state.web.pending).take()
}

/// The download shortcut: reads the clipboard once, at this moment (Kento never watches it), and
/// opens the dialog for the link on it, or says there is none.
pub fn open_from_clipboard(app: &AppHandle) {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let text = app.clipboard().read_text().unwrap_or_default();
    match clipboard_link(&text) {
        Some(url) => {
            if let Err(err) = open_dialog(app, url) {
                tracing::warn!("the download dialog could not be opened: {err}");
            }
        }
        None => {
            let lang = app.state::<AppState>().lang();
            toast::note(app, i18n::text(&lang, "web.shortcut.none"));
        }
    }
}

fn clipboard_link(text: &str) -> Option<String> {
    link(text).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_are_checked_before_anything_runs() {
        assert_eq!(
            link("  https://www.youtube.com/watch?v=abc \n").unwrap(),
            "https://www.youtube.com/watch?v=abc"
        );
        for refused in [
            "",
            "youtube.com/watch",
            "file:///C:/a.mp4",
            "https://a.org b",
        ] {
            let error = link(refused).unwrap_err();
            assert_eq!(error.key, "error.web.not-a-link", "{refused}");
        }
        assert_eq!(
            clipboard_link("https://www.instagram.com/p/xyz/"),
            Some("https://www.instagram.com/p/xyz/".into())
        );
        assert_eq!(clipboard_link("a note with https://a.org in it"), None);
    }

    #[test]
    fn engine_problems_reach_the_dialog_as_message_keys() {
        assert_eq!(
            WebError::of(&EngineError::Web(WebProblem::NoMedia)).key,
            "error.web.no-media"
        );
        assert_eq!(
            WebError::of(&EngineError::MissingCodec(kento_engines::Codec::YtDlp)).key,
            "error.codec.ytdlp"
        );
        let json = serde_json::to_value(WebError::of(&EngineError::Web(WebProblem::Drm))).unwrap();
        assert_eq!(json["key"], "error.web.drm");
        assert_eq!(json["details"], "web download: protected by DRM");
    }

    #[test]
    fn downloading_needs_ytdlp_deno_and_ffmpeg() {
        let path = |name: &str| Some(PathBuf::from(name));
        let all = Tools {
            ffmpeg: path("ffmpeg"),
            ffprobe: path("ffprobe"),
            ytdlp: path("yt-dlp"),
            deno: path("deno"),
            ..Tools::default()
        };
        assert_eq!(needs(&all), None);
        for missing in [
            Tools {
                ytdlp: None,
                ..all.clone()
            },
            Tools {
                deno: None,
                ..all.clone()
            },
            Tools {
                ffmpeg: None,
                ..all.clone()
            },
            Tools::default(),
        ] {
            assert_eq!(needs(&missing), Some(ToolGroup::Media));
        }
    }

    #[test]
    fn the_default_folder_is_the_fixed_output_folder_or_downloads() {
        let dir = tempfile::tempdir().unwrap();
        let downloads = dir.path().join("Downloads").join("Kento");
        let fixed = dir.path().join("Çıktılar 🎈");
        std::fs::create_dir_all(&fixed).unwrap();
        let next_to_source = Output::default();
        assert_eq!(default_folder(&next_to_source, &downloads), downloads);
        let folder = Output {
            location: OutputLocation::Folder,
            folder: Some(fixed.clone()),
        };
        assert_eq!(default_folder(&folder, &downloads), fixed);
        // A folder set earlier but not in use, or gone, does not count.
        let unused = Output {
            location: OutputLocation::NextToSource,
            folder: Some(fixed.clone()),
        };
        assert_eq!(default_folder(&unused, &downloads), downloads);
        let gone = Output {
            location: OutputLocation::Folder,
            folder: Some(dir.path().join("gone")),
        };
        assert_eq!(default_folder(&gone, &downloads), downloads);
    }

    #[test]
    fn only_the_default_or_a_chosen_folder_takes_a_download() {
        let dir = tempfile::tempdir().unwrap();
        let default = dir.path().join("Kento");
        let picked = dir.path().join("Videolar ğüş");
        let other = dir.path().join("Elsewhere");
        for folder in [&default, &picked, &other] {
            std::fs::create_dir_all(folder).unwrap();
        }
        let chosen = vec![picked.clone()];
        assert_eq!(target_folder(None, &chosen, &default).unwrap(), default);
        assert_eq!(
            target_folder(Some(&default), &chosen, &default).unwrap(),
            default
        );
        assert_eq!(
            target_folder(Some(&picked), &chosen, &default).unwrap(),
            picked
        );
        assert!(target_folder(Some(&other), &chosen, &default).is_err());
        let gone = dir.path().join("gone");
        assert!(target_folder(Some(&gone), std::slice::from_ref(&gone), &default).is_err());
    }

    #[test]
    fn choices_outside_the_offered_ones_are_refused() {
        assert_eq!(
            checked(WebChoice::Video {
                max_height: Some(1080)
            })
            .unwrap(),
            WebChoice::Video {
                max_height: Some(1080)
            }
        );
        assert!(checked(WebChoice::Video { max_height: None }).is_ok());
        assert!(checked(WebChoice::Video {
            max_height: Some(0)
        })
        .is_err());
        assert!(checked(WebChoice::Images { indexes: vec![] }).is_err());
        // Pictures are saved in the post's order, each once.
        assert_eq!(
            checked(WebChoice::Images {
                indexes: vec![3, 0, 2, 0]
            })
            .unwrap(),
            WebChoice::Images {
                indexes: vec![0, 2, 3]
            }
        );
        for plain in [WebChoice::Audio, WebChoice::Thumbnail, WebChoice::Original] {
            assert_eq!(checked(plain.clone()).unwrap(), plain);
        }
    }

    #[test]
    fn the_folder_takes_the_title_or_the_site() {
        let url = "https://www.youtube.com/watch?v=abc";
        assert_eq!(
            folder_name(Some("Kapadokya: balonlar / 2026 🎈"), url, "Web download"),
            "Kapadokya balonlar 2026 🎈"
        );
        assert_eq!(folder_name(None, url, "Web download"), "youtube.com");
        assert_eq!(
            folder_name(Some(" ... "), "https://user@Example.ORG:8080/a", "x"),
            "example.org"
        );
        assert_eq!(
            folder_name(None, "https://", "Web indirmesi"),
            "Web indirmesi"
        );
        assert_eq!(folder_name(Some("CON"), url, "x"), "_CON");
        assert_eq!(folder_name(Some("lpt1.mp4"), url, "x"), "_lpt1.mp4");
        assert_eq!(folder_name(Some(".hidden."), url, "x"), "hidden");
        let long = "ğ".repeat(200);
        assert_eq!(
            folder_name(Some(&long), url, "x").chars().count(),
            NAME_LIMIT
        );
    }

    #[test]
    fn probes_are_remembered_newest_first_and_kept_few() {
        let state = WebState::default();
        let info = |title: &str| WebInfo {
            url: "https://a.org/".into(),
            site: engine::Site::Other,
            kind: engine::WebKind::Video,
            title: title.into(),
            duration: None,
            heights: vec![],
            thumbnail: false,
            images: vec![],
        };
        state.remember("https://a.org/", info("first"));
        state.remember("https://a.org/", info("again"));
        assert_eq!(state.probed("https://a.org/").unwrap().title, "again");
        for n in 0..REMEMBER {
            state.remember(&format!("https://b.org/{n}"), info("b"));
        }
        assert!(state.probed("https://a.org/").is_none());
        assert_eq!(lock(&state.probes).len(), REMEMBER);
    }
}
