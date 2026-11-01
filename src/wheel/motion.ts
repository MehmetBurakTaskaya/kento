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
  reduced: { open: 90, close: 80 },
} as const;

export function openDuration(slices: number, reduced: boolean): number {
  return reduced ? MOTION.reduced.open : MOTION.open + MOTION.stagger * Math.max(0, slices - 1);
}

export function closeDuration(reduced: boolean): number {
  return reduced ? MOTION.reduced.close : MOTION.close;
}

/** From the apply until the wheel starts to close. */
export function applyDuration(reduced: boolean): number {
  return (reduced ? 0 : MOTION.apply) + MOTION.hold;
}
