# Kento

**By [Mehmet Burak Taşkaya](https://mehmetburaktaskaya.com)** · [Türkçe](README.tr.md)

Drag a file, press a modifier key, and drop it on a slice of the wheel: Kento converts, compresses and edits the file on your own computer. Windows first, macOS too.

> Kento is in early development: Phase 1 of 10, the app's skeleton. There is no release yet. Progress is in [docs/ROADMAP.md](docs/ROADMAP.md).

## What it will do

- Convert images, video, audio, documents, spreadsheets, presentations, subtitles, PDFs and archives. The full list is generated from the app's catalog: [docs/FORMATS.md](docs/FORMATS.md).
- Tools on the same wheel: compress (also to a target size), crop, trim, merge, mark up, redact, edit metadata, read QR codes, PDF tools and more.
- File actions: share, copy, move, copy the path, open a terminal there, or put the file on a shelf.
- Never touch the original: every job writes a new copy with a name of its own.

## Privacy

Everything happens on your computer. Files are never uploaded, and there is no account, analytics or telemetry. Kento goes online only for tool and media downloads you start and to check for updates.

## Build from source

You need Node.js 24, the stable Rust toolchain (with the MSVC build tools on Windows) and WebView2, which Windows 10 and 11 already have.

```sh
npm ci
npm run pdfium           # the pinned PDFium library Kento ships with
npm run tauri dev        # run Kento with live reload
npm test                 # page tests
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

The design of the default theme is in [design/DESIGN.md](design/DESIGN.md), the specification in [docs/SPEC.md](docs/SPEC.md) and the code's structure in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE), copyright (c) 2026 Mehmet Burak Taşkaya. Third-party notices arrive with the first release.
