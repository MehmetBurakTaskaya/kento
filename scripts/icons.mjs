// SPDX-License-Identifier: MIT
// Draws the app and tray icons from the marks in design/icons with Playwright:
//   src-tauri/icons/source.png, source-mac.png   1024 px masters; `tauri icon` makes the full set from them
//   src-tauri/icons/tray/tray-{16,20,24,32}.png    Windows notification area, the simplified mark
//   src-tauri/icons/tray/tray-mac.png              macOS menu bar template (black on transparent)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icons = path.join(root, 'src-tauri', 'icons');
const tray = path.join(icons, 'tray');
mkdirSync(tray, { recursive: true });

// app.svg: full detail; app-mac.svg: the macOS plate; tray.svg: simplified for 16–32 px;
// tray-mac.svg: the menu bar template, one black shape.
const mark = (name) => readFileSync(path.join(root, 'design', 'icons', `${name}.svg`), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg, size, file) {
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg', `<svg id="mark" width="${size}" height="${size}"`)}</body></html>`;
  await page.setContent(html);
  await page.locator('#mark').screenshot({ path: file, omitBackground: true });
}

await render(mark('app'), 1024, path.join(icons, 'source.png'));
await render(mark('app-mac'), 1024, path.join(icons, 'source-mac.png'));
for (const size of [16, 20, 24, 32]) await render(mark('tray'), size, path.join(tray, `tray-${size}.png`));
await render(mark('tray-mac'), 44, path.join(tray, 'tray-mac.png'));
await browser.close();

// The full set from the Windows master, then the macOS bundle icon from the plated master.
const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
execFileSync(process.execPath, [cli, 'icon', path.join(icons, 'source.png'), '--output', icons], { stdio: 'inherit' });
const mac = mkdtempSync(path.join(tmpdir(), 'kento-icon-'));
execFileSync(process.execPath, [cli, 'icon', path.join(icons, 'source-mac.png'), '--output', mac], {
  stdio: 'inherit',
});
copyFileSync(path.join(mac, 'icon.icns'), path.join(icons, 'icon.icns'));
rmSync(mac, { recursive: true, force: true });
// Kento ships for Windows and macOS only: drop the mobile and Store sizes the CLI also writes.
for (const entry of readdirSync(icons)) {
  if (['android', 'ios'].includes(entry) || entry.startsWith('Square') || entry === 'StoreLogo.png') {
    rmSync(path.join(icons, entry), { recursive: true, force: true });
  }
}
console.log('icons written to src-tauri/icons');
