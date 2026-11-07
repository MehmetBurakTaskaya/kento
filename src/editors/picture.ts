// SPDX-License-Identifier: MIT
// Numbers behind the editors of the picture tools: Make vertical's 9:16 window, the turns of Rotate
// video, the length of Reverse and loop and the colour map of Color and look. The engine works the
// same numbers out (src-tauri/engines/src/media/tools/picture.rs and picture/color.rs), so what the
// editor shows is what the video gets.
import { useState } from 'react';
import { api, type Area, type Grade, type Look, type LoopMode, type Turn } from '../ipc';
import { useBlobUrl } from './controls';
import type { Size } from './crop';
import { clamp } from './time';

/**
 * A still of the video at the playhead, `size` pixels on its longer side, taken again once the
 * playhead stops somewhere else (not on every frame while it plays).
 */
export function useStill(path: string, at: number, playing: boolean, size: number): string | null {
  const [shown, setShown] = useState(at);
  if (!playing && Math.abs(shown - at) >= 0.05) setShown(at);
  const moment = Math.round(shown * 10) / 10;
  return useBlobUrl(() => api.mediaFrame(path, moment, size), `${path}|${moment}|${size}`);
}

/** Make vertical always writes this size. */
export const VERTICAL: Size = { width: 1080, height: 1920 };
/** Results longer than these run past what some apps take for short videos. */
export const SHORT_LIMITS = [60, 180] as const;

/** Down to an even whole number, 0 at least. */
const even = (value: number) => Math.floor(Math.max(0, value) / 2) * 2;
const side = (value: number) => Math.max(2, even(value));

/**
 * Make vertical's 9:16 window, on even pixels: the full height with its middle at `center` of the
 * width (0 the left edge, 1 the right), or on a picture narrower than 9:16 the full width in the
 * middle of the height.
 */
export function portraitWindow(center: number, frame: Size): Area {
  const { width, height } = frame;
  if (width * 16 > height * 9) {
    const w = side((height * 9) / 16);
    const middle = (Number.isFinite(center) ? clamp(center, 0, 1) : 0.5) * width;
    return { x: even(clamp(middle - w / 2, 0, width - w)), y: 0, width: w, height: side(height) };
  }
  const h = clamp(side((width * 16) / 9), 2, side(height));
  return { x: 0, y: even((height - h) / 2), width: side(width), height: h };
}

/** The `center` that puts the window's middle where an area's middle is. */
export const centerOf = (area: Area, frame: Size) =>
  frame.width > 0 ? clamp((area.x + area.width / 2) / frame.width, 0, 1) : 0.5;

/** How the window sits across the picture, 0 to 1, for `object-position` in a portrait preview. */
export function windowPosition(window: Area, frame: Size): number {
  const room = frame.width - window.width;
  return room > 0 ? clamp(window.x / room, 0, 1) : 0.5;
}

/** Whether a video already stands upright. */
export const isUpright = (frame: Size) => frame.height > frame.width;

/** Which short-video length a result runs past: the longest, or null. */
export function pastLimit(seconds: number): (typeof SHORT_LIMITS)[number] | null {
  for (const limit of [...SHORT_LIMITS].reverse()) if (seconds > limit + 0.05) return limit;
  return null;
}

const TURNS: Turn[] = ['none', 'right', 'half', 'left'];

/** A quarter turn more to the right (`step` 1) or to the left (-1). */
export function turnBy(turn: Turn, step: number): Turn {
  const index = TURNS.indexOf(turn);
  return TURNS[(((index + step) % 4) + 4) % 4]!;
}

const DEGREES: Record<Turn, number> = { none: 0, right: 90, half: 180, left: 270 };

/** Whether a turn, a mirror and a flip together change nothing (a half turn is a mirror and a flip). */
export const unchanged = (turn: Turn, mirror: boolean, flip: boolean) =>
  turn === 'none' ? !mirror && !flip : turn === 'half' && mirror && flip;

export const isQuarter = (turn: Turn) => turn === 'right' || turn === 'left';

/** The CSS transform that shows the picture as the result will be: turned, then mirrored, then flipped. */
export function turnTransform(turn: Turn, mirror: boolean, flip: boolean): string {
  // CSS applies a transform list from the right, so the turn comes last.
  const parts = [flip ? 'scaleY(-1)' : '', mirror ? 'scaleX(-1)' : '', `rotate(${DEGREES[turn]}deg)`];
  return parts.filter(Boolean).join(' ');
}

export const MAX_LOOPS = 10;

/** The length of Reverse and loop's result. */
export function loopLength(mode: LoopMode, count: number, duration: number): number {
  const times = clamp(Math.round(count), 1, MAX_LOOPS);
  if (mode === 'reverse') return duration;
  return mode === 'boomerang' ? 2 * duration * times : duration * times;
}

export const LOOKS: Look[] = ['none', 'black-white', 'warm', 'cool', 'vivid', 'faded', 'vintage'];

