// SPDX-License-Identifier: MIT
//! Test documents built at run time with `lopdf`, and the PDFium library for tests.

use std::path::{Path, PathBuf};

use lopdf::{dictionary, Document, Object, ObjectId, Stream, StringFormat};
use pdfium_render::prelude::Pdfium;

/// Loads PDFium from `KENTO_PDFIUM` or `src-tauri/resources/pdfium`. Without it the caller
/// skips its PDFium checks (this prints why), unless `KENTO_REQUIRE_PDFIUM=1` (CI).
pub(super) fn pdfium() -> bool {
    let path = std::env::var_os("KENTO_PDFIUM")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../resources/pdfium")
                .join(Pdfium::pdfium_platform_library_name())
        });
    if !path.is_file() {
        let required = std::env::var("KENTO_REQUIRE_PDFIUM").is_ok_and(|v| v == "1");
        assert!(
            !required,
            "KENTO_REQUIRE_PDFIUM=1 but PDFium is not at {}",
            path.display()
        );
        eprintln!(
            "skipped the PDFium checks: no library at {} (set KENTO_PDFIUM)",
            path.display()
        );
        return false;
    }
    super::init(&path).expect("PDFium loads");
    true
}

fn literal(text: &str) -> Object {
    Object::String(text.as_bytes().to_vec(), StringFormat::Literal)
}

/// A Letter-size document whose pages say "Kento page N says hello" in Helvetica, with two
/// body lines. The page tree is nested and the font and MediaBox are inherited from its root.
/// Page 1 links to page 3 (explicit), to page 2 (the named destination `chapter2`) and to a
/// web address; the outline is "Start" (page 1) and "Middle" (`chapter2`) holding "End" (the
/// last page).
pub(super) struct Fixture {
    pages: usize,
}

impl Fixture {
    pub(super) fn pages(pages: usize) -> Self {
        assert!(pages >= 1);
        Self { pages }
    }

    pub(super) fn write(&self, path: &Path) {
        self.document().save(path).unwrap();
    }

    pub(super) fn document(&self) -> Document {
        let mut doc = Document::with_version("1.7");
        let root_id = doc.new_object_id();
        let inner_id = doc.new_object_id();
        let font = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
        });

        let mut page_ids = Vec::new();
        for n in 1..=self.pages {
            let content = format!(
                "BT /F1 24 Tf 72 700 Td (Kento page {n} says hello) Tj ET \
                 BT /F1 12 Tf 72 650 Td (first line of the body) Tj \
                 0 -14 Td (second line of the body) Tj ET"
            );
            let content = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
            // The first two pages sit in an inner node of the page tree.
            let parent = if n <= 2 { inner_id } else { root_id };
            let page = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => parent,
                "Contents" => content,
            });
            page_ids.push(page);
        }
        let page = |n: usize| page_ids[(n - 1).min(self.pages - 1)];

        let named_target = vec![page(2).into(), "Fit".into()];
        let links = vec![
            doc.add_object(dictionary! {
                "Type" => "Annot",
                "Subtype" => "Link",
                "Rect" => vec![72.into(), 690.into(), 300.into(), 725.into()],
                "Border" => vec![0.into(), 0.into(), 0.into()],
                "Dest" => vec![page(3).into(), "XYZ".into(), Object::Null, Object::Null, Object::Null],
            }),
            doc.add_object(dictionary! {
                "Type" => "Annot",
                "Subtype" => "Link",
                "Rect" => vec![72.into(), 640.into(), 300.into(), 660.into()],
                "A" => dictionary! { "S" => "GoTo", "D" => literal("chapter2") },
            }),
            doc.add_object(dictionary! {
                "Type" => "Annot",
                "Subtype" => "Link",
                "Rect" => vec![72.into(), 620.into(), 300.into(), 640.into()],
                "A" => dictionary! { "S" => "URI", "URI" => literal("https://example.com/") },
            }),
        ];
        let first = doc.get_dictionary_mut(page(1)).unwrap();
        first.set(
            "Annots",
            links.into_iter().map(Object::from).collect::<Vec<_>>(),
        );

        let inner_kids: Vec<Object> = page_ids.iter().take(2).map(|&id| id.into()).collect();
        let mut root_kids: Vec<Object> = vec![inner_id.into()];
        root_kids.extend(page_ids.iter().skip(2).map(|&id| Object::from(id)));
        doc.objects.insert(
            inner_id,
            dictionary! {
                "Type" => "Pages",
                "Parent" => root_id,
                "Count" => inner_kids.len() as i64,
                "Kids" => inner_kids,
            }
            .into(),
        );
        doc.objects.insert(
            root_id,
            dictionary! {
                "Type" => "Pages",
                "Count" => self.pages as i64,
                "Kids" => root_kids,
                "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
            }
            .into(),
        );

        let outlines = doc.new_object_id();
        let start = doc.new_object_id();
        let middle = doc.new_object_id();
        let end = doc.new_object_id();
        doc.objects.insert(
            start,
            dictionary! {
                "Title" => literal("Start"),
                "Parent" => outlines,
                "Next" => middle,
                "Dest" => vec![page(1).into(), "Fit".into()],
            }
            .into(),
        );
        doc.objects.insert(
            middle,
            dictionary! {
                "Title" => literal("Middle"),
                "Parent" => outlines,
                "Prev" => start,
                "First" => end,
                "Last" => end,
                "Count" => 1,
                "A" => dictionary! { "S" => "GoTo", "D" => literal("chapter2") },
            }
            .into(),
        );
        doc.objects.insert(
            end,
            dictionary! {
                "Title" => literal("End"),
                "Parent" => middle,
                "Dest" => vec![page(self.pages).into(), "Fit".into()],
            }
            .into(),
        );
        doc.objects.insert(
            outlines,
            dictionary! {
                "Type" => "Outlines",
                "First" => start,
                "Last" => middle,
                "Count" => 3,
            }
            .into(),
        );

        let catalog = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => root_id,
            "Outlines" => outlines,
            "Names" => dictionary! {
                "Dests" => dictionary! {
                    "Names" => vec![literal("chapter2"), named_target.into()],
                },
            },
        });
        let info = doc.add_object(dictionary! { "Title" => literal("Kento fixture") });
        doc.trailer.set("Root", catalog);
        doc.trailer.set("Info", info);
        doc
    }
}

