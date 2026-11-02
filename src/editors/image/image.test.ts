// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { Mark } from '../../ipc';
import type { KeyInput } from '../keys';
import { resizeArea, RATIOS, fitRatio, drawArea } from '../crop';
import { isUnchanged, NO_ADJUST, outputSize, resize, turn } from './adjust';
import {
  canvasLayout,
  fitScale,
  maxZoom,
  nudge,
  pixelArea,
  previewSize,
  stepZoom,
  toScreen,
  toSource,
  withSide,
  zoomScroll,
} from './geometry';
import { canRedo, canUndo, commit, redo, startHistory, undo } from './history';
import { imageAllowed, imageKey } from './keys';
import {
  arrowHead,
  cornersToArea,
  extendStroke,
  isDrawn,
  isVisible,
  markBounds,
  moveMark,
  normalArea,
  restyle,
  rgbToHex,
  roundMark,
  snapAngle,
  strokeWidths,
  textLines,
  textSizes,
} from './marks';

const PHOTO = { width: 4000, height: 3000 };

describe('fitting and zooming', () => {
  it('fits the whole picture in the box', () => {
    expect(fitScale(PHOTO, { width: 800, height: 450 })).toBeCloseTo(0.15);
    expect(fitScale({ width: 300, height: 600 }, { width: 800, height: 450 })).toBeCloseTo(0.75);
    // A small picture grows to the box.
    expect(fitScale({ width: 100, height: 100 }, { width: 400, height: 300 })).toBe(3);
    expect(fitScale({ width: 0, height: 0 }, { width: 400, height: 300 })).toBe(1);
  });

  it('steps through the zooms, never past eight screen pixels per source pixel', () => {
    expect(stepZoom(1, 1, 50)).toBe(1.5);
    expect(stepZoom(1.5, 1, 50)).toBe(2);
    expect(stepZoom(2, -1, 50)).toBe(1.5);
    expect(stepZoom(1, -1, 50)).toBe(1);
    expect(stepZoom(2.5, 1, 50)).toBe(3);
    expect(maxZoom(0.15)).toBeCloseTo(53.33, 1);
    expect(stepZoom(16, 1, maxZoom(0.15))).toBeCloseTo(53.33, 1);
    // At its own size a picture of 8 px per pixel cannot zoom at all.
    expect(maxZoom(8)).toBe(1);
    expect(stepZoom(1, 1, maxZoom(8))).toBe(1);
  });

  it('centres a picture smaller than the box', () => {
    expect(canvasLayout(PHOTO, { width: 800, height: 450 }, 0.15)).toEqual({
      width: 600,
      height: 450,
      left: 100,
      top: 0,
    });
    expect(canvasLayout(PHOTO, { width: 800, height: 450 }, 0.3)).toMatchObject({ left: 0, top: 0 });
  });

  it('keeps the point under the pointer in place while zooming', () => {
    const box = { width: 800, height: 450 };
    const before = canvasLayout(PHOTO, box, 0.15);
    const after = canvasLayout(PHOTO, box, 0.3);
    // The middle of the picture under the middle of the box.
    expect(zoomScroll({ x: 400, y: 225 }, { x: 0, y: 0 }, before, after, box)).toEqual({ x: 200, y: 225 });
    // The picture's top left corner stays at the top left.
    expect(zoomScroll({ x: 100, y: 0 }, { x: 0, y: 0 }, before, after, box)).toEqual({ x: 0, y: 0 });
    // Zooming back out returns to no scroll at all.
    expect(zoomScroll({ x: 400, y: 225 }, { x: 200, y: 225 }, after, before, box)).toEqual({ x: 0, y: 0 });
    // Scrolled already: the source point under the pointer is found through the scroll.
    const twice = canvasLayout(PHOTO, box, 0.6);
    const point = { x: 300, y: 100 };
    const scroll = zoomScroll(point, { x: 200, y: 225 }, after, twice, box);
    const sourceBefore = toSource(
      point,
      { left: -200 + after.left, top: -225 + after.top, width: after.width, height: after.height },
      PHOTO,
    );
    const sourceAfter = toSource(
      point,
      { left: -scroll.x + twice.left, top: -scroll.y + twice.top, width: twice.width, height: twice.height },
      PHOTO,
    );
    expect(sourceAfter.x).toBeCloseTo(sourceBefore.x);
    expect(sourceAfter.y).toBeCloseTo(sourceBefore.y);
  });

  it('maps screen points to source pixels and back at any zoom', () => {
    const fitted = { left: 120, top: 40, width: 600, height: 450 };
    expect(toSource({ x: 120, y: 40 }, fitted, PHOTO)).toEqual({ x: 0, y: 0 });
    expect(toSource({ x: 420, y: 265 }, fitted, PHOTO)).toEqual({ x: 2000, y: 1500 });
    // Zoomed in and scrolled: the box starts left of and above the stage.
    const zoomed = { left: -900, top: -500, width: 2400, height: 1800 };
    expect(toSource({ x: 300, y: 400 }, zoomed, PHOTO)).toEqual({ x: 2000, y: 1500 });
    expect(toScreen({ x: 2000, y: 1500 }, zoomed, PHOTO)).toEqual({ x: 300, y: 400 });
    expect(toSource({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 }, PHOTO)).toEqual({ x: 0, y: 0 });
  });

  it('asks for previews sharp enough for the zoom, within the engine’s limits and the picture', () => {
    expect(previewSize(PHOTO)).toBe(1600);
    expect(previewSize(PHOTO, 1.2)).toBe(2000);
    expect(previewSize(PHOTO, 8)).toBe(2048);
    expect(previewSize({ width: 640, height: 480 })).toBe(640);
    expect(previewSize({ width: 640, height: 480 }, 4)).toBe(640);
    expect(previewSize({ width: 16, height: 16 })).toBe(64);
    expect(previewSize(null)).toBe(1600);
    // Small zoom changes reuse the same size.
    expect(previewSize(PHOTO, 1.1)).toBe(previewSize(PHOTO, 1.2));
  });
});

