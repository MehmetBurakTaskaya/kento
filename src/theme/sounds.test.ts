// SPDX-License-Identifier: MIT
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import catalog from './catalog.json';
import { hasRecorded, recordedTakes, trimLead } from './host/recorded';

const VOICES = ['open', 'tick', 'enter', 'leave', 'success'] as const;
const dir = path.join(__dirname, 'sounds');
const sources = JSON.parse(readFileSync(path.join(dir, 'sources.json'), 'utf8')) as {
  recordings: Record<string, { title: string; author: string; page: string; preview: string; license: string }>;
  themes: Record<string, Record<string, unknown>>;
};
type Clip = { from: number; start: number; end: number; rate?: number };
const clips = (theme: string, voice: string) => (sources.themes[theme]?.[voice] ?? []) as Clip[];

describe('the themes’ recorded voices', () => {
  it('give every theme all five voices, a tick in several takes, each clip a file', () => {
    for (const { id } of catalog) {
      for (const voice of VOICES) {
        expect(clips(id, voice).length, `${id} ${voice}`).toBeGreaterThan(0);
        expect(hasRecorded(id, voice), `${id} ${voice}`).toBe(true);
        expect(recordedTakes(id, voice)).toBe(clips(id, voice).length);
        clips(id, voice).forEach((_, k) =>
          expect(existsSync(path.join(dir, id, `${voice}-${k + 1}.mp3`)), `${id}/${voice}-${k + 1}.mp3`).toBe(true),
        );
      }
      expect(clips(id, 'tick').length, `${id} tick takes`).toBeGreaterThanOrEqual(3);
      const files = readdirSync(path.join(dir, id));
      expect(files.length, `${id}: files no clip names`).toBe(VOICES.reduce((n, v) => n + clips(id, v).length, 0));
    }
  });

  it('come only from listed CC0 recordings, and stay short', () => {
    for (const [theme, voices] of Object.entries(sources.themes))
      for (const voice of VOICES)
        for (const clip of voices[voice] as Clip[]) {
          const source = sources.recordings[String(clip.from)];
          expect(source?.license, `${theme} ${voice} ${clip.from}`).toBe('CC0-1.0');
          expect(source?.page).toMatch(/^https:\/\/freesound\.org\//);
          const seconds = (clip.end - clip.start) / (clip.rate ?? 1);
          expect(seconds, `${theme} ${voice}`).toBeLessThanOrEqual(voice === 'tick' ? 0.15 : 1.3);
        }
  });

  it('start the instant they are played: the decoder’s silence in front is cut, 2 ms before the sound kept', () => {
    const rate = 32000;
    const make = (data: Float32Array) => ({
      sampleRate: rate,
      length: data.length,
      getChannelData: () => data,
      copyToChannel(source: Float32Array) {
        data.set(source);
      },
    });
    const ac = { createBuffer: (_: number, length: number) => make(new Float32Array(length)) };
    const data = new Float32Array(2000);
    for (let i = 1105; i < 2000; i++) data[i] = 0.5 * Math.min(1, (i - 1105) / 8);
    const out = trimLead(ac as never, make(data) as never);
    // The first sample over 1 % of the peak is 1106; 64 samples (2 ms) before it stay.
    expect(out.length).toBe(2000 - (1106 - 64));
    expect(out.getChannelData(0)[64]).toBe(data[1106]);
    // A buffer that starts with its sound is kept as it is.
    const plain = make(Float32Array.from({ length: 100 }, (_, i) => Math.sin(i + 1)));
    expect(trimLead(ac as never, plain as never)).toBe(plain);
  });
});
