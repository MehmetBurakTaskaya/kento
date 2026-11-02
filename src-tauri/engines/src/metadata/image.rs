// SPDX-License-Identifier: MIT
//! Pictures through ExifTool. A read lists every tag ExifTool finds, grouped by family (EXIF, XMP,
//! IPTC, ICC_Profile…, with the GPS block on its own), plus six common fields to edit. Each common
//! field is written where other programs look for it: the EXIF tag when the format holds EXIF
//! (the XMP one otherwise), and the same field in the other families only where the file already
//! has it, so no two copies disagree. ExifTool writes a new file in the job's temp folder; the
//! input is only read.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::Duration;

use serde_json::{Map, Value};

use super::exiftool::{self, failure};
use super::{check_keys, editable, move_file, shown, MetadataInfo, MetadataRun};
use crate::{Error, Progress, Result, Tools};

/// The formats ExifTool writes; BMP and SVG are only read.
const WRITABLE: &[&str] = &["jpg", "png", "tiff", "webp", "heic", "avif", "gif"];
/// A read that takes longer has hung; the panel should not wait for ever.
const READ_LIMIT: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Text,
    /// Several values, typed as one list separated by commas.
    List,
    /// A date and time, typed as `2024-05-01 14:30:00`.
    Date,
}

/// A common field: its stable key and where it lives. Tags are `family 1 group:tag name`.
struct Common {
    key: &'static str,
    name: &'static str,
    kind: Kind,
    /// Shown in this order; the first one the file has wins.
    read: &'static [&'static str],
    /// Written whenever the format holds EXIF.
    exif: Option<&'static str>,
    /// Written when the format holds no EXIF (or the field has no EXIF tag), or the file has it.
    xmp: &'static str,
    /// Written only where the file already has them.
    others: &'static [&'static str],
}

const COMMON: [Common; 6] = [
    Common {
        key: "title",
        name: "Title",
        kind: Kind::Text,
        read: &["XMP-dc:Title", "IFD0:XPTitle", "IPTC:ObjectName"],
        exif: None,
        xmp: "XMP-dc:Title",
        others: &["IFD0:XPTitle", "IPTC:ObjectName"],
    },
    Common {
        key: "author",
        name: "Artist",
        kind: Kind::Text,
        read: &[
            "IFD0:Artist",
            "XMP-dc:Creator",
            "IPTC:By-line",
            "IFD0:XPAuthor",
        ],
        exif: Some("IFD0:Artist"),
        xmp: "XMP-dc:Creator",
        others: &["IPTC:By-line", "IFD0:XPAuthor"],
    },
    Common {
        key: "description",
        name: "ImageDescription",
        kind: Kind::Text,
        read: &[
            "IFD0:ImageDescription",
            "XMP-dc:Description",
            "IPTC:Caption-Abstract",
        ],
        exif: Some("IFD0:ImageDescription"),
        xmp: "XMP-dc:Description",
        others: &["IPTC:Caption-Abstract"],
    },
    Common {
        key: "copyright",
        name: "Copyright",
        kind: Kind::Text,
        read: &["IFD0:Copyright", "XMP-dc:Rights", "IPTC:CopyrightNotice"],
        exif: Some("IFD0:Copyright"),
        xmp: "XMP-dc:Rights",
        others: &["IPTC:CopyrightNotice"],
    },
    Common {
        key: "keywords",
        name: "Keywords",
        kind: Kind::List,
        read: &["XMP-dc:Subject", "IPTC:Keywords", "IFD0:XPKeywords"],
        exif: None,
        xmp: "XMP-dc:Subject",
        others: &["IPTC:Keywords", "IFD0:XPKeywords"],
    },
    Common {
        key: "date",
        name: "DateTimeOriginal",
        kind: Kind::Date,
        read: &[
            "ExifIFD:DateTimeOriginal",
            "XMP-exif:DateTimeOriginal",
            "XMP-photoshop:DateCreated",
        ],
        exif: Some("ExifIFD:DateTimeOriginal"),
        xmp: "XMP-photoshop:DateCreated",
        others: &["XMP-exif:DateTimeOriginal"],
    },
];

/// One tag as ExifTool reported it.
#[derive(Debug, Clone, PartialEq)]
struct Tag {
    /// Family 0 (`EXIF`, `XMP`, `File`) and family 1 (`IFD0`, `XMP-dc`, `GPS`).
    family0: String,
    family1: String,
    name: String,
    /// The raw JSON key, unique within a read.
    key: String,
    /// List items; one item for a plain value.
    items: Vec<String>,
}

