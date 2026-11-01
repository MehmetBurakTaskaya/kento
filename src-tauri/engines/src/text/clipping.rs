// SPDX-License-Identifier: MIT
//! macOS text clippings (`.textclipping`).
//!
//! Current ones are property lists (binary or XML) that keep the clipped text under uniform type
//! identifiers. Old ones keep it in a resource fork, which survives only on a Mac file system or
//! in an AppleDouble `._` companion file (zip archives and non-Mac disks); without it the text is
//! gone and the clipping cannot be read.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use encoding_rs::{MACINTOSH, UTF_16BE, UTF_16LE};
use plist::Value;

use crate::{Error, Result};

const MAX_CLIPPING_BYTES: u64 = 64 << 20;

/// Text types in order of preference: how each is stored and how to read it.
const TEXT_TYPES: [(&str, Encoding); 6] = [
    ("public.utf8-plain-text", Encoding::Utf8),
    ("public.plain-text", Encoding::Utf8),
    ("NSStringPboardType", Encoding::Utf8),
    ("public.utf16-plain-text", Encoding::Utf16Le),
    ("public.utf16-external-plain-text", Encoding::Utf16Be),
    ("public.html", Encoding::Html),
];

#[derive(Clone, Copy)]
enum Encoding {
    Utf8,
    /// Native byte order, little-endian on every Mac that writes these files.
    Utf16Le,
    /// Big-endian unless a BOM says otherwise.
    Utf16Be,
    Html,
}

pub(super) fn read(path: &Path) -> Result<String> {
    let bytes = super::read_capped(path, MAX_CLIPPING_BYTES)?;
    if !bytes.is_empty() {
        if let Some(found) = from_plist(&bytes) {
            return found
                .ok_or_else(|| Error::Unreadable("the clipping holds no plain text".into()));
        }
    }
    if let Some(text) = resource_forks(path)
        .into_iter()
        .find_map(|fork| from_resource_fork(&fork))
    {
        return Ok(text);
    }
    Err(Error::Unreadable(if bytes.is_empty() {
        "this clipping keeps its text in a resource fork, which this copy of the file does not \
         carry"
            .into()
    } else {
        "this is not a text clipping".into()
    }))
}

/// A clipping nests two or three levels. The property list parser, and dropping what it built,
/// recurse once per level, so anything deeper than this is refused before parsing.
const MAX_PLIST_DEPTH: usize = 64;

/// The best text in the property list (`UTI-Data` in current files): `None` when the bytes are
/// no property list, `Some(None)` when it holds no plain text.
fn from_plist(bytes: &[u8]) -> Option<Option<String>> {
    let value = if bytes.starts_with(b"bplist00") {
        if !binary_depth_within(bytes, MAX_PLIST_DEPTH) {
            return None;
        }
        Value::from_reader(Cursor::new(bytes)).ok()?
    } else {
        if !xml_depth_within(bytes, MAX_PLIST_DEPTH) {
            return None;
        }
        Value::from_reader_xml(bytes).ok()?
    };
    let mut best: Option<(usize, String)> = None;
    collect(&value, &mut best);
    Some(best.map(|(_, text)| text))
}

