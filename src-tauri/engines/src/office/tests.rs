// SPDX-License-Identifier: MIT
//! The routes, and real conversions through LibreOffice. Every fixture is made at run time, most
//! by LibreOffice itself from HTML, CSV or flat ODP written here, under folder and file names with
//! Turkish letters and an emoji (the profile's folder too). Without LibreOffice the real checks
//! are skipped with a note, unless `KENTO_REQUIRE_SOFFICE=1`; LibreOffice is found through
//! `KENTO_SOFFICE`, the PATH or its usual install folders.

use std::env;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use calamine::{open_workbook, Data, Ods, Reader, Xlsx};
use zip::ZipArchive;

use super::*;
use crate::{Codec, Conversion, Error, Options, Output, Progress, Tools};

const NAME: &str = "Kento ğüşıöç 🧪";

#[test]
fn office_routes_are_the_ones_no_other_engine_takes() {
    for (from, to) in [
        ("docx", "pdf"),
        ("doc", "odt"),
        ("odt", "md"),
        ("rtf", "docx"),
        ("rtfd", "pdf"),
        ("pages", "docx"),
        ("txt", "pdf"),
        ("md", "docx"),
        ("html", "epub"),
        ("textclipping", "docx"),
        ("epub", "docx"),
        ("xlsx", "ods"),
        ("xls", "pdf"),
        ("csv", "ods"),
        ("numbers", "tsv"),
        ("numbers", "xlsx"),
        ("ppt", "pptx"),
        ("odp", "jpg"),
        ("key", "png"),
        ("pdf", "pptx"),
        ("pdf", "docx"),
        ("pdf", "epub"),
        ("pdf", "html"),
    ] {
        assert!(supports(from, to), "{from} → {to}");
        assert!(crate::heavy(from, to), "{from} → {to} runs one at a time");
    }
    for (from, to) in [
        ("docx", "docx"),
        ("pptx", "pptx"),
        ("txt", "md"),
        ("md", "html"),
        ("html", "txt"),
        ("textclipping", "txt"),
        ("csv", "xlsx"),
        ("xlsx", "csv"),
        ("ods", "html"),
        ("pdf", "xlsx"),
        ("pdf", "png"),
        ("pdf", "txt"),
        ("pptx", "docx"),
        ("docx", "xlsx"),
        ("png", "pdf"),
        ("epub", "pages"),
    ] {
        assert!(!supports(from, to), "{from} → {to}");
    }
    assert!(!crate::heavy("txt", "md"));
    assert_eq!(output("pptx", "png"), Output::Folder);
    assert_eq!(output("odp", "jpg"), Output::Folder);
    assert_eq!(output("pdf", "pptx"), Output::File);
    assert_eq!(output("docx", "pdf"), Output::File);
    assert_eq!(crate::output("key", "jpg"), Some(Output::Folder));
}

#[test]
fn office_filters_follow_libreoffices_names() {
    let argument = |app, to| {
        let export = export(app, to);
        format!("{}:{}", export.extension, export.filter)
    };
    assert_eq!(argument(App::Writer, "pdf"), "pdf:writer_pdf_Export");
    assert_eq!(argument(App::Writer, "docx"), "docx:MS Word 2007 XML");
    assert_eq!(argument(App::Writer, "txt"), "txt:Text (encoded):UTF8");
    assert_eq!(
        argument(App::Writer, "html"),
        "html:HTML (StarWriter):EmbedImages"
    );
    assert_eq!(argument(App::Writer, "md"), "html:HTML (StarWriter)");
    assert_eq!(argument(App::Writer, "epub"), "epub:EPUB");
    assert_eq!(argument(App::Calc, "ods"), "ods:calc8");
    assert_eq!(
        argument(App::Calc, "tsv"),
        "csv:Text - txt - csv (StarCalc):9,34,76,1,,1033,false,true,true,false,false"
    );
    assert_eq!(argument(App::Impress, "png"), "pdf:impress_pdf_Export");
    assert_eq!(
        argument(App::Impress, "pptx"),
        "pptx:Impress MS PowerPoint 2007 XML"
    );
    // Formulas stay text (the 13th place), and the separator decides the decimal mark.
    for delimiter in *b",;\t|" {
        let options = csv_import(delimiter);
        let places: Vec<&str> = options
            .trim_start_matches("Text - txt - csv (StarCalc):")
            .split(',')
            .collect();
        assert_eq!(places.len(), 13, "{options}");
        assert_eq!(places[0], u32::from(delimiter).to_string());
        assert_eq!(places[2], "76", "UTF-8");
        assert_eq!(places[12], "false", "no formulas");
        assert_eq!(places[5], if delimiter == b';' { "1031" } else { "1033" });
    }
}

