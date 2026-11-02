// SPDX-License-Identifier: MIT
// Checks the website kit's playground (website-kit/playground/) in headless Chromium. The kit is served
// from 127.0.0.1 under a Content-Security-Policy like the author's website (inline scripts and styles
// by hash, images, fonts and connections from the page's own origin only), and every request is
// recorded: once the playground has started, none may follow. It converts real PNG and JPEG pictures
// to every format the wheel offers, by keyboard, by a drag with Shift (synthetic drag events), by a
// plain drop and by touch, and reads each download back (in the browser, or byte by byte for TIFF,
// ICO and PDF) to confirm its format, its size and some of its pixels. It also covers phone width,
// light and dark, English and Turkish, reduced motion, AVIF and WebP detection on and off, paging past
// eight slices, the refusals (HEIC, a file that is no picture), and the one-page draft (index.html).
// Run: node scripts/check-playground.mjs (screenshots in artifacts/playground-shots, not committed)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = path.join(root, 'website-kit');
const shots = path.join(root, 'artifacts', 'playground-shots');
mkdirSync(shots, { recursive: true });

const failures = [];
const notes = [];
let current = '';
function check(ok, message) {
  if (!ok) failures.push(`${current}: ${message}`);
  return ok;
}
function equal(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return check(ok, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** The pages still open; a scenario that stops early leaves them to be closed here. */
const live = new Set();
async function scenario(name, run) {
  current = name;
  const t0 = Date.now();
  try {
    await run();
  } catch (error) {
    failures.push(`${name}: stopped: ${String(error.message || error).split('\n')[0]}`);
  } finally {
    for (const session of live) await session.context.close().catch(() => {});
    live.clear();
  }
  console.log(`${name}: ${Date.now() - t0} ms`);
}

// ------------------------------------------------------------------ the server

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** CSP sources for every inline <script> and <style> of the kit's pages, as the website allows them. */
function inlineHashes() {
  const hashes = { script: new Set(), style: new Set() };
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (name.endsWith('.html')) {
        const text = readFileSync(file, 'utf8');
        for (const [, kind, attrs, body] of text.matchAll(/<(script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
          if (/\bsrc\s*=/.test(attrs || '')) continue;
          hashes[kind].add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
        }
      }
    }
  };
  walk(kit);
  return hashes;
}
const HASHES = inlineHashes();

function policy(blobImages) {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...HASHES.script].join(' '),
    ["style-src 'self'", ...HASHES.style].join(' '),
    `img-src 'self'${blobImages ? ' blob:' : ''}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const file = path.join(kit, decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(kit) || !statSafe(file)) {
    response.writeHead(404).end();
    return;
  }
  const headers = {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  };
  if (file.endsWith('.html')) headers['Content-Security-Policy'] = policy(url.searchParams.get('csp') === 'blob');
  response.writeHead(200, headers).end(readFileSync(file));
});
function statSafe(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------------ pages

const browser = await chromium.launch();

/** A fresh page with its requests, CSP reports and downloads recorded. */
async function open(options = {}) {
  const {
    lang = 'en',
    theme = 'light',
    colorScheme = theme === 'dark' ? 'dark' : 'light',
    reducedMotion = 'no-preference',
    viewport = { width: 1280, height: 900 },
    mobile = false,
    init = null,
    page: at = '/playground/index.html',
    csp = '',
  } = options;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme,
    reducedMotion,
    acceptDownloads: true,
    locale: lang === 'tr' ? 'tr-TR' : 'en-GB',
  });
  const log = { requests: [], started: false, after: [], violations: [], errors: [] };
  await context.route('**/*', (route) => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
    log.requests.push(`${request.method()} ${url}`);
    if (log.started) log.after.push(`${request.method()} ${url}`);
    return url.startsWith(origin) ? route.continue() : route.abort();
  });
  if (init) await context.addInitScript(init);
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window.__violations = window.__violations || []).push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => log.errors.push(String(error)));
  live.add({ context });
  const query = new URLSearchParams({ lang, ...(theme === 'system' ? {} : { theme }), ...(csp ? { csp } : {}) });
  await page.goto(`${origin}${at}?${query}`);
  if (at.startsWith('/playground/')) await page.waitForSelector('.kento-playground [data-stage]:not([hidden])');
  return { context, page, log };
}

/** Starts the playground (a click on its sample button would do too) and marks the end of loading. */
async function started(session) {
  await session.page.waitForFunction(() => !!document.querySelector('.kento-playground').kentoPlayground);
  // Let the module's own imports settle before anything counts as a request made after loading.
  await session.page.waitForTimeout(100);
  session.log.started = true;
}

async function close(session) {
  const violations = await session.page.evaluate(() => window.__violations || []).catch(() => []);
  session.log.violations.push(...violations);
  check(session.log.after.length === 0, `requests after the playground started: ${session.log.after.join(', ')}`);
  check(session.log.errors.length === 0, `page errors: ${session.log.errors.join(' | ')}`);
  await session.context.close();
  for (const entry of live) if (entry.context === session.context) live.delete(entry);
  return session.log;
}

// ------------------------------------------------------------------ test pictures

/** Pictures painted in a blank page: a PNG with transparent corners and many colours, an opaque JPEG. */
async function pictures() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const made = await page.evaluate(async () => {
    const paint = (w, h, corners, middle) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      if (corners) {
        g.beginPath();
        g.roundRect(0, 0, w, h, 60);
        g.clip();
      }
      const sky = g.createLinearGradient(0, 0, w, h);
      sky.addColorStop(0, '#89a7f5');
      sky.addColorStop(0.5, '#e9edf3');
      sky.addColorStop(1, '#4f6f62');
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `hsl(${i * 9} 60% 50%)`;
        g.beginPath();
        g.arc((i * 97) % w, (i * 53) % h, 18, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = middle;
      g.fillRect(w / 2 - 50, h / 2 - 30, 100, 60);
      return c;
    };
    const bytes = async (c, type, q) => {
      const blob = await new Promise((resolve) => c.toBlob(resolve, type, q));
      const data = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (const b of data) text += String.fromCharCode(b);
      return btoa(text);
    };
    return {
      png: await bytes(paint(640, 400, true, '#2a4ea6'), 'image/png'),
      jpg: await bytes(paint(800, 600, false, '#c2372d'), 'image/jpeg', 0.92),
      big: await bytes(paint(2400, 1600, false, '#2a4ea6'), 'image/png'),
    };
  });
  await context.close();
  return Object.fromEntries(Object.entries(made).map(([k, v]) => [k, Buffer.from(v, 'base64')]));
}
const PICTURES = await pictures();
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" rx="24" fill="#2a4ea6"/><circle cx="150" cy="100" r="60" fill="#eef1f3"/></svg>',
);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic\0\0\0\0mif1heic'), Buffer.alloc(200, 7)]);

// ------------------------------------------------------------------ reading downloads back

/** Width, height and a few pixels of a picture, decoded by the browser. */
async function decode(page, bytes, type, points = []) {
  return page.evaluate(
    async ({ b64, type, points }) => {
      const data = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([data], { type }));
      const c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      const g = c.getContext('2d');
      g.drawImage(bitmap, 0, 0);
      const px = points.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data]);
      return { width: bitmap.width, height: bitmap.height, px };
    },
    { b64: bytes.toString('base64'), type, points },
  );
}

const near = (a, b, tolerance) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

function tiffInfo(buf) {
  check(buf.toString('latin1', 0, 4) === 'II*\0', 'TIFF header');
  const ifd = buf.readUInt32LE(4);
  const n = buf.readUInt16LE(ifd);
  const tags = {};
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    const tag = buf.readUInt16LE(e);
    const type = buf.readUInt16LE(e + 2);
    const count = buf.readUInt32LE(e + 4);
    const size = { 3: 2, 4: 4, 5: 8 }[type] * count;
    const at = size <= 4 ? e + 8 : buf.readUInt32LE(e + 8);
    const values = [];
    for (let i = 0; i < (type === 5 ? count * 2 : count); i++) {
      values.push(type === 3 ? buf.readUInt16LE(at + i * 2) : buf.readUInt32LE(at + i * 4));
    }
    tags[tag] = values;
  }
  const [width] = tags[256];
  const [height] = tags[257];
  const [spp] = tags[277];
  const offsets = tags[273];
  const counts = tags[279];
  const total = counts.reduce((a, b) => a + b, 0);
  check(total === width * height * spp, `TIFF strips hold ${total} bytes, not ${width * height * spp}`);
  check(offsets.at(-1) + counts.at(-1) === buf.length, 'TIFF ends with its last strip');
  const pixel = (x, y) => {
    const at = offsets[0] + (y * width + x) * spp;
    return [...buf.subarray(at, at + spp)];
  };
  return { width, height, spp, pixel };
}

function icoInfo(buf) {
  check(buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1, 'ICO header');
  const n = buf.readUInt16LE(4);
  const entries = [];
  for (let k = 0; k < n; k++) {
    const e = 6 + k * 16;
    const size = buf[e] || 256;
    const length = buf.readUInt32LE(e + 8);
    const at = buf.readUInt32LE(e + 12);
    const png = buf.subarray(at, at + length);
    check(png.toString('latin1', 1, 4) === 'PNG', `ICO entry ${size} is a PNG`);
    check(png.readUInt32BE(16) === size && png.readUInt32BE(20) === size, `ICO entry ${size} is ${size} × ${size}`);
    entries.push({ size, png });
  }
  return entries;
}

function pdfInfo(buf) {
  const text = buf.toString('latin1');
  check(text.startsWith('%PDF-1.4\n'), 'PDF header');
  check(text.trimEnd().endsWith('%%EOF'), 'PDF trailer');
  const start = Number(/startxref\n(\d+)/.exec(text)[1]);
  check(text.startsWith('xref', start), 'startxref points at the xref table');
  const rows = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  rows.forEach((at, i) => check(text.startsWith(`${i + 1} 0 obj`, at), `xref entry ${i + 1}`));
  const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text).slice(1).map(Number);
  const stream = (n) => {
    const m = new RegExp(`${n} 0 obj\\n<<(.*?)>>\\nstream\\n`, 's').exec(text);
    if (!m) return null;
    const length = Number(/\/Length (\d+)/.exec(m[1])[1]);
    const from = m.index + m[0].length;
    return { dict: m[1], bytes: buf.subarray(from, from + length) };
  };
  const image = stream(4);
  const mask = stream(6);
  const width = Number(/\/Width (\d+)/.exec(image.dict)[1]);
  const height = Number(/\/Height (\d+)/.exec(image.dict)[1]);
  const filter = /\/Filter \/(\w+)/.exec(image.dict)[1];
  return {
    media,
    width,
    height,
    filter,
    image: image.bytes,
    mask: mask && mask.bytes,
    smask: /\/SMask 6 0 R/.test(image.dict),
  };
}

// ------------------------------------------------------------------ driving the playground

const MENU = '.kp-overlay .kp-disc';

async function choose(page, name, type, bytes, button = '[data-act="choose"]') {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator(`.kento-playground ${button}:visible`).first().click(),
  ]);
  await chooser.setFiles({ name, mimeType: type, buffer: bytes });
}

const labels = (page) => page.$$eval(`${MENU} [role="menuitem"]`, (items) => items.map((item) => item.textContent));
const active = (page) =>
  page.evaluate((menu) => {
    const disc = document.querySelector(menu);
    const id = disc && disc.getAttribute('aria-activedescendant');
    return id ? document.getElementById(id).textContent : null;
  }, MENU);
const wheelOpen = (page) => page.waitForSelector(`${MENU}`, { state: 'attached' });
const wheelGone = (page) => page.waitForSelector('.kp-overlay', { state: 'detached', timeout: 5000 });

/** Presses Down until the slice called `label` is under the dial. */
async function keyTo(page, label) {
  for (let i = 0; i < 12; i++) {
    if ((await active(page)) === label) return true;
    await page.keyboard.press('ArrowDown');
  }
  return check(false, `no slice called ${label}`);
}

/** Where slice `index` of the open ring is on the screen (its label, radius 103.5 of 400). */
async function slicePoint(page, index, radius = 103.5) {
  return page.evaluate(
    ({ menu, index, radius }) => {
      const disc = document.querySelector(menu);
      const svg = disc.querySelector('svg');
      const n = disc.querySelectorAll('[role="menuitem"]').length;
      const offset = Number(svg.getAttribute('data-offset')) || 0;
      const a = ((offset + (index * 360) / n) * Math.PI) / 180;
      const b = disc.getBoundingClientRect();
      const ux = 200 + radius * Math.sin(a);
      const uy = 200 - radius * Math.cos(a);
      return { x: b.left + ((ux + 30) / 460) * b.width, y: b.top + ((uy + 30) / 460) * b.height };
    },
    { menu: MENU, index, radius },
  );
}

async function indexOf(page, label) {
  const all = await labels(page);
  const i = all.indexOf(label);
  check(i >= 0, `slice ${label} among ${all.join(', ')}`);
  return i;
}

/** A download started by `act`: its suggested name and bytes. */
async function download(page, act) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), act()]);
  const where = await file.path();
  return { name: file.suggestedFilename(), bytes: readFileSync(where) };
}

/** Synthetic drag events with a DataTransfer that carries a file, as a drag from the desktop does. */
async function dragFile(page, name, type, bytes) {
  await page.evaluate(
    ({ name, type, b64 }) => {
      const data = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      window.__drag = new DataTransfer();
      window.__drag.items.add(new File([data], name, { type }));
    },
    { name, type, b64: bytes.toString('base64') },
  );
}
async function fire(page, type, x, y, shift = false) {
  await page.evaluate(
    ({ type, x, y, shift }) => {
      const target = (x >= 0 && y >= 0 && document.elementFromPoint(x, y)) || document.documentElement;
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          shiftKey: shift,
          dataTransfer: window.__drag,
        }),
      );
    },
    { type, x, y, shift },
  );
}
/** Holds the drag over a point for `ms`, as the browser keeps sending dragover while the pointer rests. */
async function rest(page, x, y, ms) {
  for (let t = 0; t < ms; t += 80) {
    await fire(page, 'dragover', x, y, true);
    await page.waitForTimeout(80);
  }
}

const centreOf = (page, selector) =>
  page.$eval(selector, (node) => {
    const b = node.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });

// ------------------------------------------------------------------ 1. keyboard, every format, desktop light EN

await scenario('keyboard, PNG to every format', async () => {
  const s = await open();
  await shot(s.page, 'zone-light-en');
  await choose(s.page, 'photo.png', 'image/png', PICTURES.png);
  await started(s);
  await wheelOpen(s.page);
  equal(
    await s.page.evaluate((m) => document.activeElement === document.querySelector(m), MENU),
    true,
    'the wheel takes the focus',
  );
  equal(
    await labels(s.page),
    ['JPG', 'WEBP', 'BMP', 'TIFF', 'GIF', 'PDF', 'ICO'],
    'the Convert wheel of a PNG (no AVIF here)',
  );
  equal(await s.page.$eval(MENU, (d) => d.getAttribute('aria-label')), 'Convert', 'the menu is named');
  await s.page.keyboard.press('ArrowDown');
  equal(await active(s.page), 'JPG', 'Down lands on the first slice');
  await s.page.waitForTimeout(250);
  check((await s.page.textContent('.kp-tip')).startsWith('JPG: Photos everywhere'), 'the tip describes the slice');
  await shot(s.page, 'wheel-light-en');
  await s.page.keyboard.press('ArrowRight');
  equal(await labels(s.page), ['High quality', 'Balanced', 'Small file'], 'Right opens the quality ring');
  equal(await active(s.page), 'Balanced', 'the ring opens on its default');
  equal(await s.page.$eval(MENU, (d) => d.getAttribute('aria-label')), 'JPG', 'the ring is named after its slice');
  check((await s.page.textContent(`${MENU} svg`)).includes('Convert ›'), 'the hub shows the trail');
  await s.page.waitForTimeout(300);
  await shot(s.page, 'ring-light-en');
  await s.page.keyboard.press('ArrowLeft');
  equal(await labels(s.page), ['JPG', 'WEBP', 'BMP', 'TIFF', 'GIF', 'PDF', 'ICO'], 'Left goes back');
  equal(await active(s.page), 'JPG', 'back on the slice that opened the ring');
  await s.page.keyboard.press('Enter');
  equal(await active(s.page), 'Balanced', 'Enter on a slice with choices opens them');
  await s.page.keyboard.press('ArrowUp');
  equal(await active(s.page), 'High quality', 'Up moves round the ring');
  const jpg = await download(s.page, () => s.page.keyboard.press('Enter'));
  equal(jpg.name, 'photo.jpg', 'the JPG is named as Kento names it');
  check(jpg.bytes[0] === 0xff && jpg.bytes[1] === 0xd8, 'the download is a JPEG');
  const jpgSeen = await decode(s.page, jpg.bytes, 'image/jpeg', [
    [320, 200],
    [1, 1],
  ]);
  equal([jpgSeen.width, jpgSeen.height], [640, 400], 'the JPEG keeps the size');
  check(near(jpgSeen.px[0], [42, 78, 166, 255], 12), `the JPEG's middle is blue: ${jpgSeen.px[0]}`);
  check(near(jpgSeen.px[1], [255, 255, 255, 255], 6), `the JPEG's transparent corner became white: ${jpgSeen.px[1]}`);
  await wheelGone(s.page);
  await s.page.waitForSelector('[data-result]:not([hidden])');
  check((await s.page.textContent('[data-result-meta]')).includes('High quality'), 'the result card names the quality');
  check(
    (await s.page.textContent('[data-result]')).includes('photo.png→photo.jpg'),
    'the result card names both files',
  );
  check((await s.page.textContent('[data-status]')).startsWith('Ready: '), 'the status says it is ready');
  equal(
    await s.page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-act')),
    'open',
    'the focus comes back to the stage',
  );
  await shot(s.page, 'result-light-en');

  const targets = {
    WEBP: async (file) => {
      check(
        file.bytes.toString('latin1', 0, 4) === 'RIFF' && file.bytes.toString('latin1', 8, 12) === 'WEBP',
        'WEBP bytes',
      );
      const seen = await decode(s.page, file.bytes, 'image/webp', [
        [320, 200],
        [1, 1],
      ]);
      equal([seen.width, seen.height], [640, 400], 'WEBP size');
      check(seen.px[1][3] === 0, 'WEBP keeps the transparent corner');
    },
    BMP: async (file) => {
      check(file.bytes.toString('latin1', 0, 2) === 'BM', 'BMP bytes');
      equal(file.bytes.length, 54 + 640 * 3 * 400, 'BMP length');
      const seen = await decode(s.page, file.bytes, 'image/bmp', [
        [320, 200],
        [1, 1],
      ]);
      equal([seen.width, seen.height], [640, 400], 'BMP size');
      check(near(seen.px[0], [42, 78, 166, 255], 0), `BMP middle: ${seen.px[0]}`);
      check(near(seen.px[1], [255, 255, 255, 255], 0), `BMP corner on white: ${seen.px[1]}`);
    },
    TIFF: async (file) => {
      const info = tiffInfo(file.bytes);
      equal([info.width, info.height, info.spp], [640, 400, 4], 'TIFF size and channels');
      equal(info.pixel(320, 200), [42, 78, 166, 255], 'TIFF middle');
      equal(info.pixel(0, 0)[3], 0, 'TIFF keeps the transparent corner');
    },
    GIF: async (file) => {
      check(file.bytes.toString('latin1', 0, 6) === 'GIF89a', 'GIF bytes');
      const seen = await decode(s.page, file.bytes, 'image/gif', [
        [320, 200],
        [1, 1],
      ]);
      equal([seen.width, seen.height], [640, 400], 'GIF size');
      check(near(seen.px[0], [42, 78, 166, 255], 8), `GIF middle: ${seen.px[0]}`);
      check(seen.px[1][3] === 0, 'GIF corner is transparent');
    },
    PDF: async (file) => {
      const info = pdfInfo(file.bytes);
      equal(info.media, [480, 300], 'PDF page at 96 dpi');
      equal([info.width, info.height, info.filter], [640, 400, 'FlateDecode'], 'PDF image');
      const rgb = inflateSync(info.image);
      equal(rgb.length, 640 * 400 * 3, 'PDF pixels');
      const at = (200 * 640 + 320) * 3;
      equal([...rgb.subarray(at, at + 3)], [42, 78, 166], 'PDF middle');
      check(info.smask && inflateSync(info.mask).length === 640 * 400, 'PDF keeps transparency as a soft mask');
    },
    ICO: async (file) => {
      const entries = icoInfo(file.bytes);
      equal(
        entries.map((e) => e.size),
        [16, 24, 32, 48, 64, 128, 256],
        'icon sizes',
      );
      const seen = await decode(s.page, entries.at(-1).png, 'image/png', [
        [128, 128],
        [128, 2],
      ]);
      check(near(seen.px[0], [42, 78, 166, 255], 10), `icon middle: ${seen.px[0]}`);
      check(seen.px[1][3] === 0, 'the icon is padded with transparency to a square');
    },
  };
  for (const [label, verify] of Object.entries(targets)) {
    await s.page.focus('[data-act="open"]');
    await s.page.keyboard.press('Enter');
    await wheelOpen(s.page);
    await keyTo(s.page, label);
    const press = async () => {
      await s.page.keyboard.press('Enter');
      if (label === 'WEBP') await s.page.keyboard.press('Enter');
    };
    const t0 = Date.now();
    const file = await download(s.page, press);
    notes.push(`PNG 640 × 400 → ${label}: ${file.bytes.length} bytes in ${Date.now() - t0} ms (with the apply motion)`);
    const ext = { WEBP: 'webp', BMP: 'bmp', TIFF: 'tif', GIF: 'gif', PDF: 'pdf', ICO: 'ico' }[label];
    equal(file.name, `photo.${ext}`, `${label} name`);
    await verify(file);
    await wheelGone(s.page);
  }
  // Esc closes the wheel and Tab does too, without converting.
  await s.page.focus('[data-act="open"]');
  await s.page.keyboard.press('Enter');
  await wheelOpen(s.page);
  await s.page.keyboard.press('Escape');
  await wheelGone(s.page);
  await s.page.keyboard.press('Enter');
  await wheelOpen(s.page);
  await s.page.keyboard.press('Tab');
  await wheelGone(s.page);
  await close(s);
});

