// SPDX-License-Identifier: MIT
//! Two kinds of check. Stand-ins (a small cmd or sh script in yt-dlp's place, printing what
//! yt-dlp prints through Kento's templates) run everywhere and test the run around yt-dlp:
//! progress, names, moves, the live and playlist guard, errors and cancelling.
//!
//! The real checks run yt-dlp, Deno and FFmpeg from `KENTO_YTDLP`, `KENTO_DENO`,
//! `KENTO_FFMPEG`/`KENTO_FFPROBE` or the PATH against a small HTTP server inside the test on
//! 127.0.0.1, serving fixtures FFmpeg makes at run time; nothing reaches the internet. Without
//! the tools they are skipped with a note, unless `KENTO_REQUIRE_YTDLP=1`.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::*;
use crate::{Codec, Error, Options, Progress, Tools, WebProblem};

/// A stand-in for yt-dlp: a cmd script on Windows, sh elsewhere.
fn stand_in(dir: &Path, windows: &str, unix: &str) -> PathBuf {
    if cfg!(windows) {
        let path = dir.join("yt-dlp.cmd");
        fs::write(
            &path,
            format!("@echo off\r\n{}\r\n", windows.replace('\n', "\r\n")),
        )
        .unwrap();
        path
    } else {
        let path = dir.join("yt-dlp");
        fs::write(&path, format!("#!/bin/sh\n{unix}\n")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }
}

/// Lines a stand-in prints on standard output: `echo` lines for cmd, a quoted here-document for
/// sh (so the tabs and backslashes stay as they are).
fn printed(lines: &[&str]) -> (String, String) {
    let windows = lines
        .iter()
        .map(|line| format!("echo {line}"))
        .collect::<Vec<_>>()
        .join("\n");
    let unix = format!("cat <<'EOF'\n{}\nEOF", lines.join("\n"));
    (windows, unix)
}

/// A job's folders the way the app makes them, with Turkish letters (and an emoji in the
/// destination, which yt-dlp never sees).
struct Bench {
    _dir: tempfile::TempDir,
    root: PathBuf,
    dest: PathBuf,
    temp: PathBuf,
}

impl Bench {
    fn new() -> Bench {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let dest = root.join("İndirilenler ğüşıöç 🎬");
        let temp = root.join("iş ğüşıöç");
        fs::create_dir_all(&dest).unwrap();
        fs::create_dir_all(&temp).unwrap();
        Bench {
            _dir: dir,
            root,
            dest,
            temp,
        }
    }

    fn options(&self, ytdlp: PathBuf) -> Options {
        Options {
            tools: Tools {
                ytdlp: Some(ytdlp),
                deno: Some(self.root.join("deno-kento-test")),
                ffmpeg: Some(self.root.join("ffmpeg-kento-test")),
                ..Tools::default()
            },
            ..Options::default()
        }
    }

    fn dest_files(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.dest)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}

/// Reports kept for checking, and a cancel that can be pulled.
#[derive(Default)]
struct Watch {
    reports: Mutex<Vec<f32>>,
    cancel: AtomicBool,
}

impl Watch {
    fn reports(&self) -> Vec<f32> {
        self.reports.lock().unwrap().clone()
    }
}

#[test]
fn stand_in_download_names_the_file_from_the_title() {
    let bench = Bench::new();
    let (windows, unix) = printed(&[
        "kento-item\tNA\t\"\\u00c7a\\u011fr\\u0131: test / video?\"\tNA\tfalse\t\"not_live\"\tNA",
        "kento-progress\tdownloading\t0\t1000\tNA\tNA\tNA\tNA\tNA\t137",
        "kento-progress\tdownloading\t500\t1000\tNA\tNA\tNA\tNA\tNA\t137",
        "kento-progress\tfinished\t1000\t1000\tNA\tNA\tNA\tNA\tNA\t137",
        "kento-progress\tdownloading\t50\t100\tNA\tNA\tNA\tNA\tNA\t140",
        "kento-progress\tfinished\t100\t100\tNA\tNA\tNA\tNA\tNA\t140",
        "kento-post\tstarted\tMerger",
        "kento-post\tfinished\tMerger",
    ]);
    let program = stand_in(
        &bench.root,
        &format!("{windows}\necho fake video> \"out\\item NA.mp4\""),
        &format!("{unix}\nprintf 'fake video' > 'out/item NA.mp4'"),
    );
    let options = bench.options(program);
    let watch = Watch::default();
    let report = |at: Option<f32>| watch.reports.lock().unwrap().extend(at);
    let cancelled = || false;
    let progress = Progress::new(&report, &cancelled);
    let choice = WebChoice::Video {
        max_height: Some(1080),
    };
    let written = download(&WebRun {
        url: "https://www.youtube.com/watch?v=abc",
        choice: &choice,
        dest: &bench.dest,
        temp: &bench.temp,
        options: &options,
        progress: &progress,
    })
    .unwrap();
    assert_eq!(written, [bench.dest.join("Çağrı - test - video.mp4")]);
    assert!(fs::read(&written[0]).unwrap().starts_with(b"fake video"));
    let reports = watch.reports();
    assert!(reports.len() >= 6, "{reports:?}");
    assert!(
        reports.windows(2).all(|pair| pair[0] <= pair[1]),
        "{reports:?}"
    );
    assert_eq!(reports.last(), Some(&1.0));
    // Nothing of yt-dlp's is left in the destination.
    assert_eq!(bench.dest_files(), ["Çağrı - test - video.mp4"]);
}

#[test]
fn stand_in_post_pictures_are_numbered_in_order() {
    let bench = Bench::new();
    let (windows, unix) = printed(&[
        "kento-item\t1\t\"Post by kento.test\"\t\"Post by kento.test\"\tNA\tNA\t\"C1abc\"",
        "kento-item\t3\t\"Post by kento.test\"\t\"Post by kento.test\"\tNA\tNA\t\"C1abc\"",
    ]);
    let program = stand_in(
        &bench.root,
        &format!(
            "{windows}\necho third> \"out\\item 3.jpg\"\necho first> \"out\\item 1.jpg\"\n\
             echo stray> \"parts\\item 2.jpg.part\""
        ),
        &format!(
            "{unix}\necho third > 'out/item 3.jpg'\necho first > 'out/item 1.jpg'\n\
             echo stray > 'parts/item 2.jpg.part'"
        ),
    );
    let options = bench.options(program);
    let choice = WebChoice::Images {
        indexes: vec![2, 0],
    };
    let written = download(&WebRun {
        url: "https://www.instagram.com/p/C1abc/",
        choice: &choice,
        dest: &bench.dest,
        temp: &bench.temp,
        options: &options,
        progress: &Progress::none(),
    })
    .unwrap();
    assert_eq!(
        written,
        [
            bench.dest.join("Post by kento.test 1.jpg"),
            bench.dest.join("Post by kento.test 2.jpg")
        ]
    );
    assert!(fs::read_to_string(&written[0])
        .unwrap()
        .starts_with("first"));
    assert!(fs::read_to_string(&written[1])
        .unwrap()
        .starts_with("third"));

    // The same lines from a link that is not one post mean a playlist: refused before a file.
    let bench = Bench::new();
    let program = stand_in(
        &bench.root,
        &format!("{windows}\necho first> \"out\\item 1.jpg\""),
        &format!("{unix}\necho first > 'out/item 1.jpg'"),
    );
    let options = bench.options(program);
    let result = download(&WebRun {
        url: "https://www.youtube.com/playlist?list=PL1",
        choice: &WebChoice::Audio,
        dest: &bench.dest,
        temp: &bench.temp,
        options: &options,
        progress: &Progress::none(),
    });
    assert!(
        matches!(result, Err(Error::Web(WebProblem::Collection))),
        "{result:?}"
    );
    assert!(bench.dest_files().is_empty());
}

#[test]
fn stand_in_only_the_converted_result_is_kept() {
    let bench = Bench::new();
    let (windows, unix) = printed(&["kento-item\tNA\t\"Thumb\"\tNA\tfalse\t\"not_live\"\tNA"]);
    let program = stand_in(
        &bench.root,
        &format!("{windows}\necho webp> \"out\\item NA.webp\"\necho jpg> \"out\\item NA.jpg\""),
        &format!("{unix}\necho webp > 'out/item NA.webp'\necho jpg > 'out/item NA.jpg'"),
    );
    let options = bench.options(program);
    let written = download(&WebRun {
        url: "https://www.youtube.com/watch?v=abc",
        choice: &WebChoice::Thumbnail,
        dest: &bench.dest,
        temp: &bench.temp,
        options: &options,
        progress: &Progress::none(),
    })
    .unwrap();
    assert_eq!(written, [bench.dest.join("Thumb.jpg")]);
    assert_eq!(bench.dest_files(), ["Thumb.jpg"]);
}

#[test]
fn stand_in_live_streams_are_stopped_before_they_record() {
    let bench = Bench::new();
    let (windows, unix) = printed(&["kento-item\tNA\t\"Live now\"\tNA\ttrue\t\"is_live\"\tNA"]);
    let program = stand_in(
        &bench.root,
        &format!("{windows}\nping -n 30 127.0.0.1 >nul\necho late> \"out\\item NA.mp4\""),
        &format!("{unix}\nsleep 30\necho late > 'out/item NA.mp4'"),
    );
    let options = bench.options(program);
    let started = Instant::now();
    let result = download(&WebRun {
        url: "https://www.youtube.com/watch?v=live",
        choice: &WebChoice::Video { max_height: None },
        dest: &bench.dest,
        temp: &bench.temp,
        options: &options,
        progress: &Progress::none(),
    });
    assert!(
        matches!(result, Err(Error::Web(WebProblem::Live))),
        "{result:?}"
    );
    assert!(started.elapsed() < Duration::from_secs(20));
    assert!(bench.dest_files().is_empty());
}

#[test]
fn stand_in_errors_become_plain_reasons() {
    let bench = Bench::new();
    let line = "ERROR: [youtube] abc: Private video. Sign in if you've been granted access to \
                this video";
    let program = stand_in(
        &bench.root,
        &format!("echo {line} 1>&2\nexit /b 1"),
        &format!("echo \"{line}\" >&2\nexit 1"),
    );
    let options = bench.options(program);
    let result = download(&WebRun {
        url: "https://www.youtube.com/watch?v=abc",
        choice: &WebChoice::Audio,
        dest: &bench.dest,
        temp: &bench.temp,
        options: &options,
        progress: &Progress::none(),
    });
    assert!(
        matches!(result, Err(Error::Web(WebProblem::Unavailable))),
        "{result:?}"
    );
    let result = probe(
        &options.tools,
        "https://www.youtube.com/watch?v=abc",
        &bench.temp,
        &Progress::none(),
    );
    assert!(
        matches!(result, Err(Error::Web(WebProblem::Unavailable))),
        "{result:?}"
    );

    // A run that ends well without a file found nothing to take.
    let bench = Bench::new();
    let program = stand_in(&bench.root, "echo nothing here", "echo nothing here");
    let options = bench.options(program);
    let result = download(&WebRun {
        url: "https://example.org/page",
        choice: &WebChoice::Original,
        dest: &bench.dest,
        temp: &bench.temp,
        options: &options,
        progress: &Progress::none(),
    });
    assert!(
        matches!(result, Err(Error::Web(WebProblem::NoMedia))),
        "{result:?}"
    );
}

#[test]
fn stand_in_cancelling_ends_the_run_and_leaves_nothing() {
    let bench = Bench::new();
    let (windows, unix) = printed(&[
        "kento-item\tNA\t\"Slow\"\tNA\tfalse\t\"not_live\"\tNA",
        "kento-progress\tdownloading\t10\t1000\tNA\tNA\tNA\tNA\tNA\t18",
    ]);
    let program = stand_in(
        &bench.root,
        &format!(
            "{windows}\necho partial> \"parts\\item NA.mp4.part\"\nping -n 60 127.0.0.1 >nul\n\
             echo done> \"out\\item NA.mp4\""
        ),
        &format!(
            "{unix}\necho partial > 'parts/item NA.mp4.part'\nsleep 60 &\necho $! > child.pid\n\
             wait\necho done > 'out/item NA.mp4'"
        ),
    );
    let options = bench.options(program);
    let watch = Watch::default();
    let report = |at: Option<f32>| {
        watch.reports.lock().unwrap().extend(at);
        watch.cancel.store(true, Ordering::SeqCst);
    };
    let cancelled = || watch.cancel.load(Ordering::SeqCst);
    let progress = Progress::new(&report, &cancelled);
    let started = Instant::now();
    let result = download(&WebRun {
        url: "https://example.org/slow.mp4",
        choice: &WebChoice::Original,
        dest: &bench.dest,
        temp: &bench.temp,
        options: &options,
        progress: &progress,
    });
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(30));
    assert!(bench.dest_files().is_empty());
    // The script and what it started are gone: the scratch folder can be deleted.
    let deadline = Instant::now() + Duration::from_secs(10);
    while fs::remove_dir_all(&bench.temp).is_err() {
        assert!(Instant::now() < deadline, "the stand-in still runs");
        thread::sleep(Duration::from_millis(100));
    }
}

