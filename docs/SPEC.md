# Kento: product and technical specification

Author: Mehmet Burak Taşkaya. Progress is tracked in `docs/ROADMAP.md`; the design system is `design/DESIGN.md`.

Items marked **[+]** are enhancements on top of the core feature set. Each one is reviewed when its phase starts and may be dropped.

## 0. Overview

Kento is a free, open-source desktop app by Mehmet Burak Taşkaya, published on GitHub and presented on [mehmetburaktaskaya.com](https://mehmetburaktaskaya.com).

The core interaction: while dragging a file in File Explorer, Finder or another app, the user presses a modifier key (Shift, Ctrl, Alt…). A circular wheel opens under the pointer. Dropping the file on a slice runs the action at once, entirely on the device:

- format conversion
- compress, crop, trim, merge
- PDF operations
- metadata editing
- QR reading
- file actions: share, copy, move, copy path, open in terminal, put on the shelf

The app also has a main window (Home and Library), a shelf, media and image editors, web media download and folder automation.

**Platforms.** Windows is first-class: Windows 10 1809+ and Windows 11, x64 (ARM64 later). macOS is fully supported as a universal build (Intel and Apple silicon). Every feature is made solid on Windows first, then brought to macOS. The architecture is designed for both platforms from the start.

**Languages.**

- Code, comments, commit messages, issues, pull requests and technical documents are in English.
- The README is bilingual: `README.md` (English) and `README.tr.md` (Turkish).
- The interface ships in 12 languages: English, Spanish, Chinese (Simplified), Japanese, German, French, Portuguese (Brazil), Arabic (right to left), Korean, Italian, Russian and Turkish.
- The app follows the system language; the user can pick another one in Settings → Language.
- English and Turkish exist from the first release; the other ten arrive in Phase 10. The translation and right-to-left infrastructure is built in Phase 1, because adding it later is expensive.
- No interface string is hard-coded; every string lives in the translation files. Details in 5.19.

## 1. Originality and clean-room rules

The idea is inspired by existing apps that convert files through a "drag + modifier key + radial menu" interaction. Ideas and interaction patterns are free to use; the code, artwork, text and brand of Kento are entirely its own.

- Contributors do not open, read, clone or copy the source code of similar apps, and do not browse their repositories or websites for reference. This specification is the reference. For how to do something, use official documentation: Tauri, Rust crate docs, Microsoft Learn, Apple Developer, FFmpeg, LibreOffice, yt-dlp.
- No other app's name, logo, icons, illustrations, color palette, marketing copy or screenshots are used or imitated. The brand and the default theme use no fruit motifs, which would look derivative. Optional themes (5.20) may take any subject, fruits included, as long as their artwork imitates no existing app.
- Name, logo, icon set, palette, typography, sounds and all copy are our own (see `design/DESIGN.md`).
- Fonts are openly licensed (OFL or similar) and embedded in the app.
- Sounds are synthesized in code or CC0-licensed.
- Marketing copy makes no "first", "only" or "we invented" claims. Kento does not claim to have invented the interaction; it is our own take on it.
- Ownership is visible everywhere:
  - `LICENSE`: MIT, Copyright (c) 2026 Mehmet Burak Taşkaya
  - every source file starts with `SPDX-License-Identifier: MIT`
  - app identifier: `com.mehmetburaktaskaya.kento`
  - installer publisher: Mehmet Burak Taşkaya
  - About window: name, version, "Made by Mehmet Burak Taşkaya", website and GitHub links
  - top of the README: an author section and the website link
- Third-party licenses are fully complied with (see 4.4).

## 2. Product principles

- **Local first.** Conversion and editing happen entirely on the device. No file is uploaded to a cloud.
- **Privacy.**
  - No analytics, telemetry, accounts or subscriptions.
  - No import of browser cookies.
  - No background clipboard monitoring.
  - The app goes online only for user-started tool downloads, update checks and user-started web downloads.
  - The README and Settings say this plainly.
- **Never touch the original.** Every job creates a new copy and never overwrites an existing file. The only exception is the Move action, chosen explicitly by the user.
- **Keyboard first-class.** Everything works with the mouse and with the keyboard.
- **Fast and light.**
  - The wheel opens in under 100 ms.
  - CPU use is close to zero when idle.
  - The installer is small; large tools are downloaded later, on request.
- **Completely free.** No paid services, APIs or dependencies.
- **Extensible.** Adding a tool or conversion means adding a catalog entry and a handler (see 5.1).

## 3. Visual identity

The wheel is a brushed-steel safe combination dial in look, motion and sound: a knurled steel dial around a white enamel face, a vault handle at the hub, and locking bolts that are thrown when an action is applied. Grey steel, white enamel, black engraving and one tempered-blue accent.

`design/DESIGN.md` is the design system: design tokens, component rules, animation timings and sound rules. The app icon is drawn from `design/icons/`. Fifty other themes can be chosen (5.20); the name and the app icon stay the same in every theme.

The name is **Kento**: short, said in one breath, the same in Turkish and English. Name searches are not trademark clearance; a trademark search comes before the first release.

## 4. Technology stack

### 4.1 Main stack

Core:

- Tauri 2 + Rust (the same stack as the author's Pano app, Panopin).
- Frontend: React + TypeScript + Vite.
- State: Zustand. Translation: i18next (ICU format).
- Styling: design tokens as CSS custom properties.
- Editors: plain SVG and canvas in React (markup, crop and redact areas, waveforms). Previews and results are drawn by the Rust engines from the same steps, so the page needs no drawing library (Konva and wavesurfer.js were considered and left out).
- All free and MIT/BSD licensed.

Rust side (current versions are verified when added; a better option is proposed with reasons):

- Tauri plugins: global-shortcut, updater, dialog, fs, store, single-instance, autostart, clipboard-manager, deep-link, log, opener, notification.
- Dragging out of the app (shelf/library → Explorer/Finder): the `drag` crate (CrabNebula).
- Platform layer: the `windows` crate (Win32, COM, WinRT); on macOS `objc2`, `objc2-app-kit`, `objc2-foundation`.
- Images: `image`, `resvg`/`usvg` (SVG). AVIF is decoded in pure Rust (`avif-parse`, `rav1d`, `yuv`) and encoded with `ravif`, both without assembly code, so the build needs no assembler. Lossy WEBP through libwebp (`webp`). HEIC through the system:
  - macOS: ImageIO (read and write).
  - Windows: WIC with the free HEIF Image Extensions (read and write); without them the job says what to install. Where they are missing, FFmpeg reads HEIC once the media tools are installed. A bundled libheif was considered and left out: it would ship an LGPL library that WIC and FFmpeg make unnecessary.
  - Writing HEIC is offered only when a reliable encoder exists (a test encode at start).
- PDF:
  - `pdfium-render` + a bundled PDFium binary (bblanchon/pdfium-binaries, one pinned release checked by SHA-256, fetched by `npm run pdfium`): page rendering and text extraction. Every PDFium call goes through one lock.
  - `lopdf`: merge, split, rotate, reorder.
- Archives: `zip`, `tar`, `flate2`, `sevenz-rust2`. RAR is extract-only, through the UnRAR library (`unrar_sys`) in its test mode, so the library writes nothing itself and Kento applies its own path and size checks; the UnRAR license allows extraction only, which the notices file states.
- QR: `rxing` (read), `qrcode` (generate **[+]**).
- Spreadsheets without an office suite: `calamine` (read XLS, XLSX, ODS), `rust_xlsxwriter` (write XLSX), `csv`.
- Text: `pulldown-cmark`, `htmd`, `html2text`, `encoding_rs`, `plist` (TEXTCLIPPING).
- Other: `notify`, `tokio`, `serde`, `thiserror`, `tracing`, `reqwest` (with rustls; resumable downloads with Range), `sha2`, `ort` (ONNX Runtime, downloaded on request).

### 4.2 External tools

Downloaded on request at first setup, never bundled.

| Group | Contents |
| --- | --- |
| Media | FFmpeg + ffprobe (Windows: the gyan.dev "essentials" release build; macOS: the evermeet.cx static release builds for Intel, which Apple silicon runs through Rosetta 2 until a pinned arm64 build is added), yt-dlp (`yt-dlp.exe` / `yt-dlp_macos`), Deno (yt-dlp now needs a JavaScript runtime for YouTube) |
| Office | LibreOffice. On Windows the official MSI is unpacked with `msiexec /a` (administrative install) into the app data folder and used portably; on macOS it is taken from the DMG. An existing system install is used when present. |
| Extras | ExifTool (Windows: the official 64-bit package; macOS: the Perl distribution run by the system's Perl), ONNX Runtime (Microsoft's release builds, MIT) and the BEN2 Base background-removal model (MIT, published by its authors); each is installed only when it is missing |

Rules:

- **Pinned versions.** Each tool's version, URL, size and SHA-256 are pinned in `src-tauri/toolchain.lock.json`. A file that fails hash verification is never run.
- **Existing installs.** Tools already on the system (PATH or standard install locations) are detected and used. A path can also be set by hand in Settings. A found tool counts only when it runs and is recent enough (FFmpeg 6, ExifTool 12, LibreOffice 7, yt-dlp 2025.11.12, Deno 2.3 or newer). A group installs only the tools it is missing.
- **Platform security flags.** On macOS the `com.apple.quarantine` attribute is removed from verified tools, with an ad-hoc signature when needed. On Windows, Mark-of-the-Web and SmartScreen behavior is handled.
- **Process isolation.** Tools run as separate processes. Arguments are always passed as arrays, never as a shell string. GPL tools are therefore never combined with the app's code, and the app stays MIT.
- **yt-dlp updates.** yt-dlp has its own "Update yt-dlp" option, independent of app updates, with hash or signature verification.
- **Model licenses.** Background removal uses permissively licensed models only (for example U²-Net, Apache 2.0; BiRefNet, MIT). Non-commercial models such as BRIA RMBG are not used.

### 4.3 Repository layout (proposal)

```
/src-tauri/src
  catalog/      formats, routes, tools        ← the single source of truth
  jobs/         queue, progress, cancel, naming
  toolchain/    manifest, download, verify, detect
  platform/     traits + windows/ + macos/ (drag detection, selection, sharing, terminal, tray, window layouts)
  shelf/ library/ automation/ recipes/ settings/ updater/ cli/
/src-tauri/engines   the engines as their own crate: image, pdf, archive, text, subtitle, sheet, qr; later ffmpeg, libreoffice, ytdlp, exiftool, bgremove, ocr
/src            frontend: windows/{main,wheel,shelf,toast,editors}, components, locales/{en,tr,...}
/design         DESIGN.md, icons/
/docs           SPEC.md, ROADMAP.md, ARCHITECTURE.md, FORMATS.md (generated from the catalog), IDEAS.md
/scripts        fixture generation, catalog export, release helpers
/website-kit    download section for the author's website + catalog.json
/.github        workflows, issue and PR templates
```

### 4.4 Licenses

- App code: MIT.
- `THIRD-PARTY-NOTICES.md`, written by `npm run third-party` (`scripts/third-party.mjs`) from `src-tauri/Cargo.lock`, `package-lock.json`, `scripts/fetch-pdfium.mjs` and `src-tauri/toolchain.lock.json`, covers:
  - the Rust crates the Windows and macOS builds link and the npm packages of the interface, with the license texts they ship (the standard text from `scripts/licences/` when a package ships none), the bundled font included
  - code that crates compile in from other projects: UnRAR (extract only, as its license requires), libwebp, Microsoft's WebView2 loader
  - PDFium, whose license texts (the `licenses` folder of the pinned build) ship beside the library
  - the optional downloaded tools: FFmpeg (GPL/LGPL), LibreOffice (MPL 2.0), yt-dlp, Deno (MIT), ExifTool, ONNX Runtime (MIT) and the license of the model used
- `docs/DEPENDENCIES.md`, written by the same script: a table of every dependency's version, source, hash and license.
- Both are sorted and carry no date; `npm run check:third-party` in CI's Licences job fails when they no longer match the lockfiles.

## 5. Feature specification

### 5.1 Catalog

All formats, conversion routes, tools and file actions are defined in one Rust catalog. Each entry has:

- id and category
- input types and output type
- required engine or tool group
- platform support
- i18n keys and icon
- a preview/experimental flag

Generated from the catalog: the wheel contents, `docs/FORMATS.md`, `website-kit/catalog.json` (read by the conversion table on the author's website) and the route tests.

Routes that depend on a tool that is not installed yet appear dimmed on the wheel; choosing one suggests "Install media tools".

### 5.2 Ways in

**1. Drag + modifier key (global)**

While the user drags files from anywhere, pressing a modifier opens the wheel under the pointer.

| Wheel | Windows default | macOS default |
| --- | --- | --- |
| Convert | Shift | Shift |
| Tools | Ctrl | ⌘ |
| File actions | Alt | ⌃ |

- All assignments can be changed in Settings, and key combinations can be defined.
- The wheel stays open when the key is released; the user keeps dragging and drops the file on a slice.
- Esc, or dropping outside the wheel, cancels.
- In a mixed selection the drag rests on a category for a moment to open its targets, since the drop ends the drag; resting on the hub goes back.
- Pressing another modifier while the wheel is open switches to that modifier's wheel.

**2. [+] Global shortcut for selected files**

Default Ctrl+Shift+Space (⌃⇧Space on macOS), configurable. It takes the files selected in Explorer or Finder and opens the wheel at the pointer.

- Windows: the selection is read from the active tab of the foreground Explorer window through `Shell.Application` → `ShellWindows`, minding the tabbed Explorer of Windows 11.
- macOS: the Finder selection is read with Apple Events. This needs the Automation permission; the app explains why before asking.

**3. Main window**

- A drop zone.
- Ctrl+O picks files.
- Ctrl+V pastes (outside text fields):
  - files are added as they are
  - text becomes a UTF-8 `.txt`
  - an image becomes a lossless `.png`
  - a link starts the web download flow
- For the files selected in the list:
  - Ctrl+Space opens the wheel. This shortcut works inside the app only, because globally it clashes with the IME.
  - Enter opens the Convert wheel.
  - Delete removes the file from the list only, never from the disk.

**4. Dragging links from a browser**

Dragging a video/media card or a link with a modifier shows "Download" options. Dropping a link on Home starts the same flow.

**5. [+] Explorer integration**

A Send To shortcut and an entry in the classic context menu, each switchable in Settings. The modern Windows 11 context menu is handled in Phase 10.

**6. [+] CLI**

```
kento convert photo.heic --to jpg
kento tool compress video.mp4 --target-size 25MB
```

The CLI is also used for testing and automation. It is a console program of its own beside the app (`kento.com` next to `kento.exe` on Windows, so typing `kento` in a terminal finds it first; inside the app bundle on macOS) and never opens a window. Commands: `convert`, `tool` (the tools that need no choices, plus those whose choices fit in options: Compress with `--quality`, `--ratio` or `--target-size`; Remove noise and Stabilize video with `--strength`; Remove pauses with `--threshold`, `--min-length` and `--keep`; Rotate video with `--turn`, `--mirror` and `--flip`; Merge videos with `--transition` and `--seconds`; Merge audio with `--crossfade`), `recipe list` and `recipe run`, `formats` and `routes`; `--out`, `--json`, `--quiet`. Results go next to each file (or `--out`) under the app's naming rules. Exit codes: 0 done, 1 a job failed, 2 wrong usage, 3 not possible, 4 a tool is missing, 130 cancelled. The Windows installer adds its folder to the user's Path, so terminals opened afterwards find `kento` anywhere; the uninstaller removes exactly that entry, and updates leave the Path as the user set it. The portable ZIP carries `kento.com` beside `Kento.exe`. On macOS the command line is `Kento.app/Contents/MacOS/kento-cli`, universal like the app.

**7. Touch screens (Phase 10)**

Press and hold opens the wheel.

### 5.3 Wheel behavior

Placement:

- The wheel opens under the pointer and shifts to stay on screen near an edge.
- Coordinates are right on multi-monitor setups with different per-monitor DPI scales (Per-Monitor v2).

Slices:

- At most 8 slices per ring. More use an inner/outer ring or a "More…" sub-wheel.
- **Rings of choices.** A slice with variants opens a ring of them when the pointer rests on it (about half a second), with Enter or with the forward arrow; resting on the hub, Esc or the back arrow goes back one level. A plain drop or click on the slice applies its default. The hub shows the path (for example "Convert › PDF"), and going in and back has its own motion, sound and haptic feedback; with reduced motion it is a short cross-fade. Rings of choices: one PDF or separate PDFs for several pictures, picture quality (JPG, WEBP, AVIF), the resolution of pages and slides as pictures, GIF size, audio bit rate, Compress presets, Speed presets, Metadata quick actions, the QR report format, recent folders for Copy and Move, the archive format for ZIP, and the quality and audio format of a web download.
- Recent choices and favorites come first; this learning stays local.

Smart filter:

- The Convert wheel shows only the targets valid for every selected file.
- Mixed selections show category groups.
- Several selected files are converted as a batch **[+]** in one queue.
- File actions work on every file type, on folders and on mixed selections.

Keyboard and accessibility:

| Key | Action |
| --- | --- |
| Up / Down | Previous / next slice |
| Right (Left in right-to-left) / Enter | Open the slice's ring of choices, or apply it |
| Left (Right in right-to-left) / Esc / Backspace | Back one ring; Esc on the first ring closes the wheel |
| Home / End | First / last slice |
| Space | Apply the selected slice |
| Tab | Close the wheel |

Every slice has a screen-reader label. In the Arabic (right-to-left) interface the slice order is mirrored (counterclockwise), and the arrows that go into and out of a ring follow the reading direction.

Feedback:

- A sound on slice change (when enabled in Settings).
- Haptic feedback on macOS (`NSHapticFeedbackManager`).
- Respect for the reduced-motion setting.
- A short description bubble on the slice, for example "PNG: lossless, keeps transparency".

### 5.4 Conversion matrix

At least these routes: the 46 core input formats and the **[+]** additions.

| Category | Inputs | Outputs |
| --- | --- | --- |
| Image (9) | AVIF, BMP, GIF, HEIC, JPG, PNG, SVG, TIFF, WEBP | JPG, PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF; HEIC (when an encoder exists); **[+]** ICO (multi-size). Animated GIF → MP4/WEBM/MOV |
| Video (7) | AVI, GIF, MKV, MOV, MP4, WEBM, WMV | MP4, MOV, MKV, WEBM, AVI, WMV, GIF (optimized with palettegen), MP3; **[+]** M4A, WAV |
| Audio (8) | AIFF, FLAC, M4A, MP3, OGG, OPUS, WAV, WMA | To each other |
| Document / text | DOCX, RTF, RTFD, TXT, MD, HTML, EPUB, PAGES, TEXTCLIPPING; **[+]** ODT, DOC | PDF, DOCX, ODT, RTF, TXT, MD, HTML, EPUB (those that make sense for the input) |
| Spreadsheet | CSV, TSV, XLS, XLSX, ODS; **[+]** NUMBERS | XLSX, ODS, CSV, TSV, PDF, HTML |
| Presentation | PPT, PPTX; **[+]** ODP, KEY | PDF, PPTX, ODP, PNG/JPG per slide |
| Subtitles | SRT, VTT | SRT ↔ VTT, TXT |
| PDF | PDF | DOCX, PPTX (with page images), XLSX (best effort), JPG/PNG per page, EPUB, TXT, MD, HTML |
| Archive (4) | ZIP, TAR, GZ (including tar.gz), RAR (read only); **[+]** 7Z | ZIP, TAR, TAR.GZ; **[+]** 7Z |

Notes:

- **Apple formats.** PAGES, KEY and NUMBERS are read through LibreOffice. Writing Pages is not supported, because it is not reliable across platforms.
- **macOS-specific formats.** RTFD and TEXTCLIPPING are read best-effort on both platforms.
- **Complex documents.** The interface says honestly that not every feature can be preserved.
- **Spreadsheets without an office suite.** CSV, TSV, XLS, XLSX and ODS convert to CSV, TSV, XLSX and HTML in the core (values only; to CSV and TSV the first sheet). ODS and PDF outputs use LibreOffice.
- **PDF to XLSX** reads the tables on each page in the core, one sheet per page, with no office suite: rows and columns come from where the text sits, and printed numbers (thousands separators, a decimal comma, negatives in parentheses) stay numbers. It is a best effort, and a scanned PDF has no text to read.
- **Encrypted PDFs** are refused, also those with only an owner password, so no document loses its restrictions.
- **Route count.** The total number of routes is computed in `FORMATS.md`.

### 5.5 Tools (40 core tools + enhancements)

Each tool opens in its own small window or panel, shows a preview and saves the result as a new copy.

**Image**

- **Compress:** images, video, audio and PDF. Three modes: quality, reduction ratio or target size (for example "under 25 MB", by binary search). Each file keeps its format; formats that cannot shrink in themselves (WAV, AIFF, BMP, GIF) are explained, and a result that would not be smaller is not written.
- **Metadata:** view, edit and remove for images, PDF and media; media also supports track and chapter fields. Engine: ExifTool + ffprobe/ffmpeg.
- **Edit image:** resize, rotate, flip; brightness, contrast and saturation with a live preview.
- **Mark up:** freehand, highlighter, shapes, text and arrows. Select/move, Delete, Ctrl+Z / Ctrl+Y.
- **Add frame:** padding, background (color, gradient or blurred), corner radius and shadow.
- **Crop image:**
  - the crop area is drawn, moved and resized by dragging
  - Shift locks the aspect ratio
  - ratio presets: 1:1, 4:5, 16:9, 9:16, 3:2, free
  - Enter saves
- **Make a collage:** editable layout, spacing and background; images are ordered by dragging.
- **Redact image:** a selected area is hidden with a solid color, blur or pixelation.
- **Read QR codes:** scans images and PDF pages; exports a TXT, CSV or JSON report. **[+]** QR generation: PNG/SVG from text or a link.

**PDF**

- **Split PDF:** by page ranges or by pages per file.
- **Edit PDF:** reorder by drag and drop in a thumbnail grid, remove and rotate pages.
- **Merge PDFs:** keeps supported content and navigation (bookmarks, links).
- **PDF from images:** images in the chosen order; page size and margin options.

**Archive**

- **Extract archive:** ZIP, TAR, GZIP, RAR (**[+]** 7Z) into a new folder.
- Safety checks: path traversal (zip-slip), symbolic links, an entry-count limit and a total-extracted-size limit (zip bombs).
- Existing file names are never overwritten.

**Video**

- **Remove audio:** a silent copy without touching the video stream.
- **Trim video:** in/out points, moving the selection and keyboard navigation.
- **Crop video area:** a region is chosen on the frame and resized.
- **Change video speed:** the audio tempo follows the speed (atempo chain) and the pitch is kept.
- **Merge videos:** clips are joined; size, frame rate and audio layout are normalized.
- **Extract frames:** frames at chosen timestamps are saved as PNG.
- **Split video:** at markers (M), into equal parts or by intervals; parts can be kept or dropped.
- **Redact video:** rectangles are hidden with color, blur or pixelation during chosen time ranges, or erased: filled in from the pixels around them (FFmpeg `delogo`), for the user's own marks such as a date stamp or their logo.
- **Merge videos** also takes a transition between clips: fade, through black, slide or wipe, 0.2 to 2 seconds (never more than a third of the shorter of the two clips), with the sound crossfading. The clips overlap for each transition, so the result is shorter by that much.
- **Make vertical:** a 1080×1920 H.264/AAC MP4 for short-video apps, from the whole video or a selection. Either a 9:16 window of the picture, placed by dragging, or the whole picture across the width over a blurred, enlarged copy of itself or a color. The editor says when the result runs past common short-video lengths (60 seconds, 3 minutes).
- **Cut out parts** (video and audio): ranges marked on the timeline are taken out and the rest is joined, with a few milliseconds of fade at every cut so the sound never clicks.
- **Remove pauses** (video and audio): quiet gaps are found (a threshold in dB, a shortest pause, a margin kept on both sides) and shown on the timeline with the time saved before anything is written; then they are cut out.
- **Add music:** a piece of music mixed under the video's own sound or replacing it, each with its level; the music can step back while someone speaks (sidechain compression), start later in the song, repeat, and fade in and out.
- **Add text or logo:** text (typeface, size, color, outline or a box behind it) and pictures placed on the frame, each with its opacity and time range. Text is drawn by the page into a picture of the result's own pixels, so the editor shows exactly what the video gets, in every script.
- **Fade and volume** (video and audio): fades in and out over chosen seconds (for video, the picture from and to black too) and a level raised or lowered, with a limiter so a louder result never clips.
- **Remove noise** (video and audio): FFT noise reduction in three strengths, optionally with the lowest rumble filtered out.
- **Rotate video:** quarter and half turns, mirrored or flipped.
- **Reverse and loop:** backwards (the sound too), a boomerang (forwards and back, silent) or the clip repeated up to ten times.
- **Color and look:** ready looks (black and white, warm, cool, vivid, faded, vintage) and brightness, contrast, saturation and warmth, with a live preview.
- **Stabilize video:** a steadier picture in three strengths, with vid.stab where the FFmpeg has it and FFmpeg's own deshake otherwise.

**Audio**

- **Normalize loudness:** EBU R128 analysis and two-pass loudnorm. Target loudness, range and true peak are adjustable.
- **Trim audio:** waveform preview, in/out handles and optional silence removal.
- **Audio channels:** mono/stereo conversion, left/right level and a channel preview.
- **Redact audio:** selected ranges are replaced with a beep or silence.
- **Audio to video:** a video with a waveform, spectrum, frequency bars or a still image.
- **Merge audio:** audio files in the chosen order, overlapping by a crossfade of up to 10 seconds.
- **Make a ringtone:** up to 40 seconds of a song or of a video's sound, faded in and out, as M4R or MP3.

On the Tools wheel, Make vertical, Rotate video, Reverse and loop, Color and look, Remove noise and Stabilize video carry rings of quick choices that run at once; "Other…" and a plain drop open the editor.

**Enhancements**

- **[+] Remove background:** a transparent PNG from an image.
- **[+] Extract text (OCR):** `Windows.Media.Ocr` on Windows and Apple Vision on macOS, both local and free. The user is told when the Turkish language pack is missing.
- **[+] Burn in subtitles:** SRT/VTT subtitles permanently into a video.
- **[+] PDF compression:** part of the Compress tool.

### 5.6 Shared keyboard layout of the media editors

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | 1 second back / forward |
| Shift+← / Shift+→ | 1 frame for video, 0.1 s for audio |
| I / O | Selection start / end |
| Shift+Space | Play the selection only |
| M | Add a split marker |
| Home / End | Go to start / end |
| Ctrl+S / ⌘S | Save |
| Esc | Close |

- **Proxy preview:** for codecs the WebView cannot play (MKV, AVI, WMV, HEVC…), FFmpeg makes a temporary low-resolution H.264 preview file. Export always uses the original source.
- **Waveform:** peaks are precomputed with FFmpeg.

### 5.7 File actions wheel

| Action | Behavior |
| --- | --- |
| Share | Windows Share (`IDataTransferManagerInterop`) on Windows; AirDrop and the share menu on macOS |
| Put on shelf | Puts the file on Kento's own shelf (see 5.8) |
| Copy | To a chosen folder |
| Move | Moves the original: the one exception, with explicit confirmation |
| Copy path | Copies the file path to the clipboard |
| Open in terminal | Windows Terminal when present, otherwise PowerShell; Terminal on macOS |
| **[+]** Show in Explorer / Finder | Reveals the file in the file manager |
| **[+]** Archive (ZIP) | Packs the selection into a ZIP file |

### 5.8 Shelf

The shelf is a small, temporary holding area at the screen edge. A file is dropped there, the user goes to another folder, then drags the file from the shelf to where it belongs.

Kento has its own shelf and no link to Pano (Panopin), the author's clipboard app. Pano keeps what is copied (text, links and screenshots); Kento's shelf holds files on their way somewhere. Decided at the start of Phase 3 (2026-11-02), after the four possible models (Pano if installed, own shelf plus "Send to Pano", Pano only, own shelf only) were compared.

The shelf:

- A small, always-on-top window with a transparent background.
- Files are dropped on it and dragged out of it: OLE on Windows, `NSDraggingSession` on macOS.
- Search the history, reuse items (send to the wheel) and show them in Explorer/Finder.
- The shelf keeps a reference to the file, not a copy, and shows when a file was moved or deleted.
- An optional "keep a copy" setting.

### 5.9 Home and Library

Home (Ctrl+1):

- Drop zone, a "Choose files" button and a paste hint.
- A "Recently done" strip.
- A tool setup card: "Tools ready" or "Complete setup".
- Active jobs.

Library (Ctrl+2):

- The last 50 successful exports and clipboard imports.
- Search (Ctrl+F) and a filter by type.
- Per item: preview, show in Explorer/Finder, drag out, send to the wheel, remove from the list.
- Data lives in `%LOCALAPPDATA%\Kento` and `~/Library/Application Support/Kento`. Updates never delete it.

Window look: Mica/Acrylic and native window controls on Windows; native traffic lights and vibrancy on macOS.

### 5.10 Web media download

Triggers:

- Pasting a link on Home.
- Ctrl+Shift+D (⌃⇧D on macOS; global): downloads the link on the clipboard.
- Dragging a card or link from a browser with a modifier, or dropping it on Home.

Options:

- Video, audio only (MP3) or the original image/media.
- A simplified quality list.
- Target folder.

Site-specific behavior:

- YouTube: the video and the thumbnail can be downloaded separately.
- Instagram reels: video and audio; there is no thumbnail.
- Instagram photo posts: a photo picker opens; chosen photos are saved in the post's order.
- Players that only expose a poster or a blob address: the user is pointed to "Copy share link".

Not supported, and said so in the interface: DRM-protected content, live streams, content behind a login, whole profiles and playlists. No cookie import.

On first use a short notice appears: "Only download content you have the right to download."

### 5.11 Folder automation and recipes

**Folder automation:** a folder is watched and rules are defined. Each rule has three parts:

- Filter: extension, name pattern, size.
- Action: convert, tool, recipe or move.
- Output folder.

Example: "Convert PNGs that land in the Screenshots folder to WEBP and put them in Optimized."

Safeguards and controls:

- Loop protection: the app skips files it produced itself, and warns when the output folder is inside the watched folder.
- Finished writes: processing waits until the file size is stable.
- Controls: pause/resume, an activity log and error notifications.

**[+] Recipes:** several steps chained and saved under a name. Example: "Ready for Instagram" = crop 4:5 + resize to 1080 px + compress under 2 MB. Recipes are available in the wheel's Favorites slice, in automation and in the CLI.

### 5.12 Window layouts

The active window is placed in one of 8 layouts with a global shortcut or the wheel's "Window" ring:

- left half, right half
- four quarters: top left, top right, bottom left, bottom right
- center
- full screen

The feature is off by default and can be switched on in Settings. It must not clash with the built-in Windows Snap: no shortcut uses the Windows key, and Kento never snaps a window.

| Layout | Windows | macOS |
| --- | --- | --- |
| Left / right half | Ctrl+Alt+← / → | ⌃⌥⌘← / → |
| Full screen | Ctrl+Alt+↑ | ⌃⌥⌘↑ |
| Center | Ctrl+Alt+↓ | ⌃⌥⌘↓ |
| Top left / top right | Ctrl+Alt+Home / Page Up | ⌃⌥⌘U / I |
| Bottom left / bottom right | Ctrl+Alt+End / Page Down | ⌃⌥⌘J / K |

With the feature on, Ctrl+Shift+Space with nothing selected opens the Window ring, whose slices sit where their layouts go on the screen. A window that cannot be resized is centred in its layout's place. On macOS the feature needs the Accessibility permission, asked for only when the feature is switched on.

### 5.13 Job queue, progress and notifications

- **Queue:**
  - The number of concurrent jobs is limited (default based on the core count).
  - Heavy jobs such as LibreOffice run one at a time.
  - Every job can be cancelled; a cancelled job's partial output is deleted.
- **Real progress:**
  - FFmpeg's `-progress pipe:1` output and yt-dlp's own progress output are parsed.
  - Operations without progress information show an indeterminate indicator.
  - A remaining-time estimate is shown.
- **Success card:** when a job ends, a short, borderless card appears in a corner. Clicking it shows the file; the card can be dragged.
- **Errors and logs:**
  - Errors are explained in plain language, with a "Copy details" button.
  - Logs stay local and are rotated; file contents are never logged.

### 5.14 Output and naming rules

- **Location:** by default the output is written next to the source file. If that is not writable, `Downloads/Kento` is used. A fixed output folder can be set in Settings.
- **Naming:**
  - Conversion: `photo.heic` → `photo.jpg`; if that exists, `photo (2).jpg`. Never overwrite.
  - Tools add a suffix: `video - trimmed.mp4`, `document - merged.pdf`. Suffixes follow the interface language.
- **Safe writes:** output goes to a temporary file first and is renamed atomically when the job is done.
- **Long paths:** paths over 260 characters (`\\?\`) are supported on Windows.
- **Special characters:** paths with Turkish characters (ı, ş, ğ, ç, ö, ü, İ) and emoji names are tested with every engine, especially in FFmpeg, LibreOffice and ExifTool arguments.
- **Cloud files:** OneDrive/iCloud "online-only" files are detected and handled.

### 5.15 First run (tool setup wizard)

The welcome screen briefly explains:

- what the app does
- the privacy approach
- the modifier keys
- the permissions it needs and why

"Complete setup → Download missing tools":

- Groups install in order: Media → Office → Extras.
- Each group's size is shown up front, and groups can be chosen one by one.
- An interrupted install resumes; a failed group can be retried.
- Tools already on the system are skipped.
- When everything is done, "Tools ready" appears.

Core image, PDF, archive, QR and text features work from the start, with no download.

### 5.16 Updates and release policy (the same rules as Pano)

Updates are mandatory:

- No "Skip", "Later" or "Ignore this version".
- The new version downloads in the background and its signature is verified.
- Once it is downloaded, no new job can start. Running and queued jobs finish, then the app restarts after a short notice and installs it. A job started meanwhile is refused with a message that says why; folder automation keeps the files that arrive and handles them after the restart. A dialog in Kento's window that holds the user's work puts the restart off until it closes, and Settings › Updates says what the update waits for.
- A Mac app that macOS runs translocated asks to be moved to Applications; one in a folder Kento may not change installs only on "Update and restart", since macOS then asks for an administrator's password. Development builds never install; their Updates section links to the release page.
- Offline, the app keeps working (local first) and updates at the first check after the connection returns.

Infrastructure:

- Tauri updater + signing (free).
- The update URL is always `.../releases/latest/download/latest.json`, because only the newest release stays published.
- `requireSignedVersion` is on: the version signed into an update must match the version `latest.json` announces, so an altered `latest.json` cannot offer an older signed release as a new one.

Check times:

- 30 seconds after start.
- Every 6 hours, or an hour after a failed check.
- By hand: Ctrl+U (⌘U on macOS) in Kento's windows, "Check for updates" in the tray menu and "Check now" in Settings.

The `notes` of `latest.json` are kept before installing and shown once on Home at the first launch after the update.

Only the newest release stays on GitHub:

- A tag builds a draft release; the owner publishes it by hand once it is verified.
- Publishing a release turns every older published release back into a draft. Drafts keep their files and download counts but only the owner sees them; publishing one again brings it back.
- If the new release fails, nothing is hidden.
- Git tags stay for the code history.

**Portable ZIP:** it follows mandatory updates too. It asks for its own entry of `latest.json`, a ZIP signed with the update key for that version. After the signature check each file of the new version is written next to the old one and takes its name; the running program, which Windows lets one rename but not overwrite, becomes `Kento.old` and is removed at the next start.

**One channel:** stable only, no beta channel.

**Consistency with Pano:** the security and update documents of Pano (Panopin) (`docs/SIGNING.md`, updater settings, release workflows) are followed to the letter; any contradiction is resolved before a release.

### 5.17 Settings (Ctrl+, / ⌘,)

- Appearance: System / Light / Dark, and the theme (5.20): a card for every theme with its wheel, and the chosen theme's wheel to try.
- Language: "System language" (default) or one of the 12 languages (see 5.19).
- Drag modifiers and key combinations.
- Global shortcuts: selection wheel, download (Ctrl+Shift+D, on by default; while it is on, the browser's own Ctrl+Shift+D does not reach the browser), window layouts.
- Output: default output location and naming suffixes.
- Feedback:
  - Sound effects: on and low by default, with a level slider.
  - Haptic feedback (macOS).
  - Reduced motion.
- System:
  - Start at sign-in.
  - Tray / menu bar icon.
  - Shelf position and wheel size.
- Tools: each tool's status, version and path; "Verify again", "Update" and "Remove".
- Performance: number of concurrent jobs.
- Library: clear the library.
- Updates: the version, the last check time, where an update stands (downloading, waiting for jobs, ready to restart, failed), "Check now" and an explanation of the mandatory update policy.
- Privacy: the privacy statement, including that update checks read `latest.json` from GitHub and send nothing about the user or their files.
- Explorer integration: on / off.

### 5.18 Platform notes

**Windows (first)**

- Tray menu: Home, show/hide shelf, pause, settings, check for updates, quit.
- Install: a per-user NSIS installer without administrator rights that installs at once (a progress bar only, then Kento starts), plus a portable ZIP. The uninstaller removes what Kento registered (Start at sign-in, the Explorer entries, the Path entry), and Kento's data with the downloaded tools only when "Delete the application data" is ticked; updates keep everything.
- WebView2: installed by the installer's bootstrapper when missing.
- Accessibility: follows High Contrast mode.
- Later phases: **[+]** WinGet and ARM64.

**macOS**

- Build: universal, macOS 13+ (`LSMinimumSystemVersion` 13.0, the oldest the bundled PDFium runs on; the release workflow fails when a bundled program needs a newer macOS). Newer APIs are used behind version checks; the feature is hidden on older versions. Signed with the hardened runtime and two entitlements: Apple Events (the Finder selection) and no library validation (the bundled PDFium and the downloaded ONNX Runtime).
- Interface: a menu bar icon; the Dock icon is optional.
- Quit: ⌘Q, with a confirmation while jobs run.
- Transparency: transparent windows need `macOSPrivateApi`; fine, since the app is not in the Mac App Store.
- Later phases: **[+]** Homebrew cask and Finder Quick Actions.

### 5.19 Languages and localization

| Language | Code | Phase |
| --- | --- | --- |
| English | en | 1 (source language) |
| Türkçe | tr | 1 |
| Español | es | 10 (needs native review) |
| 简体中文 | zh-Hans | 10 (needs native review) |
| 日本語 | ja | 10 (needs native review) |
| Deutsch | de | 10 (needs native review) |
| Français | fr | 10 (needs native review) |
| Português (Brasil) | pt-BR | 10 (needs native review) |
| العربية (right to left) | ar | 10 (needs native review) |
| 한국어 | ko | 10 (needs native review) |
| Italiano | it | 10 (needs native review) |
| Русский | ru | 10 (needs native review) |

Language choice:

- The app follows the system language by default; Settings → Language picks another.
- Each language is listed in its own name ("Deutsch", "日本語").
- Changing the language needs no restart and reaches every window at once, including the wheel, the shelf and the toast.
- Without an exact match the closest language is used (pt-PT → pt-BR, es-MX → es); with no match, English.

Text and formatting:

- Plurals use ICU MessageFormat (Arabic has 6 plural forms, Russian 3).
- Numbers, dates, durations and file sizes are formatted per language with `Intl`.
- Turkish case mapping is locale-aware (i/İ, ı/I). Library search is locale-aware and accent-insensitive.
- Chinese, Japanese and Korean input respects IME composition events: Enter pressed while a word is being composed never triggers a search or an action.
- Shortcut key names stay as the operating system shows them.

Right to left (Arabic):

- The RTL infrastructure is built in Phase 1, even though the Arabic translation arrives in Phase 10:
  - `dir="rtl"` and CSS logical properties only (`margin-inline-start`, `inset-inline-end`…).
  - Directional icons (arrows, back/forward) are mirrored. The brand logo and media playback controls are not.
  - Media timelines and waveforms stay left to right, as common design guidelines recommend.
  - The wheel's slice order is mirrored (counterclockwise) and the arrow keys follow the visual direction.
  - File names and paths inside RTL text are bidi-isolated (`<bdi>`), so names like `photo (2).jpg` stay intact.

Fonts:

- The brand font covers Latin and Cyrillic.
- Chinese, Japanese, Korean and Arabic fall back to system fonts:
  - Windows: Microsoft YaHei UI, Yu Gothic UI, Malgun Gothic, Segoe UI.
  - macOS: PingFang SC, Hiragino Sans, Apple SD Gothic Neo, SF Arabic / Geeza Pro.
- Large CJK fonts are not bundled, to keep the installer small.

Translation process:

- English is the source language. Turkish is reviewed by hand.
- Other languages start from machine translation and are marked "not reviewed" in the translation file.
- Terms are consistent across languages; `CONTRIBUTING.md` names the ones to keep (wheel, slice, shelf, recipe, rule, Library…).
- `CONTRIBUTING.md` has a translation guide.
- The README and the website kit stay English + Turkish.

Tests:

- Pseudo-localization: a test language that lengthens strings by 40 % to catch overflow and truncation.
- A pseudo-RTL test language validates the RTL layout from Phase 1.
- Playwright screenshots of the main screens in every language (especially ar, ja, de, ru).
- Missing or extra translation keys fail CI.

### 5.20 Themes

The default theme is the steel safe dial (`design/DESIGN.md`). From Phase 1 the theming is pluggable, so adding a theme later needs no change elsewhere: a theme is a set of design tokens for light and dark, a wheel renderer (face, slices, hover, the apply effect), motion timings, a sound set and typefaces; the rest of the app takes the theme's colours. The app icon and the name stay the same in every theme.

Rules for every theme:

- The wheel still appears within 100 ms: textures and particle fields are pre-rendered or cached, never computed per frame.
- WCAG AA contrast in light and dark, reduced-motion support, right-to-left mirroring and the 12 languages, like the default theme.
- Sounds are synthesized or CC0, low by default, and follow the sound setting.

**The themes.** Kento has 51 themes, each with its own name, the same in every language, listed in `src/theme/catalog.json` in the order Settings shows them: Kasa (the steel dial, the default), Ayar, Beton, Titan, Varak, Obsidyen, Damla, Serpinti, Atlas, Girdap, Yörünge, Halka, Pusula, Tezgâh, Portakal, Karpuz, Nar, Fırın, Akide, Baklava, Gündöndü, Ayaz, Kütük, Petek, Helezon, Dalga, Çini, Kilim, Nazar, Sema, Telve, Hedef, Ahize, Plak, Radar, Frekans, Saniye, Jeton, Piksel, Kare, Konfeti, Yaldız, Bom, Fırça, Tebeşir, Ozalit, Revzen, Kıvrım, Sedef, Mozaik, Serap. Every theme but Kasa is a pack (`src/theme/packs/`): its wheel drawn from the slices the app shows, its light and dark palettes, its timings (open within 200 ms plus a short stagger, an apply effect of up to about 700 ms), its open, tick and apply sounds and its typefaces. A saved theme that is no longer in the list falls back to Kasa.

Choosing a theme:

- Settings → Appearance → Theme shows every theme as a card with its wheel, small and at rest, in the light or dark the app shows; the cards are a radio group (arrow keys, Home, End, Space). Above them the chosen theme's wheel is live: pointing at a slice ticks, a click applies it with its effect and sound, and it opens again.
- The choice applies at once, in Settings itself and in every window: the main window, the floating wheel, the shelf and the corner cards.
- A theme changes the wheel completely, and the colours of the rest of the app: its palette's page, surface, border, text, accent, focus and status colours replace the steel ones. The layout of Home, Library, Settings, the shelf and the cards and the interface typeface stay the same, so every theme reads the same way.
- Everything the wheel does stays the app's: pointing, the keys, rings of choices, paging, the back control, the description bubble, drag and drop and the menu for screen readers. In Windows High Contrast the steel wheel is shown, since it draws itself in the system's colours.

## 6. Security and known technical pitfalls

**Global drag detection, Windows**

- A drag may have started when the left button is down and the pointer passes the `SM_CXDRAG`/`SM_CYDRAG` threshold. Catch it with either:
  - a light `WH_MOUSE_LL` hook, or
  - `GetCursorPos` + `GetAsyncKeyState` polling that runs only while the left button is down.
- Read modifiers with `GetAsyncKeyState`. No low-level keyboard hook.
- The wheel window is a real OLE drop target. If the dragged thing is not a file, the wheel closes silently.

**Global drag detection, macOS**

- Detect the drag with `NSPasteboard(name: .drag)` `changeCount` and a global `leftMouseDragged` monitor.
- Read modifiers by polling `NSEvent.modifierFlags`; this needs no keyboard permission.
- The wheel window is a non-activating `NSPanel`.

**Tauri / WebView2**

- Drop-target registration: WebView2 registers the OLE drop target after the window is first painted. Fix: create the wheel and shelf windows at startup with `visible: true`, parked off screen (`x: -10000`), and show them with `set_position`.
- `dragDropEnabled`: set it in the window definition in `tauri.conf.json`; set from the Rust builder it can be ignored.
- Mica/Acrylic: apply once. Never hide/show the window with `hide()`/`show()`, which breaks the effect and flickers; hide and show by moving it.
- Focus: never call `set_focus()` during a drag; it breaks Explorer's `DoDragDrop` loop.
- Dragging out: turn off auto-close during an outgoing drag with an atomic flag.
- Slice hit-testing: compute the slice under the pointer from `DragDropEvent::Over { position }`, minding the DPI scale.

**Windows specifics**

- Elevated windows: drags from windows running as administrator cannot be caught because of UIPI. Document it; never suggest running the app as administrator.
- Alt key: releasing Alt can activate the source app's menu bar. Test it; if it causes trouble, change the default.
- Ctrl+Space is the IME shortcut on Windows and the input-source shortcut on macOS, so it is in-app only.
- Shortcut conflicts: detect global shortcut conflicts at registration and tell the user.

**Media and office engines**

- Local media playback: open the Tauri asset protocol with a narrow scope. Verify that Range requests work for large files.
- LibreOffice cannot run concurrently in headless mode with the same profile. Queue the jobs or use a separate `-env:UserInstallation` profile per job. Its first start is slow; add a warm-up option.

**General security**

- Tauri configuration: the narrowest capabilities/permissions and a strict CSP.
- Input validation: paths from the frontend are validated on the Rust side.
- Temporary files: cleaned when a job ends and at app start.
- Verification chain: updates pass signature verification, downloaded tools pass hash verification.
- `SECURITY.md`: vulnerabilities are reported through GitHub's private vulnerability reporting.

**Size**

- Release profile: `opt-level = "s"`, `lto = true`, `codegen-units = 1`, `strip = true`. Panics unwind rather than abort, so a parser that panics on a malformed file ends that job and not the app.
- Default features of heavy crates are turned off.
- The installer size is reported at the end of every phase.

## 7. Quality and testing

- **Rust tests:**
  - Unit tests: catalog consistency, naming, path safety, zip-slip, hash verification.
  - Integration tests: every conversion route runs when its tool is installed; otherwise the test is skipped and reported.
- **Fixtures:** generated by scripts in `scripts/`. Large binaries are never committed.
- **`Kento --smoke-test`:** checks the wheel, clipboard, drag and drop, library, editors and export; writes a JSON report and PNG screenshots. In a release copy (an installed one, a macOS bundle, or `KENTO_REQUIRE_RELEASE=1`) it also requires the command line and the license texts beside the app; every run checks the updater's public key, fixed endpoint and `requireSignedVersion`.
- **Frontend:** Vitest; Playwright where possible.
- **Code quality:**
  - `cargo clippy -D warnings`, rustfmt, ESLint, Prettier.
  - Missing or extra translation keys fail CI.
  - Pseudo-localization and RTL screenshot tests (see 5.19).
- **Security scanning (all free):** `cargo audit`, `cargo deny` (licenses and advisories), `npm audit`, Dependabot.
- **CI (GitHub Actions, free for public repositories):**
  - Build and test on `windows-latest` and `macos-latest` for every pull request.
  - A `v*` tag publishes a release with tauri-action. The release carries:
    - fixed-name assets
    - `SHA256SUMS.txt`
    - a signed `latest.json`
    - `catalog.json`
  - Then the old-release cleanup step runs (see 5.16).

## 8. Distribution and website integration

GitHub Releases is the main channel. Because only the newest release stays published, assets are uploaded under fixed names, so `https://github.com/<owner>/<repo>/releases/latest/download/...` links never break:

- `Kento-Windows-x64-Setup.exe`
- `Kento-Windows-x64-Portable.zip`
- `Kento-macOS-Universal.dmg`

Beside them, for updates and checks:

- `Kento-Windows-x64-Update.exe`: the same installer under the name updates fetch, so the download counts tell people's downloads from updates.
- `Kento-macOS-Universal.app.tar.gz`: the archive Mac updates install.
- `latest.json` with the update signatures (no `.sig` file appears on the release page), and `SHA256SUMS.txt` for every file.

Signing:

- Updates are signed with the project's update key from the first release; the private key lives only in the repository's GitHub Secrets and the owner's offline backup.
- Windows builds are not code-signed.
- Every Mac build is signed with the project's own self-signed certificate, the same for every version, so macOS keeps the Accessibility and Automation permissions given to Kento across updates (an ad-hoc signature changes with every build). It is not an Apple certificate, so the app is not notarized.
- The README explains the first launch with screenshots:
  - Windows SmartScreen: "More info" → "Run anyway".
  - macOS: close the warning, then System Settings → Privacy & Security → Open Anyway.
- After v1.0 has some users: apply to the SignPath Foundation's free code-signing program for open-source Windows apps.
- No Apple notarization for now: it needs a paid developer account.

`website-kit/` (to embed on the author's website):

- A download section, framework-free (plain HTML/CSS/JS):
  - detects the operating system and highlights the right button
  - fetches the version number and date from the GitHub API (`/releases/latest`)
  - also lists the other platforms' links
  - English + Turkish copy (the website is bilingual)
- A searchable conversion table generated from `catalog.json`.
- Content: feature sections, a privacy note and an FAQ.
- Signature: "Made by Mehmet Burak Taşkaya" and the GitHub link.

Promotion:

- A script and shot checklist for a 60–90 second demo video.
- A demo GIF for the README.
- Social media cards.

**[+] Web playground (Phase 10):** an interactive demo of the wheel on the author's website. It really converts images in the browser (Canvas/WASM); no file is uploaded to a server.

Repository files: `README.md`, `README.tr.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, issue and PR templates.

## 9. Roadmap

Every phase ends with a test pass on Windows, and on macOS where it applies. Progress is tracked with checkboxes in `docs/ROADMAP.md`.

- **Phase 0: design.** Visual identity, the name, the design system (`design/DESIGN.md`) and the app icon.
- **Phase 1: skeleton.** Tauri 2 + React/TS project, settings, design tokens and the pluggable theme system (default theme only, 5.20). Translation infrastructure (EN + TR), RTL infrastructure, pseudo-localization and pseudo-RTL test languages. Main window shell. Catalog skeleton, job queue, naming rules, logging. Single instance and tray icon. `ShelfProvider` interface. CI, license files, SPDX headers.
- **Phase 2: core local engines (no downloads).** Image conversions. PDF tools: merge, split, edit, PDF from images, PDF to images. Archive extraction and creation. QR reading. Text, subtitle and spreadsheet conversions. In-app wheel, drop zone, paste, Library and success card.
- **Phase 3: global wheel and desktop integration.** Drag + modifier detection: Windows first, then macOS. The three wheels and file actions. The chosen shelf model. Selection shortcut, Send To and context menu. Sounds and haptics.
- **Phase 4: media.** Tool setup wizard. FFmpeg conversions and the 13 video and audio tools (Compress and Metadata, which also take media, come in Phase 5). Proxy preview, waveform, real progress.
- **Phase 5: image editors and metadata.** Edit image, Mark up, Add frame, Crop, Collage, Redact image. Metadata with ExifTool. The Compress tool (including target size).
- **Phase 6: office.** Document, spreadsheet and presentation conversions with LibreOffice. PDF to other formats. Apple and macOS-specific input formats.
- **Phase 7: web download.** yt-dlp + Deno. Ctrl+Shift+D and dragging from browsers. Site-specific flows. Independent yt-dlp updates.
- **Phase 8: automation and enhancements.** Folder automation, recipes, window layouts. Background removal, OCR, QR generation, subtitle burn-in, CLI.
- **Phase 9: release readiness (v1.0).** Mandatory updates and a signed `latest.json`. NSIS installer, portable ZIP and universal DMG. Fixed-name assets, SHA256SUMS and the old-release cleanup step. README (EN/TR), the other repository documents and the notices file. Website kit, demo video script, `--smoke-test`. Release checklist.
- **Phase 10: growth.** The remaining 10 languages: es, zh-Hans, ja, de, fr, pt-BR, ar (RTL), ko, it, ru, each checked with screenshots (see 5.19). Web playground. WinGet and Homebrew. The modern Windows 11 context menu. Touch support and ARM64. More themes (5.20).
