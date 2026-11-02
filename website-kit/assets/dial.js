// SPDX-License-Identifier: MIT
// A picture of Kento's wheel as one SVG, for the website kit: the hero of index.html, the social
// cards (scripts/social-cards.mjs) and the wheel of the playground (playground/playground.js). The
// geometry and the colours follow design/DESIGN.md and src/wheel/geometry.ts (a 400-unit drawing,
// angles in degrees from twelve o'clock, clockwise). It is drawn with plain shapes and gradients, no
// filters, no style attributes and no fonts of its own, so it works inline in a page under a strict
// Content-Security-Policy and as a standalone file.

const C = 200;
/** Radii in the 400-unit drawing, outside in. */
export const R = {
  OUT: 197,
  RING: 187,
  KNURL: 184,
  SCALE: 181,
  FACE: 164,
  CHAPTER: 141,
  WINDOW: 66,
  COLLAR: 62,
  HUB: 56,
  LABEL: 103.5,
  NUMERAL: 152.5,
  DIAL_NUMBER: 169.3,
  KNOB: 74,
};
const BOLT = { width: 25, length: 25, tip: 195, out: 18 };
const BOLT_ANGLES = [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5];
const SPOKE_ANGLES = [22.5, 112.5, 202.5, 292.5];
const FONT = "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

/** The light steel of design/DESIGN.md, section 4. `bezel` is the conic `bezel-ring` as [angle, colour]. */
export const LIGHT = {
  face: '#f7f8f9',
  hover: '#dbe2ec',
  selected: '#28499c',
  text: '#111317',
  textSelected: '#ffffff',
  textMuted: '#4f5661',
  num: '#2b3036',
  line: '#d0d5db',
  tick: '#22262b',
  index: '#2a4ea6',
  onIndex: '#ffffff',
  indexIdle: '#646b75',
  pointerEdge: 'rgba(12, 22, 48, 0.55)',
  chapterHover: '#e9edf3',
  enamelHi: '#ffffff',
  enamelLo: '#e9ecef',
  blueHi: '#3d66c9',
  blueLo: '#1b3478',
  shadow: 'rgba(26, 34, 48, 0.3)',
  dialTick: 'rgba(20, 24, 30, 0.62)',
  dialNum: '#23282e',
  knurlDark: 'rgba(26, 31, 38, 0.46)',
  knurlLight: 'rgba(255, 255, 255, 0.72)',
  ringHi: '#fdfdfe',
  ringMid: '#cdd2d8',
  ringLo: '#848b94',
  ringOpacity: 0.9,
  notch: '#1d2126',
  channel: 'rgba(30, 36, 44, 0.38)',
  edgeDark: 'rgba(28, 34, 42, 0.5)',
  faceShade: 'rgba(28, 34, 42, 0.1)',
  steelHi: '#ffffff',
  steelMid: '#c3c8ce',
  steelLo: '#7c838c',
  hubFace: '#f3f5f7',
  dome: 0.85,
  spoke: '#9ba2aa',
  spokeEdge: 'rgba(40, 46, 54, 0.55)',
  spokeHi: 'rgba(255, 255, 255, 0.85)',
  knobHi: '#ffffff',
  knobLo: '#8a919a',
  boltHi: '#ffffff',
  boltMid: '#c5cad0',
  boltLo: '#80878f',
  boltEdge: '#596069',
  capHi: '#ffffff',
  capLo: '#c9ced4',
  boltLine: 'rgba(30, 36, 44, 0.6)',
  boltShadow: 'rgba(18, 26, 38, 0.38)',
  bezel: [
    [0, '#c7ccd2'],
    [35, '#a8aeb6'],
    [70, '#91979f'],
    [108, '#b4bac1'],
    [135, '#eef1f3'],
    [165, '#c3c8ce'],
    [205, '#a0a6ae'],
    [245, '#8a9098'],
    [282, '#aeb4bb'],
    [315, '#f7f8fa'],
    [345, '#d6dade'],
    [360, '#c7ccd2'],
  ],
};

