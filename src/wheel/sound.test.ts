// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playWheelSound, TICK_GAP, tickAllowed } from './sound';

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
    expect(created).not.toHaveBeenCalled();
  });
});
