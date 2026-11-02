// SPDX-License-Identifier: MIT
// The social media cards of the website kit (1200 x 630), in English and Turkish. Each card is laid out
// in headless Chromium with the brand font, so the text is measured rather than guessed; the result is
// written as an SVG source to website-kit/social/ and rendered from that file to a PNG beside it.
// Run: node scripts/social-cards.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { dialSvg, LIGHT } from '../website-kit/assets/dial.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'website-kit', 'social');
mkdirSync(out, { recursive: true });

const W = 1200;
const H = 630;
const FONT = "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
// The text column ends before the wheel, whose steel starts near x = 665.
const COLUMN = 560;
const WHEEL_EDGE = 640;

const COPY = {
  en: {
    lines: ['Drag a file,', 'press a key,', 'drop it on the wheel.'],
    sub: ['Converts, compresses and edits files on', 'your computer. Free and open source.'],
    keys: [
      ['Shift', 'Convert'],
      ['Ctrl', 'Tools'],
      ['Alt', 'File actions'],
    ],
    foot: 'Windows and macOS · github.com/MehmetBurakTaskaya/kento',
    wheel: { title: 'Convert', file: 'photo.heic', more: 'More…' },
  },
  tr: {
    lines: ['Dosyayı sürükleyin,', 'bir tuşa basın,', 'çarka bırakın.'],
    sub: ['Dosyaları bilgisayarınızda dönüştürür,', 'sıkıştırır ve düzenler. Ücretsiz, açık kaynak.'],
    keys: [
      ['Shift', 'Dönüştür'],
      ['Ctrl', 'Araçlar'],
      ['Alt', 'Dosya işlemleri'],
    ],
    foot: 'Windows ve macOS · github.com/MehmetBurakTaskaya/kento',
    wheel: { title: 'Dönüştür', file: 'foto.heic', more: 'Daha fazla…' },
  },
};

const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The app icon's small mark (design/icons/tray.svg), with ids of its own. */
const MARK = `<g transform="translate(80 70) scale(0.25)">
<defs>
<radialGradient id="mark-face" cx="0.4" cy="0.32" r="0.78"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e1e5e9"/></radialGradient>
<linearGradient id="mark-blue" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#4b74d8"/><stop offset="0.55" stop-color="#2a4ea6"/><stop offset="1" stop-color="#1a3170"/></linearGradient>
<linearGradient id="mark-ring" x1="0.2" y1="0.05" x2="0.8" y2="0.95"><stop offset="0" stop-color="#c3c8ce"/><stop offset="0.5" stop-color="#858c95"/><stop offset="1" stop-color="#4a5159"/></linearGradient>
<linearGradient id="mark-bolt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6d747d"/><stop offset="0.3" stop-color="#fbfcfd"/><stop offset="0.56" stop-color="#b9bfc6"/><stop offset="0.86" stop-color="#737a83"/><stop offset="1" stop-color="#4c535b"/></linearGradient>
</defs>
${[45, 135, 225, 315]
  .map(
    (a) =>
      `<g transform="rotate(${a} 128 128)"><rect x="104.77" y="10.84" width="46.46" height="46.46" rx="2.53" fill="url(#mark-bolt)" stroke="#2b3138" stroke-opacity="0.85" stroke-width="9.09"/></g>`,
  )
  .join('')}
<circle cx="128" cy="128" r="101" fill="url(#mark-ring)" stroke="#2b3138" stroke-opacity="0.9" stroke-width="9.09"/>
<circle cx="128" cy="128" r="64.64" fill="url(#mark-face)"/>
<path d="M128 128L93.75 73.18A64.64 64.64 0 0 1 162.25 73.18Z" fill="url(#mark-blue)"/>
</g>`;

