// SPDX-License-Identifier: MIT
// What a pack's register() function receives: Board.define() to declare a theme, and the contrast
// pairs every palette must pass, which a theme extends with its own.
import type { ThemeConcept, ThemeMotion } from './contract';

type Pair = [string, string, 'text' | 'large' | 'ui'];

export const DEFAULT_PAIRS: Pair[] = [
  ['text', 'bg', 'text'],
  ['text', 'surface', 'text'],
  ['text-muted', 'bg', 'text'],
  ['text-muted', 'surface', 'text'],
  ['on-accent', 'accent', 'text'],
  ['accent', 'surface', 'ui'],
  ['focus', 'bg', 'ui'],
  ['success', 'surface', 'ui'],
  ['wheel-text', 'wheel-slice', 'text'],
  ['wheel-text', 'wheel-slice-hover', 'text'],
  ['wheel-text-selected', 'wheel-slice-selected', 'text'],
];

/** The contrast each kind of pair needs (WCAG 2.2 AA). */
export const NEED = { text: 4.5, large: 3, ui: 3 } as const;

export interface Board {
  define(concept: ThemeConcept): void;
  readonly DEFAULT_PAIRS: Pair[];
}

export type Register = (board: Board) => void;

/** Runs a pack and returns the themes it defines, with the default timings filled in. */
export function definePack(register: Register): ThemeConcept[] {
  const defined: ThemeConcept[] = [];
  register({
    define(concept) {
      // A pack may leave out any timing.
      const motion: Partial<ThemeMotion> = concept.motion ?? {};
      concept.motion = {
        ...motion,
        open: motion.open ?? 160,
        close: motion.close ?? 110,
        stagger: motion.stagger ?? 12,
      };
      defined.push(concept);
    },
    // A copy, so a pack that changes the list in place changes only its own.
    get DEFAULT_PAIRS() {
      return DEFAULT_PAIRS.map((pair) => [...pair] as Pair);
    },
  });
  return defined;
}
