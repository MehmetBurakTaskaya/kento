// SPDX-License-Identifier: MIT
// Writes THIRD-PARTY-NOTICES.md, the licence texts of everything that ships inside Kento and the
// terms of the tools it downloads on request, and docs/DEPENDENCIES.md, every dependency's version,
// source, checksum and licence (SPEC 4.4). Both come from the lockfiles, so the output never depends
// on the computer or the day it is made.
//   npm run third-party              writes both files (needs Cargo and an installed node_modules)
//   npm run check:third-party        fails when either file is out of date
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tauri = path.join(root, 'src-tauri');
const check = process.argv.includes('--check');
const read = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');
const cargo = (args) => execFileSync('cargo', args, { cwd: tauri, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
// Never localeCompare: the order must not depend on the computer's language (Turkish sorts I apart).
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byPackage = (a, b) => byText(a.name, b.name) || byText(a.version, b.version);

// ---------------------------------------------------------------------------------------------
// Rust: the crates the Windows and macOS builds link (normal dependencies only: build scripts,
// procedural macros, tests and dev tools do not ship), as Cargo.lock pins them. Procedural macros
// would also bring the dependencies of the computer running the script, whatever the target.

const TARGETS = {
  'x86_64-pc-windows-msvc': 'Windows',
  'aarch64-apple-darwin': 'macOS',
  'x86_64-apple-darwin': 'macOS',
};

const cargoLock = new Map();
for (const block of read('src-tauri', 'Cargo.lock').replace(/\r\n?/g, '\n').split('\n[[package]]\n').slice(1)) {
  const field = (key) => new RegExp(`^${key} = "([^"]*)"$`, 'm').exec(block)?.[1];
  cargoLock.set(`${field('name')}@${field('version')}`, { source: field('source'), checksum: field('checksum') });
}

const manifests = new Map(
  JSON.parse(cargo(['metadata', '--format-version', '1', '--locked'])).packages.map((p) => [
    `${p.name}@${p.version}`,
    { dir: path.dirname(p.manifest_path), file: p.license_file, authors: p.authors },
  ]),
);

const crates = new Map();
for (const [target, platform] of Object.entries(TARGETS)) {
  const tree = cargo([
    'tree',
    '--locked',
    '--workspace',
    '--edges',
    'normal,no-proc-macro',
    '--target',
    target,
    '--prefix',
    'none',
    '--format',
    '{p}|{l}',
  ]);
  for (const line of tree.split(/\r?\n/)) {
    const match = /^(\S+) v(\S+)[^|]*\|(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, name, version, declared] = match;
    const key = `${name}@${version}`;
    const pin = cargoLock.get(key);
    // Kento's own crates have no source in the lockfile.
    if (!pin?.source) continue;
    if (!crates.has(key)) {
      // Cargo marks a crate it already printed with "(*)".
      const license = declared.replace(/\s*\(\*\)\s*$/, '').trim() || 'UNKNOWN';
      crates.set(key, { name, version, license, ...pin, ...manifests.get(key), platforms: new Set() });
    }
    crates.get(key).platforms.add(platform);
  }
}
const rust = [...crates.values()].sort(byPackage);

// ---------------------------------------------------------------------------------------------
// npm: the packages the page is built from (dependencies, not devDependencies), as
// package-lock.json pins them. Their licence files come from node_modules.

function licenseOf(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

const npm = Object.entries(JSON.parse(read('package-lock.json')).packages)
  .filter(([location, entry]) => location && !entry.dev && !entry.devOptional && !entry.link)
  .map(([location, entry]) => {
    const dir = path.join(root, location);
    const file = path.join(dir, 'package.json');
    if (!existsSync(file)) throw new Error(`${location} is not installed: run npm ci first`);
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
    return {
      name: location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: entry.version,
      license: entry.license ?? licenseOf(manifest),
      resolved: entry.resolved,
      integrity: entry.integrity,
      dir,
      authors: author ? [author] : [],
      npm: true,
    };
  })
  .sort(byPackage);

// ---------------------------------------------------------------------------------------------
// PDFium: the release and builds `npm run pdfium` fetches, read from that script.

const fetcher = read('scripts', 'fetch-pdfium.mjs').replace(/\r\n?/g, '\n');
const pdfiumRelease = /^const RELEASE = '([^']+)';$/m.exec(fetcher)?.[1];
const pdfiumUrl = /`(https:\/\/github\.com\/[^`]+\.tgz)`/.exec(fetcher)?.[1];
const pdfiumBuilds = [...fetcher.matchAll(/'([\w-]+)': \{\s*sha256: '([0-9a-f]{64})',\s*library: '([^']+)'/g)].map(
  ([, name, sha256, library]) => ({
    name,
    sha256,
    library: path.posix.basename(library),
    url: pdfiumUrl?.replace('${RELEASE}', pdfiumRelease).replace('${name}', name),
  }),
);
if (!pdfiumRelease || !pdfiumUrl || pdfiumBuilds.length === 0) {
  throw new Error('scripts/fetch-pdfium.mjs changed shape: teach scripts/third-party.mjs to read it');
}
const PDFIUM_PLATFORMS = { 'win-x64': 'Windows x64', 'mac-univ': 'macOS (universal)' };

// ---------------------------------------------------------------------------------------------
// The tools Kento downloads on request, as src-tauri/toolchain.lock.json pins them.

const TOOLS = {
  ffmpeg: {
    name: 'FFmpeg',
    license: 'GPL-3.0-or-later',
    home: 'https://ffmpeg.org',
    terms: 'https://ffmpeg.org/legal.html',
  },
  ffprobe: {
    name: 'FFmpeg',
    license: 'GPL-3.0-or-later',
    home: 'https://ffmpeg.org',
    terms: 'https://ffmpeg.org/legal.html',
  },
  'yt-dlp': {
    name: 'yt-dlp',
    license: 'Unlicense; the program file GPL-3.0-or-later',
    home: 'https://github.com/yt-dlp/yt-dlp',
    terms: 'https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE',
  },
  deno: {
    name: 'Deno',
    license: 'MIT',
    home: 'https://deno.com',
    terms: 'https://github.com/denoland/deno/blob/main/LICENSE.md',
  },
  soffice: {
    name: 'LibreOffice',
    license: 'MPL-2.0',
    home: 'https://www.libreoffice.org',
    terms: 'https://www.libreoffice.org/about-us/licenses/',
  },
  exiftool: {
    name: 'ExifTool',
    license: 'Artistic-1.0-Perl OR GPL-1.0-or-later',
    home: 'https://exiftool.org',
    terms: 'https://exiftool.org',
  },
  onnxruntime: {
    name: 'ONNX Runtime',
    license: 'MIT',
    home: 'https://onnxruntime.ai',
    terms: 'https://github.com/microsoft/onnxruntime/blob/main/LICENSE',
  },
  'bg-model': {
    name: 'BEN2 Base (background-removal model)',
    license: 'MIT',
    home: 'https://huggingface.co/PramaLLC/BEN2',
    terms: 'https://huggingface.co/PramaLLC/BEN2',
  },
};
const GROUPS = { media: 'Media', office: 'Office', extras: 'Extras' };
const PLATFORMS = {
  'windows-x64': 'Windows x64',
  'macos-arm64': 'macOS (Apple silicon)',
  'macos-x64': 'macOS (Intel)',
};

const toolchain = JSON.parse(read('src-tauri', 'toolchain.lock.json'));
const tools = [];
const toolFiles = [];
const toolSources = [];
for (const group of toolchain.groups) {
  const groupName = GROUPS[group.id] ?? group.id;
  for (const id of group.tools) {
    if (!TOOLS[id])
      throw new Error(`toolchain.lock.json names the tool "${id}": add its licence to scripts/third-party.mjs`);
    tools.push({ id, group: groupName, version: group.versions?.[id] ?? group.version, ...TOOLS[id] });
  }
  for (const [platform, entry] of Object.entries(group.platforms)) {
    toolSources.push({ group: groupName, platform: PLATFORMS[platform] ?? platform, source: entry.source });
    for (const file of entry.files) {
      // One download may hold several programs (FFmpeg's archive holds ffmpeg and ffprobe).
      const held = [
        ...new Map(Object.keys(file.entries).map((id) => [TOOLS[id].name, tools.find((t) => t.id === id)])).values(),
      ];
      toolFiles.push({ tools: held, platform: PLATFORMS[platform] ?? platform, ...file });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Licence texts.

// LICENSE, LICENSE-MIT, LICENCE.md, COPYING, NOTICE, COPYRIGHT…
const LICENCE_FILE = /^(licen[cs]e|copying|notice|copyright)([-._].*)?$/i;
const STANDARD = path.join(root, 'scripts', 'licences');
// Crates that build another project's code into Kento, and where that code's licence is. A crate
// with a vendor folder that is not listed here stops the script, so none is missed.
const VENDORED = {
  unrar_sys: { label: 'UnRAR', files: ['vendor/unrar/license.txt'] },
  'libwebp-sys': { label: 'libwebp', files: ['vendor/COPYING', 'vendor/PATENTS'] },
};

const holdersOf = (p) =>
  p.authors?.length ? p.authors.map((a) => a.replace(/\s*<[^>]*>/g, '').trim()).join(', ') : `the ${p.name} authors`;

/** The licence texts a package ships, or the standard texts of its licences when it ships none. */
function textsOf(p) {
  const files = new Set();
  if (p.file) files.add(path.resolve(p.dir, p.file));
  if (p.dir && existsSync(p.dir)) {
    // statSync follows links, so a linked licence counts on every system.
    for (const name of readdirSync(p.dir)) {
      if (LICENCE_FILE.test(name) && statSync(path.join(p.dir, name)).isFile()) files.add(path.join(p.dir, name));
    }
  } else {
    throw new Error(`${p.name} ${p.version}: its files are not on this computer (cargo fetch, npm ci)`);
  }
  const shipped = [...files].sort(byText).map((file) => readFileSync(file, 'utf8'));
  if (shipped.length > 0) return { texts: shipped, standard: false };
  const ids = p.license
    .split(/\s+(?:OR|AND|WITH)\s+|[()/]/)
    .map((id) => id.trim())
    .filter(Boolean);
  const known = ids.filter((id) => existsSync(path.join(STANDARD, `${id}.txt`)));
  if (known.length === 0) {
    throw new Error(`${p.name} ${p.version} ships no licence text, and scripts/licences has none for ${p.license}`);
  }
  return {
    texts: known.map((id) => read('scripts', 'licences', `${id}.txt`).replaceAll('<copyright holders>', holdersOf(p))),
    standard: true,
  };
}

// The same text the same on every computer: LF line ends, no trailing spaces; trim() also drops a
// byte order mark.
const normalise = (text) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
// Many crates ship the Apache License 2.0 with their own preamble or appendix: its terms are printed
// once, at the end, and each copy keeps only what differs.
const APACHE_TERMS = /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION[\s\S]*?END OF TERMS AND CONDITIONS/;
const APACHE_NOTE = '[The terms and conditions of the Apache License, Version 2.0 are printed once, at the end.]';
let apacheTerms = null;
function shorten(text) {
  const terms = APACHE_TERMS.exec(text);
  if (!terms) return text;
  apacheTerms ??= terms[0];
  return text.replace(APACHE_TERMS, APACHE_NOTE);
}

// One section per text, kept apart for packages that ship it and packages given its standard text.
const groups = new Map();
function addText(text, user, standard) {
  const key = `${standard}\n${text}`;
  const group = groups.get(key) ?? { text, users: new Set(), standard };
  group.users.add(user);
  groups.set(key, group);
}
const label = (p) => `${p.name} ${p.version}${p.npm ? ' (npm)' : ''}`;
for (const p of [...rust, ...npm]) {
  const { texts, standard } = textsOf(p);
  for (const text of texts) addText(shorten(normalise(text)), label(p), standard);
  const vendored = VENDORED[p.name];
  if (vendored) {
    for (const file of vendored.files) {
      addText(
        shorten(normalise(readFileSync(path.join(p.dir, file), 'utf8'))),
        `${vendored.label} in ${label(p)}`,
        false,
      );
    }
  } else if (!p.npm && existsSync(path.join(p.dir, 'vendor')) && statSync(path.join(p.dir, 'vendor')).isDirectory()) {
    throw new Error(`${p.name} ${p.version} has a vendor folder: add the licence of its code to VENDORED`);
  }
}

// The packaging of the PDFium build ships this text as LICENSE; the copy in scripts/licences keeps
// the notices the same on every computer, and is checked against a fetched build when there is one.
const pdfiumLicence = normalise(read('scripts', 'licences', 'pdfium-binaries.txt'));
const fetchedLicence = path.join(tauri, 'resources', 'pdfium', 'LICENSE');
if (existsSync(fetchedLicence) && normalise(readFileSync(fetchedLicence, 'utf8')) !== pdfiumLicence) {
  throw new Error('The fetched PDFium has another LICENSE: copy it to scripts/licences/pdfium-binaries.txt');
}

// ---------------------------------------------------------------------------------------------
// Markdown.

const cell = (text) => String(text).replaceAll('|', '\\|');
const table = (head, rows) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
const fence = (text) => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const marks = '`'.repeat(longest + 1);
  return `${marks}text\n${text}\n${marks}`;
};
const megabytes = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;
const platformsOf = (crate) => ['Windows', 'macOS'].filter((p) => crate.platforms.has(p)).join(', ');
const unrar = rust.find((c) => c.name === 'unrar_sys');
const webp = rust.find((c) => c.name === 'libwebp-sys');
const webview = rust.find((c) => c.name === 'webview2-com-sys');
const fonts = npm.filter((p) => p.name.startsWith('@fontsource'));

