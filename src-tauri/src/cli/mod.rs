// SPDX-License-Identifier: MIT
//! Kento on the command line (SPEC 5.2): `kento convert`, `kento tool`, `kento recipe`,
//! `kento formats` and `kento routes`. A console program of its own (`src/bin/kento_cli.rs`)
//! runs this, so a terminal waits for it and gets its output and exit code; it never starts the
//! window, the tray or the single-instance hand-off. It runs the same engines, output names, tool
//! detection, recipes and messages as the app, in Kento's language.

mod args;
mod console;
mod lists;
mod run;

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Serialize;
use serde_json::{json, Value};

use crate::catalog::ToolGroup;
use crate::paths::{AppPaths, APP_DIR};
use crate::settings::Settings;
use crate::toolchain::Toolchain;
use crate::{catalog, i18n};
pub use args::{parse, Command, Invocation, ToolOptions, Topic, Usage};

/// Points the command line at another data folder (settings, recipes, tool paths, scratch
/// files) instead of the app's; tests and portable scripts use it.
pub const DATA_DIR_VAR: &str = "KENTO_DATA_DIR";

/// The exit codes, for scripts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    Done = 0,
    /// A job failed (the others still ran).
    Failed = 1,
    /// The command line was wrong: a command, option, value, file or name.
    Usage = 2,
    /// Kento cannot do this: a route, a kind of file, a tool that needs its window.
    Unsupported = 3,
    /// A tool Kento needs is not on this computer (FFmpeg, LibreOffice, ExifTool).
    MissingTool = 4,
    /// Ctrl+C.
    Cancelled = 130,
}

impl Exit {
    pub fn code(self) -> u8 {
        self as u8
    }

    /// The name in JSON output.
    pub fn kind(self) -> &'static str {
        match self {
            Exit::Done => "done",
            Exit::Failed => "failed",
            Exit::Usage => "usage",
            Exit::Unsupported => "unsupported",
            Exit::MissingTool => "missing-tool",
            Exit::Cancelled => "cancelled",
        }
    }
}

/// What stops a command or a job, in plain language, with the technical text apart.
#[derive(Debug, Clone)]
pub(crate) struct Problem {
    pub exit: Exit,
    pub message: String,
    pub details: Option<String>,
}

impl Problem {
    pub(crate) fn json(&self) -> Value {
        json!({
            "kind": self.exit.kind(),
            "message": self.message,
            "details": self.details,
        })
    }
}

/// Runs the command line and returns its exit code.
pub fn main() -> ExitCode {
    console::quiet_pipes();
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let exit = run_in(data_paths(), args, true);
    console::finished();
    ExitCode::from(exit.code())
}

/// Runs one command line with this data folder; `watch` turns Ctrl+C into a cancel.
fn run_in(paths: AppPaths, args: Vec<OsString>, watch: bool) -> Exit {
    let json = args::wants_json(&args);
    match parse(args) {
        Ok(invocation) => {
            let session = Session::new(paths, invocation.json, invocation.quiet);
            let jobs = matches!(
                invocation.command,
                Command::Convert { .. } | Command::Tool { .. } | Command::Recipe { .. }
            );
            if watch && jobs {
                console::watch();
            }
            session.run(invocation.command)
        }
        Err(usage) => {
            let session = Session::new(paths, json, true);
            let problem = session.usage(&usage);
            session.fail(&problem)
        }
    }
}

/// What every command shares: the data folder, the language and how to answer.
pub(crate) struct Session {
    paths: AppPaths,
    lang: String,
    json: bool,
    quiet: bool,
}

impl Session {
    fn new(paths: AppPaths, json: bool, quiet: bool) -> Self {
        let lang = i18n::resolve(
            &language_setting(&paths.settings_file()),
            i18n::system_locale().as_deref(),
        );
        Self {
            paths,
            lang,
            json,
            quiet,
        }
    }

    fn run(&self, command: Command) -> Exit {
        match command {
            Command::Help(topic) => {
                println!("{}", self.help(topic));
                Exit::Done
            }
            Command::Version => {
                let version = env!("CARGO_PKG_VERSION");
                if self.json {
                    print_json(&json!({ "ok": true, "exitCode": 0, "version": version }));
                } else {
                    println!("kento {version}");
                }
                Exit::Done
            }
            Command::Formats => lists::formats(self),
            Command::Routes { format } => lists::routes(self, &format),
            Command::Recipes => lists::recipes(self),
            Command::Convert { files, to, out } => run::convert(self, &files, &to, out.as_deref()),
            Command::Tool {
                tool,
                files,
                out,
                options,
            } => run::tool(self, &tool, &files, out.as_deref(), &options),
            Command::Recipe { recipe, files, out } => {
                run::recipe(self, &recipe, &files, out.as_deref())
            }
        }
    }

