// SPDX-License-Identifier: MIT
// The stage of the demo recording (scripts/record-demo.mjs): a plain desktop of our own with a
// folder window, a pointer, key caps and captions, round Kento's real windows. Each window is the
// app itself in a frame, on the browser stand-in that scripts/demo/stand-in.mjs fills: the
// floating wheel, the corner card, the shelf and the main window. The stage plays the core's part
// and drives the drag; `demo.play()` runs the storyboard once and `demo.still(name)` sets up one
// screenshot for the README.
import '@fontsource-variable/ibm-plex-sans/wght.css';
import './stage.css';
import { paintPhoto } from './stand-in.mjs';

const params = new URLSearchParams(window.location.search);
const LANG = params.get('lang') === 'tr' ? 'tr' : 'en';
/** A page for one screenshot: no montage to load, and everything light or dark from the start. */
const STILL = params.has('still');
const DARK = params.get('appearance') === 'dark';

const TEXT = {
  en: {
    tagline: 'Drag a file. Press a key. Drop it on the dial.',
    folder: 'Demo',
    items: (n) => `${n} items`,
    files: ['sunrise.heic', 'harbor.jpg', 'report.docx', 'slides.pptx', 'budget.xlsx', 'invoice.pdf', 'clip.mov'],
    made: ['sunrise.jpg', 'clip.mp4', 'clip - vertical.mp4'],
    mac: (key) => `${key} on a Mac`,
    caption: {
      drag: 'Drag a file and press Shift',
      wheel: 'The Convert wheel opens under the pointer',
      rest: 'Rest on a slice for its choices',
      copy: 'Drop it: a new copy, next to the original',
      ctrl: 'Ctrl opens the tools',
      tools: 'Crop, mark up, compress, remove the background…',
      video: 'Make a video vertical for shorts and stories',
      pauses: 'Take the pauses out of a talk or a podcast',
      music: 'Add music: it steps back when someone speaks',
      overlay: 'Put a title or your logo on the video',
      redact: 'Hide faces, number plates and marks',
      loudness: 'Even out the sound for a podcast or a video',
      alt: 'Alt opens the file actions',
      shelf: 'Share, copy, move, ZIP, or keep it on the shelf',
      mixed: 'A mixed selection? Pick the kind, then the format',
      formats: 'Documents, slides, spreadsheets, PDF, video, audio',
      paste: 'Paste a video link to download it',
      rules: 'Folder rules handle new files by themselves',
      recipes: 'Recipes chain steps: crop, resize, compress',
      library: 'The Library keeps what Kento made',
      dark: 'Light or dark',
      languages: 'Twelve languages, right to left too',
    },
    title: 'Sunrise over the valley',
    vertical: 'Make vertical',
    languages: 'languages',
    end: ['Free and open source', 'Works on your computer', 'Windows and macOS'],
  },
  tr: {
    tagline: 'Dosyayı sürükle. Bir tuşa bas. Kadrana bırak.',
    folder: 'Demo',
    items: (n) => `${n} öğe`,
    files: ['balon.heic', 'liman.jpg', 'rapor.docx', 'sunum.pptx', 'bütçe.xlsx', 'fatura.pdf', 'klip.mov'],
    made: ['balon.jpg', 'klip.mp4', 'klip - dikey.mp4'],
    mac: (key) => `Mac’te ${key}`,
    caption: {
      drag: 'Bir dosyayı sürükle, Shift’e bas',
      wheel: 'Dönüştürme çarkı imlecin altında açılır',
      rest: 'Seçenekler için bir dilimde bekle',
      copy: 'Bırak: orijinalin yanına yeni bir kopya',
      ctrl: 'Ctrl araçları açar',
      tools: 'Kırp, işaretle, sıkıştır, arka planı kaldır…',
      video: 'Videoyu kısa videolar ve hikâyeler için dikey yap',
      pauses: 'Konuşmadaki ve podcast’teki duraklamaları çıkar',
      music: 'Müzik ekle: biri konuşunca kendiliğinden kısılır',
      overlay: 'Videoya bir başlık ya da logonu koy',
      redact: 'Yüzleri, plakaları ve işaretleri gizle',
      loudness: 'Sesi podcast ya da video için dengele',
      alt: 'Alt dosya işlemlerini açar',
      shelf: 'Paylaş, kopyala, taşı, ZIP’le ya da rafa koy',
      mixed: 'Karışık seçim mi? Önce türü, sonra biçimi seç',
      formats: 'Belgeler, sunumlar, tablolar, PDF, video, ses',
      paste: 'İndirmek için bir video bağlantısı yapıştır',
      rules: 'Klasör kuralları yeni dosyaları kendiliğinden işler',
      recipes: 'Tarifler adımları birbirine bağlar: kırp, boyutlandır, sıkıştır',
      library: 'Kütüphane, Kento’nun yaptıklarını tutar',
      dark: 'Açık ya da koyu',
      languages: 'On iki dil, sağdan sola yazılanlar dahil',
    },
    title: 'Vadide gün doğumu',
    vertical: 'Dikey video yap',
    languages: 'dil',
    end: ['Ücretsiz ve açık kaynak', 'Bilgisayarında çalışır', 'Windows ve macOS'],
  },
}[LANG];

