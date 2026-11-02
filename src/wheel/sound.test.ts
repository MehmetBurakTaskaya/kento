// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import { armWheelAudio, playWheelSound, TICK_GAP, tickAllowed, type WheelSound } from './sound';

describe('wheel sounds', () => {
  afterEach(() => vi.unstubAllGlobals());

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
});
