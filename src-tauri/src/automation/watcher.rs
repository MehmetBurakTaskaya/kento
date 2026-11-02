// SPDX-License-Identifier: MIT
//! Watching the rules' folders with `notify`, on a thread of its own. A change to a file a rule
//! wants starts (or restarts) its wait; a file whose size then holds for the quiet spell is
//! finished, passes the loop checks and goes to every rule that wants it, once.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};

use super::guard::{self, Handled, Produced, Stamp};
use super::rules::{below, inside, Rule};
use super::settle::Settle;

/// How long a file's size must hold, and how often waiting files are looked at.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    pub quiet: Duration,
    pub tick: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            quiet: Duration::from_secs(2),
            tick: Duration::from_millis(250),
        }
    }
}

/// A finished file for a rule.
pub type OnFile = Box<dyn Fn(&Rule, &Path) + Send>;
/// A rule whose folder cannot be watched, with the reason.
pub type OnTrouble = Box<dyn Fn(&Rule, String) + Send>;

enum Message {
    Event(notify::Result<Event>),
    Rules(Vec<Rule>),
    Stop,
}

/// The watching thread; dropping it stops the thread.
pub struct Watcher {
    tx: Sender<Message>,
    thread: Option<JoinHandle<()>>,
}

impl Watcher {
    pub fn start(
        rules: Vec<Rule>,
        timing: Timing,
        produced: Arc<Produced>,
        on_file: OnFile,
        on_trouble: OnTrouble,
    ) -> Self {
        let (tx, rx) = mpsc::channel();
        let events = tx.clone();
        let thread = std::thread::Builder::new()
            .name("kento-automation".into())
            .spawn(move || {
                let watcher = notify::recommended_watcher(move |event| {
                    let _ = events.send(Message::Event(event));
                });
                let watcher = match watcher {
                    Ok(watcher) => watcher,
                    Err(err) => {
                        tracing::error!("folders cannot be watched: {err}");
                        for rule in &rules {
                            on_trouble(rule, err.to_string());
                        }
                        return;
                    }
                };
                Worker {
                    watcher,
                    watched: HashMap::new(),
                    rules: Vec::new(),
                    settle: Settle::new(timing.quiet),
                    handled: Handled::default(),
                    produced,
                    on_file,
                    on_trouble,
                }
                .run(rx, rules, timing.tick);
            });
        let thread = match thread {
            Ok(thread) => Some(thread),
            Err(err) => {
                tracing::error!("the folder automation thread did not start: {err}");
                None
            }
        };
        Self { tx, thread }
    }

