// SPDX-License-Identifier: MIT
//! yt-dlp's command line, from its README ("Usage and options"). Every run starts with the same
//! flags that keep it private and predictable; a probe or a choice adds what it needs; the link
//! always comes last, after `--`, so it can never be read as an option.

use std::ffi::{OsStr, OsString};
use std::path::Path;

use super::info::limit;
use super::run::Dirs;
use super::{AudioFormat, WebChoice};

/// The flags every run starts with.
const PRIVATE: [&str; 9] = [
    // No configuration file and no plugin, so a yt-dlp set up on this computer for something
    // else never changes what Kento does.
    "--ignore-config",
    "--no-plugin-dirs",
    // Updates are Kento's job (SPEC 4.2).
    "--no-update",
    // Nothing is read from a browser or a cookie file, and nothing is kept between runs.
    "--no-cookies",
    "--no-cookies-from-browser",
    "--no-cache-dir",
    // One video or post: never the playlist a video's link may also name.
    "--no-playlist",
    // A downloaded file is a new file; the site's date is not its date.
    "--no-mtime",
    // Code to run never comes from the network (the official builds carry YouTube's scripts).
    "--no-remote-components",
];

/// What yt-dlp prints for Kento while it downloads, fields separated by tabs (a JSON string
/// never holds a raw tab):
/// each video before it starts, with what the guard and the file names need;
const ITEM: &str = "video:kento-item\t%(playlist_index)s\t%(title)j\t%(playlist_title)j\
                    \t%(is_live)j\t%(live_status)j\t%(playlist_id)j";
/// its download, part by part (video and audio arrive as separate parts before a merge);
const STEP: &str = "download:kento-progress\t%(progress.status)s\
                    \t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\
                    \t%(progress.total_bytes_estimate)s\t%(progress.fragment_index)s\
                    \t%(progress.fragment_count)s\t%(info.playlist_autonumber)s\
                    \t%(info.n_entries)s\t%(info.format_id)s";
/// and the steps after it (merging, converting, moving).
const POST: &str = "postprocess:kento-post\t%(progress.status)s\t%(progress.postprocessor)s";

/// The names yt-dlp gives the files in the scratch folder: plain ASCII with the item's place
/// in a post, so Kento can number them; the real names come from the title afterwards.
const NAME: &str = "item %(playlist_index)s.%(ext)s";

/// The flags every run starts with, Deno as the only JavaScript runtime and Kento's FFmpeg.
pub(super) fn common(deno: &Path, ffmpeg: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = PRIVATE.iter().map(OsString::from).collect();
    args.push("--no-js-runtimes".into());
    args.push("--js-runtimes".into());
    args.push(tagged("deno:", deno));
    args.push("--ffmpeg-location".into());
    args.push(plain(ffmpeg));
    // Printed text is UTF-8 whatever the console's code page.
    args.extend(["--encoding", "utf-8"].map(OsString::from));
    // A connection that stops answering fails instead of waiting for ever.
    args.extend(["--socket-timeout", "30"].map(OsString::from));
    args
}

/// What the link holds, as one JSON document, without downloading.
pub(super) fn probe(deno: &Path, ffmpeg: &Path, url: &str) -> Vec<OsString> {
    let mut args = common(deno, ffmpeg);
    args.extend(
        [
            "--dump-single-json",
            // A channel or profile is refused from its first page of links instead of after
            // reading every video; a post's pictures are full entries either way. 50 is more
            // than an Instagram post holds.
            "--flat-playlist",
            "--playlist-items",
            "1:50",
            // A photo of a post has no video formats; its picture is its thumbnail.
            "--ignore-no-formats-error",
        ]
        .map(OsString::from),
    );
    link(&mut args, url);
    args
}

/// One download into the scratch folder: finished files in `dirs.out`, partial ones in
/// `dirs.parts`.
pub(super) fn download(
    deno: &Path,
    ffmpeg: &Path,
    dirs: &Dirs,
    choice: &WebChoice,
    url: &str,
) -> Vec<OsString> {
    let mut args = common(deno, ffmpeg);
    args.extend(
        [
            // `--print` is quiet and would only simulate; the progress lines stay on.
            "--no-simulate",
            "--quiet",
            "--progress",
            "--newline",
            "--progress-delta",
            "0.5",
            "--print",
            ITEM,
            "--progress-template",
            STEP,
            "--progress-template",
            POST,
        ]
        .map(OsString::from),
    );
    args.push("--paths".into());
    args.push(tagged("home:", &dirs.out));
    args.push("--paths".into());
    args.push(tagged("temp:", &dirs.parts));
    let thumbnail = format!("thumbnail:{NAME}");
    args.extend(
        [
            "--output",
            NAME,
            "--output",
            &thumbnail,
            // A post's own cover is not one of its pictures.
            "--output",
            "pl_thumbnail:",
        ]
        .map(OsString::from),
    );
    args.extend(chosen(choice).into_iter().map(OsString::from));
    link(&mut args, url);
    args
}

