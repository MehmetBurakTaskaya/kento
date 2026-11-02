<p align="center">
  <img src="design/icons/app.svg" width="112" height="112" alt="Kento icon: a steel safe dial">
</p>

<h1 align="center">Kento</h1>

<p align="center">
  <strong>Drag a file, press a key, drop it on the dial.</strong><br>
  Free, open-source file conversion and tools for Windows and macOS, done on your own computer.
</p>

<p align="center">
  By <a href="https://mehmetburaktaskaya.com">Mehmet Burak Taşkaya</a> ·
  <a href="https://github.com/MehmetBurakTaskaya/kento/releases/latest">Download</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

While you drag a file in Explorer, Finder or any other app, press **Shift**: a steel safe dial
opens under the pointer. Drop the file on a slice and Kento converts it on the spot, into a new
copy next to the original. **Ctrl** (⌘ on a Mac) opens the tools instead (compress, crop, trim,
merge, mark up, redact, metadata, remove the background) and **Alt** (⌃) the file actions. Nothing
is uploaded anywhere, and the original stays as it was.

## Download

| | |
| --- | --- |
| Windows 10 (1809 or later) and Windows 11, x64: installer | [Kento-Windows-x64-Setup.exe](https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/Kento-Windows-x64-Setup.exe) |
| Windows, portable | [Kento-Windows-x64-Portable.zip](https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/Kento-Windows-x64-Portable.zip) |
| macOS 12 or later, Apple silicon and Intel | [Kento-macOS-Universal.dmg](https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/Kento-macOS-Universal.dmg) |

These links always lead to the newest release. Each release lists the SHA-256 of every file in
`SHA256SUMS.txt`; to compare a download, run `Get-FileHash .\Kento-Windows-x64-Setup.exe` in
PowerShell or `shasum -a 256 Kento-macOS-Universal.dmg` in Terminal.

- **Installer.** Kento installs for your user only, with no administrator rights. The installer
  fetches Microsoft Edge WebView2 when Windows lacks it (Windows 11 has it), and puts the command
  line on your PATH.
- **Portable.** Unzip it anywhere and run `kento.exe`. Your data still lives in
  `%LOCALAPPDATA%\Kento`, and the portable copy keeps itself up to date like the installed one.
- **macOS.** Open the disk image and drag Kento into Applications, where it can keep itself up to
  date.

## First launch

**Windows.** Kento is not code-signed (certificates cost money; see
[docs/SIGNING.md](docs/SIGNING.md)), so SmartScreen may say "Windows protected your PC". Choose
**More info → Run anyway**.

**macOS.** Every Mac build is signed with the project's own certificate, but not by Apple, so Kento
is not notarised and macOS blocks its first opening:

1. Open Kento. When macOS says it cannot verify Kento, close the warning with **Done** or
   **Cancel**, whichever your macOS shows (not Move to Trash).
2. Open **System Settings → Privacy & Security**, scroll down and choose **Open Anyway** next to
   Kento. The button stays there for about an hour after you tried to open it.
3. Choose **Open Anyway** again and enter your password. From then on Kento opens like any app.

Or, in Terminal: `xattr -dr com.apple.quarantine /Applications/Kento.app`

Kento sees drags without any keyboard or input-monitoring permission. macOS asks once before Kento
may read the Finder selection for ⌃⇧Space (Automation), and Kento asks for Accessibility only if
you turn on window layouts. Updates keep these permissions, because every version is signed with
the same certificate. On Apple silicon the FFmpeg that Kento downloads runs through Rosetta 2,
which macOS offers to install the first time.

## How to use it

### The wheel

Drag one or more files, and while you drag, press a key:

| Wheel | Windows | macOS |
| --- | --- | --- |
| Convert | Shift | Shift |
| Tools | Ctrl | ⌘ |
| File actions | Alt | ⌃ |

- The wheel stays open when you let go of the key: keep dragging and drop the files on a slice.
  Esc, or dropping outside the wheel, cancels. Another key switches to its wheel.
