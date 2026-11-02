// SPDX-License-Identifier: MIT
//! What yt-dlp's `--dump-single-json` says about a link, as `WebInfo`. The fields read are the
//! documented ones (README, "Output template" and "Format selection"); any of them may be
//! missing, and a missing one never fails the probe on its own.

use serde_json::Value;

use super::{host, Site, WebImage, WebInfo, WebKind};
use crate::{Error, Result, WebProblem};

/// The simplified quality list snaps every frame to one of these.
pub(super) const STEPS: [u32; 6] = [2160, 1440, 1080, 720, 480, 360];

/// Formats that are pictures rather than video.
const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif", "bmp",
];
/// Containers that hold sound only, for formats whose codecs the site does not name.
const AUDIO_EXTS: &[&str] = &[
    "mp3", "m4a", "aac", "opus", "ogg", "oga", "wav", "flac", "weba", "mka", "aiff",
];

/// The probe's result, and the file to measure when yt-dlp could not tell its frame size.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Found {
    pub info: WebInfo,
    pub direct: Option<Direct>,
}

/// A plain media file on a web server, which ffprobe can read for its frame size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Direct {
    pub url: String,
    pub user_agent: Option<String>,
    pub referer: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Media {
    Video,
    Audio,
    Picture,
    Nothing,
}

/// The JSON of one link as `WebInfo`, or why Kento does not download it. `warnings` are
/// yt-dlp's warning lines, which tell when DRM is why a video has no formats.
pub(super) fn map(url: &str, json: &Value, warnings: &[String]) -> Result<Found> {
    let refuse = |problem| Err(Error::Web(problem));
    if !json.is_object() {
        return refuse(WebProblem::NoMedia);
    }
    let key = extractor(json);
    let site = site(key, url);
    if live(json) {
        return refuse(WebProblem::Live);
    }
    let drm = warnings
        .iter()
        .any(|line| super::problem::mentions_drm(line));
    match text(json, "_type").unwrap_or("video") {
        // An Instagram post with several pictures or videos is a playlist of its own items.
        "playlist" if key.eq_ignore_ascii_case("instagram") => post(url, site, json, drm),
        "playlist" | "multi_video" => refuse(WebProblem::Collection),
        "url" | "url_transparent" => refuse(WebProblem::NoMedia),
        _ => single(url, site, json, drm),
    }
}

/// One video, sound or picture.
fn single(url: &str, site: Site, json: &Value, drm: bool) -> Result<Found> {
    let media = media(json, site, drm)?;
    let mut info = WebInfo {
        url: url.to_owned(),
        site,
        kind: WebKind::Video,
        title: title(json, url),
        duration: duration(json),
        heights: Vec::new(),
        thumbnail: false,
        images: Vec::new(),
    };
    let mut direct = None;
    match media {
        Media::Video => {
            info.heights = heights(json);
            info.thumbnail = site == Site::YouTube && has_thumbnail(json);
            if info.heights.is_empty() {
                direct = direct_file(json);
            }
        }
        Media::Audio => info.kind = WebKind::Audio,
        Media::Picture | Media::Nothing => {
            info.kind = WebKind::Images;
            info.duration = None;
            info.images = vec![picture(json, 0)];
        }
    }
    Ok(Found { info, direct })
}