#[test]
fn office_without_libreoffice_jobs_ask_for_it() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join(format!("{NAME}.docx"));
    fs::write(&input, b"PK\x03\x04").unwrap();
    let options = Options::default();
    let progress = Progress::none();
    let result = crate::convert(&Conversion {
        input: &input,
        from: "docx",
        to: "pdf",
        dest: &dir.path().join("out.pdf"),
        temp: dir.path(),
        options: &options,
        progress: &progress,
    });
    assert!(
        matches!(result, Err(Error::MissingCodec(Codec::LibreOffice))),
        "{result:?}"
    );
    assert!(matches!(
        warm_up(&Tools::default(), &dir.path().join("profile")),
        Err(Error::MissingCodec(Codec::LibreOffice))
    ));
}

#[test]
fn office_base64_matches_the_standard() {
    assert_eq!(base64(b""), "");
    assert_eq!(base64(b"f"), "Zg==");
    assert_eq!(base64(b"fo"), "Zm8=");
    assert_eq!(base64(b"foo"), "Zm9v");
    assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    assert_eq!(base64(&[0xFF, 0xEE, 0x80]), "/+6A");
}

// Real conversions -------------------------------------------------------------------------------

/// LibreOffice from `KENTO_SOFFICE`, the PATH, or where its installers put it.
fn find_soffice() -> Option<PathBuf> {
    let program = if cfg!(windows) {
        "soffice.exe"
    } else {
        "soffice"
    };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = env::var_os("KENTO_SOFFICE") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|dir| dir.join(program)));
    }
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(dir) = env::var_os(var) {
                candidates.push(
                    PathBuf::from(dir)
                        .join("LibreOffice")
                        .join("program")
                        .join(program),
                );
            }
        }
    } else if cfg!(target_os = "macos") {
        candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice".into());
    } else {
        candidates.push("/usr/bin/soffice".into());
        candidates.push("/usr/lib/libreoffice/program/soffice".into());
    }
    let found = candidates.into_iter().find(|path| path.is_file());
    if found.is_none() {
        let required = env::var("KENTO_REQUIRE_SOFFICE").is_ok_and(|v| v == "1");
        assert!(
            !required,
            "KENTO_REQUIRE_SOFFICE=1 but LibreOffice is missing"
        );
        eprintln!(
            "skipped the LibreOffice checks: no soffice (set KENTO_SOFFICE or install LibreOffice)"
        );
    }
    found
}

/// PDFium from `KENTO_PDFIUM` or `src-tauri/resources/pdfium`, for the routes through PDF.
fn pdfium() -> bool {
    let path = env::var_os("KENTO_PDFIUM")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../resources/pdfium")
                .join(pdfium_render::prelude::Pdfium::pdfium_platform_library_name())
        });
    if !path.is_file() {
        let required = env::var("KENTO_REQUIRE_PDFIUM").is_ok_and(|v| v == "1");
        assert!(!required, "KENTO_REQUIRE_PDFIUM=1 but PDFium is missing");
        eprintln!("skipped the LibreOffice checks through PDF: no PDFium");
        return false;
    }
    crate::pdf::init(&path).expect("PDFium loads");
    true
}

