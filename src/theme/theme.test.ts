// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { contrast } from './contrast';
import { applyTheme, getTheme, listThemes, modeFor, REQUIRED_TOKENS } from './registry';
import './steel';

/** Text pairs need 4.5:1 and interface parts 3:1 (WCAG 2.2 AA). */
const PAIRS: [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text-muted', 'bg', 4.5],
  ['text-muted', 'surface', 4.5],
  ['text-muted', 'surface-2', 4.5],
  ['on-accent', 'accent', 4.5],
  ['on-accent', 'accent-hi', 4.5],
  ['accent', 'surface', 3],
  ['focus', 'bg', 3],
  ['success-text', 'surface', 4.5],
  ['warning-text', 'surface', 4.5],
  ['on-success', 'success', 3],
];

describe('themes', () => {
  it('define every required token in light and dark', () => {
    for (const theme of listThemes()) {
      for (const mode of ['light', 'dark'] as const) {
        for (const token of REQUIRED_TOKENS)
          expect(theme.tokens[mode][token], `${theme.id} ${mode} ${token}`).toBeTruthy();
      }
    }
  });

  it('pass WCAG AA for their text and interface pairs', () => {
    for (const theme of listThemes()) {
      for (const mode of ['light', 'dark'] as const) {
        for (const [fg, bg, need] of PAIRS) {
          const ratio = contrast(theme.tokens[mode][fg]!, theme.tokens[mode][bg]!);
          expect(ratio, `${theme.id} ${mode} ${fg} on ${bg}`).toBeGreaterThanOrEqual(need);
        }
      }
    }
  });

  it('fall back to the default theme and apply tokens as CSS properties', () => {
    expect(getTheme('no-such-theme').id).toBe('steel');
    expect(modeFor('system', true)).toBe('dark');
    expect(modeFor('light', true)).toBe('light');
    const element = document.createElement('div');
    applyTheme(element, getTheme('steel'), 'dark');
    expect(element.dataset.theme).toBe('dark');
    expect(element.style.getPropertyValue('--bg')).toBe('#16181b');
  });
});
