# Roadmap

Progress against [SPEC.md](SPEC.md) section 9.

## Phase 0: design

- [x] Repository skeleton: `docs/SPEC.md`, `docs/ROADMAP.md`, `docs/IDEAS.md`, `LICENSE`
- [x] Visual identity: the steel safe dial (the default theme)
- [x] Name: Kento
- [x] Design system (`design/DESIGN.md`): design tokens, component rules, animation timings, sound rules
- [x] App icon (`design/icons/`)

## Phase 1: skeleton

- [x] Tauri 2 + React/TS project, settings, design tokens
- [x] Pluggable theme system with the default steel safe-dial theme only (SPEC 5.20)
- [x] Translation infrastructure (EN + TR), RTL infrastructure, pseudo-localization (`en-XA`) and pseudo-RTL (`ar-XB`) test languages
- [x] Main window shell (Home, Library, Settings; Mica on Windows 11)
- [x] Catalog skeleton (formats, routes, tools, actions; `docs/FORMATS.md`, `website-kit/catalog.json`), job queue, naming rules, logging
- [x] Single instance and tray icon
- [x] Shelf interface (`ShelfProvider`)
- [x] CI (Windows and macOS, cargo-deny, Dependabot), license checks, SPDX headers, `kento --smoke-test`

## Phase 2: core local engines

- [x] Engines crate (`src-tauri/engines`) and the pinned PDFium download
- [x] Image conversions, with ICO [+] and HEIC through the system
- [x] PDF tools: merge, split, edit, PDF from images, PDF to images and text
- [x] Archive extraction and creation, with 7Z [+]
- [x] QR reading
- [x] Text, subtitle and spreadsheet conversions (spreadsheets without an office suite)
- [x] In-app wheel (the steel safe dial), drop zone, paste, Library and success card
- [x] Batch conversion [+]

## Phase 3: global wheel and desktop integration

- [x] Drag + modifier detection on Windows
- [x] Drag + modifier detection on macOS (built and unit-tested in CI; checked on a Mac later)
- [x] The three wheels and file actions, in the main window and floating over other apps
- [x] Shelf model: Kento's own shelf, no link to Pano (SPEC 5.8)
- [x] The shelf: its own window, history, search, dragging files out, "keep a copy"
- [x] Selection shortcut [+], Send To and the context menu [+] (Windows)
- [x] Sounds and haptics
- [x] Result card in a corner for jobs started outside the main window

## Phase 4: media

- [x] Tool setup wizard: the Media group (pinned FFmpeg downloads, resumed and checked by SHA-256); Office and Extras arrive with their phases
- [x] FFmpeg conversions, with M4A and WAV from video [+]
- [x] The 13 video and audio tools and their editors (shared player, timeline and keys, SPEC 5.6)
- [x] Proxy preview, waveform, real progress
- [x] HEIC through FFmpeg where the system cannot read it
- [x] Wheel slices that need a missing tool open the setup
- [x] Settings › Tools: each tool's state, version and path; choosing a program, verifying again, updating and removing Kento's download

## Phase 5: image editors and metadata

- [ ] Edit image, Mark up, Add frame, Crop, Collage, Redact image
- [ ] Metadata with ExifTool
- [ ] Compress tool (including target size)

## Phase 6: office

- [ ] Document, spreadsheet and presentation conversions with LibreOffice
- [ ] PDF to other formats
- [ ] Apple and macOS-specific input formats

## Phase 7: web download

- [ ] yt-dlp + Deno
- [ ] Ctrl+Shift+D and dragging from browsers
- [ ] Site-specific flows
- [ ] Independent yt-dlp updates

## Phase 8: automation and enhancements

- [ ] Folder automation, recipes, window layouts
- [ ] Background removal, OCR, QR generation, subtitle burn-in, CLI

## Phase 9: release readiness (v1.0)

- [ ] Mandatory updates and a signed `latest.json`
- [ ] NSIS installer, portable ZIP and universal DMG
- [ ] Fixed-name assets, SHA256SUMS and old-release cleanup
- [ ] README (EN/TR), repository documents, notices file
- [ ] Website kit, demo video script, `--smoke-test`
- [ ] Release checklist

## Phase 10: growth

- [ ] The remaining 10 languages, each checked with screenshots
- [ ] Web playground
- [ ] WinGet and Homebrew
- [ ] Modern Windows 11 context menu
- [ ] Touch support and ARM64
- [ ] More themes (SPEC 5.20)
- [ ] After v1.0 has users: apply to the SignPath Foundation's free code-signing program
