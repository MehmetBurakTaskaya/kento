// SPDX-License-Identifier: MIT
// The playground of the website kit (SPEC 8): Kento's Convert wheel on a page, converting a picture in
// the browser. A picture dragged onto the section with Shift held opens the wheel under the pointer,
// and dropping it on a slice converts it; a chosen picture opens the wheel for the pointer or the
// keyboard; on a touch screen, pressing and holding the picture opens it under the finger. The wheel
// is drawn by assets/dial.js and behaves as src/wheel does: the keys, the rings of choices that open
// when the pointer rests on a slice, paging past eight slices, reduced motion. Pictures are read with
// createImageBitmap (an <img> for SVG) and written by a canvas or by encoders.js, then saved as a
// download named as Kento names its files (photo.png → photo.jpg). Nothing goes over the network.
// playground.html loads this module when the visitor starts and calls mount() once per section.
import { dialSvg, setState, sliceAt, R, LIGHT, DARK } from '../assets/dial.js';
import * as write from './encoders.js';

const ICONS = {
  high: 'M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.66l5.9-.86z',
  balanced:
    'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M17 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM11 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM19 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  small: 'M12 3v10M7.5 8.5L12 13l4.5-4.5M5 17h14M8 21h8',
  first: 'M3.5 12a8.5 8.5 0 1 0 2.5-6l-2.5 2.5M3.5 3.5v5h5',
};

/** What the script writes itself; everything else is in playground.html, in both languages. */
const TEXT = {
  en: {
    convert: 'Convert',
    dragged: 'your picture',
    more: 'More…',
    moreHint: (n) => (n === 1 ? '1 more choice' : `${n} more choices`),
    first: 'Back to start',
    firstHint: 'Back to the first choices',
    back: 'Back',
    trail: (name) => `${name} ›`,
    withChoices: (hint) => `${hint} · Rest here for more choices`,
    quality: { high: 'High quality', balanced: 'Balanced', small: 'Small file' },
    qualityHint: {
      high: 'The best picture, a larger file',
      balanced: 'A good picture at a sensible size',
      small: 'The smallest file, a little detail lost',
    },
    hint: {
      jpg: 'Photos everywhere; small, no transparency',
      png: 'Lossless, keeps transparency',
      webp: 'Small files for the web',
      avif: 'Smallest photos; newer apps',
      bmp: 'Uncompressed, for old programs',
      tiff: 'Lossless, for print and archives',
      gif: '256 colours, opens everywhere',
      pdf: 'One page per image or document',
      ico: 'A Windows icon in several sizes',
    },
    instructions:
      'Up and Down choose, Enter applies. Right opens a slice’s choices, Left goes back. Esc goes back or closes.',
    opened: (name, n) => `${name}: ${n} choices`,
    backTo: (name) => `Back to ${name}`,
    page: (n) => `Page ${n}`,
    sample: 'sample.png',
    pixels: (w, h) => `${w} × ${h} px`,
    icons: (sizes) => `icon sizes ${sizes} px`,
    offers: (list) => `In this browser the wheel offers ${list}.`,
    missing: (list, n) =>
      `${list} ${n === 1 ? 'is' : 'are'} left out because this browser cannot write ${n === 1 ? 'it' : 'them'}; Kento writes ${n === 1 ? 'it' : 'them'} on any computer.`,
    reading: (name) => `Reading ${name}…`,
    converting: (name, to) => `Converting ${name} to ${to}…`,
    saved: (name, size) => `Ready: ${name}, ${size}. Your browser saves it like any download.`,
    notImage: (name) =>
      `${name} is not a picture the playground reads. Try a PNG, JPG, WEBP, GIF, BMP, AVIF or SVG file.`,
    noHeic: (name) =>
      `This browser cannot read HEIC pictures such as ${name}, so the playground cannot convert it here. Safari can, and Kento itself reads HEIC on Windows and macOS.`,
    noTiff: (name) =>
      `This browser cannot read TIFF pictures such as ${name}. Safari can, and Kento itself reads TIFF on Windows and macOS.`,
    unreadable: (name) => `${name} could not be read in this browser.`,
    tooLarge: (w, h) =>
      `This picture (${w} × ${h} pixels) is too large to convert in a browser; Kento converts it on your computer.`,
    failed: (to) => `The browser could not write ${to} from this picture.`,
    oneAtATime: 'The playground converts one picture at a time; Kento converts many in one go.',
    shiftTip: 'Next time hold Shift while you drag: the wheel opens before you let go, as in Kento.',
    otherKeys:
      'In Kento, Ctrl opens the Tools wheel and Alt the file actions (⌘ and ⌃ on a Mac). The playground has the Convert wheel.',
    notPicture:
      'The playground converts pictures. Kento itself converts video, audio, documents, PDF and archives too.',
    busy: 'One moment: the last picture is still being converted.',
    chooseFirst: 'Choose a picture first.',
  },
  tr: {
    convert: 'Dönüştür',
    dragged: 'görseliniz',
    more: 'Daha fazla…',
    moreHint: (n) => `${n} seçenek daha`,
    first: 'Başa dön',
    firstHint: 'İlk seçeneklere dön',
    back: 'Geri',
    trail: (name) => `${name} ›`,
    withChoices: (hint) => `${hint} · Daha fazla seçenek için burada bekle`,
    quality: { high: 'Yüksek kalite', balanced: 'Dengeli', small: 'Küçük dosya' },
    qualityHint: {
      high: 'En iyi görüntü, daha büyük dosya',
      balanced: 'Makul boyutta iyi görüntü',
      small: 'En küçük dosya, biraz ayrıntı kaybolur',
    },
    hint: {
      jpg: 'Her yerde açılan fotoğraf; küçük, saydamlık yok',
      png: 'Kayıpsız, saydamlığı korur',
      webp: 'Web için küçük dosyalar',
      avif: 'En küçük fotoğraflar; yeni uygulamalar',
      bmp: 'Sıkıştırmasız, eski programlar için',
      tiff: 'Kayıpsız, baskı ve arşiv için',
      gif: '256 renk, her yerde açılır',
      pdf: 'Görüntü ya da belge başına bir sayfa',
      ico: 'Birkaç boyutta Windows simgesi',
    },
    instructions:
      'Yukarı ve Aşağı ile seç, Enter ile uygula. Sağ, dilimin seçeneklerini açar; Sol geri döner. Esc geri döner ya da kapatır.',
    opened: (name, n) => `${name}: ${n} seçenek`,
    backTo: (name) => `Geri: ${name}`,
    page: (n) => `Sayfa ${n}`,
    sample: 'örnek.png',
    pixels: (w, h) => `${w} × ${h} piksel`,
    icons: (sizes) => `simge boyutları ${sizes} piksel`,
    offers: (list) => `Bu tarayıcıda çark şunları sunuyor: ${list}.`,
    missing: (list) => `${list} dışarıda kaldı, çünkü bu tarayıcı yazamıyor; Kento ise her bilgisayarda yazar.`,
    reading: (name) => `${name} okunuyor…`,
    converting: (name, to) => `${name}, ${to} biçimine dönüştürülüyor…`,
    saved: (name, size) => `Hazır: ${name}, ${size}. Tarayıcınız onu her indirme gibi kaydeder.`,
    notImage: (name) =>
      `${name}, deneme alanının okuyabildiği bir görsel değil. PNG, JPG, WEBP, GIF, BMP, AVIF ya da SVG dosyası deneyin.`,
    noHeic: (name) =>
      `Bu tarayıcı ${name} gibi HEIC görselleri okuyamıyor; bu yüzden deneme alanı onu burada dönüştüremez. Safari okuyabilir; Kento ise HEIC’i Windows’ta ve macOS’te okur.`,
    noTiff: (name) =>
      `Bu tarayıcı ${name} gibi TIFF görselleri okuyamıyor. Safari okuyabilir; Kento ise TIFF’i Windows’ta ve macOS’te okur.`,
    unreadable: (name) => `${name} bu tarayıcıda okunamadı.`,
    tooLarge: (w, h) =>
      `Bu görsel (${w} × ${h} piksel) tarayıcıda dönüştürmek için fazla büyük; Kento onu bilgisayarınızda dönüştürür.`,
    failed: (to) => `Tarayıcı bu görselden ${to} yazamadı.`,
    oneAtATime: 'Deneme alanı bir seferde bir görsel dönüştürür; Kento birçoğunu tek seferde dönüştürür.',
    shiftTip: 'Bir dahaki sefere sürüklerken Shift’e basılı tutun: çark, Kento’daki gibi siz bırakmadan açılır.',
    otherKeys:
      'Kento’da Ctrl Araçlar çarkını, Alt da dosya işlemlerini açar (Mac’te ⌘ ve ⌃). Deneme alanında Dönüştür çarkı var.',
    notPicture: 'Deneme alanı görselleri dönüştürür. Kento ise video, ses, belge, PDF ve arşivleri de dönüştürür.',
    busy: 'Bir saniye: son görsel hâlâ dönüştürülüyor.',
    chooseFirst: 'Önce bir görsel seçin.',
  },
};

