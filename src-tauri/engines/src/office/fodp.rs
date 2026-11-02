// SPDX-License-Identifier: MIT
//! PDF pages as slides: a flat ODP (`.fodp`, the whole presentation in one XML file) with one
//! picture per page, which LibreOffice reads and writes as PPTX. The slide has the first page's
//! size and every page sits centred on its slide at its own aspect. Pictures go inside the file
//! as base64: LibreOffice blocks linked pictures from documents outside trusted locations
//! (`profile.rs`), and the job's folder is not one.

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use ::image::codecs::jpeg::JpegEncoder;
use ::image::{ImageError, RgbImage};

use super::base64;
use crate::{Error, Progress, Result};

/// PowerPoint's slide sizes run from 1 to 56 inches a side.
const SIDE_MIN_CM: f64 = 2.54;
const SIDE_MAX_CM: f64 = 142.24;
/// A page picture over this many bytes as PNG (a scan, a photo) goes in as JPEG instead; pages of
/// text stay sharp PNGs.
const PNG_LIMIT: u64 = 1_500_000;

const HEAD: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<office:document xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" \
xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" \
xmlns:draw=\"urn:oasis:names:tc:opendocument:xmlns:drawing:1.0\" \
xmlns:presentation=\"urn:oasis:names:tc:opendocument:xmlns:presentation:1.0\" \
xmlns:svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\" \
xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" \
office:version=\"1.3\" office:mimetype=\"application/vnd.oasis.opendocument.presentation\">\n";

const TAIL: &str = "</office:presentation>\n</office:body>\n</office:document>\n";

/// A size or a place on the slide, in centimetres.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Box2 {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Writes the presentation to `dest`: `pages` are the page pictures in order, rendered at `dpi`.
pub(super) fn write(
    pages: &[PathBuf],
    dpi: u16,
    jpeg_quality: u8,
    dest: &Path,
    progress: &Progress,
) -> Result<()> {
    let first = pages
        .first()
        .ok_or_else(|| Error::Unreadable("the document has no pages".into()))?;
    let (width, height) = dimensions(first)?;
    let slide = slide_size(width, height, dpi);
    let mut out = BufWriter::new(File::create(dest)?);
    out.write_all(head(slide).as_bytes())?;
    for (index, page) in pages.iter().enumerate() {
        progress.check()?;
        let (width, height) = dimensions(page)?;
        let frame = fit(slide, width, height);
        let picture = picture(page, jpeg_quality)?;
        write!(
            out,
            "<draw:page draw:name=\"page{}\" draw:style-name=\"dp1\" \
             draw:master-page-name=\"Kento\"><draw:frame draw:style-name=\"gr1\" \
             svg:x=\"{:.3}cm\" svg:y=\"{:.3}cm\" svg:width=\"{:.3}cm\" svg:height=\"{:.3}cm\">\
             <draw:image><office:binary-data>",
            index + 1,
            frame.x,
            frame.y,
            frame.width,
            frame.height
        )?;
        out.write_all(base64(&picture).as_bytes())?;
        out.write_all(b"</office:binary-data></draw:image></draw:frame></draw:page>\n")?;
    }
    out.write_all(TAIL.as_bytes())?;
    out.flush()?;
    Ok(())
}

fn head(slide: Box2) -> String {
    let orientation = if slide.width >= slide.height {
        "landscape"
    } else {
        "portrait"
    };
    format!(
        "{HEAD}<office:automatic-styles>\n\
         <style:page-layout style:name=\"PM1\"><style:page-layout-properties \
         fo:margin-top=\"0cm\" fo:margin-bottom=\"0cm\" fo:margin-left=\"0cm\" \
         fo:margin-right=\"0cm\" fo:page-width=\"{:.3}cm\" fo:page-height=\"{:.3}cm\" \
         style:print-orientation=\"{orientation}\"/></style:page-layout>\n\
         <style:style style:name=\"dp1\" style:family=\"drawing-page\">\
         <style:drawing-page-properties draw:fill=\"solid\" draw:fill-color=\"#ffffff\" \
         presentation:background-visible=\"true\" \
         presentation:background-objects-visible=\"true\"/></style:style>\n\
         <style:style style:name=\"gr1\" style:family=\"graphic\">\
         <style:graphic-properties draw:stroke=\"none\" draw:fill=\"none\"/></style:style>\n\
         </office:automatic-styles>\n\
         <office:master-styles><style:master-page style:name=\"Kento\" \
         style:page-layout-name=\"PM1\"/></office:master-styles>\n\
         <office:body>\n<office:presentation>\n",
        slide.width, slide.height
    )
}