// ------------------------------------------------------------------ 2. a JPEG: to PNG and to PDF

await scenario('JPEG source', async () => {
  const s = await open();
  await choose(s.page, 'Fotoğraf İzmir.jpeg', 'image/jpeg', PICTURES.jpg);
  await started(s);
  await wheelOpen(s.page);
  equal(await labels(s.page), ['PNG', 'WEBP', 'BMP', 'TIFF', 'GIF', 'PDF', 'ICO'], 'the Convert wheel of a JPEG');
  const png = await download(s.page, async () => {
    await keyTo(s.page, 'PNG');
    await s.page.keyboard.press('Enter');
  });
  equal(png.name, 'Fotoğraf İzmir.png', 'the PNG keeps the name, Turkish letters and spaces too');
  check(png.bytes.toString('latin1', 1, 4) === 'PNG', 'PNG bytes');
  const seen = await decode(s.page, png.bytes, 'image/png', [[400, 300]]);
  equal([seen.width, seen.height], [800, 600], 'PNG size');
  check(near(seen.px[0], [194, 55, 45, 255], 12), `PNG middle: ${seen.px[0]}`);
  await wheelGone(s.page);
  await s.page.focus('[data-act="open"]');
  await s.page.keyboard.press('Enter');
  await wheelOpen(s.page);
  const pdf = await download(s.page, async () => {
    await keyTo(s.page, 'PDF');
    await s.page.keyboard.press('Enter');
  });
  const info = pdfInfo(pdf.bytes);
  equal([info.filter, info.smask, info.media], ['DCTDecode', false, [600, 450]], 'a photo stays a JPEG inside the PDF');
  check(info.image[0] === 0xff && info.image[1] === 0xd8, 'the PDF holds JPEG data');
  const inside = await decode(s.page, info.image, 'image/jpeg', [[400, 300]]);
  equal([inside.width, inside.height], [800, 600], 'the JPEG inside the PDF');
  await wheelGone(s.page);
  await close(s);
});