const FORMATS = {
  jpg: { label: 'JPG', ext: 'jpg', mime: 'image/jpeg' },
  png: { label: 'PNG', ext: 'png', mime: 'image/png' },
  webp: { label: 'WEBP', ext: 'webp', mime: 'image/webp' },
  avif: { label: 'AVIF', ext: 'avif', mime: 'image/avif' },
  bmp: { label: 'BMP', ext: 'bmp', mime: 'image/bmp' },
  tiff: { label: 'TIFF', ext: 'tif', mime: 'image/tiff' },
  gif: { label: 'GIF', ext: 'gif', mime: 'image/gif' },
  pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  ico: { label: 'ICO', ext: 'ico', mime: 'image/vnd.microsoft.icon' },
};
/** Kento's order of picture targets (catalog.json); HEIC is left out, as no browser writes it. */
const TARGETS = ['jpg', 'png', 'webp', 'avif', 'bmp', 'tiff', 'gif', 'pdf', 'ico'];
/** Kento's picture inputs, with their names. */
const INPUTS = {
  avif: 'AVIF',
  bmp: 'BMP',
  gif: 'GIF',
  heic: 'HEIC',
  jpg: 'JPG',
  png: 'PNG',
  svg: 'SVG',
  tiff: 'TIFF',
  webp: 'WEBP',
};
const FROM_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
};
/** The picture quality of each choice, as Kento sets it (src-tauri/src/work.rs, Preset). */
const QUALITY = {
  high: { jpg: 0.95, webp: 0.92, avif: 0.88 },
  balanced: { jpg: 0.9, webp: 0.85, avif: 0.75 },
  small: { jpg: 0.75, webp: 0.7, avif: 0.55 },
};
/** design/DESIGN.md, section 6, and src/wheel/motion.ts, in milliseconds. */
const MOTION = { dwell: 520, open: 180, stagger: 7, apply: 640, hold: 450, close: 120, level: 220, press: 500 };
const REDUCED = { open: 90, close: 80, level: 110 };
/** Pictures larger than this are beyond what browsers reliably paint on a canvas. */
const MAX_PIXELS = 50e6;
const MAX_SIDE = 16384;
const PAGE = 7;

const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const still = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const isDark = () => {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'dark' || (theme !== 'light' && !!dark && dark.matches);
};
const reducedMotion = () => !!still && still.matches;
// File names are bidi-isolated wherever the script writes them into text (design/DESIGN.md, section 10).
const isolate = (text) => `\u2068${text}\u2069`;
const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
let ids = 0;

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function langOf(root) {
  const chosen = root.getAttribute('data-lang');
  const page = root.parentElement && root.parentElement.closest('[lang]');
  const value = (chosen || (page && page.getAttribute('lang')) || document.documentElement.lang || 'en').toLowerCase();
  return value.startsWith('tr') ? 'tr' : 'en';
}

/** A size as Kento writes it: 1000-based units, one decimal below 100 (src/i18n/format.ts). */
function bytes(n, lang) {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
  let value = Math.max(0, n);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(intl(lang), {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 || value >= 100 ? 0 : 1,
  }).format(value);
}

/** British English, as the kit is written, and Turkish. */
const intl = (lang) => (lang === 'tr' ? 'tr-TR' : 'en-GB');
const list = (items, lang) => new Intl.ListFormat(intl(lang), { type: 'conjunction' }).format(items);
const count = (n, lang) => new Intl.NumberFormat(intl(lang), { useGrouping: false }).format(n);

