// SPDX-License-Identifier: MIT
//! Folder automation rules (SPEC 5.11): a watched folder, a filter (extensions, a name pattern,
//! sizes), an action (convert, a tool that needs no choices, a recipe, or move) and an output
//! folder.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const VERSION: u32 = 1;
/// The longest rule name, in characters.
pub const MAX_NAME: usize = 80;
/// The tools a rule can run: the ones that run at once from the wheel, without choices.
pub const TOOLS: [&str; 2] = ["extract", "mute"];

/// What automation.json holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub version: u32,
    /// "Pause all": no rule watches while this is set.
    pub paused: bool,
    pub rules: Vec<Rule>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: VERSION,
            paused: false,
            rules: Vec::new(),
        }
    }
}

impl Config {
    /// The rules that watch now: switched on, while automation is not paused.
    pub fn active(&self) -> Vec<Rule> {
        if self.paused {
            return Vec::new();
        }
        self.rules
            .iter()
            .filter(|rule| rule.enabled)
            .cloned()
            .collect()
    }
}

fn on() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    /// Stable across edits; empty for a rule the page has not saved yet.
    #[serde(default)]
    pub id: String,
    /// May be empty: the page then describes the rule by its folders and action.
    #[serde(default)]
    pub name: String,
    /// The rule's own on/off (pause and resume one rule).
    #[serde(default = "on")]
    pub enabled: bool,
    pub folder: PathBuf,
    /// Also files that land in folders inside the watched folder.
    #[serde(default)]
    pub subfolders: bool,
    #[serde(default)]
    pub filter: Filter,
    pub action: Action,
    /// Where results go; for Move, where the file goes.
    pub output: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Filter {
    /// Lowercase, without the dot ("png", "tar.gz"); empty takes every extension.
    pub extensions: Vec<String>,
    /// The whole file name, `*` for any run of characters and `?` for one, ignoring case; empty
    /// takes every name.
    pub pattern: String,
    /// In bytes; a file must be at least this large.
    pub min_size: Option<u64>,
    /// In bytes; a file must be at most this large.
    pub max_size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    /// To a format (a catalog id).
    Convert { to: String },
    /// One of `TOOLS`.
    Tool { tool: String },
    /// A recipe, by id.
    Recipe { recipe: String },
    /// Moves the file itself into the output folder, under a free name.
    Move,
}

impl Filter {
    /// Lowercase extensions without dots, each once; a trimmed pattern ("*" alone takes all).
    pub fn normalized(self) -> Self {
        let mut extensions: Vec<String> = Vec::new();
        for ext in self.extensions {
            let ext = ext.trim().trim_start_matches(['.', '*']).to_lowercase();
            if !ext.is_empty() && !extensions.contains(&ext) {
                extensions.push(ext);
            }
        }
        let pattern = self.pattern.trim();
        Self {
            extensions,
            pattern: if pattern == "*" {
                String::new()
            } else {
                pattern.to_owned()
            },
            min_size: self.min_size,
            max_size: self.max_size,
        }
    }

    /// Whether a file name passes the extension and name tests; its size is tested once the file
    /// is finished.
    pub fn takes_name(&self, name: &str) -> bool {
        let lower = name.to_lowercase();
        let extension = self.extensions.is_empty()
            || self.extensions.iter().any(|ext| {
                lower
                    .strip_suffix(ext.as_str())
                    .is_some_and(|rest| rest.len() > 1 && rest.ends_with('.'))
            });
        extension && (self.pattern.is_empty() || glob(&self.pattern, name))
    }

    pub fn takes_size(&self, size: u64) -> bool {
        self.min_size.is_none_or(|min| size >= min) && self.max_size.is_none_or(|max| size <= max)
    }
}

/// `*` (any run of characters, none included) and `?` (exactly one) against the whole name,
/// ignoring case.
pub fn glob(pattern: &str, name: &str) -> bool {
    let pattern: Vec<char> = pattern.to_lowercase().chars().collect();
    let name: Vec<char> = name.to_lowercase().chars().collect();
    let (mut p, mut n) = (0, 0);
    // Where the last `*` was, and the name position it matched up to.
    let mut star: Option<(usize, usize)> = None;
    while n < name.len() {
        match pattern.get(p) {
            Some('*') => {
                star = Some((p, n));
                p += 1;
            }
            Some(&c) if c == '?' || c == name[n] => {
                p += 1;
                n += 1;
            }
            _ => match star {
                // Let the last `*` take one more character and try again from there.
                Some((at, matched)) => {
                    p = at + 1;
                    n = matched + 1;
                    star = Some((at, matched + 1));
                }
                None => return false,
            },
        }
    }
    pattern[p..].iter().all(|&c| c == '*')
}