/** The smoked steel of the dark theme. */
export const DARK = {
  face: '#1d2024',
  hover: '#2d333b',
  selected: '#3a5fc0',
  text: '#f0f2f5',
  textSelected: '#ffffff',
  textMuted: '#b0b8c3',
  num: '#c9cfd7',
  line: '#30353c',
  tick: '#d3d8de',
  index: '#8fb0ff',
  onIndex: '#0a1530',
  indexIdle: '#8a929c',
  pointerEdge: 'rgba(0, 0, 0, 0.55)',
  chapterHover: '#272c33',
  enamelHi: '#2a2e34',
  enamelLo: '#17191c',
  blueHi: '#5a7fdc',
  blueLo: '#28448f',
  shadow: 'rgba(0, 0, 0, 0.62)',
  dialTick: 'rgba(232, 237, 242, 0.62)',
  dialNum: '#e3e8ed',
  knurlDark: 'rgba(8, 10, 12, 0.55)',
  knurlLight: 'rgba(255, 255, 255, 0.3)',
  ringHi: '#b9c0c7',
  ringMid: '#727980',
  ringLo: '#363b41',
  ringOpacity: 0.92,
  notch: '#0b0d0f',
  channel: 'rgba(0, 0, 0, 0.5)',
  edgeDark: 'rgba(0, 0, 0, 0.6)',
  faceShade: 'rgba(0, 0, 0, 0.35)',
  steelHi: '#c6ccd3',
  steelMid: '#6b727b',
  steelLo: '#2f343a',
  hubFace: '#1b1e22',
  dome: 0.1,
  spoke: '#7a8189',
  spokeEdge: 'rgba(0, 0, 0, 0.6)',
  spokeHi: 'rgba(255, 255, 255, 0.45)',
  knobHi: '#d3d8dd',
  knobLo: '#4a5158',
  boltHi: '#eef1f4',
  boltMid: '#a1a8b0',
  boltLo: '#5a6169',
  boltEdge: '#30363c',
  capHi: '#f4f6f8',
  capLo: '#9ea5ad',
  boltLine: 'rgba(0, 0, 0, 0.65)',
  boltShadow: 'rgba(0, 0, 0, 0.6)',
  bezel: [
    [0, '#6b7179'],
    [35, '#555b63'],
    [70, '#454b53'],
    [108, '#5d646c'],
    [135, '#9ba2aa'],
    [165, '#676e76'],
    [205, '#4d535b'],
    [245, '#3f454c'],
    [282, '#585e66'],
    [315, '#a9b0b8'],
    [345, '#7c838b'],
    [360, '#6b7179'],
  ],
};

const rad = (deg) => (deg * Math.PI) / 180;
const fx = (n) => String(Math.round(n * 100) / 100);
const polar = (r, deg) => [C + r * Math.sin(rad(deg)), C - r * Math.cos(rad(deg))];
const point = (r, deg) => polar(r, deg).map(fx).join(' ');
const esc = (text) =>
  String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function ringPath(r0, r1) {
  const ring = (r, sweep) => `M${C} ${C - r}a${r} ${r} 0 1 ${sweep} 0 ${2 * r}a${r} ${r} 0 1 ${sweep} 0 ${-2 * r}Z`;
  return r0 > 0 ? ring(r1, 1) + ring(r0, 0) : ring(r1, 1);
}

function sectorPath(r0, r1, a0, a1) {
  const big = a1 - a0 > 180 ? 1 : 0;
  return (
    `M${point(r1, a0)}A${fx(r1)} ${fx(r1)} 0 ${big} 1 ${point(r1, a1)}` +
    `L${point(r0, a1)}A${fx(r0)} ${fx(r0)} 0 ${big} 0 ${point(r0, a0)}Z`
  );
}

const arcPath = (r, a0, a1) => `M${point(r, a0)}A${fx(r)} ${fx(r)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${point(r, a1)}`;
const rayPath = (r0, r1, deg) => `M${point(r0, deg)}L${point(r1, deg)}`;

