# Architecture

Kento is a Tauri 2 app: a Rust core (`src-tauri/`) with its local engines (`src-tauri/engines/`) and a React + TypeScript page (`src/`) in one window per surface. This file describes the code as it stands; the plan is in [SPEC.md](SPEC.md) and the progress in [ROADMAP.md](ROADMAP.md).

## Engines (`src-tauri/engines`, crate `kento-engines`)

Every conversion and tool. Only `media/` and image metadata need something outside Kento (FFmpeg and ExifTool, downloaded on request); the rest runs as it is. The crate knows nothing about windows, settings or the queue: it gets claimed paths, options and a progress handle, and runs on a blocking thread. Its tests run without the app (`cargo test -p kento-engines`).

| Module | Role |
| --- | --- |
| `image/` | Image inputs to image outputs and PDF; AVIF decoding in pure Rust; HEIC through the system (WIC on Windows, ImageIO on macOS) |
| `pdf/` | PDF pages to images, text and Markdown on the bundled PDFium; merge, split, edit and PDF from images on `lopdf` |
| `archive/` | ZIP, TAR, GZ, RAR (read only) and 7Z: conversion entry by entry, and extraction with path, link, count and size checks |
| `text.rs`, `subtitle.rs`, `sheet.rs` | TXT, MD and HTML; SRT and VTT; CSV, TSV, XLS, XLSX and ODS without an office suite |
| `qr.rs`, `thumb.rs` | Reading QR codes in images and PDF pages; small previews |
| `media/` | Video and audio through FFmpeg and ffprobe: conversions, the 13 media tools, probing, proxy previews, waveform peaks and frames, and HEIC where the system cannot read it |
| `image/tools/` | The six image editors (edit, crop, mark up, frame, collage, redact): one code path for the live preview at any scale and the full-size result |
| `compress.rs` | Compress: one entry that hands images to `image/compress.rs`, video and audio to `media/compress.rs` and PDF to `pdf/compress.rs` |
| `metadata/` | Metadata: images through ExifTool, PDF through lopdf, video and audio through ffprobe and FFmpeg (tags and chapters) |

## Rust core (`src-tauri/src`)

| Module | Role |
| --- | --- |
| `lib.rs` | Starts the app: plugins, state, tray, the main window; keeps running in the tray when the window closes |
| `catalog/` | Every format, conversion route, tool and file action (SPEC 5.1). `export.rs` writes `docs/FORMATS.md` and `website-kit/catalog.json` (`npm run catalog:export`; CI checks they are current) |
| `jobs/` | The job queue: light jobs side by side up to a limit, heavy jobs one at a time, cancellation, pausing, progress events. `naming.rs`: output names and safe writing for files and folders; `engine.rs`: a job that runs an engine under a claimed name with its own scratch folder |
| `work.rs`, `tools.rs` | The Convert and Tools wheels' contents for a selection, conversions (one job per file) and the core tools; slices that need a missing tool open the setup |
| `toolchain/` | The optional tools (SPEC 4.2): finding them (a path set in Settings, PATH and the usual install folders, Kento's own folder), the pinned downloads of `toolchain.lock.json`, resumable downloading, the SHA-256 check and unpacking only the named binaries and folders |
| `media.rs` | The media commands: probing, previews (proxy files in the temp folder), waveform peaks, frames and the media tools' jobs |
| `images.rs`, `compress.rs`, `metadata.rs` | The image editors' size and preview commands (with a small cache of decoded pictures) and their jobs; Compress, one job per file; Metadata's read and its job |
| `files.rs`, `library.rs` | Choosing and pasting files, previews, and the Library (`library.json`, the last 50 outputs) |
| `settings.rs` | Settings as JSON in the data folder; broken files are kept aside, values are clamped |
| `i18n.rs` | The languages, system-language matching, and the strings Rust shows (tray menu) |
| `shelf/` | Kento's own shelf (SPEC 5.8): references, history, "keep a copy", in `shelf.json` |
| `overlay/` | The windows over other apps: the floating wheel (`wheel.rs`: the drag session and click mode), the shelf window and the result card. They hide by moving off screen |
| `platform/` | What the system provides: drags seen anywhere and the modifiers held, the Explorer or Finder selection, sharing, a terminal, Send To and the context menu; `windows/` and `macos/` |
| `actions.rs`, `shortcut.rs` | The file actions wheel; the selection shortcut |
| `paths.rs`, `logging.rs` | The data folder (`%LOCALAPPDATA%\Kento`, `~/Library/Application Support/Kento`), temp clean-up, rolling logs |
| `window.rs`, `tray.rs` | The main window (built on demand, Mica on Windows 11) and the tray or menu bar icon |
| `commands.rs` | What the page may call; links and folders are decided in Rust, never taken from the page as they are |
| `smoke.rs` | `kento --smoke-test`: a hidden run that checks the parts that exist and writes `smoke-test.json` |

## Page (`src`)

| Folder | Role |
| --- | --- |
| `app/` | The window's shell (navigation rail) and its pages: Home, Library, Settings (with the tools' state); file input (drop, Ctrl+O, Ctrl+V), the wheel's host and the tool setup |
| `wheel/` | The steel safe-dial wheel: drawing, hit-testing, keyboard, motion and synthesized sounds |
| `tools/` | The panels of the tools that need choices: Merge PDFs, Split PDF, Edit PDF, PDF from images, Read QR codes, Compress, Metadata |
| `editors/` | The media editors: one player, timeline and waveform shared by the video and audio tools, with the keys of SPEC 5.6; `editors/image/`: the image editors, a zoomable stage with the engine's preview, mark up drawn as SVG with undo |
| `components/` | Icons, file previews, the dialog and the cards in the corner |
| `i18n/` | i18next with ICU messages from `/locales`, right-to-left switching, the pseudo-languages `en-XA` and `ar-XB`, and language-aware formatting and search |
| `theme/` | Themes as plug-ins (`registry.ts`); the default steel theme (`steel.ts`, values from `design/DESIGN.md`) |
| `state/` | The page's store (Zustand) |
| `ipc.ts` | The only door to the core; in a plain browser it answers from memory, so `npm run dev` and the screenshot script work without the app |

