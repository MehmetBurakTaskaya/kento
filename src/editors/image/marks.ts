// SPDX-License-Identifier: MIT
// The marks of Mark up and how they are drawn. The engine draws the same marks into the result by
// the same rules (viewBox = the upright source size, everything in source pixels):
// - each mark is one layer, <g opacity="a / 255">, painted in rgb(r, g, b), so the parts of a
//   mark never darken where they overlap;
// - pen: a polyline, round caps and joins; highlighter: the same with butt caps;
// - rectangle and ellipse: the area made positive, the stroke centred on its edge (sharp corners),
//   filled in the same colour when `filled`;
// - line: round caps; arrow: a filled isosceles head of length L = max(4 · width, 12) and base
//   0.75 · L with its tip at `to`, and a shaft from `from` to the middle of the head's base;
// - text: FONT_FAMILY at weight 600 and `size`, line i on the baseline at.y + size + i · 1.25 · size,
//   starting at at.x, spaces kept;
// - nothing at all for a fully transparent mark, a pen without points or an arrow of no length.
import type { Area, Mark, Point as Pair, Rgb, Rgba } from '../../ipc';
import type { Size } from '../crop';

export type MarkTool = 'select' | 'pen' | 'highlighter' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text';

export const MARK_TOOLS: MarkTool[] = ['select', 'pen', 'highlighter', 'rectangle', 'ellipse', 'line', 'arrow', 'text'];

export const FONT_FAMILY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
export const FONT_WEIGHT = 600;
export const LINE_HEIGHT = 1.25;

/** The highlighter's alpha, about 40 %: it tints what is under it. */
export const HIGHLIGHT_ALPHA = 102;
/** A highlighter stroke is this many times wider than a pen stroke of the same choice. */
export const HIGHLIGHT_FACTOR = 4;

export const PALETTE: { id: string; rgb: Rgb }[] = [
  { id: 'red', rgb: [229, 57, 53] },
  { id: 'orange', rgb: [245, 124, 0] },
  { id: 'yellow', rgb: [253, 216, 53] },
  { id: 'green', rgb: [67, 160, 71] },
  { id: 'blue', rgb: [30, 136, 229] },
  { id: 'purple', rgb: [142, 36, 170] },
  { id: 'black', rgb: [0, 0, 0] },
  { id: 'white', rgb: [255, 255, 255] },
];

/** Sizes follow the picture, so a mark looks the same on a small picture and on a photo. */
const unit = (source: Size) => Math.max(source.width, source.height, 1) / 1000;

/** The four stroke widths offered (fine to heavy), in source pixels. */
export const strokeWidths = (source: Size) => [2, 4, 8, 16].map((w) => Math.max(1, Math.round(w * unit(source))));

/** The four text sizes offered (small to very large), in source pixels. */
export const textSizes = (source: Size) => [24, 40, 64, 96].map((s) => Math.max(8, Math.round(s * unit(source))));

export const rgbCss = (color: Rgb | Rgba) => `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
export const alpha = (color: Rgba) => Math.round((color[3] / 255) * 1000) / 1000;

export function rgbToHex(rgb: Rgb | Rgba): string {
  return `#${[rgb[0], rgb[1], rgb[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export const sameRgb = (a: Rgb | Rgba, b: Rgb | Rgba) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** The arrow's head: its tip, the two corners of its base and the middle of the base. */
export function arrowHead(from: Pair, to: Pair, width: number) {
  const length = Math.max(4 * width, 12);
  const half = (0.75 * length) / 2;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  // A head with no direction yet points right.
  const [ux, uy] = distance > 0 ? [dx / distance, dy / distance] : [1, 0];
  const base: Pair = [to[0] - ux * length, to[1] - uy * length];
  return {
    length,
    tip: to,
    base,
    corners: [
      [base[0] - uy * half, base[1] + ux * half],
      [base[0] + uy * half, base[1] - ux * half],
    ] as [Pair, Pair],
  };
}

/** An area with a positive width and height, wherever its corner was given. */
export function normalArea(area: Area): Area {
  return {
    x: Math.min(area.x, area.x + area.width),
    y: Math.min(area.y, area.y + area.height),
    width: Math.abs(area.width),
    height: Math.abs(area.height),
  };
}

/** Whether the mark paints anything (the rules leave out invisible and empty marks). */
export function isDrawn(mark: Mark): boolean {
  if (mark.color[3] <= 0) return false;
  if (mark.kind === 'pen' || mark.kind === 'highlighter') return mark.points.length > 0;
  if (mark.kind === 'arrow') return mark.from[0] !== mark.to[0] || mark.from[1] !== mark.to[1];
  return true;
}

/** The lines of a text mark with their baselines. */
export function textLines(mark: Extract<Mark, { kind: 'text' }>): { text: string; x: number; y: number }[] {
  return mark.text.split('\n').map((text, i) => ({
    text,
    x: mark.at[0],
    y: mark.at[1] + mark.size + i * LINE_HEIGHT * mark.size,
  }));
}

/** Measures a line of text in source pixels; without a canvas, a fair guess for the font. */
export type Measure = (text: string, size: number) => number;
export const guessWidth: Measure = (text, size) => [...text].length * 0.58 * size;

