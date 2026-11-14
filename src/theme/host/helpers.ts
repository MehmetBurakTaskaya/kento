// SPDX-License-Identifier: MIT
// The drawing helpers a theme's wheel receives as `H`: SVG elements, the wheel's polar geometry in its
// 400 x 400 space, and labels that shrink to fit their slice, wrap to two lines when that reads better
// and, past the smallest size, end with an ellipsis so they never leave the slice. Labels are measured
// in the document, so a wheel is drawn into a connected element once its fonts have loaded. And the
// mark of a slice that opens a ring of choices, which every theme draws in its own look.
import { iconMarkup } from './icons';
import type { ModelSlice, WheelModel } from './contract';

const SVGNS = 'http://www.w3.org/2000/svg';
/** Every wheel is drawn in a 400 x 400 viewBox centred on (200, 200). */
export const C = 200;

export type Attrs = Record<string, string | number | boolean | null | undefined>;

export interface LabelOptions {
  maxWidth?: number;
  size?: number;
  minSize?: number;
  /** Line height, as a share of the font size. */
  lh?: number;
  maxLines?: number;
  cls?: string;
  attrs?: Attrs;
}

export interface BlockOptions extends Omit<LabelOptions, 'attrs' | 'maxLines'> {
  icon?: boolean;
  iconSize?: number;
  subSize?: number;
  gap?: number;
  subCls?: string;
  /** The sub-label; undefined takes the slice's own, null leaves it out. */
  sub?: string | null;
}

/** The shared shapes of a ring mark, each pointing outwards. */
export type RingMarkShape = 'arrow' | 'chevron' | 'double' | 'dart' | 'tag' | 'pixel';

export interface RingMarkOptions {
  /** The radius of the mark's point, its outer end: near the rim, inside the slice. */
  r: number;
  /** The mark's length along the radius; its width follows its shape. */
  size?: number;
  /** Degrees round from the slice's centre line towards the next slice, in place of the model's
   *  (the steel wheel's); mirrored right to left. */
  offset?: number;
  /** Degrees the slice itself is turned at the mark's radius, in a theme whose slices curve: the mark
   *  moves with it, so it stays on the same side of the slice as drawn. */
  turn?: number;
  /** One of the shared shapes, or the theme's own path drawn pointing up, its point at 0,0 and its
   *  base at y = size; a function receives the size. */
  shape?: RingMarkShape | string | ((size: number) => string);
  /** Stroked rather than filled (a chevron is a line). */
  line?: boolean;
  /** For the pixel shape: the side of one pixel, and of the grid its pixels keep to (a third of the
   *  size by default, with no grid). */
  grid?: number;
  /** A halo under the mark, `--ring-mark-halo` (the slice's colour), that lifts it off a busy ground;
   *  a number sets its width. */
  halo?: boolean | number;
  cls?: string;
}

export interface Helpers {
  C: number;
  s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs, parent?: Element | null): SVGElementTagNameMap[K];
  s(tag: string, attrs?: Attrs, parent?: Element | null): SVGElement;
  el(tag: string, attrs?: Attrs, parent?: Element | null): HTMLElement;
  polar(r: number, a: number): [number, number];
  sector(r0: number, r1: number, a0: number, a1: number, gap?: number): string;
  arc(r: number, a0: number, a1: number): string;
  ring(r0: number, r1: number): string;
  label(parent: Element, x: number, y: number, text: string, options?: LabelOptions): SVGTextElement;
  fitWidth(text: SVGTextElement, maxWidth: number, size: number, minSize: number): number;
  slice(parent: Element, slice: ModelSlice, model: WheelModel): SVGGElement;
  rad(a: number): number;
  uid(prefix?: string): string;
  icon(parent: Element, name: string, x: number, y: number, size?: number, cls?: string): SVGGElement;
  text(parent: Element, x: number | string, y: number | string, text: string, attrs?: Attrs): SVGTextElement;
  block(
    parent: Element,
    slice: ModelSlice,
    r: number,
    options?: BlockOptions,
  ): { label: SVGTextElement; icon?: SVGGElement; sub?: SVGTextElement };
  /** The mark of a slice that opens a ring of choices, drawn into its slice group: null for a slice
   *  that opens none. */
  ringMark(parent: Element, slice: ModelSlice, model: WheelModel, options: RingMarkOptions): SVGGElement | null;
}

