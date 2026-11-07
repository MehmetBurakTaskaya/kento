// SPDX-License-Identifier: MIT
//! The command line as a terminal runs it: the built `kento-cli` program with a data folder of
//! its own, on files with Turkish letters and an emoji in their names (SPEC 5.14).

use std::ffi::OsStr;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Output;

use serde_json::Value;

/// A data folder (settings, recipes, scratch files) and a folder of files, both thrown away.
struct Bench {
    data: tempfile::TempDir,
    root: tempfile::TempDir,
}

impl Bench {
    /// Kento set to `lang`, so its messages do not depend on this computer's language.
    fn new(lang: &str) -> Self {
        let data = tempfile::tempdir().unwrap();
        fs::write(
            data.path().join("settings.json"),
            format!(r#"{{"language":"{lang}"}}"#),
        )
        .unwrap();
        Self {
            data,
            root: tempfile::tempdir().unwrap(),
        }
    }

    /// A folder for the files, named the hard way.
    fn dir(&self) -> PathBuf {
        let dir = self.root.path().join("Klasör ğüşıöç 🧪");
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn kento<I, S>(&self, args: I) -> Output
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        std::process::Command::new(env!("CARGO_BIN_EXE_kento-cli"))
            .args(args)
            .env("KENTO_DATA_DIR", self.data.path())
            .output()
            .unwrap()
    }

    /// Runs with `--json` and reads the document it prints.
    fn json<I, S>(&self, args: I) -> (i32, Value)
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut all: Vec<std::ffi::OsString> =
            args.into_iter().map(|a| a.as_ref().to_owned()).collect();
        all.push("--json".into());
        let output = self.kento(all);
        let stdout = String::from_utf8(output.stdout).unwrap();
        assert!(stdout.is_ascii(), "JSON output is ASCII: {stdout}");
        let value: Value = serde_json::from_str(&stdout)
            .unwrap_or_else(|err| panic!("not JSON ({err}): {stdout}"));
        (output.status.code().unwrap(), value)
    }

    /// The command's scratch folders are gone.
    fn assert_clean(&self) {
        let temp = self.data.path().join("temp");
        let left: Vec<_> = fs::read_dir(&temp)
            .map(|dir| dir.flatten().map(|e| e.file_name()).collect())
            .unwrap_or_default();
        assert!(left.is_empty(), "left in temp: {left:?}");
    }
}

fn code(output: &Output) -> i32 {
    output.status.code().unwrap()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn path(value: &Value) -> PathBuf {
    PathBuf::from(value.as_str().unwrap())
}

/// Nothing half-written next to the results.
fn assert_no_parts(dir: &Path) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        assert!(!name.ends_with(".kento-part"), "{name} was left behind");
    }
}

/// An RGB PNG with a gradient and some noise, written by hand (zlib from flate2), so that JPEG
/// has something to compress.
fn png(path: &Path, width: u32, height: u32) {
    let mut seed = 0x2545_f491u32;
    let mut raw = Vec::new();
    for y in 0..height {
        raw.push(0);
        for x in 0..width {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let noise = (seed & 0x3f) as u8;
            raw.extend_from_slice(&[
                (x * 180 / width) as u8 + noise,
                (y * 180 / height) as u8 + noise / 2,
                90 + noise,
            ]);
        }
    }
    let mut zlib = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    zlib.write_all(&raw).unwrap();
    let mut header = Vec::new();
    header.extend_from_slice(&width.to_be_bytes());
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 2, 0, 0, 0]);
    let mut file = b"\x89PNG\r\n\x1a\n".to_vec();
    for (kind, data) in [
        (b"IHDR", header),
        (b"IDAT", zlib.finish().unwrap()),
        (b"IEND", Vec::new()),
    ] {
        let mut crc = flate2::Crc::new();
        crc.update(kind);
        crc.update(&data);
        file.extend_from_slice(&(data.len() as u32).to_be_bytes());
        file.extend_from_slice(kind);
        file.extend_from_slice(&data);
        file.extend_from_slice(&crc.sum().to_be_bytes());
    }
    fs::write(path, file).unwrap();
}

