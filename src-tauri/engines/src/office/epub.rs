// SPDX-License-Identifier: MIT
//! EPUB in: LibreOffice has no EPUB import, so the book is read here (`META-INF/container.xml` →
//! the package document → its spine) into one HTML page for Writer, each chapter on a new page,
//! with its pictures inlined and anything remote taken out (`html.rs`).

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

use zip::ZipArchive;

use super::html;
use crate::text::{decode_html, escape_html};
use crate::{Error, Progress, Result};

/// Entries are read up to these sizes: XML and chapters, pictures, and everything together.
const MAX_TEXT: u64 = 64 << 20;
const MAX_PICTURE: u64 = 32 << 20;
const MAX_TOTAL: u64 = 512 << 20;
const MAX_CHAPTERS: usize = 10_000;

const CONTAINER: &str = "META-INF/container.xml";
const PACKAGE_TYPE: &str = "application/oebps-package+xml";

struct Book<R: Read + Seek> {
    zip: ZipArchive<R>,
    /// Bytes still allowed.
    left: u64,
}

impl<R: Read + Seek> Book<R> {
    fn read(&mut self, name: &str, max: u64) -> Result<Option<Vec<u8>>> {
        let mut entry = match self.zip.by_name(name) {
            Ok(entry) => entry,
            Err(zip::result::ZipError::FileNotFound) => return Ok(None),
            Err(error) => return Err(Error::Unreadable(format!("EPUB: {error}"))),
        };
        let cap = max.min(self.left);
        let mut bytes = Vec::new();
        (&mut entry).take(cap + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > cap {
            return Err(Error::Limit(format!(
                "{name} in the book is larger than {} MB",
                cap >> 20
            )));
        }
        self.left -= bytes.len() as u64;
        Ok(Some(bytes))
    }

    fn text(&mut self, name: &str) -> Result<String> {
        let bytes = self
            .read(name, MAX_TEXT)?
            .ok_or_else(|| Error::Unreadable(format!("the book has no {name}")))?;
        Ok(decode_html(&bytes))
    }
}

/// One chapter of the spine.
struct Chapter {
    path: String,
}

/// What the package document says.
struct Package {
    title: String,
    language: String,
    chapters: Vec<Chapter>,
}

/// Writes the book as one HTML page at `dest`.
pub(super) fn to_html(input: &Path, dest: &Path, progress: &Progress) -> Result<()> {
    let file = BufReader::new(File::open(input)?);
    let zip = ZipArchive::new(file)
        .map_err(|error| Error::Unreadable(format!("not an EPUB (a ZIP archive): {error}")))?;
    let mut book = Book {
        zip,
        left: MAX_TOTAL,
    };
    let page = page(&mut book, progress)?;
    std::fs::write(dest, page)?;
    Ok(())
}

fn page<R: Read + Seek>(book: &mut Book<R>, progress: &Progress) -> Result<String> {
    let container = book.text(CONTAINER)?;
    let opf_path = rootfile(&container)?;
    let opf = book.text(&opf_path)?;
    let package = package(&opf, &opf_path)?;
    if let Some(encryption) = book.read("META-INF/encryption.xml", MAX_TEXT)? {
        let encrypted = encrypted_paths(&decode_html(&encryption));
        // Fonts may be obfuscated (the standard's font mangling); chapters may not be.
        if package
            .chapters
            .iter()
            .any(|chapter| encrypted.contains(&chapter.path))
        {
            return Err(Error::Encrypted);
        }
    }
    let mut body = String::new();
    for (index, chapter) in package.chapters.iter().enumerate() {
        progress.check()?;
        let Some(bytes) = book.read(&chapter.path, MAX_TEXT)? else {
            continue;
        };
        let xhtml = decode_html(&bytes);
        let folder = folder_of(&chapter.path).to_owned();
        let mut picture = |src: &str| -> Option<String> {
            let name = resolve(&folder, src)?;
            let kind = html::picture_type(&name)?;
            let bytes = book.read(&name, MAX_PICTURE).ok()??;
            Some(html::data_url(kind, &bytes))
        };
        let content = html::clean(body_of(&xhtml), &mut picture);
        // Each chapter after the first starts a new page, as in the book.
        if index == 0 {
            body.push_str("<div>\n");
        } else {
            body.push_str("<div style=\"page-break-before: always\">\n");
        }
        body.push_str(&content);
        body.push_str("\n</div>\n");
    }
    if body.is_empty() {
        return Err(Error::Unreadable("the book has no chapters to read".into()));
    }
    let language = if package.language.is_empty() {
        String::new()
    } else {
        format!(" lang=\"{}\"", escape_html(&package.language))
    };
    Ok(format!(
        "\u{feff}<!DOCTYPE html>\n<html{language}>\n<head>\n<meta charset=\"utf-8\">\n\
         <title>{}</title>\n</head>\n<body>\n{body}</body>\n</html>\n",
        escape_html(&package.title)
    ))
}

fn xml(text: &str) -> Result<roxmltree::Document<'_>> {
    roxmltree::Document::parse(text.trim_start_matches('\u{feff}'))
        .map_err(|error| Error::Unreadable(format!("EPUB: {error}")))
}

