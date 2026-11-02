// SPDX-License-Identifier: MIT
//! Metadata (SPEC 5.5): view, edit and remove. Images through ExifTool, PDF through lopdf, video
//! and audio through ffprobe and FFmpeg (which also carry track and chapter fields). Edits are
//! written to a new copy; the original is never touched.
//!
//! Every read lists all the fields a file carries, read-only and grouped, plus a few common
//! fields under stable keys (`title`, `author`, …) that can be edited; each kind maps those keys
//! to its own tags. Values are data: they are never logged.

mod exiftool;
mod image;
mod media;
mod pdf;

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, FileKind, Progress, Result, Tools};

/// One field as the panel shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    /// Stable within one read: what `MetadataChange::set` names.
    pub key: String,
    /// The family it belongs to (EXIF, XMP, IPTC, PDF, Format, Stream…), shown as a heading.
    pub group: String,
    /// The tag's own name; tag names are not translated.
    pub name: String,
    pub value: String,
    pub editable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub start: f64,
    pub end: f64,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataInfo {
    pub fields: Vec<Field>,
    /// Video and audio only.
    pub chapters: Vec<Chapter>,
    /// Whether the file carries a position (GPS) that "Remove location" would take out.
    pub has_location: bool,
    /// Whether the file's format can hold chapters, so the panel offers to edit them (MP4, MKV,
    /// MP3 and others; not WAV, AVI, FLAC or OGG Vorbis as FFmpeg writes them).
    #[serde(default)]
    pub chapters_editable: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataChange {
    /// Editable field keys and their new values; an empty value removes the field.
    pub set: BTreeMap<String, String>,
    /// Removes every field that can go. The picture's orientation and colour profile stay, so
    /// the result looks the same.
    pub remove_all: bool,
    /// Removes the position (GPS) fields only.
    pub remove_location: bool,
    /// Video and audio: the new chapter list; None keeps the chapters.
    pub chapters: Option<Vec<Chapter>>,
}

/// Reads what the panel shows.
pub fn read(path: &Path, from: &str, kind: FileKind, tools: &Tools) -> Result<MetadataInfo> {
    // A missing file is an I/O error, not a damaged one.
    fs::metadata(path)?;
    match kind {
        FileKind::Image => image::read(path, from, tools),
        FileKind::Pdf => pdf::read(path),
        FileKind::Video | FileKind::Audio => media::read(path, from, tools),
    }
}

/// One metadata edit.
pub struct MetadataRun<'a> {
    pub input: &'a Path,
    /// The catalog id of the input format; the result keeps it.
    pub from: &'a str,
    pub kind: FileKind,
    pub change: &'a MetadataChange,
    /// The file to create, with the input's extension.
    pub dest: &'a Path,
    pub temp: &'a Path,
    pub tools: &'a Tools,
    pub progress: &'a Progress<'a>,
}

/// Writes a copy of the input with the change applied and returns it.
pub fn write(run: &MetadataRun) -> Result<Vec<PathBuf>> {
    run.progress.check()?;
    fs::metadata(run.input)?;
    tracing::debug!(
        kind = ?run.kind,
        fields = run.change.set.len(),
        remove_all = run.change.remove_all,
        remove_location = run.change.remove_location,
        chapters = run.change.chapters.as_ref().map(Vec::len),
        "writing metadata"
    );
    match run.kind {
        FileKind::Image => image::write(run)?,
        FileKind::Pdf => pdf::write(run)?,
        FileKind::Video | FileKind::Audio => media::write(run)?,
    }
    run.progress.report(1.0);
    Ok(vec![run.dest.to_path_buf()])
}

/// Longer values are cut for the panel (a maker note's dump, an embedded document); nothing is
/// ever cut when writing.
const MAX_VALUE: usize = 2000;

fn clip(value: &str) -> String {
    match value.char_indices().nth(MAX_VALUE) {
        Some((at, _)) => format!("{}…", &value[..at]),
        None => value.to_owned(),
    }
}

/// A field the panel only shows.
fn shown(key: String, group: &str, name: &str, value: &str) -> Field {
    Field {
        key,
        group: group.to_owned(),
        name: name.to_owned(),
        value: clip(value),
        editable: false,
    }
}

/// A common field under a stable key; its value is never cut, since it is edited as a whole.
fn editable(key: &str, group: &str, name: &str, value: String) -> Field {
    Field {
        key: key.to_owned(),
        group: group.to_owned(),
        name: name.to_owned(),
        value,
        editable: true,
    }
}

/// Refuses keys this file has no editable field for.
fn check_keys(change: &MetadataChange, known: &[&str]) -> Result<()> {
    match change.set.keys().find(|key| !known.contains(&key.as_str())) {
        Some(key) => Err(Error::Other(format!(
            "the field {key:?} cannot be edited in this file"
        ))),
        None => Ok(()),
    }
}

/// Moves a finished file from the job's temp folder to its destination, copying when they are on
/// different drives.
fn move_file(from: &Path, to: &Path) -> io::Result<()> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to)?;
    let _ = fs::remove_file(from);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_values_are_cut_for_the_panel_only() {
        let long = "ğ".repeat(MAX_VALUE + 5);
        let cut = clip(&long);
        assert_eq!(cut.chars().count(), MAX_VALUE + 1);
        assert!(cut.ends_with('…'));
        assert_eq!(clip("kısa 😀"), "kısa 😀");
        assert_eq!(editable("title", "XMP", "Title", long.clone()).value, long);
    }

    #[test]
    fn the_page_contract_is_camel_case() {
        let info = MetadataInfo {
            fields: vec![shown("k".into(), "EXIF", "Make", "Kento")],
            chapters: vec![Chapter {
                start: 0.0,
                end: 1.5,
                title: "Giriş".into(),
            }],
            has_location: true,
            chapters_editable: true,
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["hasLocation"], true);
        assert_eq!(json["chaptersEditable"], true);
        assert_eq!(json["fields"][0]["editable"], false);
        let change: MetadataChange = serde_json::from_str(
            r#"{"set":{"title":"Yeni"},"removeAll":false,"removeLocation":true,"chapters":null}"#,
        )
        .unwrap();
        assert!(change.remove_location && change.chapters.is_none());
        assert!(check_keys(&change, &["title"]).is_ok());
        assert!(check_keys(&change, &["author"]).is_err());
    }
}
