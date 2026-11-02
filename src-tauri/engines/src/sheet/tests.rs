// SPDX-License-Identifier: MIT
use std::fs;
use std::path::Path;

use calamine::{open_workbook, Data, Reader, Xlsx};
use encoding_rs::WINDOWS_1254;
use rust_xlsxwriter::{ExcelDateTime, Format, Workbook};

use super::*;
use crate::text::tests::{convert_bytes, convert_in};
use crate::Progress;

const BOM: &str = "\u{feff}";

fn text_output(bytes: Vec<u8>) -> String {
    let text = String::from_utf8(bytes).unwrap();
    assert!(text.starts_with(BOM), "CSV and TSV start with a BOM");
    text[BOM.len()..].to_owned()
}

#[test]
fn routes() {
    for from in INPUTS {
        for to in OUTPUTS {
            assert_eq!(supports(from, to), from != to, "{from} → {to}");
            assert_eq!(crate::supports(from, to), from != to, "{from} → {to}");
        }
    }
    assert!(!supports("numbers", "csv"));
    assert!(!supports("csv", "ods"));
    assert!(!supports("csv", "pdf"));
}

#[test]
fn sniffs_delimiters() {
    use read::sniff_delimiter as sniff;
    assert_eq!(sniff("a,b,c\n1,2,3\n"), b',');
    assert_eq!(sniff("Ad;Fiyat\nElma;1,5\nArmut;2,75\n"), b';');
    assert_eq!(sniff("a\tb\tc\n1\t2,5\t3\n"), b'\t');
    assert_eq!(sniff("a|b|c\n1|2|3\n"), b'|');
    assert_eq!(sniff("\"x,y\";\"z\"\n\"1,2\";\"3\"\n"), b';');
    assert_eq!(sniff("\"multi\nline, with comma\";b\nc;d\n"), b';');
    assert_eq!(sniff("tek sütun\nbir değer\n"), b',');
}

const SEMICOLON_CSV: &str = "Ad;Fiyat;Açıklama;Tarih\r\n\
Elma;1,5;\"Kırmızı; tatlı\";2024-01-31\r\n\
Armut;2,75;\"İki\r\nsatır \"\"özel\"\"\";\r\n\
Şeftali;;;\r\n";

#[test]
fn semicolon_cp1254_csv_to_tsv() {
    let (bytes, _, lossy) = WINDOWS_1254.encode(SEMICOLON_CSV);
    assert!(!lossy);
    let out = text_output(convert_bytes("Kento ğüşıöç 🧪.csv", &bytes, "csv", "tsv").unwrap());
    let expected = "Ad\tFiyat\tAçıklama\tTarih\r\n\
Elma\t1,5\tKırmızı; tatlı\t2024-01-31\r\n\
Armut\t2,75\t\"İki\r\nsatır \"\"özel\"\"\"\t\r\n\
Şeftali\t\t\t\r\n";
    assert_eq!(out, expected);
}

#[test]
fn tsv_to_csv_quotes_when_needed() {
    let tsv = "ad\tnot\r\nAyşe\tvirgül, var\r\nCan 🧪\t\"tırnak\"\"lı\"\r\n";
    let out = text_output(convert_bytes("liste.tsv", tsv.as_bytes(), "tsv", "csv").unwrap());
    assert_eq!(
        out,
        "ad,not\r\nAyşe,\"virgül, var\"\r\nCan 🧪,\"tırnak\"\"lı\"\r\n"
    );
}

fn read_back(bytes: &[u8]) -> Vec<(String, Vec<Vec<Data>>)> {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("back.xlsx");
    fs::write(&path, bytes).unwrap();
    let mut workbook: Xlsx<_> = open_workbook(&path).unwrap();
    workbook
        .worksheets()
        .into_iter()
        .map(|(name, range)| (name, range.rows().map(<[Data]>::to_vec).collect()))
        .collect()
}

fn date_serial(data: &Data) -> f64 {
    match data {
        Data::DateTime(datetime) if datetime.is_datetime() => datetime.as_f64(),
        other => panic!("expected a date, got {other:?}"),
    }
}