Strings live in `/locales/*.json` and are shared by both sides. Layout uses CSS logical properties only, so right-to-left needs no separate rules.

## Decisions

1. **Own settings file instead of the store plugin.** A small, versioned JSON file with clamping and a kept-aside copy of a broken file is easier to test and to migrate.
2. **`tracing` for logs.** Rolling daily files, seven kept; the page logs through a command that shortens its text. No file contents are ever logged.
3. **The main window is destroyed on close and built again from the tray.** Kento waits in the tray with little memory, and Mica is applied once per window, never toggled by hiding and showing.
4. **Windows are built from their own thread.** WebView2 cannot finish setting up a webview while the main thread waits in a command or an event handler.
5. **Links and folders through Rust commands.** The page has only the `core:event:default` permission; there is no opener or file system access from the page.
6. **Pseudo-language codes `en-XA` and `ar-XB`.** i18next rewrites codes such as `qps-ploc` to `qps-Ploc`, so the private-use region codes known from Android are used. Development builds accept them as a setting.
7. **Plugins only when their phase needs them.** Phase 1 uses single instance, autostart, opener and dialog; the global shortcut, updater, deep links, clipboard and notifications arrive with their features.
8. **Engines in their own crate.** The heavy format libraries build and test without the webview, and the CLI (Phase 8) can use them as they are.
9. **PDFium ships inside Kento.** `npm run pdfium` fetches one pinned build of the pdfium-binaries project, checks its SHA-256 and puts it in `src-tauri/resources/pdfium` (not committed); the installer bundles it and the app loads it at start. Every PDFium call goes through one lock, because PDFium is not thread-safe.
10. **No assembler in the build.** AV1 decoding (`rav1d`) and encoding (`ravif`) run without their assembly code, so building needs no NASM; AVIF pictures are small, so the speed is enough.
11. **HEIC through the system.** Windows decodes HEIC with the HEIF Image Extensions through WIC and macOS with ImageIO; without them the job explains what to install.
12. **Unwinding panics in release builds.** A parser that panics on a malformed file ends that job with an error; Kento keeps running.
13. **Encrypted PDFs are refused,** also those with only an owner password, so Kento never drops a document's restrictions.
14. **RAR through UnRAR's test mode.** The library streams each entry to Kento and never writes files or links itself; extraction then applies Kento's own path and size checks.
15. **The clipboard is read only on paste.** Files come from the system clipboard (CF_HDROP on Windows, the pasteboard on macOS); text and images from the paste event. Imports go to the output folder, or Downloads/Kento.
16. **The page opens only what Kento wrote.** Opening and showing go through Library ids, so the page cannot launch arbitrary files.
17. **The floating wheel waits off screen.** Its window is defined in `tauri.conf.json`, visible from the start and parked at -20000, so WebView2 has registered it as a drop target before the first drag; showing it is a move to the pointer. It never takes the focus during a drag, which would break the source app's drag loop.
18. **Drags are seen by polling, not hooks.** A thread reads the button, the pointer and the modifiers (and the drag pasteboard on macOS): every 40 ms while the button is up, every 10 ms while it is down. No keyboard hook, no Accessibility or Input Monitoring permission.
19. **The drag tells the files.** The wheel learns what is dragged when the drag enters its window; a drag of text or a link closes it silently. Because a drop ends the drag, a category of a mixed selection opens its ring when the pointer rests on it, and resting on the hub goes back.
20. **Explorer integration stays off until switched on.** Send To and the context menu write only under the user's profile (HKCU); Explorer may start Kento once per file, and launches within 400 ms join one wheel.
21. **Tools on the computer come first.** A path set in Settings, then PATH and the usual install folders (WinGet links, Homebrew), then Kento's own download. Each candidate is run once and must report a version Kento drives (FFmpeg 6, ExifTool 12 or newer); anything else is ignored. A program is chosen in the system's file dialog, so the page can never name one for Kento to run.
22. **Only pinned files are downloaded.** `toolchain.lock.json` is built into the app with each file's URL (HTTPS), size and SHA-256. A download resumes with a Range request, is checked before anything is unpacked, and only the binaries and folders the lockfile names are taken out, under names Kento chooses (ExifTool's Windows program needs its `exiftool_files` folder, the Perl version its `lib` folder). Each version gets its own folder, so an update never touches a working install.
23. **One Intel build on every Mac for now.** No static Apple silicon build with fixed, checkable release files was pinned yet, so Apple silicon runs the Intel build through Rosetta 2, which macOS offers to install on first use.
24. **FFmpeg runs as a separate process.** Arguments go as arrays, paths are anchored so that FFmpeg never reads them as options or protocols, no console window opens on Windows, progress comes from `-progress`, and cancelling ends the process together with anything it started (on Windows through a job object, because package-manager shims start the real FFmpeg as a child). Builds without libvorbis or libopus, such as Homebrew's, use FFmpeg's own encoders for those formats. Kento's code and FFmpeg's GPL code never link.
25. **Previews play the original when the webview can.** Otherwise FFmpeg writes a small H.264 proxy into the temp folder (named by the source's path, size and time, reused until it changes). The asset protocol starts with an empty scope; each previewed file or proxy is allowed one by one. Exports always read the original.
26. **HEIC falls back to FFmpeg.** Where the system cannot decode HEIC (Windows without the HEIF Image Extensions), FFmpeg 7.1 or newer turns the photo into PNG in memory, tiles and turn included; an older FFmpeg would give one tile as the photo, so it is not used for this.
27. **Previews come from the engine.** The image editors ask for a PNG of the tool applied to a scaled-down copy; the engine runs the same steps as for the result, with every coordinate scaled, so what the editor shows is what gets written. Decoded copies are kept for the next request, so sliders redraw quickly. The page draws only what follows the pointer (crop and redact areas, marks).
28. **Mark up is SVG on both sides.** The page draws the marks as SVG over the picture; the engine builds the same SVG from the same marks, with the same rules (strokes, arrow heads, a group opacity per mark, text in the system's sans-serif) and renders it with resvg. Marks are data, never markup from the page, so nothing can point the renderer at a file.
29. **Compress keeps the format and never writes a larger file.** Pictures search the encoder quality and then the size; video and audio get a bit rate from the duration, two passes and smaller frame sizes when bits run short; PDF stores its pictures again as smaller JPEGs. A result that is not smaller, or not under the target, is deleted and the job says so.
30. **ExifTool through an argument file.** Every argument goes in a UTF-8 file read from standard input with `-charset filename=utf8`, so Turkish and emoji paths and values survive the Windows command line; ExifTool writes a new file in the job's folder, which then moves to its name. PDF metadata is rewritten in full by lopdf (ExifTool's PDF edits are incremental and can be undone), and video and audio tags by FFmpeg with the streams copied.

## Checks

`npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:i18n`, `npm run check:spdx`, `npm run check:licenses`, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace` (PDF tests need the fetched PDFium, media tests FFmpeg, image metadata tests ExifTool; CI installs both and sets `KENTO_REQUIRE_FFMPEG=1` and `KENTO_REQUIRE_EXIFTOOL=1`), the catalog check and `cargo deny` run in CI on Windows and macOS (`.github/workflows/ci.yml`), followed by a release build and the smoke test. `npm run shots` takes screenshots of the pages in English, Turkish and both pseudo-languages.
