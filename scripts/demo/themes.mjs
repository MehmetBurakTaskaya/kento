// SPDX-License-Identifier: MIT
// The themes reel of the README (scripts/record-demo.mjs --themes), in English and Turkish: every
// theme's wheel, drawn by the app's own Wheel in the app's page, in the language of the page; the
// theme names are the same in every language. A burst counts the themes and their sound sets; Kasa
// opens beside the pitch; six themes each open, sweep and apply a slice in their own way; more follow
// quickly, each name popping in under its wheel while the pitch fills in beside it; six apply at
// once; all of them stand side by side; and the end card asks for the download. The module takes over the page it is loaded into (`?surface=wheel`);
// `demo.play()` runs the reel once.
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import i18n from '/src/i18n/index.ts';
import { listThemes, loadTheme } from '/src/theme/registry.ts';
import { sample } from '/src/theme/shots.tsx';
import { Wheel } from '/src/wheel/Wheel.tsx';
import './themes.css';

const THEMES = listThemes();
const N = THEMES.length;
const LANG = i18n.language === 'tr' ? 'tr' : 'en';
const TEXT = {
  en: {
    kicker: 'Make it yours',
    burst: ['themes', `${N} sound sets`],
    headline: `${N} different<br>themes`,
    points: [
      'Pick the one you like',
      'Its own motion, its own sounds',
      'Light or dark, every one',
      'Switch any time, in one click',
    ],
    together: 'Same wheel, its own moves',
    band: `${N} themes. Which one is yours?`,
    where: 'Settings → Appearance → Theme',
    end: ['Free and open source', `${N} themes, ${N} sound sets`, 'Windows and macOS'],
    cta: 'Download it free',
  },
  tr: {
    kicker: 'Tarzını seç',
    burst: ['tema', `${N} ses seti`],
    headline: `${N} farklı<br>tema`,
    points: [
      'Hangisini seversen onu seç',
      'Kendi hareketi, kendi sesi',
      'Her biri açık ya da koyu',
      'İstediğin an, tek tıkla değiştir',
    ],
    together: 'Aynı çark, kendine has hareketler',
    band: `${N} tema. Seninki hangisi?`,
    where: 'Ayarlar → Görünüm → Tema',
    end: ['Ücretsiz ve açık kaynak', `${N} tema, ${N} ses seti`, 'Windows ve macOS'],
    cta: 'Ücretsiz indir',
  },
}[LANG];

/** Six themes that each open, sweep and apply a slice in turn, big: the most different moves, each
 *  named as it plays, with what it sounds like (a GIF is silent, so the sound is written). */
const ACTS = [
  [
    'ebru-a',
    { en: 'a splash of paint', tr: 'boya sıçraması' },
    { en: 'a drop of paint lands', tr: 'boya damlası şapırdar' },
  ],
  [
    'popart',
    { en: 'a comic-book boom', tr: 'çizgi roman patlaması' },
    { en: 'a cartoon BOOM', tr: 'çizgi film gibi BUM' },
  ],
  [
    'nar',
    { en: 'seeds spill out', tr: 'taneler saçılır' },
    { en: 'seeds patter and roll', tr: 'taneler tıkır tıkır yuvarlanır' },
  ],
  ['piksel', { en: 'pixels fly', tr: 'pikseller uçuşur' }, { en: 'little chiptune bleeps', tr: 'küçük 8-bit bipler' }],
  ['memphis', { en: 'confetti', tr: 'konfeti yağar' }, { en: 'a party popper', tr: 'konfeti patlangacı' }],
  ['simya-a', { en: 'a glow of gold', tr: 'altın bir ışık' }, { en: 'a chime of gold', tr: 'altın bir çınlama' }],
];
/** A small loudspeaker for the sound line under each act. */
const SPEAKER =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
/** Then more, at rest and quicker: light, then a theme a beat in dark, never more than three a
 *  second. Neighbours differ, so each change reads. The rest are in the line-up at the end. */