#[test]
fn csv_to_xlsx_types_values() {
    let csv = "Ad,Adet,Fiyat,Kod,Tarih,Zaman,Var\r\n\
Elma,3,1.5,007,2024-01-31,2024-01-31 13:05:00,TRUE\r\n\
Uzun,12345678901234567,1e3,-0.5,31.01.2024,13:05,false\r\n\
Saat,13:05:30,\"1,5\",,,,\r\n";
    let out = convert_bytes("Satışlar ğüşıöç 🧪.csv", csv.as_bytes(), "csv", "xlsx").unwrap();
    let sheets = read_back(&out);
    assert_eq!(sheets.len(), 1);
    let (name, rows) = &sheets[0];
    assert_eq!(name, "Satışlar ğüşıöç 🧪");
    assert_eq!(rows[0][0], Data::String("Ad".into()));
    assert_eq!(rows[1][1], Data::Float(3.0));
    assert_eq!(rows[1][2], Data::Float(1.5));
    assert_eq!(rows[1][3], Data::String("007".into()));
    assert_eq!(date_serial(&rows[1][4]), 45322.0);
    assert!((date_serial(&rows[1][5]) - (45322.0 + 13.0 / 24.0 + 5.0 / 1440.0)).abs() < 1e-9);
    assert_eq!(rows[1][6], Data::Bool(true));
    assert_eq!(rows[2][1], Data::String("12345678901234567".into()));
    assert_eq!(rows[2][2], Data::Float(1000.0));
    assert_eq!(rows[2][3], Data::Float(-0.5));
    assert_eq!(rows[2][4], Data::String("31.01.2024".into()));
    assert_eq!(rows[2][5], Data::String("13:05".into()));
    assert_eq!(rows[2][6], Data::Bool(false));
    assert!(
        (date_serial(&rows[3][1]) - (13.0 * 3600.0 + 5.0 * 60.0 + 30.0) / 86400.0).abs() < 1e-9
    );
    assert_eq!(
        rows[3][2],
        Data::String("1,5".into()),
        "a comma file keeps 1,5 as text"
    );
}

#[test]
fn semicolon_csv_to_xlsx_reads_decimal_commas() {
    let out = convert_bytes("tr.csv", SEMICOLON_CSV.as_bytes(), "csv", "xlsx").unwrap();
    let sheets = read_back(&out);
    let rows = &sheets[0].1;
    assert_eq!(rows[1][1], Data::Float(1.5));
    assert_eq!(rows[2][1], Data::Float(2.75));
    assert_eq!(rows[2][2], Data::String("İki\r\nsatır \"özel\"".into()));
    assert_eq!(date_serial(&rows[1][3]), 45322.0);
}

/// A workbook with an empty first sheet, a sheet of every value type and a third sheet.
fn sample_workbook(path: &Path) {
    let mut workbook = Workbook::new();
    workbook.add_worksheet().set_name("Boş").unwrap();
    let date = Format::new().set_num_format("yyyy-mm-dd");
    let time = Format::new().set_num_format("hh:mm:ss");
    let datetime = Format::new().set_num_format("yyyy-mm-dd hh:mm:ss.000");
    let duration = Format::new().set_num_format("[h]:mm:ss");
    let sheet = workbook.add_worksheet();
    sheet.set_name("Satış <&> ğüşıöç").unwrap();
    for (column, title) in [
        "Ürün", "Adet", "Fiyat", "Tarih", "Saat", "Zaman", "Var mı", "Not",
    ]
    .iter()
    .enumerate()
    {
        sheet.write_string(0, column as u16, *title).unwrap();
    }
    sheet.write_string(1, 0, "Elma, kırmızı").unwrap();
    sheet.write_number(1, 1, 3).unwrap();
    sheet.write_number(1, 2, 0.1 + 0.2).unwrap();
    let day = ExcelDateTime::from_ymd(2024, 1, 31).unwrap();
    sheet.write_datetime_with_format(1, 3, &day, &date).unwrap();
    let clock = ExcelDateTime::from_hms(13, 5, 30).unwrap();
    sheet
        .write_datetime_with_format(1, 4, &clock, &time)
        .unwrap();
    let moment = ExcelDateTime::from_ymd(2024, 2, 29)
        .unwrap()
        .and_hms_milli(8, 0, 0, 250)
        .unwrap();
    sheet
        .write_datetime_with_format(1, 5, &moment, &datetime)
        .unwrap();
    sheet.write_boolean(1, 6, true).unwrap();
    sheet
        .write_string(1, 7, "satır 1\nsatır 2 \"tırnak\" <b>")
        .unwrap();
    sheet.write_string(2, 0, "Armut 🧪").unwrap();
    sheet.write_number(2, 1, -2).unwrap();
    sheet.write_number(2, 2, 1234.5).unwrap();
    sheet
        .write_number_with_format(2, 4, 1.5, &duration)
        .unwrap();
    sheet.write_boolean(2, 6, false).unwrap();
    sheet.write_string(4, 9, "uzak").unwrap();
    let third = workbook.add_worksheet();
    third.set_name("Üçüncü").unwrap();
    third.write_number(0, 0, 42).unwrap();
    workbook.save(path).unwrap();
}

