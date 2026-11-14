# Changelog

All notable changes to Kento are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.2] - 2026-11-14

### Fixed

- On Windows an update could close Kento without installing, and Kento then tried again at every
  start and closed itself shortly after (from 1.2.0 to 1.2.1 on some computers). The installer now
  waits for the Kento that started it to end before replacing it, an update that still fails starts
  the old Kento again, and Kento says the update did not install and tries that version again only
  when you choose Check now in Settings › Updates or when a newer version is out.
- A failed install no longer removes the `kento` command line.

## [1.2.1] - 2026-11-14

### Fixed

- Sound effects were hard to hear, and some themes much quieter than others: every sound of every
  theme now plays at a level measured for it, so all 51 themes are equally loud, and louder than
  before at the same volume. Settings shows the volume as a percentage and plays the theme's sound
  when you change it.

## [1.2.0] - 2026-11-07

### Added

- **Make vertical:** a 1080 × 1920 video for short-video apps from a whole video or a part of it,
  either a 9:16 window you place on the picture or the whole picture over a blurred copy of itself
  or a color.
- **Cut out parts** and **Remove pauses**, for video and audio: take out the parts you mark, or the
  quiet gaps Kento finds and shows on the timeline before anything is cut, and join the rest.
- **Add music:** mixed under a video's own sound or replacing it, stepping back while someone
  speaks, from any point of the song, repeated if it is shorter, fading in and out.
- **Add text or logo:** text in four typefaces with an outline or a box, and pictures, placed and
  sized on the video, each with its opacity and its own time.
- **Fade and volume** and **Remove noise**, for video and audio.
- **Rotate video**, **Reverse and loop** (backwards, a boomerang or repeated), **Color and look**
  (ready looks and sliders, previewed exactly) and **Stabilize video**.
- **Merge audio**, with an optional crossfade, and **Make a ringtone** (up to 40 seconds as M4R or
  MP3).
- Redact video can erase a small mark of your own, such as a date stamp or your logo, by filling it
  in from what is around it.
- Merge videos takes a transition between clips: fade, through black, slide or wipe.
- Quick choices on the Tools wheel turn, mirror, reverse, make a boomerang, make vertical, apply a
  look, remove noise or stabilize at once.
- The command line runs Remove noise, Remove pauses, Stabilize video, Rotate video and Merge audio,
  and Merge videos with a transition; folder rules can remove noise or pauses.
- **Every theme sounds like what it shows.** New sounds for all fifty themes beside Kasa: pointing
  at a slice of Karpuz takes a juicy bite, Damla drips paint, Plak crackles, Tebeşir taps chalk, Bom
  goes boom. Each theme also has its own sounds for opening a ring of choices and going back.

### Fixed

- Trim audio saves again: every trim ended in an error, with or without removing the silence.
- A damaged or deliberately malformed XLS or XLSB spreadsheet can no longer crash Kento or use up
  its memory: the spreadsheet reader is updated to a version that checks such files.

## [1.1.1] - 2026-11-03

### Fixed

- In Turkish, file extensions keep their usual capitals: folder rules show HEIC and ZIP, not HEİC and
  ZİP, and the Piksel, Yaldız and Bom themes write the key under the hub as SHIFT, not SHİFT.

## [1.1.0] - 2026-11-03

### Added

- **Themes.** Fifty more themes beside the steel dial, Kasa: 51 in all, each with its own name,
  wheel, palette for light and dark, motion and sounds, from rotary phone dials and record players
  to fruit, tiles, glass and paper. Settings → Appearance → Theme shows every theme's wheel and one
  to try; the choice colours every window (Home, Library, Settings, the shelf and the corner cards)
  at once, and the wheel opens as fast in every theme.
- The theme in use is shown at the foot of the side bar; clicking it opens the themes in Settings.
- In every theme, a slice that opens a ring of choices carries a small mark on its outer edge, as
  the steel dial's arrowhead does.

### Fixed

- The Settings icon is now a gear; it looked like a sun.

## [1.0.2] - 2026-11-03

### Fixed

- The Mac app is built and signed: the command line inside it is now signed before the app, so
  macOS accepts the bundle. Version 1.0.0 was published for Windows only.

### Changed

- Kento for Mac needs macOS 13 or later, the oldest version its PDF library runs on.

## [1.0.0] - 2026-11-03

The first release. Everything happens on your computer: there is no account, analytics or
telemetry, and Kento goes online only to update itself, to download the tools you install and to
download the links you ask for.

### Added

