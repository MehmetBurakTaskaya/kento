// SPDX-License-Identifier: MIT
//! Video and audio through ffprobe and FFmpeg: the container's tags, each stream's tags and the
//! chapters. An edit copies every picture, sound, subtitle and attachment stream as it is
//! (`-c copy`), so nothing is encoded again; data streams (timecodes, sensor tracks, the text
//! track MP4 keeps its chapters in) are left out, since most containers cannot take them back.
//!
//! Each container keeps only some fields (SPEC 5.5 "respect the container's limits"), found by
//! writing every field with FFmpeg and reading it back: the panel offers just those, and chapters
//! only where the container keeps them.

use std::fs;
use std::path::Path;

use serde::Deserialize;
use serde_json::{Map, Value};

use super::{check_keys, editable, shown, Chapter, MetadataInfo, MetadataRun};
use crate::media::run::{self, command, media_path, spawn_error, Cmd, Watch};
use crate::{Error, Result, Tools};

/// The common fields, by FFmpeg's names for them.
const ALL: &[&str] = &[
    "title",
    "artist",
    "album",
    "album_artist",
    "date",
    "track",
    "genre",
    "comment",
    "composer",
    "copyright",
    "description",
];
/// Vorbis comments and ASF fold a description into the comment.
const NO_DESCRIPTION: &[&str] = &[
    "title",
    "artist",
    "album",
    "album_artist",
    "date",
    "track",
    "genre",
    "comment",
    "composer",
    "copyright",
];
/// QuickTime's own tags, as FFmpeg's MOV writer keeps them.
const MOV: &[&str] = &[
    "title",
    "artist",
    "album",
    "date",
    "genre",
    "comment",
    "copyright",
];
/// RIFF INFO in AVI (its album comes back under another name, so it is not offered).
const AVI: &[&str] = &[
    "title",
    "artist",
    "date",
    "track",
    "genre",
    "comment",
    "copyright",
];
/// RIFF INFO in WAV.
const WAV: &[&str] = &[
    "title",
    "artist",
    "album",
    "date",
    "track",
    "genre",
    "comment",
    "copyright",
];

/// How FFmpeg writes one container.
struct Container {
    muxer: &'static str,
    keys: &'static [&'static str],
    chapters: bool,
    /// Ogg keeps its comments on the sound stream, not on the file.
    stream_tags: bool,
    args: &'static [&'static str],
}

/// By catalog id.
fn container(from: &str) -> Option<Container> {
    let (muxer, keys, chapters, args): (_, _, _, &'static [&'static str]) = match from {
        "mp4" => ("mp4", ALL, true, &["-movflags", "+faststart"]),
        "m4a" => ("ipod", ALL, true, &["-movflags", "+faststart"]),
        "mov" => ("mov", MOV, true, &["-movflags", "+faststart"]),
        "mkv" => ("matroska", ALL, true, &[]),
        "webm" => ("webm", ALL, true, &[]),
        "avi" => ("avi", AVI, false, &[]),
        "wmv" | "wma" => ("asf", NO_DESCRIPTION, true, &[]),
        // ID3v2.3 is what Windows and most car stereos read.
        "mp3" => ("mp3", ALL, true, &["-id3v2_version", "3"]),
        "wav" => ("wav", WAV, false, &["-rf64", "auto"]),
        "flac" => ("flac", NO_DESCRIPTION, false, &[]),
        "ogg" => ("ogg", NO_DESCRIPTION, false, &[]),
        "opus" => ("opus", NO_DESCRIPTION, true, &[]),
        // AIFF's own chunks hold four fields; an ID3 chunk holds them all.
        "aiff" => ("aiff", ALL, true, &["-write_id3v2", "1"]),
        _ => return None,
    };
    Some(Container {
        muxer,
        keys,
        chapters,
        stream_tags: matches!(from, "ogg" | "opus"),
        args,
    })
}