    pub(crate) fn text(&self, key: &str) -> String {
        i18n::text(&self.lang, key)
    }

    /// A message with its `{name}` arguments filled in.
    pub(crate) fn say(&self, key: &str, args: &[(&str, &str)]) -> String {
        fill(&self.text(key), args)
    }

    pub(crate) fn problem(&self, exit: Exit, key: &str, args: &[(&str, &str)]) -> Problem {
        Problem {
            exit,
            message: self.say(key, args),
            details: None,
        }
    }

    pub(crate) fn usage(&self, usage: &Usage) -> Problem {
        let (key, args): (&str, Vec<(&str, String)>) = match usage {
            Usage::UnknownCommand(command) => {
                ("cli.usage.command", vec![("command", command.clone())])
            }
            Usage::UnknownOption(option) => ("cli.usage.option", vec![("option", option.clone())]),
            Usage::MissingValue(option) => {
                ("cli.usage.value", vec![("option", option.to_string())])
            }
            Usage::Twice(option) => ("cli.usage.twice", vec![("option", option.to_string())]),
            Usage::Invalid { option, value } => (
                "cli.usage.invalid",
                vec![("option", option.to_string()), ("value", value.clone())],
            ),
            Usage::NotHere(option) => ("cli.usage.not-here", vec![("option", option.to_string())]),
            Usage::Extra(word) => ("cli.usage.extra", vec![("argument", word.clone())]),
            Usage::NoFiles => ("cli.usage.files", vec![]),
            Usage::NoTarget => ("cli.usage.to", vec![]),
            Usage::NoFormat => ("cli.usage.format", vec![]),
            Usage::NoTool => ("cli.usage.tool", vec![]),
            Usage::NoRecipe => ("cli.usage.recipe", vec![]),
            Usage::OneMode => ("cli.usage.compress", vec![]),
        };
        let args: Vec<(&str, &str)> = args.iter().map(|(k, v)| (*k, v.as_str())).collect();
        self.problem(Exit::Usage, key, &args)
    }

    /// Says why the command ends and returns its exit code.
    pub(crate) fn fail(&self, problem: &Problem) -> Exit {
        if self.json {
            print_json(&json!({
                "ok": false,
                "exitCode": problem.exit.code(),
                "error": problem.json(),
            }));
        }
        self.tell(None, problem);
        problem.exit
    }

    /// A problem on standard error, for the person at the terminal.
    pub(crate) fn tell(&self, file: Option<&Path>, problem: &Problem) {
        match file.and_then(Path::file_name) {
            Some(name) => eprintln!("kento: {}: {}", name.to_string_lossy(), problem.message),
            None => eprintln!("kento: {}", problem.message),
        }
        if let Some(details) = &problem.details {
            eprintln!(
                "  {}",
                self.say("cli.details", &[("details", details.as_str())])
            );
        }
    }

    /// The tools of the groups a command needs; detection runs only for those, since it starts
    /// each tool once (LibreOffice takes a while).
    pub(crate) fn tools(&self, groups: &[ToolGroup]) -> kento_engines::Tools {
        let wanted: Vec<&str> = groups
            .iter()
            .filter(|group| **group != ToolGroup::Core)
            .map(|group| group.key())
            .collect();
        if wanted.is_empty() {
            return kento_engines::Tools::default();
        }
        Toolchain::new(&self.paths.data).engine_tools_of(&wanted)
    }

    /// Every tool group, for recipes, whose steps may need any of them.
    pub(crate) fn all_tools(&self) -> kento_engines::Tools {
        Toolchain::new(&self.paths.data).engine_tools()
    }

    /// The plain message for a missing tool group, as the app gives it.
    pub(crate) fn missing(&self, group: ToolGroup) -> Problem {
        let key = match group {
            ToolGroup::Office => "error.codec.libreoffice",
            ToolGroup::Extras => "error.codec.exiftool",
            ToolGroup::Media | ToolGroup::Core => "error.codec.ffmpeg",
        };
        self.problem(Exit::MissingTool, key, &[])
    }

