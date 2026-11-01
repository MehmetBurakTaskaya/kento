// SPDX-License-Identifier: MIT
// Themes are plug-ins (SPEC 5.20): each one brings tokens for light and dark, and in later phases
// its wheel renderer, motion and sounds. Adding a theme means registering one more definition;
// nothing else in the app changes. Phase 1 ships the default theme only.

export type Tokens = Record<string, string>;
export type Mode = 'light' | 'dark';

export interface ThemeDefinition {
  id: string;
  /** The i18n key of the theme's name in Settings. */
  nameKey: string;
  tokens: Record<Mode, Tokens>;
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

const themes = new Map<string, ThemeDefinition>();
let fallback: string | null = null;

export function registerTheme(theme: ThemeDefinition): void {
  themes.set(theme.id, theme);
  fallback ??= theme.id;
}

export function listThemes(): ThemeDefinition[] {
  return [...themes.values()];
}

/** The theme with this id, or the default one. */
export function getTheme(id: string): ThemeDefinition {
  const theme = themes.get(id) ?? (fallback ? themes.get(fallback) : undefined);
  if (!theme) throw new Error('no theme is registered');
  return theme;
}

/** Light or dark for the appearance setting and the system's preference. */
export function modeFor(appearance: 'system' | Mode, systemPrefersDark: boolean): Mode {
  return appearance === 'system' ? (systemPrefersDark ? 'dark' : 'light') : appearance;
}

/** Writes a theme's tokens as CSS custom properties on an element. */
export function applyTheme(element: HTMLElement, theme: ThemeDefinition, mode: Mode): void {
  element.dataset.theme = mode;
  element.dataset.themeId = theme.id;
  element.style.colorScheme = mode;
  for (const [name, value] of Object.entries(theme.tokens[mode])) {
    element.style.setProperty(`--${name}`, value);
  }
}
