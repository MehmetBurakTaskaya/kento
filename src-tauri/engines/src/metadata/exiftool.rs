// SPDX-License-Identifier: MIT
//! Running ExifTool. Every argument travels in a UTF-8 argument file written to its standard input
//! (`-@ -`), read with `-charset filename=utf8`: on Windows its command line would pass through
//! the system code page, which has no room for most Turkish letters or any emoji. No console
//! window opens, and cancelling ends ExifTool together with the Perl it starts.

use std::io::{self, Read, Write};
use std::path::Path;
use std::process::Stdio;
use std::thread;
use std::time::{Duration, Instant};

use crate::process::{command, Reap};
use crate::{Codec, Error, Progress, Result};

/// How often a run looks at the cancel flag.
const POLL: Duration = Duration::from_millis(40);
/// Stderr kept for the error message; ExifTool says little, and only about the files.
const STDERR_LIMIT: u64 = 64 * 1024;

pub(super) struct Output {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub success: bool,
}

/// The argument file: one argument per line. ExifTool skips blank lines and lines starting with
/// `#`, drops leading spaces and ends an argument at a line break, so such arguments cannot be
/// passed this way (values with line breaks are read from files with `-TAG<=FILE` instead).
fn argfile(args: &[String]) -> Result<Vec<u8>> {
    let mut text = String::new();
    for arg in args {
        let unsafe_start = arg.starts_with(char::is_whitespace) || arg.starts_with('#');
        if arg.is_empty() || unsafe_start || arg.contains(['\n', '\r']) {
            return Err(Error::Other(
                "a file name or value cannot be handed to ExifTool".into(),
            ));
        }
        text.push_str(arg);
        text.push('\n');
    }
    Ok(text.into_bytes())
}

/// Runs ExifTool with `args`, stopping it when the job is cancelled or after `limit`.
pub(super) fn run(
    exiftool: &Path,
    args: &[String],
    progress: &Progress,
    limit: Option<Duration>,
) -> Result<Output> {
    progress.check()?;
    let file = argfile(args)?;
    let mut command = command(exiftool);
    command
        .args(["-charset", "filename=utf8", "-@", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command.spawn().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            Error::MissingCodec(Codec::ExifTool)
        } else {
            Error::Io(error)
        }
    })?;
    // On Windows the ExifTool there is a launcher that starts Perl, and the kill must reach both.
    let mut process = Reap::new(child);
    let mut stdin = process.child.stdin.take().expect("stdin is piped");
    let mut stdout = process.child.stdout.take().expect("stdout is piped");
    let stderr = process.child.stderr.take().expect("stderr is piped");
    // Writing and reading on threads of their own, so no full pipe ever stalls either side.
    let writer = thread::spawn(move || {
        let _ = stdin.write_all(&file);
    });
    let out = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let err = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.take(STDERR_LIMIT).read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).into_owned()
    });
    let deadline = limit.map(|limit| Instant::now() + limit);
    let status = loop {
        if progress.is_cancelled() {
            process.kill();
            return Err(Error::Cancelled);
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            process.kill();
            return Err(Error::Other("ExifTool did not finish in time".into()));
        }
        if let Some(status) = process.child.try_wait()? {
            break status;
        }
        thread::sleep(POLL);
    };
    let _ = writer.join();
    Ok(Output {
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
        success: status.success(),
    })
}

/// The error for a failed run: `Unreadable` when ExifTool blamed the file, otherwise `Other`
/// with its message (which names files, never their contents).
pub(super) fn failure(stderr: &str) -> Error {
    let errors: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("Error"))
        .collect();
    let detail = errors
        .last()
        .copied()
        .or_else(|| stderr.lines().rev().map(str::trim).find(|l| !l.is_empty()))
        .unwrap_or("ExifTool stopped without a message")
        .to_owned();
    let input = [
        "Not a valid",
        "File format error",
        "Unknown file type",
        "corrupted",
        "File is empty",
    ];
    if errors
        .iter()
        .any(|line| input.iter().any(|problem| line.contains(problem)))
    {
        Error::Unreadable(detail)
    } else {
        Error::Other(format!("ExifTool failed: {detail}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_that_would_change_meaning_in_an_argument_file_are_refused() {
        let ok = |args: &[&str]| argfile(&args.iter().map(|a| a.to_string()).collect::<Vec<_>>());
        assert_eq!(
            ok(&["-j", "C:\\Kişiler\\fotoğraf 😀.jpg"]).unwrap(),
            "-j\nC:\\Kişiler\\fotoğraf 😀.jpg\n".as_bytes()
        );
        assert_eq!(
            ok(&["-XMP-dc:Title=$HOME @x #y"]).unwrap(),
            b"-XMP-dc:Title=$HOME @x #y\n"
        );
        for bad in [
            "",
            " leading",
            "#comment",
            "-XMP-dc:Title=two\nlines",
            "a\rb",
        ] {
            assert!(ok(&[bad]).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn blames_the_file_only_when_exiftool_does() {
        assert!(matches!(
            failure("Error: Not a valid JPG (looks more like a PNG) - x.jpg\n"),
            Error::Unreadable(_)
        ));
        assert!(matches!(
            failure("Warning: [minor] Something\nError: Can't create output\n"),
            Error::Other(message) if message.contains("Can't create output")
        ));
        assert!(matches!(failure(""), Error::Other(_)));
    }
}