fn dimensions(path: &Path) -> Result<(u32, u32)> {
    let (width, height) = ::image::image_dimensions(path).map_err(image_error)?;
    if width == 0 || height == 0 {
        return Err(Error::Other("a page picture is empty".into()));
    }
    Ok((width, height))
}

fn image_error(error: ImageError) -> Error {
    match error {
        ImageError::IoError(error) => Error::Io(error),
        other => Error::Other(other.to_string()),
    }
}

/// The page's size at `dpi`, scaled into PowerPoint's limits at the same aspect where possible.
fn slide_size(width: u32, height: u32, dpi: u16) -> Box2 {
    let inch = 2.54 / f64::from(dpi.max(1));
    let (mut width, mut height) = (f64::from(width) * inch, f64::from(height) * inch);
    let longer = width.max(height);
    if longer > SIDE_MAX_CM {
        width *= SIDE_MAX_CM / longer;
        height *= SIDE_MAX_CM / longer;
    }
    let shorter = width.min(height);
    if shorter < SIDE_MIN_CM {
        width *= SIDE_MIN_CM / shorter;
        height *= SIDE_MIN_CM / shorter;
    }
    Box2 {
        x: 0.0,
        y: 0.0,
        width: width.clamp(SIDE_MIN_CM, SIDE_MAX_CM),
        height: height.clamp(SIDE_MIN_CM, SIDE_MAX_CM),
    }
}

/// The largest frame at the picture's aspect that fits the slide, centred.
fn fit(slide: Box2, width: u32, height: u32) -> Box2 {
    let (width, height) = (f64::from(width), f64::from(height));
    let scale = (slide.width / width).min(slide.height / height);
    let (w, h) = (width * scale, height * scale);
    Box2 {
        x: (slide.width - w) / 2.0,
        y: (slide.height - h) / 2.0,
        width: w,
        height: h,
    }
}