#[test]
fn stand_in_probe_reads_the_json() {
    let bench = Bench::new();
    let json = r#"{"_type": "video", "id": "abc", "title": "Çağrı clip", "extractor_key": "Youtube", "duration": 61.5, "thumbnail": "https://i.ytimg.com/vi/abc/hq.jpg", "formats": [{"format_id": "137", "ext": "mp4", "vcodec": "avc1", "acodec": "none", "width": 1920, "height": 1080}, {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2"}]}"#;
    let program = stand_in(
        &bench.root,
        &format!("echo WARNING: a notice 1>&2\necho {json}"),
        &format!("echo 'WARNING: a notice' >&2\ncat <<'EOF'\n{json}\nEOF"),
    );
    let options = bench.options(program);
    let info = probe(
        &options.tools,
        " https://youtu.be/abc ",
        &bench.temp,
        &Progress::none(),
    )
    .unwrap();
    assert_eq!(
        info,
        WebInfo {
            url: "https://youtu.be/abc".into(),
            site: Site::YouTube,
            kind: WebKind::Video,
            title: "Çağrı clip".into(),
            duration: Some(61.5),
            heights: vec![1080],
            thumbnail: true,
            images: Vec::new(),
        }
    );
}

#[test]
fn stand_in_a_missing_program_is_a_missing_tool() {
    let bench = Bench::new();
    let options = bench.options(bench.root.join("no-such-yt-dlp-kento-test.exe"));
    let result = probe(
        &options.tools,
        "https://example.org/a",
        &bench.temp,
        &Progress::none(),
    );
    assert!(
        matches!(result, Err(Error::MissingCodec(Codec::YtDlp))),
        "{result:?}"
    );
}

