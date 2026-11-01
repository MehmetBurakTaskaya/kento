// SPDX-License-Identifier: MIT
//! The catalog: every format, conversion route, tool and file action in one place (SPEC 5.1).
//! The wheels, docs/FORMATS.md, website-kit/catalog.json and the route tests all come from it.
//! An entry is Planned until its engine exists; only Ready entries reach the wheel.

mod data;
pub mod export;

use std::collections::HashSet;

use serde::Serialize;

pub use data::{actions, formats, routes, tools};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum Category {
    Image,
    Video,
    Audio,
    Document,
    Spreadsheet,
    Presentation,
    Subtitle,
    Pdf,
    Archive,
}

impl Category {
    pub const ALL: [Category; 9] = [
        Category::Image,
        Category::Video,
        Category::Audio,
        Category::Document,
        Category::Spreadsheet,
        Category::Presentation,
        Category::Subtitle,
        Category::Pdf,
        Category::Archive,
    ];

    pub fn key(self) -> &'static str {
        match self {
            Category::Image => "image",
            Category::Video => "video",
            Category::Audio => "audio",
            Category::Document => "document",
            Category::Spreadsheet => "spreadsheet",
            Category::Presentation => "presentation",
            Category::Subtitle => "subtitle",
            Category::Pdf => "pdf",
            Category::Archive => "archive",
        }
    }
}

/// The download a feature needs (SPEC 4.2). Core needs none.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum ToolGroup {
    Core,
    Media,
    Office,
    Extras,
}

impl ToolGroup {
    pub const ALL: [ToolGroup; 4] = [
        ToolGroup::Core,
        ToolGroup::Media,
        ToolGroup::Office,
        ToolGroup::Extras,
    ];

