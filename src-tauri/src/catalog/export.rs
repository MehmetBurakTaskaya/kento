// SPDX-License-Identifier: MIT
//! The catalog as Markdown (docs/FORMATS.md) and JSON (website-kit/catalog.json). Both outputs are
//! deterministic, so CI can check that the committed files are current.

use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};

use serde_json::{json, Value};

use super::{actions, format, formats, routes, summary, tools, Category, Status, ToolGroup};

pub type Dictionary = HashMap<String, String>;

fn status_word(status: Status) -> &'static str {
    match status {
        Status::Planned => "planned",
        Status::Preview => "preview",
        Status::Ready => "ready",
    }
}

fn group_word(group: ToolGroup) -> &'static str {
    match group {
        ToolGroup::Core => "Core",
        ToolGroup::Media => "Media",
        ToolGroup::Office => "Office",
        ToolGroup::Extras => "Extras",
    }
}

fn label(id: &str) -> String {
    format(id).map_or_else(|| id.to_string(), |f| f.label.to_string())
}

pub fn markdown(en: &Dictionary) -> String {
    let s = summary();
    let name = |key: &str| en.get(key).cloned().unwrap_or_else(|| key.to_string());
    let mut out = String::new();
    out.push_str("# Formats, tools and file actions\n\n");
    out.push_str("Generated from the catalog in `src-tauri/src/catalog` by `npm run catalog:export`; do not edit by hand.\n\n");
    out.push_str("**Status:** *ready* works today; *preview* depends on the computer (HEIC needs the system's HEIF support or the media tools); *planned* arrives in a later phase. **[+]** marks an enhancement beyond the core feature set. Core needs no download; Media, Office and Extras are optional tool groups (SPEC 4.2).\n\n");
    out.push_str("| | Count |\n| --- | ---: |\n");
    out.push_str(&format!("| Formats | {} |\n| Core input formats | {} |\n| Conversion routes | {} |\n| Tools | {} |\n| File actions | {} |\n\n", s.formats, s.core_inputs, s.routes, s.tools, s.actions));

    for category in Category::ALL {
        let sources: Vec<_> = formats()
            .iter()
            .filter(|f| f.category == category && f.read)
            .collect();
        if sources.is_empty() {
            continue;
        }
        out.push_str(&format!(
            "## {}\n\n",
            name(&format!("category.{}", category.key()))
        ));
        out.push_str("| From | To | Needs | Status | Notes |\n| --- | --- | --- | --- | --- |\n");
        for source in sources {
            // Per tool group: the targets, and each note with the targets it applies to.
            type Notes = Vec<(&'static str, Vec<String>)>;
            // Ready rows first within a group.
            let mut rows: BTreeMap<(ToolGroup, Reverse<Status>), (Vec<String>, Notes)> =
                BTreeMap::new();
            for route in routes().iter().filter(|r| r.from == source.id) {
                let mut target = label(route.to);
                if route.enhancement && !source.enhancement {
                    target.push_str(" [+]");
                }
                let row = rows
                    .entry((route.group, Reverse(route.status)))
                    .or_default();
                row.0.push(target);
                if let Some(note) = route.note {
                    match row.1.iter_mut().find(|(text, _)| *text == note) {
                        Some((_, targets)) => targets.push(label(route.to)),
                        None => row.1.push((note, vec![label(route.to)])),
                    }
                }
            }
            let mut from = source.label.to_string();
            if source.enhancement {
                from.push_str(" [+]");
            }
            if rows.is_empty() {
                out.push_str(&format!("| {from} | (tools only) | | | |\n"));
                continue;
            }
            for ((group, Reverse(status)), (targets, notes)) in rows {
                let notes: Vec<String> = notes
                    .into_iter()
                    .map(|(text, on)| {
                        if on.len() == targets.len() {
                            text.to_string()
                        } else {
                            format!("{}: {text}", on.join(", "))
                        }
                    })
                    .collect();
                out.push_str(&format!(
                    "| {from} | {} | {} | {} | {} |\n",
                    targets.join(", "),
                    group_word(group),
                    status_word(status),
                    notes.join("; ")
                ));
            }
        }
        out.push('\n');
    }

    out.push_str("## Tools\n\n| Tool | Works on | Needs | Status | Notes |\n| --- | --- | --- | --- | --- |\n");
    for tool in tools() {
        let on: Vec<String> = tool
            .categories
            .iter()
            .map(|c| name(&format!("category.{}", c.key())))
            .collect();
        let mut title = name(&tool.name_key());
        if tool.enhancement {
            title.push_str(" [+]");
        }
        out.push_str(&format!(
            "| {title} | {} | {} | {} | {} |\n",
            if on.is_empty() {
                "text or a link".to_string()
            } else {
                on.join(", ")
            },
            group_word(tool.group),
            status_word(tool.status),
            tool.note.unwrap_or("")
        ));
    }
    out.push_str("\n## File actions\n\n| Action | Status |\n| --- | --- |\n");
    for action in actions() {
        let names: Vec<String> = action.name_keys().iter().map(|k| name(k)).collect();
        let mut title = names.join(" / ");
        if action.enhancement {
            title.push_str(" [+]");
        }
        out.push_str(&format!("| {title} | {} |\n", status_word(action.status)));
    }
    out
}

pub fn json(dictionaries: &[(&str, &Dictionary)]) -> Value {
    let names = |key: &str| -> Value {
        let map: serde_json::Map<String, Value> = dictionaries
            .iter()
            .map(|(code, dict)| {
                (
                    (*code).to_string(),
                    Value::String(dict.get(key).cloned().unwrap_or_else(|| key.to_string())),
                )
            })
            .collect();
        Value::Object(map)
    };
    json!({
        "summary": summary(),
        "categories": Category::ALL.iter().map(|c| json!({ "id": c.key(), "names": names(&format!("category.{}", c.key())) })).collect::<Vec<_>>(),
        "groups": ToolGroup::ALL.iter().map(|g| json!({ "id": g.key(), "names": names(&format!("group.{}", g.key())) })).collect::<Vec<_>>(),
        "formats": formats(),
        "routes": routes(),
        "tools": tools().iter().map(|t| {
            let mut value = serde_json::to_value(t).unwrap_or(Value::Null);
            value["names"] = names(&t.name_key());
            value
        }).collect::<Vec<_>>(),
        "actions": actions().iter().map(|a| {
            let mut value = serde_json::to_value(a).unwrap_or(Value::Null);
            value["names"] = Value::Array(a.name_keys().iter().map(|k| names(k)).collect());
            value
        }).collect::<Vec<_>>(),
    })
}
