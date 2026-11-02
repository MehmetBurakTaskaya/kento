// SPDX-License-Identifier: MIT
use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

/// Why an engine stopped. The app turns each kind into a plain-language message and keeps the
/// `Display` text for "Copy details".
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{from} to {to} is not supported")]
    Unsupported { from: String, to: String },
    /// The input is damaged, truncated or not what its extension says.
    #[error("the file could not be read: {0}")]
    Unreadable(String),
    #[error("the file is password protected")]
    Encrypted,
    /// A codec or library that this computer lacks.
    #[error("{0} is not available on this computer")]
    MissingCodec(Codec),
    /// An archive or document over a safety limit (entry count, total size, page count).
    #[error("over the safety limit: {0}")]
    Limit(String),
    /// Compress found nothing smaller than the original, or nothing under the target size.
    #[error("no smaller result")]
    NotSmaller,
    /// Text recognition found no text at all.
    #[error("no text found")]
    NoText,
    /// A web download Kento does not or cannot do (SPEC 5.10).
    #[error("web download: {0}")]
    Web(WebProblem),
    /// An external tool stopped unexpectedly (it crashed), more than once.
    #[error("{0} stopped unexpectedly")]
    Crashed(Codec),
    #[error("cancelled")]
    Cancelled,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Codec {
    /// HEIC/HEIF: the system's support (Windows HEIF Image Extensions, macOS ImageIO).
    Heif,
    /// The bundled PDFium library.
    Pdfium,
    /// FFmpeg and ffprobe, the media tools downloaded on request.
    Ffmpeg,
    /// ExifTool, one of the Extras tools downloaded on request.
    ExifTool,
    /// LibreOffice, the Office tools downloaded on request or found on the computer.
    LibreOffice,
    /// yt-dlp with Deno, the web download part of the Media tools.
    YtDlp,
    /// ONNX Runtime with the background-removal model, part of the Extras tools.
    BackgroundRemoval,
    /// The system's text recognition for the chosen language: a Windows language pack, or a
    /// language Apple's Vision reads on this version of macOS.
    OcrLanguage,
    /// FFmpeg's `subtitles` filter, which builds without libass (Homebrew's) lack.
    Libass,
}

/// Why a link cannot be downloaded, each said plainly in the interface (SPEC 5.10).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebProblem {
    /// Protected by DRM.
    Drm,
    /// A live stream.
    Live,
    /// Only for signed-in viewers; Kento imports no cookies.
    Login,
    /// A profile, channel or playlist rather than one post or video.
    Collection,
    /// Removed, private, unavailable in this country, or no page at that address.
    Unavailable,
    /// The page shows no media yt-dlp can take (a poster or a blob address): copy the share link.
    NoMedia,
    /// The site could not be reached.
    Network,
    /// Not a web address Kento downloads from (only http and https).
    NotALink,
}

impl fmt::Display for WebProblem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            WebProblem::Drm => "protected by DRM",
            WebProblem::Live => "a live stream",
            WebProblem::Login => "needs a signed-in account",
            WebProblem::Collection => "a profile, channel or playlist",
            WebProblem::Unavailable => "not available",
            WebProblem::NoMedia => "no media on the page",
            WebProblem::Network => "the site could not be reached",
            WebProblem::NotALink => "not a web address",
        })
    }
}

impl fmt::Display for Codec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Codec::Heif => "HEIF support",
            Codec::Pdfium => "PDFium",
            Codec::Ffmpeg => "the media tools (FFmpeg)",
            Codec::ExifTool => "ExifTool",
            Codec::LibreOffice => "the Office tools (LibreOffice)",
            Codec::YtDlp => "the web download tools (yt-dlp)",
            Codec::BackgroundRemoval => "background removal (ONNX Runtime and its model)",
            Codec::OcrLanguage => "text recognition for this language",
            Codec::Libass => "FFmpeg's subtitle drawing (libass)",
        })
    }
}
