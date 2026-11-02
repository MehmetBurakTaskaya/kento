// SPDX-License-Identifier: MIT
//! Kento's client for the LibreOffice it keeps running (`kept.rs`): the script `kento_office.py`,
//! run by LibreOffice's own Python, loads one document through LibreOffice's API and stores it
//! with an export filter (`XComponentLoader.loadComponentFromURL`, `XStorable.storeToURL`, the
//! `MediaDescriptor` properties of the LibreOffice API reference).
//!
//! Kento chooses every property here and the script only hands them over, so what a document may
//! do while it loads (no macros, no link updates) is decided and tested in Rust.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use super::soffice::{file_url, plain, Export, Log};

/// The client, written next to each job's files before it runs.
pub(super) const SCRIPT: &str = include_str!("kento_office.py");
const SCRIPT_NAME: &str = "kento_office.py";

/// The script's exit codes (the constants at its top).
pub(super) mod code {
    pub const OK: i32 = 0;
    pub const OTHER: i32 = 1;
    pub const USAGE: i32 = 2;
    pub const NO_UNO: i32 = 3;
    pub const NO_CONNECTION: i32 = 4;
    pub const UNREADABLE: i32 = 5;
    pub const BROKEN: i32 = 6;
}

/// What the script prefixes its message line with.
const SAYS: &str = "kento-office: ";

/// `com.sun.star.document.MacroExecMode.NEVER_EXECUTE`: no macro runs at all.
const NEVER_EXECUTE: i16 = 0;
/// `com.sun.star.document.UpdateDocMode.NO_UPDATE`: links in the document are not updated.
const NO_UPDATE: i16 = 0;

/// LibreOffice's own Python, the one with pyuno, beside `soffice` (LibreOffice Help, "Python
/// Interactive Shell"): `python.exe` in the program folder on Windows, `Contents/Resources/python`
/// in `LibreOffice.app` on macOS and `python` in the program folder elsewhere, for Kento's copy and
/// a system install alike. None when there is none; jobs then start LibreOffice for each document.
pub(super) fn python(soffice: &Path) -> Option<PathBuf> {
    // Homebrew links `soffice` into its bin folder; the app is where the link leads.
    let soffice = if cfg!(unix) {
        fs::canonicalize(soffice).unwrap_or_else(|_| soffice.to_path_buf())
    } else {
        soffice.to_path_buf()
    };
    let os = if cfg!(windows) {
        Os::Windows
    } else if cfg!(target_os = "macos") {
        Os::Mac
    } else {
        Os::Other
    };
    let path = python_beside(&soffice, os);
    path.is_file().then_some(path)
}

#[derive(Debug, Clone, Copy)]
enum Os {
    Windows,
    Mac,
    Other,
}

fn python_beside(soffice: &Path, os: Os) -> PathBuf {
    let program = soffice.parent().unwrap_or(Path::new(""));
    match os {
        Os::Windows => program.join("python.exe"),
        // `Contents/MacOS/soffice` → `Contents/Resources/python`.
        Os::Mac => program
            .parent()
            .unwrap_or(program)
            .join("Resources")
            .join("python"),
        Os::Other => program.join("python"),
    }
}

/// A property of a load or store request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Property {
    pub(super) name: &'static str,
    pub(super) value: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Value {
    Bool(bool),
    Short(i16),
    Text(String),
}

fn property(name: &'static str, value: Value) -> Property {
    Property { name, value }
}

impl Property {
    /// `Name:type:value`, as the script reads it.
    fn argument(&self) -> String {
        let (kind, text) = match &self.value {
            Value::Bool(value) => ("bool", value.to_string()),
            Value::Short(value) => ("short", value.to_string()),
            Value::Text(value) => ("string", value.clone()),
        };
        format!("{}:{kind}:{text}", self.name)
    }
}