/// An Instagram post: its pictures for the picker, or its videos when it has no pictures.
fn post(url: &str, site: Site, json: &Value, drm: bool) -> Result<Found> {
    let entries: Vec<&Value> = json
        .get("entries")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter(|entry| entry.is_object()).collect())
        .unwrap_or_default();
    if entries.iter().any(|entry| live(entry)) {
        return Err(Error::Web(WebProblem::Live));
    }
    let mut pictures = Vec::new();
    let mut videos = Vec::new();
    let mut audio = false;
    let mut problem = None;
    for (place, entry) in entries.iter().enumerate() {
        // `playlist_index` counts from 1 in the whole post.
        let index = whole(entry, "playlist_index")
            .and_then(|index| usize::try_from(index).ok())
            .filter(|index| *index >= 1)
            .map_or(place, |index| index - 1);
        match media(entry, site, false) {
            Ok(Media::Picture) => pictures.push(picture(entry, index)),
            Ok(Media::Video) => videos.push(*entry),
            Ok(Media::Audio) => audio = true,
            Ok(Media::Nothing) => {}
            Err(Error::Web(found)) => {
                problem.get_or_insert(found);
            }
            Err(other) => return Err(other),
        }
    }
    pictures.sort_by_key(|picture| picture.index);
    let mut info = WebInfo {
        url: url.to_owned(),
        site,
        kind: WebKind::Images,
        title: title(json, url),
        duration: None,
        heights: Vec::new(),
        thumbnail: false,
        images: Vec::new(),
    };
    if !pictures.is_empty() {
        info.images = pictures;
    } else if !videos.is_empty() {
        info.kind = WebKind::Video;
        info.heights = simplify(videos.iter().flat_map(|entry| qualities(entry)));
        if let [only] = videos.as_slice() {
            info.duration = duration(only);
        }
    } else if audio {
        info.kind = WebKind::Audio;
    } else {
        let fallback = if drm {
            WebProblem::Drm
        } else {
            WebProblem::NoMedia
        };
        return Err(Error::Web(problem.unwrap_or(fallback)));
    }
    Ok(Found { info, direct: None })
}

/// What one item holds, or why it holds nothing Kento can take.
fn media(entry: &Value, site: Site, drm: bool) -> Result<Media> {
    let formats = formats(entry);
    let usable: Vec<&Value> = formats
        .iter()
        .copied()
        .filter(|format| !flag(format, "has_drm"))
        .collect();
    let kinds: Vec<Media> = usable.iter().map(|format| kind(format)).collect();
    for wanted in [Media::Video, Media::Audio, Media::Picture] {
        if kinds.contains(&wanted) {
            return Ok(wanted);
        }
    }
    let refuse = |problem| Err(Error::Web(problem));
    if !formats.is_empty() && usable.is_empty() {
        return refuse(WebProblem::Drm);
    }
    // A photo of an Instagram post has no formats; its picture is its thumbnail. A video
    // without formats (it has a length) is not a photo, and on other sites a lone thumbnail is
    // only a player's poster.
    if site == Site::Instagram && has_thumbnail(entry) && duration(entry).is_none() {
        return Ok(Media::Picture);
    }
    if drm {
        return refuse(WebProblem::Drm);
    }
    if matches!(
        text(entry, "availability"),
        Some("needs_auth" | "premium_only" | "subscriber_only")
    ) {
        return refuse(WebProblem::Login);
    }
    refuse(WebProblem::NoMedia)
}

/// The item's formats, without YouTube's storyboards (preview strips, not media). An item
/// without a format list is its own single format.
fn formats(entry: &Value) -> Vec<&Value> {
    let list: Vec<&Value> = match entry.get("formats").and_then(Value::as_array) {
        Some(list) => list.iter().filter(|format| format.is_object()).collect(),
        None if text(entry, "url").is_some()
            && !matches!(text(entry, "_type"), Some("url" | "url_transparent")) =>
        {
            vec![entry]
        }
        None => Vec::new(),
    };
    list.into_iter()
        .filter(|format| !storyboard(format))
        .collect()
}

fn storyboard(format: &Value) -> bool {
    text(format, "ext") == Some("mhtml")
        || text(format, "protocol") == Some("mhtml")
        || text(format, "format_note")
            .is_some_and(|note| note.to_ascii_lowercase().contains("storyboard"))
}

