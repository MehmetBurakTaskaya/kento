// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { keyAction } from './keys';

const moveTo = (key: string, current: number | null, dir: 'ltr' | 'rtl', count = 8) => {
  const action = keyAction(key, current, count, dir);
  return action?.type === 'move' ? action.index : null;
};

describe('wheel keyboard', () => {
  it('uses Down and Up as next and previous in both directions, round the dial', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      expect(moveTo('ArrowDown', 2, dir)).toBe(3);
      expect(moveTo('ArrowUp', 2, dir)).toBe(1);
      expect(moveTo('ArrowDown', 7, dir)).toBe(0);
      expect(moveTo('ArrowUp', 0, dir, 3)).toBe(2);
    }
  });

  it('starts next to where the dial is parked', () => {
    expect(moveTo('ArrowDown', null, 'ltr')).toBe(0);
    expect(moveTo('ArrowUp', null, 'ltr')).toBe(7);
    expect(moveTo('ArrowDown', null, 'rtl')).toBe(0);
  });

  it('opens a slice’s choices with the arrow in the reading direction, mirrored right to left', () => {
    expect(keyAction('ArrowRight', 2, 8, 'ltr')).toEqual({ type: 'open' });
    expect(keyAction('ArrowLeft', 2, 8, 'rtl')).toEqual({ type: 'open' });
    // Nothing to open while no slice is chosen.
    expect(keyAction('ArrowRight', null, 8, 'ltr')).toBeNull();
    // The other arrow goes back, but only from a ring a level in.
    expect(keyAction('ArrowLeft', 2, 8, 'ltr')).toBeNull();
    expect(keyAction('ArrowLeft', 2, 8, 'ltr', 1)).toEqual({ type: 'back' });
    expect(keyAction('ArrowRight', 2, 8, 'rtl', 2)).toEqual({ type: 'back' });
  });

  it('goes back with Esc and Backspace a level in; Esc and Tab close at the first level', () => {
    expect(keyAction('Escape', null, 8, 'ltr')).toEqual({ type: 'close' });
    expect(keyAction('Escape', 3, 8, 'ltr', 1)).toEqual({ type: 'back' });
    expect(keyAction('Backspace', null, 8, 'ltr')).toBeNull();
    expect(keyAction('Backspace', null, 8, 'ltr', 1)).toEqual({ type: 'back' });
    expect(keyAction('Tab', 3, 8, 'rtl')).toEqual({ type: 'close' });
    expect(keyAction('Tab', 3, 8, 'rtl', 1)).toEqual({ type: 'close' });
  });

  it('jumps with Home and End, applies with Enter or Space, and pages', () => {
    expect(moveTo('Home', 5, 'ltr')).toBe(0);
    expect(moveTo('End', 0, 'rtl', 5)).toBe(4);
    expect(keyAction('Enter', 2, 8, 'ltr')).toEqual({ type: 'apply' });
    expect(keyAction(' ', 2, 8, 'ltr')).toEqual({ type: 'apply' });
    expect(keyAction('Enter', null, 8, 'ltr')).toBeNull();
    expect(keyAction('PageDown', 0, 8, 'ltr')).toEqual({ type: 'page', delta: 1 });
    expect(keyAction('PageUp', 0, 8, 'rtl')).toEqual({ type: 'page', delta: -1 });
    expect(keyAction('a', 0, 8, 'ltr')).toBeNull();
    expect(keyAction('ArrowDown', null, 0, 'ltr')).toBeNull();
  });
});