#[test]
fn xlsx_to_csv_takes_the_first_sheet_with_values() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("kaynak.xlsx");
    sample_workbook(&source);
    let bytes = fs::read(&source).unwrap();
    let out =
        text_output(convert_in(dir.path(), "Kento ğüşıöç 🧪.xlsx", &bytes, "xlsx", "csv").unwrap());
    let expected = "Ürün,Adet,Fiyat,Tarih,Saat,Zaman,Var mı,Not,,\r\n\
\"Elma, kırmızı\",3,0.3,2024-01-31,13:05:30,2024-02-29T08:00:00.250,TRUE,\"satır 1\nsatır 2 \"\"tırnak\"\" <b>\",,\r\n\
Armut 🧪,-2,1234.5,,36:00:00,,FALSE,,,\r\n\
,,,,,,,,,\r\n\
,,,,,,,,,uzak\r\n";
    assert_eq!(out, expected);

    let out = text_output(convert_in(dir.path(), "tab.xlsx", &bytes, "xlsx", "tsv").unwrap());
    assert!(out.starts_with("Ürün\tAdet\t"));
    assert!(out.contains("\"Elma, kırmızı\"") || out.contains("Elma, kırmızı\t3"));
}

#[test]
fn xlsx_to_html_has_a_table_per_sheet() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("kaynak.xlsx");
    sample_workbook(&source);
    let bytes = fs::read(&source).unwrap();
    let out = convert_in(dir.path(), "Rapor ğüşıöç 🧪.xlsx", &bytes, "xlsx", "html").unwrap();
    let out = String::from_utf8(out).unwrap();
    assert!(out.starts_with("<!DOCTYPE html>"));
    assert!(out.contains("<meta charset=\"utf-8\">"));
    assert!(out.contains("<title>Rapor ğüşıöç 🧪</title>"));
    assert!(out.contains("<h2>Boş</h2>\n<table>\n</table>"));
    assert!(out.contains("<h2>Satış &lt;&amp;&gt; ğüşıöç</h2>"));
    assert!(out.contains("<h2>Üçüncü</h2>"));
    assert!(out.contains("<td>satır 1\nsatır 2 &quot;tırnak&quot; &lt;b&gt;</td>"));
    assert!(out.contains("<td class=\"n\">2024-01-31</td>"));
    assert!(out.contains("<td>TRUE</td>"));
    assert_eq!(out.matches("<table>").count(), 3);
    assert!(!out.contains("<b>"));
}

#[test]
fn csv_to_html_without_headings() {
    let csv = "a,b\n<x>,&\n";
    let out = convert_bytes("düz.csv", csv.as_bytes(), "csv", "html").unwrap();
    let out = String::from_utf8(out).unwrap();
    assert!(!out.contains("<h2>"));
    assert!(out.contains("<title>düz</title>"));
    assert!(out.contains("<tr><td>&lt;x&gt;</td><td>&amp;</td></tr>"));
}

