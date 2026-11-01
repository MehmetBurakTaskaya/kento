// SPDX-License-Identifier: MIT
use std::fs;
use std::io::Cursor;

use encoding_rs::{ISO_8859_7, WINDOWS_1252, WINDOWS_1254};
use plist::{Dictionary, Value};

use super::*;
use crate::{Conversion, Error, Options, Progress};

/// Runs one conversion on `input` saved as `name` in a fresh folder and returns what it wrote.
pub(crate) fn convert_bytes(name: &str, input: &[u8], from: &str, to: &str) -> Result<Vec<u8>> {
    let dir = tempfile::tempdir().unwrap();
    convert_in(dir.path(), name, input, from, to)
}

pub(crate) fn convert_in(
    dir: &Path,
    name: &str,
    input: &[u8],
    from: &str,
    to: &str,
) -> Result<Vec<u8>> {
    let source = dir.join(name);
    fs::write(&source, input).unwrap();
    let dest = dir.join(format!("Kento çıktı 🧪.{to}"));
    fs::write(&dest, b"placeholder").unwrap();
    let temp = dir.join("temp");
    fs::create_dir_all(&temp).unwrap();
    let options = Options::default();
    let progress = Progress::none();
    let job = Conversion {
        input: &source,
        from,
        to,
        dest: &dest,
        temp: &temp,
        options: &options,
        progress: &progress,
    };
    let written = crate::convert(&job)?;
    assert_eq!(written, vec![dest.clone()]);
    assert_eq!(
        fs::read(&source).unwrap(),
        input,
        "the input must not change"
    );
    assert_eq!(
        fs::read_dir(&temp).unwrap().count(),
        0,
        "temp holds leftovers"
    );
    Ok(fs::read(&dest).unwrap())
}

pub(crate) fn convert_text(name: &str, input: &[u8], from: &str, to: &str) -> String {
    let bytes = convert_bytes(name, input, from, to).unwrap();
    assert!(
        !bytes.starts_with(&[0xEF, 0xBB, 0xBF]),
        "no BOM in text output"
    );
    String::from_utf8(bytes).unwrap()
}

const TURKISH: &str = "Ağaç, ışık, şöyle: İstanbul'da Ünlü Çiçekçi Ğ ğ ı İ ş Ş ö ü ç";

