// SPDX-License-Identifier: MIT
//! Every archive here is generated at runtime, with the format crates directly, so that the
//! readers and writers are checked against an independent producer.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

use flate2::write::GzEncoder;
use flate2::{Compression, GzBuilder};
use sevenz_rust2::encoder_options::AesEncoderOptions;
use sevenz_rust2::{
    ArchiveEntry, ArchiveWriter, EncoderConfiguration, EncoderMethod, NtTime, Password,
};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, System, ZipArchive, ZipWriter};

use super::entry::{self, Entry, Kind};
use super::{convert, create_zip, extract, read, safe, supports, Limits, OUTPUTS};
use crate::{Conversion, Error, Options, Progress};

/// 2021-05-06 07:08:10 UTC: even seconds, so MS-DOS times hold it exactly.
const T: i64 = 1_620_284_890;
const TURKISH: &str = "Klasör/Kento ğüşıöç 🧪.txt";
const EMPTY_DIR: &str = "Klasör/boş";

fn long_name() -> String {
    format!("deep/{}.txt", "x".repeat(120))
}

fn noise(len: usize) -> Vec<u8> {
    let mut state = 0x2545_F491_u32;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            (state >> 24) as u8
        })
        .collect()
}

/// The files every generated archive holds, by relative path.
fn sample() -> BTreeMap<String, Vec<u8>> {
    BTreeMap::from([
        ("hello.txt".to_owned(), b"Hello, Kento!\n".to_vec()),
        (TURKISH.to_owned(), "Merhaba dünya".as_bytes().to_vec()),
        ("Klasör/alt/empty.txt".to_owned(), Vec::new()),
        ("data/big.bin".to_owned(), noise(300_000)),
        (long_name(), b"a long path".to_vec()),
    ])
}

fn mode_of(name: &str) -> u32 {
    if name == "hello.txt" {
        0o750
    } else {
        0o644
    }
}

fn dos_time() -> DateTime {
    let (year, month, day, hour, min, sec) = entry::to_civil(T);
    DateTime::from_date_and_time(
        year as u16,
        month as u8,
        day as u8,
        hour as u8,
        min as u8,
        sec as u8,
    )
    .unwrap()
}

fn make_zip(path: &Path) {
    let mut zip = ZipWriter::new(File::create(path).unwrap());
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .last_modified_time(dos_time())
        .system(System::Unix);
    zip.add_directory(format!("{EMPTY_DIR}/"), options).unwrap();
    for (name, data) in sample() {
        zip.start_file(name.as_str(), options.unix_permissions(mode_of(&name)))
            .unwrap();
        zip.write_all(&data).unwrap();
    }
    zip.finish().unwrap();
}

fn tar_header(kind: tar::EntryType, size: u64, mode: u32) -> tar::Header {
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(kind);
    header.set_size(size);
    header.set_mode(mode);
    header.set_mtime(T as u64);
    header
}

fn write_tar<W: Write>(out: W) -> W {
    let mut builder = tar::Builder::new(out);
    let mut dir = tar_header(tar::EntryType::Directory, 0, 0o755);
    builder
        .append_data(&mut dir, format!("{EMPTY_DIR}/"), std::io::empty())
        .unwrap();
    for (name, data) in sample() {
        let mut header = tar_header(tar::EntryType::Regular, data.len() as u64, mode_of(&name));
        builder
            .append_data(&mut header, &name, data.as_slice())
            .unwrap();
    }
    builder.into_inner().unwrap()
}

fn make_tar(path: &Path) {
    write_tar(File::create(path).unwrap());
}

fn make_tar_gz(path: &Path) {
    let gz = GzEncoder::new(File::create(path).unwrap(), Compression::default());
    write_tar(gz).finish().unwrap();
}