#[test]
fn workbook_to_xlsx_keeps_types_and_every_sheet() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("kaynak.xlsx");
    sample_workbook(&source);
    let progress = Progress::none();
    let sheets = read::workbook(&source, "xlsx", &progress).unwrap();
    assert_eq!(sheets.len(), 3);
    let dest = dir.path().join("yeni.xlsx");
    write::xlsx(&sheets, None, &dest, &progress).unwrap();
    let back = read_back(&fs::read(&dest).unwrap());
    let names: Vec<&str> = back.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, ["Boş", "Satış <&> ğüşıöç", "Üçüncü"]);
    let rows = &back[1].1;
    assert_eq!(rows[1][0], Data::String("Elma, kırmızı".into()));
    assert_eq!(rows[1][1], Data::Float(3.0));
    assert_eq!(date_serial(&rows[1][3]), 45322.0);
    assert!(
        (date_serial(&rows[1][4]) - (13.0 * 3600.0 + 5.0 * 60.0 + 30.0) / 86400.0).abs() < 1e-9
    );
    let moment = date_serial(&rows[1][5]);
    assert!((moment - (45351.0 + (8.0 * 3600.0 + 0.25) / 86400.0)).abs() < 1e-8);
    assert_eq!(rows[1][6], Data::Bool(true));
    match &rows[2][4] {
        Data::DateTime(duration) => {
            assert!(duration.is_duration());
            assert_eq!(duration.as_f64(), 1.5);
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(back[2].1[0][0], Data::Float(42.0));
}

#[test]
fn far_away_cell_hits_the_limit_not_the_memory() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("seyrek.xlsx");
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.write_string(0, 0, "A1").unwrap();
    sheet.write_string(1_048_575, 16_383, "XFD1048576").unwrap();
    workbook.save(&source).unwrap();
    let bytes = fs::read(&source).unwrap();
    let error = convert_in(dir.path(), "seyrek kopya.xlsx", &bytes, "xlsx", "csv").unwrap_err();
    assert!(matches!(error, Error::Limit(_)), "{error:?}");
}

#[test]
fn xlsx_limits_are_checked() {
    let dir = tempfile::tempdir().unwrap();
    let progress = Progress::none();
    let tall = Sheet {
        name: "uzun".into(),
        cells: vec![(2_000_000, 0, Value::Int(1))],
    };
    let error = write::xlsx(&[tall], None, &dir.path().join("a.xlsx"), &progress).unwrap_err();
    assert!(matches!(error, Error::Limit(_)));
    let wide = Sheet {
        name: "geniş".into(),
        cells: vec![(0, 0, Value::Text("x".repeat(40_000)))],
    };
    let error = write::xlsx(&[wide], None, &dir.path().join("b.xlsx"), &progress).unwrap_err();
    assert!(matches!(error, Error::Limit(_)));
}

#[test]
fn not_a_workbook() {
    let error = convert_bytes(
        "sahte.xls",
        b"<html><table><tr><td>1</td></tr></table></html>",
        "xls",
        "csv",
    )
    .unwrap_err();
    assert!(matches!(error, Error::Unreadable(_)));
    let mut compound = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    compound.extend_from_slice(&[0; 512]);
    let error = convert_bytes("bozuk.xls", &compound, "xls", "csv").unwrap_err();
    assert!(matches!(error, Error::Unreadable(_)), "{error:?}");
    let error = convert_bytes("bozuk.ods", b"PK\x03\x04garbage", "ods", "csv").unwrap_err();
    assert!(matches!(error, Error::Unreadable(_)), "{error:?}");
}

#[test]
fn values_as_text() {
    assert_eq!(number_text(0.1 + 0.2), "0.3");
    assert_eq!(number_text(1234.5), "1234.5");
    assert_eq!(number_text(-0.0), "0");
    assert_eq!(number_text(1e21), "1000000000000000000000");
    assert_eq!(number_text(1.0 / 3.0), "0.333333333333333");
    assert_eq!(duration_text(1.5), "36:00:00");
    assert_eq!(duration_text(-0.5), "-12:00:00");
    assert_eq!(duration_text(1.0 / 86_400_000.0 * 250.0), "0:00:00.250");
    assert_eq!(Value::Bool(true).text(), "TRUE");
    assert_eq!(Value::Int(-7).text(), "-7");
}