/** The wheel in eight of the twelve languages, at the end: the recording's own first, Arabic
 *  (right to left) last. */
const NAMES = {
  en: 'English',
  tr: 'Türkçe',
  de: 'Deutsch',
  es: 'Español',
  ja: '日本語',
  ko: '한국어',
  'zh-Hans': '简体中文',
  ar: 'العربية',
};
const MONTAGE = [LANG, LANG === 'tr' ? 'en' : 'tr', 'de', 'es', 'ja', 'ko', 'zh-Hans', 'ar'].map((code) => [
  code,
  NAMES[code],
]);

const FOLDER = 'C:\\Users\\me\\Documents\\Demo';
const pathOf = (name) => `${FOLDER}\\${name}`;
const [PHOTO, HARBOUR, DOC, SLIDES, SHEET, PDF, VIDEO] = TEXT.files.map(pathOf);
const [JPG, MP4, VERTICAL] = TEXT.made.map(pathOf);
/** An interview and a song for the audio editors' screenshots; they are not on the desk. */
const AUDIO = pathOf(LANG === 'tr' ? 'röportaj.mp3' : 'interview.mp3');
const SONG = pathOf(LANG === 'tr' ? 'şarkı.mp3' : 'song.mp3');

// ---------------------------------------------------------------- small tools

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Calls `step` on every frame with the eased share of `ms` gone by, read from performance.now
 *  (the frame's own timestamp may lag behind it). */
function tween(ms, step, curve = inOut) {
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = () => {
      const t = Math.min(1, Math.max(0, (performance.now() - start) / ms));
      step(curve(t));
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

async function until(test, what, timeout = 30_000) {
  const start = performance.now();
  while (!test()) {
    if (performance.now() - start > timeout) throw new Error(`stage: waited too long for ${what}`);
    await sleep(50);
  }
}

function element(tag, className, parent, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  parent?.append(node);
  return node;
}

const stage = document.getElementById('stage');

// ---------------------------------------------------------------- the desktop

element('div', 'desk', stage);
const darkDesk = element('div', 'desk is-dark', stage);

const GLYPH_COLORS = {
  docx: '#2a4ea6',
  pptx: '#b4532a',
  xlsx: '#1c7a4b',
  pdf: '#b8322a',
  mov: '#5a4bb0',
  mp4: '#5a4bb0',
};

/** The picture of a file in the folder window: the photo itself, or a page with its type. */
function thumb(name) {
  const box = element('div', 'thumb');
  const extension = name.split('.').pop();
  if (extension === 'heic' || extension === 'jpg') {
    const photo = paintPhoto(128, 96, /harbor|liman/.test(name) ? 'jpg' : 'heic');
    box.append(photo);
    return box;
  }
  const color = GLYPH_COLORS[extension] ?? '#555c67';
  const lines = [22, 27, 32].map((y) => `<path d="M10 ${y}h${y === 32 ? 16 : 24}" stroke="#c3c8ce" stroke-width="2"/>`);
  box.innerHTML = `<svg width="48" height="60" viewBox="0 0 48 60" aria-hidden="true">
    <path d="M5 1.5h27l13.5 13.5v41a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-52.5a2 2 0 0 1 2-2z" fill="#fff" stroke="#aab1ba" stroke-width="1.5"/>
    <path d="M32 1.5v11.5a2 2 0 0 0 2 2h11.5" fill="#eef0f3" stroke="#aab1ba" stroke-width="1.5"/>
    ${lines.join('')}
    <rect x="1" y="38" width="36" height="14" rx="3" fill="${color}"/>
    <text x="19" y="48.3" fill="#fff" font-family="IBM Plex Sans Variable, sans-serif" font-size="9" font-weight="700" text-anchor="middle">${extension.toUpperCase()}</text>
  </svg>`;
  return box;
}

const folder = element('section', 'folder', stage);
const folderHead = element(
  'header',
  'folder-head',
  folder,
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span>${TEXT.folder}</span><span class="count"></span>`,
);
const tiles = element('div', 'tiles', folder);
const tileOf = new Map();
function addTile(path, fresh = false) {
  const name = path.split('\\').pop();
  const tile = element('div', fresh ? 'tile is-new' : 'tile', tiles);
  tile.append(thumb(name));
  element('div', 'name', tile).textContent = name;
  tileOf.set(path, tile);
  return tile;
}
for (const path of [PHOTO, HARBOUR, DOC, SLIDES, SHEET, PDF, VIDEO]) addTile(path);
// In the order the tour makes them: the photo, the vertical clip, the converted clip.
for (const path of [JPG, VERTICAL, MP4]) addTile(path, true);
const countItems = () =>
  (folderHead.querySelector('.count').textContent = TEXT.items(
    [...tiles.children].filter((tile) => !tile.classList.contains('is-new') || tile.classList.contains('is-shown'))
      .length,
  ));
countItems();

async function reveal(path) {
  tileOf.get(path).classList.add('is-shown');
  countItems();
}

function centerOf(node) {
  const box = node.getBoundingClientRect();
  const origin = stage.getBoundingClientRect();
  return [box.left - origin.left + box.width / 2, box.top - origin.top + box.height / 2];
}

// ---------------------------------------------------------------- Kento's windows

const query = (extra) =>
  `/?${new URLSearchParams({ demo: '1', tools: 'ready', lang: LANG, appearance: DARK ? 'dark' : 'light', ...extra })}`;

function appFrame(className, extra, [width, height], parent = stage) {
  const frame = element('iframe', className, parent);
  frame.width = String(width);
  frame.height = String(height);
  Object.assign(frame.style, { inlineSize: `${width}px`, blockSize: `${height}px` });
  // The frame's scheme must be the page's own, or the browser paints it opaque.
  frame.style.colorScheme = (extra.appearance ?? (DARK ? 'dark' : 'light')) === 'dark' ? 'dark' : 'light';
  frame.tabIndex = -1;
  frame.src = query(extra);
  return frame;
}
const kento = (frame) => frame.contentWindow.__kento;

const mainWindow = element('div', 'window', stage);
element('div', 'window-head', mainWindow, `<img src="/design/icons/app.svg" alt=""><span>Kento</span>`);
const main = appFrame('', { section: 'home' }, [920, 472], mainWindow);
const toast = appFrame('surface toast', { surface: 'toast' }, [400, 200]);
Object.assign(toast.style, { insetInlineStart: '546px', insetBlockStart: '412px' });
const shelf = appFrame('surface shelf', { surface: 'shelf' }, [300, 480]);
Object.assign(shelf.style, { insetInlineStart: '644px', insetBlockStart: '24px' });

/** The floating wheel: its own transparent window, opened under the pointer. */
class FloatingWheel {
  constructor(extra, className = '') {
    this.frame = appFrame(`surface wheel ${className}`, { surface: 'wheel', ...extra }, [520, 520]);
    this.at = [0, 0];
  }
  get kento() {
    return kento(this.frame);
  }
  get doc() {
    return this.frame.contentDocument;
  }
  ready() {
    return () => !!this.kento?.listens('wheelOpen') && this.kento.listens('drag');
  }
  /** The core moves the window under the pointer and starts a session for the dragged files;
   *  `shown` false keeps it out of sight until a cut shows it. */
  async open(kind, paths, [x, y] = [pointer.x, pointer.y], shown = true) {
    await this.closed();
    this.at = [Math.round(x - 260), Math.round(y - 260)];
    Object.assign(this.frame.style, { insetInlineStart: `${this.at[0]}px`, insetBlockStart: `${this.at[1]}px` });
    // Recent choices would reorder the slices; every take starts from the catalog's order.
    this.frame.contentWindow.localStorage.removeItem('kento.recent');
    this.kento.openWheel({ id: ++FloatingWheel.sessions, kind, mode: 'drag', paths });
    this.kento.drag({ type: 'enter', paths, link: null, ...this.local(x, y) });
    if (!shown) return;
    this.frame.classList.add('is-shown');
    // The dragged pictures give way to the labels under them.
    ghost.classList.add('is-over');
    pointer.feed = this;
  }
  local(x, y) {
    return { x: x - this.at[0], y: y - this.at[1] };
  }
  over(x, y) {
    this.kento.drag({ type: 'over', ...this.local(x, y) });
  }
  drop() {
    pointer.feed = null;
    this.kento.drag({ type: 'drop', paths: [], link: null, ...this.local(pointer.x, pointer.y) });
  }
  close() {
    pointer.feed = null;
    this.kento.closeWheel();
  }
  /** Takes the window away at once, for a cut. */
  cut() {
    pointer.feed = null;
    this.frame.classList.add('is-cut');
    this.frame.classList.remove('is-shown');
    this.kento.closeWheel();
  }
  async opened() {
    await until(() => this.doc.querySelector('.wheel.is-open'), 'the wheel');
  }
  /** The last session has ended (its wheel has played its close). */
  async closed() {
    await until(() => !this.doc.querySelector('.wheel'), 'the wheel to close');
  }
  /** The place of the slice named `label` in the ring on screen. */
  async indexOf(label) {
    await this.opened();
    const items = [...this.doc.querySelectorAll('.wheel-face [role=menuitem]')];
    // A long label breaks into lines, so spaces are not compared.
    const bare = (text) => text.replace(/\s+/g, '');
    const index = items.findIndex((item) => bare(item.textContent).includes(bare(label)));
    if (index < 0) throw new Error(`stage: no slice ${label}`);
    return index;
  }
  /** Where to point at the `index`-th slice of the ring on screen, on the stage: a little below and
   *  after its label, so the pointer does not hide it. */
  async slice(index) {
    await this.opened();
    const items = this.doc.querySelectorAll('.wheel-face [role=menuitem]');
    const content = items[index]?.querySelector('.wheel-content');
    if (!content) throw new Error(`stage: no slice ${index}`);
    const box = content.getBoundingClientRect();
    return [this.at[0] + box.left + box.width / 2 + 12, this.at[1] + box.top + box.height / 2 + 16];
  }
}
FloatingWheel.sessions = 0;
const wheel = new FloatingWheel({});
const montage = (STILL ? [] : MONTAGE).map(([code, name]) => ({
  name,
  wheel: new FloatingWheel({ lang: code, appearance: 'dark' }, 'is-cut'),
}));

// ---------------------------------------------------------------- pointer, drag and keys

const pointerNode = element(
  'div',
  'pointer',
  stage,
  `<svg width="24" height="30" viewBox="0 0 24 30" aria-hidden="true"><path d="M2.5 2.2v21.6l5.6-5.3 3.7 8.6 3.6-1.5-3.7-8.5h7.8z" fill="#fff" stroke="#15181c" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
);
const clickNode = element('div', 'click', stage);
const ghost = element('div', 'ghost', stage);

const pointer = {
  x: 640,
  y: 420,
  feed: null,
  place() {
    pointerNode.style.transform = `translate(${this.x - 2.5}px, ${this.y - 2.2}px)`;
    // The position goes in translate, which comes before the scale the ghost takes over a wheel.
    ghost.style.translate = `${this.x + 14}px ${this.y + 18}px`;
    this.feed?.over(this.x, this.y);
  },
  /** Moves along a gentle curve, easing in and out, as a hand does. */
  async to([x, y], ms = 650, arc = 0.1) {
    const [x0, y0] = [this.x, this.y];
    const [cx, cy] = [(x0 + x) / 2 - (y - y0) * arc, (y0 + y) / 2 + (x - x0) * arc];
    await tween(ms, (t) => {
      const u = 1 - t;
      this.x = u * u * x0 + 2 * u * t * cx + t * t * x;
      this.y = u * u * y0 + 2 * u * t * cy + t * t * y;
      this.place();
    });
  },
  jump([x, y]) {
    this.x = x;
    this.y = y;
    this.place();
  },
  async click() {
    clickNode.style.transform = `translate(${this.x}px, ${this.y}px)`;
    clickNode.classList.remove('is-on');
    void clickNode.offsetWidth;
    clickNode.classList.add('is-on');
    await sleep(140);
  },
};
pointer.place();

let dragged = [];
/** Picks up files: their tiles fade a little and their pictures follow the pointer. */
function grab(paths) {
  dragged = paths.map((path) => tileOf.get(path)).filter(Boolean);
  dragged.forEach((tile) => tile.classList.add('is-dragged'));
  ghost.replaceChildren(...paths.slice(0, 3).map((path) => thumb(path.split('\\').pop())));
  if (paths.length > 1) element('span', 'badge', ghost).textContent = String(paths.length);
  ghost.classList.add('is-on');
}
function letGo() {
  dragged.forEach((tile) => tile.classList.remove('is-dragged'));
  dragged = [];
  ghost.classList.remove('is-on', 'is-over');
}
function select(paths) {
  tiles.querySelectorAll('.tile').forEach((tile) => tile.classList.remove('is-selected'));
  paths.forEach((path) => tileOf.get(path)?.classList.add('is-selected'));
}

const caption = element('div', 'caption', stage);
let line = null;
/** Puts a new caption in the band under the scene; the old one slides away. */
let said = '';
let saidAt = 0;
/** How long a caption stays before the next may replace it, in the demo's time: long enough to
 *  read while watching what happens above it. */
const holdFor = (text) => Math.min(4400, Math.max(2400, 1300 + 62 * text.length));

/** Waits until the caption on screen has been up long enough to read. */
async function settle() {
  const wait = said ? holdFor(said) - (performance.now() - saidAt) : 0;
  if (wait > 0) await sleep(wait);
}

async function say(text) {
  await settle();
  said = text ?? '';
  saidAt = performance.now();
  if (line) {
    const old = line;
    old.classList.replace('is-on', 'is-off');
    setTimeout(() => old.remove(), 400);
  }
  line = null;
  if (!text) return;
  line = element('div', 'line', caption);
  line.append(text);
  void line.offsetWidth;
  line.classList.add('is-on');
}

const keys = element('div', 'keys', caption);
/** Shows key caps being pressed, with the Mac's key beside them. */
async function press(names, mac) {
  keys.replaceChildren();
  names.forEach((name, i) => {
    if (i) element('span', 'plus', keys).textContent = '+';
    element('span', 'key', keys).textContent = name;
  });
  if (mac) element('span', 'note', keys).textContent = TEXT.mac(mac);
  keys.classList.add('is-on');
  await sleep(60);
  keys.classList.add('is-down');
}
function release(after = 900) {
  keys.classList.remove('is-down');
  setTimeout(() => keys.classList.remove('is-on'), after);
}

const chip = element('div', 'chip', caption);

// ---------------------------------------------------------------- title and end cards

const icon = '<img src="/design/icons/app.svg" alt="">';
const titleCard = element('div', 'card is-on', stage, `${icon}<h1>Kento</h1><p class="tagline">${TEXT.tagline}</p>`);
const endCard = element(
  'div',
  'card',
  stage,
  `${icon}<h1>Kento</h1><div class="facts">${TEXT.end.map((fact) => `<span>${fact}</span>`).join('')}</div><div class="url">github.com/MehmetBurakTaskaya/kento</div>`,
);

// ---------------------------------------------------------------- the main window

const show = (node, on = true) => node.classList.toggle('is-shown', on);
const inMain = (selector) => main.contentDocument.querySelector(selector);

/** Points at something in the main window and clicks it. */
async function clickMain(selector, ms = 600) {
  const target = typeof selector === 'string' ? inMain(selector) : selector;
  if (!target) throw new Error(`stage: nothing at ${selector}`);
  const box = target.getBoundingClientRect();
  const frame = main.getBoundingClientRect();
  await pointer.to([frame.left + box.left + box.width / 2, frame.top + box.top + box.height / 2], ms, 0.06);
  await pointer.click();
  target.click();
}

/** Home, Library, Automation and Settings; the theme badge above Settings is not counted. */
const railItem = (index) => main.contentDocument.querySelectorAll('.rail-item:not(.rail-theme)')[index];
const store = async () => (await kento(main).store()).useApp;

function darken(on) {
  stage.classList.toggle('is-dark', on);
  darkDesk.classList.toggle('is-on', on);
  mainWindow.classList.toggle('is-dark', on);
}

// ---------------------------------------------------------------- readiness

const fontsOf = async (frame) => {
  await until(() => frame.contentDocument?.fonts, 'a frame', 180_000);
  await frame.contentDocument.fonts.ready;
};

const ready = (async () => {
  await document.fonts.ready;
  // Every window loads the whole app from the dev server, which takes a while on a busy computer.
  const loading = 180_000;
  await until(() => kento(main)?.listens('openTool') && inMain('.shell'), 'the main window', loading);
  await until(() => kento(toast)?.listens('toast'), 'the corner card', loading);
  await until(() => kento(shelf)?.listens('shelf'), 'the shelf', loading);
  for (const each of [wheel, ...montage.map((entry) => entry.wheel)]) await until(each.ready(), 'a wheel', loading);
  await Promise.all([main, toast, shelf, wheel.frame, ...montage.map((entry) => entry.wheel.frame)].map(fontsOf));
  // The web dialog's first-use notice was seen on an earlier day.
  const app = await store();
  const { settings } = app.getState();
  app.setState({ settings: { ...settings, web: { ...settings.web, noticeShown: true } } });
  await prepareLanguages();
  return true;
})();

// ---------------------------------------------------------------- the storyboard

/** Points at slices of the wheel in turn: [slice, milliseconds to get there, pause there]. A slice
 *  with a ring of choices opens it after a rest of 520 ms, so those are only passed over. */
async function sweep(on, steps) {
  for (const [index, ms, pause] of steps) {
    await pointer.to(await on.slice(index), ms, 0.05);
    await sleep(pause);
  }
}

/** Picks files up from their tiles, drags them to `at` and opens a wheel there with a key. */
async function dragOut(paths, kind, key, mac, at = [700, 262]) {
  await pointer.to(centerOf(tileOf.get(paths[paths.length - 1])), 560);
  await pointer.click();
  grab(paths);
  await pointer.to(at, 760, 0.14);
  await press([key], mac);
  await wheel.open(kind, paths);
  release();
  await wheel.opened();
}

/** The drop's apply has played; the wheel is closing. */
const applied = () => sleep(1000);

async function convertPhoto() {
  select([PHOTO]);
  await say(TEXT.caption.drag);
  await dragOut([PHOTO], 'convert', 'Shift');
  await say(TEXT.caption.wheel);
  await sleep(200);
  // PNG, then a rest on JPG, whose ring holds High quality, Balanced (under the pointer) and
  // Small file.
  await sweep(wheel, [
    [1, 420, 260],
    [0, 300, 0],
  ]);
  await say(TEXT.caption.rest);
  await sleep(950);
  await pointer.to(await wheel.slice(0), 420, 0.08);
  await sleep(350);
  wheel.drop();
  letGo();
  await applied();
  select([]);
  reveal(JPG);
  kento(toast).toast(`${TEXT.files[0]} → JPG`, [JPG]);
  show(toast);
  await say(TEXT.caption.copy);
  await pointer.to([600, 420], 700);
  await sleep(800);
}

async function tools() {
  show(toast, false);
  await say(TEXT.caption.ctrl);
  await dragOut([PHOTO], 'tools', 'Ctrl', '⌘');
  await sleep(200);
  // Favorites, Compress, Metadata, Edit image, Mark up, Add frame, Crop image, More…: past the
  // tools without choices to Crop image.
  await sweep(wheel, [
    [3, 380, 220],
    [4, 260, 160],
    [6, 380, 380],
  ]);
  wheel.drop();
  letGo();
  await applied();
  // The core hands the tool to the main window, which comes to the front with it.
  kento(main).openTool('crop-image', [PHOTO]);
  await sleep(120);
  show(mainWindow);
  await say(TEXT.caption.tools);
  await until(() => inMain('.image-stage img'), 'the crop editor');
  await sleep(250);
  const portrait = [...main.contentDocument.querySelectorAll('.editor-side button')].find(
    (button) => button.textContent.trim() === '4:5',
  );
  if (portrait) await clickMain(portrait, 650);
  await sleep(900);
  // The window fades first; the editor closes once it is gone, so Home never shows behind it.
  const app = await store();
  show(mainWindow, false);
  setTimeout(() => app.getState().closePanel(), 300);
}

/** A video made vertical from the Tools wheel's ring, then the pauses of an interview and a song
 *  under the clip in the main window's editors. */
async function video() {
  await say(TEXT.caption.video);
  await dragOut([VIDEO], 'tools', 'Ctrl', '⌘');
  await sleep(200);
  // Past Trim video to Make vertical, whose rest opens Crop the middle, Blurred background and
  // Other…; the drop on Blurred background makes the video at once.
  const vertical = await wheel.indexOf(TEXT.vertical);
  await sweep(wheel, [
    [vertical - 2, 380, 160],
    [vertical, 300, 0],
  ]);
  await sleep(950);
  await pointer.to(await wheel.slice(1), 420, 0.08);
  await sleep(450);
  wheel.drop();
  letGo();
  await applied();
  reveal(VERTICAL);
  kento(toast).toast(`${TEXT.vertical} · ${TEXT.files[6]}`, [VERTICAL]);
  show(toast);
  // Out of the way of the editors that follow.
  await pointer.to([942, 530], 700);
  await sleep(700);
  show(toast, false);
  // The editors in the main window, one after another, each with what it is for.
  const app = await store();
  for (const [i, [tool, files, caption, prepare]] of EDITORS.entries()) {
    await settle();
    // The window dips while the next editor loads its preview, so no loading frame shows.
    if (i > 0) {
      show(mainWindow, false);
      await sleep(320);
      app.getState().closePanel();
    }
    kento(main).openTool(tool, files());
    await until(() => inMain('.editor-side'), tool);
    if (files()[0] === VIDEO) await until(() => inMain('.editor-video')?.readyState >= 2, tool);
    await prepare?.();
    await sleep(tool === 'remove-pauses' ? 700 : 200);
    show(mainWindow);
    await say(TEXT.caption[caption]);
    await sleep(900);
  }
  await settle();
  show(mainWindow, false);
  setTimeout(() => app.getState().closePanel(), 300);
}

/** The editors the video scene shows: the tool, its files, its caption and what is set first. */
const EDITORS = [
  ['remove-pauses', () => [AUDIO], 'pauses', null],
  ['add-music', () => [VIDEO, SONG], 'music', null],
  [
    'add-overlay',
    () => [VIDEO],
    'overlay',
    async () => {
      inMain('.overlay-add button').click();
      await until(() => inMain('.overlay-words'), 'the text layer');
      typeInto(inMain('.overlay-words'), TEXT.title);
    },
  ],
  [
    'redact-video',
    () => [VIDEO],
    'redact',
    async () => {
      main.contentDocument.querySelectorAll('.editor-side .segmented')[0].querySelectorAll('button')[2].click();
      // A pointer of our own has no capture to set.
      main.contentWindow.Element.prototype.setPointerCapture = () => {};
      await sleep(100);
      await drawOn(inMain('.overlay'), [0.665, 0.875, 0.95, 0.955]);
    },
  ],
  ['normalize', () => [AUDIO], 'loudness', null],
];

async function actions() {
  await say(TEXT.caption.alt);
  await dragOut([JPG], 'actions', 'Alt', '⌃');
  await sleep(150);
  // Share, then Put on shelf.
  await sweep(wheel, [
    [0, 340, 200],
    [1, 280, 380],
  ]);
  wheel.drop();
  letGo();
  await sleep(900);
  kento(shelf).shelf([JPG]);
  show(shelf);
  await say(TEXT.caption.shelf);
  await pointer.to([560, 440], 600);
  await sleep(1000);
  show(shelf, false);
}

async function mixed() {
  await say(TEXT.caption.mixed);
  for (const path of [PHOTO, PDF, VIDEO]) {
    await pointer.to(centerOf(tileOf.get(path)), 360, 0.04);
    await pointer.click();
    tileOf.get(path).classList.add('is-selected');
  }
  grab([PHOTO, PDF, VIDEO]);
  await pointer.to([700, 262], 760, 0.14);
  await press(['Shift']);
  await wheel.open('convert', [PHOTO, PDF, VIDEO]);
  release();
  // Image, PDF, Video: a rest on Video opens its formats, with MP4 under the pointer.
  await sweep(wheel, [[2, 420, 1000]]);
  await sweep(wheel, [[0, 200, 250]]);
  wheel.drop();
  letGo();
  await applied();
  select([]);
  reveal(MP4);
  kento(toast).toast(`${TEXT.files[6]} → MP4`, [MP4]);
  show(toast);
  await sleep(900);
}

async function formats() {
  show(toast, false);
  await say(TEXT.caption.formats);
  // A document to PDF, and slides to a PNG per slide, whose rest opens the page resolutions.
  for (const [path, index, pause] of [
    [DOC, 0, 700],
    [SLIDES, 2, 1150],
  ]) {
    grab([path]);
    pointer.jump([700, 262]);
    await wheel.open('convert', [path]);
    await sleep(250);
    await sweep(wheel, [[index, 400, pause]]);
    wheel.close();
    letGo();
    await sleep(140);
  }
}

async function web() {
  const app = await store();
  await pointer.to([520, 300], 400);
  show(mainWindow);
  await say(TEXT.caption.paste);
  await sleep(350);
  await press(['Ctrl', 'V'], '⌘');
  app.getState().openWeb(kento(main).link);
  release(600);
  await until(() => inMain('[role=dialog] .button.primary'), 'the download dialog');
  await sleep(1000);
  await clickMain([...main.contentDocument.querySelectorAll('[role=dialog] .button.primary')].pop(), 650);
  await sleep(350);
}

async function automation() {
  await clickMain(railItem(2), 600);
  await say(TEXT.caption.rules);
  await sleep(1500);
  const content = inMain('.content');
  // Rules, recipes, then the activity log.
  const recipes = main.contentDocument.querySelectorAll('.automation .card')[1];
  const target = recipes.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop - 12;
  await say(TEXT.caption.recipes);
  const from = content.scrollTop;
  await tween(550, (t) => content.scrollTo(0, from + (target - from) * t));
  await sleep(1300);
}

/** Opens a page from the rail, at its top (the pages share one scrolling area). */
async function openPage(index) {
  await clickMain(railItem(index), 600);
  inMain('.content').scrollTo(0, 0);
}

async function library() {
  await openPage(1);
  await say(TEXT.caption.library);
  await sleep(1500);
}

async function dark() {
  // The caption changes as the page does: on the click, not before it and not after.
  await openPage(3);
  await say(TEXT.caption.dark);
  await sleep(350);
  const buttons = [...main.contentDocument.querySelectorAll('.segmented button')];
  await clickMain(buttons[2], 600);
  darken(true);
  await sleep(1100);
}

/** Every wheel of the montage opens out of sight with a tool under the pointer (Edit image, Mark
 *  up, Add frame or Crop image: no ring of choices), so the montage only cuts between them. */
async function prepareLanguages() {
  for (const [n, entry] of montage.entries()) {
    await entry.wheel.open('tools', [PHOTO], [480, 262], false);
    entry.point = await entry.wheel.slice(3 + (n % 4));
    entry.wheel.over(...entry.point);
  }
}

/** The twelve languages, each in its own script, for the burst. */
const TONGUES = [
  'English',
  'Türkçe',
  'Deutsch',
  'Español',
  'Français',
  'Italiano',
  'Português',
  'Русский',
  '简体中文',
  '日本語',
  '한국어',
  'العربية',
];

async function languages() {
  await settle();
  for (const node of [mainWindow, folder]) {
    node.style.transition = 'none';
    node.style.opacity = '0';
  }
  // A burst: the number counts up to twelve while the languages fly out round it, with no pointer
  // over it.
  pointerNode.style.visibility = 'hidden';
  const burst = element('div', 'burst', stage);
  const count = element('div', 'burst-count', burst);
  count.textContent = '1';
  element('div', 'burst-word', burst).textContent = TEXT.languages;
  TONGUES.forEach((name, i) => {
    const angle = (i / TONGUES.length) * Math.PI * 2 - Math.PI / 2;
    const tongue = element('span', 'burst-tongue', burst);
    tongue.textContent = name;
    tongue.style.setProperty('--x', `${Math.round(Math.cos(angle) * 330)}px`);
    tongue.style.setProperty('--y', `${Math.round(Math.sin(angle) * 175)}px`);
    tongue.style.animationDelay = `${300 + i * 70}ms`;
  });
  void burst.offsetWidth;
  burst.classList.add('is-on');
  await say(TEXT.caption.languages);
  await tween(900, (t) => (count.textContent = String(Math.max(1, Math.round(t * 12)))));
  await sleep(1700);
  // Then the wheel itself in eight of them, right to left last.
  burst.classList.add('is-leaving');
  setTimeout(() => burst.remove(), 400);
  pointerNode.style.visibility = '';
  for (const [n, { name, wheel: each, point }] of montage.entries()) {
    each.frame.classList.add('is-shown');
    pointer.jump(point);
    chip.textContent = name;
    chip.classList.add('is-on');
    await sleep(n === 0 ? 700 : 520);
    if (n < montage.length - 1) each.frame.classList.remove('is-shown');
  }
  await sleep(300);
  chip.classList.remove('is-on');
}

/** The scenes in order, each with what it shows; play() returns when each began, in seconds. */
const SCENES = [
  [
    'title',
    async () => {
      await sleep(2000);
      titleCard.classList.remove('is-on');
      await sleep(250);
    },
  ],
  ['convert', convertPhoto],
  ['tools', tools],
  ['video and audio', video],
  ['file actions', actions],
  ['mixed selection', mixed],
  ['documents', formats],
  ['web link', web],
  ['automation', automation],
  ['library', library],
  ['light and dark', dark],
  ['languages', languages],
  [
    'end',
    async () => {
      await say(null);
      endCard.classList.add('is-on');
      await sleep(3000);
    },
  ],
];

async function play() {
  await ready;
  const start = performance.now();
  const marks = [];
  for (const [name, scene] of SCENES) {
    marks.push([name, (performance.now() - start) / 1000]);
    await scene();
  }
  marks.push(['', (performance.now() - start) / 1000]);
  return marks;
}

// ---------------------------------------------------------------- screenshots for the README

/** A window with a margin of the desk round it. */
const regionOf = (node, margin, bottom) => {
  const box = node.getBoundingClientRect();
  const x = Math.max(0, box.left - margin);
  const y = Math.max(0, box.top - margin);
  return { x, y, width: Math.min(960, box.right + margin) - x, height: Math.min(bottom, box.bottom + margin) - y };
};
/** The scene above the caption band. */
const SCENE = { x: 0, y: 0, width: 960, height: 528 };

/** Draws a rectangle on an editor's picture, from and to fractions of it. The overlay takes the
 *  pointer's events; between them React draws the draft. */
async function drawOn(overlay, [x0, y0, x1, y1]) {
  const view = main.contentWindow;
  const box = overlay.getBoundingClientRect();
  const at = ([x, y]) => ({ clientX: box.left + x * box.width, clientY: box.top + y * box.height });
  for (const [type, point] of [
    ['pointerdown', [x0, y0]],
    ['pointermove', [(x0 + x1) / 2, (y0 + y1) / 2]],
    ['pointermove', [x1, y1]],
    ['pointerup', [x1, y1]],
  ]) {
    overlay.dispatchEvent(new view.PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...at(point) }));
    await sleep(60);
  }
}

/** Types into a field the way a person would, so React hears it. */
function typeInto(field, text) {
  const view = main.contentWindow;
  const proto = field instanceof view.HTMLTextAreaElement ? view.HTMLTextAreaElement : view.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(field, text);
  field.dispatchEvent(new view.Event('input', { bubbles: true }));
}

/** The files each editor of the README opens. */
const EDITOR_FILES = {
  normalize: () => [AUDIO],
  'remove-pauses': () => [AUDIO],
  'add-music': () => [VIDEO, SONG],
};

/** A media editor as the README shows it: Crop video at 9:16, Make vertical over a blurred copy,
 *  a title in Add text or logo, the date stamp pixelated in Redact video, the interview's pauses,
 *  a song under the clip, or the interview's loudness. */
async function editor(name) {
  // The editors want a taller window than the tour's; the recording gives them a taller page.
  stage.style.blockSize = `${innerHeight}px`;
  mainWindow.style.blockSize = `${innerHeight - 32}px`;
  main.style.blockSize = `${innerHeight - 64}px`;
  const files = EDITOR_FILES[name]?.() ?? [VIDEO];
  kento(main).openTool(name, files);
  await until(() => inMain('.editor-side'), 'the editor');
  if (files[0] === VIDEO) await until(() => inMain('.editor-video')?.readyState >= 2, 'the sample video');
  const side = [...main.contentDocument.querySelectorAll('.editor-side .segmented')];
  const buttons = (index) => [...(side[index]?.querySelectorAll('button') ?? [])];
  switch (name) {
    case 'crop-video':
      buttons(0)
        .find((button) => button.textContent === '9:16')
        .click();
      break;
    case 'make-vertical':
      buttons(0)[1].click();
      await until(() => inMain('.editor-side img'), 'the portrait preview');
      break;
    case 'add-overlay': {
      inMain('.overlay-add button').click();
      await until(() => inMain('.overlay-words'), 'the text layer');
      typeInto(inMain('.overlay-words'), TEXT.title);
      break;
    }
    case 'redact-video':
      // Pixelate: in a still, Erase's preview still shows what it will take away.
      buttons(0)[2].click();
      // A pointer of our own has no capture to set.
      main.contentWindow.Element.prototype.setPointerCapture = () => {};
      await sleep(100);
      await drawOn(inMain('.overlay'), [0.665, 0.875, 0.95, 0.955]);
      break;
    case 'add-music':
      // The music steps back while someone speaks.
      await sleep(600);
      [...main.contentDocument.querySelectorAll('.editor-side input[type=checkbox]')].pop()?.click();
      await sleep(600);
      break;
    default:
      // Remove pauses waits for its search.
      await sleep(1200);
  }
}

/** Sets up one screenshot and says which part of the page to take. */
async function still(name) {
  await ready;
  titleCard.style.transition = 'none';
  titleCard.classList.remove('is-on');
  for (const node of [mainWindow, ...stage.querySelectorAll('.surface')]) node.style.transition = 'none';
  const app = await store();
  darken(DARK);
  if (name.startsWith('wheel') || name.startsWith('tools')) {
    select([PHOTO]);
    tileOf.get(PHOTO).classList.add('is-dragged');
    pointer.jump([700, 262]);
    if (name.startsWith('wheel')) {
      // The Convert wheel of a photo, PNG under the pointer.
      await wheel.open('convert', [PHOTO]);
      await sleep(300);
      await sweep(wheel, [[1, 300, 500]]);
    } else {
      // The Tools wheel of a photo: a rest on Compress opens its presets; Under 25 MB.
      await wheel.open('tools', [PHOTO]);
      await sleep(300);
      await sweep(wheel, [[1, 300, 1200]]);
      await sweep(wheel, [[3, 300, 500]]);
    }
    return SCENE;
  }
  // A taller window, without the pointer.
  pointerNode.style.display = 'none';
  Object.assign(mainWindow.style, { insetBlockStart: '16px', blockSize: '568px' });
  main.style.blockSize = '536px';
  show(mainWindow);
  if (name.startsWith('home')) {
    await app.getState().addFiles([PHOTO, DOC, VIDEO, PDF]);
  } else if (name.startsWith('library')) {
    app.getState().setSection('library');
  } else if (name.startsWith('automation')) {
    app.getState().setSection('automation');
  } else if (name.startsWith('compress')) {
    await app.getState().addFiles([PHOTO, VIDEO]);
    app.getState().openPanel('compress', [PHOTO, VIDEO]);
    await until(() => inMain('.compress-mode button'), 'Compress');
  } else {
    await editor(name);
  }
  await sleep(900);
  main.contentDocument.activeElement?.blur();
  await sleep(100);
  return regionOf(mainWindow, 16, innerHeight);
}

window.demo = { ready, play, still };