    fn help(&self, topic: Option<Topic>) -> String {
        match topic {
            None => self.text("cli.help"),
            Some(Topic::Tool) => {
                let lines: Vec<String> = run::TOOLS
                    .iter()
                    .map(|id| format!("  {id:<15} {}", self.text(&format!("tool.{id}"))))
                    .collect();
                self.say("cli.help.tool", &[("tools", &lines.join("\n"))])
            }
            Some(topic) => self.text(&format!("cli.help.{}", topic.word())),
        }
    }

    pub(crate) fn json(&self) -> bool {
        self.json
    }

    pub(crate) fn quiet(&self) -> bool {
        self.quiet
    }

    pub(crate) fn paths(&self) -> &AppPaths {
        &self.paths
    }

    /// Downloads/Kento, where outputs go when the source's folder cannot be written to.
    pub(crate) fn fallback(&self) -> PathBuf {
        dirs::download_dir()
            .unwrap_or_else(|| self.paths.data.clone())
            .join(APP_DIR)
    }

    /// Loads the PDFium library the app ships, for the PDF routes. It lies where the app finds
    /// its resources: beside the program on Windows and in a build folder, in the bundle's
    /// Resources folder on macOS.
    pub(crate) fn load_pdfium(&self) {
        let resources = std::env::current_exe().ok().and_then(|exe| {
            // A link such as /usr/local/bin/kento points into the app bundle.
            let exe = if cfg!(target_os = "macos") {
                exe.canonicalize().ok()?
            } else {
                exe
            };
            let dir = exe.parent()?;
            let bundle = dir.join("..").join("Resources");
            Some(if cfg!(target_os = "macos") && bundle.is_dir() {
                bundle
            } else {
                dir.to_path_buf()
            })
        });
        if let Some(library) = crate::pdfium_library(resources) {
            if let Err(err) = kento_engines::pdf::init(&library) {
                tracing::warn!("PDFium could not be loaded: {err}");
            }
        }
    }
}

/// The data folder: the app's own (%LOCALAPPDATA%\Kento, ~/Library/Application Support/Kento),
/// or the one `KENTO_DATA_DIR` names.
fn data_paths() -> AppPaths {
    match std::env::var_os(DATA_DIR_VAR).filter(|dir| !dir.is_empty()) {
        Some(dir) => {
            let data = std::path::absolute(PathBuf::from(&dir)).unwrap_or_else(|_| dir.into());
            AppPaths {
                logs: data.join("logs"),
                temp: data.join("temp"),
                data,
            }
        }
        None => AppPaths::under(&dirs::data_local_dir().unwrap_or_else(std::env::temp_dir)),
    }
}

/// The language chosen in Settings ("system" unless one was picked). Read only: a broken file is
/// the app's to put aside.
fn language_setting(file: &Path) -> String {
    std::fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .map(Settings::normalized)
        .unwrap_or_default()
        .language
}