#[derive(Debug, Default, Deserialize)]
struct Report {
    #[serde(default)]
    streams: Vec<Stream>,
    #[serde(default)]
    format: Format,
    #[serde(default)]
    chapters: Vec<RawChapter>,
}

#[derive(Debug, Default, Deserialize)]
struct Format {
    duration: Option<String>,
    #[serde(default)]
    tags: Map<String, Value>,
}

#[derive(Debug, Deserialize)]
struct Stream {
    index: usize,
    codec_type: Option<String>,
    #[serde(default)]
    tags: Map<String, Value>,
    #[serde(default)]
    disposition: Map<String, Value>,
}

#[derive(Debug, Deserialize)]
struct RawChapter {
    start_time: Option<String>,
    end_time: Option<String>,
    #[serde(default)]
    tags: Map<String, Value>,
}

impl Stream {
    fn kind(&self) -> &str {
        self.codec_type.as_deref().unwrap_or("data")
    }

    /// Cover art: a picture stored as a one-frame video stream.
    fn cover(&self) -> bool {
        self.disposition
            .get("attached_pic")
            .and_then(Value::as_i64)
            .is_some_and(|flag| flag != 0)
    }
}

impl Report {
    fn duration(&self) -> f64 {
        self.format
            .duration
            .as_deref()
            .and_then(seconds)
            .unwrap_or(0.0)
    }

    /// A common field's value: on the sound stream for Ogg, on the file otherwise.
    fn value(&self, key: &str, stream_tags: bool) -> String {
        let audio = self
            .streams
            .iter()
            .find(|stream| stream.kind() == "audio")
            .filter(|_| stream_tags);
        audio
            .and_then(|stream| tag(&stream.tags, key))
            .or_else(|| tag(&self.format.tags, key))
            .unwrap_or_default()
    }

    fn chapters(&self) -> Vec<Chapter> {
        self.chapters
            .iter()
            .filter_map(|chapter| {
                let start = chapter.start_time.as_deref().and_then(seconds)?;
                let end = chapter.end_time.as_deref().and_then(seconds)?;
                Some(Chapter {
                    start,
                    end,
                    title: tag(&chapter.tags, "title").unwrap_or_default(),
                })
            })
            .collect()
    }
}

/// Tag names are compared without case: Matroska writes `ARTIST`, MP4 `artist`.
fn tag(tags: &Map<String, Value>, key: &str) -> Option<String> {
    tags.iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .map(|(_, value)| text(value))
}

fn text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn seconds(text: &str) -> Option<f64> {
    text.trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value >= 0.0)
}

/// A position: QuickTime's `location` (ISO 6709), Apple's keys, Matroska's `LOCATION`, GPS tags.
fn is_location(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name == "location"
        || name.starts_with("location-")
        || name.contains(".location")
        || name.contains("iso6709")
        || name.starts_with("gps")
}

fn probe(ffprobe: &Path, input: &Path) -> Result<Report> {
    let output = command(ffprobe)
        .args([
            "-v",
            "error",
            "-hide_banner",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-show_chapters",
            "-i",
        ])
        .arg(media_path(input))
        .output()
        .map_err(spawn_error)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let lines: Vec<&str> = stderr.lines().filter(|line| !line.is_empty()).collect();
        let detail = lines[lines.len().saturating_sub(3)..].join(" | ");
        return Err(Error::Unreadable(if detail.is_empty() {
            "ffprobe could not read the file".to_owned()
        } else {
            detail
        }));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| Error::Unreadable(format!("ffprobe's report: {error}")))
}

pub(super) fn read(path: &Path, from: &str, tools: &Tools) -> Result<MetadataInfo> {
    let report = probe(tools.ffprobe()?, path)?;
    Ok(info(&report, from))
}