- **The wheel and the ways in.** Drag files anywhere and press Shift, Ctrl or Alt (Shift, ⌘ or ⌃ on
  a Mac): a steel safe dial opens under the pointer with the Convert, Tools or File actions wheel.
  Drop the files on a slice and the job runs at once. The wheel stays open when you let go of the
  key, shows only what fits every selected file and opens a mixed selection by kind. Rest on a slice
  for its ring of choices (quality, size, one PDF or several, presets, recent folders) and on the
  hub to go back. It works with the keyboard and screen readers, with soft sounds and, on a Mac,
  haptic feedback. Ctrl+Shift+Space (⌃⇧Space) opens it for the files selected in Explorer or
  Finder; Home takes files dropped, chosen (Ctrl+O) or pasted (Ctrl+V); Explorer's Send To and
  right-click menus can open it too. Every job writes a new file next to the original and never
  overwrites one.
- **Conversions** between pictures (AVIF, BMP, GIF, HEIC, JPG, PNG, SVG, TIFF, WEBP, and ICO out),
  video, audio, documents, spreadsheets, presentations, PDF, subtitles and archives (RAR read only):
  355 routes, listed in [docs/FORMATS.md](docs/FORMATS.md). Pictures, PDF pages, archives, text and
  spreadsheets convert with no download; video, audio and office files use free tools that Kento
  downloads from their publishers when you ask, checked against a fixed SHA-256, or finds on your
  computer.
- **Tools.** Compress pictures, video, audio and PDF to a quality, a ratio or a target size such as
  "under 25 MB". View, edit and remove metadata. Six picture editors: edit, mark up, frame, crop,
  collage and redact. Split, edit and merge PDFs, and make one from pictures. Extract archives
  safely. Thirteen video and audio tools (remove audio, trim, crop, change speed, merge, extract
  frames, split, redact; normalize loudness, trim audio, audio channels, redact audio, audio to
  video) with one player, a waveform and the same keys.
- **File actions:** share, put on the shelf, copy or move to a folder (Move asks first, and recent
  folders come back), copy the path, open a terminal there, show in Explorer or Finder, and archive
  as ZIP, 7Z or TAR.GZ.
- **Shelf and Library.** The shelf holds files at the edge of the screen while you go to another
  folder, then you drag them where they belong; it keeps a history and shows when a file has moved.
  The Library (Ctrl+2) lists the last 50 results with search, a filter by type, previews and
  dragging out.
- **Web downloads.** Paste a link on Home, press Ctrl+Shift+D (⌃⇧D) with one copied, or drag it
  from the browser: download the video, only its audio, the original or the pictures of a photo
  post, in the quality and folder you choose. yt-dlp can be updated on its own from Settings.
- **Automation and recipes.** Rules watch folders and convert each new file, run a tool or a recipe
  on it, or move it. Recipes chain steps under a name, such as crop to 4:5, resize to 1080 px and
  compress under 2 MB, and appear on the wheel's Favorites slice, in rules and on the command line.
- **Remove background:** a transparent PNG from a picture, made on your computer with the BEN2 Base
  model.
- **Extract text (OCR)** from pictures and PDF pages, with the text recognition built into Windows
  and macOS.
- **QR codes:** read them from pictures and PDF pages, with a TXT, CSV or JSON report, and make
  them as PNG or SVG from a text or a link.
- **Subtitles:** SRT and VTT to each other and to text, and burned into a video.
- **Window layouts,** off until you turn them on: halves, quarters, center and full screen with
  Ctrl+Alt and the arrow keys (⌃⌥⌘ on a Mac), or from the Window ring.
- **Command line:** `kento convert`, `kento tool`, `kento recipe`, `kento formats` and
  `kento routes`, with JSON output and exit codes for scripts. The Windows installer puts it on
  your PATH.
- **Updates** are mandatory and signed. Kento looks for a new version at start, every 6 hours and
  with Ctrl+U (⌘U), downloads it in the background, lets the running jobs finish and restarts into
  it. The Windows installer (for your user, with no administrator rights), the portable ZIP and the
  Mac app all keep themselves up to date.
- **Languages:** English, Turkish, Spanish, Simplified Chinese, Japanese, German, French, Brazilian
  Portuguese, Arabic (right to left), Korean, Italian and Russian. Kento follows the system
  language, and Settings → Language changes it at once in every window.

[1.2.2]: https://github.com/MehmetBurakTaskaya/kento/releases/tag/v1.2.2
[1.2.1]: https://github.com/MehmetBurakTaskaya/kento/releases/tag/v1.2.1
[1.2.0]: https://github.com/MehmetBurakTaskaya/kento/releases/tag/v1.2.0
[1.1.1]: https://github.com/MehmetBurakTaskaya/kento/releases/tag/v1.1.1
[1.1.0]: https://github.com/MehmetBurakTaskaya/kento/releases/tag/v1.1.0
[1.0.2]: https://github.com/MehmetBurakTaskaya/kento/releases/tag/v1.0.2
[1.0.0]: https://github.com/MehmetBurakTaskaya/kento/releases/tag/v1.0.0