// ------------------------------------------------------------------ 3. a drag with Shift, resting on a slice

await scenario('drag with Shift', async () => {
  const s = await open();
  await dragFile(s.page, 'photo.png', 'image/png', PICTURES.png);
  const zone = await centreOf(s.page, '[data-zone]');
  await fire(s.page, 'dragenter', zone.x, zone.y);
  await started(s);
  await fire(s.page, 'dragover', zone.x, zone.y);
  check(await s.page.$eval('[data-stage]', (n) => n.classList.contains('is-over')), 'the stage shows the drag');
  equal(await s.page.$('.kp-overlay'), null, 'no wheel without Shift');
  await fire(s.page, 'dragover', zone.x, zone.y, true);
  await wheelOpen(s.page);
  const disc = await centreOf(s.page, MENU);
  check(Math.abs(disc.x - zone.x) < 2 && Math.abs(disc.y - zone.y) < 2, 'the wheel opens under the pointer');
  equal(await labels(s.page), ['JPG', 'WEBP', 'BMP', 'TIFF', 'GIF', 'PDF', 'ICO'], 'the wheel knows the dragged type');
  await shot(s.page, 'drag-open-light-en');
  // Resting on WEBP for half a second opens its quality ring, unfolded where WEBP was.
  const webp = await slicePoint(s.page, await indexOf(s.page, 'WEBP'));
  await rest(s.page, webp.x, webp.y, 760);
  equal(await labels(s.page), ['High quality', 'Balanced', 'Small file'], 'resting opens the ring');
  const balanced = await slicePoint(s.page, 1);
  check(Math.hypot(balanced.x - webp.x, balanced.y - webp.y) < 2, 'the default sits where its slice was');
  const small = await slicePoint(s.page, 2);
  await rest(s.page, small.x, small.y, 160);
  equal(await active(s.page), 'Small file', 'the drag hovers the choice');
  await shot(s.page, 'drag-ring-light-en');
  const file = await download(s.page, () => fire(s.page, 'drop', small.x, small.y, true));
  equal(file.name, 'photo.webp', 'the drop converts the dragged file');
  check(file.bytes.toString('latin1', 8, 12) === 'WEBP', 'WEBP bytes');
  await wheelGone(s.page);
  check((await s.page.textContent('[data-result-meta]')).includes('Small file'), 'the result names the choice');
  // Resting on the hub inside a ring goes back; a drop outside the wheel cancels.
  await fire(s.page, 'dragover', zone.x, zone.y, true);
  await wheelOpen(s.page);
  const jpg = await slicePoint(s.page, 0);
  await rest(s.page, jpg.x, jpg.y, 700);
  equal(await labels(s.page), ['High quality', 'Balanced', 'Small file'], 'the JPG ring opens');
  const hub = await centreOf(s.page, MENU);
  await rest(s.page, hub.x + 30, hub.y + 30, 160);
  await rest(s.page, hub.x, hub.y, 700);
  equal(await labels(s.page), ['JPG', 'WEBP', 'BMP', 'TIFF', 'GIF', 'PDF', 'ICO'], 'resting on the hub goes back');
  let fired = false;
  s.page.once('download', () => (fired = true));
  await fire(s.page, 'drop', 8, 8, true);
  await wheelGone(s.page);
  equal(fired, false, 'a drop outside the wheel converts nothing');
  // A drag that leaves the window closes the wheel it opened.
  await fire(s.page, 'dragover', zone.x, zone.y, true);
  await wheelOpen(s.page);
  await fire(s.page, 'dragleave', -1, -1, true);
  await wheelGone(s.page);
  // Ctrl names the other wheels; a plain drop loads the file and opens the wheel there.
  await s.page.evaluate(() => {
    const stage = document.querySelector('[data-stage]');
    const b = stage.getBoundingClientRect();
    const at = { clientX: b.left + 20, clientY: b.top + 20 };
    stage.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, ...at, ctrlKey: true, dataTransfer: window.__drag }),
    );
  });
  check(
    (await s.page.textContent('[data-status]')).includes('Ctrl opens the Tools wheel'),
    'Ctrl during a drag is explained',
  );
  const fileZone = await centreOf(s.page, '[data-file]');
  await fire(s.page, 'drop', fileZone.x, fileZone.y);
  await wheelOpen(s.page);
  check((await s.page.textContent('[data-status]')).includes('hold Shift'), 'a plain drop suggests Shift');
  await s.page.keyboard.press('Escape');
  await wheelGone(s.page);
  await close(s);
});

