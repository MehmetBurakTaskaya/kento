// SPDX-License-Identifier: MIT
// Theme: Lolipop. A big swirl candy on a stick: every slice is one twisting pastel arm between
// white sugar stripes, under a glossy shine and a dusting of sugar. Applying cracks the arm:
// a zigzag crack splits it, the outer shard jumps, and sugar crystals sparkle out.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const ID = 'lolipop';
    // Radii in the 400 x 400 view box. The arms twist by TW degrees from the hub to the rim: flat
    // through the labels, curling toward the hub and the rim, so every label sits on its slice's own
    // angle with the whole width of its arm.
    const R = { hub: 46, disc: 176, lbl: 111, crack: 151 };
    const TW = 40;
    const tw = (r) => {
      const u = Math.max(-1, Math.min(1, (r - R.lbl) / (R.disc - R.lbl)));
      return (TW / 2) * Math.sign(u) * Math.abs(u) ** 2.2;
    };
    // The widest label the slice holds around the point at radius R.lbl on its centre line: on each
    // line the label covers, the distance to the nearer edge of the slice (between radii r0 and r1,
    // less `pad`), so a slice on the side of the wheel, where text runs along the radius, gets more
    // room than one at the top. Labels stay upright, so this is what fits whatever the angle.
    const room = (H, sl, r0, r1, pad, twist = () => 0) => {
      const [cx, cy] = H.polar(R.lbl, sl.mid);
      const inside = (x, y) => {
        const r = Math.hypot(x - 200, y - 200);
        if (r < r0 || r > r1) return false;
        const a = (Math.atan2(x - 200, 200 - y) * 180) / Math.PI - twist(r);
        return (((a - sl.a0) % 360) + 360) % 360 <= sl.a1 - sl.a0;
      };
      let half = 66;
      for (const y of [cy - 11, cy, cy + 11]) {
        let left = 0;
        let right = 0;
        while (left < 66 + pad && inside(cx - left - 1, y)) left += 1;
        while (right < 66 + pad && inside(cx + right + 1, y)) right += 1;
        half = Math.min(half, Math.min(left, right) - pad);
      }
      return Math.max(44, 2 * half);
    };
    // Four candy colours in turn; a wheel of 5 (or 9) slices ends on the third, so that no two
    // neighbours, the last and the first among them, share a colour.
    const family = (k, n) => (n % 4 === 1 && k === n - 1 ? 3 : (k % 4) + 1);
    const STICK = 135; // the stick leaves the candy toward the lower right

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
    // The effect plays only while the wheel is applying: with reduced motion the app never sets it.
    const applying = (root) => {
      const wheel = root.closest('.wheel');
      return !!wheel && wheel.classList.contains('is-applying');
    };
    const dot = (x, y, r) =>
      `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
    const star = (x, y, s) =>
      `M${f2(x)} ${f2(y - s)}L${f2(x + s * 0.24)} ${f2(y - s * 0.24)}L${f2(x + s)} ${f2(y)}L${f2(x + s * 0.24)} ${f2(y + s * 0.24)}L${f2(x)} ${f2(y + s)}L${f2(x - s * 0.24)} ${f2(y + s * 0.24)}L${f2(x - s)} ${f2(y)}L${f2(x - s * 0.24)} ${f2(y - s * 0.24)}Z`;
    function stop(grad, H, offset, token, op) {
      H.s('stop', { offset, style: `stop-color: var(${token})${op != null ? `; stop-opacity: ${op}` : ''}` }, grad);
    }

    // Points along the twisted boundary that starts at angle a, from radius r0 to r1.
    function edge(H, a, r0, r1, steps = 14) {
      const pts = [];
      for (let k = 0; k <= steps; k++) {
        const r = r0 + ((r1 - r0) * k) / steps;
        pts.push(H.polar(r, a + tw(r)));
      }
      return pts;
    }
    const line = (pts, first = 'M') => pts.map(([x, y], k) => (k ? 'L' : first) + f2(x) + ' ' + f2(y)).join('');
    // The crack across an arm at radius R.crack, from its a0 edge to its a1 edge.
    function crackPts(H, sl) {
      const pts = [];
      // One tooth every six degrees or so, so a wide arm cracks as finely as a narrow one.
      const n = Math.max(7, Math.round((sl.a1 - sl.a0) / 6));
      for (let k = 0; k <= n; k++) {
        const a = sl.a0 + ((sl.a1 - sl.a0) * k) / n;
        const r = R.crack + (k === 0 || k === n ? 0 : k % 2 ? 5 : -4);
        pts.push(H.polar(r, a + tw(r)));
      }
      return pts;
    }
    // An arc of radius r over `span` degrees to the point `to`, centred on angle `mid` (twisted): a
    // wheel of one slice goes round the whole circle, which one arc command cannot draw.
    function arcTo(H, r, span, mid, to, sweep) {
      const flag = span > 180 ? 1 : 0;
      if (span < 359.9) return `A${r} ${r} 0 ${flag} ${sweep} ${f2(to[0])} ${f2(to[1])}`;
      const [mx, my] = H.polar(r, mid);
      return `A${r} ${r} 0 0 ${sweep} ${f2(mx)} ${f2(my)}A${r} ${r} 0 0 ${sweep} ${f2(to[0])} ${f2(to[1])}`;
    }
    function armPath(H, sl, r0, r1) {
      const a = edge(H, sl.a0, r0, r1);
      const b = edge(H, sl.a1, r0, r1).reverse();
      const span = sl.a1 - sl.a0;
      return (
        line(a) +
        arcTo(H, r1, span, sl.mid + tw(r1), b[0], 1) +
        line(b.slice(1), 'L') +
        arcTo(H, r0, span, sl.mid + tw(r0), a[0], 0) +
        'Z'
      );
    }
    // The arm broken in two along the crack.
    function innerPiece(H, sl) {
      const a = edge(H, sl.a0, R.hub, R.crack, 10);
      const b = edge(H, sl.a1, R.hub, R.crack, 10).reverse();
      return (
        line(a) +
        line(crackPts(H, sl).slice(1), 'L') +
        line(b.slice(1), 'L') +
        arcTo(H, R.hub, sl.a1 - sl.a0, sl.mid + tw(R.hub), a[0], 0) +
        'Z'
      );
    }
    function outerPiece(H, sl) {
      const a = edge(H, sl.a0, R.crack, R.disc, 4);
      const b = edge(H, sl.a1, R.crack, R.disc, 4).reverse();
      return (
        line(a) +
        arcTo(H, R.disc, sl.a1 - sl.a0, sl.mid + tw(R.disc), b[0], 1) +
        line(b.slice(1), 'L') +
        line(crackPts(H, sl).reverse().slice(1), 'L') +
        'Z'
      );
    }

    // Sounds. Every voice is drawn sample by sample into a buffer, a few takes of it once per sample
    // rate, and then only played: a tick costs one buffer source and one gain, and no two calls in a
    // row sound quite alike (another take, played a little faster or slower).
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
    // Hard sugar knocking on hard sugar: a bright, glassy tick ringing in a few close partials.
    function glass(y, sr, rand, at, f, tau, amp, hard = 0.5) {
      crack(y, sr, rand, at, 5200 + rand() * 1000, 2, hard * amp, 0.0002);
      [
        [1, 1, 1],
        [1.53, 0.6, 0.7],
        [2.33, 0.35, 0.5],
        [2.9, 0.2, 0.35],
      ].forEach(([r, a, d]) => {
        if (f * r < 7600) ring(y, sr, at, f * r * (0.995 + rand() * 0.01), tau * d, amp * a);
      });
    }
    // The cellophane wrapper: crinkles, each a cluster of sharp little snaps; shape(u) says how
    // busy it is.
    function crinkle(y, sr, rand, at, len, events, amp, shape) {
      for (let k = 0; k < events; k++) {
        const u = rand();
        const a = amp * shape(u) * (0.2 + 0.8 * rand() ** 2);
        for (let n = 0, m = 2 + Math.floor(rand() * 5); n < m; n++)
          crack(
            y,
            sr,
            rand,
            at + u * len + rand() * 0.002,
            2500 + rand() * 4000,
            1.5 + rand() * 1.5,
            a * (0.3 + rand() * 0.7),
            0.0001 + rand() * 0.0002,
          );
      }
    }
    // Sticky sugar letting go: a run of tiny tacky clicks, ever closer, then the release.
    function tack(y, sr, rand, at, len, count, amp) {
      for (let k = 0; k < count; k++) {
        const u = rand() ** 0.5;
        crack(y, sr, rand, at + u * len, 900 + rand() * 1600, 1.2, amp * (0.2 + 0.5 * rand()) * u, 0.0002);
      }
      crack(y, sr, rand, at + len, 1400, 1.4, amp, 0.0004);
    }
    // A sugar crystal twinkling: a small chime with a faint octave.
    function twinkle(y, sr, at, f, amp) {
      ring(y, sr, at, f, 0.07, amp);
      ring(y, sr, at, f * 2, 0.035, 0.25 * amp);
    }
    // How loud each voice plays, measured so that the theme sits as loud as every other one.
    const LEVEL = { open: 0.062, tick: 0.069, enter: 0.046, leave: 0.045, success: 0.113 };

    Board.define({
      id: ID,
      fonts: {
        brand: "'Sour Gummy'",
        load: ["'Sour Gummy'"],
        credits: [{ family: 'Sour Gummy', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 190, close: 120, stagger: 12, apply: 640 },
      palette: {
        light: {
          bg: '#fdf7fb',
          surface: '#ffffff',
          'surface-2': '#faf0f7',
          border: '#efd9e8',
          'border-strong': '#d3a7c6',
          text: '#2e1238',
          'text-muted': '#6b4f73',
          accent: '#b3124f',
          'on-accent': '#ffffff',
          focus: '#7a3fc4',
          success: '#2f8a5a',
          'on-success': '#ffffff',
          'success-text': '#22704a',
          warning: '#b86e00',
          'warning-text': '#7a4800',
          danger: '#c8243b',
          desk: 'radial-gradient(120% 100% at 20% 10%, #ffffff 0%, #fdf0f7 40%, #e8eefc 100%)',
          'wheel-face': '#fffaf3',
          'wheel-slice': '#ffbfd2',
          'wheel-slice-hover': '#ff8fb3',
          'wheel-slice-selected': '#b3124f',
          'wheel-text': '#341040',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#fffaf3',
          'wheel-shadow': 'rgba(120, 60, 140, 0.25)',
          'lp-c1': '#ffbfd2',
          'lp-c2': '#b4ecd6',
          'lp-c3': '#fff0a0',
          'lp-c4': '#dccbf5',
          'lp-h1': '#ff8fb3',
          'lp-h2': '#7fdcb8',
          'lp-h3': '#ffdc5c',
          'lp-h4': '#c3a6f0',
          'lp-stripe': '#fffaf3',
          'lp-core': '#fffaf3',
          'lp-rim': 'rgba(150, 70, 140, 0.35)',
          'lp-gloss': '#ffffff',
          'lp-gloss-op': '0.6',
          'lp-sugar': '#ffffff',
          'lp-sugar-op': '0.9',
          'lp-crack': '#fffaf3',
          'lp-sub': '#4a1a55',
          'lp-sub-sel': '#ffe3ee',
          'lp-stick': '#fffdf8',
          'lp-stick-line': '#f4c2d6',
          'lp-stick-edge': '#e6d6de',
          'lp-bow': '#ff7aa8',
          'lp-bow-dark': '#d94c82',
          'lp-hub-text': '#341040',
          'lp-hub-sub': '#6b4f73',
          'lp-key': '#b3124f',
          'lp-key-text': '#ffffff',
          'lp-ring': '#ffbfd2',
          'lp-crystal-a': '#ffffff',
          'lp-crystal-b': '#ff8fb3',
          'lp-crystal-c': '#7fdcb8',
        },
        dark: {
          bg: '#120d1e',
          surface: '#1c1530',
          'surface-2': '#251c3c',
          border: '#372a55',
          'border-strong': '#56447f',
          text: '#f6effc',
          'text-muted': '#bcaed6',
          accent: '#ff8fbe',
          'on-accent': '#2a0618',
          focus: '#c9a6ff',
          success: '#6fd3a0',
          'on-success': '#06210f',
          'success-text': '#86e0b4',
          warning: '#ffbf5a',
          'warning-text': '#ffd080',
          danger: '#ff6b85',
          desk: 'radial-gradient(110% 100% at 75% 10%, #2e2152 0%, #1a1233 45%, #0c0918 100%)',
          'wheel-face': '#f6eaf6',
          'wheel-slice': '#8e1650',
          'wheel-slice-hover': '#b01d66',
          'wheel-slice-selected': '#ffb8d4',
          'wheel-text': '#ffffff',
          'wheel-text-selected': '#3a0a22',
          'wheel-line': '#f6eaf6',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'lp-c1': '#8e1650',
          'lp-c2': '#0e6a63',
          'lp-c3': '#a8360b',
          'lp-c4': '#5b2a9e',
          'lp-h1': '#b01d66',
          'lp-h2': '#0f7d74',
          'lp-h3': '#c2410c',
          'lp-h4': '#7438c0',
          'lp-stripe': '#f6eaf6',
          'lp-core': '#f6eaf6',
          'lp-rim': 'rgba(255, 255, 255, 0.25)',
          'lp-gloss': '#ffffff',
          'lp-gloss-op': '0.4',
          'lp-sugar': '#ffffff',
          'lp-sugar-op': '0.85',
          'lp-crack': '#2a0a22',
          'lp-sub': '#fff4f9',
          'lp-sub-sel': '#5a1238',
          'lp-stick': '#efe6f0',
          'lp-stick-line': '#b86a9a',
          'lp-stick-edge': '#9a8aa6',
          'lp-bow': '#ff7aa8',
          'lp-bow-dark': '#c43c74',
          'lp-hub-text': '#3a0a22',
          'lp-hub-sub': '#6b3a58',
          'lp-key': '#8e1650',
          'lp-key-text': '#ffffff',
          'lp-ring': '#b01d66',
          'lp-crystal-a': '#ffffff',
          'lp-crystal-b': '#ffb8d4',
          'lp-crystal-c': '#9ff0d8',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['wheel-text', 'lp-c1', 'text'],
        ['wheel-text', 'lp-c2', 'text'],
        ['wheel-text', 'lp-c3', 'text'],
        ['wheel-text', 'lp-c4', 'text'],
        ['wheel-text', 'lp-h1', 'text'],
        ['wheel-text', 'lp-h2', 'text'],
        ['wheel-text', 'lp-h3', 'text'],
        ['wheel-text', 'lp-h4', 'text'],
        ['lp-sub', 'lp-c1', 'text'],
        ['lp-sub', 'lp-c2', 'text'],
        ['lp-sub', 'lp-c3', 'text'],
        ['lp-sub', 'lp-c4', 'text'],
        ['lp-sub', 'lp-h1', 'text'],
        ['lp-sub', 'lp-h2', 'text'],
        ['lp-sub', 'lp-h3', 'text'],
        ['lp-sub', 'lp-h4', 'text'],
        ['lp-sub-sel', 'wheel-slice-selected', 'text'],
        ['lp-hub-text', 'lp-core', 'text'],
        ['lp-hub-sub', 'lp-core', 'text'],
        ['lp-key-text', 'lp-key', 'text'],
      ],
      // Gradients are built per wheel in render(): they read the palette tokens of their own card.
      defs: '',

      wheel: {
        render(root, m, H) {
          const uid = H.uid(ID);
          const rand = rng(2718 + m.n);
          const defs = H.s('defs', {}, root);
          const sh = H.s(
            'radialGradient',
            { id: `${uid}-shadow`, gradientUnits: 'userSpaceOnUse', cx: 206, cy: 212, r: R.disc + 14 },
            defs,
          );
          stop(sh, H, 0.85, '--wheel-shadow');
          stop(sh, H, 1, '--wheel-shadow', 0);
          const gl = H.s(
            'radialGradient',
            { id: `${uid}-gloss`, gradientUnits: 'userSpaceOnUse', cx: 150, cy: 120, r: 190 },
            defs,
          );
          stop(gl, H, 0, '--lp-gloss', 0.32);
          stop(gl, H, 0.55, '--lp-gloss', 0);

          // The stick with its bow, under the candy.
          const back = H.s('g', { class: 'lp-back', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: 206, cy: 212, r: R.disc + 14, fill: `url(#${uid}-shadow)` }, back);
          const [s0x, s0y] = H.polar(R.disc - 20, STICK);
          const [s1x, s1y] = H.polar(R.disc + 96, STICK);
          H.s('path', { d: `M${f2(s0x)} ${f2(s0y)}L${f2(s1x)} ${f2(s1y)}`, class: 'lp-stick-edge' }, back);
          H.s('path', { d: `M${f2(s0x)} ${f2(s0y)}L${f2(s1x)} ${f2(s1y)}`, class: 'lp-stick' }, back);
          let lines = '';
          for (let k = 0; k < 7; k++) {
            const [x, y] = H.polar(R.disc + 14 + k * 12, STICK);
            lines += `M${f2(x - 6)} ${f2(y + 1)}L${f2(x + 1)} ${f2(y - 6)}`;
          }
          H.s('path', { d: lines, class: 'lp-stick-line' }, back);
          const [bx, by] = H.polar(R.disc + 6, STICK);
          const bow = H.s('g', { class: 'lp-bow', transform: `translate(${f2(bx)} ${f2(by)}) rotate(-45)` }, back);
          H.s(
            'path',
            {
              d: 'M0 0C-6 -14 -20 -14 -20 -3C-20 6 -8 6 0 0ZM0 0C6 -14 20 -14 20 -3C20 6 8 6 0 0Z',
              class: 'lp-bow-loop',
            },
            bow,
          );
          H.s('path', { d: 'M-2 2L-9 16L-4 15L-1 19ZM2 2L9 16L4 15L1 19Z', class: 'lp-bow-tail' }, bow);
          H.s('circle', { cx: 0, cy: 0, r: 3.6, class: 'lp-bow-knot' }, bow);
          // The candy under the arms shows through the cracks.
          H.s('circle', { cx: 200, cy: 200, r: R.disc + 1, class: 'lp-base' }, root);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const fam = family(sl.i, m.n);
            g.style.setProperty('--arm', `var(--lp-c${fam})`);
            g.style.setProperty('--arm-h', `var(--lp-h${fam})`);
            const t = H.rad(sl.mid);
            g.style.setProperty('--ux', f2(Math.sin(t)));
            g.style.setProperty('--uy', f2(-Math.cos(t)));
            const lift = H.s('g', { class: 'lp-lift' }, g);
            H.s('path', { d: armPath(H, sl, R.hub, R.disc), class: 'lp-arm' }, lift);
            const broken = H.s('g', { class: 'lp-broken' }, lift);
            H.s('path', { d: innerPiece(H, sl), class: 'lp-piece' }, broken);
            const shard = H.s('g', { class: 'lp-shard' }, broken);
            H.s('path', { d: outerPiece(H, sl), class: 'lp-piece' }, shard);
            H.s('path', { d: line(crackPts(H, sl)), class: 'lp-crack', pathLength: 1 }, broken);
            // A bright lick of light along the rim of the arm under the pointer.
            const [q0x, q0y] = H.polar(R.disc - 9, sl.a0 + tw(R.disc - 9) + 6);
            const [q1x, q1y] = H.polar(R.disc - 9, sl.a1 + tw(R.disc - 9) - 6);
            H.s(
              'path',
              {
                d:
                  `M${f2(q0x)} ${f2(q0y)}` +
                  arcTo(H, R.disc - 9, sl.a1 - sl.a0 - 12, sl.mid + tw(R.disc - 9), [q1x, q1y], 1),
                class: 'lp-rimlight',
              },
              lift,
            );
            // The shine sits under the label, so the text keeps its full color.
            H.s('path', { d: armPath(H, sl, R.hub, R.disc), fill: `url(#${uid}-gloss)`, class: 'lp-sheen' }, lift);
            if (sl.off) H.s('path', { d: armPath(H, sl, R.hub, R.disc), class: 'lp-off' }, lift);
            const c = H.s('g', { class: 'lp-content' }, lift);
            const maxWidth = room(H, sl, R.hub, R.disc, 5, tw);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 27,
                subSize: 13,
                gap: -1,
                maxWidth,
                minSize: 11,
                cls: 'lp-lbl lp-fmt',
                subCls: 'lp-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 15,
                gap: 2,
                maxWidth,
                minSize: 8.5,
                cls: 'lp-lbl lp-word',
                sub: null,
              });
            }
            // More choices: an arrowhead on the arm just inside the crack, so it stays on the piece that
            // keeps its place when the candy breaks, following the swirl.
            H.ringMark(lift, sl, m, {
              r: R.crack - 7,
              size: 9,
              offset: 11,
              turn: tw(R.crack - 11.5),
              cls: 'lp-ring-mark',
            });
            H.s('g', { class: 'lp-fx' }, g);
          }

          // Sugar stripes along the swirl, the shine, a dusting of sugar and the rim.
          const top = H.s('g', { class: 'lp-top', 'aria-hidden': 'true' }, root);
          let stripes = '';
          for (const sl of m.slices) stripes += line(edge(H, sl.a0, R.hub, R.disc, 16));
          H.s('path', { d: stripes, class: 'lp-stripes' }, top);
          const [g0x, g0y] = H.polar(R.disc - 14, 284);
          const [g1x, g1y] = H.polar(R.disc - 14, 338);
          H.s(
            'path',
            {
              d: `M${f2(g0x)} ${f2(g0y)}A${R.disc - 14} ${R.disc - 14} 0 0 1 ${f2(g1x)} ${f2(g1y)}`,
              class: 'lp-gloss',
            },
            top,
          );
          let sugar = '';
          let sparks = '';
          for (let k = 0; k < 46; k++) {
            const ring = rand() < 0.62;
            const r = ring ? R.disc - 26 + rand() * 22 : R.hub + 6 + rand() * 20;
            const [x, y] = H.polar(r, rand() * 360);
            if (k % 6 === 0) sparks += star(x, y, 2.6 + rand() * 2.2);
            else sugar += dot(x, y, 0.5 + rand() * 0.8);
          }
          H.s('path', { d: sugar, class: 'lp-sugar' }, top);
          H.s('path', { d: sparks, class: 'lp-spark' }, top);
          H.s('circle', { cx: 200, cy: 200, r: R.disc, class: 'lp-rim' }, top);

          // The hub: a round of plain candy with the name, the file and the key.
          const hub = H.s('g', { class: 'lp-hub' }, root);
          H.s('circle', { cx: 200, cy: 200, r: R.hub, class: 'lp-core' }, hub);
          // Without a key (a ring opened from the menu) the name and the file sit in the middle.
          const low = m.key ? 0 : 8;
          H.label(hub, 200, 184 + low, m.title, { maxWidth: 80, size: 17, minSize: 9, cls: 'lp-title', maxLines: 1 });
          H.label(hub, 200, 201 + low, m.file, {
            maxWidth: 76,
            size: 12,
            minSize: 9,
            cls: 'lp-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.3;
            H.s('rect', { x: f2(200 - kw / 2), y: 210, width: f2(kw), height: 16, rx: 8, class: 'lp-key' }, hub);
            H.text(hub, 200, 218.5, m.key, { class: 'lp-keytext' });
          }
        },

        // Sugar crystals burst from the crack and twinkle away; built for the effect only.
        onSelect(root, m, i, H, t) {
          root.querySelectorAll('.lp-fx').forEach((n) => (n.textContent = ''));
          if (t == null && !applying(root)) return;
          const g = root.querySelector(`.slice[data-slice="${i}"]`);
          const sl = m.slices[i];
          const fx = g.querySelector('.lp-fx');
          const rand = rng(99 + i * 7);
          const pts = crackPts(H, sl);
          const cols = ['a', 'b', 'c'];
          for (let k = 0; k < 18; k++) {
            const [px, py] = pts[1 + Math.floor(rand() * (pts.length - 2))];
            const a = sl.mid + (rand() - 0.5) * 120;
            const dist = 20 + rand() * 46;
            const ta = H.rad(a);
            const at = H.s('g', { transform: `translate(${f2(px)} ${f2(py)})` }, fx);
            const fly = H.s('g', { class: 'lp-crystal' }, at);
            fly.style.setProperty('--dx', f2(Math.sin(ta) * dist) + 'px');
            fly.style.setProperty('--dy', f2(-Math.cos(ta) * dist) + 'px');
            fly.style.setProperty('--rot', Math.round((rand() - 0.5) * 360) + 'deg');
            fly.style.setProperty('--d', Math.round(90 + rand() * 60) + 'ms');
            const s = 2 + rand() * 2.6;
            H.s(
              'path',
              {
                d: `M0 ${f2(-s * 1.3)}L${f2(s * 0.8)} 0L0 ${f2(s * 1.3)}L${f2(-s * 0.8)} 0Z`,
                class: 'lp-crystal-' + cols[k % 3],
              },
              fly,
            );
          }
          for (let k = 0; k < 4; k++) {
            const [px, py] = pts[1 + Math.floor(rand() * (pts.length - 2))];
            const ox = (rand() - 0.5) * 50;
            const oy = (rand() - 0.5) * 50;
            const at = H.s('g', { transform: `translate(${f2(px + ox)} ${f2(py + oy)})` }, fx);
            const tw2 = H.s('path', { d: star(0, 0, 6 + rand() * 4), class: 'lp-twinkle' }, at);
            tw2.style.setProperty('--d', Math.round(120 + k * 90 + rand() * 40) + 'ms');
          }
          if (t != null) return;
          clearTimeout(root.__lpFx);
          root.__lpFx = setTimeout(() => (fx.textContent = ''), 720);
        },
      },

      sounds: {
        // The cellophane crinkles open and the candy lands on the table with a glassy tok and a hop.
        open: voice({
          name: 'open',
          len: 0.36,
          takes: 3,
          spread: 0.02,
          level: LEVEL.open,
          lp: 7500,
          draw(y, sr, rand) {
            crinkle(y, sr, rand, 0.002, 0.22, 24, 5, (u) => Math.sin(Math.PI * u) ** 0.5);
            glass(y, sr, rand, 0.13, 1500, 0.03, 0.7, 0.6);
            glass(y, sr, rand, 0.2, 1560, 0.02, 0.3);
          },
        }),
        // Two arms of hard candy touching: a small glassy tik.
        tick: voice({
          name: 'tick',
          len: 0.05,
          takes: 8,
          spread: 0.05,
          level: LEVEL.tick,
          lp: 7500,
          draw(y, sr, rand) {
            glass(y, sr, rand, 0.002, 2700 + rand() * 800, 0.01, 1);
          },
        }),
        // The arm comes away from its neighbours with a tacky little peel, then knocks free.
        enter: voice({
          name: 'enter',
          len: 0.16,
          takes: 4,
          spread: 0.04,
          level: LEVEL.enter,
          lp: 7500,
          draw(y, sr, rand) {
            tack(y, sr, rand, 0.002, 0.045, 26, 2.5);
            glass(y, sr, rand, 0.055, 2100, 0.02, 0.8);
          },
        }),
        // Back out: the candy set down again, a glassy tok and two small hops.
        leave: voice({
          name: 'leave',
          len: 0.14,
          takes: 4,
          spread: 0.04,
          level: LEVEL.leave,
          lp: 7500,
          draw(y, sr, rand) {
            glass(y, sr, rand, 0.002, 1800, 0.025, 1);
            glass(y, sr, rand, 0.045, 1830, 0.018, 0.3);
            glass(y, sr, rand, 0.075, 1850, 0.012, 0.1);
          },
        }),
        // A tap, then the arm cracks: a brittle snap running down the zigzag, the shard landing, sugar
        // crystals scattering and twinkling.
        success: voice({
          name: 'success',
          len: 0.66,
          takes: 3,
          spread: 0.02,
          level: LEVEL.success,
          lp: 7500,
          draw(y, sr, rand) {
            glass(y, sr, rand, 0.01, 1900, 0.02, 0.6);
            crack(y, sr, rand, 0.08, 3000, 1, 1.3, 0.0004);
            crack(y, sr, rand, 0.081, 1800, 1.5, 0.9, 0.0006);
            glass(y, sr, rand, 0.08, 2300, 0.015, 0.6, 0.2);
            for (let k = 0; k < 18; k++)
              crack(y, sr, rand, 0.085 + 0.155 * (k / 18) ** 0.6, 2000 + rand() * 4000, 1.6, 0.6 - k * 0.018, 0.0002);
            for (let k = 0; k < 10; k++) glass(y, sr, rand, 0.1 + rand() * 0.26, 4300 + rand() * 1500, 0.006, 0.15);
            [0.12, 0.21, 0.3, 0.39].forEach((at, k) =>
              twinkle(y, sr, at + rand() * 0.04, [3136, 3520, 3951, 3322][k] * (0.98 + rand() * 0.04), 0.22),
            );
            glass(y, sr, rand, 0.45, 3000, 0.018, 0.45);
            glass(y, sr, rand, 0.51, 3050, 0.012, 0.15);
          },
        }),
      },
    });
  })();
}