describe('crop areas', () => {
  const frame = { width: 4032, height: 3024 };

  it('rounds edges to whole pixels inside the picture', () => {
    expect(pixelArea({ x: 10.4, y: 20.6, width: 99.8, height: 50.2 }, frame)).toEqual({
      x: 10,
      y: 21,
      width: 100,
      height: 50,
    });
    // Odd sizes are fine for pictures.
    expect(pixelArea({ x: 0, y: 0, width: 333, height: 777 }, frame)).toEqual({ x: 0, y: 0, width: 333, height: 777 });
    expect(pixelArea({ x: -5, y: 3020, width: 4100, height: 0.2 }, frame)).toEqual({
      x: 0,
      y: 3020,
      width: 4032,
      height: 1,
    });
  });

  it('nudges by 1 % of the picture, or a pixel with Shift, and stops at the edges', () => {
    const area = { x: 100, y: 100, width: 1000, height: 800 };
    expect(nudge(area, 1, 0, false, frame)).toMatchObject({ x: 140, y: 100 });
    expect(nudge(area, 0, -1, false, frame)).toMatchObject({ x: 100, y: 70 });
    expect(nudge(area, -1, 0, true, frame)).toMatchObject({ x: 99 });
    expect(nudge({ ...area, x: 3030 }, 1, 0, false, frame)).toMatchObject({ x: 3032 });
    expect(nudge({ ...area, x: 5 }, -1, 0, false, frame)).toMatchObject({ x: 0 });
  });

  it('keeps a preset ratio when a side is typed', () => {
    const area = { x: 0, y: 0, width: 3024, height: 3024 };
    expect(withSide(area, 'width', 1000, 1, frame)).toMatchObject({ width: 1000, height: 1000 });
    expect(withSide(area, 'height', 900, 16 / 9, frame)).toMatchObject({ width: 1600, height: 900 });
    // Too wide for the picture: both sides shrink to fit.
    expect(withSide(area, 'width', 5000, 1, frame)).toMatchObject({ width: 3024, height: 3024 });
    expect(withSide(area, 'width', 1200, null, frame)).toMatchObject({ width: 1200, height: 3024 });
  });

  it('offers the presets of SPEC 5.5 and fits each in the picture', () => {
    expect(RATIOS.map((option) => option.id)).toEqual(['free', '1:1', '4:5', '16:9', '9:16', '3:2']);
    const portrait = fitRatio(frame, 4 / 5);
    expect(portrait.x).toBeCloseTo(806.4);
    expect(portrait.width).toBeCloseTo(2419.2);
    expect(portrait.height).toBeCloseTo(3024);
    expect(fitRatio(frame, 16 / 9).width).toBe(4032);
  });

  it('locks the ratio with Shift on a corner and on an edge grip', () => {
    const start = { x: 0, y: 0, width: 2000, height: 1000 };
    const corner = resizeArea(start, 'se', { x: 3000, y: 1200 }, frame, 2);
    expect(corner.width / corner.height).toBeCloseTo(2);
    // An edge grip keeps the other side centred where it was.
    const edge = resizeArea({ ...start, y: 1000 }, 'e', { x: 3000, y: 1500 }, frame, 2);
    expect(edge).toEqual({ x: 0, y: 750, width: 3000, height: 1500 });
    const square = drawArea({ x: 100, y: 100 }, { x: 600, y: 300 }, frame, 1);
    expect(square.width).toBe(square.height);
  });
});

