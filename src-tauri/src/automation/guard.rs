// SPDX-License-Identifier: MIT
//! Loop protection (SPEC 5.11). A rule never takes:
//! - a file Kento itself wrote (any job's output, remembered for a while, a folder output with
//!   everything in it), so a result landing in a watched folder is not handled again;
//! - a file in the rule's own output folder;
//! - a file it already handled, unless the file changed since;
//! - hidden files and the partial files of downloads and of Kento's own safe writes.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use super::rules::{inside, Rule};

/// How long an output is remembered: far longer than any file takes to settle.
const REMEMBER: Duration = Duration::from_secs(60 * 60);
/// The most outputs and handled files remembered.
const MOST: usize = 10_000;

/// Endings of files still being written by browsers and other apps, and by Kento's safe writes.
const PARTIAL: [&str; 8] = [
    ".kento-part",
    ".crdownload",
    ".part",
    ".partial",
    ".download",
    ".tmp",
    ".temp",
    "~",
];

/// A hidden file, an Office lock file or a file still being written.
pub fn hidden_or_partial(name: &str) -> bool {
    let lower = name.to_lowercase();
    name.starts_with('.')
        || name.starts_with("~$")
        || PARTIAL.iter().any(|end| lower.ends_with(end))
}

/// The outputs Kento wrote lately: every finished job's, not only folder automation's.
#[derive(Debug, Default)]
pub struct Produced {
    recent: Mutex<VecDeque<(PathBuf, Instant)>>,
}

impl Produced {
    pub fn remember(&self, outputs: &[PathBuf], now: Instant) {
        let mut recent = self.recent.lock().unwrap_or_else(|p| p.into_inner());
        recent.extend(outputs.iter().map(|path| (path.clone(), now)));
        while recent.len() > MOST
            || recent
                .front()
                .is_some_and(|(_, at)| now.saturating_duration_since(*at) > REMEMBER)
        {
            recent.pop_front();
        }
    }

    /// Whether `path` is an output, or inside a folder output.
    pub fn contains(&self, path: &Path, now: Instant) -> bool {
        let recent = self.recent.lock().unwrap_or_else(|p| p.into_inner());
        recent.iter().any(|(output, at)| {
            now.saturating_duration_since(*at) <= REMEMBER && inside(path, output)
        })
    }
}

/// What a file looked like when a rule took it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stamp {
    pub size: u64,
    pub modified: Option<SystemTime>,
}

impl Stamp {
    pub fn of(path: &Path) -> Option<Self> {
        let meta = std::fs::metadata(path).ok()?;
        Some(Self {
            size: meta.len(),
            modified: meta.modified().ok(),
        })
    }
}

/// The files each rule took, so the events a finished file keeps causing (another app touching
/// it, a second notification) do not start it twice. A file that changed is taken again.
#[derive(Debug, Default)]
pub struct Handled {
    seen: HashMap<(String, PathBuf), Stamp>,
    order: VecDeque<(String, PathBuf)>,
}

impl Handled {
    /// Records that `rule` takes `path` as it is now; false when it already took it like this.
    pub fn take(&mut self, rule: &str, path: &Path, stamp: Stamp) -> bool {
        let key = (rule.to_owned(), path.to_path_buf());
        if self.seen.get(&key) == Some(&stamp) {
            return false;
        }
        if self.seen.insert(key.clone(), stamp).is_none() {
            self.order.push_back(key);
        }
        while self.order.len() > MOST {
            if let Some(old) = self.order.pop_front() {
                self.seen.remove(&old);
            }
        }
        true
    }
}

/// Why a rule leaves a finished file alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skip {
    /// Kento wrote it.
    Produced,
    /// It is in the rule's own output folder.
    InOutput,
    /// Hidden, or still being written by another app.
    Partial,
}

/// The loop checks of one rule for one finished file.
pub fn skip(rule: &Rule, path: &Path, produced: &Produced, now: Instant) -> Option<Skip> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if hidden_or_partial(&name) {
        Some(Skip::Partial)
    } else if inside(path, &rule.output) {
        Some(Skip::InOutput)
    } else if produced.contains(path, now) {
        Some(Skip::Produced)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::rules::{Action, Filter};

    fn rule(folder: &Path, output: &Path) -> Rule {
        Rule {
            id: "k".into(),
            name: String::new(),
            enabled: true,
            folder: folder.to_path_buf(),
            subfolders: true,
            filter: Filter::default(),
            action: Action::Convert { to: "webp".into() },
            output: output.to_path_buf(),
        }
    }

    #[test]
    fn kentos_own_outputs_are_left_alone_for_a_while() {
        let now = Instant::now();
        let produced = Produced::default();
        let folder = PathBuf::from("/İzlenen 👀");
        let file = folder.join("foto.webp");
        let pages = folder.join("Rapor - sayfalar");
        produced.remember(&[file.clone(), pages.clone()], now);
        let watching = rule(&folder, Path::new("/Çıktı"));
        assert_eq!(skip(&watching, &file, &produced, now), Some(Skip::Produced));
        assert_eq!(
            skip(&watching, &pages.join("Rapor-1.png"), &produced, now),
            Some(Skip::Produced)
        );
        assert_eq!(
            skip(&watching, &folder.join("yeni.png"), &produced, now),
            None
        );
        let later = now + REMEMBER + Duration::from_secs(1);
        assert_eq!(skip(&watching, &file, &produced, later), None);
        produced.remember(&[], later);
        assert!(produced.recent.lock().unwrap().is_empty(), "old entries go");
    }

    #[test]
    fn the_rules_own_output_folder_and_partial_files_are_skipped() {
        let now = Instant::now();
        let produced = Produced::default();
        let folder = PathBuf::from("/Masaüstü");
        let output = folder.join("Çıktı 📦");
        let inner = rule(&folder, &output);
        assert_eq!(
            skip(&inner, &output.join("eski.png"), &produced, now),
            Some(Skip::InOutput)
        );
        for name in [
            ".gizli.png",
            "~$rapor.docx",
            ".foto.jpg.kento-part",
            "film.mp4.crdownload",
            "indirilen.PART",
            "yedek.tmp",
        ] {
            assert_eq!(
                skip(&inner, &folder.join(name), &produced, now),
                Some(Skip::Partial),
                "{name}"
            );
        }
        assert_eq!(
            skip(&inner, &folder.join("bitti.png"), &produced, now),
            None
        );
    }

    #[test]
    fn a_file_is_taken_once_until_it_changes() {
        let mut handled = Handled::default();
        let path = Path::new("/İzlenen/a.png");
        let first = Stamp {
            size: 10,
            modified: Some(SystemTime::UNIX_EPOCH),
        };
        assert!(handled.take("k1", path, first));
        assert!(!handled.take("k1", path, first));
        assert!(handled.take("k2", path, first), "another rule takes it too");
        let changed = Stamp { size: 12, ..first };
        assert!(handled.take("k1", path, changed));
        for n in 0..MOST + 5 {
            handled.take("k3", Path::new(&format!("/x/{n}.png")), first);
        }
        assert!(handled.seen.len() <= MOST);
    }
}