/// A fixture encrypted with RC4 (128-bit). With `user_password` "" it opens without a password
/// but carries an owner password and permissions (printing only).
pub(super) fn encrypted(path: &Path, user_password: &str) {
    let mut doc = Fixture::pages(2).document();
    let id = Object::String(b"kento-fixture-id".to_vec(), StringFormat::Hexadecimal);
    doc.trailer.set("ID", vec![id.clone(), id]);
    let state = lopdf::EncryptionState::try_from(lopdf::EncryptionVersion::V2 {
        document: &doc,
        owner_password: "owner",
        user_password,
        key_length: 128,
        permissions: lopdf::Permissions::PRINTABLE,
    })
    .unwrap();
    doc.encrypt(&state).unwrap();
    doc.save(path).unwrap();
}

/// The page object ids of a document, in order.
pub(super) fn pages(doc: &Document) -> Vec<ObjectId> {
    doc.page_iter().collect()
}

/// A Letter-size document whose pages hold Helvetica text objects at the given places:
/// (text, size, x, y) for each page. Only `(`, `)` and `\` are escaped, so keep to ASCII.
pub(super) fn placed(path: &Path, pages: &[&[(&str, u32, u32, u32)]]) {
    let mut doc = Document::with_version("1.7");
    let root_id = doc.new_object_id();
    let font = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    let mut kids: Vec<Object> = Vec::new();
    for pieces in pages {
        let mut content = String::new();
        for (text, size, x, y) in pieces.iter() {
            let escaped = text
                .replace('\\', "\\\\")
                .replace('(', "\\(")
                .replace(')', "\\)");
            content.push_str(&format!("BT /F1 {size} Tf {x} {y} Td ({escaped}) Tj ET\n"));
        }
        let content = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => root_id,
            "Contents" => content,
        });
        kids.push(page.into());
    }
    doc.objects.insert(
        root_id,
        dictionary! {
            "Type" => "Pages",
            "Count" => kids.len() as i64,
            "Kids" => kids,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
        }
        .into(),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => root_id });
    doc.trailer.set("Root", catalog);
    doc.save(path).unwrap();
}
