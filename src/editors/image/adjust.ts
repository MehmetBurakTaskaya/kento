// SPDX-License-Identifier: MIT
// Edit image's choices: quarter turns, flips, a new size and the colour adjustments, in the
// order the engine applies them (turn, flip, resize, colour).
import type { Adjust } from '../../ipc';
import type { Size } from '../crop';
import { clamp } from '../time';

export const NO_ADJUST: Adjust = {
  turn: 'none',
  flipHorizontal: false,
  flipVertical: false,
  resize: null,
  brightness: 0,
  contrast: 0,
  saturation: 0,
};

/** The largest side a resize may ask for. */
export const MAX_SIDE = 20000;

const TURNS: Adjust['turn'][] = ['none', 'right', 'half', 'left'];

/** A quarter turn clockwise (1) or counterclockwise (-1); a new size turns with the picture. */
export function turn(adjust: Adjust, by: 1 | -1): Adjust {
  const index = (TURNS.indexOf(adjust.turn) + by + TURNS.length) % TURNS.length;
  const resize = adjust.resize ? ([adjust.resize[1], adjust.resize[0]] as [number, number]) : null;
  return { ...adjust, turn: TURNS[index]!, resize };
}

export const quarter = (value: Adjust['turn']) => value === 'left' || value === 'right';

/** The picture's size after its turn, before any resize. */
export const turnedSize = (source: Size, value: Adjust['turn']): Size =>
  quarter(value) ? { width: source.height, height: source.width } : source;

/** The size of the result. */
export function outputSize(source: Size, adjust: Adjust): Size {
  return adjust.resize ? { width: adjust.resize[0], height: adjust.resize[1] } : turnedSize(source, adjust.turn);
}

/**
 * A typed width or height. With the proportions kept, the other side follows the turned picture's
 * ratio. A size equal to the turned picture's is no resize at all.
 */
export function resize(adjust: Adjust, source: Size, side: 'width' | 'height', value: number, keep: boolean): Adjust {
  const base = turnedSize(source, adjust.turn);
  const current = outputSize(source, adjust);
  const typed = clamp(Math.round(value), 1, MAX_SIDE);
  let width = side === 'width' ? typed : current.width;
  let height = side === 'height' ? typed : current.height;
  if (keep) {
    if (side === 'width') height = clamp(Math.round((typed * base.height) / base.width), 1, MAX_SIDE);
    else width = clamp(Math.round((typed * base.width) / base.height), 1, MAX_SIDE);
  }
  const same = width === base.width && height === base.height;
  return { ...adjust, resize: same ? null : [width, height] };
}

export const isUnchanged = (adjust: Adjust) =>
  adjust.turn === 'none' &&
  !adjust.flipHorizontal &&
  !adjust.flipVertical &&
  adjust.resize === null &&
  adjust.brightness === 0 &&
  adjust.contrast === 0 &&
  adjust.saturation === 0;