/// The page picture's bytes: the PNG as it is, or a JPEG on white when the PNG is large.
fn picture(path: &Path, quality: u8) -> Result<Vec<u8>> {
    if fs::metadata(path)?.len() <= PNG_LIMIT {
        return Ok(fs::read(path)?);
    }
    let page = ::image::open(path).map_err(image_error)?.to_rgba8();
    let flat = RgbImage::from_fn(page.width(), page.height(), |x, y| {
        let pixel = page.get_pixel(x, y);
        let alpha = u32::from(pixel[3]);
        ::image::Rgb(std::array::from_fn(|c| {
            ((u32::from(pixel[c]) * alpha + 255 * (255 - alpha) + 127) / 255) as u8
        }))
    });
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, quality.clamp(1, 100))
        .encode_image(&flat)
        .map_err(image_error)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn save(path: &Path, width: u32, height: u32, noisy: bool) {
        let mut seed: u32 = 12345;
        let picture = ::image::RgbaImage::from_fn(width, height, |x, y| {
            if noisy {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                let v = seed.to_le_bytes();
                ::image::Rgba([v[1], v[2], v[3], 255])
            } else {
                ::image::Rgba([(x % 256) as u8, (y % 256) as u8, 90, 255])
            }
        });
        picture.save(path).unwrap();
    }

    #[test]
    fn office_fodp_slides_take_the_first_pages_size_and_fit_every_page() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("Sayfalar ğ 🧪");
        fs::create_dir(&folder).unwrap();
        // A4 landscape and portrait at 72 dpi, then a noisy page that goes in as JPEG.
        let pages = [
            folder.join("p-1.png"),
            folder.join("p-2.png"),
            folder.join("p-3.png"),
        ];
        save(&pages[0], 842, 595, false);
        save(&pages[1], 595, 842, false);
        save(&pages[2], 900, 700, true);
        assert!(fs::metadata(&pages[2]).unwrap().len() > PNG_LIMIT);
        let dest = folder.join("slaytlar.fodp");
        write(&pages, 72, 85, &dest, &Progress::none()).unwrap();

        let xml = fs::read_to_string(&dest).unwrap();
        let doc = roxmltree::Document::parse(&xml).expect("well-formed XML");
        let draw = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0";
        let fo = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0";
        let svg = "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0";
        let layout = doc
            .descendants()
            .find(|n| n.has_tag_name("page-layout-properties"))
            .unwrap();
        let cm =
            |value: Option<&str>| -> f64 { value.unwrap().trim_end_matches("cm").parse().unwrap() };
        let (width, height) = (
            cm(layout.attribute((fo, "page-width"))),
            cm(layout.attribute((fo, "page-height"))),
        );
        assert!(
            (width - 29.7).abs() < 0.05 && (height - 20.99).abs() < 0.05,
            "{width} × {height}"
        );
        let slides: Vec<_> = doc
            .descendants()
            .filter(|n| n.has_tag_name((draw, "page")))
            .collect();
        assert_eq!(slides.len(), 3);
        let frames: Vec<_> = doc
            .descendants()
            .filter(|n| n.has_tag_name((draw, "frame")))
            .collect();
        // The portrait page stands centred on the landscape slide at its own aspect.
        let portrait = frames[1];
        let frame_width = cm(portrait.attribute((svg, "width")));
        let frame_height = cm(portrait.attribute((svg, "height")));
        assert!((frame_height - height).abs() < 0.01);
        assert!((frame_width / frame_height - 595.0 / 842.0).abs() < 0.001);
        let x = cm(portrait.attribute((svg, "x")));
        assert!((x * 2.0 + frame_width - width).abs() < 0.01);
        let data: Vec<&str> = doc
            .descendants()
            .filter(|n| n.has_tag_name("binary-data"))
            .map(|n| n.text().unwrap())
            .collect();
        assert!(data[0].starts_with("iVBORw0KGgo"), "a PNG");
        assert!(data[2].starts_with("/9j/"), "a large page goes in as JPEG");
    }

    #[test]
    fn office_fodp_slide_sizes_stay_in_powerpoints_limits() {
        let a4 = slide_size(1240, 1754, 150);
        assert!((a4.width - 21.0).abs() < 0.01 && (a4.height - 29.7).abs() < 0.01);
        let poster = slide_size(20_000, 10_000, 72);
        assert!((poster.width - SIDE_MAX_CM).abs() < 1e-9);
        assert!((poster.height - SIDE_MAX_CM / 2.0).abs() < 1e-9);
        let stamp = slide_size(10, 20, 72);
        assert!((stamp.width - SIDE_MIN_CM).abs() < 1e-9);
        assert!((stamp.height - SIDE_MIN_CM * 2.0).abs() < 1e-9);
        let ribbon = slide_size(100_000, 10, 72);
        assert!(ribbon.width <= SIDE_MAX_CM && ribbon.height >= SIDE_MIN_CM);
        let frame = fit(
            Box2 {
                x: 0.0,
                y: 0.0,
                width: 20.0,
                height: 10.0,
            },
            100,
            100,
        );
        assert_eq!(
            frame,
            Box2 {
                x: 5.0,
                y: 0.0,
                width: 10.0,
                height: 10.0
            }
        );
    }

    #[test]
    fn office_fodp_no_pages_is_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("x.fodp");
        assert!(matches!(
            write(&[], 150, 90, &dest, &Progress::none()),
            Err(Error::Unreadable(_))
        ));
    }
}
