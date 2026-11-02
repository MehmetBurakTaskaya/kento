// SPDX-License-Identifier: MIT
//! Finished writes (SPEC 5.11): a file counts as finished only once its size has stayed the same
//! for a quiet spell. Every change seen on a file starts its wait again. The clock is passed in,
//! so the tests drive it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// A file still empty or still growing after this long is given up on.
const GIVE_UP: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Copy)]
struct Seen {
    /// The size at the last look; None before the first.
    size: Option<u64>,
    /// When the size last changed (or a change was reported).
    since: Instant,
    first: Instant,
}

/// The files waiting to be finished.
#[derive(Debug)]
pub struct Settle {
    quiet: Duration,
    pending: HashMap<PathBuf, Seen>,
}

impl Settle {
    pub fn new(quiet: Duration) -> Self {
        Self {
            quiet,
            pending: HashMap::new(),
        }
    }

    /// Something happened to `path`: its wait starts again.
    pub fn touch(&mut self, path: PathBuf, now: Instant) {
        self.pending
            .entry(path)
            .and_modify(|seen| seen.since = now)
            .or_insert(Seen {
                size: None,
                since: now,
                first: now,
            });
    }

    pub fn forget(&mut self, path: &Path) {
        self.pending.remove(path);
    }

    /// Keeps only the files `keep` still wants (after the rules changed).
    pub fn retain(&mut self, keep: impl Fn(&Path) -> bool) {
        self.pending.retain(|path, _| keep(path));
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.pending.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// The files whose size has stayed the same for the quiet spell, with that size; they leave
    /// the list. `size` says what the disk holds now: None for a file that is gone (it leaves the
    /// list too). An empty file waits on, since writers often create the file first.
    pub fn due(
        &mut self,
        now: Instant,
        size: impl Fn(&Path) -> Option<u64>,
    ) -> Vec<(PathBuf, u64)> {
        let mut done = Vec::new();
        let quiet = self.quiet;
        self.pending.retain(|path, seen| {
            let Some(current) = size(path) else {
                return false;
            };
            if now.saturating_duration_since(seen.first) >= GIVE_UP {
                tracing::debug!("stopped waiting for a file that never settled");
                return false;
            }
            if seen.size != Some(current) {
                seen.size = Some(current);
                seen.since = now;
                return true;
            }
            if current == 0 || now.saturating_duration_since(seen.since) < quiet {
                return true;
            }
            done.push((path.clone(), current));
            false
        });
        done.sort();
        done
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const QUIET: Duration = Duration::from_millis(1500);

    fn at(start: Instant, ms: u64) -> Instant {
        start + Duration::from_millis(ms)
    }

    #[test]
    fn a_file_is_finished_once_its_size_holds_for_the_quiet_spell() {
        let start = Instant::now();
        let mut settle = Settle::new(QUIET);
        let path = PathBuf::from("Ekran görüntüsü 🖼️.png");
        let size = Cell::new(1_000u64);
        let disk = |_: &Path| Some(size.get());
        settle.touch(path.clone(), start);
        // The first look only learns the size.
        assert!(settle.due(at(start, 250), disk).is_empty());
        // Still growing: the wait starts again.
        size.set(5_000);
        assert!(settle.due(at(start, 1_000), disk).is_empty());
        assert!(settle.due(at(start, 2_499), disk).is_empty());
        assert_eq!(settle.due(at(start, 2_500), disk), vec![(path, 5_000)]);
        assert!(settle.is_empty());
    }

    #[test]
    fn a_new_change_restarts_the_wait() {
        let start = Instant::now();
        let mut settle = Settle::new(QUIET);
        let path = PathBuf::from("rapor ş.pdf");
        settle.touch(path.clone(), start);
        assert!(settle.due(at(start, 100), |_| Some(10)).is_empty());
        settle.touch(path.clone(), at(start, 1_500));
        assert!(settle.due(at(start, 1_600), |_| Some(10)).is_empty());
        assert_eq!(settle.due(at(start, 3_000), |_| Some(10)).len(), 1);
    }

    #[test]
    fn gone_files_leave_and_empty_ones_wait() {
        let start = Instant::now();
        let mut settle = Settle::new(QUIET);
        settle.touch(PathBuf::from("gitti.tmp"), start);
        settle.touch(PathBuf::from("boş.png"), start);
        let disk = |path: &Path| (path == Path::new("boş.png")).then_some(0);
        assert!(settle.due(at(start, 100), disk).is_empty());
        assert_eq!(settle.len(), 1);
        assert!(settle.due(at(start, 10_000), disk).is_empty());
        assert_eq!(settle.len(), 1, "an empty file waits");
        // Written at last.
        assert!(settle.due(at(start, 11_000), |_| Some(42)).is_empty());
        assert_eq!(settle.due(at(start, 12_500), |_| Some(42)).len(), 1);

        settle.touch(PathBuf::from("hiç bitmeyen.bin"), start);
        assert!(settle.due(at(start, 3_600_000), |_| Some(0)).is_empty());
        assert!(settle.is_empty(), "given up after an hour");
    }

    #[test]
    fn forgetting_and_retaining_drop_files() {
        let start = Instant::now();
        let mut settle = Settle::new(QUIET);
        for name in ["a.png", "b.png", "c.jpg"] {
            settle.touch(PathBuf::from(name), start);
        }
        settle.forget(Path::new("a.png"));
        settle.retain(|path| path.extension().is_some_and(|ext| ext == "png"));
        assert_eq!(settle.len(), 1);
    }
}
