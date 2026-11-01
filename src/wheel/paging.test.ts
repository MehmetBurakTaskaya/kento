// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { clampPage, pageCount, pageItems, PAGE_SIZE } from './paging';

const list = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);
const ids = (items: ReturnType<typeof pageItems<string>>) =>
  items.map((item) => (item.type === 'slice' ? item.slice : item.wraps ? 'first' : `more+${item.remaining}`));

describe('paging', () => {
  it('shows up to eight slices on one ring', () => {
    for (const n of [0, 1, 5, 8]) {
      expect(pageCount(n)).toBe(1);
      expect(ids(pageItems(list(n), 0))).toEqual(list(n));
    }
  });

  it('pages past eight: seven slices and a "More…" slice, which goes back to the start on the last page', () => {
    expect(pageCount(9)).toBe(2);
    expect(ids(pageItems(list(9), 0))).toEqual([...list(7), 'more+2']);
    expect(ids(pageItems(list(9), 1))).toEqual(['s7', 's8', 'first']);
    expect(pageItems(list(9), 0).at(-1)).toMatchObject({ type: 'more', target: 1, wraps: false });
    expect(pageItems(list(9), 1).at(-1)).toMatchObject({ type: 'more', target: 0, wraps: true });
  });

  it('walks through every slice exactly once', () => {
    for (const n of [9, 14, 15, 31]) {
      const seen: string[] = [];
      for (let p = 0; p < pageCount(n); p++) {
        const items = pageItems(list(n), p);
        expect(items.length).toBeLessThanOrEqual(PAGE_SIZE + 1);
        for (const item of items) if (item.type === 'slice') seen.push(item.slice);
      }
      expect(seen).toEqual(list(n));
    }
    expect(pageCount(31)).toBe(5);
    expect(ids(pageItems(list(31), 3)).at(-1)).toBe('more+3');
  });

  it('keeps the page inside the list when it shrinks', () => {
    expect(clampPage(4, 9)).toBe(1);
    expect(clampPage(-1, 20)).toBe(0);
    expect(clampPage(2, 8)).toBe(0);
    expect(ids(pageItems(list(9), 7))).toEqual(['s7', 's8', 'first']);
  });
});
