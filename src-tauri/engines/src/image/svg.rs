// SPDX-License-Identifier: MIT
//! SVG drawn with resvg at its own size, with the system fonts for text.

use std::path::{Component, Path};
use std::sync::{Arc, OnceLock};

use ::image::{DynamicImage, RgbaImage};
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{self, fontdb, ImageHrefResolver, ImageHrefStringResolverFn};

use super::decode::Decoded;
use super::{read_input, unpremultiply, MAX_SVG_SIDE};
use crate::{Error, Result};

pub(super) fn decode(path: &Path) -> Result<Decoded> {
    let data = read_input(path)?;
    let options = usvg::Options {
        resources_dir: path.parent().map(Path::to_path_buf),
        fontdb: fonts(),
        image_href_resolver: ImageHrefResolver {
            resolve_data: ImageHrefResolver::default_data_resolver(),
            resolve_string: files_beside_the_svg(),
        },
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_data(&data, &options).map_err(|error| match error {
        usvg::Error::ElementsLimitReached => Error::Limit(error.to_string()),
        _ => Error::Unreadable(error.to_string()),
    })?;

    let size = tree.size();
    let longest = size.width().max(size.height());
    let scale = if longest > MAX_SVG_SIDE {
        MAX_SVG_SIDE / longest
    } else {
        1.0
    };
    let side = |length: f32| (length * scale).round().clamp(1.0, MAX_SVG_SIDE) as u32;
    let (width, height) = (side(size.width()), side(size.height()));
    let mut pixmap = Pixmap::new(width, height)
        .ok_or_else(|| Error::Limit(format!("an SVG of {width}×{height} pixels")))?;
    let transform =
        Transform::from_scale(width as f32 / size.width(), height as f32 / size.height());
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    let mut pixels = pixmap.take();
    unpremultiply(&mut pixels);
    let image = RgbaImage::from_raw(width, height, pixels)
        .ok_or_else(|| Error::Other("the SVG renderer returned a short buffer".into()))?;
    Ok(Decoded {
        image: DynamicImage::ImageRgba8(image),
        icc: None,
        lossy: false,
        jpeg_as_is: false,
    })
}

/// Loading every system font takes a moment, so it happens once per run. Mark up draws its text
/// with these too.
pub(crate) fn fonts() -> Arc<fontdb::Database> {
    static FONTS: OnceLock<Arc<fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut fonts = fontdb::Database::new();
            fonts.load_system_fonts();
            Arc::new(fonts)
        })
        .clone()
}

/// Linked images load only from the SVG's folder and below: a downloaded drawing must not pull
/// other local files (or URLs) into the output.
fn files_beside_the_svg() -> ImageHrefStringResolverFn<'static> {
    let load = ImageHrefResolver::default_string_resolver();
    Box::new(move |href: &str, options: &usvg::Options| {
        let inside = !href.contains(':')
            && Path::new(href)
                .components()
                .all(|part| matches!(part, Component::Normal(_) | Component::CurDir));
        if inside {
            load(href, options)
        } else {
            None
        }
    })
}
