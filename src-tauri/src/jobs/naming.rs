// SPDX-License-Identifier: MIT
//! Output names and safe writing (SPEC 5.14). Kento never overwrites a file: an output takes the
//! first free name ("photo.jpg", then "photo (2).jpg"), is written to a temporary file next to it,
//! and only takes its final name when the job succeeds.

use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// Where outputs go.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputDir {
    NextToSource,
    Folder(PathBuf),
}

/// The folder for an output of `source`: the chosen folder, or the source's own folder when it can
/// be written to, else `fallback` (Downloads/Kento).
pub fn output_dir(source: &Path, setting: &OutputDir, fallback: &Path) -> PathBuf {
    match setting {
        OutputDir::Folder(dir) if is_writable(dir) => dir.clone(),
        OutputDir::NextToSource => match source.parent() {
            Some(dir) if !dir.as_os_str().is_empty() && is_writable(dir) => dir.to_path_buf(),
            _ => fallback.to_path_buf(),
        },
        OutputDir::Folder(_) => fallback.to_path_buf(),
    }
}

/// True when a file can be created in `dir`.
pub fn is_writable(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    for n in 0..100u32 {
        let probe = dir.join(format!(".kento-probe-{}-{n}", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&probe) {
            Ok(file) => {
                drop(file);
                let _ = fs::remove_file(&probe);
                return true;
            }
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return false,
        }
    }
    false
}

/// "photo", "trimmed", "mp4" → "photo - trimmed.mp4". The suffix comes translated from the caller.
pub fn file_name(stem: &str, suffix: Option<&str>, extension: &str) -> String {
    let stem = match suffix {
        Some(suffix) if !suffix.is_empty() => format!("{stem} - {suffix}"),
        _ => stem.to_string(),
    };
    if extension.is_empty() {
        stem
    } else {
        format!("{stem}.{extension}")
    }
}

fn numbered(stem: &str, extension: &str, n: u32) -> String {
    if n == 1 {
        file_name(stem, None, extension)
    } else {
        file_name(&format!("{stem} ({n})"), None, extension)
    }
}

/// A claimed output name. The final path exists as an empty file from the start, so no other job
/// can take the name; the work goes to `temp`. `commit` moves it into place; dropping the
/// reservation without committing removes both files.
#[derive(Debug)]
pub struct Reservation {
    final_path: PathBuf,
    temp_path: PathBuf,
    committed: bool,
}

impl Reservation {
    /// Claims the first free name for `stem` + `extension` in `dir`.
    pub fn claim(dir: &Path, stem: &str, extension: &str) -> io::Result<Self> {
        for n in 1..=10_000u32 {
            let name = numbered(stem, extension, n);
            let final_path = dir.join(&name);
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(long_path(&final_path))
            {
                Ok(file) => {
                    drop(file);
                    let temp_path = dir.join(format!(".{name}.kento-part"));
                    return Ok(Self {
                        final_path,
                        temp_path,
                        committed: false,
                    });
                }
                Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(err),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "no free output name",
        ))
    }

    pub fn final_path(&self) -> &Path {
        &self.final_path
    }

    pub fn temp_path(&self) -> &Path {
        &self.temp_path
    }

    /// Opens the temporary file for writing.
    pub fn create_temp(&self) -> io::Result<File> {
        File::create(long_path(&self.temp_path))
    }

    /// Moves the finished temporary file over the empty placeholder that holds the name.
    pub fn commit(mut self) -> io::Result<PathBuf> {
        fs::rename(long_path(&self.temp_path), long_path(&self.final_path))?;
        self.committed = true;
        Ok(self.final_path.clone())
    }
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(long_path(&self.temp_path));
            let _ = fs::remove_file(long_path(&self.final_path));
        }
    }
}

/// A claimed output folder (PDF pages, extracted archives). The final folder exists, empty, from
/// the start so no other job takes the name; the work fills `temp`, a hidden sibling. `commit`
/// swaps it into place; dropping the reservation without committing removes both.
#[derive(Debug)]
pub struct FolderReservation {
    final_path: PathBuf,
    temp_path: PathBuf,
    committed: bool,
}

impl FolderReservation {
    /// Claims the first free folder name for `name` in `dir` ("photos", then "photos (2)").
    pub fn claim(dir: &Path, name: &str) -> io::Result<Self> {
        for n in 1..=10_000u32 {
            let name = numbered(name, "", n);
            let final_path = dir.join(&name);
            match fs::create_dir(long_path(&final_path)) {
                Ok(()) => {
                    let temp_path = dir.join(format!(".{name}.kento-part"));
                    fs::create_dir(long_path(&temp_path))?;
                    return Ok(Self {
                        final_path,
                        temp_path,
                        committed: false,
                    });
                }
                Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(err),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "no free folder name",
        ))
    }

    pub fn final_path(&self) -> &Path {
        &self.final_path
    }

    pub fn temp_path(&self) -> &Path {
        &self.temp_path
    }

    /// Replaces the empty placeholder with the filled folder. A folder cannot be renamed over
    /// another, so the placeholder goes first; the name stays ours for that moment.
    pub fn commit(mut self) -> io::Result<PathBuf> {
        fs::remove_dir(long_path(&self.final_path))?;
        fs::rename(long_path(&self.temp_path), long_path(&self.final_path))?;
        self.committed = true;
        Ok(self.final_path.clone())
    }
}

