// SPDX-License-Identifier: MIT
//! Updates as the portable copy receives them (SPEC 5.16): a key pair made for the test, a ZIP
//! signed the way `tauri signer sign --app-version` signs the release's, and the updater plugin set
//! up from tauri.conf.json in a mock app, with the test key in place of the release key. Only a ZIP
//! signed with that key for the version latest.json announces may change Kento's files.

use std::fs;
use std::io::{Cursor, Write};
use std::path::Path;

use base64::Engine;
use kento_lib::updates::{self, Kind};
use serde_json::json;
use tauri_plugin_updater::Update;

/// A key pair made in a folder of its own, kept in the files `tauri signer generate` writes.
struct Signer {
    pair: minisign::KeyPair,
    /// The public key as tauri.conf.json carries it: the key file, in base64.
    pubkey: String,
    _keys: tempfile::TempDir,
}

impl Signer {
    fn new() -> Self {
        let keys = tempfile::tempdir().unwrap();
        let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        let public = keys.path().join("kento-test.key.pub");
        fs::write(&public, pair.pk.to_box().unwrap().to_string()).unwrap();
        fs::write(
            keys.path().join("kento-test.key"),
            pair.sk.to_box(None).unwrap().to_string(),
        )
        .unwrap();
        let pubkey = base64(fs::read_to_string(public).unwrap().as_bytes());
        Self {
            pair,
            pubkey,
            _keys: keys,
        }
    }

    /// A signature that names the version it was made for, in base64 as latest.json holds it.
    fn sign(&self, bytes: &[u8], version: &str) -> String {
        let trusted =
            format!("timestamp:1793000000\tfile:Kento-Windows-x64-Portable.zip\tversion:{version}");
        let signature = minisign::sign(
            Some(&self.pair.pk),
            &self.pair.sk,
            Cursor::new(bytes),
            Some(&trusted),
            Some("signature from tauri secret key"),
        )
        .unwrap();
        base64(signature.to_string().as_bytes())
    }
}

fn base64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn zip_of(files: &[(&str, &str)]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, body) in files {
        zip.start_file(*name, options).unwrap();
        zip.write_all(body.as_bytes()).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

/// What the portable copy finds in a latest.json that offers `version` with `signature`, through
/// the updater configured as tauri.conf.json configures it.
fn found(signer: &Signer, version: &str, signature: String) -> Update {
    let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let mut block = conf["plugins"]["updater"].clone();
    block["pubkey"] = signer.pubkey.clone().into();
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".into(), block);
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let download = "https://github.com/MehmetBurakTaskaya/kento/releases/latest/download";
    let latest = json!({
        "version": version,
        "notes": "Yenilikler\n- Daha hızlı dönüştürme",
        "pub_date": "2026-11-02T12:00:00Z",
        "platforms": {
            "windows-x86_64": {
                "url": format!("{download}/Kento-Windows-x64-Update.exe"),
                "signature": "the installer's, never the portable copy's"
            },
            "windows-x86_64-portable": {
                "url": format!("{download}/Kento-Windows-x64-Portable.zip"),
                "signature": signature
            }
        }
    });
    updates::updater(app.handle(), Kind::Portable)
        .build()
        .unwrap()
        .restore_update(latest)
        .unwrap()
        .expect("newer than the mock app's 0.1.0")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

#[test]
fn only_a_zip_signed_with_the_update_key_for_its_version_installs() {
    let signer = Signer::new();
    let zip = zip_of(&[
        ("kento.com", "new command line"),
        ("pdfium/pdfium.dll", "new pdfium"),
        ("Kento.exe", "new program"),
    ]);
    let folder = tempfile::tempdir().unwrap();
    let dir = folder.path().join("Kento ğüşıöç 🧪");
    fs::create_dir(&dir).unwrap();
    let exe = dir.join("Kento.exe");
    fs::write(&exe, "old program").unwrap();
    fs::write(dir.join("kento.com"), "old command line").unwrap();
    let unchanged = || {
        assert_eq!(read(&exe), "old program");
        assert_eq!(read(&dir.join("kento.com")), "old command line");
        assert!(!dir.join("Kento.old").exists());
        assert!(!dir.join("pdfium").exists());
    };

    // Changed after it was signed.
    let update = found(&signer, "1.2.0", signer.sign(&zip, "1.2.0"));
    let mut forged = zip.clone();
    let middle = forged.len() / 2;
    forged[middle] ^= 0x55;
    assert!(updates::install_portable(&update, &forged, &exe).is_err());
    unchanged();

    // A genuine older release offered as a newer one.
    let update = found(&signer, "1.2.0", signer.sign(&zip, "1.1.0"));
    let err = updates::install_portable(&update, &zip, &exe).unwrap_err();
    assert!(err.contains("signed for version 1.1.0"), "{err}");
    unchanged();

    // Signed with a key that is not Kento's.
    let stranger = Signer::new();
    let update = found(&signer, "1.2.0", stranger.sign(&zip, "1.2.0"));
    assert!(updates::install_portable(&update, &zip, &exe).is_err());
    unchanged();

    // The real thing: its own entry of latest.json, its notes, and the files swapped.
    let update = found(&signer, "1.2.0", signer.sign(&zip, "1.2.0"));
    assert_eq!(update.target, "windows-x86_64-portable");
    assert_eq!(
        update.body.as_deref(),
        Some("Yenilikler\n- Daha hızlı dönüştürme")
    );
    let leftovers = updates::install_portable(&update, &zip, &exe).unwrap();
    assert_eq!(leftovers, vec![dir.join("Kento.old")]);
    assert_eq!(read(&exe), "new program");
    assert_eq!(read(&dir.join("Kento.old")), "old program");
    assert_eq!(read(&dir.join("kento.com")), "new command line");
    assert_eq!(read(&dir.join("pdfium").join("pdfium.dll")), "new pdfium");
}
