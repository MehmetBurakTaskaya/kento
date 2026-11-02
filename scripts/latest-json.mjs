// SPDX-License-Identifier: MIT
// Prints the updater's latest.json for a release (ARCHITECTURE 46): one signed entry per way Kento
// is installed, each with its download address on github.com. Plain release addresses need no
// GitHub API call, so copies never meet the API's limit of 60 requests an hour.
// Usage: node scripts/latest-json.mjs <version> <notes file> <folder with the release files>
// The folder holds Kento-Windows-x64-Update.exe (the installer under the name updates fetch),
// Kento-Windows-x64-Portable.zip and, when the Mac build succeeded,
// Kento-macOS-Universal.app.tar.gz, each next to its .sig file.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [version, notesFile, folder] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version ?? '') || !notesFile || !folder) {
  console.error('usage: node scripts/latest-json.mjs <version> <notes file> <folder>');
  process.exit(1);
}
const base = `https://github.com/MehmetBurakTaskaya/kento/releases/download/v${version}`;

// A file and its signature, or null when either is missing.
function entry(name) {
  const file = path.join(folder, name);
  const sig = `${file}.sig`;
  if (!existsSync(file) || !existsSync(sig)) return null;
  const signature = readFileSync(sig, 'utf8').trim();
  if (!signature) return null;
  return { signature, url: `${base}/${encodeURIComponent(name)}` };
}

const platforms = {};
// The installed copy asks for windows-x86_64-nsis first and then this one; the installer runs
// quietly (installMode "quiet").
const windows = entry('Kento-Windows-x64-Update.exe');
if (!windows) {
  console.error('Kento-Windows-x64-Update.exe or its signature is missing');
  process.exit(1);
}
platforms['windows-x86_64'] = windows;
// The portable copy asks for its own entry and unpacks the ZIP.
const portable = entry('Kento-Windows-x64-Portable.zip');
if (!portable) {
  console.error('Kento-Windows-x64-Portable.zip or its signature is missing');
  process.exit(1);
}
platforms['windows-x86_64-portable'] = portable;
// One universal archive serves both Mac architectures.
const mac = entry('Kento-macOS-Universal.app.tar.gz');
if (mac) {
  platforms['darwin-aarch64'] = mac;
  platforms['darwin-x86_64'] = mac;
}

const latest = {
  version,
  notes: readFileSync(notesFile, 'utf8').replace(/\r\n?/g, '\n').trim(),
  // RFC 3339 without fractions.
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms,
};
process.stdout.write(`${JSON.stringify(latest, null, 2)}\n`);