/// Looks through nested dictionaries for the best text type.
fn collect(value: &Value, best: &mut Option<(usize, String)>) {
    match value {
        Value::Dictionary(dict) => {
            for (key, value) in dict {
                let found = TEXT_TYPES
                    .iter()
                    .position(|(name, _)| name == key)
                    .filter(|&rank| best.as_ref().is_none_or(|(best, _)| rank < *best));
                match found
                    .and_then(|rank| text_value(value, TEXT_TYPES[rank].1).map(|t| (rank, t)))
                {
                    Some(hit) => *best = Some(hit),
                    None => collect(value, best),
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect(item, best);
            }
        }
        _ => {}
    }
}

/// Whether the containers of an XML property list nest at most `max` deep, from its tags.
fn xml_depth_within(bytes: &[u8], max: usize) -> bool {
    let mut depth = 0usize;
    let mut at = 0;
    while let Some(offset) = bytes[at..].iter().position(|&b| b == b'<') {
        let tag = &bytes[at + offset + 1..];
        let Some(end) = tag.iter().position(|&b| b == b'>') else {
            break;
        };
        at += offset + 1 + end + 1;
        let (closing, name) = match tag.strip_prefix(b"/") {
            Some(name) => (true, name),
            None => (false, tag),
        };
        if !(name.starts_with(b"array") || name.starts_with(b"dict")) {
            continue;
        }
        if closing {
            depth = depth.saturating_sub(1);
        } else if tag[..end].last() != Some(&b'/') {
            depth += 1;
            if depth > max {
                return false;
            }
        }
    }
    true
}

/// Whether the containers of a binary property list nest at most `max` deep (which also rules
/// out cycles), walking the object table level by level as the format lays it out: a 32-byte
/// trailer gives the offset table, and arrays, sets and dictionaries list object references.
fn binary_depth_within(bytes: &[u8], max: usize) -> bool {
    let Some(trailer) = bytes.len().checked_sub(32).map(|at| &bytes[at..]) else {
        return false;
    };
    let (offset_size, ref_size) = (usize::from(trailer[6]), usize::from(trailer[7]));
    if !(1..=8).contains(&offset_size) || !(1..=8).contains(&ref_size) {
        return false;
    }
    let number = |at: usize, size: usize| -> Option<u64> {
        let field = bytes.get(at..at.checked_add(size)?)?;
        Some(field.iter().fold(0u64, |n, &b| (n << 8) | u64::from(b)))
    };
    let (Some(objects), Some(top), Some(table)) = (
        number(bytes.len() - 24, 8),
        number(bytes.len() - 16, 8),
        number(bytes.len() - 8, 8),
    ) else {
        return false;
    };
    let offset = |object: u64| -> Option<usize> {
        if object >= objects {
            return None;
        }
        let entry =
            usize::try_from(table.checked_add(object.checked_mul(offset_size as u64)?)?).ok()?;
        usize::try_from(number(entry, offset_size)?).ok()
    };
    let mut level = vec![top];
    for _ in 0..=max {
        let mut next = std::collections::HashSet::new();
        for &object in &level {
            let Some(at) = offset(object) else {
                return false;
            };
            let Some(&marker) = bytes.get(at) else {
                return false;
            };
            if !matches!(marker >> 4, 0xA | 0xC | 0xD) {
                continue;
            }
            // Counts of 15 and more follow the marker as an integer object (0x1n, 2^n bytes).
            let (count, refs_at) = match marker & 0x0F {
                0x0F => match bytes.get(at + 1) {
                    Some(&int) if int >> 4 == 0x1 && int & 0x0F <= 3 => {
                        let size = 1usize << (int & 0x0F);
                        let Some(count) = number(at + 2, size) else {
                            return false;
                        };
                        (count, at + 2 + size)
                    }
                    _ => return false,
                },
                small => (u64::from(small), at + 1),
            };
            let refs = if marker >> 4 == 0xD { count * 2 } else { count };
            if refs.saturating_mul(ref_size as u64) > bytes.len() as u64 {
                return false;
            }
            for k in 0..refs as usize {
                let Some(child) = number(refs_at + k * ref_size, ref_size) else {
                    return false;
                };
                next.insert(child);
            }
        }
        if next.is_empty() {
            return true;
        }
        level = next.into_iter().collect();
    }
    false
}

fn text_value(value: &Value, encoding: Encoding) -> Option<String> {
    let text = match value {
        Value::String(text) => text.clone(),
        Value::Data(bytes) => match encoding {
            Encoding::Utf8 | Encoding::Html => super::decode(bytes),
            Encoding::Utf16Le | Encoding::Utf16Be
                if encoding_rs::Encoding::for_bom(bytes).is_some() =>
            {
                super::decode(bytes)
            }
            Encoding::Utf16Le => UTF_16LE.decode_without_bom_handling(bytes).0.into_owned(),
            Encoding::Utf16Be => UTF_16BE.decode_without_bom_handling(bytes).0.into_owned(),
        },
        _ => return None,
    };
    let text = match encoding {
        Encoding::Html => super::html::to_text(&text).ok()?,
        _ => text,
    };
    Some(text.trim_end_matches('\0').to_owned())
}

/// Where an old clipping's resource fork may still be.
fn resource_forks(path: &Path) -> Vec<Vec<u8>> {
    let mut forks = Vec::new();
    #[cfg(target_os = "macos")]
    if let Ok(fork) = super::read_capped(&path.join("..namedfork/rsrc"), MAX_CLIPPING_BYTES) {
        forks.push(fork);
    }
    if let Some(fork) = apple_double(path)
        .and_then(|companion| super::read_capped(&companion, MAX_CLIPPING_BYTES).ok())
        .and_then(|file| apple_double_fork(&file).map(<[u8]>::to_vec))
    {
        forks.push(fork);
    }
    forks
}

fn apple_double(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    Some(path.with_file_name(format!("._{name}")))
}

/// The resource fork entry of an AppleSingle or AppleDouble file (RFC 1740).
fn apple_double_fork(file: &[u8]) -> Option<&[u8]> {
    if !matches!(be32(file, 0)?, 0x0005_1600 | 0x0005_1607) {
        return None;
    }
    let entries = usize::from(be16(file, 24)?);
    (0..entries).find_map(|i| {
        let entry = 26 + i * 12;
        if be32(file, entry)? != 2 {
            return None;
        }
        let offset = be32(file, entry + 4)? as usize;
        let length = be32(file, entry + 8)? as usize;
        file.get(offset..offset.checked_add(length)?)
    })
}

/// The text of a classic Mac resource fork ('utf8', 'utxt' or 'TEXT' resource), as laid out in
/// Inside Macintosh: More Macintosh Toolbox, "Resource Manager".
fn from_resource_fork(fork: &[u8]) -> Option<String> {
    let data_start = be32(fork, 0)? as usize;
    let map_start = be32(fork, 4)? as usize;
    let types_start =
        map_start.checked_add(usize::from(be16(fork, map_start.checked_add(24)?)?))?;
    let type_count = usize::from(be16(fork, types_start)?) + 1;
    let resource = |wanted: &[u8; 4]| -> Option<&[u8]> {
        (0..type_count).find_map(|i| {
            let entry = types_start + 2 + i * 8;
            if fork.get(entry..entry + 4)? != wanted {
                return None;
            }
            let refs = types_start + usize::from(be16(fork, entry + 6)?);
            // The first resource of the type: a clipping has one.
            let offset = (be32(fork, refs + 4)? & 0x00ff_ffff) as usize;
            let at = data_start.checked_add(offset)?;
            let length = be32(fork, at)? as usize;
            fork.get(at + 4..(at + 4).checked_add(length)?)
        })
    };
    if let Some(bytes) = resource(b"utf8") {
        return Some(String::from_utf8_lossy(bytes).into_owned());
    }
    if let Some(bytes) = resource(b"utxt") {
        return Some(UTF_16BE.decode_without_bom_handling(bytes).0.into_owned());
    }
    resource(b"TEXT").map(|bytes| MACINTOSH.decode_without_bom_handling(bytes).0.into_owned())
}

fn be16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        bytes.get(at..at.checked_add(2)?)?.try_into().ok()?,
    ))
}