// ------------------------------------------------------------------ 4. phone width, touch

await scenario('phone, touch', async () => {
  const s = await open({ viewport: { width: 390, height: 844 }, mobile: true });
  check((await s.page.isVisible('.kp-touch')) === false, 'the touch hint waits for a picture');
  await shot(s.page, 'zone-phone-en', true);
  await choose(s.page, 'photo.png', 'image/png', PICTURES.png);
  await started(s);
  await wheelOpen(s.page);
  const box = await s.page.$eval('.kp-wheel', (n) => n.getBoundingClientRect().toJSON());
  check(
    box.left >= 0 && box.right <= 390 && box.top >= 0 && box.bottom <= 844,
    `the wheel fits the phone: ${JSON.stringify(box)}`,
  );
  await s.page.waitForTimeout(300);
  await shot(s.page, 'wheel-phone-en');
  const gif = await slicePoint(s.page, await indexOf(s.page, 'GIF'));
  const tapped = await download(s.page, () => s.page.touchscreen.tap(gif.x, gif.y));
  equal(tapped.name, 'photo.gif', 'a tap on a slice converts');
  await wheelGone(s.page);
  check(await s.page.isVisible('[data-file] .kp-touch'), 'the touch hint shows on a touch screen');
  const cdp = await s.context.newCDPSession(s.page);
  const thumb = await centreOf(s.page, '[data-thumb]');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: thumb.x, y: thumb.y }] });
  await s.page.waitForTimeout(700);
  check(!!(await s.page.$('.kp-overlay')), 'press and hold opens the wheel');
  const disc = await centreOf(s.page, MENU);
  const heldNear = Math.abs(disc.x - thumb.x) < 2 || disc.x > thumb.x;
  check(heldNear, 'the wheel opens at the finger, moved to stay on screen');
  const bmp = await slicePoint(s.page, await indexOf(s.page, 'BMP'));
  // Touch moves reach the page on animation frames.
  const halfway = { x: (thumb.x + bmp.x) / 2, y: (thumb.y + bmp.y) / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [halfway] });
  await s.page.waitForTimeout(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bmp.x, y: bmp.y }] });
  await s.page.waitForTimeout(100);
  equal(await active(s.page), 'BMP', 'sliding the finger hovers a slice');
  const slid = await download(s.page, () =>
    cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  );
  equal(slid.name, 'photo.bmp', 'lifting the finger on a slice converts');
  await wheelGone(s.page);
  // Holding a finger on a slice with choices opens them.
  await s.page.locator('[data-act="open"]').tap();
  await wheelOpen(s.page);
  const jpg = await slicePoint(s.page, 0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jpg.x, y: jpg.y }] });
  await s.page.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  equal(await labels(s.page), ['High quality', 'Balanced', 'Small file'], 'holding a slice opens its choices');
  await shot(s.page, 'ring-phone-en');
  const high = await slicePoint(s.page, 0);
  const tappedRing = await download(s.page, () => s.page.touchscreen.tap(high.x, high.y));
  equal(tappedRing.name, 'photo.jpg', 'a tap in the ring converts');
  await wheelGone(s.page);
  await s.page.locator('[data-result]').scrollIntoViewIfNeeded();
  await shot(s.page, 'result-phone-en');
  await close(s);
});

