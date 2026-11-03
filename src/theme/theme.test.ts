// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import catalog from './catalog.json';
import { DEFAULT_PAIRS, NEED } from './host/board';
import { PALETTE_TOKENS } from './host/contract';
import { loadPack, packNames } from './host/packs';
import {
  applyTheme,
  chromeTokens,
  getTheme,
  listThemes,
  loadTheme,
  modeFor,
  REQUIRED_TOKENS,
  themeEntry,
  themeReady,
} from './registry';
import { steel } from './steel';

/** WCAG 2.2 contrast of two CSS colours (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()); a translucent
 *  colour is laid over the one below it, and that over the page's background. */
function parse(color: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (hex) {
    let h = hex[1]!;
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (!rgb) return null;
  const parts = rgb[1]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
}
const over = (fg: number[], bg: number[]) => [0, 1, 2].map((k) => fg[k]! * fg[3]! + bg[k]! * (1 - fg[3]!)).concat(1);
const luminance = (c: number[]) =>
  [0, 1, 2]
    .map((k) => {
      const v = c[k]! / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, k) => sum + v * [0.2126, 0.7152, 0.0722][k]!, 0);
function contrast(tokens: Record<string, string>, fg: string, bg: string): number | null {
  const base = parse(tokens.bg ?? '#ffffff') ?? [255, 255, 255, 1];
  let b = tokens[bg] ? parse(tokens[bg]) : null;
  let f = tokens[fg] ? parse(tokens[fg]) : null;
  if (!b || !f) return null;
  if (b[3] < 1) b = over(b, base) as typeof b;
  if (f[3] < 1) f = over(f, b) as typeof f;
  const [light, dark] = [luminance(f), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** Text in the shell needs 4.5:1 and its controls 3:1 (WCAG 2.2 AA). */
const SHELL_PAIRS: [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text-muted', 'bg', 4.5],
  ['text-muted', 'surface', 4.5],
  ['on-accent', 'accent', 4.5],
  ['accent', 'surface', 3],
  ['focus', 'bg', 3],
];

describe('the theme catalog', () => {
  it('lists 51 themes with their own names, the steel theme first', () => {
    expect(catalog).toHaveLength(51);
    expect(catalog[0]).toEqual({ id: 'steel', name: 'Kasa', pack: null });
    expect(new Set(catalog.map((theme) => theme.id)).size).toBe(51);
    expect(new Set(catalog.map((theme) => theme.name)).size).toBe(51);
    expect(listThemes()).toEqual(catalog);
  });

  it('names a pack in the repository for every other theme, and every pack is used', () => {
    const packs = new Set(packNames());
    for (const theme of catalog.slice(1)) expect(packs.has(theme.pack!), theme.id).toBe(true);
    expect(new Set(catalog.slice(1).map((theme) => theme.pack))).toEqual(packs);
  });

  it('gives the default theme for an id it does not have', () => {
    expect(themeEntry('no-such-theme').id).toBe('steel');
    expect(getTheme('no-such-theme').id).toBe('steel');
    expect(themeEntry('simya-b').id).toBe('steel');
  });
});

describe('the steel theme', () => {
  it('defines every shell token in light and dark and passes WCAG AA', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const token of REQUIRED_TOKENS) expect(steel.tokens[mode][token], `${mode} ${token}`).toBeTruthy();
      for (const [fg, bg, need] of SHELL_PAIRS)
        expect(contrast(steel.tokens[mode], fg, bg), `${mode} ${fg} on ${bg}`).toBeGreaterThanOrEqual(need);
    }
  });
});

describe('the theme packs', () => {
  // The first load of every pack takes seconds on a slow machine; the tests after it reuse them.
  it('each define the themes the catalog names, with every palette token in light and dark', async () => {
    for (const theme of catalog.slice(1)) {
      const themes = await loadPack(theme.pack!);
      const pack = themes.get(theme.id);
      expect(pack, theme.id).toBeTruthy();
      for (const mode of ['light', 'dark'] as const)
        for (const token of PALETTE_TOKENS)
          expect(pack!.concept.palette[mode][token], `${theme.id} ${mode} ${token}`).toBeTruthy();
      expect(typeof pack!.concept.wheel.render).toBe('function');
      expect(pack!.concept.fonts.brand).toBeTruthy();
    }
  }, 60_000);

  it('pass the contrast pairs of their wheels (WCAG AA)', async () => {
    const failures: string[] = [];
    for (const theme of catalog.slice(1)) {
      const { concept } = (await loadPack(theme.pack!)).get(theme.id)!;
      for (const mode of ['light', 'dark'] as const) {
        const tokens = concept.palette[mode];
        for (const [fg, bg, kind] of concept.contrast ?? DEFAULT_PAIRS) {
          const ratio = contrast(tokens, fg, bg);
          // Gradients and textures are judged by eye.
          if (ratio !== null && ratio < NEED[kind] - 0.005)
            failures.push(`${theme.id} ${mode} ${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('colour the shell: their palette over the steel tokens, with the shell colours a palette lacks', async () => {
    const theme = await loadTheme('telefon');
    expect(themeReady('telefon')).toBe(true);
    const palette = theme.wheel!.concept.palette.light;
    const tokens = theme.tokens.light;
    expect(tokens.bg).toBe(palette.bg);
    expect(tokens.accent).toBe(palette.accent);
    expect(tokens['accent-hi']).toBe(palette['accent-hi'] ?? palette.accent);
    expect(tokens.shadow).toBe(palette['wheel-shadow']);
    // The steel wheel's own tokens stay for the parts of the shell that use them.
    expect(tokens.slot).toBe(steel.tokens.light.slot);
    for (const token of REQUIRED_TOKENS) expect(tokens[token], token).toBeTruthy();
    // A token of the theme's wheel never reaches the shell.
    expect(chromeTokens({ ...palette, radius: '40px', shadow: '0 1px 2px red' }, steel.tokens.light).radius).toBe(
      undefined,
    );
  });

  it('pass WCAG AA in the shell for its text and controls', async () => {
    const failures: string[] = [];
    for (const entry of catalog.slice(1)) {
      const theme = await loadTheme(entry.id);
      for (const mode of ['light', 'dark'] as const)
        for (const [fg, bg, need] of SHELL_PAIRS) {
          const ratio = contrast(theme.tokens[mode], fg, bg);
          if (ratio !== null && ratio < need - 0.005)
            failures.push(`${entry.id} ${mode} ${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }
    }
    expect(failures).toEqual([]);
  });
});

describe('applying a theme', () => {
  it('writes its tokens and clears those of the theme before', async () => {
    expect(modeFor('system', true)).toBe('dark');
    expect(modeFor('light', true)).toBe('light');
    const element = document.createElement('div');
    applyTheme(element, getTheme('steel'), 'dark');
    expect(element.dataset.theme).toBe('dark');
    expect(element.style.getPropertyValue('--bg')).toBe('#16181b');
    const theme = await loadTheme('kadran-b');
    applyTheme(element, theme, 'light');
    expect(element.dataset.themeId).toBe('kadran-b');
    expect(element.style.getPropertyValue('--bg')).toBe(theme.tokens.light.bg);
    element.style.setProperty('--left-over', 'x');
    applyTheme(
      element,
      { ...theme, tokens: { ...theme.tokens, light: { ...theme.tokens.light, extra: '1' } } },
      'light',
    );
    applyTheme(element, theme, 'light');
    expect(element.style.getPropertyValue('--extra')).toBe('');
  });
});
