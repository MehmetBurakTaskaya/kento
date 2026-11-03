// SPDX-License-Identifier: MIT
// The wheel's timings in milliseconds (design/DESIGN.md, section 6). The keyframes live in wheel.css;
// these drive the state changes around them.

export const MOTION = {
  /** Resting on a ring-opening slice during a drag opens it. */
  dwell: 520,
  open: 180,
  /** Each slice's labels fade in this much after the one before. */
  stagger: 7,
  hover: 170,
  apply: 640,
  /** The bolts stay out this long after the apply effect before the wheel closes. */
  hold: 450,
  close: 120,
  denied: 260,
  /** Into a ring of choices or back out of one: the sweep, the flight to or from the hub, the fold. */
  level: 220,
  /** The dial clicks this far into its stop on a level change, in degrees (four steps of its scale). */
  detent: { turn: 14.4, duration: 180 },
  reduced: { open: 90, close: 80, level: 110 },
} as const;

export function openDuration(slices: number, reduced: boolean): number {
  return reduced ? MOTION.reduced.open : MOTION.open + MOTION.stagger * Math.max(0, slices - 1);
}

export function closeDuration(reduced: boolean): number {
  return reduced ? MOTION.reduced.close : MOTION.close;
}

/** A level change: a sweep and a flight, or a cross-fade when motion is reduced. */
export function levelDuration(reduced: boolean): number {
  return reduced ? MOTION.reduced.level : MOTION.level;
}

/** From the apply until the wheel starts to close. */
export function applyDuration(reduced: boolean): number {
  return (reduced ? 0 : MOTION.apply) + MOTION.hold;
}

/** The phases of a wheel in milliseconds: each theme times its own. */
export interface WheelTimings {
  /** From the start of the open animation until the wheel is fully open. */
  open(slices: number, reduced: boolean): number;
  /** The apply effect; 0 skips it. */
  apply(reduced: boolean): number;
  /** From the end of the apply effect until the wheel starts to close. */
  hold(reduced: boolean): number;
  close(reduced: boolean): number;
}

export const STEEL_TIMINGS: WheelTimings = {
  open: openDuration,
  apply: (reduced) => (reduced ? 0 : MOTION.apply),
  hold: () => MOTION.hold,
  close: closeDuration,
};
