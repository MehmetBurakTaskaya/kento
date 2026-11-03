// SPDX-License-Identifier: MIT
// The model a theme draws from (contract.ts), made from the slices the app shows and the app's own
// geometry, so a theme's slices sit exactly where the app's pointing and keys find them: the same
// start angle, the same direction, mirrored the same way right to left, turned the same way when a
// ring of choices unfolds from a slice, and with the mark of a slice that opens a ring where the steel
// wheel puts its own. And the timings of a theme's wheel, from its motion.
import { ringMarkAngle, type SliceGeometry } from '../../wheel/geometry';
import type { WheelTimings } from '../../wheel/motion';
import type { ThemeMotion, WheelModel } from './contract';

export interface ModelSliceInput {
  id: string;
  label: string;
  sub?: string | null;
  icon?: string;
  tip?: string;
  off: boolean;
  ring: boolean;
  format: boolean;
}

export interface ModelInput {
  kind: string;
  lang: string;
  dir: 'ltr' | 'rtl';
  title: string;
  file: string;
  key: string;
  slices: ModelSliceInput[];
  /** The app's layout of the same slices (geometry.ts layoutSlices). */
  geometry: SliceGeometry[];
}

export function buildModel({ kind, lang, dir, title, file, key, slices, geometry }: ModelInput): WheelModel {
  const n = slices.length;
  return {
    kind,
    lang,
    dir,
    n,
    step: n ? 360 / n : 360,
    title,
    key,
    file,
    slices: slices.map((slice, i) => {
      const g = geometry[i]!;
      return {
        i,
        id: slice.id,
        label: slice.label,
        sub: slice.sub || null,
        icon: slice.icon ?? 'file',
        tip: slice.tip ?? '',
        off: slice.off,
        a0: g.start,
        a1: g.end,
        mid: g.mid,
        step: g.step,
        ring: slice.ring,
        mark: slice.ring ? ringMarkAngle(g, dir) : null,
        format: slice.format,
      };
    }),
  };
}

/** The phases of a theme's wheel: its own open animation (with the stagger across its slices), its
 *  apply effect, a pause to show the result, and its close. With reduced motion every wheel fades. */
export function themeTimings(motion: ThemeMotion): WheelTimings {
  const apply = (reduced: boolean) => (reduced ? 0 : Math.max(0, motion.apply ?? 0));
  return {
    open: (slices, reduced) => (reduced ? 100 : motion.open + motion.stagger * Math.max(0, slices - 1)),
    apply,
    // The wheel closes 650 ms after the apply at the earliest, and 450 ms after a longer effect.
    hold: (reduced) => Math.max(650 - apply(reduced), 450),
    close: (reduced) => (reduced ? 90 : motion.close) + 30,
  };
}
