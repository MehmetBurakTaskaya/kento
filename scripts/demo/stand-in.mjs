// SPDX-License-Identifier: MIT
// What the demo recording (scripts/record-demo.mjs) adds to the browser stand-in of src/ipc.ts, in
// the app's own frames: sample files whose targets and tools come from the real catalog (every
// tool group installed), painted pictures, and hooks through which the stage plays the core's
// part (a wheel session, the drag over it, a corner card, the shelf, a tool window). The recording
// loads it into src/ipc.ts; it acts only in frames opened with ?demo=1.
import catalog from '../../website-kit/catalog.json';

const params = new URLSearchParams(window.location.search);
const lang = params.get('lang') ?? 'en';
const turkish = lang === 'tr';

const FOLDER = 'C:\\Users\\me\\Documents\\Demo';
const at = (name) => `${FOLDER}\\${name}`;

/** Sizes of the sample files, so the panels read like real ones. */
const SIZES = {
  heic: 3_148_220,
  jpg: 2_406_918,
  png: 412_668,
  docx: 184_320,
  pdf: 1_268_736,
  pptx: 4_812_400,
  xlsx: 48_960,
  mov: 186_240_512,
  mp4: 41_870_336,
};
const sizeOf = (name) => SIZES[name.split('.').pop()] ?? 1_000_000;

const BY_EXTENSION = new Map(
  catalog.formats.flatMap((format) => format.extensions.map((extension) => [extension, format])),
);
const formatOf = (path) => BY_EXTENSION.get(path.split('.').pop().toLowerCase()) ?? null;

function entry(path) {
  const name = path.split(/[\\/]/).pop();
  const format = formatOf(path);
  return {
    path,
    name,
    folder: false,
    format: format?.id ?? null,
    category: format?.category ?? null,
    size: sizeOf(name),
  };
}

/** The Convert targets of a selection, as the core's `targets` command finds them in the catalog
 *  (every tool group installed). */
function targets(paths) {
  const groups = [];
  for (const path of paths) {
    const format = formatOf(path);
    if (!format) continue;
    const group = groups.find((g) => g.category === format.category);
    if (group) group.ids.push(format.id);
    else groups.push({ category: format.category, ids: [format.id] });
  }
  const usable = (from, to) => catalog.routes.some((r) => r.from === from && r.to === to && r.status !== 'planned');
  return groups.map(({ category, ids }) => ({
    category,
    count: ids.length,
    targets: catalog.routes
      .filter((route) => route.from === ids[0] && route.status !== 'planned' && ids.every((id) => usable(id, route.to)))
      .map((route) => ({
        to: route.to,
        label: catalog.formats.find((format) => format.id === route.to)?.label ?? route.to.toUpperCase(),
        group: route.group,
        enhancement: route.enhancement,
        note: route.note,
        needs: null,
      })),
  }));
}

/** The Tools wheel's tools for a selection, by the rules of the core's `tools` command. */
function tools(paths) {
  const categories = paths.map((path) => formatOf(path)?.category ?? null);
  const count = categories.length;
  const all = (wanted) => count > 0 && categories.every((c) => c && wanted.includes(c));
  const one = (wanted) => categories.filter((c) => c === wanted).length === 1;
  const fits = (tool) => {
    switch (tool.id) {
      case 'split-pdf':
      case 'edit-pdf':
        return count === 1 && all(['pdf']);
      case 'merge-pdf':
        return count >= 2 && all(['pdf']);
      case 'images-to-pdf':
      case 'remove-background':
        return all(['image']);
      case 'read-qr':
        return all(['image', 'pdf']);
      case 'extract':
        return all(['archive']);
      case 'mute':
        return all(['video']);
      case 'merge-video':
        return count >= 2 && all(['video']);
      case 'trim-video':
      case 'crop-video':
      case 'speed':
      case 'frames':
      case 'split-video':
      case 'redact-video':
        return count === 1 && all(['video']);
      case 'normalize':
      case 'trim-audio':
      case 'channels':
      case 'redact-audio':
      case 'audio-to-video':
        return count === 1 && all(['audio']);
      case 'edit-image':
      case 'crop-image':
      case 'markup':
      case 'frame':
      case 'redact-image':
        return count === 1 && all(['image']);
      case 'collage':
        return count >= 2 && all(['image']);
      case 'metadata':
        return count === 1 && all(tool.categories);
      case 'make-qr':
        return false;
      case 'burn-subtitles':
        return count === 2 && one('video') && one('subtitle');
      default:
        return all(tool.categories);
    }
  };
  return catalog.tools
    .filter((tool) => tool.status === 'ready' && fits(tool))
    .map((tool) => ({ id: tool.id, icon: tool.icon, group: tool.group, enhancement: tool.enhancement, needs: null }));
}

