// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { clampArea, drawArea, fitRatio, fullArea, moveArea, resizeArea, roundArea, sameArea, type Size } from './crop';
import { allowed, editorKey, keyScope, type KeyInput } from './keys';
import {
  hexToRgb,
  lengthAtSpeed,
  peaksAround,
  resamplePeaks,
  sliderFromSpeed,
  SPEED_PRESETS,
  speedFromSlider,
} from './levels';
import { addPoint, addSpan, dragEnd, dragStart, isFull, setEnd, setStart } from './spans';
import { countParts, keepFlags, MAX_PARTS, partKey, splitParts } from './split';
import { fineStep, formatTime, tickStep, ticks } from './time';

describe('time', () => {
  it('reads mm:ss.s in the language’s decimal sign', () => {
    expect(formatTime(83.44, 'en')).toBe('01:23.4');
    expect(formatTime(83.44, 'tr')).toBe('01:23,4');
    expect(formatTime(0, 'en')).toBe('00:00.0');
    expect(formatTime(-3, 'en')).toBe('00:00.0');
    expect(formatTime(Number.NaN, 'en')).toBe('00:00.0');
  });

  it('rounds once, so the seconds never read 60', () => {
    expect(formatTime(59.96, 'en')).toBe('01:00.0');
    expect(formatTime(3599.97, 'en')).toBe('1:00:00.0');
    expect(formatTime(3723.4, 'en')).toBe('1:02:03.4');
  });

  it('uses the language’s digits', () => {
    expect(formatTime(83.4, 'ar-EG')).toMatch(/^[٠-٩]{2}:[٠-٩]{2}٫[٠-٩]$/);
    // The pseudo-languages format like English.
    expect(formatTime(83.4, 'ar-XB')).toBe('01:23.4');
  });

  it('drops the tenths for the ruler', () => {
    expect(formatTime(90, 'en', false)).toBe('01:30');
  });

  it('steps one frame for video and a tenth for audio', () => {
    const info = { duration: 10, video: { width: 1, height: 1, fps: 25, codec: 'h264' }, audio: null };
    expect(fineStep(info, false)).toBeCloseTo(0.04);
    expect(fineStep(info, true)).toBe(0.1);
    expect(fineStep(null, false)).toBe(0.1);
  });

  it('spaces ruler ticks so labels do not touch', () => {
    expect(tickStep(95.4, 800)).toBe(10);
    expect(tickStep(4, 800)).toBe(0.5);
    expect(tickStep(0, 800)).toBe(7200);
    expect(ticks(95.4, 10)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(ticks(1, 0.2)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe('spans', () => {
  const all = { start: 0, end: 100 };

  it('sets the start and end at the playhead', () => {
    expect(setStart(all, 20, 100)).toEqual({ start: 20, end: 100 });
    expect(setEnd({ start: 20, end: 100 }, 60, 100)).toEqual({ start: 20, end: 60 });
  });

  it('moves the other end away when I or O passes it', () => {
    expect(setStart({ start: 10, end: 30 }, 50, 100)).toEqual({ start: 50, end: 100 });
    expect(setEnd({ start: 50, end: 100 }, 20, 100)).toEqual({ start: 0, end: 20 });
    expect(setStart(all, 100, 100).start).toBeCloseTo(99.9);
    expect(setEnd(all, 0, 100).end).toBeCloseTo(0.1);
  });

  it('stops dragged handles short of each other', () => {
    expect(dragStart({ start: 10, end: 30 }, 50)).toEqual({ start: 29.9, end: 30 });
    expect(dragEnd({ start: 10, end: 30 }, 5, 100)).toEqual({ start: 10, end: 10.1 });
    expect(dragEnd({ start: 10, end: 30 }, 500, 100)).toEqual({ start: 10, end: 100 });
  });

  it('knows a selection of the whole file', () => {
    expect(isFull(all, 100)).toBe(true);
    expect(isFull({ start: 0.02, end: 99.97 }, 100)).toBe(true);
    expect(isFull({ start: 1, end: 100 }, 100)).toBe(false);
  });

  it('merges overlapping and touching spans in order', () => {
    expect(addSpan([{ start: 10, end: 20 }], { start: 30, end: 40 })).toEqual([
      { start: 10, end: 20 },
      { start: 30, end: 40 },
    ]);
    expect(addSpan([{ start: 30, end: 40 }], { start: 15, end: 30 })).toEqual([{ start: 15, end: 40 }]);
    expect(addSpan([], { start: 5, end: 2 })).toEqual([{ start: 2, end: 5 }]);
    expect(addSpan([], { start: 5, end: 5 })).toEqual([]);
  });

  it('adds points in order, skipping repeats and, for markers, the ends', () => {
    expect(addPoint([10, 30], 20, 100, 0.1)).toEqual([10, 20, 30]);
    expect(addPoint([10], 10.05, 100, 0.1)).toEqual([10]);
    expect(addPoint([], 0, 100, 0.1, false)).toEqual([]);
    expect(addPoint([], 0, 100, 0.1)).toEqual([0]);
    expect(addPoint([], 120, 100, 0.1)).toEqual([100]);
  });
});

describe('split', () => {
  it('cuts at markers inside the file', () => {
    expect(splitParts({ kind: 'markers', at: [30, 10, 10, 0, 100] }, 100)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 30 },
      { start: 30, end: 100 },
    ]);
    expect(countParts({ kind: 'markers', at: [] }, 100)).toBe(1);
  });

  it('makes equal parts', () => {
    const parts = splitParts({ kind: 'parts', count: 3 }, 90);
    expect(parts).toEqual([
      { start: 0, end: 30 },
      { start: 30, end: 60 },
      { start: 60, end: 90 },
    ]);
  });

  it('cuts every n seconds, the last part shorter', () => {
    expect(splitParts({ kind: 'every', seconds: 40 }, 95.4)).toEqual([
      { start: 0, end: 40 },
      { start: 40, end: 80 },
      { start: 80, end: 95.4 },
    ]);
    expect(countParts({ kind: 'every', seconds: 10 }, 100)).toBe(10);
    expect(countParts({ kind: 'every', seconds: 0.01 }, 3600)).toBeGreaterThan(MAX_PARTS);
  });

  it('remembers dropped parts by their start', () => {
    const before = splitParts({ kind: 'markers', at: [50] }, 100);
    const dropped = new Set([partKey(before[1]!)]);
    expect(keepFlags(before, dropped)).toEqual([true, false]);
    // A marker in the first part leaves the dropped second part dropped.
    const after = splitParts({ kind: 'markers', at: [20, 50] }, 100);
    expect(keepFlags(after, dropped)).toEqual([true, true, false]);
  });
});

describe('crop', () => {
  const frame: Size = { width: 1920, height: 1080 };

  it('fits a ratio as large as the frame allows, around a point', () => {
    expect(fitRatio(frame, 1)).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
    expect(fitRatio(frame, 16 / 9)).toEqual(fullArea(frame));
    const tall = fitRatio(frame, 9 / 16, { x: 0, y: 540 });
    expect(tall.x).toBe(0);
    expect(tall.height).toBe(1080);
    expect(tall.width).toBeCloseTo(607.5);
  });

  it('draws inside the frame in any direction', () => {
    expect(drawArea({ x: 100, y: 100 }, { x: 300, y: 200 }, frame, null)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });
    expect(drawArea({ x: 100, y: 100 }, { x: -50, y: 40 }, frame, null)).toEqual({
      x: 0,
      y: 40,
      width: 100,
      height: 60,
    });
  });

  it('keeps a ratio while drawing, the larger direction leading', () => {
    const square = drawArea({ x: 100, y: 100 }, { x: 300, y: 150 }, frame, 1);
    expect(square).toEqual({ x: 100, y: 100, width: 200, height: 200 });
    // Near the bottom edge the square shrinks to the room left.
    const edge = drawArea({ x: 100, y: 1000 }, { x: 400, y: 1050 }, frame, 1);
    expect(edge).toEqual({ x: 100, y: 1000, width: 80, height: 80 });
  });

  it('resizes from a corner and from an edge', () => {
    const start = { x: 100, y: 100, width: 200, height: 100 };
    expect(resizeArea(start, 'se', { x: 500, y: 300 }, frame, null)).toEqual({
      x: 100,
      y: 100,
      width: 400,
      height: 200,
    });
    expect(resizeArea(start, 'w', { x: 50, y: 0 }, frame, null)).toEqual({ x: 50, y: 100, width: 250, height: 100 });
    // Past the opposite edge the side flips over.
    expect(resizeArea(start, 'e', { x: 0, y: 0 }, frame, null)).toEqual({ x: 0, y: 100, width: 100, height: 100 });
  });

  it('keeps the ratio from an edge, centred across', () => {
    const start = { x: 100, y: 100, width: 200, height: 100 };
    const wider = resizeArea(start, 'e', { x: 500, y: 0 }, frame, 2);
    expect(wider).toEqual({ x: 100, y: 50, width: 400, height: 200 });
    // There is room for a height of 300 around y = 150 only, so the width stops at 600.
    const capped = resizeArea(start, 'e', { x: 1500, y: 0 }, frame, 2);
    expect(capped).toEqual({ x: 100, y: 0, width: 600, height: 300 });
  });

  it('moves and clamps inside the frame', () => {
    const start = { x: 100, y: 100, width: 200, height: 100 };
    expect(moveArea(start, -500, 2000, frame)).toEqual({ x: 0, y: 980, width: 200, height: 100 });
    expect(clampArea({ x: 1915, y: -10, width: 3, height: 5000 }, frame)).toEqual({
      x: 1912,
      y: 0,
      width: 8,
      height: 1080,
    });
  });

  it('rounds to whole pixels with even sides', () => {
    expect(roundArea({ x: 10.4, y: 20.6, width: 301.7, height: 99.2 }, frame)).toEqual({
      x: 10,
      y: 21,
      width: 302,
      height: 98,
    });
    expect(roundArea({ x: 1800, y: 0, width: 200, height: 1080 }, { width: 1919, height: 1080 })).toEqual({
      x: 1719,
      y: 0,
      width: 200,
      height: 1080,
    });
    expect(sameArea(fullArea(frame), { x: 0.2, y: 0, width: 1920, height: 1079.6 })).toBe(true);
  });
});

describe('keys', () => {
  const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  });

  it('follows the shared layout', () => {
    expect(editorKey(press(' '), false, 0.04)).toEqual({ type: 'toggle' });
    expect(editorKey(press(' ', { shiftKey: true }), false, 0.04)).toEqual({ type: 'play-selection' });
    expect(editorKey(press('ArrowLeft'), false, 0.04)).toEqual({ type: 'step', seconds: -1 });
    expect(editorKey(press('ArrowRight'), false, 0.04)).toEqual({ type: 'step', seconds: 1 });
    expect(editorKey(press('ArrowRight', { shiftKey: true }), false, 0.04)).toEqual({ type: 'step', seconds: 0.04 });
    expect(editorKey(press('ArrowLeft', { shiftKey: true }), false, 0.1)).toEqual({ type: 'step', seconds: -0.1 });
    expect(editorKey(press('i'), false, 0.1)).toEqual({ type: 'in' });
    expect(editorKey(press('O', { shiftKey: true }), false, 0.1)).toEqual({ type: 'out' });
    expect(editorKey(press('m'), false, 0.1)).toEqual({ type: 'marker' });
    expect(editorKey(press('Home'), false, 0.1)).toEqual({ type: 'start' });
    expect(editorKey(press('End'), false, 0.1)).toEqual({ type: 'end' });
    expect(editorKey(press('Escape'), false, 0.1)).toEqual({ type: 'close' });
  });

  it('reads I on Turkish layouts', () => {
    expect(editorKey(press('ı'), false, 0.1)).toEqual({ type: 'in' });
    expect(editorKey(press('İ', { shiftKey: true }), false, 0.1)).toEqual({ type: 'in' });
  });

  it('saves with Ctrl+S, or ⌘S on macOS, on any layout', () => {
    expect(editorKey(press('s', { ctrlKey: true }), false, 0.1)).toEqual({ type: 'save' });
    expect(editorKey(press('ы', { ctrlKey: true, code: 'KeyS' }), false, 0.1)).toEqual({ type: 'save' });
    expect(editorKey(press('s', { metaKey: true }), true, 0.1)).toEqual({ type: 'save' });
    expect(editorKey(press('s', { ctrlKey: true }), true, 0.1)).toBeNull();
    expect(editorKey(press('s'), false, 0.1)).toBeNull();
  });

  it('leaves other shortcuts alone', () => {
    expect(editorKey(press('ArrowLeft', { altKey: true }), false, 0.1)).toBeNull();
    expect(editorKey(press('i', { ctrlKey: true }), false, 0.1)).toBeNull();
    expect(editorKey(press('x'), false, 0.1)).toBeNull();
  });

  it('gives fields their keys and buttons their Space', () => {
    const field = document.createElement('input');
    const box = document.createElement('input');
    box.type = 'checkbox';
    const button = document.createElement('button');
    const radio = document.createElement('input');
    radio.type = 'radio';
    const slider = document.createElement('div');
    slider.setAttribute('role', 'slider');
    expect(keyScope(field)).toBe('commands');
    expect(keyScope(radio)).toBe('commands');
    expect(keyScope(box)).toBe('no-activation');
    expect(keyScope(button)).toBe('no-activation');
    expect(keyScope(slider)).toBe('all');
    expect(allowed({ type: 'step', seconds: 1 }, 'commands')).toBe(false);
    expect(allowed({ type: 'save' }, 'commands')).toBe(true);
    expect(allowed({ type: 'toggle' }, 'no-activation')).toBe(false);
    expect(allowed({ type: 'play-selection' }, 'no-activation')).toBe(true);
    expect(allowed({ type: 'in' }, 'no-activation')).toBe(true);
  });
});

describe('levels', () => {
  it('maps the speed slider on a log scale with round steps', () => {
    expect(sliderFromSpeed(1)).toBe(0);
    expect(sliderFromSpeed(4)).toBe(2);
    expect(sliderFromSpeed(10)).toBe(2);
    for (const preset of SPEED_PRESETS) expect(speedFromSlider(sliderFromSpeed(preset))).toBe(preset);
    expect(speedFromSlider(0.3)).toBe(1.25);
    expect(lengthAtSpeed(90, 2)).toBe(45);
  });

  it('resamples peaks to the highest of each group', () => {
    expect(resamplePeaks([0.1, 0.5, 0.2, 0.9], 2)).toEqual([0.5, 0.9]);
    expect(resamplePeaks([0.4, 0.8], 4)).toEqual([0.4, 0.4, 0.8, 0.8]);
    expect(resamplePeaks([], 3)).toEqual([]);
  });

  it('reads a color input as RGB', () => {
    expect(hexToRgb('#1a2B3c')).toEqual([26, 43, 60]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('nonsense')).toEqual([0, 0, 0]);
  });

  it('takes the peaks around a moment', () => {
    expect(peaksAround([0, 0.1, 0.2, 0.3, 0.4], 5, 10, 3)).toEqual([0.1, 0.2, 0.3]);
    expect(peaksAround([0.5, 0.6], 0, 10, 3)).toEqual([0, 0.5, 0.6]);
  });
});
