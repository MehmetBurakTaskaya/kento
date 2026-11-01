// SPDX-License-Identifier: MIT
// Downloads the PDFium library that ships inside Kento (SPEC 4.1) into src-tauri/resources/pdfium,
// pinned to one release of the pdfium-binaries builds and checked against its SHA-256.
//   node scripts/fetch-pdfium.mjs            the build for this computer
//   node scripts/fetch-pdfium.mjs mac-univ   a named build (win-x64, mac-univ)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE = 'chromium/8125';
const BUILDS = {
  'win-x64': {
    sha256: '9a964261760cff52570aabf038ab346d3a5034dd8b30d0d5fe8861235d356b8b',
    library: 'bin/pdfium.dll',
  },
  // One universal library serves both Apple silicon and Intel Macs.
  'mac-univ': {
    sha256: '0cf06803b9a4acc489fc967a1b05990622ca1cf41fa027ff9cc89eeab9b19279',
    library: 'lib/libpdfium.dylib',
  },
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src-tauri', 'resources', 'pdfium');
const name = process.argv[2] ?? (process.platform === 'win32' ? 'win-x64' : 'mac-univ');
const build = BUILDS[name];
if (!build) {
  console.error(`Unknown build "${name}"; known: ${Object.keys(BUILDS).join(', ')}`);
  process.exit(1);
}

const library = path.join(out, path.basename(build.library));
const stamp = path.join(out, 'version.txt');
const wanted = `${RELEASE} ${name} ${build.sha256}`;
if (existsSync(library) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === wanted) {
  console.log(`PDFium ${RELEASE} (${name}) is already in src-tauri/resources/pdfium`);
  process.exit(0);
}

const url = `https://github.com/bblanchon/pdfium-binaries/releases/download/${RELEASE}/pdfium-${name}.tgz`;
const response = await fetch(url);
if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(archive).digest('hex');
if (digest !== build.sha256) throw new Error(`${url}: SHA-256 ${digest}, expected ${build.sha256}`);

const work = mkdtempSync(path.join(tmpdir(), 'kento-pdfium-'));
try {
  const file = path.join(work, 'pdfium.tgz');
  writeFileSync(file, archive);
  // Relative to the folder: GNU tar reads "C:\…" as a remote host.
  execFileSync('tar', ['-xzf', 'pdfium.tgz'], { cwd: work });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copyFileSync(path.join(work, build.library), library);
  copyFileSync(path.join(work, 'LICENSE'), path.join(out, 'LICENSE'));
  writeFileSync(stamp, `${wanted}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`PDFium ${RELEASE} (${name}) written to src-tauri/resources/pdfium`);
