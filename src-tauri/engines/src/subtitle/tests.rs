// SPDX-License-Identifier: MIT
use encoding_rs::WINDOWS_1254;

use super::*;
use crate::text::tests::{convert_bytes, convert_text};

const SRT: &str = "\u{feff}1\r\n\
00:00:01,000 --> 00:00:04,500\r\n\
<i>Merhaba</i> dünya & <b>ğüşıöç</b> 🧪\r\n\
İkinci satır\r\n\
\r\n\
2\r\n\
00:00:03,000 --> 00:00:06,000 X1:10 X2:20 Y1:30 Y2:40\r\n\
{\\an8}Üstte, çakışan\r\n\
\r\n\
00:01:02.5 --> 01:00:00,000\r\n\
Numarasız -- > ok\r\n\
a <3 b\r\n";

#[test]
fn routes() {
    for (from, to) in [
        ("srt", "vtt"),
        ("srt", "txt"),
        ("vtt", "srt"),
        ("vtt", "txt"),
    ] {
        assert!(supports(from, to), "{from} → {to}");
        assert!(crate::supports(from, to));
    }
    for (from, to) in [
        ("srt", "srt"),
        ("vtt", "vtt"),
        ("txt", "srt"),
        ("srt", "md"),
    ] {
        assert!(!supports(from, to), "{from} → {to}");
    }
}

#[test]
fn times() {
    assert_eq!(parse_time("00:00:01,000"), Some(1000));
    assert_eq!(parse_time("01:02:03.456"), Some(3_723_456));
    assert_eq!(parse_time("02:03.456"), Some(123_456));
    assert_eq!(parse_time("1:02:03,4"), Some(3_723_400));
    assert_eq!(parse_time("100:00:00.000"), Some(360_000_000));
    assert_eq!(parse_time("00:61:00.000"), None);
    assert_eq!(parse_time("abc"), None);
    assert_eq!(format_time(3_723_456, ','), "01:02:03,456");
    assert_eq!(format_time(360_000_000, '.'), "100:00:00.000");
}

#[test]
fn srt_to_vtt() {
    let out = convert_text("Kento ğüşıöç 🧪.srt", SRT.as_bytes(), "srt", "vtt");
    let expected = "WEBVTT\r\n\
\r\n\
00:00:01.000 --> 00:00:04.500\r\n\
<i>Merhaba</i> dünya &amp; <b>ğüşıöç</b> 🧪\r\n\
İkinci satır\r\n\
\r\n\
00:00:03.000 --> 00:00:06.000\r\n\
Üstte, çakışan\r\n\
\r\n\
00:01:02.500 --> 01:00:00.000\r\n\
Numarasız -- > ok\r\n\
a &lt;3 b\r\n\
\r\n";
    assert_eq!(out, expected);
}

#[test]
fn srt_to_txt() {
    let out = convert_text("film.srt", SRT.as_bytes(), "srt", "txt");
    let expected = "Merhaba dünya & ğüşıöç 🧪\r\n\
İkinci satır\r\n\
\r\n\
Üstte, çakışan\r\n\
\r\n\
Numarasız -- > ok\r\n\
a <3 b\r\n";
    assert_eq!(out, expected);
}

const VTT: &str = "WEBVTT - Türkçe altyazı\n\
Kind: captions\n\
\n\
NOTE bu bir not\n\
00:00 bile olsa yok sayılır\n\
\n\
STYLE\n\
::cue { color: yellow }\n\
\n\
REGION\n\
id:alt width:40%\n\
\n\
giris\n\
00:01.000 --> 00:04.000 line:0 align:start\n\
<v Ayşe>Merhaba &amp; hoş geldin</v>\n\
<c.vurgu>renkli</c> <i.yan>eğik</i> <00:00:02.000>zamanlı\n\
\n\
00:00:03.500 --> 00:00:05.000\n\
Çakışan &lt;ok&gt; &#x1F9EA;\n\
\n\
2\n\
00:00:06.000 --> 00:00:07.000\n\
\n";

#[test]
fn vtt_to_srt() {
    let out = convert_text("film.vtt", VTT.as_bytes(), "vtt", "srt");
    let expected = "1\n\
00:00:01,000 --> 00:00:04,000\n\
Merhaba & hoş geldin\n\
renkli <i>eğik</i> zamanlı\n\
\n\
2\n\
00:00:03,500 --> 00:00:05,000\n\
Çakışan <ok> 🧪\n\
\n\
3\n\
00:00:06,000 --> 00:00:07,000\n\
\n";
    assert_eq!(out, expected);
}

#[test]
fn vtt_to_txt() {
    let out = convert_text("film.vtt", VTT.as_bytes(), "vtt", "txt");
    assert_eq!(
        out,
        "Merhaba & hoş geldin\nrenkli eğik zamanlı\n\nÇakışan <ok> 🧪\n"
    );
}

#[test]
fn vtt_keeps_identifiers_and_settings_when_parsed() {
    let content = text::normalize_newlines(VTT);
    let cues = parse(&content, Source::Vtt);
    assert_eq!(cues.len(), 3);
    assert_eq!(cues[0].id.as_deref(), Some("giris"));
    assert_eq!(cues[0].settings, "line:0 align:start");
    assert_eq!((cues[1].start, cues[1].end), (3500, 5000));
    assert_eq!(cues[2].id.as_deref(), Some("2"));
    assert!(cues[2].lines.is_empty());
}

