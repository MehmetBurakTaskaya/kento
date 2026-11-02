// SPDX-License-Identifier: MIT
//! PDF through `lopdf`: the document information dictionary (Title, Author, Subject, Keywords,
//! Creator, Producer, the dates and any other entries) and whether an XMP metadata stream exists.
//! The result is always a complete new file, never an incremental update, which would keep the
//! old values in the file for anyone to recover. Encrypted documents are refused, as everywhere
//! in Kento.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use lopdf::{decode_text_string, text_string, Dictionary, Document, LoadOptions, Object, ObjectId};

use super::{check_keys, editable, shown, MetadataInfo, MetadataRun};
use crate::{Error, Result};

/// Decompression of object and cross-reference streams while loading stops here.
const MAX_STREAM: usize = 512 << 20;

/// The editable entries: stable key and the entry's name in the dictionary.
const EDITABLE: [(&str, &str); 6] = [
    ("title", "Title"),
    ("author", "Author"),
    ("subject", "Subject"),
    ("keywords", "Keywords"),
    ("creator", "Creator"),
    ("producer", "Producer"),
];

fn load(path: &Path) -> Result<Document> {
    let options = LoadOptions {
        max_decompressed_size: Some(MAX_STREAM),
        ..LoadOptions::default()
    };
    let doc = Document::load_with_options(path, options).map_err(|error| match error {
        lopdf::Error::IO(error) => Error::Io(error),
        lopdf::Error::InvalidPassword | lopdf::Error::Decryption(_) => Error::Encrypted,
        other => Error::Unreadable(other.to_string()),
    })?;
    // A file with only an owner password opens, but a copy would drop its permissions.
    if doc.is_encrypted() || doc.was_encrypted() {
        return Err(Error::Encrypted);
    }
    Ok(doc)
}

/// Where the information dictionary is: an object of its own (as usual) or inside the trailer.
fn info_id(doc: &Document) -> Option<ObjectId> {
    doc.trailer.get(b"Info").and_then(Object::as_reference).ok()
}

fn info(doc: &Document) -> Option<&Dictionary> {
    match doc.trailer.get(b"Info").ok()? {
        Object::Reference(id) => doc.get_dictionary(*id).ok(),
        Object::Dictionary(dict) => Some(dict),
        _ => None,
    }
}

/// An entry's value as text: strings decoded (PDFDocEncoding, UTF-16 or UTF-8), names as they are.
fn value_text(doc: &Document, object: &Object) -> String {
    let object = match object {
        Object::Reference(id) => match doc.get_object(*id) {
            Ok(object) => object,
            Err(_) => return String::new(),
        },
        other => other,
    };
    match object {
        Object::String(..) => decode_text_string(object).unwrap_or_else(|_| {
            String::from_utf8_lossy(object.as_str().unwrap_or_default()).into()
        }),
        Object::Name(name) => String::from_utf8_lossy(name).into_owned(),
        Object::Boolean(value) => value.to_string(),
        Object::Integer(value) => value.to_string(),
        Object::Real(value) => value.to_string(),
        Object::Array(items) => items
            .iter()
            .map(|item| value_text(doc, item))
            .collect::<Vec<_>>()
            .join(", "),
        _ => String::new(),
    }
}

