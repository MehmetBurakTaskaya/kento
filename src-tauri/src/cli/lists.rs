// SPDX-License-Identifier: MIT
//! What Kento converts, from the catalog (`kento formats`, `kento routes <format>`), and the
//! recipes saved in the app (`kento recipe list`). Only routes this version runs are listed.

use std::sync::OnceLock;

use serde::Serialize;
use serde_json::json;

use super::{format_named, print_json, run, Exit, Session};
use crate::catalog::{self, Category, Format, Route, ToolGroup};
use crate::work::{missing_in, usable};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FormatRow {
    id: &'static str,
    label: &'static str,
    category: Category,
    extensions: &'static [&'static str],
    read: bool,
    write: bool,
    /// What it converts to.
    to: Vec<&'static str>,
}

impl FormatRow {
    fn of(format: &'static Format) -> Self {
        Self {
            id: format.id,
            label: format.label,
            category: format.category,
            extensions: format.extensions,
            read: format.read,
            write: format.write,
            to: targets(format.id).iter().map(|route| route.to).collect(),
        }
    }
}

/// The catalog's routes that run in this version, found once.
fn runnable() -> &'static [&'static Route] {
    static ROUTES: OnceLock<Vec<&'static Route>> = OnceLock::new();
    ROUTES.get_or_init(|| {
        catalog::routes()
            .iter()
            .filter(|route| usable(route.from, route.to))
            .collect()
    })
}

/// The routes from a format that run in this version.
fn targets(from: &str) -> Vec<&'static Route> {
    let runnable = runnable().iter().copied();
    runnable.filter(|route| route.from == from).collect()
}

/// The routes into a format that run in this version.
fn sources(to: &str) -> Vec<&'static Route> {
    let runnable = runnable().iter().copied();
    runnable.filter(|route| route.to == to).collect()
}

pub fn formats(session: &Session) -> Exit {
    let rows: Vec<FormatRow> = catalog::formats()
        .iter()
        .filter(|format| !targets(format.id).is_empty() || !sources(format.id).is_empty())
        .map(FormatRow::of)
        .collect();
    if session.json() {
        print_json(&json!({ "ok": true, "exitCode": 0, "formats": rows }));
        return Exit::Done;
    }
    for category in Category::ALL {
        let rows: Vec<&FormatRow> = rows.iter().filter(|r| r.category == category).collect();
        if rows.is_empty() {
            continue;
        }
        println!("{}", session.text(&format!("category.{}", category.key())));
        let extensions: Vec<String> = rows
            .iter()
            .map(|row| {
                let list: Vec<String> =
                    row.extensions.iter().map(|ext| format!(".{ext}")).collect();
                list.join(" ")
            })
            .collect();
        let id_width = rows.iter().map(|row| row.id.len()).max().unwrap_or(0);
        let ext_width = extensions.iter().map(|ext| ext.len()).max().unwrap_or(0);
        for (row, extensions) in rows.iter().zip(&extensions) {
            let to = if row.to.is_empty() {
                session.text("cli.formats.written")
            } else {
                format!("→ {}", row.to.join(" "))
            };
            println!("  {:<id_width$}  {extensions:<ext_width$}  {to}", row.id);
        }
        println!();
    }
    Exit::Done
}

pub fn routes(session: &Session, name: &str) -> Exit {
    let Some(format) = format_named(name, false) else {
        return session.fail(&session.problem(
            Exit::Usage,
            "cli.format.unknown",
            &[("format", name)],
        ));
    };
    let (to, from) = (targets(format.id), sources(format.id));
    let mut groups: Vec<ToolGroup> = to.iter().chain(&from).map(|route| route.group).collect();
    groups.sort();
    groups.dedup();
    let tools = session.tools(&groups);
    let ready = |route: &Route| missing_in(&tools, route.group).is_none();
    let label = |id: &str| catalog::format(id).map_or("", |format| format.label);
    if session.json() {
        let list = |routes: &[&'static Route], other: fn(&Route) -> &'static str| {
            routes
                .iter()
                .map(|route| {
                    json!({
                        "format": other(route),
                        "label": label(other(route)),
                        "group": route.group,
                        "ready": ready(route),
                        "enhancement": route.enhancement,
                        "note": route.note,
                    })
                })
                .collect::<Vec<_>>()
        };
        print_json(&json!({
            "ok": true,
            "exitCode": 0,
            "format": FormatRow::of(format),
            "to": list(&to, |route| route.to),
            "from": list(&from, |route| route.from),
        }));
        return Exit::Done;
    }
    let title = format!("{} ({})", format.label, format.id);
    let show = |routes: &[&'static Route], other: fn(&Route) -> &'static str| {
        if routes.is_empty() {
            println!("  {}", session.text("cli.routes.none"));
        }
        let id_width = routes.iter().map(|r| other(r).len()).max().unwrap_or(0);
        let label_width = routes
            .iter()
            .map(|r| label(other(r)).len())
            .max()
            .unwrap_or(0);
        for route in routes {
            let id = other(route);
            let needs = if ready(route) {
                String::new()
            } else {
                format!(
                    "  {} · {}",
                    session.text(&format!("group.{}", route.group.key())),
                    session.text("home.tools.status.missing")
                )
            };
            let line = format!("  {id:<id_width$}  {:<label_width$}{needs}", label(id));
            println!("{}", line.trim_end());
        }
    };
    println!("{}", session.say("cli.routes.to", &[("format", &title)]));
    show(&to, |route| route.to);
    println!();
    println!("{}", session.say("cli.routes.from", &[("format", &title)]));
    show(&from, |route| route.from);
    Exit::Done
}

pub fn recipes(session: &Session) -> Exit {
    let recipes = match run::load_recipes(session) {
        Ok(recipes) => recipes,
        Err(problem) => return session.fail(&problem),
    };
    if session.json() {
        print_json(&json!({ "ok": true, "exitCode": 0, "recipes": recipes }));
    } else if recipes.is_empty() {
        println!("{}", session.text("cli.recipe.none"));
    } else {
        for recipe in &recipes {
            println!("  {}  ({})", recipe.name, recipe.id);
        }
    }
    Exit::Done
}
