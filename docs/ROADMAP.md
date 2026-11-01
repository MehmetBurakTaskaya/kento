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
- [x] `ShelfProvider` interface (local shelf, Pano bridge)
- [x] CI (Windows and macOS, cargo-deny, Dependabot), license checks, SPDX headers, `kento --smoke-test`

## Phase 2: core local engines

- [ ] Image conversions
- [ ] PDF tools: merge, split, edit, PDF from images, PDF to images
- [ ] Archive extraction and creation
- [ ] QR reading
- [ ] Text, subtitle and spreadsheet conversions
- [ ] In-app wheel, drop zone, paste, Library and success card

## Phase 3: global wheel and desktop integration

- [ ] Drag + modifier detection on Windows
- [ ] Drag + modifier detection on macOS
- [ ] The three wheels and file actions
- [ ] The shelf (SPEC 5.8)
- [ ] Selection shortcut, Send To and context menu
- [ ] Sounds and haptics

## Phase 4: media

- [ ] Tool setup wizard
- [ ] FFmpeg conversions and the 15 media tools
- [ ] Proxy preview, waveform, real progress

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