// ------------------------------------------------------------------ 5. dark, Turkish, reduced motion

await scenario('dark, Turkish, reduced motion', async () => {
  const s = await open({ lang: 'tr', theme: 'dark', reducedMotion: 'reduce' });
  equal(await s.page.innerText('#kento-playground-title'), 'Çarkı deneyin', 'the title in Turkish');
  await shot(s.page, 'zone-dark-tr');
  await s.page.click('[data-act="sample"]');
  await started(s);
  await wheelOpen(s.page);
  equal(await s.page.$eval(MENU, (d) => d.getAttribute('aria-label')), 'Dönüştür', 'the wheel in Turkish');
  check(await s.page.$eval('.kp-wheel', (n) => n.classList.contains('is-reduced')), 'reduced motion is followed');
  equal(await s.page.$eval(`${MENU} .kw-dial`, (n) => getComputedStyle(n).transitionDuration), '0s', 'the dial jumps');
  equal(await s.page.$eval(`${MENU} circle[r="56"]`, (n) => n.getAttribute('fill')), '#1b1e22', 'dark steel');
  await s.page.keyboard.press('ArrowDown');
  await s.page.waitForTimeout(150);
  check((await s.page.textContent('.kp-tip')).startsWith('JPG: Her yerde açılan fotoğraf'), 'the tip in Turkish');
  await s.page.keyboard.press('ArrowRight');
  equal(await labels(s.page), ['Yüksek kalite', 'Dengeli', 'Küçük dosya'], 'the ring in Turkish');
  check((await s.page.textContent(`${MENU} svg`)).includes('Dönüştür ›'), 'the trail in Turkish');
  await shot(s.page, 'ring-dark-tr');
  // A theme switch on the page repaints the open wheel.
  await s.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await s.page.waitForTimeout(50);
  equal(
    await s.page.$eval(`${MENU} circle[r="56"]`, (n) => n.getAttribute('fill')),
    '#f3f5f7',
    'light steel after the switch',
  );
  equal(await labels(s.page), ['Yüksek kalite', 'Dengeli', 'Küçük dosya'], 'the ring stays open through a repaint');
  await s.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const file = await download(s.page, () => s.page.keyboard.press('Enter'));
  equal(file.name, 'örnek.jpg', 'the sample is named in Turkish');
  await wheelGone(s.page);
  check((await s.page.textContent('[data-status]')).startsWith('Hazır: '), 'the status in Turkish');
  check(/Dengeli/.test(await s.page.textContent('[data-result-meta]')), 'the result in Turkish');
  await shot(s.page, 'result-dark-tr');
  // The language follows the page as it changes.
  await s.page.click('[data-set-lang="en"]');
  check((await s.page.textContent('[data-status]')).startsWith('Ready: '), 'the status follows the page language');
  await close(s);
});