pub(super) fn read(path: &Path) -> Result<MetadataInfo> {
    let doc = load(path)?;
    let entries: Vec<(String, String)> = info(&doc)
        .map(|dict| {
            dict.iter()
                .map(|(name, value)| {
                    (
                        String::from_utf8_lossy(name).into_owned(),
                        value_text(&doc, value),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let mut fields: Vec<_> = EDITABLE
        .iter()
        .map(|(key, name)| {
            let value = entries
                .iter()
                .find(|(entry, _)| entry == name)
                .map(|(_, value)| value.clone())
                .unwrap_or_default();
            editable(key, "PDF", name, value)
        })
        .collect();
    for (name, value) in &entries {
        let value = if name.ends_with("Date") {
            shown_date(value)
        } else {
            value.clone()
        };
        fields.push(shown(format!("pdf:{name}"), "PDF", name, &value));
    }
    fields.push(shown(
        "pdf:version".into(),
        "Document",
        "Version",
        &doc.version,
    ));
    fields.push(shown(
        "pdf:pages".into(),
        "Document",
        "Pages",
        &doc.get_pages().len().to_string(),
    ));
    if let Some(bytes) = xmp_size(&doc) {
        fields.push(shown(
            "pdf:xmp".into(),
            "XMP",
            "Metadata",
            &format!("{bytes} B"),
        ));
    }
    Ok(MetadataInfo {
        fields,
        chapters: Vec::new(),
        has_location: false,
        chapters_editable: false,
    })
}

/// The size of the catalog's XMP metadata stream, when there is one.
fn xmp_size(doc: &Document) -> Option<usize> {
    let id = doc
        .catalog()
        .ok()?
        .get(b"Metadata")
        .and_then(Object::as_reference)
        .ok()?;
    match doc.get_object(id).ok()? {
        Object::Stream(stream) => Some(stream.content.len()),
        _ => None,
    }
}

/// `D:20240501143000+03'00'` → `2024-05-01 14:30:00 +03:00`; anything else stays as it is.
fn shown_date(value: &str) -> String {
    let text = value.strip_prefix("D:").unwrap_or(value);
    let digits: String = text.chars().take_while(char::is_ascii_digit).collect();
    if digits.len() < 4 {
        return value.to_owned();
    }
    let part = |from: usize, to: usize, default: &str| -> String {
        digits.get(from..to).unwrap_or(default).to_owned()
    };
    let mut out = format!(
        "{}-{}-{} {}:{}:{}",
        part(0, 4, "0000"),
        part(4, 6, "01"),
        part(6, 8, "01"),
        part(8, 10, "00"),
        part(10, 12, "00"),
        part(12, 14, "00")
    );
    let zone = &text[digits.len()..];
    if zone.starts_with('Z') {
        out.push_str(" UTC");
    } else if let Some(sign) = zone.chars().next().filter(|c| *c == '+' || *c == '-') {
        let numbers: String = zone.chars().filter(char::is_ascii_digit).collect();
        if numbers.len() >= 2 {
            let minutes = numbers.get(2..4).unwrap_or("00");
            out.push_str(&format!(" {sign}{}:{minutes}", &numbers[..2]));
        }
    }
    out
}

pub(super) fn write(run: &MetadataRun) -> Result<()> {
    let change = run.change;
    let keys: Vec<&str> = EDITABLE.iter().map(|(key, _)| *key).collect();
    check_keys(change, &keys)?;
    if change
        .chapters
        .as_ref()
        .is_some_and(|list| !list.is_empty())
    {
        return Err(Error::Other("PDF files have no chapters".into()));
    }
    let mut doc = load(run.input)?;
    run.progress.check()?;
    run.progress.report(0.4);
    if change.remove_all {
        remove_all(&mut doc);
    } else if !change.set.is_empty() {
        let dict = info_mut(&mut doc);
        for (key, value) in &change.set {
            let name = EDITABLE
                .iter()
                .find(|(known, _)| known == key)
                .map(|(_, name)| *name)
                .expect("keys are checked");
            let value = value.trim();
            if value.is_empty() {
                dict.remove(name.as_bytes());
            } else {
                dict.set(name, text_string(value));
            }
        }
        // Readers that know both prefer the newer of this dictionary and the XMP stream.
        dict.set(
            "ModDate",
            Object::string_literal(pdf_date(SystemTime::now())),
        );
    }
    run.progress.report(0.6);
    let mut file = BufWriter::new(File::create(run.dest)?);
    doc.save_to(&mut file)?;
    file.flush()?;
    Ok(())
}

/// The information dictionary to edit, created when the file has none.
fn info_mut(doc: &mut Document) -> &mut Dictionary {
    let id = match info_id(doc) {
        Some(id) if doc.get_dictionary(id).is_ok() => id,
        _ => {
            // A dictionary inside the trailer moves into an object of its own.
            let inline = match doc.trailer.get(b"Info") {
                Ok(Object::Dictionary(dict)) => dict.clone(),
                _ => Dictionary::new(),
            };
            let id = doc.add_object(inline);
            doc.trailer.set("Info", id);
            id
        }
    };
    doc.get_dictionary_mut(id)
        .expect("the dictionary was just found or made")
}

/// Drops the information dictionary and the catalog's XMP stream, the objects as well as the
/// references, so nothing of them reaches the new file.
fn remove_all(doc: &mut Document) {
    if let Some(id) = info_id(doc) {
        doc.objects.remove(&id);
    }
    doc.trailer.remove(b"Info");
    let metadata = doc
        .catalog()
        .ok()
        .and_then(|catalog| catalog.get(b"Metadata").and_then(Object::as_reference).ok());
    if let Ok(catalog) = doc.catalog_mut() {
        catalog.remove(b"Metadata");
    }
    if let Some(id) = metadata {
        doc.objects.remove(&id);
    }
}

/// A PDF date in UTC, `D:20240501143000Z`.
fn pdf_date(time: SystemTime) -> String {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    let days = (seconds / 86_400) as i64;
    let rest = seconds % 86_400;
    let (year, month, day) = civil(days);
    format!(
        "D:{year:04}{month:02}{day:02}{:02}{:02}{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// The calendar date `days` after 1970-01-01 (proleptic Gregorian).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::{MetadataChange, MetadataInfo};
    use crate::{FileKind, Progress, Tools};
    use lopdf::{dictionary, Stream, StringFormat};
    use std::path::PathBuf;

    const NAME: &str = "Belge ğüşıöç 🧪";

    /// A one-page document with an information dictionary (a Latin title, a Turkish author in
    /// UTF-16, dates, a custom entry) and an XMP stream.
    fn fixture(path: &Path) {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let content = doc.add_object(Stream::new(dictionary! {}, b"BT ET".to_vec()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 200.into(), 200.into()],
            "Contents" => content,
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page.into()],
                "Count" => 1,
            }),
        );
        let xmp = doc.add_object(Stream::new(
            dictionary! { "Type" => "Metadata", "Subtype" => "XML" },
            b"<x:xmpmeta xmlns:x='adobe:ns:meta/'><dc:title>Eski</dc:title></x:xmpmeta>".to_vec(),
        ));
        let catalog = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
            "Metadata" => xmp,
        });
        let info = doc.add_object(dictionary! {
            "Title" => Object::String(b"Old title".to_vec(), StringFormat::Literal),
            "Author" => text_string("Ayşe Yılmaz"),
            "Producer" => Object::String(b"Kento fixture".to_vec(), StringFormat::Literal),
            "CreationDate" => Object::string_literal("D:20240501143000+03'00'"),
            "Company" => text_string("Örnek A.Ş."),
            "Trapped" => Object::Name(b"False".to_vec()),
        });
        doc.trailer.set("Root", catalog);
        doc.trailer.set("Info", info);
        doc.save(path).unwrap();
    }

    fn value<'a>(info: &'a MetadataInfo, key: &str) -> Option<&'a str> {
        info.fields
            .iter()
            .find(|field| field.key == key)
            .map(|field| field.value.as_str())
    }

    fn edit(input: &Path, dest: &Path, change: &MetadataChange) -> Result<Vec<PathBuf>> {
        let temp = tempfile::tempdir().unwrap();
        crate::metadata::write(&MetadataRun {
            input,
            from: "pdf",
            kind: FileKind::Pdf,
            change,
            dest,
            temp: temp.path(),
            tools: &Tools::default(),
            progress: &Progress::none(),
        })
    }

    fn read(path: &Path) -> MetadataInfo {
        crate::metadata::read(path, "pdf", FileKind::Pdf, &Tools::default()).unwrap()
    }

    #[test]
    fn reads_the_information_dictionary_and_the_xmp_stream() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join(format!("{NAME}.pdf"));
        fixture(&input);
        let info = read(&input);
        assert_eq!(value(&info, "title"), Some("Old title"));
        assert_eq!(value(&info, "author"), Some("Ayşe Yılmaz"));
        assert_eq!(value(&info, "subject"), Some(""));
        assert_eq!(info.fields.iter().filter(|f| f.editable).count(), 6);
        assert_eq!(
            value(&info, "pdf:CreationDate"),
            Some("2024-05-01 14:30:00 +03:00")
        );
        assert_eq!(value(&info, "pdf:Company"), Some("Örnek A.Ş."));
        assert_eq!(value(&info, "pdf:Trapped"), Some("False"));
        assert_eq!(value(&info, "pdf:pages"), Some("1"));
        assert!(value(&info, "pdf:xmp").is_some_and(|v| v.ends_with(" B")));
        assert!(!info.has_location && !info.chapters_editable);
    }

    #[test]
    fn edits_fields_into_a_complete_new_file() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join(format!("{NAME}.pdf"));
        fixture(&input);
        let before = std::fs::read(&input).unwrap();
        let dest = dir
            .path()
            .join(format!(".{NAME} - metadata.pdf.kento-part"));
        let mut change = MetadataChange::default();
        change.set.insert("title".into(), "Yeni başlık 😀".into());
        change.set.insert("author".into(), "  ".into());
        change.set.insert("keywords".into(), "rapor, 2026".into());
        assert_eq!(
            edit(&input, &dest, &change).unwrap(),
            std::slice::from_ref(&dest)
        );
        assert_eq!(
            std::fs::read(&input).unwrap(),
            before,
            "the input is untouched"
        );

        let info = read(&dest);
        assert_eq!(value(&info, "title"), Some("Yeni başlık 😀"));
        assert_eq!(value(&info, "author"), Some(""));
        assert_eq!(value(&info, "keywords"), Some("rapor, 2026"));
        assert_eq!(value(&info, "producer"), Some("Kento fixture"));
        assert!(value(&info, "pdf:ModDate").is_some_and(|v| v.ends_with("UTC")));
        // A full rewrite: the old title is gone from the bytes, not only from the dictionary.
        let bytes = std::fs::read(&dest).unwrap();
        assert!(!bytes.windows(9).any(|w| w == b"Old title"));
        assert_eq!(bytes.windows(9).filter(|w| *w == b"startxref").count(), 1);

        let mut unknown = MetadataChange::default();
        unknown.set.insert("artist".into(), "x".into());
        assert!(edit(&input, &dir.path().join("x.pdf"), &unknown).is_err());
    }

    #[test]
    fn remove_all_drops_the_dictionary_and_the_xmp_stream() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join(format!("{NAME}.pdf"));
        fixture(&input);
        let dest = dir.path().join(format!("{NAME} - metadata.pdf"));
        let change = MetadataChange {
            remove_all: true,
            ..MetadataChange::default()
        };
        edit(&input, &dest, &change).unwrap();
        let info = read(&dest);
        assert!(info
            .fields
            .iter()
            .all(|f| !f.key.starts_with("pdf:") || f.key == "pdf:version" || f.key == "pdf:pages"));
        assert!(info
            .fields
            .iter()
            .filter(|f| f.editable)
            .all(|f| f.value.is_empty()));
        let bytes = std::fs::read(&dest).unwrap();
        for gone in [&b"Company"[..], b"xmpmeta", b"Kento fixture"] {
            assert!(!bytes.windows(gone.len()).any(|w| w == gone));
        }
        // Still a document with its page.
        assert_eq!(load(&dest).unwrap().get_pages().len(), 1);
    }

    #[test]
    fn a_file_without_information_gets_a_dictionary() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("bare.pdf");
        fixture(&input);
        let bare = dir.path().join("bare 2.pdf");
        edit(
            &input,
            &bare,
            &MetadataChange {
                remove_all: true,
                ..MetadataChange::default()
            },
        )
        .unwrap();
        let dest = dir.path().join("titled.pdf");
        let mut change = MetadataChange::default();
        change.set.insert("subject".into(), "Konu".into());
        edit(&bare, &dest, &change).unwrap();
        assert_eq!(value(&read(&dest), "subject"), Some("Konu"));
    }

    #[test]
    fn encrypted_files_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join(format!("{NAME} şifreli.pdf"));
        fixture(&input);
        let mut doc = Document::load(&input).unwrap();
        let id = Object::String(b"kento-metadata-id".to_vec(), StringFormat::Hexadecimal);
        doc.trailer.set("ID", vec![id.clone(), id]);
        let state = lopdf::EncryptionState::try_from(lopdf::EncryptionVersion::V2 {
            document: &doc,
            owner_password: "owner",
            user_password: "",
            key_length: 128,
            permissions: lopdf::Permissions::PRINTABLE,
        })
        .unwrap();
        doc.encrypt(&state).unwrap();
        doc.save(&input).unwrap();
        let read = crate::metadata::read(&input, "pdf", FileKind::Pdf, &Tools::default());
        assert!(matches!(read, Err(Error::Encrypted)), "{read:?}");
        let dest = dir.path().join("out.pdf");
        let written = edit(&input, &dest, &MetadataChange::default());
        assert!(matches!(written, Err(Error::Encrypted)), "{written:?}");
    }

    #[test]
    fn dates_are_shown_and_written_readably() {
        assert_eq!(shown_date("D:20240501143000Z"), "2024-05-01 14:30:00 UTC");
        assert_eq!(shown_date("D:20240501"), "2024-05-01 00:00:00");
        assert_eq!(shown_date("D:2024"), "2024-01-01 00:00:00");
        assert_eq!(
            shown_date("D:20240501143000-05'30'"),
            "2024-05-01 14:30:00 -05:30"
        );
        assert_eq!(shown_date("yesterday"), "yesterday");
        assert_eq!(pdf_date(UNIX_EPOCH), "D:19700101000000Z");
        let leap = UNIX_EPOCH + std::time::Duration::from_secs(1_709_208_000);
        assert_eq!(pdf_date(leap), "D:20240229120000Z");
    }
}
