// SPDX-License-Identifier: MIT
// Theme: Ayçiçeği (sunflower). The slices are petals around a seed head laid out on the golden
// angle. Applying a slice lifts its petal toward the light and spirals seeds into the hub.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const GOLDEN = 137.50776;
    // Radii in the 400 x 400 wheel: seed disc, petal base, widest point, tip, label line.
    const R = { disc: 80, base: 72, wide: 132, tip: 195, label: 140 };

    const reducedMotion = () =>
      document.documentElement.classList.contains('reduce-motion') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    // A petal pointing up from the center (C, C): base at radius r0, widest (half-width w) at rw,
    // a soft point at r1. Its group rotates it into place.
    function petal(r0, rw, r1, w, C = 200) {
      const y = (r) => f2(C - r);
      const x = (d) => f2(C + d);
      const lo = rw - r0;
      const hi = r1 - rw;
      return (
        `M${C} ${y(r0)}` +
        `C${x(w * 0.5)} ${y(r0 + lo * 0.18)} ${x(w)} ${y(rw - lo * 0.5)} ${x(w)} ${y(rw)}` +
        `C${x(w)} ${y(rw + hi * 0.42)} ${x(w * 0.2)} ${y(r1 - hi * 0.1)} ${C} ${y(r1)}` +
        `C${x(-w * 0.2)} ${y(r1 - hi * 0.1)} ${x(-w)} ${y(rw + hi * 0.42)} ${x(-w)} ${y(rw)}` +
        `C${x(-w)} ${y(rw - lo * 0.5)} ${x(-w * 0.5)} ${y(r0 + lo * 0.18)} ${C} ${y(r0)}Z`
      );
    }

    // How far the petal reaches to either side at radius r: its outline sampled from the base out.
    function petalHalf(r, w) {
      const bez = (p, t) =>
        (1 - t) ** 3 * p[0] + 3 * (1 - t) ** 2 * t * p[1] + 3 * (1 - t) * t ** 2 * p[2] + t ** 3 * p[3];
      const lo = R.wide - R.base;
      const hi = R.tip - R.wide;
      const legs = [
        [
          [0, w * 0.5, w, w],
          [R.base, R.base + lo * 0.18, R.wide - lo * 0.5, R.wide],
        ],
        [
          [w, w, w * 0.2, 0],
          [R.wide, R.wide + hi * 0.42, R.tip - hi * 0.1, R.tip],
        ],
      ];
      let last = [0, R.base];
      for (const [xs, ys] of legs)
        for (let k = 1; k <= 24; k++) {
          const p = [bez(xs, k / 24), bez(ys, k / 24)];
          if (p[1] >= r) return last[0] + ((p[0] - last[0]) * (r - last[1])) / Math.max(1e-6, p[1] - last[1]);
          last = p;
        }
      return 0;
    }

    // The length of the mark of a slice that opens a ring of choices.
    const MARK = 8.5;
    // Where that mark goes: just inside the petal's edge towards the next petal, at the outermost
    // radius where it keeps clear of the label (a label lying along a petal reaches far out).
    function markSpot(H, sl, w, ink) {
      let box = null;
      try {
        box = ink.getBBox();
      } catch {
        box = null;
      }
      const clear = (x, y) => {
        if (!box || !box.width) return true;
        const dx = Math.max(box.x - x, 0, x - box.x - box.width);
        const dy = Math.max(box.y - y, 0, y - box.y - box.height);
        return Math.hypot(dx, dy) >= MARK / 2 + 4;
      };
      let first = null;
      for (let r = 180; r >= 120; r -= 2) {
        const side = petalHalf(r - MARK / 2, w) - MARK * 0.75;
        if (side <= 2) continue;
        const offset = (Math.asin(side / r) * 180) / Math.PI;
        first = first || { r, offset };
        const [x, y] = H.polar(r - MARK / 2, sl.mark === null ? sl.mid : sl.mid + Math.sign(sl.mark - sl.mid) * offset);
        if (clear(x, y)) return { r, offset };
      }
      return first;
    }

    // Seeds on the golden angle (Vogel's model): seed k sits at radius c * sqrt(k). One path for
    // the whole band keeps the node count low.
    function seedPath(cx, cy, c, rMin, rMax, s0, s1) {
      let d = '';
      const k0 = Math.ceil((rMin / c) ** 2);
      const k1 = Math.floor((rMax / c) ** 2);
      for (let k = Math.max(1, k0); k <= k1; k++) {
        const r = c * Math.sqrt(k);
        const a = (k * GOLDEN * Math.PI) / 180;
        const x = cx + r * Math.sin(a);
        const y = cy - r * Math.cos(a);
        const s = s0 + ((s1 - s0) * (r - rMin)) / Math.max(1, rMax - rMin);
        d += `M${f2(x - s)} ${f2(y)}a${f2(s)} ${f2(s)} 0 1 0 ${f2(2 * s)} 0a${f2(s)} ${f2(s)} 0 1 0 ${f2(-2 * s)} 0`;
      }
      return d;
    }

    // Short grooves near the tip of a petal (upright, like petal()).
    function veins(C = 200) {
      const y = (r) => f2(C - r);
      return (
        `M${C} ${y(160)}L${C} ${y(185)}` +
        `M${C - 14} ${y(156)}Q${C - 12} ${y(172)} ${C - 5} ${y(182)}` +
        `M${C + 14} ${y(156)}Q${C + 12} ${y(172)} ${C + 5} ${y(182)}` +
        `M${C - 8} ${y(86)}L${C - 9} ${y(100)}M${C + 8} ${y(86)}L${C + 9} ${y(100)}`
      );
    }

    function stops(parent, H, list) {
      for (const [o, v] of list) H.s('stop', { offset: o, style: `stop-color: var(--${v})` }, parent);
    }

    // Sounds. Every voice is drawn sample by sample into a buffer, a few takes of it once per sample
    // rate, and then only played: a tick costs one buffer source and one gain, and no two calls in a
    // row sound quite alike (another take, played a little faster or slower).
    function rng(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const TAKES = new Map();
    const VOICES = [];
    // A voice: v.draw(y, sr, rand) draws a take of v.len seconds (v.takes of them, each its own
    // rand), v.level sets its loudness and v.spread how much faster or slower a call may play it.
    function voice(v) {
      VOICES.push(v);
      return (ac, out, t) => play(ac, out, t, v);
    }
    function takeOf(ac, v, k) {
      const key = v.name + ac.sampleRate;
      let list = TAKES.get(key);
      if (!list) TAKES.set(key, (list = []));
      if (!list[k]) list[k] = take(ac, v, 7 + k * 977);
      return list[k];
    }
    function play(ac, out, t, v) {
      const buf = takeOf(ac, v, Math.floor(Math.random() * v.takes));
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * v.spread;
      const g = ac.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v.level, t + 0.0005);
      src.connect(g).connect(out);
      src.start(t);
      src.stop(t + buf.duration / (1 - v.spread) + 0.02);
      warm(ac);
    }
    // After the first sound, the takes not drawn yet are drawn one at a time while the page is idle,
    // the apply's first, so no sound waits on its drawing.
    let warming = false;
    function warm(ac) {
      if (warming || typeof window === 'undefined') return;
      warming = true;
      const later = (f) => (window.requestIdleCallback ? window.requestIdleCallback(f) : window.setTimeout(f, 50));
      const order = [...VOICES].sort((a, b) => (b.name === 'success') - (a.name === 'success'));
      const jobs = [];
      for (let k = 0; k < 8; k++) for (const v of order) if (k < v.takes) jobs.push([v, k]);
      const next = () => {
        const job = jobs.shift();
        if (!job) return;
        takeOf(ac, job[0], job[1]);
        later(next);
      };
      later(next);
    }
    // One take: drawn, kept above 90 Hz (no rumble small speakers cannot play, no offset) and below
    // v.lp, faded out over its last eighth and scaled to the energy of every other take of the voice.
    function take(ac, v, seed) {
      const sr = ac.sampleRate;
      const y = new Float32Array(Math.ceil(v.len * sr));
      v.draw(y, sr, rng(seed));
      const hp = svf(sr);
      const lp = svf(sr);
      const fade = Math.round(Math.max(0.003, v.len * 0.12) * sr);
      let sum = 0;
      for (let i = 0; i < y.length; i++) {
        hp.run(y[i], 90, 0.7);
        let s = hp.h;
        if (v.lp) {
          lp.run(s, v.lp, 0.7);
          s = lp.l;
        }
        if (i > y.length - fade) s *= 0.5 - 0.5 * Math.cos((Math.PI * (y.length - i)) / fade);
        y[i] = s;
        sum += s * s;
      }
      const scale = 0.1 / Math.sqrt(sum / y.length || 1);
      for (let i = 0; i < y.length; i++) y[i] *= scale;
      const buf = ac.createBuffer(1, y.length, sr);
      buf.getChannelData(0).set(y);
      return buf;
    }
    // A state-variable filter that stays steady while its frequency moves: run() leaves the band
    // (at 0 dB), low and high outputs in b, l and h.
    function svf(sr) {
      const s = { b: 0, l: 0, h: 0 };
      let z1 = 0,
        z2 = 0,
        pf = 0,
        pq = 0,
        k = 1,
        a1 = 0,
        a2 = 0,
        a3 = 0;
      s.run = (x, f, q) => {
        if (f !== pf || q !== pq) {
          pf = f;
          pq = q;
          const g = Math.tan((Math.PI * Math.min(f, sr * 0.45)) / sr);
          k = 1 / q;
          a1 = 1 / (1 + g * (g + k));
          a2 = g * a1;
          a3 = g * a2;
        }
        const v3 = x - z2;
        const v1 = a1 * z1 + a2 * v3;
        const v2 = z2 + a2 * z1 + a3 * v3;
        z1 = 2 * v1 - z1;
        z2 = 2 * v2 - z2;
        s.b = k * v1;
        s.l = v2;
        s.h = x - k * v1 - v2;
        return s.b;
      };
      return s;
    }
    // A damped partial, the way a struck body rings: it starts from zero and dies away over tau.
    function ring(y, sr, at, f, tau, amp) {
      const i0 = Math.round(at * sr);
      const n = Math.min(y.length - i0, Math.ceil(tau * 7 * sr));
      const w = (2 * Math.PI * f) / sr;
      const c = Math.cos(w) * Math.exp(-1 / (tau * sr));
      const s = Math.sin(w) * Math.exp(-1 / (tau * sr));
      let re = amp,
        im = 0;
      for (let i = 0; i < n; i++) {
        y[i0 + i] += im;
        const r = re * c - im * s;
        im = re * s + im * c;
        re = r;
      }
    }
    // A crack: a sliver of noise through a resonance, the contact of a hit or the grain of a crackle
    // (amp is about its peak).
    function crack(y, sr, rand, at, f, q, amp, len) {
      const fl = svf(sr);
      const i0 = Math.round(at * sr);
      const n = Math.max(2, Math.round(len * sr));
      const end = Math.min(y.length - i0, n + Math.round((q / f) * 4 * sr));
      for (let i = 0; i < end; i++) {
        const e = i < n ? (rand() * 2 - 1) * (1 - i / n) : 0;
        y[i0 + i] += 3 * amp * fl.run(e, f, q);
      }
    }
    // Noise through a moving band: shape(u) gives the level and the band's centre, u from 0 to 1.
    function hiss(y, sr, rand, at, len, q, shape) {
      const fl = svf(sr);
      const i0 = Math.round(at * sr);
      const n = Math.min(y.length - i0, Math.round(len * sr));
      // The shape moves slowly next to the samples: it is read every 16 of them, the level eased
      // between readings and starting from silence.
      let a0 = 0,
        a1 = 0,
        f = 1000;
      for (let i = 0; i < n; i++) {
        const j = i % 16;
        if (!j) {
          a0 = a1;
          [a1, f] = shape(Math.min(1, (i + 16) / n));
        }
        y[i0 + i] += (a0 + ((a1 - a0) * j) / 16) * fl.run(rand() * 2 - 1, f, q);
      }
    }
    // A petal brushing past: smooth, silky noise that swells and fades as its band slides.
    function swish(y, sr, rand, at, len, f0, f1, amp, q = 1) {
      hiss(y, sr, rand, at, len, q, (u) => [amp * Math.sin(Math.PI * u) ** 2, f0 * (f1 / f0) ** u]);
    }
    // A sunflower seed landing: a small, dry, woody click of its husk.
    function husk(y, sr, rand, at, amp) {
      const f = 1100 + rand() * 500;
      crack(y, sr, rand, at, 1800 + rand() * 1200, 3, amp, 0.0003);
      ring(y, sr, at, f, 0.003, 0.5 * amp);
      ring(y, sr, at, f * 2.4, 0.0015, 0.2 * amp);
    }
    // Sunlight: a soft, warm chord that blooms slowly and fades, each note a slightly detuned pair.
    function glow(y, sr, at, len, amp, notes) {
      const i0 = Math.round(at * sr);
      const n = Math.min(y.length - i0, Math.round(len * sr));
      for (const [f, a] of notes)
        for (const d of [0.9985, 1.0015]) {
          const w = (2 * Math.PI * f * d) / sr;
          const c = Math.cos(w);
          const s = Math.sin(w);
          let re = 0.5 * amp * a,
            im = 0;
          for (let i = 0; i < n; i++) {
            y[i0 + i] += im * Math.min(1, i / (0.06 * sr)) * (1 - i / n) ** 2;
            const r = re * c - im * s;
            im = re * s + im * c;
            re = r;
          }
        }
    }
    // How loud each voice plays, measured so that the theme sits as loud as every other one.
    const LEVEL = { open: 0.061, tick: 0.035, enter: 0.023, leave: 0.023, success: 0.108 };

    Board.define({
      id: 'aycicegi',
      fonts: {
        brand: "'Playpen Sans Variable'",
        display: "'Playpen Sans Variable'",
        load: ["'Playpen Sans Variable'"],
        credits: [{ family: 'Playpen Sans', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 180, close: 120, stagger: 12, apply: 680 },

      palette: {
        light: {
          bg: '#f4f7ef',
          surface: '#ffffff',
          'surface-2': '#eef3e4',
          border: '#d8e1c8',
          'border-strong': '#a6b58a',
          text: '#1f2a10',
          'text-muted': '#535e3c',
          accent: '#3f6f12',
          'on-accent': '#ffffff',
          focus: '#2a6db0',
          success: '#2e7d32',
          'on-success': '#ffffff',
          'success-text': '#256b29',
          warning: '#b8770b',
          'warning-text': '#7a4e00',
          danger: '#c0362c',
          desk: 'linear-gradient(180deg, #8fcdef 0%, #bfe3f4 52%, #e6f2d4 100%)',
          'wheel-face': '#2c3810',
          'wheel-slice': '#fcc93a',
          'wheel-slice-hover': '#ffe37e',
          'wheel-slice-selected': '#ff9a2e',
          'wheel-text': '#2a2706',
          'wheel-text-selected': '#2a1400',
          'wheel-sub': '#5a4808',
          'wheel-line': '#e3940c',
          'wheel-shadow': 'rgba(34, 62, 22, 0.32)',
          'petal-base': '#f0a314',
          'petal-mid': '#fbc632',
          'petal-tip': '#ffdb57',
          'petal-edge': '#e08d0a',
          'back-base': '#de8a0c',
          'back-tip': '#f4b22a',
          glow: '#fff3a3',
          flash: '#fff8d6',
          'disc-in': '#3e4c18',
          'disc-out': '#202a0a',
          seed: '#71822a',
          floret: '#e9b83d',
          'hub-text': '#fff3c9',
          'hub-muted': '#d9d09b',
          'key-bg': 'rgba(255, 243, 201, 0.12)',
          'key-line': 'rgba(255, 243, 201, 0.5)',
        },
        dark: {
          bg: '#10132e',
          surface: '#181c3d',
          'surface-2': '#20254b',
          border: '#2e3460',
          'border-strong': '#4a5290',
          text: '#f4efd9',
          'text-muted': '#b8b49c',
          accent: '#f5b83a',
          'on-accent': '#1d1500',
          focus: '#9fb7ff',
          success: '#6fd07a',
          'on-success': '#0b2210',
          'success-text': '#7fdc8a',
          warning: '#f2b84b',
          'warning-text': '#f5c869',
          danger: '#ff7b6e',
          desk: 'radial-gradient(1.6px 1.6px at 14% 20%, #ffffff 40%, transparent 100%), radial-gradient(1.2px 1.2px at 78% 12%, #fff6d8 40%, transparent 100%), radial-gradient(1.8px 1.8px at 88% 70%, #ffffff 40%, transparent 100%), radial-gradient(1.2px 1.2px at 8% 82%, #dfe6ff 40%, transparent 100%), radial-gradient(1.4px 1.4px at 46% 6%, #ffffff 40%, transparent 100%), radial-gradient(1.2px 1.2px at 30% 94%, #fff6d8 40%, transparent 100%), radial-gradient(120% 95% at 50% 0%, #2b3274 0%, #171b47 55%, #0b0e2b 100%)',
          'wheel-face': '#1b2309',
          'wheel-slice': '#e0a12c',
          'wheel-slice-hover': '#ffcd57',
          'wheel-slice-selected': '#ff9d3c',
          'wheel-text': '#1c1500',
          'wheel-text-selected': '#1f0f00',
          'wheel-sub': '#3d2c00',
          'wheel-line': '#b36f0c',
          'wheel-shadow': 'rgba(0, 0, 8, 0.6)',
          'petal-base': '#c06d0e',
          'petal-mid': '#df9c26',
          'petal-tip': '#f7d47c',
          'petal-edge': 'rgba(206, 218, 255, 0.7)',
          'back-base': '#a65f0c',
          'back-tip': '#cf8c22',
          glow: '#ffe7a0',
          flash: '#fff4cc',
          'disc-in': '#2c3611',
          'disc-out': '#121805',
          seed: '#5b6c24',
          floret: '#cfa032',
          'hub-text': '#fff0c2',
          'hub-muted': '#cfc697',
          'key-bg': 'rgba(255, 240, 194, 0.1)',
          'key-line': 'rgba(255, 240, 194, 0.42)',
        },
      },
      contrast: [
        ['text', 'bg', 'text'],
        ['text', 'surface', 'text'],
        ['text-muted', 'bg', 'text'],
        ['text-muted', 'surface', 'text'],
        ['on-accent', 'accent', 'text'],
        ['accent', 'surface', 'ui'],
        ['focus', 'bg', 'ui'],
        ['success', 'surface', 'ui'],
        ['wheel-text', 'wheel-slice', 'text'],
        ['wheel-text', 'wheel-slice-hover', 'text'],
        ['wheel-text-selected', 'wheel-slice-selected', 'text'],
        ['wheel-text', 'petal-base', 'text'],
        ['wheel-sub', 'wheel-slice', 'text'],
        ['wheel-sub', 'wheel-slice-hover', 'text'],
        ['hub-text', 'wheel-face', 'text'],
        ['hub-muted', 'wheel-face', 'text'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const defs = H.s('defs', {}, root);
          const pid = H.uid('aycicegi-p');
          const bid = H.uid('aycicegi-b');
          const did = H.uid('aycicegi-d');
          // Gradients in the upright petal space: every rotated petal shares them.
          stops(
            H.s(
              'linearGradient',
              { id: pid, gradientUnits: 'userSpaceOnUse', x1: C, y1: C - R.base, x2: C, y2: C - R.tip },
              defs,
            ),
            H,
            [
              [0, 'petal-base'],
              [0.45, 'petal-mid'],
              [1, 'petal-tip'],
            ],
          );
          stops(
            H.s(
              'linearGradient',
              { id: bid, gradientUnits: 'userSpaceOnUse', x1: C, y1: C - 90, x2: C, y2: C - 196 },
              defs,
            ),
            H,
            [
              [0, 'back-base'],
              [1, 'back-tip'],
            ],
          );
          stops(H.s('radialGradient', { id: did, cx: 0.5, cy: 0.5, r: 0.5 }, defs), H, [
            [0, 'disc-in'],
            [0.7, 'disc-in'],
            [1, 'disc-out'],
          ]);

          // Back row: narrower petals at the slice borders, reaching a little further out. Wide slices
          // (fewer than six) get more of them, so the flower stays full with two petals or eight.
          const back = H.s('g', { class: 'ay-back', 'aria-hidden': 'true' }, root);
          for (const sl of m.slices) {
            const per = Math.max(1, Math.round(sl.step / 30));
            const bp = petal(86, 150, 197, Math.min(34, 25 + (sl.step - 45) * 0.3));
            for (let j = 0; j < per; j++) {
              const a = sl.a0 + (j * sl.step) / per;
              if (Math.abs(a - sl.mid) < 10) continue;
              H.s(
                'path',
                { d: bp, fill: `url(#${bid})`, class: 'ay-bp', transform: `rotate(${f2(a)} ${C} ${C})` },
                back,
              );
            }
          }

          const vein = veins();
          for (const sl of m.slices) {
            // The petal widens with its slice, up to a point where it still reads as a petal.
            const w = Math.min(60, 47 + (sl.step - 45) * 0.3);
            const front = petal(R.base, R.wide, R.tip, w);
            const glow = petal(R.base, R.wide + 4, R.tip + 10, w + 8);
            const room = Math.round(w * 1.55);
            const g = H.slice(root, sl, m);
            g.style.setProperty('--ux', f2(Math.sin(H.rad(sl.mid))));
            g.style.setProperty('--uy', f2(-Math.cos(H.rad(sl.mid))));
            H.s('path', { d: H.sector(R.disc, 199, sl.a0, sl.a1), class: 'ay-hit' }, g);
            const unf = H.s('g', { class: 'ay-unfurl' }, g);
            const lift = H.s('g', { class: 'ay-lift' }, unf);
            const rot = H.s('g', { transform: `rotate(${f2(sl.mid)} ${C} ${C})` }, lift);
            H.s('path', { d: glow, class: 'ay-glow' }, rot);
            H.s('path', { d: front, class: 'ay-petal', fill: `url(#${pid})` }, rot);
            H.s('path', { d: front, class: 'ay-tint' }, rot);
            H.s('path', { d: vein, class: 'ay-vein' }, rot);
            const ink = H.s('g', { class: 'ay-ink' }, lift);
            if (sl.format) {
              H.block(ink, sl, R.label, {
                size: 23,
                subSize: 12.5,
                gap: 1,
                maxWidth: room + 2,
                minSize: 9,
                cls: 'ay-lbl',
                subCls: 'ay-sub',
              });
            } else {
              H.block(ink, sl, R.label, {
                icon: true,
                iconSize: 22,
                size: 14,
                gap: 3,
                maxWidth: room,
                minSize: 9,
                cls: 'ay-lbl ay-lbl-s',
                sub: null,
              });
            }
            // More choices: an arrowhead inside the petal's edge towards the next one, as near the tip
            // as the petal is wide enough to hold it clear of the label.
            if (sl.ring) {
              const spot = markSpot(H, sl, w, ink);
              H.ringMark(lift, sl, m, { r: spot.r, size: MARK, offset: spot.offset, cls: 'ay-ring-mark' });
            }
          }

          // The seed head: florets at the rim, seeds on the golden angle, a calm middle for the text.
          const disc = H.s('g', { class: 'ay-disc', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: C, cy: C, r: R.disc, fill: `url(#${did})`, class: 'ay-head' }, disc);
          H.s('path', { d: seedPath(C, C, 3.5, 2, 49, 1.1, 1.5), class: 'ay-seeds-in' }, disc);
          H.s('path', { d: seedPath(C, C, 3.5, 49, 70, 1.5, 2.3), class: 'ay-seeds' }, disc);
          H.s('path', { d: seedPath(C, C, 3.5, 70, 78.5, 2.3, 2.5), class: 'ay-florets' }, disc);
          H.s('circle', { cx: C, cy: C, r: R.disc - 0.5, class: 'ay-rim' }, disc);

          // The hub: title, file and the key that opened the wheel (none for some wheels).
          const hub = H.s('g', { class: 'ay-hub' }, root);
          const dy = m.key ? 0 : 9;
          H.label(hub, C, C - 15 + dy, m.title, {
            maxWidth: 88,
            size: 16.5,
            minSize: 10,
            cls: 'ay-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 5.5 + dy, m.file, {
            maxWidth: 82,
            size: 11.5,
            minSize: 8.5,
            cls: 'ay-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.6;
            H.s('rect', { x: f2(C - kw / 2), y: C + 18, width: f2(kw), height: 17, rx: 8.5, class: 'ay-key' }, hub);
            H.text(hub, C, C + 26.8, m.key, { class: 'ay-keytext' });
          }

          H.s('g', { class: 'ay-fx', 'aria-hidden': 'true' }, root);
        },

        onOpen(root) {
          const wrap = root.closest('.wheel');
          if (wrap && wrap.classList.contains('has-selected')) return;
          const fx = root.querySelector('.ay-fx');
          if (fx) fx.textContent = '';
        },

        // Rays at the petal tip and ten seeds that spiral from the petal into the head. The motion
        // itself is CSS (rotate + translate interpolate into a spiral); frozen frames use --t.
        onSelect(root, m, i, H, t) {
          const fx = root.querySelector('.ay-fx');
          fx.textContent = '';
          if (t == null && reducedMotion()) return;
          const sl = m.slices[i];
          const C = H.C;
          for (let k = 0; k < 5; k++) {
            const g = H.s('g', { transform: `rotate(${f2(sl.mid + (k - 2) * 7.5)} ${C} ${C})` }, fx);
            const long = k === 2 ? 36 : k % 2 ? 28 : 21;
            H.s(
              'path',
              {
                class: 'ay-ray',
                style: `--k: ${Math.abs(k - 2)}`,
                d: `M${C - 4.5} ${C - 200}L${C} ${C - 200 - long}L${C + 4.5} ${C - 200}Z`,
              },
              g,
            );
          }
          const turn = m.dir === 'rtl' ? -1 : 1;
          for (let k = 0; k < 12; k++) {
            const a0 = sl.mid + ((k % 5) - 2) * 5;
            const a1 = a0 + turn * (220 + k * 8);
            const r0 = 104 + ((k * 23) % 70);
            const seed = H.s(
              'g',
              { class: 'ay-fly', style: `--a0: ${f2(a0)}deg; --a1: ${f2(a1)}deg; --r0: ${r0}; --d: ${30 + k * 21}ms` },
              fx,
            );
            H.s(
              'path',
              {
                class: 'ay-fly-shell',
                d: `M${C} ${C - 6}C${C + 4.2} ${C - 3} ${C + 3.6} ${C + 4} ${C} ${C + 5.5}C${C - 3.6} ${C + 4} ${C - 4.2} ${C - 3} ${C} ${C - 6}Z`,
              },
              seed,
            );
            H.s('path', { class: 'ay-fly-stripe', d: `M${C} ${C - 4.5}L${C} ${C + 4}` }, seed);
          }
        },
      },

      sounds: {
        // The petals unfurl one after another in a silky rustle, on a warm breath of summer air.
        open: voice({
          name: 'open',
          len: 0.45,
          takes: 3,
          spread: 0.02,
          level: LEVEL.open,
          lp: 7000,
          draw(y, sr, rand) {
            for (let k = 0; k < 8; k++) {
              const f = 1600 + rand() * 1000;
              swish(y, sr, rand, 0.002 + k * 0.022 + rand() * 0.008, 0.07, f, f * 1.5, 0.6);
            }
            hiss(y, sr, rand, 0.002, 0.4, 0.7, (u) => [0.35 * Math.sin(Math.PI * u), 700 + 300 * u]);
            glow(y, sr, 0.1, 0.34, 0.25, [
              [392, 1],
              [523.3, 0.8],
              [659.3, 0.5],
            ]);
          },
        }),
        // A petal leans out: a soft, silky brush.
        tick: voice({
          name: 'tick',
          len: 0.055,
          takes: 8,
          spread: 0.05,
          level: LEVEL.tick,
          lp: 7000,
          draw(y, sr, rand) {
            crack(y, sr, rand, 0.003, 2800 + rand() * 600, 1.2, 0.25, 0.0003);
            swish(y, sr, rand, 0.002, 0.045, 2200 + rand() * 500, 3400 + rand() * 500, 1, 1.1);
          },
        }),
        // The flower turns on its stem: a leafy sweep and the stalk creaking as it bends.
        enter: voice({
          name: 'enter',
          len: 0.22,
          takes: 4,
          spread: 0.04,
          level: LEVEL.enter,
          lp: 7000,
          draw(y, sr, rand) {
            swish(y, sr, rand, 0.002, 0.12, 900, 1800, 1, 0.8);
            [
              [0.03, 330, 0.3],
              [0.06, 310, 0.22],
              [0.09, 345, 0.15],
            ].forEach(([at, f, a]) => {
              ring(y, sr, at, f, 0.012, a);
              crack(y, sr, rand, at, 700, 2, 0.5 * a, 0.0006);
            });
          },
        }),
        // Back out: the head swings back with a lighter sweep.
        leave: voice({
          name: 'leave',
          len: 0.14,
          takes: 4,
          spread: 0.04,
          level: LEVEL.leave,
          lp: 7000,
          draw(y, sr, rand) {
            swish(y, sr, rand, 0.002, 0.08, 2400, 1500, 0.8);
            ring(y, sr, 0.05, 320, 0.01, 0.15);
          },
        }),
        // The petal rises to the light in a warm bloom of sun, and seeds spiral into the head, landing
        // one by one with dry little clicks as it bobs.
        success: voice({
          name: 'success',
          len: 1,
          takes: 3,
          spread: 0.015,
          level: LEVEL.success,
          lp: 7000,
          draw(y, sr, rand) {
            swish(y, sr, rand, 0.002, 0.2, 1200, 3000, 1, 0.9);
            glow(y, sr, 0.07, 0.85, 0.7, [
              [349.2, 1],
              [440, 0.8],
              [523.3, 0.7],
              [698.5, 0.35],
            ]);
            for (let k = 0; k < 12; k++) husk(y, sr, rand, 0.45 + 0.021 * k + rand() * 0.02, 0.9 - k * 0.03);
            ring(y, sr, 0.42, 300, 0.018, 0.5);
            hiss(y, sr, rand, 0.42, 0.03, 1, (u) => [0.3 * (1 - u) ** 2, 600]);
          },
        }),
      },
    });
  })();
}
