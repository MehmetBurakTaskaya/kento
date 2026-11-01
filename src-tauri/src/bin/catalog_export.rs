// SPDX-License-Identifier: MIT
//! Writes docs/FORMATS.md and website-kit/catalog.json from the catalog. With --check it only
//! compares and fails when a committed file is out of date (CI runs it that way).

use std::path::PathBuf;
use std::process::ExitCode;

use kento_lib::catalog::export::{self, Dictionary};

fn main() -> ExitCode {
    let check = std::env::args().any(|arg| arg == "--check");
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let load = |code: &str| -> Dictionary {
        let text = std::fs::read_to_string(root.join("locales").join(format!("{code}.json")))
            .expect("locale file");
        serde_json::from_str(&text).expect("locale JSON")
    };
    let (en, tr) = (load("en"), load("tr"));
    let markdown = export::markdown(&en);
    let json = serde_json::to_string_pretty(&export::json(&[("en", &en), ("tr", &tr)]))
        .expect("catalog JSON")
        + "\n";
    let outputs = [
        (root.join("docs").join("FORMATS.md"), markdown),
        (root.join("website-kit").join("catalog.json"), json),
    ];

    let mut stale = Vec::new();
    for (path, content) in &outputs {
        let current = std::fs::read_to_string(path)
            .unwrap_or_default()
            .replace("\r\n", "\n");
        if current == *content {
            continue;
        }
        if check {
            stale.push(path.display().to_string());
        } else {
            std::fs::create_dir_all(path.parent().expect("a parent folder")).expect("folder");
            std::fs::write(path, content).expect("write");
            println!("wrote {}", path.display());
        }
    }
    if stale.is_empty() {
        ExitCode::SUCCESS
    } else {
        eprintln!(
            "out of date (run npm run catalog:export): {}",
            stale.join(", ")
        );
        ExitCode::FAILURE
    }
}
