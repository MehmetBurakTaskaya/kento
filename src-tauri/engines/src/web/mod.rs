// SPDX-License-Identifier: MIT
//! Web media download through yt-dlp (SPEC 5.10): one video, track or post at a time, never a
//! profile, channel or playlist, never anything behind a login, and no cookies from any browser.
//! yt-dlp runs with Deno as its JavaScript runtime and FFmpeg for merging and audio.
//!
//! yt-dlp runs as a process of its own for every probe and download (`process.rs`: arguments as
//! an array, no console window, a cancel that ends what it started). It reads no configuration,
//! plugin or cookie, never updates itself and keeps every file it writes, its temporary files and
//! Deno's cache inside the job's scratch folder. Only finished files leave it: Kento moves them
//! into the destination under names it makes from the title.

mod args;
mod info;
mod names;
mod problem;
mod progress;
mod run;

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::{Error, Options, Progress, Result, Tools, WebProblem};
use progress::{Line, Meter};
use run::{Dirs, Flow, Job};

/// The sites with a flow of their own; everything else yt-dlp knows is `Other`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Site {
    YouTube,
    Instagram,
    Other,
}

/// What a link holds, which decides the choices offered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WebKind {
    /// A video, possibly with sound.
    Video,
    /// Sound only (a track, a podcast episode).
    Audio,
    /// One or more pictures (an Instagram photo post, an image page).
    Images,
}

/// A picture of a photo post, in the post's order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebImage {
    /// 0-based place in the post.
    pub index: usize,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// A small preview the picker may show (a remote address; the page fetches it).
    pub preview: Option<String>,
}

/// What yt-dlp found at a link, for the download dialog.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebInfo {
    /// The address as given, trimmed.
    pub url: String,
    pub site: Site,
    pub kind: WebKind,
    pub title: String,
    /// Seconds, for video and audio.
    pub duration: Option<f64>,
    /// The simplified quality list: frame heights available, highest first (`[2160, 1080, 720,
    /// 480]`), empty for audio and pictures. Each is the shorter side of the frame, as quality
    /// names go (a 1080 × 1920 vertical video is 1080), rounded to the usual steps.
    pub heights: Vec<u32>,
    /// Whether the thumbnail can be downloaded on its own (YouTube).
    pub thumbnail: bool,
    /// The pictures of a photo post, in order; empty otherwise.
    pub images: Vec<WebImage>,
}

/// What to download from a link.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WebChoice {
    /// The video with its sound as MP4, at most this frame height (None: the best there is).
    #[serde(rename_all = "camelCase")]
    Video { max_height: Option<u32> },
    /// The sound only, as MP3.
    Audio,
    /// The thumbnail on its own, as JPG.
    Thumbnail,
    /// These pictures of a photo post (indexes from `WebInfo::images`), saved in the post's
    /// order.
    Images { indexes: Vec<usize> },
    /// The media as the site serves it, unconverted.
    Original,
}

/// One download.
pub struct WebRun<'a> {
    pub url: &'a str,
    pub choice: &'a WebChoice,
    /// A new, empty folder to fill; the files are named from the title.
    pub dest: &'a Path,
    /// A private scratch folder for this job; the app deletes it when the job ends.
    pub temp: &'a Path,
    pub options: &'a Options,
    pub progress: &'a Progress<'a>,
}

/// A probe that takes longer is stopped: finding what a page holds takes seconds, even with
/// YouTube's player script run through Deno.
const PROBE_LIMIT: Duration = Duration::from_secs(180);

/// Whether `text` is a link Kento would try: one http or https address, nothing else.
pub fn is_link(text: &str) -> bool {
    let text = text.trim();
    let lower = text.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && text.len() > "https://".len()
        && !text.chars().any(char::is_whitespace)
}