// ------------------------------------------------------------------ 6. what this browser writes

await scenario('AVIF and WebP detection', async () => {
  const off = await open();
  await off.page.click('[data-act="sample"]');
  await started(off);
  await wheelOpen(off.page);
  check(!(await labels(off.page)).includes('AVIF'), 'no AVIF slice where the canvas cannot write AVIF');
  const line = await off.page.textContent('[data-formats-now]');
  check(line.includes('AVIF is left out'), `the page says AVIF is left out: ${line}`);
  notes.push(`Chromium ${browser.version()}: ${line}`);
  await close(off);

  // A canvas that writes AVIF (simulated: PNG bytes labelled AVIF) gives the wheel an AVIF slice.
  const avif = () => {
    const write = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (done, type, quality) {
      if (type !== 'image/avif') return write.call(this, done, type, quality);
      return write.call(this, (blob) => done(blob && new Blob([blob], { type: 'image/avif' })), 'image/png');
    };
  };
  const on = await open({ init: avif });
  await choose(on.page, 'photo.png', 'image/png', PICTURES.png);
  await started(on);
  await wheelOpen(on.page);
  equal(
    await labels(on.page),
    ['JPG', 'WEBP', 'AVIF', 'BMP', 'TIFF', 'GIF', 'PDF', 'ICO'],
    'AVIF where the canvas writes it',
  );
  equal(
    await on.page.textContent('[data-formats-now]'),
    'In this browser the wheel offers JPG, PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF and ICO.',
    'nothing left out',
  );
  const made = await download(on.page, async () => {
    await keyTo(on.page, 'AVIF');
    await on.page.keyboard.press('Enter');
    await on.page.keyboard.press('Enter');
  });
  equal(made.name, 'photo.avif', 'the AVIF slice converts and names the file');
  await wheelGone(on.page);
  await close(on);

  // A canvas without WebP (as in Safari) leaves WEBP out and says so.
  const noWebp = () => {
    const write = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (done, type, quality) {
      return write.call(this, done, type === 'image/webp' ? 'image/png' : type, quality);
    };
  };
  const safari = await open({ init: noWebp });
  await safari.page.click('[data-act="sample"]');
  await started(safari);
  await wheelOpen(safari.page);
  equal(await labels(safari.page), ['JPG', 'BMP', 'TIFF', 'GIF', 'PDF', 'ICO'], 'no WEBP slice without a WebP writer');
  check(
    (await safari.page.textContent('[data-formats-now]')).includes('WEBP and AVIF are left out'),
    'the page names both',
  );
  await close(safari);
});

