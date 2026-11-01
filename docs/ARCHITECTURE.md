# Architecture

Kento is a Tauri 2 app: a Rust core (`src-tauri/`) with its local engines (`src-tauri/engines/`) and a React + TypeScript page (`src/`) in one window per surface. This file describes the code as it stands; the plan is in [SPEC.md](SPEC.md) and the progress in [ROADMAP.md](ROADMAP.md).

## Engines (`src-tauri/engines`, crate `kento-engines`)

Every conversion and tool that needs no download. The crate knows nothing about windows, settings or the queue: it gets claimed paths, options and a progress handle, and runs on a blocking thread. Its tests run without the app (`cargo test -p kento-engines`).

| Module | Role |
| --- | --- |
| `image/` | Image inputs to image outputs and PDF; AVIF decoding in pure Rust; HEIC through the system (WIC on Windows, ImageIO on macOS) |
| `pdf/` | PDF pages to images, text and Markdown on the bundled PDFium; merge, split, edit and PDF from images on `lopdf` |
| `archive/` | ZIP, TAR, GZ, RAR (read only) and 7Z: conversion entry by entry, and extraction with path, link, count and size checks |
| `text.rs`, `subtitle.rs`, `sheet.rs` | TXT, MD and HTML; SRT and VTT; CSV, TSV, XLS, XLSX and ODS without an office suite |
| `qr.rs`, `thumb.rs` | Reading QR codes in images and PDF pages; small previews |

## Rust core (`src-tauri/src`)

| Module | Role |
| --- | --- |
| `lib.rs` | Starts the app: plugins, state, tray, the main window; keeps running in the tray when the window closes |
| `catalog/` | Every format, conversion route, tool and file action (SPEC 5.1). `export.rs` writes `docs/FORMATS.md` and `website-kit/catalog.json` (`npm run catalog:export`; CI checks they are current) |
| `jobs/` | The job queue: light jobs side by side up to a limit, heavy jobs one at a time, cancellation, pausing, progress events. `naming.rs`: output names and safe writing for files and folders; `engine.rs`: a job that runs an engine under a claimed name with its own scratch folder |
| `work.rs`, `tools.rs` | The Convert and Tools wheels' contents for a selection, conversions (one job per file) and the core tools |
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
| `app/` | The window's shell (navigation rail) and its pages: Home, Library, Settings; file input (drop, Ctrl+O, Ctrl+V) and the wheel's host |
| `wheel/` | The steel safe-dial wheel: drawing, hit-testing, keyboard, motion and synthesized sounds |
| `tools/` | The panels of the tools that need choices: Merge PDFs, Split PDF, Edit PDF, PDF from images, Read QR codes |
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

## Checks

`npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:i18n`, `npm run check:spdx`, `npm run check:licenses`, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace` (PDF tests need the fetched PDFium), the catalog check and `cargo deny` run in CI on Windows and macOS (`.github/workflows/ci.yml`), followed by a release build and the smoke test. `npm run shots` takes screenshots of the pages in English, Turkish and both pseudo-languages.
