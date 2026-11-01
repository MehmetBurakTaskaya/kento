// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { fitLabel, layoutBlock, sizeFor, type Measure } from './labels';

// Every character is half an em wide.
const half: Measure = (text) => Array.from(text).length * 0.5;
const measures = { format: half, label: half, sub: half };

describe('label fitting', () => {
  it('keeps the full size when the label fits and shrinks in half steps when it does not', () => {
    expect(sizeFor(1.5, 72, 20.5, 8)).toBe(20.5);
    expect(sizeFor(5, 72, 20.5, 8)).toBe(14);
    expect(sizeFor(50, 72, 20.5, 8)).toBe(8);
    expect(fitLabel('PNG', { size: 20.5, minSize: 8, maxWidth: 72, maxLines: 1 }, half)).toEqual({
      lines: ['PNG'],
      size: 20.5,
    });
  });

  it('wraps to two lines when that keeps the label larger', () => {
    const fitted = fitLabel('Normalize loudness', { size: 12.8, minSize: 8, maxWidth: 72, maxLines: 2 }, half);
    expect(fitted.lines).toEqual(['Normalize', 'loudness']);
    expect(fitted.size).toBe(12.8);
  });

  it('stays on one line when asked to, or when a single word cannot wrap', () => {
    expect(fitLabel('Normalize loudness', { size: 12.8, minSize: 8, maxWidth: 72, maxLines: 1 }, half).lines).toEqual([
      'Normalize loudness',
    ]);
    expect(
      fitLabel('Ünbreakablelongword', { size: 12.8, minSize: 8, maxWidth: 72, maxLines: 2 }, half).lines,
    ).toHaveLength(1);
  });

  it('shortens with an ellipsis at the smallest size, keeping a file name’s ending', () => {
    const name = 'a-very-long-holiday-photo-name.heic';
    const end = fitLabel(name, { size: 11, minSize: 8, maxWidth: 90, maxLines: 1 }, half);
    expect(end.size).toBe(8);
    expect(end.lines[0]).toMatch(/…$/);
    expect(half(end.lines[0]!) * 8).toBeLessThanOrEqual(90);
    const middle = fitLabel(name, { size: 11, minSize: 8, maxWidth: 90, maxLines: 1, truncate: 'middle' }, half);
    expect(middle.lines[0]).toMatch(/^a-very.*….*\.heic$/);
  });
});

describe('label blocks', () => {
  it('centres a format name and its sub-label on the slice', () => {
    const block = layoutBlock({ label: 'PNG', sublabel: 'lossless', icon: false, format: true }, [300, 200], measures);
    expect(block.icon).toBeNull();
    expect(block.label.size).toBe(20.5);
    const labelY = block.label.lines[0]!.y;
    const subY = block.sub!.lines[0]!.y;
    expect(labelY).toBeLessThan(200);
    expect(subY).toBeGreaterThan(200);
    // The block's middle is the label point.
    const top = labelY - (20.5 * 1.1) / 2;
    const bottom = subY + (10.8 * 1.1) / 2;
    expect((top + bottom) / 2).toBeCloseTo(200, 0);
  });

  it('puts the icon above a tool label, and moves both apart when the label wraps', () => {
    const one = layoutBlock({ label: 'Crop', icon: true, format: false }, [200, 100], measures);
    const two = layoutBlock({ label: 'Normalize loudness', icon: true, format: false }, [200, 100], measures);
    expect(one.icon!.size).toBe(22);
    expect(one.icon!.y).toBeLessThan(one.label.lines[0]!.y);
    expect(two.label.lines).toHaveLength(2);
    expect(two.icon!.y).toBeLessThan(one.icon!.y);
    expect(two.label.lines[1]!.y).toBeGreaterThan(two.label.lines[0]!.y);
  });
});