// The themes' recorded sounds: CC0 recordings from Freesound, cut by scripts/theme-sounds.mjs. CC0
// asks for no credit; each is named with its author all the same.
const soundSources = existsSync(path.join(root, 'src', 'theme', 'sounds', 'sources.json'))
  ? JSON.parse(read('src', 'theme', 'sounds', 'sources.json'))
  : null;
const themeNames = Object.fromEntries(JSON.parse(read('src', 'theme', 'catalog.json')).map((e) => [e.id, e.name]));
const themeSounds = soundSources
  ? (() => {
      const users = new Map();
      for (const [theme, voices] of Object.entries(soundSources.themes))
        for (const clips of Object.values(voices).filter(Array.isArray))
          for (const clip of clips) {
            const names = users.get(String(clip.from)) ?? new Set();
            names.add(themeNames[theme] ?? theme);
            users.set(String(clip.from), names);
          }
      const ids = [...users.keys()].sort((a, b) => Number(a) - Number(b));
      return `### Theme sounds

The themes' sounds are cut from ${ids.length} recordings published on [Freesound](https://freesound.org)
under CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>), which waives every right to
them and asks for no credit. They are listed with their authors all the same, with the themes that
use them.

${ids
  .map((id) => {
    const r = soundSources.recordings[id];
    return `- "${r.title}" by ${r.author}, <${r.page}>: ${[...users.get(id)].sort(byText).join(', ')}`;
  })
  .join('\n')}

`;
    })()
  : '';
