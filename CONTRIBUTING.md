# Contributing to Kento

Issues and pull requests are welcome. For larger changes, please open an issue first, so we can
agree on the approach before you spend time on it. Security problems are reported privately, as
[SECURITY.md](SECURITY.md) describes, and everyone taking part follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

What Kento does and why is written down in [docs/SPEC.md](docs/SPEC.md), the structure of the code
and the decisions behind it in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the look, motion and
sound of the default theme in [design/DESIGN.md](design/DESIGN.md), and every format, route and tool
in [docs/FORMATS.md](docs/FORMATS.md).

## Clean room

Kento's idea, a radial menu that opens while a file is dragged, is inspired by existing apps. Ideas
and interaction patterns are free to use; Kento's code, artwork, text and brand are its own, and
they stay that way:

- Do not open, read, clone or copy the source code of similar apps, and do not browse their
  repositories or websites for reference. [docs/SPEC.md](docs/SPEC.md) is the reference. For how to
  do something, use official documentation: Tauri, the Rust crates' docs, Microsoft Learn, Apple
  Developer, FFmpeg, LibreOffice, yt-dlp.
- Do not use or imitate another app's name, logo, icons, illustrations, colour palette, marketing
  copy or screenshots. The brand and the default theme use no fruit motifs.
- Fonts are openly licensed (OFL or similar) and embedded; sounds are synthesised in code or
  CC0-licensed; icons and artwork are drawn for Kento.
- Texts make no "first", "only" or "we invented" claims.

A pull request that does not follow these rules cannot be merged, however good it is otherwise.

## Building

You need Node.js 24, the stable Rust toolchain (on Windows with the Visual Studio Build Tools and
their C++ workload; on macOS with the Xcode Command Line Tools) and, on Windows, WebView2.

```sh
npm ci
npm run pdfium                        # the pinned PDFium library, needed before any Cargo build
npm run tauri dev                     # Kento with live reload
npm run tauri build -- --no-bundle    # release builds in src-tauri/target/release
npm run dev                           # only the page, in a browser, answering from memory
```

`npm run dev` and `npm run shots` work without the Rust core: `src/ipc.ts` answers from memory in a
plain browser. `?files=demo` and `?library=demo` fill Home and the Library with examples, and
`?wheel-demo=1` opens a page for trying the wheel.
`npm run shots` takes screenshots of the pages in English, Turkish and the two test languages into
`artifacts/app-shots`.

`npm run demo` remakes the README's demo GIFs (`docs/images/kento-demo.gif` and
`kento-demo-tr.gif`) and its screenshots (`docs/images/kento-*.webp`) from the same stand-in.
`scripts/demo/stage.html` is a plain desktop of our own around Kento's real windows (the floating
wheel, the corner card, the shelf and the main window, each the app in a frame);
`scripts/demo/stand-in.mjs` adds sample files from the real catalog and lets the stage play the
core's part; `scripts/record-demo.mjs` plays the storyboard in headless Chromium, three times
slower than life, and FFmpeg (on the PATH) turns the frames into GIFs. Each GIF is the tour
followed by the themes reel: `scripts/demo/themes.mjs` draws every theme's wheel with the app's own
Wheel in the app's page. A take is recorded again, three times at most, when the computer falls
behind in a part that moves on every frame (the count-ups), so close heavy programs first. Run it
again after a visible change to the wheel, the pages or a theme;
`--gif`, `--stills` and `--lang en` make only part of it, and `--themes` records the reel alone
(its frames, for a video of its own).

`npm run theme:levels` measures every sound of every theme and writes the gain that brings each to
its level into `src/theme/levels.json`, so all themes are equally loud. Run it after changing a
theme's sounds and commit the table with them; `-- --check` tells whether it is up to date.

A bundled build (`npm run tauri build` with the installer or the disk image) also signs the update
files and needs `TAURI_SIGNING_PRIVATE_KEY`. For a local test, make a throwaway key with
`npx tauri signer generate`; releases are signed by CI only (see [docs/RELEASING.md](docs/RELEASING.md)
and [docs/SIGNING.md](docs/SIGNING.md)).

## Checks

CI runs these on Windows and macOS for every push and pull request. Please run them before you open
a pull request:

