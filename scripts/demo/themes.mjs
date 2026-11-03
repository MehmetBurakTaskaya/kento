// SPDX-License-Identifier: MIT
// The themes reel of the README (scripts/record-demo.mjs --themes): every theme's wheel, drawn by the
// app's own Wheel in the app's page. Kasa opens first beside the count, then the other themes follow
// one another, slowly at first and then quicker; six of them apply a slice at once, each with its own
// effect; all of them stand side by side; and the end card closes the loop. The module takes over the
// page it is loaded into (`?surface=wheel`); `demo.play()` runs the reel once.
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import i18n from '/src/i18n/index.ts';
import { listThemes, loadTheme } from '/src/theme/registry.ts';
import { sample } from '/src/theme/shots.tsx';
import { Wheel } from '/src/wheel/Wheel.tsx';
import './themes.css';

const LANG = i18n.language === 'tr' ? 'tr' : 'en';
const TEXT = {
  en: {
    count: (n) => `${n} themes`,
    line: 'Every one a wheel of its own',
    motion: 'Each with its own motion',
    where: 'Settings → Appearance → Theme',
    end: ['Free and open source', 'Works on your computer', 'Windows and macOS'],
  },
  tr: {
    count: (n) => `${n} tema`,
    line: 'Her biri kendine ait bir çark',
    motion: 'Her birinin kendi hareketi var',
    where: 'Ayarlar → Görünüm → Tema',
    end: ['Ücretsiz ve açık kaynak', 'Bilgisayarında çalışır', 'Windows ve macOS'],
  },
}[LANG];

const THEMES = listThemes();
/** The parade after Kasa: a few opening and pointed at, then the rest at rest, quicker and then a
 *  theme a beat, never more than three a second. Neighbours differ, so each change reads. */