/** Kento's naming rule for a conversion: photo.png → photo.jpg. */
export function outputName(name, ext) {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

/** An error the visitor reads: a key of TEXT and its arguments. */
class Problem extends Error {
  constructor(key, args = []) {
    super(key);
    this.key = key;
    this.args = args;
  }
}

function canvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function toBlob(c, type, quality) {
  return new Promise((resolve) => c.toBlob(resolve, type, quality));
}

/** The formats a canvas really writes here: it falls back to PNG for a type it cannot write. */
async function detect() {
  const probe = canvas(2, 2);
  const writes = async (type) => {
    try {
      const blob = await toBlob(probe, type, 0.8);
      return !!blob && blob.type === type;
    } catch {
      return false;
    }
  };
  const [jpg, webp, avif] = await Promise.all([writes('image/jpeg'), writes('image/webp'), writes('image/avif')]);
  let pdf;
  try {
    pdf = typeof CompressionStream === 'function' && !!new CompressionStream('deflate');
  } catch {
    pdf = false;
  }
  return { jpg, png: true, webp, avif, bmp: true, tiff: true, gif: true, pdf, ico: true };
}

/**
 * The pixel size of an SVG as Kento draws it: its width and height in pixels, else its viewBox, else
 * what the browser found; browsers disagree about SVG files without a size of their own.
 */
async function svgSize(file, found) {
  const text = await file.slice(0, 8192).text();
  const tag = (/<svg\b[^>]*>/i.exec(text) || [''])[0];
  const attr = (name) => (new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px)?\\s*["']`, 'i').exec(tag) || [])[1];
  const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  const [w, h] = [Number(attr('width')), Number(attr('height'))];
  if (w > 0 && h > 0) return [Math.round(w), Math.round(h)];
  const [bw, bh] = box ? [Number(box[1]), Number(box[2])] : [0, 0];
  if (bw > 0 && bh > 0) return w > 0 ? [Math.round(w), Math.round((w * bh) / bw)] : [Math.round(bw), Math.round(bh)];
  return found[0] && found[1] ? found : [1024, 1024];
}

function viaImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable'));
    };
    image.src = url;
  });
}

/** Reads a picture: its format from its bytes, then its pixels through the browser's own decoders. */
async function read(file, lang) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const format = write.sniff(head);
  const name = isolate(file.name);
  if (!format || !INPUTS[format]) throw new Problem('notImage', [name]);
  let picture = null;
  if (format !== 'svg') {
    try {
      picture = await createImageBitmap(file);
    } catch {
      picture = null;
    }
  }
  // Some browsers read SVG, HEIC or TIFF only through an image element.
  if (!picture) picture = await viaImage(file).catch(() => null);
  if (!picture) throw new Problem(format === 'heic' ? 'noHeic' : format === 'tiff' ? 'noTiff' : 'unreadable', [name]);
  let width = picture.naturalWidth || picture.width;
  let height = picture.naturalHeight || picture.height;
  if (format === 'svg') [width, height] = await svgSize(file, [width, height]);
  if (!width || !height) throw new Problem('unreadable', [name]);
  if (width * height > MAX_PIXELS || Math.max(width, height) > MAX_SIDE) {
    throw new Problem('tooLarge', [count(width, lang), count(height, lang)]);
  }
  return { file, name: file.name, size: file.size, format, picture, width, height, lossy: write.lossy(format, head) };
}

/** The picture on a canvas of its own size, over a background colour or on transparency. */
function paint(source, background) {
  const c = canvas(source.width, source.height);
  const g = c.getContext('2d', { willReadFrequently: !background });
  if (background) {
    g.fillStyle = background;
    g.fillRect(0, 0, c.width, c.height);
  }
  g.drawImage(source.picture, 0, 0, c.width, c.height);
  return c;
}

function pixels(source) {
  const c = paint(source);
  const data = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  c.width = c.height = 0;
  return data;
}

/**
 * The picture scaled to fit `w` × `h`, halving first so that a large picture does not alias on its
 * way down to a thumbnail or a 16-pixel icon.
 */
function shrink(image, iw, ih, w, h) {
  while (iw > w * 2 && ih > h * 2) {
    const half = canvas(Math.ceil(iw / 2), Math.ceil(ih / 2));
    const g = half.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(image, 0, 0, half.width, half.height);
    image = half;
    iw = half.width;
    ih = half.height;
  }
  return image;
}

/** The picture fitted into a transparent square, centred, as Kento makes each size of an icon. */
function square(source, size) {
  const scale = size / Math.max(source.width, source.height);
  const w = Math.min(size, Math.max(1, Math.round(source.width * scale)));
  const h = Math.min(size, Math.max(1, Math.round(source.height * scale)));
  const c = canvas(size, size);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(shrink(source.picture, source.width, source.height, w, h), (size - w) / 2, (size - h) / 2, w, h);
  return c;
}

async function encode(c, type, quality) {
  const blob = await toBlob(c, type, quality);
  c.width = c.height = 0;
  if (!blob || blob.type !== type)
    throw new Problem('failed', [FORMATS[TARGETS.find((id) => FORMATS[id].mime === type)].label]);
  return blob;
}

/** Converts a picture read by `read`; `preset` is a quality choice for JPG, WEBP and AVIF. */
async function convert(source, target, preset) {
  const q = QUALITY[preset || 'balanced'];
  const blob = (data) => new Blob([data], { type: FORMATS[target].mime });
  switch (target) {
    case 'jpg':
      return encode(paint(source, '#ffffff'), 'image/jpeg', q.jpg);
    case 'webp':
      return encode(paint(source), 'image/webp', q.webp);
    case 'avif':
      return encode(paint(source), 'image/avif', q.avif);
    case 'bmp':
      return blob(write.bmp(pixels(source)));
    case 'tiff':
      return blob(write.tiff(pixels(source)));
    case 'gif':
      return blob(write.gif(pixels(source)));
    case 'ico': {
      const entries = [];
      for (const size of write.iconSizes(source.width, source.height)) {
        const png = await encode(square(source, size), 'image/png');
        entries.push({ size, png: new Uint8Array(await png.arrayBuffer()) });
      }
      return blob(write.ico(entries));
    }
    case 'pdf': {
      const { data, width, height } = pixels(source);
      const mask = write.hasAlpha(data) ? await write.deflate(write.alphaOf(data)) : null;
      // A photo stays a JPEG inside the PDF, as Kento keeps it; a lossless picture stays lossless.
      const image = source.lossy
        ? new Uint8Array(await (await encode(paint(source, '#ffffff'), 'image/jpeg', 0.92)).arrayBuffer())
        : await write.deflate(write.rgbOf(data));
      return blob(write.pdf({ width, height, image, filter: source.lossy ? 'DCTDecode' : 'FlateDecode', mask }));
    }
    default:
      return encode(paint(source), 'image/png');
  }
}

/** A picture drawn into a square canvas, contained, for the cards. */
function thumbnail(c, image, iw, ih) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const side = Math.round((c.clientWidth || 72) * ratio);
  c.width = c.height = side;
  const scale = Math.min(side / iw, side / ih);
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(shrink(image, iw, ih, w, h), (side - w) / 2, (side - h) / 2, w, h);
}

