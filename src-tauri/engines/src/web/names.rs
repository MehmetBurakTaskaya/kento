// SPDX-License-Identifier: MIT
//! The names of downloaded files: made from the title, valid on Windows and macOS, short enough
//! for deep folders, numbered in a post's order; and the move of finished files out of the
//! scratch folder, all of them or none.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{Progress, Result};

/// A title longer than this is cut, at a word when one ends near the cut. Windows counts 260
/// characters for a whole path by default and macOS 255 bytes for one name.
const MAX_CHARS: usize = 80;
const MAX_BYTES: usize = 180;

/// A finished file yt-dlp left in the scratch folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Finished {
    /// Its place in a post (`item 3.jpg`), none for a single video (`item NA.mp4`).
    pub index: Option<u32>,
    pub path: PathBuf,
    /// Lower case, without the dot.
    pub ext: String,
}

/// A title as a file name without extension: no character Windows or macOS refuses or hides
/// with, no direction marks that could disguise the extension, no name Windows reserves. Empty
/// when nothing is left.
pub(crate) fn sanitize(title: &str) -> String {
    let mut name = String::with_capacity(title.len());
    let mut chars = title.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '/' | '\\' | '|' | '*' => name.push('-'),
            // "Song: Live" reads as "Song - Live"; "12:30" as "12-30".
            ':' if chars.peek().is_some_and(|next| next.is_whitespace()) => name.push_str(" -"),
            ':' => name.push('-'),
            '?' => {}
            '"' => name.push('\''),
            '<' => name.push('('),
            '>' => name.push(')'),
            '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' => {}
            c if c.is_control() || c.is_whitespace() => name.push(' '),
            c => name.push(c),
        }
    }
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    // Windows drops trailing dots and spaces; a leading dot hides a file on macOS.
    let name = shorten(name.trim_matches(|c: char| c == '.' || c == ' '));
    if reserved(&name) {
        format!("_{name}")
    } else {
        name
    }
}

/// The base name for the files of a download: the title, else the site's address, else the
/// app's own name.
pub(super) fn base(title: &str, url: &str) -> String {
    let name = sanitize(title);
    if !name.is_empty() {
        return name;
    }
    let host = super::host(url).map(|host| sanitize(&host));
    host.filter(|host| !host.is_empty())
        .unwrap_or_else(|| "kento".to_owned())
}

/// At most `MAX_CHARS` characters and `MAX_BYTES` bytes, cut at a word in the last quarter if
/// there is one, without a dangling joiner or separator.
fn shorten(name: &str) -> String {
    if name.chars().count() <= MAX_CHARS && name.len() <= MAX_BYTES {
        return name.to_owned();
    }
    let mut cut = String::new();
    for (count, c) in name.chars().enumerate() {
        if count == MAX_CHARS || cut.len() + c.len_utf8() > MAX_BYTES {
            break;
        }
        cut.push(c);
    }
    if let Some(space) = cut.rfind(' ') {
        if space >= cut.len() * 3 / 4 {
            cut.truncate(space);
        }
    }
    cut.trim_end_matches(|c: char| {
        matches!(
            c,
            ' ' | '.' | '-' | ',' | ';' | '_' | '\u{200D}' | '(' | '\''
        )
    })
    .to_owned()
}

/// Names Windows keeps for devices, also before an extension (`CON.mp4`, `nul.tar.gz`).
fn reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).trim_end();
    let stem = stem.to_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return true;
    }
    let number = stem
        .strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"));
    number.is_some_and(|number| {
        matches!(
            number,
            "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
        )
    })
}

/// The finished files in yt-dlp's output folder, in the post's order.
pub(super) fn finished(out: &Path) -> io::Result<Vec<Finished>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(out)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() || meta.len() == 0 {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((_, ext)) = name.rsplit_once('.') else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        // What yt-dlp leaves while it works never lands here, but a name like it is no result.
        if matches!(ext.as_str(), "part" | "ytdl" | "temp" | "tmp") || name.starts_with('.') {
            continue;
        }
        let stem = name.split('.').next().unwrap_or("");
        let index = stem
            .strip_prefix("item ")
            .and_then(|index| index.trim().parse::<u32>().ok());
        files.push(Finished { index, path, ext });
    }
    files.sort_by(|a, b| (a.index.unwrap_or(0), &a.path).cmp(&(b.index.unwrap_or(0), &b.path)));
    Ok(files)
}