describe('keys', () => {
  const key = (init: Partial<KeyInput>): KeyInput => ({
    key: '',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...init,
  });

  it('saves, undoes and redoes with the platform’s command key', () => {
    expect(imageKey(key({ key: 's', ctrlKey: true }), false)).toEqual({ type: 'save' });
    expect(imageKey(key({ key: 's', metaKey: true }), true)).toEqual({ type: 'save' });
    expect(imageKey(key({ key: 's', ctrlKey: true }), true)).toBeNull();
    expect(imageKey(key({ key: 'z', ctrlKey: true }), false)).toEqual({ type: 'undo' });
    expect(imageKey(key({ key: 'y', ctrlKey: true }), false)).toEqual({ type: 'redo' });
    expect(imageKey(key({ key: 'Z', ctrlKey: true, shiftKey: true }), false)).toEqual({ type: 'redo' });
    expect(imageKey(key({ key: 'z', metaKey: true, shiftKey: true }), true)).toEqual({ type: 'redo' });
  });

  it('reads the letter that was typed first, and the key’s place only without a Latin letter', () => {
    // German layout: Z sits where Y is on an English keyboard.
    expect(imageKey(key({ key: 'z', code: 'KeyY', ctrlKey: true }), false)).toEqual({ type: 'undo' });
    expect(imageKey(key({ key: 'y', code: 'KeyZ', ctrlKey: true }), false)).toEqual({ type: 'redo' });
    // A Cyrillic layout types я on the Z key.
    expect(imageKey(key({ key: 'я', code: 'KeyZ', ctrlKey: true }), false)).toEqual({ type: 'undo' });
    expect(imageKey(key({ key: 'ы', code: 'KeyS', ctrlKey: true }), false)).toEqual({ type: 'save' });
  });

  it('zooms with Ctrl and +, - or 0', () => {
    expect(imageKey(key({ key: '=', ctrlKey: true }), false)).toEqual({ type: 'zoom', by: 1 });
    expect(imageKey(key({ key: '+', ctrlKey: true, shiftKey: true }), false)).toEqual({ type: 'zoom', by: 1 });
    expect(imageKey(key({ key: '-', ctrlKey: true }), false)).toEqual({ type: 'zoom', by: -1 });
    expect(imageKey(key({ key: '0', metaKey: true }), true)).toEqual({ type: 'zoom', by: 0 });
  });

  it('removes, nudges and takes Enter without modifiers', () => {
    expect(imageKey(key({ key: 'Delete' }), false)).toEqual({ type: 'remove' });
    expect(imageKey(key({ key: 'Backspace' }), false)).toEqual({ type: 'remove' });
    expect(imageKey(key({ key: 'Enter' }), false)).toEqual({ type: 'enter' });
    expect(imageKey(key({ key: 'Enter', shiftKey: true }), false)).toBeNull();
    expect(imageKey(key({ key: 'ArrowLeft' }), false)).toEqual({ type: 'nudge', x: -1, y: 0, fine: false });
    expect(imageKey(key({ key: 'ArrowDown', shiftKey: true }), false)).toEqual({
      type: 'nudge',
      x: 0,
      y: 1,
      fine: true,
    });
    expect(imageKey(key({ key: 'ArrowLeft', altKey: true }), false)).toBeNull();
  });

  it('leaves typing, buttons and sliders their own keys', () => {
    const enter = { type: 'enter' } as const;
    const nudgeLeft = { type: 'nudge', x: -1, y: 0, fine: false } as const;
    expect(imageAllowed({ type: 'save' }, 'commands', false)).toBe(true);
    expect(imageAllowed({ type: 'undo' }, 'commands', false)).toBe(false);
    expect(imageAllowed(enter, 'no-activation', false)).toBe(false);
    expect(imageAllowed(nudgeLeft, 'no-activation', false)).toBe(false);
    expect(imageAllowed({ type: 'undo' }, 'no-activation', false)).toBe(true);
    // A crop area is a button to assistive technology, but Enter and the arrows are the picture's.
    expect(imageAllowed(enter, 'no-activation', true)).toBe(true);
    expect(imageAllowed(nudgeLeft, 'all', false)).toBe(true);
  });
});