/// How a document loads: hidden and read-only, never running a macro or updating a link, with
/// the import filter and its options when Kento names one (`--infilter`'s `name:options`).
pub(super) fn load_properties(infilter: Option<&str>) -> Vec<Property> {
    let mut properties = vec![
        property("Hidden", Value::Bool(true)),
        property("ReadOnly", Value::Bool(true)),
        property("MacroExecutionMode", Value::Short(NEVER_EXECUTE)),
        property("UpdateDocMode", Value::Short(NO_UPDATE)),
    ];
    if let Some(filter) = infilter {
        properties.extend(filter_properties(filter));
    }
    properties
}

/// How the result is stored: the export filter with its options (`--convert-to`'s
/// `extension:name:options`), replacing what an earlier try left in the job's own folder.
pub(super) fn store_properties(export: &Export) -> Vec<Property> {
    let mut properties = filter_properties(&export.filter);
    properties.push(property("Overwrite", Value::Bool(true)));
    properties
}

/// `FilterName`, and `FilterOptions` from what follows the first colon (no filter name has one).
fn filter_properties(filter: &str) -> Vec<Property> {
    let (name, options) = match filter.split_once(':') {
        Some((name, options)) => (name, Some(options)),
        None => (filter, None),
    };
    let mut properties = vec![property("FilterName", Value::Text(name.to_owned()))];
    if let Some(options) = options.filter(|options| !options.is_empty()) {
        properties.push(property("FilterOptions", Value::Text(options.to_owned())));
    }
    properties
}

/// One conversion: `input` loaded and stored as `output` by the LibreOffice listening on `pipe`,
/// which the script waits for up to `wait`.
pub(super) fn convert_arguments(
    script: &Path,
    pipe: &str,
    wait: Duration,
    input: &Path,
    output: &Path,
    infilter: Option<&str>,
    export: &Export,
) -> Vec<OsString> {
    let mut args = head(script, "convert", pipe, wait);
    args.push(format!("--input={}", file_url(input)).into());
    args.push(format!("--output={}", file_url(output)).into());
    for load in load_properties(infilter) {
        args.push(format!("--load={}", load.argument()).into());
    }
    for store in store_properties(export) {
        args.push(format!("--store={}", store.argument()).into());
    }
    args
}

/// Asks the LibreOffice listening on `pipe` to end.
pub(super) fn stop_arguments(script: &Path, pipe: &str, wait: Duration) -> Vec<OsString> {
    head(script, "stop", pipe, wait)
}

/// `-s` keeps the user's own Python packages out and `-B` leaves no compiled files in
/// LibreOffice's folder; then the script, the action, the pipe and the wait.
fn head(script: &Path, action: &str, pipe: &str, wait: Duration) -> Vec<OsString> {
    vec![
        "-s".into(),
        "-B".into(),
        plain(script),
        action.into(),
        format!("--pipe={pipe}").into(),
        format!("--wait={:.1}", wait.as_secs_f64()).into(),
    ]
}

/// Writes the script into `dir`, a folder of the job's own that holds nothing else (Python looks
/// for modules beside the script first).
pub(super) fn write_script(dir: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let path = dir.join(SCRIPT_NAME);
    fs::write(&path, SCRIPT)?;
    Ok(path)
}

/// The command for one request, run in the script's folder. None of the user's `PYTHON*` settings
/// reach LibreOffice's Python: its launcher sets what pyuno needs, and another Python's home or
/// path would break it.
pub(super) fn command(python: &Path, script: &Path, args: &[OsString]) -> Command {
    let mut command = crate::process::command(python);
    for (key, _) in std::env::vars_os() {
        if key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("PYTHON")
        {
            command.env_remove(&key);
        }
    }
    command
        .args(args)
        .current_dir(script.parent().unwrap_or(Path::new(".")))
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    command
}