// ---------------------------------------------------------------------------------------------
// Real yt-dlp against a local server.

/// yt-dlp, Deno, FFmpeg and ffprobe from their variables or the PATH.
fn real_tools() -> Option<Tools> {
    let find = |var: &str, name: &str| {
        env::var_os(var)
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .or_else(|| {
                let names: Vec<String> = if cfg!(windows) {
                    vec![format!("{name}.exe")]
                } else if name == "yt-dlp" {
                    vec![name.to_owned(), "yt-dlp_macos".to_owned()]
                } else {
                    vec![name.to_owned()]
                };
                env::split_paths(&env::var_os("PATH")?).find_map(|dir| {
                    names
                        .iter()
                        .map(|name| dir.join(name))
                        .find(|path| path.is_file())
                })
            })
    };
    let tools = Tools {
        ytdlp: find("KENTO_YTDLP", "yt-dlp"),
        deno: find("KENTO_DENO", "deno"),
        ffmpeg: find("KENTO_FFMPEG", "ffmpeg"),
        ffprobe: find("KENTO_FFPROBE", "ffprobe"),
        ..Tools::default()
    };
    let missing: Vec<&str> = [
        ("yt-dlp", tools.ytdlp.is_none()),
        ("Deno", tools.deno.is_none()),
        ("FFmpeg", tools.ffmpeg.is_none()),
        ("ffprobe", tools.ffprobe.is_none()),
    ]
    .into_iter()
    .filter_map(|(name, gone)| gone.then_some(name))
    .collect();
    if missing.is_empty() {
        return Some(tools);
    }
    let required = env::var("KENTO_REQUIRE_YTDLP").is_ok_and(|v| v == "1");
    assert!(
        !required,
        "KENTO_REQUIRE_YTDLP=1 but {} missing",
        missing.join(", ")
    );
    eprintln!(
        "skipped the real web download checks: no {} (set KENTO_YTDLP, KENTO_DENO, \
         KENTO_FFMPEG and KENTO_FFPROBE or put them on the PATH)",
        missing.join(", ")
    );
    None
}