    /// The rules to watch from now on (the active ones).
    pub fn set_rules(&self, rules: Vec<Rule>) {
        let _ = self.tx.send(Message::Rules(rules));
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        let _ = self.tx.send(Message::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Whether `rule` wants the file at `path`: in its folder (or below, with subfolders), not in a
/// hidden folder, not hidden or partial, named as the filter asks, and not in its output folder.
pub fn wants(rule: &Rule, path: &Path) -> bool {
    let Some(parts) = below(path, &rule.folder) else {
        return false;
    };
    let Some(name) = parts.last() else {
        return false;
    };
    if !rule.subfolders && parts.len() != 1 {
        return false;
    }
    // Kento's own half-written folders are hidden ones (".name.kento-part").
    if parts.iter().any(|part| part.starts_with('.')) {
        return false;
    }
    !guard::hidden_or_partial(name) && rule.filter.takes_name(name) && !inside(path, &rule.output)
}

struct Worker {
    watcher: RecommendedWatcher,
    watched: HashMap<PathBuf, RecursiveMode>,
    rules: Vec<Rule>,
    settle: Settle,
    handled: Handled,
    produced: Arc<Produced>,
    on_file: OnFile,
    on_trouble: OnTrouble,
}

impl Worker {
    fn run(mut self, rx: Receiver<Message>, rules: Vec<Rule>, tick: Duration) {
        self.set_rules(rules);
        let mut looked = Instant::now();
        loop {
            // Nothing waiting: sleep until something happens.
            let wait = if self.settle.is_empty() {
                Duration::from_secs(3600)
            } else {
                tick
            };
            match rx.recv_timeout(wait) {
                Ok(Message::Event(Ok(event))) => self.on_event(event, Instant::now()),
                Ok(Message::Event(Err(err))) => tracing::warn!("folder watching: {err}"),
                Ok(Message::Rules(rules)) => self.set_rules(rules),
                Ok(Message::Stop) | Err(RecvTimeoutError::Disconnected) => return,
                Err(RecvTimeoutError::Timeout) => {}
            }
            let now = Instant::now();
            if now.saturating_duration_since(looked) >= tick {
                looked = now;
                self.finish(now);
            }
        }
    }

    fn set_rules(&mut self, rules: Vec<Rule>) {
        let mut wanted: HashMap<PathBuf, RecursiveMode> = HashMap::new();
        for rule in &rules {
            let mode = if rule.subfolders {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };
            wanted
                .entry(rule.folder.clone())
                .and_modify(|known| {
                    if mode == RecursiveMode::Recursive {
                        *known = mode;
                    }
                })
                .or_insert(mode);
        }
        let stale: Vec<PathBuf> = self
            .watched
            .iter()
            .filter(|(path, mode)| wanted.get(*path) != Some(*mode))
            .map(|(path, _)| path.clone())
            .collect();
        for path in stale {
            let _ = self.watcher.unwatch(&path);
            self.watched.remove(&path);
        }
        for (path, mode) in wanted {
            if self.watched.contains_key(&path) {
                continue;
            }
            match self.watcher.watch(&path, mode) {
                Ok(()) => {
                    self.watched.insert(path, mode);
                }
                Err(err) => {
                    tracing::warn!("a watched folder cannot be watched: {err}");
                    for rule in rules.iter().filter(|rule| rule.folder == path) {
                        (self.on_trouble)(rule, err.to_string());
                    }
                }
            }
        }
        self.rules = rules;
        let rules = &self.rules;
        self.settle
            .retain(|path| rules.iter().any(|rule| wants(rule, path)));
    }

    fn on_event(&mut self, event: Event, now: Instant) {
        match event.kind {
            EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                for path in &event.paths {
                    self.settle.forget(path);
                }
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
                if let [from, to] = event.paths.as_slice() {
                    self.settle.forget(from);
                    self.consider(to.clone(), now);
                }
            }
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Any => {
                for path in event.paths {
                    self.consider(path, now);
                }
            }
            EventKind::Access(_) | EventKind::Other => {}
        }
    }

    fn consider(&mut self, path: PathBuf, now: Instant) {
        if self.rules.iter().any(|rule| wants(rule, &path)) {
            self.settle.touch(path, now);
        }
    }

    /// Hands the files that have settled to their rules.
    fn finish(&mut self, now: Instant) {
        if self.settle.is_empty() {
            return;
        }
        let size = |path: &Path| {
            std::fs::metadata(path)
                .ok()
                .filter(|meta| meta.is_file())
                .map(|meta| meta.len())
        };
        for (path, size) in self.settle.due(now, size) {
            // Another app may still hold the file shut to others: wait another spell.
            if std::fs::File::open(&path).is_err() {
                self.settle.touch(path, now);
                continue;
            }
            let Some(stamp) = Stamp::of(&path) else {
                continue;
            };
            for rule in &self.rules {
                if !wants(rule, &path) || !rule.filter.takes_size(size) {
                    continue;
                }
                if let Some(why) = guard::skip(rule, &path, &self.produced, now) {
                    tracing::debug!(?why, "folder automation left a file alone");
                    continue;
                }
                if self.handled.take(&rule.id, &path, stamp) {
                    (self.on_file)(rule, &path);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::rules::{Action, Filter};
    use std::fs;
    use std::io::Write;
    use std::sync::mpsc::Receiver;

    const QUIET: Duration = Duration::from_millis(400);

    struct Bench {
        _root: tempfile::TempDir,
        watched: PathBuf,
        output: PathBuf,
    }

    impl Bench {
        fn new() -> Self {
            let root = tempfile::tempdir().unwrap();
            let watched = root.path().join("İzlenen klasör 👀");
            let output = root.path().join("Çıktı ş");
            fs::create_dir_all(watched.join("alt klasör")).unwrap();
            fs::create_dir_all(&output).unwrap();
            Self {
                _root: root,
                watched,
                output,
            }
        }

        fn rule(&self, subfolders: bool) -> Rule {
            Rule {
                id: "k1".into(),
                name: "PNG → WEBP".into(),
                enabled: true,
                folder: self.watched.clone(),
                subfolders,
                filter: Filter {
                    extensions: vec!["png".into()],
                    ..Filter::default()
                },
                action: Action::Convert { to: "webp".into() },
                output: self.output.clone(),
            }
        }
    }

    fn start(
        rules: Vec<Rule>,
        produced: Arc<Produced>,
    ) -> (
        Watcher,
        Receiver<(String, PathBuf, Instant)>,
        Receiver<String>,
    ) {
        let (files, file_rx) = mpsc::channel();
        let (troubles, trouble_rx) = mpsc::channel();
        let watcher = Watcher::start(
            rules,
            Timing {
                quiet: QUIET,
                tick: Duration::from_millis(50),
            },
            produced,
            Box::new(move |rule, path| {
                let _ = files.send((rule.id.clone(), path.to_path_buf(), Instant::now()));
            }),
            Box::new(move |rule, _| {
                let _ = troubles.send(rule.id.clone());
            }),
        );
        // Let the thread start watching.
        std::thread::sleep(Duration::from_millis(300));
        (watcher, file_rx, trouble_rx)
    }

    #[test]
    fn rules_want_files_by_place_name_and_filter() {
        let bench = Bench::new();
        let flat = bench.rule(false);
        let deep = bench.rule(true);
        let file = bench.watched.join("Ekran görüntüsü 🖼️.png");
        let nested = bench.watched.join("alt klasör").join("iç.png");
        assert!(wants(&flat, &file) && wants(&deep, &file));
        assert!(!wants(&flat, &nested) && wants(&deep, &nested));
        assert!(!wants(&deep, &bench.watched.join("notlar.txt")));
        assert!(!wants(&deep, &bench.watched.join(".gizli.png")));
        assert!(!wants(
            &deep,
            &bench.watched.join(".foto.png.kento-part").join("x.png")
        ));
        assert!(!wants(&deep, &bench.watched));
        let inner = Rule {
            output: bench.watched.join("alt klasör"),
            ..deep
        };
        assert!(!wants(&inner, &nested), "the rule's own output folder");
    }

    #[test]
    fn a_file_is_handed_on_once_its_writing_has_settled() {
        let bench = Bench::new();
        let produced = Arc::new(Produced::default());
        let (watcher, files, _troubles) = start(vec![bench.rule(false)], produced.clone());

        // Written in three parts, like a slow copy.
        let path = bench.watched.join("Ekran görüntüsü İ 🖼️.png");
        let mut file = fs::File::create(&path).unwrap();
        for part in 0..3 {
            if part > 0 {
                std::thread::sleep(Duration::from_millis(150));
            }
            file.write_all(&[7u8; 4096]).unwrap();
            file.flush().unwrap();
        }
        let written = Instant::now();
        drop(file);
        fs::write(bench.watched.join("not.txt"), b"filtered out").unwrap();
        fs::write(bench.output.join("sonuç.png"), b"not watched").unwrap();

        let (rule, seen, at) = files.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(rule, "k1");
        assert_eq!(seen, path);
        assert!(at.duration_since(written) >= QUIET - Duration::from_millis(50));
        assert!(
            files.recv_timeout(Duration::from_millis(1500)).is_err(),
            "once, and nothing else"
        );

        // Kento's own output in the watched folder is left alone.
        let own = bench.watched.join("kento sonucu.png");
        produced.remember(std::slice::from_ref(&own), Instant::now());
        fs::write(&own, [1u8; 100]).unwrap();
        assert!(files.recv_timeout(Duration::from_millis(1500)).is_err());

        // A rule switched off watches no more.
        watcher.set_rules(Vec::new());
        std::thread::sleep(Duration::from_millis(200));
        fs::write(bench.watched.join("sonra.png"), [2u8; 100]).unwrap();
        assert!(files.recv_timeout(Duration::from_millis(1500)).is_err());

        // On again, and with subfolders.
        watcher.set_rules(vec![bench.rule(true)]);
        std::thread::sleep(Duration::from_millis(300));
        let nested = bench.watched.join("alt klasör").join("derin ğ.png");
        fs::write(&nested, [3u8; 100]).unwrap();
        let (_, seen, _) = files.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(seen, nested);
    }

    #[test]
    fn a_folder_that_cannot_be_watched_is_reported() {
        let bench = Bench::new();
        let gone = Rule {
            folder: bench.watched.join("yok"),
            ..bench.rule(false)
        };
        let (_watcher, _files, troubles) = start(vec![gone], Arc::new(Produced::default()));
        assert_eq!(troubles.recv_timeout(Duration::from_secs(5)).unwrap(), "k1");
    }
}