const LIGHT = ['portakal', 'iznik', 'vitray', 'baklava', 'kilim', 'hologram', 'pusula', 'karpuz', 'lolipop', 'origami'];
const DARK = [
  'aycicegi',
  'kartanesi',
  'balpetegi',
  'sema',
  'dart',
  'radar',
  'kronograf',
  'bauhaus',
  'blueprint',
  'kakma',
  'astro-b',
  'karatahta',
];
/** Six more apply effects side by side, at once. */
const APPLY = ['steel', 'telefon', 'ebru-b', 'pikap', 'pizza', 'artdeco'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const element = (tag, className, parent, html = '') => {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  parent?.appendChild(node);
  return node;
};
const CHECK =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

const reel = element('div', 'reel', document.body);
const tools = () => sample('tools8');

/** The pitch beside the wheel: it stays through Kasa and the parade, in each theme's own text
 *  colour, and its points come in one by one. */
const pitch = element(
  'div',
  'pitch',
  reel,
  `<p class="kicker">${TEXT.kicker}</p><h1>${TEXT.headline}</h1><ul>${TEXT.points
    .map((point) => `<li>${CHECK}<span>${point}</span></li>`)
    .join('')}</ul>`,
);
// The pitch above is the template: each theme's scene draws its own copy in its own colours, so a
// scene uncovered from the middle of its wheel uncovers its words with it.
pitch.style.display = 'none';
let shownPitch = null;

/** The pitch's first appearance, and one more of its points, on the template and on screen. */
function pitchOn() {
  pitch.classList.add('is-on');
  shownPitch?.classList.add('is-on');
}
function point(i) {
  pitch.querySelectorAll('li')[i].classList.add('is-on');
  shownPitch?.querySelectorAll('li')[i].classList.add('is-on');
}

/** The theme's desk and text colours. The names keep the reel's own face: the wheels show the
 *  themes' faces, and one face reads more easily through 51 changes. */
function looks(theme, mode) {
  const tokens = theme.tokens[mode];
  return {
    desk: theme.wheel?.concept.palette[mode].desk ?? tokens.bg,
    text: tokens.text,
    muted: tokens['text-muted'],
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
  // Every face the wheels and the words use, before the first frame.
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

/** A theme on its own desk: its wheel on the left, its name popping in under it, the pitch beside it
 *  in its colours. */
function showTheme(id, mode, preview, reveal = false) {
  const theme = loaded.get(id);
  const look = looks(theme, mode);
  const scene = element('section', `scene dial${reveal ? ' is-revealed' : ''}`, reel);
  scene.style.background = look.desk;
  const stage = element('div', 'dial-wheel', scene);
  const name = element('div', 'dial-name', scene);
  name.textContent = theme.name;
  name.style.color = look.text;
  const local = pitch.cloneNode(true);
  local.style.display = '';
  local.style.color = look.text;
  scene.append(local);
  shownPitch = local;
  const wheel = mountWheel(stage, id, mode, 380, preview);
  return { scene, stage, wheel };
}

/** Puts a theme on in place of the one shown; the one before leaves once this one covers it. */
function next(shown, id, mode, preview, reveal = false) {
  const now = showTheme(id, mode, preview, reveal);
  setTimeout(
    () => {
      shown.wheel.root.unmount();
      shown.scene.remove();
    },
    reveal ? 300 : 0,
  );
  return now;
}

/** A burst before the first wheel: the count springs up to the number of themes while a dot of
 *  each theme's colour flies out round it, then the sound sets ring in under it. */
async function burst() {
  const scene = element('section', 'scene burst', reel);
  const count = element('div', 'burst-count', scene);
  count.textContent = '1';
  element('div', 'burst-word', scene).textContent = TEXT.burst[0];
  const heard = element('div', 'burst-sounds', scene, SPEAKER);
  element('span', '', heard).textContent = TEXT.burst[1];
  THEMES.forEach((entry, i) => {
    const angle = (i / N) * Math.PI * 2;
    const ring = i % 2 ? 300 : 360;
    const dot = element('span', 'burst-dot', scene);
    dot.style.background = loaded.get(entry.id).tokens.light.accent;
    dot.style.setProperty('--x', `${Math.round(Math.cos(angle) * ring)}px`);
    dot.style.setProperty('--y', `${Math.round(Math.sin(angle) * ring * 0.62)}px`);
    dot.style.animationDelay = `${120 + i * 14}ms`;
  });
  const start = performance.now();
  while (performance.now() - start < 950) {
    const t = Math.min(1, (performance.now() - start) / 950);
    count.textContent = String(Math.max(1, Math.round((1 - (1 - t) ** 3) * N)));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  count.textContent = String(N);
  heard.classList.add('is-on');
  await sleep(1700);
  return scene;
}

async function intro(before) {
  const shown = showTheme('steel', 'light', 'live');
  before.remove();
  await sleep(450);
  pitchOn();
  // The dial goes round without resting long enough on a slice to open its ring.
  await sleep(500);
  for (let i = 0; i < 6; i++) {
    await press(shown.stage, 'ArrowDown');
    if (i === 2) point(0);
    await sleep(270);
  }
  await sleep(250);
  return shown;
}

/** Six themes, each uncovered from the middle of its wheel: it opens, sweeps two slices and applies
 *  the next with its own effect. */
async function acts(previous) {
  let shown = previous;
  point(1);
  for (const [i, [id, move, sound]] of ACTS.entries()) {
    const mode = i % 2 ? 'dark' : 'light';
    shown = next(shown, id, mode, 'live', true);
    await sleep(520);
    for (let k = 0; k < 2; k++) {
      await press(shown.stage, 'ArrowDown');
      await sleep(170);
    }
    await press(shown.stage, 'ArrowDown', 'Enter');
    // The wheel gives a little jump, and what it does is named under it.
    shown.stage.classList.add('is-applied');
    const named = element('div', 'dial-move', shown.scene);
    named.textContent = move[LANG];
    named.style.color = looks(loaded.get(id), mode).muted;
    const heard = element('div', 'dial-sound', shown.scene, SPEAKER);
    element('span', '', heard).textContent = sound[LANG];
    heard.style.color = looks(loaded.get(id), mode).muted;
    await sleep((loaded.get(id).wheel?.timings.apply(false) ?? 640) + 260);
  }
  return shown;
}

/** More themes at rest, quicker: light, then a theme a beat in dark. */
async function parade(previous) {
  let shown = previous;
  point(2);
  for (const id of LIGHT) {
    shown = next(shown, id, 'light', 'still');
    await sleep(420);
  }
  point(3);
  for (const id of DARK) {
    shown = next(shown, id, 'dark', 'still');
    await sleep(340);
  }
  return shown;
}

/** Six themes apply a slice one after another, then open again. */
async function apply(previous) {
  const scene = element('section', 'scene apply', reel);
  element('div', 'apply-title', scene).textContent = TEXT.together;
  const cells = APPLY.map((id, i) => {
    const mode = i % 2 ? 'dark' : 'light';
    const look = looks(loaded.get(id), mode);
    const cell = element('div', 'apply-cell', scene);
    cell.style.background = look.desk;
    const stage = element('div', 'apply-wheel', cell);
    const name = element('div', 'apply-name', cell);
    name.textContent = loaded.get(id).name;
    name.style.color = look.text;
    let round = 0;
    const wheel = mountWheel(stage, id, mode, 200, 'live', () => setTimeout(() => wheel.render(++round), 120));
    return { stage, wheel };
  });
  shownPitch = null;
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
    // The first cells are already on their way when the grid cuts in, so it never opens empty.
    cell.style.animationDelay = `${i * 22 - 140}ms`;
    return mountWheel(element('div', 'all-wheel', cell), entry.id, mode, 86, 'still');
  });
  const band = element('div', 'all-band', scene, `<strong>${TEXT.band}</strong><span>${TEXT.where}</span>`);
  for (const wheel of previous.wheels) wheel.root.unmount();
  previous.scene.remove();
  await sleep(N * 22 + 500);
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
      .join('')}</div><div class="cta">${TEXT.cta}</div><div class="url">github.com/MehmetBurakTaskaya/kento</div>`,
  );
  for (const wheel of previous.wheels) wheel.root.unmount();
  previous.scene.remove();
  await sleep(2800);
  return scene;
}

async function play() {
  await ready;
  const start = performance.now();
  const marks = [];
  const mark = (name) => marks.push([name, (performance.now() - start) / 1000]);
  mark('burst');
  const opening = await burst();
  mark('intro');
  const first = await intro(opening);
  mark('acts');
  const moved = await acts(first);
  mark('parade');
  const last = await parade(moved);
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
