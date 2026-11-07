// SPDX-License-Identifier: MIT
//! The catalog's entries, following the conversion matrix and the tool list of SPEC 5.4 and 5.5.

use std::sync::OnceLock;

use super::{Action, Category, Engine, Format, Platforms, Route, Status, Tool, ToolGroup};

const fn f(
    id: &'static str,
    label: &'static str,
    category: Category,
    extensions: &'static [&'static str],
    read: bool,
    write: bool,
    enhancement: bool,
) -> Format {
    Format {
        id,
        label,
        category,
        extensions,
        read,
        write,
        enhancement,
    }
}

use Category::*;

const FORMATS: &[Format] = &[
    // Image (9 inputs; ICO is an output only)
    f("avif", "AVIF", Image, &["avif"], true, true, false),
    f("bmp", "BMP", Image, &["bmp"], true, true, false),
    f("gif", "GIF", Image, &["gif"], true, true, false),
    f("heic", "HEIC", Image, &["heic", "heif"], true, true, false),
    f("jpg", "JPG", Image, &["jpg", "jpeg"], true, true, false),
    f("png", "PNG", Image, &["png"], true, true, false),
    f("svg", "SVG", Image, &["svg"], true, false, false),
    f("tiff", "TIFF", Image, &["tif", "tiff"], true, true, false),
    f("webp", "WEBP", Image, &["webp"], true, true, false),
    f("ico", "ICO", Image, &["ico"], false, true, true),
    // Video (7 inputs with GIF)
    f("avi", "AVI", Video, &["avi"], true, true, false),
    f("mkv", "MKV", Video, &["mkv"], true, true, false),
    f("mov", "MOV", Video, &["mov"], true, true, false),
    f("mp4", "MP4", Video, &["mp4", "m4v"], true, true, false),
    f("webm", "WEBM", Video, &["webm"], true, true, false),
    f("wmv", "WMV", Video, &["wmv"], true, true, false),
    // Audio (8)
    f("aiff", "AIFF", Audio, &["aif", "aiff"], true, true, false),
    f("flac", "FLAC", Audio, &["flac"], true, true, false),
    f("m4a", "M4A", Audio, &["m4a"], true, true, false),
    f("mp3", "MP3", Audio, &["mp3"], true, true, false),
    f("ogg", "OGG", Audio, &["ogg", "oga"], true, true, false),
    f("opus", "OPUS", Audio, &["opus"], true, true, false),
    f("wav", "WAV", Audio, &["wav"], true, true, false),
    f("wma", "WMA", Audio, &["wma"], true, true, false),
    // Document and text (9 inputs, ODT and DOC as [+])
    f("docx", "DOCX", Document, &["docx"], true, true, false),
    f("rtf", "RTF", Document, &["rtf"], true, true, false),
    f("rtfd", "RTFD", Document, &["rtfd"], true, false, false),
    f("txt", "TXT", Document, &["txt"], true, true, false),
    f("md", "MD", Document, &["md", "markdown"], true, true, false),
    f(
        "html",
        "HTML",
        Document,
        &["html", "htm"],
        true,
        true,
        false,
    ),
    f("epub", "EPUB", Document, &["epub"], true, true, false),
    f("pages", "PAGES", Document, &["pages"], true, false, false),
    f(
        "textclipping",
        "TEXTCLIPPING",
        Document,
        &["textclipping"],
        true,
        false,
        false,
    ),
    f("odt", "ODT", Document, &["odt"], true, true, true),
    f("doc", "DOC", Document, &["doc"], true, false, true),
    // Spreadsheet (5 inputs, NUMBERS as [+])
    f("csv", "CSV", Spreadsheet, &["csv"], true, true, false),
    f("tsv", "TSV", Spreadsheet, &["tsv"], true, true, false),
    f("xls", "XLS", Spreadsheet, &["xls"], true, false, false),
    f("xlsx", "XLSX", Spreadsheet, &["xlsx"], true, true, false),
    f("ods", "ODS", Spreadsheet, &["ods"], true, true, false),
    f(
        "numbers",
        "NUMBERS",
        Spreadsheet,
        &["numbers"],
        true,
        false,
        true,
    ),
    // Presentation (2 inputs, ODP and KEY as [+])
    f("ppt", "PPT", Presentation, &["ppt"], true, false, false),
    f("pptx", "PPTX", Presentation, &["pptx"], true, true, false),
    f("odp", "ODP", Presentation, &["odp"], true, true, true),
    f("key", "KEY", Presentation, &["key"], true, false, true),
    // Subtitles
    f("srt", "SRT", Subtitle, &["srt"], true, true, false),
    f("vtt", "VTT", Subtitle, &["vtt"], true, true, false),
    // PDF
    f("pdf", "PDF", Pdf, &["pdf"], true, true, false),
    // Archive (4 inputs, 7Z as [+]); a .tar.gz is read as GZ and written as TAR.GZ
    f("zip", "ZIP", Archive, &["zip"], true, true, false),
    f("tar", "TAR", Archive, &["tar"], true, true, false),
    f("gz", "GZ", Archive, &["gz", "tgz"], true, false, false),
    f("tar-gz", "TAR.GZ", Archive, &["tar.gz"], false, true, false),
    f("rar", "RAR", Archive, &["rar"], true, false, false),
    f("7z", "7Z", Archive, &["7z"], true, true, true),
];

