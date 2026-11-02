// SPDX-License-Identifier: MIT
//! The portable Windows copy updates from its own ZIP (SPEC 5.16, decision 46), once the updater
//! has checked the ZIP's signature. Every file of the new version is first written in full beside
//! the one it replaces; then each old file steps aside under a name ending in `.old` and the new
//! one takes its name. Windows lets a running program or a loaded library be renamed but not
//! overwritten, which is why old files step aside instead of being written over: the running
//! Kento.exe becomes Kento.old. An entry that would land outside Kento's folder refuses the whole
//! update before anything is written, and a step that fails undoes the steps before it, so the
//! folder always keeps a working copy. What stepped aside and is still in use goes at the next
//! start.
//!
//! This is plain file work, so it builds and is tested everywhere; only Windows uses it.

use std::fs::{self, File};
use std::io::{self, Cursor, Read, Seek};
use std::path::{Path, PathBuf};

use zip::ZipArchive;

/// The program in the ZIP. It replaces the running program, whatever that is called.
const PROGRAM: &str = "Kento.exe";
/// The ending of a new file while it waits beside the old one.
const STAGED: &str = "kento-new";
/// What stepped aside and could not be removed yet, in the data folder.
const LEFTOVERS: &str = "update-leftovers.json";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("the update is not a readable ZIP: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("the update holds {0:?}, which would land outside Kento's folder")]
    Outside(String),
    #[error("the update holds no {PROGRAM}")]
    NoProgram,
    #[error("{0}")]
    Io(#[from] io::Error),
}

/// One file of the update: its entry in the ZIP, its place, where it waits until every file is
/// written, and the name its old copy steps aside to.
struct Placed {
    index: usize,
    target: PathBuf,
    staged: PathBuf,
    aside: PathBuf,
}

impl Placed {
    fn new(index: usize, target: PathBuf, aside: PathBuf) -> Self {
        let mut staged = target.clone().into_os_string();
        staged.push(".");
        staged.push(STAGED);
        Self {
            index,
            target,
            staged: staged.into(),
            aside,
        }
    }
}

/// `path` with ".old" added to its name.
fn old_name(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".old");
    name.into()
}

/// Replaces the program at `exe` and the files beside it with those in `zip`, whose signature the
/// updater has checked. Returns what stepped aside and is still there: the old program, which
/// runs until the restart, and any old file still in use.
pub fn replace(exe: &Path, zip: &[u8]) -> Result<Vec<PathBuf>, Error> {
    let dir = exe
        .parent()
        .ok_or_else(|| io::Error::other("the program has no folder"))?;
    let mut archive = ZipArchive::new(Cursor::new(zip))?;
    let files = plan(&mut archive, exe, dir)?;

    let mut made = Vec::new();
    if let Err(err) = stage(&mut archive, &files, &mut made) {
        discard(&files, &made);
        return Err(err);
    }
    let mut swapped: Vec<(&Placed, bool)> = Vec::new();
    for file in &files {
        match swap(file) {
            Ok(had_old) => swapped.push((file, had_old)),
            Err(err) => {
                undo(&swapped);
                discard(&files, &made);
                return Err(err.into());
            }
        }
    }
    // The program goes last, so it is the last one here; it runs until the restart.
    let leftovers = swapped
        .iter()
        .filter(|(_, had_old)| *had_old)
        .map(|(file, _)| &file.aside)
        .filter(|aside| *aside == &exe.with_extension("old") || fs::remove_file(aside).is_err())
        .cloned()
        .collect();
    Ok(leftovers)
}

/// Where each file of the archive goes, checked before anything is written. The program comes
/// last, so a file that cannot be swapped never touches it.
fn plan<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    exe: &Path,
    dir: &Path,
) -> Result<Vec<Placed>, Error> {
    let mut files = Vec::new();
    let mut program = None;
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index)?;
        let name = entry.name()?.into_owned();
        if entry.is_dir() {
            continue;
        }
        let place = (!entry.is_symlink() && entry.enclosed_name().is_some())
            .then(|| inside(&name))
            .flatten()
            .ok_or_else(|| Error::Outside(name.clone()))?;
        if place.as_os_str().eq_ignore_ascii_case(PROGRAM) {
            program = Some(Placed::new(
                index,
                exe.to_path_buf(),
                exe.with_extension("old"),
            ));
        } else {
            let target = dir.join(&place);
            let aside = old_name(&target);
            files.push(Placed::new(index, target, aside));
        }
    }
    files.push(program.ok_or(Error::NoProgram)?);
    Ok(files)
}

