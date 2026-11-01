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
}

impl fmt::Display for Codec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Codec::Heif => "HEIF support",
            Codec::Pdfium => "PDFium",
        })
    }
}