fn utf16(text: &str, little_endian: bool) -> Vec<u8> {
    let mut bytes = if little_endian {
        vec![0xFF, 0xFE]
    } else {
        vec![0xFE, 0xFF]
    };
    for unit in text.encode_utf16() {
        let pair = if little_endian {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        bytes.extend_from_slice(&pair);
    }
    bytes
}

#[test]
fn routes() {
    for (from, to) in [
        ("txt", "md"),
        ("txt", "html"),
        ("md", "txt"),
        ("md", "html"),
        ("html", "txt"),
        ("html", "md"),
        ("textclipping", "txt"),
    ] {
        assert!(supports(from, to), "{from} → {to}");
        assert!(crate::supports(from, to), "{from} → {to}");
        assert_eq!(crate::output(from, to), Some(crate::Output::File));
    }
    for (from, to) in [
        ("txt", "txt"),
        ("md", "md"),
        ("textclipping", "md"),
        ("txt", "pdf"),
        ("csv", "html"),
    ] {
        assert!(!supports(from, to), "{from} → {to}");
    }
    let error = convert_bytes("a.txt", b"x", "txt", "txt").unwrap_err();
    assert!(matches!(error, Error::Unsupported { .. }));
}

#[test]
fn decodes_every_supported_encoding() {
    let sample = format!("{TURKISH} 🧪 emoji");
    assert_eq!(decode(sample.as_bytes()), sample);
    let mut bom = vec![0xEF, 0xBB, 0xBF];
    bom.extend_from_slice(sample.as_bytes());
    assert_eq!(decode(&bom), sample);
    assert_eq!(decode(&utf16(&sample, true)), sample);
    assert_eq!(decode(&utf16(&sample, false)), sample);

    let (turkish, _, lossy) = WINDOWS_1254.encode(TURKISH);
    assert!(!lossy);
    assert_eq!(decode(&turkish), TURKISH);

    let western = "Café, naïve façade, Größe, señor";
    let (bytes, _, lossy) = WINDOWS_1252.encode(western);
    assert!(!lossy);
    assert_eq!(decode(&bytes), western);
}

#[test]
fn html_meta_charset_wins_over_the_guess() {
    let greek = "Καλημέρα κόσμε";
    let page =
        format!("<html><head><meta charset=\"iso-8859-7\"></head><body>{greek}</body></html>");
    let (bytes, _, _) = ISO_8859_7.encode(&page);
    assert!(decode_html(&bytes).contains(greek));
    let page = format!(
        "<meta http-equiv=\"Content-Type\" content=\"text/html; charset=windows-1254\">{TURKISH}"
    );
    let (bytes, _, _) = WINDOWS_1254.encode(&page);
    assert!(decode_html(&bytes).contains(TURKISH));
}

#[test]
fn newlines() {
    assert_eq!(Newline::detect("a\r\nb\nc"), Newline::CrLf);
    assert_eq!(Newline::detect("a\nb\r\n"), Newline::Lf);
    assert_eq!(Newline::detect("a\rb"), Newline::Cr);
    assert_eq!(Newline::detect("single line"), Newline::Lf);
    assert_eq!(normalize_newlines("a\r\nb\rc\n"), "a\nb\nc\n");
    assert_eq!(Newline::CrLf.apply("a\nb\n"), "a\r\nb\r\n");
}

#[test]
fn entities() {
    assert_eq!(
        decode_entities("Tom &amp; Jerry &lt;3 &#x1F9EA; &#305; &nbsp;&unknown; & done"),
        "Tom & Jerry <3 🧪 ı \u{a0}&unknown; & done"
    );
    assert!(starts_with_entity("&amp; x"));
    assert!(starts_with_entity("&#233;"));
    assert!(!starts_with_entity("& x;"));
    assert!(!starts_with_entity("&T"));
}

const PLAIN: &str = "# not a heading\n\
* not a list\n\
- not a list either\n\
1. not numbered\n\
> not a quote\n\
---\n\
snake_case and *stars* and _under_ `code` [link](https://x.test) ![img](y.png)\n\
<b>not bold</b> AT&T &amp; | pipe | ~strike~ back\\slash\n    indented four\n\
\tand a tab\n\
\n\
Ağaç İstanbul 🧪\n\
=====\n\
+ plus\n\
#hashtag stays";

#[test]
fn txt_to_md_reads_the_same() {
    let markdown = markdown::escape_text(PLAIN);
    let html = markdown::to_html(&markdown);
    for element in [
        "<h1",
        "<h2",
        "<ul",
        "<ol",
        "<blockquote",
        "<hr",
        "<em",
        "<strong",
        "<code",
        "<a ",
        "<img",
        "<b>",
        "<pre",
        "<table",
        "<del",
    ] {
        assert!(!html.contains(element), "{element} in {html}");
    }
    assert_eq!(html.matches("<p>").count(), 2, "{html}");
    let back = markdown::to_text(&markdown).replace('\u{a0}', " ");
    assert_eq!(back, format!("{}\n", PLAIN.replace('\t', "    ")));
    assert!(
        markdown.contains("snake_case"),
        "intraword underscores stay readable"
    );
    assert!(markdown.contains("AT&T"), "a bare ampersand stays readable");
    assert!(markdown.contains("\\&amp;"), "an entity is escaped");
}

#[test]
fn txt_to_md_keeps_crlf_and_encodings() {
    let input = "Satır bir\r\nSatır *iki*\r\n\r\nYeni paragraf\r\n";
    let out = convert_text("Kento ğüşıöç 🧪.txt", input.as_bytes(), "txt", "md");
    assert_eq!(
        out,
        "Satır bir\\\r\nSatır \\*iki\\*\r\n\r\nYeni paragraf\r\n"
    );

    let (cp1254, _, _) = WINDOWS_1254.encode(TURKISH);
    let out = convert_text("eski.txt", &cp1254, "txt", "md");
    assert_eq!(out, TURKISH);
}

#[test]
fn txt_to_html_is_a_complete_page() {
    let input = "Başlık <script>alert(1)</script> & \"quotes\"\n  indented line\n\nİkinci 🧪";
    let out = convert_text("R&D ğüşıöç 🧪.txt", input.as_bytes(), "txt", "html");
    assert!(out.starts_with("<!DOCTYPE html>"));
    assert!(out.contains("<meta charset=\"utf-8\">"));
    assert!(out.contains("<title>R&amp;D ğüşıöç 🧪</title>"));
    assert!(out.contains(
        "<p>Başlık &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;<br>  indented line</p>"
    ));
    assert!(out.contains("<p>İkinci 🧪</p>"));
    assert!(!out.contains("<script>"));
    for external in ["src=", "href=", "http", "@import", "url("] {
        assert!(!out.contains(external), "{external}");
    }
    assert!(out.ends_with("</html>\n"));

    let utf16_input = utf16("Satır\r\nİki\r\n", true);
    let out = convert_text("utf16.txt", &utf16_input, "txt", "html");
    assert!(out.contains("<p>Satır<br>İki</p>\r\n"));
    assert!(
        !out.replace("\r\n", "").contains('\n'),
        "CRLF kept throughout"
    );
}

const MARKDOWN: &str = "# Başlık ğüşıöç\n\
\n\
Paragraf **kalın** ve *eğik* ve ~~silik~~ ve `kod` ve [bağlantı](https://example.test).\n\
\n\
| Ad | Şehir |\n\
|----|-------|\n\
| Ayşe | İzmir |\n\
| Can 🧪 | Muğla |\n\
\n\
- [x] bitti\n\
- [ ] yapılacak\n  - iç madde\n\
\n\
1. bir\n\
2. iki\n\
\n\
```rust\n\
fn main() {}\n\
```\n\
\n\
> alıntı\n";

#[test]
fn md_to_html_renders_extensions() {
    let out = convert_text("Notlar ğüşıöç 🧪.md", MARKDOWN.as_bytes(), "md", "html");
    assert!(out.starts_with("<!DOCTYPE html>"));
    assert!(out.contains("<title>Notlar ğüşıöç 🧪</title>"));
    assert!(out.contains("<h1>Başlık ğüşıöç</h1>"));
    assert!(out.contains("<table>"));
    assert!(out.contains("<td>Can 🧪</td>"));
    assert!(out.contains("<del>silik</del>"));
    assert!(out.contains("type=\"checkbox\""));
    assert!(out.contains("<strong>kalın</strong>"));
    assert!(out.contains("<code class=\"language-rust\">"));
    assert!(out.contains("<blockquote>"));
}

#[test]
fn md_to_txt_keeps_words_markers_and_code() {
    let out = convert_text("notes.md", MARKDOWN.as_bytes(), "md", "txt");
    let expected = "Başlık ğüşıöç\n\
\n\
Paragraf kalın ve eğik ve silik ve kod ve bağlantı.\n\
\n\
Ad\tŞehir\n\
Ayşe\tİzmir\n\
Can 🧪\tMuğla\n\
\n\
- [x] bitti\n\
- [ ] yapılacak\n  - iç madde\n\
\n\
1. bir\n\
2. iki\n\
\n\
fn main() {}\n\
\n\
alıntı\n";
    assert_eq!(out, expected);
}

#[test]
fn md_to_txt_handles_loose_lists_and_crlf() {
    let input = "- first\r\n\r\n  second paragraph\r\n- next\r\n\r\n3. three\r\n4. four\r\n";
    let out = convert_text("loose.md", input.as_bytes(), "md", "txt");
    assert_eq!(
        out,
        "- first\r\n\r\n  second paragraph\r\n- next\r\n\r\n3. three\r\n4. four\r\n"
    );
}

const PAGE: &str = "<!DOCTYPE html><html><head><title>Sayfa başlığı</title>\
<style>p { color: red }</style><script>var secret = 1;</script></head><body>\
<h1>Merhaba &amp; ho&#351; geldin</h1>\
<p>Uzun paragraf LONG_TEXT</p>\
<p>Caf&eacute; &lt;tag&gt; &#x1F9EA; <a href=\"https://example.test\">bağlantı</a> <em>vurgu</em></p>\
<ul><li>bir</li><li>iki</li></ul>\
<ol><li>first</li><li>second</li></ol>\
<hr>\
<table><tr><th>Ad</th><th>Şehir</th></tr><tr><td>Ayşe</td><td>İzmir</td></tr></table>\
<p>satır<br>alt satır</p>\
</body></html>";

fn page() -> String {
    PAGE.replace("LONG_TEXT", &"kelime ".repeat(60))
}

#[test]
fn html_to_txt_without_wrapping() {
    let out = convert_text("sayfa.html", page().as_bytes(), "html", "txt");
    let lines: Vec<&str> = out.lines().collect();
    assert!(lines.contains(&"Merhaba & hoş geldin"), "{out}");
    let long = lines
        .iter()
        .find(|line| line.starts_with("Uzun paragraf"))
        .unwrap();
    assert_eq!(
        long.trim_end(),
        format!("Uzun paragraf {}", "kelime ".repeat(60)).trim_end()
    );
    assert!(lines.contains(&"Café <tag> 🧪 bağlantı vurgu"), "{out}");
    assert!(
        lines.contains(&"- bir") && lines.contains(&"- iki"),
        "{out}"
    );
    assert!(
        lines.contains(&"1. first") && lines.contains(&"2. second"),
        "{out}"
    );
    assert!(lines.contains(&"* * *"), "{out}");
    assert!(
        lines.contains(&"satır") && lines.contains(&"alt satır"),
        "{out}"
    );
    assert!(out.contains("Ayşe") && out.contains("İzmir"));
    assert!(!out.contains("secret") && !out.contains("color"));
    assert!(!out.contains("https://"), "links keep their text only");
    assert!(!out.contains('#'));
}

#[test]
fn html_to_md() {
    let out = convert_text("sayfa.html", page().as_bytes(), "html", "md");
    assert!(out.contains("# Merhaba & hoş geldin"), "{out}");
    assert!(out.contains("[bağlantı](https://example.test)"), "{out}");
    assert!(out.contains("_vurgu_") || out.contains("*vurgu*"), "{out}");
    assert!(out.contains("- bir\n- iki"), "{out}");
    assert!(out.contains("1. first\n2. second"), "{out}");
    assert!(out.contains("| Ayşe | İzmir |"), "{out}");
    assert!(out.contains("satır\\\nalt satır"), "{out}");
    assert!(
        !out.contains("secret") && !out.contains("Sayfa başlığı"),
        "{out}"
    );
    assert!(out.ends_with('\n') && !out.ends_with("\n\n"));

    let crlf = "<p>bir</p>\r\n<p>iki</p>\r\n";
    let out = convert_text("crlf.html", crlf.as_bytes(), "html", "md");
    assert_eq!(out, "bir\r\n\r\niki\r\n");
}

#[test]
fn html_to_txt_large_page_is_quick() {
    let row = "<tr><td>hücre</td><td>değer 🧪</td></tr>";
    let page = format!(
        "<p>{}</p><hr><table>{}</table><ul>{}</ul>",
        "uzun ".repeat(20_000),
        row.repeat(2_000),
        "<li>madde</li>".repeat(2_000)
    );
    let started = std::time::Instant::now();
    let out = html::to_text(&page).unwrap();
    assert!(out.lines().next().unwrap().len() > 90_000);
    assert!(started.elapsed().as_secs() < 30);
}

fn clipping(dictionary: Dictionary) -> Vec<u8> {
    let mut root = Dictionary::new();
    root.insert("UTI-Data".into(), Value::Dictionary(dictionary));
    root.insert(
        "UTI-Data-Ordering".into(),
        Value::Array(vec![Value::String("public.utf8-plain-text".into())]),
    );
    let mut bytes = Vec::new();
    Value::Dictionary(root)
        .to_writer_binary(Cursor::new(&mut bytes))
        .unwrap();
    bytes
}

#[test]
fn textclipping_from_binary_plist() {
    let text = format!("{TURKISH}\n🧪 ikinci satır");
    let mut dictionary = Dictionary::new();
    dictionary.insert(
        "public.utf8-plain-text".into(),
        Value::Data(text.as_bytes().to_vec()),
    );
    dictionary.insert("public.rtf".into(), Value::Data(b"{\\rtf1 x}".to_vec()));
    let out = convert_text(
        "Kento ğüşıöç 🧪.textclipping",
        &clipping(dictionary),
        "textclipping",
        "txt",
    );
    assert_eq!(out, text);

    // UTF-16 only, as some apps store it.
    let mut dictionary = Dictionary::new();
    let units: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
    dictionary.insert("public.utf16-plain-text".into(), Value::Data(units));
    let out = convert_text(
        "utf16.textclipping",
        &clipping(dictionary),
        "textclipping",
        "txt",
    );
    assert_eq!(out, text);

    // A string value in an XML property list.
    let mut dictionary = Dictionary::new();
    dictionary.insert("public.utf8-plain-text".into(), Value::String(text.clone()));
    let mut root = Dictionary::new();
    root.insert("UTI-Data".into(), Value::Dictionary(dictionary));
    let mut xml = Vec::new();
    Value::Dictionary(root).to_writer_xml(&mut xml).unwrap();
    let out = convert_text("xml.textclipping", &xml, "textclipping", "txt");
    assert_eq!(out, text);
}

#[test]
fn textclipping_without_text() {
    let mut dictionary = Dictionary::new();
    dictionary.insert("public.rtf".into(), Value::Data(b"{\\rtf1 x}".to_vec()));
    let error = convert_bytes(
        "rtf.textclipping",
        &clipping(dictionary),
        "textclipping",
        "txt",
    )
    .unwrap_err();
    assert!(matches!(error, Error::Unreadable(_)));

    // Classic clipping copied without its resource fork.
    let error = convert_bytes("old.textclipping", b"", "textclipping", "txt").unwrap_err();
    match error {
        Error::Unreadable(reason) => assert!(reason.contains("resource fork"), "{reason}"),
        other => panic!("{other:?}"),
    }
    let error =
        convert_bytes("junk.textclipping", b"not a plist", "textclipping", "txt").unwrap_err();
    assert!(matches!(error, Error::Unreadable(_)));
}

/// Property lists nest arrays inside a dictionary `depth` levels deep, next to the text.
fn nested_clipping(depth: usize, binary: bool) -> Vec<u8> {
    let mut deep = Value::String("dip".into());
    for _ in 0..depth {
        deep = Value::Array(vec![deep]);
    }
    let mut root = Dictionary::new();
    root.insert(
        "public.utf8-plain-text".into(),
        Value::String("bulundu".into()),
    );
    root.insert("deep".into(), deep);
    let mut bytes = Vec::new();
    if binary {
        Value::Dictionary(root)
            .to_writer_binary(Cursor::new(&mut bytes))
            .unwrap();
    } else {
        Value::Dictionary(root).to_writer_xml(&mut bytes).unwrap();
    }
    bytes
}

/// A hostile clipping cannot make the parser recurse until the stack runs out.
#[test]
fn textclipping_nesting_is_bounded() {
    for binary in [true, false] {
        let out = convert_text(
            "sığ.textclipping",
            &nested_clipping(20, binary),
            "textclipping",
            "txt",
        );
        assert_eq!(out, "bulundu");
        let error = convert_bytes(
            "derin.textclipping",
            &nested_clipping(100, binary),
            "textclipping",
            "txt",
        )
        .unwrap_err();
        assert!(matches!(error, Error::Unreadable(_)), "{error:?}");
    }
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>\
         <key>public.utf8-plain-text</key><string>x</string><key>deep</key>{}{}</dict></plist>",
        "<array>".repeat(1_000_000),
        "</array>".repeat(1_000_000)
    );
    // An array that contains itself.
    let mut cyclic = b"bplist00\xA1\x00".to_vec();
    cyclic.push(8);
    cyclic.extend_from_slice(&[0, 0, 0, 0, 0, 0, 1, 1]);
    cyclic.extend_from_slice(&1u64.to_be_bytes());
    cyclic.extend_from_slice(&0u64.to_be_bytes());
    cyclic.extend_from_slice(&10u64.to_be_bytes());
    std::thread::Builder::new()
        .stack_size(1 << 20)
        .spawn(move || {
            for hostile in [xml.into_bytes(), cyclic] {
                let error = convert_bytes("kötü.textclipping", &hostile, "textclipping", "txt")
                    .unwrap_err();
                assert!(matches!(error, Error::Unreadable(_)), "{error:?}");
            }
        })
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn textclipping_from_apple_double_resource_fork() {
    let dir = tempfile::tempdir().unwrap();
    let text = "Eski Mac kırpıntısı";
    let fork = clipping::fixtures::resource_fork(b"utf8", text.as_bytes());
    fs::write(
        dir.path().join("._Eski.textclipping"),
        clipping::fixtures::apple_double(&fork),
    )
    .unwrap();
    let out = convert_in(dir.path(), "Eski.textclipping", b"", "textclipping", "txt").unwrap();
    assert_eq!(String::from_utf8(out).unwrap(), text);

    let (roman, _, _) = encoding_rs::MACINTOSH.encode("Café über");
    let fork = clipping::fixtures::resource_fork(b"TEXT", &roman);
    fs::write(
        dir.path().join("._Roman.textclipping"),
        clipping::fixtures::apple_double(&fork),
    )
    .unwrap();
    let out = convert_in(dir.path(), "Roman.textclipping", b"", "textclipping", "txt").unwrap();
    assert_eq!(String::from_utf8(out).unwrap(), "Café über");
}

#[test]
fn oversized_input_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.txt");
    fs::write(&path, vec![b'a'; 2048]).unwrap();
    assert!(matches!(read_capped(&path, 1024), Err(Error::Limit(_))));
    assert_eq!(read_capped(&path, 2048).unwrap().len(), 2048);
}

