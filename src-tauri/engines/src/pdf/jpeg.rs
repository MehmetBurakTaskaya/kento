// SPDX-License-Identifier: MIT
//! Reads what a PDF needs from a JPEG header without decoding the picture: the frame header
//! (ISO/IEC 10918-1), JFIF and Exif densities, the Exif orientation and the Adobe APP14 marker.

/// What `images_to_pdf` needs to embed a JPEG as it is.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct JpegInfo {
    pub width: u16,
    pub height: u16,
    /// 1 (gray), 3 (RGB) or 4 (CMYK).
    pub components: u8,
    /// An Adobe APP14 marker: Adobe tools store 4-component data inverted.
    pub adobe: bool,
    /// Pixels per inch (x, y), when the file states a plausible density.
    pub dpi: Option<(f32, f32)>,
    /// The Exif orientation (1 to 8); 1 when the file has none.
    pub orientation: u16,
}

/// `None` when the bytes are not an 8-bit baseline or progressive JPEG that a PDF reader's
/// DCTDecode filter can show, or when the header is damaged.
pub(super) fn read(bytes: &[u8]) -> Option<JpegInfo> {
    if !bytes.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut jfif_dpi = None;
    let mut exif: Option<Exif> = None;
    let mut adobe = false;
    let mut pos = 2;
    loop {
        if *bytes.get(pos)? != 0xFF {
            return None;
        }
        while *bytes.get(pos)? == 0xFF {
            pos += 1;
        }
        let marker = bytes[pos];
        pos += 1;
        if marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            continue;
        }
        // The end of the image or the scan data before any frame header.
        if marker == 0xD9 || marker == 0xDA {
            return None;
        }
        let length = usize::from(be16(bytes, pos)?);
        let segment = bytes.get(pos + 2..pos + length)?;
        match marker {
            0xE0 => jfif_dpi = jfif_dpi.or_else(|| jfif_density(segment)),
            0xE1 if exif.is_none() => exif = read_exif(segment),
            0xEE => adobe |= segment.starts_with(b"Adobe"),
            // Frame headers; C4 (DHT), C8 (JPG) and CC (DAC) share the range.
            0xC0..=0xCF if !matches!(marker, 0xC4 | 0xC8 | 0xCC) => {
                let precision = *segment.first()?;
                let height = be16(segment, 1)?;
                let width = be16(segment, 3)?;
                let components = *segment.get(5)?;
                if precision != 8 || width == 0 || height == 0 || ![1, 3, 4].contains(&components) {
                    return None;
                }
                let exif = exif.unwrap_or_default();
                return Some(JpegInfo {
                    width,
                    height,
                    components,
                    adobe,
                    dpi: jfif_dpi.or(exif.dpi),
                    orientation: exif.orientation,
                });
            }
            _ => {}
        }
        pos += length;
    }
}

#[derive(Debug, Clone, Copy)]
struct Exif {
    orientation: u16,
    dpi: Option<(f32, f32)>,
}

impl Default for Exif {
    fn default() -> Self {
        Self {
            orientation: 1,
            dpi: None,
        }
    }
}

fn be16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]))
}

fn jfif_density(segment: &[u8]) -> Option<(f32, f32)> {
    let rest = segment.strip_prefix(b"JFIF\0")?;
    let x = f32::from(be16(rest, 3)?);
    let y = f32::from(be16(rest, 5)?);
    match *rest.get(2)? {
        1 => per_inch(x, y, 1.0),
        2 => per_inch(x, y, 2.54),
        // 0 states only the aspect ratio.
        _ => None,
    }
}

fn per_inch(x: f32, y: f32, factor: f32) -> Option<(f32, f32)> {
    let (x, y) = (x * factor, y * factor);
    let plausible = |dpi: f32| (10.0..=10_000.0).contains(&dpi);
    (plausible(x) && plausible(y)).then_some((x, y))
}