/// A path's parts for comparing: case is ignored where the file system usually ignores it.
fn parts(path: &Path) -> Vec<String> {
    path.components()
        .filter(|part| !matches!(part, Component::CurDir))
        .map(|part| {
            let text = part.as_os_str().to_string_lossy();
            if cfg!(any(windows, target_os = "macos")) {
                text.to_lowercase()
            } else {
                text.into_owned()
            }
        })
        .collect()
}

/// The parts of `path` below `dir`, or None when `path` is not `dir` or inside it.
pub fn below(path: &Path, dir: &Path) -> Option<Vec<String>> {
    let (path_parts, dir_parts) = (parts(path), parts(dir));
    let names: Vec<String> = path
        .components()
        .filter(|part| !matches!(part, Component::CurDir))
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect();
    (path_parts.len() >= dir_parts.len() && path_parts[..dir_parts.len()] == dir_parts[..])
        .then(|| names[dir_parts.len()..].to_vec())
}

/// Whether `path` is `dir` or anywhere inside it.
pub fn inside(path: &Path, dir: &Path) -> bool {
    below(path, dir).is_some()
}

/// Why a rule cannot be saved, as a message key of the locale files.
pub fn check(rule: &Rule) -> Result<(), &'static str> {
    if rule.name.trim().chars().count() > MAX_NAME {
        return Err("automation.error.name");
    }
    if !rule.folder.is_absolute() || !rule.folder.is_dir() {
        return Err("automation.error.folder");
    }
    if !rule.output.is_absolute() || !rule.output.is_dir() {
        return Err("automation.error.output");
    }
    // Every file in a rule's output folder is skipped, so the same folder would do nothing.
    if inside(&rule.folder, &rule.output) {
        return Err("automation.error.same");
    }
    if let (Some(min), Some(max)) = (rule.filter.min_size, rule.filter.max_size) {
        if min > max {
            return Err("automation.error.sizes");
        }
    }
    match &rule.action {
        Action::Tool { tool } if !TOOLS.contains(&tool.as_str()) => Err("automation.error.action"),
        Action::Convert { to } if crate::catalog::format(to).is_none_or(|f| !f.write) => {
            Err("automation.error.action")
        }
        Action::Recipe { recipe } if recipe.is_empty() => Err("automation.error.action"),
        _ => Ok(()),
    }
}

