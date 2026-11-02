// SPDX-License-Identifier: MIT
//! Documents, spreadsheets and presentations through LibreOffice (SPEC 4.2, 5.4): the routes no
//! engine inside Kento does, run by `soffice` in headless mode with a profile of Kento's own.
//!
//! Each job copies its input into its scratch folder under a plain ASCII name, converts it there
//! and copies the result to the claimed destination, so LibreOffice never sees the user's file
//! names and never writes next to the original. Kento's own engines do the steps around
//! LibreOffice: Markdown, text and text clippings in, Markdown out, EPUB reading, slides as
//! pictures and PDF pages as slides. LibreOffice never reaches the network for a document: remote
//! references leave HTML before it sees it (`html.rs`), and its profile turns off macros and
//! linked content (`profile.rs`).

mod encrypted;
mod epub;
mod fodp;
mod html;
mod package;
mod profile;
mod soffice;

use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use crate::{text, Conversion, Error, Output, Progress, Result, Tools};
use soffice::{Export, Office};

const WRITER_IN: &[&str] = &[
    "docx",
    "rtf",
    "rtfd",
    "txt",
    "md",
    "html",
    "epub",
    "pages",
    "textclipping",
    "odt",
    "doc",
];
const WRITER_OUT: &[&str] = &["pdf", "docx", "odt", "rtf", "txt", "md", "html", "epub"];
const CALC_IN: &[&str] = &["csv", "tsv", "xls", "xlsx", "ods", "numbers"];
const CALC_OUT: &[&str] = &["xlsx", "ods", "csv", "tsv", "pdf", "html"];
const IMPRESS_IN: &[&str] = &["ppt", "pptx", "odp", "key"];
const IMPRESS_OUT: &[&str] = &["pdf", "pptx", "odp", "png", "jpg"];
/// PDF into Writer through its PDF import, and into Impress as page pictures. PDF to XLSX is the
/// PDF engine's.
const PDF_OUT: &[&str] = &["pptx", "docx", "epub", "html"];

/// Writer reads plain text as UTF-8 (Kento writes it so) with LF line ends.
const TEXT_IMPORT: &str = "Text (encoded):UTF8,LF";
/// Writer's HTML import: without it an HTML file opens in Writer/Web, which has no Word, ODT or
/// EPUB export.
const HTML_IMPORT: &str = "HTML (StarWriter)";
const PDF_IMPORT: &str = "writer_pdf_import";
const FODP_IMPORT: &str = "OpenDocument Presentation Flat XML";

/// The LibreOffice application a document opens in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum App {
    Writer,
    Calc,
    Impress,
}

fn app(from: &str, to: &str) -> Option<App> {
    let within =
        |inputs: &[&str], outputs: &[&str]| inputs.contains(&from) && outputs.contains(&to);
    if from == to {
        None
    } else if within(WRITER_IN, WRITER_OUT) {
        Some(App::Writer)
    } else if within(CALC_IN, CALC_OUT) {
        Some(App::Calc)
    } else if within(IMPRESS_IN, IMPRESS_OUT) {
        Some(App::Impress)
    } else if from == "pdf" && PDF_OUT.contains(&to) {
        Some(if to == "pptx" {
            App::Impress
        } else {
            App::Writer
        })
    } else {
        None
    }
}

/// Whether LibreOffice does this route here: never a route an engine inside Kento does, which
/// keeps what it does now (TXT, MD and HTML among themselves, spreadsheet values, PDF pages).
pub fn supports(from: &str, to: &str) -> bool {
    app(from, to).is_some() && !inside_kento(from, to)
}

fn inside_kento(from: &str, to: &str) -> bool {
    crate::pdf::supports(from, to)
        || crate::image::supports(from, to)
        || crate::archive::supports(from, to)
        || crate::text::supports(from, to)
        || crate::subtitle::supports(from, to)
        || crate::sheet::supports(from, to)
        || crate::media::supports(from, to)
}

/// What the route writes: slides become one picture each in a folder.
pub fn output(from: &str, to: &str) -> Output {
    if app(from, to) == Some(App::Impress) && matches!(to, "png" | "jpg") {
        Output::Folder
    } else {
        Output::File
    }
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    if !supports(job.from, job.to) {
        return Err(unsupported(job));
    }
    run(job)
}

fn unsupported(job: &Conversion) -> Error {
    Error::Unsupported {
        from: job.from.to_owned(),
        to: job.to.to_owned(),
    }
}