const toolRows = [...new Map(tools.map((t) => [t.name, t])).values()];

const textSections = [...groups.values()]
  .map((group) => ({ ...group, users: [...group.users].sort(byText) }))
  .sort((a, b) => byText(a.users[0], b.users[0]) || byText(a.text, b.text))
  .map(
    (group) =>
      `**Used by:** ${group.users.join(', ')}\n\n${
        group.standard
          ? `${group.users.length === 1 ? 'This package ships no licence file; this is the standard text of its licence.' : 'These packages ship no licence file; this is the standard text of their licence.'}\n\n`
          : ''
      }${fence(group.text)}\n`,
  );

const notices = `# Third-party notices

Kento is free software under the [MIT License](LICENSE), copyright (c) 2026 Mehmet Burak Taşkaya.
It is built on open-source software, and it can download free tools when you ask for them. This
file gives their licences; [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) lists every dependency with
its version, source and checksum.

It is generated by \`npm run third-party\` from \`src-tauri/Cargo.lock\`, \`package-lock.json\`,
\`scripts/fetch-pdfium.mjs\` and \`src-tauri/toolchain.lock.json\`. Do not edit it by hand.

- [Inside Kento](#inside-kento)
- [Tools Kento downloads on request](#tools-kento-downloads-on-request)
- [Licence texts](#licence-texts)

## Inside Kento

The Windows and macOS builds contain ${rust.length} Rust crates (the core, its engines and the
command line), ${npm.length} npm packages (the interface and its font) and the PDFium library.
Each text under [Licence texts](#licence-texts) names the packages that ship it. Where a package
offers a choice of licences, the texts it ships are given.

### Font

${fonts
  .map(
    (p) =>
      `The interface font is IBM Plex Sans, bundled from \`${p.name}\` ${p.version} under the\nSIL Open Font License 1.1 (${p.license}). Its text is under [Licence texts](#licence-texts).`,
  )
  .join('\n\n')}

