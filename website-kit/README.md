# Website kit

Material for Kento's page on [mehmetburaktaskaya.com](https://mehmetburaktaskaya.com), where Kento is
one of the projects (the site is Astro, English at `/` and Turkish under `/tr/`). Everything here speaks
English and Turkish, follows the light or dark theme, works at phone width and makes no request to
another site except the GitHub API for the version line.

| File | What it is |
| --- | --- |
| `download-section.html` | The download section: one self-contained `<section>` to embed. |
| `conversion-table.html` | The searchable conversion table: one self-contained `<section>` that builds itself from `catalog.json`. |
| `catalog.json` | Formats, conversions, tools and file actions, written by `npm run catalog:export`. Never edit it by hand. |
| `index.html` | A one-page draft of Kento's page in English and Turkish, whose texts the project page can reuse. |
| `assets/dial.js` | Draws the wheel as SVG, for the hero of `index.html` and for the social cards. |
| `site/kento.yaml` | A draft of Kento's entry for the site's `src/content/projects/`. |
| `social/` | Social media cards, 1200 × 630, in English and Turkish: SVG sources and PNGs. |
| `demo-video.md` | The script and shot list of a 60–90 second demo video, and the plan for the README's demo GIF. |

## Looking at it locally

The draft pulls in the two sections and the catalog with `fetch`, which browsers refuse for files
opened from the disk, so serve the folder:

```sh
python -m http.server 4319 --directory website-kit
```

then open <http://localhost:4319/> (`?lang=tr` for Turkish; the EN/TR switch in the header does the
same). Without Python, `npx vite website-kit --port 4319` works too.

## The download section

`download-section.html` is one `<section class="kento-embed kento-download">`. Its styles apply only
inside that class, the icon is drawn inline, and a small script:

- recognises Windows or macOS and puts that platform's button first, with the other one under
  "Other platforms"; on a phone, a tablet or Linux both buttons stay side by side with a line saying
  that Kento is a desktop app for Windows and macOS;
- asks `https://api.github.com/repos/MehmetBurakTaskaya/kento/releases/latest` for the version, the
  date and the size of each file, and keeps the answer for an hour in the visitor's `localStorage`
  (`kento-release-v1`), because the API allows 60 requests an hour per visitor. Before the first
  release, offline, rate-limited, blocked or slow (8 seconds), the version line simply stays hidden;
  the request sends no cookies and no referrer;
- follows the page's language and theme as they change.

The buttons never depend on the script or on the API: they always point to
`https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/<file>`, which GitHub serves
from the newest published release:

| Platform | File |
| --- | --- |
| Windows installer | `Kento-Windows-x64-Setup.exe` |
| Windows, portable | `Kento-Windows-x64-Portable.zip` |
| macOS (Apple silicon and Intel) | `Kento-macOS-Universal.dmg` |
| Checksums | `SHA256SUMS.txt` |

The section also lists the release notes, the first-launch steps for SmartScreen and macOS, and the
signature: "Made by Mehmet Burak Taşkaya", the GitHub link and the license.

**Language.** The section speaks the language of the page (`<html lang="tr">`, or the nearest
element with a `lang`). `data-lang="tr"` or `data-lang="en"` on the section overrides it. Every
sentence appears twice, in `<span data-l="en">` and `<span data-l="tr">`; edit both. The few strings
the script writes (the version line, the sizes) are in the `TEXT` object at the top of the script.

**Theme.** Light by default, dark under `prefers-color-scheme: dark`, and it follows a site that
switches themes with `data-theme="light"` or `data-theme="dark"` on `<html>`, as
mehmetburaktaskaya.com does.

## The conversion table

`conversion-table.html` is one `<section class="kento-embed kento-formats">`. It loads
`catalog.json` and lists every format with its extensions, what it converts to, grouped by what does
the work (built into Kento, the system's HEIF support, FFmpeg from the Media tools, LibreOffice from
the Office tools), the notes of each conversion, and the tools the Tools wheel offers for each
category. A search field matches a format's name or extension (`heic`, `.docx`, `mp4`) or a category,
and buttons filter by category. Untouched, the table shows the first twelve formats and a "Show all"
button.

The catalog comes from `data-catalog` on the section or on any element around it, for example
`data-catalog="/kento/catalog.json"`; without one it is `catalog.json` next to the page. The catalog's
notes are in English; the script holds their Turkish forms in `NOTES_TR`, and a note it does not know
yet shows in English until it is added there.

### Refreshing the catalog

`catalog.json` and `docs/FORMATS.md` are generated from the Rust catalog (`src-tauri/src/catalog`):

```sh
npm run catalog:export
```

Commit both files with the change that caused them. Every release also carries `catalog.json` as an
asset. A page on another site cannot fetch release assets from github.com (the download addresses
send no CORS headers), so the website keeps its own copy: after a release, copy `catalog.json` to the
site again (step 3 below).

## On mehmetburaktaskaya.com

The site builds each app's page (`/projects/<slug>/` and `/tr/projects/<slug>/`) from a YAML file in
`src/content/projects/` through `src/components/pages/SoftwareAppPage.astro` and `ProjectEntry.astro`,
which already draw a plain download button per platform from the YAML's `download` list. Its checks
(`npm run check`) allow one inline script per page (the theme restore) and 2 KB of JavaScript in all,
and its Content-Security-Policy (written by `scripts/htaccess.mjs`) allows connections to the site
itself only. The steps below fit those rules; they were tried on a copy of the site, where
`npm run build`, `npm run check`, `npm run validate` and `npm run links` all passed once the budget in
step 6 was changed.