/** A colour between two hex colours. */
function mix(a, b, t) {
  const ch = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The colour of the conic brushing at an angle. */
function bezelAt(stops, deg) {
  for (let i = 1; i < stops.length; i++) {
    const [a1, c1] = stops[i];
    const [a0, c0] = stops[i - 1];
    if (deg <= a1) return mix(c0, c1, (deg - a0) / (a1 - a0));
  }
  return stops[stops.length - 1][1];
}

/**
 * The slices of a ring of `count`, clockwise from twelve. `offset` turns the whole ring: slice 1 sits
 * there, as a ring of choices does when it unfolds from the slice that opened it.
 */
export function layout(count, offset = 0) {
  const step = 360 / count;
  return Array.from({ length: count }, (_, index) => {
    const mid = offset + index * step;
    return { index, mid, start: mid - step / 2, end: mid + step / 2, step };
  });
}

/** Where the dial's index points: over the slice in use, or parked on the boundary before slice 1. */
export function dialAngle(count, slice, offset = 0) {
  return offset + (slice === null || slice === undefined ? -180 / count : (slice * 360) / count);
}

/** The slice under a point of the 400-unit drawing, or null outside the slices and the steel. */
export function sliceAt(x, y, count, offset = 0) {
  const r = Math.hypot(x - C, y - C);
  if (r < R.WINDOW || r > R.OUT) return null;
  const step = 360 / count;
  const angle = (Math.atan2(x - C, -(y - C)) * 180) / Math.PI - offset;
  return Math.floor((((angle + step / 2) % 360) + 360) % 360 / step) % count;
}

/** An angle reached from `current` by the shortest turn, counting on past 360 so that a CSS
 *  transition never spins the long way round (src/wheel/geometry.ts, turnTo). */
export function turnTo(current, target) {
  return current + ((((target - current + 180) % 360) + 360) % 360) - 180;
}

/** A label for a slice of words, such as a tool or a choice: one line, or two split at the space
 *  nearest the middle when it is long. */
function wordLines(text) {
  const words = String(text).split(' ');
  if (String(text).length <= 11 || words.length < 2) return [String(text)];
  let best = 1;
  let gap = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < gap) {
      gap = d;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

/**
 * The wheel as SVG markup.
 * @param {object} o
 * @param {{label: string, small?: boolean, choices?: boolean, word?: boolean, icon?: string}[]} o.slices
 *   up to eight, clockwise from twelve. A format is drawn large ("PNG"); `word` draws a tool or a choice
 *   ("High quality") smaller, on two lines when it is long, under `icon` (the path of a 24-unit stroke icon)
 * @param {string} o.title the hub's title (drawn in capitals)
 * @param {string} [o.subtitle] the hub's second line, such as the file name
 * @param {string} [o.trail] inside a ring of choices, the rings above it over the title ("Convert ›")
 * @param {string} [o.back] inside a ring of choices, the hub's way back ("Back")
 * @param {number} [o.offset] where slice 1 sits, in degrees from twelve (see `layout`)
 * @param {number | null} [o.hover] the slice under the pointer
 * @param {number | null} [o.selected] the applied slice: blue, with the bolts thrown and the handle turned
 * @param {typeof LIGHT} [o.palette]
 * @param {string} [o.id] a prefix for the gradient ids, unique in the page
 * @param {string} [o.attrs] more attributes for the <svg> element
 * @param {boolean} [o.cast] draws the shadow on the desk (for a standalone picture)
 */
export function dialSvg({
  slices,
  title,
  subtitle = '',
  trail = '',
  back = '',
  offset = 0,
  hover = null,
  selected = null,
  palette = LIGHT,
  id = 'kw',
  attrs = '',
  cast = false,
}) {
  const p = palette;
  const count = slices.length;
  const geo = layout(count, offset);
  const applied = selected !== null && selected !== undefined;
  const turn = dialAngle(count, applied ? selected : hover, offset);
  const out = [];
  const push = (s) => out.push(s);

  push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -30 460 460" font-family="${esc(FONT)}"${offset ? ` data-offset="${fx(offset)}"` : ''} ${attrs}>`,
  );
  push('<defs>');
  push(
    `<linearGradient id="${id}-bolt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.boltLo}"/><stop offset="0.3" stop-color="${p.boltHi}"/><stop offset="0.55" stop-color="${p.boltMid}"/><stop offset="0.86" stop-color="${p.boltLo}"/><stop offset="1" stop-color="${p.boltEdge}"/></linearGradient>`,
  );
  push(
    `<linearGradient id="${id}-cap" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.capLo}"/><stop offset="0.35" stop-color="${p.capHi}"/><stop offset="1" stop-color="${p.capLo}"/></linearGradient>`,
  );
  push(
    `<linearGradient id="${id}-ring" gradientUnits="userSpaceOnUse" x1="60" y1="30" x2="340" y2="370"><stop offset="0" stop-color="${p.ringHi}"/><stop offset="0.45" stop-color="${p.ringMid}"/><stop offset="1" stop-color="${p.ringLo}"/></linearGradient>`,
  );
  push(
    `<radialGradient id="${id}-enamel" gradientUnits="userSpaceOnUse" cx="152" cy="108" r="290"><stop offset="0" stop-color="${p.enamelHi}"/><stop offset="0.6" stop-color="${p.face}"/><stop offset="1" stop-color="${p.enamelLo}"/></radialGradient>`,
  );
  push(
    `<linearGradient id="${id}-blue" gradientUnits="userSpaceOnUse" x1="80" y1="50" x2="320" y2="350"><stop offset="0" stop-color="${p.blueHi}"/><stop offset="0.5" stop-color="${p.selected}"/><stop offset="1" stop-color="${p.blueLo}"/></linearGradient>`,
  );
  push(
    `<radialGradient id="${id}-knob" cx="0.36" cy="0.32" r="0.75"><stop offset="0" stop-color="${p.knobHi}"/><stop offset="1" stop-color="${p.knobLo}"/></radialGradient>`,
  );
  push(
    `<linearGradient id="${id}-collar" gradientUnits="userSpaceOnUse" x1="150" y1="135" x2="250" y2="265"><stop offset="0" stop-color="${p.steelHi}"/><stop offset="0.45" stop-color="${p.steelMid}"/><stop offset="1" stop-color="${p.steelLo}"/></linearGradient>`,
  );
  push(
    `<radialGradient id="${id}-dome" gradientUnits="userSpaceOnUse" cx="186" cy="172" r="72"><stop offset="0" stop-color="#fff" stop-opacity="${p.dome}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
  );
  if (cast) {
    push(
      `<radialGradient id="${id}-cast" gradientUnits="userSpaceOnUse" cx="200" cy="214" r="226"><stop offset="0.82" stop-color="${p.shadow}"/><stop offset="1" stop-color="${p.shadow}" stop-opacity="0"/></radialGradient>`,
    );
  }
  push('</defs>');

  if (cast) push(`<circle cx="${C}" cy="${C + 14}" r="226" fill="url(#${id}-cast)"/>`);

  // The bolts sit under the steel; applying a slice throws them out past the ring.
  push(`<g class="kw-bolts">`);
  for (const a of BOLT_ANGLES) {
    const dx = 1.5 * Math.sin(rad(a));
    const dy = 1.5 * Math.cos(rad(a));
    const x = C - BOLT.width / 2;
    const y = C - BOLT.tip;
    push(`<g transform="rotate(${a} ${C} ${C})"><g class="kw-bolt"${applied ? ` transform="translate(0 ${-BOLT.out})"` : ''}>`);
    push(
      `<rect x="${fx(x + dx)}" y="${fx(y + dy + 0.6)}" width="${BOLT.width}" height="${BOLT.length}" rx="2" fill="${p.boltShadow}"/>`,
    );
    push(`<rect x="${x}" y="${y}" width="${BOLT.width}" height="${BOLT.length}" rx="2" fill="url(#${id}-bolt)"/>`);
    push(
      `<rect x="${fx(x + 0.6)}" y="${fx(y + 0.6)}" width="${BOLT.width - 1.2}" height="3.8" rx="1.4" fill="url(#${id}-cap)"/>`,
    );
    push(
      `<path d="M${fx(x + 0.6)} ${fx(y + 4.6)}H${fx(x + BOLT.width - 0.6)}" stroke="${p.boltLine}" stroke-width="0.7" stroke-opacity="0.6"/>`,
    );
    push(
      `<path d="M${fx(x + 7.2)} ${fx(y + 6.2)}V${fx(y + BOLT.length - 2)}" stroke="#fff" stroke-width="1.4" stroke-opacity="0.55" stroke-linecap="round"/>`,
    );
    push(
      `<rect x="${x}" y="${y}" width="${BOLT.width}" height="${BOLT.length}" rx="2" fill="none" stroke="${p.boltLine}" stroke-width="0.8"/>`,
    );
    push('</g></g>');
  }
  push('</g>');

  // The brushed steel under the ring and the dial: the conic brushing, drawn as thin wedges.
  const wedges = 120;
  for (let k = 0; k < wedges; k++) {
    const a0 = (k * 360) / wedges;
    const a1 = ((k + 1) * 360) / wedges + 0.35;
    push(`<path d="${sectorPath(R.FACE - 2, R.OUT, a0, a1)}" fill="${bezelAt(p.bezel, a0 + 180 / wedges)}"/>`);
  }
  for (let r = R.FACE + 2; r < R.OUT; r += 2.4) {
    push(`<circle cx="${C}" cy="${C}" r="${fx(r)}" fill="none" stroke="#fff" stroke-opacity="0.07" stroke-width="0.8"/>`);
  }

  // The fixed ring with the index notch at twelve and a channel for each bolt.
  push(`<path d="${ringPath(R.RING, R.OUT)}" fill="url(#${id}-ring)" fill-rule="evenodd" opacity="${p.ringOpacity}"/>`);
  push(`<circle cx="${C}" cy="${C}" r="${R.RING + 1.3}" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="0.8"/>`);
  push(`<circle cx="${C}" cy="${C}" r="${R.RING + 0.4}" fill="none" stroke="${p.edgeDark}" stroke-width="1.1"/>`);
  push(`<circle cx="${C}" cy="${C}" r="${R.OUT - 0.5}" fill="none" stroke="${p.edgeDark}" stroke-width="1"/>`);
  push(`<path d="M${C - 4.6} ${C - 195.2}H${C + 4.6}L${C} ${C - 187.4}Z" fill="${p.notch}"/>`);
  for (const a of BOLT_ANGLES) {
    push(
      `<g transform="rotate(${a} ${C} ${C})"><rect x="${C - BOLT.width / 2 - 1}" y="${fx(C - R.OUT - 0.2)}" width="${BOLT.width + 2}" height="4.6" rx="1.2" fill="${p.channel}"/><path d="M${fx(C - BOLT.width / 2 - 0.6)} ${fx(C - R.OUT + 4.6)}H${fx(C + BOLT.width / 2 + 0.6)}" stroke="#fff" stroke-opacity="0.35" stroke-width="0.7"/></g>`,
    );
  }

  // The turning dial: a 100-step scale numbered every ten and the knurled grip, with its index.
  let fine = '';
  let major = '';
  for (let k = 1; k < 100; k++) {
    const a = k * 3.6;
    if (k % 10 === 0) major += rayPath(R.SCALE, 174.4, a);
    else if (k % 5 === 0) major += rayPath(R.SCALE, 176.2, a);
    else fine += rayPath(R.SCALE, 177.6, a);
  }
  const ridge = (2 * Math.PI * R.KNURL) / 168;
  // An empty circle keeps each turning group's box centred on the hub, so a page can turn it with CSS
  // (transform-box: fill-box; transform-origin: center).
  const anchor = (r) => `<circle cx="${C}" cy="${C}" r="${r}" fill="none"/>`;
  push(`<g class="kw-dial" transform="rotate(${fx(turn)} ${C} ${C})">${anchor(190)}`);
  push(`<circle cx="${C}" cy="${C}" r="${R.FACE + 0.5}" fill="none" stroke="${p.edgeDark}" stroke-width="1.1"/>`);
  push(`<path d="${fine}" stroke="${p.dialTick}" stroke-width="0.7"/>`);
  push(`<path d="${major}" stroke="${p.dialTick}" stroke-width="1.2"/>`);
  for (let i = 1; i < 10; i++) {
    const a = i * 36;
    const [x, y] = polar(R.DIAL_NUMBER, a);
    push(
      `<text x="${fx(x)}" y="${fx(y)}" transform="rotate(${a} ${fx(x)} ${fx(y)})" fill="${p.dialNum}" font-size="7.8" font-weight="600" text-anchor="middle" dominant-baseline="central">${i * 10}</text>`,
    );
  }
  push(`<circle cx="${C}" cy="${C}" r="${R.SCALE + 0.4}" fill="none" stroke="${p.edgeDark}" stroke-width="0.6"/>`);
  push(
    `<circle cx="${C}" cy="${C}" r="${R.KNURL}" fill="none" stroke="${p.knurlDark}" stroke-width="6" stroke-dasharray="${fx(ridge * 0.44)} ${fx(ridge * 0.56)}"/>`,
  );
  push(
    `<circle cx="${C}" cy="${C}" r="${R.KNURL}" fill="none" stroke="${p.knurlLight}" stroke-width="6" stroke-dasharray="${fx(ridge * 0.16)} ${fx(ridge * 0.84)}" stroke-dashoffset="${fx(-ridge * 0.48)}"/>`,
  );
  const active = applied || (hover !== null && hover !== undefined);
  push(
    `<path class="kw-pointer" d="M${C - 4.7} ${C - 186.5}H${C + 4.7}V${C - 170.5}L${C} ${C - 161.8}L${C - 4.7} ${C - 170.5}Z" fill="${active ? p.index : p.indexIdle}" stroke="${p.pointerEdge}" stroke-width="0.7" stroke-linejoin="round"/>`,
  );
  push(`<path d="M${C - 3.2} ${C - 185}H${C - 0.5}V${C - 164.2}L${C - 3.2} ${C - 170.2}Z" fill="#fff" fill-opacity="0.32"/>`);
  push('</g>');

  // The enamel face with the slices, the chapter ring and its numerals.
  push(`<circle cx="${C}" cy="${C}" r="${R.FACE}" fill="url(#${id}-enamel)"/>`);
  geo.forEach((g, i) => {
    const isHover = i === hover && !applied;
    const isSelected = i === selected;
    push(`<g class="kw-slice" data-slice="${i}">`);
    push(
      `<path class="kw-cell" d="${sectorPath(R.CHAPTER, R.FACE, g.start, g.end)}" fill="${p.chapterHover}" opacity="${isHover || isSelected ? 1 : 0}"/>`,
    );
    push(
      `<path class="kw-window" d="${sectorPath(R.WINDOW, R.CHAPTER, g.start, g.end)}" fill="${p.hover}" opacity="${isHover ? 1 : 0}"/>`,
    );
    push(
      `<path class="kw-inlay" d="${sectorPath(R.WINDOW - 3, R.CHAPTER, g.start, g.end)}" fill="url(#${id}-blue)" opacity="${isSelected ? 1 : 0}"/>`,
    );
    push(
      `<path class="kw-keyline" d="${arcPath(R.CHAPTER - 1.7, g.start + 0.9, g.end - 0.9)}" fill="none" stroke="${p.index}" stroke-width="2.6" opacity="${isHover ? 1 : 0}"/>`,
    );
    push('</g>');
  });

  let windows = '';
  let majorFace = '';
  let minorFace = '';
  for (const { start, step } of geo) {
    windows += rayPath(R.WINDOW, R.CHAPTER, start);
    majorFace += rayPath(R.CHAPTER, R.FACE, start);
    for (let k = 1; k < 10; k++) if (k < 4 || k > 6) minorFace += rayPath(R.FACE - 5, R.FACE, start + (k * step) / 10);
  }
  push(`<path d="${windows}" stroke="${p.line}" stroke-width="1"/>`);
  push(`<circle cx="${C}" cy="${C}" r="${R.CHAPTER}" fill="none" stroke="${p.tick}" stroke-width="0.7"/>`);
  push(`<path d="${minorFace}" stroke="${p.tick}" stroke-width="0.8"/>`);
  push(`<path d="${majorFace}" stroke="${p.tick}" stroke-width="1.5"/>`);
  push(`<circle cx="${C}" cy="${C}" r="${R.FACE - 1.5}" fill="none" stroke="${p.faceShade}" stroke-width="3"/>`);

  geo.forEach((g, i) => {
    const slice = slices[i];
    const isHover = i === hover && !applied;
    const isSelected = i === selected;
    const [nx, ny] = polar(R.NUMERAL, g.mid);
    const [lx, ly] = polar(R.LABEL, g.mid);
    const textFill = isSelected ? p.textSelected : p.text;
    push(`<g class="kw-marks" data-slice="${i}">`);
    push(`<circle class="kw-latch" cx="${fx(nx)}" cy="${fx(ny)}" r="8.4" fill="${p.index}" opacity="${isSelected ? 1 : 0}"/>`);
    push(
      `<text class="kw-numeral" x="${fx(nx)}" y="${fx(ny)}" fill="${isSelected ? p.onIndex : isHover ? p.index : p.num}" font-size="10.5" font-weight="${isSelected || isHover ? 700 : 600}" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`,
    );
    if (slice.choices) {
      const at = g.mid + Math.min(16, Math.max(6, g.step * 0.36));
      const mark = (r, a) => polar(r, a).map(fx).join(' ');
      push(
        `<path class="kw-ringmark" d="M${mark(R.CHAPTER - 4.5, at)}L${mark(R.CHAPTER - 10.5, at - 1.5)}L${mark(R.CHAPTER - 10.5, at + 1.5)}Z" fill="${isSelected ? p.textSelected : isHover ? p.index : p.num}" opacity="${isHover || isSelected ? 1 : 0.75}"/>`,
      );
    }
    if (slice.small) {
      // A slice such as More…: three dots over a smaller label.
      push(
        `<text class="kw-label" x="${fx(lx)}" y="${fx(ly - 9)}" fill="${textFill}" font-size="15" font-weight="700" text-anchor="middle" dominant-baseline="central">···</text>`,
      );
      push(
        `<text class="kw-label" x="${fx(lx)}" y="${fx(ly + 8)}" fill="${textFill}" font-size="12.8" font-weight="600" text-anchor="middle" dominant-baseline="central">${esc(slice.label)}</text>`,
      );
    } else if (slice.word || slice.icon) {
      // A tool or a choice: a 22-unit icon over a 12.8 label of one or two lines, centred as a block.
      const lines = wordLines(slice.label);
      const height = (slice.icon ? 26 : 0) + lines.length * 14.5;
      let y = ly - height / 2;
      if (slice.icon) {
        push(
          `<path class="kw-icon" d="${esc(slice.icon)}" transform="translate(${fx(lx - 11)} ${fx(y)}) scale(${fx(22 / 24)})" fill="none" stroke="${textFill}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
        y += 26;
      }
      for (const line of lines) {
        push(
          `<text class="kw-label" x="${fx(lx)}" y="${fx(y + 7.25)}" fill="${textFill}" font-size="12.8" font-weight="600" text-anchor="middle" dominant-baseline="central">${esc(line)}</text>`,
        );
        y += 14.5;
      }
    } else {
      push(
        `<text class="kw-label" x="${fx(lx)}" y="${fx(ly)}" fill="${textFill}" font-size="20.5" font-weight="600" letter-spacing="0.8" text-anchor="middle" dominant-baseline="central">${esc(slice.label)}</text>`,
      );
    }
    push('</g>');
  });

  // The vault handle round the hub cap; it turns an eighth when a slice is applied.
  const spokes = SPOKE_ANGLES.map((a) => rayPath(R.HUB, R.KNOB, a)).join('');
  push(`<g class="kw-handle" transform="rotate(${applied ? 45 : 0} ${C} ${C})">${anchor(84)}`);
  push(`<path d="${spokes}" stroke="${p.spokeEdge}" stroke-width="7.6" stroke-linecap="round"/>`);
  push(`<path d="${spokes}" stroke="${p.spoke}" stroke-width="6.2" stroke-linecap="round"/>`);
  push(`<path d="${spokes}" stroke="${p.spokeHi}" stroke-width="1.6" stroke-linecap="round"/>`);
  for (const a of SPOKE_ANGLES) {
    const [x, y] = polar(R.KNOB, a);
    push(
      `<circle cx="${fx(x)}" cy="${fx(y)}" r="6.2" fill="url(#${id}-knob)" stroke="${p.spokeEdge}" stroke-width="0.8"/>`,
    );
  }
  push('</g>');

  // The hub cap in its steel collar, with the wheel's title and the file name.
  push(`<path d="${ringPath(R.HUB, R.COLLAR)}" fill="url(#${id}-collar)" fill-rule="evenodd"/>`);
  push(`<circle cx="${C}" cy="${C}" r="${R.COLLAR - 0.4}" fill="none" stroke="${p.edgeDark}" stroke-width="0.9"/>`);
  push(`<circle cx="${C}" cy="${C}" r="${R.HUB}" fill="${p.hubFace}"/>`);
  push(`<circle cx="${C}" cy="${C}" r="${R.HUB}" fill="url(#${id}-dome)"/>`);
  push(`<circle cx="${C}" cy="${C}" r="${R.HUB + 0.4}" fill="none" stroke="${p.edgeDark}" stroke-width="0.9"/>`);
  const titleY = subtitle ? C - 8 : C;
  if (trail) {
    push(
      `<text class="kw-trail" x="${C}" y="${C - 24}" fill="${p.textMuted}" font-size="9.5" font-weight="500" text-anchor="middle" dominant-baseline="central">${esc(trail)}</text>`,
    );
  }
  push(
    `<text x="${C}" y="${titleY}" fill="${p.text}" font-size="11.5" font-weight="600" letter-spacing="1.6" text-anchor="middle" dominant-baseline="central">${esc(title.toLocaleUpperCase(lang(title)))}</text>`,
  );
  if (subtitle) {
    push(
      `<text x="${C}" y="${C + 8.5}" fill="${p.textMuted}" font-size="11" font-weight="450" text-anchor="middle" dominant-baseline="central">${esc(subtitle)}</text>`,
    );
  }
  if (back) {
    push(
      `<text class="kw-back" x="${C}" y="${C + 26}" fill="${p.index}" font-size="10" font-weight="650" text-anchor="middle" dominant-baseline="central">‹ ${esc(back)}</text>`,
    );
  }
  push('</svg>');
  return out.join('');
}