#[test]
fn iso_dates_and_durations() {
    let stamp = |text| parse_iso(text).map(|stamp| stamp.iso());
    assert_eq!(stamp("2024-01-31"), Some("2024-01-31".into()));
    assert_eq!(
        stamp("2024-01-31T13:05:00"),
        Some("2024-01-31T13:05:00".into())
    );
    assert_eq!(
        stamp("2024-01-31 13:05"),
        Some("2024-01-31T13:05:00".into())
    );
    assert_eq!(
        stamp("2024-01-31T13:05:00.5Z"),
        Some("2024-01-31T13:05:00.500".into())
    );
    assert_eq!(
        stamp("2024-01-31T13:05:00+03:00"),
        Some("2024-01-31T13:05:00".into())
    );
    assert_eq!(stamp("13:05:30"), Some("13:05:30".into()));
    assert_eq!(stamp("2023-02-29"), None);
    assert_eq!(stamp("2024-13-01"), None);
    assert_eq!(stamp("13:05"), None);
    assert_eq!(stamp("2024-01-31x"), None);
    assert_eq!(stamp("İstanbul 2024"), None);
    assert_eq!(parse_iso_duration("PT36H15M00S"), Some(36.25 / 24.0));
    assert_eq!(parse_iso_duration("-P1DT12H"), Some(-1.5));
    assert_eq!(parse_iso_duration("P1W"), Some(7.0));
    assert_eq!(parse_iso_duration("PT"), None);
    assert_eq!(parse_iso_duration("12:00"), None);
}

#[test]
fn typing_csv_values() {
    assert_eq!(infer("42", '.'), Value::Int(42));
    assert_eq!(infer("-3.25", '.'), Value::Number(-3.25));
    assert_eq!(infer("3,25", ','), Value::Number(3.25));
    assert_eq!(infer("3.25", ','), Value::Text("3.25".into()));
    assert_eq!(infer("1,000", '.'), Value::Text("1,000".into()));
    assert_eq!(infer("0042", '.'), Value::Text("0042".into()));
    assert_eq!(infer("0.5", '.'), Value::Number(0.5));
    assert_eq!(infer("+5", '.'), Value::Text("+5".into()));
    assert_eq!(infer("1e400", '.'), Value::Text("1e400".into()));
    assert_eq!(infer("True", '.'), Value::Bool(true));
    assert_eq!(infer("NaN", '.'), Value::Text("NaN".into()));
}

#[test]
fn sheet_names_excel_accepts() {
    let mut used = std::collections::HashSet::new();
    let mut name = |text: &str| write::sheet_name(text, &mut used);
    assert_eq!(name("Satış [2024]: Q1/Q2?"), "Satış _2024__ Q1_Q2_");
    assert_eq!(name("satış [2024]: q1/q2?"), "satış _2024__ q1_q2_ (2)");
    assert_eq!(name("'quoted'"), "quoted");
    assert_eq!(name(""), "Sheet");
    assert_eq!(name("History"), "History (2)");
    let long = name(&"ğ".repeat(40));
    assert_eq!(long.chars().count(), 31);
    let again = name(&"ğ".repeat(40));
    assert_eq!(again, format!("{} (2)", "ğ".repeat(27)));
}

#[test]
fn cell_budget() {
    let mut budget = read::Budget(2);
    assert!(budget.take().is_ok());
    assert!(budget.take().is_ok());
    assert!(matches!(budget.take(), Err(Error::Limit(_))));
}

#[test]
fn printed_numbers_from_pdf_tables() {
    let comma = decimal_of(["1.234,50", "7", "Total", "3,5"].into_iter());
    assert_eq!(comma, ',');
    // A part of three digits could be a thousands group, so it decides nothing.
    assert_eq!(decimal_of(["1,234", "2,500"].into_iter()), '.');
    assert_eq!(decimal_of(["0.25", "1,234"].into_iter()), '.');

    assert_eq!(printed("1,234,567.89", '.'), Value::Number(1_234_567.89));
    assert_eq!(printed("1.234.567,89", ','), Value::Number(1_234_567.89));
    assert_eq!(printed("1 234", '.'), Value::Int(1234));
    assert_eq!(printed("(1,200)", '.'), Value::Int(-1200));
    assert_eq!(printed("\u{2212}3.5", '.'), Value::Number(-3.5));
    assert_eq!(printed(" 42 ", '.'), Value::Int(42));
    // Not numbers as printed: uneven groups, two kinds of separator, codes with leading zeros.
    assert_eq!(printed("12,34,567", '.'), Value::Text("12,34,567".into()));
    assert_eq!(printed("1,234 567", '.'), Value::Text("1,234 567".into()));
    assert_eq!(printed("007", '.'), Value::Text("007".into()));
    assert_eq!(printed("(note)", '.'), Value::Text("(note)".into()));
    assert_eq!(printed("Kiwi ğüş", '.'), Value::Text("Kiwi ğüş".into()));
    assert!(matches!(printed("2026-11-02", '.'), Value::Date(_)));
}
