// SPDX-License-Identifier: MIT
//! Apple's Vision (`VNRecognizeTextRequest`, macOS 10.15 and later) at its accurate level. Which
//! languages it reads depends on the macOS version; nothing can be added to it, so a missing one
//! is only explained.

use std::io::Cursor;

use image::{ImageFormat, RgbaImage};
use objc2::rc::autoreleasepool;
use objc2::runtime::{AnyClass, AnyObject, NSObjectProtocol};
use objc2::{sel, AnyThread};
use objc2_foundation::{NSArray, NSData, NSDictionary, NSError, NSString};
use objc2_vision::{
    VNImageOption, VNImageRequestHandler, VNRecognizeTextRequest, VNRequest,
    VNRequestTextRecognitionLevel,
};

use crate::{Codec, Error, Result};

fn failed(error: &NSError) -> Error {
    Error::Other(format!(
        "Vision text recognition: {}",
        error.localizedDescription()
    ))
}

/// Vision's text recognition arrived with macOS 10.15.
fn present() -> Result<()> {
    if AnyClass::get(c"VNRecognizeTextRequest").is_some() {
        Ok(())
    } else {
        Err(Error::Unsupported {
            from: "image".into(),
            to: "ocr".into(),
        })
    }
}

fn request() -> objc2::rc::Retained<VNRecognizeTextRequest> {
    let request = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request
}

pub(super) fn languages() -> Result<Vec<String>> {
    present()?;
    autoreleasepool(|_| {
        let request = request();
        // macOS 12 asks the request; earlier versions ask the class for its revision.
        let list = if request.respondsToSelector(sel!(supportedRecognitionLanguagesAndReturnError:))
        {
            // SAFETY: the request is set up and the selector exists on this system.
            unsafe { request.supportedRecognitionLanguagesAndReturnError() }
        } else {
            #[allow(deprecated)]
            // SAFETY: the class method of macOS 10.15 and 11, with the request's own revision.
            unsafe {
                VNRecognizeTextRequest::supportedRecognitionLanguagesForTextRecognitionLevel_revision_error(
                    VNRequestTextRecognitionLevel::Accurate,
                    request.revision(),
                )
            }
        };
        let list = list.map_err(|error| failed(&error))?;
        Ok(list.to_vec().iter().map(|tag| tag.to_string()).collect())
    })
}

/// Vision is asked per picture; the reader only keeps the language.
pub(super) struct Reader {
    language: String,
}

impl Reader {
    pub(super) fn new(tag: &str) -> Result<Self> {
        if !languages()?.iter().any(|have| have == tag) {
            return Err(Error::MissingCodec(Codec::OcrLanguage));
        }
        Ok(Self {
            language: tag.to_owned(),
        })
    }

    /// The lines of text, in the order Vision reports them (top to bottom for a page).
    pub(super) fn read(&self, rgba: &RgbaImage) -> Result<Vec<String>> {
        // Vision takes encoded pictures, so the pixels go over as a PNG.
        let mut png = Cursor::new(Vec::new());
        super::flatten(rgba)
            .write_to(&mut png, ImageFormat::Png)
            .map_err(|error| Error::Other(error.to_string()))?;
        let png = png.into_inner();
        autoreleasepool(|_| {
            let data = NSData::with_bytes(&png);
            let options = NSDictionary::<VNImageOption, AnyObject>::new();
            let handler = VNImageRequestHandler::initWithData_options(
                VNImageRequestHandler::alloc(),
                &data,
                &options,
            );
            let request = request();
            request.setUsesLanguageCorrection(true);
            let languages = NSArray::from_retained_slice(&[NSString::from_str(&self.language)]);
            request.setRecognitionLanguages(&languages);
            let generic: &VNRequest = &request;
            let requests = NSArray::from_slice(&[generic]);
            handler
                .performRequests_error(&requests)
                .map_err(|error| failed(&error))?;
            let mut lines = Vec::new();
            let found = request
                .results()
                .map(|found| found.to_vec())
                .unwrap_or_default();
            for observation in found {
                if let Some(best) = observation.topCandidates(1).firstObject() {
                    lines.push(best.string().to_string());
                }
            }
            Ok(lines)
        })
    }
}
