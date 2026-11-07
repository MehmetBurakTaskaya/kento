// SPDX-License-Identifier: MIT
//! The command line's words: the command, its files and its options. Parsed by hand: the commands
//! are few, file names arrive as the system gives them (not always UTF-8), and every message comes
//! from the locale files, which a parser crate's own English help and errors would not.

use std::ffi::OsString;
use std::path::PathBuf;

use kento_engines::compress::Compression;
use kento_engines::media::{Strength, TransitionKind, Turn};
use kento_engines::pdf::PageSize;
use kento_engines::qr::Report;

/// What the command line asked for.
#[derive(Debug, Clone, PartialEq)]
pub struct Invocation {
    pub command: Command,
    /// The result as one JSON document on standard output.
    pub json: bool,
    /// No progress lines on standard error.
    pub quiet: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    /// Help on the commands, or on one of them.
    Help(Option<Topic>),
    Version,
    Convert {
        files: Vec<PathBuf>,
        to: String,
        out: Option<PathBuf>,
    },
    Tool {
        tool: String,
        files: Vec<PathBuf>,
        out: Option<PathBuf>,
        options: ToolOptions,
    },
    Recipes,
    Recipe {
        recipe: String,
        files: Vec<PathBuf>,
        out: Option<PathBuf>,
    },
    Formats,
    Routes {
        format: String,
    },
}

/// The commands with help of their own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Topic {
    Convert,
    Tool,
    Recipe,
    Formats,
    Routes,
}

impl Topic {
    fn named(word: &str) -> Option<Topic> {
        Some(match word {
            "convert" => Topic::Convert,
            "tool" => Topic::Tool,
            "recipe" => Topic::Recipe,
            "formats" => Topic::Formats,
            "routes" => Topic::Routes,
            _ => return None,
        })
    }

    pub fn word(self) -> &'static str {
        match self {
            Topic::Convert => "convert",
            Topic::Tool => "tool",
            Topic::Recipe => "recipe",
            Topic::Formats => "formats",
            Topic::Routes => "routes",
        }
    }
}

/// The choices a tool takes on the command line. Which tool takes which is checked when the tool
/// is known; `given` keeps the option names in the order they came.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ToolOptions {
    pub compression: Option<Compression>,
    pub page: Option<PageSize>,
    pub margin_mm: Option<f32>,
    pub report: Option<Report>,
    /// Remove noise and Stabilize video.
    pub strength: Option<Strength>,
    /// Remove noise also takes away the lowest hum and rumble.
    pub rumble: bool,
    /// Remove pauses: dB, then seconds.
    pub threshold: Option<f64>,
    pub min_length: Option<f64>,
    pub keep: Option<f64>,
    /// Rotate video.
    pub turn: Option<Turn>,
    pub mirror: bool,
    pub flip: bool,
    /// Merge audio, in seconds.
    pub crossfade: Option<f64>,
    /// Merge videos, and how long each transition lasts in seconds.
    pub transition: Option<TransitionKind>,
    pub seconds: Option<f64>,
    pub given: Vec<&'static str>,
}

