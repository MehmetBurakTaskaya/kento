// SPDX-License-Identifier: MIT
// Numbers behind the editors' sliders and pictures: the speed scale, loudness presets and peaks
// resampled for a canvas.
import { clamp } from './time';

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

// The slider runs on a log2 scale, so 0.25–1 gets as much room as 1–4.
export const sliderFromSpeed = (factor: number) => Math.log2(clamp(factor, SPEED_MIN, SPEED_MAX));

/** A slider position as a speed in steps of 0.05. */
export const speedFromSlider = (value: number) =>
  clamp(Math.round(2 ** clamp(value, -2, 2) * 20) / 20, SPEED_MIN, SPEED_MAX);

/** The length of the result at a speed. */
export const lengthAtSpeed = (duration: number, factor: number) => (factor > 0 ? duration / factor : duration);

/** Integrated loudness targets (LUFS): streaming services, podcasts, EBU R128 broadcast. */
export const LOUDNESS_PRESETS = [
  { id: 'streaming', target: -14 },
  { id: 'podcast', target: -16 },
  { id: 'broadcast', target: -23 },
] as const;

/** The engine's defaults and the bounds FFmpeg's loudnorm accepts. */
export const LOUDNESS = {
  target: { min: -70, max: -5, value: -16 },
  range: { min: 1, max: 20, value: 11 },
  peak: { min: -9, max: 0, value: -1.5 },
} as const;

/** `count` peaks from a longer or shorter list, each the highest of the ones it covers. */
export function resamplePeaks(peaks: number[], count: number): number[] {
  if (count <= 0 || peaks.length === 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * peaks.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / count));
    let high = 0;
    for (let j = from; j < to && j < peaks.length; j++) high = Math.max(high, peaks[j]!);
    return clamp(high, 0, 1);
  });
}

/** The peaks around a moment, `count` of them, for the Audio to video preview. */
export function peaksAround(peaks: number[], at: number, duration: number, count: number): number[] {
  if (!peaks.length || duration <= 0) return Array.from({ length: count }, () => 0);
  const middle = Math.round((at / duration) * (peaks.length - 1));
  const first = middle - Math.floor(count / 2);
  return Array.from({ length: count }, (_, i) => peaks[first + i] ?? 0);
}

/** "#1a2b3c" from a color input as the red, green and blue the engine takes. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const value = match ? parseInt(match[1]!, 16) : 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