#[derive(Clone)]
struct Route {
    body: Arc<Vec<u8>>,
    kind: &'static str,
    /// Sent a kilobyte at a time, slowly, for the cancel check.
    slow: bool,
}

/// A small HTTP/1.1 server on 127.0.0.1 with byte ranges, for yt-dlp and ffprobe; every other
/// path is a 404. Returns the base address.
fn serve(routes: HashMap<&'static str, Route>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let routes = Arc::new(routes);
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let routes = routes.clone();
            thread::spawn(move || answer(stream, &routes));
        }
    });
    base
}

fn answer(mut stream: TcpStream, routes: &HashMap<&'static str, Route>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut request = Vec::new();
    let mut buffer = [0u8; 4096];
    while !request.windows(4).any(|w| w == b"\r\n\r\n") && request.len() < 64 * 1024 {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(n) => request.extend_from_slice(&buffer[..n]),
        }
    }
    let request = String::from_utf8_lossy(&request).into_owned();
    let mut lines = request.lines();
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let method = first.next().unwrap_or("GET").to_owned();
    let target = first.next().unwrap_or("/");
    let path = target.split(['?', '#']).next().unwrap_or("/");
    let range = lines.find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("range")
            .then(|| value.trim().to_owned())
    });
    let Some(route) = routes.get(path) else {
        let body = b"<html><body>Not here</body></html>";
        let head = format!(
            "HTTP/1.1 404 Not Found\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\
             Connection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(head.as_bytes());
        if method != "HEAD" {
            let _ = stream.write_all(body);
        }
        return;
    };
    let size = route.body.len();
    let span = range.as_deref().and_then(|range| {
        let (from, to) = range.strip_prefix("bytes=")?.split_once('-')?;
        let from: usize = from.trim().parse().ok()?;
        let to: usize = match to.trim() {
            "" => size.checked_sub(1)?,
            to => to.parse::<usize>().ok()?.min(size.checked_sub(1)?),
        };
        (from <= to).then_some((from, to))
    });
    let (status, from, to) = match span {
        Some((from, to)) => ("206 Partial Content", from, to + 1),
        None => ("200 OK", 0, size),
    };
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\n\
         Connection: close\r\n",
        route.kind,
        to - from
    );
    if span.is_some() {
        head.push_str(&format!(
            "Content-Range: bytes {from}-{}/{size}\r\n",
            to - 1
        ));
    }
    head.push_str("\r\n");
    if stream.write_all(head.as_bytes()).is_err() || method == "HEAD" {
        return;
    }
    let body = &route.body[from..to];
    if route.slow {
        for chunk in body.chunks(1024) {
            if stream.write_all(chunk).is_err() {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
    } else {
        let _ = stream.write_all(body);
    }
}

/// The fixtures: an MP4 with picture and sound, an MP3, and a page with a `<video>`.
struct Fixtures {
    _dir: tempfile::TempDir,
    clip: Vec<u8>,
    song: Vec<u8>,
    base: String,
}

impl Fixtures {
    fn new(tools: &Tools) -> Fixtures {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = tools.ffmpeg.as_ref().unwrap();
        let make = |args: &[&str], name: &str| {
            let out = dir.path().join(name);
            let status = Command::new(ffmpeg)
                .args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error"])
                .args(args)
                .arg(&out)
                .status()
                .unwrap();
            assert!(status.success(), "making {name}");
            fs::read(out).unwrap()
        };
        let clip = make(
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=640x360:r=25:d=2",
                "-f",
                "lavfi",
                "-i",
                "sine=f=440:r=48000:d=2",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "30",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ac",
                "2",
                "-shortest",
                "-movflags",
                "+faststart",
            ],
            "clip.mp4",
        );
        let song = make(
            &[
                "-f",
                "lavfi",
                "-i",
                "sine=f=330:r=44100:d=2",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "128k",
            ],
            "song.mp3",
        );
        let page = b"<!doctype html><html><head><meta charset=\"utf-8\">\
            <title>Kento test page</title>\
            <meta property=\"og:title\" content=\"Kento test page\"></head>\
            <body><video src=\"/clip.mp4\" controls></video></body></html>"
            .to_vec();
        let route = |body: &Vec<u8>, kind, slow| Route {
            body: Arc::new(body.clone()),
            kind,
            slow,
        };
        let routes = HashMap::from([
            ("/clip.mp4", route(&clip, "video/mp4", false)),
            ("/slow.mp4", route(&clip, "video/mp4", true)),
            ("/song.mp3", route(&song, "audio/mpeg", false)),
            (
                "/page.html",
                route(&page, "text/html; charset=utf-8", false),
            ),
        ]);
        let base = serve(routes);
        Fixtures {
            _dir: dir,
            clip,
            song,
            base,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }
}

/// Real tools, fixtures and a job folder, or None (with a note) without the tools.
fn real() -> Option<(Tools, Fixtures, Bench)> {
    let tools = real_tools()?;
    let fixtures = Fixtures::new(&tools);
    Some((tools, fixtures, Bench::new()))
}

/// A new destination folder with Turkish letters and an emoji in its name.
fn folder(bench: &Bench, name: &str) -> PathBuf {
    let path = bench.root.join(format!("Kento ğüşıöç İ 🎬 {name}"));
    fs::create_dir_all(&path).unwrap();
    path
}

fn fetch(tools: &Tools, bench: &Bench, url: &str, choice: WebChoice, dest: &Path) -> Vec<PathBuf> {
    let options = Options {
        tools: tools.clone(),
        ..Options::default()
    };
    // Every run makes a new folder of its own inside the job's scratch folder.
    let temp = &bench.temp;
    let reports = Mutex::new(Vec::new());
    let report = |at: Option<f32>| reports.lock().unwrap().extend(at);
    let cancelled = || false;
    let progress = Progress::new(&report, &cancelled);
    let written = download(&WebRun {
        url,
        choice: &choice,
        dest,
        temp,
        options: &options,
        progress: &progress,
    })
    .unwrap_or_else(|error| panic!("{choice:?} from {url}: {error}"));
    let reports = reports.into_inner().unwrap();
    assert!(
        reports.windows(2).all(|pair| pair[0] <= pair[1]),
        "{reports:?}"
    );
    assert_eq!(reports.last(), Some(&1.0));
    for file in &written {
        assert!(file.starts_with(dest), "{}", file.display());
    }
    let names: Vec<String> = fs::read_dir(dest)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names.len(), written.len(), "only finished files: {names:?}");
    written
}