const span = (points: Pair[], pad: number): Area => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
};

/** The box a mark covers, with its stroke; used to pick it and to outline it when chosen. */
export function markBounds(mark: Mark, measure: Measure = guessWidth): Area {
  switch (mark.kind) {
    case 'pen':
    case 'highlighter':
      return span(mark.points.length ? mark.points : [[0, 0]], mark.width / 2);
    case 'rectangle':
    case 'ellipse': {
      const pad = mark.width / 2;
      const { x, y, width, height } = normalArea(mark.area);
      return { x: x - pad, y: y - pad, width: width + 2 * pad, height: height + 2 * pad };
    }
    case 'line':
      return span([mark.from, mark.to], mark.width / 2);
    case 'arrow': {
      const head = arrowHead(mark.from, mark.to, mark.width);
      return span([mark.from, mark.to, ...head.corners], mark.width / 2);
    }
    case 'text': {
      const lines = mark.text.split('\n');
      const width = Math.max(mark.size * 0.3, ...lines.map((line) => measure(line, mark.size)));
      return { x: mark.at[0], y: mark.at[1], width, height: lines.length * LINE_HEIGHT * mark.size };
    }
  }
}

const shift = (p: Pair, dx: number, dy: number): Pair => [p[0] + dx, p[1] + dy];

export function moveMark(mark: Mark, dx: number, dy: number): Mark {
  switch (mark.kind) {
    case 'pen':
    case 'highlighter':
      return { ...mark, points: mark.points.map((p) => shift(p, dx, dy)) };
    case 'rectangle':
    case 'ellipse':
      return { ...mark, area: { ...mark.area, x: mark.area.x + dx, y: mark.area.y + dy } };
    case 'line':
    case 'arrow':
      return { ...mark, from: shift(mark.from, dx, dy), to: shift(mark.to, dx, dy) };
    case 'text':
      return { ...mark, at: shift(mark.at, dx, dy) };
  }
}

/** The area between two corners; `square` makes it square towards the pointer. */
export function cornersToArea(a: Pair, b: Pair, square: boolean): Area {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  return { x: Math.min(a[0], a[0] + dx), y: Math.min(a[1], a[1] + dy), width: Math.abs(dx), height: Math.abs(dy) };
}

/** The end of a line turned to the nearest multiple of 45°, at the same length. */
export function snapAngle(from: Pair, to: Pair): Pair {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  // Rounded away from tiny float errors, so a snapped line is exactly level or upright.
  const x = Math.round(Math.cos(angle) * length * 1000) / 1000;
  const y = Math.round(Math.sin(angle) * length * 1000) / 1000;
  return [from[0] + x, from[1] + y];
}

/** A pen stroke grows by points at least `step` apart, so a slow hand does not pile them up. */
export function extendStroke(points: Pair[], point: Pair, step: number): Pair[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < step) return points;
  return [...points, point];
}

/** Whether a finished drag drew something worth keeping (at least `min` source pixels). */
export function isVisible(mark: Mark, min: number): boolean {
  switch (mark.kind) {
    case 'pen':
    case 'highlighter': {
      const box = span(mark.points.length ? mark.points : [[0, 0]], 0);
      return mark.points.length >= 2 && Math.max(box.width, box.height) >= min;
    }
    case 'rectangle':
    case 'ellipse':
      return mark.area.width >= min && mark.area.height >= min;
    case 'line':
    case 'arrow':
      return Math.hypot(mark.to[0] - mark.from[0], mark.to[1] - mark.from[1]) >= min;
    case 'text':
      return mark.text.trim() !== '';
  }
}

const tenth = (value: number) => Math.round(value * 10) / 10;
const pair = (p: Pair): Pair => [tenth(p[0]), tenth(p[1])];

/** A mark as it is sent: tenths of a pixel are enough and keep long strokes small. */
export function roundMark(mark: Mark): Mark {
  switch (mark.kind) {
    case 'pen':
    case 'highlighter':
      return { ...mark, points: mark.points.map(pair) };
    case 'rectangle':
    case 'ellipse': {
      const { x, y, width, height } = mark.area;
      return { ...mark, area: { x: tenth(x), y: tenth(y), width: tenth(width), height: tenth(height) } };
    }
    case 'line':
    case 'arrow':
      return { ...mark, from: pair(mark.from), to: pair(mark.to) };
    case 'text':
      return { ...mark, at: pair(mark.at) };
  }
}

/** A mark with another colour, width or fill; what each kind has. */
export function restyle(mark: Mark, style: { color?: Rgb; width?: number; size?: number; filled?: boolean }): Mark {
  const color: Rgba = style.color ? [...style.color, mark.color[3]] : mark.color;
  switch (mark.kind) {
    case 'text':
      return { ...mark, color, size: style.size ?? mark.size };
    case 'rectangle':
    case 'ellipse':
      return { ...mark, color, width: style.width ?? mark.width, filled: style.filled ?? mark.filled };
    default:
      return { ...mark, color, width: style.width ?? mark.width };
  }
}
