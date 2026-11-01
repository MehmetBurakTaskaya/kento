// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { keyAction } from './keys';

const moveTo = (key: string, current: number | null, dir: 'ltr' | 'rtl', count = 8) => {
  const action = keyAction(key, current, count, dir);
  return action?.type === 'move' ? action.index : null;
};

describe('wheel keyboard', () => {
  it('turns clockwise with Right and counterclockwise with Left, left to right', () => {
    expect(moveTo('ArrowRight', 0, 'ltr')).toBe(1);
    expect(moveTo('ArrowLeft', 1, 'ltr')).toBe(0);
    expect(moveTo('ArrowRight', 7, 'ltr')).toBe(0);
    expect(moveTo('ArrowLeft', 0, 'ltr')).toBe(7);
  });

  it('follows the visual direction right to left, where the slices run counterclockwise', () => {
    // Slice 2 sits counterclockwise of slice 1, so Right (clockwise) steps back through the list.
    expect(moveTo('ArrowRight', 1, 'rtl')).toBe(0);
    expect(moveTo('ArrowLeft', 0, 'rtl')).toBe(1);
    expect(moveTo('ArrowRight', 0, 'rtl')).toBe(7);
    expect(moveTo('ArrowLeft', 7, 'rtl')).toBe(0);
  });

  it('starts next to where the dial is parked', () => {
    expect(moveTo('ArrowRight', null, 'ltr')).toBe(0);
    expect(moveTo('ArrowLeft', null, 'ltr')).toBe(7);
    expect(moveTo('ArrowLeft', null, 'rtl')).toBe(0);
    expect(moveTo('ArrowRight', null, 'rtl')).toBe(7);
    expect(moveTo('ArrowDown', null, 'rtl')).toBe(0);
  });

  it('uses Up and Down as previous and next in both directions', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      expect(moveTo('ArrowDown', 2, dir)).toBe(3);
      expect(moveTo('ArrowUp', 2, dir)).toBe(1);
      expect(moveTo('ArrowUp', 0, dir, 3)).toBe(2);
    }
  });

  it('jumps with Home and End, applies with Enter or Space and closes with Esc or Tab', () => {
    expect(moveTo('Home', 5, 'ltr')).toBe(0);
    expect(moveTo('End', 0, 'rtl', 5)).toBe(4);
    expect(keyAction('Enter', 2, 8, 'ltr')).toEqual({ type: 'apply' });
    expect(keyAction(' ', 2, 8, 'ltr')).toEqual({ type: 'apply' });
    expect(keyAction('Enter', null, 8, 'ltr')).toBeNull();
    expect(keyAction('Escape', null, 8, 'ltr')).toEqual({ type: 'close' });
    expect(keyAction('Tab', 3, 8, 'rtl')).toEqual({ type: 'close' });
  });

  it('goes back with Backspace only in a sub-wheel, and pages with Page Up and Page Down', () => {
    expect(keyAction('Backspace', null, 8, 'ltr')).toBeNull();
    expect(keyAction('Backspace', null, 8, 'ltr', true)).toEqual({ type: 'back' });
    expect(keyAction('PageDown', 0, 8, 'ltr')).toEqual({ type: 'page', delta: 1 });
    expect(keyAction('PageUp', 0, 8, 'rtl')).toEqual({ type: 'page', delta: -1 });
    expect(keyAction('a', 0, 8, 'ltr')).toBeNull();
    expect(keyAction('ArrowRight', null, 0, 'ltr')).toBeNull();
  });
});