describe('undo and redo', () => {
  it('steps back and forward through finished changes', () => {
    let history = startHistory<number[]>([]);
    expect(canUndo(history)).toBe(false);
    history = commit(history, [1]);
    history = commit(history, [1, 2]);
    history = undo(history);
    expect(history.present).toEqual([1]);
    expect(canRedo(history)).toBe(true);
    history = redo(history);
    expect(history.present).toEqual([1, 2]);
    expect(redo(history)).toBe(history);
    history = undo(undo(history));
    expect(history.present).toEqual([]);
    expect(undo(history)).toBe(history);
  });

  it('drops the undone steps when something new is done', () => {
    let history = commit(commit(startHistory<string>('a'), 'b'), 'c');
    history = commit(undo(history), 'd');
    expect(history).toEqual({ past: ['a', 'b'], present: 'd', future: [] });
  });

  it('keeps a limited number of steps and ignores a change to the same value', () => {
    let history = startHistory(0);
    for (let i = 1; i <= 10; i++) history = commit(history, i, 4);
    expect(history.past).toEqual([6, 7, 8, 9]);
    expect(commit(history, history.present)).toBe(history);
  });
});

describe('marks', () => {
  it('builds the arrow head from the width', () => {
    const head = arrowHead([0, 0], [100, 0], 4);
    expect(head.length).toBe(16);
    expect(head.base).toEqual([84, 0]);
    expect(head.corners[0][0]).toBeCloseTo(84);
    expect(Math.abs(head.corners[0][1] - head.corners[1][1])).toBeCloseTo(12);
    // A thin arrow still gets a head of 12 px.
    expect(arrowHead([0, 0], [0, 50], 1)).toMatchObject({ length: 12, base: [0, 38] });
    // An arrow with no length points right (and is not drawn at all).
    expect(arrowHead([5, 5], [5, 5], 10).base).toEqual([-35, 5]);
  });

  it('puts the head symmetrically about a diagonal shaft', () => {
    const head = arrowHead([0, 0], [30, 40], 5);
    expect(head.length).toBe(20);
    expect(head.base[0]).toBeCloseTo(18);
    expect(head.base[1]).toBeCloseTo(24);
    const [a, b] = head.corners;
    expect(Math.hypot(a[0] - 30, a[1] - 40)).toBeCloseTo(Math.hypot(b[0] - 30, b[1] - 40));
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(15);
  });

  it('places each text line on its baseline', () => {
    const lines = textLines({ kind: 'text', at: [10, 20], text: 'One\nTwo', color: [0, 0, 0, 255], size: 40 });
    expect(lines).toEqual([
      { text: 'One', x: 10, y: 60 },
      { text: 'Two', x: 10, y: 110 },
    ]);
  });

  it('measures the box of every kind of mark', () => {
    const red: Mark['color'] = [229, 57, 53, 255];
    expect(
      markBounds({
        kind: 'pen',
        points: [
          [10, 10],
          [50, 30],
        ],
        color: red,
        width: 4,
      }),
    ).toEqual({
      x: 8,
      y: 8,
      width: 44,
      height: 24,
    });
    expect(
      markBounds({
        kind: 'rectangle',
        area: { x: 10, y: 10, width: 20, height: 20 },
        color: red,
        width: 2,
        filled: false,
      }),
    ).toEqual({ x: 9, y: 9, width: 22, height: 22 });
    const text = markBounds(
      { kind: 'text', at: [0, 0], text: 'ab\nabcd', color: red, size: 10 },
      (line, size) => line.length * size,
    );
    expect(text).toEqual({ x: 0, y: 0, width: 40, height: 25 });
    const arrow = markBounds({ kind: 'arrow', from: [0, 0], to: [100, 0], color: red, width: 4 });
    expect(arrow.height).toBeCloseTo(16);
  });

  it('moves marks and draws shapes from two corners', () => {
    const line: Mark = { kind: 'line', from: [0, 0], to: [10, 10], color: [0, 0, 0, 255], width: 2 };
    expect(moveMark(line, 5, -5)).toMatchObject({ from: [5, -5], to: [15, 5] });
    const text: Mark = { kind: 'text', at: [1, 2], text: 'x', color: [0, 0, 0, 255], size: 9 };
    expect(moveMark(text, 1, 1)).toMatchObject({ at: [2, 3] });
    expect(cornersToArea([50, 50], [10, 30], false)).toEqual({ x: 10, y: 30, width: 40, height: 20 });
    expect(cornersToArea([50, 50], [10, 30], true)).toEqual({ x: 10, y: 10, width: 40, height: 40 });
  });

  it('snaps lines to 45° steps at the same length', () => {
    const level = snapAngle([0, 0], [100, 8]);
    expect(level[0]).toBeCloseTo(100.319);
    expect(level[1]).toBe(0);
    const diagonal = snapAngle([0, 0], [100, 90]);
    expect(diagonal[0]).toBeCloseTo(diagonal[1]);
    const upright = snapAngle([10, 10], [12, 80]);
    expect(upright[0]).toBe(10);
    expect(upright[1]).toBeCloseTo(80.029);
  });

  it('keeps pen points apart and ignores slips', () => {
    expect(extendStroke([[0, 0]], [0.5, 0], 1)).toEqual([[0, 0]]);
    expect(extendStroke([[0, 0]], [2, 0], 1)).toEqual([
      [0, 0],
      [2, 0],
    ]);
    const color: Mark['color'] = [0, 0, 0, 255];
    expect(isVisible({ kind: 'pen', points: [[0, 0]], color, width: 3 }, 2)).toBe(false);
    expect(isVisible({ kind: 'line', from: [0, 0], to: [1, 1], color, width: 3 }, 2)).toBe(false);
    expect(isVisible({ kind: 'arrow', from: [0, 0], to: [10, 1], color, width: 3 }, 2)).toBe(true);
    expect(isVisible({ kind: 'text', at: [0, 0], text: '  ', color, size: 3 }, 2)).toBe(false);
  });

  it('draws nothing for invisible or empty marks and makes areas positive', () => {
    const color: Mark['color'] = [0, 0, 0, 255];
    expect(isDrawn({ kind: 'arrow', from: [3, 4], to: [3, 4], color, width: 2 })).toBe(false);
    expect(isDrawn({ kind: 'line', from: [3, 4], to: [3, 4], color, width: 2 })).toBe(true);
    expect(isDrawn({ kind: 'pen', points: [], color, width: 2 })).toBe(false);
    expect(isDrawn({ kind: 'text', at: [0, 0], text: 'x', color: [0, 0, 0, 0], size: 9 })).toBe(false);
    expect(normalArea({ x: 50, y: 40, width: -20, height: -10 })).toEqual({ x: 30, y: 30, width: 20, height: 10 });
    expect(
      markBounds({ kind: 'ellipse', area: { x: 50, y: 40, width: -20, height: 10 }, color, width: 2, filled: true }),
    ).toEqual({ x: 29, y: 39, width: 22, height: 12 });
  });

  it('sends tenths of a pixel and restyles what each kind has', () => {
    const pen: Mark = {
      kind: 'pen',
      points: [
        [1.234, 5.678],
        [9.99, 0.04],
      ],
      color: [1, 2, 3, 102],
      width: 4,
    };
    expect(roundMark(pen)).toMatchObject({
      points: [
        [1.2, 5.7],
        [10, 0],
      ],
    });
    expect(restyle(pen, { color: [9, 9, 9], width: 8, size: 50 })).toEqual({ ...pen, color: [9, 9, 9, 102], width: 8 });
    const text: Mark = { kind: 'text', at: [0, 0], text: 'x', color: [0, 0, 0, 255], size: 10 };
    expect(restyle(text, { size: 20, width: 5 })).toEqual({ ...text, size: 20 });
    expect(rgbToHex([255, 128, 0])).toBe('#ff8000');
  });

  it('scales the offered widths and sizes with the picture', () => {
    expect(strokeWidths({ width: 4000, height: 3000 })).toEqual([8, 16, 32, 64]);
    expect(strokeWidths({ width: 200, height: 100 })).toEqual([1, 1, 2, 3]);
    expect(textSizes({ width: 1000, height: 800 })).toEqual([24, 40, 64, 96]);
    expect(textSizes({ width: 100, height: 100 })[0]).toBe(8);
  });
});