#[test]
fn srt_without_blank_lines_or_numbers() {
    let input =
        "1\n00:00:01,000 --> 00:00:02,000\nbir\n2\n00:00:03,000 --> 00:00:04,000\niki\n\n\n\
                 00:00:05,000-->00:00:06,000\nüç\n\ndevam eden satır\n\n7\n";
    let cues = parse(input, Source::Srt);
    assert_eq!(cues.len(), 3);
    assert_eq!(cues[0].lines, ["bir"]);
    assert_eq!(cues[1].id.as_deref(), Some("2"));
    assert_eq!(cues[1].lines, ["iki"]);
    assert_eq!(cues[2].lines, ["üç", "devam eden satır"]);
}

#[test]
fn legacy_encodings() {
    let srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nĞüneşli ışık, İzmir\r\n";
    let (cp1254, _, _) = WINDOWS_1254.encode(srt);
    let out = convert_text("eski.srt", &cp1254, "srt", "txt");
    assert_eq!(out, "Ğüneşli ışık, İzmir\r\n");

    let mut utf16 = vec![0xFF, 0xFE];
    utf16.extend(srt.encode_utf16().flat_map(u16::to_le_bytes));
    let out = convert_text("utf16.srt", &utf16, "srt", "vtt");
    assert!(out.starts_with("WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nĞüneşli"));
}

#[test]
fn empty_file_is_unreadable() {
    let error = convert_bytes("empty.srt", b"\xEF\xBB\xBF\r\n\r\n", "srt", "vtt").unwrap_err();
    assert!(matches!(error, Error::Unreadable(_)));
    let error = convert_bytes("header.vtt", b"WEBVTT\n\nNOTE only\n", "vtt", "srt").unwrap_err();
    assert!(matches!(error, Error::Unreadable(_)));
}

#[test]
fn round_trip_keeps_timing_and_text() {
    let vtt = convert_text("a.srt", SRT.as_bytes(), "srt", "vtt");
    let srt = convert_text("a.vtt", vtt.as_bytes(), "vtt", "srt");
    let original = parse(
        &text::normalize_newlines(SRT.trim_start_matches('\u{feff}')),
        Source::Srt,
    );
    let again = parse(&text::normalize_newlines(&srt), Source::Srt);
    assert_eq!(original.len(), again.len());
    for (a, b) in original.iter().zip(&again) {
        assert_eq!((a.start, a.end), (b.start, b.end));
    }
    assert_eq!(
        again[0].lines,
        ["<i>Merhaba</i> dünya & <b>ğüşıöç</b> 🧪", "İkinci satır"]
    );
}

#[test]
fn hands_ffmpeg_a_utf8_srt_and_the_page_a_sample() {
    let dir = tempfile::tempdir().unwrap();
    // Windows-1254 SRT, as Turkish subtitles often come.
    let legacy = dir.path().join("eski ğ.srt");
    let (cp1254, _, _) =
        WINDOWS_1254.encode("1\r\n00:00:01,500 --> 00:00:03,000\r\nŞimdi ağaç\r\n");
    std::fs::write(&legacy, cp1254).unwrap();
    assert_eq!(
        to_srt(&legacy, false).unwrap(),
        "1\n00:00:01,500 --> 00:00:03,000\nŞimdi ağaç\n\n"
    );
    // At the top: each cue moves, except one that places itself.
    let placed = dir.path().join("yer.srt");
    std::fs::write(
        &placed,
        "1\n00:00:01,000 --> 00:00:02,000\nüst\n\n2\n00:00:03,000 --> 00:00:04,000\n{\\an1}sol alt\n",
    )
    .unwrap();
    assert_eq!(
        to_srt(&placed, true).unwrap(),
        "1\n00:00:01,000 --> 00:00:02,000\n{\\an8}üst\n\n2\n00:00:03,000 --> 00:00:04,000\n{\\an1}sol alt\n\n"
    );
    // VTT tags become SRT's, entities become letters; an empty first cue is skipped.
    let vtt = dir.path().join("web 🧪.vtt");
    std::fs::write(
        &vtt,
        "WEBVTT\n\n00:00.000 --> 00:00.500\n\n\n00:02.000 --> 00:04.000 line:0\n<c.red>Kırmızı</c> &amp; <b>kalın</b>\nikinci\n",
    )
    .unwrap();
    let srt = to_srt(&vtt, false).unwrap();
    assert!(
        srt.contains("00:00:02,000 --> 00:00:04,000\nKırmızı & <b>kalın</b>\nikinci\n"),
        "{srt:?}"
    );
    assert_eq!(
        sample(&vtt).unwrap(),
        Some(Sample {
            start: 2.0,
            end: 4.0,
            text: "Kırmızı & kalın\nikinci".into()
        })
    );
    let empty = dir.path().join("boş.srt");
    std::fs::write(&empty, "\u{feff}\n").unwrap();
    assert!(matches!(to_srt(&empty, false), Err(Error::Unreadable(_))));
}