```sh
npm run typecheck
npm run lint
npm run format:check            # npm run format fixes it
npm test
npm run check:i18n
npm run check:spdx
npm run check:licenses
npm run check:third-party       # npm run third-party brings the notices up to date
cargo fmt --all --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

In `src-tauri`, `cargo deny check` checks the licences and advisories of the Rust dependencies.
After a change to the catalog, `npm run catalog:export` writes `docs/FORMATS.md` and
`website-kit/catalog.json`; CI fails when they are out of date. The engines build and test on their
own: `cargo test -p kento-engines`.

Some tests need the tools Kento downloads on request. Without them they are skipped and say so; a
variable makes them fail instead, as in CI:

| Tests | Need | Found through | Required with |
| --- | --- | --- | --- |
| PDF | the fetched PDFium (`npm run pdfium`) | `src-tauri/resources/pdfium`, `KENTO_PDFIUM` | `KENTO_REQUIRE_PDFIUM=1` |
| Video and audio | FFmpeg 6 or newer and ffprobe | PATH, `KENTO_FFMPEG`, `KENTO_FFPROBE` | `KENTO_REQUIRE_FFMPEG=1` |
| Picture metadata | ExifTool 12 or newer | PATH, `KENTO_EXIFTOOL` | `KENTO_REQUIRE_EXIFTOOL=1` |
| Office | LibreOffice 7 or newer | PATH, its usual install folders, `KENTO_SOFFICE` | `KENTO_REQUIRE_SOFFICE=1` |
| Web downloads (against a local server, never the internet) | yt-dlp and Deno | PATH, `KENTO_YTDLP`, `KENTO_DENO` | `KENTO_REQUIRE_YTDLP=1` |
| Background removal | ONNX Runtime and the BEN2 Base model | `KENTO_ONNXRUNTIME`, `KENTO_BG_MODEL` | `KENTO_REQUIRE_BGREMOVE=1` |

`kento --smoke-test` starts a release build with a hidden window, checks the parts that exist and
writes `smoke-test.json` into the data folder. The second workflow,
[toolchain.yml](.github/workflows/toolchain.yml), installs every pinned tool for real, as the app
does on request.

## Code

- **Rust:** rustfmt's defaults and `cargo clippy -D warnings`. Errors with `thiserror`, logs with
  `tracing`. Never log what is in a file.
- **TypeScript and React:** strict TypeScript, ESLint and Prettier (single quotes, 120 columns).
  Design tokens are CSS custom properties; layout uses CSS logical properties only
  (`margin-inline-start`, `inset-inline-end`…), so right-to-left needs no rules of its own.
- **Comments** explain why, not what, and match the density of the code around them.
- **Every source file** starts with `// SPDX-License-Identifier: MIT` (or the comment form of its
  language) in its first lines; `npm run check:spdx` checks it.
- **Keep to the principles** of [SPEC 2](docs/SPEC.md#2-product-principles): work stays on the
  computer; a job writes a new file and never overwrites one (only Move touches the original);
  Kento goes online only for update checks, tool downloads and web downloads the user started; no
  analytics, telemetry or accounts; everything works with the keyboard; only free tools and
  services.
- **External tools** run as separate processes with their arguments as an array, never as a shell
  string. Paths from the page are checked in the Rust core.
- **A new format, route or tool** is a catalog entry in `src-tauri/src/catalog` and a handler; the
  wheel, `docs/FORMATS.md` and the website's conversion table follow from the catalog.

## Dependencies

- New dependencies need a reason; prefer what is already in the tree. Turn off the default
  features of heavy crates.
- Rust crates must carry a licence that `src-tauri/deny.toml` allows; npm packages that ship must
  pass `npm run check:licenses`. npm versions are pinned exactly (`.npmrc` sets `save-exact`).
- After any change to `Cargo.lock`, `package-lock.json`, `scripts/fetch-pdfium.mjs` or
  `src-tauri/toolchain.lock.json`, run `npm run third-party` and commit
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)
  with it.