/// The flags of one choice.
fn chosen(choice: &WebChoice) -> Vec<String> {
    let list =
        |items: &[&str]| -> Vec<String> { items.iter().map(|item| (*item).to_owned()).collect() };
    match choice {
        // The best video no taller than asked with the best sound, merged by FFmpeg into MP4.
        // The quality comes first; at the same quality H.264 and AAC win, which play everywhere
        // in MP4. A site's single file in another container is remuxed, never re-encoded.
        WebChoice::Video { max_height } => {
            let mut args = list(&["--format", "bv*+ba/b/bv", "--format-sort"]);
            args.push(sort(*max_height));
            args.extend(list(&[
                "--merge-output-format",
                "mp4",
                "--remux-video",
                "mp4",
            ]));
            args
        }
        // The best sound (or the sound of the best file), converted by FFmpeg to MP3 at
        // VBR quality 2 (about 190 kbit/s), well above what sites serve.
        WebChoice::Audio
        | WebChoice::AudioAs {
            format: AudioFormat::Mp3,
        } => list(&[
            "--format",
            "ba/b",
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "2",
        ]),
        // AAC in M4A: the site's own AAC sound comes first and is only moved into M4A; any other
        // sound is converted at 192 kbit/s.
        WebChoice::AudioAs {
            format: AudioFormat::M4a,
        } => list(&[
            "--format",
            "ba[acodec^=mp4a]/ba/b",
            "--extract-audio",
            "--audio-format",
            "m4a",
            "--audio-quality",
            "192K",
        ]),
        // The best sound as the site serves it, taken out of its file without converting it
        // ("--audio-format best", yt-dlp's default, only moves the stream).
        WebChoice::AudioAs {
            format: AudioFormat::Original,
        } => list(&["--format", "ba/b", "--extract-audio"]),
        // The best thumbnail alone, as JPG; the video's formats do not matter for it.
        WebChoice::Thumbnail => list(&[
            "--skip-download",
            "--write-thumbnail",
            "--convert-thumbnails",
            "jpg",
            "--ignore-no-formats-error",
        ]),
        // The chosen pictures of a post (yt-dlp counts from 1), each as the site serves it.
        WebChoice::Images { indexes } => {
            let mut args = list(&[
                "--skip-download",
                "--write-thumbnail",
                "--ignore-no-formats-error",
                "--playlist-items",
            ]);
            args.push(items(indexes));
            args
        }
        // The site's own file when it has one with picture and sound; otherwise its best
        // streams put together unchanged, or the one stream there is.
        WebChoice::Original => list(&["--format", "bv*+ba/b/ba/bv"]),
    }
}

/// `--format-sort`: the language the site marks as original, then the quality (yt-dlp's `res`
/// is the shorter side of the frame, as Kento's heights are), then H.264 and AAC.
fn sort(max_height: Option<u32>) -> String {
    let res = match max_height {
        Some(height) => format!("res:{}", limit(height)),
        None => "res".to_owned(),
    };
    format!("lang,{res},vcodec:h264,acodec:aac")
}

/// `1,3,4` for the 0-based places 0, 2 and 3, in order, each once.
fn items(indexes: &[usize]) -> String {
    let mut sorted = indexes.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    sorted
        .iter()
        .map(|index| (index + 1).to_string())
        .collect::<Vec<_>>()
        .join(",")
}

fn link(args: &mut Vec<OsString>, url: &str) {
    args.push("--".into());
    args.push(url.into());
}

/// `prefix` followed by a path, as in `home:C:\…`.
fn tagged(prefix: &str, path: &Path) -> OsString {
    let mut arg = OsString::from(prefix);
    arg.push(plain(path));
    arg
}

