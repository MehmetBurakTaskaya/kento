// SPDX-License-Identifier: MIT
// Screenshots of the main window's pages in a browser, with the in-memory stand-in for the core:
// English and Turkish, light and dark, and the two pseudo-languages for overflow and right to left
// (SPEC 5.19). Output: artifacts/app-shots/*.png (not committed).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'artifacts', 'app-shots');
mkdirSync(out, { recursive: true });

const SHOTS = [
  ['home-light-en', { lang: 'en', appearance: 'light', section: 'home' }],
  ['home-dark-tr', { lang: 'tr', appearance: 'dark', section: 'home' }],
  ['library-dark-en', { lang: 'en', appearance: 'dark', section: 'library' }],
  ['settings-light-tr', { lang: 'tr', appearance: 'light', section: 'settings' }],
  ['settings-dark-en-mac', { lang: 'en', appearance: 'dark', section: 'settings', platform: 'macos' }],
  ['home-pseudo-long', { lang: 'en-XA', appearance: 'light', section: 'home' }],
  ['home-pseudo-rtl', { lang: 'ar-XB', appearance: 'light', section: 'home' }],
  ['settings-pseudo-rtl', { lang: 'ar-XB', appearance: 'dark', section: 'settings' }],
];

const server = await createServer({ root, logLevel: 'error', server: { port: 1430, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const errors = [];
for (const [name, params] of SHOTS) {
  const tall = params.section === 'settings';
  const page = await browser.newPage({ viewport: { width: 1000, height: tall ? 1600 : 680 } });
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && errors.push(`${name}: ${message.text()}`));
  await page.goto(`${base}?${new URLSearchParams(params)}`);
  await page.waitForSelector('.shell');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  await page.close();
}
await browser.close();
await server.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${SHOTS.length} screenshots in artifacts/app-shots`);
