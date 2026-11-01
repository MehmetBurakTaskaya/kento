// SPDX-License-Identifier: MIT
//! Merge, split and edit with `lopdf`. The chosen pages are copied into a new document with
//! everything they use; links and bookmarks follow when their target page is still there.
//!
//! What is kept: page content, resources, inherited page attributes, annotations (links whose
//! page is gone are dropped), bookmarks, form fields with a widget on a kept page and, for split
//! and edit, the document information and viewer settings. Named destinations become explicit
//! ones, so no name tree is needed. Not kept: the logical structure (tags), page labels,
//! article threads, attached files and document-level scripts.

use std::collections::{HashMap, HashSet};
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};

use lopdf::{dictionary, text_string, Dictionary, Document, LoadOptions, Object, ObjectId, Stream};

use super::write::{new_document, save};
use super::MAX_PAGES;
use crate::{Error, Progress, Result};

/// How `split` cuts a document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Split {
    /// One file per range of 1-based page numbers, in this order.
    Ranges(Vec<RangeInclusive<usize>>),
    /// One file per run of this many pages; the last one may be shorter.
    Every(usize),
}

/// One page of `edit`'s result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageEdit {
    /// The source page, 0-based.
    pub index: usize,
    /// Degrees clockwise, a multiple of 90, added to the page's own rotation.
    pub rotate: i32,
}

/// Decompression of object and cross-reference streams while loading stops here.
const MAX_STREAM: usize = 512 << 20;
/// Nesting deeper than this (objects, outline levels, the page tree) is not followed.
const MAX_DEPTH: usize = 64;
/// Outline items, name tree nodes and form fields visited at most.
const MAX_NODES: usize = 100_000;
const LETTER: [i64; 4] = [0, 0, 612, 792];

/// One PDF from several, in this order. Each source gets a top-level bookmark named after its
/// file that holds its own bookmarks.
pub fn merge(inputs: &[PathBuf], dest: &Path, progress: &Progress) -> Result<()> {
    if inputs.is_empty() {
        return Err(Error::Other("there are no PDFs to merge".into()));
    }
    let mut output = Output::new();
    let mut total = 0;
    for (done, input) in inputs.iter().enumerate() {
        progress.check()?;
        let source = Source::open(input)?;
        total += source.pages.len();
        if total > MAX_PAGES {
            return Err(Error::Limit(format!(
                "{total} pages or more; at most {MAX_PAGES}"
            )));
        }
        if source.doc.version > output.doc.version {
            output.doc.version.clone_from(&source.doc.version);
        }
        let pages_id = output.pages_id;
        let mut copier = Copier::new(&source, &mut output.doc);
        let targets = copier.claim(&source.pages);
        for (&page, &(target, first)) in source.pages.iter().zip(&targets) {
            copier.copy_page(page, target, pages_id, 0, first);
        }
        let children = copier.bookmarks();
        let form = copier.form();
        copier.drain();

        if let Some(&(first_page, _)) = targets.first() {
            let stem = input
                .file_stem()
                .map(|stem| stem.to_string_lossy())
                .unwrap_or_default();
            output.bookmarks.push(Bookmark {
                title: text_string(&stem),
                dest: Some(vec![first_page.into(), "Fit".into()].into()),
                children,
                ..Bookmark::default()
            });
        }
        output
            .kids
            .extend(targets.iter().map(|&(target, _)| Object::from(target)));
        if let Some(form) = form {
            output.add_form(form);
        }
        progress.report((done + 1) as f32 / inputs.len() as f32);
    }
    output.finish(dest)
}

/// Writes the parts into `dest_dir` (an empty folder) as `<stem>-<first>-<last>.pdf`, or
/// `<stem>-<page>.pdf` for one page, and returns them in order.
pub fn split(
    input: &Path,
    how: Split,
    dest_dir: &Path,
    progress: &Progress,
) -> Result<Vec<PathBuf>> {
    let source = Source::open(input)?;
    let count = source.pages.len();
    if count == 0 {
        return Err(Error::Unreadable("the document has no pages".into()));
    }
    let mut ranges = match how {
        Split::Ranges(ranges) => {
            if ranges.is_empty() {
                return Err(Error::Other("there are no page ranges".into()));
            }
            if let Some(bad) = ranges
                .iter()
                .find(|r| *r.start() == 0 || r.start() > r.end() || *r.end() > count)
            {
                return Err(Error::Other(format!(
                    "pages {}-{} are not within 1-{count}",
                    bad.start(),
                    bad.end()
                )));
            }
            ranges
        }
        Split::Every(0) => return Err(Error::Other("a part needs at least one page".into())),
        Split::Every(n) => (1..=count)
            .step_by(n)
            .map(|first| first..=first.saturating_add(n - 1).min(count))
            .collect(),
    };
    // The same range twice would write the same file twice.
    let mut seen = HashSet::new();
    ranges.retain(|range| seen.insert(range.clone()));
    if ranges.len() > MAX_PAGES {
        return Err(Error::Limit(format!(
            "{} parts; at most {MAX_PAGES}",
            ranges.len()
        )));
    }

    let stem = input.file_stem().unwrap_or(std::ffi::OsStr::new("part"));
    let mut written = Vec::with_capacity(ranges.len());
    for (done, range) in ranges.iter().enumerate() {
        progress.check()?;
        let mut name = stem.to_os_string();
        if range.start() == range.end() {
            name.push(format!("-{}.pdf", range.start()));
        } else {
            name.push(format!("-{}-{}.pdf", range.start(), range.end()));
        }
        let path = dest_dir.join(name);
        let slots: Vec<(usize, i32)> = range.clone().map(|page| (page - 1, 0)).collect();
        extract(&source, &slots, &path, progress, &|_| {})?;
        written.push(path);
        progress.report((done + 1) as f32 / ranges.len() as f32);
    }
    Ok(written)
}