/// The real checks run one after another: each starts LibreOffice with a profile of its own.
static SERIAL: Mutex<()> = Mutex::new(());

/// A scratch folder with Turkish letters and an emoji in its name, LibreOffice and a profile.
struct Lab {
    _serial: MutexGuard<'static, ()>,
    _dir: tempfile::TempDir,
    root: PathBuf,
    soffice: PathBuf,
    profile: PathBuf,
}

impl Lab {
    fn new() -> Option<Lab> {
        let soffice = find_soffice()?;
        let serial = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Klasör ğ 🧪");
        fs::create_dir(&root).unwrap();
        let profile = root.join("Profil şü 🧪");
        Some(Lab {
            _serial: serial,
            _dir: dir,
            root,
            soffice,
            profile,
        })
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn write(&self, name: &str, bytes: impl AsRef<[u8]>) -> PathBuf {
        let path = self.path(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    fn options(&self) -> Options {
        Options {
            tools: Tools {
                soffice: Some(self.soffice.clone()),
                ..Tools::default()
            },
            office_profile: Some(self.profile.clone()),
            ..Options::default()
        }
    }

    /// Where a conversion writes: a fresh file named the way Kento names files while it writes
    /// them, or a new empty folder.
    fn dest(&self, input: &Path, to: &str, output: Output) -> PathBuf {
        let stem = input.file_stem().unwrap().to_string_lossy().into_owned();
        let mut n = 1;
        loop {
            let name = format!(".{stem} {n}.{to}.kento-part");
            let path = self.path(&name);
            if !path.exists() {
                if output == Output::Folder {
                    fs::create_dir(&path).unwrap();
                }
                return path;
            }
            n += 1;
        }
    }

    fn try_convert(
        &self,
        input: &Path,
        from: &str,
        to: &str,
        progress: &Progress,
    ) -> crate::Result<(PathBuf, Vec<PathBuf>)> {
        let output = crate::output(from, to).unwrap_or(Output::File);
        let dest = self.dest(input, to, output);
        let temp = tempfile::tempdir_in(&self.root).unwrap();
        let options = self.options();
        let written = crate::convert(&Conversion {
            input,
            from,
            to,
            dest: &dest,
            temp: temp.path(),
            options: &options,
            progress,
        })?;
        Ok((dest, written))
    }

    /// A route as the app runs it; the input stays as it was.
    fn convert(&self, input: &Path, from: &str, to: &str) -> PathBuf {
        let before = fs::metadata(input).map(|meta| meta.len()).ok();
        let (dest, written) = self
            .try_convert(input, from, to, &Progress::none())
            .unwrap_or_else(|error| panic!("{from} → {to}: {error}"));
        assert!(!written.is_empty(), "{from} → {to} wrote nothing");
        assert_eq!(
            fs::metadata(input).map(|meta| meta.len()).ok(),
            before,
            "the input must not change"
        );
        dest
    }

    /// LibreOffice's filters for a pair Kento sends elsewhere (a NUMBERS file would take them).
    fn office(&self, input: &Path, from: &str, to: &str) -> PathBuf {
        let dest = self.dest(input, to, Output::File);
        let temp = tempfile::tempdir_in(&self.root).unwrap();
        let options = self.options();
        let progress = Progress::none();
        run(&Conversion {
            input,
            from,
            to,
            dest: &dest,
            temp: temp.path(),
            options: &options,
            progress: &progress,
        })
        .unwrap_or_else(|error| panic!("{from} → {to}: {error}"));
        dest
    }

    /// The text of a document, through Kento's route to TXT.
    fn text(&self, path: &Path, from: &str) -> String {
        let txt = self.convert(path, from, "txt");
        fs::read_to_string(txt).unwrap()
    }
}

fn entry(path: &Path, name: &str) -> String {
    let mut zip = ZipArchive::new(File::open(path).unwrap()).unwrap();
    let mut text = String::new();
    zip.by_name(name)
        .unwrap_or_else(|_| panic!("{name} in {}", path.display()))
        .read_to_string(&mut text)
        .unwrap();
    text
}

fn entries(path: &Path) -> Vec<String> {
    let zip = ZipArchive::new(File::open(path).unwrap()).unwrap();
    zip.file_names()
        .map(|name| name.unwrap().into_owned())
        .collect()
}

fn has(text: &str, needle: &str) {
    assert!(text.contains(needle), "{needle:?} is not in:\n{text}");
}

const PAGE: &str =
    "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><title>Deneme</title></head>\
<body>\n<h1>Başlık ğüşıöç</h1>\n<p>Çağrı <b>kalın</b> yazı yazdı. Kento 🧪</p>\n\
<ul><li>birinci madde</li><li>ikinci madde</li></ul>\n\
<p><img src=\"https://example.invalid/uzak.png\" alt=\"uzak\"></p>\n\
<p style=\"page-break-before: always\">İkinci sayfa</p>\n</body></html>\n";

#[test]
fn office_writer_documents() {
    let Some(lab) = Lab::new() else { return };
    let html = lab.write(&format!("{NAME}.html"), PAGE);
    let docx = lab.convert(&html, "html", "docx");
    let names = entries(&docx);
    assert!(names.contains(&"word/document.xml".to_owned()));
    let document = entry(&docx, "word/document.xml");
    has(&document, "ğüşıöç");
    let relations = entry(&docx, "word/_rels/document.xml.rels");
    assert!(
        !document.contains("example.invalid") && !relations.contains("example.invalid"),
        "a remote picture never reaches LibreOffice"
    );

    let text = lab.text(&docx, "docx");
    has(&text, "Başlık ğüşıöç");
    has(&text, "Çağrı kalın yazı yazdı. Kento 🧪");
    has(&text, "ikinci madde");
    assert!(!text.starts_with('\u{feff}'), "no byte order mark");

    let odt = lab.convert(&docx, "docx", "odt");
    has(
        &entry(&odt, "mimetype"),
        "application/vnd.oasis.opendocument.text",
    );
    has(&lab.text(&odt, "odt"), "Çağrı kalın yazı yazdı.");

    let rtf = lab.convert(&odt, "odt", "rtf");
    assert!(fs::read(&rtf).unwrap().starts_with(b"{\\rtf"));
    has(&lab.text(&rtf, "rtf"), "İkinci sayfa");

    let page = lab.convert(&docx, "docx", "html");
    let page_text = lab.text(&page, "html");
    has(&page_text, "Çağrı kalın yazı yazdı.");

    let markdown = fs::read_to_string(lab.convert(&docx, "docx", "md")).unwrap();
    assert!(
        markdown
            .lines()
            .any(|line| line.starts_with('#') && line.contains("Başlık ğüşıöç")),
        "the heading stays a heading:\n{markdown}"
    );
    has(&markdown, "kalın");
    assert!(
        !markdown.contains("<img") && !markdown.contains("!["),
        "{markdown}"
    );

    // EPUB out, and back in through Kento's own reader.
    let epub = lab.convert(&docx, "docx", "epub");
    assert_eq!(entry(&epub, "mimetype").trim(), "application/epub+zip");
    has(&lab.text(&epub, "epub"), "Çağrı kalın yazı yazdı.");

    if pdfium() {
        let pdf = lab.convert(&docx, "docx", "pdf");
        assert_eq!(
            crate::pdf::page_count(&pdf).unwrap(),
            2,
            "the page break stays"
        );
        let pdf_text = lab.text(&pdf, "pdf");
        has(&pdf_text, "Başlık ğüşıöç");
        has(&pdf_text, "İkinci sayfa");
    }
}

#[test]
fn office_text_inputs_go_through_kentos_own_steps() {
    let Some(lab) = Lab::new() else { return };
    // Windows-1254, as an old Turkish Notepad file.
    let (bytes, _, _) =
        encoding_rs::WINDOWS_1254.encode("Eski dosya: ğüşıöç İĞ\r\nikinci satır\r\n");
    let txt = lab.write(&format!("{NAME}.txt"), bytes);
    let odt = lab.convert(&txt, "txt", "odt");
    let text = lab.text(&odt, "odt");
    has(&text, "Eski dosya: ğüşıöç İĞ");
    has(&text, "ikinci satır");

    let md = lab.write(
        &format!("{NAME}.md"),
        "# Not başlığı\n\nBir **kalın** söz ve [bağlantı](https://example.com/).\n\n\
         ![uzak](https://example.invalid/a.png)\n\n- madde bir\n- madde iki\n",
    );
    let docx = lab.convert(&md, "md", "docx");
    let document = entry(&docx, "word/document.xml");
    has(&document, "Not başlığı");
    assert!(!entry(&docx, "word/_rels/document.xml.rels").contains("example.invalid"));
    let text = lab.text(&docx, "docx");
    has(&text, "Bir kalın söz ve bağlantı.");
    has(&text, "madde iki");

    // A text clipping as macOS writes it (an XML property list here).
    let mut data = plist::Dictionary::new();
    data.insert(
        "public.utf8-plain-text".into(),
        plist::Value::String("Kırpıntı ğüşıöç 🧪\nikinci satır".into()),
    );
    let mut root = plist::Dictionary::new();
    root.insert("UTI-Data".into(), plist::Value::Dictionary(data));
    let mut clipping = Vec::new();
    plist::Value::Dictionary(root)
        .to_writer_xml(&mut clipping)
        .unwrap();
    let clipping = lab.write(&format!("{NAME}.textclipping"), clipping);
    let odt = lab.convert(&clipping, "textclipping", "odt");
    has(&lab.text(&odt, "odt"), "Kırpıntı ğüşıöç 🧪");

    // An RTFD package folder; its picture is lost, its text is not.
    let rtfd = lab.path(&format!("{NAME}.rtfd"));
    fs::create_dir(&rtfd).unwrap();
    fs::write(
        rtfd.join("TXT.rtf"),
        // ğüşıöç as Unicode escapes, as TextEdit writes letters outside its code page.
        "{\\rtf1\\ansi\\uc1 RTFD metni \\u287?\\u252?\\u351?\\u305?\\u246?\\u231?\\par}",
    )
    .unwrap();
    fs::write(rtfd.join("resim.png"), super::epub::tests::png()).unwrap();
    let docx = lab.convert(&rtfd, "rtfd", "docx");
    has(&lab.text(&docx, "docx"), "RTFD metni ğüşıöç");

    // An EPUB read by Kento: both chapters, the picture inlined, nothing remote.
    let epub = lab.write(&format!("{NAME}.epub"), super::epub::tests::book(None));
    let odt = lab.convert(&epub, "epub", "odt");
    let names = entries(&odt);
    assert!(
        names.iter().any(|name| name.starts_with("Pictures/")),
        "the book's picture is in the document: {names:?}"
    );
    let text = lab.text(&odt, "odt");
    has(&text, "Birinci bölüm");
    has(&text, "Çağrı ışığı gördü.");
    has(&text, "The end.");
}

fn rows(range: &calamine::Range<Data>) -> Vec<Vec<Data>> {
    range.rows().map(<[Data]>::to_vec).collect()
}

#[test]
fn office_spreadsheets() {
    let Some(lab) = Lab::new() else { return };
    let expected = |rows: &[Vec<Data>]| {
        assert_eq!(rows[0][0], Data::String("Ad".into()));
        assert_eq!(rows[1][0], Data::String("Çağrı".into()));
        assert_eq!(rows[1][1], Data::Float(3.0));
        assert_eq!(rows[1][2], Data::Float(1.5));
        assert_eq!(rows[2][0], Data::String("Şule 🧪".into()));
        assert_eq!(rows[2][2], Data::Float(2.25));
        // Formulas from a CSV stay text.
        assert_eq!(rows[3][0], Data::String("=1+1".into()));
    };
    // `;` and decimal commas, as Turkish and German spreadsheets write CSV.
    let csv = lab.write(
        &format!("{NAME}.csv"),
        "Ad;Adet;Fiyat\r\nÇağrı;3;1,5\r\nŞule 🧪;12;2,25\r\n=1+1;;\r\n",
    );
    let ods = lab.convert(&csv, "csv", "ods");
    let mut workbook: Ods<_> = open_workbook(&ods).unwrap();
    let sheet = workbook.worksheet_range_at(0).unwrap().unwrap();
    expected(&rows(&sheet));

    // ODS → XLSX goes through Kento's own engine; LibreOffice's XLSX filter is checked here.
    let xlsx = lab.office(&ods, "ods", "xlsx");
    let mut workbook: Xlsx<_> = open_workbook(&xlsx).unwrap();
    let sheet = workbook.worksheet_range_at(0).unwrap().unwrap();
    expected(&rows(&sheet));

    // Kento's own XLSX into LibreOffice.
    let tab = lab.write(
        &format!("{NAME}.tsv"),
        "Ad\tAdet\tFiyat\nÇağrı\t3\t1.5\nŞule 🧪\t12\t2.25\n=1+1\t\t\n",
    );
    let native = lab.convert(&tab, "tsv", "xlsx");
    let ods = lab.convert(&native, "xlsx", "ods");
    let mut workbook: Ods<_> = open_workbook(&ods).unwrap();
    let sheet = workbook.worksheet_range_at(0).unwrap().unwrap();
    let back = rows(&sheet);
    assert_eq!(back[1][0], Data::String("Çağrı".into()));
    assert_eq!(back[2][2], Data::Float(2.25));

    // TSV out: LibreOffice writes ".csv" with tabs; Kento names it.
    let tsv = lab.office(&ods, "ods", "tsv");
    let text = fs::read_to_string(&tsv).unwrap();
    has(&text, "Ad\tAdet\tFiyat");
    has(&text, "Çağrı\t3\t1");
    let ods_from_tsv = lab.convert(&tab, "tsv", "ods");
    let mut workbook: Ods<_> = open_workbook(&ods_from_tsv).unwrap();
    let sheet = workbook.worksheet_range_at(0).unwrap().unwrap();
    assert_eq!(rows(&sheet)[1][2], Data::Float(1.5));

    if pdfium() {
        let pdf = lab.convert(&csv, "csv", "pdf");
        assert!(crate::pdf::page_count(&pdf).unwrap() >= 1);
        has(&lab.text(&pdf, "pdf"), "Çağrı");
    }
}

/// Three slides with a title each, as a flat ODP.
fn slides() -> String {
    let mut pages = String::new();
    for n in 1..=3 {
        pages.push_str(&format!(
            "<draw:page draw:name=\"s{n}\" draw:master-page-name=\"Default\">\
             <draw:frame svg:x=\"2cm\" svg:y=\"2cm\" svg:width=\"24cm\" svg:height=\"4cm\">\
             <draw:text-box><text:p>Slayt {n} ğüşıöç</text:p></draw:text-box></draw:frame>\
             </draw:page>"
        ));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <office:document xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" \
         xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" \
         xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" \
         xmlns:draw=\"urn:oasis:names:tc:opendocument:xmlns:drawing:1.0\" \
         xmlns:svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\" \
         xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" \
         xmlns:presentation=\"urn:oasis:names:tc:opendocument:xmlns:presentation:1.0\" \
         office:version=\"1.3\" office:mimetype=\"application/vnd.oasis.opendocument.presentation\">\
         <office:automatic-styles><style:page-layout style:name=\"PM1\">\
         <style:page-layout-properties fo:margin-top=\"0cm\" fo:margin-bottom=\"0cm\" \
         fo:margin-left=\"0cm\" fo:margin-right=\"0cm\" fo:page-width=\"28cm\" \
         fo:page-height=\"15.75cm\" style:print-orientation=\"landscape\"/></style:page-layout>\
         </office:automatic-styles><office:master-styles><style:master-page \
         style:name=\"Default\" style:page-layout-name=\"PM1\"/></office:master-styles>\
         <office:body><office:presentation>{pages}</office:presentation></office:body>\
         </office:document>\n"
    )
}

#[test]
fn office_presentations() {
    let Some(lab) = Lab::new() else { return };
    // LibreOffice makes the PPTX from a flat ODP.
    let fodp = lab.write("sunum.fodp", slides());
    let out = lab.path("sunum-out");
    fs::create_dir(&out).unwrap();
    let office = Office::new(&lab.soffice, &lab.profile, Progress::none());
    let made = office
        .convert(
            &fodp,
            Some(FODP_IMPORT),
            &Export::new("pptx", "Impress MS PowerPoint 2007 XML"),
            &out,
        )
        .unwrap();
    let pptx = lab.path(&format!("{NAME}.pptx"));
    fs::rename(made, &pptx).unwrap();
    let slide_files = |path: &Path| {
        entries(path)
            .into_iter()
            .filter(|name| name.starts_with("ppt/slides/slide") && name.ends_with(".xml"))
            .count()
    };
    assert_eq!(slide_files(&pptx), 3);

    let odp = lab.convert(&pptx, "pptx", "odp");
    let content = entry(&odp, "content.xml");
    assert_eq!(content.matches("<draw:page ").count(), 3, "three slides");
    has(&content, "Slayt 2 ğüşıöç");
    assert_eq!(slide_files(&lab.convert(&odp, "odp", "pptx")), 3);

    if !pdfium() {
        return;
    }
    let pdf = lab.convert(&pptx, "pptx", "pdf");
    assert_eq!(crate::pdf::page_count(&pdf).unwrap(), 3);
    has(&lab.text(&pdf, "pdf"), "Slayt 2 ğüşıöç");

    // One picture per slide, named after the presentation, at the slide's aspect.
    let folder = lab.convert(&pptx, "pptx", "png");
    let mut pictures: Vec<String> = fs::read_dir(&folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    pictures.sort();
    assert_eq!(
        pictures,
        [1, 2, 3].map(|n| format!("{NAME}-{n}.png")),
        "named like PDF pages"
    );
    let (width, height) = ::image::image_dimensions(folder.join(&pictures[0])).unwrap();
    assert!((f64::from(width) / f64::from(height) - 28.0 / 15.75).abs() < 0.02);
    let folder = lab.convert(&odp, "odp", "jpg");
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 3);
}

#[test]
fn office_pdf_inputs() {
    let Some(lab) = Lab::new() else { return };
    if !pdfium() {
        return;
    }
    let html = lab.write(&format!("{NAME}.html"), PAGE);
    let pdf = lab.convert(&html, "html", "pdf");
    let pages = crate::pdf::page_count(&pdf).unwrap();
    assert_eq!(pages, 2);

    // Pages as pictures, one per slide.
    let pptx = lab.convert(&pdf, "pdf", "pptx");
    let names = entries(&pptx);
    let slides = names
        .iter()
        .filter(|name| name.starts_with("ppt/slides/slide") && name.ends_with(".xml"))
        .count();
    assert_eq!(slides, pages);
    assert!(
        names.iter().any(|name| name.starts_with("ppt/media/")),
        "the slides hold pictures: {names:?}"
    );

    // Writer's PDF import keeps the words, in text boxes.
    let docx = lab.convert(&pdf, "pdf", "docx");
    has(&entry(&docx, "word/document.xml"), "Kento");
    let page = lab.convert(&pdf, "pdf", "html");
    assert!(fs::metadata(&page).unwrap().len() > 0);
    let epub = lab.convert(&pdf, "pdf", "epub");
    assert_eq!(entry(&epub, "mimetype").trim(), "application/epub+zip");
}

#[test]
fn office_cancelling_ends_libreoffice_and_the_profile_still_works() {
    let Some(lab) = Lab::new() else { return };
    let html = lab.write(&format!("{NAME}.html"), PAGE);
    // The profile is new, so LibreOffice takes seconds to start; the job is cancelled meanwhile.
    let started = Mutex::new(None::<Instant>);
    let stop = AtomicBool::new(false);
    let cancelled = || {
        let mut started = started.lock().unwrap();
        let at = *started.get_or_insert_with(Instant::now);
        if at.elapsed() > Duration::from_millis(400) {
            stop.store(true, Ordering::Relaxed);
        }
        stop.load(Ordering::Relaxed)
    };
    let progress = Progress::new(&|_| {}, &cancelled);
    let temp = tempfile::tempdir_in(&lab.root).unwrap();
    let dest = lab.dest(&html, "docx", Output::File);
    let options = lab.options();
    let clock = Instant::now();
    let result = crate::convert(&Conversion {
        input: &html,
        from: "html",
        to: "docx",
        dest: &dest,
        temp: temp.path(),
        options: &options,
        progress: &progress,
    });
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(clock.elapsed() < Duration::from_secs(30));
    assert!(!dest.exists(), "nothing reaches the destination");
    // On Windows a process still running would hold its folders: the job's folder goes.
    let path = temp.keep();
    let deadline = Instant::now() + Duration::from_secs(10);
    while fs::remove_dir_all(&path).is_err() {
        assert!(
            Instant::now() < deadline,
            "LibreOffice still holds the job's folder"
        );
        std::thread::sleep(Duration::from_millis(200));
    }
    // The same profile works afterwards.
    let docx = lab.convert(&html, "html", "docx");
    has(&entry(&docx, "word/document.xml"), "ğüşıöç");
}

#[test]
fn office_unreadable_documents_say_so() {
    let Some(lab) = Lab::new() else { return };
    let mut noise = vec![0u8; 4096];
    let mut seed: u32 = 7;
    for byte in &mut noise {
        seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
        *byte = (seed >> 24) as u8;
    }
    noise[..4].copy_from_slice(b"\0\x01\0\x02");
    let bad = lab.write(&format!("{NAME}.xlsx"), &noise);
    // LibreOffice would open the noise as text; Kento sees it is no package first.
    let result = lab.try_convert(&bad, "xlsx", "ods", &Progress::none());
    assert!(
        matches!(result, Err(Error::Unreadable(_))),
        "noise is no workbook: {result:?}"
    );
    // A password-protected Word file is recognised before LibreOffice starts.
    let locked = lab.write(
        &format!("{NAME} şifreli.docx"),
        super::encrypted::tests::compound_file(&["EncryptionInfo", "EncryptedPackage"]),
    );
    assert!(matches!(
        lab.try_convert(&locked, "docx", "pdf", &Progress::none()),
        Err(Error::Encrypted)
    ));
}

#[test]
fn office_warm_up_makes_the_profile_beside_a_job() {
    let Some(lab) = Lab::new() else { return };
    let tools = lab.options().tools;
    let html = lab.write(&format!("{NAME}.html"), PAGE);
    // The warm-up and a job share the profile: the lock keeps them one after the other.
    let docx = std::thread::scope(|scope| {
        let warm = scope.spawn(|| warm_up(&tools, &lab.profile));
        let docx = lab.convert(&html, "html", "docx");
        warm.join().unwrap().unwrap();
        docx
    });
    has(&entry(&docx, "word/document.xml"), "ğüşıöç");
    let user = lab.profile.join("user");
    let settings = fs::read_to_string(user.join("registrymodifications.xcu")).unwrap();
    for name in [
        "MacroSecurityLevel",
        "DisableMacrosExecution",
        "BlockUntrustedRefererLinks",
    ] {
        has(&settings, &format!("oor:name=\"{name}\""));
    }
    has(
        &settings,
        "<prop oor:name=\"MacroSecurityLevel\" oor:op=\"fuse\"><value>3</value>",
    );
    assert!(
        fs::read_dir(&user).unwrap().count() > 1,
        "LibreOffice made its profile"
    );
    warm_up(&tools, &lab.profile).unwrap();
}