#[test]
fn real_probe_tells_video_from_audio() {
    let Some((tools, fixtures, bench)) = real() else {
        return;
    };
    let progress = Progress::none();
    let clip = probe(&tools, &fixtures.url("/clip.mp4"), &bench.temp, &progress)
        .unwrap_or_else(|error| panic!("probing the clip: {error}"));
    assert_eq!(clip.site, Site::Other);
    assert_eq!(clip.kind, WebKind::Video);
    assert_eq!(clip.heights, [360]);
    assert!(!clip.thumbnail);
    assert!(clip.images.is_empty());

    let page = probe(&tools, &fixtures.url("/page.html"), &bench.temp, &progress)
        .unwrap_or_else(|error| panic!("probing the page: {error}"));
    assert_eq!(page.site, Site::Other);
    assert_eq!(page.kind, WebKind::Video);
    assert_eq!(page.heights, [360]);
    assert!(!page.title.is_empty());

    let song = probe(&tools, &fixtures.url("/song.mp3"), &bench.temp, &progress)
        .unwrap_or_else(|error| panic!("probing the song: {error}"));
    assert_eq!(song.kind, WebKind::Audio);
    assert!(song.heights.is_empty());
}

#[test]
fn real_downloads_video_audio_and_the_original() {
    let Some((tools, fixtures, bench)) = real() else {
        return;
    };

    let dest = folder(&bench, "video");
    let video = fetch(
        &tools,
        &bench,
        &fixtures.url("/page.html"),
        WebChoice::Video {
            max_height: Some(720),
        },
        &dest,
    );
    assert_eq!(video.len(), 1);
    assert_eq!(video[0].extension().unwrap(), "mp4");
    let info = crate::media::probe(&tools, &video[0]).unwrap();
    assert_eq!(info.video.as_ref().map(|v| v.height), Some(360));
    assert!(info.audio.is_some(), "the video keeps its sound");

    let dest = folder(&bench, "audio");
    let audio = fetch(
        &tools,
        &bench,
        &fixtures.url("/clip.mp4"),
        WebChoice::Audio,
        &dest,
    );
    assert_eq!(audio.len(), 1);
    assert_eq!(audio[0].extension().unwrap(), "mp3");
    let info = crate::media::probe(&tools, &audio[0]).unwrap();
    assert!(info.video.is_none());
    assert_eq!(info.audio.map(|a| a.codec), Some("mp3".to_owned()));

    let dest = folder(&bench, "original mp3");
    let song = fetch(
        &tools,
        &bench,
        &fixtures.url("/song.mp3"),
        WebChoice::Original,
        &dest,
    );
    assert_eq!(song.len(), 1);
    assert_eq!(fs::read(&song[0]).unwrap(), fixtures.song, "unconverted");
    assert!(crate::media::probe(&tools, &song[0]).is_ok());

    let dest = folder(&bench, "original mp4");
    let clip = fetch(
        &tools,
        &bench,
        &fixtures.url("/clip.mp4"),
        WebChoice::Original,
        &dest,
    );
    assert_eq!(clip.len(), 1);
    assert_eq!(fs::read(&clip[0]).unwrap(), fixtures.clip, "unconverted");
}