### PDFium

Kento reads and draws PDF pages with PDFium, which it ships: release \`${pdfiumRelease}\` of the
[pdfium-binaries](https://github.com/bblanchon/pdfium-binaries) builds, ${pdfiumBuilds
  .map((b) => `\`${b.library}\` for ${PDFIUM_PLATFORMS[b.name] ?? b.name}`)
  .join(' and ')}. PDFium is copyright The PDFium Authors under the BSD-3-Clause licence
(<https://pdfium.googlesource.com/pdfium/>), and the build contains other libraries under their own
licences. Their texts come with the build in its \`licenses\` folder, which \`npm run pdfium\` puts
beside the library and Kento installs with it. The build's own licence:

${fence(pdfiumLicence)}

${themeSounds}### Code from other projects built into Kento

Some crates compile another project's code into Kento. Their texts are under
[Licence texts](#licence-texts) too.

- **UnRAR**, in \`${unrar.name}\` ${unrar.version}: the UnRAR source by Alexander Roshal. Its
  licence lets any program use it to handle RAR archives, but not to make a RAR-compatible archiver
  or re-create the RAR compression algorithm. Kento uses it only to read and extract RAR archives,
  and never writes one.
- **libwebp**, in \`${webp.name}\` ${webp.version}: Google's WebP library, under the BSD-3-Clause
  licence with Google's patent grant.
- **WebView2 loader**, in \`${webview.name}\` ${webview.version} (Windows only): Microsoft's
  \`WebView2LoaderStatic.lib\` from the WebView2 SDK, copyright Microsoft Corporation, under the
  licence published with the SDK's
  [Microsoft.Web.WebView2](https://www.nuget.org/packages/Microsoft.Web.WebView2) package.

## Tools Kento downloads on request

Kento does not include these tools. When you choose a group in the tool setup (Media, Office or
Extras), Kento downloads the pinned files from their publishers, checks each against its SHA-256
before anything runs, and keeps only the programs it needs. It runs the tools as separate programs
and passes them arguments; none of them is linked with Kento's code, so their licences do not change
Kento's. A tool already on your computer is used instead when it is recent enough.

${table(
  ['Tool', 'Group', 'Version', 'Licence', 'Project'],
  toolRows.map((t) => [t.name, t.group, t.version, `[${t.license}](${t.terms})`, `<${t.home}>`]),
)}

- **FFmpeg.** The builds Kento downloads include GPL-licensed libraries (libx264 among them), so
  they are under the GNU General Public License, version 3 or later
  (<https://www.gnu.org/licenses/gpl-3.0.html>). FFmpeg's source code: <https://ffmpeg.org/download.html>.
- **yt-dlp.** yt-dlp's own code is released under the Unlicense. Its program file bundles Python
  and other libraries, and is distributed as a whole under the GNU General Public License,
  version 3 or later. Settings → Tools → Update yt-dlp replaces it with the newest yt-dlp release,
  checked against that release's published SHA-256 sums.
- **LibreOffice** is under the Mozilla Public License 2.0 (<https://www.mozilla.org/MPL/2.0/>), with
  parts under other licences that LibreOffice lists itself.
- **ExifTool** is free software under the same terms as Perl itself: the Artistic License or the
  GNU General Public License (<https://dev.perl.org/licenses/>). Its Windows package includes the
  Perl it runs on.
- **ONNX Runtime** and **Deno** are under the MIT License. The **BEN2 Base** model, by Prama LLC,
  is under the MIT License; Kento uses only permissively licensed models.

Where the files come from, as \`src-tauri/toolchain.lock.json\` describes them:

${toolSources.map((s) => `- **${s.group}, ${s.platform}.** ${s.source}`).join('\n')}

## Licence texts

${textSections.join('\n')}${
  apacheTerms ? `\n### Apache License, Version 2.0: terms and conditions\n\n${fence(apacheTerms)}\n` : ''
}`;

const dependencies = `# Dependencies

