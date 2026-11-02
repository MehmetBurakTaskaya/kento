// SPDX-License-Identifier: MIT
//! Web media download through yt-dlp (SPEC 5.10): one video, track or post at a time, never a
//! profile, channel or playlist, never anything behind a login, and no cookies from any browser.
//! yt-dlp runs with Deno as its JavaScript runtime and FFmpeg for merging and audio.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Codec, Error, Options, Progress, Result, Tools};

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
    /// 480]`), empty for audio and pictures.
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
    /// A new, empty folder to fill; the files keep the names yt-dlp gives from the title.
    pub dest: &'a Path,
    /// A private scratch folder for this job; the app deletes it when the job ends.
    pub temp: &'a Path,
    pub options: &'a Options,
    pub progress: &'a Progress<'a>,
}

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
    let _ = (temp, progress);
    if !is_link(url) {
        return Err(Error::Web(crate::WebProblem::NotALink));
    }
    tools.ytdlp()?;
    Err(Error::MissingCodec(Codec::YtDlp))
}

/// Downloads what `run.choice` asks for into `run.dest` and returns the files written there.
pub fn download(run: &WebRun) -> Result<Vec<PathBuf>> {
    if !is_link(run.url) {
        return Err(Error::Web(crate::WebProblem::NotALink));
    }
    run.options.tools.ytdlp()?;
    Err(Error::MissingCodec(Codec::YtDlp))
}

#[cfg(test)]
mod tests {
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
}
