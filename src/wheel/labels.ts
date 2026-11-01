// SPDX-License-Identifier: MIT
// Fits a label into its slice (design/DESIGN.md, section 3): it shrinks to fit, and wraps to two lines
// when that keeps it larger; at the smallest size it is shortened with an ellipsis. Widths are measured
// once per text at size 1 and scale with the font size, so fitting needs no layout pass.

/** The width of a text at font size 1, in the wheel's units. */
export type Measure = (text: string) => number;

export interface FitOptions {
  size: number;
  minSize: number;
  maxWidth: number;
  maxLines: 1 | 2;
  /** File names keep their start and extension; other labels lose their end. */
  truncate?: 'end' | 'middle';
}

export interface FittedLabel {
  lines: string[];
  size: number;
}

const ELLIPSIS = '…';

/** The largest size, in half steps between minSize and size, at which a width fits. */
export function sizeFor(width: number, maxWidth: number, size: number, minSize: number): number {
  if (width <= 0) return size;
  const fits = Math.floor((maxWidth / width) * 2) / 2;
  return Math.min(size, Math.max(minSize, fits));
}

function shorten(text: string, size: number, maxWidth: number, measure: Measure, mode: 'end' | 'middle'): string {
  if (measure(text) * size <= maxWidth) return text;
  const chars = Array.from(text);
  for (let keep = chars.length - 1; keep > 0; keep--) {
    const head = mode === 'middle' ? Math.ceil(keep / 2) : keep;
    const tail = keep - head;
    const candidate = chars.slice(0, head).join('').trimEnd() + ELLIPSIS + (tail ? chars.slice(-tail).join('') : '');
    if (measure(candidate) * size <= maxWidth) return candidate;
  }
  return ELLIPSIS;
}

export function fitLabel(text: string, options: FitOptions, measure: Measure): FittedLabel {
  const { size, minSize, maxWidth, maxLines, truncate = 'end' } = options;
  const one = sizeFor(measure(text), maxWidth, size, minSize);
  const single = () => ({ lines: [shorten(text, one, maxWidth, measure, truncate)], size: one });
  const words = text.split(/\s+/).filter(Boolean);
  if (maxLines === 1 || words.length < 2 || one >= size * 0.86) return single();

  // The split whose wider line is narrowest.
  let best: { lines: [string, string]; width: number } | null = null;
  for (let k = 1; k < words.length; k++) {
    const lines: [string, string] = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
    const width = Math.max(measure(lines[0]), measure(lines[1]));
    if (!best || width < best.width) best = { lines, width };
  }
  if (!best) return single();
  const two = sizeFor(best.width, maxWidth, size, minSize);
  if (two <= one) return single();
  return { lines: best.lines.map((line) => shorten(line, two, maxWidth, measure, truncate)), size: two };
}

export interface FontSpec {
  family: string;
  weight: number;
  /** Letter spacing in em. */
  spacing?: number;
}

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
let context: Context2D | null | undefined;

function canvasContext(): Context2D | null {
  if (context !== undefined) return context;
  try {
    context =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d')
        : document.createElement('canvas').getContext('2d');
  } catch {
    context = null;
  }
  return context;
}

/** A measure for one font, through a canvas; without one (tests) it estimates from the length. */
export function canvasMeasure({ family, weight, spacing = 0 }: FontSpec): Measure {
  const cache = new Map<string, number>();
  const ctx = canvasContext();
  return (text) => {
    let width = cache.get(text);
    if (width === undefined) {
      const length = Array.from(text).length;
      if (ctx) {
        ctx.font = `${weight} 100px ${family}`;
        width = ctx.measureText(text).width / 100;
      } else {
        width = length * 0.56;
      }
      width += spacing * length;
      cache.set(text, width);
    }
    return width;
  };
}

export interface TextLine {
  text: string;
  y: number;
}

export interface LabelBlock {
  x: number;
  icon: { y: number; size: number } | null;
  label: { size: number; lines: TextLine[] };
  sub: { size: number; lines: TextLine[] } | null;
}

export interface BlockMeasures {
  /** A format name such as "PNG". */
  format: Measure;
  /** A tool or action name under its icon. */
  label: Measure;
  sub: Measure;
}

const LINE = 1.1;
const MAX_WIDTH = 72;
const MIN_SIZE = 8;

/** Stacks the icon, the label and the sub-label on the slice's centre line at the label radius
 * (design/DESIGN.md, section 3): a format label 20.5 with a 10.8 sub-label, or a 22-unit icon over a
 * 12.8 label. The block stays upright and centred at every angle, in both directions. */
export function layoutBlock(
  slice: { label: string; sublabel?: string; icon: boolean; format: boolean },
  center: [number, number],
  measures: BlockMeasures,
): LabelBlock {
  const [x, y] = center;
  const sub = slice.sublabel || null;
  const iconSize = slice.format || !slice.icon ? 0 : sub ? 20 : 22;
  const size = slice.format ? 20.5 : 12.8;
  const subSize = 10.8;
  const gap = slice.format ? 2 : 4;
  const fitted = fitLabel(
    slice.label,
    { size, minSize: MIN_SIZE, maxWidth: MAX_WIDTH, maxLines: sub ? 1 : 2 },
    slice.format ? measures.format : measures.label,
  );
  const hIcon = iconSize ? iconSize + gap : 0;
  const hSub = sub ? 2 + subSize * LINE : 0;
  const top = y - (hIcon + size * LINE + hSub) / 2;
  const middle = top + hIcon + (size * LINE) / 2;
  // A second line grows the block both ways: the icon moves up and the sub-label down.
  const extra = fitted.lines.length === 2 ? (LINE * fitted.size) / 2 : 0;
  const lines = fitted.lines.map((text, k) => ({
    text,
    y: fitted.lines.length === 2 ? middle + (k === 0 ? -extra : extra) : middle,
  }));
  let subBlock: LabelBlock['sub'] = null;
  if (sub) {
    const fit = fitLabel(sub, { size: subSize, minSize: MIN_SIZE, maxWidth: MAX_WIDTH, maxLines: 1 }, measures.sub);
    const subY = middle + (size * LINE) / 2 + 2 + (subSize * LINE) / 2 + extra;
    subBlock = { size: fit.size, lines: [{ text: fit.lines[0]!, y: subY }] };
  }
  return {
    x,
    icon: iconSize ? { y: top + iconSize / 2 - extra, size: iconSize } : null,
    label: { size: fitted.size, lines },
    sub: subBlock,
  };
}