- The Convert wheel shows only the formats every selected file can become. A mixed selection shows
  its kinds first: rest on one to open it.
- **Rings of choices.** Rest on a slice for half a second and its choices open around it: picture
  quality, one PDF or separate PDFs, resolution, presets, recent folders and more. A plain drop
  uses the default; resting on the hub goes back.
- With the keyboard: Up and Down move, Right or Enter opens a slice's choices or applies it,
  Left, Esc or Backspace go back, Space applies, Tab closes.
- Every job writes a new file next to the original: `photo.heic` becomes `photo.jpg`, or
  `photo (2).jpg` when that name is taken. Tools add a word: `video - trimmed.mp4`. Kento never
  overwrites a file; only Move, which you confirm, moves the original. Settings → Output can send
  everything to one folder instead.
- The keys can be changed in Settings → Wheel.

On Windows, a drag that starts in a program running as administrator cannot be seen by Kento,
because Windows keeps the two apart. Please do not run Kento as administrator to get around it.

### Without dragging

- **Ctrl+Shift+Space** (⌃⇧Space on a Mac) opens the wheel at the pointer for the files selected in
  Explorer or Finder. When none of them converts, the file actions open.
- **Ctrl+Shift+D** (⌃⇧D) downloads the link on the clipboard (see [Web downloads](#web-downloads)).
  While it is on, the browser's own Ctrl+Shift+D does not reach the browser; Settings can turn it
  off.
- **Home** (Ctrl+1): drop files, choose them (Ctrl+O) or paste them (Ctrl+V). Pasted text becomes a
  `.txt` file, a pasted picture a `.png`, and a pasted link starts a download. In the file list,
  Enter opens the Convert wheel, Ctrl+Space the tools and Alt+Enter the file actions; Delete takes a
  file off the list, never off the disk. Home also shows what was done lately, the tools' state and
  the running jobs.
- **Library** (Ctrl+2): the last 50 files Kento made, with search (Ctrl+F), a filter by type, a
  preview, Show in Explorer or Finder, dragging out and sending to the wheel.
- **Automation** (Ctrl+3): folder rules and recipes.
- **Settings** (Ctrl+,).
- **Explorer** (Windows): Kento can add itself to the Send To menu and to the right-click menu.
  Both stay off until you turn them on in Settings → Explorer.

On a Mac the window shortcuts use ⌘ instead of Ctrl. Closing the window leaves Kento in the
notification area (the menu bar on a Mac), where its menu opens Home and Settings, pauses the jobs
and quits.

### The shelf

**Put on shelf**, in the file actions, puts files on Kento's shelf: a small window at the edge of
the screen. Go to another folder and drag them from the shelf to where they belong. The shelf keeps
a reference to each file, not a copy (Settings → Shelf can keep a copy), and shows when a file was
moved or deleted. Its history can be searched, and its files sent to the wheel or shown in Explorer
or Finder.

## What it converts

The full list, made from the app's catalog, is in [docs/FORMATS.md](docs/FORMATS.md). In short:

| Kind | From | To |
| --- | --- | --- |
| Images | AVIF, BMP, GIF, HEIC, JPG, PNG, SVG, TIFF, WEBP | JPG, PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF, ICO; HEIC where the system can write it; animated GIF to MP4, WEBM, MOV |
| Video | AVI, MKV, MOV, MP4, WEBM, WMV | each other, GIF, MP3, M4A, WAV |
| Audio | AIFF, FLAC, M4A, MP3, OGG, OPUS, WAV, WMA | each other |
| Documents | DOCX, DOC, ODT, RTF, RTFD, PAGES, TXT, MD, HTML, EPUB, TEXTCLIPPING | PDF, DOCX, ODT, RTF, TXT, MD, HTML, EPUB |
| Spreadsheets | CSV, TSV, XLS, XLSX, ODS, NUMBERS | XLSX, ODS, CSV, TSV, PDF, HTML |
| Presentations | PPT, PPTX, ODP, KEY | PDF, PPTX, ODP, a PNG or JPG per slide |
| PDF | PDF | a JPG or PNG per page, TXT, MD, XLSX (the tables), DOCX, PPTX, EPUB, HTML |
| Subtitles | SRT, VTT | SRT, VTT, TXT |
| Archives | ZIP, TAR, GZ, 7Z, RAR (read only) | ZIP, TAR, TAR.GZ, 7Z |

With no download, Kento converts pictures, archives, subtitles, plain text, Markdown and HTML,
spreadsheets to CSV, TSV, XLSX and HTML, and PDF pages to pictures, text and tables. Video and audio
need the Media tools; office documents, presentations and the other spreadsheet and PDF routes need
the Office tools (see [below](#tools-kento-downloads-on-request)). Complex documents may lose what
the new format cannot hold. On Windows, HEIC photos need Microsoft's HEIF Image Extensions or the
Media tools.

**Tools**, 31 of them, most on the Tools wheel:

- **Images:** Edit image (size, rotation, brightness, contrast, saturation), Mark up, Add frame,
  Crop image, Make a collage, Redact image, Remove background.
- **PDF:** Split PDF, Edit PDF (reorder, rotate and remove pages), Merge PDFs, PDF from images.
- **Video:** Remove audio, Trim video, Crop video area, Change video speed, Merge videos, Extract
  frames, Split video, Redact video, Burn in subtitles.
- **Audio:** Normalize loudness, Trim audio, Audio channels, Redact audio, Audio to video.
- **For several kinds:** Compress (images, video, audio and PDF, by quality, by ratio or to a
  target size such as "under 25 MB"; it never writes a file that is not smaller), Metadata (view,
  edit and remove), Extract text (from pictures and PDF pages, with the text recognition built into
  Windows and macOS), Read QR codes (pictures and PDF pages, with a TXT, CSV or JSON report),
  Extract archive (with checks against harmful paths, links and archive bombs), and Make a QR code
  (PNG or SVG from text or a link, on Home).

**File actions:** Share, Put on shelf, Copy to…, Move to…, Copy path, Open in terminal, Show in
Explorer or Finder, and Archive (ZIP, or 7Z and TAR.GZ from its ring).

### Web downloads

Paste a link on Home, press Ctrl+Shift+D with a link copied, or drag a link or a video from the
browser with a key held (or drop it on Home): Kento asks what to download (the video, only its audio, the original, a
YouTube thumbnail, the chosen pictures of a photo post), in which quality and into which folder.
Content behind DRM or a sign-in, live streams, whole profiles and playlists are not supported, and
Kento never takes cookies from your browser. Only download what you have the right to download.

### Automation and recipes

A **rule** watches a folder and handles each new file that lands in it: it converts the file, runs a
tool or a recipe on it, or moves it, and puts the result where you choose. For example, PNGs that
land in Screenshots become WEBP files in Optimized. Kento waits until a file is fully written, never
handles its own results again, and keeps an activity log.

A **recipe** chains steps under a name, such as "Instagram": crop to 4:5, resize to 1080 px and
compress under 2 MB. Recipes appear on the wheel's Favorites slice, in rules and on the command
line.

### Window layouts

Off until you turn them on in Settings → Window layouts. Then shortcuts place the window in front,
and with nothing selected Ctrl+Shift+Space opens a Window ring. No shortcut uses the Windows key,
so Windows Snap stays as it is.

| Layout | Windows | macOS |
| --- | --- | --- |
| Left or right half | Ctrl+Alt+← / → | ⌃⌥⌘← / → |
| Full screen | Ctrl+Alt+↑ | ⌃⌥⌘↑ |
| Center | Ctrl+Alt+↓ | ⌃⌥⌘↓ |
| Top left or top right | Ctrl+Alt+Home / Page Up | ⌃⌥⌘U / I |
| Bottom left or bottom right | Ctrl+Alt+End / Page Down | ⌃⌥⌘J / K |

## Tools Kento downloads on request

Kento itself is small. The free tools that video, audio, office files and a few extras need are
downloaded once, when you ask: on Home (**Complete setup**), in Settings → Tools, or by choosing a
dimmed slice. Each group shows its size first and installs only what is missing.

| Group | For | Tools | Licences |
| --- | --- | --- | --- |
| Media | video, audio and web downloads | FFmpeg, yt-dlp, Deno | GPL-3.0-or-later (the FFmpeg builds and the yt-dlp program), MIT (Deno) |
| Office | documents, spreadsheets, presentations | LibreOffice | MPL-2.0 |
| Extras | picture metadata, background removal | ExifTool, ONNX Runtime, the BEN2 Base model | Artistic or GPL (ExifTool, like Perl), MIT, MIT |

- Every file is pinned in [src-tauri/toolchain.lock.json](src-tauri/toolchain.lock.json) with its
  address, size and SHA-256, and comes from its publisher's own release. A file that fails the
  check is never run. Interrupted downloads resume.
- Tools already on your computer are used when they are recent enough (FFmpeg 6, LibreOffice 7,
  ExifTool 12, yt-dlp 2025.11.12, Deno 2.3 or newer). Settings → Tools can also point to a program
  you choose.
- The tools run as separate programs; none of them is linked with Kento's code. yt-dlp has its own
  **Update yt-dlp** button in Settings → Tools, because sites change faster than Kento's releases.
- Their versions, sources and checksums are in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md), their
  licences in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Command line

```sh
kento convert photo.heic --to jpg
kento convert report.docx notes.md --to pdf --out PDFs
kento tool compress video.mp4 --target-size 25MB
kento tool merge-pdf part1.pdf part2.pdf
kento recipe run Instagram photo.jpg
kento routes heic
```

The command line runs the same engines, recipes and naming rules as the app, without opening a
window. Results go next to each file, or into the `--out` folder, which Kento creates when needed.

| Command | Does |
| --- | --- |
| `kento convert FILES… --to FORMAT` | converts each file |
| `kento tool TOOL FILES…` | runs a tool: `compress` (`--quality 1–100`, `--ratio 5–95` or `--target-size`), `mute`, `normalize`, `merge-video`, `extract`, `merge-pdf`, `images-to-pdf` (`--page fit\|a4\|letter`, `--margin`), `read-qr` (`--format txt\|csv\|json`) |
| `kento recipe list`, `kento recipe run RECIPE FILES…` | lists or runs your recipes |
| `kento formats`, `kento routes FORMAT` | lists the formats, or what one converts to and from |
| `kento help COMMAND` | explains a command |

Options: `-o`/`--out FOLDER`, `--json` (the result as one JSON document), `-q`/`--quiet`,
`-h`/`--help`, `-V`/`--version`. Exit codes: 0 done, 1 a job failed, 2 wrong usage, 3 not possible,
4 a tool is missing, 130 cancelled (Ctrl+C cancels the job and removes its partial output). The
tools that need choices in a window (the editors, for example) are not on the command line.

- **Windows:** `kento.com` sits beside `kento.exe`, and the installer adds its folder to your
  user's PATH, so `kento` works in any new terminal. With the portable ZIP, run it from its folder
  or add the folder to your PATH yourself.
- **macOS:** the command line is `Kento.app/Contents/MacOS/kento-cli`. Link it into a folder on your
  PATH to type `kento`:

  ```sh
  sudo mkdir -p /usr/local/bin
  sudo ln -sf /Applications/Kento.app/Contents/MacOS/kento-cli /usr/local/bin/kento
  ```

## Updates

Kento keeps itself up to date, and updates are not optional: there is no Skip or Later.

- It looks for a new version at start, every 6 hours, and when you ask (Settings → Updates →
  **Check now**, or Ctrl+U, ⌘U on a Mac).
- A new version downloads in the background and must carry a signature made with the project's
  update key, which is built into Kento, for exactly the version announced. Anything else is
  refused. How the key is kept is in [docs/SIGNING.md](docs/SIGNING.md).
- Once it is downloaded, no new job starts. Running and queued jobs finish, then Kento says so,
  restarts and installs the new version. Your settings, Library, shelf, recipes, rules and tools
  stay.
- Without a connection Kento keeps working, and updates at the first check after the connection
  returns.
- The check reads one small file, `latest.json`, from this repository's newest release on GitHub.
  It sends nothing about you, your computer or your files; GitHub sees the request like any
  download.
- The notes of the new version appear on its first start.

## Privacy

- **Local first.** Conversion and editing happen on your computer. No file is uploaded, and there is
  no account, analytics, telemetry or crash report.
- **Kento goes online only** to check for updates and download them, to download a tool you agreed
  to install (or a newer yt-dlp when you ask), and to download a link you asked for (reading what
  the link holds, the pictures shown in the dialog and the files themselves).
- It never takes cookies from your browser and never watches the clipboard: it reads the clipboard
  only when you paste, or press Ctrl+Shift+D.
- Office documents are converted with macros off, and nothing they link to is loaded from the
  internet.
- Logs stay on your computer, are rotated, and never contain what is in your files.
- Data lives in `%LOCALAPPDATA%\Kento` on Windows and `~/Library/Application Support/Kento` on a
  Mac: settings, the Library list, the shelf, recipes, rules, downloaded tools and logs. Updates
  never delete it.
- The only numbers the author sees are the download counts GitHub keeps for every release file.

## Languages

Kento speaks twelve languages and follows the system's language; Settings → Language changes it at
once, in every window: English, Turkish, Spanish, Simplified Chinese, Japanese, German, French,
Brazilian Portuguese, Arabic (right to left), Korean, Italian and Russian. English and Turkish are
checked by hand; the other ten are new and wait for a native speaker's review. Corrections are
welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Build from source

You need Node.js 24, the stable Rust toolchain (on Windows with the Visual Studio Build Tools and
their C++ workload; on macOS with the Xcode Command Line Tools) and, on Windows, WebView2, which
Windows 10 and 11 already have.

```sh
npm ci
npm run pdfium                        # the pinned PDFium library Kento ships with
npm run tauri dev                     # run Kento with live reload
npm run tauri build -- --no-bundle    # release builds of kento and kento-cli in src-tauri/target/release
```

A full build with the installer or the disk image also signs the update files, so it needs
`TAURI_SIGNING_PRIVATE_KEY`; for a local test, a throwaway key from `npx tauri signer generate`
will do. Releases are described in [docs/RELEASING.md](docs/RELEASING.md).

CI runs these on Windows and macOS for every push and pull request:

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run check:i18n
npm run check:spdx
npm run check:licenses
npm run check:third-party
cargo fmt --all --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

plus `cargo deny check` in `src-tauri`, a check that [docs/FORMATS.md](docs/FORMATS.md) matches the
catalog (`npm run catalog:export` writes it), a release build, `kento --smoke-test` and a run of the
command line. [CONTRIBUTING.md](CONTRIBUTING.md) explains which tests need FFmpeg, LibreOffice and
the other tools.

The design system is in [design/DESIGN.md](design/DESIGN.md), the specification in
[docs/SPEC.md](docs/SPEC.md) and the structure of the code in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributing

Issues and pull requests are welcome; for larger changes, please open an issue first.
[CONTRIBUTING.md](CONTRIBUTING.md) explains how. Please report security problems privately, as
[SECURITY.md](SECURITY.md) describes. Everyone taking part follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

[MIT](LICENSE) © 2026 Mehmet Burak Taşkaya. Kento is built on open-source packages, listed with
their licences in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and with their versions and
checksums in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

---

<p align="center">Made by Mehmet Burak Taşkaya · <a href="https://mehmetburaktaskaya.com">mehmetburaktaskaya.com</a></p>