/// A new PDF with exactly these pages in this order: pages may be left out, repeated or
/// turned.
pub fn edit(input: &Path, pages: &[PageEdit], dest: &Path, progress: &Progress) -> Result<()> {
    let source = Source::open(input)?;
    if pages.is_empty() {
        return Err(Error::Other("the edited PDF would have no pages".into()));
    }
    if pages.len() > MAX_PAGES {
        return Err(Error::Limit(format!(
            "{} pages; at most {MAX_PAGES}",
            pages.len()
        )));
    }
    for page in pages {
        if page.index >= source.pages.len() {
            return Err(Error::Other(format!("there is no page {}", page.index + 1)));
        }
        if page.rotate % 90 != 0 {
            return Err(Error::Other(format!(
                "{} degrees is not a quarter turn",
                page.rotate
            )));
        }
    }
    let slots: Vec<(usize, i32)> = pages.iter().map(|p| (p.index, p.rotate)).collect();
    let total = slots.len() as f32;
    extract(&source, &slots, dest, progress, &|done| {
        progress.report(done as f32 / total)
    })
}

/// Writes one document made of `slots` (0-based source page, added rotation).
fn extract(
    source: &Source,
    slots: &[(usize, i32)],
    dest: &Path,
    progress: &Progress,
    report: &dyn Fn(usize),
) -> Result<()> {
    let mut output = Output::new();
    output.doc.version.clone_from(&source.doc.version);
    let pages_id = output.pages_id;
    let mut copier = Copier::new(source, &mut output.doc);
    let pages: Vec<ObjectId> = slots
        .iter()
        .map(|&(index, _)| source.pages[index])
        .collect();
    let targets = copier.claim(&pages);
    for (done, ((&page, &(target, first)), &(_, turn))) in
        pages.iter().zip(&targets).zip(slots).enumerate()
    {
        progress.check()?;
        copier.copy_page(page, target, pages_id, turn, first);
        report(done + 1);
    }
    let bookmarks = copier.bookmarks();
    let form = copier.form();
    let catalog = copier.catalog_settings();
    let info = copier.info();
    copier.drain();

    output.bookmarks = bookmarks;
    output.kids = targets.iter().map(|&(target, _)| target.into()).collect();
    output.catalog = catalog;
    if let Some(form) = form {
        output.add_form(form);
    }
    if let Some(info) = info {
        let info = output.doc.add_object(info);
        output.doc.trailer.set("Info", info);
    }
    output.finish(dest)
}

fn load(path: &Path) -> Result<Document> {
    let options = LoadOptions {
        max_decompressed_size: Some(MAX_STREAM),
        ..LoadOptions::default()
    };
    let doc = Document::load_with_options(path, options).map_err(|error| match error {
        lopdf::Error::IO(error) => Error::Io(error),
        lopdf::Error::InvalidPassword | lopdf::Error::Decryption(_) => Error::Encrypted,
        other => Error::Unreadable(other.to_string()),
    })?;
    // `lopdf` silently decrypts a file that has only an owner password (`was_encrypted`) and
    // leaves the others encrypted. Both are refused: a copy would drop the permissions.
    if doc.is_encrypted() || doc.was_encrypted() {
        return Err(Error::Encrypted);
    }
    Ok(doc)
}

/// Follows references, a bounded number of times.
fn deref<'a>(doc: &'a Document, object: Option<&'a Object>) -> Option<&'a Object> {
    let mut object = object?;
    for _ in 0..MAX_DEPTH {
        match object {
            Object::Reference(id) => object = doc.objects.get(id)?,
            _ => return Some(object),
        }
    }
    None
}

fn is_name(object: lopdf::Result<&Object>, name: &[u8]) -> bool {
    object.and_then(Object::as_name).is_ok_and(|n| n == name)
}

/// A loaded document and what copying from it needs.
struct Source {
    doc: Document,
    pages: Vec<ObjectId>,
    /// The page tree, pages included: references into it are never followed while copying.
    tree: HashSet<ObjectId>,
    /// Named destinations, from the catalog's `Dests` dictionary and `Names` tree.
    names: HashMap<Vec<u8>, Object>,
}

impl Source {
    fn open(path: &Path) -> Result<Self> {
        let doc = load(path)?;
        let pages: Vec<ObjectId> = doc.page_iter().collect();
        if pages.len() > MAX_PAGES {
            return Err(Error::Limit(format!(
                "{} pages; at most {MAX_PAGES}",
                pages.len()
            )));
        }
        let mut tree: HashSet<ObjectId> = pages.iter().copied().collect();
        if let Ok(root) = doc
            .catalog()
            .and_then(|c| c.get(b"Pages"))
            .and_then(Object::as_reference)
        {
            tree.insert(root);
        }
        for &page in &pages {
            let mut node = page;
            for _ in 0..MAX_DEPTH {
                let parent = doc
                    .get_dictionary(node)
                    .and_then(|d| d.get(b"Parent"))
                    .and_then(Object::as_reference);
                match parent {
                    Ok(parent) if tree.insert(parent) => node = parent,
                    _ => break,
                }
            }
        }
        let names = named_destinations(&doc);
        Ok(Self {
            doc,
            pages,
            tree,
            names,
        })
    }

    /// A page attribute, from the page or the nearest page tree node that has it.
    fn inherited(&self, page: ObjectId, key: &[u8]) -> Option<&Object> {
        let mut node = self.doc.get_dictionary(page).ok()?;
        for _ in 0..MAX_DEPTH {
            if let Ok(value) = node.get(key) {
                return Some(value);
            }
            let parent = node.get(b"Parent").and_then(Object::as_reference).ok()?;
            node = self.doc.get_dictionary(parent).ok()?;
        }
        None
    }