impl Tag {
    fn value(&self) -> String {
        self.items.join(", ")
    }

    /// `IFD0:Artist`, as `Common` names tags.
    fn address(&self) -> String {
        format!("{}:{}", self.family1, self.name)
    }

    /// Bookkeeping, not metadata: file system dates and names, ExifTool's own notes, and the
    /// tags it derives from others.
    fn hidden(&self) -> bool {
        matches!(self.family0.as_str(), "ExifTool" | "Composite") || self.family1 == "System"
    }
}

pub(super) fn read(path: &Path, from: &str, tools: &Tools) -> Result<MetadataInfo> {
    let exiftool = tools.exiftool()?;
    let tags = read_tags(exiftool, path, &Progress::none())?;
    Ok(info(&tags, from))
}

/// Every tag of the file, as `-j -G0:1`: JSON with both group families in each key. Print
/// conversion stays on (`Rotate 90 CW`, not `6`), since people read these values; `-n` is not
/// needed for anything Kento writes back. Numbers come quoted (`structformat=jsonq`) so values
/// such as `0230` or `13.60` keep their exact text.
fn read_tags(exiftool: &Path, path: &Path, progress: &Progress) -> Result<Vec<Tag>> {
    let args: Vec<String> = ["-j", "-G0:1", "-api", "structformat=jsonq", "-m"]
        .into_iter()
        .map(str::to_owned)
        .chain([path_arg(path)?])
        .collect();
    let output = exiftool::run(exiftool, &args, progress, Some(READ_LIMIT))?;
    // A file ExifTool cannot read still gets a report, with the reason in `ExifTool:Error`;
    // without a report, its message says why.
    let report = serde_json::from_slice::<Value>(&output.stdout).is_ok();
    match parse(&output.stdout) {
        Err(_) if !output.success && !report => Err(failure(&output.stderr)),
        result => result,
    }
}

fn path_arg(path: &Path) -> Result<String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| Error::Other("the file name is not valid Unicode".into()))
}

/// ExifTool's JSON: an array with one object per file.
fn parse(stdout: &[u8]) -> Result<Vec<Tag>> {
    let files: Vec<Map<String, Value>> = serde_json::from_slice(stdout)
        .map_err(|error| Error::Unreadable(format!("ExifTool's report: {error}")))?;
    let file = files
        .into_iter()
        .next()
        .ok_or_else(|| Error::Unreadable("ExifTool reported nothing".into()))?;
    if let Some(Value::String(error)) = file.get("ExifTool:Error") {
        return Err(Error::Unreadable(error.clone()));
    }
    let mut tags = Vec::new();
    for (key, value) in file {
        let parts: Vec<&str> = key.split(':').collect();
        let (family0, family1, name) = match parts.as_slice() {
            [family0, family1, name] => (*family0, *family1, *name),
            // ExifTool writes one group when both families have the same name.
            [family, name] => (*family, *family, *name),
            _ => continue,
        };
        let items = match &value {
            Value::Array(list) => list.iter().map(text).collect(),
            other => vec![text(other)],
        };
        tags.push(Tag {
            family0: family0.to_owned(),
            family1: family1.to_owned(),
            name: name.to_owned(),
            key,
            items,
        });
    }
    Ok(tags)
}

fn text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// The heading a tag is shown under: its family 0 group, with the GPS block on its own so that
/// the location stands out.
fn heading(tag: &Tag) -> &str {
    if tag.family1 == "GPS" {
        "GPS"
    } else {
        &tag.family0
    }
}

/// A position: coordinates in EXIF's GPS block, in XMP, or in IPTC Extension's location
/// structures.
fn is_location(tag: &Tag) -> bool {
    let name = tag.name.to_ascii_lowercase();
    [
        "gpslatitude",
        "gpslongitude",
        "gpscoordinates",
        "gpsposition",
    ]
    .iter()
    .any(|part| name.contains(part))
}

fn writable(from: &str) -> bool {
    WRITABLE.contains(&from)
}

/// GIF holds XMP and comments, not EXIF.
fn holds_exif(from: &str) -> bool {
    from != "gif"
}