const SLOW = ['portakal', 'telefon', 'iznik', 'vitray'];
const MEDIUM = [
  'piksel',
  'ebru-a',
  'pikap',
  'astro-b',
  'karatahta',
  'baklava',
  'memphis',
  'kilim',
  'hologram',
  'pusula',
];
const FAST = THEMES.map((theme) => theme.id).filter(
  (id) => id !== 'steel' && !SLOW.includes(id) && !MEDIUM.includes(id),
);
/** Six apply effects side by side. */
const APPLY = ['steel', 'ebru-a', 'telefon', 'pikap', 'memphis', 'simya-a'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const element = (tag, className, parent, html = '') => {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  parent?.appendChild(node);
  return node;
};

const reel = element('div', 'reel', document.body);
const tools = () => sample('tools8');

/** The theme's desk, text colours and display face. */
function looks(theme, mode) {
  const tokens = theme.tokens[mode];
  const fonts = theme.wheel?.concept.fonts;
  return {
    desk: theme.wheel?.concept.palette[mode].desk ?? tokens.bg,
    text: tokens.text,
    muted: tokens['text-muted'],
    accent: tokens.accent,
    face: fonts?.display ?? fonts?.brand ?? 'inherit',
  };
}

/** A wheel in `parent`: live (opening, and answering keys) or still (open at rest). */
function mountWheel(parent, id, mode, size, preview, onClose = () => {}) {
  const theme = loaded.get(id);
  const { kind, title, slices } = tools();
  const root = createRoot(parent);
  const render = (round) =>
    root.render(
      h(Wheel, {
        key: round,
        preview,
        look: { theme, mode },
        kind,
        title,
        subtitle: i18n.t('settings.appearance.sample'),
        slices,
        size,
        keyName: 'Ctrl',
        sound: { enabled: false, volume: 0 },
        reducedMotion: false,
        openSound: false,
        onApply: () => {},
        onClose: () => onClose(),
      }),
    );
  flushSync(() => render(0));
  return { root, render };
}

/** Presses keys on a live wheel, as its keyboard does, letting it draw after each. */
async function press(parent, ...keys) {
  for (const key of keys) {
    const target = parent.querySelector('[role="group"]');
    target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await sleep(30);
  }
}

const loaded = new Map();
const ready = (async () => {
  for (const entry of THEMES) loaded.set(entry.id, await loadTheme(entry.id));
  // Every face the wheels and the names use, before the first frame.
  const families = new Set(['IBM Plex Sans Variable']);
  for (const theme of loaded.values()) for (const family of theme.wheel?.concept.fonts.load ?? []) families.add(family);
  await Promise.all(
    [...families].flatMap((family) =>
      ['400', '600', '700'].map((weight) => document.fonts.load(`${weight} 24px "${family}"`, 'AaĞğİıŞş0123')),
    ),
  );
  await document.fonts.ready;
})();

// ---------------------------------------------------------------- scenes

async function intro() {
  const kasa = loaded.get('steel');
  const look = looks(kasa, 'light');
  const scene = element('section', 'scene intro', reel);
  scene.style.background = look.desk;
  const stage = element('div', 'intro-wheel', scene);
  const words = element(
    'div',
    'intro-words',
    scene,
    `<img src="/design/icons/app.svg" alt=""><h1>${TEXT.count(THEMES.length)}</h1><p>${TEXT.line}</p>`,
  );
  words.style.color = look.text;
  const wheel = mountWheel(stage, 'steel', 'light', 360, 'live');
  await sleep(500);
  words.classList.add('is-on');
  // The dial goes round without resting long enough on a slice to open its ring.
  await sleep(600);
  for (let i = 0; i < 6; i++) {
    await press(stage, 'ArrowDown');
    await sleep(270);
  }
  await sleep(250);
  return { scene, wheel };
}

/** The parade: each theme on its own desk, the first few uncovered from the middle over the one
 *  before, the rest cut in. */
async function parade(previous) {
  let shown = previous;
  let number = 2;
  const step = async (id, mode, hold, preview, keys = [], reveal = false) => {
    const theme = loaded.get(id);
    const look = looks(theme, mode);
    const scene = element('section', `scene parade${reveal ? ' is-revealed' : ''}`, reel);
    scene.style.background = look.desk;
    const stage = element('div', 'parade-wheel', scene);
    const name = element('div', 'parade-name', scene);
    name.textContent = theme.name;
    Object.assign(name.style, { color: look.text, fontFamily: look.face });
    const count = element('div', 'parade-count', scene);
    count.textContent = `${number++} / ${THEMES.length}`;
    count.style.color = look.muted;
    const wheel = mountWheel(stage, id, mode, 380, preview);
    const gone = shown;
    shown = { scene, wheel };
    // The scene before leaves once this one covers it.
    setTimeout(
      () => {
        gone.wheel.root.unmount();
        gone.scene.remove();
      },
      reveal ? 300 : 0,
    );
    const begun = performance.now();
    for (const [at, key] of keys) {
      await sleep(at);
      await press(stage, key);
    }
    await sleep(hold - (performance.now() - begun));
  };
  for (const [i, id] of SLOW.entries())
    await step(
      id,
      i % 2 ? 'dark' : 'light',
      1100,
      'live',
      [
        [450, 'ArrowDown'],
        [190, 'ArrowDown'],
        [190, 'ArrowDown'],
      ],
      true,
    );
  for (const id of MEDIUM) await step(id, 'light', 450, 'still');
  for (const id of FAST) await step(id, 'dark', 340, 'still');
  return shown;
}

/** Six themes apply a slice one after another, then open again. */
async function apply(previous) {
  const scene = element('section', 'scene apply', reel);
  element('div', 'apply-title', scene).textContent = TEXT.motion;
  const cells = APPLY.map((id, i) => {
    const mode = i % 2 ? 'dark' : 'light';
    const look = looks(loaded.get(id), mode);
    const cell = element('div', 'apply-cell', scene);
    cell.style.background = look.desk;
    const stage = element('div', 'apply-wheel', cell);
    const name = element('div', 'apply-name', cell);
    name.textContent = loaded.get(id).name;
    Object.assign(name.style, { color: look.text, fontFamily: look.face });
    let round = 0;
    const wheel = mountWheel(stage, id, mode, 200, 'live', () => setTimeout(() => wheel.render(++round), 120));
    return { stage, wheel };
  });
  previous.wheel.root.unmount();
  previous.scene.remove();
  await sleep(800);
  // One after another: a slice pointed at and applied at once, before its ring could open.
  for (const [i, cell] of cells.entries()) {
    await press(cell.stage, ...Array(2 + (i % 3)).fill('ArrowDown'), 'Enter');
    await sleep(120);
  }
  await sleep(1900);
  return { scene, wheels: cells.map((cell) => cell.wheel) };
}

/** Every theme at rest, light and dark in turn, coming in one after another. */
async function all(previous) {
  const scene = element('section', 'scene all', reel);
  const grid = element('div', 'all-grid', scene);
  const wheels = THEMES.map((entry, i) => {
    const mode = (i + Math.floor(i / 9)) % 2 ? 'dark' : 'light';
    const cell = element('div', 'all-cell', grid);
    cell.style.background = looks(loaded.get(entry.id), mode).desk;
    cell.style.animationDelay = `${i * 22}ms`;
    return mountWheel(element('div', 'all-wheel', cell), entry.id, mode, 86, 'still');
  });
  const band = element(
    'div',
    'all-band',
    scene,
    `<strong>${TEXT.count(THEMES.length)}</strong><span>${TEXT.where}</span>`,
  );
  for (const wheel of previous.wheels) wheel.root.unmount();
  previous.scene.remove();
  await sleep(51 * 22 + 500);
  band.classList.add('is-on');
  await sleep(2400);
  return { scene, wheels };
}

async function end(previous) {
  const scene = element(
    'section',
    'scene end',
    reel,
    `<img src="/design/icons/app.svg" alt=""><h1>Kento</h1><div class="facts">${TEXT.end
      .map((fact) => `<span>${fact}</span>`)
      .join('')}</div><div class="url">github.com/MehmetBurakTaskaya/kento</div>`,
  );
  for (const wheel of previous.wheels) wheel.root.unmount();
  previous.scene.remove();
  await sleep(2600);
  return scene;
}

async function play() {
  await ready;
  const start = performance.now();
  const marks = [];
  const mark = (name) => marks.push([name, (performance.now() - start) / 1000]);
  mark('intro');
  const first = await intro();
  mark('parade');
  const last = await parade(first);
  mark('apply');
  const six = await apply(last);
  mark('all');
  const every = await all(six);
  mark('end');
  await end(every);
  mark('');
  return marks;
}

window.demo = { ready, play };