/// Starts LibreOffice once with `profile` so the first real job does not wait for the profile to
/// be made (SPEC 6: its first start is slow): a line of text becomes a PDF in a folder of its
/// own, which goes again afterwards.
pub fn warm_up(tools: &Tools, profile: &Path) -> Result<()> {
    let soffice = tools.soffice()?;
    let folder = warm_up_folder()?;
    let result = (|| {
        let input = folder.join("in").join("warm-up.txt");
        let out = folder.join("out");
        fs::create_dir_all(input.parent().unwrap_or(&folder))?;
        fs::create_dir_all(&out)?;
        fs::write(&input, "Kento\n")?;
        let office = Office::new(soffice, profile, Progress::none());
        office
            .convert(
                &input,
                Some(TEXT_IMPORT),
                &Export::new("pdf", "writer_pdf_Export"),
                &out,
            )
            .map(|_| ())
    })();
    let _ = fs::remove_dir_all(&folder);
    result
}

fn warm_up_folder() -> Result<PathBuf> {
    let base = std::env::temp_dir();
    for n in 0..1000u32 {
        let folder = base.join(format!("kento-office-warm-up-{}-{n}", std::process::id()));
        match fs::create_dir(&folder) {
            Ok(()) => return Ok(folder),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(Error::Other("no free folder for the warm-up".into()))
}

/// The job's folders inside its scratch folder: the input LibreOffice opens, what it writes, and
/// the steps around it.
struct Dirs {
    input: PathBuf,
    out: PathBuf,
    steps: PathBuf,
}

impl Dirs {
    fn new(temp: &Path) -> Result<Dirs> {
        let root = temp.join("office");
        let dirs = Dirs {
            input: root.join("in"),
            out: root.join("out"),
            steps: root.join("steps"),
        };
        for dir in [&dirs.input, &dirs.out, &dirs.steps] {
            fs::create_dir_all(dir)?;
        }
        Ok(dirs)
    }
}

/// The conversion itself, without asking whether Kento offers the route: the tests also drive
/// filters that only a NUMBERS file would reach.
fn run(job: &Conversion) -> Result<Vec<PathBuf>> {
    let app = app(job.from, job.to).ok_or_else(|| unsupported(job))?;
    let soffice = job.options.tools.soffice()?;
    job.progress.check()?;
    // LibreOffice tells nothing about how far it is, so the job stays indeterminate; the steps
    // around it keep quiet too, so the bar never jumps to a share of only one step.
    let cancelled = || job.progress.is_cancelled();
    let quiet = Progress::new(&|_| {}, &cancelled);
    let dirs = Dirs::new(job.temp)?;
    let profile = job
        .options
        .office_profile
        .clone()
        .unwrap_or_else(|| job.temp.join("office-profile"));
    let (input, infilter) = stage(job, &dirs, &quiet)?;
    encrypted::check(&input, job.from)?;
    quiet.check()?;
    let office = Office::new(soffice, &profile, quiet);
    let produced = office.convert(&input, infilter, &export(app, job.to), &dirs.out)?;
    let quiet = Progress::new(&|_| {}, &cancelled);
    finish(job, &produced, &dirs, &quiet)
}

/// Puts the input where LibreOffice reads it, as a file it can open, and names the import filter
/// when type detection alone would choose the wrong one.
fn stage(
    job: &Conversion,
    dirs: &Dirs,
    progress: &Progress,
) -> Result<(PathBuf, Option<&'static str>)> {
    let named = |extension: &str| dirs.input.join(format!("in.{extension}"));
    let folder = |path: &Path| path.parent().map(Path::to_path_buf);
    Ok(match job.from {
        "txt" => {
            let path = named("txt");
            write_text(&path, &read_text(job.input)?)?;
            (path, Some(TEXT_IMPORT))
        }
        "textclipping" => {
            let clipping = dirs.steps.join("clipping.txt");
            text_step(job, job.input, "textclipping", "txt", &clipping, progress)?;
            let path = named("txt");
            write_text(&path, &read_text(&clipping)?)?;
            (path, Some(TEXT_IMPORT))
        }
        "md" => {
            let page = dirs.steps.join("markdown.html");
            text_step(job, job.input, "md", "html", &page, progress)?;
            let path = named("html");
            let html = text::decode_html(&text::read_capped(&page, text::MAX_TEXT_BYTES)?);
            write_html(&path, &html, folder(job.input))?;
            (path, Some(HTML_IMPORT))
        }
        "html" => {
            let path = named("html");
            let html = text::decode_html(&text::read_capped(job.input, text::MAX_TEXT_BYTES)?);
            write_html(&path, &html, folder(job.input))?;
            (path, Some(HTML_IMPORT))
        }
        "epub" => {
            let path = named("html");
            epub::to_html(job.input, &path, progress)?;
            (path, Some(HTML_IMPORT))
        }
        "csv" | "tsv" => {
            let content = read_text(job.input)?;
            let delimiter = if job.from == "tsv" {
                b'\t'
            } else {
                crate::sheet::sniff_delimiter(&content)
            };
            let path = named(job.from);
            fs::write(&path, content)?;
            (path, Some(csv_import(delimiter)))
        }
        "rtfd" => {
            let path = named("rtf");
            package::rtfd(job.input, &path)?;
            (path, None)
        }
        "pages" | "numbers" | "key" => {
            let path = named(job.from);
            package::iwork(job.input, &path, progress)?;
            (path, None)
        }
        "pdf" if job.to == "pptx" => {
            let path = named("fodp");
            pdf_to_fodp(job, dirs, &path, progress)?;
            (path, Some(FODP_IMPORT))
        }
        "pdf" => {
            // Encrypted PDFs are refused everywhere in Kento (SPEC 5.4), and PDFium tells.
            let pages = crate::pdf::page_count(job.input)?;
            if pages == 0 {
                return Err(Error::Unreadable("the document has no pages".into()));
            }
            if pages > crate::pdf::MAX_PAGES {
                return Err(Error::Limit(format!(
                    "{pages} pages; at most {}",
                    crate::pdf::MAX_PAGES
                )));
            }
            let path = named("pdf");
            copy_new(job.input, &path)?;
            (path, Some(PDF_IMPORT))
        }
        from => {
            if !job.input.is_file() {
                return Err(Error::Unreadable("this is a folder, not a document".into()));
            }
            let path = named(from);
            copy_new(job.input, &path)?;
            (path, None)
        }
    })
}

/// LibreOffice's export filter for each output (LibreOffice Help, "File Conversion Filter
/// Names"). Markdown comes from Writer's HTML; PNG and JPG pages from a PDF.
fn export(app: App, to: &str) -> Export {
    match (app, to) {
        (App::Writer, "pdf") => Export::new("pdf", "writer_pdf_Export"),
        (App::Writer, "docx") => Export::new("docx", "MS Word 2007 XML"),
        (App::Writer, "odt") => Export::new("odt", "writer8"),
        (App::Writer, "rtf") => Export::new("rtf", "Rich Text Format"),
        (App::Writer, "txt") => Export::new("txt", "Text (encoded):UTF8"),
        // One self-contained page: pictures as data: URLs instead of files beside it.
        (App::Writer, "html") => Export::new("html", "HTML (StarWriter):EmbedImages"),
        (App::Writer, "md") => Export::new("html", "HTML (StarWriter)"),
        (App::Writer, _) => Export::new("epub", "EPUB"),
        (App::Calc, "xlsx") => Export::new("xlsx", "Calc MS Excel 2007 XML"),
        (App::Calc, "ods") => Export::new("ods", "calc8"),
        // LibreOffice names a TSV ".csv" too; `finish` gives it its own name.
        (App::Calc, "csv") => Export::new("csv", &csv_export(b',')),
        (App::Calc, "tsv") => Export::new("csv", &csv_export(b'\t')),
        (App::Calc, "pdf") => Export::new("pdf", "calc_pdf_Export"),
        (App::Calc, _) => Export::new("html", "HTML (StarCalc)"),
        (App::Impress, "pptx") => Export::new("pptx", "Impress MS PowerPoint 2007 XML"),
        (App::Impress, "odp") => Export::new("odp", "impress8"),
        (App::Impress, _) => Export::new("pdf", "impress_pdf_Export"),
    }
}

/// The CSV import filter's options (LibreOffice Help, "CSV Filter Options"), by position: the
/// separator, `"` around text, UTF-8 (76; Kento writes the file so), from line 1, no column
/// types, the language whose numbers the file writes, quoted fields not forced to text, no dates
/// or other special numbers guessed, two export-only places, spaces kept, one export-only place,
/// and formulas off: a cell such as `=WEBSERVICE(…)` stays text.
fn csv_import(delimiter: u8) -> &'static str {
    // A file delimited by `;` writes decimals with a comma, as the locales that use `;` do (the
    // same reading as the spreadsheet engine's); German (1031) reads them so, US English (1033)
    // reads points.
    match delimiter {
        b'\t' => "Text - txt - csv (StarCalc):9,34,76,1,,1033,false,false,,,false,,false",
        b';' => "Text - txt - csv (StarCalc):59,34,76,1,,1031,false,false,,,false,,false",
        b'|' => "Text - txt - csv (StarCalc):124,34,76,1,,1033,false,false,,,false,,false",
        _ => "Text - txt - csv (StarCalc):44,34,76,1,,1033,false,false,,,false,,false",
    }
}

/// The CSV export filter's options: the separator, `"` around text that needs it, UTF-8, from
/// line 1, no column types, US English, text not always quoted, numbers as numbers, cells as
/// shown, values rather than formulas, and (by leaving the sheet out) the first sheet.
fn csv_export(delimiter: u8) -> String {
    format!(
        "Text - txt - csv (StarCalc):{},34,76,1,,1033,false,true,true,false,false",
        delimiter
    )
}

/// Moves LibreOffice's result to the destination, with Kento's own step after it where the route
/// has one.
fn finish(
    job: &Conversion,
    produced: &Path,
    dirs: &Dirs,
    progress: &Progress,
) -> Result<Vec<PathBuf>> {
    match job.to {
        "png" | "jpg" => {
            // The pages carry the input's name, as PDF pages do: "talk-1.png".
            let folder = dirs.steps.join("slides");
            fs::create_dir_all(&folder)?;
            let pdf = folder.join(format!("{}.pdf", text::stem(job.input)));
            fs::rename(produced, &pdf)?;
            crate::pdf::convert(&Conversion {
                input: &pdf,
                from: "pdf",
                to: job.to,
                dest: job.dest,
                temp: &dirs.steps,
                options: job.options,
                progress,
            })
        }
        "md" => {
            // Writer writes its pictures as files beside the page; Markdown gets the text only.
            let html = text::decode_html(&text::read_capped(produced, text::MAX_TEXT_BYTES)?);
            let page = dirs.steps.join("document.html");
            fs::write(&page, html::clean(&html, &mut |_| None))?;
            text_step(job, &page, "html", "md", job.dest, progress)?;
            Ok(vec![job.dest.to_path_buf()])
        }
        "txt" => {
            // Kento's text outputs are UTF-8 without a byte order mark.
            let bytes = fs::read(produced)?;
            let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
            write_new(job.dest, body)?;
            Ok(vec![job.dest.to_path_buf()])
        }
        _ => {
            copy_new(produced, job.dest)?;
            Ok(vec![job.dest.to_path_buf()])
        }
    }
}

/// One of the text engine's conversions as a step.
fn text_step(
    job: &Conversion,
    input: &Path,
    from: &str,
    to: &str,
    dest: &Path,
    progress: &Progress,
) -> Result<()> {
    text::convert(&Conversion {
        input,
        from,
        to,
        dest,
        temp: job.temp,
        options: job.options,
        progress,
    })
    .map(|_| ())
}

/// Text in any encoding Kento reads (BOM, UTF-8, the likely Windows code page), with LF lines.
fn read_text(path: &Path) -> Result<String> {
    let bytes = text::read_capped(path, text::MAX_TEXT_BYTES)?;
    Ok(text::normalize_newlines(&text::decode(&bytes)))
}

fn write_text(path: &Path, content: &str) -> Result<()> {
    fs::write(path, content)?;
    Ok(())
}

/// A page for Writer's HTML import: nothing remote in it, pictures beside the original page
/// inlined, and UTF-8 said twice (a byte order mark and the one charset declaration left).
fn write_html(path: &Path, html: &str, pictures: Option<PathBuf>) -> Result<()> {
    let mut local = html::LocalPictures::new(pictures);
    let cleaned = html::clean(html, &mut |src| local.data_url(src));
    fs::write(path, format!("\u{feff}{cleaned}"))?;
    Ok(())
}

/// PDF → PPTX: every page as a picture (PDFium), one per slide of a flat ODP at the pages'
/// aspect, which LibreOffice then writes as PPTX.
fn pdf_to_fodp(job: &Conversion, dirs: &Dirs, dest: &Path, progress: &Progress) -> Result<()> {
    let pages = dirs.steps.join("pages");
    fs::create_dir_all(&pages)?;
    let pictures = crate::pdf::convert(&Conversion {
        input: job.input,
        from: "pdf",
        to: "png",
        dest: &pages,
        temp: &dirs.steps,
        options: job.options,
        progress,
    })?;
    fodp::write(
        &pictures,
        job.options.page_dpi,
        job.options.jpeg_quality,
        dest,
        progress,
    )
}

/// Copies a file to a path that must not exist yet: nothing is ever replaced.
fn copy_new(from: &Path, to: &Path) -> Result<()> {
    let mut source = File::open(from)?;
    let mut target = OpenOptions::new().write(true).create_new(true).open(to)?;
    io::copy(&mut source, &mut target)?;
    target.sync_all()?;
    Ok(())
}

fn write_new(to: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut target = OpenOptions::new().write(true).create_new(true).open(to)?;
    target.write_all(bytes)?;
    target.sync_all()?;
    Ok(())
}

/// Standard base64 with padding, for pictures in data: URLs and in the flat ODP.
pub(super) fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(chunk.get(1).copied().unwrap_or(0)) << 8)
            | u32::from(chunk.get(2).copied().unwrap_or(0));
        let sextet = |shift: u32| char::from(ALPHABET[((n >> shift) & 63) as usize]);
        out.push(sextet(18));
        out.push(sextet(12));
        out.push(if chunk.len() > 1 { sextet(6) } else { '=' });
        out.push(if chunk.len() > 2 { sextet(0) } else { '=' });
    }
    out
}