    /// The explicit destination (`[page /View …]`) behind a destination: an array, a name, a
    /// string, or a dictionary holding one in `D`.
    fn explicit(&self, dest: &Object) -> Option<Vec<Object>> {
        let mut value = deref(&self.doc, Some(dest))?;
        for _ in 0..4 {
            value = match value {
                Object::Array(items) => return Some(items.clone()),
                Object::Name(name) | Object::String(name, _) => {
                    deref(&self.doc, self.names.get(name))?
                }
                Object::Dictionary(dict) => deref(&self.doc, dict.get(b"D").ok())?,
                _ => return None,
            };
        }
        None
    }
}

fn named_destinations(doc: &Document) -> HashMap<Vec<u8>, Object> {
    let mut names = HashMap::new();
    let Ok(catalog) = doc.catalog() else {
        return names;
    };
    if let Some(Object::Dictionary(dests)) = deref(doc, catalog.get(b"Dests").ok()) {
        for (name, dest) in dests.iter() {
            names.insert(name.clone(), dest.clone());
        }
    }
    let tree = deref(doc, catalog.get(b"Names").ok())
        .and_then(|n| n.as_dict().ok())
        .and_then(|n| n.get(b"Dests").ok());
    let mut stack: Vec<&Object> = tree.into_iter().collect();
    let mut seen = HashSet::new();
    while let Some(node) = stack.pop() {
        if let Object::Reference(id) = node {
            if !seen.insert(*id) || seen.len() > MAX_NODES {
                continue;
            }
        }
        let Some(Object::Dictionary(node)) = deref(doc, Some(node)) else {
            continue;
        };
        if let Some(Object::Array(pairs)) = deref(doc, node.get(b"Names").ok()) {
            for [name, dest] in pairs.as_chunks::<2>().0 {
                if let Some(Object::String(name, _)) = deref(doc, Some(name)) {
                    names.entry(name.clone()).or_insert_with(|| dest.clone());
                }
            }
        }
        if let Some(Object::Array(kids)) = deref(doc, node.get(b"Kids").ok()) {
            stack.extend(kids.iter());
        }
    }
    names
}

/// A bookmark of the output, its destination already pointing into the output.
struct Bookmark {
    title: Object,
    dest: Option<Object>,
    action: Option<Object>,
    open: bool,
    color: Option<Object>,
    flags: Option<Object>,
    children: Vec<Bookmark>,
}

impl Default for Bookmark {
    fn default() -> Self {
        Self {
            title: Object::Null,
            dest: None,
            action: None,
            open: false,
            color: None,
            flags: None,
            children: Vec::new(),
        }
    }
}

/// Copies objects from one source into the output, giving each a new number once.
struct Copier<'a> {
    src: &'a Source,
    out: &'a mut Document,
    copies: HashMap<ObjectId, ObjectId>,
    /// Source pages in the output and their (first) copy.
    pages: HashMap<ObjectId, ObjectId>,
    /// Annotations on the kept pages: the form fields above them are kept.
    annots: HashSet<ObjectId>,
    /// Copies whose content is still to be written.
    queue: Vec<(ObjectId, ObjectId)>,
}

impl<'a> Copier<'a> {
    fn new(src: &'a Source, out: &'a mut Document) -> Self {
        Self {
            src,
            out,
            copies: HashMap::new(),
            pages: HashMap::new(),
            annots: HashSet::new(),
            queue: Vec::new(),
        }
    }

    /// New page numbers for these source pages, and whether each is the page's first copy.
    /// Done before any copying, so that links between kept pages resolve.
    fn claim(&mut self, pages: &[ObjectId]) -> Vec<(ObjectId, bool)> {
        pages
            .iter()
            .map(|&page| {
                let target = self.out.new_object_id();
                let first = !self.pages.contains_key(&page);
                if first {
                    self.pages.insert(page, target);
                }
                (target, first)
            })
            .collect()
    }

    fn copy_page(
        &mut self,
        source: ObjectId,
        target: ObjectId,
        parent: ObjectId,
        turn: i32,
        first: bool,
    ) {
        let src = self.src;
        let empty = Dictionary::new();
        let page = src.doc.get_dictionary(source).unwrap_or(&empty);
        let mut out = dictionary! { "Type" => "Page", "Parent" => parent };
        for (key, value) in page.iter() {
            // The structure tree and article threads are not copied, so their back links go.
            if matches!(
                key.as_slice(),
                b"Type" | b"Parent" | b"Annots" | b"Rotate" | b"B" | b"StructParents"
            ) {
                continue;
            }
            let copy = self.value(value, 0);
            out.set(key.clone(), copy);
        }
        for key in [b"Resources".as_slice(), b"MediaBox", b"CropBox"] {
            if !out.has(key) {
                if let Some(value) = src.inherited(source, key) {
                    let copy = self.value(value, 0);
                    out.set(key.to_vec(), copy);
                }
            }
        }
        if !out.has(b"MediaBox") {
            out.set("MediaBox", LETTER.map(Object::from).to_vec());
        }
        if !out.has(b"Resources") {
            out.set("Resources", Dictionary::new());
        }
        let own = deref(&src.doc, src.inherited(source, b"Rotate"))
            .and_then(|r| {
                r.as_i64()
                    .ok()
                    .or_else(|| r.as_float().ok().map(|f| f as i64))
            })
            .unwrap_or(0);
        // Readers only honour quarter turns.
        let rotate = (own + i64::from(turn)).rem_euclid(360) / 90 * 90;
        if rotate != 0 {
            out.set("Rotate", rotate);
        }
        if let Some(annots) = self.annotations(page, target, first) {
            out.set("Annots", annots);
        }
        self.out.objects.insert(target, out.into());
    }

