// SPDX-License-Identifier: MIT
//! Documents, spreadsheets and presentations through LibreOffice (SPEC 4.2, 5.4): the routes no
//! engine inside Kento does, run by `soffice` in headless mode with a profile of Kento's own.

use std::path::{Path, PathBuf};

use crate::{Conversion, Error, Output, Result, Tools};

/// Whether LibreOffice does this route here.
pub fn supports(_from: &str, _to: &str) -> bool {
    false
}

/// What the route writes.
pub fn output(_from: &str, _to: &str) -> Output {
    Output::File
}

pub fn convert(job: &Conversion) -> Result<Vec<PathBuf>> {
    Err(Error::Unsupported {
        from: job.from.to_owned(),
        to: job.to.to_owned(),
    })
}

/// Starts LibreOffice once with `profile` so the first real job does not wait for the profile to
/// be made (SPEC 7: its first start is slow).
pub fn warm_up(tools: &Tools, _profile: &Path) -> Result<()> {
    tools.soffice().map(|_| ())
}