fn be32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}

#[cfg(test)]
pub(super) mod fixtures {
    /// A resource fork with one resource of `kind` holding `data`.
    pub fn resource_fork(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let data_start = 256u32;
        let mut fork = vec![0u8; 256];
        fork.extend_from_slice(&(data.len() as u32).to_be_bytes());
        fork.extend_from_slice(data);
        let map_start = fork.len() as u32;
        let mut map = vec![0u8; 28];
        map[24..26].copy_from_slice(&28u16.to_be_bytes());
        // Type list: one type, one reference right after it.
        map.extend_from_slice(&0u16.to_be_bytes());
        map.extend_from_slice(kind);
        map.extend_from_slice(&0u16.to_be_bytes());
        map.extend_from_slice(&10u16.to_be_bytes());
        map.extend_from_slice(&128i16.to_be_bytes());
        map.extend_from_slice(&0xffffu16.to_be_bytes());
        map.extend_from_slice(&0u32.to_be_bytes());
        map.extend_from_slice(&0u32.to_be_bytes());
        fork.extend_from_slice(&map);
        fork[0..4].copy_from_slice(&data_start.to_be_bytes());
        fork[4..8].copy_from_slice(&map_start.to_be_bytes());
        fork[8..12].copy_from_slice(&(data.len() as u32 + 4).to_be_bytes());
        fork[12..16].copy_from_slice(&(map.len() as u32).to_be_bytes());
        fork
    }

    /// An AppleDouble companion file carrying `fork`.
    pub fn apple_double(fork: &[u8]) -> Vec<u8> {
        let mut file = Vec::new();
        file.extend_from_slice(&0x0005_1607u32.to_be_bytes());
        file.extend_from_slice(&0x0002_0000u32.to_be_bytes());
        file.extend_from_slice(&[0u8; 16]);
        file.extend_from_slice(&1u16.to_be_bytes());
        file.extend_from_slice(&2u32.to_be_bytes());
        file.extend_from_slice(&38u32.to_be_bytes());
        file.extend_from_slice(&(fork.len() as u32).to_be_bytes());
        file.extend_from_slice(fork);
        file
    }
}