/// What one format carries. A codec the site does not name counts as there (a plain `.mp4`
/// link has both), unless the container holds sound only.
fn kind(format: &Value) -> Media {
    let ext = text(format, "ext").unwrap_or("").to_ascii_lowercase();
    if IMAGE_EXTS.contains(&ext.as_str()) {
        return Media::Picture;
    }
    let video = match text(format, "vcodec") {
        Some("none") => false,
        Some(_) => true,
        None => !AUDIO_EXTS.contains(&ext.as_str()),
    };
    let audio = text(format, "acodec") != Some("none");
    if video {
        Media::Video
    } else if audio {
        Media::Audio
    } else {
        Media::Nothing
    }
}

/// The simplified quality list of one video.
fn heights(json: &Value) -> Vec<u32> {
    simplify(qualities(json))
}

/// The quality of every video format of an item (and of the item itself, which carries the
/// fields of the format yt-dlp would pick).
fn qualities(entry: &Value) -> Vec<u32> {
    let mut found: Vec<u32> = formats(entry)
        .into_iter()
        .filter(|format| !flag(format, "has_drm") && kind(format) == Media::Video)
        .filter_map(|format| quality(whole(format, "width"), whole(format, "height")))
        .collect();
    found.extend(quality(whole(entry, "width"), whole(entry, "height")));
    found
}

/// A frame's quality: its shorter side, as yt-dlp's `res` sort counts it and as quality names
/// go (1280 × 720 and 720 × 1280 are both 720). Only the height when the width is unknown.
pub(super) fn quality(width: Option<u64>, height: Option<u64>) -> Option<u32> {
    let side = match (width, height) {
        (Some(width), Some(height)) if width > 0 && height > 0 => width.min(height),
        (_, Some(height)) if height > 0 => height,
        _ => return None,
    };
    u32::try_from(side).ok()
}

/// The nearest step; halfway between two goes up.
pub(super) fn snap(quality: u32) -> u32 {
    let mut best = STEPS[0];
    let mut distance = u32::MAX;
    // From the top, so a tie keeps the higher step.
    for step in STEPS {
        let gap = step.abs_diff(quality);
        if gap < distance {
            best = step;
            distance = gap;
        }
    }
    best
}

/// The highest quality that still snaps to `label`, which a download asks yt-dlp not to pass:
/// the 480 of the list also stands for a 576-line PAL video, so "at most 480" is at most 599.
pub(super) fn limit(label: u32) -> u32 {
    let step = snap(label);
    let place = STEPS.iter().position(|s| *s == step).unwrap_or(0);
    let higher = if place == 0 {
        step * 2
    } else {
        STEPS[place - 1]
    };
    (step + higher).div_ceil(2) - 1
}

/// Distinct steps, highest first.
pub(super) fn simplify(qualities: impl IntoIterator<Item = u32>) -> Vec<u32> {
    let mut steps: Vec<u32> = qualities.into_iter().map(snap).collect();
    steps.sort_unstable_by(|a, b| b.cmp(a));
    steps.dedup();
    steps
}

/// The address of a single plain file, when that is what yt-dlp would download (no merged
/// streams, no playlist protocol), with the headers yt-dlp would send.
fn direct_file(json: &Value) -> Option<Direct> {
    let merged = json
        .get("requested_formats")
        .and_then(Value::as_array)
        .is_some_and(|list| !list.is_empty());
    if merged {
        return None;
    }
    let url = text(json, "url")?;
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return None;
    }
    if text(json, "protocol").is_some_and(|protocol| protocol != "http" && protocol != "https") {
        return None;
    }
    let headers = json.get("http_headers").and_then(Value::as_object);
    let header = |name: &str| {
        headers?
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .and_then(|(_, value)| value.as_str())
            .filter(|value| !value.chars().any(char::is_control))
            .map(str::to_owned)
    };
    Some(Direct {
        url: url.to_owned(),
        user_agent: header("User-Agent"),
        referer: header("Referer"),
    })
}