/// The package document's path in the archive.
fn rootfile(container: &str) -> Result<String> {
    let doc = xml(container)?;
    let rootfiles: Vec<_> = doc
        .descendants()
        .filter(|node| node.tag_name().name() == "rootfile")
        .collect();
    rootfiles
        .iter()
        .find(|node| node.attribute("media-type") == Some(PACKAGE_TYPE))
        .or(rootfiles.first())
        .and_then(|node| node.attribute("full-path"))
        .map(|path| path.trim_start_matches('/').to_owned())
        .filter(|path| !path.is_empty())
        .ok_or_else(|| Error::Unreadable("the book names no package document".into()))
}

fn package(opf: &str, opf_path: &str) -> Result<Package> {
    let doc = xml(opf)?;
    let folder = folder_of(opf_path);
    let first_text = |name: &str| {
        doc.descendants()
            .find(|node| node.tag_name().name() == name)
            .and_then(|node| node.text())
            .map(|text| text.trim().to_owned())
            .unwrap_or_default()
    };
    let title = first_text("title");
    let language = first_text("language");
    let manifest: HashMap<&str, (&str, &str)> = doc
        .descendants()
        .filter(|node| node.tag_name().name() == "item")
        .filter_map(|node| {
            Some((
                node.attribute("id")?,
                (
                    node.attribute("href")?,
                    node.attribute("media-type").unwrap_or(""),
                ),
            ))
        })
        .collect();
    let mut chapters = Vec::new();
    for itemref in doc
        .descendants()
        .filter(|node| node.tag_name().name() == "itemref")
    {
        let Some(&(href, kind)) = itemref.attribute("idref").and_then(|id| manifest.get(id)) else {
            continue;
        };
        if !matches!(kind, "application/xhtml+xml" | "text/html") {
            continue;
        }
        if let Some(path) = resolve(folder, href) {
            chapters.push(Chapter { path });
        }
        if chapters.len() > MAX_CHAPTERS {
            return Err(Error::Limit(format!(
                "the book has more than {MAX_CHAPTERS} chapters"
            )));
        }
    }
    if chapters.is_empty() {
        return Err(Error::Unreadable(
            "the book's spine lists no chapters".into(),
        ));
    }
    Ok(Package {
        title,
        language,
        chapters,
    })
}

/// The archive paths that `META-INF/encryption.xml` says are encrypted.
fn encrypted_paths(encryption: &str) -> Vec<String> {
    let Ok(doc) = xml(encryption) else {
        return Vec::new();
    };
    doc.descendants()
        .filter(|node| node.tag_name().name() == "CipherReference")
        .filter_map(|node| node.attribute("URI"))
        .filter_map(|uri| resolve("", uri))
        .collect()
}

/// `OEBPS/text/` for `OEBPS/text/ch1.xhtml`.
fn folder_of(path: &str) -> &str {
    path.rfind('/').map_or("", |slash| &path[..=slash])
}

