// SPDX-License-Identifier: MIT
// The sound helpers a theme's voices receive as `X`: tones, filtered noise bursts and an envelope,
// scheduled with WebAudio at a given time. A new gain node starts at 1 until its envelope begins, which
// clicks when a sound starts exactly on a sample boundary, so every helper's gain starts silent.

export interface ToneOptions {
  type?: OscillatorType;
  f?: number;
  f2?: number | null;
  dur?: number;
  gain?: number;
  a?: number;
  detune?: number;
}

export interface BurstOptions {
  type?: BiquadFilterType;
  f?: number;
  f2?: number | null;
  q?: number;
  dur?: number;
  gain?: number;
  a?: number;
}

export interface EnvelopeOptions {
  a?: number;
  d?: number;
  peak?: number;
}

export interface Sfx {
  noise(ac: BaseAudioContext): AudioBuffer;
  env(param: AudioParam, t: number, options?: EnvelopeOptions): void;
  tone(ac: BaseAudioContext, out: AudioNode, t: number, options?: ToneOptions): OscillatorNode;
  burst(ac: BaseAudioContext, out: AudioNode, t: number, options?: BurstOptions): AudioBufferSourceNode;
}

let noise: AudioBuffer | null = null;

export const SFX: Sfx = {
  /** One second of white noise from a fixed seed, shared by every burst. */
  noise(ac) {
    if (noise && noise.sampleRate === ac.sampleRate) return noise;
    const buffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    return (noise = buffer);
  },
  /** An exponential attack and decay on an AudioParam. */
  env(param, t, { a = 0.003, d = 0.12, peak = 1 } = {}) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  },
  tone(ac, out, t, { type = 'sine', f = 880, f2 = null, dur = 0.12, gain = 0.3, a = 0.004, detune = 0 } = {}) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    g.gain.value = 0;
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    o.detune.value = detune;
    SFX.env(g.gain, t, { a, d: dur, peak: gain });
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + a + dur + 0.05);
    return o;
  },
  burst(ac, out, t, { dur = 0.03, gain = 0.4, type = 'bandpass', f = 3000, f2 = null, q = 6, a = 0.001 } = {}) {
    const src = ac.createBufferSource();
    src.buffer = SFX.noise(ac);
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f, t);
    if (f2) filter.frequency.exponentialRampToValueAtTime(f2, t + dur);
    filter.Q.value = q;
    const g = ac.createGain();
    g.gain.value = 0;
    SFX.env(g.gain, t, { a, d: dur, peak: gain });
    src.connect(filter).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + a + dur + 0.05);
    return src;
  },
};