/// A path without the Windows `\\?\` prefix, which yt-dlp and its helpers do not expect.
pub(super) fn plain(path: &Path) -> OsString {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}").into();
    }
    match text.strip_prefix(r"\\?\") {
        Some(stripped) => OsStr::new(stripped).to_owned(),
        None => path.as_os_str().to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    const URL: &str = "https://www.youtube.com/watch?v=abc&list=xyz";

    fn paths() -> (PathBuf, PathBuf) {
        if cfg!(windows) {
            (
                PathBuf::from(r"C:\Kullanıcılar\Şule\Kento\tools\deno.exe"),
                PathBuf::from(r"C:\Kullanıcılar\Şule\Kento\tools\ffmpeg.exe"),
            )
        } else {
            (
                PathBuf::from("/Users/şule/Kento/tools/deno"),
                PathBuf::from("/Users/şule/Kento/tools/ffmpeg"),
            )
        }
    }

    fn dirs() -> Dirs {
        let root = PathBuf::from(if cfg!(windows) {
            r"C:\Temp\job 1\yt-dlp-1"
        } else {
            "/tmp/job 1/yt-dlp-1"
        });
        Dirs {
            out: root.join("out"),
            parts: root.join("parts"),
            tmp: root.join("tmp"),
            deno: root.join("deno"),
            root,
        }
    }

    fn texts(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    fn every_run() -> Vec<(String, Vec<String>)> {
        let (deno, ffmpeg) = paths();
        let mut runs = vec![("probe".to_owned(), texts(&probe(&deno, &ffmpeg, URL)))];
        for choice in [
            WebChoice::Video { max_height: None },
            WebChoice::Video {
                max_height: Some(720),
            },
            WebChoice::Audio,
            WebChoice::AudioAs {
                format: AudioFormat::M4a,
            },
            WebChoice::AudioAs {
                format: AudioFormat::Original,
            },
            WebChoice::Thumbnail,
            WebChoice::Images {
                indexes: vec![2, 0],
            },
            WebChoice::Original,
        ] {
            runs.push((
                format!("{choice:?}"),
                texts(&download(&deno, &ffmpeg, &dirs(), &choice, URL)),
            ));
        }
        runs
    }

    fn after<'a>(args: &'a [String], flag: &str) -> Vec<&'a str> {
        args.windows(2)
            .filter(|pair| pair[0] == flag)
            .map(|pair| pair[1].as_str())
            .collect()
    }

    #[test]
    fn privacy_flags_are_always_there_and_cookies_never_are() {
        let (deno, ffmpeg) = paths();
        for (name, args) in every_run() {
            for flag in PRIVATE {
                assert!(args.iter().any(|arg| arg == flag), "{name} lacks {flag}");
            }
            for arg in &args {
                let flag = arg.split('=').next().unwrap();
                assert!(
                    !matches!(
                        flag,
                        "--cookies" | "--cookies-from-browser" | "-U" | "--update"
                    ),
                    "{name} has {arg}"
                );
                assert!(
                    !matches!(flag, "--plugin-dirs" | "--config-locations" | "--exec"),
                    "{name} has {arg}"
                );
            }
            // Deno is the only runtime: the defaults are cleared first.
            let runtimes = args.iter().position(|arg| arg == "--js-runtimes").unwrap();
            let cleared = args
                .iter()
                .position(|arg| arg == "--no-js-runtimes")
                .unwrap();
            assert!(cleared < runtimes, "{name}");
            assert_eq!(
                after(&args, "--js-runtimes"),
                [format!("deno:{}", deno.display())],
                "{name}"
            );
            assert_eq!(
                after(&args, "--ffmpeg-location"),
                [ffmpeg.display().to_string()],
                "{name}"
            );
            // The link comes last, after `--`.
            assert_eq!(args[args.len() - 2], "--", "{name}");
            assert_eq!(args[args.len() - 1], URL, "{name}");
            assert_eq!(args.iter().filter(|arg| *arg == "--").count(), 1, "{name}");
        }
    }

    #[test]
    fn a_probe_reads_without_downloading() {
        let (deno, ffmpeg) = paths();
        let args = texts(&probe(&deno, &ffmpeg, URL));
        assert!(args.contains(&"--dump-single-json".to_owned()));
        assert!(args.contains(&"--flat-playlist".to_owned()));
        assert_eq!(after(&args, "--playlist-items"), ["1:50"]);
        assert!(!args.iter().any(|arg| arg == "--no-simulate"));
        assert!(!args.iter().any(|arg| arg.starts_with("--paths")));
    }

    #[test]
    fn downloads_stay_in_the_scratch_folder_with_plain_names() {
        let (deno, ffmpeg) = paths();
        let dirs = dirs();
        let args = texts(&download(&deno, &ffmpeg, &dirs, &WebChoice::Audio, URL));
        assert_eq!(
            after(&args, "--paths"),
            [
                format!("home:{}", dirs.out.display()),
                format!("temp:{}", dirs.parts.display())
            ]
        );
        assert_eq!(
            after(&args, "--output"),
            [
                "item %(playlist_index)s.%(ext)s",
                "thumbnail:item %(playlist_index)s.%(ext)s",
                "pl_thumbnail:"
            ]
        );
        let print = after(&args, "--print");
        assert_eq!(print.len(), 1);
        assert!(print[0].starts_with("video:kento-item\t"));
        assert_eq!(print[0].matches('\t').count(), 6);
        let templates = after(&args, "--progress-template");
        assert!(templates[0].starts_with("download:kento-progress\t"));
        assert_eq!(templates[0].matches('\t').count(), 9);
        assert!(templates[1].starts_with("postprocess:kento-post\t"));
        for flag in ["--no-simulate", "--newline", "--progress", "--quiet"] {
            assert!(args.iter().any(|arg| arg == flag), "{flag}");
        }
    }

    #[test]
    fn each_choice_asks_for_its_own_result() {
        let (deno, ffmpeg) = paths();
        let run = |choice: WebChoice| texts(&download(&deno, &ffmpeg, &dirs(), &choice, URL));

        let video = run(WebChoice::Video {
            max_height: Some(720),
        });
        assert_eq!(after(&video, "--format"), ["bv*+ba/b/bv"]);
        assert_eq!(
            after(&video, "--format-sort"),
            ["lang,res:899,vcodec:h264,acodec:aac"]
        );
        assert_eq!(after(&video, "--merge-output-format"), ["mp4"]);
        assert_eq!(after(&video, "--remux-video"), ["mp4"]);
        let best = run(WebChoice::Video { max_height: None });
        assert_eq!(
            after(&best, "--format-sort"),
            ["lang,res,vcodec:h264,acodec:aac"]
        );

        let audio = run(WebChoice::Audio);
        assert!(audio.contains(&"--extract-audio".to_owned()));
        assert_eq!(after(&audio, "--audio-format"), ["mp3"]);
        assert_eq!(after(&audio, "--format"), ["ba/b"]);
        let mp3 = run(WebChoice::AudioAs {
            format: AudioFormat::Mp3,
        });
        assert_eq!(mp3, audio);
        let m4a = run(WebChoice::AudioAs {
            format: AudioFormat::M4a,
        });
        assert!(m4a.contains(&"--extract-audio".to_owned()));
        assert_eq!(after(&m4a, "--audio-format"), ["m4a"]);
        assert_eq!(after(&m4a, "--format"), ["ba[acodec^=mp4a]/ba/b"]);
        assert_eq!(after(&m4a, "--audio-quality"), ["192K"]);
        // The sound as served: taken out of its file, never converted.
        let served = run(WebChoice::AudioAs {
            format: AudioFormat::Original,
        });
        assert!(served.contains(&"--extract-audio".to_owned()));
        assert_eq!(after(&served, "--format"), ["ba/b"]);
        assert!(after(&served, "--audio-format").is_empty());
        assert!(after(&served, "--audio-quality").is_empty());

        // Older requests still mean MP3; the others name their format.
        let parse = |json: &str| serde_json::from_str::<WebChoice>(json).unwrap();
        assert_eq!(parse(r#"{"kind":"audio"}"#), WebChoice::Audio);
        assert_eq!(
            parse(r#"{"kind":"audioAs","format":"m4a"}"#),
            WebChoice::AudioAs {
                format: AudioFormat::M4a
            }
        );
        assert_eq!(
            parse(r#"{"kind":"audioAs","format":"original"}"#),
            WebChoice::AudioAs {
                format: AudioFormat::Original
            }
        );

        let thumbnail = run(WebChoice::Thumbnail);
        assert!(thumbnail.contains(&"--skip-download".to_owned()));
        assert!(thumbnail.contains(&"--write-thumbnail".to_owned()));
        assert_eq!(after(&thumbnail, "--convert-thumbnails"), ["jpg"]);

        let images = run(WebChoice::Images {
            indexes: vec![3, 0, 2, 3],
        });
        assert_eq!(after(&images, "--playlist-items"), ["1,3,4"]);
        assert!(images.contains(&"--write-thumbnail".to_owned()));
        assert!(images.contains(&"--skip-download".to_owned()));
        assert!(after(&images, "--convert-thumbnails").is_empty());

        let original = run(WebChoice::Original);
        assert_eq!(after(&original, "--format"), ["bv*+ba/b/ba/bv"]);
        for flag in [
            "--extract-audio",
            "--remux-video",
            "--recode-video",
            "--merge-output-format",
            "--convert-thumbnails",
            "--format-sort",
        ] {
            assert!(!original.iter().any(|arg| arg == flag), "{flag}");
        }
    }

    #[test]
    fn verbatim_paths_lose_their_prefix() {
        assert_eq!(
            plain(Path::new(r"\\?\C:\Temp\x")),
            OsString::from(r"C:\Temp\x")
        );
        assert_eq!(
            plain(Path::new(r"\\?\UNC\srv\share\x")),
            OsString::from(r"\\srv\share\x")
        );
        assert_eq!(plain(Path::new("/tmp/x")), OsString::from("/tmp/x"));
    }
}