/// The orientation and resolution tags of IFD0 (Exif 2.3, TIFF 6.0).
fn read_exif(segment: &[u8]) -> Option<Exif> {
    let tiff = segment.strip_prefix(b"Exif\0\0")?;
    let little = match tiff.get(..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |at: usize| -> Option<u16> {
        let b = tiff.get(at..at.checked_add(2)?)?;
        Some(if little {
            u16::from_le_bytes([b[0], b[1]])
        } else {
            u16::from_be_bytes([b[0], b[1]])
        })
    };
    let u32_at = |at: usize| -> Option<u32> {
        let b = tiff.get(at..at.checked_add(4)?)?;
        let b = [b[0], b[1], b[2], b[3]];
        Some(if little {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        })
    };
    if u16_at(2)? != 42 {
        return None;
    }
    let ifd = usize::try_from(u32_at(4)?).ok()?;
    let rational = |entry: usize| -> Option<f32> {
        let at = usize::try_from(u32_at(entry + 8)?).ok()?;
        let (num, den) = (u32_at(at)?, u32_at(at.checked_add(4)?)?);
        (den != 0).then(|| num as f32 / den as f32)
    };
    let mut exif = Exif::default();
    let (mut x, mut y, mut unit) = (None, None, 2);
    for i in 0..usize::from(u16_at(ifd)?) {
        let entry = ifd + 2 + i * 12;
        let (Some(tag), Some(kind)) = (u16_at(entry), u16_at(entry + 2)) else {
            break;
        };
        const SHORT: u16 = 3;
        const RATIONAL: u16 = 5;
        match (tag, kind) {
            (0x0112, SHORT) => {
                exif.orientation = u16_at(entry + 8)
                    .filter(|o| (1..=8).contains(o))
                    .unwrap_or(1)
            }
            (0x0128, SHORT) => unit = u16_at(entry + 8).unwrap_or(2),
            (0x011A, RATIONAL) => x = rational(entry),
            (0x011B, RATIONAL) => y = rational(entry),
            _ => {}
        }
    }
    exif.dpi = match (x, y, unit) {
        (Some(x), Some(y), 2) => per_inch(x, y, 1.0),
        (Some(x), Some(y), 3) => per_inch(x, y, 2.54),
        _ => None,
    };
    Some(exif)
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use ::image::codecs::jpeg::{JpegEncoder, PixelDensity};
    use ::image::{GrayImage, RgbImage};

    /// A small JPEG from the `image` crate, optionally with a JFIF density.
    pub(in crate::pdf) fn rgb_jpeg(width: u32, height: u32, dpi: Option<u16>) -> Vec<u8> {
        let image = RgbImage::from_fn(width, height, |x, y| {
            ::image::Rgb([(x * 7) as u8, (y * 5) as u8, 128])
        });
        let mut bytes = Vec::new();
        let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 85);
        if let Some(dpi) = dpi {
            encoder.set_pixel_density(PixelDensity::dpi(dpi));
        }
        encoder.encode_image(&image).unwrap();
        bytes
    }

    pub(in crate::pdf) fn gray_jpeg(width: u32, height: u32) -> Vec<u8> {
        let image = GrayImage::from_fn(width, height, |x, _| ::image::Luma([(x * 3) as u8]));
        let mut bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut bytes, 85)
            .encode_image(&image)
            .unwrap();
        bytes
    }

    /// Inserts a big-endian Exif APP1 segment with this orientation right after SOI.
    pub(in crate::pdf) fn with_orientation(jpeg: &[u8], orientation: u16) -> Vec<u8> {
        let mut tiff = b"MM\0\x2a\0\0\0\x08".to_vec();
        tiff.extend_from_slice(&1u16.to_be_bytes());
        tiff.extend_from_slice(&0x0112u16.to_be_bytes());
        tiff.extend_from_slice(&3u16.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&orientation.to_be_bytes());
        tiff.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
        let mut segment = b"Exif\0\0".to_vec();
        segment.extend_from_slice(&tiff);
        let mut out = jpeg[..2].to_vec();
        out.extend_from_slice(&[0xFF, 0xE1]);
        out.extend_from_slice(&((segment.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(&segment);
        out.extend_from_slice(&jpeg[2..]);
        out
    }

    /// A header-only CMYK JPEG written by an Adobe tool (no scan data).
    pub(in crate::pdf) fn adobe_cmyk_header() -> Vec<u8> {
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xEE, 0x00, 0x0E];
        out.extend_from_slice(b"Adobe\0\x64\0\0\0\0\x02");
        out.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x14, 8, 0, 20, 0, 30, 4]);
        for id in 1..=4u8 {
            out.extend_from_slice(&[id, 0x11, 0]);
        }
        out.extend_from_slice(&[0xFF, 0xD9]);
        out
    }

    #[test]
    fn pdf_jpeg_header_rgb_gray_and_density() {
        let rgb = read(&rgb_jpeg(40, 30, Some(300))).unwrap();
        assert_eq!((rgb.width, rgb.height, rgb.components), (40, 30, 3));
        assert_eq!(rgb.dpi, Some((300.0, 300.0)));
        assert_eq!(rgb.orientation, 1);
        assert!(!rgb.adobe);

        let gray = read(&gray_jpeg(12, 8)).unwrap();
        assert_eq!((gray.width, gray.height, gray.components), (12, 8, 1));
    }

    #[test]
    fn pdf_jpeg_header_exif_orientation_and_adobe() {
        let turned = read(&with_orientation(&rgb_jpeg(10, 20, None), 6)).unwrap();
        assert_eq!(turned.orientation, 6);
        assert_eq!((turned.width, turned.height), (10, 20));

        let cmyk = read(&adobe_cmyk_header()).unwrap();
        assert_eq!((cmyk.width, cmyk.height, cmyk.components), (30, 20, 4));
        assert!(cmyk.adobe);
    }

    #[test]
    fn pdf_jpeg_header_rejects_other_data() {
        assert_eq!(read(b"\x89PNG\r\n\x1a\n"), None);
        assert_eq!(read(&[0xFF, 0xD8, 0xFF]), None);
        let mut twelve_bit = adobe_cmyk_header();
        // The frame header's sample precision.
        twelve_bit[22] = 12;
        assert_eq!(read(&twelve_bit), None);
    }
}
