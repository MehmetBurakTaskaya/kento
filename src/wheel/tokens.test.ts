// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import design from '../../design/DESIGN.md?raw';
import { contrast } from '../theme/contrast';
import { steel } from '../theme/steel';

/** The rows of the wheel's two token tables in design/DESIGN.md, as name → [light, dark]. */
function wheelTables(): Map<string, [string, string]> {
  const start = design.indexOf('### Wheel');
  const end = design.indexOf('## 5. Components');
  const rows = new Map<string, [string, string]>();
  for (const line of design.slice(start, end).split('\n')) {
    const cells = line.split('|').slice(1, -1);
    if (cells.length !== 3) continue;
    const ticks = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    const [names, light, dark] = cells.map(ticks) as [string[], string[], string[]];
    names.forEach((name, i) => rows.set(name, [light[i]!, dark[i]!]));
  }
  return rows;
}

/** Wheel text pairs need 4.5:1 and its interface parts 3:1 (WCAG 2.2 AA). */
const PAIRS: [string, string, number][] = [
  ['wheel-text', 'wheel-face', 4.5],
  ['wheel-text', 'wheel-slice-hover', 4.5],
  ['wheel-text-muted', 'wheel-slice', 4.5],
  ['wheel-text-muted', 'wheel-slice-hover', 4.5],
  ['wheel-num', 'wheel-face', 4.5],
  ['wheel-text-selected', 'wheel-slice-selected', 4.5],
  ['on-index', 'index', 4.5],
  ['keycap-text', 'keycap', 4.5],
  ['index', 'wheel-face', 3],
  ['index', 'chapter-hover', 3],
];

describe('the steel wheel tokens', () => {
  it('match design/DESIGN.md in light and dark', () => {
    const rows = wheelTables();
    expect(rows.size).toBeGreaterThanOrEqual(59);
    for (const [name, [light, dark]] of rows) {
      expect(steel.tokens.light[name], `light ${name}`).toBe(light);
      expect(steel.tokens.dark[name], `dark ${name}`).toBe(dark);
    }
  });

  it('pass WCAG AA for the wheel’s text and its index', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const [fg, bg, need] of PAIRS) {
        const ratio = contrast(steel.tokens[mode][fg]!, steel.tokens[mode][bg]!);
        expect(ratio, `${mode} ${fg} on ${bg}`).toBeGreaterThanOrEqual(need);
      }
    }
  });
});