/** A sample picture painted here, for a visitor without one at hand: a landscape with round corners. */
async function samplePicture(name) {
  const c = canvas(1200, 800);
  const g = c.getContext('2d');
  // Round corners show what each format does with transparency (JPG fills them with white).
  if (g.roundRect) {
    g.beginPath();
    g.roundRect(0, 0, 1200, 800, 72);
    g.clip();
  }
  const sky = g.createLinearGradient(0, 0, 0, 560);
  sky.addColorStop(0, '#3a62c2');
  sky.addColorStop(0.55, '#89a7f5');
  sky.addColorStop(1, '#e9edf3');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1200, 800);
  const sun = g.createRadialGradient(860, 250, 10, 860, 250, 190);
  sun.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  sun.addColorStop(0.35, 'rgba(255, 244, 214, 0.7)');
  sun.addColorStop(1, 'rgba(255, 244, 214, 0)');
  g.fillStyle = sun;
  g.fillRect(600, 0, 600, 520);
  const hill = (y, colour, points) => {
    g.beginPath();
    g.moveTo(0, 800);
    g.lineTo(0, y);
    for (const [cx, cy, x, yy] of points) g.quadraticCurveTo(cx, cy, x, yy);
    g.lineTo(1200, 800);
    g.closePath();
    g.fillStyle = colour;
    g.fill();
  };
  hill(470, '#7c8a9c', [
    [220, 360, 430, 450],
    [700, 560, 900, 420],
    [1060, 330, 1200, 400],
  ]);
  hill(560, '#4f6f62', [
    [300, 480, 560, 570],
    [860, 660, 1200, 520],
  ]);
  hill(660, '#2f4a3f', [
    [260, 600, 520, 690],
    [900, 790, 1200, 650],
  ]);
  const blob = await toBlob(c, 'image/png');
  c.width = c.height = 0;
  return new File([blob], name, { type: 'image/png' });
}

function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = el('a', '', { href: url, download: name, rel: 'noopener', hidden: '' });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The share of half a turn between two slices of a ring: 0 on the slice, 1 opposite it. */
function spread(index, from, n) {
  if (n <= 1) return 0;
  const k = (((index - from) % n) + n) % n;
  return (Math.min(k, n - k) * 2) / n;
}

/**
 * Mounts the playground in its section. Returns the calls playground.html's loader makes: take a
 * chosen or dropped file, or paint the sample.
 */