pub fn formats() -> &'static [Format] {
    FORMATS
}

struct Routes(Vec<Route>);

impl Routes {
    /// Adds every from → to pair that is not already there and not a conversion to itself.
    #[allow(clippy::too_many_arguments)]
    fn add(
        &mut self,
        from: &[&'static str],
        to: &[&'static str],
        engine: Engine,
        group: ToolGroup,
        enhancement: bool,
        note: Option<&'static str>,
    ) -> &mut Self {
        for &a in from {
            for &b in to {
                let same = a == b || (a == "gz" && b == "tar-gz");
                if same || self.0.iter().any(|r| r.from == a && r.to == b) {
                    continue;
                }
                let enhancement = enhancement || is_enhancement(a) || is_enhancement(b);
                self.0.push(Route {
                    from: a,
                    to: b,
                    engine,
                    group,
                    platforms: Platforms::Both,
                    status: Status::Planned,
                    enhancement,
                    note,
                });
            }
        }
        self
    }
}

fn is_enhancement(id: &str) -> bool {
    FORMATS
        .iter()
        .any(|format| format.id == id && format.enhancement)
}

const IMAGE_IN: &[&str] = &["avif", "bmp", "gif", "jpg", "png", "svg", "tiff", "webp"];
const IMAGE_OUT: &[&str] = &["jpg", "png", "webp", "avif", "bmp", "tiff", "gif", "pdf"];
// An animated GIF has no sound: it becomes a video only (MP4, WEBM, MOV).
const VIDEO_IN: &[&str] = &["avi", "mkv", "mov", "mp4", "webm", "wmv"];
const VIDEO_OUT: &[&str] = &["mp4", "mov", "mkv", "webm", "avi", "wmv", "gif", "mp3"];
const AUDIO: &[&str] = &["aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"];
const TEXT: &[&str] = &["txt", "md", "html"];
const DOC_IN: &[&str] = &[
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
const DOC_OUT: &[&str] = &["pdf", "docx", "odt", "rtf", "txt", "md", "html", "epub"];
// Workbooks without an office suite: values in, values out.
const SHEET_NATIVE_IN: &[&str] = &["csv", "tsv", "xls", "xlsx", "ods"];
const SHEET_NATIVE_OUT: &[&str] = &["csv", "tsv", "xlsx", "html"];
const SHEET_IN: &[&str] = &["csv", "tsv", "xls", "xlsx", "ods", "numbers"];
const SHEET_OUT: &[&str] = &["xlsx", "ods", "csv", "tsv", "pdf", "html"];
const SLIDES_IN: &[&str] = &["ppt", "pptx", "odp", "key"];
const ARCHIVE_IN: &[&str] = &["zip", "tar", "gz", "rar", "7z"];
const ARCHIVE_OUT: &[&str] = &["zip", "tar", "tar-gz", "7z"];

pub fn routes() -> &'static [Route] {
    static ROUTES: OnceLock<Vec<Route>> = OnceLock::new();
    ROUTES.get_or_init(|| {
        use Engine as E;
        use ToolGroup as G;
        let mut r = Routes(Vec::new());
        r.add(IMAGE_IN, IMAGE_OUT, E::Image, G::Core, false, None)
            .add(
                &["heic"],
                IMAGE_OUT,
                E::Heif,
                G::Core,
                false,
                Some("read with the system's HEIF support or the media tools"),
            )
            .add(
                IMAGE_IN,
                &["heic"],
                E::Heif,
                G::Core,
                false,
                Some("only where a reliable HEIC encoder exists"),
            )
            .add(
                IMAGE_IN,
                &["ico"],
                E::Image,
                G::Core,
                true,
                Some("several sizes in one icon"),
            )
            .add(&["heic"], &["ico"], E::Heif, G::Core, true, None)
            .add(
                &["gif"],
                &["mp4", "webm", "mov"],
                E::Ffmpeg,
                G::Media,
                false,
                Some("animated GIF"),
            )
            .add(VIDEO_IN, VIDEO_OUT, E::Ffmpeg, G::Media, false, None)
            .add(VIDEO_IN, &["m4a", "wav"], E::Ffmpeg, G::Media, true, None)
            .add(AUDIO, AUDIO, E::Ffmpeg, G::Media, false, None)
            .add(TEXT, TEXT, E::Text, G::Core, false, None)
            .add(
                &["textclipping"],
                &["txt"],
                E::Text,
                G::Core,
                false,
                Some("best effort"),
            )
            .add(DOC_IN, DOC_OUT, E::LibreOffice, G::Office, false, None)
            .add(
                SHEET_NATIVE_IN,
                SHEET_NATIVE_OUT,
                E::Sheet,
                G::Core,
                false,
                None,
            )
            .add(SHEET_IN, SHEET_OUT, E::LibreOffice, G::Office, false, None)
            .add(
                SLIDES_IN,
                &["pdf", "pptx", "odp"],
                E::LibreOffice,
                G::Office,
                false,
                None,
            )
            .add(
                SLIDES_IN,
                &["png", "jpg"],
                E::LibreOffice,
                G::Office,
                false,
                Some("one image per slide"),
            )
            .add(
                &["srt", "vtt"],
                &["srt", "vtt", "txt"],
                E::Text,
                G::Core,
                false,
                None,
            )
            .add(
                &["pdf"],
                &["jpg", "png"],
                E::Pdf,
                G::Core,
                false,
                Some("one image per page"),
            )
            .add(
                &["pdf"],
                &["txt", "md"],
                E::Pdf,
                G::Core,
                false,
                Some("text only"),
            )
            .add(
                &["pdf"],
                &["pptx"],
                E::LibreOffice,
                G::Office,
                false,
                Some("with page images"),
            )
            .add(
                &["pdf"],
                &["xlsx"],
                E::Pdf,
                G::Core,
                false,
                Some("tables found in the text, best effort"),
            )
            .add(
                &["pdf"],
                &["docx", "epub", "html"],
                E::LibreOffice,
                G::Office,
                false,
                None,
            )
            .add(ARCHIVE_IN, ARCHIVE_OUT, E::Archive, G::Core, false, None);
        for route in &mut r.0 {
            if route.engine == E::LibreOffice && route.note.is_none() {
                route.note = office_note(route.from, route.to);
            }
            if matches!(route.from, "rtfd" | "textclipping") && route.note.is_none() {
                route.note = Some("best effort");
            }
            if route.from == "rar" {
                route.note = Some("extract only (UnRAR licence)");
            }
            if route.engine == E::Sheet && matches!(route.from, "xls" | "xlsx" | "ods") {
                route.note = Some(match route.to {
                    "csv" | "tsv" => "the first sheet",
                    _ => "values only",
                });
            }
            route.status = match route.engine {
                E::Image
                | E::Pdf
                | E::Archive
                | E::Text
                | E::Sheet
                | E::Ffmpeg
                | E::LibreOffice => Status::Ready,
                // Depends on the computer's HEIF support.
                E::Heif => Status::Preview,
                _ => Status::Planned,
            };
        }
        r.0
    })
}

/// What a LibreOffice route cannot keep, where the result is approximate (SPEC 5.4, complex
/// documents).
fn office_note(from: &str, to: &str) -> Option<&'static str> {
    Some(match (from, to) {
        ("pdf", "docx" | "epub" | "html") => "best effort, as text boxes",
        ("numbers", "csv" | "tsv") => "best effort, the first sheet",
        ("pages" | "numbers" | "key", _) => "best effort",
        ("rtfd", _) => "best effort, without attachments",
        (_, "md") => "text and structure, without pictures",
        ("epub", _) => "text and pictures, without the book's styles",
        _ => return None,
    })
}

const fn tool(
    id: &'static str,
    categories: &'static [Category],
    engine: Engine,
    group: ToolGroup,
    icon: &'static str,
    enhancement: bool,
    note: Option<&'static str>,
) -> Tool {
    Tool {
        id,
        categories,
        engine,
        group,
        platforms: Platforms::Both,
        status: Status::Planned,
        enhancement,
        icon,
        note,
    }
}

const TOOLS: &[Tool] = &[
    // Image
    tool(
        "compress",
        &[Image, Video, Audio, Pdf],
        Engine::Image,
        ToolGroup::Core,
        "compress",
        false,
        Some("video and audio need the Media tools; PDF compression is [+]"),
    ),
    tool(
        "metadata",
        &[Image, Pdf, Video, Audio],
        Engine::ExifTool,
        ToolGroup::Extras,
        "tag",
        false,
        Some("media files also use ffprobe from the Media tools"),
    ),
    tool(
        "edit-image",
        &[Image],
        Engine::Image,
        ToolGroup::Core,
        "sliders",
        false,
        None,
    ),
    tool(
        "markup",
        &[Image],
        Engine::Image,
        ToolGroup::Core,
        "pen",
        false,
        None,
    ),
    tool(
        "frame",
        &[Image],
        Engine::Image,
        ToolGroup::Core,
        "frame",
        false,
        None,
    ),
    tool(
        "crop-image",
        &[Image],
        Engine::Image,
        ToolGroup::Core,
        "crop",
        false,
        None,
    ),
    tool(
        "collage",
        &[Image],
        Engine::Image,
        ToolGroup::Core,
        "grid",
        false,
        None,
    ),
    tool(
        "redact-image",
        &[Image],
        Engine::Image,
        ToolGroup::Core,
        "redact",
        false,
        None,
    ),
    tool(
        "read-qr",
        &[Image, Pdf],
        Engine::Qr,
        ToolGroup::Core,
        "qr",
        false,
        None,
    ),
    tool(
        "make-qr",
        &[],
        Engine::Qr,
        ToolGroup::Core,
        "qr",
        true,
        Some("from text or a link"),
    ),
    // PDF
    tool(
        "split-pdf",
        &[Pdf],
        Engine::Pdf,
        ToolGroup::Core,
        "doc",
        false,
        None,
    ),
    tool(
        "edit-pdf",
        &[Pdf],
        Engine::Pdf,
        ToolGroup::Core,
        "doc",
        false,
        None,
    ),
    tool(
        "merge-pdf",
        &[Pdf],
        Engine::Pdf,
        ToolGroup::Core,
        "doc",
        false,
        None,
    ),
    tool(
        "images-to-pdf",
        &[Image],
        Engine::Pdf,
        ToolGroup::Core,
        "doc",
        false,
        None,
    ),
    // Archive
    tool(
        "extract",
        &[Archive],
        Engine::Archive,
        ToolGroup::Core,
        "zip",
        false,
        None,
    ),
    // Video
    tool(
        "mute",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "video",
        false,
        None,
    ),
    tool(
        "trim-video",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "video",
        false,
        None,
    ),
    tool(
        "cut-out",
        &[Video, Audio],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "cut-out",
        false,
        None,
    ),
    tool(
        "make-vertical",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "vertical",
        false,
        None,
    ),
    tool(
        "add-music",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "music-plus",
        false,
        None,
    ),
    tool(
        "add-overlay",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "overlay",
        false,
        None,
    ),
    tool(
        "remove-pauses",
        &[Video, Audio],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "pauses",
        false,
        None,
    ),
    tool(
        "crop-video",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "crop",
        false,
        None,
    ),
    tool(
        "speed",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "video",
        false,
        None,
    ),
    tool(
        "merge-video",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "video",
        false,
        None,
    ),
    tool(
        "frames",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "image",
        false,
        None,
    ),
    tool(
        "split-video",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "video",
        false,
        None,
    ),
    tool(
        "redact-video",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "redact",
        false,
        None,
    ),
    tool(
        "fade",
        &[Video, Audio],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "fade",
        false,
        None,
    ),
    tool(
        "denoise",
        &[Video, Audio],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "denoise",
        false,
        None,
    ),
    tool(
        "rotate-video",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "rotate-right",
        false,
        None,
    ),
    tool(
        "color-video",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "palette",
        false,
        None,
    ),
    tool(
        "loop-video",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "loop",
        false,
        None,
    ),
    tool(
        "stabilize",
        &[Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "stabilize",
        false,
        None,
    ),
    // Audio
    tool(
        "normalize",
        &[Audio],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "music",
        false,
        None,
    ),
    tool(
        "trim-audio",
        &[Audio],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "music",
        false,
        None,
    ),
    tool(
        "channels",
        &[Audio],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "music",
        false,
        None,
    ),
    tool(
        "redact-audio",
        &[Audio],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "music",
        false,
        None,
    ),
    tool(
        "audio-to-video",
        &[Audio],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "video",
        false,
        None,
    ),
    tool(
        "merge-audio",
        &[Audio],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "merge-audio",
        false,
        None,
    ),
    tool(
        "ringtone",
        &[Audio, Video],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "bell",
        false,
        None,
    ),
    // Enhancements
    tool(
        "remove-background",
        &[Image],
        Engine::BackgroundRemoval,
        ToolGroup::Extras,
        "cutout",
        true,
        Some("permissively licensed models only"),
    ),
    tool(
        "ocr",
        &[Image, Pdf],
        Engine::Ocr,
        ToolGroup::Core,
        "doc",
        true,
        Some("Windows OCR and Apple Vision"),
    ),
    tool(
        "burn-subtitles",
        &[Video, Subtitle],
        Engine::Ffmpeg,
        ToolGroup::Media,
        "video",
        true,
        None,
    ),
];

/// Tools whose engine has shipped.
const READY_TOOLS: &[&str] = &[
    "read-qr",
    "split-pdf",
    "edit-pdf",
    "merge-pdf",
    "images-to-pdf",
    "extract",
    "mute",
    "trim-video",
    "crop-video",
    "speed",
    "merge-video",
    "frames",
    "split-video",
    "redact-video",
    "normalize",
    "trim-audio",
    "channels",
    "redact-audio",
    "audio-to-video",
    "compress",
    "metadata",
    "edit-image",
    "crop-image",
    "markup",
    "frame",
    "collage",
    "redact-image",
    "remove-background",
    "make-qr",
    "ocr",
    "burn-subtitles",
    "make-vertical",
    "cut-out",
    "remove-pauses",
    "add-music",
    "add-overlay",
    "fade",
    "denoise",
    "rotate-video",
    "loop-video",
    "color-video",
    "merge-audio",
    "ringtone",
    "stabilize",
];

pub fn tools() -> &'static [Tool] {
    static READY: OnceLock<Vec<Tool>> = OnceLock::new();
    READY.get_or_init(|| {
        TOOLS
            .iter()
            .cloned()
            .map(|mut tool| {
                if READY_TOOLS.contains(&tool.id) {
                    tool.status = Status::Ready;
                }
                tool
            })
            .collect()
    })
}

const fn action(
    id: &'static str,
    icon: &'static str,
    enhancement: bool,
    per_platform: bool,
) -> Action {
    Action {
        id,
        platforms: Platforms::Both,
        status: Status::Planned,
        enhancement,
        icon,
        per_platform,
    }
}

const ACTIONS: &[Action] = &[
    action("share", "share", false, false),
    action("shelf", "shelf", false, false),
    action("copy", "copy", false, false),
    action("move", "move", false, false),
    action("copy-path", "link", false, false),
    action("terminal", "terminal", false, false),
    action("reveal", "folder", true, true),
    action("zip", "zip", true, false),
];

/// Every file action works from Phase 3 on.
pub fn actions() -> &'static [Action] {
    static READY: OnceLock<Vec<Action>> = OnceLock::new();
    READY.get_or_init(|| {
        ACTIONS
            .iter()
            .cloned()
            .map(|mut action| {
                action.status = Status::Ready;
                action
            })
            .collect()
    })
}
