// SPDX-License-Identifier: MIT
// Numbers and hooks behind the editors that work on time and sound (Cut out parts, Remove pauses,
// Add music, Fade and volume, Remove noise, Merge audio, Make a ringtone). The limits follow the
// engine's (src-tauri/engines/src/media/tools/sound.rs), so the editor shows what the job writes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { intlLocale } from '../i18n';
import { api, type MediaInfo, type Pauses, type Span } from '../ipc';
import { clamp } from './time';
import type { EditorCore } from './useEditor';

/** The engine's `Pauses::default()` and the editor's ranges. */
export const PAUSES: Pauses = { threshold: -40, minLength: 0.6, keep: 0.15 };
export const PAUSE_RANGES = {
  threshold: { min: -60, max: -20, step: 1 },
  minLength: { min: 0.3, max: 3, step: 0.1 },
  keep: { min: 0, max: 0.5, step: 0.05 },
} as const;

/** Add music's levels in dB, and the longest fade there and in Fade and volume. */
export const LEVEL = { min: -30, max: 6 } as const;
export const FADE_MAX = 10;
/** Fade and volume's level in dB. */
export const VOLUME = { min: -20, max: 20 } as const;
export const CROSSFADE_MAX = 10;
export const RINGTONE_MAX = 40;
/** A new ringtone's first selection, from the start. */
export const RINGTONE_FIRST = 30;
/** Kept pieces shorter than this go with the cuts around them (as in the engine). */
const MIN_PIECE = 0.02;

/** A level in dB as a factor. */
export const gain = (db: number) => 10 ** (db / 20);

/** A level in dB with its sign ("+6", "−4.5", "0") in the language's digits. */
export const formatLevel = (db: number, lang: string) =>
  new Intl.NumberFormat(intlLocale(lang), { signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format(db);

/** A media element's volume: it cannot go above 1, so a louder level plays at full volume. */
export const elementVolume = (factor: number) => clamp(Number.isFinite(factor) ? factor : 0, 0, 1);

/** What a cut keeps of a file of `duration` seconds once `spans` (sorted or not) are taken out. */
export function keptPieces(spans: Span[], duration: number): Span[] {
  const cuts = spans
    .map((span) => ({ start: Math.max(0, span.start), end: Math.min(duration, span.end) }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const pieces: Span[] = [];
  let at = 0;
  for (const cut of cuts) {
    if (cut.start - at >= MIN_PIECE) pieces.push({ start: at, end: cut.start });
    at = Math.max(at, cut.end);
  }
  if (duration - at >= MIN_PIECE) pieces.push({ start: at, end: duration });
  return pieces;
}

/** The length of what a cut keeps. */
export const keptLength = (spans: Span[], duration: number) =>
  keptPieces(spans, duration).reduce((sum, piece) => sum + piece.end - piece.start, 0);

/** The sum of the spans' lengths (spans that do not overlap, such as pauses). */
export const spansLength = (spans: Span[]) => spans.reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0);

/** How loud the sound is at `at` seconds with these fades, from 0 to 1. */
export function fadeGain(at: number, fadeIn: number, fadeOut: number, duration: number): number {
  let level = 1;
  if (fadeIn > 0 && at < fadeIn) level *= clamp(at / fadeIn, 0, 1);
  if (fadeOut > 0 && at > duration - fadeOut) level *= clamp((duration - at) / fadeOut, 0, 1);
  return level;
}

/**
 * A selection kept within `max` seconds: the end that moved stays where it was put and the other
 * follows it.
 */
export function limitSpan(next: Span, previous: Span, max: number, duration: number): Span {
  if (next.end - next.start <= max) return next;
  if (next.start !== previous.start) {
    const end = Math.min(duration, next.start + max);
    return { start: Math.max(0, end - max), end };
  }
  const start = Math.max(0, next.end - max);
  return { start, end: Math.min(duration, start + max) };
}

/** Merge audio's crossfade: 0 to 10 seconds, never more than half the shortest file. */
export function crossfadeFor(seconds: number, lengths: number[]): number {
  const shortest = lengths.length ? Math.min(...lengths) : 0;
  const value = Math.min(clamp(Number.isFinite(seconds) ? seconds : 0, 0, CROSSFADE_MAX), shortest / 2);
  return value >= 0.01 ? Math.round(value * 1000) / 1000 : 0;
}

/** The length of the files merged, each crossfade taken off once. */
export const mergedLength = (lengths: number[], crossfade: number) =>
  lengths.reduce((sum, length) => sum + length, 0) - crossfade * Math.max(0, lengths.length - 1);

/**
 * Where in the music the video's time `at` falls: from `offset`, again from `offset` when it
 * repeats, or null once the music has ended.
 */
export function musicTime(at: number, offset: number, duration: number, repeat: boolean): number | null {
  const left = duration - offset;
  if (left <= 0) return null;
  if (at < left) return offset + at;
  return repeat ? offset + (at % left) : null;
}

/**
 * The editor's core with the player's volume set to `volume` (0 to 1): the preview plays at the
 * chosen level. The media element is the one the player already drives.
 */
export function useVolume(core: EditorCore, volume: number): EditorCore {
  const element = useRef<HTMLVideoElement | null>(null);
  const level = useRef(volume);
  const base = core.player.videoProps;
  const videoProps = useMemo(
    () => ({
      ...base,
      ref: (media: HTMLVideoElement | null) => {
        base.ref(media);
        element.current = media;
        if (media) media.volume = level.current;
      },
    }),
    [base],
  );
  useEffect(() => {
    level.current = volume;
    if (element.current) element.current.volume = volume;
  }, [volume]);
  return { ...core, player: { ...core.player, videoProps } };
}

/** Waveform peaks of the editor's file: an audio editor has them; a video's are read here. */
export function useSoundPeaks(core: EditorCore, buckets = 1600): number[] | null {
  const own = core.audio ? core.media.peaks : null;
  const wanted = !core.audio && Boolean(core.info?.audio);
  const path = core.path;
  const [read, setRead] = useState<{ path: string; peaks: number[] } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    api
      .mediaPeaks(path, buckets)
      .then((peaks) => live && setRead({ path, peaks }))
      .catch((reason) => void api.log('warn', `media peaks failed: ${String(reason)}`));
    return () => {
      live = false;
    };
  }, [path, wanted, buckets]);
  if (core.audio) return own;
  return read?.path === path ? read.peaks : null;
}

/** What ffprobe says about each file, once all have answered. */
export function useProbes(paths: string[]): Record<string, MediaInfo> | null {
  const key = paths.join('\n');
  const [found, setFound] = useState<{ key: string; infos: Record<string, MediaInfo> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const list = key.split('\n');
    Promise.all(list.map((path) => api.mediaProbe(path)))
      .then((infos) => live && setFound({ key, infos: Object.fromEntries(list.map((path, i) => [path, infos[i]!])) }))
      .catch((reason) => void api.log('warn', `files not probed: ${String(reason)}`));
    return () => {
      live = false;
    };
  }, [key]);
  return found?.key === key ? found.infos : null;
}