/// `base.ext` for one file; `base 1.ext`, `base 2.ext`, … for several, padded so they sort.
pub(super) fn numbered(base: &str, files: &[Finished]) -> Vec<String> {
    if let [only] = files {
        return vec![format!("{base}.{}", only.ext)];
    }
    let width = files.len().to_string().len();
    files
        .iter()
        .enumerate()
        .map(|(n, file)| format!("{base} {:0width$}.{}", n + 1, file.ext))
        .collect()
}

/// Moves the files into `dest` under `names` (a taken name gets " (2)"), and returns where they
/// went. On a failure or a cancel the files already moved are removed again.
pub(super) fn place(
    files: &[Finished],
    names: &[String],
    dest: &Path,
    progress: &Progress,
) -> Result<Vec<PathBuf>> {
    fs::create_dir_all(dest)?;
    let mut placed = Vec::with_capacity(files.len());
    let mut moving = || -> Result<()> {
        for (file, name) in files.iter().zip(names) {
            progress.check()?;
            let target = free(dest, name);
            move_file(&file.path, &target)?;
            placed.push(target);
        }
        Ok(())
    };
    if let Err(error) = moving() {
        for path in &placed {
            let _ = fs::remove_file(path);
        }
        return Err(error);
    }
    Ok(placed)
}

/// `name` in `dest`, or `stem (2).ext`, `stem (3).ext`, … when it is taken.
fn free(dest: &Path, name: &str) -> PathBuf {
    let first = dest.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    (2u32..)
        .map(|n| {
            if ext.is_empty() {
                dest.join(format!("{stem} ({n})"))
            } else {
                dest.join(format!("{stem} ({n}).{ext}"))
            }
        })
        .find(|path| !path.exists())
        .unwrap_or(first)
}

