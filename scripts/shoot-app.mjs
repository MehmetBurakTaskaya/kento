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
  ['settings-tools-light-tr', { lang: 'tr', appearance: 'light', section: 'settings', tools: 'ready' }],
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
  // The image editors on a sample photo the demo paints, and Compress with a mixed selection.
  ['image-edit-light-en', { lang: 'en', appearance: 'light' }, 'image:edit-image'],
  ['image-crop-dark-tr', { lang: 'tr', appearance: 'dark' }, 'image:crop-image'],
  ['image-markup-light-en', { lang: 'en', appearance: 'light' }, 'image:markup'],
  ['image-markup-dark-tr', { lang: 'tr', appearance: 'dark' }, 'image:markup'],
  ['image-markup-pseudo-rtl', { lang: 'ar-XB', appearance: 'light' }, 'image:markup'],
  ['image-frame-light-tr', { lang: 'tr', appearance: 'light' }, 'image:frame'],
  ['image-collage-dark-en', { lang: 'en', appearance: 'dark' }, 'image:collage'],
  ['image-redact-light-tr', { lang: 'tr', appearance: 'light' }, 'image:redact-image'],
  ['image-edit-pseudo-long', { lang: 'en-XA', appearance: 'dark' }, 'image:edit-image'],
  ['compress-light-en', { lang: 'en', appearance: 'light' }, 'compress'],
  ['compress-size-dark-tr', { lang: 'tr', appearance: 'dark' }, 'compress:size'],
  ['compress-pseudo-rtl', { lang: 'ar-XB', appearance: 'light' }, 'compress:ratio'],
];

const SIZES = { wheel: [520, 520], shelf: [300, 480], toast: [400, 200] };

/** A point on the picture of an image editor, from fractions of its size. */
async function onPicture(page, [x, y]) {
  const box = await page.locator('.image-canvas').boundingBox();
  return [box.x + x * box.width, box.y + y * box.height];
}

/** Drags across the picture of an image editor. */
async function drag(page, from, to) {
  await page.mouse.move(...(await onPicture(page, from)));
  await page.mouse.down();
  await page.mouse.move(...(await onPicture(page, to)), { steps: 10 });
  await page.mouse.up();
}

/** Opens an image editor on the demo photo and uses it a little, as a person would. */
async function imageEditor(page, tool) {
  await page.evaluate(
    (id) => import('/src/editors/image/demo.tsx').then((demo) => demo.mountImageEditorDemo(id)),
    tool,
  );
  await page.waitForSelector('.image-stage img');
  const tools = page.locator('.image-tool');
  const segment = (index) => page.locator('.editor-side .editor-segmented button').nth(index).click();
  if (tool === 'edit-image') {
    const sliders = page.locator('.editor-side input[type=range]');
    await sliders.nth(0).fill('18');
    await sliders.nth(1).fill('12');
    await sliders.nth(2).fill('30');
  } else if (tool === 'crop-image') {
    await segment(2);
  } else if (tool === 'markup') {
    await tools.nth(3).click();
    await drag(page, [0.05, 0.07], [0.22, 0.36]);
    await tools.nth(6).click();
    await drag(page, [0.42, 0.42], [0.25, 0.25]);
    await tools.nth(2).click();
    await drag(page, [0.52, 0.86], [0.86, 0.86]);
    await tools.nth(7).click();
    await page.mouse.click(...(await onPicture(page, [0.44, 0.36])));
    await page.keyboard.type('Göreme 2026');
    await page.keyboard.press('Enter');
    await tools.nth(0).click();
    await page.mouse.click(...(await onPicture(page, [0.335, 0.335])));
  } else if (tool === 'frame') {
    await segment(1);
  } else if (tool === 'redact-image') {
    await drag(page, [0.08, 0.08], [0.25, 0.38]);
    await drag(page, [0.6, 0.62], [0.82, 0.78]);
    await segment(2);
  }
  // The demo paints previews after the editors' pause; let the last one land.
  await page.waitForTimeout(700);
}

/** Opens Compress for a mixed selection, through the store as the Tools wheel would. */
async function compress(page, mode) {
  await page.evaluate(async () => {
    const { useApp } = await import('/src/state/store.ts');
    const file = (path, category, size) => ({
      path,
      name: path.split('\\').pop(),
      folder: false,
      format: path.split('.').pop(),
      category,
      size,
    });
    const files = [
      file('C:\\Users\\me\\Pictures\\Kapadokya 🎈.jpg', 'image', 6_420_000),
      file('C:\\Users\\me\\Pictures\\Göreme gün batımı.heic', 'image', 3_150_000),
      file('C:\\Users\\me\\Videos\\Balon turu.mp4', 'video', 182_400_000),
      file('C:\\Users\\me\\Music\\Röportaj 2026.mp3', 'audio', 24_800_000),
      file('C:\\Users\\me\\Documents\\Rapor 2026.pdf', 'pdf', 12_600_000),
    ];
    useApp.setState({ files });
    useApp.getState().openPanel(
      'compress',
      files.map((entry) => entry.path),
    );
  });
  await page.waitForSelector('[role=dialog] .compress-files');
  if (mode)
    await page
      .locator('.compress-mode button')
      .nth(mode === 'ratio' ? 1 : 2)
      .click();
  await page.waitForTimeout(300);
}

/** Opens a wheel or a panel the way a person would with the keyboard. */
async function act(page, action) {
  if (!action) return;
  if (action.startsWith('image:')) return imageEditor(page, action.slice('image:'.length));
  if (action.startsWith('compress')) return compress(page, action.split(':')[1]);
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