    fn annotations(&mut self, page: &Dictionary, target: ObjectId, first: bool) -> Option<Object> {
        let src = self.src;
        let Some(Object::Array(annots)) = deref(&src.doc, page.get(b"Annots").ok()) else {
            return None;
        };
        let mut kept = Vec::new();
        for annot in annots {
            let (id, dict) = match annot {
                Object::Reference(id) => match src.doc.get_dictionary(*id) {
                    Ok(dict) => (Some(*id), dict),
                    Err(_) => continue,
                },
                Object::Dictionary(dict) => (None, dict),
                _ => continue,
            };
            if self.dead_link(dict) {
                continue;
            }
            let mut copy = self.dict(dict, 0);
            if copy.has(b"P") {
                copy.set("P", target);
            }
            // A repeated page gets its own annotations: an annotation belongs to one page.
            let copy_id = match id {
                Some(id) if first => {
                    self.annots.insert(id);
                    *self
                        .copies
                        .entry(id)
                        .or_insert_with(|| self.out.new_object_id())
                }
                _ => self.out.new_object_id(),
            };
            self.out.objects.insert(copy_id, copy.into());
            kept.push(Object::from(copy_id));
        }
        (!kept.is_empty()).then_some(Object::Array(kept))
    }

    /// A link whose target page is not in the output, or cannot be found.
    fn dead_link(&self, annot: &Dictionary) -> bool {
        if !is_name(annot.get(b"Subtype"), b"Link") {
            return false;
        }
        let doc = &self.src.doc;
        let dest = annot.get(b"Dest").ok().or_else(|| {
            let action = deref(doc, annot.get(b"A").ok())?.as_dict().ok()?;
            if is_name(action.get(b"S"), b"GoTo") {
                action.get(b"D").ok()
            } else {
                None
            }
        });
        let Some(dest) = dest else {
            return false;
        };
        let page = self
            .src
            .explicit(dest)
            .and_then(|d| d.first().and_then(|p| p.as_reference().ok()));
        !page.is_some_and(|page| self.pages.contains_key(&page))
    }

    fn reference(&mut self, id: ObjectId) -> Object {
        if let Some(&page) = self.pages.get(&id) {
            return page.into();
        }
        if self.src.tree.contains(&id) {
            return Object::Null;
        }
        if let Some(&copy) = self.copies.get(&id) {
            return copy.into();
        }
        let skipped = match self.src.doc.objects.get(&id) {
            None => true,
            Some(Object::Dictionary(dict)) => document_level(dict),
            Some(Object::Stream(stream)) => document_level(&stream.dict),
            Some(_) => false,
        };
        if skipped {
            return Object::Null;
        }
        let copy = self.out.new_object_id();
        self.copies.insert(id, copy);
        self.queue.push((id, copy));
        copy.into()
    }

    fn value(&mut self, object: &Object, depth: usize) -> Object {
        if depth > MAX_DEPTH {
            return Object::Null;
        }
        match object {
            Object::Reference(id) => self.reference(*id),
            Object::Array(items) => Object::Array(
                items
                    .iter()
                    .map(|item| self.value(item, depth + 1))
                    .collect(),
            ),
            Object::Dictionary(dict) => Object::Dictionary(self.dict(dict, depth + 1)),
            Object::Stream(stream) => {
                let dict = self.dict(&stream.dict, depth + 1);
                Object::Stream(
                    Stream::new(dict, stream.content.clone())
                        .with_compression(stream.allows_compression),
                )
            }
            other => other.clone(),
        }
    }

    fn dict(&mut self, dict: &Dictionary, depth: usize) -> Dictionary {
        let go_to = is_name(dict.get(b"S"), b"GoTo");
        let field = dict.has(b"FT") || dict.has(b"T");
        let mut out = Dictionary::new();
        for (key, value) in dict.iter() {
            let copy = match key.as_slice() {
                b"Dest" => self.destination(value),
                b"D" if go_to => self.destination(value),
                b"Kids" if field => Some(self.field_kids(value, depth)),
                _ => Some(self.value(value, depth)),
            };
            if let Some(copy) = copy {
                out.set(key.clone(), copy);
            }
        }
        out
    }

    /// An explicit destination in the output, or `None` when its page is not there.
    fn destination(&mut self, dest: &Object) -> Option<Object> {
        let explicit = self.src.explicit(dest)?;
        let (page, view) = explicit.split_first()?;
        let mut copy = vec![Object::from(*self.pages.get(&page.as_reference().ok()?)?)];
        copy.extend(view.iter().map(|v| self.value(v, MAX_DEPTH)));
        Some(Object::Array(copy))
    }

    fn field_kids(&mut self, kids: &Object, depth: usize) -> Object {
        let src = self.src;
        let Some(Object::Array(items)) = deref(&src.doc, Some(kids)) else {
            return self.value(kids, depth);
        };
        let kept: Vec<&Object> = items.iter().filter(|kid| self.survives(kid)).collect();
        Object::Array(
            kept.into_iter()
                .map(|kid| self.value(kid, depth + 1))
                .collect(),
        )
    }