/// Asks yt-dlp what the link holds, without downloading it.
pub fn probe(tools: &Tools, url: &str, temp: &Path, progress: &Progress) -> Result<WebInfo> {
    let url = checked(url)?;
    let (ytdlp, deno, ffmpeg) = (tools.ytdlp()?, tools.deno()?, tools.ffmpeg()?);
    let dirs = Dirs::new(temp)?;
    let args = args::probe(deno, ffmpeg, url);
    let job = Job {
        program: ytdlp,
        args: &args,
        dirs: &dirs,
        progress,
        capture: true,
        timeout: Some(PROBE_LIMIT),
    };
    let outcome = run::run(&job, |_| Flow::Go)?;
    let Some(json) = run::json(&outcome.stdout) else {
        return Err(problem::failure(&outcome.log, outcome.status.success()));
    };
    let found = match info::map(url, &json, &outcome.log.warnings) {
        // YouTube without its challenge solved shows few or no formats: say why.
        Err(Error::Web(WebProblem::NoMedia)) => return Err(problem::no_media(&outcome.log)),
        other => other?,
    };
    let mut info = found.info;
    if let Some(direct) = found.direct {
        // yt-dlp does not open a plain file to learn its frame size; ffprobe reads its header.
        if let Some(height) = run::direct_height(tools, &direct, progress) {
            info.heights = vec![height];
        }
        progress.check()?;
    }
    Ok(info)
}

/// Downloads what `run.choice` asks for into `run.dest` and returns the files written there.
pub fn download(run: &WebRun) -> Result<Vec<PathBuf>> {
    let url = checked(run.url)?;
    let tools = &run.options.tools;
    let (ytdlp, deno, ffmpeg) = (tools.ytdlp()?, tools.deno()?, tools.ffmpeg()?);
    if let WebChoice::Images { indexes } = run.choice {
        if indexes.is_empty() {
            return Err(Error::Other("no pictures were chosen".into()));
        }
    }
    let dirs = Dirs::new(run.temp)?;
    let args = args::download(deno, ffmpeg, &dirs, run.choice, url);
    let post = instagram_post(url);
    let mut meter = Meter::new(match run.choice {
        // Turning the sound into MP3 takes a while; merging and remuxing copy streams.
        WebChoice::Audio => 0.15,
        _ => 0.05,
    });
    let mut items = Vec::new();
    let job = Job {
        program: ytdlp,
        args: &args,
        dirs: &dirs,
        progress: run.progress,
        capture: false,
        timeout: None,
    };
    let outcome = run::run(&job, |line| match progress::parse(line) {
        Some(Line::Step(step)) => {
            if let Some(at) = meter.step(&step) {
                run.progress.report(at);
            }
            Flow::Go
        }
        Some(Line::Post) => {
            run.progress.report(meter.post());
            Flow::Go
        }
        // yt-dlp names each video before it downloads it: a live stream, or one video of a
        // playlist the link turned out to be, stops the run there.
        Some(Line::Item(item)) => match progress::refused(&item, post) {
            Some(problem) => Flow::Stop(Error::Web(problem)),
            None => {
                items.push(item);
                Flow::Go
            }
        },
        None => Flow::Go,
    })?;
    run.progress.check()?;
    let mut finished = names::finished(&dirs.out)?;
    // A converted result is the result; the file it was made from is not (a WebP thumbnail
    // beside its JPG, say, should a build keep it).
    let converted = match run.choice {
        WebChoice::Video { .. } => Some("mp4"),
        WebChoice::Audio => Some("mp3"),
        WebChoice::Thumbnail => Some("jpg"),
        WebChoice::Images { .. } | WebChoice::Original => None,
    };
    if let Some(ext) = converted {
        if finished.iter().any(|file| file.ext == ext) {
            finished.retain(|file| file.ext == ext);
        }
    }
    if finished.is_empty() {
        return Err(problem::failure(&outcome.log, outcome.status.success()));
    }
    if !outcome.status.success() {
        // Some pictures of a post may fail while others arrive; those are kept.
        tracing::warn!(
            "yt-dlp ended with {} after writing {} file(s)",
            outcome.status,
            finished.len()
        );
    }
    let base = names::base(progress::title(&items), url);
    let targets = names::numbered(&base, &finished);
    let written = names::place(&finished, &targets, run.dest, run.progress)?;
    run.progress.report(1.0);
    Ok(written)
}