export const FLAT: Grade = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };

/** `out = matrix · rgb + offset` on values from 0 to 1, clamped once at the end. */
export interface ColorMap {
  matrix: number[][];
  offset: number[];
}

const BRIGHTNESS = 0.5;
const CONTRAST = 0.5;
const WARMTH = [0.14, 0.03, -0.16];
const LUMA = [0.213, 0.715, 0.072];
const SEPIA = [
  [0.393, 0.769, 0.189],
  [0.349, 0.686, 0.168],
  [0.272, 0.534, 0.131],
];

type Step =
  | ['brightness', number]
  | ['contrast', number]
  | ['saturation', number]
  | ['warmth', number]
  | ['sepia', number]
  | ['fade', number];

const LOOK_STEPS: Record<Look, Step[]> = {
  none: [],
  'black-white': [
    ['saturation', 0],
    ['contrast', 1.1],
  ],
  warm: [
    ['warmth', 0.6],
    ['saturation', 1.08],
  ],
  cool: [
    ['warmth', -0.6],
    ['contrast', 1.04],
  ],
  vivid: [
    ['saturation', 1.45],
    ['contrast', 1.12],
  ],
  faded: [
    ['saturation', 0.7],
    ['fade', 0.12],
  ],
  vintage: [
    ['sepia', 0.4],
    ['fade', 0.08],
    ['warmth', 0.25],
    ['contrast', 0.95],
  ],
};

const diagonal = (gains: number[], offset: number): ColorMap => ({
  matrix: [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? gains[i]! : 0))),
  offset: [offset, offset, offset],
});

function stepMap([kind, value]: Step): ColorMap {
  switch (kind) {
    case 'brightness':
      return diagonal([value, value, value], 0);
    case 'contrast':
      return diagonal([value, value, value], 0.5 * (1 - value));
    case 'saturation':
      return {
        matrix: [0, 1, 2].map((i) => [0, 1, 2].map((j) => LUMA[j]! * (1 - value) + (i === j ? value : 0))),
        offset: [0, 0, 0],
      };
    case 'warmth':
      return diagonal(
        WARMTH.map((gain) => 1 + gain * value),
        0,
      );
    case 'sepia':
      return {
        matrix: [0, 1, 2].map((i) => [0, 1, 2].map((j) => SEPIA[i]![j]! * value + (i === j ? 1 - value : 0))),
        offset: [0, 0, 0],
      };
    case 'fade':
      return diagonal([1 - 1.5 * value, 1 - 1.5 * value, 1 - 1.5 * value], value);
  }
}

/** `next` applied after `first`. */
function after(next: ColorMap, first: ColorMap): ColorMap {
  const row = (i: number, column: number[]) => [0, 1, 2].reduce((sum, k) => sum + next.matrix[i]![k]! * column[k]!, 0);
  return {
    matrix: [0, 1, 2].map((i) =>
      [0, 1, 2].map((j) =>
        row(
          i,
          [0, 1, 2].map((k) => first.matrix[k]![j]!),
        ),
      ),
    ),
    offset: [0, 1, 2].map((i) => row(i, first.offset) + next.offset[i]!),
  };
}

const IDENTITY: ColorMap = diagonal([1, 1, 1], 0);

const slider = (value: number) => (Number.isFinite(value) ? clamp(value, -100, 100) / 100 : 0);

/** The look first, then brightness, contrast, saturation and warmth. */
export function colorMap(look: Look, grade: Grade): ColorMap {
  const steps: Step[] = [
    ...LOOK_STEPS[look],
    ['brightness', 1 + BRIGHTNESS * slider(grade.brightness)],
    ['contrast', 1 + CONTRAST * slider(grade.contrast)],
    ['saturation', 1 + slider(grade.saturation)],
    ['warmth', slider(grade.warmth)],
  ];
  return steps.reduce((map, step) => after(stepMap(step), map), IDENTITY);
}

export function applyColor(map: ColorMap, rgb: number[]): number[] {
  return [0, 1, 2].map((i) =>
    clamp(
      [0, 1, 2].reduce((sum, j) => sum + map.matrix[i]![j]! * rgb[j]!, map.offset[i]!),
      0,
      1,
    ),
  );
}

export const isPlain = (map: ColorMap) =>
  [0, 1, 2].every(
    (i) =>
      Math.abs(map.offset[i]!) < 1e-4 &&
      [0, 1, 2].every((j) => Math.abs(map.matrix[i]![j]! - (i === j ? 1 : 0)) < 1e-4),
  );

/** The 20 values of an SVG `feColorMatrix` that does the same (alpha untouched). */
export function svgMatrix(map: ColorMap): string {
  const rows = [0, 1, 2].map((i) => [...map.matrix[i]!, 0, map.offset[i]!]);
  return [...rows, [0, 0, 0, 1, 0]]
    .flat()
    .map((value) => String(Math.round(value * 10000) / 10000))
    .join(' ');
}
