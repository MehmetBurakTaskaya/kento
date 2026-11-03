// SPDX-License-Identifier: MIT
// Pictures of the themes as the app shows them (SPEC 5.20), for working on a theme: the floating wheel
// in light and dark with 2, 3, 5 and 8 slices, with a second page ("More…"), with a ring of choices
// open, in Arabic (right to left) and German (long labels), pointed at, in the middle of its apply
// effect and applied; and Settings › Appearance with the theme chosen, and its card. Each theme gets a
// folder in artifacts/theme-shots/ with the pictures and contact.png, a sheet of all of them. The
// script reports every error a page logs, labels a theme had to shorten, letters its faces lack
// (Turkish, Cyrillic) and the longest a wheel took to be drawn, in report.json and on the console; it
// fails when a page logged an error.
//   npm run shots:themes                     every theme
//   npm run shots:themes -- pusula telefon   these themes
//   npm run shots:themes -- --no-settings    without the Settings pictures (faster)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'artifacts', 'theme-shots');
const catalog = JSON.parse(readFileSync(path.join(root, 'src', 'theme', 'catalog.json'), 'utf8'));
const args = process.argv.slice(2);
const settingsShots = !args.includes('--no-settings');
const asked = args.filter((arg) => !arg.startsWith('--'));
const unknown = asked.filter((id) => !catalog.some((theme) => theme.id === id));
if (unknown.length) {
  console.error(`No such theme: ${unknown.join(', ')}. Themes: ${catalog.map((theme) => theme.id).join(' ')}`);
  process.exit(2);
}
const themes = asked.length ? catalog.filter((theme) => asked.includes(theme.id)) : catalog;