fn info(tags: &[Tag], from: &str) -> MetadataInfo {
    let visible: Vec<&Tag> = tags.iter().filter(|tag| !tag.hidden()).collect();
    let by_address: HashMap<String, &Tag> =
        visible.iter().map(|tag| (tag.address(), *tag)).collect();
    let mut fields = Vec::new();
    if writable(from) {
        for common in &COMMON {
            let found = common
                .read
                .iter()
                .filter_map(|address| by_address.get(*address))
                .map(|tag| tag.value())
                .find(|value| !value.trim().is_empty())
                .unwrap_or_default();
            let value = if common.kind == Kind::Date {
                shown_date(&found)
            } else {
                found
            };
            let group = match common.exif {
                Some(_) if holds_exif(from) => "EXIF",
                _ => "XMP",
            };
            fields.push(editable(common.key, group, common.name, value));
        }
    }
    // A tag name that two blocks share (the main picture's resolution and the thumbnail's) gets
    // its block added.
    let mut seen: HashMap<(String, String), usize> = HashMap::new();
    for tag in &visible {
        let group = heading(tag);
        let count = seen
            .entry((group.to_owned(), tag.name.clone()))
            .or_default();
        *count += 1;
        let name = if *count > 1 && tag.family1 != group {
            format!("{} ({})", tag.name, tag.family1)
        } else {
            tag.name.clone()
        };
        fields.push(shown(tag.key.clone(), group, &name, &tag.value()));
    }
    MetadataInfo {
        fields,
        chapters: Vec::new(),
        has_location: visible.iter().any(|tag| is_location(tag)),
        chapters_editable: false,
    }
}

/// `2024:05:01 14:30:00` as people type it, `2024-05-01 14:30:00`.
fn shown_date(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 10 && bytes[4] == b':' && bytes[7] == b':' {
        format!("{}-{}-{}", &value[..4], &value[5..7], &value[8..])
    } else {
        value.to_owned()
    }
}