- A tool Kento downloads is pinned in `src-tauri/toolchain.lock.json` with its address (HTTPS, the
  publisher's own release), size and SHA-256.

## Commits and pull requests

- Code, comments, commit messages, issues and pull requests are in English.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
  `fix:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:`, with a scope where it helps
  (`feat(wheel):`, `fix(office):`). The subject says what changes for the user or the code, in
  plain words: `fix(shortcut): read the selection of the Explorer tab that is on screen`.
- One logical change per commit, and a pull request that does one thing. Say how you tested it,
  and on which systems.
- User-facing changes get a line in [CHANGELOG.md](CHANGELOG.md), in words a user understands.

## Languages

Kento's interface ships in English and Turkish; Spanish, Simplified Chinese, Japanese, German,
French, Brazilian Portuguese, Arabic, Korean, Italian and Russian are planned. English is the
source. The README and the website stay in English and Turkish.

### Rules for code

- Every text the user sees lives in the files under `locales/`, never in code. The page reads them
  through i18next, the Rust core (tray menu, notes, the command line) through `src-tauri/src/i18n.rs`.
- A new text goes into `locales/en.json` and into every other locale file. Until it is translated,
  the English text may stand in a translation.
- Messages use ICU MessageFormat: plurals are written as `{count, plural, one {# file} other {#
  files}}`, never by adding an "s" in code. Numbers, dates, sizes and durations are formatted with
  `Intl` in the interface's language.
- Keys ending in `.mac` are the macOS version of the key without it: ⌘ instead of Ctrl, Finder
  instead of Explorer, macOS's own names for its settings.
- File names and paths inside text are isolated for right-to-left languages (`<bdi>`), so a name
  such as `photo (2).jpg` stays intact.
- Turkish needs locale-aware case mapping (i/İ, ı/I); never upper- or lower-case a text without the
  language.
- `npm run check:i18n` makes sure every file has the same keys and placeholders as English, every
  message is valid ICU, and every key the code uses exists.
- Development builds offer two test languages in Settings → Language: `en-XA` lengthens every text
  by about 40 % to catch overflow, and `ar-XB` lays the interface out right to left.

### The files

Each language is one file in `locales/`, named by its language tag: `tr.json`, `pt-BR.json`,
`zh-Hans.json` and so on. A file is a flat list of keys and texts in the order of `en.json`. The two
entries at the top describe the file itself:

```json
{
  "@language": "Türkçe",
  "@status": "needs review",
  "app.name": "Kento",
  …
}
```

`"@status"` is `"needs review"` until a native speaker has gone through the whole file, and
`"reviewed"` after that.

### Reviewing or translating a language

1. Choose the language in Kento (Settings → Language) and walk through Home, the Library,
   Automation, Settings, the wheels, the shelf, the tool panels and the download dialog. Note what
   reads wrong, sounds unnatural or is cut off.
2. Fix the texts in the language's file. GitHub's web editor is enough: open the file, press the
   pencil icon, and GitHub guides you to a pull request.
3. If you went through the whole file, change `"@status"` to `"reviewed"`. Partial fixes are just as
   welcome; then leave it as it is.
4. In the pull request, say which language you reviewed and, if you like, how you want to be
   credited.

Rules for texts:

- **Keep the placeholders.** Words in braces, such as `{count}`, `{name}` or `{format}`, are filled
  in by Kento. Keep each of them exactly; you may move them within the sentence.
- **Keep names** as they are: Kento, Windows, macOS, Explorer, Finder, FFmpeg, LibreOffice,
  ExifTool, yt-dlp, Deno, GitHub, and format names such as PNG or PDF.
- **Key names** stay as the operating system shows them in your language (German Strg, Umschalt),
  and the Mac symbols ⌘ ⌥ ⇧ ⌃ stay as they are.
- **Keep it short.** Many texts are labels on slices, buttons and menus with little room. Aim for
  no more than about a third longer than the English, and check the result in the app.
- **Use the same word for the same thing** throughout a file: wheel, slice, shelf, recipe, rule,
  Library and the tools' names in particular.
- Follow your language's punctuation and quotation marks, and keep the "→" in settings paths (a
  right-to-left language writes "←").

### Adding a language

1. Copy `locales/en.json` to `locales/<tag>.json`, set `"@language"` to the language's own name and
   `"@status"` to `"needs review"`, and translate the texts.
2. Add the file to `resources` in `src/i18n/index.ts` and to the dictionaries in
   `src-tauri/src/i18n.rs`, which already lists the twelve planned languages.
3. Run `npm run check:i18n`, `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml
   --workspace`, and look at the pages with `npm run shots` or in the app.

## Licence of contributions

Kento is released under the [MIT License](LICENSE). By contributing, you agree that your
contribution is released under the same licence, and you confirm that you have the right to submit
it: it is your own work, or it comes from a source whose licence allows this and is named in the
pull request. Code, text, artwork, fonts and sounds from sources whose licences are not compatible
with MIT, or whose origin is unclear, cannot be accepted.
