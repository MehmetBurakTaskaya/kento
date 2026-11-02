// SPDX-License-Identifier: MIT
// The wheel's keyboard (SPEC 5.3), the keys of a menu with submenus: Down and Up step to the next
// and previous slice (round the dial in reading order), Home and End jump to the first and last,
// Enter or Space applies, or opens the choices of a slice that has them. The arrow in the reading
// direction (Right, or Left in right-to-left layouts) opens a slice's choices; the other one, Esc
// and Backspace go back a level. Esc closes the wheel at the first level, and Tab always does.
import type { Direction } from './geometry';

export type KeyAction =
  | { type: 'move'; index: number }
  | { type: 'apply' }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'back' }
  | { type: 'page'; delta: 1 | -1 };

function step(current: number | null, delta: 1 | -1, count: number): number {
  // From rest the first press lands next to the dial's parking spot: slice 1 going forward, the
  // last slice going back.
  if (current === null) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** `depth` is how many levels the wheel is in: 0 on its first ring. */
export function keyAction(
  key: string,
  current: number | null,
  count: number,
  dir: Direction,
  depth = 0,
): KeyAction | null {
  const move = (delta: 1 | -1): KeyAction | null =>
    count > 0 ? { type: 'move', index: step(current, delta, count) } : null;
  const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  switch (key) {
    case 'ArrowDown':
      return move(1);
    case 'ArrowUp':
      return move(-1);
    case forward:
      return current === null ? null : { type: 'open' };
    case backward:
    case 'Backspace':
      return depth > 0 ? { type: 'back' } : null;
    case 'Home':
      return count > 0 ? { type: 'move', index: 0 } : null;
    case 'End':
      return count > 0 ? { type: 'move', index: count - 1 } : null;
    case 'Enter':
    case ' ':
      return current === null ? null : { type: 'apply' };
    case 'Escape':
      return depth > 0 ? { type: 'back' } : { type: 'close' };
    case 'Tab':
      return { type: 'close' };
    case 'PageDown':
      return { type: 'page', delta: 1 };
    case 'PageUp':
      return { type: 'page', delta: -1 };
    default:
      return null;
  }
}