/// The output folder lies inside the watched folder (the page warns: with subfolders on, the
/// results would land where the rule watches).
pub fn output_inside(rule: &Rule) -> bool {
    inside(&rule.output, &rule.folder)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(extensions: &[&str], pattern: &str) -> Filter {
        Filter {
            extensions: extensions.iter().map(|e| e.to_string()).collect(),
            pattern: pattern.into(),
            min_size: None,
            max_size: None,
        }
        .normalized()
    }

    #[test]
    fn extensions_and_patterns_pick_the_files() {
        let png = filter(&[".PNG", "png", " jpg "], "");
        assert_eq!(png.extensions, ["png", "jpg"]);
        assert!(png.takes_name("Ekran görüntüsü 2026-11-02 🖼️.png"));
        assert!(png.takes_name("FOTO.JPG"));
        assert!(!png.takes_name("notlar.txt"));
        assert!(!png.takes_name("png"), "a bare name is not an extension");
        assert!(!png.takes_name("arşiv.png.zip"));

        let tarball = filter(&["tar.gz"], "");
        assert!(tarball.takes_name("yedek.tar.gz"));
        assert!(!tarball.takes_name("yedek.gz"));

        let shots = filter(&[], "Ekran görüntüsü*");
        assert!(shots.takes_name("ekran GÖRÜNTÜSÜ 1.png"));
        assert!(!shots.takes_name("Fotoğraf.png"));
        assert!(filter(&[], "*").takes_name("her şey.bin"));
        assert!(filter(&[], "").takes_name("her şey.bin"));
    }

    #[test]
    fn globs_take_stars_and_question_marks() {
        assert!(glob("IMG_????.heic", "img_0042.HEIC"));
        assert!(!glob("IMG_????.heic", "img_042.heic"));
        assert!(glob("*rapor*", "2026 Rapor final.pdf"));
        assert!(glob("a*b*c", "aXXbYYc"));
        assert!(!glob("a*b*c", "aXXbYY"));
        assert!(glob("**", ""));
        assert!(glob("ş?k*", "şık 🧪.txt"));
        assert!(!glob("", "x"));
    }

    #[test]
    fn sizes_limit_both_ways() {
        let sized = Filter {
            min_size: Some(1_000),
            max_size: Some(5_000_000),
            ..Filter::default()
        };
        assert!(!sized.takes_size(999));
        assert!(sized.takes_size(1_000));
        assert!(sized.takes_size(5_000_000));
        assert!(!sized.takes_size(5_000_001));
        assert!(Filter::default().takes_size(0));
    }

    #[test]
    fn paths_compare_by_their_parts() {
        let dir = Path::new("/Users/ayşe/Ekran Görüntüleri");
        assert!(inside(&dir.join("a.png"), dir));
        assert!(inside(dir, dir));
        assert_eq!(
            below(&dir.join("Alt").join("b 🧪.png"), dir),
            Some(vec!["Alt".to_string(), "b 🧪.png".to_string()])
        );
        assert!(!inside(
            Path::new("/Users/ayşe/Ekran Görüntüleri 2/a.png"),
            dir
        ));
        assert!(!inside(Path::new("/Users"), dir));
        #[cfg(windows)]
        {
            assert!(inside(
                Path::new(r"c:\users\AYŞE\masaüstü\x.png"),
                Path::new(r"C:\Users\ayşe\Masaüstü\")
            ));
        }
    }

    #[test]
    fn rules_need_real_folders_apart_and_a_known_action() {
        let dir = tempfile::tempdir().unwrap();
        let watched = dir.path().join("İzlenen 👀");
        let out = dir.path().join("Çıktı");
        std::fs::create_dir_all(watched.join("iç")).unwrap();
        std::fs::create_dir_all(&out).unwrap();
        let rule = Rule {
            id: "k1".into(),
            name: "PNG → WEBP".into(),
            enabled: true,
            folder: watched.clone(),
            subfolders: false,
            filter: filter(&["png"], ""),
            action: Action::Convert { to: "webp".into() },
            output: out.clone(),
        };
        assert_eq!(check(&rule), Ok(()));
        assert!(!output_inside(&rule));
        let inner = Rule {
            output: watched.join("iç"),
            ..rule.clone()
        };
        assert_eq!(check(&inner), Ok(()));
        assert!(output_inside(&inner));
        let same = Rule {
            output: watched.clone(),
            ..rule.clone()
        };
        assert_eq!(check(&same), Err("automation.error.same"));
        let missing = Rule {
            folder: dir.path().join("yok"),
            ..rule.clone()
        };
        assert_eq!(check(&missing), Err("automation.error.folder"));
        for action in [
            Action::Convert { to: "svg".into() },
            Action::Tool {
                tool: "collage".into(),
            },
            Action::Recipe {
                recipe: String::new(),
            },
        ] {
            let bad = Rule {
                action,
                ..rule.clone()
            };
            assert_eq!(check(&bad), Err("automation.error.action"));
        }
        let sizes = Rule {
            filter: Filter {
                min_size: Some(10),
                max_size: Some(5),
                ..Filter::default()
            },
            ..rule.clone()
        };
        assert_eq!(check(&sizes), Err("automation.error.sizes"));
    }

    #[test]
    fn the_file_reads_back_and_pausing_stops_every_rule() {
        let json = r#"{"rules":[{"id":"a","folder":"/x","action":{"kind":"move"},"output":"/y"},
            {"id":"b","enabled":false,"folder":"/x","action":{"kind":"recipe","recipe":"r1"},"output":"/z"}]}"#;
        let mut config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.version, VERSION);
        assert!(config.rules[0].enabled, "rules start switched on");
        assert_eq!(config.rules[0].filter, Filter::default());
        assert_eq!(config.active().len(), 1);
        config.paused = true;
        assert!(config.active().is_empty());
        let again: Config = serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert_eq!(again, config);
        let text = serde_json::to_string(&config.rules[1].action).unwrap();
        assert_eq!(text, r#"{"kind":"recipe","recipe":"r1"}"#);
    }
}