#[test]
fn converts_a_png_with_turkish_letters_and_an_emoji_to_jpg() {
    let bench = Bench::new("en");
    let dir = bench.dir();
    let source = dir.join("Fotoğraf İı ğüş 🧪.png");
    png(&source, 96, 64);

    let (exit, report) = bench.json([
        OsStr::new("convert"),
        source.as_os_str(),
        "--to".as_ref(),
        "jpg".as_ref(),
    ]);
    assert_eq!(exit, 0, "{report}");
    assert_eq!(report["ok"], true);
    let result = &report["results"][0];
    assert_eq!(path(&result["inputs"][0]), source);
    let jpg = path(&result["outputs"][0]);
    assert_eq!(jpg, dir.join("Fotoğraf İı ğüş 🧪.jpg"));
    assert_eq!(&fs::read(&jpg).unwrap()[..3], &[0xFF, 0xD8, 0xFF]);

    // Never overwrite: the second run takes the next name and prints it.
    let output = bench.kento([
        OsStr::new("convert"),
        source.as_os_str(),
        "--to=jpeg".as_ref(),
    ]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    let printed = String::from_utf8(output.stdout).unwrap();
    assert_eq!(
        PathBuf::from(printed.trim()),
        dir.join("Fotoğraf İı ğüş 🧪 (2).jpg")
    );
    assert_eq!(fs::read(&jpg).unwrap()[..3], [0xFF, 0xD8, 0xFF]);
    assert_no_parts(&dir);
    bench.assert_clean();
}

#[test]
fn compresses_under_a_target_size_into_an_out_folder() {
    let bench = Bench::new("en");
    let dir = bench.dir();
    let source = dir.join("Manzara ğüş 🧪.png");
    png(&source, 320, 240);
    let (exit, report) = bench.json([
        OsStr::new("convert"),
        source.as_os_str(),
        "--to".as_ref(),
        "jpg".as_ref(),
    ]);
    assert_eq!(exit, 0, "{report}");
    let jpg = path(&report["results"][0]["outputs"][0]);
    let original = fs::metadata(&jpg).unwrap().len();
    // Half the size, in the decimal kilobytes the panel uses.
    let target_kb = original / 2 / 1000;
    assert!(
        target_kb >= 2,
        "the test picture is too small: {original} bytes"
    );
    let out = bench.root.path().join("Çıktı 🧪");

    let (exit, report) = bench.json([
        OsStr::new("tool"),
        "compress".as_ref(),
        jpg.as_os_str(),
        "--target-size".as_ref(),
        format!("{target_kb}KB").as_ref(),
        "--out".as_ref(),
        out.as_os_str(),
    ]);
    assert_eq!(exit, 0, "{report}");
    let small = path(&report["results"][0]["outputs"][0]);
    assert_eq!(small, out.join("Manzara ğüş 🧪 - compressed.jpg"));
    let size = fs::metadata(&small).unwrap().len();
    assert!(
        size <= target_kb * 1000,
        "{size} bytes for a {target_kb} KB target"
    );
    assert!(
        fs::metadata(&jpg).unwrap().len() == original,
        "the original stays"
    );
    assert_no_parts(&out);
    bench.assert_clean();
}

#[test]
fn lists_formats_and_routes() {
    let bench = Bench::new("en");
    let (exit, routes) = bench.json(["routes", "png"]);
    assert_eq!(exit, 0, "{routes}");
    assert_eq!(routes["format"]["id"], "png");
    let to: Vec<&str> = routes["to"]
        .as_array()
        .unwrap()
        .iter()
        .map(|route| route["format"].as_str().unwrap())
        .collect();
    assert!(to.contains(&"jpg") && to.contains(&"pdf"), "{to:?}");
    assert!(routes["to"][0]["ready"].is_boolean());
    assert!(routes["from"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["format"] == "heic"));

    // By extension, as a person types it.
    let output = bench.kento(["routes", ".JPEG"]);
    assert_eq!(code(&output), 0);
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.starts_with("JPG (jpg) converts to:"), "{text}");

    let (exit, formats) = bench.json(["formats"]);
    assert_eq!(exit, 0);
    let png = formats["formats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|format| format["id"] == "png")
        .expect("png is listed");
    assert_eq!(png["category"], "image");
    assert!(png["to"].as_array().unwrap().iter().any(|to| to == "jpg"));
}

#[test]
fn exit_codes_tell_what_went_wrong() {
    let bench = Bench::new("en");
    let dir = bench.dir();
    let source = dir.join("Resim ğüş 🧪.png");
    png(&source, 16, 16);

    // A sample of wrong usage; every case is in the command line's own tests.
    let output = bench.kento([
        OsStr::new("convert"),
        source.as_os_str(),
        OsStr::new("--loud"),
    ]);
    assert_eq!(code(&output), 2);
    assert_eq!(
        stderr(&output).trim(),
        "kento: There is no option --loud. The options: kento --help"
    );
    // The same in JSON, on standard output.
    let (exit, report) = bench.json([
        OsStr::new("convert"),
        source.as_os_str(),
        OsStr::new("--to"),
        OsStr::new("mp3"),
    ]);
    assert_eq!(exit, 3);
    assert_eq!(report["ok"], false);
    assert_eq!(report["exitCode"], 3);
    assert_eq!(report["error"]["kind"], "unsupported");
    assert!(report["error"]["message"]
        .as_str()
        .unwrap()
        .contains("cannot convert png to mp3"));
    // A file that fails does not stop the others, and the exit code says one failed.
    let broken = dir.join("bozuk 🧪.png");
    fs::write(&broken, b"not a picture").unwrap();
    let (exit, report) = bench.json([
        OsStr::new("convert"),
        broken.as_os_str(),
        source.as_os_str(),
        OsStr::new("--to"),
        OsStr::new("webp"),
    ]);
    assert_eq!(exit, 1, "{report}");
    assert_eq!(report["results"][0]["error"]["kind"], "failed");
    assert!(path(&report["results"][1]["outputs"][0]).is_file());
    assert_no_parts(&dir);
    assert!(
        !dir.join("bozuk 🧪.webp").exists(),
        "a failed job leaves nothing"
    );
    bench.assert_clean();
}

#[test]
fn speaks_the_language_chosen_in_settings() {
    let turkish = Bench::new("tr");
    let output = turkish.kento(["convrt"]);
    assert_eq!(code(&output), 2);
    assert!(
        stderr(&output).contains("Kento’da “convrt” adlı bir komut yok"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn runs_the_tools_that_need_no_choices() {
    let bench = Bench::new("en");
    let dir = bench.dir();
    let (a, b) = (dir.join("Sayfa 1 ğ.png"), dir.join("Sayfa 2 🧪.png"));
    png(&a, 40, 30);
    png(&b, 30, 40);
    let (exit, report) = bench.json([
        OsStr::new("tool"),
        "images-to-pdf".as_ref(),
        a.as_os_str(),
        b.as_os_str(),
        "--page".as_ref(),
        "a4".as_ref(),
        "--margin".as_ref(),
        "10".as_ref(),
    ]);
    assert_eq!(exit, 0, "{report}");
    let pdf = path(&report["results"][0]["outputs"][0]);
    assert_eq!(pdf, dir.join("Sayfa 1 ğ.pdf"));
    assert!(fs::read(&pdf).unwrap().starts_with(b"%PDF"));

    let (exit, report) = bench.json([
        OsStr::new("tool"),
        "merge-pdf".as_ref(),
        pdf.as_os_str(),
        pdf.as_os_str(),
    ]);
    assert_eq!(exit, 0, "{report}");
    assert_eq!(
        path(&report["results"][0]["outputs"][0]),
        dir.join("Sayfa 1 ğ - merged.pdf")
    );

    let archive = dir.join("Arşiv 🧪.zip");
    let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
    zip.start_file("içerik ğ.txt", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all("Kento çark".as_bytes()).unwrap();
    zip.finish().unwrap();
    let (exit, report) = bench.json([OsStr::new("tool"), "extract".as_ref(), archive.as_os_str()]);
    assert_eq!(exit, 0, "{report}");
    let folder = path(&report["results"][0]["outputs"][0]);
    assert_eq!(folder, dir.join("Arşiv 🧪"));
    assert_eq!(
        fs::read_to_string(folder.join("içerik ğ.txt")).unwrap(),
        "Kento çark"
    );

    // A picture without a code: read, nothing found, no report written.
    let (exit, report) = bench.json([
        OsStr::new("tool"),
        "read-qr".as_ref(),
        a.as_os_str(),
        "--format".as_ref(),
        "csv".as_ref(),
    ]);
    assert_eq!(exit, 0, "{report}");
    assert_eq!(report["results"][0]["codes"], Value::Array(vec![]));
    assert!(!dir.join("Sayfa 1 ğ - QR codes.csv").exists());
    assert_no_parts(&dir);
    bench.assert_clean();
}

#[test]
fn recipes_are_listed_and_found_by_name_or_id() {
    let bench = Bench::new("en");
    fs::write(
        bench.data.path().join("recipes.json"),
        r#"[{"id":"kucuk","name":"Küçük 🧪","steps":[{"kind":"convert","to":"webp"}]}]"#,
    )
    .unwrap();
    let (exit, list) = bench.json(["recipe", "list"]);
    assert_eq!(exit, 0, "{list}");
    assert_eq!(list["recipes"][0]["name"], "Küçük 🧪");

    let dir = bench.dir();
    let source = dir.join("Foto ğ.png");
    png(&source, 24, 24);
    // By name in another case; the result carries the recipe's name. The runner may still be
    // missing in this build: then the job fails and leaves nothing behind.
    let (exit, report) = bench.json([
        OsStr::new("recipe"),
        "run".as_ref(),
        "KÜÇÜK 🧪".as_ref(),
        source.as_os_str(),
    ]);
    if exit == 0 {
        assert_eq!(
            path(&report["results"][0]["outputs"][0]),
            dir.join("Foto ğ - Küçük 🧪.webp")
        );
    } else {
        assert!(report["results"][0]["error"].is_object(), "{report}");
        assert!(!dir.join("Foto ğ - Küçük 🧪").exists());
    }
    assert_no_parts(&dir);
    bench.assert_clean();
}

/// FFmpeg and ffprobe from `KENTO_FFMPEG`/`KENTO_FFPROBE` or the PATH, to make clips with and
/// measure them; without them the media check is skipped, unless `KENTO_REQUIRE_FFMPEG=1`.
fn media_tools() -> Option<(PathBuf, PathBuf)> {
    let find = |var: &str, name: &str| {
        std::env::var_os(var)
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .or_else(|| {
                let exe = format!("{name}{}", std::env::consts::EXE_SUFFIX);
                std::env::split_paths(&std::env::var_os("PATH")?)
                    .map(|dir| dir.join(&exe))
                    .find(|path| path.is_file())
            })
    };
    let found = find("KENTO_FFMPEG", "ffmpeg").zip(find("KENTO_FFPROBE", "ffprobe"));
    if found.is_none() {
        let required = std::env::var("KENTO_REQUIRE_FFMPEG").is_ok_and(|v| v == "1");
        assert!(!required, "KENTO_REQUIRE_FFMPEG=1 but FFmpeg is missing");
        eprintln!("skipped the media check of the command line: no FFmpeg on the PATH");
    }
    found
}

#[test]
fn merges_videos_with_a_transition() {
    let Some((ffmpeg, ffprobe)) = media_tools() else {
        return;
    };
    let bench = Bench::new("en");
    let dir = bench.dir();
    // Two sizes and frame rates, sound in one only.
    let clip = |name: &str, picture: &str, sound: bool| {
        let path = dir.join(name);
        let mut command = std::process::Command::new(&ffmpeg);
        command.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            picture,
        ]);
        if sound {
            command.args(["-f", "lavfi", "-i", "sine=f=440:r=48000:d=3", "-c:a", "aac"]);
        }
        let status = command
            .args([
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&path)
            .status()
            .unwrap();
        assert!(status.success(), "making {name}");
        path
    };
    let first = clip("Kapadokya ğüş 🧪.mp4", "testsrc2=s=192x108:r=25:d=3", true);
    let second = clip("Göreme İı.mp4", "testsrc2=s=120x120:r=30:d=3", false);

    let (exit, report) = bench.json([
        OsStr::new("tool"),
        "merge-video".as_ref(),
        first.as_os_str(),
        second.as_os_str(),
        "--transition".as_ref(),
        "fade-black".as_ref(),
        "--seconds".as_ref(),
        "1".as_ref(),
    ]);
    assert_eq!(exit, 0, "{report}");
    let merged = path(&report["results"][0]["outputs"][0]);
    assert_eq!(merged, dir.join("Kapadokya ğüş 🧪 - merged.mp4"));
    let probe = std::process::Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=width",
            "-of",
            "json",
        ])
        .arg(&merged)
        .output()
        .unwrap();
    let probe: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(probe["streams"][0]["width"], 192, "{probe}");
    // Two clips of three seconds overlap by one.
    let seconds: f64 = probe["format"]["duration"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((seconds - 5.0).abs() < 0.1, "{seconds} seconds");
    assert_no_parts(&dir);
    bench.assert_clean();

    // A transition's length without a transition is wrong usage, and nothing runs.
    let output = bench.kento([
        OsStr::new("tool"),
        "merge-video".as_ref(),
        first.as_os_str(),
        second.as_os_str(),
        "--seconds".as_ref(),
        "1".as_ref(),
    ]);
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert_eq!(
        stderr(&output).trim(),
        "kento: --seconds does not go with this command."
    );
    assert!(!dir.join("Kapadokya ğüş 🧪 - merged (2).mp4").exists());
}