function element(tag: string, attrs: Attrs, parent: Element | null | undefined, ns: string | null): Element {
  const node = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  parent?.appendChild(node);
  return node;
}

const s = (tag: string, attrs: Attrs = {}, parent?: Element | null) => element(tag, attrs, parent, SVGNS);
export const rad = (a: number) => (a * Math.PI) / 180;
/** Angles are degrees, 0 at twelve o'clock, growing clockwise. */
export const polar = (r: number, a: number): [number, number] => [C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))];
const f2 = (n: number) => Math.round(n * 100) / 100;

const FULL = 359.99;

export function ring(r0: number, r1: number): string {
  const outer = `M${C} ${C - r1}a${r1} ${r1} 0 1 1 0 ${2 * r1}a${r1} ${r1} 0 1 1 0 ${-2 * r1}Z`;
  if (r0 <= 0) return outer;
  return `${outer}M${C} ${C - r0}a${r0} ${r0} 0 1 0 0 ${2 * r0}a${r0} ${r0} 0 1 0 0 ${-2 * r0}Z`;
}

/** An annular sector from a0 to a1 between r0 and r1, with an optional gap in px along its sides. A
 *  wheel of one slice gets the whole ring, which a single arc cannot draw. */
export function sector(r0: number, r1: number, a0: number, a1: number, gap = 0): string {
  if (a1 - a0 >= FULL) return ring(r0, r1);
  const g1 = gap ? ((gap / 2 / r1) * 180) / Math.PI : 0;
  const [x1, y1] = polar(r1, a0 + g1);
  const [x2, y2] = polar(r1, a1 - g1);
  const big1 = a1 - a0 - 2 * g1 > 180 ? 1 : 0;
  if (r0 <= 0) return `M${C} ${C}L${f2(x1)} ${f2(y1)}A${r1} ${r1} 0 ${big1} 1 ${f2(x2)} ${f2(y2)}Z`;
  const g0 = gap ? ((gap / 2 / r0) * 180) / Math.PI : 0;
  const [x3, y3] = polar(r0, a1 - g0);
  const [x4, y4] = polar(r0, a0 + g0);
  const big0 = a1 - a0 - 2 * g0 > 180 ? 1 : 0;
  return `M${f2(x1)} ${f2(y1)}A${r1} ${r1} 0 ${big1} 1 ${f2(x2)} ${f2(y2)}L${f2(x3)} ${f2(y3)}A${r0} ${r0} 0 ${big0} 0 ${f2(x4)} ${f2(y4)}Z`;
}

export function arc(r: number, a0: number, a1: number): string {
  if (a1 - a0 >= FULL) return `M${C} ${C - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`;
  const [x1, y1] = polar(r, a0);
  const [x2, y2] = polar(r, a1);
  return `M${f2(x1)} ${f2(y1)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f2(x2)} ${f2(y2)}`;
}

const length = (node: SVGTextContentElement) => node.getComputedTextLength();

/** The font size that stepping down from `size` by 0.5 finds: the first that fits maxWidth, or the
 *  first at or below minSize. Every measurement lays the text out again, which a wheel of themed
 *  labels pays for many times over, and text widens in step with its size: one measurement at
 *  `size` guesses the step and one or two more confirm it, where stepping down measured each step. */
function settle(
  set: (fs: number) => void,
  width: () => number,
  maxWidth: number,
  size: number,
  minSize: number,
): number {
  set(size);
  if (size <= minSize) return size;
  const full = width();
  if (full <= maxWidth) return size;
  const at = (k: number) => size - k / 2;
  const fits = (k: number) => {
    set(at(k));
    return width() <= maxWidth;
  };
  // The first step at or below minSize, where stepping down stops.
  const last = Math.ceil((size - minSize) * 2);
  let k = Math.min(last, Math.max(1, Math.ceil((size - (size * maxWidth) / full) * 2)));
  if (fits(k)) {
    while (k > 1 && fits(k - 1)) k -= 1;
  } else if (k < last) {
    do k += 1;
    while (k < last && !fits(k));
  }
  set(at(k));
  return at(k);
}

