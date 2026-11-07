// SPDX-License-Identifier: MIT
// Pusula. A compass rose drawn on chart paper: every slice is a direction, and a
// needle swings to the slice under the pointer or the keyboard.
export default function register(Board) {
  (function () {
    'use strict';

    // The italic and the heavier Fira weights are not in the engine's font wait list; ask for
    // them now so labels are measured in the right face (document.fonts.ready waits for them).
    if (document.fonts) {
      for (const f of [
        "italic 400 16px 'Vollkorn Variable'",
        "600 16px 'Vollkorn Variable'",
        "500 16px 'Fira Sans'",
        "600 16px 'Fira Sans'",
      ]) {
        document.fonts.load(f).catch(() => null);
      }
    }

    // Radii of the wheel (viewBox 400 x 400, center 200, 200).
    const R = { cap: 56, tip: 105, tail: 86, inner: 102, label: 141, outer: 180, band: 192, rim: 196 };
    const f2 = (n) => Math.round(n * 100) / 100;

    // A kite on the line at angle a: from radius r0 to r1, widest (half-width w) at radius rw.
    // Returns its two halves, counterclockwise side first, as path data.
    function kite(H, a, r0, r1, rw, w) {
      const rad = H.rad(a);
      const u = [Math.sin(rad), -Math.cos(rad)];
      const v = [Math.cos(rad), Math.sin(rad)];
      const p = (r, s) => `${f2(H.C + u[0] * r + v[0] * s)} ${f2(H.C + u[1] * r + v[1] * s)}`;
      return [`M${p(r0, 0)}L${p(rw, -w)}L${p(r1, 0)}Z`, `M${p(r0, 0)}L${p(rw, w)}L${p(r1, 0)}Z`];
    }

    // Where the first slice points: twelve o'clock, or wherever a ring of choices was turned to.
    const origin = (m) => (m.slices.length ? m.slices[0].mid : 0);
    // Where the needle rests when nothing is aimed at: the star point between the last slice and
    // the first one, so it never seems to pick a slice. Mirrored in right-to-left languages.
    const restAngle = (m) => origin(m) + ((m.dir === 'rtl' ? 1 : -1) * m.step) / 2;

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
    // The needle's swing is a breath of air through a narrow band that follows its angle, as loud as it swings
    // fast; where it turns back, its jewel pivot ticks. The chart is paper: a dry crackle of grains.
    function pivot(d, sr, t, amp) {
      tap(d, sr, t, 3600, amp);
      mode(d, sr, t, 2490, amp * 0.25, 0.006);
    }
    const paper = (d, sr, t, dur, amp, f, env) => hiss(d, sr, t, dur, amp, { f, q: 1.2, grain: 0.35, env });
    // The needle settling on its bearing: past it, back, and still, as its swing eases do.
    const overshoot = (u) => 1 - Math.exp(-5 * u) * Math.cos(9 * u);

    const SOUNDS = {
      // The chart unfolds with a papery rustle, and the needle swings in, wobbling to rest with small ticks on its
      // pivot (its swings of 111, 22, 8 and 2 degrees, as the open animation draws them).
      open: drawn(
        'pusula:open',
        0.36,
        (d, sr) => {
          paper(d, sr, 0, 0.19, 0.06, 2500, swell(0.3));
          hiss(d, sr, 0, 0.17, 0.04, { f: 700, q: 0.8, grain: 0.5, env: swell(0.4) });
          for (const [t, dur, k, f0, f1] of [
            [0.073, 0.068, 1, 1400, 2600],
            [0.141, 0.044, 0.31, 2600, 2000],
            [0.185, 0.034, 0.15, 2000, 2300],
            [0.219, 0.024, 0.05, 2300, 2200],
          ])
            hiss(d, sr, t, dur, 0.07 * k, { f: f0, to: f1, q: 4, env: swell(0.5) });
          pivot(d, sr, 0.141, 0.18);
          pivot(d, sr, 0.185, 0.14);
          pivot(d, sr, 0.219, 0.07);
        },
        { fade: 0.06, gain: 0.689 },
      ),
      // The needle swings to the slice: a quick breath of air that bends as it overshoots, a whisper of chart
      // paper and a tiny tick of the pivot.
      tick: drawn(
        'pusula:tick',
        0.06,
        (d, sr, v, r) => {
          const f = 2100 * (1 + 0.05 * r());
          hiss(d, sr, 0, 0.04, 0.05, { f: f * 0.7, to: f, q: 5, path: overshoot, env: swell(0.35) });
          paper(d, sr, 0, 0.022, 0.015, 3200, swell(0.3));
          pivot(d, sr, 0.03, 0.14);
        },
        { vary: 6, rate: 0.03, fade: 0.012, gain: 1.22 },
      ),
      // The chart turns to a new bearing: a quick slide of paper, then the needle swings over with a firm tick.
      enter: drawn(
        'pusula:enter',
        0.22,
        (d, sr, v, r) => {
          hiss(d, sr, 0, 0.11, 0.05, { f: 1800, to: 2600, q: 1.2, grain: 0.35, env: swell(0.5) });
          hiss(d, sr, 0.05, 0.1, 0.06, {
            f: 1500,
            to: 2400 * (1 + 0.03 * r()),
            q: 4,
            path: overshoot,
            env: swell(0.4),
          });
          pivot(d, sr, 0.15, 0.3);
          mode(d, sr, 0.15, 1400, 0.03, 0.012);
        },
        { vary: 3, fade: 0.04, gain: 0.524 },
      ),
      // Back to the last bearing: the paper slides the other way and the needle swings back with a lighter tick.
      leave: drawn(
        'pusula:leave',
        0.2,
        (d, sr, v, r) => {
          hiss(d, sr, 0, 0.1, 0.045, { f: 2600, to: 1800, q: 1.2, grain: 0.35, env: swell(0.5) });
          hiss(d, sr, 0.04, 0.09, 0.05, {
            f: 2600,
            to: 1700 * (1 + 0.03 * r()),
            q: 4,
            path: overshoot,
            env: swell(0.4),
          });
          pivot(d, sr, 0.125, 0.24);
          mode(d, sr, 0.125, 1900, 0.025, 0.01);
        },
        { vary: 3, fade: 0.04, gain: 0.583 },
      ),
      // The bearing is stamped onto the chart with a firm papery thump, the needle locks with three small shakes on
      // its pivot, and the brass case hums a short note.
      success: drawn(
        'pusula:success',
        1,
        (d, sr) => {
          mode(d, sr, 0, 180, 0.08, 0.03, { a: 0.002 });
          mode(d, sr, 0, 410, 0.04, 0.02, { a: 0.0015 });
          hiss(d, sr, 0, 0.06, 0.12, { f: 1500, q: 0.7, env: hit(0.001, 0.02) });
          paper(d, sr, 0, 0.05, 0.08, 3500, hit(0.001, 0.012));
          for (const [t, a] of [
            [0.076, 0.14],
            [0.171, 0.09],
            [0.266, 0.05],
          ]) {
            hiss(d, sr, t - 0.03, 0.04, a * 0.3, { f: 2000, q: 4, env: swell(0.6) });
            pivot(d, sr, t, a);
          }
          for (const [k, a, tau] of [
            [1, 0.09, 0.32],
            [1.004, 0.03, 0.3],
            [2.76, 0.02, 0.12],
            [5.4, 0.006, 0.05],
          ])
            mode(d, sr, 0.076, 698.5 * k, a, tau, { a: 0.004 });
        },
        { fade: 0.25, gain: 0.737 },
      ),
    };

    Board.define({
      id: 'pusula',
      fonts: {
        brand: "'Fira Sans'",
        display: "'Vollkorn Variable'",
        load: ["'Vollkorn Variable'", "'Fira Sans'"],
        // Fira Sans first: the type specimen is set in the brand face and labeled with credits[0].
        credits: [
          { family: 'Fira Sans', license: 'SIL Open Font License 1.1' },
          { family: 'Vollkorn', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 120, stagger: 9 },

      palette: {
        light: {
          bg: '#f5f0e6',
          layer: '#fbf8f1',
          surface: '#fffdf8',
          'surface-2': '#efe8da',
          border: '#e1d7c4',
          'border-strong': '#b3a385',
          text: '#1d2836',
          'text-muted': '#5c5649',
          accent: '#a83a22',
          'on-accent': '#fffaf1',
          focus: '#235d8c',
          success: '#2f7a4d',
          'on-success': '#ffffff',
          'success-text': '#256840',
          warning: '#b8781a',
          'warning-text': '#7c4f0c',
          danger: '#b0281c',
          desk: 'linear-gradient(135deg, #c3cdd0 0%, #d8d5ca 55%, #c2cccb 100%)',
          'wheel-face': '#f4ead4',
          'paper-edge': '#e5d3ae',
          'wheel-slice': '#f4ead4',
          'wheel-slice-hover': '#ebd5bf',
          'wheel-slice-selected': '#a83a22',
          'wheel-text': '#1d2836',
          'wheel-text-selected': '#fff6e6',
          'wheel-sub': '#5e5545',
          'wheel-muted': '#7a6f5c',
          'wheel-line': '#8c7b5e',
          'wheel-ink': '#1d2836',
          'wheel-shadow': 'rgba(52, 38, 14, 0.34)',
          needle: '#a83a22',
          'needle-dark': '#76261a',
          'needle-rest': '#4b5767',
          'needle-rest-dark': '#2c3746',
          rhumb: 'rgba(122, 98, 60, 0.3)',
          hatch: 'rgba(29, 40, 54, 0.26)',
          'grain-opacity': '0.55',
        },
        dark: {
          bg: '#0f1824',
          layer: '#132031',
          surface: '#18263a',
          'surface-2': '#1f2f44',
          border: '#2b3d53',
          'border-strong': '#4c6179',
          text: '#ece3cf',
          'text-muted': '#aeaa9e',
          accent: '#ef8b72',
          'on-accent': '#20100b',
          focus: '#8cc3ec',
          success: '#5cc98a',
          'on-success': '#0a2414',
          'success-text': '#6fd49a',
          warning: '#e9b155',
          'warning-text': '#f0c070',
          danger: '#ff7a6b',
          desk: 'linear-gradient(135deg, #0a1018 0%, #141b27 55%, #0c171c 100%)',
          'wheel-face': '#15273b',
          'paper-edge': '#0e1b2b',
          'wheel-slice': '#15273b',
          'wheel-slice-hover': '#284060',
          'wheel-slice-selected': '#ef8b72',
          'wheel-text': '#ece3cf',
          'wheel-text-selected': '#1a0f0a',
          'wheel-sub': '#a7b3bf',
          'wheel-muted': '#7d8a99',
          'wheel-line': '#7f95ad',
          'wheel-ink': '#d9cfb8',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          needle: '#ef8b72',
          'needle-dark': '#c25c46',
          'needle-rest': '#9aa7b5',
          'needle-rest-dark': '#71808f',
          rhumb: 'rgba(160, 186, 212, 0.22)',
          hatch: 'rgba(220, 210, 190, 0.24)',
          'grain-opacity': '0.8',
        },
      },
      contrast: [
        ['text', 'bg', 'text'],
        ['text', 'surface', 'text'],
        ['text-muted', 'bg', 'text'],
        ['text-muted', 'surface', 'text'],
        ['text-muted', 'layer', 'text'],
        ['text-muted', 'surface-2', 'text'],
        ['on-accent', 'accent', 'text'],
        ['accent', 'surface', 'ui'],
        ['focus', 'bg', 'ui'],
        ['success', 'surface', 'ui'],
        ['success-text', 'surface', 'text'],
        ['warning-text', 'surface', 'text'],
        ['on-success', 'success', 'text'],
        ['wheel-text', 'wheel-slice', 'text'],
        ['wheel-text', 'wheel-slice-hover', 'text'],
        ['wheel-text-selected', 'wheel-slice-selected', 'text'],
        ['wheel-sub', 'wheel-face', 'text'],
        ['wheel-sub', 'wheel-slice-hover', 'text'],
        ['wheel-ink', 'wheel-face', 'ui'],
        ['needle', 'wheel-face', 'ui'],
        ['needle-rest', 'wheel-face', 'ui'],
        ['wheel-muted', 'wheel-face', 'ui'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          // Chart lines under the slices: about 32 rhumb lines, the slice ring rules, the degree ring.
          // Both run from the first slice, so they meet the slice borders however many slices there
          // are and wherever a ring of choices was turned to.
          const face = H.s('g', { class: 'pu-face', 'aria-hidden': 'true' }, root);
          const a0 = origin(m);
          const lines = Math.max(4, Math.round(16 / m.n) * 2);
          let rh = '';
          for (let k = 0; k < m.n * lines; k++) {
            const a = a0 + (k * m.step) / lines;
            const [x0, y0] = H.polar(R.cap + 2, a);
            const [x1, y1] = H.polar(R.outer, a);
            rh += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d: rh, class: 'pu-rhumbs' }, face);
          // A degree ring of 72 to 120 ticks: the longest on each slice's centre line, then its borders.
          let ticks = '';
          const per = 12 * Math.max(1, Math.round(8 / m.n));
          for (let k = 0; k < m.n * per; k++) {
            const a = a0 + (k * m.step) / per;
            const len = k % per === 0 ? 9 : k % (per / 2) === 0 ? 7 : k % 3 === 0 ? 4.5 : 2.6;
            const [x0, y0] = H.polar(R.band - len, a);
            const [x1, y1] = H.polar(R.band, a);
            ticks += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d: ticks, class: 'pu-ticks' }, face);
          H.s('circle', { cx: C, cy: C, r: R.outer, class: 'pu-rule pu-rule-thin' }, face);
          H.s('circle', { cx: C, cy: C, r: R.band, class: 'pu-rule' }, face);
          H.s('circle', { cx: C, cy: C, r: R.rim, class: 'pu-rule pu-rim' }, face);
          H.s('circle', { cx: C, cy: C, r: R.inner, class: 'pu-rule' }, face);
          H.s('circle', { cx: C, cy: C, r: R.inner - 3.5, class: 'pu-rule pu-rule-thin' }, face);

          // Labels may be as wide as the wedge between two star points allows, and as the rings
          // above and below allow where a slice lies on its side: 70 there, up to 96 on a slice
          // that stands upright among few, so long words keep their size and wrap less.
          const across = 2 * (R.label - 12) * Math.sin(H.rad(Math.min(m.step, 180) / 2)) - 22;
          const width = (sl) => {
            const along = (2 * (R.label - R.inner - 4)) / Math.max(0.01, Math.abs(Math.sin(H.rad(sl.mid))));
            return Math.round(Math.max(70, Math.min(96, across, along)));
          };

          // Slices: a hit area from the hub to the rim, the visible wedge and the lubber mark.
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.cap, R.rim + 2, sl.a0, sl.a1), class: 'pu-hit' }, g);
            H.s('path', { d: H.sector(R.inner + 0.6, R.outer - 0.4, sl.a0, sl.a1), class: 'pu-wedge' }, g);
            if (sl.off) {
              // Not installed yet: hatched like uncharted water.
              const id = H.uid('pusula-clip');
              const cp = H.s('clipPath', { id }, g);
              H.s('path', { d: H.sector(R.inner + 1, R.outer - 1, sl.a0, sl.a1) }, cp);
              let d = '';
              for (let x = -400; x <= 400; x += 5.5) d += `M${x} 0L${x + 400} 400`;
              H.s('path', { d, class: 'pu-hatch', 'clip-path': `url(#${id})` }, g);
            }
            const d = 1.5;
            const [tx, ty] = H.polar(R.outer + 1.5, sl.mid);
            const [ax, ay] = H.polar(R.band - 0.5, sl.mid - d);
            const [bx, by] = H.polar(R.band - 0.5, sl.mid + d);
            H.s('path', { d: `M${f2(tx)} ${f2(ty)}L${f2(ax)} ${f2(ay)}L${f2(bx)} ${f2(by)}Z`, class: 'pu-mark' }, g);
            const c = H.s('g', { class: 'pu-ink' }, g);
            const wide = width(sl);
            // Formats are lettered large, as place names on the chart.
            if (sl.format) {
              H.block(c, sl, R.label, {
                size: 22,
                subSize: 12.5,
                gap: 1,
                maxWidth: wide - 2,
                minSize: 9,
                cls: 'pu-lbl pu-fmt pu-type',
                subCls: 'pu-sub pu-type',
              });
            } else {
              H.block(c, sl, R.label, {
                icon: true,
                iconSize: 23,
                size: 14.5,
                gap: 3.5,
                maxWidth: wide,
                minSize: 9.5,
                cls: 'pu-lbl pu-type',
                sub: null,
              });
            }
            // More choices: a needle's head pointing out to the band, beside the label.
            H.ringMark(g, sl, m, { r: R.outer - 4, size: 11, shape: 'dart', halo: 1.2, cls: 'pu-ring-mark' });
          }

          // Star points between the slices; the one where the needle rests is the north point.
          const rose = H.s('g', { class: 'pu-rose', 'aria-hidden': 'true' }, root);
          const rest = restAngle(m);
          for (const sl of m.slices) {
            // Each slice's a0 is one boundary; together they cover every boundary in both directions.
            const off = (((sl.a0 - rest) % 360) + 360) % 360;
            const isNorth = off < 0.01 || off > 359.99;
            const [l, r] = isNorth
              ? kite(H, sl.a0, R.inner - 1, R.rim, R.inner + 13, 8)
              : kite(H, sl.a0, R.inner - 1, R.band - 1, R.inner + 11, 6.2);
            const g = H.s('g', { class: 'pu-pt' + (isNorth ? ' pu-north' : '') }, rose);
            H.s('path', { d: l, class: 'pu-pt-a' }, g);
            H.s('path', { d: r, class: 'pu-pt-b' }, g);
          }

          // The needle pivots under the hub; update() turns the outer group, the open
          // animation swings the inner one.
          const nd = H.s('g', { class: 'pu-needle', 'aria-hidden': 'true' }, root);
          const sw = H.s('g', { class: 'pu-swing' }, nd);
          const W = 17;
          H.s('path', { d: `M${C} ${C - R.tip}L${C - W} ${C}L${C} ${C}Z`, class: 'pu-n-a' }, sw);
          H.s('path', { d: `M${C} ${C - R.tip}L${C + W} ${C}L${C} ${C}Z`, class: 'pu-n-b' }, sw);
          H.s('path', { d: `M${C} ${C + R.tail}L${C - W} ${C}L${C} ${C}Z`, class: 'pu-n-c' }, sw);
          H.s('path', { d: `M${C} ${C + R.tail}L${C + W} ${C}L${C} ${C}Z`, class: 'pu-n-d' }, sw);

          // Hub: the pivot cap carries the wheel's name, the file and the key that opened it.
          const cap = H.s('g', { class: 'pu-cap' }, root);
          H.s('circle', { cx: C, cy: C, r: R.cap, class: 'pu-cap-disc' }, cap);
          H.s('circle', { cx: C, cy: C, r: R.cap - 4.5, class: 'pu-cap-ring' }, cap);
          // Without a key the title and the file move down to the middle of the cap.
          const dy = m.key ? 0 : 8;
          H.label(cap, C, C - 17 + dy, m.title, {
            maxWidth: 86,
            size: 15.5,
            minSize: 10,
            cls: 'pu-title pu-type',
            maxLines: 1,
          });
          H.label(cap, C, C + 2 + dy, m.file, {
            maxWidth: 84,
            size: 11,
            minSize: 8.5,
            cls: 'pu-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.6;
            H.s('rect', { x: f2(C - kw / 2), y: C + 15, width: f2(kw), height: 17, rx: 8.5, class: 'pu-key' }, cap);
            H.text(cap, C, C + 23.8, m.key, { class: 'pu-keytext' });
          }
        },

        update(root, m, st) {
          const target = st.hover ?? st.selected;
          const goal = target == null ? restAngle(m) : m.slices[target].mid;
          const nd = root.querySelector('.pu-needle');
          const prev = nd.__angle;
          // Turn the short way round; the angle accumulates so the needle never spins back.
          const next = prev == null ? goal : prev + ((((goal - prev) % 360) + 540) % 360) - 180;
          nd.__angle = next;
          if (prev == null) {
            nd.style.transition = 'none';
            nd.style.transform = `rotate(${f2(next)}deg)`;
            void nd.getBoundingClientRect();
            nd.style.transition = '';
          } else {
            nd.style.transform = `rotate(${f2(next)}deg)`;
          }
          root.classList.toggle('pu-aiming', target != null);
          root.classList.toggle('pu-aim-off', target != null && m.slices[target].off);
        },

        onSelect(root) {
          root.classList.remove('pu-fix');
          void root.getBoundingClientRect();
          root.classList.add('pu-fix');
          clearTimeout(root.__fix);
          root.__fix = setTimeout(() => root.classList.remove('pu-fix'), 420);
        },
      },

      sounds: SOUNDS,
    });
  })();
}
