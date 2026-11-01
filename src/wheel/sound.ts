// SPDX-License-Identifier: MIT
// The wheel's sounds (design/DESIGN.md, section 7), synthesized with WebAudio: nothing is recorded or
// downloaded. Browsers only start audio after a user gesture, so the AudioContext is created on the
// first one, and a sound asked for before it is skipped. Sound never carries meaning on its own.

export type WheelSound = 'open' | 'tick' | 'apply';

export interface SoundSettings {
  enabled: boolean;
  /** Master gain, 0 to 1. */
  volume: number;
}

/** Slice clicks are at least this far apart, so a fast sweep does not buzz. */
export const TICK_GAP = 30;

export function tickAllowed(now: number, last: number | null): boolean {
  return last === null || now - last >= TICK_GAP;
}

interface Burst {
  type: BiquadFilterType;
  f: number;
  q: number;
  dur: number;
  gain: number;
  a?: number;
}

interface Tone {
  type?: OscillatorType;
  f: number;
  f2?: number;
  dur: number;
  gain: number;
  a?: number;
}

let noiseBuffer: AudioBuffer | null = null;

class Synth {
  constructor(
    private readonly ac: AudioContext,
    private readonly out: AudioNode,
  ) {}

  /** One second of white noise from a fixed seed, shared by every burst. */
  private noise(): AudioBuffer {
    if (noiseBuffer && noiseBuffer.sampleRate === this.ac.sampleRate) return noiseBuffer;
    const buffer = this.ac.createBuffer(1, this.ac.sampleRate, this.ac.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    return (noiseBuffer = buffer);
  }

  /** An exponential attack and decay. */
  private envelope(param: AudioParam, t: number, a: number, d: number, peak: number) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone(t: number, { type = 'sine', f, f2, dur, gain, a = 0.004 }: Tone) {
    const osc = this.ac.createOscillator();
    const amp = this.ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
    this.envelope(amp.gain, t, a, dur, gain);
    osc.connect(amp).connect(this.out);
    osc.start(t);
    osc.stop(t + a + dur + 0.05);
  }

  burst(t: number, { type, f, q, dur, gain, a = 0.001 }: Burst) {
    const src = this.ac.createBufferSource();
    src.buffer = this.noise();
    const filter = this.ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f, t);
    filter.Q.value = q;
    const amp = this.ac.createGain();
    this.envelope(amp.gain, t, a, dur, gain);
    src.connect(filter).connect(amp).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + a + dur + 0.05);
  }
}

const VOICES: Record<WheelSound, (s: Synth, t: number) => void> = {
  // A fast run of fine dial ticks, slowing into a last click (about 150 ms).
  open(s, t) {
    let dt = 0;
    for (let k = 0; k < 10; k++) {
      s.burst(t + dt, { type: 'bandpass', f: 5600 - k * 120, q: 7, dur: 0.005, gain: 0.1 - k * 0.004 });
      dt += 0.008 + k * 0.0025;
    }
    s.burst(t + dt + 0.01, { type: 'bandpass', f: 4300, q: 6, dur: 0.008, gain: 0.14 });
    s.tone(t + dt + 0.01, { type: 'triangle', f: 2700, f2: 2350, dur: 0.02, gain: 0.015, a: 0.001 });
  },
  // One combination click: a dry tick, a thin ring of steel and a small body (about 30 ms).
  tick(s, t) {
    s.burst(t, { type: 'bandpass', f: 4300, q: 6, dur: 0.008, gain: 0.2 });
    s.burst(t, { type: 'highpass', f: 9000, q: 0.7, dur: 0.003, gain: 0.045 });
    s.tone(t, { type: 'triangle', f: 2800, f2: 2400, dur: 0.016, gain: 0.018, a: 0.001 });
    s.tone(t, { f: 320, f2: 230, dur: 0.02, gain: 0.03, a: 0.001 });
  },
  // The handle ratchet (five ticks), the bolt throw (a low thud with a ring of steel) and the latch
  // click, in time with the apply effect (about 450 ms).
  apply(s, t) {
    [0.02, 0.06, 0.1, 0.14, 0.18].forEach((dt, k) =>
      s.burst(t + dt, { type: 'bandpass', f: 2500 + k * 120, q: 4, dur: 0.01, gain: 0.09 + k * 0.01 }),
    );
    s.burst(t + 0.13, { type: 'bandpass', f: 1500, q: 2.5, dur: 0.02, gain: 0.08 });
    s.tone(t + 0.26, { f: 74, f2: 44, dur: 0.17, gain: 0.16, a: 0.002 });
    s.burst(t + 0.26, { type: 'lowpass', f: 650, q: 0.8, dur: 0.05, gain: 0.15 });
    s.burst(t + 0.262, { type: 'bandpass', f: 2100, q: 3, dur: 0.014, gain: 0.12 });
    s.tone(t + 0.265, { type: 'triangle', f: 523, dur: 0.32, gain: 0.022, a: 0.002 });
    s.tone(t + 0.265, { f: 1412, dur: 0.24, gain: 0.014, a: 0.002 });
    s.tone(t + 0.265, { f: 2663, dur: 0.14, gain: 0.006, a: 0.001 });
    s.burst(t + 0.4, { type: 'bandpass', f: 5200, q: 6, dur: 0.007, gain: 0.13 });
    s.tone(t + 0.4, { type: 'triangle', f: 1950, f2: 1700, dur: 0.025, gain: 0.02, a: 0.001 });
  },
};

let audio: { ac: AudioContext; master: GainNode } | null = null;
let lastTick: number | null = null;

function createAudio() {
  if (audio) return audio;
  const Context =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    const ac = new Context();
    const master = ac.createGain();
    master.connect(ac.destination);
    audio = { ac, master };
  } catch {
    audio = null;
  }
  return audio;
}

/** Whether the page has had a user gesture, so a new AudioContext may start. */
function hasGesture(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation?.hasBeenActive ?? false;
}

/** Creates the AudioContext on the next pointer or key press; returns the clean-up. */
export function armWheelAudio(): () => void {
  if (audio || typeof window === 'undefined') return () => {};
  const onGesture = () => {
    const created = createAudio();
    if (created?.ac.state === 'suspended') void created.ac.resume();
    stop();
  };
  const stop = () => {
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
  };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  return stop;
}

export function playWheelSound(name: WheelSound, settings: SoundSettings, now = performance.now()): void {
  if (!settings.enabled || !(settings.volume > 0)) return;
  if (name === 'tick') {
    if (!tickAllowed(now, lastTick)) return;
    lastTick = now;
  }
  const current = audio ?? (hasGesture() ? createAudio() : null);
  if (!current) return;
  const { ac, master } = current;
  if (ac.state === 'suspended') void ac.resume();
  master.gain.value = Math.min(1, settings.volume);
  try {
    VOICES[name](new Synth(ac, master), ac.currentTime + 0.01);
  } catch {
    // A sound that cannot play is skipped; the wheel works the same muted.
  }
}