/// Wrong usage, before anything runs. The message is put together from the locale files.
#[derive(Debug, Clone, PartialEq)]
pub enum Usage {
    UnknownCommand(String),
    UnknownOption(String),
    MissingValue(&'static str),
    Twice(&'static str),
    Invalid {
        option: &'static str,
        value: String,
    },
    /// An option this command (or tool) does not take.
    NotHere(&'static str),
    Extra(String),
    NoFiles,
    NoTarget,
    NoFormat,
    NoTool,
    NoRecipe,
    /// Compress takes one of --quality, --ratio and --target-size.
    OneMode,
    /// Rotate video needs --turn, --mirror or --flip.
    NoTurn,
}

/// Options without a value, with their short forms.
const FLAGS: [(&str, &str); 10] = [
    ("--json", "--json"),
    ("--quiet", "--quiet"),
    ("-q", "--quiet"),
    ("--help", "--help"),
    ("-h", "--help"),
    ("--version", "--version"),
    ("-V", "--version"),
    ("--rumble", "--rumble"),
    ("--mirror", "--mirror"),
    ("--flip", "--flip"),
];

/// Options with a value (`--to jpg` or `--to=jpg`), with their short forms.
const VALUES: [(&str, &str); 17] = [
    ("--to", "--to"),
    ("--out", "--out"),
    ("-o", "--out"),
    ("--quality", "--quality"),
    ("--ratio", "--ratio"),
    ("--target-size", "--target-size"),
    ("--page", "--page"),
    ("--margin", "--margin"),
    ("--format", "--format"),
    ("--strength", "--strength"),
    ("--threshold", "--threshold"),
    ("--min-length", "--min-length"),
    ("--keep", "--keep"),
    ("--turn", "--turn"),
    ("--crossfade", "--crossfade"),
    ("--transition", "--transition"),
    ("--seconds", "--seconds"),
];

/// The options `tool` passes on to the tool.
const TOOL_VALUES: [&str; 14] = [
    "--quality",
    "--ratio",
    "--target-size",
    "--page",
    "--margin",
    "--format",
    "--strength",
    "--threshold",
    "--min-length",
    "--keep",
    "--turn",
    "--crossfade",
    "--transition",
    "--seconds",
];

/// The switches `tool` passes on to the tool.
const TOOL_FLAGS: [&str; 3] = ["--rumble", "--mirror", "--flip"];

/// How quiet a pause is, in dB, and how long its parts last, in seconds: wide enough for any
/// recording, narrow enough to catch a slip of the keyboard (`--threshold 40` for -40).
const THRESHOLD: std::ops::RangeInclusive<f64> = -80.0..=-10.0;
const MIN_LENGTH: std::ops::RangeInclusive<f64> = 0.1..=10.0;
const KEEP: std::ops::RangeInclusive<f64> = 0.0..=2.0;
/// Merge audio overlaps by at most 10 seconds, Merge videos' transitions last 0.2 to 2.
const CROSSFADE: std::ops::RangeInclusive<f64> = 0.0..=10.0;
const TRANSITION: std::ops::RangeInclusive<f64> = 0.2..=2.0;

#[derive(Debug, Default)]
struct Words {
    operands: Vec<OsString>,
    flags: Vec<&'static str>,
    values: Vec<(&'static str, OsString)>,
}

impl Words {
    fn has(&self, flag: &str) -> bool {
        self.flags.contains(&flag)
    }

    fn value(&self, option: &str) -> Option<&OsString> {
        self.values
            .iter()
            .find(|(name, _)| *name == option)
            .map(|(_, value)| value)
    }

    /// Fails on the first option given that `allowed` does not list (the switches every command
    /// takes, such as --json, need no listing).
    fn only(&self, allowed: &[&str]) -> Result<(), Usage> {
        let values = self.values.iter().map(|(name, _)| *name);
        let switches = self
            .flags
            .iter()
            .copied()
            .filter(|f| TOOL_FLAGS.contains(f));
        match values.chain(switches).find(|name| !allowed.contains(name)) {
            Some(name) => Err(Usage::NotHere(name)),
            None => Ok(()),
        }
    }
}

/// Splits the arguments into operands and options. Options may come anywhere; after `--` every
/// argument is an operand, so a file may start with a dash.
fn words(args: impl IntoIterator<Item = OsString>) -> Result<Words, Usage> {
    let mut words = Words::default();
    let mut args = args.into_iter();
    let mut operands_only = false;
    while let Some(arg) = args.next() {
        let text = match arg.to_str() {
            Some(text) if !operands_only && text.starts_with('-') && text.len() > 1 => text,
            _ => {
                words.operands.push(arg);
                continue;
            }
        };
        if text == "--" {
            operands_only = true;
            continue;
        }
        let (name, inline) = match text.split_once('=') {
            Some((name, value)) if name.starts_with("--") => (name, Some(value)),
            _ => (text, None),
        };
        if let Some((_, flag)) = FLAGS.iter().find(|(word, _)| *word == name) {
            if let Some(value) = inline {
                return Err(Usage::Invalid {
                    option: flag,
                    value: value.to_owned(),
                });
            }
            words.flags.push(flag);
        } else if let Some((_, option)) = VALUES.iter().find(|(word, _)| *word == name) {
            let value = match inline {
                Some(value) => OsString::from(value),
                None => args.next().ok_or(Usage::MissingValue(option))?,
            };
            if value.is_empty() {
                return Err(Usage::MissingValue(option));
            }
            if words.value(option).is_some() {
                return Err(Usage::Twice(option));
            }
            words.values.push((option, value));
        } else {
            return Err(Usage::UnknownOption(name.to_owned()));
        }
    }
    Ok(words)
}

/// Whether the arguments ask for JSON, for a message about arguments that do not parse.
pub fn wants_json(args: &[OsString]) -> bool {
    args.iter()
        .take_while(|arg| arg.to_str() != Some("--"))
        .any(|arg| arg.to_str() == Some("--json"))
}

pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Invocation, Usage> {
    let words = words(args)?;
    let (json, quiet) = (words.has("--json"), words.has("--quiet"));
    let mut operands = words.operands.iter();
    let command = match operands.next() {
        Some(word) => Some(
            word.to_str()
                .ok_or_else(|| Usage::UnknownCommand(word.to_string_lossy().into_owned()))?,
        ),
        None => None,
    };
    let rest: Vec<&OsString> = operands.collect();
    let command = match command {
        None => {
            words.only(&[])?;
            if words.has("--version") && !words.has("--help") {
                Command::Version
            } else {
                Command::Help(None)
            }
        }
        Some("help") => {
            words.only(&[])?;
            match rest.as_slice() {
                [] => Command::Help(None),
                [word, ..] => {
                    let word = word.to_string_lossy();
                    let topic =
                        Topic::named(&word).ok_or_else(|| Usage::UnknownCommand(word.into()))?;
                    Command::Help(Some(topic))
                }
            }
        }
        Some(word) => {
            let topic = Topic::named(word).ok_or_else(|| Usage::UnknownCommand(word.to_owned()))?;
            if words.has("--help") {
                Command::Help(Some(topic))
            } else if words.has("--version") {
                Command::Version
            } else {
                command_of(topic, &words, &rest)?
            }
        }
    };
    Ok(Invocation {
        command,
        json,
        quiet,
    })
}

fn command_of(topic: Topic, words: &Words, rest: &[&OsString]) -> Result<Command, Usage> {
    let files = |list: &[&OsString]| -> Result<Vec<PathBuf>, Usage> {
        if list.is_empty() {
            return Err(Usage::NoFiles);
        }
        Ok(list.iter().map(PathBuf::from).collect())
    };
    let out = words.value("--out").map(PathBuf::from);
    let text = |arg: &OsString| arg.to_string_lossy().into_owned();
    Ok(match topic {
        Topic::Convert => {
            words.only(&["--to", "--out"])?;
            let to = words.value("--to").ok_or(Usage::NoTarget)?;
            Command::Convert {
                files: files(rest)?,
                to: text(to),
                out,
            }
        }
        Topic::Tool => {
            let mut allowed = TOOL_VALUES.to_vec();
            allowed.extend(TOOL_FLAGS);
            allowed.push("--out");
            words.only(&allowed)?;
            let (tool, list) = rest.split_first().ok_or(Usage::NoTool)?;
            Command::Tool {
                tool: text(tool),
                files: files(list)?,
                out,
                options: tool_options(words)?,
            }
        }
        Topic::Recipe => match rest.split_first() {
            Some((word, extra)) if word.to_str() == Some("list") => {
                words.only(&[])?;
                if let Some(extra) = extra.first() {
                    return Err(Usage::Extra(text(extra)));
                }
                Command::Recipes
            }
            Some((word, list)) if word.to_str() == Some("run") => {
                words.only(&["--out"])?;
                let (recipe, list) = list.split_first().ok_or(Usage::NoRecipe)?;
                Command::Recipe {
                    recipe: text(recipe),
                    files: files(list)?,
                    out,
                }
            }
            Some((word, _)) => return Err(Usage::UnknownCommand(text(word))),
            None => Command::Help(Some(Topic::Recipe)),
        },
        Topic::Formats => {
            words.only(&[])?;
            if let Some(extra) = rest.first() {
                return Err(Usage::Extra(text(extra)));
            }
            Command::Formats
        }
        Topic::Routes => {
            words.only(&[])?;
            match rest {
                [] => return Err(Usage::NoFormat),
                [format] => Command::Routes {
                    format: text(format),
                },
                [_, extra, ..] => return Err(Usage::Extra(text(extra))),
            }
        }
    })
}

fn tool_options(words: &Words) -> Result<ToolOptions, Usage> {
    let mut options = ToolOptions::default();
    for &(option, ref value) in &words.values {
        if !TOOL_VALUES.contains(&option) {
            continue;
        }
        let text = value.to_string_lossy();
        let invalid = || Usage::Invalid {
            option,
            value: text.clone().into_owned(),
        };
        let number = |range: std::ops::RangeInclusive<u8>| {
            text.trim()
                .trim_end_matches('%')
                .parse::<u8>()
                .ok()
                .filter(|n| range.contains(n))
                .ok_or_else(invalid)
        };
        match option {
            "--quality" | "--ratio" | "--target-size" => {
                if options.compression.is_some() {
                    return Err(Usage::OneMode);
                }
                options.compression = Some(match option {
                    "--quality" => Compression::Quality {
                        level: number(1..=100)?,
                    },
                    "--ratio" => Compression::Ratio {
                        percent: number(5..=95)?,
                    },
                    _ => Compression::Size {
                        bytes: size(&text).ok_or_else(invalid)?,
                    },
                });
            }
            "--page" => {
                options.page = Some(match text.trim().to_ascii_lowercase().as_str() {
                    "fit" | "fit-image" => PageSize::FitImage,
                    "a4" => PageSize::A4,
                    "letter" => PageSize::Letter,
                    _ => return Err(invalid()),
                });
            }
            "--margin" => {
                let mm = text
                    .trim()
                    .trim_end_matches("mm")
                    .trim()
                    .replace(',', ".")
                    .parse::<f32>()
                    .ok()
                    .filter(|mm| (0.0..=50.0).contains(mm))
                    .ok_or_else(invalid)?;
                options.margin_mm = Some(mm);
            }
            "--format" => {
                options.report = Some(match word(&text).as_str() {
                    "txt" => Report::Txt,
                    "csv" => Report::Csv,
                    "json" => Report::Json,
                    _ => return Err(invalid()),
                });
            }
            "--strength" => {
                options.strength = Some(match word(&text).as_str() {
                    "light" => Strength::Light,
                    "medium" => Strength::Medium,
                    "strong" => Strength::Strong,
                    _ => return Err(invalid()),
                });
            }
            "--turn" => {
                options.turn = Some(match word(&text).as_str() {
                    "right" => Turn::Right,
                    "left" => Turn::Left,
                    "half" => Turn::Half,
                    _ => return Err(invalid()),
                });
            }
            "--transition" => {
                options.transition = Some(match word(&text).as_str() {
                    "cut" => TransitionKind::Cut,
                    "fade" => TransitionKind::Fade,
                    "fade-black" => TransitionKind::FadeBlack,
                    "slide" => TransitionKind::Slide,
                    "wipe" => TransitionKind::Wipe,
                    _ => return Err(invalid()),
                });
            }
            "--threshold" => {
                options.threshold = Some(decimal(&text, "db", THRESHOLD).ok_or_else(invalid)?)
            }
            "--min-length" => {
                options.min_length = Some(decimal(&text, "s", MIN_LENGTH).ok_or_else(invalid)?)
            }
            "--keep" => options.keep = Some(decimal(&text, "s", KEEP).ok_or_else(invalid)?),
            "--crossfade" => {
                options.crossfade = Some(decimal(&text, "s", CROSSFADE).ok_or_else(invalid)?)
            }
            _ => options.seconds = Some(decimal(&text, "s", TRANSITION).ok_or_else(invalid)?),
        }
        options.given.push(option);
    }
    for &flag in &words.flags {
        match flag {
            "--rumble" => options.rumble = true,
            "--mirror" => options.mirror = true,
            "--flip" => options.flip = true,
            _ => continue,
        }
        options.given.push(flag);
    }
    Ok(options)
}

/// A choice by its name, in any case.
fn word(text: &str) -> String {
    text.trim().to_ascii_lowercase()
}

/// A number with a decimal point or comma and, optionally, its unit ("-40dB", "0,5 s"), within
/// `range`.
fn decimal(text: &str, unit: &str, range: std::ops::RangeInclusive<f64>) -> Option<f64> {
    let text = word(text);
    let text = text.strip_suffix(unit).unwrap_or(&text);
    let value: f64 = text.trim().replace(',', ".").parse().ok()?;
    (value.is_finite() && range.contains(&value)).then_some(value)
}

/// "25MB", "2,5 mb", "800KB", "1G" or a number of bytes: decimal units, like every size Kento
/// shows, and the binary ones when asked for ("2MiB").
pub fn size(text: &str) -> Option<u64> {
    let text = text.trim().replace(',', ".");
    let split = text
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(text.len());
    let (number, unit) = text.split_at(split);
    let value: f64 = number.parse().ok()?;
    let scale: f64 = match unit.trim().to_ascii_lowercase().as_str() {
        "" | "b" => 1.0,
        "k" | "kb" => 1e3,
        "m" | "mb" => 1e6,
        "g" | "gb" => 1e9,
        "kib" => 1024.0,
        "mib" => 1024.0 * 1024.0,
        "gib" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    let bytes = (value * scale).round();
    (bytes.is_finite() && bytes >= 1.0 && bytes < u64::MAX as f64).then_some(bytes as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(args: &[&str]) -> Result<Invocation, Usage> {
        parse(args.iter().map(OsString::from))
    }

    fn command(args: &[&str]) -> Command {
        run(args).unwrap().command
    }

    #[test]
    fn convert_takes_options_anywhere_and_keeps_paths_as_given() {
        let expected = Command::Convert {
            files: vec!["Fotoğraf 🧪.heic".into(), "b.png".into()],
            to: "jpg".into(),
            out: Some("çıktı".into()),
        };
        for args in [
            &[
                "convert",
                "Fotoğraf 🧪.heic",
                "b.png",
                "--to",
                "jpg",
                "--out",
                "çıktı",
            ][..],
            &[
                "convert",
                "--to=jpg",
                "-o",
                "çıktı",
                "Fotoğraf 🧪.heic",
                "b.png",
            ],
            &[
                "--json",
                "convert",
                "Fotoğraf 🧪.heic",
                "--out=çıktı",
                "b.png",
                "--to",
                "jpg",
            ],
        ] {
            assert_eq!(command(args), expected, "{args:?}");
        }
        let parsed = run(&["-q", "convert", "a.png", "--to", "jpg", "--json"]).unwrap();
        assert!(parsed.json && parsed.quiet);
        // After `--` a file may start with a dash.
        assert_eq!(
            command(&["convert", "--to", "jpg", "--", "-tire.png", "--json"]),
            Command::Convert {
                files: vec!["-tire.png".into(), "--json".into()],
                to: "jpg".into(),
                out: None,
            }
        );
    }

    #[test]
    fn wrong_usage_is_named() {
        assert_eq!(
            run(&["convrt", "a.png"]),
            Err(Usage::UnknownCommand("convrt".into()))
        );
        assert_eq!(
            run(&["convert", "a.png", "--too", "jpg"]),
            Err(Usage::UnknownOption("--too".into()))
        );
        assert_eq!(
            run(&["convert", "a.png", "--to"]),
            Err(Usage::MissingValue("--to"))
        );
        assert_eq!(
            run(&["convert", "a.png", "--to="]),
            Err(Usage::MissingValue("--to"))
        );
        assert_eq!(
            run(&["convert", "a.png", "--to", "jpg", "--to", "png"]),
            Err(Usage::Twice("--to"))
        );
        assert_eq!(run(&["convert", "a.png"]), Err(Usage::NoTarget));
        assert_eq!(run(&["convert", "--to", "jpg"]), Err(Usage::NoFiles));
        assert_eq!(
            run(&["convert", "a.png", "--to", "jpg", "--quality", "50"]),
            Err(Usage::NotHere("--quality"))
        );
        assert_eq!(
            run(&["--json=yes", "formats"]),
            Err(Usage::Invalid {
                option: "--json",
                value: "yes".into()
            })
        );
        assert_eq!(run(&["formats", "png"]), Err(Usage::Extra("png".into())));
        assert_eq!(run(&["routes"]), Err(Usage::NoFormat));
        assert_eq!(
            run(&["routes", "png", "jpg"]),
            Err(Usage::Extra("jpg".into()))
        );
        assert_eq!(run(&["tool"]), Err(Usage::NoTool));
        assert_eq!(run(&["tool", "compress"]), Err(Usage::NoFiles));
        assert_eq!(run(&["recipe", "run"]), Err(Usage::NoRecipe));
        assert_eq!(
            run(&["recipe", "sil"]),
            Err(Usage::UnknownCommand("sil".into()))
        );
    }

    #[test]
    fn tools_take_their_choices() {
        let Command::Tool {
            tool,
            files,
            options,
            ..
        } = command(&["tool", "compress", "video.mp4", "--target-size", "25MB"])
        else {
            panic!("not a tool");
        };
        assert_eq!((tool.as_str(), files.len()), ("compress", 1));
        assert_eq!(
            options.compression,
            Some(Compression::Size { bytes: 25_000_000 })
        );
        assert_eq!(options.given, ["--target-size"]);
        let Command::Tool { options, .. } = command(&[
            "tool",
            "images-to-pdf",
            "a.png",
            "b.jpg",
            "--page",
            "A4",
            "--margin",
            "12,5mm",
        ]) else {
            panic!("not a tool");
        };
        assert_eq!(options.page, Some(PageSize::A4));
        assert_eq!(options.margin_mm, Some(12.5));
        let Command::Tool { options, .. } =
            command(&["tool", "read-qr", "kod.png", "--format", "csv"])
        else {
            panic!("not a tool");
        };
        assert_eq!(options.report, Some(Report::Csv));
        let Command::Tool { options, .. } = command(&["tool", "compress", "a.jpg", "--ratio=40%"])
        else {
            panic!("not a tool");
        };
        assert_eq!(
            options.compression,
            Some(Compression::Ratio { percent: 40 })
        );
        assert_eq!(
            run(&[
                "tool",
                "compress",
                "a.jpg",
                "--quality",
                "60",
                "--ratio",
                "50"
            ]),
            Err(Usage::OneMode)
        );
        for (option, value) in [
            ("--quality", "0"),
            ("--quality", "101"),
            ("--ratio", "96"),
            ("--target-size", "25 parsecs"),
            ("--page", "a3"),
            ("--margin", "80"),
            ("--format", "xml"),
        ] {
            assert!(
                matches!(
                    run(&["tool", "compress", "a.jpg", option, value]),
                    Err(Usage::Invalid { .. })
                ),
                "{option} {value}"
            );
        }
    }

    #[test]
    fn video_and_audio_tools_take_their_choices() {
        let options = |args: &[&str]| match command(args) {
            Command::Tool { options, .. } => options,
            other => panic!("not a tool: {other:?}"),
        };
        let denoise = options(&[
            "tool",
            "denoise",
            "ses.wav",
            "--strength",
            "Strong",
            "--rumble",
        ]);
        assert_eq!(denoise.strength, Some(Strength::Strong));
        assert!(denoise.rumble);
        assert_eq!(denoise.given, ["--strength", "--rumble"]);

        let pauses = options(&[
            "tool",
            "remove-pauses",
            "konuşma 🧪.mp4",
            "--threshold",
            "-35dB",
            "--min-length=0,8",
            "--keep",
            "0.2s",
        ]);
        assert_eq!(pauses.threshold, Some(-35.0));
        assert_eq!(pauses.min_length, Some(0.8));
        assert_eq!(pauses.keep, Some(0.2));

        let turned = options(&["tool", "rotate-video", "a.mp4", "--turn", "half", "--flip"]);
        assert_eq!(turned.turn, Some(Turn::Half));
        assert!(turned.flip && !turned.mirror);
        assert!(options(&["tool", "rotate-video", "a.mp4", "--mirror"]).mirror);

        let merged = options(&[
            "tool",
            "merge-video",
            "a.mp4",
            "b.mov",
            "--transition",
            "fade-black",
            "--seconds",
            "1.5",
        ]);
        assert_eq!(merged.transition, Some(TransitionKind::FadeBlack));
        assert_eq!(merged.seconds, Some(1.5));
        let joined = options(&["tool", "merge-audio", "a.mp3", "b.wav", "--crossfade", "3"]);
        assert_eq!(joined.crossfade, Some(3.0));

        for (option, value) in [
            ("--strength", "max"),
            ("--threshold", "-5"),
            ("--threshold", "-100"),
            ("--threshold", "loud"),
            ("--min-length", "0"),
            ("--keep", "3"),
            ("--turn", "up"),
            ("--transition", "dissolve"),
            ("--seconds", "0.1"),
            ("--seconds", "3"),
            ("--crossfade", "-1"),
            ("--crossfade", "NaN"),
        ] {
            assert!(
                matches!(
                    run(&["tool", "denoise", "a.wav", option, value]),
                    Err(Usage::Invalid { .. })
                ),
                "{option} {value}"
            );
        }
        // The switches belong to the tool command only, and take no value.
        assert_eq!(
            run(&["convert", "a.mp4", "--to", "webm", "--mirror"]),
            Err(Usage::NotHere("--mirror"))
        );
        assert_eq!(run(&["--flip"]), Err(Usage::NotHere("--flip")));
        assert!(matches!(
            run(&["tool", "denoise", "a.wav", "--rumble=yes"]),
            Err(Usage::Invalid { .. })
        ));
    }

    #[test]
    fn recipes_formats_and_routes() {
        assert_eq!(command(&["recipe", "list"]), Command::Recipes);
        assert_eq!(
            command(&["recipe", "run", "Instagram için", "a.jpg", "-o", "x"]),
            Command::Recipe {
                recipe: "Instagram için".into(),
                files: vec!["a.jpg".into()],
                out: Some("x".into()),
            }
        );
        assert_eq!(command(&["formats", "--json"]), Command::Formats);
        assert_eq!(
            command(&["routes", "heic"]),
            Command::Routes {
                format: "heic".into()
            }
        );
    }

    #[test]
    fn help_and_version() {
        assert_eq!(command(&[]), Command::Help(None));
        assert_eq!(command(&["-h"]), Command::Help(None));
        assert_eq!(command(&["help"]), Command::Help(None));
        assert_eq!(command(&["help", "tool"]), Command::Help(Some(Topic::Tool)));
        assert_eq!(
            command(&["convert", "--help"]),
            Command::Help(Some(Topic::Convert))
        );
        // Help on a command needs nothing else to be right.
        assert_eq!(
            command(&["tool", "compress", "-h"]),
            Command::Help(Some(Topic::Tool))
        );
        assert_eq!(command(&["--version"]), Command::Version);
        assert_eq!(command(&["-V", "--json"]), Command::Version);
        assert_eq!(
            run(&["help", "nothing"]),
            Err(Usage::UnknownCommand("nothing".into()))
        );
        assert!(wants_json(&["x".into(), "--json".into()]));
        assert!(!wants_json(&["--".into(), "--json".into()]));
    }

    #[test]
    fn sizes_read_like_the_compress_panel() {
        assert_eq!(size("25MB"), Some(25_000_000));
        assert_eq!(size("25 mb"), Some(25_000_000));
        assert_eq!(size("2,5M"), Some(2_500_000));
        assert_eq!(size("800KB"), Some(800_000));
        assert_eq!(size("1gb"), Some(1_000_000_000));
        assert_eq!(size("2MiB"), Some(2 << 20));
        assert_eq!(size("1048576"), Some(1 << 20));
        assert_eq!(size("0"), None);
        assert_eq!(size("MB"), None);
        assert_eq!(size("12 TB"), None);
        assert_eq!(size("-5MB"), None);
    }
}
