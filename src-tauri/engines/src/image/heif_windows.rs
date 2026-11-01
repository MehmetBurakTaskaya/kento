// SPDX-License-Identifier: MIT
//! HEIC through the Windows Imaging Component. The codec comes with the HEIF Image Extensions
//! (which need the HEVC Video Extensions); without them HEIC fails with `MissingCodec`.

use std::mem::ManuallyDrop;
use std::path::Path;
use std::ptr;

use ::image::{DynamicImage, Rgb, RgbImage, RgbaImage};
use windows::core::{w, HSTRING, PWSTR};
use windows::Win32::Foundation::{
    GENERIC_READ, RPC_E_CHANGED_MODE, WINCODEC_ERR_COMPONENTNOTFOUND,
};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_ContainerFormatHeif, GUID_WICPixelFormat24bppBGR,
    GUID_WICPixelFormat24bppRGB, GUID_WICPixelFormat32bppRGBA, IWICBitmapFrameDecode,
    IWICBitmapFrameEncode, IWICImagingFactory, WICBitmapDitherTypeNone, WICBitmapEncoderNoCache,
    WICBitmapPaletteTypeCustom, WICColorContextProfile, WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::StructuredStorage::{IPropertyBag2, PROPBAG2};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IStream, CLSCTX_INPROC_SERVER,
    COINIT_MULTITHREADED, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET,
};
use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_R4};
use windows::Win32::UI::Shell::SHCreateMemStream;

use super::check_size;
use super::decode::Decoded;
use crate::{Codec, Error, Result};

/// COM for one call on the current thread, released after every interface made under it (the
/// guard is the first local, so it drops last).
struct Com {
    owned: bool,
}

impl Com {
    fn init() -> Result<Self> {
        // SAFETY: plain per-thread COM initialisation, balanced in `drop`.
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if result.is_ok() {
            Ok(Self { owned: true })
        } else if result == RPC_E_CHANGED_MODE {
            // The thread already runs COM in another apartment, which WIC accepts as well.
            Ok(Self { owned: false })
        } else {
            Err(Error::Other(format!("COM could not start: {result}")))
        }
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.owned {
            // SAFETY: balances the successful `CoInitializeEx` above.
            unsafe { CoUninitialize() }
        }
    }
}

fn factory() -> Result<IWICImagingFactory> {
    // SAFETY: COM is initialised on this thread by the caller's guard.
    unsafe { CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER) }
        .map_err(|error| Error::Other(format!("WIC is not available: {error}")))
}

/// A missing component, or a Media Foundation error (facility 0xD) from the HEVC decoder behind
/// the HEIF codec, means the extensions are not installed.
fn is_missing_codec(error: &windows::core::Error) -> bool {
    let code = error.code();
    code == WINCODEC_ERR_COMPONENTNOTFOUND || (code.0 as u32) >> 16 == 0xC00D
}

fn read_error(error: windows::core::Error) -> Error {
    if is_missing_codec(&error) {
        Error::MissingCodec(Codec::Heif)
    } else {
        Error::Unreadable(format!("HEIC: {}", error.message()))
    }
}

fn write_error(error: windows::core::Error) -> Error {
    if is_missing_codec(&error) {
        Error::MissingCodec(Codec::Heif)
    } else {
        Error::Other(format!("HEIC could not be written: {}", error.message()))
    }
}

pub(super) fn decode(path: &Path) -> Result<Decoded> {
    let _com = Com::init()?;
    let factory = factory()?;
    // Without the extension there is no HEIF decoder at all; asking first keeps a damaged file
    // from being reported as a missing codec.
    // SAFETY: valid GUID pointer; a null vendor means any vendor.
    if unsafe { factory.CreateDecoder(&GUID_ContainerFormatHeif, ptr::null()) }.is_err() {
        return Err(Error::MissingCodec(Codec::Heif));
    }
    // SAFETY: the path string lives for the call; the decoder only reads the file.
    let decoder = unsafe {
        factory.CreateDecoderFromFilename(
            &HSTRING::from(path),
            None,
            GENERIC_READ,
            WICDecodeMetadataCacheOnDemand,
        )
    }
    .map_err(|error| Error::Unreadable(format!("HEIC: {}", error.message())))?;
    // SAFETY: plain COM calls on live interfaces; buffers are sized as WIC expects.
    unsafe {
        let frame = decoder.GetFrame(0).map_err(read_error)?;
        let (mut width, mut height) = (0, 0);
        frame.GetSize(&mut width, &mut height).map_err(read_error)?;
        check_size(width, height)?;
        // The HEIF codec applies the rotation and mirroring (`irot`, `imir`) itself and reports
        // the frame as upright, so no orientation step follows.
        let icc = color_profile(&factory, &frame);

        let converter = factory.CreateFormatConverter().map_err(read_error)?;
        converter
            .Initialize(
                &frame,
                &GUID_WICPixelFormat32bppRGBA,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )
            .map_err(read_error)?;
        let stride = width * 4;
        let mut pixels = vec![0u8; stride as usize * height as usize];
        converter
            .CopyPixels(ptr::null(), stride, &mut pixels)
            .map_err(read_error)?;
        let image = RgbaImage::from_raw(width, height, pixels)
            .ok_or_else(|| Error::Other("HEIC: short pixel buffer".into()))?;
        Ok(Decoded {
            image: DynamicImage::ImageRgba8(image),
            icc,
            lossy: true,
            jpeg_as_is: false,
        })
    }
}

