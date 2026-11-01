// SPDX-License-Identifier: MIT
//! Turning stored entry names into paths that stay inside the destination folder (zip-slip), are
//! valid on this system, and never land on a name already written.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};

use crate::{Error, Result};

/// Gives up on a name after this many numbered tries.
const MAX_TRIES: u32 = 10_000;

/// The parts of a stored path that can be joined under a folder: separators of either kind, and
/// no root, drive, UNC prefix, `.` or `..` (a `..` drops the part before it, never more).
pub(super) fn components(name: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    for raw in name.split(['/', '\\']) {
        let part: String = raw.chars().filter(|&c| c != '\0').collect();
        match part.as_str() {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ if parts.is_empty() && is_drive(&part) => {}
            _ => parts.push(part),
        }
    }
    parts
}

/// `components`, each part also made a valid file name here.
pub(super) fn local_components(name: &str) -> Vec<String> {
    components(name)
        .iter()
        .map(|part| file_name(part, cfg!(windows)))
        .collect()
}

fn is_drive(part: &str) -> bool {
    let bytes = part.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// Makes one path part a valid file name. With `windows`, characters and names Windows forbids
/// are replaced rather than failing the whole extraction; this also neutralises NTFS
/// alternate-stream names (`name:stream`).
pub(super) fn file_name(part: &str, windows: bool) -> String {
    let mut name: String = part
        .chars()
        .map(|c| {
            let forbidden = c == '\0' || (windows && (c < ' ' || "<>:\"|?*".contains(c)));
            if forbidden {
                '_'
            } else {
                c
            }
        })
        .collect();
    if windows {
        let kept = name.trim_end_matches(['.', ' ']).len();
        name.truncate(kept);
        if name.is_empty() {
            name.push('_');
        }
        if is_reserved(&name) {
            name.insert(0, '_');
        }
    }
    shorten(name, windows)
}

/// Device names Windows reserves in every folder, with or without an extension.
fn is_reserved(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return true;
    }
    let mut chars = stem.chars();
    let prefix: String = chars.by_ref().take(3).collect();
    let digit = chars.next();
    (prefix == "COM" || prefix == "LPT")
        && matches!(digit, Some('0'..='9' | '¹' | '²' | '³'))
        && chars.next().is_none()
}

/// Cuts a name to the 255 units file systems allow, keeping a short extension and room for a
/// ` (n)` suffix.
fn shorten(name: String, windows: bool) -> String {
    let units = |s: &str| {
        if windows {
            s.encode_utf16().count()
        } else {
            s.len()
        }
    };
    const MAX: usize = 255;
    const ROOM: usize = 12;
    if units(&name) <= MAX {
        return name;
    }
    let (stem, ext) = split_extension(&name);
    let ext = if units(ext) <= 32 { ext } else { "" };
    let budget = MAX - ROOM - units(ext);
    let mut out = String::new();
    for c in stem.chars() {
        let mut buf = [0; 4];
        if units(&out) + units(c.encode_utf8(&mut buf)) > budget {
            break;
        }
        out.push(c);
    }
    out.push_str(ext);
    out
}

/// `report.pdf` → (`report`, `.pdf`); a leading dot does not start an extension.
fn split_extension(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(dot) if dot > 0 => name.split_at(dot),
        _ => (name, ""),
    }
}

/// The `n`th name for a path part: the part itself, then `stem (2).ext`, `stem (3).ext`, …
pub(super) fn numbered(part: &str, n: u32) -> String {
    if n <= 1 {
        return part.to_owned();
    }
    let (stem, ext) = split_extension(part);
    format!("{stem} ({n}){ext}")
}

/// `numbered` on the last part of a `/`-separated archive path.
pub(super) fn numbered_path(path: &str, n: u32) -> String {
    match path.rsplit_once('/') {
        Some((parent, last)) => format!("{parent}/{}", numbered(last, n)),
        None => numbered(path, n),
    }
}

/// Names compare case-insensitively where the file system does.
fn fold(name: &str) -> String {
    if cfg!(any(windows, target_os = "macos")) {
        name.to_lowercase()
    } else {
        name.to_owned()
    }
}

/// Decides where each extracted entry goes under the destination folder. Entries that map to the
/// same name never overwrite each other: the later one gets a number, and a folder that collides
/// with a file is numbered with everything inside it.
pub(super) struct Placer {
    root: PathBuf,
    /// Archive folder path (folded) → (path under `root`, its folded key).
    dirs: HashMap<String, (PathBuf, String)>,
    /// Every path under `root` already used (folded).
    taken: HashSet<String>,
}

impl Placer {
    pub(super) fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            dirs: HashMap::new(),
            taken: HashSet::new(),
        }
    }

    /// Creates the folders for `parts` and returns the last one.
    pub(super) fn dir(&mut self, parts: &[String]) -> Result<PathBuf> {
        let (relative, _) = self.dir_inner(parts)?;
        Ok(self.root.join(relative))
    }

    fn dir_inner(&mut self, parts: &[String]) -> Result<(PathBuf, String)> {
        let mut real = PathBuf::new();
        let mut real_key = String::new();
        let mut logical = String::new();
        for part in parts {
            if !logical.is_empty() {
                logical.push('/');
            }
            logical.push_str(part);
            let logical_key = fold(&logical);
            if let Some((found, key)) = self.dirs.get(&logical_key) {
                real.clone_from(found);
                real_key.clone_from(key);
                continue;
            }
            let (name, key) = self.free_dir(&real, &real_key, part)?;
            real.push(name);
            real_key = key;
            self.dirs
                .insert(logical_key, (real.clone(), real_key.clone()));
        }
        Ok((real, real_key))
    }

    fn free_dir(
        &mut self,
        parent: &Path,
        parent_key: &str,
        part: &str,
    ) -> Result<(String, String)> {
        for n in 1..=MAX_TRIES {
            let name = numbered(part, n);
            let key = child_key(parent_key, &name);
            if self.taken.contains(&key) {
                continue;
            }
            self.taken.insert(key.clone());
            let path = self.checked(&parent.join(&name))?;
            match fs::create_dir(&path) {
                Ok(()) => return Ok((name, key)),
                // The file system folds names further than `fold` (Unicode normalisation): the
                // folder is one of ours, so the two merge.
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists && is_plain_dir(&path) => {
                    return Ok((name, key));
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        }
        Err(Error::Other("too many entries with the same name".into()))
    }

    /// Creates a new, empty file for `parts` (which must not be empty).
    pub(super) fn file(&mut self, parts: &[String]) -> Result<(PathBuf, File)> {
        let Some((last, parents)) = parts.split_last() else {
            return Err(Error::Other("an entry without a name".into()));
        };
        let (parent, parent_key) = self.dir_inner(parents)?;
        for n in 1..=MAX_TRIES {
            let name = numbered(last, n);
            let key = child_key(&parent_key, &name);
            if !self.taken.insert(key) {
                continue;
            }
            let path = self.checked(&parent.join(&name))?;
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => return Ok((path, file)),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        }
        Err(Error::Other("too many entries with the same name".into()))
    }

    /// `relative` under the root, after making sure it cannot leave it.
    fn checked(&self, relative: &Path) -> Result<PathBuf> {
        if relative
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
        {
            Ok(self.root.join(relative))
        } else {
            Err(Error::Other(
                "an entry path leaves the destination folder".into(),
            ))
        }
    }
}

fn child_key(parent_key: &str, name: &str) -> String {
    if parent_key.is_empty() {
        fold(name)
    } else {
        format!("{parent_key}/{}", fold(name))
    }
}

fn is_plain_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_dir())
}