/// An archive path for `href` relative to `folder`; None when it leaves the archive or is not a
/// relative reference.
fn resolve(folder: &str, href: &str) -> Option<String> {
    let href = href.trim();
    if href.starts_with(['/', '\\', '#'])
        || href
            .find(':')
            .is_some_and(|colon| !href[..colon].contains(['/', '?', '#']))
    {
        return None;
    }
    let end = href.find(['?', '#']).unwrap_or(href.len());
    let decoded = html::percent_decode(&href[..end])?;
    let mut parts: Vec<&str> = folder.split('/').filter(|part| !part.is_empty()).collect();
    for part in decoded.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// What is inside `<body>`, or the whole document when it has none.
fn body_of(xhtml: &str) -> &str {
    let lower = xhtml.to_ascii_lowercase();
    let Some(open) = lower.find("<body") else {
        return xhtml;
    };
    let Some(start) = lower[open..].find('>').map(|end| open + end + 1) else {
        return xhtml;
    };
    let end = lower
        .rfind("</body")
        .filter(|&end| end >= start)
        .unwrap_or(xhtml.len());
    &xhtml[start..end]
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    /// A small orange PNG.
    pub(crate) fn png() -> Vec<u8> {
        let picture = ::image::RgbImage::from_pixel(8, 6, ::image::Rgb([240, 120, 20]));
        let mut bytes = Cursor::new(Vec::new());
        picture
            .write_to(&mut bytes, ::image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    /// A small EPUB 3 with two chapters in a sub-folder, a picture beside them, a stylesheet,
    /// a navigation document outside the spine and a remote picture.
    pub(crate) fn book(encrypted: Option<&str>) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file(CONTAINER, deflated).unwrap();
        zip.write_all(
            r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/içerik.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#
                .as_bytes(),
        )
        .unwrap();
        zip.start_file("OEBPS/içerik.opf", deflated).unwrap();
        zip.write_all(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">kento-test</dc:identifier>
    <dc:title>Kitap ğüşıöç 🧪</dc:title>
    <dc:language>tr</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="b1" href="metin/bir%C3%B6l%C3%BCm.xhtml" media-type="application/xhtml+xml"/>
    <item id="b2" href="metin/iki.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="stil.css" media-type="text/css"/>
    <item id="pic" href="resim/nokta.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="b1"/><itemref idref="css"/><itemref idref="b2" linear="no"/></spine>
</package>"#
                .as_bytes(),
        )
        .unwrap();
        zip.start_file("OEBPS/metin/birölüm.xhtml", deflated)
            .unwrap();
        zip.write_all(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title>
<link rel="stylesheet" href="../stil.css"/></head>
<body class="x"><h1>Birinci bölüm</h1><p>Çağrı ışığı gördü.</p>
<p><img src="../resim/nokta.png" alt="nokta"/><img src="https://example.com/uzak.png"/></p>
</body></html>"#
                .as_bytes(),
        )
        .unwrap();
        zip.start_file("OEBPS/metin/iki.xhtml", deflated).unwrap();
        zip.write_all(
            br#"<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Second</h1><p>The end.</p></body></html>"#,
        )
        .unwrap();
        zip.start_file("OEBPS/resim/nokta.png", stored).unwrap();
        zip.write_all(&png()).unwrap();
        zip.start_file("OEBPS/stil.css", deflated).unwrap();
        zip.write_all(b"h1{color:red}").unwrap();
        if let Some(path) = encrypted {
            zip.start_file("META-INF/encryption.xml", deflated).unwrap();
            zip.write_all(
                format!(
                    r#"<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
 xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:CipherData>
 <enc:CipherReference URI="{path}"/></enc:CipherData></enc:EncryptedData></encryption>"#
                )
                .as_bytes(),
            )
            .unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn read(bytes: Vec<u8>) -> Result<String> {
        let mut book = Book {
            zip: ZipArchive::new(Cursor::new(bytes)).unwrap(),
            left: MAX_TOTAL,
        };
        page(&mut book, &Progress::none())
    }

    #[test]
    fn office_epub_the_spine_becomes_one_page() {
        let page = read(book(None)).unwrap();
        assert!(page.starts_with("\u{feff}<!DOCTYPE html>"));
        assert!(page.contains("<html lang=\"tr\">"));
        assert!(page.contains("<title>Kitap ğüşıöç 🧪</title>"));
        let first = page.find("Birinci bölüm").expect("the first chapter");
        let second = page
            .find("Second")
            .expect("the second chapter, though not linear");
        assert!(first < second, "spine order");
        assert!(page.contains("<p>Çağrı ışığı gördü.</p>"));
        assert!(page.contains("<div style=\"page-break-before: always\">"));
        assert!(
            page.contains(&format!(
                "<img src=\"data:image/png;base64,{}\" alt=\"nokta\" />",
                super::super::base64(&png())
            )),
            "the picture is inlined: {page}"
        );
        assert!(!page.contains("example.com"), "remote pictures go");
        assert!(!page.contains("stil.css"), "the stylesheet link goes");
        assert!(!page.contains("<?xml"), "only the bodies are taken");
    }

    #[test]
    fn office_epub_encrypted_chapters_are_refused() {
        assert!(matches!(
            read(book(Some("OEBPS/metin/iki.xhtml"))),
            Err(Error::Encrypted)
        ));
        // Obfuscated fonts are no reason to refuse a book.
        assert!(read(book(Some("OEBPS/fonts/a.otf"))).is_ok());
    }

    #[test]
    fn office_epub_broken_books_are_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("kırık 🧪.epub");
        std::fs::write(&path, b"not a zip").unwrap();
        let dest = dir.path().join("out.html");
        assert!(matches!(
            to_html(&path, &dest, &Progress::none()),
            Err(Error::Unreadable(_))
        ));
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("mimetype", SimpleFileOptions::default())
            .unwrap();
        let empty = zip.finish().unwrap().into_inner();
        assert!(matches!(read(empty), Err(Error::Unreadable(_))));
    }

    #[test]
    fn office_epub_paths_resolve_inside_the_book() {
        assert_eq!(
            resolve("OEBPS/text/", "ch%201.xhtml#x").unwrap(),
            "OEBPS/text/ch 1.xhtml"
        );
        assert_eq!(
            resolve("OEBPS/text/", "../img/a.png").unwrap(),
            "OEBPS/img/a.png"
        );
        assert_eq!(resolve("", "../../a.png"), None);
        assert_eq!(resolve("OEBPS/", "https://example.com/a.png"), None);
        assert_eq!(resolve("OEBPS/", "/abs.png"), None);
        assert_eq!(folder_of("OEBPS/text/ch1.xhtml"), "OEBPS/text/");
        assert_eq!(folder_of("ch1.xhtml"), "");
        assert_eq!(
            body_of("<html><BODY a=1>x<p>y</p></Body></html>"),
            "x<p>y</p>"
        );
        assert_eq!(body_of("<p>no body</p>"), "<p>no body</p>");
    }
}