describe('edit image', () => {
  const source = { width: 4000, height: 3000 };

  it('turns in quarters, and a new size turns with the picture', () => {
    expect(turn(NO_ADJUST, 1).turn).toBe('right');
    expect(turn(NO_ADJUST, -1).turn).toBe('left');
    expect(turn(turn(NO_ADJUST, 1), 1).turn).toBe('half');
    const sized = { ...NO_ADJUST, resize: [2000, 1500] as [number, number] };
    expect(turn(sized, 1).resize).toEqual([1500, 2000]);
    expect(outputSize(source, turn(NO_ADJUST, 1))).toEqual({ width: 3000, height: 4000 });
  });

  it('keeps the proportions while resizing unless told not to', () => {
    expect(resize(NO_ADJUST, source, 'width', 2000, true).resize).toEqual([2000, 1500]);
    expect(resize(NO_ADJUST, source, 'height', 600, true).resize).toEqual([800, 600]);
    expect(resize(NO_ADJUST, source, 'width', 2000, false).resize).toEqual([2000, 3000]);
    // Back to the picture's own size is no resize at all.
    expect(resize(NO_ADJUST, source, 'width', 4000, true).resize).toBeNull();
    // A turned picture keeps its turned proportions.
    expect(resize(turn(NO_ADJUST, 1), source, 'width', 1500, true).resize).toEqual([1500, 2000]);
    expect(resize(NO_ADJUST, source, 'width', 0, true).resize).toEqual([1, 1]);
  });

  it('knows when nothing changes', () => {
    expect(isUnchanged(NO_ADJUST)).toBe(true);
    expect(isUnchanged({ ...NO_ADJUST, contrast: 1 })).toBe(false);
    expect(isUnchanged(turn(turn(turn(turn(NO_ADJUST, 1), 1), 1), 1))).toBe(true);
  });
});
