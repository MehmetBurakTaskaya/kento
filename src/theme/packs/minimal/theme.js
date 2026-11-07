// SPDX-License-Identifier: MIT
// Minimal ring. No metaphor: a quiet acrylic ring that sits with Windows 11 Fluent and Mica.
export default function register(Board) {
  (function () {
    'use strict';

    // A voice is drawn sample by sample into a short buffer: struck modes (each a sine dying away at its own
    // rate), filtered noise and contact clicks, so it plays from one source node however rich it is. A buffer
    // is drawn once and kept for its sample rate. A voice with variants plays one at random (never the same
    // twice running) a little faster or slower, so a quick sweep never repeats itself.
    // Envelopes start and end at zero and a DC blocker runs last, so nothing clicks and nothing rumbles.
    const TAU = 2 * Math.PI;
    const drawnSounds = new Map();
    let noiseSeed = 1;
    // Seeded white noise from -1 to 1.
    function noise(seed) {
      let x = seed >>> 0 || 1;
      return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2147483648 - 1;
    }
    // Envelopes for hiss(), of t seconds and u (0 to 1) into it: a hit rises in a seconds and falls by 1/e
    // every tau seconds; a swell rises to its peak at p and falls back to zero.
    const hit = (a, tau) => (t) => (t < a ? Math.sin((Math.PI / 2) * (t / a)) ** 2 : Math.exp((a - t) / tau));
    const swell = (p) => (t, u) =>
      (u < p ? Math.sin((Math.PI / 2) * (u / p)) : Math.cos((Math.PI / 2) * ((u - p) / (1 - p)))) ** 2;
    // A struck mode from t0: a sine at f Hz falling by 1/e every tau seconds after an attack of o.a seconds (a
    // long one swells like a bowed note). o.to glides the pitch there with time constant o.glide, or o.freq(t)
    // sets it outright. A tone that does not die by itself lasts o.len seconds under o.env, an envelope as for
    // hiss().
    function mode(d, sr, t0, f, amp, tau, o = {}) {
      const i0 = Math.round(t0 * sr);
      const n = Math.min(d.length - i0, Math.ceil((o.len ?? tau * 7) * sr));
      const att = Math.max(1, (o.a ?? 0.0007) * sr);
      const tail = 0.002 * sr;
      const k = Math.exp(-1 / (tau * sr));
      let c = 1,
        s = 0,
        cw = 1,
        sw = 0,
        env = amp;
      for (let i = 0; i < n; i++) {
        if (i % 32 === 0) {
          const t = i / sr;
          const fi = o.freq ? o.freq(t) : o.to ? o.to + (f - o.to) * Math.exp(-t / (o.glide ?? 0.03)) : f;
          cw = Math.cos((TAU * fi) / sr);
          sw = Math.sin((TAU * fi) / sr);
          const m = 1 / Math.hypot(c, s);
          c *= m;
          s *= m;
        }
        const nc = c * cw - s * sw;
        s = c * sw + s * cw;
        c = nc;
        let g = env;
        if (i < att) g *= 0.5 - 0.5 * Math.cos((Math.PI * i) / att);
        if (n - i < tail) g *= (n - i) / tail;
        if (o.env) g *= o.env(i / sr, i / n);
        d[i0 + i] += g * s;
        env *= k;
      }
    }
    // A contact click at t0: a windowed burst of `cycles` cycles at f Hz, its energy around f.
    function tap(d, sr, t0, f, amp, cycles = 1.5) {
      const i0 = Math.round(t0 * sr);
      const n = Math.min(d.length - i0, Math.round((cycles / f) * sr) + 1);
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        d[i0 + i] += amp * (0.5 - 0.5 * Math.cos(TAU * u)) * Math.sin(TAU * cycles * (u - 0.5));
      }
    }
    // Filtered noise for dur seconds from t0: a band at o.f Hz (all below it with o.type 'low'), swept to o.to
    // along o.path (0 to 1, straight unless given), resonance o.q, shaped by o.env (a quick hit unless given)
    // and o.am. o.grain from 0 to 1 thins it into a crackle of separate grains, as grit, paper and leaf make.
    function hiss(d, sr, t0, dur, amp, o = {}) {
      const i0 = Math.round(t0 * sr);
      const n = Math.min(d.length - i0, Math.round(dur * sr));
      const rnd = noise((noiseSeed += 7919));
      const env = o.env ?? hit(0.002, dur / 4);
      const k = 1 / (o.q ?? 1);
      const fade = 0.003 * sr;
      let a1 = 0,
        a2 = 0,
        a3 = 0,
        z1 = 0,
        z2 = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        if (i % 16 === 0) {
          const f = o.to ? o.f * (o.to / o.f) ** (o.path ? o.path(u) : u) : o.f;
          const g = Math.tan((Math.PI * Math.min(f, 0.45 * sr)) / sr);
          a1 = 1 / (1 + g * (g + k));
          a2 = g * a1;
          a3 = g * a2;
        }
        let x = rnd();
        if (o.grain) x = Math.abs(rnd()) < o.grain ? x / Math.sqrt(o.grain) : 0;
        // A state-variable filter, stable however fast its frequency moves.
        const v3 = x - z2;
        const v1 = a1 * z1 + a2 * v3;
        const v2 = z2 + a2 * z1 + a3 * v3;
        z1 = 2 * v1 - z1;
        z2 = 2 * v2 - z2;
        const y = o.type === 'low' ? v2 : k * v1;
        const t = i / sr;
        d[i0 + i] += amp * y * env(t, u) * (o.am ? o.am(t) : 1) * Math.min(1, (n - i) / fade);
      }
    }
    // A voice drawn by draw(d, sr, v, r) into dur seconds at o.gain: o.vary variants (v, each with seeded noise
    // r of its own) played o.rate faster or slower at random; o.next(last) may choose the variant instead. Its
    // key starts with the theme's id: the first sound of a theme draws the rest of its voices in idle moments
    // after the wheel has opened, so applying a slice never waits for a drawing.
    const drawers = new Map();
    function drawn(key, dur, draw, o = {}) {
      const vary = o.vary ?? 1;
      const theme = key.split(':')[0];
      let last = -1;
      const pick = () => {
        if (vary < 2) return 0;
        const v = Math.floor(Math.random() * (last < 0 ? vary : vary - 1));
        return last >= 0 && v >= last ? v + 1 : v;
      };
      const make = (ac, v) => {
        const sr = ac.sampleRate;
        const id = `${key}:${v}:${sr}`;
        let buf = drawnSounds.get(id);
        if (buf) return buf;
        buf = ac.createBuffer(1, Math.ceil(dur * sr), sr);
        const d = buf.getChannelData(0);
        draw(d, sr, v, noise(v * 7919 + 101));
        // A DC blocker, the voice's gain and a fade over its last moments.
        const R = Math.exp((-TAU * 20) / sr);
        const fade = Math.max(1, (o.fade ?? 0.004) * sr);
        let x1 = 0,
          y1 = 0;
        for (let i = 0; i < d.length; i++) {
          y1 = d[i] - x1 + R * y1;
          x1 = d[i];
          const left = d.length - 1 - i;
          d[i] = (o.gain ?? 1) * y1 * (left < fade ? Math.sin((Math.PI / 2) * (left / fade)) ** 2 : 1);
        }
        drawnSounds.set(id, buf);
        return buf;
      };
      if (!drawers.has(theme)) drawers.set(theme, { list: [], rates: new Set() });
      for (let v = 0; v < vary; v++) drawers.get(theme).list.push((ac) => make(ac, v));
      return (ac, out, t) => {
        const v = o.next ? o.next(last) : pick();
        last = v;
        const buf = make(ac, v);
        const all = drawers.get(theme);
        if (!all.rates.has(ac.sampleRate)) {
          all.rates.add(ac.sampleRate);
          const queue = [...all.list];
          const idle = (f) => (window.requestIdleCallback ? window.requestIdleCallback(f) : setTimeout(f, 20));
          // A drawing takes up to a few milliseconds: only when the page has that much time to spare.
          const next = (spare) => {
            if (!queue.length) return;
            if (!spare || spare.timeRemaining() > 8) queue.shift()(ac);
            idle(next);
          };
          setTimeout(() => idle(next), 400);
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 1 + (o.rate ?? 0) * (2 * Math.random() - 1);
        src.connect(out);
        src.start(t);
        src.stop(t + buf.duration / src.playbackRate.value + 0.02);
      };
    }
    // A felt mallet on a small wooden bar: a soft contact (strike sets how firm), the note and the bar's tuned partial
    // 3.93 times higher.
    function mallet(d, sr, t, f, amp, tau, strike = 1.5) {
      tap(d, sr, t, f * 2.5, amp * strike, 2);
      mode(d, sr, t, f, amp, tau, { a: 0.0025 });
      mode(d, sr, t, f * 3.93, amp * 0.12, tau * 0.2, { a: 0.002 });
    }

    const SOUNDS = {
      // The ring pops up: a soft airy puff and a round note that rises and settles.
      open: drawn(
        'minimal:open',
        0.3,
        (d, sr) => {
          hiss(d, sr, 0, 0.14, 0.03, { f: 900, to: 2400, q: 0.9, env: swell(0.3) });
          tap(d, sr, 0.005, 1500, 0.12, 2);
          mode(d, sr, 0.005, 523.25, 0.07, 0.05, { a: 0.002, to: 784, glide: 0.03 });
          mode(d, sr, 0.005, 1046.5, 0.015, 0.04, { a: 0.006, to: 1568, glide: 0.03 });
        },
        { fade: 0.06, gain: 0.602 },
      ),
      // A soft, rounded tap on acrylic: a short pip that drops a little in pitch as it fades.
      tick: drawn(
        'minimal:tick',
        0.045,
        (d, sr, v, r) => {
          const f = 1250 * (1 + 0.04 * r());
          mode(d, sr, 0, f, 0.18, 0.0045, { a: 0.0008, to: f * 0.76, glide: 0.005 });
          mode(d, sr, 0, f * 2.9, 0.02, 0.0025);
          tap(d, sr, 0, 3000, 0.3, 2);
        },
        { vary: 6, rate: 0.02, gain: 0.551 },
      ),
      // Into a ring: two soft mallet notes stepping up a third.
      enter: drawn(
        'minimal:enter',
        0.2,
        (d, sr) => {
          mallet(d, sr, 0, 784, 0.07, 0.018, 5.5);
          mallet(d, sr, 0.055, 987.8, 0.07, 0.02, 5.5);
        },
        { fade: 0.04, gain: 0.398 },
      ),
      // Back out: the same two notes stepping down.
      leave: drawn(
        'minimal:leave',
        0.2,
        (d, sr) => {
          mallet(d, sr, 0, 987.8, 0.06, 0.016, 7);
          mallet(d, sr, 0.055, 784, 0.06, 0.018, 7);
        },
        { fade: 0.04, gain: 0.359 },
      ),
      // A soft press, then a warm two-note answer a fifth apart, like a felt mallet on a wooden bar.
      success: drawn(
        'minimal:success',
        0.75,
        (d, sr) => {
          mode(d, sr, 0, 300, 0.06, 0.02, { a: 0.002, to: 250, glide: 0.02 });
          hiss(d, sr, 0, 0.04, 0.03, { f: 1200, q: 0.8, env: hit(0.002, 0.01) });
          mallet(d, sr, 0.02, 784, 0.1, 0.25, 3);
          mallet(d, sr, 0.11, 1174.7, 0.09, 0.3, 3);
        },
        { fade: 0.15, gain: 0.483 },
      ),
    };

    Board.define({
      id: 'minimal',
      fonts: {
        brand: "'Onest Variable'",
        load: ["'Onest Variable'"],
        credits: [{ family: 'Onest', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 150, close: 100, stagger: 10 },
      palette: {
        light: {
          bg: '#f3f4f7',
          surface: '#ffffff',
          'surface-2': '#f6f7fa',
          border: '#e1e3ea',
          'border-strong': '#b9becc',
          text: '#16181d',
          'text-muted': '#5a6070',
          accent: '#3b4bdb',
          'on-accent': '#ffffff',
          focus: '#3b4bdb',
          success: '#138a4b',
          'on-success': '#ffffff',
          'success-text': '#0f7a41',
          warning: '#c27c0e',
          'warning-text': '#8a5600',
          danger: '#c42b3b',
          desk: 'linear-gradient(135deg, #d9e1f2 0%, #ece4f2 55%, #e4eef0 100%)',
          'wheel-face': 'rgba(251, 251, 253, 0.8)',
          'wheel-slice': '#fafafc',
          'wheel-slice-hover': '#e7eafb',
          'wheel-slice-selected': '#3b4bdb',
          'wheel-text': '#16181d',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#e1e3ea',
          'wheel-shadow': 'rgba(20, 24, 40, 0.24)',
        },
        dark: {
          bg: '#1c1d22',
          surface: '#26272d',
          'surface-2': '#2e2f36',
          border: '#3a3c44',
          'border-strong': '#5a5d69',
          text: '#f2f3f6',
          'text-muted': '#a9adba',
          accent: '#8e9bff',
          'on-accent': '#0e1240',
          focus: '#a6b0ff',
          success: '#3ccb7f',
          'on-success': '#08240f',
          'success-text': '#5fd897',
          warning: '#f2b33d',
          'warning-text': '#f5c264',
          danger: '#ff6b78',
          desk: 'linear-gradient(135deg, #1e2336 0%, #2a2133 55%, #1d2a2e 100%)',
          'wheel-face': 'rgba(38, 39, 46, 0.84)',
          'wheel-slice': '#2a2b32',
          'wheel-slice-hover': '#363b60',
          'wheel-slice-selected': '#8e9bff',
          'wheel-text': '#f2f3f6',
          'wheel-text-selected': '#0e1240',
          'wheel-line': '#3a3c44',
          'wheel-shadow': 'rgba(0, 0, 0, 0.5)',
        },
      },
      defs: `
      <filter id="minimal-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>`,

      wheel: {
        render(root, m, H) {
          const R0 = 80,
            R1 = 186;
          H.s('circle', { cx: H.C, cy: H.C, r: R1 + 4, class: 'mn-rim' }, root);
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R0 + 4, R1, sl.a0, sl.a1, 4), class: 'mn-seg' }, g);
            H.s('path', { d: H.arc(R1 + 9, sl.a0 + 5, sl.a1 - 5), class: 'mn-ind' }, g);
            const c = H.s('g', { class: 'mn-content' }, g);
            // Formats read as their name, large, with a second line where they have one.
            if (sl.format) {
              H.block(c, sl, 136, {
                size: 22,
                subSize: 12.5,
                gap: 2,
                maxWidth: 84,
                cls: 'mn-lbl mn-fmt',
                subCls: 'mn-sub',
              });
            } else {
              H.block(c, sl, 136, {
                icon: true,
                iconSize: 25,
                size: 14,
                gap: 5,
                maxWidth: 82,
                minSize: 9,
                cls: 'mn-lbl',
                sub: null,
              });
            }
            // More choices: a small arrowhead pointing out, just inside the rim.
            H.ringMark(g, sl, m, { r: 178, size: 8, cls: 'mn-ring-mark' });
          }
          // Center: what wheel this is and which file it acts on.
          const ctr = H.s('g', { class: 'mn-center' }, root);
          H.s('circle', { cx: H.C, cy: H.C, r: R0 - 4, class: 'mn-hub' }, ctr);
          // Without a key the title and the file move down to the middle.
          const dy = m.key ? 0 : 9;
          H.label(ctr, H.C, H.C - 16 + dy, m.title, {
            maxWidth: 120,
            size: 15,
            minSize: 10,
            cls: 'mn-title',
            maxLines: 1,
          });
          H.label(ctr, H.C, H.C + 5 + dy, m.file, {
            maxWidth: 120,
            size: 11.5,
            minSize: 9,
            cls: 'mn-file',
            maxLines: 1,
          });
          // The key that opened the wheel; a ring opened without one shows none.
          if (m.key) {
            const kw = 12 + m.key.length * 7.5;
            H.s('rect', { x: H.C - kw / 2, y: H.C + 21, width: kw, height: 19, rx: 5, class: 'mn-key' }, ctr);
            H.text(ctr, H.C, H.C + 31, m.key, { class: 'mn-keytext' });
          }
        },
      },

      sounds: SOUNDS,
    });
  })();
}