    /// Whether a form field has a widget on a kept page (fields without widgets stay too).
    fn survives(&self, field: &Object) -> bool {
        let doc = &self.src.doc;
        let mut stack = vec![field];
        let mut seen = HashSet::new();
        while let Some(node) = stack.pop() {
            let Object::Reference(id) = node else {
                return true;
            };
            if self.annots.contains(id) {
                return true;
            }
            if !seen.insert(*id) || seen.len() > MAX_NODES {
                continue;
            }
            let Ok(dict) = doc.get_dictionary(*id) else {
                continue;
            };
            if is_name(dict.get(b"Subtype"), b"Widget") {
                continue;
            }
            match deref(doc, dict.get(b"Kids").ok()) {
                Some(Object::Array(kids)) => stack.extend(kids.iter()),
                _ => return true,
            }
        }
        false
    }

    /// The source's bookmarks in output terms. Items whose page is gone lose their target and
    /// are dropped unless they hold items that stay.
    fn bookmarks(&mut self) -> Vec<Bookmark> {
        let src = self.src;
        let first = src
            .doc
            .catalog()
            .ok()
            .and_then(|c| deref(&src.doc, c.get(b"Outlines").ok()))
            .and_then(|o| o.as_dict().ok())
            .and_then(|o| o.get(b"First").ok());
        match first {
            Some(first) => self.outline_level(first, 0, &mut HashSet::new()),
            None => Vec::new(),
        }
    }

    fn outline_level(
        &mut self,
        first: &Object,
        depth: usize,
        seen: &mut HashSet<ObjectId>,
    ) -> Vec<Bookmark> {
        let src = self.src;
        let mut items = Vec::new();
        let mut next = Some(first);
        while let Some(link) = next {
            let Ok(id) = link.as_reference() else {
                break;
            };
            if !seen.insert(id) || seen.len() > MAX_NODES {
                break;
            }
            let Ok(item) = src.doc.get_dictionary(id) else {
                break;
            };
            let children = match item.get(b"First") {
                Ok(first) if depth < MAX_DEPTH => self.outline_level(first, depth + 1, seen),
                _ => Vec::new(),
            };
            let (dest, action) = self.outline_target(item);
            if dest.is_some() || action.is_some() || !children.is_empty() {
                let title = deref(&src.doc, item.get(b"Title").ok())
                    .filter(|t| matches!(t, Object::String(..)))
                    .cloned()
                    .unwrap_or_else(|| text_string(""));
                items.push(Bookmark {
                    title,
                    dest,
                    action,
                    open: item
                        .get(b"Count")
                        .and_then(Object::as_i64)
                        .is_ok_and(|count| count > 0),
                    color: item.get(b"C").ok().map(|c| self.value(c, 0)),
                    flags: item.get(b"F").ok().map(|f| self.value(f, 0)),
                    children,
                });
            }
            next = item.get(b"Next").ok();
        }
        items
    }

    /// A destination in the output, or another kind of action (a web link, for example).
    fn outline_target(&mut self, item: &Dictionary) -> (Option<Object>, Option<Object>) {
        if let Ok(dest) = item.get(b"Dest") {
            return (self.destination(dest), None);
        }
        let src = self.src;
        let Some(action) = deref(&src.doc, item.get(b"A").ok()).and_then(|a| a.as_dict().ok())
        else {
            return (None, None);
        };
        if is_name(action.get(b"S"), b"GoTo") {
            let dest = action.get(b"D").ok().and_then(|d| self.destination(d));
            return (dest, None);
        }
        (None, Some(Object::Dictionary(self.dict(action, 0))))
    }

    /// The source's form, with the fields that keep a widget in the output.
    fn form(&mut self) -> Option<Dictionary> {
        let src = self.src;
        let catalog = src.doc.catalog().ok()?;
        let form = deref(&src.doc, catalog.get(b"AcroForm").ok())?
            .as_dict()
            .ok()?;
        let fields = deref(&src.doc, form.get(b"Fields").ok())?.as_array().ok()?;
        let kept: Vec<&Object> = fields.iter().filter(|f| self.survives(f)).collect();
        if kept.is_empty() {
            return None;
        }
        let fields: Vec<Object> = kept.into_iter().map(|f| self.value(f, 0)).collect();
        let mut out = dictionary! { "Fields" => fields };
        for key in ["DR", "DA", "Q", "NeedAppearances"] {
            if let Ok(value) = form.get(key.as_bytes()) {
                let copy = self.value(value, 0);
                out.set(key, copy);
            }
        }
        Some(out)
    }

    /// Viewer settings and optional content (layers) from the source catalog.
    fn catalog_settings(&mut self) -> Dictionary {
        let mut out = Dictionary::new();
        let Ok(catalog) = self.src.doc.catalog() else {
            return out;
        };
        for key in [
            "Lang",
            "PageLayout",
            "PageMode",
            "ViewerPreferences",
            "OCProperties",
        ] {
            if let Ok(value) = catalog.get(key.as_bytes()) {
                let copy = self.value(value, 0);
                out.set(key, copy);
            }
        }
        out
    }

    /// The document information dictionary (title, author …).
    fn info(&mut self) -> Option<Dictionary> {
        let src = self.src;
        let info = deref(&src.doc, src.doc.trailer.get(b"Info").ok())?
            .as_dict()
            .ok()?;
        Some(self.dict(info, 0))
    }

    /// Writes every copy still waiting for its content.
    fn drain(&mut self) {
        let src = self.src;
        while let Some((source, target)) = self.queue.pop() {
            // Annotations are written as soon as their page is; keep that copy.
            if self.out.objects.contains_key(&target) {
                continue;
            }
            if let Some(object) = src.doc.objects.get(&source) {
                let copy = self.value(object, 0);
                self.out.objects.insert(target, copy);
            }
        }
    }
}

/// Objects that belong to the document rather than to its pages.
fn document_level(dict: &Dictionary) -> bool {
    dict.get(b"Type")
        .and_then(Object::as_name)
        .is_ok_and(|t| matches!(t, b"Page" | b"Pages" | b"Catalog" | b"Outlines"))
}