#[test]
fn real_cancel_mid_download_leaves_nothing() {
    let Some((tools, fixtures, bench)) = real() else {
        return;
    };
    let dest = folder(&bench, "cancel");
    let options = Options {
        tools: tools.clone(),
        ..Options::default()
    };
    let started = Instant::now();
    let pulled = AtomicBool::new(false);
    let report = |at: Option<f32>| {
        if at.is_some_and(|at| at > 0.0) {
            pulled.store(true, Ordering::SeqCst);
        }
    };
    // Pulled once the download has moved, or after a while if no progress came.
    let cancelled = || pulled.load(Ordering::SeqCst) || started.elapsed() > Duration::from_secs(20);
    let progress = Progress::new(&report, &cancelled);
    let result = download(&WebRun {
        url: &fixtures.url("/slow.mp4"),
        choice: &WebChoice::Video { max_height: None },
        dest: &dest,
        temp: &bench.temp,
        options: &options,
        progress: &progress,
    });
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(60));
    assert!(fs::read_dir(&dest).unwrap().next().is_none());
}

#[test]
fn real_a_missing_page_is_unavailable() {
    let Some((tools, fixtures, bench)) = real() else {
        return;
    };
    let result = probe(
        &tools,
        &fixtures.url("/missing.mp4"),
        &bench.temp,
        &Progress::none(),
    );
    assert!(
        matches!(
            result,
            Err(Error::Web(WebProblem::Unavailable | WebProblem::NoMedia))
        ),
        "{result:?}"
    );
    let dest = folder(&bench, "missing");
    let options = Options {
        tools,
        ..Options::default()
    };
    let result = download(&WebRun {
        url: &fixtures.url("/missing.mp4"),
        choice: &WebChoice::Original,
        dest: &dest,
        temp: &bench.temp,
        options: &options,
        progress: &Progress::none(),
    });
    assert!(
        matches!(
            result,
            Err(Error::Web(WebProblem::Unavailable | WebProblem::NoMedia))
        ),
        "{result:?}"
    );
    assert!(fs::read_dir(&dest).unwrap().next().is_none());
}