fn info(report: &Report, from: &str) -> MetadataInfo {
    let container = container(from);
    let mut fields = Vec::new();
    if let Some(container) = &container {
        for key in container.keys {
            let value = report.value(key, container.stream_tags);
            fields.push(editable(key, "Format", key, value));
        }
    }
    for (name, value) in &report.format.tags {
        fields.push(shown(
            format!("format:{name}"),
            "Format",
            name,
            &text(value),
        ));
    }
    for stream in &report.streams {
        let group = format!("Stream {} · {}", stream.index, stream.kind());
        for (name, value) in &stream.tags {
            fields.push(shown(
                format!("stream:{}:{name}", stream.index),
                &group,
                name,
                &text(value),
            ));
        }
    }
    let has_location = report.format.tags.keys().any(|name| is_location(name))
        || report
            .streams
            .iter()
            .any(|stream| stream.tags.keys().any(|name| is_location(name)));
    MetadataInfo {
        fields,
        chapters: report.chapters(),
        has_location,
        chapters_editable: container.is_some_and(|container| container.chapters),
    }
}

pub(super) fn write(run: &MetadataRun) -> Result<()> {
    let ffmpeg = run.tools.ffmpeg()?;
    let ffprobe = run.tools.ffprobe()?;
    let unsupported = |what: &str| Error::Unsupported {
        from: run.from.to_owned(),
        to: what.to_owned(),
    };
    let container = container(run.from).ok_or_else(|| unsupported("metadata"))?;
    let change = run.change;
    check_keys(change, container.keys)?;
    let report = probe(ffprobe, run.input)?;
    run.progress.check()?;
    let duration = report.duration();
    let chapters = match &change.chapters {
        Some(list) if !list.is_empty() && !change.remove_all => {
            if !container.chapters {
                return Err(unsupported("chapters"));
            }
            Some(sane(list, duration)?)
        }
        _ => None,
    };

    let mut cmd = Cmd::new();
    cmd.input(run.input);
    if let Some(list) = &chapters {
        let file = run.temp.join("kento-chapters.txt");
        fs::write(&file, ffmetadata(list))?;
        cmd.args(["-f", "ffmetadata"]).input(&file);
    }
    // The streams that stay, in their order; cover art and attachments are metadata too, and go
    // with everything else.
    let kept: Vec<&Stream> = report
        .streams
        .iter()
        .filter(|stream| match stream.kind() {
            "video" => !(change.remove_all && stream.cover()),
            "audio" | "subtitle" => true,
            "attachment" => !change.remove_all,
            _ => false,
        })
        .collect();
    if kept.is_empty() {
        return Err(Error::Unreadable("no sound or picture in the file".into()));
    }
    for stream in &kept {
        cmd.map(stream.index);
    }
    cmd.args(["-c", "copy"]);
    if change.remove_all {
        // Neither the file's nor the streams' tags nor the chapters, and no encoder tag either.
        cmd.args([
            "-map_metadata",
            "-1",
            "-map_metadata:s",
            "-1",
            "-map_chapters",
            "-1",
            "-fflags",
            "+bitexact",
        ]);
    } else {
        cmd.args(["-map_metadata", "0"]);
        let from_chapters = match (&change.chapters, &chapters) {
            (_, Some(_)) => "1",
            (Some(_), None) => "-1",
            (None, None) => "0",
        };
        cmd.args(["-map_chapters", from_chapters]);
        let audio = kept.iter().position(|stream| stream.kind() == "audio");
        let target = match (container.stream_tags, audio) {
            (true, Some(at)) => format!("-metadata:s:{at}"),
            _ => "-metadata".to_owned(),
        };
        for (key, value) in &change.set {
            cmd.arg(&target).arg(format!("{key}={}", value.trim()));
        }
        if change.remove_location {
            for name in report.format.tags.keys().filter(|name| is_location(name)) {
                cmd.arg("-metadata").arg(format!("{name}="));
            }
            for (at, stream) in kept.iter().enumerate() {
                for name in stream.tags.keys().filter(|name| is_location(name)) {
                    cmd.arg(format!("-metadata:s:{at}")).arg(format!("{name}="));
                }
            }
        }
    }
    cmd.args(container.args);
    cmd.output(container.muxer, run.dest);
    run::run(ffmpeg, &cmd, Watch::new(run.progress, duration))?;
    Ok(())
}