/// The document being written.
struct Output {
    doc: Document,
    pages_id: ObjectId,
    kids: Vec<Object>,
    bookmarks: Vec<Bookmark>,
    form: Option<Dictionary>,
    /// More catalog entries.
    catalog: Dictionary,
}

impl Output {
    fn new() -> Self {
        let mut doc = new_document();
        let pages_id = doc.new_object_id();
        Self {
            doc,
            pages_id,
            kids: Vec::new(),
            bookmarks: Vec::new(),
            form: None,
            catalog: Dictionary::new(),
        }
    }

    fn add_form(&mut self, form: Dictionary) {
        let Some(merged) = self.form.as_mut() else {
            self.form = Some(form);
            return;
        };
        let more = form
            .get(b"Fields")
            .and_then(Object::as_array)
            .cloned()
            .unwrap_or_default();
        if let Ok(Object::Array(fields)) = merged.get_mut(b"Fields") {
            fields.extend(more);
        }
    }

    fn finish(mut self, dest: &Path) -> Result<()> {
        let count = self.kids.len() as i64;
        let pages = dictionary! { "Type" => "Pages", "Kids" => self.kids, "Count" => count };
        self.doc.objects.insert(self.pages_id, pages.into());
        let mut catalog = self.catalog;
        catalog.set("Type", "Catalog");
        catalog.set("Pages", self.pages_id);
        if let Some(outlines) = write_outline(&mut self.doc, self.bookmarks) {
            catalog.set("Outlines", outlines);
        }
        if let Some(form) = self.form {
            let form = self.doc.add_object(form);
            catalog.set("AcroForm", form);
        }
        let catalog = self.doc.add_object(catalog);
        self.doc.trailer.set("Root", catalog);
        save(&mut self.doc, dest)
    }
}

fn write_outline(doc: &mut Document, items: Vec<Bookmark>) -> Option<ObjectId> {
    if items.is_empty() {
        return None;
    }
    let root = doc.new_object_id();
    let (first, last, visible) = write_level(doc, items, root);
    doc.objects.insert(
        root,
        dictionary! {
            "Type" => "Outlines",
            "First" => first,
            "Last" => last,
            "Count" => visible,
        }
        .into(),
    );
    Some(root)
}

