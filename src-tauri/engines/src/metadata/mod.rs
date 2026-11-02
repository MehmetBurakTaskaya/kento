// SPDX-License-Identifier: MIT
//! Metadata (SPEC 5.5): view, edit and remove. Images through ExifTool, PDF through lopdf, video
//! and audio through ffprobe and FFmpeg (which also carry track and chapter fields). Edits are
//! written to a new copy; the original is never touched.

use std::collections::BTreeMap;
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
    let _ = (path, from, kind, tools);
    Err(Error::Other("metadata is not built yet".into()))
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
    let _ = run;
    Err(Error::Other("metadata is not built yet".into()))
}
