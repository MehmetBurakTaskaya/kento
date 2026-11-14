// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import LEVELS from '../theme/levels.json';
import type { PackTheme } from '../theme/host/packs';
import { armWheelAudio, playWheelSound, TICK_GAP, tickAllowed, voiceGain, type WheelSound } from './sound';

describe('wheel sounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../theme/host/recorded');
  });

  it('allows at most one slice click per 30 ms', () => {
    expect(TICK_GAP).toBe(30);
    expect(tickAllowed(1000, null)).toBe(true);
    expect(tickAllowed(1029, 1000)).toBe(false);
    expect(tickAllowed(1030, 1000)).toBe(true);
  });

  it('creates no audio while sound is off, or before the first user gesture', () => {
    const created = vi.fn();
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          created();
        }
      },
    );
    playWheelSound('open', { enabled: false, volume: 0.3 });
    playWheelSound('tick', { enabled: true, volume: 0 });
    // jsdom reports no user activation, so the context waits for a gesture.
    playWheelSound('apply', { enabled: true, volume: 0.3 });
    playWheelSound('enter', { enabled: true, volume: 0.3 });
    expect(created).not.toHaveBeenCalled();
  });

  it('clicks deeper going into a ring and lighter coming back, and only while sound is on', () => {
    // What each sound starts: the frequencies of its tones and of the filters on its noise bursts.
    let started: { tones: number[]; clicks: number[] } = { tones: [], clicks: [] };
    const param = (into?: number[]) => ({
      value: 0,
      setValueAtTime: (value: number) => into?.push(value),
      exponentialRampToValueAtTime: () => {},
    });
    const node = (into?: number[]) => ({
      connect: (next: unknown) => next,
      disconnect: () => {},
      start: () => {},
      stop: () => {},
      frequency: param(into),
      Q: param(),
      gain: param(),
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        currentTime = 0;
        sampleRate = 8000;
        destination = {};
        createGain = () => node();
        createDynamicsCompressor = () => ({
          ...node(),
          threshold: param(),
          knee: param(),
          ratio: param(),
          attack: param(),
          release: param(),
        });
        createOscillator = () => node(started.tones);
        createBiquadFilter = () => node(started.clicks);
        createBufferSource = () => node();
        createBuffer = (_channels: number, length: number) => ({
          sampleRate: 8000,
          getChannelData: () => new Float32Array(length),
        });
        resume = () => Promise.resolve();
      },
    );
    // The first gesture starts the audio.
    const stop = armWheelAudio();
    window.dispatchEvent(new Event('pointerdown'));
    stop();
    const play = (name: WheelSound, enabled = true) => {
      started = { tones: [], clicks: [] };
      playWheelSound(name, { enabled, volume: 0.3 }, 1e6 + Math.random() * 1e6);
      return started;
    };
    const tick = play('tick');
    const enter = play('enter');
    const leave = play('leave');
    // The main click and the body of each: entering is lower than a slice click on both counts,
    // leaving lies between the two, with a body lighter than entering's.
    expect(enter.clicks[0]).toBeLessThan(tick.clicks[0]!);
    expect(Math.min(...enter.tones)).toBeLessThan(Math.min(...tick.tones));
    expect(leave.clicks[1]).toBeGreaterThan(enter.clicks[0]!);
    expect(leave.clicks[1]).toBeLessThan(tick.clicks[0]!);
    expect(Math.min(...leave.tones)).toBeGreaterThan(Math.min(...enter.tones));
    expect(play('enter', false)).toEqual({ tones: [], clicks: [] });
    expect(play('leave', false)).toEqual({ tones: [], clicks: [] });
  });

  it('brings each voice to its measured level, and leaves unlisted ones as they are', () => {
    expect(voiceGain('steel', 'tick')).toBeCloseTo(10 ** (LEVELS.steel.tick / 20));
    expect(voiceGain('steel', 'success')).toBeGreaterThan(1);
    expect(voiceGain('no-such-theme', 'tick')).toBe(1);
  });

  it('plays a theme voice through a gain at its level, a ring falling back to the tick', async () => {
    // Where each voice drew.
    const drawn: { voice: string; out: unknown }[] = [];
    const node = () => ({ connect: (next: unknown) => next, disconnect: () => {} });
    const param = () => ({ value: 0 });
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        currentTime = 0;
        destination = {};
        createGain = () => ({ ...node(), gain: param() });
        createDynamicsCompressor = () => ({
          ...node(),
          threshold: param(),
          knee: param(),
          ratio: param(),
          attack: param(),
          release: param(),
        });
        resume = () => Promise.resolve();
      },
    );
    // A fresh player, so its audio is made with this context; the voices drawn in code, as for a
    // theme without recordings.
    vi.resetModules();
    vi.doMock('../theme/host/recorded', () => ({
      hasRecorded: () => false,
      loadRecorded: () => Promise.resolve(),
      recordedVoice: () => null,
    }));
    const sound = await import('./sound');
    const { playFor } = await import('./voices');
    const stop = sound.armWheelAudio();
    window.dispatchEvent(new Event('pointerdown'));
    stop();
    const voice = (name: string) => (_ac: unknown, out: unknown) => drawn.push({ voice: name, out });
    const pack = { id: 'nar', concept: { sounds: { tick: voice('tick'), success: voice('success') } } };
    playFor(pack as unknown as PackTheme, 'enter', { enabled: true, volume: 0.5 });
    playFor(pack as unknown as PackTheme, 'apply', { enabled: true, volume: 0.5 });
    expect(drawn.map((each) => each.voice)).toEqual(['tick', 'success']);
    // Each voice draws into a gain of its own, set to its theme's level.
    expect(drawn[0]!.out).toMatchObject({ gain: { value: voiceGain('nar', 'tick') } });
    expect(drawn[1]!.out).toMatchObject({ gain: { value: voiceGain('nar', 'success') } });
    // A theme without a voice for a sound plays nothing for it.
    playFor(pack as unknown as PackTheme, 'open', { enabled: true, volume: 0.5 });
    expect(drawn).toHaveLength(2);
  });

  it('plays a theme’s recording at its level, and nothing in its place while it decodes', async () => {
    const drawn: { voice: string; out: unknown }[] = [];
    const node = () => ({ connect: (next: unknown) => next, disconnect: () => {} });
    const param = () => ({ value: 0 });
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        currentTime = 0;
        destination = {};
        createGain = () => ({ ...node(), gain: param() });
        createDynamicsCompressor = () => ({
          ...node(),
          threshold: param(),
          knee: param(),
          ratio: param(),
          attack: param(),
          release: param(),
        });
        resume = () => Promise.resolve();
      },
    );
    let decoded = false;
    const loading: string[] = [];
    vi.resetModules();
    vi.doMock('../theme/host/recorded', () => ({
      hasRecorded: (theme: string, voice?: string) => theme === 'steel' && voice !== 'leave',
      loadRecorded: (theme: string) => (loading.push(theme), Promise.resolve()),
      recordedVoice: (_theme: string, voice: string) =>
        decoded ? (_ac: unknown, out: unknown) => drawn.push({ voice: `recorded ${voice}`, out }) : null,
    }));
    const sound = await import('./sound');
    const { playFor } = await import('./voices');
    const stop = sound.armWheelAudio();
    window.dispatchEvent(new Event('pointerdown'));
    stop();
    const settings = { enabled: true, volume: 0.5 };
    // Still decoding: silence, not the voice drawn in code.
    playFor(null, 'apply', settings);
    expect(drawn).toEqual([]);
    expect(loading).toEqual(['steel']);
    decoded = true;
    playFor(null, 'apply', settings);
    // A ring's way back without a recording of its own takes the recorded tick.
    playFor(null, 'leave', settings);
    expect(drawn.map((each) => each.voice)).toEqual(['recorded success', 'recorded tick']);
    expect(drawn[0]!.out).toMatchObject({ gain: { value: voiceGain('steel', 'success') } });
    expect(drawn[1]!.out).toMatchObject({ gain: { value: voiceGain('steel', 'tick') } });
  });
});
