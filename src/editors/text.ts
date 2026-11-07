// SPDX-License-Identifier: MIT
// Text for Add text or logo, drawn by the page (ARCHITECTURE 54): a canvas of exactly the layer's
// size in the video's own pixels, sent to the core as a PNG. The editor shows that same picture on
// the stage, so the preview is the result in every script and with emoji. The typefaces ship with
// Kento and cover Turkish; other scripts and emoji fall back to the system's faces, as everywhere.
import { useEffect, useState } from 'react';
import type { Rgb } from '../ipc';
import { registerFaces } from '../theme/host/fonts';
import literataLatin from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import literataLatinExt from '@fontsource-variable/literata/files/literata-latin-ext-wght-normal.woff2?url';
import literataCyrillic from '@fontsource-variable/literata/files/literata-cyrillic-wght-normal.woff2?url';
import alfaSlabLatin from '@fontsource/alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff2?url';
import alfaSlabLatinExt from '@fontsource/alfa-slab-one/files/alfa-slab-one-latin-ext-400-normal.woff2?url';
import caveatLatin from '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url';
import caveatLatinExt from '@fontsource-variable/caveat/files/caveat-latin-ext-wght-normal.woff2?url';
import caveatCyrillic from '@fontsource-variable/caveat/files/caveat-cyrillic-wght-normal.woff2?url';

export type TypefaceId = 'sans' | 'serif' | 'display' | 'hand';
export type TextFrame = 'plain' | 'outline' | 'box';
export type TextAlign = 'left' | 'center' | 'right';

/** The interface's own face, a book serif, a heavy slab for titles and a handwriting face. */
export const TYPEFACES: Record<TypefaceId, { family: string; weight: number }> = {
  sans: { family: 'IBM Plex Sans Variable', weight: 700 },
  serif: { family: 'Literata Variable', weight: 700 },
  display: { family: 'Alfa Slab One', weight: 400 },
  hand: { family: 'Caveat Variable', weight: 700 },
};

export interface TextStyle {
  text: string;
  font: TypefaceId;
  color: Rgb;
  frame: TextFrame;
  /** The outline's or the box's colour. */
  accent: Rgb;
  align: TextAlign;
}

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';

/** Lines are this many font sizes apart. */
const LINE = 1.25;
/** Room around the text, in font sizes: a little for the glyphs' overhang, more for an outline or a box. */
const PADDING: Record<TextFrame, number> = { plain: 0.1, outline: 0.16, box: 0.45 };
const OUTLINE = 0.16;
const BOX_ALPHA = 0.75;
const BOX_RADIUS = 0.3;
/** Letters that make every face load the files Turkish needs. */
const SAMPLE = 'AaĞğİıŞşÇçÖöÜü';

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  // IBM Plex Sans comes with the interface.
  registerFaces([
    {
      family: 'Literata Variable',
      weight: '200 900',
      sources: [
        { url: literataLatin, range: LATIN },
        { url: literataLatinExt, range: LATIN_EXT },
        { url: literataCyrillic, range: CYRILLIC },
      ],
    },
    {
      family: 'Alfa Slab One',
      weight: '400',
      sources: [
        { url: alfaSlabLatin, range: LATIN },
        { url: alfaSlabLatinExt, range: LATIN_EXT },
      ],
    },
    {
      family: 'Caveat Variable',
      weight: '400 700',
      sources: [
        { url: caveatLatin, range: LATIN },
        { url: caveatLatinExt, range: LATIN_EXT },
        { url: caveatCyrillic, range: CYRILLIC },
      ],
    },
  ]);
}

/** Counts up once the typefaces have loaded, so text drawn before is drawn again with them. */
export function useTypefaces(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    register();
    if (typeof document === 'undefined' || !document.fonts) return;
    let live = true;
    const loads = Object.values(TYPEFACES).map(({ family, weight }) =>
      document.fonts.load(`${weight} 32px "${family}"`, SAMPLE).catch(() => []),
    );
    void Promise.all(loads).then(() => {
      if (live) setVersion((value) => value + 1);
    });
    return () => {
      live = false;
    };
  }, []);
  return version;
}