export function mount(root) {
  if (root.kentoPlayground) return root.kentoPlayground;
  const $ = (selector) => root.querySelector(selector);
  const ui = {
    stage: $('[data-stage]'),
    zone: $('[data-zone]'),
    file: $('[data-file]'),
    press: $('[data-press]'),
    thumb: $('[data-thumb]'),
    name: $('[data-name]'),
    meta: $('[data-meta]'),
    open: $('[data-act="open"]'),
    result: $('[data-result]'),
    from: $('[data-result-from]'),
    to: $('[data-result-to]'),
    resultMeta: $('[data-result-meta]'),
    resultThumb: $('[data-result-thumb]'),
    badge: $('[data-result-badge]'),
    status: $('[data-status]'),
    formats: $('[data-formats-now]'),
    input: $('[data-input]'),
  };
  const state = { lang: langOf(root), caps: null, source: null, result: null, busy: false, wheel: null, status: null };
  const tx = () => TEXT[state.lang];
  const ready = detect().then((caps) => {
    state.caps = caps;
    renderFormats();
    return caps;
  });

  function say(key, args = [], tone = '') {
    state.status = key ? { key, args, tone } : null;
    renderStatus();
  }

  function renderStatus() {
    const s = state.status;
    const text = s ? tx()[s.key] : '';
    ui.status.textContent = typeof text === 'function' ? text(...s.args) : text;
    ui.status.classList.toggle('is-error', !!s && s.tone === 'error');
  }

  function renderFormats() {
    if (!state.caps || !ui.formats) return;
    const offered = TARGETS.filter((id) => state.caps[id]).map((id) => FORMATS[id].label);
    const missing = TARGETS.filter((id) => !state.caps[id]).map((id) => FORMATS[id].label);
    const t = tx();
    ui.formats.textContent =
      t.offers(list(offered, state.lang)) +
      (missing.length ? ` ${t.missing(list(missing, state.lang), missing.length)}` : '');
  }

  function renderFile() {
    const s = state.source;
    ui.zone.hidden = !!s;
    ui.file.hidden = !s;
    if (!s) return;
    ui.name.textContent = s.name;
    ui.meta.textContent = [
      INPUTS[s.format],
      bytes(s.size, state.lang),
      tx().pixels(count(s.width, state.lang), count(s.height, state.lang)),
    ].join(' · ');
  }

  function renderResult() {
    const r = state.result;
    ui.result.hidden = !r;
    if (!r) return;
    const t = tx();
    ui.from.textContent = r.from;
    ui.to.textContent = r.name;
    const change = new Intl.NumberFormat(intl(state.lang), {
      style: 'percent',
      signDisplay: 'exceptZero',
      maximumFractionDigits: 0,
    });
    const detail = [
      `${INPUTS[r.format]} ${bytes(r.before, state.lang)} → ${FORMATS[r.target].label} ${bytes(r.blob.size, state.lang)} (${change.format(r.blob.size / r.before - 1)})`,
      t.pixels(count(r.width, state.lang), count(r.height, state.lang)),
    ];
    if (r.preset) detail.push(t.quality[r.preset]);
    if (r.target === 'ico')
      detail.push(
        t.icons(
          list(
            write.iconSizes(r.width, r.height).map((n) => count(n, state.lang)),
            state.lang,
          ),
        ),
      );
    ui.resultMeta.textContent = detail.join(' · ');
  }

  function render() {
    state.lang = langOf(root);
    renderStatus();
    renderFormats();
    renderFile();
    renderResult();
  }

  /** Puts a picture read by `read` in the stage; the one before gives back its decoded pixels. */
  function use(source) {
    const old = state.source;
    state.source = source;
    if (old && old.picture !== source.picture && typeof old.picture.close === 'function') old.picture.close();
    renderFile();
    thumbnail(ui.thumb, source.picture, source.width, source.height);
  }

  /** Loads a picture into the stage and opens the wheel on it. */
  async function take(file, how = {}) {
    if (!file) return;
    if (state.busy) return say('busy');
    if (state.wheel) {
      state.wheel.close();
      await state.wheel.closed;
    }
    await ready;
    say('reading', [isolate(file.name)]);
    let source;
    try {
      source = await read(file, state.lang);
    } catch (error) {
      return say(error.key || 'unreadable', error.args || [isolate(file.name)], 'error');
    }
    use(source);
    say(how.many ? 'oneAtATime' : how.via === 'drop' ? 'shiftTip' : null);
    openWheel(how.x === undefined ? null : { x: how.x, y: how.y }, false);
  }

  /** Runs the conversion the wheel chose, on the picture in the stage or on the one dropped there. */
  async function run(target, preset, file, closed) {
    state.busy = true;
    try {
      let source = state.source;
      if (file) {
        say('reading', [isolate(file.name)]);
        source = await read(file, state.lang);
        use(source);
      }
      if (!source) throw new Problem('chooseFirst');
      say('converting', [isolate(source.name), FORMATS[target].label]);
      await frame();
      const blob = await convert(source, target, preset);
      const name = outputName(source.name, FORMATS[target].ext);
      await closed;
      state.result = {
        blob,
        name,
        from: source.name,
        format: source.format,
        before: source.size,
        target,
        preset: ['jpg', 'webp', 'avif'].includes(target) ? preset || 'balanced' : null,
        width: source.width,
        height: source.height,
      };
      saveFile(blob, name);
      renderResult();
      showResult(blob, target);
      say('saved', [isolate(name), bytes(blob.size, state.lang)]);
    } catch (error) {
      await closed;
      say(error.key || 'failed', error.args || [FORMATS[target].label], 'error');
    } finally {
      state.busy = false;
    }
  }

  /** The result as the browser reads it back, which shows it is the real file; TIFF and PDF get a badge. */
  async function showResult(blob, target) {
    ui.badge.textContent = `.${FORMATS[target].ext}`;
    let image = null;
    if (target !== 'tiff' && target !== 'pdf') {
      try {
        image = await createImageBitmap(blob);
      } catch {
        image = null;
      }
    }
    ui.resultThumb.hidden = !image;
    ui.badge.hidden = !!image;
    if (image) {
      thumbnail(ui.resultThumb, image, image.width, image.height);
      image.close();
    }
  }

  /** Where the wheel opens without a pointer: the middle of the stage, as far as it is on screen. */
  function stageMiddle() {
    const box = ui.stage.getBoundingClientRect();
    const top = Math.max(box.top, 0);
    const bottom = Math.min(box.bottom, window.innerHeight);
    return { x: box.left + box.width / 2, y: bottom > top ? (top + bottom) / 2 : window.innerHeight / 2 };
  }

  function openWheel(at, drag, format) {
    if (state.wheel || state.busy || !state.caps) return null;
    const source = format === undefined ? state.source : null;
    if (!source && format === undefined) {
      say('chooseFirst');
      return null;
    }
    const point = at || stageMiddle();
    state.wheel = createWheel({
      x: point.x,
      y: point.y,
      drag,
      format: source ? source.format : format,
      subtitle: source ? source.name : tx().dragged,
      onChoose: (target, preset, file, closed) => run(target, preset, file, closed),
      onClosed: () => {
        state.wheel = null;
      },
      fallbackFocus: () => (state.source ? ui.open : root.querySelector('[data-act="choose"]')),
    });
    return state.wheel;
  }

  /** The Convert wheel's slices for a picture of `format` (null when unknown during a drag). */
  function slicesFor(format) {
    const t = tx();
    return TARGETS.filter((id) => id !== format && state.caps[id]).map((id) => {
      const slice = { id, label: FORMATS[id].label, hint: `${FORMATS[id].label}: ${t.hint[id]}` };
      if (QUALITY.high[id] === undefined) return slice;
      return {
        ...slice,
        hint: t.withChoices(slice.hint),
        default: 'balanced',
        variants: ['high', 'balanced', 'small'].map((q) => ({
          id: q,
          label: t.quality[q],
          icon: ICONS[q],
          hint: t.qualityHint[q],
        })),
      };
    });
  }

  /**
   * The wheel: an overlay under the pointer (or over the stage), driven by the pointer, the keyboard,
   * a drag of files or a held finger. It closes itself after an apply, an Esc or a click outside.
   */
  function createWheel({ x, y, drag, format, subtitle, onChoose, onClosed, fallbackFocus }) {
    const t = tx();
    const uid = `kp${++ids}`;
    const reduced = reducedMotion();
    const tree = slicesFor(format);
    const levels = [];
    let palette = isDark() ? DARK : LIGHT;
    let page = 0;
    let hover = null;
    let selected = null;
    let phase = 'opening';
    let items = [];
    let n = 0;
    let offset = 0;
    let svg = null;
    let dragged = drag;
    let dropped = null;
    const dwell = { spot: null, timer: 0, settled: false };
    const previous = document.activeElement;
    let finish;
    const closed = new Promise((resolve) => (finish = resolve));

    const overlay = el('div', 'kp-overlay', { lang: state.lang });
    const box = el('div', `kp-wheel is-opening${reduced ? ' is-reduced' : ''}`, {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t.convert,
    });
    const disc = el('div', 'kp-disc', { role: 'menu', tabindex: '-1', 'aria-describedby': `${uid}-help` });
    const face = el('div', 'kp-face');
    const menu = el('div', 'kp-items');
    const tip = el('p', 'kp-tip', { 'aria-hidden': 'true' });
    const help = el('p', '', { id: `${uid}-help`, hidden: '' });
    const live = el('p', 'kp-sr', { 'aria-live': 'polite' });
    help.textContent = t.instructions;
    disc.append(face, menu);
    box.append(disc, tip, help, live);
    overlay.append(box);
    document.body.append(overlay);

    const ringOf = () => levels.reduce((ring, level) => ring.find((s) => s.id === level.id).variants, tree);
    const interactive = () => phase === 'opening' || phase === 'open';

    function pageOf(ring) {
      if (ring.length <= 8) return ring;
      const pages = Math.ceil(ring.length / PAGE);
      const p = Math.min(page, pages - 1);
      const last = p === pages - 1;
      return [
        ...ring.slice(p * PAGE, p * PAGE + PAGE),
        last
          ? { id: '\u0001first', label: t.first, icon: ICONS.first, hint: t.firstHint, paging: 0 }
          : {
              id: '\u0001more',
              label: t.more,
              small: true,
              hint: t.moreHint(ring.length - (p + 1) * PAGE),
              paging: p + 1,
            },
      ];
    }

    /** Places the wheel round a point and keeps it on screen, the tip under it or, near the bottom, over it. */
    function place(px, py) {
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = window.innerHeight;
      const side = Math.max(200, Math.min(414, vw - 16, vh - 72));
      const half = side / 2;
      const cx = vw >= side ? Math.min(Math.max(px, half), vw - half) : vw / 2;
      const cy = vh >= side ? Math.min(Math.max(py, half), vh - half) : vh / 2;
      box.style.setProperty('--kp-box', `${side}px`);
      box.style.left = `${cx}px`;
      box.style.top = `${cy}px`;
      box.classList.toggle('has-tip-above', cy + half + 48 > vh);
    }

    function draw(entering) {
      const ring = ringOf();
      items = pageOf(ring);
      n = items.length;
      const level = levels[levels.length - 1];
      // A ring of choices turns so that it unfolds from its slice, with its default where the slice was.
      offset = level ? level.at - (page === 0 ? level.anchor : 0) * (360 / n) : 0;
      const title = level ? level.label : t.convert;
      const name = subtitle.length > 20 ? `${subtitle.slice(0, 10)}…${subtitle.slice(-9)}` : subtitle;
      face.innerHTML = dialSvg({
        slices: items.map((item) =>
          item.small
            ? { label: item.label, small: true }
            : item.icon
              ? { label: item.label, icon: item.icon, word: true }
              : { label: item.label, choices: !!item.variants },
        ),
        title,
        subtitle: name,
        trail: level ? [t.convert, ...levels.slice(0, -1).map((l) => l.label)].map(t.trail).join(' ') : '',
        back: level ? t.back : '',
        offset,
        hover,
        selected,
        palette,
        id: uid,
      });
      svg = face.firstElementChild;
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      setState(svg, palette, { hover, selected });
      menu.textContent = '';
      items.forEach((item, i) => {
        const entry = el('div', '', {
          role: 'menuitem',
          id: `${uid}-item-${i}`,
          'aria-posinset': String(i + 1),
          'aria-setsize': String(n),
          'aria-describedby': `${uid}-hint-${i}`,
        });
        if (item.variants) entry.setAttribute('aria-haspopup', 'menu');
        entry.textContent = item.label;
        entry.addEventListener('click', () => activate(i, 'key'));
        const hint = el('span', '', { id: `${uid}-hint-${i}`, hidden: '' });
        hint.textContent = item.hint;
        menu.append(entry, hint);
      });
      disc.setAttribute('aria-label', title);
      describe();
      if (entering && !reduced) unfold(entering.origin, entering.way);
      else if (entering) svg.classList.add('is-fading');
    }

    /** The new ring lights up outward from the slice it came from, and the dial clicks into a stop. */
    function unfold(origin, way) {
      svg.classList.add('is-entering');
      for (const group of svg.querySelectorAll('.kw-slice, .kw-marks')) {
        const i = Number(group.getAttribute('data-slice'));
        group.style.animationDelay = `${Math.round(10 + spread(i, origin, n) * 120)}ms`;
      }
      const dial = svg.querySelector('.kw-dial');
      const angle = dial.style.transform;
      const turn = Number(/-?[\d.]+/.exec(angle)[0]);
      dial.style.transition = 'none';
      dial.style.transform = `rotate(${turn - 14.4 * way}deg)`;
      getComputedStyle(dial).transform;
      dial.style.transition = 'transform 180ms cubic-bezier(0.12, 0.75, 0.3, 1.06)';
      dial.style.transform = angle;
    }

    function describe() {
      const item = hover === null ? null : items[hover];
      if (item) disc.setAttribute('aria-activedescendant', `${uid}-item-${hover}`);
      else disc.removeAttribute('aria-activedescendant');
      if (item && interactive()) {
        tip.textContent = item.hint;
        tip.classList.add('is-shown');
      } else tip.classList.remove('is-shown');
    }

    function announce(text) {
      live.textContent = text;
    }

    function hoverTo(index) {
      if (index === hover) return;
      hover = index;
      setState(svg, palette, { hover, selected });
      describe();
    }

    function settle() {
      clearTimeout(dwell.timer);
      Object.assign(dwell, { spot: null, timer: 0, settled: true });
    }

    function open(index) {
      const item = items[index];
      if (!interactive() || !item || !item.variants) return;
      const at = offset + index * (360 / n);
      const anchor = Math.max(
        0,
        item.variants.findIndex((v) => v.id === item.default),
      );
      levels.push({ id: item.id, label: item.label, index, page, at, anchor });
      page = 0;
      selected = null;
      hover = anchor;
      draw({ origin: anchor, way: 1 });
      announce(t.opened(item.label, item.variants.length));
      settle();
    }

    function back(via) {
      const last = levels.pop();
      if (!interactive() || !last) return;
      page = last.page;
      selected = null;
      hover = via === 'key' ? last.index : null;
      draw({ origin: last.index, way: -1 });
      announce(t.backTo(levels.length ? levels[levels.length - 1].label : t.convert));
      settle();
    }

    /** Another page of a ring of more than eight; from the paging slice, the new one takes its place. */
    function turnPage(target, onPaging) {
      page = target;
      const last = pageOf(ringOf()).length - 1;
      hover = onPaging ? last : null;
      draw({ origin: last, way: 1 });
      announce(t.page(target + 1));
      settle();
    }

    function activate(index, how) {
      const item = items[index];
      if (!interactive() || !item) return;
      if (item.paging !== undefined) return turnPage(item.paging, true);
      if (item.variants) return how === 'pointer' ? choose(index, item.default) : open(index);
      choose(index, null);
    }

    function choose(index, preset) {
      const item = items[index];
      const target = levels.length ? levels[0].id : item.id;
      const choice = levels.length ? item.id : preset;
      phase = 'applying';
      clearTimeout(dwell.timer);
      selected = index;
      hover = index;
      box.classList.add('is-applying');
      if (!reduced) {
        // The dial snaps a little past the slice and back as the handle turns and the bolts are thrown.
        const dial = svg.querySelector('.kw-dial');
        const angle = dial.style.transform;
        dial.style.transition = 'none';
        dial.style.transform = `rotate(${Number(/-?[\d.]+/.exec(angle)[0]) + 7.2}deg)`;
        getComputedStyle(dial).transform;
        dial.style.transition = '';
      }
      setState(svg, palette, { hover, selected });
      describe();
      onChoose(target, choice, dropped, closed);
      setTimeout(close, (reduced ? 0 : MOTION.apply) + MOTION.hold);
    }

    function close() {
      if (phase === 'closing' || phase === 'closed') return;
      phase = 'closing';
      clearTimeout(dwell.timer);
      box.classList.remove('is-opening');
      box.classList.add('is-closing');
      describe();
      setTimeout(
        () => {
          phase = 'closed';
          const focused = box.contains(document.activeElement);
          overlay.remove();
          window.removeEventListener('resize', onResize);
          onClosed();
          // The focus goes back where it was; when that is gone (the chooser of an empty stage), to the
          // stage. A wheel opened by a drag took no focus worth giving back.
          if (focused) {
            const usable =
              previous && previous !== document.body && previous.isConnected && previous.offsetParent !== null;
            const target = usable ? previous : drag ? null : fallbackFocus();
            if (target) target.focus({ preventScroll: true });
          }
          finish();
        },
        reduced ? REDUCED.close : MOTION.close,
      );
    }

    function spotAt(cx, cy) {
      const b = disc.getBoundingClientRect();
      const vx = ((cx - b.left) / b.width) * 460 - 30;
      const vy = ((cy - b.top) / b.height) * 460 - 30;
      const r = Math.hypot(vx - 200, vy - 200);
      return { index: sliceAt(vx, vy, n, offset), r };
    }

    function rests(spot, dragging) {
      if (spot === 'hub') return levels.length > 0;
      const item = spot === null ? null : items[spot];
      return !!item && (!!item.variants || (dragging && item.paging !== undefined));
    }

    /** Resting acts: on a slice with choices it opens them, on the hub it goes back a level, and during
     *  a drag (where nothing can be clicked) on More… it turns the page. Once a rest has acted, what
     *  lies under the pointer in the new ring waits until the pointer moves on. */
    function dwellOn(spot, dragging) {
      if (dwell.settled) return Object.assign(dwell, { spot, settled: false });
      if (dwell.spot === spot) return;
      clearTimeout(dwell.timer);
      Object.assign(dwell, { spot, timer: 0 });
      if (!rests(spot, dragging)) return;
      dwell.timer = setTimeout(() => {
        settle();
        if (!interactive()) return;
        if (spot === 'hub') back('pointer');
        else if (items[spot] && items[spot].paging !== undefined) turnPage(items[spot].paging, true);
        else open(spot);
      }, MOTION.dwell);
    }

    function pointTo(cx, cy, dragging) {
      if (!interactive()) return;
      const { index, r } = spotAt(cx, cy);
      hoverTo(index);
      dwellOn(index !== null ? index : r < R.WINDOW ? 'hub' : null, dragging);
    }

    disc.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'touch') pointTo(event.clientX, event.clientY, false);
    });
    disc.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch' || !interactive()) return;
      dwellOn(null, false);
      hoverTo(null);
    });
    disc.addEventListener('mousedown', (event) => event.preventDefault());
    // A finger has no hover: holding it on a slice with choices opens them, as resting the pointer does.
    let press = null;
    // A hold that opened a ring may still be followed by its own click, which must not apply a slice.
    let heldClick = false;
    const unpress = () => {
      if (!press) return;
      clearTimeout(press.timer);
      heldClick = press.used;
      press = null;
    };
    disc.addEventListener('pointerdown', (event) => {
      if (press) clearTimeout(press.timer);
      press = null;
      heldClick = false;
      if (event.pointerType !== 'touch' || !interactive()) return;
      const { index } = spotAt(event.clientX, event.clientY);
      if (index === null || !items[index].variants) return;
      const held = { x: event.clientX, y: event.clientY, used: false };
      held.timer = setTimeout(() => {
        held.used = true;
        hoverTo(index);
        open(index);
      }, MOTION.dwell);
      press = held;
    });
    disc.addEventListener('pointermove', (event) => {
      if (press && !press.used && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) unpress();
    });
    disc.addEventListener('pointerup', unpress);
    disc.addEventListener('pointercancel', unpress);
    disc.addEventListener('contextmenu', (event) => event.preventDefault());
    overlay.addEventListener('click', (event) => {
      if (heldClick) {
        heldClick = false;
        return;
      }
      if (event.button !== 0 || !interactive()) return;
      if (!disc.contains(event.target) || event.target.closest('.kp-items')) {
        if (event.target === overlay) close();
        return;
      }
      const { index, r } = spotAt(event.clientX, event.clientY);
      if (index !== null) activate(index, 'pointer');
      else if (r < R.WINDOW && levels.length) back('pointer');
      else if (r > R.OUT) close();
    });
    disc.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key;
      const handled = [
        'ArrowDown',
        'ArrowUp',
        'ArrowRight',
        'ArrowLeft',
        'Backspace',
        'Home',
        'End',
        'Enter',
        ' ',
        'Escape',
        'Tab',
        'PageDown',
        'PageUp',
      ];
      if (!handled.includes(key)) return;
      event.preventDefault();
      box.classList.add('is-keyboard');
      if (!interactive()) return;
      const move = (delta) => hoverTo(hover === null ? (delta > 0 ? 0 : n - 1) : (hover + delta + n) % n);
      const item = hover === null ? null : items[hover];
      const pages = Math.ceil(ringOf().length / PAGE);
      if (key === 'ArrowDown') move(1);
      else if (key === 'ArrowUp') move(-1);
      else if (key === 'Home') hoverTo(0);
      else if (key === 'End') hoverTo(n - 1);
      else if (key === 'ArrowRight' && item) item.paging !== undefined ? activate(hover, 'key') : open(hover);
      else if ((key === 'ArrowLeft' || key === 'Backspace') && levels.length) back('key');
      else if ((key === 'Enter' || key === ' ') && item) activate(hover, 'key');
      else if (key === 'Escape') levels.length ? back('key') : close();
      else if (key === 'Tab') close();
      else if ((key === 'PageDown' || key === 'PageUp') && ringOf().length > 8) {
        turnPage((page + (key === 'PageDown' ? 1 : -1) + pages) % pages, false);
      }
    });
    const onResize = () => place(x, y);
    window.addEventListener('resize', onResize);

    place(x, y);
    draw(null);
    // On screen at once; the dial spins in from almost a full turn back and settles.
    if (!reduced) {
      const dial = svg.querySelector('.kw-dial');
      const angle = dial.style.transform;
      dial.style.transition = 'none';
      dial.style.transform = `rotate(${Number(/-?[\d.]+/.exec(angle)[0]) - 300}deg)`;
      getComputedStyle(dial).transform;
      dial.style.transition = `transform ${MOTION.open + MOTION.stagger * (n - 1)}ms cubic-bezier(0.12, 0.75, 0.3, 1.06)`;
      dial.style.transform = angle;
    }
    box.style.setProperty('--kp-open', `${reduced ? REDUCED.open : MOTION.open + MOTION.stagger * (n - 1)}ms`);
    box.style.setProperty('--kp-close', `${reduced ? REDUCED.close : MOTION.close}ms`);
    box.style.setProperty('--kp-level', `${reduced ? REDUCED.level : MOTION.level}ms`);
    disc.focus({ preventScroll: true });
    setTimeout(
      () => {
        if (phase === 'opening') phase = 'open';
        box.classList.remove('is-opening');
        const dial = svg && svg.querySelector('.kw-dial');
        if (dial) dial.style.transition = '';
      },
      (reduced ? REDUCED.open : MOTION.open + MOTION.stagger * (n - 1)) + 30,
    );

    return {
      closed,
      get dragged() {
        return dragged;
      },
      /** A drag of files or a held finger is over this point. */
      point(cx, cy) {
        dragged = true;
        pointTo(cx, cy, true);
      },
      /** The drag dropped here: a slice converts the file (a slice with choices its default), anywhere else closes. */
      drop(cx, cy, file) {
        dwellOn(null, true);
        const { index } = spotAt(cx, cy);
        const item = index === null ? null : items[index];
        if (!item || !interactive() || item.paging !== undefined) return close();
        dropped = file || null;
        activate(index, 'pointer');
      },
      /** A held finger lifted here: a slice applies; anywhere else the wheel stays open for a tap. */
      release(cx, cy) {
        dwellOn(null, true);
        const { index } = spotAt(cx, cy);
        if (index !== null && items[index] && items[index].paging === undefined) activate(index, 'pointer');
      },
      leave() {
        dwellOn(null, true);
        if (interactive()) hoverTo(null);
      },
      repaint() {
        palette = isDark() ? DARK : LIGHT;
        if (interactive()) draw(null);
      },
      close,
    };
  }

  // ------------------------------------------------------------ drags of files over the page

  const hasFiles = (event) =>
    !!event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') >= 0;
  let gone = 0;
  let noted = false;

  /** A drag that left the window, was cancelled with Esc or ended elsewhere: the wheel it opened closes. */
  function dragEnded() {
    ui.stage.classList.remove('is-over');
    noted = false;
    if (state.wheel && state.wheel.dragged) state.wheel.close();
  }

  function onDragOver(event) {
    if (!hasFiles(event)) return;
    clearTimeout(gone);
    gone = setTimeout(dragEnded, 1500);
    const wheel = state.wheel;
    if (wheel) {
      event.preventDefault();
      // A copy: the original file stays where it is, whatever the keys held.
      event.dataTransfer.dropEffect = 'copy';
      wheel.point(event.clientX, event.clientY);
      return;
    }
    if (!root.contains(event.target)) {
      ui.stage.classList.remove('is-over');
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    ui.stage.classList.add('is-over');
    if (state.busy || !state.caps) return;
    if (event.shiftKey) {
      const items = event.dataTransfer.items;
      const type = items && items[0] ? items[0].type : '';
      if (type && !FROM_TYPE[type]) {
        if (!noted) say('notPicture');
        noted = true;
        return;
      }
      const opened = openWheel({ x: event.clientX, y: event.clientY }, true, FROM_TYPE[type] || null);
      if (opened && items && items.length > 1) say('oneAtATime');
    } else if ((event.ctrlKey || event.altKey || event.metaKey) && !noted) {
      noted = true;
      say('otherKeys');
    }
  }

  /** Leaving the window ends the drag for the page at once; anything else waits for the next dragover,
   *  and without one the drag is over after a moment anyway. */
  function onDragLeave(event) {
    if (!hasFiles(event) || event.relatedTarget) return;
    const { clientX: cx, clientY: cy } = event;
    if (cx > 0 && cy > 0 && cx < window.innerWidth && cy < window.innerHeight) return;
    clearTimeout(gone);
    gone = setTimeout(dragEnded, 100);
  }

  function onDrop(event) {
    if (!hasFiles(event)) return;
    clearTimeout(gone);
    ui.stage.classList.remove('is-over');
    noted = false;
    const wheel = state.wheel;
    if (!wheel && !root.contains(event.target)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const files = event.dataTransfer.files;
    if (wheel) {
      if (state.busy) return wheel.close();
      wheel.drop(event.clientX, event.clientY, files[0]);
      if (files.length > 1) say('oneAtATime');
      return;
    }
    take(files[0], { via: 'drop', x: event.clientX, y: event.clientY, many: files.length > 1 });
  }

  document.addEventListener('dragenter', onDragOver);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('drop', onDrop);

  // ------------------------------------------------------------ press and hold on a touch screen

  let hold = null;
  const endHold = () => {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  };
  ui.press.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || !event.isPrimary || !state.source || state.busy || state.wheel) return;
    const at = { x: event.clientX, y: event.clientY };
    hold = {
      id: event.pointerId,
      ...at,
      open: false,
      timer: setTimeout(() => {
        if (!hold) return;
        hold.open = !!openWheel(at, false);
      }, MOTION.press),
    };
  });
  ui.press.addEventListener('pointermove', (event) => {
    if (!hold || event.pointerId !== hold.id) return;
    if (hold.open && state.wheel) state.wheel.point(event.clientX, event.clientY);
    else if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 12) endHold();
  });
  ui.press.addEventListener('pointerup', (event) => {
    if (!hold || event.pointerId !== hold.id) return;
    const opened = hold.open;
    endHold();
    if (opened && state.wheel) state.wheel.release(event.clientX, event.clientY);
  });
  ui.press.addEventListener('pointercancel', endHold);
  ui.press.addEventListener('contextmenu', (event) => event.preventDefault());

  // ------------------------------------------------------------ buttons, language and theme

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const act = button.getAttribute('data-act');
    if (act === 'open') {
      // A click opens the wheel under the pointer; Enter or Space over the stage.
      const at = event.detail > 0 && (event.clientX || event.clientY) ? { x: event.clientX, y: event.clientY } : null;
      openWheel(at, false);
    } else if (act === 'save' && state.result) saveFile(state.result.blob, state.result.name);
  });

  const follow = () => {
    if (langOf(root) !== state.lang) {
      if (state.wheel) state.wheel.close();
      render();
    } else if (state.wheel) state.wheel.repaint();
  };
  new MutationObserver(follow).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['lang', 'data-lang', 'data-theme'],
    subtree: true,
  });
  if (dark) dark.addEventListener('change', follow);

  render();
  const api = {
    take,
    async sample() {
      await ready;
      take(await samplePicture(tx().sample), { via: 'sample' });
    },
  };
  root.kentoPlayground = api;
  return api;
}