/// The link, trimmed, when Kento downloads from it. A `blob:` address is what a page's player
/// hands out instead of its media; the share link of the post works instead.
fn checked(url: &str) -> Result<&str> {
    let url = url.trim();
    if url.to_ascii_lowercase().starts_with("blob:") {
        return Err(Error::Web(WebProblem::NoMedia));
    }
    if !is_link(url) {
        return Err(Error::Web(WebProblem::NotALink));
    }
    Ok(url)
}

/// The host of an http(s) address, lower case and without `www.`, a port or a user name.
pub(crate) fn host(url: &str) -> Option<String> {
    let (_, rest) = url.trim().split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    let host = if authority.starts_with('[') {
        authority.split_inclusive(']').next()?
    } else {
        authority.split(':').next()?
    };
    let host = host.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_owned();
    (!host.is_empty()).then_some(host)
}

/// Whether the link is one Instagram post or reel, the only kind of link that may hold several
/// items (a carousel's pictures and videos).
fn instagram_post(url: &str) -> bool {
    let instagram = host(url).is_some_and(|host| {
        host == "instagram.com" || host.ends_with(".instagram.com") || host == "instagr.am"
    });
    let path = url
        .split_once("://")
        .and_then(|(_, rest)| rest.split_once('/'))
        .map_or("", |(_, path)| path);
    let path = path.split(['?', '#']).next().unwrap_or("");
    instagram
        && path
            .split('/')
            .any(|part| matches!(part, "p" | "reel" | "reels" | "tv" | "share"))
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn links_are_one_web_address() {
        assert!(is_link("https://www.youtube.com/watch?v=abc"));
        assert!(is_link("  HTTP://example.org/a  "));
        assert!(!is_link("https://"));
        assert!(!is_link("ftp://example.org/a"));
        assert!(!is_link("file:///C:/a.mp4"));
        assert!(!is_link("https://a.org/x https://b.org/y"));
        assert!(!is_link("watch this: https://a.org/x"));
    }

    #[test]
    fn a_blob_address_points_to_the_share_link() {
        assert!(matches!(
            checked("blob:https://www.instagram.com/5f0c-11"),
            Err(Error::Web(WebProblem::NoMedia))
        ));
        assert!(matches!(
            checked("javascript:alert(1)"),
            Err(Error::Web(WebProblem::NotALink))
        ));
        assert_eq!(checked("  https://a.org/x ").unwrap(), "https://a.org/x");
    }

    #[test]
    fn hosts_and_instagram_posts() {
        assert_eq!(
            host("https://www.YouTube.com/watch?v=a").as_deref(),
            Some("youtube.com")
        );
        assert_eq!(
            host("http://user@127.0.0.1:8080/a.mp4").as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(host("https://[::1]:80/x").as_deref(), Some("[::1]"));
        assert_eq!(host("nothing"), None);
        assert!(instagram_post("https://www.instagram.com/p/C1abc/"));
        assert!(instagram_post("https://instagram.com/reel/C1abc/?igsh=x"));
        assert!(instagram_post(
            "https://www.instagram.com/kento.test/p/C1abc/"
        ));
        assert!(!instagram_post("https://www.instagram.com/kento.test/"));
        assert!(!instagram_post("https://example.org/p/abc"));
    }

    #[test]
    fn missing_tools_are_reported_before_anything_runs() {
        let dir = tempfile::tempdir().unwrap();
        let result = probe(
            &Tools::default(),
            "https://example.org/a",
            dir.path(),
            &Progress::none(),
        );
        assert!(matches!(
            result,
            Err(Error::MissingCodec(crate::Codec::YtDlp))
        ));
        assert!(
            std::fs::read_dir(dir.path()).unwrap().next().is_none(),
            "nothing is written before the tools are there"
        );
        let options = Options::default();
        let run = WebRun {
            url: "notalink",
            choice: &WebChoice::Audio,
            dest: dir.path(),
            temp: dir.path(),
            options: &options,
            progress: &Progress::none(),
        };
        assert!(matches!(
            download(&run),
            Err(Error::Web(WebProblem::NotALink))
        ));
    }
}