/// A picture of a post: its size from its largest version, and a small version to preview.
fn picture(entry: &Value, index: usize) -> WebImage {
    let thumbnails: Vec<&Value> = entry
        .get("thumbnails")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|thumbnail| text(thumbnail, "url").is_some())
                .collect()
        })
        .unwrap_or_default();
    let size = |value: &Value| (whole(value, "width"), whole(value, "height"));
    let largest = thumbnails
        .iter()
        .filter(|thumbnail| size(thumbnail).0.is_some() && size(thumbnail).1.is_some())
        .max_by_key(|thumbnail| {
            let (width, height) = size(thumbnail);
            width.unwrap_or(0).saturating_mul(height.unwrap_or(0))
        });
    let (width, height) = largest.map_or_else(|| size(entry), |largest| size(largest));
    let small = thumbnails
        .iter()
        .filter(|thumbnail| whole(thumbnail, "width").is_some_and(|width| width >= 320))
        .min_by_key(|thumbnail| whole(thumbnail, "width"));
    let preview = small
        .and_then(|thumbnail| text(thumbnail, "url"))
        .or_else(|| text(entry, "thumbnail").filter(|url| !url.is_empty()))
        .or_else(|| {
            thumbnails
                .last()
                .and_then(|thumbnail| text(thumbnail, "url"))
        })
        .map(str::to_owned);
    WebImage {
        index,
        width: width.and_then(|width| u32::try_from(width).ok()),
        height: height.and_then(|height| u32::try_from(height).ok()),
        preview,
    }
}

/// The extractor's key (`Youtube`, `Instagram`, `Generic`, …).
fn extractor(json: &Value) -> &str {
    text(json, "extractor_key")
        .or_else(|| text(json, "ie_key"))
        .or_else(|| text(json, "extractor"))
        .unwrap_or("")
}

fn site(key: &str, url: &str) -> Site {
    let key = key.to_ascii_lowercase();
    if key.starts_with("youtube") {
        return Site::YouTube;
    }
    if key.starts_with("instagram") {
        return Site::Instagram;
    }
    if !key.is_empty() {
        return Site::Other;
    }
    match host(url).as_deref() {
        Some(host) if host.ends_with("youtube.com") || host == "youtu.be" => Site::YouTube,
        Some(host) if host.ends_with("instagram.com") => Site::Instagram,
        _ => Site::Other,
    }
}

/// A stream that is on air, about to start, or ended but not yet ready to watch again.
fn live(value: &Value) -> bool {
    value.get("is_live").and_then(Value::as_bool) == Some(true)
        || matches!(
            text(value, "live_status"),
            Some("is_live" | "is_upcoming" | "post_live")
        )
}

fn title(json: &Value, url: &str) -> String {
    ["title", "fulltitle"]
        .iter()
        .filter_map(|key| text(json, key))
        .map(str::trim)
        .find(|title| !title.is_empty())
        .map(str::to_owned)
        .or_else(|| host(url))
        .unwrap_or_default()
}

fn duration(value: &Value) -> Option<f64> {
    value
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
}

fn has_thumbnail(value: &Value) -> bool {
    text(value, "thumbnail").is_some_and(|url| !url.is_empty())
        || value
            .get("thumbnails")
            .and_then(Value::as_array)
            .is_some_and(|list| !list.is_empty())
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str()
}

fn flag(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool) == Some(true)
}