/// Fills `{name}` arguments in one pass, so a value that holds braces stays as it is.
pub(crate) fn fill(text: &str, args: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.find('}') else {
            out.push_str(&rest[open..]);
            return out;
        };
        let name = &after[..close];
        match args.iter().find(|(key, _)| *key == name) {
            Some((_, value)) => out.push_str(value),
            None => out.push_str(&rest[open..open + close + 2]),
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    out
}

/// One JSON document on standard output, in ASCII: everything else is escaped, so the text
/// survives any console code page (Windows PowerShell 5.1 reads programs' output in the OEM one).
pub(crate) fn print_json(value: &impl Serialize) {
    let text = serde_json::to_string_pretty(value).unwrap_or_else(|_| "null".into());
    println!("{}", ascii(&text));
}

fn ascii(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii() {
            out.push(c);
        } else {
            let mut units = [0u16; 2];
            for unit in c.encode_utf16(&mut units) {
                out.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    out
}

/// The format a name stands for: a catalog id or an extension ("jpeg", ".tif").
pub(crate) fn format_named(name: &str, writable: bool) -> Option<&'static catalog::Format> {
    let name = name.trim().trim_start_matches('.').to_lowercase();
    let fits = |format: &&catalog::Format| !writable || format.write;
    catalog::formats()
        .iter()
        .filter(fits)
        .find(|format| format.id == name)
        .or_else(|| {
            catalog::formats()
                .iter()
                .filter(fits)
                .find(|format| format.extensions.contains(&name.as_str()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_are_filled_once() {
        assert_eq!(
            fill(
                "{file}: {to} olmaz",
                &[("file", "a{to}.png"), ("to", "MP3")]
            ),
            "a{to}.png: MP3 olmaz"
        );
        assert_eq!(fill("{unknown} {", &[]), "{unknown} {");
    }

    #[test]
    fn json_is_ascii_and_reads_back() {
        let value = json!({ "path": "C:\\Fotoğraf 🧪.jpg" });
        let text = ascii(&serde_json::to_string(&value).unwrap());
        assert!(text.is_ascii(), "{text}");
        assert!(
            text.contains("\\u011f") && text.contains("\\ud83e\\uddea"),
            "{text}"
        );
        assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), value);
    }

    #[test]
    fn formats_are_found_by_id_or_extension() {
        assert_eq!(format_named("JPEG", true).map(|f| f.id), Some("jpg"));
        assert_eq!(format_named(".tif", true).map(|f| f.id), Some("tiff"));
        assert_eq!(format_named("heif", false).map(|f| f.id), Some("heic"));
        assert!(format_named("exe", false).is_none());
    }

    /// The exit codes of commands that stop before any job, run in this process (a process
    /// start per case would make the test slow).
    #[test]
    fn exit_codes_say_why_a_command_stops() {
        let data = tempfile::tempdir().unwrap();
        std::fs::write(data.path().join("settings.json"), r#"{"language":"en"}"#).unwrap();
        let paths = AppPaths {
            data: data.path().to_path_buf(),
            logs: data.path().join("logs"),
            temp: data.path().join("temp"),
        };
        let files = tempfile::tempdir().unwrap();
        let png = files.path().join("Resim ğüş 🧪.png");
        std::fs::write(&png, b"not read before the checks").unwrap();
        let src = png.to_str().unwrap();
        let pdf = files.path().join("Belge 🧪.pdf");
        std::fs::write(&pdf, b"%PDF-1.7").unwrap();
        let pdf = pdf.to_str().unwrap();
        let cases: &[(&[&str], Exit)] = &[
            (&["tool", "merge-pdf", pdf], Exit::Usage),
            (&[], Exit::Done),
            (&["--version"], Exit::Done),
            (&["help", "routes"], Exit::Done),
            (&["formats"], Exit::Done),
            (&["recipe", "list"], Exit::Done),
            (&["convrt", src], Exit::Usage),
            (&["convert", src], Exit::Usage),
            (&["convert", src, "--to", "nosuch"], Exit::Usage),
            (&["convert", "yok 🧪.png", "--to", "jpg"], Exit::Usage),
            (&["convert", src, "--to", "jpg", "--loud"], Exit::Usage),
            (&["tool", "compress", src, "--page", "a4"], Exit::Usage),
            (&["tool", "compress", src, "--quality", "0"], Exit::Usage),
            (&["tool", "nosuch", src], Exit::Usage),
            (&["tool", "merge-pdf", src], Exit::Unsupported),
            (&["recipe", "run", "yok", src], Exit::Usage),
            (&["routes", "nosuch"], Exit::Usage),
            (&["convert", src, "--to", "mp3"], Exit::Unsupported),
            (&["tool", "trim-video", src], Exit::Unsupported),
            (&["tool", "mute", src], Exit::Unsupported),
        ];
        for (args, expected) in cases {
            let args: Vec<OsString> = args.iter().map(OsString::from).collect();
            let exit = run_in(paths.clone(), args.clone(), false);
            assert_eq!(exit, *expected, "{args:?}");
        }
        // A recipes file that does not read is a failure, not an empty list.
        std::fs::write(paths.recipes_file(), "{ broken").unwrap();
        let args = vec![OsString::from("recipe"), OsString::from("list")];
        assert_eq!(run_in(paths.clone(), args, false), Exit::Failed);
        assert_eq!(Exit::Cancelled.code(), 130);
        assert_eq!(Exit::MissingTool.kind(), "missing-tool");
    }

    #[test]
    fn every_message_the_command_line_uses_exists() {
        let session = Session {
            paths: AppPaths::under(Path::new("unused")),
            lang: "en".into(),
            json: false,
            quiet: true,
        };
        for topic in [
            None,
            Some(Topic::Convert),
            Some(Topic::Tool),
            Some(Topic::Recipe),
            Some(Topic::Formats),
            Some(Topic::Routes),
        ] {
            let help = session.help(topic);
            assert!(!help.starts_with("cli."), "{help}");
            assert!(!help.contains('{'), "{help}");
        }
        for id in run::TOOLS {
            assert!(
                catalog::tools().iter().any(|tool| tool.id == id),
                "{id} is not in the catalog"
            );
        }
        let turkish = Session {
            lang: "tr".into(),
            ..session
        };
        assert!(turkish.help(Some(Topic::Convert)).contains("Kullanım"));
    }
}
