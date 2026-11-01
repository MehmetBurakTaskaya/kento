// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { move } from './OrderList';
import { parseRanges } from './ranges';

describe('page ranges', () => {
  it('read single pages, ranges and dashes people type', () => {
    expect(parseRanges('1-3, 5, 8–10', 10)).toEqual([
      [1, 3],
      [5, 5],
      [8, 10],
    ]);
    expect(parseRanges(' 2 ;4 - 4 ', 4)).toEqual([
      [2, 2],
      [4, 4],
    ]);
  });

  it('refuse pages outside the document and backwards ranges', () => {
    expect(parseRanges('0', 5)).toBeNull();
    expect(parseRanges('4-6', 5)).toBeNull();
    expect(parseRanges('3-1', 5)).toBeNull();
    expect(parseRanges('a', 5)).toBeNull();
    expect(parseRanges('', 5)).toBeNull();
  });
});

describe('ordering', () => {
  it('moves an item and ignores moves past the ends', () => {
    expect(move(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(move(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    const same = ['a', 'b'];
    expect(move(same, 0, -1)).toBe(same);
    expect(move(same, 1, 2)).toBe(same);
  });
});