/// The entry's place under Kento's folder, or None when its name is absolute, steps up with `..`
/// or names a drive or a stream (`C:`, `file:stream`).
fn inside(name: &str) -> Option<PathBuf> {
    let mut place = PathBuf::new();
    for part in name.split(['/', '\\']) {
        if part.is_empty() || part == "." || part == ".." || part.contains(':') {
            return None;
        }
        place.push(part);
    }
    Some(place)
}

/// Writes every file in full beside its old copy. `made` collects the folders created for them.
fn stage<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    files: &[Placed],
    made: &mut Vec<PathBuf>,
) -> Result<(), Error> {
    for file in files {
        if let Some(parent) = file.target.parent() {
            let missing: Vec<PathBuf> = parent
                .ancestors()
                .take_while(|dir| !dir.exists())
                .map(Path::to_path_buf)
                .collect();
            fs::create_dir_all(parent)?;
            made.extend(missing.into_iter().rev());
        }
        let mut entry = archive.by_index(file.index)?;
        let mut out = File::create(&file.staged)?;
        io::copy(&mut entry, &mut out)?;
        out.sync_all()?;
    }
    Ok(())
}

/// Moves the old file aside and the new one into its place; says whether there was an old file.
/// Undone when the second step fails.
fn swap(file: &Placed) -> io::Result<bool> {
    if file.target.is_dir() {
        return Err(io::Error::other(format!(
            "{} is a folder",
            file.target.display()
        )));
    }
    let had_old = file.target.exists();
    if had_old {
        // A leftover of an earlier update; when it cannot go, the rename below says why.
        let _ = fs::remove_file(&file.aside);
        fs::rename(&file.target, &file.aside)?;
    }
    if let Err(err) = fs::rename(&file.staged, &file.target) {
        if had_old {
            let _ = fs::rename(&file.aside, &file.target);
        }
        return Err(err);
    }
    Ok(had_old)
}

/// Puts the old files back after a swap failed, newest first.
fn undo(swapped: &[(&Placed, bool)]) {
    for (file, had_old) in swapped.iter().rev() {
        let back = if *had_old {
            fs::rename(&file.aside, &file.target)
        } else {
            fs::remove_file(&file.target)
        };
        if let Err(err) = back {
            tracing::error!("{} could not be put back: {err}", file.target.display());
        }
    }
}

/// Removes the new files that wait beside the old ones, and the folders made for them.
fn discard(files: &[Placed], made: &[PathBuf]) {
    for file in files {
        let _ = fs::remove_file(&file.staged);
    }
    for dir in made.iter().rev() {
        let _ = fs::remove_dir(dir);
    }
}

/// Writes down what stepped aside and is still there, for the next start.
pub fn remember(data: &Path, leftovers: &[PathBuf]) -> io::Result<()> {
    fs::write(data.join(LEFTOVERS), serde_json::to_vec_pretty(leftovers)?)
}