// ------------------------------------------------------------------ 7. more than eight slices: an SVG

await scenario('SVG and paging', async () => {
  const avif = () => {
    const write = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (done, type, quality) {
      if (type !== 'image/avif') return write.call(this, done, type, quality);
      return write.call(this, (blob) => done(blob && new Blob([blob], { type: 'image/avif' })), 'image/png');
    };
  };
  const s = await open({ init: avif, csp: 'blob' });
  await choose(s.page, 'logo.svg', 'image/svg+xml', SVG);
  await started(s);
  await wheelOpen(s.page);
  equal(await labels(s.page), ['JPG', 'PNG', 'WEBP', 'AVIF', 'BMP', 'TIFF', 'GIF', 'More…'], 'seven slices and More…');
  await s.page.keyboard.press('End');
  await s.page.keyboard.press('Enter');
  equal(await labels(s.page), ['PDF', 'ICO', 'Back to start'], 'the second page');
  equal(await active(s.page), 'Back to start', 'the paging slice keeps its place');
  await shot(s.page, 'paging-light-en');
  await s.page.keyboard.press('PageDown');
  equal((await labels(s.page))[0], 'JPG', 'Page Down turns the page');
  await s.page.keyboard.press('ArrowDown');
  await s.page.keyboard.press('ArrowDown');
  const png = await download(s.page, () => s.page.keyboard.press('Enter'));
  equal(png.name, 'logo.png', 'the SVG becomes a PNG');
  const seen = await decode(s.page, png.bytes, 'image/png', [
    [150, 100],
    [2, 2],
  ]);
  equal([seen.width, seen.height], [300, 200], 'an SVG without a width and height is drawn at its viewBox');
  check(near(seen.px[0], [238, 241, 243, 255], 4), `the SVG's circle: ${seen.px[0]}`);
  check(seen.px[1][3] < 255, 'the SVG keeps its transparent corner');
  await wheelGone(s.page);
  await close(s);

  // Under the website's CSP as it is (no blob: images) an SVG cannot be read, and the page says so.
  const strict = await open();
  await choose(strict.page, 'logo.svg', 'image/svg+xml', SVG);
  await started(strict);
  await strict.page.waitForFunction(() => document.querySelector('[data-status]').classList.contains('is-error'));
  equal(
    await strict.page.textContent('[data-status]'),
    '\u2068logo.svg\u2069 could not be read in this browser.',
    'the refusal',
  );
  notes.push(`SVG under img-src 'self': ${(await strict.page.evaluate(() => window.__violations || [])).join(', ')}`);
  strict.log.violations.length = 0;
  await strict.page.evaluate(() => (window.__violations = []));
  await close(strict);
});