fn seven_item(name: &str, dir: bool, mode: u32) -> ArchiveEntry {
    let mut item = if dir {
        ArchiveEntry::new_directory(name)
    } else {
        ArchiveEntry::new_file(name)
    };
    item.last_modified_date = NtTime::from(entry::to_filetime(T).unwrap());
    item.has_last_modified_date = true;
    let file_type = if dir { 0o040_000 } else { 0o100_000 };
    item.windows_attributes = 0x20 | 0x8000 | ((mode | file_type) << 16);
    item.has_windows_attributes = true;
    item
}

fn make_7z(path: &Path) {
    let mut writer = ArchiveWriter::create(path).unwrap();
    writer
        .push_archive_entry::<&[u8]>(seven_item(EMPTY_DIR, true, 0o755), None)
        .unwrap();
    for (name, data) in sample() {
        let item = seven_item(&name, false, mode_of(&name));
        let reader = (!data.is_empty()).then_some(data.as_slice());
        writer.push_archive_entry(item, reader).unwrap();
    }
    writer.finish().unwrap();
}

fn make_gz(path: &Path, data: &[u8]) {
    let mut gz = GzBuilder::new()
        .mtime(T as u32)
        .write(File::create(path).unwrap(), Compression::default());
    gz.write_all(data).unwrap();
    gz.finish().unwrap();
}