impl Drop for FolderReservation {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_dir_all(long_path(&self.temp_path));
            let _ = fs::remove_dir(long_path(&self.final_path));
        }
    }
}

/// Windows paths of 260 characters or more need the \\?\ prefix; everything else stays as is.
pub fn long_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.as_os_str().to_string_lossy();
        if path.is_absolute() && text.len() >= 260 && !text.starts_with(r"\\?\") {
            return if let Some(share) = text.strip_prefix(r"\\") {
                PathBuf::from(format!(r"\\?\UNC\{share}"))
            } else {
                PathBuf::from(format!(r"\\?\{text}"))
            };
        }
    }
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn names_follow_the_rules() {
        assert_eq!(file_name("photo", None, "jpg"), "photo.jpg");
        assert_eq!(
            file_name("video", Some("trimmed"), "mp4"),
            "video - trimmed.mp4"
        );
        assert_eq!(
            file_name("belge", Some("birleştirildi"), "pdf"),
            "belge - birleştirildi.pdf"
        );
        assert_eq!(numbered("photo", "jpg", 2), "photo (2).jpg");
    }

    #[test]
    fn never_overwrites_and_numbers_the_next_name() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("foto.jpg"), b"original").unwrap();
        let first = Reservation::claim(dir.path(), "foto", "jpg").unwrap();
        assert_eq!(first.final_path().file_name().unwrap(), "foto (2).jpg");
        let second = Reservation::claim(dir.path(), "foto", "jpg").unwrap();
        assert_eq!(second.final_path().file_name().unwrap(), "foto (3).jpg");
        first.create_temp().unwrap().write_all(b"new").unwrap();
        let done = first.commit().unwrap();
        assert_eq!(fs::read(&done).unwrap(), b"new");
        assert_eq!(fs::read(dir.path().join("foto.jpg")).unwrap(), b"original");
        drop(second);
        assert!(!dir.path().join("foto (3).jpg").exists());
    }

    #[test]
    fn folders_are_claimed_filled_and_swapped_into_place() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("rapor")).unwrap();
        let first = FolderReservation::claim(dir.path(), "rapor").unwrap();
        assert_eq!(first.final_path().file_name().unwrap(), "rapor (2)");
        fs::write(first.temp_path().join("rapor-1.png"), b"page").unwrap();
        let done = first.commit().unwrap();
        assert_eq!(fs::read(done.join("rapor-1.png")).unwrap(), b"page");
        let dropped = FolderReservation::claim(dir.path(), "Klasör 🧪").unwrap();
        fs::write(dropped.temp_path().join("half.png"), b"x").unwrap();
        drop(dropped);
        let left: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(left.len(), 2, "only rapor and rapor (2) remain");
    }

    #[test]
    fn a_dropped_reservation_leaves_nothing_behind() {
        let dir = tempfile::tempdir().unwrap();
        let reservation = Reservation::claim(dir.path(), "klip - kesildi", "mp4").unwrap();
        reservation
            .create_temp()
            .unwrap()
            .write_all(b"half")
            .unwrap();
        drop(reservation);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn turkish_and_emoji_names_work() {
        let dir = tempfile::tempdir().unwrap();
        for stem in [
            "İstanbul ılık şiş çöp ğüz",
            "tatil 🏖️ fotoğrafı",
            "photo (2)",
        ] {
            let reservation = Reservation::claim(dir.path(), stem, "png").unwrap();
            reservation.create_temp().unwrap().write_all(b"x").unwrap();
            let done = reservation.commit().unwrap();
            assert_eq!(
                done.file_name().unwrap().to_string_lossy(),
                format!("{stem}.png")
            );
        }
    }

    #[test]
    fn output_falls_back_when_the_source_folder_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let fallback = dir.path().join("Downloads").join("Kento");
        let source = dir.path().join("gone").join("photo.heic");
        assert_eq!(
            output_dir(&source, &OutputDir::NextToSource, &fallback),
            fallback
        );
        let source = dir.path().join("photo.heic");
        assert_eq!(
            output_dir(&source, &OutputDir::NextToSource, &fallback),
            dir.path()
        );
        let chosen = OutputDir::Folder(dir.path().to_path_buf());
        assert_eq!(output_dir(&source, &chosen, &fallback), dir.path());
    }

    #[cfg(windows)]
    #[test]
    fn long_paths_get_the_prefix() {
        let deep = PathBuf::from(format!(r"C:\{}\file.txt", "a".repeat(300)));
        assert!(long_path(&deep).to_string_lossy().starts_with(r"\\?\C:\"));
        let short = PathBuf::from(r"C:\short\file.txt");
        assert_eq!(long_path(&short), short);
        let dir = tempfile::tempdir().unwrap();
        let mut nested = dir.path().to_path_buf();
        while nested.as_os_str().len() < 280 {
            nested.push("klasör-çok-uzun-bir-ad");
        }
        fs::create_dir_all(long_path(&nested)).unwrap();
        let reservation = Reservation::claim(&nested, "uzun", "txt").unwrap();
        reservation.create_temp().unwrap().write_all(b"ok").unwrap();
        let done = reservation.commit().unwrap();
        assert!(fs::metadata(long_path(&done)).unwrap().is_file());
    }
}
