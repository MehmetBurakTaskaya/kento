// SPDX-License-Identifier: MIT
// Prints the CHANGELOG.md section of one version: the notes Kento shows after an update. The
// section is found by the version in brackets, whatever follows it (`## [1.0.0] - 2026-11-20`, or
// `- Unreleased` before the date is set). With --release it adds the download and first-launch
// notes for the GitHub release page; --mac adds the Mac files to them, for releases that carry
// them.
// Usage: node scripts/release-notes.mjs 1.0.0 [--release] [--mac]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [version, ...flags] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('usage: node scripts/release-notes.mjs <version> [--release] [--mac]');
  process.exit(1);
}
const changelog = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8').replace(
  /\r\n?/g,
  '\n',
);
const escaped = version.replace(/[.+]/g, '\\$&');
const heading = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n`, 'm');
const start = heading.exec(changelog);
if (!start) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const rest = changelog.slice(start.index + start[0].length);
// The section ends at the next version or at the link definitions under the last one.
const end = rest.search(/^## \[|^\[[^\]]+\]: /m);
const notes = (end === -1 ? rest : rest.slice(0, end)).trim();
if (!notes) {
  console.error(`The CHANGELOG.md section for ${version} is empty`);
  process.exit(1);
}

const mac = `
- **Kento-macOS-Universal.dmg**: for macOS 12 or later, on Apple silicon and Intel. Open it and drag
  Kento into Applications. Kento is not notarized by Apple, so macOS blocks its first opening: close
  the warning (**Done** or **Cancel**, not Move to Trash), then open **System Settings → Privacy &
  Security**, scroll down, choose **Open Anyway** next to Kento and enter your password.
  \`Kento-macOS-Universal.app.tar.gz\` is what updates install.`;

const downloads = `### Downloads

- **Kento-Windows-x64-Setup.exe**: the installer for Windows 10 (1809 or later) and Windows 11, x64.
  Open it and Kento installs for your user, with no administrator rights and no pages to click
  through, then starts. Terminals opened afterwards find the \`kento\` command line.
- **Kento-Windows-x64-Portable.zip**: unzip it anywhere and run \`Kento.exe\`; \`kento.com\` beside it
  is the command line.
- \`Kento-Windows-x64-Update.exe\` is the same installer, fetched by Kento's own updates.${flags.includes('--mac') ? mac : ''}

Kento is not code-signed on Windows yet. If SmartScreen says "Windows protected your PC", choose
**More info → Run anyway**. \`SHA256SUMS.txt\` lists the SHA-256 of every file.`;

process.stdout.write(`${flags.includes('--release') ? `${notes}\n\n${downloads}` : notes}\n`);