const MODES = ['light', 'dark'];
// `set` names a sample in src/theme/shots.tsx; `act` what happens before the picture.
const SHOTS = [
  { name: '2', set: 'convert2', lang: 'en' },
  { name: '3', set: 'tools3', lang: 'en' },
  { name: '5', set: 'actions5', lang: 'en' },
  { name: '8', set: 'convert8', lang: 'en' },
  { name: 'more', set: 'convert12', lang: 'en' },
  { name: 'more-page-2', set: 'convert12', lang: 'en', act: 'page' },
  { name: 'ring', set: 'convert8', lang: 'en', act: 'ring' },
  { name: 'ar', set: 'tools8', lang: 'ar' },
  { name: 'de', set: 'tools8', lang: 'de' },
  { name: 'hover', set: 'tools8', lang: 'en', act: 'hover' },
  { name: 'apply', set: 'tools8', lang: 'en', act: 'apply' },
  { name: 'selected', set: 'tools8', lang: 'en', act: 'selected' },
];
const WINDOW = { width: 520, height: 520 };
const SIZE = 360;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The middle of slice `index` of a ring of `count` (left to right, from twelve o'clock). */
async function sliceAt(page, index, count) {
  const box = await page.locator('.wheel-disc').boundingBox();
  const angle = ((index * 360) / count) * (Math.PI / 180);
  const r = box.width * 0.33;
  return [box.x + box.width / 2 + r * Math.sin(angle), box.y + box.height / 2 - r * Math.cos(angle)];
}

async function act(page, shot, timings) {
  if (shot.act === 'page') {
    // "More…" is the eighth slice; Enter on it turns the page.
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await wait(timings.open + 200);
  } else if (shot.act === 'ring') {
    // JPG, the first slice, opens its picture quality.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await wait(timings.open + 200);
  } else if (shot.act === 'hover') {
    await page.mouse.move(...(await sliceAt(page, 1, 8)));
    await wait(350);
  } else if (shot.act === 'apply') {
    await page.mouse.move(...(await sliceAt(page, 1, 8)));
    await page.mouse.down();
    await page.mouse.up();
    await wait(Math.max(40, timings.apply / 2));
  } else if (shot.act === 'selected') {
    await page.mouse.move(...(await sliceAt(page, 1, 8)));
    await page.mouse.down();
    await page.mouse.up();
    await wait(timings.apply + 150);
  }
}

function contactSheet(theme, pictures) {
  const cell = ([label, file]) =>
    `<figure><img src="data:image/png;base64,${readFileSync(file).toString('base64')}"><figcaption>${label}</figcaption></figure>`;
  const rows = MODES.map(
    (mode) =>
      `<h2>${mode}</h2><div class="row">${pictures
        .filter((p) => p.mode === mode && !p.settings && !p.card)
        .map((p) => cell([p.name, p.file]))
        .join('')}</div>`,
  ).join('');
  const settings = pictures.filter((p) => p.settings || p.card);
  return `<!doctype html><meta charset="utf-8"><style>
    body { margin: 16px; font: 14px/1.4 system-ui, sans-serif; background: #fff; color: #111; }
    h1 { margin: 0 0 8px; font-size: 20px; } h2 { margin: 16px 0 6px; font-size: 15px; }
    .row { display: grid; grid-template-columns: repeat(6, 260px); gap: 8px; }
    figure { margin: 0; } img { display: block; width: 100%; border: 1px solid #ccc; }
    figcaption { font-size: 12px; color: #555; }
    .settings { display: grid; grid-template-columns: 640px 200px 640px 200px; gap: 8px; align-items: start; }
  </style><h1>${theme.name} (${theme.id})</h1>${rows}${
    settings.length
      ? `<h2>Settings</h2><div class="settings">${settings.map((p) => cell([`${p.mode} ${p.name}`, p.file])).join('')}</div>`
      : ''
  }`;
}

// Only the themes shot now are taken again; the report keeps what earlier runs found for the others.
for (const theme of themes) rmSync(path.join(out, theme.id), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const reportFile = path.join(out, 'report.json');
const server = await createServer({ root, logLevel: 'error', server: { port: 1431, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : {};
let failed = false;

for (const theme of themes) {
  const dir = path.join(out, theme.id);
  mkdirSync(dir, { recursive: true });
  const entry = { errors: [], shortened: {}, missingLetters: {}, slowestDrawMs: 0 };
  report[theme.id] = entry;
  const pictures = [];
  let current = 'load';
  const listen = (page) => {
    page.on('pageerror', (error) => entry.errors.push(`${current}: ${error.message}`));
    page.on('console', (message) => message.type() === 'error' && entry.errors.push(`${current}: ${message.text()}`));
  };

  const page = await browser.newPage({ viewport: WINDOW });
  listen(page);
  await page.goto(`${base}?surface=wheel&lang=en&appearance=light&theme=${theme.id}`);
  await page.waitForSelector('#root');
  for (const mode of MODES) {
    for (const shot of SHOTS) {
      current = `${mode} ${shot.name}`;
      const timings = await page.evaluate(
        (options) => import('/src/theme/shots.tsx').then((shots) => shots.mountWheelShot(options)),
        { theme: theme.id, mode, lang: shot.lang, set: shot.set, size: SIZE },
      );
      await page.waitForSelector('.wheel-disc');
      // The wheel must be on screen within 100 ms of the key press (SPEC 5.20).
      entry.slowestDrawMs = Math.max(entry.slowestDrawMs, timings.drawn);
      await wait(timings.open);
      const seen = await page.evaluate((id) => import('/src/theme/shots.tsx').then((s) => s.inspectShot(id)), theme.id);
      if (seen.shortened.length) entry.shortened[current] = seen.shortened;
      Object.assign(entry.missingLetters, seen.missing);
      await act(page, shot, timings);
      const file = path.join(dir, `${mode}-${shot.name}.png`);
      await page.screenshot({ path: file });
      pictures.push({ mode, name: shot.name, file });
    }
  }
  await page.close();

  if (settingsShots) {
    for (const mode of MODES) {
      current = `${mode} settings`;
      const settings = await browser.newPage({ viewport: { width: 1040, height: 1200 } });
      listen(settings);
      await settings.goto(`${base}?section=settings&lang=en&appearance=${mode}&theme=${theme.id}`);
      await settings.waitForSelector('.theme-preview .wheel-disc');
      await settings.evaluate(() => document.fonts.ready);
      await wait(900);
      // The page in the theme's colours, with its wheel to try and the first cards.
      const file = path.join(dir, `${mode}-settings.png`);
      await settings.screenshot({ path: file });
      pictures.push({ mode, name: 'settings', file, settings: true });
      // The theme's own card, drawn once it comes into view.
      const card = settings.locator('.theme-card.is-checked');
      await card.scrollIntoViewIfNeeded();
      await settings.waitForSelector('.theme-card.is-checked .wheel-disc');
      await wait(500);
      const cardFile = path.join(dir, `${mode}-card.png`);
      await card.screenshot({ path: cardFile });
      pictures.push({ mode, name: 'card', file: cardFile, card: true });
      await settings.close();
    }
  }

  const sheet = await browser.newPage({ viewport: { width: 1640, height: 900 } });
  await sheet.setContent(contactSheet(theme, pictures));
  await sheet.screenshot({ path: path.join(dir, 'contact.png'), fullPage: true });
  await sheet.close();

  const notes = [
    `drawn in ${entry.slowestDrawMs} ms at most${entry.slowestDrawMs > 100 ? ' (over 100 ms)' : ''}`,
    entry.errors.length ? `${entry.errors.length} error(s)` : null,
    Object.keys(entry.shortened).length ? `labels shortened in ${Object.keys(entry.shortened).join(', ')}` : null,
    Object.keys(entry.missingLetters).length
      ? `faces lack ${Object.entries(entry.missingLetters)
          .map(([family, letters]) => `${family}: ${letters}`)
          .join('; ')}`
      : null,
  ].filter(Boolean);
  console.log(`${theme.id.padEnd(12)} ${notes.join(' · ') || 'ok'}`);
  for (const error of entry.errors) console.log(`  ${error}`);
  if (entry.errors.length) failed = true;
}

await browser.close();
await server.close();
writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(`${themes.length} theme(s) in artifacts/theme-shots (report.json lists what each page showed)`);
if (failed) process.exit(1);