/// What the client's exit code and message line say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Answer {
    Done,
    /// LibreOffice could not load the document; its message.
    Unreadable(String),
    /// This Python cannot run the client: no pyuno, or it does not start.
    Unusable(String),
    /// Nothing listened on the pipe in time.
    NoConnection(String),
    /// The connection to LibreOffice broke during the request: it crashed or was ended.
    Broken(String),
    /// Anything else, such as an export that failed.
    Failed(String),
}

pub(super) fn answer(exit: Option<i32>, log: &Log) -> Answer {
    let lines = || log.tail.iter().filter_map(|line| line.strip_prefix(SAYS));
    // The script ran when it said anything; its message is its last line but "connected".
    let ran = lines().next().is_some();
    let said = lines()
        .rev()
        .filter_map(|line| line.split_once(": "))
        .find(|(kind, _)| *kind != "connected")
        .map(|(_, message)| message);
    let message = || {
        said.map(str::to_owned)
            .or_else(|| log.tail.back().cloned())
            .unwrap_or_else(|| "no message".to_owned())
    };
    match exit {
        Some(code::OK) => Answer::Done,
        Some(code::UNREADABLE) => Answer::Unreadable(message()),
        Some(code::NO_UNO) => Answer::Unusable(message()),
        Some(code::NO_CONNECTION) => Answer::NoConnection(message()),
        Some(code::BROKEN) => Answer::Broken(message()),
        Some(code::USAGE) => Answer::Failed(format!("the office client refused: {}", message())),
        // The script says why it failed; without a line of it Python itself did not run it.
        Some(code::OTHER) if ran => Answer::Failed(message()),
        Some(other) => Answer::Unusable(format!("Python ended with {other}: {}", message())),
        None => Answer::Failed("the office client was stopped".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn office_client_python_is_where_libreoffice_keeps_it() {
        // Forward slashes, so that the Windows case reads the same on a Mac, where a backslash is
        // part of a name.
        assert_eq!(
            python_beside(
                Path::new("C:/Program Files/LibreOffice/program/soffice.exe"),
                Os::Windows
            ),
            Path::new("C:/Program Files/LibreOffice/program").join("python.exe")
        );
        assert_eq!(
            python_beside(
                Path::new("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
                Os::Mac
            ),
            Path::new("/Applications/LibreOffice.app/Contents/Resources/python")
        );
        assert_eq!(
            python_beside(Path::new("/opt/libreoffice/program/soffice"), Os::Other),
            Path::new("/opt/libreoffice/program/python")
        );
    }

    #[test]
    fn office_client_without_python_there_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let (soffice, python_path) = if cfg!(windows) {
            (
                dir.path().join("soffice.exe"),
                dir.path().join("python.exe"),
            )
        } else if cfg!(target_os = "macos") {
            let contents = dir.path().join("LibreOffice.app").join("Contents");
            fs::create_dir_all(contents.join("MacOS")).unwrap();
            fs::create_dir_all(contents.join("Resources")).unwrap();
            (
                contents.join("MacOS").join("soffice"),
                contents.join("Resources").join("python"),
            )
        } else {
            (dir.path().join("soffice"), dir.path().join("python"))
        };
        fs::write(&soffice, b"").unwrap();
        assert_eq!(python(&soffice), None);
        fs::write(&python_path, b"").unwrap();
        let found = python(&soffice).unwrap();
        assert_eq!(
            fs::canonicalize(found).unwrap(),
            fs::canonicalize(&python_path).unwrap()
        );
    }

    #[test]
    fn office_client_documents_load_hidden_read_only_and_inert() {
        let names = |properties: &[Property]| {
            properties
                .iter()
                .map(|property| property.argument())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            names(&load_properties(None)),
            [
                "Hidden:bool:true",
                "ReadOnly:bool:true",
                "MacroExecutionMode:short:0",
                "UpdateDocMode:short:0",
            ]
        );
        // `--infilter`'s name and options become two properties; the options keep their colons
        // and commas as they are.
        let csv = load_properties(Some(
            "Text - txt - csv (StarCalc):59,34,76,1,,1031,false,false,,,false,,false",
        ));
        assert_eq!(
            names(&csv[4..]),
            [
                "FilterName:string:Text - txt - csv (StarCalc)",
                "FilterOptions:string:59,34,76,1,,1031,false,false,,,false,,false",
            ]
        );
        let text = load_properties(Some("Text (encoded):UTF8,LF"));
        assert_eq!(
            names(&text[4..]),
            [
                "FilterName:string:Text (encoded)",
                "FilterOptions:string:UTF8,LF"
            ]
        );
        let html = load_properties(Some("HTML (StarWriter)"));
        assert_eq!(names(&html[4..]), ["FilterName:string:HTML (StarWriter)"]);
    }

    #[test]
    fn office_client_results_store_with_the_export_filter() {
        let names = |export: Export| {
            store_properties(&export)
                .iter()
                .map(Property::argument)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            names(Export::new("pdf", "writer_pdf_Export")),
            ["FilterName:string:writer_pdf_Export", "Overwrite:bool:true"]
        );
        assert_eq!(
            names(Export::new("html", "HTML (StarWriter):EmbedImages")),
            [
                "FilterName:string:HTML (StarWriter)",
                "FilterOptions:string:EmbedImages",
                "Overwrite:bool:true"
            ]
        );
        assert_eq!(
            names(Export::new(
                "csv",
                "Text - txt - csv (StarCalc):9,34,76,1,,1033,false,true,true,false,false"
            )),
            [
                "FilterName:string:Text - txt - csv (StarCalc)",
                "FilterOptions:string:9,34,76,1,,1033,false,true,true,false,false",
                "Overwrite:bool:true"
            ]
        );
        assert_eq!(
            names(Export::new("txt", "Text (encoded):UTF8"))[1],
            "FilterOptions:string:UTF8"
        );
    }

    #[test]
    fn office_client_arguments_are_an_array_in_a_fixed_order() {
        let (script, input, output) = if cfg!(windows) {
            (
                r"C:\Kullanıcılar\Şule\Kento\temp\iş 1\office\client\kento_office.py",
                r"C:\Kullanıcılar\Şule\Kento\temp\iş 1\office\in\in.csv",
                r"C:\Kullanıcılar\Şule\Kento\temp\iş 1\office\out\in.ods",
            )
        } else {
            (
                "/Users/şule/Kento/temp/iş 1/office/client/kento_office.py",
                "/Users/şule/Kento/temp/iş 1/office/in/in.csv",
                "/Users/şule/Kento/temp/iş 1/office/out/in.ods",
            )
        };
        let args = convert_arguments(
            Path::new(script),
            "kento-42-office-1",
            Duration::from_secs(120),
            Path::new(input),
            Path::new(output),
            Some("Text - txt - csv (StarCalc):44,34,76"),
            &Export::new("ods", "calc8"),
        );
        let url = |path: &str| {
            if cfg!(windows) {
                format!("file:///C:/Kullan%C4%B1c%C4%B1lar/%C5%9Eule/Kento/temp/i%C5%9F%201/office/{path}")
            } else {
                format!("file:///Users/%C5%9Fule/Kento/temp/i%C5%9F%201/office/{path}")
            }
        };
        assert_eq!(
            text(&args),
            [
                "-s".to_owned(),
                "-B".to_owned(),
                script.to_owned(),
                "convert".to_owned(),
                "--pipe=kento-42-office-1".to_owned(),
                "--wait=120.0".to_owned(),
                format!("--input={}", url("in/in.csv")),
                format!("--output={}", url("out/in.ods")),
                "--load=Hidden:bool:true".to_owned(),
                "--load=ReadOnly:bool:true".to_owned(),
                "--load=MacroExecutionMode:short:0".to_owned(),
                "--load=UpdateDocMode:short:0".to_owned(),
                "--load=FilterName:string:Text - txt - csv (StarCalc)".to_owned(),
                "--load=FilterOptions:string:44,34,76".to_owned(),
                "--store=FilterName:string:calc8".to_owned(),
                "--store=Overwrite:bool:true".to_owned(),
            ]
        );
        assert_eq!(
            text(&stop_arguments(
                Path::new(script),
                "kento-42-office-1",
                Duration::ZERO
            )),
            [
                "-s",
                "-B",
                script,
                "stop",
                "--pipe=kento-42-office-1",
                "--wait=0.0"
            ]
        );
        if cfg!(windows) {
            // LibreOffice's Python reads no `\\?\` paths.
            let long = stop_arguments(
                Path::new(r"\\?\C:\Temp\client\kento_office.py"),
                "p",
                Duration::ZERO,
            );
            assert_eq!(long[2], r"C:\Temp\client\kento_office.py");
        }
    }

    #[test]
    fn office_client_the_script_answers_in_the_codes_kento_reads() {
        for (name, value) in [
            ("OK", code::OK),
            ("OTHER", code::OTHER),
            ("USAGE", code::USAGE),
            ("NO_UNO", code::NO_UNO),
            ("NO_CONNECTION", code::NO_CONNECTION),
            ("UNREADABLE", code::UNREADABLE),
            ("BROKEN", code::BROKEN),
        ] {
            assert!(
                SCRIPT
                    .lines()
                    .any(|line| line == format!("{name} = {value}")),
                "{name} = {value}"
            );
        }
        assert!(SCRIPT.starts_with("# SPDX-License-Identifier: MIT\n"));
        assert!(SCRIPT.contains(&format!("\"{SAYS}%s: %s\\n\"")));
        // A pipe, never a socket.
        assert!(SCRIPT.contains("\"uno:pipe,name=%s;urp;StarOffice.ComponentContext\""));
        assert!(!SCRIPT.contains("uno:socket"));
        let dir = tempfile::tempdir().unwrap();
        let path = write_script(&dir.path().join("client")).unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), SCRIPT);
    }

    #[test]
    fn office_client_answers_follow_the_exit_code() {
        let log = |lines: &[&str]| {
            let mut log = Log::default();
            log.tail.extend(lines.iter().map(|line| (*line).to_owned()));
            log
        };
        let unreadable = log(&[
            "kento-office: connected: kento-1-office-1",
            "kento-office: unreadable: could not be loaded: General Error",
        ]);
        assert_eq!(
            answer(Some(code::UNREADABLE), &unreadable),
            Answer::Unreadable("could not be loaded: General Error".into())
        );
        assert_eq!(answer(Some(code::OK), &Log::default()), Answer::Done);
        assert!(matches!(
            answer(Some(code::NO_UNO), &log(&["kento-office: no-uno: No module named 'uno'"])),
            Answer::Unusable(message) if message == "No module named 'uno'"
        ));
        assert!(matches!(
            answer(Some(code::NO_CONNECTION), &Log::default()),
            Answer::NoConnection(_)
        ));
        assert!(matches!(
            answer(Some(code::BROKEN), &log(&["kento-office: broken: Binary URP bridge disposed"])),
            Answer::Broken(message) if message.contains("disposed")
        ));
        assert!(matches!(
            answer(Some(code::OTHER), &log(&["kento-office: error: could not be written: x"])),
            Answer::Failed(message) if message == "could not be written: x"
        ));
        // Python that fails before the script runs is no client.
        assert!(matches!(
            answer(
                Some(code::OTHER),
                &log(&["Fatal Python error: init_fs_encoding"])
            ),
            Answer::Unusable(_)
        ));
        assert!(matches!(
            answer(Some(9009), &Log::default()),
            Answer::Unusable(_)
        ));
        assert!(matches!(
            answer(Some(code::USAGE), &Log::default()),
            Answer::Failed(_)
        ));
        assert!(matches!(answer(None, &Log::default()), Answer::Failed(_)));
    }
}