/// Writes sibling items under `parent`. Returns the first and last item and how many items show
/// while the parent is open (ISO 32000-1, 12.3.3).
fn write_level(
    doc: &mut Document,
    items: Vec<Bookmark>,
    parent: ObjectId,
) -> (ObjectId, ObjectId, i64) {
    let ids: Vec<ObjectId> = items.iter().map(|_| doc.new_object_id()).collect();
    let mut visible = 0;
    for (i, item) in items.into_iter().enumerate() {
        let mut dict = dictionary! { "Title" => item.title, "Parent" => parent };
        if i > 0 {
            dict.set("Prev", ids[i - 1]);
        }
        if let Some(&next) = ids.get(i + 1) {
            dict.set("Next", next);
        }
        if let Some(dest) = item.dest {
            dict.set("Dest", dest);
        } else if let Some(action) = item.action {
            dict.set("A", action);
        }
        if let Some(color) = item.color {
            dict.set("C", color);
        }
        if let Some(flags) = item.flags {
            dict.set("F", flags);
        }
        visible += 1;
        if !item.children.is_empty() {
            let (first, last, count) = write_level(doc, item.children, ids[i]);
            dict.set("First", first);
            dict.set("Last", last);
            dict.set("Count", if item.open { count } else { -count });
            if item.open {
                visible += count;
            }
        }
        doc.objects.insert(ids[i], dict.into());
    }
    (ids[0], ids[ids.len() - 1], visible)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::fixtures::{self, Fixture};

    /// What the page says ("Kento page N says hello").
    fn says(doc: &Document, page: ObjectId) -> String {
        let content = doc.get_page_content(page);
        let text = String::from_utf8_lossy(&content);
        let start = text.find("(Kento page ").unwrap() + 1;
        let end = start + text[start..].find(')').unwrap();
        text[start..end].to_owned()
    }

    fn page_number(doc: &Document, dest: &Object) -> Option<usize> {
        let target = dest.as_array().ok()?.first()?.as_reference().ok()?;
        let position = fixtures::pages(doc).iter().position(|&p| p == target)?;
        Some(position + 1)
    }

    /// The outline as (depth, title, destination page).
    fn outline(doc: &Document) -> Vec<(usize, String, Option<usize>)> {
        fn walk(
            doc: &Document,
            first: Option<ObjectId>,
            depth: usize,
            out: &mut Vec<(usize, String, Option<usize>)>,
        ) {
            let mut next = first;
            while let Some(id) = next {
                let item = doc.get_dictionary(id).unwrap();
                let title = lopdf::decode_text_string(item.get(b"Title").unwrap()).unwrap();
                let page = item.get(b"Dest").ok().and_then(|d| page_number(doc, d));
                out.push((depth, title, page));
                let child = item.get(b"First").and_then(Object::as_reference).ok();
                walk(doc, child, depth + 1, out);
                next = item.get(b"Next").and_then(Object::as_reference).ok();
            }
        }
        let mut out = Vec::new();
        if let Ok(root) = doc
            .catalog()
            .unwrap()
            .get(b"Outlines")
            .and_then(Object::as_reference)
        {
            let root = doc.get_dictionary(root).unwrap();
            let first = root.get(b"First").and_then(Object::as_reference).ok();
            walk(doc, first, 0, &mut out);
        }
        out
    }

    /// A page's links: "page N" for the internal ones, the address for web links.
    fn links(doc: &Document, page: ObjectId) -> Vec<String> {
        let dict = doc.get_dictionary(page).unwrap();
        let Ok(annots) = dict.get(b"Annots").and_then(Object::as_array) else {
            return Vec::new();
        };
        annots
            .iter()
            .map(|annot| {
                let annot = doc.get_dictionary(annot.as_reference().unwrap()).unwrap();
                let action = annot.get(b"A").and_then(Object::as_dict).ok();
                let dest = annot.get(b"Dest").ok().or_else(|| action?.get(b"D").ok());
                match dest {
                    Some(dest) => format!("page {}", page_number(doc, dest).unwrap()),
                    None => {
                        let uri = action.unwrap().get(b"URI").unwrap().as_str().unwrap();
                        String::from_utf8_lossy(uri).into_owned()
                    }
                }
            })
            .collect()
    }

    fn rotation(doc: &Document, page: ObjectId) -> i64 {
        let dict = doc.get_dictionary(page).unwrap();
        dict.get(b"Rotate").and_then(Object::as_i64).unwrap_or(0)
    }

    fn assert_complete_pages(doc: &Document) {
        for page in fixtures::pages(doc) {
            let dict = doc.get_dictionary(page).unwrap();
            assert!(dict.get(b"MediaBox").unwrap().as_array().is_ok());
            let resources = dict.get(b"Resources").unwrap().as_dict().unwrap();
            assert!(resources.get(b"Font").is_ok(), "inherited resources copied");
        }
    }

    fn hello(pages: &[usize]) -> Vec<String> {
        pages
            .iter()
            .map(|n| format!("Kento page {n} says hello"))
            .collect()
    }

    #[test]
    fn pdf_merge_keeps_pages_links_and_bookmarks() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first.pdf");
        let second = dir.path().join("İkinci ğüş 🧪.pdf");
        Fixture::pages(3).write(&first);
        Fixture::pages(2).write(&second);
        let dest = dir.path().join("merged.pdf");
        merge(&[first, second], &dest, &Progress::none()).unwrap();

        let doc = Document::load(&dest).unwrap();
        let pages = fixtures::pages(&doc);
        let said: Vec<String> = pages.iter().map(|&p| says(&doc, p)).collect();
        assert_eq!(said, hello(&[1, 2, 3, 1, 2]));
        assert_complete_pages(&doc);
        assert_eq!(
            links(&doc, pages[0]),
            ["page 3", "page 2", "https://example.com/"]
        );
        assert_eq!(
            links(&doc, pages[3]),
            ["page 5", "page 5", "https://example.com/"]
        );

        let expected = [
            (0, "first", Some(1)),
            (1, "Start", Some(1)),
            (1, "Middle", Some(2)),
            (2, "End", Some(3)),
            (0, "İkinci ğüş 🧪", Some(4)),
            (1, "Start", Some(4)),
            (1, "Middle", Some(5)),
            (2, "End", Some(5)),
        ]
        .map(|(depth, title, page)| (depth, title.to_owned(), page));
        assert_eq!(outline(&doc), expected);
        let root = doc.catalog().unwrap().get(b"Outlines").unwrap();
        let root = doc.get_dictionary(root.as_reference().unwrap()).unwrap();
        assert_eq!(
            root.get(b"Count").unwrap().as_i64().unwrap(),
            2,
            "the file bookmarks start closed"
        );

        if fixtures::pdfium() {
            assert_eq!(crate::pdf::page_count(&dest).unwrap(), 5);
            crate::pdf::render_page(&dest, 4, 36).unwrap();
        }
    }

    #[test]
    fn pdf_split_by_ranges_and_every() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("Kento ğüşıöç 🧪.pdf");
        Fixture::pages(5).write(&input);

        let ranges = dir.path().join("ranges");
        std::fs::create_dir(&ranges).unwrap();
        let how = Split::Ranges(vec![1..=1, 2..=4, 1..=1]);
        let parts = split(&input, how, &ranges, &Progress::none()).unwrap();
        let names: Vec<_> = parts.iter().map(|p| p.file_name().unwrap()).collect();
        assert_eq!(
            names,
            ["Kento ğüşıöç 🧪-1.pdf", "Kento ğüşıöç 🧪-2-4.pdf"],
            "a repeated range is written once"
        );

        let one = Document::load(&parts[0]).unwrap();
        let pages = fixtures::pages(&one);
        assert_eq!(pages.len(), 1);
        assert_eq!(
            links(&one, pages[0]),
            ["https://example.com/"],
            "links to pages that stayed behind are dropped"
        );
        assert_eq!(outline(&one), [(0, "Start".to_owned(), Some(1))]);
        let info = one.trailer.get(b"Info").unwrap().as_reference().unwrap();
        let title = one.get_dictionary(info).unwrap().get(b"Title").unwrap();
        assert_eq!(title.as_str().unwrap(), b"Kento fixture");

        let three = Document::load(&parts[1]).unwrap();
        let pages = fixtures::pages(&three);
        let said: Vec<String> = pages.iter().map(|&p| says(&three, p)).collect();
        assert_eq!(said, hello(&[2, 3, 4]));
        assert_complete_pages(&three);
        assert_eq!(outline(&three), [(0, "Middle".to_owned(), Some(1))]);

        let every = dir.path().join("every");
        std::fs::create_dir(&every).unwrap();
        let parts = split(&input, Split::Every(2), &every, &Progress::none()).unwrap();
        let counts: Vec<usize> = parts
            .iter()
            .map(|p| fixtures::pages(&Document::load(p).unwrap()).len())
            .collect();
        assert_eq!(counts, [2, 2, 1]);
        assert!(parts[2].ends_with("Kento ğüşıöç 🧪-5.pdf"));
        if fixtures::pdfium() {
            assert_eq!(crate::pdf::page_count(&parts[0]).unwrap(), 2);
        }

        let bad = dir.path().join("bad");
        std::fs::create_dir(&bad).unwrap();
        for how in [
            Split::Ranges(vec![RangeInclusive::new(0, 1)]),
            Split::Ranges(vec![RangeInclusive::new(4, 6)]),
            Split::Ranges(vec![RangeInclusive::new(3, 2)]),
            Split::Ranges(Vec::new()),
            Split::Every(0),
        ] {
            let result = split(&input, how.clone(), &bad, &Progress::none());
            assert!(matches!(result, Err(Error::Other(_))), "{how:?}");
        }
        assert_eq!(std::fs::read_dir(&bad).unwrap().count(), 0);
    }

    #[test]
    fn pdf_edit_reorders_rotates_and_drops() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("turned.pdf");
        let mut doc = Fixture::pages(4).document();
        // Every page inherits a quarter turn from the page tree root; edits add to it.
        let root = doc
            .catalog()
            .unwrap()
            .get(b"Pages")
            .unwrap()
            .as_reference()
            .unwrap();
        doc.get_dictionary_mut(root).unwrap().set("Rotate", 90);
        doc.save(&input).unwrap();

        let dest = dir.path().join("edited.pdf");
        let edits = [(3, 0), (0, 270), (2, -90), (3, 180), (0, 0)]
            .map(|(index, rotate)| PageEdit { index, rotate });
        edit(&input, &edits, &dest, &Progress::none()).unwrap();

        let out = Document::load(&dest).unwrap();
        let pages = fixtures::pages(&out);
        let said: Vec<String> = pages.iter().map(|&p| says(&out, p)).collect();
        assert_eq!(said, hello(&[4, 1, 3, 4, 1]));
        let turns: Vec<i64> = pages.iter().map(|&p| rotation(&out, p)).collect();
        assert_eq!(turns, [90, 0, 0, 270, 90]);
        assert_complete_pages(&out);

        // Page 1 links to page 3 (kept, now third) and to page 2 (dropped).
        assert_eq!(links(&out, pages[1]), ["page 3", "https://example.com/"]);
        assert_eq!(links(&out, pages[4]), ["page 3", "https://example.com/"]);
        let annots = |page: ObjectId| {
            let dict = out.get_dictionary(page).unwrap();
            dict.get(b"Annots").unwrap().as_array().unwrap().clone()
        };
        assert_ne!(
            annots(pages[1]),
            annots(pages[4]),
            "a repeated page has its own annotations"
        );
        assert_eq!(
            outline(&out),
            [
                (0, "Start".to_owned(), Some(2)),
                (0, "Middle".to_owned(), None),
                (1, "End".to_owned(), Some(1)),
            ]
        );

        if fixtures::pdfium() {
            let first = crate::pdf::render_page(&dest, 0, 36).unwrap();
            assert!(first.width() > first.height(), "turned to landscape");
            let second = crate::pdf::render_page(&dest, 1, 36).unwrap();
            assert!(second.width() < second.height());
        }

        for edits in [
            vec![PageEdit {
                index: 4,
                rotate: 0,
            }],
            vec![PageEdit {
                index: 0,
                rotate: 45,
            }],
            Vec::new(),
        ] {
            let result = edit(&input, &edits, &dest, &Progress::none());
            assert!(matches!(result, Err(Error::Other(_))), "{edits:?}");
        }
    }

    #[test]
    fn pdf_tools_refuse_encrypted_and_damaged_files() {
        let dir = tempfile::tempdir().unwrap();
        let locked = dir.path().join("locked.pdf");
        fixtures::encrypted(&locked, "secret");
        let owner_only = dir.path().join("owner only.pdf");
        fixtures::encrypted(&owner_only, "");
        let opened = Document::load(&owner_only).unwrap();
        assert!(
            opened.was_encrypted() && fixtures::pages(&opened).len() == 2,
            "the fixture opens without a password"
        );
        let clear = dir.path().join("clear.pdf");
        Fixture::pages(1).write(&clear);
        let damaged = dir.path().join("damaged.pdf");
        std::fs::write(&damaged, b"%PDF-1.7\nthis is not a PDF body").unwrap();
        let dest = dir.path().join("out.pdf");
        let none = Progress::none();
        let keep = [PageEdit {
            index: 0,
            rotate: 0,
        }];

        for encrypted in [&locked, &owner_only] {
            let parts = dir.path().join("parts");
            std::fs::create_dir_all(&parts).unwrap();
            assert!(matches!(
                merge(&[clear.clone(), encrypted.clone()], &dest, &none),
                Err(Error::Encrypted)
            ));
            assert!(matches!(
                split(encrypted, Split::Every(1), &parts, &none),
                Err(Error::Encrypted)
            ));
            assert!(matches!(
                edit(encrypted, &keep, &dest, &none),
                Err(Error::Encrypted)
            ));
            assert!(!dest.exists(), "nothing is written");
            assert_eq!(std::fs::read_dir(&parts).unwrap().count(), 0);
        }
        assert!(matches!(
            edit(&damaged, &keep, &dest, &none),
            Err(Error::Unreadable(_))
        ));
        assert!(matches!(merge(&[], &dest, &none), Err(Error::Other(_))));
    }

    #[test]
    fn pdf_tools_stop_when_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("in.pdf");
        Fixture::pages(2).write(&input);
        let report = |_: Option<f32>| {};
        let cancelled = || true;
        let progress = Progress::new(&report, &cancelled);
        let result = merge(&[input], &dir.path().join("out.pdf"), &progress);
        assert!(matches!(result, Err(Error::Cancelled)));
    }
}
