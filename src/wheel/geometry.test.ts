// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  C,
  hitTest,
  layoutSlices,
  normalize,
  offsetFor,
  polar,
  R,
  restAngle,
  sectorPath,
  toView,
  turnTo,
} from './geometry';

describe('slice layout', () => {
  it('runs clockwise from twelve o’clock, and counterclockwise right to left', () => {
    expect(layoutSlices(8, 'ltr').map((s) => normalize(s.mid))).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(layoutSlices(8, 'rtl').map((s) => normalize(s.mid))).toEqual([0, 315, 270, 225, 180, 135, 90, 45]);
    const [first] = layoutSlices(4, 'ltr');
    expect(first).toMatchObject({ index: 0, start: -45, end: 45, step: 90 });
    expect(layoutSlices(0, 'ltr')).toEqual([]);
  });

  it('turns a ring as a whole so that a chosen slice sits at a given angle', () => {
    // Slice 3 of five (72° each) at three o’clock: slice 1 sits 144° before it.
    const offset = offsetFor(90, 2, 5, 'ltr');
    expect(offset).toBe(-54);
    const ring = layoutSlices(5, 'ltr', offset);
    expect(normalize(ring[2]!.mid)).toBe(90);
    expect(normalize(ring[3]!.mid)).toBe(162);
    const rtl = layoutSlices(5, 'rtl', offsetFor(90, 2, 5, 'rtl'));
    expect(normalize(rtl[2]!.mid)).toBe(90);
    expect(normalize(rtl[3]!.mid)).toBe(18);
    expect(restAngle(5, 'ltr', offset)).toBe(-54 - 36);
    for (const slice of ring) {
      const [x, y] = polar(R.LABEL, slice.mid);
      expect(hitTest(x, y, 5, 'ltr', offset)).toBe(slice.index);
    }
    const [x, y] = polar(R.LABEL, 90);
    expect(hitTest(x, y, 5, 'rtl', offsetFor(90, 2, 5, 'rtl'))).toBe(2);
  });

  it('parks the dial on the boundary before slice 1', () => {
    expect(restAngle(8, 'ltr')).toBe(-22.5);
    expect(restAngle(8, 'rtl')).toBe(22.5);
    expect(restAngle(3, 'ltr')).toBe(-60);
    expect(restAngle(0, 'ltr')).toBe(0);
  });

  it('turns the dial the shortest way and keeps counting past a full turn', () => {
    expect(turnTo(0, 90)).toBe(90);
    expect(turnTo(0, 315)).toBe(-45);
    expect(turnTo(350, 10)).toBe(370);
    expect(turnTo(-22.5, 0)).toBe(0);
    expect(turnTo(720, 90)).toBe(810);
    expect(turnTo(-700, 0)).toBe(-720);
  });
});

describe('hit-testing', () => {
  const at = (r: number, deg: number) => polar(r, deg);

  it('finds every slice at its centre, in both directions and for every count up to eight', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      for (let count = 1; count <= 8; count++) {
        for (const slice of layoutSlices(count, dir)) {
          for (const r of [R.WINDOW + 1, R.LABEL, R.FACE, R.OUT - 1]) {
            const [x, y] = at(r, slice.mid);
            expect(hitTest(x, y, count, dir), `${dir} ${count} #${slice.index} r${r}`).toBe(slice.index);
          }
        }
      }
    }
  });

  it('splits at the boundaries', () => {
    const [x1, y1] = at(R.LABEL, 22.4);
    const [x2, y2] = at(R.LABEL, 22.6);
    expect(hitTest(x1, y1, 8, 'ltr')).toBe(0);
    expect(hitTest(x2, y2, 8, 'ltr')).toBe(1);
    expect(hitTest(x2, y2, 8, 'rtl')).toBe(7);
    const [x3, y3] = at(R.LABEL, -22.6);
    expect(hitTest(x3, y3, 8, 'ltr')).toBe(7);
    expect(hitTest(x3, y3, 8, 'rtl')).toBe(1);
  });

  it('ignores the hub, the handle and the space outside the ring', () => {
    expect(hitTest(C, C, 8, 'ltr')).toBeNull();
    const [hx, hy] = at(R.WINDOW - 1, 45);
    expect(hitTest(hx, hy, 8, 'ltr')).toBeNull();
    const [ox, oy] = at(R.OUT + 1, 45);
    expect(hitTest(ox, oy, 8, 'ltr')).toBeNull();
    expect(hitTest(C, C - R.LABEL, 0, 'ltr')).toBeNull();
  });

  it('maps screen points into the 400-unit space at any size', () => {
    const box = { left: 100, top: 50, width: 360 };
    expect(toView(100 + 180, 50 + 180, box)).toEqual({ x: 200, y: 200 });
    expect(toView(100 + 360, 50, box)).toEqual({ x: 400, y: 0 });
    const { x, y } = toView(100 + 180, 50 + 18, box);
    expect(hitTest(x, y, 8, 'ltr')).toBe(0);
  });
});

describe('paths', () => {
  it('draws a single-slice wheel as a full ring', () => {
    expect(sectorPath(R.WINDOW, R.CHAPTER, -180, 180)).toContain('a141 141 0 1 1');
    expect(sectorPath(R.WINDOW, R.CHAPTER, -22.5, 22.5)).toMatch(/^M[\d.]+ [\d.]+A141 141 0 0 1/);
  });
});
