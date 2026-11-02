// SPDX-License-Identifier: MIT
// Times on the media timelines (SPEC 5.6): mm:ss.s in the digits and decimal sign of the interface
// language, the fine step of Shift+arrow and evenly spaced ruler ticks.
import { intlLocale } from '../i18n';
import type { MediaInfo } from '../ipc';

const formats = new Map<string, Intl.NumberFormat>();

// Formatting runs on every frame while a clip plays, so the formatters are made once per locale.
function digits(locale: string, integers: number, fraction: number): Intl.NumberFormat {
  const key = `${locale}|${integers}|${fraction}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      minimumIntegerDigits: integers,
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
      useGrouping: false,
    });
    formats.set(key, format);
  }
  return format;
}

/** "01:23.4" (or "1:02:03.4" past an hour); without tenths "01:23", for the ruler. */
export function formatTime(seconds: number, lang: string, tenths = true): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  // Rounded once, in tenths, so 59.96 reads 01:00.0 and never 00:60.0.
  const units = tenths ? Math.round(safe * 10) : Math.round(safe) * 10;
  const hours = Math.floor(units / 36_000);
  const minutes = Math.floor((units % 36_000) / 600);
  const rest = (units % 600) / 10;
  const locale = intlLocale(lang);
  const two = digits(locale, 2, 0);
  const head = hours > 0 ? `${digits(locale, 1, 0).format(hours)}:${two.format(minutes)}` : two.format(minutes);
  return `${head}:${digits(locale, 2, tenths ? 1 : 0).format(rest)}`;
}

/** A plain number in the language's digits, without grouping ("1920", "29,97"). */
export function formatNumber(value: number, lang: string, fraction = 0): string {
  return new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: fraction, useGrouping: false }).format(value);
}

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** A time inside the file. */
export const clampTime = (seconds: number, duration: number) => clamp(seconds, 0, Math.max(0, duration));

/** Milliseconds are enough for every request. */
export const roundTime = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** Shift+← / Shift+→: one frame for video, a tenth of a second for audio. */
export function fineStep(info: MediaInfo | null, audio: boolean): number {
  const fps = info?.video?.fps ?? 0;
  return !audio && fps > 0 ? 1 / fps : 0.1;
}

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** The smallest ruler step that keeps labels at least `gap` pixels apart. */
export function tickStep(duration: number, width: number, gap = 72): number {
  if (duration <= 0 || width <= 0) return STEPS[STEPS.length - 1]!;
  return STEPS.find((step) => (step / duration) * width >= gap) ?? STEPS[STEPS.length - 1]!;
}

/** Ruler positions from 0, every `step` seconds, up to the end. */
export function ticks(duration: number, step: number): number[] {
  if (duration <= 0 || step <= 0) return [0];
  const count = Math.floor(duration / step + 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step * 1000) / 1000);
}