const font = (id: TypefaceId, size: number) => {
  const { family, weight } = TYPEFACES[id];
  return `${weight} ${size}px "${family}", system-ui, sans-serif, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"`;
};

const css = ([r, g, b]: Rgb, alpha = 1) => `rgb(${r} ${g} ${b} / ${alpha})`;

const linesOf = (text: string) => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines.length ? lines : [''];
};

/** Whether text reads right to left, by its first letter that has a direction. */
export function rightToLeft(text: string): boolean {
  for (const char of text) {
    if (/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u.test(char)) return true;
    if (/\p{L}/u.test(char)) return false;
  }
  return false;
}

let measurer: CanvasRenderingContext2D | null | undefined;

function measuring(): CanvasRenderingContext2D | null {
  if (measurer === undefined) {
    measurer = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  return measurer;
}

/** The block's size for a font size of 1 pixel: multiply by the size in video pixels. */
export function textUnits(style: Pick<TextStyle, 'text' | 'font' | 'frame'>): { width: number; height: number } {
  const lines = linesOf(style.text);
  const context = measuring();
  let widest = 0;
  if (context) {
    context.font = font(style.font, 100);
    for (const line of lines) widest = Math.max(widest, context.measureText(line).width / 100);
  } else {
    // Without a canvas (tests), an average letter.
    for (const line of lines) widest = Math.max(widest, [...line].length * 0.6);
  }
  const pad = 2 * PADDING[style.frame];
  return { width: Math.max(widest, 0.5) + pad, height: lines.length * LINE + pad };
}

/** The text drawn into a canvas of `width` × `height` pixels; null without a canvas. */
export function drawText(style: TextStyle, width: number, height: number): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) return null;
  const units = textUnits(style);
  // The size that fills the canvas: the block's own, give or take the rounding of its pixels.
  const size = Math.min(canvas.width / units.width, canvas.height / units.height);
  const lines = linesOf(style.text);
  if (style.frame === 'box') {
    context.fillStyle = css(style.accent, BOX_ALPHA);
    context.beginPath();
    context.roundRect(0, 0, canvas.width, canvas.height, BOX_RADIUS * size);
    context.fill();
  }
  const pad = PADDING[style.frame] * size;
  context.font = font(style.font, size);
  context.textBaseline = 'middle';
  context.textAlign = style.align;
  context.direction = rightToLeft(style.text) ? 'rtl' : 'ltr';
  const x = style.align === 'left' ? pad : style.align === 'right' ? canvas.width - pad : canvas.width / 2;
  const top = (canvas.height - lines.length * LINE * size) / 2;
  lines.forEach((line, i) => {
    const y = top + (i + 0.5) * LINE * size;
    if (style.frame === 'outline') {
      context.lineJoin = 'round';
      context.lineWidth = OUTLINE * size;
      context.strokeStyle = css(style.accent);
      context.strokeText(line, x, y);
    }
    context.fillStyle = css(style.color);
    context.fillText(line, x, y);
  });
  return canvas;
}

const pictures = new Map<string, string | null>();

/**
 * The text as a PNG data URL of exactly `width` × `height` pixels, kept for the next call with the
 * same text, size and typefaces (`version` from useTypefaces). Null where the page cannot draw.
 */
export function textPicture(style: TextStyle, width: number, height: number, version: number): string | null {
  const key = JSON.stringify([style, Math.round(width), Math.round(height), version]);
  const known = pictures.get(key);
  if (known !== undefined) return known;
  let url: string | null;
  try {
    url = drawText(style, width, height)?.toDataURL('image/png') ?? null;
  } catch {
    url = null;
  }
  if (url && !url.startsWith('data:image/png;base64,')) url = null;
  // A few dozen pictures are plenty for a drag, and the oldest go first.
  if (pictures.size > 48) pictures.delete(pictures.keys().next().value!);
  pictures.set(key, url);
  return url;
}

/** The base64 part of a PNG data URL, as the core takes it. */
export const pngBase64 = (url: string) => url.slice(url.indexOf(',') + 1);
