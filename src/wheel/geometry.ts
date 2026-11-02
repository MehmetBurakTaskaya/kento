// SPDX-License-Identifier: MIT
// The wheel's geometry in its 400 x 400 drawing space (design/DESIGN.md, section 5). Angles are
// degrees from twelve o'clock, growing clockwise. Slices run clockwise from twelve; in right-to-left
// languages they run counterclockwise, so only the slice angles change, never the drawing. A sub-ring
// turns as a whole (`offset`) so that it unfolds from the slice that opened it.

export const VIEW = 400;
export const C = VIEW / 2;

/** Radii, outside in: fixed ring, turning dial, enamel face, slice windows, handle and hub cap. */
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
} as const;

/** The bolts sit on the eight boundaries of a full ring, hidden under the steel, and are thrown 18 out. */
export const BOLT = { width: 25, length: 25, tip: 195, out: 18 } as const;
export const BOLT_ANGLES = [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5] as const;
export const SPOKE_ANGLES = [22.5, 112.5, 202.5, 292.5] as const;

export const MAX_SLICES = 8;

export type Direction = 'ltr' | 'rtl';

export interface SliceGeometry {
  index: number;
  /** The slice's centre line. */
  mid: number;
  start: number;
  end: number;
  step: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const fx = (n: number) => String(Math.round(n * 100) / 100);

/** An angle folded into [0, 360). */
export function normalize(deg: number): number {
  const a = deg % 360;
  // Adding zero also turns -0 into 0.
  return a < 0 ? a + 360 : a + 0;
}

/** `offset` is where slice 1 sits; 0 is twelve o'clock. */
export function layoutSlices(count: number, dir: Direction, offset = 0): SliceGeometry[] {
  if (count <= 0) return [];
  const step = 360 / count;
  const sign = dir === 'rtl' ? -1 : 1;
  return Array.from({ length: count }, (_, index) => {
    const mid = offset + sign * index * step;
    return { index, mid, start: mid - step / 2, end: mid + step / 2, step };
  });
}

/** At rest the dial parks on the boundary before slice 1, so its index never seems to choose a slice. */
export function restAngle(count: number, dir: Direction, offset = 0): number {
  if (count <= 0) return offset;
  return offset + ((dir === 'rtl' ? 1 : -1) * 180) / count;
}

/** The offset that puts slice `index` of a ring of `count` at the angle `at`. */
export function offsetFor(at: number, index: number, count: number, dir: Direction): number {
  if (count <= 0) return at;
  return at - (dir === 'rtl' ? -1 : 1) * index * (360 / count);
}

/** The dial angle after turning the shortest way from `current` to `target`; it keeps counting past
 * 360 so a CSS transition never spins the long way round. */
export function turnTo(current: number, target: number): number {
  return current + normalize(target - current + 180) - 180;
}

/** The slice under a point of the 400-unit space, by angle and radius: anywhere from the slice window
 * to the fixed ring's edge counts; the hub and the space outside the ring do not. */
export function hitTest(x: number, y: number, count: number, dir: Direction, offset = 0): number | null {
  if (count <= 0) return null;
  const dx = x - C;
  const dy = y - C;
  const r = Math.hypot(dx, dy);
  if (r < R.WINDOW || r > R.OUT) return null;
  return sliceAt((Math.atan2(dx, -dy) * 180) / Math.PI, count, dir, offset);
}

/** The slice whose window holds an angle. */
export function sliceAt(angle: number, count: number, dir: Direction, offset = 0): number {
  const step = 360 / count;
  const a = dir === 'rtl' ? offset - angle : angle - offset;
  return Math.floor(normalize(a + step / 2) / step) % count;
}

/** How far slice `index` lies from slice `from` round a ring of `count`, as a share of half a turn: 0
 * on `from`, 1 opposite it. A ring unfolds from a slice in this order and folds back in the reverse;
 * the order follows the ring, so it mirrors with it in right-to-left layouts. */
export function spread(index: number, from: number, count: number): number {
  if (count <= 1) return 0;
  const k = (((index - from) % count) + count) % count;
  return (Math.min(k, count - k) * 2) / count;
}

/** Where a point of the screen lands in the 400-unit space of a wheel drawn in `box`. */
export function toView(clientX: number, clientY: number, box: { left: number; top: number; width: number }) {
  const scale = box.width > 0 ? VIEW / box.width : 0;
  return { x: (clientX - box.left) * scale, y: (clientY - box.top) * scale };
}

export function polar(r: number, deg: number): [number, number] {
  return [C + r * Math.sin(rad(deg)), C - r * Math.cos(rad(deg))];
}

const point = (r: number, deg: number) => polar(r, deg).map(fx).join(' ');

/** A ring between two radii (even-odd), for full circles and single-slice wheels. */
export function ringPath(r0: number, r1: number): string {
  const outer = `M${C} ${C - r1}a${r1} ${r1} 0 1 1 0 ${2 * r1}a${r1} ${r1} 0 1 1 0 ${-2 * r1}Z`;
  if (r0 <= 0) return outer;
  return `${outer}M${C} ${C - r0}a${r0} ${r0} 0 1 0 0 ${2 * r0}a${r0} ${r0} 0 1 0 0 ${-2 * r0}Z`;
}

/** An annular sector from angle a0 to a1 (a0 < a1), between radii r0 and r1. */
export function sectorPath(r0: number, r1: number, a0: number, a1: number): string {
  if (a1 - a0 >= 359.99) return ringPath(r0, r1);
  const big = a1 - a0 > 180 ? 1 : 0;
  const outer = `M${point(r1, a0)}A${fx(r1)} ${fx(r1)} 0 ${big} 1 ${point(r1, a1)}`;
  if (r0 <= 0) return `M${C} ${C}L${point(r1, a0)}A${fx(r1)} ${fx(r1)} 0 ${big} 1 ${point(r1, a1)}Z`;
  return `${outer}L${point(r0, a1)}A${fx(r0)} ${fx(r0)} 0 ${big} 0 ${point(r0, a0)}Z`;
}

export function arcPath(r: number, a0: number, a1: number): string {
  if (a1 - a0 >= 359.99) return `M${C} ${C - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`;
  return `M${point(r, a0)}A${fx(r)} ${fx(r)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${point(r, a1)}`;
}

/** A radial line from r0 to r1 at one angle. */
export function rayPath(r0: number, r1: number, deg: number): string {
  return `M${point(r0, deg)}L${point(r1, deg)}`;
}

export { fx };