/// Removes what an earlier update set aside: the old program and the files it listed, which have
/// stopped by now. What still cannot go stays on the list for the next start. Only names an update
/// gives, ending in `.old`, are ever removed.
pub fn tidy(exe: &Path, data: &Path) {
    let list = data.join(LEFTOVERS);
    let mut paths: Vec<PathBuf> = fs::read(&list)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let program = exe.with_extension("old");
    if !paths.contains(&program) {
        paths.push(program);
    }
    let left: Vec<PathBuf> = paths
        .into_iter()
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("old"))
        })
        .filter(|path| match fs::remove_file(path) {
            Ok(()) => false,
            Err(err) if err.kind() == io::ErrorKind::NotFound => false,
            Err(err) => {
                tracing::warn!("{} is still in use: {err}", path.display());
                true
            }
        })
        .collect();
    let kept = if left.is_empty() {
        fs::remove_file(&list).or_else(|err| match err.kind() {
            io::ErrorKind::NotFound => Ok(()),
            _ => Err(err),
        })
    } else {
        remember(data, &left)
    };
    if let Err(err) = kept {
        tracing::warn!("the list of old update files was not updated: {err}");
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    fn zip_of(files: &[(&str, &str)]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        // Deflated, as the release packs it.
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in files {
            zip.start_file(*name, options).unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    /// A portable folder of the old version, with a file of the user's beside it.
    fn folder() -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("Kento taşınabilir 🧪");
        fs::create_dir_all(dir.join("pdfium")).unwrap();
        for (name, body) in OLD {
            fs::write(dir.join(name), body).unwrap();
        }
        let exe = dir.join("Kento.exe");
        (temp, exe)
    }

    const OLD: [(&str, &str); 6] = [
        ("Kento.exe", "old program"),
        ("kento.com", "old command line"),
        ("pdfium/pdfium.dll", "old pdfium"),
        ("LICENSE.txt", "licence"),
        ("THIRD-PARTY-NOTICES.md", "old notices"),
        ("notlarım.txt", "the user's own file"),
    ];

    fn new_version() -> Vec<u8> {
        zip_of(&[
            ("kento.com", "new command line"),
            ("pdfium/pdfium.dll", "new pdfium"),
            ("pdfium/LICENSE", "pdfium licence"),
            ("LICENSE.txt", "licence"),
            ("THIRD-PARTY-NOTICES.md", "new notices"),
            ("Kento.exe", "new program"),
        ])
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    /// Every file in the folder, relative and sorted, with `/` between parts.
    fn listing(dir: &Path) -> Vec<String> {
        fn walk(base: &Path, dir: &Path, out: &mut Vec<String>) {
            for entry in fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(base, &path, out);
                } else {
                    let relative = path.strip_prefix(base).unwrap();
                    let parts: Vec<String> = relative
                        .components()
                        .map(|part| part.as_os_str().to_string_lossy().into_owned())
                        .collect();
                    out.push(parts.join("/"));
                }
            }
        }
        let mut out = Vec::new();
        walk(dir, dir, &mut out);
        out.sort();
        out
    }

    fn untouched(exe: &Path) {
        let dir = exe.parent().unwrap();
        for (name, body) in OLD {
            assert_eq!(read(&dir.join(name)), body, "{name}");
        }
        let mut names: Vec<String> = OLD.iter().map(|(name, _)| name.to_string()).collect();
        names.sort();
        assert_eq!(listing(dir), names, "nothing was added or left behind");
    }

    #[test]
    fn swaps_every_file_and_sets_the_running_program_aside() {
        let (_temp, exe) = folder();
        let dir = exe.parent().unwrap().to_path_buf();
        let leftovers = replace(&exe, &new_version()).unwrap();

        assert_eq!(read(&exe), "new program");
        assert_eq!(read(&dir.join("kento.com")), "new command line");
        assert_eq!(read(&dir.join("pdfium/pdfium.dll")), "new pdfium");
        assert_eq!(read(&dir.join("pdfium/LICENSE")), "pdfium licence");
        assert_eq!(read(&dir.join("THIRD-PARTY-NOTICES.md")), "new notices");
        assert_eq!(read(&dir.join("notlarım.txt")), "the user's own file");
        assert_eq!(read(&dir.join("Kento.old")), "old program");
        assert_eq!(leftovers, vec![dir.join("Kento.old")]);
        assert_eq!(
            listing(&dir),
            [
                "Kento.exe",
                "Kento.old",
                "LICENSE.txt",
                "THIRD-PARTY-NOTICES.md",
                "kento.com",
                "notlarım.txt",
                "pdfium/LICENSE",
                "pdfium/pdfium.dll",
            ],
            "old files that are not in use go at once, and nothing waits half-written"
        );

        // The next start removes the old program.
        let data = tempfile::tempdir().unwrap();
        remember(data.path(), &leftovers).unwrap();
        tidy(&exe, data.path());
        assert!(!dir.join("Kento.old").exists());
        assert!(!data.path().join(LEFTOVERS).exists());
        assert_eq!(read(&exe), "new program");

        // A second update replaces the first.
        replace(&exe, &zip_of(&[("Kento.exe", "newer program")])).unwrap();
        assert_eq!(read(&exe), "newer program");
        assert_eq!(read(&dir.join("Kento.old")), "new program");
    }

    #[test]
    fn refuses_entries_that_would_land_outside_the_folder() {
        for name in [
            "../evil.txt",
            "pdfium/../../evil.txt",
            "..\\evil.txt",
            "/evil.txt",
            "\\evil.txt",
            "C:/evil.txt",
            "C:evil.txt",
            "LICENSE.txt:stream",
            "./../evil.txt",
        ] {
            let (temp, exe) = folder();
            let zip = zip_of(&[("Kento.exe", "new program"), (name, "evil")]);
            let err = replace(&exe, &zip).unwrap_err();
            assert!(
                matches!(err, Error::Outside(ref entry) if entry == name),
                "{name}: {err}"
            );
            untouched(&exe);
            assert!(!temp.path().join("evil.txt").exists(), "{name}");
        }
    }

    #[test]
    fn refuses_an_update_without_the_program() {
        let (_temp, exe) = folder();
        let zip = zip_of(&[("THIRD-PARTY-NOTICES.md", "new notices")]);
        assert!(matches!(replace(&exe, &zip), Err(Error::NoProgram)));
        untouched(&exe);
        assert!(replace(&exe, b"not a zip").is_err());
        untouched(&exe);
    }

    #[test]
    fn a_failing_write_leaves_the_old_copy() {
        let (_temp, exe) = folder();
        let dir = exe.parent().unwrap().to_path_buf();
        // The notices cannot be written where they wait.
        let blocked = dir.join("THIRD-PARTY-NOTICES.md.kento-new");
        fs::create_dir(&blocked).unwrap();
        let zip = zip_of(&[
            ("kento.com", "new command line"),
            ("docs/yeni klasör/README.txt", "a file in a new folder"),
            ("THIRD-PARTY-NOTICES.md", "new notices"),
            ("Kento.exe", "new program"),
        ]);
        assert!(replace(&exe, &zip).is_err());
        fs::remove_dir(&blocked).unwrap();
        untouched(&exe);
    }

    #[test]
    fn a_failing_swap_puts_every_file_back() {
        let (_temp, exe) = folder();
        let dir = exe.parent().unwrap().to_path_buf();
        // The program cannot step aside, after every other file has been swapped.
        let blocked = dir.join("Kento.old");
        fs::create_dir(&blocked).unwrap();
        fs::write(blocked.join("busy"), "x").unwrap();
        assert!(replace(&exe, &new_version()).is_err());
        fs::remove_dir_all(&blocked).unwrap();
        untouched(&exe);
    }

    #[test]
    fn tidying_removes_only_what_an_update_set_aside() {
        let (_temp, exe) = folder();
        let dir = exe.parent().unwrap().to_path_buf();
        let data = tempfile::tempdir().unwrap();
        fs::write(dir.join("Kento.old"), "old program").unwrap();
        fs::write(dir.join("pdfium/pdfium.dll.old"), "old pdfium").unwrap();
        remember(
            data.path(),
            &[dir.join("pdfium/pdfium.dll.old"), dir.join("notlarım.txt")],
        )
        .unwrap();
        tidy(&exe, data.path());
        assert!(!dir.join("Kento.old").exists());
        assert!(!dir.join("pdfium/pdfium.dll.old").exists());
        assert!(
            dir.join("notlarım.txt").exists(),
            "never a file of the user's"
        );
        assert!(!data.path().join(LEFTOVERS).exists());
        // Nothing to do is fine too.
        tidy(&exe, data.path());
    }
}
