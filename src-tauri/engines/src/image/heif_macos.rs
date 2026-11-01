// SPDX-License-Identifier: MIT
//! HEIC through ImageIO (`CGImageSource`, `CGImageDestination`), with the few CoreFoundation and
//! CoreGraphics calls it needs declared here.

use std::ffi::c_void;
use std::path::Path;
use std::ptr;

use ::image::metadata::Orientation;
use ::image::{DynamicImage, RgbImage, RgbaImage};

use super::decode::Decoded;
use super::{check_size, read_input, unpremultiply};
use crate::{Codec, Error, Result};

/// Every CoreFoundation, CoreGraphics and ImageIO object is a CF type behind a pointer.
type Ref = *const c_void;
type CFIndex = isize;

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[repr(C)]
struct CFDictionaryCallBacks {
    _opaque: [u8; 0],
}

const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
const CF_NUMBER_SINT32: CFIndex = 3;
const CF_NUMBER_FLOAT64: CFIndex = 6;
const CG_COLOR_SPACE_MODEL_RGB: i32 = 1;
const CG_IMAGE_ALPHA_NONE: u32 = 0;
const CG_IMAGE_ALPHA_PREMULTIPLIED_LAST: u32 = 1;
const CG_RENDERING_INTENT_DEFAULT: i32 = 0;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFTypeDictionaryKeyCallBacks: CFDictionaryCallBacks;
    static kCFTypeDictionaryValueCallBacks: CFDictionaryCallBacks;
    fn CFRelease(object: Ref);
    fn CFEqual(a: Ref, b: Ref) -> u8;
    fn CFDataCreate(allocator: Ref, bytes: *const u8, length: CFIndex) -> Ref;
    fn CFDataCreateMutable(allocator: Ref, capacity: CFIndex) -> Ref;
    fn CFDataGetBytePtr(data: Ref) -> *const u8;
    fn CFDataGetLength(data: Ref) -> CFIndex;
    fn CFStringCreateWithBytes(
        allocator: Ref,
        bytes: *const u8,
        length: CFIndex,
        encoding: u32,
        external_representation: u8,
    ) -> Ref;
    fn CFNumberCreate(allocator: Ref, kind: CFIndex, value: *const c_void) -> Ref;
    fn CFNumberGetValue(number: Ref, kind: CFIndex, value: *mut c_void) -> u8;
    fn CFDictionaryCreate(
        allocator: Ref,
        keys: *const Ref,
        values: *const Ref,
        count: CFIndex,
        key_callbacks: *const CFDictionaryCallBacks,
        value_callbacks: *const CFDictionaryCallBacks,
    ) -> Ref;
    fn CFDictionaryGetValue(dictionary: Ref, key: Ref) -> Ref;
    fn CFArrayGetCount(array: Ref) -> CFIndex;
    fn CFArrayGetValueAtIndex(array: Ref, index: CFIndex) -> Ref;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    static kCGColorSpaceSRGB: Ref;
    fn CGColorSpaceCreateWithName(name: Ref) -> Ref;
    fn CGColorSpaceCreateWithICCData(data: Ref) -> Ref;
    fn CGColorSpaceGetModel(space: Ref) -> i32;
    fn CGColorSpaceCopyICCData(space: Ref) -> Ref;
    fn CGImageGetWidth(image: Ref) -> usize;
    fn CGImageGetHeight(image: Ref) -> usize;
    fn CGImageGetColorSpace(image: Ref) -> Ref;
    fn CGImageCreate(
        width: usize,
        height: usize,
        bits_per_component: usize,
        bits_per_pixel: usize,
        bytes_per_row: usize,
        space: Ref,
        bitmap_info: u32,
        provider: Ref,
        decode: *const f64,
        should_interpolate: bool,
        intent: i32,
    ) -> Ref;
    fn CGDataProviderCreateWithCFData(data: Ref) -> Ref;
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits_per_component: usize,
        bytes_per_row: usize,
        space: Ref,
        bitmap_info: u32,
    ) -> Ref;
    fn CGContextDrawImage(context: Ref, rect: CGRect, image: Ref);
}

#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    static kCGImagePropertyOrientation: Ref;
    static kCGImageDestinationLossyCompressionQuality: Ref;
    fn CGImageSourceCreateWithData(data: Ref, options: Ref) -> Ref;
    fn CGImageSourceGetCount(source: Ref) -> usize;
    fn CGImageSourceCopyPropertiesAtIndex(source: Ref, index: usize, options: Ref) -> Ref;
    fn CGImageSourceCreateImageAtIndex(source: Ref, index: usize, options: Ref) -> Ref;
    fn CGImageSourceCopyTypeIdentifiers() -> Ref;
    fn CGImageDestinationCopyTypeIdentifiers() -> Ref;
    fn CGImageDestinationCreateWithData(data: Ref, kind: Ref, count: usize, options: Ref) -> Ref;
    fn CGImageDestinationAddImage(destination: Ref, image: Ref, properties: Ref);
    fn CGImageDestinationFinalize(destination: Ref) -> bool;
}