Every dependency of Kento's Windows and macOS builds, with its version, source, checksum and
licence. Generated by \`npm run third-party\` from the lockfiles; do not edit it by hand. The licence
texts are in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).

${table(
  ['', 'Count'],
  [
    ['Rust crates', rust.length],
    ['npm packages', npm.length],
    ['Bundled library (PDFium)', 1],
    ['Tools downloaded on request', toolRows.length],
  ],
).replace('| --- | --- |', '| --- | ---: |')}

Tools used only to build, test and develop Kento (Rust build and dev dependencies, npm
devDependencies) do not ship and are not listed.

## Rust crates

From crates.io, as \`src-tauri/Cargo.lock\` pins them. The checksum is the SHA-256 of the crate file,
which Cargo checks when it downloads it. Platforms are the builds that contain the crate.

${table(
  ['Crate', 'Version', 'Licence', 'Platforms', 'SHA-256'],
  rust.map((c) => [
    `[${c.name}](https://crates.io/crates/${c.name}/${c.version})`,
    c.version,
    c.license,
    platformsOf(c),
    c.checksum ? `\`${c.checksum}\`` : 'not recorded',
  ]),
)}

## npm packages

From the npm registry, as \`package-lock.json\` pins them. The checksum is the integrity hash npm
checks when it downloads the package. Vite bundles what the pages use into the app.

${table(
  ['Package', 'Version', 'Licence', 'Integrity'],
  npm.map((p) => [
    `[${p.name}](https://www.npmjs.com/package/${p.name}/v/${p.version})`,
    p.resolved ? `[${p.version}](${p.resolved})` : p.version,
    p.license,
    p.integrity ? `\`${p.integrity}\`` : 'not recorded',
  ]),
)}