/// Converters that recurse per level must not overflow the small stack of a worker thread.
#[test]
fn deeply_nested_input_on_a_small_stack() {
    let nested = |depth: usize| format!("{}x{}", "<div>".repeat(depth), "</div>".repeat(depth));
    let quotes = format!("{}x", "> ".repeat(20_000));
    let list: String = (0..2_000)
        .map(|level| format!("{}- x\n", "  ".repeat(level)))
        .collect();
    std::thread::Builder::new()
        .stack_size(1 << 20)
        .spawn(move || {
            assert!(html::to_markdown(&nested(900)).unwrap().contains('x'));
            assert!(html::to_text(&nested(2_000)).unwrap().contains('x'));
            // Too deep for `htmd`, found on the parsed page.
            assert!(matches!(
                html::to_markdown(&nested(1_500)),
                Err(Error::Limit(_))
            ));
            assert!(markdown::to_text(&quotes).contains('x'));
            assert!(markdown::to_html(&quotes).contains('x'));
            assert!(markdown::to_text(&list).contains('x'));
        })
        .unwrap()
        .join()
        .unwrap();
}

/// Pages that would keep the parser busy for minutes are refused before parsing, quickly.
#[test]
fn pathological_nesting_is_refused_quickly() {
    let started = std::time::Instant::now();
    let deep = format!("{}x", "<div>".repeat(200_000));
    assert!(matches!(html::to_text(&deep), Err(Error::Limit(_))));
    assert!(matches!(html::to_markdown(&deep), Err(Error::Limit(_))));
    let self_closing = "<div/>".repeat(6_000);
    assert!(matches!(html::to_text(&self_closing), Err(Error::Limit(_))));
    // Deep enough to stay under the depth limit, with many tags at that depth.
    let heavy = format!("{}{}", "<div>".repeat(4_900), "<i>x</i>".repeat(70_000));
    assert!(matches!(html::to_text(&heavy), Err(Error::Limit(_))));
    assert!(started.elapsed().as_secs() < 10, "{:?}", started.elapsed());
}

/// Sloppy but ordinary markup: unclosed cells, items and paragraphs, stray end tags, SVG with
/// self-closing shapes, scripts full of tags.
#[test]
fn sloppy_pages_are_not_refused() {
    let page = format!(
        "<!DOCTYPE html><!-- <div><div> --><table>{}</table><ul>{}</ul>{}{}<svg>{}</svg>\
         <script>{}</script><dl>{}</dl><select>{}</select>",
        "<tr><td><font>a<td><b>b".repeat(3_000),
        "<li><span>item".repeat(3_000),
        "<p><font>paragraph".repeat(3_000),
        "</b></span>x".repeat(3_000),
        "<path d='M0 0'/>".repeat(6_000),
        "document.write('<div>');".repeat(6_000),
        "<dt>t<dd><em>d".repeat(3_000),
        "<option>o".repeat(6_000),
    );
    assert!(html::within_parse_budget(&page));
    assert!(html::to_text("<ul><li>a<ul><li>b<ul><li>c</ul></ul></ul>")
        .unwrap()
        .contains('c'));
}