1. **Kento's entry.** Copy `site/kento.yaml` to `src/content/projects/kento.yaml` and adjust `order`.
   Its `download` list gives the page the site's usual buttons. If you add the download section
   (steps 2 and 4), set `download: null`, so the page does not show two sets of buttons. `card` and
   `screenshot` are `null` until there are pictures: put them in `src/assets/projects/kento/` and name
   them as Panopin's entry does; `video` waits for the demo (`demo-video.md`).
2. **The download section.** Create `src/components/KentoDownload.astro` and paste the whole content
   of `download-section.html` into it. Change `<style>` to `<style is:global>`, so Astro moves the
   styles into the page's stylesheet (they are already scoped by their class). Leave `<script>` as it
   is: Astro bundles it into a file under `/_astro/`, which the one-inline-script rule and
   `script-src 'self'` accept. Its first line, `// @ts-nocheck`, keeps `astro check` from
   type-checking the plain JavaScript. The page's `lang` chooses the language, so no `data-lang` is
   needed.
3. **The conversion table.** Create `src/components/KentoFormats.astro` the same way from
   `conversion-table.html` (`<style is:global>`, `<script>` unchanged), and add
   `data-catalog="/kento/catalog.json"` to its `<section>`. Copy `catalog.json` to
   `public/kento/catalog.json`.
4. **Put them on Kento's page.** In `src/components/pages/SoftwareAppPage.astro`, import both
   components and add them after `<ProjectEntry … />`:

   ```astro
   import KentoDownload from '../KentoDownload.astro';
   import KentoFormats from '../KentoFormats.astro';
   ```

   ```astro
   <ProjectEntry project={project} lang={lang} standalone />
   {slug === 'kento' && <KentoDownload />}
   {slug === 'kento' && <KentoFormats />}
   ```

   The sections take the full width of the content; to line them up with the entry's text column,
   wrap them in an element with the column's class.
5. **Let the page reach the GitHub API.** In `scripts/htaccess.mjs`, add the API to `connect-src`:

   ```js
   ["connect-src 'self'", 'https://api.github.com', ...counter].join(' '),
   ```

   Without it the browser refuses the request (the console shows a CSP error), the version line stays
   hidden and everything else works.
6. **The script budget.** The two sections' scripts are about 3.5 KB and 9.6 KB once built, and the
   site counts every script against 2 KB. Either raise the budget for these two files only, in
   `scripts/check-content.mjs`:

   ```js
   // Kento's download section and conversion table (website-kit) bring their own scripts, which only its page loads.
   const kentoScript = (p) => /[\\/]Kento(Download|Formats)\.astro_[^\\/]*\.js$/.test(p);
   const scriptBytes = distFiles.filter((p) => p.endsWith('.js') && !kentoScript(p)).reduce((sum, p) => sum + statSync(p).size, 0);
   if (scriptBytes > 2048) fail('dist', `ships ${scriptBytes} bytes of JavaScript; the budget is 2048`);
   const kentoBytes = distFiles.filter(kentoScript).reduce((sum, p) => sum + statSync(p).size, 0);
   if (kentoBytes > 16384) fail('dist', `Kento's sections ship ${kentoBytes} bytes of JavaScript; their budget is 16384`);
   ```

   or keep 2 KB and use the YAML's `download` list instead of the download section, and link
   `docs/FORMATS.md` on GitHub instead of the table. Without its script the download section still
   works (both buttons, no version line), but the table needs its script.
7. **Check.** `npm run build`, `npm run check`, `npm run validate` and `npm run links`; then
   `npm run dev` and look at `/projects/kento/` and `/tr/projects/kento/` at phone width and in dark
   mode, and click "Download for Windows" once to see the file arrive.

When the kit changes, paste the changed file again (keeping the two edits of step 2 or 3).

### On any other page

Paste the content of `download-section.html` or `conversion-table.html` where the section belongs.
Inline scripts and styles must be allowed there; otherwise follow the steps above. On a page whose
`lang` is not the section's language, add `data-lang="tr"` or `data-lang="en"` to the section.

## The one-page draft

`index.html` holds the texts of a full page, in both languages: the hero, the wheel and the ways in,
conversions (with the table), tools, file actions, the shelf, web downloads, folder rules and
recipes, background removal, text recognition, QR codes, subtitles, window layouts, the command line,
the privacy note, mandatory signed updates, questions, the download section and the signature. It
uses system fonts (IBM Plex Sans when it is installed). The wheel in its hero is drawn by
`assets/dial.js` from the design tokens of `design/DESIGN.md`; pointing at a slice turns the dial, and
a click throws the bolts.

The privacy note's promise is the app's: files never leave the computer; Kento goes online only for
update checks, for the tools the user agreed to download and for the links the user asked it to
download; nothing about the user is sent. Keep any rewrite to that. Words such as "secure", "safe",
"locked" or "protected" are never said about files (`design/DESIGN.md`, section 10).

## Social cards

`social/kento-card-en.png` and `social/kento-card-tr.png` (1200 × 630) are for posts and link
previews; GitHub's social preview takes them too (Settings › Social preview). Their sources are the
SVG files beside them, which name IBM Plex Sans and fall back to the system's font when it is
missing. To change them, edit `scripts/social-cards.mjs` and run:

```sh
node scripts/social-cards.mjs
```

It lays each card out in headless Chromium with the brand font, writes the SVG and renders the PNG
from it. The site's own Open Graph pictures are made by its `npm run og`.
