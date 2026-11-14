// SPDX-License-Identifier: MIT
// The themes' recorded voices: src/theme/sounds/<theme>/<voice>-<k>.mp3, cut by
// scripts/theme-sounds.mjs from the CC0 recordings listed in src/theme/sounds/sources.json. Each file
// is a module of its own, loaded with its theme (the security policy lets the page load scripts from
// the app but not fetch its files, and the file is small), and decoded once. A voice with several takes
// plays one of them at random, a tick also a touch faster or slower, so repeats differ.
import type { SoundVoice, ThemeVoice } from './contract';

const FILES = import.meta.glob<string>('../sounds/*/*.mp3', { query: '?inline', import: 'default' });

const VOICES: readonly ThemeVoice[] = ['open', 'tick', 'enter', 'leave', 'success'];

/** The files of each theme's voices, by theme and voice, in take order. */
const index = new Map<string, Map<ThemeVoice, (() => Promise<string>)[]>>();
for (const [path, load] of Object.entries(FILES).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
  const match = /\/sounds\/([^/]+)\/([a-z]+)-(\d+)\.mp3$/.exec(path);
  if (!match || !VOICES.includes(match[2] as ThemeVoice)) continue;
  const [, theme, voice] = match as unknown as [string, string, ThemeVoice];
  let voices = index.get(theme);
  if (!voices) index.set(theme, (voices = new Map()));
  voices.set(voice, [...(voices.get(voice) ?? []), load]);
}

const decoded = new Map<string, Map<ThemeVoice, AudioBuffer[]>>();
const loading = new Map<string, Promise<void>>();

/** Whether a theme has recorded voices, or a recording of this voice. */
export function hasRecorded(theme: string, voice?: ThemeVoice): boolean {
  const voices = index.get(theme);
  return !!voices && (voice === undefined || voices.has(voice));
}

/** The number of takes of a theme's voice. */
export function recordedTakes(theme: string, voice: ThemeVoice): number {
  return index.get(theme)?.get(voice)?.length ?? 0;
}

function bytes(dataUrl: string): ArrayBuffer {
  const text = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out.buffer;
}

/** The buffer from 2 ms before the sound begins. An MP3 decoder may put the encoder's delay, some tens
 *  of milliseconds of silence, in front of it; the files begin with the sound, so that silence goes and
 *  a tick plays the instant the pointer moves. */
export function trimLead(ac: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (const x of data) peak = Math.max(peak, Math.abs(x));
  const floor = peak * 0.01;
  let first = 0;
  while (first < data.length && Math.abs(data[first]!) < floor) first++;
  const start = Math.max(0, first - Math.round(buffer.sampleRate * 0.002));
  if (start === 0 || start >= data.length) return buffer;
  const out = ac.createBuffer(1, data.length - start, buffer.sampleRate);
  out.copyToChannel(data.subarray(start), 0);
  return out;
}

/** Loads and decodes a theme's recorded voices, once; a theme without any resolves at once. */
export function loadRecorded(theme: string): Promise<void> {
  const voices = index.get(theme);
  if (!voices || typeof OfflineAudioContext === 'undefined') return Promise.resolve();
  let load = loading.get(theme);
  if (!load) {
    load = (async () => {
      const ac = new OfflineAudioContext(1, 1, 32000);
      const done = new Map<ThemeVoice, AudioBuffer[]>();
      await Promise.all(
        [...voices].map(async ([voice, files]) => {
          const takes = await Promise.all(
            files.map(async (file) => trimLead(ac, await ac.decodeAudioData(bytes(await file())))),
          );
          done.set(voice, takes);
        }),
      );
      decoded.set(theme, done);
    })();
    // A load that failed may be tried again.
    load.catch(() => loading.delete(theme));
    loading.set(theme, load);
  }
  return load;
}

/** A theme's recorded voice once it has decoded, or null: one of its takes, or the take given. */
export function recordedVoice(theme: string, voice: ThemeVoice, take?: number): SoundVoice | null {
  const takes = decoded.get(theme)?.get(voice);
  if (!takes?.length) return null;
  return (ac, out, t) => {
    const buffer = takes[take ?? Math.floor(Math.random() * takes.length)] ?? takes[0]!;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const rate = voice === 'tick' && take === undefined ? 1 + (Math.random() * 2 - 1) * 0.03 : 1;
    src.playbackRate.value = rate;
    const g = ac.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.001);
    src.connect(g).connect(out);
    src.start(t);
    src.stop(t + buffer.duration / rate + 0.02);
  };
}