    pub fn key(self) -> &'static str {
        match self {
            ToolGroup::Core => "core",
            ToolGroup::Media => "media",
            ToolGroup::Office => "office",
            ToolGroup::Extras => "extras",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum Engine {
    Image,
    Heif,
    Pdf,
    Archive,
    Text,
    Qr,
    Ocr,
    Ffmpeg,
    LibreOffice,
    ExifTool,
    BackgroundRemoval,
    System,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum Platforms {
    Both,
    Windows,
    Mac,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Planned,
    Preview,
    Ready,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    pub id: &'static str,
    /// The name shown on the wheel; format names are not translated.
    pub label: &'static str,
    pub category: Category,
    pub extensions: &'static [&'static str],
    pub read: bool,
    pub write: bool,
    /// Marked [+] in SPEC: beyond the core feature set.
    pub enhancement: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    pub from: &'static str,
    pub to: &'static str,
    pub engine: Engine,
    pub group: ToolGroup,
    pub platforms: Platforms,
    pub status: Status,
    pub enhancement: bool,
    /// A short English note for FORMATS.md, such as "when an encoder is installed".
    pub note: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub id: &'static str,
    pub categories: &'static [Category],
    pub engine: Engine,
    pub group: ToolGroup,
    pub platforms: Platforms,
    pub status: Status,
    pub enhancement: bool,
    pub icon: &'static str,
    pub note: Option<&'static str>,
}

impl Tool {
    pub fn name_key(&self) -> String {
        format!("tool.{}", self.id)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub id: &'static str,
    pub platforms: Platforms,
    pub status: Status,
    pub enhancement: bool,
    pub icon: &'static str,
    /// A key per platform when the wording differs ("Show in Explorer" / "Show in Finder").
    pub per_platform: bool,
}

impl Action {
    pub fn name_keys(&self) -> Vec<String> {
        if self.per_platform {
            vec![
                format!("action.{}.windows", self.id),
                format!("action.{}.mac", self.id),
            ]
        } else {
            vec![format!("action.{}", self.id)]
        }
    }
}

pub fn format(id: &str) -> Option<&'static Format> {
    formats().iter().find(|format| format.id == id)
}

/// The formats a file with this extension can be read as.
pub fn format_for_extension(extension: &str) -> Option<&'static Format> {
    let ext = extension.trim_start_matches('.').to_ascii_lowercase();
    formats()
        .iter()
        .find(|format| format.read && format.extensions.contains(&ext.as_str()))
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub formats: usize,
    pub core_inputs: usize,
    pub routes: usize,
    pub tools: usize,
    pub actions: usize,
    pub ready: usize,
}

pub fn summary() -> Summary {
    let routes = routes();
    Summary {
        formats: formats().len(),
        core_inputs: formats()
            .iter()
            .filter(|f| f.read && !f.enhancement)
            .count(),
        routes: routes.len(),
        tools: tools().len(),
        actions: actions().len(),
        ready: routes.iter().filter(|r| r.status == Status::Ready).count()
            + tools().iter().filter(|t| t.status == Status::Ready).count()
            + actions()
                .iter()
                .filter(|a| a.status == Status::Ready)
                .count(),
    }
}

/// Every i18n key the catalog uses.
pub fn i18n_keys() -> Vec<String> {
    let mut keys: Vec<String> = Category::ALL
        .iter()
        .map(|c| format!("category.{}", c.key()))
        .collect();
    keys.extend(ToolGroup::ALL.iter().flat_map(|g| {
        [
            format!("group.{}", g.key()),
            format!("group.{}.detail", g.key()),
        ]
    }));
    keys.extend(tools().iter().map(Tool::name_key));
    keys.extend(actions().iter().flat_map(Action::name_keys));
    keys
}

/// Problems with the catalog's own consistency; empty when all is well.
pub fn problems() -> Vec<String> {
    let mut problems = Vec::new();
    // Ids are unique within their kind; a wheel slice names its kind as well as its id.
    let kinds: [(&str, Vec<&str>); 3] = [
        ("format", formats().iter().map(|f| f.id).collect()),
        ("tool", tools().iter().map(|t| t.id).collect()),
        ("action", actions().iter().map(|a| a.id).collect()),
    ];
    for (kind, list) in kinds {
        let mut ids = HashSet::new();
        for id in list {
            if !ids.insert(id) {
                problems.push(format!("{kind} id {id} is used twice"));
            }
        }
    }
    let mut extensions = HashSet::new();
    for format in formats() {
        if format.extensions.is_empty() {
            problems.push(format!("{} has no extension", format.id));
        }
        for ext in format.extensions {
            if ext.to_ascii_lowercase() != *ext || ext.starts_with('.') {
                problems.push(format!(
                    "{} has extension {ext}; use lowercase without a dot",
                    format.id
                ));
            }
            if format.read && !extensions.insert(*ext) {
                problems.push(format!("extension {ext} is read by two formats"));
            }
        }
    }
    let mut pairs = HashSet::new();
    for route in routes() {
        match (format(route.from), format(route.to)) {
            (Some(from), Some(to)) => {
                if !from.read {
                    problems.push(format!(
                        "route {} → {}: {} cannot be read",
                        route.from, route.to, from.id
                    ));
                }
                if !to.write {
                    problems.push(format!(
                        "route {} → {}: {} cannot be written",
                        route.from, route.to, to.id
                    ));
                }
            }
            _ => problems.push(format!(
                "route {} → {} names an unknown format",
                route.from, route.to
            )),
        }
        if route.from == route.to {
            problems.push(format!(
                "route {} → {} converts to itself",
                route.from, route.to
            ));
        }
        if !pairs.insert((route.from, route.to)) {
            problems.push(format!(
                "route {} → {} is listed twice",
                route.from, route.to
            ));
        }
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn the_catalog_is_consistent() {
        let problems = problems();
        assert!(problems.is_empty(), "{problems:#?}");
    }

    #[test]
    fn it_has_the_46_core_input_formats_of_the_spec() {
        assert_eq!(summary().core_inputs, 46);
        assert_eq!(tools().iter().filter(|t| !t.enhancement).count(), 27);
    }

    #[test]
    fn every_key_exists_in_every_locale() {
        for (code, json) in [
            ("en", include_str!("../../../locales/en.json")),
            ("tr", include_str!("../../../locales/tr.json")),
        ] {
            let dict: HashMap<String, String> = serde_json::from_str(json).unwrap();
            for key in i18n_keys() {
                assert!(dict.contains_key(&key), "{code} is missing {key}");
            }
        }
    }

    #[test]
    fn extensions_find_their_format() {
        assert_eq!(format_for_extension("HEIC").map(|f| f.id), Some("heic"));
        assert_eq!(format_for_extension(".jpeg").map(|f| f.id), Some("jpg"));
        assert_eq!(format_for_extension("tgz").map(|f| f.id), Some("gz"));
        assert!(format_for_extension("exe").is_none());
    }
}
