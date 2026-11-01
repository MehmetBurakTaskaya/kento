// SPDX-License-Identifier: MIT
//! AVIF reading: `avif-parse` for the container, `rav1d` for the AV1 frames and `yuv` for the
//! colour conversion. The few container properties `avif-parse` leaves out (rotation, mirroring,
//! colour profile) are read here.

use std::ffi::{c_int, c_uint};
use std::mem::MaybeUninit;
use std::path::Path;
use std::ptr::{self, NonNull};

use ::image::{DynamicImage, ImageBuffer, Rgba};
use rav1d::include::dav1d::data::Dav1dData;
use rav1d::include::dav1d::dav1d::{Dav1dContext, Dav1dSettings};
use rav1d::include::dav1d::headers::{
    DAV1D_MC_BT2020_CL, DAV1D_MC_BT2020_NCL, DAV1D_MC_BT470BG, DAV1D_MC_BT601, DAV1D_MC_BT709,
    DAV1D_MC_FCC, DAV1D_MC_IDENTITY, DAV1D_MC_SMPTE240, DAV1D_MC_SMPTE_YCGCO,
    DAV1D_PIXEL_LAYOUT_I400, DAV1D_PIXEL_LAYOUT_I420, DAV1D_PIXEL_LAYOUT_I422,
    DAV1D_PIXEL_LAYOUT_I444,
};
use rav1d::include::dav1d::picture::Dav1dPicture;
use rav1d::src::lib::{
    dav1d_close, dav1d_data_create, dav1d_data_unref, dav1d_default_settings, dav1d_get_picture,
    dav1d_open, dav1d_picture_unref, dav1d_send_data,
};
use rav1d::Dav1dResult;
use yuv::{YuvError, YuvGrayImage, YuvPlanarImage, YuvRange, YuvStandardMatrix};

use super::decode::Decoded;
use super::{check_size, read_input, MAX_PIXELS};
use crate::{Error, Result};

pub(super) fn decode(path: &Path) -> Result<Decoded> {
    let mut file = read_input(path)?;
    accept_compatible_brand(&mut file);
    let properties = Properties::read(&file);
    let avif = avif_parse::read_avif(&mut file.as_slice()).map_err(parse_error)?;
    let metadata = avif.primary_item_metadata().map_err(parse_error)?;
    check_size(
        metadata.max_frame_width.get(),
        metadata.max_frame_height.get(),
    )?;

    let color = decode_av1(&avif.primary_item)?;
    let mut image = to_rgba(&color, properties.nclx)?;
    if let Some(item) = &avif.alpha_item {
        let alpha = decode_av1(item)?;
        apply_alpha(&mut image, &alpha, avif.premultiplied_alpha)?;
    }
    Ok(Decoded {
        image: properties.orient(image),
        icc: properties.icc,
        lossy: true,
        jpeg_as_is: false,
    })
}

/// `avif-parse` wants `avif` as the major brand; files that only list it among the compatible
/// brands (or lead with the animation brand) still hold an AVIF still image.
fn accept_compatible_brand(file: &mut [u8]) {
    if file.len() < 16 || &file[4..8] != b"ftyp" || &file[8..12] == b"avif" {
        return;
    }
    let size = u32::from_be_bytes([file[0], file[1], file[2], file[3]]) as usize;
    let size = size.clamp(16, file.len());
    if file[16..size]
        .as_chunks::<4>()
        .0
        .iter()
        .any(|brand| brand == b"avif")
    {
        file[8..12].copy_from_slice(b"avif");
    }
}