/** Turkish capitals keep their dots (i → İ); the title is the only text drawn in capitals. */
function lang(text) {
  return /[ğüşıöçĞÜŞİÖÇ]/.test(text) ? 'tr' : 'en';
}

/** The dial's angle as last set on each wheel, so the next turn takes the shortest way. */
const turns = new WeakMap();

/**
 * Shows a slice under the pointer, or applies one, on a wheel drawn by dialSvg, without drawing it
 * again, so the page's transitions run: the dial turns the shortest way, the bolts slide and the
 * handle turns. It changes attributes and the CSSOM only, which a strict Content-Security-Policy
 * allows.
 */
export function setState(svg, palette, { hover = null, selected = null }) {
  const p = palette;
  const count = svg.querySelectorAll('.kw-slice').length;
  const applied = selected !== null;
  const dial = svg.querySelector('.kw-dial');
  const target = dialAngle(count, applied ? selected : hover, Number(svg.getAttribute('data-offset')) || 0);
  const drawn = /rotate\((-?[\d.]+)/.exec(dial.getAttribute('transform') || '');
  const angle = turnTo(turns.has(svg) ? turns.get(svg) : drawn ? Number(drawn[1]) : target, target);
  turns.set(svg, angle);
  dial.style.transform = `rotate(${fx(angle)}deg)`;
  svg.querySelector('.kw-handle').style.transform = `rotate(${applied ? 45 : 0}deg)`;
  svg.querySelector('.kw-pointer').setAttribute('fill', applied || hover !== null ? p.index : p.indexIdle);
  for (const bolt of svg.querySelectorAll('.kw-bolt')) {
    bolt.removeAttribute('transform');
    bolt.style.transform = applied ? `translateY(${-BOLT.out}px)` : '';
  }
  for (const slice of svg.querySelectorAll('.kw-slice')) {
    const i = Number(slice.dataset.slice);
    const isHover = i === hover && !applied;
    const isSelected = i === selected;
    slice.querySelector('.kw-cell').setAttribute('opacity', isHover || isSelected ? '1' : '0');
    slice.querySelector('.kw-window').setAttribute('opacity', isHover ? '1' : '0');
    slice.querySelector('.kw-inlay').setAttribute('opacity', isSelected ? '1' : '0');
    slice.querySelector('.kw-keyline').setAttribute('opacity', isHover ? '1' : '0');
  }
  for (const marks of svg.querySelectorAll('.kw-marks')) {
    const i = Number(marks.dataset.slice);
    const isHover = i === hover && !applied;
    const isSelected = i === selected;
    marks.querySelector('.kw-latch').setAttribute('opacity', isSelected ? '1' : '0');
    const numeral = marks.querySelector('.kw-numeral');
    numeral.setAttribute('fill', isSelected ? p.onIndex : isHover ? p.index : p.num);
    numeral.setAttribute('font-weight', isSelected || isHover ? '700' : '600');
    for (const label of marks.querySelectorAll('.kw-label')) {
      label.setAttribute('fill', isSelected ? p.textSelected : p.text);
    }
    for (const icon of marks.querySelectorAll('.kw-icon')) {
      icon.setAttribute('stroke', isSelected ? p.textSelected : p.text);
    }
    const mark = marks.querySelector('.kw-ringmark');
    if (mark) {
      mark.setAttribute('fill', isSelected ? p.textSelected : isHover ? p.index : p.num);
      mark.setAttribute('opacity', isHover || isSelected ? '1' : '0.75');
    }
  }
}
