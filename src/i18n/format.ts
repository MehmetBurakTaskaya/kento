// SPDX-License-Identifier: MIT
// Numbers, sizes, durations and dates in the interface language (SPEC 5.19), plus the
// language-aware text helpers: Turkish casing (i/İ, ı/I) and accent-insensitive search.
import { intlLocale } from './index';

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

export function formatBytes(bytes: number, lang: string): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(intlLocale(lang), {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 || value >= 100 ? 0 : 1,
  }).format(value);
}

/** A remaining time such as "12 s" or "3 min". */
export function formatDuration(ms: number, lang: string): string {
  const seconds = Math.round(ms / 1000);
  const [value, unit] = seconds < 60 ? [seconds, 'second'] : [Math.round(seconds / 60), 'minute'];
  return new Intl.NumberFormat(intlLocale(lang), { style: 'unit', unit, unitDisplay: 'short' }).format(value);
}

/** "2 min ago", "yesterday" and so on, from a time in milliseconds. */
export function formatRelative(then: number, now: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(intlLocale(lang), { numeric: 'auto', style: 'short' });
  // A moment ahead of a clock that ticks by the minute still reads as now, never "in 30 seconds".
  const seconds = Math.min(0, Math.round((then - now) / 1000));
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    // Rounded first, so 59.9 minutes reads as an hour, not "60 minutes".
    if (Math.abs(Math.round(value)) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), 'year');
}

export const upper = (text: string, lang: string) => text.toLocaleUpperCase(intlLocale(lang));
export const lower = (text: string, lang: string) => text.toLocaleLowerCase(intlLocale(lang));

/** A form of the text for searching: language-aware lower case without accents, so "Ş" finds "s"
 * and "I" finds "ı". */
export function searchKey(text: string, lang: string): string {
  return lower(text, lang).normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

export const matchesSearch = (text: string, query: string, lang: string) =>
  searchKey(text, lang).includes(searchKey(query, lang));