/// A whole number, also when written as a float.
pub(super) fn whole(value: &Value, key: &str) -> Option<u64> {
    let number = value.get(key)?;
    number.as_u64().or_else(|| {
        number
            .as_f64()
            .filter(|float| float.is_finite() && *float >= 0.0)
            .map(|float| float.round() as u64)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(json: &str) -> Result<Found> {
        found_at("https://example.org/watch", json, &[])
    }

    fn found_at(url: &str, json: &str, warnings: &[&str]) -> Result<Found> {
        let value: Value = serde_json::from_str(json).unwrap();
        let warnings: Vec<String> = warnings.iter().map(|w| (*w).to_owned()).collect();
        map(url, &value, &warnings)
    }

    fn problem(result: Result<Found>) -> WebProblem {
        match result {
            Err(Error::Web(problem)) => problem,
            other => panic!("expected a web problem, got {other:?}"),
        }
    }

    const YOUTUBE: &str = r#"{
        "_type": "video", "id": "abc", "title": "  Çağrı: a test / video? 🎬 ",
        "duration": 212.0, "extractor": "youtube", "extractor_key": "Youtube",
        "is_live": false, "live_status": "not_live", "availability": "public",
        "thumbnail": "https://i.ytimg.com/vi/abc/maxresdefault.jpg",
        "thumbnails": [
            {"url": "https://i.ytimg.com/vi/abc/default.jpg", "width": 120, "height": 90},
            {"url": "https://i.ytimg.com/vi/abc/maxresdefault.jpg", "width": 1280, "height": 720}
        ],
        "formats": [
            {"format_id": "sb0", "ext": "mhtml", "protocol": "mhtml", "format_note": "storyboard",
             "vcodec": "none", "acodec": "none", "width": 320, "height": 180},
            {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2"},
            {"format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus"},
            {"format_id": "160", "ext": "mp4", "vcodec": "avc1.4d400c", "acodec": "none",
             "width": 256, "height": 144},
            {"format_id": "133", "ext": "mp4", "vcodec": "avc1.4d4015", "acodec": "none",
             "width": 426, "height": 240},
            {"format_id": "18", "ext": "mp4", "vcodec": "avc1.42001E", "acodec": "mp4a.40.2",
             "width": 640, "height": 360},
            {"format_id": "135", "ext": "mp4", "vcodec": "avc1.4d401e", "acodec": "none",
             "width": 854, "height": 480},
            {"format_id": "136", "ext": "mp4", "vcodec": "avc1.4d401f", "acodec": "none",
             "width": 1280, "height": 720},
            {"format_id": "137", "ext": "mp4", "vcodec": "avc1.640028", "acodec": "none",
             "width": 1920, "height": 1080},
            {"format_id": "248", "ext": "webm", "vcodec": "vp9", "acodec": "none",
             "width": 1920, "height": 1080},
            {"format_id": "400", "ext": "mp4", "vcodec": "av01.0.12M.08", "acodec": "none",
             "width": 2560, "height": 1440},
            {"format_id": "401", "ext": "mp4", "vcodec": "av01.0.12M.08", "acodec": "none",
             "width": 3840, "height": 2160}
        ],
        "requested_formats": [{"format_id": "401"}, {"format_id": "251"}],
        "width": 3840, "height": 2160, "vcodec": "av01.0.12M.08", "acodec": "opus"
    }"#;

    #[test]
    fn a_youtube_video() {
        let found = found(YOUTUBE).unwrap();
        let info = found.info;
        assert_eq!(info.site, Site::YouTube);
        assert_eq!(info.kind, WebKind::Video);
        assert_eq!(info.title, "Çağrı: a test / video? 🎬");
        assert_eq!(info.duration, Some(212.0));
        // 144 and 240 merge into 360; the storyboard and the sound are not qualities.
        assert_eq!(info.heights, [2160, 1440, 1080, 720, 480, 360]);
        assert!(info.thumbnail);
        assert!(info.images.is_empty());
        assert_eq!(found.direct, None);
        assert_eq!(info.url, "https://example.org/watch");
    }

    const CAROUSEL: &str = r#"{
        "_type": "playlist", "id": "C1abc", "title": "Post by kento.test",
        "extractor": "Instagram", "extractor_key": "Instagram",
        "entries": [
            {"id": "1", "title": "Post by kento.test", "playlist_index": 1,
             "thumbnails": [
                {"url": "https://cdn.example/1_s.jpg", "width": 320, "height": 400},
                {"url": "https://cdn.example/1_xs.jpg", "width": 150, "height": 188},
                {"url": "https://cdn.example/1.jpg", "width": 1080, "height": 1350}
             ]},
            {"id": "2", "title": "Video by kento.test", "playlist_index": 2, "duration": 9.5,
             "thumbnail": "https://cdn.example/2.jpg",
             "formats": [
                {"format_id": "dash-v", "ext": "mp4", "vcodec": "avc1.4d401f", "acodec": "none",
                 "width": 720, "height": 1280},
                {"format_id": "dash-a", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.5"}
             ]},
            {"id": "3", "playlist_index": 3, "thumbnail": "https://cdn.example/3.jpg",
             "thumbnails": [{"url": "https://cdn.example/3.jpg", "width": 1080, "height": 1080}]}
        ]
    }"#;

    #[test]
    fn an_instagram_carousel_lists_its_pictures_in_order() {
        let info = found_at("https://www.instagram.com/p/C1abc/", CAROUSEL, &[])
            .unwrap()
            .info;
        assert_eq!(info.site, Site::Instagram);
        assert_eq!(info.kind, WebKind::Images);
        assert_eq!(info.title, "Post by kento.test");
        assert!(!info.thumbnail);
        assert_eq!(info.duration, None);
        assert_eq!(
            info.images,
            [
                WebImage {
                    index: 0,
                    width: Some(1080),
                    height: Some(1350),
                    preview: Some("https://cdn.example/1_s.jpg".into()),
                },
                WebImage {
                    index: 2,
                    width: Some(1080),
                    height: Some(1080),
                    preview: Some("https://cdn.example/3.jpg".into()),
                },
            ]
        );
    }

    #[test]
    fn a_carousel_of_videos_is_video() {
        let json = r#"{"_type": "playlist", "extractor_key": "Instagram", "title": "Post",
            "entries": [
                {"playlist_index": 1, "duration": 4.0, "formats": [
                    {"ext": "mp4", "vcodec": "avc1", "acodec": "none", "width": 1080, "height": 1920},
                    {"ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.5"}]},
                {"playlist_index": 2, "duration": 6.0, "formats": [
                    {"ext": "mp4", "vcodec": "avc1", "acodec": "mp4a", "width": 720, "height": 720}]}
            ]}"#;
        let info = found(json).unwrap().info;
        assert_eq!(info.kind, WebKind::Video);
        assert_eq!(info.heights, [1080, 720]);
        assert_eq!(info.duration, None, "two videos have no single length");
    }

    #[test]
    fn a_reel_is_video_with_sound_and_no_thumbnail_choice() {
        let json = r#"{"_type": "video", "id": "C2", "title": "Video by kento.test",
            "extractor_key": "Instagram", "duration": 15.2,
            "thumbnail": "https://cdn.example/reel.jpg",
            "formats": [
                {"format_id": "1", "ext": "mp4", "vcodec": "avc1.4d401f", "acodec": "none",
                 "width": 720, "height": 1280},
                {"format_id": "2", "ext": "mp4", "vcodec": "avc1.640028", "acodec": "none",
                 "width": 1080, "height": 1920},
                {"format_id": "3", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.5"}
            ]}"#;
        let info = found_at("https://www.instagram.com/reel/C2/", json, &[])
            .unwrap()
            .info;
        assert_eq!(info.site, Site::Instagram);
        assert_eq!(info.kind, WebKind::Video);
        assert_eq!(info.heights, [1080, 720]);
        assert!(!info.thumbnail);
        assert_eq!(info.duration, Some(15.2));
    }

    #[test]
    fn a_single_photo_post_is_one_picture() {
        let json = r#"{"_type": "video", "extractor_key": "Instagram", "title": "Post",
            "thumbnails": [{"url": "https://cdn.example/p.jpg", "width": 1080, "height": 1080}]}"#;
        let info = found(json).unwrap().info;
        assert_eq!(info.kind, WebKind::Images);
        assert_eq!(info.images.len(), 1);
        assert_eq!(info.images[0].index, 0);
        // Elsewhere a thumbnail alone is only a poster.
        let poster = r#"{"_type": "video", "extractor_key": "Generic", "title": "Player",
            "thumbnail": "https://example.org/poster.jpg"}"#;
        assert_eq!(problem(found(poster)), WebProblem::NoMedia);
        // And an Instagram video whose formats did not come is no photo.
        let video = r#"{"_type": "video", "extractor_key": "Instagram", "duration": 8.0,
            "thumbnail": "https://cdn.example/v.jpg", "formats": []}"#;
        assert_eq!(problem(found(video)), WebProblem::NoMedia);
    }

    #[test]
    fn live_streams_are_refused() {
        let live = r#"{"_type": "video", "extractor_key": "Youtube", "is_live": true,
            "live_status": "is_live", "formats": [
                {"ext": "mp4", "vcodec": "avc1", "acodec": "mp4a", "width": 1920, "height": 1080,
                 "protocol": "m3u8_native"}]}"#;
        assert_eq!(problem(found(live)), WebProblem::Live);
        let upcoming = r#"{"_type": "video", "extractor_key": "Youtube",
            "live_status": "is_upcoming", "formats": []}"#;
        assert_eq!(problem(found(upcoming)), WebProblem::Live);
        let ended = r#"{"_type": "video", "extractor_key": "Youtube", "is_live": false,
            "live_status": "was_live", "formats": [
                {"ext": "mp4", "vcodec": "avc1", "acodec": "mp4a", "width": 1280, "height": 720}]}"#;
        assert_eq!(found(ended).unwrap().info.heights, [720]);
    }

    #[test]
    fn playlists_channels_and_profiles_are_refused() {
        let playlist = r#"{"_type": "playlist", "extractor_key": "YoutubeTab",
            "title": "Uploads", "entries": [
                {"_type": "url", "ie_key": "Youtube", "url": "https://www.youtube.com/watch?v=a"}]}"#;
        assert_eq!(problem(found(playlist)), WebProblem::Collection);
        let profile = r#"{"_type": "playlist", "extractor_key": "InstagramUser",
            "entries": []}"#;
        assert_eq!(problem(found(profile)), WebProblem::Collection);
        let parts = r#"{"_type": "multi_video", "extractor_key": "Generic", "entries": []}"#;
        assert_eq!(problem(found(parts)), WebProblem::Collection);
    }

    const DIRECT: &str = r#"{
        "_type": "video", "id": "clip", "title": "clip", "extractor": "generic",
        "extractor_key": "Generic", "direct": true, "ext": "mp4", "protocol": "http",
        "url": "http://127.0.0.1:8000/clip.mp4",
        "http_headers": {"User-Agent": "Mozilla/5.0 (test)", "Accept": "*/*"},
        "formats": [{"format_id": "mp4", "url": "http://127.0.0.1:8000/clip.mp4",
                     "ext": "mp4", "vcodec": null, "protocol": "http"}]
    }"#;

    #[test]
    fn a_direct_file_is_measured_by_ffprobe() {
        let found = found(DIRECT).unwrap();
        assert_eq!(found.info.site, Site::Other);
        assert_eq!(found.info.kind, WebKind::Video);
        assert!(found.info.heights.is_empty());
        assert!(!found.info.thumbnail);
        assert_eq!(
            found.direct,
            Some(Direct {
                url: "http://127.0.0.1:8000/clip.mp4".into(),
                user_agent: Some("Mozilla/5.0 (test)".into()),
                referer: None,
            })
        );
        // A stream list is not a file ffprobe should be pointed at.
        let hls = DIRECT.replace(r#""protocol": "http","#, r#""protocol": "m3u8_native","#);
        assert_eq!(
            found_at("https://example.org/a", &hls, &[]).unwrap().direct,
            None
        );
    }

    #[test]
    fn a_direct_sound_file_is_audio() {
        let mp3 = r#"{"_type": "video", "title": "song", "extractor_key": "Generic",
            "url": "http://127.0.0.1:8000/song.mp3", "ext": "mp3",
            "formats": [{"url": "http://127.0.0.1:8000/song.mp3", "ext": "mp3",
                         "vcodec": "none"}]}"#;
        let info = found(mp3).unwrap().info;
        assert_eq!(info.kind, WebKind::Audio);
        assert!(info.heights.is_empty());
        // The container tells when the codecs are not named.
        let m4a = r#"{"title": "episode", "extractor_key": "Generic", "duration": 60,
            "url": "https://example.org/ep.m4a", "ext": "m4a"}"#;
        let info = found(m4a).unwrap().info;
        assert_eq!(info.kind, WebKind::Audio);
        assert_eq!(info.duration, Some(60.0));
    }

    #[test]
    fn drm_sign_in_and_nothing() {
        let drm = r#"{"_type": "video", "extractor_key": "Generic", "formats": [
            {"ext": "mp4", "vcodec": "avc1", "acodec": "mp4a", "height": 720, "has_drm": true}]}"#;
        assert_eq!(problem(found(drm)), WebProblem::Drm);
        let removed = r#"{"_type": "video", "extractor_key": "Generic", "title": "x",
            "formats": []}"#;
        assert_eq!(
            problem(found_at(
                "https://example.org/a",
                removed,
                &["WARNING: [generic] x: This video is DRM protected"]
            )),
            WebProblem::Drm
        );
        assert_eq!(problem(found(removed)), WebProblem::NoMedia);
        let members = r#"{"_type": "video", "extractor_key": "Youtube",
            "availability": "subscriber_only", "formats": []}"#;
        assert_eq!(problem(found(members)), WebProblem::Login);
        assert_eq!(problem(found("[]")), WebProblem::NoMedia);
        let redirect = r#"{"_type": "url", "url": "https://example.org/b"}"#;
        assert_eq!(problem(found(redirect)), WebProblem::NoMedia);
    }

    #[test]
    fn a_missing_title_falls_back_to_the_host() {
        let json = r#"{"_type": "video", "extractor_key": "Generic", "title": "  ",
            "formats": [{"ext": "mp4"}]}"#;
        let info = found_at("https://www.example.org/v/1", json, &[])
            .unwrap()
            .info;
        assert_eq!(info.title, "example.org");
        assert_eq!(info.kind, WebKind::Video);
    }

    #[test]
    fn heights_are_simplified() {
        assert_eq!(quality(Some(1920), Some(1080)), Some(1080));
        assert_eq!(quality(Some(1080), Some(1920)), Some(1080));
        assert_eq!(quality(None, Some(720)), Some(720));
        assert_eq!(quality(Some(640), None), None);
        assert_eq!(quality(Some(0), Some(0)), None);
        assert_eq!(snap(1080), 1080);
        assert_eq!(snap(1076), 1080);
        assert_eq!(snap(1088), 1080);
        assert_eq!(snap(800), 720);
        assert_eq!(snap(576), 480);
        assert_eq!(snap(144), 360);
        assert_eq!(snap(4320), 2160);
        // Halfway goes up.
        assert_eq!(snap(420), 480);
        assert_eq!(snap(419), 360);
        assert_eq!(
            simplify([1080, 1072, 720, 704, 2160, 144, 240, 360, 1440, 576]),
            [2160, 1440, 1080, 720, 480, 360]
        );
        assert!(simplify([]).is_empty());
        // Each label's limit is the last quality that snaps to it.
        for (label, top) in [
            (360, 419),
            (480, 599),
            (720, 899),
            (1080, 1259),
            (1440, 1799),
            (2160, 3239),
        ] {
            assert_eq!(limit(label), top, "{label}");
            assert_eq!(snap(top), label);
            if label != STEPS[0] {
                assert_ne!(snap(top + 1), label);
            }
        }
        assert_eq!(limit(700), 899, "a label off the list snaps first");
    }
}