fn parse_error(error: avif_parse::Error) -> Error {
    match error {
        avif_parse::Error::OutOfMemory => Error::Limit("the AVIF file is too large".into()),
        avif_parse::Error::Io(error) => Error::Io(error),
        other => Error::Unreadable(format!("AVIF: {other}")),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Layout {
    I400,
    I420,
    I422,
    I444,
}

impl Layout {
    fn chroma_size(self, width: u32, height: u32) -> (u32, u32) {
        match self {
            Layout::I400 => (0, 0),
            Layout::I420 => (width.div_ceil(2), height.div_ceil(2)),
            Layout::I422 => (width.div_ceil(2), height),
            Layout::I444 => (width, height),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Shape {
    width: u32,
    height: u32,
    depth: u8,
    layout: Layout,
    full_range: bool,
}

enum Planes {
    Eight([Vec<u8>; 3]),
    High([Vec<u16>; 3]),
}

/// One decoded AV1 frame, its planes copied out of the decoder.
struct Frame {
    shape: Shape,
    planes: Planes,
    matrix: c_uint,
}

struct Decoder(Option<Dav1dContext>);

impl Drop for Decoder {
    fn drop(&mut self) {
        // SAFETY: the context came from `dav1d_open`; `dav1d_close` takes it out and frees it.
        unsafe { dav1d_close(Some(NonNull::from(&mut self.0))) }
    }
}

struct Data(Dav1dData);

impl Drop for Data {
    fn drop(&mut self) {
        // SAFETY: the data is either empty or was made by `dav1d_data_create`.
        unsafe { dav1d_data_unref(Some(NonNull::from(&mut self.0))) }
    }
}

struct Picture(Dav1dPicture);

impl Drop for Picture {
    fn drop(&mut self) {
        // SAFETY: the picture is either empty or was filled by `dav1d_get_picture`.
        unsafe { dav1d_picture_unref(Some(NonNull::from(&mut self.0))) }
    }
}

fn check(result: Dav1dResult) -> Result<()> {
    if result.0 < 0 {
        Err(Error::Unreadable(format!(
            "the AV1 image could not be decoded (error {})",
            -result.0
        )))
    } else {
        Ok(())
    }
}

fn decode_av1(obu: &[u8]) -> Result<Frame> {
    if obu.is_empty() {
        return Err(Error::Unreadable("the AVIF file has no image data".into()));
    }
    let mut settings = MaybeUninit::<Dav1dSettings>::uninit();
    // SAFETY: `dav1d_default_settings` writes every field of the settings.
    let mut settings = unsafe {
        dav1d_default_settings(NonNull::new_unchecked(settings.as_mut_ptr()));
        settings.assume_init()
    };
    settings.n_threads =
        std::thread::available_parallelism().map_or(1, |threads| threads.get().min(8)) as c_int;
    settings.max_frame_delay = 1;
    settings.all_layers = 0;
    settings.frame_size_limit = MAX_PIXELS as c_uint;
    // SAFETY: a logger without cookie and callback (all zero, both `None`) turns logging off.
    settings.logger = unsafe { std::mem::zeroed() };

    let mut decoder = Decoder(None);
    // SAFETY: both pointers are valid for the call; the context lands in `decoder`.
    check(unsafe {
        dav1d_open(
            Some(NonNull::from(&mut decoder.0)),
            Some(NonNull::from(&mut settings)),
        )
    })?;
    let context = decoder.0;

    let mut data = Data(Dav1dData::default());
    // SAFETY: on success the decoder owns a fresh buffer of `obu.len()` bytes inside `data`.
    let buffer = unsafe { dav1d_data_create(Some(NonNull::from(&mut data.0)), obu.len()) };
    if buffer.is_null() {
        return Err(Error::Limit("the AV1 image is too large".into()));
    }
    // SAFETY: `buffer` holds `obu.len()` bytes and does not overlap `obu`.
    unsafe { ptr::copy_nonoverlapping(obu.as_ptr(), buffer, obu.len()) };

    let mut picture = Picture(Dav1dPicture::default());
    let again = -libc::EAGAIN;
    let mut idle = 0;
    loop {
        if data.0.sz > 0 {
            // SAFETY: `context` is open and `data` is valid to read and write.
            let sent = unsafe { dav1d_send_data(context, Some(NonNull::from(&mut data.0))) };
            if sent.0 != again {
                check(sent)?;
            }
        }
        // SAFETY: `context` is open and `picture` is valid to write.
        let got = unsafe { dav1d_get_picture(context, Some(NonNull::from(&mut picture.0))) };
        if got.0 == 0 {
            break;
        }
        if got.0 != again {
            check(got)?;
        }
        if data.0.sz == 0 {
            idle += 1;
            if idle > 32 {
                return Err(Error::Unreadable("the AV1 data holds no picture".into()));
            }
        }
    }
    copy_frame(&picture.0)
}

fn copy_frame(picture: &Dav1dPicture) -> Result<Frame> {
    let unreadable = |what: &str| Error::Unreadable(format!("AV1: {what}"));
    let width = u32::try_from(picture.p.w).map_err(|_| unreadable("bad width"))?;
    let height = u32::try_from(picture.p.h).map_err(|_| unreadable("bad height"))?;
    check_size(width, height)?;
    let layout = match picture.p.layout {
        DAV1D_PIXEL_LAYOUT_I400 => Layout::I400,
        DAV1D_PIXEL_LAYOUT_I420 => Layout::I420,
        DAV1D_PIXEL_LAYOUT_I422 => Layout::I422,
        DAV1D_PIXEL_LAYOUT_I444 => Layout::I444,
        _ => return Err(unreadable("unknown pixel layout")),
    };
    let depth = u8::try_from(picture.p.bpc).map_err(|_| unreadable("bad bit depth"))?;
    // SAFETY: a decoded picture keeps its sequence header alive until it is unreferenced.
    let sequence = picture.seq_hdr.map(|header| unsafe { header.as_ref() });
    let (matrix, full_range) = sequence.map_or((DAV1D_MC_BT601, false), |header| {
        (header.mtrx, header.color_range != 0)
    });

    let (cw, ch) = layout.chroma_size(width, height);
    let sizes = [(width, height), (cw, ch), (cw, ch)];
    let strides = [picture.stride[0], picture.stride[1], picture.stride[1]];
    let planes = match depth {
        8 => Planes::Eight(copy_planes::<u8>(picture, sizes, strides)?),
        10 | 12 => Planes::High(copy_planes::<u16>(picture, sizes, strides)?),
        _ => return Err(unreadable("unsupported bit depth")),
    };
    Ok(Frame {
        shape: Shape {
            width,
            height,
            depth,
            layout,
            full_range,
        },
        planes,
        matrix,
    })
}

fn copy_planes<T: Copy>(
    picture: &Dav1dPicture,
    sizes: [(u32, u32); 3],
    strides: [isize; 3],
) -> Result<[Vec<T>; 3]> {
    let mut planes: [Vec<T>; 3] = Default::default();
    for (index, plane) in planes.iter_mut().enumerate() {
        let (width, height) = (sizes[index].0 as usize, sizes[index].1 as usize);
        if width == 0 {
            continue;
        }
        let base = picture.data[index]
            .ok_or_else(|| Error::Unreadable("AV1: a plane is missing".into()))?
            .as_ptr()
            .cast::<u8>();
        plane.reserve_exact(width * height);
        for row in 0..height {
            // SAFETY: the decoder lays out `height` rows of at least `width` samples of `T`,
            // `strides[index]` bytes apart, valid while the picture is referenced.
            let samples = unsafe {
                let start = base.offset(strides[index] * row as isize).cast::<T>();
                std::slice::from_raw_parts(start, width)
            };
            plane.extend_from_slice(samples);
        }
    }
    Ok(planes)
}

#[derive(Clone, Copy)]
enum Matrix {
    Yuv(YuvStandardMatrix),
    Identity,
    YCgCo,
}

impl Matrix {
    fn from_av1(coefficients: c_uint) -> Self {
        match coefficients {
            DAV1D_MC_IDENTITY => Matrix::Identity,
            DAV1D_MC_SMPTE_YCGCO => Matrix::YCgCo,
            DAV1D_MC_BT709 => Matrix::Yuv(YuvStandardMatrix::Bt709),
            DAV1D_MC_FCC => Matrix::Yuv(YuvStandardMatrix::Fcc),
            DAV1D_MC_BT470BG | DAV1D_MC_BT601 => Matrix::Yuv(YuvStandardMatrix::Bt601),
            DAV1D_MC_SMPTE240 => Matrix::Yuv(YuvStandardMatrix::Smpte240),
            DAV1D_MC_BT2020_NCL | DAV1D_MC_BT2020_CL => Matrix::Yuv(YuvStandardMatrix::Bt2020),
            // Unspecified and the rarer matrices: BT.601, as AVIF readers commonly do.
            _ => Matrix::Yuv(YuvStandardMatrix::Bt601),
        }
    }

    /// Gray frames only need the range; any matrix gives the same result.
    fn standard(self) -> YuvStandardMatrix {
        match self {
            Matrix::Yuv(matrix) => matrix,
            Matrix::Identity | Matrix::YCgCo => YuvStandardMatrix::Bt601,
        }
    }
}

fn yuv_error(error: YuvError) -> Error {
    Error::Unreadable(format!("AVIF colour conversion: {error}"))
}

fn identity_needs_444() -> Error {
    Error::Unreadable("AVIF: RGB-coded images must not be subsampled".into())
}

fn to_rgba(frame: &Frame, nclx: Option<(u16, bool)>) -> Result<DynamicImage> {
    // The container's colour box wins over the AV1 header when both are present.
    let (coefficients, full_range) = match nclx {
        Some((coefficients, full)) => (c_uint::from(coefficients), full),
        None => (frame.matrix, frame.shape.full_range),
    };
    let shape = Shape {
        full_range,
        ..frame.shape
    };
    let matrix = Matrix::from_av1(coefficients);
    let (width, height) = (shape.width, shape.height);
    let image = match &frame.planes {
        Planes::Eight([y, u, v]) => {
            let pixels = rgba8(shape, matrix, y, u, v)?;
            ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, pixels)
                .map(DynamicImage::ImageRgba8)
        }
        Planes::High([y, u, v]) => {
            let mut pixels = rgba_high(shape, matrix, y, u, v)?;
            let depth = u32::from(shape.depth);
            for sample in &mut pixels {
                *sample = widen(u32::from(*sample), depth);
            }
            ImageBuffer::<Rgba<u16>, _>::from_raw(width, height, pixels)
                .map(DynamicImage::ImageRgba16)
        }
    };
    image.ok_or_else(|| Error::Other("AVIF: the converted buffer has the wrong size".into()))
}

/// A 10- or 12-bit sample to the full 16-bit range, repeating its top bits into the bottom.
fn widen(value: u32, depth: u32) -> u16 {
    ((value << (16 - depth)) | (value >> (2 * depth - 16))) as u16
}

fn rgba8(shape: Shape, matrix: Matrix, y: &[u8], u: &[u8], v: &[u8]) -> Result<Vec<u8>> {
    let Shape { width, height, .. } = shape;
    let (chroma_width, _) = shape.layout.chroma_size(width, height);
    let range = range(shape);
    let stride = width * 4;
    let mut out = vec![0u8; width as usize * height as usize * 4];
    let planar = YuvPlanarImage {
        y_plane: y,
        y_stride: width,
        u_plane: u,
        u_stride: chroma_width,
        v_plane: v,
        v_stride: chroma_width,
        width,
        height,
    };
    let result = match (shape.layout, matrix) {
        (Layout::I400, matrix) => {
            let gray = YuvGrayImage {
                y_plane: y,
                y_stride: width,
                width,
                height,
            };
            yuv::yuv400_to_rgba(&gray, &mut out, stride, range, matrix.standard())
        }
        (Layout::I444, Matrix::Identity) => {
            identity(shape, [y, u, v], &mut out, u8::MAX);
            Ok(())
        }
        (_, Matrix::Identity) => return Err(identity_needs_444()),
        (Layout::I420, Matrix::YCgCo) => yuv::ycgco420_to_rgba(&planar, &mut out, stride, range),
        (Layout::I422, Matrix::YCgCo) => yuv::ycgco422_to_rgba(&planar, &mut out, stride, range),
        (Layout::I444, Matrix::YCgCo) => yuv::ycgco444_to_rgba(&planar, &mut out, stride, range),
        (Layout::I420, Matrix::Yuv(m)) => yuv::yuv420_to_rgba(&planar, &mut out, stride, range, m),
        (Layout::I422, Matrix::Yuv(m)) => yuv::yuv422_to_rgba(&planar, &mut out, stride, range, m),
        (Layout::I444, Matrix::Yuv(m)) => yuv::yuv444_to_rgba(&planar, &mut out, stride, range, m),
    };
    result.map_err(yuv_error)?;
    Ok(out)
}

type High = fn(
    &YuvPlanarImage<u16>,
    &mut [u16],
    u32,
    YuvRange,
    YuvStandardMatrix,
) -> std::result::Result<(), YuvError>;
type HighGray = fn(
    &YuvGrayImage<u16>,
    &mut [u16],
    u32,
    YuvRange,
    YuvStandardMatrix,
) -> std::result::Result<(), YuvError>;
type HighCgCo =
    fn(&YuvPlanarImage<u16>, &mut [u16], u32, YuvRange) -> std::result::Result<(), YuvError>;

/// 10- and 12-bit frames to RGBA samples of the same depth.
fn rgba_high(shape: Shape, matrix: Matrix, y: &[u16], u: &[u16], v: &[u16]) -> Result<Vec<u16>> {
    let Shape { width, height, .. } = shape;
    let (chroma_width, _) = shape.layout.chroma_size(width, height);
    let range = range(shape);
    let stride = width * 4;
    let twelve = shape.depth == 12;
    let mut out = vec![0u16; width as usize * height as usize * 4];
    let planar = YuvPlanarImage {
        y_plane: y,
        y_stride: width,
        u_plane: u,
        u_stride: chroma_width,
        v_plane: v,
        v_stride: chroma_width,
        width,
        height,
    };
    let result = match (shape.layout, matrix) {
        (Layout::I400, matrix) => {
            let gray = YuvGrayImage {
                y_plane: y,
                y_stride: width,
                width,
                height,
            };
            let convert: HighGray = if twelve {
                yuv::y012_to_rgba12
            } else {
                yuv::y010_to_rgba10
            };
            convert(&gray, &mut out, stride, range, matrix.standard())
        }
        (Layout::I444, Matrix::Identity) => {
            let max = ((1u32 << shape.depth) - 1) as u16;
            identity(shape, [y, u, v], &mut out, max);
            Ok(())
        }
        (_, Matrix::Identity) => return Err(identity_needs_444()),
        (layout, Matrix::YCgCo) => {
            let convert: HighCgCo = match (layout, twelve) {
                (Layout::I420, false) => yuv::icgc010_to_rgba10,
                (Layout::I420, true) => yuv::icgc012_to_rgba12,
                (Layout::I422, false) => yuv::icgc210_to_rgba10,
                (Layout::I422, true) => yuv::icgc212_to_rgba12,
                (_, false) => yuv::icgc410_to_rgba10,
                (_, true) => yuv::icgc412_to_rgba12,
            };
            convert(&planar, &mut out, stride, range)
        }
        (layout, Matrix::Yuv(m)) => {
            let convert: High = match (layout, twelve) {
                (Layout::I420, false) => yuv::i010_to_rgba10,
                (Layout::I420, true) => yuv::i012_to_rgba12,
                (Layout::I422, false) => yuv::i210_to_rgba10,
                (Layout::I422, true) => yuv::i212_to_rgba12,
                (_, false) => yuv::i410_to_rgba10,
                (_, true) => yuv::i412_to_rgba12,
            };
            convert(&planar, &mut out, stride, range, m)
        }
    };
    result.map_err(yuv_error)?;
    Ok(out)
}

fn range(shape: Shape) -> YuvRange {
    if shape.full_range {
        YuvRange::Full
    } else {
        YuvRange::Limited
    }
}

/// Limited ("studio") range to full range at the given depth.
fn expand(value: u32, depth: u8, full_range: bool) -> u32 {
    let max = (1u32 << depth) - 1;
    if full_range {
        return value.min(max);
    }
    let shift = u32::from(depth - 8);
    let (low, span) = (16 << shift, 219 << shift);
    ((value.saturating_sub(low) * max + span / 2) / span).min(max)
}

/// RGB coded without a matrix: AV1 keeps green in Y, blue in U and red in V.
fn identity<T>(shape: Shape, [g, b, r]: [&[T]; 3], out: &mut [T], opaque: T)
where
    T: Copy + Into<u32> + TryFrom<u32>,
{
    let sample = |value: T| {
        T::try_from(expand(value.into(), shape.depth, shape.full_range)).unwrap_or(opaque)
    };
    for (index, pixel) in out.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        pixel[0] = sample(r[index]);
        pixel[1] = sample(g[index]);
        pixel[2] = sample(b[index]);
        pixel[3] = opaque;
    }
}

fn apply_alpha(image: &mut DynamicImage, alpha: &Frame, premultiplied: bool) -> Result<()> {
    let shape = alpha.shape;
    if (shape.width, shape.height) != (image.width(), image.height()) {
        return Err(Error::Unreadable(
            "AVIF: the alpha plane does not match the image size".into(),
        ));
    }
    // Normalise to 16 bits first: the alpha plane may have another depth than the colour planes.
    let max = (1u32 << shape.depth) - 1;
    let to16 = |value: u32| (expand(value, shape.depth, shape.full_range) * 65_535 + max / 2) / max;
    let values: Vec<u32> = match &alpha.planes {
        Planes::Eight([y, ..]) => y.iter().map(|&a| to16(u32::from(a))).collect(),
        Planes::High([y, ..]) => y.iter().map(|&a| to16(u32::from(a))).collect(),
    };
    match image {
        DynamicImage::ImageRgba8(buffer) => {
            for (pixel, &a) in buffer.pixels_mut().zip(&values) {
                let a = (a + 128) / 257;
                pixel[3] = a as u8;
                if premultiplied {
                    unpremultiply_pixel(&mut pixel.0[..3], a, 255);
                }
            }
        }
        DynamicImage::ImageRgba16(buffer) => {
            for (pixel, &a) in buffer.pixels_mut().zip(&values) {
                pixel[3] = a as u16;
                if premultiplied {
                    unpremultiply_pixel(&mut pixel.0[..3], a, 65_535);
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn unpremultiply_pixel<T>(channels: &mut [T], alpha: u32, max: u32)
where
    T: Copy + Into<u32> + TryFrom<u32>,
{
    if alpha == 0 || alpha >= max {
        return;
    }
    for channel in channels {
        let value = ((*channel).into() * max + alpha / 2) / alpha;
        if let Ok(value) = T::try_from(value.min(max)) {
            *channel = value;
        }
    }
}

/// The primary item's transform and colour properties from the HEIF container (ISO/IEC 23008-12).
#[derive(Debug, Default)]
pub(super) struct Properties {
    /// Anticlockwise quarter turns (`irot`).
    pub rotation: u8,
    /// `imir`: 0 mirrors about the vertical axis (left and right swap), 1 about the horizontal.
    pub mirror: Option<u8>,
    pub icc: Option<Vec<u8>>,
    /// `colr` of type `nclx`: matrix coefficients and the full-range flag.
    pub nclx: Option<(u16, bool)>,
}

impl Properties {
    pub fn read(file: &[u8]) -> Self {
        let mut found = Self::default();
        let Some(meta) = boxes(file).find(|(kind, _)| kind == b"meta") else {
            return found;
        };
        // `meta` is a full box: version and flags come before its children.
        let meta = meta.1.get(4..).unwrap_or_default();
        let (mut primary, mut ipco, mut ipma) = (None, None, None);
        for (kind, body) in boxes(meta) {
            match &kind {
                b"pitm" => primary = primary_item(body),
                b"iprp" => {
                    for (kind, body) in boxes(body) {
                        match &kind {
                            b"ipco" => ipco = Some(body),
                            b"ipma" => ipma = Some(body),
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
        let (Some(primary), Some(ipco), Some(ipma)) = (primary, ipco, ipma) else {
            return found;
        };
        let properties: Vec<([u8; 4], &[u8])> = boxes(ipco).collect();
        for index in associations(ipma, primary).unwrap_or_default() {
            let Some((kind, body)) = index.checked_sub(1).and_then(|i| properties.get(i)) else {
                continue;
            };
            match kind {
                b"irot" => found.rotation = body.first().map_or(0, |angle| angle & 3),
                b"imir" => found.mirror = body.first().map(|axis| axis & 1),
                b"colr" if body.len() >= 4 => match &body[0..4] {
                    b"prof" | b"rICC" => found.icc = Some(body[4..].to_vec()),
                    b"nclx" if body.len() >= 11 => {
                        let coefficients = u16::from_be_bytes([body[8], body[9]]);
                        found.nclx = Some((coefficients, body[10] & 0x80 != 0));
                    }
                    _ => {}
                },
                _ => {}
            }
        }
        found
    }

    /// MIAF fixes the order: rotation first, then mirroring.
    pub fn orient(&self, image: DynamicImage) -> DynamicImage {
        let image = match self.rotation {
            1 => image.rotate270(),
            2 => image.rotate180(),
            3 => image.rotate90(),
            _ => image,
        };
        match self.mirror {
            Some(0) => image.fliph(),
            Some(_) => image.flipv(),
            None => image,
        }
    }
}

/// The boxes directly inside `data`; stops at the first malformed one.
pub(super) fn boxes(data: &[u8]) -> impl Iterator<Item = ([u8; 4], &[u8])> {
    let mut rest = data;
    std::iter::from_fn(move || {
        let size = u64::from(u32::from_be_bytes(rest.get(0..4)?.try_into().ok()?));
        let kind: [u8; 4] = rest.get(4..8)?.try_into().ok()?;
        let (header, size) = match size {
            0 => (8, rest.len() as u64),
            1 => (16, u64::from_be_bytes(rest.get(8..16)?.try_into().ok()?)),
            size => (8, size),
        };
        if size < header as u64 || size > rest.len() as u64 {
            return None;
        }
        let body = &rest[header..size as usize];
        rest = &rest[size as usize..];
        Some((kind, body))
    })
}

fn primary_item(pitm: &[u8]) -> Option<u32> {
    match pitm.first()? {
        0 => Some(u32::from(u16::from_be_bytes(
            pitm.get(4..6)?.try_into().ok()?,
        ))),
        _ => Some(u32::from_be_bytes(pitm.get(4..8)?.try_into().ok()?)),
    }
}

/// The 1-based property indices associated with `item` in an `ipma` box.
fn associations(ipma: &[u8], item: u32) -> Option<Vec<usize>> {
    let mut reader = Reader(ipma);
    let version = reader.u8()?;
    let flags = reader.bytes(3)?;
    let wide_index = flags[2] & 1 != 0;
    for _ in 0..reader.u32()? {
        let id = if version < 1 {
            u32::from(reader.u16()?)
        } else {
            reader.u32()?
        };
        let count = reader.u8()?;
        let mut indices = Vec::with_capacity(usize::from(count));
        for _ in 0..count {
            let index = if wide_index {
                usize::from(reader.u16()? & 0x7fff)
            } else {
                usize::from(reader.u8()? & 0x7f)
            };
            indices.push(index);
        }
        if id == item {
            return Some(indices);
        }
    }
    None
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn bytes(&mut self, count: usize) -> Option<&'a [u8]> {
        let (head, rest) = (self.0.get(..count)?, self.0.get(count..)?);
        self.0 = rest;
        Some(head)
    }

    fn u8(&mut self) -> Option<u8> {
        Some(self.bytes(1)?[0])
    }

    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_be_bytes(self.bytes(2)?.try_into().ok()?))
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_be_bytes(self.bytes(4)?.try_into().ok()?))
    }
}

/// The encoder used by the round-trip tests only writes 4:4:4, so the other layouts, depths and
/// matrices are checked here on hand-made planes.
#[cfg(test)]
mod tests {
    use super::*;

    fn frame(shape: Shape, matrix: c_uint, [y, u, v]: [u16; 3]) -> Frame {
        let (width, height) = (shape.width, shape.height);
        let (cw, ch) = shape.layout.chroma_size(width, height);
        let scale = 1 << (shape.depth - 8);
        let plane = |value: u16, w: u32, h: u32| vec![value * scale; (w * h) as usize];
        let planes = [plane(y, width, height), plane(u, cw, ch), plane(v, cw, ch)];
        let planes = if shape.depth == 8 {
            Planes::Eight(planes.map(|plane| plane.into_iter().map(|s| s as u8).collect()))
        } else {
            Planes::High(planes)
        };
        Frame {
            shape,
            planes,
            matrix,
        }
    }

    fn pixel(frame: &Frame) -> [u8; 4] {
        let image = to_rgba(frame, None).unwrap().to_rgba8();
        assert_eq!(image.dimensions(), (frame.shape.width, frame.shape.height));
        image
            .get_pixel(frame.shape.width - 1, frame.shape.height - 1)
            .0
    }

    fn assert_near(actual: [u8; 4], expected: [u8; 3], what: &str) {
        for channel in 0..3 {
            assert!(
                actual[channel].abs_diff(expected[channel]) <= 4,
                "{what}: {actual:?}, expected about {expected:?}"
            );
        }
        assert_eq!(actual[3], 255, "{what}: opaque");
    }

    #[test]
    fn every_layout_and_depth() {
        // Odd sizes catch rounding of the subsampled chroma planes.
        for depth in [8, 10, 12] {
            for layout in [Layout::I400, Layout::I420, Layout::I422, Layout::I444] {
                let shape = Shape {
                    width: 5,
                    height: 3,
                    depth,
                    layout,
                    full_range: false,
                };
                // Studio-range BT.601 red; a gray frame keeps only its luma.
                let red = frame(shape, DAV1D_MC_BT601, [81, 90, 240]);
                let expected = if layout == Layout::I400 {
                    [76, 76, 76]
                } else {
                    [255, 0, 0]
                };
                assert_near(pixel(&red), expected, &format!("{layout:?} {depth}-bit"));
            }
        }
    }

    #[test]
    fn identity_and_ycgco() {
        for depth in [8, 10] {
            let shape = Shape {
                width: 3,
                height: 3,
                depth,
                layout: Layout::I444,
                full_range: true,
            };
            let rgb = frame(shape, DAV1D_MC_IDENTITY, [10, 20, 30]);
            assert_near(pixel(&rgb), [30, 10, 20], &format!("identity {depth}-bit"));
            let gray = frame(shape, DAV1D_MC_SMPTE_YCGCO, [128, 128, 128]);
            assert_near(pixel(&gray), [128, 128, 128], &format!("YCgCo {depth}-bit"));
        }
        let subsampled = Shape {
            width: 4,
            height: 4,
            depth: 8,
            layout: Layout::I420,
            full_range: true,
        };
        assert!(to_rgba(&frame(subsampled, DAV1D_MC_IDENTITY, [1, 2, 3]), None).is_err());
    }

    #[test]
    fn alpha_planes() {
        let mut image = DynamicImage::ImageRgba8(::image::RgbaImage::from_pixel(
            2,
            1,
            Rgba([100, 50, 0, 255]),
        ));
        let shape = Shape {
            width: 2,
            height: 1,
            depth: 10,
            layout: Layout::I400,
            full_range: false,
        };
        // Studio-range alpha halfway along its span, with the colour stored premultiplied.
        let half = 16 + 219 / 2;
        apply_alpha(
            &mut image,
            &frame(shape, DAV1D_MC_BT601, [half, 0, 0]),
            true,
        )
        .unwrap();
        let pixel = image.to_rgba8().get_pixel(0, 0).0;
        assert!(pixel[3].abs_diff(127) <= 2, "{pixel:?}");
        assert!(pixel[0].abs_diff(200) <= 4, "{pixel:?}");
        assert!(pixel[1].abs_diff(100) <= 4, "{pixel:?}");
    }
}
