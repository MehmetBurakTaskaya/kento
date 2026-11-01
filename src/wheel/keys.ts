// SPDX-License-Identifier: MIT
// The wheel's keyboard (SPEC 5.3): arrows move between slices, Home and End jump to the first and
// last, Enter or Space applies, Esc or Tab closes. Left and Right follow the visual direction round
// the dial (Right turns clockwise), so in right-to-left layouts, where the slices run counterclockwise,
// they step backwards through the list. Up and Down are previous and next as in any menu.
import type { Direction } from './geometry';

export type KeyAction =
  | { type: 'move'; index: number }
  | { type: 'apply' }
  | { type: 'close' }
  | { type: 'back' }
  | { type: 'page'; delta: 1 | -1 };

function step(current: number | null, delta: 1 | -1, count: number): number {
  // From rest the first press lands next to the dial's parking spot: slice 1 going forward, the
  // last slice going back.
  if (current === null) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

export function keyAction(
  key: string,
  current: number | null,
  count: number,
  dir: Direction,
  canGoBack = false,
): KeyAction | null {
  const clockwise = dir === 'rtl' ? -1 : 1;
  const move = (delta: 1 | -1): KeyAction | null =>
    count > 0 ? { type: 'move', index: step(current, delta, count) } : null;
  switch (key) {
    case 'ArrowRight':
      return move(clockwise === 1 ? 1 : -1);
    case 'ArrowLeft':
      return move(clockwise === 1 ? -1 : 1);
    case 'ArrowDown':
      return move(1);
    case 'ArrowUp':
      return move(-1);
    case 'Home':
      return count > 0 ? { type: 'move', index: 0 } : null;
    case 'End':
      return count > 0 ? { type: 'move', index: count - 1 } : null;
    case 'Enter':
    case ' ':
      return current === null ? null : { type: 'apply' };
    case 'Escape':
    case 'Tab':
      return { type: 'close' };
    case 'Backspace':
      return canGoBack ? { type: 'back' } : null;
    case 'PageDown':
      return { type: 'page', delta: 1 };
    case 'PageUp':
      return { type: 'page', delta: -1 };
    default:
      return null;
  }
}
