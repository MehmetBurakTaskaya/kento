// SPDX-License-Identifier: MIT
// The themes (SPEC 5.20). catalog.json lists them in the order Settings shows them, each with its own
// name (the same in every language) and its pack: the default steel theme is built in, the others are
// packs in src/theme/packs that load when needed (host/packs.ts). The Rust side reads the same file to
// check a saved choice. A theme's palette colours the whole app; only the wheel changes its drawing.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import catalog from './catalog.json';
import { loadedPackTheme, loadPackTheme, type PackTheme } from './host/packs';
import { steel } from './steel';

export type Tokens = Record<string, string>;
export type Mode = 'light' | 'dark';

export interface CatalogEntry {
  id: string;
  /** A proper name, the same in every language. */
  name: string;
  /** The folder of its pack, or null for the built-in steel theme. */
  pack: string | null;
}

export interface ThemeDefinition extends CatalogEntry {
  /** The app's colours in light and dark. */
  tokens: Record<Mode, Tokens>;
  /** The theme's own wheel, once its pack has loaded; null for the steel wheel. */
  wheel: PackTheme | null;
}

/** The tokens every theme defines; the components use nothing else. */
export const REQUIRED_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'accent',
  'accent-hi',
  'on-accent',
  'focus',
  'success',
  'on-success',
  'success-text',
  'warning',
  'warning-text',
  'danger',
  'shadow',
] as const;

export const DEFAULT_THEME = 'steel';
const THEMES: readonly CatalogEntry[] = catalog;

export function listThemes(): readonly CatalogEntry[] {
  return THEMES;
}

/** The catalog entry of a theme, or of the default one for an id that is not (or no longer) there. */
export function themeEntry(id: string): CatalogEntry {
  return THEMES.find((theme) => theme.id === id) ?? THEMES.find((theme) => theme.id === DEFAULT_THEME)!;
}

/** The shell takes a theme's colours for its pages, windows and cards, but none of its other tokens: a
 *  palette may hold the wheel's own values under names the shell uses otherwise. A palette that leaves
 *  out a shell colour gets one made from its own. */
export function chromeTokens(palette: Tokens, base: Tokens): Tokens {
  const tokens: Tokens = { ...base };
  for (const name of REQUIRED_TOKENS) if (palette[name]) tokens[name] = palette[name];
  tokens['accent-hi'] = palette['accent-hi'] ?? palette.accent ?? base['accent-hi']!;
  // A palette's own "shadow" may be a box-shadow; the shell's is a colour, as the wheel's shadow is.
  tokens.shadow = palette['wheel-shadow'] ?? base.shadow!;
  tokens['wheel-shadow'] = palette['wheel-shadow'] ?? base['wheel-shadow']!;
  // Keys in the shell's own text, and the fine rule of its scales.
  tokens.keycap = palette['surface-2'] ?? base.keycap!;
  tokens['keycap-text'] = palette.text ?? base['keycap-text']!;
  if (palette['text-muted']) tokens['scale-tick'] = `color-mix(in srgb, ${palette['text-muted']} 42%, transparent)`;
  return tokens;
}

function definition(entry: CatalogEntry, wheel: PackTheme | null): ThemeDefinition {
  if (!wheel) return { ...entry, tokens: steel.tokens, wheel: null };
  const palette = wheel.concept.palette;
  return {
    ...entry,
    tokens: {
      light: chromeTokens(palette.light, steel.tokens.light),
      dark: chromeTokens(palette.dark, steel.tokens.dark),
    },
    wheel,
  };
}

const definitions = new Map<string, ThemeDefinition>();

/** A theme as far as it has loaded: until its pack is there, the steel colours and no wheel. Unknown
 *  ids give the default theme. */
export function getTheme(id: string): ThemeDefinition {
  const entry = themeEntry(id);
  const known = definitions.get(entry.id);
  if (known) return known;
  const wheel = entry.pack ? loadedPackTheme(entry.id) : null;
  const theme = definition(entry, wheel);
  if (!entry.pack || wheel) definitions.set(entry.id, theme);
  return theme;
}

/** Whether a theme can be drawn now: steel always, a pack theme once it has loaded. */
export function themeReady(id: string): boolean {
  const entry = themeEntry(id);
  return !entry.pack || !!loadedPackTheme(entry.id);
}

const listeners = new Set<() => void>();
let loadedCount = 0;

/** Loads a theme's pack and faces. A pack that fails to load leaves the theme drawn in steel. */
export async function loadTheme(id: string): Promise<ThemeDefinition> {
  const entry = themeEntry(id);
  if (entry.pack && !loadedPackTheme(entry.id)) {
    await loadPackTheme(entry.pack, entry.id);
    loadedCount++;
    listeners.forEach((listener) => listener());
  }
  return getTheme(entry.id);
}

/** The theme for a React component: it re-renders once the theme's pack has loaded. */
export function useTheme(id: string): ThemeDefinition {
  useSyncExternalStore(subscribe, () => loadedCount);
  useEffect(() => {
    if (!themeReady(id)) void loadTheme(id).catch(() => {});
  }, [id]);
  return getTheme(id);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Light or dark for the appearance setting and the system's preference. */
export function modeFor(appearance: 'system' | Mode, systemPrefersDark: boolean): Mode {
  return appearance === 'system' ? (systemPrefersDark ? 'dark' : 'light') : appearance;
}

const DARK = '(prefers-color-scheme: dark)';

function subscribeDark(listener: () => void) {
  if (typeof matchMedia !== 'function') return () => {};
  const query = matchMedia(DARK);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** Light or dark for a React component, following the system while the setting does. */
export function useMode(appearance: 'system' | Mode): Mode {
  const dark = useSyncExternalStore(subscribeDark, () => typeof matchMedia === 'function' && matchMedia(DARK).matches);
  return modeFor(appearance, dark);
}

/** A theme and its mode, as the wheel takes them. */
export function useLook(id: string, appearance: 'system' | Mode): { theme: ThemeDefinition; mode: Mode } {
  const theme = useTheme(id);
  const mode = useMode(appearance);
  return useMemo(() => ({ theme, mode }), [theme, mode]);
}

const wanted = new WeakMap<HTMLElement, string>();

/** Colours an element in a theme as soon as the theme can be drawn; until then it keeps the theme it
 *  has, so a change never flashes the default one. A pack that fails to load gives the default theme. */
export function showTheme(element: HTMLElement, id: string, mode: Mode): Promise<void> {
  wanted.set(element, id);
  if (themeReady(id)) {
    applyTheme(element, getTheme(id), mode);
    return Promise.resolve();
  }
  const current = () => wanted.get(element) === id;
  return loadTheme(id).then(
    (theme) => void (current() && applyTheme(element, theme, mode)),
    () => void (current() && applyTheme(element, getTheme(DEFAULT_THEME), mode)),
  );
}

const written = new WeakMap<HTMLElement, Set<string>>();

/** Writes a theme's tokens as CSS custom properties on an element, and clears those of the theme it
 *  had before that this one does not set. */
export function applyTheme(element: HTMLElement, theme: ThemeDefinition, mode: Mode): void {
  element.dataset.theme = mode;
  element.dataset.themeId = theme.id;
  element.style.colorScheme = mode;
  const tokens = theme.tokens[mode];
  const before = written.get(element);
  if (before) for (const name of before) if (!(name in tokens)) element.style.removeProperty(`--${name}`);
  for (const [name, value] of Object.entries(tokens)) element.style.setProperty(`--${name}`, value);
  written.set(element, new Set(Object.keys(tokens)));
}