## PDFium

Release \`${pdfiumRelease}\` of the pdfium-binaries builds, fetched by \`npm run pdfium\` and checked
against its SHA-256 before it is unpacked.

${table(
  ['Build', 'Platform', 'File', 'SHA-256', 'Licence'],
  pdfiumBuilds.map((b) => [
    b.name,
    PDFIUM_PLATFORMS[b.name] ?? b.name,
    `[${path.posix.basename(b.url)}](${b.url})`,
    `\`${b.sha256}\``,
    'BSD-3-Clause (PDFium), MIT (the build), the licences in its licenses folder',
  ]),
)}

## Tools downloaded on request

Downloaded only when you ask, from \`src-tauri/toolchain.lock.json\`; each file is checked against its
size and SHA-256 before anything is unpacked. yt-dlp can be updated on its own to a newer release
(Settings → Tools → Update yt-dlp).

${table(
  ['Tool', 'Version', 'Licence', 'Platform', 'File', 'Size', 'SHA-256'],
  toolFiles.map((f) => [
    f.tools.map((t) => t.name).join(', '),
    f.tools.map((t) => t.version).join(', '),
    f.tools.map((t) => t.license).join(', '),
    f.platform,
    `[${decodeURIComponent(path.posix.basename(new URL(f.url).pathname))}](${f.url})`,
    megabytes(f.size),
    `\`${f.sha256}\``,
  ]),
)}
`;

const outputs = [
  [path.join(root, 'THIRD-PARTY-NOTICES.md'), notices],
  [path.join(root, 'docs', 'DEPENDENCIES.md'), dependencies],
];

if (check) {
  const stale = outputs.filter(([file, content]) => !existsSync(file) || readFileSync(file, 'utf8') !== content);
  for (const [file] of stale) console.error(`${path.relative(root, file)} is out of date: run npm run third-party`);
  if (stale.length === 0) console.log('THIRD-PARTY-NOTICES.md and docs/DEPENDENCIES.md are current.');
  process.exit(stale.length ? 1 : 0);
}
for (const [file, content] of outputs) writeFileSync(file, content);
const standard = [...groups.values()].filter((g) => g.standard).length;
console.log(
  `third-party: ${rust.length} Rust crates, ${npm.length} npm packages, ${toolRows.length} tools, ${groups.size} licence texts` +
    (standard ? ` (${standard} standard texts for packages that ship none)` : ''),
);