/// A rename, or a copy under a hidden name and a rename when the scratch folder is on another
/// disk, so the destination never shows a half-copied file under its real name.
fn move_file(from: &Path, to: &Path) -> io::Result<()> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    let name = to
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let part = to.with_file_name(format!(".{name}.kento-part"));
    let copied = fs::copy(from, &part).and_then(|_| fs::rename(&part, to));
    if copied.is_err() {
        let _ = fs::remove_file(&part);
    } else {
        let _ = fs::remove_file(from);
    }
    copied
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_become_names_windows_and_macos_accept() {
        assert_eq!(
            sanitize("  Çağrı: a test / video? 🎬 "),
            "Çağrı - a test - video 🎬"
        );
        assert_eq!(sanitize("12:30 news"), "12-30 news");
        assert_eq!(sanitize(r#"a<b>c"d|e*f\g"#), "a(b)c'd-e-f-g");
        assert_eq!(
            sanitize("line\nbreak\ttab\u{0007}bell"),
            "line break tab bell"
        );
        assert_eq!(sanitize("  ..hidden. . "), "hidden");
        assert_eq!(sanitize("photo\u{202E}gpj.exe"), "photogpj.exe");
        assert_eq!(
            sanitize("İstanbul’da ğüşıöç ÇĞÜŞİÖ"),
            "İstanbul’da ğüşıöç ÇĞÜŞİÖ"
        );
        assert_eq!(sanitize("👩‍👩‍👧 family"), "👩‍👩‍👧 family");
        assert_eq!(sanitize("???"), "");
        assert_eq!(sanitize(""), "");
    }

    #[test]
    fn reserved_windows_names_get_a_prefix() {
        assert_eq!(sanitize("CON"), "_CON");
        assert_eq!(sanitize("con.air"), "_con.air");
        assert_eq!(sanitize("Nul "), "_Nul");
        assert_eq!(sanitize("COM1"), "_COM1");
        assert_eq!(sanitize("lpt²"), "_lpt²");
        assert_eq!(sanitize("Concert"), "Concert");
        assert_eq!(sanitize("COM10"), "COM10");
        assert_eq!(sanitize("AUX party"), "AUX party");
    }

    #[test]
    fn long_titles_are_cut_short() {
        let name = sanitize(&"a".repeat(200));
        assert_eq!(name.chars().count(), MAX_CHARS);
        let name = sanitize(&"ş".repeat(200));
        assert_eq!(name.chars().count(), MAX_CHARS);
        assert!(name.len() <= MAX_BYTES);
        // Four bytes each: the byte limit comes first.
        let name = sanitize(&"🎬".repeat(100));
        assert_eq!(name.len(), MAX_BYTES);
        assert_eq!(name.chars().count(), MAX_BYTES / 4);
        // A word that ends near the cut is where it is cut.
        let words = "word ".repeat(40);
        let name = sanitize(&words);
        assert!(name.ends_with("word"), "{name}");
        assert!(name.chars().count() <= MAX_CHARS);
        // Nothing dangles at the end.
        let title = format!("{} - remix", "x".repeat(MAX_CHARS - 2));
        let name = sanitize(&title);
        assert!(!name.ends_with(['-', ' ']), "{name}");
    }

    #[test]
    fn the_base_name_falls_back_to_the_site() {
        assert_eq!(base("Clip", "https://example.org/a"), "Clip");
        assert_eq!(
            base("???", "https://www.youtube.com/watch?v=x"),
            "youtube.com"
        );
        assert_eq!(base("", "https://[::1]/x"), "[--1]");
        assert_eq!(base("", "not a link"), "kento");
    }

    fn file(index: Option<u32>, ext: &str) -> Finished {
        Finished {
            index,
            path: PathBuf::from(format!("item {index:?}.{ext}")),
            ext: ext.into(),
        }
    }

    #[test]
    fn several_files_are_numbered_in_order() {
        assert_eq!(numbered("Clip", &[file(None, "mp4")]), ["Clip.mp4"]);
        assert_eq!(
            numbered(
                "Post",
                &[
                    file(Some(1), "jpg"),
                    file(Some(3), "jpg"),
                    file(Some(4), "webp")
                ]
            ),
            ["Post 1.jpg", "Post 2.jpg", "Post 3.webp"]
        );
        let twelve: Vec<Finished> = (1..=12).map(|n| file(Some(n), "jpg")).collect();
        let names = numbered("Post", &twelve);
        assert_eq!(names[0], "Post 01.jpg");
        assert_eq!(names[11], "Post 12.jpg");
    }

    #[test]
    fn finished_files_come_in_the_posts_order() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path();
        for name in [
            "item 10.jpg",
            "item 02.jpg",
            "item NA.NA.jpg",
            "item 03.webp",
            "item 04.jpg.part",
            "empty.jpg",
        ] {
            let body: &[u8] = if name == "empty.jpg" { b"" } else { b"x" };
            fs::write(out.join(name), body).unwrap();
        }
        fs::create_dir(out.join("item 05.jpg")).unwrap();
        let found = finished(out).unwrap();
        let summary: Vec<(Option<u32>, &str)> = found
            .iter()
            .map(|file| (file.index, file.ext.as_str()))
            .collect();
        assert_eq!(
            summary,
            [
                (None, "jpg"),
                (Some(2), "jpg"),
                (Some(3), "webp"),
                (Some(10), "jpg")
            ]
        );
    }

    #[test]
    fn files_are_moved_all_or_none() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out");
        let dest = dir.path().join("İndirilenler ğüşıöç 🎬");
        fs::create_dir_all(&out).unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(out.join("item 1.jpg"), b"one").unwrap();
        fs::write(out.join("item 2.jpg"), b"two").unwrap();
        fs::write(dest.join("Post 1.jpg"), b"already here").unwrap();
        let files = finished(&out).unwrap();
        let names = numbered("Post", &files);
        let placed = place(&files, &names, &dest, &Progress::none()).unwrap();
        assert_eq!(
            placed,
            [dest.join("Post 1 (2).jpg"), dest.join("Post 2.jpg")]
        );
        assert_eq!(fs::read(&placed[0]).unwrap(), b"one");
        assert_eq!(fs::read(dest.join("Post 1.jpg")).unwrap(), b"already here");
        assert!(fs::read_dir(&out).unwrap().next().is_none());

        // A cancel before the move leaves the destination as it was.
        fs::write(out.join("item 3.jpg"), b"three").unwrap();
        let files = finished(&out).unwrap();
        let cancelled = || true;
        let progress = Progress::new(&|_| {}, &cancelled);
        let result = place(&files, &numbered("Late", &files), &dest, &progress);
        assert!(matches!(result, Err(crate::Error::Cancelled)));
        assert!(!dest.join("Late.jpg").exists());

        // A file that cannot be moved takes back the ones moved before it.
        let missing = Finished {
            index: Some(9),
            path: out.join("gone.jpg"),
            ext: "jpg".into(),
        };
        let files = vec![finished(&out).unwrap().remove(0), missing];
        let names = numbered("Pair", &files);
        assert!(place(&files, &names, &dest, &Progress::none()).is_err());
        assert!(!dest.join("Pair 1.jpg").exists());
        assert!(!dest.join("Pair 2.jpg").exists());
    }
}