/// The chapters in order, each with a length, inside the file, none running into the next.
fn sane(chapters: &[Chapter], duration: f64) -> Result<Vec<Chapter>> {
    let bad = || Error::Other("a chapter has no length or lies outside the file".into());
    let mut list = chapters.to_vec();
    for chapter in &list {
        let finite = chapter.start.is_finite() && chapter.end.is_finite();
        if !finite || chapter.start < 0.0 || chapter.end <= chapter.start {
            return Err(bad());
        }
    }
    list.sort_by(|a, b| a.start.total_cmp(&b.start));
    if duration > 0.0 {
        for chapter in &mut list {
            if chapter.start >= duration {
                return Err(bad());
            }
            chapter.end = chapter.end.min(duration);
        }
    }
    for at in 1..list.len() {
        let next = list[at].start;
        let previous = &mut list[at - 1];
        previous.end = previous.end.min(next);
        if previous.end <= previous.start {
            return Err(bad());
        }
    }
    Ok(list)
}

/// FFmpeg's metadata file with the chapters, in milliseconds.
fn ffmetadata(chapters: &[Chapter]) -> String {
    let mut text = String::from(";FFMETADATA1\n");
    for chapter in chapters {
        let title: String = chapter
            .title
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect();
        let mut escaped = String::new();
        for c in title.trim().chars() {
            if matches!(c, '=' | ';' | '#' | '\\') {
                escaped.push('\\');
            }
            escaped.push(c);
        }
        text.push_str(&format!(
            "[CHAPTER]\nTIMEBASE=1/1000\nSTART={}\nEND={}\ntitle={escaped}\n",
            (chapter.start * 1000.0).round() as u64,
            (chapter.end * 1000.0).round() as u64,
        ));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::MetadataChange;
    use crate::{FileKind, Progress};
    use std::path::PathBuf;
    use std::process::Command;

    fn chapter(start: f64, end: f64, title: &str) -> Chapter {
        Chapter {
            start,
            end,
            title: title.into(),
        }
    }

    #[test]
    fn chapters_are_ordered_trimmed_and_checked() {
        let list = sane(
            &[
                chapter(5.0, 12.0, "İkinci"),
                chapter(0.0, 6.0, "Giriş"),
                chapter(9.0, 30.0, "Son"),
            ],
            20.0,
        )
        .unwrap();
        assert_eq!(
            list,
            [
                chapter(0.0, 5.0, "Giriş"),
                chapter(5.0, 9.0, "İkinci"),
                chapter(9.0, 20.0, "Son")
            ]
        );
        for wrong in [
            vec![chapter(3.0, 3.0, "")],
            vec![chapter(-1.0, 3.0, "")],
            vec![chapter(0.0, f64::NAN, "")],
            vec![chapter(25.0, 30.0, "")],
            vec![chapter(1.0, 2.0, ""), chapter(1.0, 4.0, "")],
        ] {
            assert!(sane(&wrong, 20.0).is_err(), "{wrong:?}");
        }
        // An unknown length leaves the ends as they are.
        assert_eq!(sane(&[chapter(0.0, 99.0, "")], 0.0).unwrap()[0].end, 99.0);
    }

    #[test]
    fn chapter_titles_are_escaped_for_ffmpeg() {
        let text = ffmetadata(&[chapter(0.0, 1.5, "a=b; #c\\d\nnew")]);
        assert_eq!(
            text,
            ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=a\\=b\\; \\#c\\\\d new\n"
        );
    }

    #[test]
    fn every_catalog_container_has_its_fields() {
        for id in [
            "mp4", "m4a", "mov", "mkv", "webm", "avi", "wmv", "wma", "mp3", "wav", "flac", "ogg",
            "opus", "aiff",
        ] {
            let container = container(id).unwrap();
            assert!(container.keys.contains(&"title"), "{id}");
        }
        assert!(container("gif").is_none());
        assert!(!container("wav").unwrap().chapters);
        assert!(container("ogg").unwrap().stream_tags);
    }

    #[test]
    fn reads_tags_streams_chapters_and_location_from_a_report() {
        let report: Report = serde_json::from_str(
            r#"{
            "streams": [
                {"index": 0, "codec_type": "video", "tags": {"handler_name": "VideoHandler"}},
                {"index": 1, "codec_type": "audio", "tags": {"language": "tur"}}
            ],
            "chapters": [
                {"start_time": "0.000000", "end_time": "60.000000", "tags": {"title": "Giriş"}},
                {"start_time": "60.000000", "end_time": "95.400000"}
            ],
            "format": {"duration": "95.400000",
                "tags": {"TITLE": "Kapadokya 🎈", "location": "+38.6430+034.8281/", "encoder": "x"}}
        }"#,
        )
        .unwrap();
        let info = info(&report, "mkv");
        assert!(info.has_location && info.chapters_editable);
        assert_eq!(info.chapters.len(), 2);
        assert_eq!(info.chapters[0].title, "Giriş");
        assert_eq!(info.chapters[1].end, 95.4);
        let title = info.fields.iter().find(|f| f.key == "title").unwrap();
        assert!(title.editable);
        assert_eq!(title.value, "Kapadokya 🎈");
        assert!(info
            .fields
            .iter()
            .any(|f| f.group == "Stream 1 · audio" && f.name == "language" && f.value == "tur"));
        assert!(!info
            .fields
            .iter()
            .any(|f| f.key == "description" && f.group != "Format"));
        assert_eq!(info.fields.iter().filter(|f| f.editable).count(), ALL.len());
    }

    // With FFmpeg: files made at run time under names with Turkish letters and an emoji.

    fn find(var: &str, name: &str) -> Option<PathBuf> {
        std::env::var_os(var)
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .or_else(|| {
                let exe = format!("{name}{}", std::env::consts::EXE_SUFFIX);
                std::env::split_paths(&std::env::var_os("PATH")?)
                    .map(|dir| dir.join(&exe))
                    .find(|path| path.is_file())
            })
    }

    fn tools() -> Option<Tools> {
        match (
            find("KENTO_FFMPEG", "ffmpeg"),
            find("KENTO_FFPROBE", "ffprobe"),
        ) {
            (Some(ffmpeg), Some(ffprobe)) => Some(Tools {
                ffmpeg: Some(ffmpeg),
                ffprobe: Some(ffprobe),
                exiftool: None,
                soffice: None,
                ytdlp: None,
                deno: None,
            }),
            _ => {
                let required = std::env::var("KENTO_REQUIRE_FFMPEG").is_ok_and(|v| v == "1");
                assert!(!required, "KENTO_REQUIRE_FFMPEG=1 but FFmpeg is missing");
                eprintln!("skipped the media metadata checks: no FFmpeg");
                None
            }
        }
    }

    struct Lab {
        _dir: tempfile::TempDir,
        root: PathBuf,
        temp: PathBuf,
        tools: Tools,
    }

    impl Lab {
        fn new() -> Option<Lab> {
            let tools = tools()?;
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("Klasör ğ 🧪");
            let temp = dir.path().join("temp");
            fs::create_dir(&root).unwrap();
            fs::create_dir(&temp).unwrap();
            Some(Lab {
                _dir: dir,
                root,
                temp,
                tools,
            })
        }

        /// A two-second file made by FFmpeg with `args` before the output.
        fn make(&self, name: &str, args: &[&str]) -> PathBuf {
            self.try_make(name, args)
                .unwrap_or_else(|| panic!("making {name}"))
        }

        fn try_make(&self, name: &str, args: &[&str]) -> Option<PathBuf> {
            let path = self.root.join(name);
            let status = Command::new(self.tools.ffmpeg.as_ref().unwrap())
                .args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error"])
                .args(args)
                .arg(&path)
                .status()
                .unwrap();
            status.success().then_some(path)
        }

        fn read(&self, path: &Path, from: &str) -> MetadataInfo {
            crate::metadata::read(path, from, FileKind::Video, &self.tools).unwrap()
        }

        fn write(&self, input: &Path, from: &str, name: &str, change: &MetadataChange) -> PathBuf {
            let dest = self.root.join(format!(".{name}.kento-part"));
            self.try_write(input, from, &dest, change).unwrap();
            dest
        }

        fn try_write(
            &self,
            input: &Path,
            from: &str,
            dest: &Path,
            change: &MetadataChange,
        ) -> Result<Vec<PathBuf>> {
            crate::metadata::write(&MetadataRun {
                input,
                from,
                kind: FileKind::Video,
                change,
                dest,
                temp: &self.temp,
                tools: &self.tools,
                progress: &Progress::none(),
            })
        }
    }

    fn value<'a>(info: &'a MetadataInfo, key: &str) -> &'a str {
        info.fields
            .iter()
            .find(|field| field.key == key && field.editable)
            .map(|field| field.value.as_str())
            .unwrap_or_default()
    }

    const VIDEO: &[&str] = &[
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=64x48:r=10:d=2",
        "-f",
        "lavfi",
        "-i",
        "sine=d=2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-shortest",
    ];

    #[test]
    fn edits_tags_and_chapters_of_an_mp4_then_removes_location_and_everything() {
        let Some(lab) = Lab::new() else { return };
        let mut args = VIDEO.to_vec();
        args.extend([
            "-metadata",
            "title=Eski",
            "-metadata",
            "location=+38.6430+034.8281/",
        ]);
        let input = lab.make("Kapadokya 🎈.mp4", &args);
        let before = fs::read(&input).unwrap();
        let info = lab.read(&input, "mp4");
        assert_eq!(value(&info, "title"), "Eski");
        assert!(info.has_location && info.chapters_editable && info.chapters.is_empty());

        let mut change = MetadataChange::default();
        change.set.insert("title".into(), "Yeni başlık 😀".into());
        change.set.insert("artist".into(), "Sanatçı Ğ".into());
        change.set.insert("comment".into(), "bir\nik = i".into());
        change.chapters = Some(vec![
            chapter(0.0, 1.0, "Giriş"),
            chapter(1.0, 2.0, "İkinci = bölüm"),
        ]);
        let edited = lab.write(&input, "mp4", "edited", &change);
        assert_eq!(fs::read(&input).unwrap(), before, "the input is untouched");
        let info = lab.read(&edited, "mp4");
        assert_eq!(value(&info, "title"), "Yeni başlık 😀");
        assert_eq!(value(&info, "artist"), "Sanatçı Ğ");
        assert_eq!(value(&info, "comment"), "bir\nik = i");
        let titles: Vec<&str> = info.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, ["Giriş", "İkinci = bölüm"]);
        assert!(info.has_location, "the location stays unless asked");

        let located = MetadataChange {
            remove_location: true,
            ..MetadataChange::default()
        };
        let unlocated = lab.write(&edited, "mp4", "unlocated", &located);
        let info = lab.read(&unlocated, "mp4");
        assert!(!info.has_location);
        assert_eq!(value(&info, "title"), "Yeni başlık 😀");
        assert_eq!(info.chapters.len(), 2, "chapters stay when not edited");

        let cleared = MetadataChange {
            remove_all: true,
            ..MetadataChange::default()
        };
        let bare = lab.write(&edited, "mp4", "bare", &cleared);
        let report = probe(lab.tools.ffprobe.as_ref().unwrap(), &bare).unwrap();
        let stripped = super::info(&report, "mp4");
        assert!(!stripped.has_location && stripped.chapters.is_empty());
        assert!(stripped
            .fields
            .iter()
            .filter(|f| f.editable)
            .all(|f| f.value.is_empty()));
        assert!(!report.format.tags.keys().any(|k| k == "encoder"));
        let kinds: Vec<&str> = report.streams.iter().map(Stream::kind).collect();
        assert_eq!(kinds, ["video", "audio"]);

        // An empty chapter list removes the chapters.
        let none = MetadataChange {
            chapters: Some(Vec::new()),
            ..MetadataChange::default()
        };
        let unchaptered = lab.write(&edited, "mp4", "unchaptered", &none);
        assert!(lab.read(&unchaptered, "mp4").chapters.is_empty());
    }

    #[test]
    fn edits_an_mp3_and_an_ogg_where_their_tags_live() {
        let Some(lab) = Lab::new() else { return };
        let mp3 = lab.make(
            "Şarkı ğ 🎵.mp3",
            &[
                "-f",
                "lavfi",
                "-i",
                "sine=d=2",
                "-c:a",
                "libmp3lame",
                "-metadata",
                "album=Eski albüm",
            ],
        );
        let mut change = MetadataChange::default();
        change.set.insert("title".into(), "Türkü".into());
        change.set.insert("album".into(), String::new());
        change.set.insert("track".into(), "3/12".into());
        change.chapters = Some(vec![chapter(0.0, 1.2, "Nakarat")]);
        let edited = lab.write(&mp3, "mp3", "edited mp3", &change);
        let info = lab.read(&edited, "mp3");
        assert_eq!(value(&info, "title"), "Türkü");
        assert_eq!(value(&info, "album"), "");
        assert_eq!(value(&info, "track"), "3/12");
        assert_eq!(info.chapters.len(), 1);
        assert_eq!(info.chapters[0].title, "Nakarat");

        let bare = lab.write(
            &edited,
            "mp3",
            "bare mp3",
            &MetadataChange {
                remove_all: true,
                ..MetadataChange::default()
            },
        );
        let info = lab.read(&bare, "mp3");
        assert!(info.chapters.is_empty());
        assert!(info.fields.iter().all(|f| f.editable && f.value.is_empty()));

        // Ogg keeps the comments on the sound stream; the edit must reach them there.
        let Some(ogg) = lab.try_make(
            "Ses ğ 🎵.ogg",
            &[
                "-f",
                "lavfi",
                "-i",
                "sine=d=2",
                "-c:a",
                "libvorbis",
                "-metadata:s:a:0",
                "title=Eski",
            ],
        ) else {
            eprintln!("this FFmpeg has no libvorbis; skipped the OGG check");
            return;
        };
        assert_eq!(value(&lab.read(&ogg, "ogg"), "title"), "Eski");
        let mut change = MetadataChange::default();
        change.set.insert("title".into(), "Yeni".into());
        let edited = lab.write(&ogg, "ogg", "edited ogg", &change);
        assert_eq!(value(&lab.read(&edited, "ogg"), "title"), "Yeni");
    }

    #[test]
    fn containers_without_chapters_or_a_field_refuse_them_clearly() {
        let Some(lab) = Lab::new() else { return };
        let wav = lab.make("Kayıt 🎙.wav", &["-f", "lavfi", "-i", "sine=d=2"]);
        let info = lab.read(&wav, "wav");
        assert!(!info.chapters_editable);
        assert!(!info.fields.iter().any(|f| f.key == "composer"));
        let dest = lab.root.join("out.wav");
        let chapters = MetadataChange {
            chapters: Some(vec![chapter(0.0, 1.0, "x")]),
            ..MetadataChange::default()
        };
        let result = lab.try_write(&wav, "wav", &dest, &chapters);
        assert!(
            matches!(result, Err(Error::Unsupported { .. })),
            "{result:?}"
        );
        let mut composer = MetadataChange::default();
        composer.set.insert("composer".into(), "x".into());
        assert!(lab.try_write(&wav, "wav", &dest, &composer).is_err());
        assert!(!dest.exists());
    }
}