/// An owned CF object, released on drop.
struct Owned(Ref);

impl Owned {
    fn new(object: Ref) -> Option<Self> {
        (!object.is_null()).then_some(Self(object))
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: the object came from a Create or Copy call and is released once.
        unsafe { CFRelease(self.0) }
    }
}

fn failed(what: &str) -> Error {
    Error::Other(format!("ImageIO: {what}"))
}

fn string(text: &str) -> Option<Owned> {
    // SAFETY: the bytes are valid UTF-8 for the call; CoreFoundation copies them.
    Owned::new(unsafe {
        CFStringCreateWithBytes(
            ptr::null(),
            text.as_ptr(),
            text.len() as CFIndex,
            CF_STRING_ENCODING_UTF8,
            0,
        )
    })
}

fn data(bytes: &[u8]) -> Result<Owned> {
    // SAFETY: CoreFoundation copies the bytes.
    Owned::new(unsafe { CFDataCreate(ptr::null(), bytes.as_ptr(), bytes.len() as CFIndex) })
        .ok_or_else(|| failed("out of memory"))
}

/// # Safety
/// `data` must be a live CFData.
unsafe fn bytes_of(data: Ref) -> Vec<u8> {
    // SAFETY: CFData keeps `length` bytes at its byte pointer while it lives.
    unsafe {
        let length = CFDataGetLength(data).max(0) as usize;
        let start = CFDataGetBytePtr(data);
        if start.is_null() || length == 0 {
            return Vec::new();
        }
        std::slice::from_raw_parts(start, length).to_vec()
    }
}

/// Whether an ImageIO type list (owned, from a Copy call) names HEIC.
fn lists_heic(types: Ref) -> bool {
    let (Some(types), Some(heic)) = (Owned::new(types), string("public.heic")) else {
        return false;
    };
    // SAFETY: indices stay below the array's count; CFEqual only compares.
    unsafe {
        (0..CFArrayGetCount(types.0))
            .any(|index| CFEqual(CFArrayGetValueAtIndex(types.0, index), heic.0) != 0)
    }
}

pub(super) fn encoder_available() -> bool {
    // SAFETY: returns an owned array, released by `lists_heic`.
    lists_heic(unsafe { CGImageDestinationCopyTypeIdentifiers() })
}

pub(super) fn decode(path: &Path) -> Result<Decoded> {
    // SAFETY: returns an owned array, released by `lists_heic`.
    if !lists_heic(unsafe { CGImageSourceCopyTypeIdentifiers() }) {
        return Err(Error::MissingCodec(Codec::Heif));
    }
    let bytes = read_input(path)?;
    let unreadable = || Error::Unreadable("HEIC: ImageIO could not read the image".into());
    let input = data(&bytes)?;
    // SAFETY: every object is checked for null and released by `Owned`; the bitmap context
    // draws into `pixels`, which outlives it.
    unsafe {
        let source =
            Owned::new(CGImageSourceCreateWithData(input.0, ptr::null())).ok_or_else(unreadable)?;
        if CGImageSourceGetCount(source.0) == 0 {
            return Err(unreadable());
        }
        let image = Owned::new(CGImageSourceCreateImageAtIndex(source.0, 0, ptr::null()))
            .ok_or_else(unreadable)?;
        let (width, height) = (CGImageGetWidth(image.0), CGImageGetHeight(image.0));
        let too_large = || Error::Limit(format!("an image of {width}×{height} pixels"));
        check_size(
            u32::try_from(width).map_err(|_| too_large())?,
            u32::try_from(height).map_err(|_| too_large())?,
        )?;
        let orientation = orientation(source.0);

        // Drawing in the image's own RGB space keeps its pixel values; its profile goes along.
        let own = CGImageGetColorSpace(image.0);
        let srgb = if !own.is_null() && CGColorSpaceGetModel(own) == CG_COLOR_SPACE_MODEL_RGB {
            None
        } else {
            Some(
                Owned::new(CGColorSpaceCreateWithName(kCGColorSpaceSRGB))
                    .ok_or_else(|| failed("no sRGB colour space"))?,
            )
        };
        let space = srgb.as_ref().map_or(own, |space| space.0);
        let icc = Owned::new(CGColorSpaceCopyICCData(space)).map(|icc| bytes_of(icc.0));

        let stride = width * 4;
        let mut pixels = vec![0u8; stride * height];
        let context = Owned::new(CGBitmapContextCreate(
            pixels.as_mut_ptr().cast(),
            width,
            height,
            8,
            stride,
            space,
            CG_IMAGE_ALPHA_PREMULTIPLIED_LAST,
        ))
        .ok_or_else(|| failed("no bitmap context"))?;
        let rect = CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: width as f64,
                height: height as f64,
            },
        };
        CGContextDrawImage(context.0, rect, image.0);
        drop(context);

        unpremultiply(&mut pixels);
        let image = RgbaImage::from_raw(width as u32, height as u32, pixels)
            .ok_or_else(|| failed("short pixel buffer"))?;
        let mut image = DynamicImage::ImageRgba8(image);
        image.apply_orientation(orientation);
        Ok(Decoded {
            image,
            icc,
            lossy: true,
            jpeg_as_is: false,
        })
    }
}

