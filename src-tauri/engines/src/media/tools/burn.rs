// SPDX-License-Identifier: MIT
//! Burn in subtitles [+]: FFmpeg's `subtitles` filter (libass) draws an SRT or VTT file into the
//! picture. The filter string has escaping rules of its own for paths (drive letters, colons,
//! quotes, backslashes), so it never sees one: Kento writes the subtitles as a UTF-8 SRT under a
//! plain name in the job's folder, copies the system's font beside it, and runs FFmpeg in that
//! folder.

use std::fs;
use std::path::{Path, PathBuf};

use resvg::usvg::fontdb;

use super::super::convert::{Audio, Recipe, Video};
use super::super::run::{self, Cmd};
use super::super::Position;
use super::{no_video, Job};
use crate::{Codec, Error, Result};

/// What the filter string names, inside the job's folder.
const SUBTITLES: &str = "subtitles.srt";
const FONTS: &str = "fonts";

/// FFmpeg sets text subtitles at 16 on a 288-line script (a line about 5.5 % of the picture's
/// height); the user's size is a percentage of that.
const BASE_SIZE: f64 = 16.0;
const MIN_SIZE: f64 = 50.0;
const MAX_SIZE: f64 = 250.0;

/// The system's sans-serif, as Mark up draws its text.
const FAMILIES: [&str; 3] = ["Segoe UI", "Helvetica Neue", "Arial"];

impl Job<'_, '_> {
    pub(super) fn burn_subtitles(
        &self,
        input: &Path,
        subtitles: &Path,
        size: f64,
        position: Position,
    ) -> Result<Vec<PathBuf>> {
        if !run::has_filter(self.ffmpeg, "subtitles") {
            return Err(Error::MissingCodec(Codec::Libass));
        }
        let probe = self.probe(input)?;
        probe.video().ok_or_else(no_video)?;
        let dir = self.run.temp;
        // The top is set cue by cue in the SRT; the bottom is where subtitles go by themselves.
        let top = position == Position::Top;
        fs::write(
            dir.join(SUBTITLES),
            crate::subtitle::to_srt(subtitles, top)?,
        )?;
        let font = font_into(&dir.join(FONTS));
        let recipe = Recipe {
            container: self.container(input, &probe)?,
            video: Video::Encode {
                keep_codec: true,
                filter: Some(filter(size, font)),
            },
            audio: Audio::Copy,
            subtitles: true,
            graph: None,
        };
        let mut cmd = Cmd::new();
        cmd.in_dir(dir).input(input);
        self.encode(
            cmd,
            &probe,
            &recipe,
            &[],
            self.run.dest,
            self.watch(probe.info.duration),
        )?;
        Ok(self.dest())
    }
}

/// The filter, naming only the files in the job's folder. `font` is a family from `FAMILIES`,
/// so it needs no escaping either.
fn filter(size: f64, font: Option<&str>) -> String {
    let size = if size.is_finite() {
        size.clamp(MIN_SIZE, MAX_SIZE)
    } else {
        100.0
    };
    let points = (BASE_SIZE * size / 100.0 * 10.0).round() / 10.0;
    let mut options = format!("subtitles=filename={SUBTITLES}");
    let mut style = format!("FontSize={points}");
    if let Some(font) = font {
        options.push_str(&format!(":fontsdir={FONTS}"));
        style = format!("FontName={font},{style}");
    }
    format!("{options}:force_style='{style}'")
}

/// Copies the regular face of the system's sans-serif into `dir` and names its family, so libass
/// draws with it whatever font lookup the FFmpeg build has (fontconfig without its configuration
/// finds nothing). None when there is no such font file: libass then chooses on its own.
fn font_into(dir: &Path) -> Option<&'static str> {
    let fonts = crate::image::system_fonts();
    FAMILIES.into_iter().find(|family| {
        let query = fontdb::Query {
            families: &[fontdb::Family::Name(family)],
            ..fontdb::Query::default()
        };
        let Some(face) = fonts.query(&query).and_then(|id| fonts.face(id)) else {
            return false;
        };
        let path = match &face.source {
            fontdb::Source::File(path) | fontdb::Source::SharedFile(path, _) => path,
            fontdb::Source::Binary(_) => return false,
        };
        let extension = path
            .extension()
            .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
            .filter(|ext| matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc"))
            .unwrap_or_else(|| "ttf".to_owned());
        fs::create_dir_all(dir).is_ok()
            && fs::copy(path, dir.join(format!("system.{extension}"))).is_ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_filter_names_only_plain_relative_files() {
        assert_eq!(
            filter(100.0, Some("Segoe UI")),
            "subtitles=filename=subtitles.srt:fontsdir=fonts:force_style='FontName=Segoe UI,FontSize=16'"
        );
        assert_eq!(
            filter(150.0, None),
            "subtitles=filename=subtitles.srt:force_style='FontSize=24'"
        );
        assert!(filter(10.0, None).ends_with("FontSize=8'"));
        assert!(filter(f64::NAN, None).ends_with("FontSize=16'"));
        assert!(filter(999.0, None).ends_with("FontSize=40'"));
        for family in FAMILIES {
            assert!(family.chars().all(|c| c.is_ascii_alphabetic() || c == ' '));
        }
    }
}
