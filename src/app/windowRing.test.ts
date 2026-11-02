// SPDX-License-Identifier: MIT
import { beforeAll, describe, expect, it } from 'vitest';
import i18n, { initI18n } from '../i18n';
import type { LayoutId } from '../ipc';
import { layoutSlices, normalize } from '../wheel/geometry';
import { windowOrder, windowSlices } from './windowRing';

/** Where on the dial each layout should sit, in degrees clockwise from twelve. */
const AT: Record<LayoutId, number> = {
  'full-screen': 0,
  'top-right': 45,
  'right-half': 90,
  'bottom-right': 135,
  center: 180,
  'bottom-left': 225,
  'left-half': 270,
  'top-left': 315,
};

beforeAll(async () => {
  await initI18n('en');
});

describe('the Window ring', () => {
  it('has the eight layouts, named and drawn', () => {
    const slices = windowSlices(i18n.t, false);
    expect(slices.map((slice) => slice.label)).toEqual([
      'Full screen',
      'Top right',
      'Right half',
      'Bottom right',
      'Center',
      'Bottom left',
      'Left half',
      'Top left',
    ]);
    expect(slices.every((slice) => slice.icon === `layout-${slice.id}` && slice.hint && !slice.dimmed)).toBe(true);
    expect(slices.find((slice) => slice.id === 'left-half')?.hint).toBe('The left half of the screen');
  });

  it('puts each slice on the side of the screen it stands for, in both directions', () => {
    for (const rtl of [false, true]) {
      const order = windowOrder(rtl);
      const angles = layoutSlices(order.length, rtl ? 'rtl' : 'ltr');
      expect(new Set(order).size).toBe(8);
      order.forEach((layout, index) => expect(normalize(angles[index]!.mid)).toBe(AT[layout]));
    }
  });
});