/// `CGImageSourceCreateImageAtIndex` leaves the stored orientation to the caller.
///
/// # Safety
/// `source` must be a live image source.
unsafe fn orientation(source: Ref) -> Orientation {
    // SAFETY: the properties dictionary is owned and released; values are borrowed from it.
    unsafe {
        let Some(properties) =
            Owned::new(CGImageSourceCopyPropertiesAtIndex(source, 0, ptr::null()))
        else {
            return Orientation::NoTransforms;
        };
        let value = CFDictionaryGetValue(properties.0, kCGImagePropertyOrientation);
        let mut number: i32 = 1;
        if value.is_null()
            || CFNumberGetValue(value, CF_NUMBER_SINT32, (&mut number as *mut i32).cast()) == 0
        {
            return Orientation::NoTransforms;
        }
        u8::try_from(number)
            .ok()
            .and_then(Orientation::from_exif)
            .unwrap_or(Orientation::NoTransforms)
    }
}

pub(super) fn encode(image: &RgbImage, icc: Option<&[u8]>, quality: f32) -> Result<Vec<u8>> {
    let (width, height) = (image.width() as usize, image.height() as usize);
    let pixels = data(image.as_raw())?;
    let profile = icc.map(data).transpose()?;
    // SAFETY: every object is checked for null and released by `Owned`; CoreFoundation copies
    // the keys and values it is given.
    unsafe {
        let tagged = profile
            .as_ref()
            .and_then(|profile| Owned::new(CGColorSpaceCreateWithICCData(profile.0)));
        let space = match tagged {
            Some(space) => space,
            None => Owned::new(CGColorSpaceCreateWithName(kCGColorSpaceSRGB))
                .ok_or_else(|| failed("no sRGB colour space"))?,
        };
        let provider = Owned::new(CGDataProviderCreateWithCFData(pixels.0))
            .ok_or_else(|| failed("no data provider"))?;
        let picture = Owned::new(CGImageCreate(
            width,
            height,
            8,
            24,
            width * 3,
            space.0,
            CG_IMAGE_ALPHA_NONE,
            provider.0,
            ptr::null(),
            false,
            CG_RENDERING_INTENT_DEFAULT,
        ))
        .ok_or_else(|| failed("no image"))?;

        let output = Owned::new(CFDataCreateMutable(ptr::null(), 0))
            .ok_or_else(|| failed("out of memory"))?;
        let kind = string("public.heic").ok_or_else(|| failed("out of memory"))?;
        let destination = Owned::new(CGImageDestinationCreateWithData(
            output.0,
            kind.0,
            1,
            ptr::null(),
        ))
        .ok_or(Error::MissingCodec(Codec::Heif))?;
        let quality = f64::from(quality);
        let number = Owned::new(CFNumberCreate(
            ptr::null(),
            CF_NUMBER_FLOAT64,
            (&quality as *const f64).cast(),
        ))
        .ok_or_else(|| failed("out of memory"))?;
        let keys = [kCGImageDestinationLossyCompressionQuality];
        let values = [number.0];
        let properties = Owned::new(CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            ptr::addr_of!(kCFTypeDictionaryKeyCallBacks),
            ptr::addr_of!(kCFTypeDictionaryValueCallBacks),
        ))
        .ok_or_else(|| failed("out of memory"))?;
        CGImageDestinationAddImage(destination.0, picture.0, properties.0);
        if !CGImageDestinationFinalize(destination.0) {
            return Err(failed("the HEIC file could not be written"));
        }
        Ok(bytes_of(output.0))
    }
}