/// Every file under `dir`, by `/`-separated relative path.
fn files_in(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for child in fs::read_dir(dir).unwrap() {
            let path = child.unwrap().path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                let relative = path.strip_prefix(root).unwrap();
                let key = relative
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                out.insert(key, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

/// The entries `read` reports, with their data's length.
fn entries_of(path: &Path, from: &str) -> Vec<(Entry, u64)> {
    let mut entries = Vec::new();
    read::for_each(
        path,
        from,
        &Limits::default(),
        &Progress::none(),
        &mut |entry, data| {
            let len = match data {
                Some(data) => std::io::copy(data, &mut std::io::sink())?,
                None => 0,
            };
            entries.push((entry.clone(), len));
            Ok(())
        },
    )
    .unwrap();
    entries
}

fn run(input: &Path, from: &str, to: &str, dest: &Path, options: &Options) -> crate::Result<()> {
    let temp = dest.with_extension("temp");
    fs::create_dir_all(&temp).unwrap();
    let progress = Progress::none();
    let job = Conversion {
        input,
        from,
        to,
        dest,
        temp: &temp,
        options,
        progress: &progress,
    };
    let written = convert(&job)?;
    assert_eq!(written, vec![dest.to_path_buf()]);
    Ok(())
}

fn unpack(input: &Path, from: &str, dest_dir: &Path) -> crate::Result<Vec<PathBuf>> {
    fs::create_dir_all(dest_dir).unwrap();
    extract(input, from, dest_dir, &Limits::default(), &Progress::none())
}

/// The catalog id an output is read back as: a `.tar.gz` is a GZ input.
fn read_id(to: &str) -> &str {
    if to == "tar-gz" {
        "gz"
    } else {
        to
    }
}

fn modified(path: &Path) -> Option<i64> {
    entry::from_system(fs::metadata(path).unwrap().modified().unwrap())
}

#[test]
fn routes_follow_the_catalog() {
    assert!(supports("zip", "tar"));
    assert!(supports("tar", "tar-gz"));
    assert!(supports("gz", "zip"));
    assert!(supports("rar", "7z"));
    assert!(!supports("zip", "zip"));
    assert!(!supports("gz", "tar-gz"));
    assert!(!supports("zip", "rar"));
    assert!(!supports("tar-gz", "zip"));
    assert!(!supports("png", "zip"));
}

#[test]
fn every_route_round_trips_contents_names_times_and_modes() {
    type Make = fn(&Path);
    let tmp = tempfile::tempdir().unwrap();
    let sources: [(&str, &str, Make); 4] = [
        ("zip", "source.zip", make_zip),
        ("tar", "source.tar", make_tar),
        ("gz", "source.tar.gz", make_tar_gz),
        ("7z", "source.7z", make_7z),
    ];
    for (from, file, make) in sources {
        let input = tmp.path().join(file);
        make(&input);
        for &to in OUTPUTS {
            if !supports(from, to) {
                continue;
            }
            let case = tmp.path().join(format!("{from}-to-{to}"));
            fs::create_dir(&case).unwrap();
            let dest = case.join("out.archive");
            run(&input, from, to, &dest, &Options::default()).unwrap();

            let out = case.join("extracted");
            let written = unpack(&dest, read_id(to), &out).unwrap();
            assert_eq!(files_in(&out), sample(), "{from} → {to}");
            assert_eq!(written.len(), sample().len(), "{from} → {to}");
            assert!(written.iter().all(|path| path.starts_with(&out)));
            assert!(out.join(EMPTY_DIR).is_dir(), "{from} → {to}: empty folder");
            assert_eq!(modified(&out.join("hello.txt")), Some(T), "{from} → {to}");

            let entries = entries_of(&dest, read_id(to));
            let (hello, _) = entries
                .iter()
                .find(|(entry, _)| entry.name == "hello.txt")
                .unwrap();
            assert_eq!(hello.mtime, Some(T), "{from} → {to}");
            assert_eq!(hello.mode.map(|m| m & 0o777), Some(0o750), "{from} → {to}");
        }
    }
}

#[test]
fn the_written_archives_open_with_the_format_crates() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("source.tar");
    make_tar(&input);

    let zip_path = tmp.path().join("out.zip");
    run(&input, "tar", "zip", &zip_path, &Options::default()).unwrap();
    let mut zip = ZipArchive::new(File::open(&zip_path).unwrap()).unwrap();
    let mut text = String::new();
    zip.by_name(TURKISH)
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    assert_eq!(text, "Merhaba dünya");
    let big = zip.by_name("data/big.bin").unwrap();
    assert_eq!(big.compression(), CompressionMethod::Deflated);
    drop(big);

    let tar_path = tmp.path().join("out.tar");
    let same = run(&input, "tar", "tar", &tar_path, &Options::default());
    assert!(matches!(same, Err(Error::Unsupported { .. })), "{same:?}");
    run(&zip_path, "zip", "tar", &tar_path, &Options::default()).unwrap();
    let mut archive = tar::Archive::new(File::open(&tar_path).unwrap());
    let names: BTreeSet<String> = archive
        .entries()
        .unwrap()
        .map(|item| String::from_utf8(item.unwrap().path_bytes().into_owned()).unwrap())
        .collect();
    assert!(names.contains(&long_name()));
    assert!(names.contains(TURKISH));

    let seven_path = tmp.path().join("out.7z");
    run(&zip_path, "zip", "7z", &seven_path, &Options::default()).unwrap();
    let mut seven = sevenz_rust2::ArchiveReader::open(&seven_path, Password::empty()).unwrap();
    assert_eq!(
        seven.read_file(TURKISH).unwrap(),
        "Merhaba dünya".as_bytes()
    );
}

#[test]
fn a_single_gzipped_file_extracts_and_converts_to_that_file() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("notes.txt.gz");
    let data = noise(70_000);
    make_gz(&input, &data);
    let expected = BTreeMap::from([("notes.txt".to_owned(), data)]);

    let out = tmp.path().join("extracted");
    let written = unpack(&input, "gz", &out).unwrap();
    assert_eq!(written, vec![out.join("notes.txt")]);
    assert_eq!(files_in(&out), expected);
    assert_eq!(modified(&out.join("notes.txt")), Some(T));

    for to in ["zip", "tar", "7z"] {
        let dest = tmp.path().join(format!("notes.{to}"));
        run(&input, "gz", to, &dest, &Options::default()).unwrap();
        let out = tmp.path().join(format!("from-{to}"));
        unpack(&dest, to, &out).unwrap();
        assert_eq!(files_in(&out), expected, "gz → {to}");
        assert_eq!(modified(&out.join("notes.txt")), Some(T), "gz → {to}");
    }
}

/// A ZIP whose entry names are patched afterwards, since writers refuse unsafe names.
fn zip_with_names(path: &Path, names: &[(&str, &str)]) {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (placeholder, _) in names {
        zip.start_file(*placeholder, options).unwrap();
        zip.write_all(b"x").unwrap();
    }
    let mut bytes = zip.finish().unwrap().into_inner();
    // Each name is in the local and the central header.
    for (placeholder, name) in names {
        assert_eq!(placeholder.len(), name.len());
        while let Some(at) = find(&bytes, placeholder.as_bytes()) {
            bytes[at..at + name.len()].copy_from_slice(name.as_bytes());
        }
    }
    fs::write(path, bytes).unwrap();
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn tar_with_names(path: &Path, entries: &[(&str, &[u8])]) {
    let mut builder = tar::Builder::new(File::create(path).unwrap());
    for (name, data) in entries {
        let mut header = tar_header(tar::EntryType::Regular, data.len() as u64, 0o644);
        header.as_old_mut().name[..name.len()].copy_from_slice(name.as_bytes());
        header.set_cksum();
        builder.append(&header, *data).unwrap();
    }
    builder.into_inner().unwrap();
}

#[test]
fn unsafe_paths_never_leave_the_destination() {
    let tmp = tempfile::tempdir().unwrap();
    let names = [
        ("PP/evil.txt", "../evil.txt"),
        ("Qabs.txt", "/abs.txt"),
        ("QQQx.txt", "C:\\x.txt"),
        ("a/PP/PP/b.txt", "a/../../b.txt"),
        ("ZZsrvZshareZunc.txt", "\\\\srv\\share\\unc.txt"),
    ];
    let expected: BTreeSet<String> = ["evil.txt", "abs.txt", "x.txt", "b.txt", "srv/share/unc.txt"]
        .into_iter()
        .map(str::to_owned)
        .collect();

    let zip_path = tmp.path().join("slip.zip");
    zip_with_names(&zip_path, &names);
    let jail = tmp.path().join("zip-jail");
    let out = jail.join("out");
    let written = unpack(&zip_path, "zip", &out).unwrap();
    assert!(written.iter().all(|path| path.starts_with(&out)));
    assert_eq!(
        files_in(&out).into_keys().collect::<BTreeSet<_>>(),
        expected
    );
    assert_eq!(fs::read_dir(&jail).unwrap().count(), 1);

    let tar_path = tmp.path().join("slip.tar");
    let entries: Vec<(&str, &[u8])> = names.iter().map(|(_, name)| (*name, &b"x"[..])).collect();
    tar_with_names(&tar_path, &entries);
    let jail = tmp.path().join("tar-jail");
    let out = jail.join("out");
    unpack(&tar_path, "tar", &out).unwrap();
    assert_eq!(
        files_in(&out).into_keys().collect::<BTreeSet<_>>(),
        expected
    );
    assert_eq!(fs::read_dir(&jail).unwrap().count(), 1);
    assert!(!tmp.path().join("evil.txt").exists());
}

#[test]
fn stored_names_become_safe_parts() {
    let parts = |name: &str| safe::components(name);
    assert_eq!(parts("../evil.txt"), ["evil.txt"]);
    assert_eq!(parts("/abs.txt"), ["abs.txt"]);
    assert_eq!(parts("C:\\x.txt"), ["x.txt"]);
    assert_eq!(parts("C:/dir/x.txt"), ["dir", "x.txt"]);
    assert_eq!(parts("a/../../b.txt"), ["b.txt"]);
    assert_eq!(parts("a/./b//c"), ["a", "b", "c"]);
    assert_eq!(parts("\\\\?\\C:\\x"), ["?", "C:", "x"]);
    assert!(parts("../..").is_empty());
}

#[test]
fn names_windows_forbids_are_replaced() {
    let windows = |part: &str| safe::file_name(part, true);
    assert_eq!(windows("a<b>c.txt"), "a_b_c.txt");
    assert_eq!(windows("what?*|\".txt"), "what____.txt");
    assert_eq!(windows("file.txt:stream"), "file.txt_stream");
    assert_eq!(windows("C:"), "C_");
    assert_eq!(windows("tab\there"), "tab_here");
    assert_eq!(windows("trailing. . "), "trailing");
    assert_eq!(windows("..."), "_");
    assert_eq!(windows("CON"), "_CON");
    assert_eq!(windows("nul.txt"), "_nul.txt");
    assert_eq!(windows("com1.log"), "_com1.log");
    assert_eq!(windows("LPT9"), "_LPT9");
    assert_eq!(windows("COM¹"), "_COM¹");
    assert_eq!(windows("CONSOLE.txt"), "CONSOLE.txt");
    assert_eq!(windows("COM10"), "COM10");
    assert_eq!(windows("Kento ğüşıöç 🧪.txt"), "Kento ğüşıöç 🧪.txt");
    assert_eq!(safe::file_name("a:b", false), "a:b");

    let long = format!("{}.txt", "ş".repeat(300));
    let short = windows(&long);
    assert!(short.encode_utf16().count() <= 255);
    assert!(short.ends_with(".txt"));
}

#[cfg(windows)]
#[test]
fn extraction_on_windows_replaces_forbidden_names() {
    let tmp = tempfile::tempdir().unwrap();
    let tar_path = tmp.path().join("names.tar");
    tar_with_names(
        &tar_path,
        &[
            ("bad<name>.txt", b"1"),
            ("CON.txt", b"2"),
            ("trailing. ", b"3"),
            ("file.txt:stream", b"4"),
            ("aux/inner.txt", b"5"),
        ],
    );
    let out = tmp.path().join("out");
    unpack(&tar_path, "tar", &out).unwrap();
    let names: BTreeSet<String> = files_in(&out).into_keys().collect();
    let expected: BTreeSet<String> = [
        "bad_name_.txt",
        "_CON.txt",
        "trailing",
        "file.txt_stream",
        "_aux/inner.txt",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(names, expected);
}

#[test]
fn duplicate_names_are_numbered_never_overwritten() {
    let tmp = tempfile::tempdir().unwrap();
    let tar_path = tmp.path().join("dupes.tar");
    tar_with_names(
        &tar_path,
        &[
            ("a.txt", b"first"),
            ("a.txt", b"second"),
            ("A.txt", b"third"),
            ("x", b"file"),
            ("x/y.txt", b"inside"),
            (".hidden", b"dot"),
            (".hidden", b"dot again"),
        ],
    );
    let out = tmp.path().join("out");
    unpack(&tar_path, "tar", &out).unwrap();
    let insensitive = cfg!(any(windows, target_os = "macos"));
    let expected = BTreeMap::from([
        ("a.txt".to_owned(), b"first".to_vec()),
        ("a (2).txt".to_owned(), b"second".to_vec()),
        (
            if insensitive { "A (3).txt" } else { "A.txt" }.to_owned(),
            b"third".to_vec(),
        ),
        ("x".to_owned(), b"file".to_vec()),
        ("x (2)/y.txt".to_owned(), b"inside".to_vec()),
        (".hidden".to_owned(), b"dot".to_vec()),
        (".hidden (2)".to_owned(), b"dot again".to_vec()),
    ]);
    assert_eq!(files_in(&out), expected);

    // The formats allow duplicates, but a converted ZIP never repeats a name.
    let zip_path = tmp.path().join("dupes.zip");
    run(&tar_path, "tar", "zip", &zip_path, &Options::default()).unwrap();
    let zip = ZipArchive::new(File::open(&zip_path).unwrap()).unwrap();
    let names: BTreeSet<String> = zip
        .file_names()
        .map(|name| name.unwrap().into_owned())
        .collect();
    assert!(names.contains("a.txt") && names.contains("a (2).txt"));
}

#[test]
fn limits_stop_extraction_and_conversion() {
    let tmp = tempfile::tempdir().unwrap();
    let zip_path = tmp.path().join("source.zip");
    make_zip(&zip_path);
    let tar_path = tmp.path().join("source.tar");
    make_tar(&tar_path);
    let seven_path = tmp.path().join("source.7z");
    make_7z(&seven_path);

    let few_entries = Limits {
        max_entries: 2,
        max_total_bytes: u64::MAX,
    };
    let few_bytes = Limits {
        max_entries: 1_000,
        max_total_bytes: 1_000,
    };
    for (path, from) in [(&zip_path, "zip"), (&tar_path, "tar"), (&seven_path, "7z")] {
        for (i, limits) in [&few_entries, &few_bytes].into_iter().enumerate() {
            let out = tmp.path().join(format!("{from}-{i}"));
            fs::create_dir(&out).unwrap();
            let result = extract(path, from, &out, limits, &Progress::none());
            assert!(matches!(result, Err(Error::Limit(_))), "{from}: {result:?}");
            // Nothing half-written stays behind.
            assert!(!out.join("data/big.bin").exists());
        }
    }

    let options = Options {
        archive_limits: few_bytes,
        ..Options::default()
    };
    let result = run(&tar_path, "tar", "7z", &tmp.path().join("out.7z"), &options);
    assert!(matches!(result, Err(Error::Limit(_))), "{result:?}");
}

#[test]
fn create_zip_packs_files_and_nested_folders() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("Proje");
    fs::create_dir_all(project.join("alt/derin")).unwrap();
    fs::create_dir_all(project.join("boş")).unwrap();
    fs::write(project.join("a.txt"), "a").unwrap();
    fs::write(project.join("alt/b.txt"), "b").unwrap();
    fs::write(project.join("alt/derin/c.bin"), noise(50_000)).unwrap();
    let single = tmp.path().join("Kento ğüşıöç 🧪.txt");
    fs::write(&single, "tek").unwrap();
    let other = tmp.path().join("other");
    fs::create_dir(&other).unwrap();
    let same_name = other.join("Kento ğüşıöç 🧪.txt");
    fs::write(&same_name, "aynı ad").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(project.join("a.txt"), project.join("link.txt")).unwrap();

    let dest = tmp.path().join("packed.zip");
    create_zip(
        &[project.clone(), single.clone(), same_name],
        &dest,
        &Progress::none(),
    )
    .unwrap();

    let mut zip = ZipArchive::new(File::open(&dest).unwrap()).unwrap();
    let names: BTreeSet<String> = zip
        .file_names()
        .map(|name| name.unwrap().into_owned())
        .collect();
    let expected: BTreeSet<String> = [
        "Proje/",
        "Proje/a.txt",
        "Proje/alt/",
        "Proje/alt/b.txt",
        "Proje/alt/derin/",
        "Proje/alt/derin/c.bin",
        "Proje/boş/",
        "Kento ğüşıöç 🧪.txt",
        "Kento ğüşıöç 🧪 (2).txt",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(names, expected);
    assert_eq!(
        zip.by_name("Proje/alt/derin/c.bin").unwrap().compression(),
        CompressionMethod::Deflated
    );

    let out = tmp.path().join("out");
    unpack(&dest, "zip", &out).unwrap();
    assert_eq!(
        fs::read(out.join("Proje/alt/derin/c.bin")).unwrap(),
        noise(50_000)
    );
    assert_eq!(
        fs::read_to_string(out.join("Kento ğüşıöç 🧪 (2).txt")).unwrap(),
        "aynı ad"
    );
    assert!(out.join("Proje/boş").is_dir());
    assert_eq!(
        modified(&out.join("Proje/a.txt")),
        modified(&project.join("a.txt"))
    );
}

#[test]
fn encrypted_archives_are_reported() {
    let tmp = tempfile::tempdir().unwrap();

    // A ZIP with the "encrypted" flag set on its entry, as a password-protected one has.
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    zip.start_file("secret.txt", options).unwrap();
    zip.write_all(b"secret").unwrap();
    let mut bytes = zip.finish().unwrap().into_inner();
    let local = find(&bytes, b"PK\x03\x04").unwrap();
    bytes[local + 6] |= 1;
    let central = find(&bytes, b"PK\x01\x02").unwrap();
    bytes[central + 8] |= 1;
    let zip_path = tmp.path().join("locked.zip");
    fs::write(&zip_path, bytes).unwrap();
    let result = unpack(&zip_path, "zip", &tmp.path().join("zip-out"));
    assert!(matches!(result, Err(Error::Encrypted)), "{result:?}");

    let seven_path = tmp.path().join("locked.7z");
    let mut writer = ArchiveWriter::create(&seven_path).unwrap();
    writer.set_content_methods(vec![
        AesEncoderOptions::new(Password::new("secret")).into(),
        EncoderConfiguration::new(EncoderMethod::LZMA2),
    ]);
    writer
        .push_archive_entry(ArchiveEntry::new_file("secret.txt"), Some(&b"secret"[..]))
        .unwrap();
    writer.finish().unwrap();
    let result = unpack(&seven_path, "7z", &tmp.path().join("7z-out"));
    assert!(matches!(result, Err(Error::Encrypted)), "{result:?}");
    let result = run(
        &seven_path,
        "7z",
        "zip",
        &tmp.path().join("locked.zip.out"),
        &Options::default(),
    );
    assert!(matches!(result, Err(Error::Encrypted)), "{result:?}");
}

#[test]
fn damaged_archives_are_unreadable() {
    let tmp = tempfile::tempdir().unwrap();
    let garbage = tmp.path().join("garbage.bin");
    fs::write(&garbage, noise(4_096)).unwrap();
    for from in ["zip", "tar", "gz", "7z", "rar"] {
        let result = unpack(&garbage, from, &tmp.path().join(format!("garbage-{from}")));
        assert!(
            matches!(result, Err(Error::Unreadable(_))),
            "{from}: {result:?}"
        );
    }

    // A truncated TAR.GZ.
    let tar_gz = tmp.path().join("source.tar.gz");
    make_tar_gz(&tar_gz);
    let bytes = fs::read(&tar_gz).unwrap();
    let cut = tmp.path().join("cut.tar.gz");
    fs::write(&cut, &bytes[..bytes.len() / 2]).unwrap();
    let result = unpack(&cut, "gz", &tmp.path().join("cut-out"));
    assert!(matches!(result, Err(Error::Unreadable(_))), "{result:?}");

    // A ZIP whose stored data no longer matches its checksum.
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    zip.start_file("data.txt", options).unwrap();
    zip.write_all(b"original contents").unwrap();
    let mut bytes = zip.finish().unwrap().into_inner();
    let at = find(&bytes, b"original").unwrap();
    bytes[at] = b'O';
    let bad_crc = tmp.path().join("bad-crc.zip");
    fs::write(&bad_crc, bytes).unwrap();
    let out = tmp.path().join("bad-crc-out");
    let result = unpack(&bad_crc, "zip", &out);
    assert!(matches!(result, Err(Error::Unreadable(_))), "{result:?}");
    assert!(!out.join("data.txt").exists());
    let result = run(
        &bad_crc,
        "zip",
        "tar",
        &tmp.path().join("bad.tar"),
        &Options::default(),
    );
    assert!(matches!(result, Err(Error::Unreadable(_))), "{result:?}");

    let missing = unpack(
        &tmp.path().join("missing.rar"),
        "rar",
        &tmp.path().join("m"),
    );
    assert!(matches!(missing, Err(Error::Io(_))), "{missing:?}");
}

#[test]
fn cancellation_stops_the_work() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("source.zip");
    make_zip(&input);
    let report = |_: Option<f32>| {};
    let cancelled = || true;
    let progress = Progress::new(&report, &cancelled);
    let out = tmp.path().join("out");
    fs::create_dir(&out).unwrap();
    let result = extract(&input, "zip", &out, &Limits::default(), &progress);
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
}

#[test]
fn times_convert_both_ways() {
    assert_eq!(entry::to_civil(T), (2021, 5, 6, 7, 8, 10));
    assert_eq!(entry::from_civil(2021, 5, 6, 7, 8, 10), T);
    assert_eq!(entry::to_civil(-1), (1969, 12, 31, 23, 59, 59));
    assert_eq!(
        entry::from_filetime(entry::to_filetime(T).unwrap()),
        Some(T)
    );
    assert_eq!(entry::from_filetime(0), None);
    // 2021-05-06 07:08:10 as an MS-DOS date and time.
    let dos = (41 << 25) | (5 << 21) | (6 << 16) | (7 << 11) | (8 << 5) | 5;
    assert_eq!(entry::from_dos(dos), Some(T));
    assert_eq!(entry::from_dos(0), None);
}

/// RAR archives cannot be made here (the UnRAR licence forbids creating them), so these run only
/// against sample archives in `KENTO_RAR_SAMPLES`: `cargo test -p kento-engines rar_samples --
/// --ignored`.
#[test]
#[ignore = "needs KENTO_RAR_SAMPLES, a folder of sample RAR archives"]
fn rar_samples() {
    let samples = PathBuf::from(std::env::var("KENTO_RAR_SAMPLES").unwrap());
    let tmp = tempfile::tempdir().unwrap();
    let mut extracted = 0;
    for item in fs::read_dir(&samples).unwrap() {
        let path = item.unwrap().path();
        if path.extension().is_none_or(|ext| ext != "rar") {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let out = tmp.path().join(format!("out-{extracted}"));
        let result = unpack(&path, "rar", &out);
        println!("{name}: {result:?}");
        match result {
            Ok(_) => {
                for (file, data) in files_in(&out) {
                    println!("  {file}: {} bytes", data.len());
                }
                let dest = tmp.path().join(format!("converted-{extracted}.zip"));
                run(&path, "rar", "zip", &dest, &Options::default()).unwrap();
                let again = tmp.path().join(format!("again-{extracted}"));
                unpack(&dest, "zip", &again).unwrap();
                assert_eq!(files_in(&again), files_in(&out), "{name}");
            }
            Err(Error::Encrypted) => assert!(name.contains("crypt") || name.contains("password")),
            Err(e) => println!("  not extracted: {e}"),
        }
        extracted += 1;
    }
    assert!(extracted > 0);
}

#[test]
fn kinds_are_reported() {
    let tmp = tempfile::tempdir().unwrap();
    let tar_path = tmp.path().join("links.tar");
    let mut builder = tar::Builder::new(File::create(&tar_path).unwrap());
    let mut link = tar_header(tar::EntryType::Symlink, 0, 0o777);
    builder
        .append_link(&mut link, "link.txt", "../../etc/passwd")
        .unwrap();
    let mut file = tar_header(tar::EntryType::Regular, 2, 0o644);
    builder
        .append_data(&mut file, "real.txt", &b"ok"[..])
        .unwrap();
    builder.into_inner().unwrap();

    let kinds: Vec<(String, Kind)> = entries_of(&tar_path, "tar")
        .into_iter()
        .map(|(entry, _)| (entry.name, entry.kind))
        .collect();
    assert_eq!(
        kinds,
        [
            ("link.txt".to_owned(), Kind::Link),
            ("real.txt".to_owned(), Kind::File)
        ]
    );
    let out = tmp.path().join("out");
    let written = unpack(&tar_path, "tar", &out).unwrap();
    assert_eq!(written, vec![out.join("real.txt")]);
    assert!(fs::symlink_metadata(out.join("link.txt")).is_err());
}
