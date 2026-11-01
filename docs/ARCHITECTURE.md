# Architecture

Kento is a Tauri 2 app: a Rust core (`src-tauri/`) and a React + TypeScript page (`src/`) in one window per surface. This file describes the code as it stands; the plan is in [SPEC.md](SPEC.md) and the progress in [ROADMAP.md](ROADMAP.md).

## Rust core (`src-tauri/src`)

| Module | Role |
| --- | --- |
| `lib.rs` | Starts the app: plugins, state, tray, the main window; keeps running in the tray when the window closes |
| `catalog/` | Every format, conversion route, tool and file action (SPEC 5.1). `export.rs` writes `docs/FORMATS.md` and `website-kit/catalog.json` (`npm run catalog:export`; CI checks they are current) |
| `jobs/` | The job queue: light jobs side by side up to a limit, heavy jobs one at a time, cancellation, pausing, progress events. `naming.rs`: output names and safe writing |
| `settings.rs` | Settings as JSON in the data folder; broken files are kept aside, values are clamped |
| `i18n.rs` | The languages, system-language matching, and the strings Rust shows (tray menu) |
| `shelf/` | `ShelfProvider` with the local shelf and the Pano bridge (SPEC 5.8) |
| `paths.rs`, `logging.rs` | The data folder (`%LOCALAPPDATA%\Kento`, `~/Library/Application Support/Kento`), temp clean-up, rolling logs |
| `window.rs`, `tray.rs` | The main window (built on demand, Mica on Windows 11) and the tray or menu bar icon |
| `commands.rs` | What the page may call; links and folders are decided in Rust, never taken from the page as they are |
| `smoke.rs` | `kento --smoke-test`: a hidden run that checks the parts that exist and writes `smoke-test.json` |

## Page (`src`)

| Folder | Role |
| --- | --- |
| `app/` | The window's shell (navigation rail) and its pages: Home, Library, Settings |
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

## Checks

`npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:i18n`, `npm run check:spdx`, `npm run check:licenses`, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, the catalog check and `cargo deny` run in CI on Windows and macOS (`.github/workflows/ci.yml`), followed by a release build and the smoke test. `npm run shots` takes screenshots of the pages in English, Turkish and both pseudo-languages.