/** The card before layout: the text is placed by `layout` below, in the page, with the real font. */
function card(lang) {
  const c = COPY[lang];
  const wheel = dialSvg({
    slices: [
      { label: 'JPG', choices: true },
      { label: 'PNG' },
      { label: 'WEBP', choices: true },
      { label: 'AVIF', choices: true },
      { label: 'PDF' },
      { label: 'TIFF' },
      { label: 'GIF', choices: true },
      { label: c.wheel.more, small: true },
    ],
    title: c.wheel.title,
    subtitle: c.wheel.file,
    selected: 0,
    palette: LIGHT,
    id: 'card',
    cast: true,
    attrs: 'x="622" y="35" width="560" height="560" overflow="visible"',
  });
  const headline = c.lines
    .map(
      (line, i) =>
        `<text data-fit="head" x="80" y="${222 + i * 62}" font-size="54" font-weight="600" fill="#15181c" letter-spacing="-0.6">${esc(line)}</text>`,
    )
    .join('');
  const sub = c.sub
    .map(
      (line, i) => `<text data-fit="sub" x="80" y="${410 + i * 33}" font-size="23" fill="#555c67">${esc(line)}</text>`,
    )
    .join('');
  const keys = c.keys
    .map(
      ([key, label]) =>
        `<g data-key=""><rect y="482" height="34" rx="5" fill="#aab1ba"/><rect y="480" height="33" rx="5" fill="#e8ebef" stroke="#aab1ba" stroke-width="1"/><text data-cap="" y="503" font-size="16" font-weight="600" fill="#2b3036">${esc(key)}</text><text data-label="" y="503" font-size="19" font-weight="500" fill="#15181c">${esc(label)}</text></g>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(FONT)}">
<title>Kento</title>
<defs>
<radialGradient id="desk" gradientUnits="userSpaceOnUse" cx="216" cy="0" r="1300"><stop offset="0" stop-color="#f8f9fa"/><stop offset="0.52" stop-color="#e7eaee"/><stop offset="1" stop-color="#d4d9df"/></radialGradient>
<linearGradient id="steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c7ccd2"/><stop offset="0.1" stop-color="#a8aeb6"/><stop offset="0.19" stop-color="#91979f"/><stop offset="0.3" stop-color="#b4bac1"/><stop offset="0.38" stop-color="#eef1f3"/><stop offset="0.46" stop-color="#c3c8ce"/><stop offset="0.57" stop-color="#a0a6ae"/><stop offset="0.68" stop-color="#8a9098"/><stop offset="0.78" stop-color="#aeb4bb"/><stop offset="0.88" stop-color="#f7f8fa"/><stop offset="0.96" stop-color="#d6dade"/><stop offset="1" stop-color="#c7ccd2"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#desk)"/>
<rect width="${W}" height="8" fill="url(#steel)"/>
${MARK}
<text x="154" y="116" font-size="40" font-weight="600" fill="#15181c" letter-spacing="-0.4">Kento</text>
${headline}
${sub}
${keys}
<text x="80" y="578" font-size="18" fill="#555c67">${esc(c.foot)}</text>
${wheel}
</svg>`;
}

/** Runs in the page: fits the headline and the sub lines to the column and sets the keycaps in a row. */
function layout(column) {
  const svg = document.querySelector('svg');
  for (const group of ['head', 'sub']) {
    const lines = [...svg.querySelectorAll(`[data-fit="${group}"]`)];
    let size = Number(lines[0].getAttribute('font-size'));
    while (size > 12 && lines.some((line) => line.getComputedTextLength() > column)) {
      size -= 1;
      for (const line of lines) line.setAttribute('font-size', String(size));
    }
  }
  let x = 80;
  for (const key of svg.querySelectorAll('[data-key]')) {
    const cap = key.querySelector('[data-cap]');
    const label = key.querySelector('[data-label]');
    const width = Math.ceil(cap.getComputedTextLength()) + 24;
    for (const rect of key.querySelectorAll('rect')) {
      rect.setAttribute('x', String(x));
      rect.setAttribute('width', String(width));
    }
    cap.setAttribute('x', String(x + 12));
    label.setAttribute('x', String(x + width + 10));
    x += width + 10 + Math.ceil(label.getComputedTextLength()) + 28;
    key.removeAttribute('data-key');
    cap.removeAttribute('data-cap');
    label.removeAttribute('data-label');
  }
  for (const line of svg.querySelectorAll('[data-fit]')) line.removeAttribute('data-fit');
  return { right: x - 28, svg: svg.outerHTML };
}

/** The brand font for the page that lays out and renders the cards (latin and latin-ext cover Turkish). */
function fontFaces() {
  const files = path.join(root, 'node_modules', '@fontsource-variable', 'ibm-plex-sans', 'files');
  return ['latin', 'latin-ext']
    .map((subset) => {
      const data = readFileSync(path.join(files, `ibm-plex-sans-${subset}-wght-normal.woff2`)).toString('base64');
      return `@font-face { font-family: 'IBM Plex Sans Variable'; font-weight: 100 700; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
    })
    .join('\n');
}

const page = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces()} html, body { margin: 0; } svg { display: block; }</style></head><body>${body}</body></html>`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
for (const lang of Object.keys(COPY)) {
  await tab.setContent(page(card(lang)), { waitUntil: 'load' });
  await tab.evaluate(() => document.fonts.ready);
  const { right, svg } = await tab.evaluate(layout, COLUMN);
  if (right > WHEEL_EDGE) throw new Error(`${lang}: the keys row ends at x = ${right} and runs into the wheel`);
  const file = path.join(out, `kento-card-${lang}.svg`);
  writeFileSync(file, `${svg}\n`);
  // The PNG is drawn from the SVG file just written, so the two never differ.
  await tab.setContent(page(readFileSync(file, 'utf8')), { waitUntil: 'load' });
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: path.join(out, `kento-card-${lang}.png`), clip: { x: 0, y: 0, width: W, height: H } });
  console.log(`website-kit/social/kento-card-${lang}.svg and .png`);
}
await browser.close();