// ---------------------------------------------------------------- pictures

const PHOTOS = {
  heic: { sky: ['#5f86d6', '#f3c3a4', '#fbe6c9'], land: ['#d9b6a0', '#b98f7b', '#8f6f62'], balloons: true },
  jpg: { sky: ['#4f8fd3', '#a9d3ef', '#e8f3f7'], land: ['#2f6f8f', '#255a76', '#1d465c'], balloons: false },
};
const BALLOONS = ['#e0443a', '#f2c230', '#2f6fd6', '#3f9b5a', '#ef7d22'];

/** A sample photo of our own: dawn over a valley with balloons, or a bay with a sail. */
export function paintPhoto(width, height, kind = 'heic') {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const g = canvas.getContext('2d');
  const [w, h] = [canvas.width, canvas.height];
  const look = PHOTOS[kind] ?? PHOTOS.heic;
  const sky = g.createLinearGradient(0, 0, 0, h * 0.72);
  look.sky.forEach((color, i) => sky.addColorStop(i / (look.sky.length - 1), color));
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const sun = g.createRadialGradient(w * 0.68, h * 0.5, 0, w * 0.68, h * 0.5, w * 0.2);
  sun.addColorStop(0, 'rgba(255, 248, 226, 1)');
  sun.addColorStop(0.35, 'rgba(255, 238, 205, 0.7)');
  sun.addColorStop(1, 'rgba(255, 238, 205, 0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);
  const ridge = (base, lift, color, seed) => {
    g.beginPath();
    g.moveTo(0, h);
    g.lineTo(0, h * base);
    for (let i = 0; i <= 10; i++) {
      const x = (w * i) / 10;
      g.lineTo(x, h * (base - lift * (0.5 + 0.5 * Math.sin(i * 1.3 + seed))));
    }
    g.lineTo(w, h);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  if (look.balloons) {
    ridge(0.66, 0.08, look.land[0], 1);
    ridge(0.78, 0.06, look.land[1], 3);
    ridge(0.9, 0.04, look.land[2], 5);
    for (let i = 0; i < 5; i++) {
      const x = w * (0.14 + i * 0.18 + 0.03 * Math.cos(i * 2));
      const y = h * (0.18 + 0.12 * Math.abs(Math.sin(i * 1.7)));
      const r = w * (0.045 - i * 0.004);
      g.beginPath();
      g.ellipse(x, y, r, r * 1.15, 0, 0, Math.PI * 2);
      g.fillStyle = BALLOONS[i % BALLOONS.length];
      g.fill();
      g.beginPath();
      g.ellipse(x, y, r * 0.36, r * 1.15, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255, 255, 255, 0.3)';
      g.fill();
      g.fillStyle = '#5b4034';
      g.fillRect(x - r * 0.22, y + r * 1.45, r * 0.44, r * 0.32);
    }
  } else {
    g.fillStyle = look.land[0];
    g.fillRect(0, h * 0.62, w, h * 0.38);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(255, 255, 255, ${0.18 - i * 0.02})`;
      g.fillRect(0, h * (0.66 + i * 0.055), w, Math.max(1, h * 0.008));
    }
    ridge(0.62, 0.1, look.land[1], 2);
    g.fillStyle = look.land[2];
    g.fillRect(0, h * 0.9, w, h * 0.1);
    // A sail.
    g.beginPath();
    g.moveTo(w * 0.36, h * 0.64);
    g.lineTo(w * 0.42, h * 0.38);
    g.lineTo(w * 0.47, h * 0.64);
    g.closePath();
    g.fillStyle = '#fbfcfd';
    g.fill();
    g.fillStyle = '#35414d';
    g.fillRect(w * 0.34, h * 0.64, w * 0.15, h * 0.025);
  }
  return canvas;
}

/** A page of a document, for PDF previews. */
function paintPage(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#2a4ea6';
  g.fillRect(width * 0.14, height * 0.12, width * 0.5, height * 0.06);
  g.fillStyle = '#c3c8ce';
  for (let i = 0; i < 9; i++)
    g.fillRect(width * 0.14, height * (0.26 + i * 0.07), width * (i % 3 === 2 ? 0.5 : 0.72), height * 0.025);
  return canvas;
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

function picture(path, size) {
  const format = formatOf(path);
  if (format?.category === 'pdf') return toBlob(paintPage(size * 0.75, size));
  // A slide saved as a picture.
  if (/slides|sunum/i.test(path)) return toBlob(paintPage(size, size * 0.75));
  if (format?.category !== 'image') return Promise.resolve(null);
  const kind = /harbou?r|liman/i.test(path) ? 'jpg' : 'heic';
  return toBlob(paintPhoto(size, size * 0.75, kind));
}

// ---------------------------------------------------------------- the main window's data

const TEXT = turkish
  ? {
      shots: 'Ekran görüntüleri → WEBP',
      social: 'Paylaşım için hazırla',
      downloads: 'İndirilen arşivler',
      web: 'Web için küçült',
      video: 'Balon turu, gün doğumu (4K)',
      pictures: 'Resimler',
      screenshots: 'Ekran görüntüleri',
      optimized: 'Küçültülenler',
      ready: 'Hazır',
      opened: 'Açılanlar',
      downloadsFolder: 'İndirilenler',
      desktop: 'Masaüstü',
    }
  : {
      shots: 'Screenshots → WEBP',
      social: 'Ready to share',
      downloads: 'Downloaded archives',
      web: 'Smaller for the web',
      video: 'Sunrise balloon tour (4K)',
      pictures: 'Pictures',
      screenshots: 'Screenshots',
      optimized: 'Optimized',
      ready: 'Ready',
      opened: 'Extracted',
      downloadsFolder: 'Downloads',
      desktop: 'Desktop',
    };

const home = (...parts) => ['C:\\Users\\me', ...parts].join('\\');

function automationView(base) {
  const now = Date.now();
  const filter = (extensions) => ({ extensions, pattern: '', minSize: null, maxSize: null });
  const rule = (id, name, folder, extensions, action, output, enabled = true) => ({
    id,
    name,
    enabled,
    folder,
    subfolders: false,
    filter: filter(extensions),
    action,
    output,
    outputInside: false,
    problem: null,
  });
  const shot = (n) => (turkish ? `Ekran görüntüsü ${n}.png` : `Screenshot ${n}.png`);
  return {
    ...base,
    paused: false,
    rules: [
      rule(
        'shots',
        TEXT.shots,
        home(TEXT.pictures, TEXT.screenshots),
        ['png'],
        { kind: 'convert', to: 'webp' },
        home(TEXT.pictures, TEXT.optimized),
      ),
      rule(
        'social',
        TEXT.social,
        home(TEXT.desktop, turkish ? 'Paylaşılacak' : 'To share'),
        ['jpg', 'heic'],
        { kind: 'recipe', recipe: 'ready-for-instagram' },
        home(TEXT.desktop, turkish ? 'Paylaşılacak' : 'To share', TEXT.ready),
      ),
      rule(
        'archives',
        TEXT.downloads,
        home(TEXT.downloadsFolder),
        ['zip', '7z'],
        { kind: 'tool', tool: 'extract' },
        home(TEXT.downloadsFolder, TEXT.opened),
        false,
      ),
    ],
    activity: [
      {
        id: 3,
        at: now - 4_000,
        rule: 'shots',
        ruleName: TEXT.shots,
        file: shot('2026-11-03 091512'),
        outcome: 'done',
        message: null,
        outputs: [home(TEXT.pictures, TEXT.optimized, shot('2026-11-03 091512').replace('.png', '.webp'))],
      },
    ],
  };
}

function recipes(list) {
  const [example] = list;
  const web = {
    id: 'smaller-for-the-web',
    name: TEXT.web,
    steps: [
      { kind: 'resize', longSide: 1600 },
      { kind: 'convert', to: 'webp' },
      { kind: 'compress', compression: { mode: 'size', bytes: 500_000 } },
    ],
  };
  return example ? [example, web] : [web];
}

const LIBRARY = (
  turkish
    ? [
        ['klip.mp4', 'convert', 'klip.mov', 20_000],
        ['balon.jpg', 'convert', 'balon.heic', 95_000],
        ['rapor.pdf', 'convert', 'rapor.docx', 400_000],
        [`${TEXT.video}.mp4`, 'download', null, 2_400_000, 312_840_192],
        ['liman - kırpılmış.jpg', 'tool', 'liman.jpg', 7_200_000],
        ['sunum - 1.png', 'convert', 'sunum.pptx', 86_400_000],
      ]
    : [
        ['clip.mp4', 'convert', 'clip.mov', 20_000],
        ['sunrise.jpg', 'convert', 'sunrise.heic', 95_000],
        ['report.pdf', 'convert', 'report.docx', 400_000],
        [`${TEXT.video}.mp4`, 'download', null, 2_400_000, 312_840_192],
        ['harbor - cropped.jpg', 'tool', 'harbor.jpg', 7_200_000],
        ['slides - 1.png', 'convert', 'slides.pptx', 86_400_000],
      ]
).map(([name, origin, source, age, size], index) => ({
  id: 100 - index,
  ...entry(origin === 'download' ? home(TEXT.downloadsFolder, 'Kento', name) : at(name)),
  // A 4K download is far bigger than the clip converted in the tour.
  ...(size && { size }),
  created: Date.now() - age,
  origin,
  source,
  exists: true,
}));

export const DEMO_LINK = 'https://video.example.org/watch/sunrise-balloons';

/** A short video of our own that the recording makes from the painted dawn (record-demo.mjs), so
 *  the media editors show a picture. Without it they show their calm placeholder. */
const SAMPLE_VIDEO = '/artifacts/demo/sample.webm';

/** Waveform peaks that read like speech: phrases of uneven syllables with short pauses between. */
function speech(buckets) {
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const peaks = [];
  while (peaks.length < buckets) {
    const phrase = 40 + Math.floor(random() * 120);
    const loud = 0.5 + random() * 0.45;
    for (let done = 0; done < phrase;) {
      const length = 3 + Math.floor(random() * 9);
      const strength = 0.25 + 0.75 * random();
      for (let i = 0; i < length; i++)
        peaks.push(
          loud * strength * (0.25 + 0.75 * Math.sin((Math.PI * (i + 0.5)) / length)) * (0.75 + 0.25 * random()),
        );
      done += length;
    }
    const pause = 8 + Math.floor(random() * 30);
    for (let i = 0; i < pause; i++) peaks.push(0.01 + 0.025 * random());
  }
  return peaks.slice(0, buckets);
}

// ---------------------------------------------------------------- hooks

/** Patches the stand-in `api` for the demo and gives the stage the core's events to send. */
export function demoStandIn(api) {
  if (!params.has('demo')) return;
  const handlers = {};
  const hold = (name) => async (handler) => {
    handlers[name] = handler;
    return () => {
      if (handlers[name] === handler) delete handlers[name];
    };
  };
  let shelf = [];
  let toastId = 0;
  const library = [...LIBRARY];
  const found = (path) =>
    library.find((item) => item.path === path) ?? {
      id: 200 + library.length,
      ...entry(path),
      created: Date.now(),
      origin: 'convert',
      source: null,
      exists: true,
    };

  const base = { ...api };
  Object.assign(api, {
    inspect: async (paths) => paths.map(entry),
    targets: async (paths) => targets(paths),
    tools: async (paths) => tools(paths),
    thumbnail: (path, size) => picture(path, size),
    pdfThumbnail: async (_path, _index, size) => toBlob(paintPage(size * 0.75, size)),
    imagePreview: (paths, _tool, size) =>
      toBlob(paintPhoto(size, size * 0.75, /harbou?r|liman/i.test(paths[0] ?? '') ? 'jpg' : 'heic')),
    mediaPreview: async (path) => ({ url: formatOf(path)?.category === 'video' ? SAMPLE_VIDEO : '', proxy: false }),
    mediaPeaks: async (_path, buckets) => speech(buckets),
    libraryList: async () => library,
    libraryFind: async (paths) => paths.map(found),
    recipesList: async () => recipes(await base.recipesList()),
    recipesFor: async (paths) =>
      paths.length && paths.every((path) => formatOf(path)?.category === 'image')
        ? recipes(await base.recipesList()).map((recipe) => ({ ...recipe, needs: null }))
        : [],
    automationView: async () => automationView(await base.automationView()),
    webNeeds: async () => null,
    // The link is read for a moment, as it is for real, so the dialog shows its reading state on
    // purpose rather than for a single frame.
    webProbe: async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      return {
        url,
        site: 'other',
        kind: 'video',
        title: TEXT.video,
        duration: 754.3,
        heights: [2160, 1440, 1080, 720, 480, 360],
        thumbnail: false,
        images: [],
      };
    },
    shelfView: async () => ({ items: shelf, history: [] }),
    toastCards: async () => [],
    onDrag: hold('drag'),
    onWheelOpen: hold('wheelOpen'),
    onWheelClose: hold('wheelClose'),
    onToast: hold('toast'),
    onShelf: hold('shelf'),
    onOpenTool: hold('openTool'),
  });

  window.__kento = {
    /** True once the page's components listen for `name`. */
    listens: (name) => !!handlers[name],
    /** The core's wheel session: the floating wheel opens for these files. */
    openWheel: (session) => handlers.wheelOpen?.(session),
    closeWheel: () => handlers.wheelClose?.(),
    /** The system drag over the floating wheel's window. */
    drag: (event) => handlers.drag?.(event),
    toast: (title, outputs) => handlers.toast?.({ kind: 'done', id: ++toastId, title, outputs }),
    shelf: (paths) => {
      shelf = paths.map((path, index) => ({
        ...entry(path),
        id: index + 1,
        added: Date.now(),
        copy: false,
        present: true,
      }));
      handlers.shelf?.();
    },
    openTool: (tool, paths) => handlers.openTool?.(tool, paths),
    store: () => import('../../src/state/store.ts'),
    link: DEMO_LINK,
  };
}