fn color_profile(factory: &IWICImagingFactory, frame: &IWICBitmapFrameDecode) -> Option<Vec<u8>> {
    // SAFETY: plain COM calls; buffers are sized from the counts WIC reports.
    unsafe {
        let mut count = 0u32;
        frame.GetColorContexts(&mut [], &mut count).ok()?;
        if count == 0 {
            return None;
        }
        let mut contexts = Vec::with_capacity(count as usize);
        for _ in 0..count {
            contexts.push(Some(factory.CreateColorContext().ok()?));
        }
        let mut actual = 0u32;
        frame.GetColorContexts(&mut contexts, &mut actual).ok()?;
        for context in contexts.iter().take(actual as usize).flatten() {
            if context.GetType().ok()? != WICColorContextProfile {
                continue;
            }
            let mut size = 0u32;
            context.GetProfileBytes(&mut [], &mut size).ok()?;
            if size == 0 {
                continue;
            }
            let mut profile = vec![0u8; size as usize];
            context.GetProfileBytes(&mut profile, &mut size).ok()?;
            profile.truncate(size as usize);
            return Some(profile);
        }
        None
    }
}

pub(super) fn encode(image: &RgbImage, icc: Option<&[u8]>, quality: f32) -> Result<Vec<u8>> {
    let _com = Com::init()?;
    let factory = factory()?;
    let (width, height) = image.dimensions();
    // SAFETY: plain COM calls on live interfaces; the pixel buffer outlives the bitmap's use.
    unsafe {
        let encoder = factory
            .CreateEncoder(&GUID_ContainerFormatHeif, ptr::null())
            .map_err(|_| Error::MissingCodec(Codec::Heif))?;
        let stream = SHCreateMemStream(None)
            .ok_or_else(|| Error::Other("no memory stream for the HEIC encoder".into()))?;
        encoder
            .Initialize(&stream, WICBitmapEncoderNoCache)
            .map_err(write_error)?;
        let mut frame: Option<IWICBitmapFrameEncode> = None;
        let mut options: Option<IPropertyBag2> = None;
        encoder
            .CreateNewFrame(&mut frame, &mut options)
            .map_err(write_error)?;
        let frame = frame.ok_or_else(|| Error::Other("the HEIC encoder made no frame".into()))?;
        if let Some(options) = &options {
            set_quality(options, quality);
        }
        frame.Initialize(options.as_ref()).map_err(write_error)?;
        frame.SetSize(width, height).map_err(write_error)?;
        let mut format = GUID_WICPixelFormat24bppBGR;
        frame.SetPixelFormat(&mut format).map_err(write_error)?;
        if let Some(icc) = icc {
            // A codec that refuses the profile still writes the pixels.
            let _ = set_color_profile(&factory, &frame, icc);
        }
        // `WriteSource` converts our RGB into whatever layout the encoder settled on.
        let source = factory
            .CreateBitmapFromMemory(
                width,
                height,
                &GUID_WICPixelFormat24bppRGB,
                width * 3,
                image.as_raw(),
            )
            .map_err(write_error)?;
        frame
            .WriteSource(&source, ptr::null())
            .map_err(write_error)?;
        frame.Commit().map_err(write_error)?;
        encoder.Commit().map_err(write_error)?;
        read_stream(&stream)
    }
}

/// # Safety
/// `options` must be the encoder's live property bag.
unsafe fn set_quality(options: &IPropertyBag2, quality: f32) {
    let name = w!("ImageQuality");
    let option = PROPBAG2 {
        pstrName: PWSTR(name.as_ptr().cast_mut()),
        ..Default::default()
    };
    let value = VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_R4,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 { fltVal: quality },
            }),
        },
    };
    // A codec without this option keeps its default quality.
    // SAFETY: one option and one value, both alive for the call.
    let _ = unsafe { options.Write(1, &option, &value) };
}

/// # Safety
/// `frame` must be a live frame encoder before `WriteSource`.
unsafe fn set_color_profile(
    factory: &IWICImagingFactory,
    frame: &IWICBitmapFrameEncode,
    icc: &[u8],
) -> windows::core::Result<()> {
    // SAFETY: plain COM calls; WIC copies the profile bytes.
    unsafe {
        let context = factory.CreateColorContext()?;
        context.InitializeFromMemory(icc)?;
        frame.SetColorContexts(&[Some(context)])
    }
}

/// # Safety
/// `stream` must be a live stream.
unsafe fn read_stream(stream: &IStream) -> Result<Vec<u8>> {
    // SAFETY: plain COM calls; the buffer holds as many bytes as `Read` is told.
    unsafe {
        let mut stat = STATSTG::default();
        stream
            .Stat(&mut stat, STATFLAG_NONAME)
            .map_err(write_error)?;
        let size = u32::try_from(stat.cbSize)
            .map_err(|_| Error::Limit("the HEIC file is too large".into()))?;
        stream.Seek(0, STREAM_SEEK_SET, None).map_err(write_error)?;
        let mut data = vec![0u8; size as usize];
        let mut read = 0u32;
        stream
            .Read(data.as_mut_ptr().cast(), size, Some(&mut read))
            .ok()
            .map_err(write_error)?;
        data.truncate(read as usize);
        Ok(data)
    }
}

/// A small test encode on a fresh thread: the HEIF encoder also needs an HEVC encoder, which only
/// a real encode reveals, and the caller's thread keeps its own COM state.
pub(super) fn encoder_available() -> bool {
    std::thread::spawn(|| {
        let probe = RgbImage::from_pixel(64, 64, Rgb([96, 128, 160]));
        encode(&probe, None, 0.8).is_ok_and(|data| !data.is_empty())
    })
    .join()
    .unwrap_or(false)
}