export function fitWidth(t: SVGTextElement, maxWidth: number, size: number, minSize: number): number {
  return settle(
    (fs) => t.setAttribute('font-size', String(fs)),
    () => length(t),
    maxWidth,
    size,
    minSize,
  );
}

/** Shortens a line that is still too wide at the smallest size, keeping its start. The label keeps its
 *  whole text as its name and says that it was shortened, for pictures of a theme to point out. */
function ellipsize(node: SVGTextContentElement, maxWidth: number): void {
  const full = node.textContent ?? '';
  if (length(node) <= maxWidth) return;
  const text = node.closest('text') ?? node;
  text.setAttribute('data-fit', 'shortened');
  if (!text.hasAttribute('aria-label')) text.setAttribute('aria-label', text.textContent ?? full);
  const chars = Array.from(full);
  let low = 0;
  let high = chars.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    node.textContent = chars.slice(0, mid).join('').trimEnd() + '…';
    if (length(node) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  node.textContent = chars.slice(0, low).join('').trimEnd() + '…';
}

/** A centred label that shrinks to fit maxWidth and wraps to two lines when that reads better. */
export function label(parent: Element, x: number, y: number, str: string, o: LabelOptions = {}): SVGTextElement {
  const { maxWidth = 90, size = 14, minSize = 8, lh = 1.1, cls = 'lbl', attrs = {} } = o;
  const t = s(
    'text',
    { x, y, class: cls, 'text-anchor': 'middle', 'dominant-baseline': 'central', ...attrs },
    parent,
  ) as SVGTextElement;
  t.textContent = str;
  const one = fitWidth(t, maxWidth, size, minSize);
  const words = String(str).split(/\s+/).filter(Boolean);
  if (one >= size * 0.86 || words.length < 2 || o.maxLines === 1) {
    ellipsize(t, maxWidth);
    return t;
  }
  let best: { lines: [string, string]; longest: number } | null = null;
  for (let k = 1; k < words.length; k++) {
    const lines: [string, string] = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
    const longest = Math.max(lines[0].length, lines[1].length);
    if (!best || longest < best.longest) best = { lines, longest };
  }
  t.textContent = '';
  const spans = best!.lines.map((line) => s('tspan', { x, dy: 0, text: line }, t) as SVGTSpanElement);
  const widest = () => Math.max(...spans.map(length));
  const fs = settle((value) => t.setAttribute('font-size', String(value)), widest, maxWidth, size, minSize);
  spans[0]!.setAttribute('dy', String(f2((-lh * fs) / 2)));
  spans[1]!.setAttribute('dy', String(f2(lh * fs)));
  if (fs <= one) {
    t.textContent = str;
    t.setAttribute('font-size', String(one));
    ellipsize(t, maxWidth);
  } else spans.forEach((span) => ellipsize(span, maxWidth));
  return t;
}

/** The shared ring mark shapes, pointing up with the point at 0,0 and the base at y = l. */
function markShape(shape: RingMarkShape, l: number): { d: string; line: boolean; evenodd?: boolean } {
  const n = f2;
  switch (shape) {
    case 'chevron': {
      const w = l * 0.78;
      return { d: `M${n(-w)} ${n(l)}L0 0L${n(w)} ${n(l)}`, line: true };
    }
    case 'double': {
      const w = l * 0.72;
      const h = l * 0.55;
      return { d: `M${n(-w)} ${n(h)}L0 0L${n(w)} ${n(h)}M${n(-w)} ${n(l)}L0 ${n(l - h)}L${n(w)} ${n(l)}`, line: true };
    }
    case 'dart': {
      const w = l * 0.66;
      return { d: `M0 0L${n(w)} ${n(l)}L0 ${n(l * 0.68)}L${n(-w)} ${n(l)}Z`, line: false };
    }
    case 'tag': {
      // A luggage tag, its point outwards, with the hole for its string.
      const w = l * 0.42;
      const k = l * 0.36;
      const h = l * 0.13;
      const y = l * 0.4;
      return {
        d: `M0 0L${n(w)} ${n(k)}V${n(l)}H${n(-w)}V${n(k)}Z M0 ${n(y - h)}a${n(h)} ${n(h)} 0 1 0 0 ${n(2 * h)}a${n(h)} ${n(h)} 0 1 0 0 ${n(-2 * h)}Z`,
        line: false,
        evenodd: true,
      };
    }
    default: {
      const w = l * 0.6;
      return { d: `M0 0L${n(w)} ${n(l)}L${n(-w)} ${n(l)}Z`, line: false };
    }
  }
}

/** A pixel arrow pointing at angle `at` turned to the nearest eighth, its pixels square to the page:
 *  rows of one, three, five… pixels of side u, or along a diagonal a staircase whose corner points.
 *  Drawn round its point's pixel, centred at 0,0. */
function pixelArrow(at: number, rows: number, u: number): string {
  const k = ((Math.round(at / 45) % 8) + 8) % 8;
  const cells: [number, number][] = [];
  for (let row = 0; row < rows; row++)
    for (let i = -row; i <= row; i++)
      if (k % 2 === 0) cells.push([i, row]);
      else if (i <= 0) cells.push([i, row + i]);
  // A quarter turn at a time keeps the pixels on the grid: x, y → -y, x.
  const quarters = Math.floor(k / 2);
  let d = '';
  for (let [x, y] of cells) {
    for (let q = 0; q < quarters; q++) [x, y] = [-y, x];
    d += `M${f2((x - 0.5) * u)} ${f2((y - 0.5) * u)}h${f2(u)}v${f2(u)}h${f2(-u)}Z`;
  }
  return d;
}

/** Draws the mark of a slice that opens a ring of choices: a small shape near the rim pointing
 *  outwards, off the centre line towards the next slice, mirrored right to left. The app's wheel sets
 *  `is-hover` and `is-selected` on it as on its slice, wherever it is drawn. */
export function ringMark(parent: Element, sl: ModelSlice, model: WheelModel, o: RingMarkOptions): SVGGElement | null {
  if (!sl.ring) return null;
  const { r, size = 7, shape = 'arrow', halo = false, cls = '' } = o;
  const rtl = model.dir === 'rtl';
  const from = o.offset === undefined && sl.mark !== null ? sl.mark : sl.mid + (rtl ? -1 : 1) * (o.offset ?? 16);
  const at = from + (o.turn ?? 0);
  const own = typeof shape === 'function' ? shape(size) : shape;
  let [x, y] = polar(r, at);
  let drawn: { d: string; line: boolean; evenodd?: boolean };
  let place: string;
  if (own === 'pixel') {
    // Upright, round its point's pixel, which keeps to the grid when there is one.
    const u = o.grid ?? size / 3;
    [x, y] = polar(r - u / 2, at);
    if (o.grid) [x, y] = [(Math.floor(x / u) + 0.5) * u, (Math.floor(y / u) + 0.5) * u];
    drawn = { d: pixelArrow(at, Math.max(2, Math.round(size / u)), u), line: false };
    place = `translate(${f2(x)} ${f2(y)})`;
  } else {
    const known = ['arrow', 'chevron', 'double', 'dart', 'tag'].includes(own);
    drawn = known ? markShape(own as RingMarkShape, size) : { d: own, line: false };
    place = `translate(${f2(x)} ${f2(y)}) rotate(${f2(at)})${rtl ? ' scale(-1 1)' : ''}`;
  }
  const line = o.line ?? drawn.line;
  const g = s(
    'g',
    {
      class: `ring-mark ${cls}`.trim() + (own === 'pixel' ? ' is-pixel' : '') + (sl.off ? ' is-off' : ''),
      'data-ring-mark': sl.i,
      'data-turn': o.turn ? f2(o.turn) : null,
      transform: place,
      'aria-hidden': 'true',
    },
    parent,
  ) as SVGGElement;
  const part = line ? ' is-line' : '';
  const rule = drawn.evenodd ? 'evenodd' : null;
  if (halo) {
    const h = s('path', { d: drawn.d, class: `ring-mark-halo${part}`, 'fill-rule': rule }, g) as SVGPathElement;
    if (typeof halo === 'number') h.style.setProperty('--ring-mark-halo-width', `${halo}px`);
  }
  s('path', { d: drawn.d, class: `ring-mark-body${part}`, 'fill-rule': rule }, g);
  return g;
}

let uids = 0;

/** The helpers for one theme: its icon overrides apply to H.icon(). */
export function createHelpers(icons?: Record<string, string>): Helpers {
  const H: Helpers = {
    C,
    s: s as Helpers['s'],
    el: (tag, attrs = {}, parent) => element(tag, attrs, parent, null) as HTMLElement,
    polar,
    sector,
    arc,
    ring,
    label,
    fitWidth,
    rad,
    uid: (prefix = 'u') => `${prefix}-${++uids}`,
    slice(parent, sl) {
      const g = s(
        'g',
        {
          class: 'slice' + (sl.off ? ' is-off' : ''),
          'data-slice': sl.i,
          'data-id': sl.id,
          role: 'menuitem',
          'aria-label': [sl.label, sl.sub].filter(Boolean).join(', '),
          'aria-disabled': sl.off ? 'true' : null,
        },
        parent,
      ) as SVGGElement;
      g.style.setProperty('--i', String(sl.i));
      g.style.setProperty('--mid', `${sl.mid}deg`);
      return g;
    },
    icon(parent, name, x, y, size = 22, cls = '') {
      const g = s(
        'g',
        {
          class: `ico ${cls}`.trim(),
          transform: `translate(${f2(x - size / 2)} ${f2(y - size / 2)}) scale(${f2(size / 24)})`,
        },
        parent,
      ) as SVGGElement;
      g.innerHTML = iconMarkup(name, icons);
      return g;
    },
    text(parent, x, y, str, attrs = {}) {
      return s(
        'text',
        { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', text: str, ...attrs },
        parent,
      ) as SVGTextElement;
    },
    // Stacks an optional icon, the label and an optional sub-label, centred on the point at radius r on
    // the slice's centre line. Works the same at every angle and in both directions.
    block(parent, sl, r, o = {}) {
      const {
        icon = false,
        iconSize = 22,
        size = 14,
        subSize = 10.5,
        maxWidth = 80,
        gap = 3,
        cls = 'lbl',
        subCls = 'sub',
        minSize = 8,
        lh = 1.1,
      } = o;
      const sub = o.sub === undefined ? sl.sub : o.sub;
      const [x, y] = polar(r, sl.mid);
      const hIcon = icon ? iconSize + gap : 0;
      const hSub = sub ? gap + subSize * lh : 0;
      const top = y - (hIcon + size * lh + hSub) / 2;
      const ly = top + hIcon + (size * lh) / 2;
      const t = label(parent, x, ly, sl.label, { maxWidth, size, minSize, cls, lh, maxLines: sub ? 1 : 2 });
      const extra = t.querySelectorAll('tspan').length === 2 ? (lh * +t.getAttribute('font-size')!) / 2 : 0;
      const parts: { label: SVGTextElement; icon?: SVGGElement; sub?: SVGTextElement } = { label: t };
      if (icon) parts.icon = H.icon(parent, sl.icon, x, top + iconSize / 2 - extra, iconSize);
      if (sub)
        parts.sub = label(parent, x, ly + (size * lh) / 2 + gap + (subSize * lh) / 2 + extra, sub, {
          maxWidth,
          size: subSize,
          minSize: Math.min(minSize, subSize),
          cls: subCls,
          maxLines: 1,
        });
      return parts;
    },
    ringMark,
  };
  return H;
}
