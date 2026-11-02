// SPDX-License-Identifier: MIT
// The wheel's Window ring (SPEC 5.12): eight layouts for the window that was in front when the
// selection shortcut opened the ring with nothing selected. Each slice sits where its layout puts
// the window (left half at nine o'clock, the whole screen at twelve, the centre at six), so the
// ring keeps this order instead of putting recent choices first, and keeps the sides physical in
// right-to-left languages too.
import type { TFunction } from 'i18next';
import type { IconName } from '../components/Icon';
import type { LayoutId } from '../ipc';
import type { WheelSlice } from '../wheel/Wheel';
import type { Ring } from './slices';

/** Clockwise from twelve o'clock, as the wheel lays out slices in left-to-right languages. */
const CLOCKWISE: LayoutId[] = [
  'full-screen',
  'top-right',
  'right-half',
  'bottom-right',
  'center',
  'bottom-left',
  'left-half',
  'top-left',
];

/** The ring's order for a direction: right-to-left wheels run counterclockwise, so the order
 *  mirrors to keep every slice on the side of the screen it stands for. */
export function windowOrder(rtl: boolean): LayoutId[] {
  return rtl ? [CLOCKWISE[0]!, ...CLOCKWISE.slice(1).reverse()] : CLOCKWISE;
}

export function windowSlices(t: TFunction, rtl: boolean): WheelSlice[] {
  return windowOrder(rtl).map((layout) => ({
    id: layout,
    label: t(`layout.${layout}`),
    icon: `layout-${layout}` as IconName,
    hint: t(`layout.${layout}.hint`),
  }));
}

/** The Window ring; the wheel's host places the window the core remembered with the chosen
 *  layout (`api.layoutsApply`). */
export function windowRing(rtl: boolean): Ring {
  return {
    view: (t) => ({
      key: 'window',
      slices: windowSlices(t, rtl),
      paths: [],
      apply: () => null,
    }),
  };
}
