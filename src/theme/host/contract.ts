// SPDX-License-Identifier: MIT
// The contract between the app and a theme pack (docs/ARCHITECTURE.md, "Theme packs"). A pack is a
// module whose default export receives a Board and calls Board.define() once per theme it holds. The
// theme draws its wheel into an SVG group from a model of the slices the app shows, and the app keeps
// everything else: pointing, the keyboard, rings of choices, paging, the tooltip and the menu that
// assistive technology reads.
import type { Sfx } from './sfx';
import type { Helpers } from './helpers';

export type Mode = 'light' | 'dark';
export type Palette = Record<string, string>;

/** One slice as a theme draws it. Angles are degrees from twelve o'clock, clockwise; in right-to-left
 *  languages the app has already mirrored them, so a theme draws from the angles and RTL works. */
export interface ModelSlice {
  i: number;
  id: string;
  label: string;
  /** The second line of a format slice, for example "Lossless" under "PNG". */
  sub: string | null;
  /** An icon name the theme's H.icon() understands (the app's icon names). */
  icon: string;
  /** The description bubble's text. */
  tip: string;
  /** Not available, or its tools are not installed: drawn dimmed. */
  off: boolean;
  a0: number;
  a1: number;
  mid: number;
  step: number;
  /** The slice opens a ring of choices. */
  ring: boolean;
  /** A target format of the Convert wheel ("PNG"), drawn as a large label: the app shows formats
   *  without an icon, and with a sub-label only where it has one. */
  format: boolean;
}

export interface WheelModel {
  /** Convert wheels show formats with a sub-label; the others tools or actions with an icon. */
  kind: string;
  lang: string;
  dir: 'ltr' | 'rtl';
  n: number;
  step: number;
  /** The hub's title, for example "Convert", or inside a ring the slice that opened it. */
  title: string;
  /** The modifier key that opened the wheel, as the system names it; empty when none did. */
  key: string;
  /** The file name or "3 files". */
  file: string;
  slices: ModelSlice[];
}

export interface WheelState {
  hover: number | null;
  selected: number | null;
}

export interface ThemeWheel {
  render(root: SVGGElement, model: WheelModel, H: Helpers): void;
  update?(root: SVGGElement, model: WheelModel, state: WheelState, H: Helpers): void;
  /** `t` is set for a still frame of the open animation. */
  onOpen?(root: SVGGElement, model: WheelModel, H: Helpers, reduced: boolean, t?: number): void;
  /** Live, `t` is undefined; for a still frame it is the time into the apply effect, drawn statically. */
  onSelect?(root: SVGGElement, model: WheelModel, i: number, H: Helpers, t?: number): void;
}

export type SoundVoice = (ac: AudioContext, out: AudioNode, t: number, X: Sfx) => void;

export interface ThemeMotion {
  open: number;
  close: number;
  stagger: number;
  /** The length of the apply effect, up to about 700 ms. */
  apply?: number;
}

export interface ThemeFonts {
  brand: string;
  display?: string;
  accent?: string;
  /** The families to wait for before labels are measured. */
  load?: string[];
  credits?: { family: string; license: string }[];
}

/** What a pack passes to Board.define(). Fields the app does not use are allowed and ignored. */
export interface ThemeConcept {
  id: string;
  fonts: ThemeFonts;
  palette: Record<Mode, Palette>;
  motion: ThemeMotion;
  /** SVG <defs> content inserted once per wheel; every id starts with the theme id. */
  defs?: string;
  /** Overrides of the 24 x 24 stroke icons, by name. */
  icons?: Record<string, string>;
  wheel: ThemeWheel;
  sounds?: Partial<Record<'open' | 'tick' | 'success', SoundVoice>>;
  /** Contrast pairs [foreground, background, kind] that must pass WCAG AA. */
  contrast?: [string, string, 'text' | 'large' | 'ui'][];
}

/** The tokens every palette defines in both modes. */
export const PALETTE_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'accent',
  'on-accent',
  'focus',
  'success',
  'on-success',
  'success-text',
  'warning',
  'warning-text',
  'danger',
  'desk',
  'wheel-face',
  'wheel-slice',
  'wheel-slice-hover',
  'wheel-slice-selected',
  'wheel-text',
  'wheel-text-selected',
  'wheel-line',
  'wheel-shadow',
] as const;