/// A typed date and time as EXIF stores it, `YYYY:MM:DD HH:MM:SS`. The date is required, the
/// time may be shortened (`14:30`) or left out; a trailing time zone is dropped, since EXIF keeps
/// it in a tag of its own.
pub(super) fn exif_date(text: &str) -> Option<String> {
    let text = text.trim();
    let zone = text
        .char_indices()
        .find(|&(at, c)| c == 'Z' || c == 'z' || c == '+' || (c == '-' && at >= 10))
        .map_or(text.len(), |(at, _)| at);
    let numbers: Vec<&str> = text[..zone]
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .collect();
    if !(3..=6).contains(&numbers.len()) || numbers[0].len() != 4 {
        return None;
    }
    let mut parts = [0u32; 6];
    for (slot, number) in parts.iter_mut().zip(&numbers) {
        if number.len() > 4 {
            return None;
        }
        *slot = number.parse().ok()?;
    }
    let [year, month, day, hour, minute, second] = parts;
    let valid = year >= 1
        && (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && hour <= 23
        && minute <= 59
        && second <= 60;
    valid.then(|| format!("{year:04}:{month:02}:{day:02} {hour:02}:{minute:02}:{second:02}"))
}

pub(super) fn write(run: &MetadataRun) -> Result<()> {
    let exiftool = run.tools.exiftool()?;
    if !writable(run.from) {
        return Err(Error::Unsupported {
            from: run.from.to_owned(),
            to: "metadata".to_owned(),
        });
    }
    let change = run.change;
    let keys: Vec<&str> = COMMON.iter().map(|common| common.key).collect();
    check_keys(change, &keys)?;
    if change
        .chapters
        .as_ref()
        .is_some_and(|list| !list.is_empty())
    {
        return Err(Error::Other("pictures have no chapters".into()));
    }
    let mut args = vec!["-m".to_owned()];
    if change.remove_all {
        remove_all(&mut args, run.from);
    } else {
        // What the file has decides which families a field is also written to.
        let tags = read_tags(exiftool, run.input, run.progress)?;
        run.progress.report(0.3);
        if change.remove_location {
            args.extend(["-gps:all=".to_owned(), "-xmp:*gps*=".to_owned()]);
        }
        assign(&mut args, change, &tags, run)?;
    }
    if args.len() == 1 {
        // Nothing to change: the copy is the file as it is.
        fs::copy(run.input, run.dest)?;
        return Ok(());
    }
    let extension = run
        .input
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_else(|| run.from.to_owned());
    let out = run.temp.join(format!("kento-metadata.{extension}"));
    // ExifTool never writes over an existing file.
    let _ = fs::remove_file(&out);
    args.extend(["-o".to_owned(), path_arg(&out)?, path_arg(run.input)?]);
    let output = exiftool::run(exiftool, &args, run.progress, None)?;
    if !output.success || !out.is_file() {
        return Err(failure(&output.stderr));
    }
    run.progress.report(0.9);
    move_file(&out, run.dest)?;
    Ok(())
}

/// Everything that can go, except what changes how the picture looks: the colour profile (kept as
/// a block) and the orientation and colour space tags (copied back), as ExifTool's documentation
/// recommends. A TIFF keeps its first IFD, which holds the picture's own layout; its other tags
/// are removed one by one.
fn remove_all(args: &mut Vec<String>, from: &str) {
    args.push("-all=".into());
    if from == "tiff" {
        args.push("-exif:ifd0:all=".into());
    }
    args.extend(
        [
            "--icc_profile:all",
            "-tagsfromfile",
            "@",
            "-colorspacetags",
            "-orientation",
        ]
        .map(str::to_owned),
    );
}

/// The assignments for the edited fields. An empty value removes the field from every family.
fn assign(
    args: &mut Vec<String>,
    change: &super::MetadataChange,
    tags: &[Tag],
    run: &MetadataRun,
) -> Result<()> {
    let present: HashMap<String, &Tag> = tags.iter().map(|tag| (tag.address(), tag)).collect();
    let exif = holds_exif(run.from);
    let mut lines = Vec::new();
    let mut iptc: Vec<&str> = Vec::new();
    for (key, value) in &change.set {
        let common = COMMON
            .iter()
            .find(|common| common.key == key)
            .expect("keys are checked");
        let primary = match common.exif {
            Some(tag) if exif => tag,
            _ => common.xmp,
        };
        let family: Vec<&str> = common
            .exif
            .filter(|_| exif)
            .into_iter()
            .chain([common.xmp])
            .chain(common.others.iter().copied())
            .collect();
        let value = value.trim();
        if value.is_empty() {
            lines.extend(family.iter().map(|tag| format!("-{tag}=")));
            continue;
        }
        let targets: Vec<&str> = family
            .iter()
            .copied()
            .filter(|tag| *tag == primary || present.contains_key(*tag))
            .collect();
        iptc.extend(targets.iter().filter(|tag| tag.starts_with("IPTC:")));
        match common.kind {
            Kind::Text => {
                for tag in &targets {
                    lines.push(text_value(tag, value, run.temp, lines.len())?);
                }
            }
            Kind::Date => {
                let date = exif_date(value).ok_or_else(|| {
                    Error::Other("the date is not a date and time Kento can read".into())
                })?;
                lines.extend(targets.iter().map(|tag| format!("-{tag}={date}")));
            }
            Kind::List => {
                let items = list_items(value);
                for tag in &targets {
                    if tag.ends_with("XPKeywords") {
                        // Windows keeps its keywords as one text, separated by semicolons.
                        lines.push(format!("-{tag}={}", items.join(";")));
                    } else {
                        lines.extend(items.iter().map(|item| format!("-{tag}={item}")));
                    }
                }
            }
        }
    }
    // IPTC text without a declared character set is read as Latin-1, where most Turkish letters
    // do not exist; as ExifTool's FAQ advises, all IPTC tags are rewritten as UTF-8 first. The
    // tags about to be written are left out of that copy, or a list would keep its old items.
    let utf8 = present
        .get("IPTC:CodedCharacterSet")
        .is_some_and(|tag| tag.value().eq_ignore_ascii_case("UTF8"));
    if !iptc.is_empty() && !utf8 {
        args.extend(["-tagsfromfile", "@", "-iptc:all"].map(str::to_owned));
        args.extend(iptc.iter().map(|tag| format!("--{tag}")));
        args.push("-IPTC:CodedCharacterSet=UTF8".to_owned());
    }
    args.extend(lines);
    Ok(())
}

/// `-TAG=value`, or `-TAG<=FILE` for a value with line breaks, which an argument file cannot
/// carry: the value goes into a file of its own in the job's temp folder.
fn text_value(tag: &str, value: &str, temp: &Path, index: usize) -> Result<String> {
    if !value.contains(['\n', '\r']) {
        return Ok(format!("-{tag}={value}"));
    }
    let file = temp.join(format!("kento-value-{index}.txt"));
    fs::write(&file, value.replace("\r\n", "\n"))?;
    Ok(format!("-{tag}<={}", path_arg(&file)?))
}

/// `a, b; c` → `[a, b, c]`, without empty or repeated items.
pub(super) fn list_items(value: &str) -> Vec<String> {
    let mut items: Vec<String> = Vec::new();
    for item in value.split([',', ';', '\n', '\r']).map(str::trim) {
        if !item.is_empty() && !items.iter().any(|known| known == item) {
            items.push(item.to_owned());
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPORT: &str = r#"[{
        "SourceFile": "C:/Fotoğraflar/Kapadokya 🎈.jpg",
        "ExifTool:ExifToolVersion": "13.60",
        "ExifTool:Warning": "[minor] Something",
        "File:System:FileName": "Kapadokya 🎈.jpg",
        "File:FileType": "JPEG",
        "File:ImageWidth": "4032",
        "EXIF:IFD0:Make": "Kento",
        "EXIF:IFD0:XResolution": "72",
        "EXIF:IFD0:Artist": "Ayşe Yılmaz",
        "EXIF:ExifIFD:DateTimeOriginal": "2024:05:01 14:30:00",
        "EXIF:GPS:GPSLatitude": "38 deg 38' 34.92\" N",
        "EXIF:IFD1:XResolution": "72",
        "XMP:XMP-dc:Subject": ["balon", "gün doğumu"],
        "XMP:XMP-dc:Title": "Göreme",
        "IPTC:ObjectName": "Eski başlık",
        "Composite:GPSPosition": "38 deg 38' 34.92\" N, 34 deg 49' 41.16\" E"
    }]"#;

    #[test]
    fn reads_every_tag_grouped_and_the_common_fields() {
        let tags = parse(REPORT.as_bytes()).unwrap();
        let info = info(&tags, "jpg");
        assert!(info.has_location);
        assert!(info.chapters.is_empty() && !info.chapters_editable);
        let value = |key: &str| {
            info.fields
                .iter()
                .find(|field| field.key == key)
                .map(|field| field.value.as_str())
        };
        assert_eq!(value("title"), Some("Göreme"));
        assert_eq!(value("author"), Some("Ayşe Yılmaz"));
        assert_eq!(value("keywords"), Some("balon, gün doğumu"));
        assert_eq!(value("date"), Some("2024-05-01 14:30:00"));
        assert_eq!(value("copyright"), Some(""));
        assert_eq!(info.fields.iter().filter(|f| f.editable).count(), 6);

        let shown: Vec<(&str, &str)> = info
            .fields
            .iter()
            .filter(|f| !f.editable)
            .map(|f| (f.group.as_str(), f.name.as_str()))
            .collect();
        assert!(shown.contains(&("EXIF", "Make")));
        assert!(shown.contains(&("EXIF", "XResolution")));
        assert!(shown.contains(&("EXIF", "XResolution (IFD1)")));
        assert!(shown.contains(&("GPS", "GPSLatitude")));
        assert!(shown.contains(&("File", "FileType")));
        assert!(shown.contains(&("IPTC", "ObjectName")));
        // Bookkeeping stays out: file system names, ExifTool's notes, derived tags.
        assert!(!shown.iter().any(|(group, name)| *group == "ExifTool"
            || *group == "Composite"
            || *name == "FileName"));
    }

    #[test]
    fn formats_exiftool_cannot_write_offer_nothing_to_edit() {
        let tags = parse(REPORT.as_bytes()).unwrap();
        for from in ["bmp", "svg"] {
            assert!(!info(&tags, from).fields.iter().any(|f| f.editable));
        }
        // GIF holds no EXIF, so its fields go to XMP.
        let gif = info(&tags, "gif");
        let author = gif.fields.iter().find(|f| f.key == "author").unwrap();
        assert_eq!(author.group, "XMP");
    }

    #[test]
    fn a_file_exiftool_cannot_read_is_unreadable() {
        let report = br#"[{"SourceFile": "x.jpg", "ExifTool:Error": "File format error"}]"#;
        assert!(matches!(parse(report), Err(Error::Unreadable(_))));
        assert!(matches!(parse(b"not json"), Err(Error::Unreadable(_))));
        assert!(matches!(parse(b"[]"), Err(Error::Unreadable(_))));
    }

    #[test]
    fn dates_are_read_the_way_people_type_them() {
        for (typed, stored) in [
            ("2024-05-01 14:30:00", "2024:05:01 14:30:00"),
            ("2024:05:01 14:30:00", "2024:05:01 14:30:00"),
            ("2024-05-01T14:30", "2024:05:01 14:30:00"),
            ("2024-05-01", "2024:05:01 00:00:00"),
            (" 2024-5-1 9:05 ", "2024:05:01 09:05:00"),
            ("2024-05-01 14:30:00+03:00", "2024:05:01 14:30:00"),
            ("2024-05-01T14:30:00Z", "2024:05:01 14:30:00"),
        ] {
            assert_eq!(exif_date(typed).as_deref(), Some(stored), "{typed}");
        }
        for wrong in [
            "",
            "dün",
            "2024-13-01",
            "2024-05-32",
            "2024-05-01 24:00",
            "24-05-01",
            "2024",
            "2024-05-01 14:30:00.123",
        ] {
            assert_eq!(exif_date(wrong), None, "{wrong}");
        }
        assert_eq!(shown_date("2024:05:01 14:30:00"), "2024-05-01 14:30:00");
        assert_eq!(shown_date("2024"), "2024");
    }

    #[test]
    fn keywords_are_split_and_cleaned() {
        assert_eq!(
            list_items(" balon, gün doğumu;balon ,, Göreme\nKapadokya "),
            ["balon", "gün doğumu", "Göreme", "Kapadokya"]
        );
        assert!(list_items(" , ;").is_empty());
    }

    #[test]
    fn remove_all_keeps_what_the_picture_looks_like() {
        let mut args = Vec::new();
        remove_all(&mut args, "jpg");
        assert_eq!(
            args,
            [
                "-all=",
                "--icc_profile:all",
                "-tagsfromfile",
                "@",
                "-colorspacetags",
                "-orientation"
            ]
        );
        let mut tiff = Vec::new();
        remove_all(&mut tiff, "tiff");
        assert_eq!(tiff[1], "-exif:ifd0:all=");
    }

    // With a real ExifTool: pictures made at run time under names with Turkish letters and an
    // emoji.

    use crate::metadata::MetadataChange;
    use crate::FileKind;
    use std::path::PathBuf;

    /// ExifTool from `KENTO_EXIFTOOL` or the PATH. Without it the checks are skipped (with a
    /// note), unless `KENTO_REQUIRE_EXIFTOOL=1`.
    fn find_exiftool() -> Option<Tools> {
        let exiftool = std::env::var_os("KENTO_EXIFTOOL")
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .or_else(|| {
                let exe = format!("exiftool{}", std::env::consts::EXE_SUFFIX);
                std::env::split_paths(&std::env::var_os("PATH")?)
                    .map(|dir| dir.join(&exe))
                    .find(|path| path.is_file())
            });
        if exiftool.is_none() {
            let required = std::env::var("KENTO_REQUIRE_EXIFTOOL").is_ok_and(|v| v == "1");
            assert!(
                !required,
                "KENTO_REQUIRE_EXIFTOOL=1 but ExifTool is missing"
            );
            eprintln!(
                "skipped the image metadata checks: no ExifTool (set KENTO_EXIFTOOL or put it \
                 on the PATH)"
            );
        }
        exiftool.map(|exiftool| Tools {
            exiftool: Some(exiftool),
            ..Tools::default()
        })
    }

    struct Lab {
        _dir: tempfile::TempDir,
        root: PathBuf,
        temp: PathBuf,
        tools: Tools,
    }

    impl Lab {
        fn new() -> Option<Lab> {
            let tools = find_exiftool()?;
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("Fotoğraflar ğ 🧪");
            let temp = dir.path().join("temp");
            fs::create_dir(&root).unwrap();
            fs::create_dir(&temp).unwrap();
            Some(Lab {
                _dir: dir,
                root,
                temp,
                tools,
            })
        }

        /// A small picture in `format`, written by the image crate.
        fn picture(&self, name: &str, format: ::image::ImageFormat) -> PathBuf {
            let path = self.root.join(name);
            let pixels = ::image::RgbImage::from_fn(32, 24, |x, y| {
                ::image::Rgb([(x * 8) as u8, (y * 10) as u8, 128])
            });
            pixels.save_with_format(&path, format).unwrap();
            path
        }

        /// Writes tags straight with ExifTool, for fixtures Kento's own fields cannot make.
        fn tag(&self, path: &Path, assignments: &[&str]) {
            let out = self.temp.join("fixture.tmp");
            let mut args: Vec<String> = assignments.iter().map(|a| a.to_string()).collect();
            args.extend([
                "-o".into(),
                path_arg(&out).unwrap(),
                path_arg(path).unwrap(),
            ]);
            let output = exiftool::run(
                self.tools.exiftool.as_ref().unwrap(),
                &args,
                &Progress::none(),
                None,
            )
            .unwrap();
            assert!(output.success, "{}", output.stderr);
            fs::rename(&out, path).unwrap();
        }

        fn read(&self, path: &Path, from: &str) -> MetadataInfo {
            crate::metadata::read(path, from, FileKind::Image, &self.tools).unwrap()
        }

        /// Writes a new copy next to the input, named the way Kento names files while it writes.
        fn write(&self, input: &Path, from: &str, change: &MetadataChange) -> Result<PathBuf> {
            let dest = (1..)
                .map(|n| self.root.join(format!(".{from} {n} - metadata.kento-part")))
                .find(|path| !path.exists())
                .unwrap();
            crate::metadata::write(&MetadataRun {
                input,
                from,
                kind: FileKind::Image,
                change,
                dest: &dest,
                temp: &self.temp,
                tools: &self.tools,
                progress: &Progress::none(),
            })?;
            Ok(dest)
        }
    }

    fn value<'a>(info: &'a MetadataInfo, key: &str) -> &'a str {
        info.fields
            .iter()
            .find(|field| field.key == key)
            .map(|field| field.value.as_str())
            .unwrap_or_default()
    }

    fn has(info: &MetadataInfo, group: &str, name: &str) -> bool {
        info.fields
            .iter()
            .any(|field| !field.editable && field.group == group && field.name == name)
    }

    #[test]
    fn edits_the_common_fields_of_a_jpeg() {
        let Some(lab) = Lab::new() else { return };
        let input = lab.picture("Kapadokya 🎈.jpg", ::image::ImageFormat::Jpeg);
        let before = fs::read(&input).unwrap();
        let info = lab.read(&input, "jpg");
        assert_eq!(info.fields.iter().filter(|f| f.editable).count(), 6);
        assert_eq!(value(&info, "title"), "");
        assert!(!info.has_location);

        let mut change = MetadataChange::default();
        change
            .set
            .insert("title".into(), "Göreme 😀 $HOME @x".into());
        change.set.insert("author".into(), "Ayşe Yılmaz".into());
        change
            .set
            .insert("description".into(), "İlk satır\nikinci satır".into());
        change.set.insert("copyright".into(), "© 2026 Ayşe".into());
        change
            .set
            .insert("keywords".into(), "balon, gün doğumu; Göreme".into());
        change.set.insert("date".into(), "2024-05-01 07:15".into());
        let edited = lab.write(&input, "jpg", &change).unwrap();
        assert_eq!(fs::read(&input).unwrap(), before, "the input is untouched");

        let info = lab.read(&edited, "jpg");
        assert_eq!(value(&info, "title"), "Göreme 😀 $HOME @x");
        assert_eq!(value(&info, "author"), "Ayşe Yılmaz");
        assert_eq!(value(&info, "description"), "İlk satır\nikinci satır");
        assert_eq!(value(&info, "copyright"), "© 2026 Ayşe");
        assert_eq!(value(&info, "keywords"), "balon, gün doğumu, Göreme");
        assert_eq!(value(&info, "date"), "2024-05-01 07:15:00");
        // EXIF where the format holds it; XMP for the fields EXIF has no tag for.
        assert!(has(&info, "EXIF", "Artist"));
        assert!(has(&info, "EXIF", "DateTimeOriginal"));
        assert!(has(&info, "XMP", "Title"));
        assert!(
            !has(&info, "XMP", "Creator"),
            "no second copy where none was"
        );

        // An empty value removes the field everywhere.
        let mut clear = MetadataChange::default();
        clear.set.insert("author".into(), String::new());
        let cleared = lab.write(&edited, "jpg", &clear).unwrap();
        let info = lab.read(&cleared, "jpg");
        assert_eq!(value(&info, "author"), "");
        assert_eq!(value(&info, "title"), "Göreme 😀 $HOME @x");

        let mut wrong = MetadataChange::default();
        wrong.set.insert("date".into(), "dün".into());
        assert!(lab.write(&input, "jpg", &wrong).is_err());
    }

    #[test]
    fn removes_the_location_or_everything_but_the_look() {
        let Some(lab) = Lab::new() else { return };
        let input = lab.picture("Konum ğ 📍.jpg", ::image::ImageFormat::Jpeg);
        lab.tag(
            &input,
            &[
                "-IFD0:Artist=Ali",
                "-IFD0:Orientation#=6",
                "-GPS:GPSLatitude=38.643",
                "-GPS:GPSLatitudeRef=N",
                "-GPS:GPSLongitude=34.828",
                "-GPS:GPSLongitudeRef=E",
                "-XMP-exif:GPSLatitude=38.643",
                "-XMP-exif:GPSLongitude=34.828",
                "-XMP-dc:Title=Başlık",
            ],
        );
        let info = lab.read(&input, "jpg");
        assert!(info.has_location);
        assert!(has(&info, "GPS", "GPSLatitude"));

        let located = MetadataChange {
            remove_location: true,
            ..MetadataChange::default()
        };
        let info = lab.read(&lab.write(&input, "jpg", &located).unwrap(), "jpg");
        assert!(!info.has_location);
        assert!(!info.fields.iter().any(|f| f.name.contains("GPS")));
        assert_eq!(value(&info, "author"), "Ali");
        assert_eq!(value(&info, "title"), "Başlık");

        let everything = MetadataChange {
            remove_all: true,
            ..MetadataChange::default()
        };
        let info = lab.read(&lab.write(&input, "jpg", &everything).unwrap(), "jpg");
        assert!(!info.has_location);
        assert!(info
            .fields
            .iter()
            .filter(|f| f.editable)
            .all(|f| f.value.is_empty()));
        let orientation = info
            .fields
            .iter()
            .find(|f| f.group == "EXIF" && f.name == "Orientation")
            .expect("the orientation stays");
        assert_eq!(orientation.value, "Rotate 90 CW");
        assert!(!has(&info, "XMP", "Title"));
    }

    #[test]
    fn writes_png_and_gif_where_they_hold_metadata() {
        let Some(lab) = Lab::new() else { return };
        for (name, from, format) in [
            ("Çizim ğ 🎨.png", "png", ::image::ImageFormat::Png),
            ("Hareket ğ 🎞.gif", "gif", ::image::ImageFormat::Gif),
        ] {
            let input = lab.picture(name, format);
            let mut change = MetadataChange::default();
            change.set.insert("title".into(), "Başlık".into());
            change.set.insert("author".into(), "Ayşe".into());
            let info = lab.read(&lab.write(&input, from, &change).unwrap(), from);
            assert_eq!(value(&info, "title"), "Başlık", "{from}");
            assert_eq!(value(&info, "author"), "Ayşe", "{from}");
            let artist_in = if from == "gif" {
                ("XMP", "Creator")
            } else {
                ("EXIF", "Artist")
            };
            assert!(has(&info, artist_in.0, artist_in.1), "{from}");
        }
        let bmp = lab.picture("Eski ğ.bmp", ::image::ImageFormat::Bmp);
        let info = lab.read(&bmp, "bmp");
        assert!(!info.fields.iter().any(|f| f.editable));
        assert!(has(&info, "File", "FileType"));
        let mut change = MetadataChange::default();
        change.set.insert("title".into(), "x".into());
        assert!(matches!(
            lab.write(&bmp, "bmp", &change),
            Err(Error::Unsupported { .. })
        ));
    }

    #[test]
    fn existing_iptc_is_kept_in_step_and_turned_into_utf8() {
        let Some(lab) = Lab::new() else { return };
        let input = lab.picture("Haber ğ 📰.jpg", ::image::ImageFormat::Jpeg);
        lab.tag(
            &input,
            &[
                "-IPTC:ObjectName=Old",
                "-IPTC:Keywords=eski",
                "-IPTC:City=Nevsehir",
                "-XMP-dc:Subject=eski",
            ],
        );
        let mut change = MetadataChange::default();
        change.set.insert("title".into(), "Yeni başlık ğüş".into());
        change.set.insert("keywords".into(), "çay, şeker".into());
        let info = lab.read(&lab.write(&input, "jpg", &change).unwrap(), "jpg");
        let iptc = |name: &str| {
            info.fields
                .iter()
                .find(|f| f.group == "IPTC" && f.name == name)
                .map(|f| f.value.as_str())
        };
        assert_eq!(iptc("ObjectName"), Some("Yeni başlık ğüş"));
        assert_eq!(iptc("Keywords"), Some("çay, şeker"));
        assert_eq!(iptc("CodedCharacterSet"), Some("UTF8"));
        assert_eq!(iptc("City"), Some("Nevsehir"), "other IPTC tags stay");
        assert_eq!(value(&info, "keywords"), "çay, şeker");
    }

    #[test]
    fn a_damaged_picture_is_unreadable() {
        let Some(lab) = Lab::new() else { return };
        let broken = lab.root.join("Bozuk ğ 💥.jpg");
        fs::write(&broken, b"\xff\xd8 not really a picture").unwrap();
        let mut change = MetadataChange::default();
        change.set.insert("title".into(), "x".into());
        let result = lab.write(&broken, "jpg", &change);
        assert!(matches!(result, Err(Error::Unreadable(_))), "{result:?}");
    }
}