// ------------------------------------------------------------------ 8. refusals

await scenario('refusals', async () => {
  const s = await open();
  await choose(s.page, 'IMG_0001.HEIC', 'image/heic', HEIC);
  await started(s);
  await s.page.waitForFunction(() => document.querySelector('[data-status]').classList.contains('is-error'));
  check(
    (await s.page.textContent('[data-status]')).startsWith('This browser cannot read HEIC pictures'),
    'HEIC is refused plainly',
  );
  equal(await s.page.$('.kp-overlay'), null, 'no wheel for a picture that cannot be read');
  await shot(s.page, 'heic-light-en');
  await choose(s.page, 'notes.txt', 'text/plain', Buffer.from('Not a picture at all.'));
  await s.page.waitForFunction(() => document.querySelector('[data-status]').textContent.includes('is not a picture'));
  equal(
    await s.page.textContent('[data-status]'),
    '\u2068notes.txt\u2069 is not a picture the playground reads. Try a PNG, JPG, WEBP, GIF, BMP, AVIF or SVG file.',
    'a text file is refused',
  );
  await s.page.click('[data-act="sample"]');
  await wheelOpen(s.page);
  await s.page.keyboard.press('Escape');
  await wheelGone(s.page);
  // A large picture still converts in reasonable time.
  await choose(s.page, 'big.png', 'image/png', PICTURES.big, '[data-file] [data-act="choose"]');
  await wheelOpen(s.page);
  const t0 = Date.now();
  const gif = await download(s.page, async () => {
    await keyTo(s.page, 'GIF');
    await s.page.keyboard.press('Enter');
  });
  notes.push(`PNG 2400 × 1600 → GIF: ${gif.bytes.length} bytes in ${Date.now() - t0} ms (with the apply motion)`);
  const seen = await decode(s.page, gif.bytes, 'image/gif');
  equal([seen.width, seen.height], [2400, 1600], 'the large GIF');
  await wheelGone(s.page);
  await close(s);
});

// ------------------------------------------------------------------ 9. the one-page draft

await scenario('one-page draft', async () => {
  const s = await open({ page: '/index.html' });
  await s.page.waitForSelector('.kento-playground[data-ready]');
  // The draft's own sections ask for the catalog and the GitHub API as it loads.
  await s.page.waitForLoadState('networkidle');
  equal(await s.page.$$eval('[data-dial] svg', (n) => n.length), 2, 'the hero draws its wheel in light and dark');
  const hero = await s.page.$eval('[data-dial]', (n) => n.getBoundingClientRect().toJSON());
  const before = await s.page.$eval('[data-dial] .is-light .kw-dial', (n) => n.style.transform);
  await s.page.mouse.move(hero.x + hero.width / 2 + hero.width * 0.22, hero.y + hero.height / 2);
  await s.page.waitForTimeout(100);
  const after = await s.page.$eval('[data-dial] .is-light .kw-dial', (n) => n.style.transform);
  check(
    before !== after && after === 'rotate(90deg)',
    `the hero's dial turns to the slice under the pointer: ${before} → ${after}`,
  );
  await s.page.locator('#playground [data-act="sample"]').scrollIntoViewIfNeeded();
  await s.page.click('#playground [data-act="sample"]');
  await started(s);
  await wheelOpen(s.page);
  equal((await labels(s.page)).length, 7, 'the playground runs inside the draft');
  await s.page.keyboard.press('Escape');
  await wheelGone(s.page);
  await shot(s.page, 'draft-light-en', true);
  const log = await close(s);
  const outside = log.requests.filter((r) => !r.includes(origin));
  notes.push(`The draft's requests to other sites (refused here as on the website): ${outside.join(', ') || 'none'}`);
  check(
    log.violations.every((v) => v.startsWith('connect-src https://api.github.com')),
    `CSP violations on the draft: ${log.violations.join(', ')}`,
  );
});

// ------------------------------------------------------------------ the end

/** A screenshot once the motion has settled. A full-page one drops touch emulation in Chromium, so a
 *  phone page shows its mouse hints in it. */
async function shot(page, name, full = false) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: full });
}

await browser.close();
server.close();
for (const note of notes) console.log(`· ${note}`);
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n${failures.map((f) => `  ✗ ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`\nThe playground passed every check. Screenshots: ${path.relative(root, shots)}`);
