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
  // Home with files and the Library filled; the wheel and a tool panel opened from the keyboard.
  ['home-files-light-tr', { lang: 'tr', appearance: 'light', section: 'home', files: 'demo', library: 'demo' }],
  ['library-filled-light-tr', { lang: 'tr', appearance: 'light', section: 'library', library: 'demo' }],
  ['library-filled-dark-en', { lang: 'en', appearance: 'dark', section: 'library', library: 'demo' }],
  ['wheel-groups-light-en', { lang: 'en', appearance: 'light', files: 'demo' }, 'convert'],
  ['wheel-images-dark-tr', { lang: 'tr', appearance: 'dark', files: 'demo' }, 'convert-image'],
  ['wheel-images-pseudo-rtl', { lang: 'ar-XB', appearance: 'light', files: 'demo' }, 'convert-image'],
  ['panel-qr-light-en', { lang: 'en', appearance: 'light', files: 'demo' }, 'tools'],
  // The windows outside the main one, at their own sizes.
  ['surface-wheel-light-tr', { lang: 'tr', appearance: 'light', surface: 'wheel', wheel: 'convert' }],
  ['surface-wheel-dark-en', { lang: 'en', appearance: 'dark', surface: 'wheel', wheel: 'actions' }],
  ['surface-shelf-light-tr', { lang: 'tr', appearance: 'light', surface: 'shelf' }],
  ['surface-toast-dark-en', { lang: 'en', appearance: 'dark', surface: 'toast' }],
];

const SIZES = { wheel: [520, 520], shelf: [300, 480], toast: [400, 200] };

/** Opens a wheel or a panel the way a person would with the keyboard. */
async function act(page, action) {
  if (!action) return;
  await page.click('.file-row');
  if (action === 'tools') await page.keyboard.press('Control+Space');
  else await page.keyboard.press('Control+a').then(() => page.keyboard.press('Enter'));
  await page.waitForSelector('[role=dialog]');
  await page.waitForTimeout(700);
  // Image group of the mixed selection, or the first tool.
  if (action === 'convert-image' || action === 'tools') {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
  }
}

const server = await createServer({ root, logLevel: 'error', server: { port: 1430, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const errors = [];
for (const [name, params, action] of SHOTS) {
  const tall = params.section === 'settings';
  const [width, height] = SIZES[params.surface] ?? [1000, tall ? 2200 : 680];
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && errors.push(`${name}: ${message.text()}`));
  await page.goto(`${base}?${new URLSearchParams(params)}`);
  await page.waitForSelector(
    params.surface ? (params.surface === 'wheel' ? '.wheel' : '.shelf, .corner-cards') : '.shell',
  );
  if (params.surface === 'wheel') await page.waitForTimeout(700);
  await page.evaluate(() => document.fonts.ready);
  await act(page, action);
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
