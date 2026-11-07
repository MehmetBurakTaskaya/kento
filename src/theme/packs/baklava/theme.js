// SPDX-License-Identifier: MIT
// Theme: Baklava. A round copper tray of baklava cut into diamonds: a hammered copper rim, golden
// flaky pastry scored in a diamond lattice with a pinch of pistachio on every piece, and a dollop
// of clotted cream in the middle. Applying drizzles glistening syrup over the slice; it stays glazed.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const ID = 'baklava';
    // Radii in the 400 x 400 view box: cream, pastry, flaky edge, tray floor, copper rim.
    const R = { hub: 46, p0: 50, flake: 166, p1: 174, floor: 181, rim: 195, lbl: 112 };
    // The mark of a slice that opens a ring of choices: its point's radius and its length.
    const MARK = { r: 157.5, size: 8.5 };
    const CUT = 2.2;
    const LAT = { s: 27, th: 32 }; // diamond lattice: spacing and angle from the vertical

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
    const dot = (x, y, r) =>
      `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
    function stop(grad, H, offset, token, op) {
      H.s('stop', { offset, style: `stop-color: var(${token})${op != null ? `; stop-opacity: ${op}` : ''}` }, grad);
    }

    // The two families of scoring lines across the whole tray (clipped to each slice later).
    function lattice() {
      const t = (LAT.th * Math.PI) / 180;
      const fams = [
        [Math.cos(t), -Math.sin(t)],
        [Math.cos(t), Math.sin(t)],
      ];
      const lines = [];
      for (const [nx, ny] of fams) {
        for (let k = -8; k <= 8; k++) {
          const c = k * LAT.s + LAT.s / 2;
          // Points on n.p = c inside the pastry circle (center 200, 200).
          const dx = -ny,
            dy = nx;
          const h2 = R.p1 * R.p1 - c * c;
          if (h2 <= 0) continue;
          const h = Math.sqrt(h2);
          const px = 200 + nx * c,
            py = 200 + ny * c;
          lines.push([px - dx * h, py - dy * h, px + dx * h, py + dy * h]);
        }
      }
      return lines;
    }
    // The centers of the diamonds.
    function centers() {
      const t = (LAT.th * Math.PI) / 180;
      const [a1, b1] = [Math.cos(t), -Math.sin(t)];
      const [a2, b2] = [Math.cos(t), Math.sin(t)];
      const det = a1 * b2 - a2 * b1;
      const out = [];
      for (let i = -8; i <= 8; i++) {
        for (let j = -8; j <= 8; j++) {
          const c1 = (i + 1) * LAT.s,
            c2 = (j + 1) * LAT.s;
          const x = (c1 * b2 - c2 * b1) / det;
          const y = (a1 * c2 - a2 * c1) / det;
          if (Math.hypot(x, y) < R.flake - 10) out.push([200 + x, 200 + y]);
        }
      }
      return out;
    }
    const angleOf = (x, y) => ((Math.atan2(x - 200, 200 - y) * 180) / Math.PI + 360) % 360;
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
    const within = (a, a0, a1, pad) => {
      const d = (((a - a0) % 360) + 360) % 360;
      return d > pad && d < a1 - a0 - pad;
    };
    // The syrup drizzle: a zigzag poured across the slice from the rim toward the center.
    function drizzle(H, sl) {
      let d = '';
      const n = 7;
      for (let k = 0; k <= n; k++) {
        const r = R.flake - 4 - (k * (R.flake - 72)) / n;
        const side = k % 2 ? 1 : -1;
        const half = ((((r * Math.sin(H.rad((sl.a1 - sl.a0) / 2)) - 10) / r) * 180) / Math.PI) * 0.92;
        const [x, y] = H.polar(r, sl.mid + side * half);
        if (!k) d += `M${f2(x)} ${f2(y)}`;
        else {
          const [cx, cy] = H.polar(r + (R.flake - 72) / n / 2, sl.mid);
          d += `Q${f2(cx)} ${f2(cy)} ${f2(x)} ${f2(y)}`;
        }
      }
      return d;
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
    // A bubble or a drop: a partial whose pitch rises as it closes, with a soft start.
    function bubble(y, sr, at, f, tau, rise, amp) {
      const i0 = Math.round(at * sr);
      const n = Math.min(y.length - i0, Math.ceil(tau * 6 * sr));
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const u = i / sr;
        ph += (2 * Math.PI * f * (1 + (rise * u) / tau)) / sr;
        y[i0 + i] += amp * Math.exp(-u / tau) * Math.min(1, u / 0.0007) * Math.sin(ph);
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
    // Phyllo: paper-thin baked layers giving way, a fine, dry, airy crackle; shape(u) sets how busy.
    function flake(y, sr, rand, at, len, count, amp, lo = 2500, hi = 6500, shape = (u) => Math.sin(Math.PI * u)) {
      for (let k = 0; k < count; k++) {
        const u = rand();
        const a = amp * shape(u) * (0.3 + 0.7 * rand());
        crack(y, sr, rand, at + u * len, lo * (hi / lo) ** rand(), 0.9 + rand() * 0.6, a, 0.0001 + rand() * 0.0002);
      }
    }
    // The hammered copper tray: a warm ring whose partials come in close pairs, so it wobbles.
    function copper(y, sr, rand, at, f, tau, amp) {
      crack(y, sr, rand, at, 1200, 1, 0.3 * amp, 0.0006);
      [
        [1, 0.7, 1],
        [1.62, 1, 0.8],
        [2.32, 0.6, 0.6],
        [3.05, 0.38, 0.45],
        [3.98, 0.22, 0.32],
      ].forEach(([r, a, d]) => {
        ring(y, sr, at, f * r * 0.996, tau * d, 0.5 * amp * a);
        ring(y, sr, at, f * r * 1.004, tau * d, 0.5 * amp * a);
      });
    }
    // Thick syrup poured: a slow, smooth, low stream, shape(u) its flow.
    function pour(y, sr, rand, at, len, amp, shape) {
      let wander = 0.5;
      hiss(y, sr, rand, at, len, 0.9, (u) => {
        wander += (rand() - wander) * 0.008;
        return [amp * shape(u), 420 + 230 * wander];
      });
      hiss(y, sr, rand, at, len, 1.2, (u) => [0.35 * amp * shape(u), 1300]);
    }
    // How loud each voice plays, measured so that the theme sits as loud as every other one.
    const LEVEL = { open: 0.074, tick: 0.067, enter: 0.048, leave: 0.048, success: 0.079 };

    Board.define({
      id: ID,
      fonts: {
        brand: "'El Messiri'",
        display: "'Yeseva One'",
        load: ["'El Messiri'", "'Yeseva One'"],
        credits: [
          { family: 'Yeseva One', license: 'SIL Open Font License 1.1' },
          { family: 'El Messiri', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 120, stagger: 14, apply: 700 },
      palette: {
        light: {
          bg: '#f8f8f3',
          surface: '#ffffff',
          'surface-2': '#f2f3ec',
          border: '#dfe2d3',
          'border-strong': '#b9bf9f',
          text: '#1c2a17',
          'text-muted': '#56604c',
          accent: '#2f6b22',
          'on-accent': '#ffffff',
          focus: '#2f6b22',
          success: '#2f7d3a',
          'on-success': '#ffffff',
          'success-text': '#256830',
          warning: '#b86e00',
          'warning-text': '#7a4800',
          danger: '#b3261e',
          desk: 'radial-gradient(120% 100% at 30% 15%, #ffffff 0%, #eef4ec 45%, #d6e7dc 100%)',
          'wheel-face': '#f6d07e',
          'wheel-slice': '#f6d07e',
          'wheel-slice-hover': '#fbdc94',
          'wheel-slice-selected': '#e8a030',
          'wheel-text': '#173511',
          'wheel-text-selected': '#11260b',
          'wheel-line': '#c58a2e',
          'wheel-shadow': 'rgba(60, 80, 50, 0.28)',
          'bk-top-in': '#fbe4a6',
          'bk-top-out': '#f1c262',
          'bk-hov-in': '#fff7de',
          'bk-hov-out': '#fbd98c',
          'bk-sel-in': '#f5b444',
          'bk-sel-out': '#de8f1a',
          'bk-halo': '#f6d07e',
          'bk-halo-h': '#fde6ae',
          'bk-halo-s': '#eba236',
          'bk-cut': '#c58a2e',
          'bk-cut-hi': '#fff6d8',
          'bk-flake-a': '#fff1c9',
          'bk-flake-b': '#d9a248',
          'bk-floor': '#e9b54e',
          'bk-syrup': '#ffd45e',
          'bk-syrup-hi': '#fffbea',
          'bk-nut-a': '#62ad35',
          'bk-nut-b': '#a6da66',
          'bk-nut-c': '#3b8526',
          'bk-cu-hi': '#ffe3d2',
          'bk-cu': '#efab86',
          'bk-cu-mid': '#da8c61',
          'bk-cu-edge': '#b0663e',
          'bk-dimple': '#fff4ec',
          'bk-dimple-dark': '#c27a52',
          'bk-dimple-op': '0.5',
          'bk-cream': '#fffdf6',
          'bk-cream-edge': '#efe4c9',
          'bk-sub': '#1b3e12',
          'bk-sub-sel': '#11260b',
          'bk-hub-text': '#173511',
          'bk-hub-sub': '#4f5a36',
          'bk-key': '#2f6b22',
          'bk-key-text': '#ffffff',
          'bk-glow': 'rgba(255, 210, 120, 0)',
        },
        dark: {
          bg: '#0c1412',
          surface: '#15201d',
          'surface-2': '#1c2a26',
          border: '#2a3d37',
          'border-strong': '#466259',
          text: '#f2f1e8',
          'text-muted': '#b2baae',
          accent: '#9bcf5e',
          'on-accent': '#10200a',
          focus: '#b9e07e',
          success: '#7fd38c',
          'on-success': '#06210f',
          'success-text': '#95e0a2',
          warning: '#ffbf5a',
          'warning-text': '#ffd080',
          danger: '#ff7a6b',
          desk: 'radial-gradient(70% 62% at 50% 55%, #26443a 0%, #142520 55%, #09110f 100%)',
          'wheel-face': '#eebe5e',
          'wheel-slice': '#eebe5e',
          'wheel-slice-hover': '#f8d27e',
          'wheel-slice-selected': '#e09420',
          'wheel-text': '#132b0e',
          'wheel-text-selected': '#0e2008',
          'wheel-line': '#a8701e',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'bk-top-in': '#fbdc8c',
          'bk-top-out': '#d99a36',
          'bk-hov-in': '#fff0c4',
          'bk-hov-out': '#f0c066',
          'bk-sel-in': '#f2ac36',
          'bk-sel-out': '#d6870f',
          'bk-halo': '#eebe5e',
          'bk-halo-h': '#f8d488',
          'bk-halo-s': '#e49a26',
          'bk-cut': '#a8701e',
          'bk-cut-hi': '#ffe9aa',
          'bk-flake-a': '#fbe2a6',
          'bk-flake-b': '#b77e2a',
          'bk-floor': '#cf952e',
          'bk-syrup': '#ffce4a',
          'bk-syrup-hi': '#fff7d8',
          'bk-nut-a': '#6cba3c',
          'bk-nut-b': '#b2e274',
          'bk-nut-c': '#3f8a28',
          'bk-cu-hi': '#ffd9c0',
          'bk-cu': '#d9875a',
          'bk-cu-mid': '#a65d34',
          'bk-cu-edge': '#62301a',
          'bk-dimple': '#ffe1cc',
          'bk-dimple-dark': '#834628',
          'bk-dimple-op': '0.5',
          'bk-cream': '#fff8e6',
          'bk-cream-edge': '#e6d3a8',
          'bk-sub': '#163910',
          'bk-sub-sel': '#0e2008',
          'bk-hub-text': '#132b0e',
          'bk-hub-sub': '#4c4a26',
          'bk-key': '#2f6b22',
          'bk-key-text': '#ffffff',
          'bk-glow': 'rgba(255, 196, 100, 0.34)',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['wheel-text', 'bk-top-in', 'text'],
        ['wheel-text', 'bk-top-out', 'text'],
        ['wheel-text', 'bk-hov-in', 'text'],
        ['wheel-text', 'bk-hov-out', 'text'],
        ['wheel-text-selected', 'bk-sel-in', 'text'],
        ['wheel-text-selected', 'bk-sel-out', 'text'],
        ['bk-sub', 'bk-top-out', 'text'],
        ['bk-sub', 'bk-hov-out', 'text'],
        ['bk-sub-sel', 'bk-sel-out', 'text'],
        ['bk-hub-text', 'bk-cream', 'text'],
        ['bk-hub-sub', 'bk-cream', 'text'],
        ['bk-key-text', 'bk-key', 'text'],
      ],

      // Gradients are built per wheel in render(): they read the palette tokens of their own card.
      defs: '',

      wheel: {
        render(root, m, H) {
          const uid = H.uid(ID);
          root.dataset.bkUid = uid;
          const rand = rng(1453 + m.n);
          const defs = H.s('defs', {}, root);
          for (const [name, a, b] of [
            ['top', '--bk-top-in', '--bk-top-out'],
            ['hov', '--bk-hov-in', '--bk-hov-out'],
            ['sel', '--bk-sel-in', '--bk-sel-out'],
          ]) {
            const g = H.s(
              'radialGradient',
              { id: `${uid}-${name}`, gradientUnits: 'userSpaceOnUse', cx: 186, cy: 180, r: R.p1 + 10 },
              defs,
            );
            stop(g, H, 0.15, a);
            stop(g, H, 1, b);
          }
          const cu = H.s(
            'linearGradient',
            { id: `${uid}-cu`, gradientUnits: 'userSpaceOnUse', x1: 60, y1: 20, x2: 340, y2: 380 },
            defs,
          );
          stop(cu, H, 0, '--bk-cu-hi');
          stop(cu, H, 0.35, '--bk-cu');
          stop(cu, H, 0.7, '--bk-cu-mid');
          stop(cu, H, 1, '--bk-cu-edge');
          const sh = H.s(
            'radialGradient',
            { id: `${uid}-shadow`, gradientUnits: 'userSpaceOnUse', cx: 205, cy: 212, r: R.rim + 12 },
            defs,
          );
          stop(sh, H, 0.86, '--wheel-shadow');
          stop(sh, H, 1, '--wheel-shadow', 0);
          const gw = H.s(
            'radialGradient',
            { id: `${uid}-glow`, gradientUnits: 'userSpaceOnUse', cx: 200, cy: 200, r: 200 },
            defs,
          );
          stop(gw, H, 0.7, '--bk-glow');
          stop(gw, H, 1, '--bk-glow', 0);

          // The copper tray: shadow, hammered rim, its bright lip and the syrupy floor.
          const tray = H.s('g', { class: 'bk-tray', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: 200, cy: 200, r: 200, fill: `url(#${uid}-glow)` }, tray);
          H.s('circle', { cx: 205, cy: 212, r: R.rim + 12, fill: `url(#${uid}-shadow)` }, tray);
          H.s('circle', { cx: 200, cy: 200, r: R.rim, fill: `url(#${uid}-cu)`, class: 'bk-rim' }, tray);
          // Hammer marks: soft dents, lit on the side away from the light, shaded on the other.
          let dim = '',
            dimDark = '';
          for (let row = 0; row < 3; row++) {
            const n = 46 + row * 5;
            for (let k = 0; k < n; k++) {
              const a = (k + rand() * 0.7 + row * 0.45) * (360 / n);
              const r = R.floor + 2.6 + row * 4.4 + rand() * 1.4;
              const [x, y] = H.polar(r, a);
              const sz = 1.9 + rand() * 1.3;
              dimDark += dot(x - 0.8, y - 0.9, sz);
              dim += dot(x + 0.6, y + 0.7, sz * 0.85);
            }
          }
          H.s('path', { d: dimDark, class: 'bk-dimple-dark' }, tray);
          H.s('path', { d: dim, class: 'bk-dimple' }, tray);
          const [l0x, l0y] = H.polar(R.rim - 3, 292);
          const [l1x, l1y] = H.polar(R.rim - 3, 352);
          H.s(
            'path',
            { d: `M${f2(l0x)} ${f2(l0y)}A${R.rim - 3} ${R.rim - 3} 0 0 1 ${f2(l1x)} ${f2(l1y)}`, class: 'bk-lip' },
            tray,
          );
          H.s('circle', { cx: 200, cy: 200, r: R.floor, class: 'bk-floor' }, tray);

          const lines = lattice();
          const nuts = centers();
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const t = H.rad(sl.mid);
            g.style.setProperty('--ux', f2(Math.sin(t)));
            g.style.setProperty('--uy', f2(-Math.cos(t)));
            H.s('path', { d: H.sector(R.hub, R.floor, sl.a0, sl.a1), class: 'bk-hit' }, g);
            const lift = H.s('g', { class: 'bk-lift' }, g);
            const shape = H.sector(R.p0, R.p1, sl.a0, sl.a1, CUT);
            H.s('path', { d: shape, class: 'bk-lift-shadow' }, lift);
            const top = H.s('path', { d: shape, class: 'bk-top', fill: `url(#${uid}-top)` }, lift);
            top.dataset.f = 'top';
            // The unglazed pastry over a freshly chosen slice, faded out as the syrup soaks in.
            H.s('path', { d: shape, class: 'bk-unsoak', fill: `url(#${uid}-top)` }, lift);
            // Flaky layers along the outer edge of the pastry.
            let flA = '',
              flB = '';
            for (let k = 0; k < 4; k++) {
              const r = R.flake + 1.2 + k * 2;
              if (k % 2) flB += H.arc(r, sl.a0 + 1.2, sl.a1 - 1.2);
              else flA += H.arc(r, sl.a0 + 1.2, sl.a1 - 1.2);
            }
            H.s('path', { d: flA, class: 'bk-flake-a' }, lift);
            H.s('path', { d: flB, class: 'bk-flake-b' }, lift);
            // The diamond scoring, clipped to the slice.
            const clipId = `${uid}-c${sl.i}`;
            const clip = H.s('clipPath', { id: clipId }, lift);
            H.s('path', { d: H.sector(R.p0, R.flake, sl.a0, sl.a1, CUT) }, clip);
            // Only the part of each line over this slice (the clip trims its edges exactly), so the
            // slice's own box stays the size of the slice: each line is cut to the wedge between the
            // slice's edges, a little widened. A wedge is convex up to 180 degrees, so a wider slice is
            // cut as its two halves.
            let cut = '';
            const side = (a) => {
              const t = H.rad(a);
              return [Math.sin(t), -Math.cos(t)];
            };
            const wedges =
              sl.a1 - sl.a0 > 170
                ? [
                    [sl.a0 - 2, sl.mid],
                    [sl.mid, sl.a1 + 2],
                  ]
                : [[sl.a0 - 2, sl.a1 + 2]];
            for (const [w0, w1] of wedges) {
              const [e0x, e0y] = side(w0);
              const [e1x, e1y] = side(w1);
              for (const [x0, y0, x1, y1] of lines) {
                const dx = x1 - x0;
                const dy = y1 - y0;
                let lo = 0;
                let hi = 1;
                // Clockwise of the first edge: cross(e0, p) >= 0; before the second: cross(e1, p) <= 0.
                for (const [ex, ey, sign] of [
                  [e0x, e0y, 1],
                  [e1x, e1y, -1],
                ]) {
                  const c0 = sign * (ex * (y0 - 200) - ey * (x0 - 200));
                  const cd = sign * (ex * dy - ey * dx);
                  if (Math.abs(cd) < 1e-9) {
                    if (c0 < 0) hi = -1;
                  } else if (cd > 0) lo = Math.max(lo, -c0 / cd);
                  else hi = Math.min(hi, -c0 / cd);
                }
                if (hi - lo < 1e-3) continue;
                cut += `M${f2(x0 + dx * lo)} ${f2(y0 + dy * lo)}L${f2(x0 + dx * hi)} ${f2(y0 + dy * hi)}`;
              }
            }
            const sc = H.s('g', { 'clip-path': `url(#${clipId})`, class: 'bk-score' }, lift);
            H.s('path', { d: cut, class: 'bk-cut-hi', transform: 'translate(0.9 0.9)' }, sc);
            H.s('path', { d: cut, class: 'bk-cut' }, sc);
            // The label, then pistachio on every diamond that stays clear of it.
            const c = H.s('g', { class: 'bk-content' }, lift);
            const maxWidth = room(H, sl, R.p0, R.flake, 5);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 25,
                subSize: 14,
                gap: -1,
                maxWidth,
                minSize: 11,
                cls: 'bk-lbl bk-fmt',
                subCls: 'bk-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 15.5,
                gap: 2,
                maxWidth,
                minSize: 8.5,
                cls: 'bk-lbl bk-word',
                sub: null,
              });
            }
            let bb = null;
            try {
              bb = c.getBBox();
            } catch (e) {
              bb = null;
            }
            const [lx, ly] = H.polar(R.lbl, sl.mid);
            const box =
              bb && bb.width
                ? { cx: bb.x + bb.width / 2, cy: bb.y + bb.height / 2, hw: bb.width / 2 + 5, hh: bb.height / 2 + 2 }
                : { cx: lx, cy: ly, hw: 42, hh: 26 };
            let nA = '',
              nB = '',
              nC = '';
            // The pistachio also leaves the mark of a slice that opens a ring of choices clear.
            const mark = sl.ring ? H.polar(MARK.r - MARK.size / 2, sl.mark) : null;
            for (const [x, y] of nuts) {
              if (!within(angleOf(x, y), sl.a0, sl.a1, 5) || Math.hypot(x - 200, y - 200) < R.p0 + 9) continue;
              if (Math.abs(x - box.cx) < box.hw && Math.abs(y - box.cy) < box.hh) continue;
              if (mark && Math.hypot(x - mark[0], y - mark[1]) < 13) continue;
              for (let q = 0; q < 7; q++) {
                const qa = rand() * Math.PI * 2,
                  qr = rand() * 4.4;
                const d = dot(x + Math.cos(qa) * qr, y + Math.sin(qa) * qr, 1.1 + rand() * 1.3);
                if (q % 3 === 0) nA += d;
                else if (q % 3 === 1) nB += d;
                else nC += d;
              }
            }
            const ng = H.s('g', { class: 'bk-nuts' });
            lift.insertBefore(ng, c);
            H.s('path', { d: nC, class: 'bk-nut-c' }, ng);
            H.s('path', { d: nA, class: 'bk-nut-a' }, ng);
            H.s('path', { d: nB, class: 'bk-nut-b' }, ng);
            // The glaze: a syrup line and glossy streaks, shown once the slice is chosen.
            const glaze = H.s('g', { class: 'bk-glaze' });
            lift.insertBefore(glaze, c);
            const dz = drizzle(H, sl);
            // The pour: a thin stream falling onto the rim where the drizzle starts.
            const [px, py] = H.polar(
              R.flake - 4,
              sl.mid -
                (((((R.flake - 4) * Math.sin(H.rad((sl.a1 - sl.a0) / 2)) - 10) / (R.flake - 4)) * 180) / Math.PI) *
                  0.92,
            );
            const pour = H.s('path', { d: `M${f2(px)} ${f2(py - 70)}L${f2(px)} ${f2(py)}`, class: 'bk-pour' }, glaze);
            pour.style.setProperty('--px', f2(px) + 'px');
            pour.style.setProperty('--py', f2(py) + 'px');
            H.s('path', { d: dz, class: 'bk-drizzle-edge', pathLength: 1 }, glaze);
            H.s('path', { d: dz, class: 'bk-drizzle', pathLength: 1 }, glaze);
            H.s('path', { d: dz, class: 'bk-drizzle-hi', pathLength: 1 }, glaze);
            let streaks = '';
            for (const [r, da, len] of [
              [R.flake - 14, -8, 12],
              [R.flake - 22, 5, 9],
              [R.p0 + 22, 2, 6],
            ])
              streaks += H.arc(r, sl.mid + da - len / 2, sl.mid + da + len / 2);
            H.s('path', { d: streaks, class: 'bk-streak' }, glaze);
            if (sl.off) lift.insertBefore(H.s('path', { d: shape, class: 'bk-off' }), c);
            H.s('path', { d: H.arc(R.flake - 4, sl.a0 + 4, sl.a1 - 4), class: 'bk-glint' }, lift);
            // More choices: an arrowhead near the flaky rim, on a patch the pistachio leaves clear.
            H.ringMark(lift, sl, m, { ...MARK, halo: 1.4, cls: 'bk-ring-mark' });
          }

          // A dollop of clotted cream in the middle carries the name, the file and the key.
          const hub = H.s('g', { class: 'bk-hub' }, root);
          let cream = '';
          for (let k = 0; k <= 48; k++) {
            const a = k * 7.5;
            const r = R.hub + 1.6 * Math.sin(H.rad(a * 5)) + 0.8 * Math.sin(H.rad(a * 11));
            const [x, y] = H.polar(r, a);
            cream += (k ? 'L' : 'M') + f2(x) + ' ' + f2(y);
          }
          H.s('path', { d: cream + 'Z', class: 'bk-cream' }, hub);
          H.s('path', { d: `M${f2(176)} ${f2(176)}C185 168 199 166 210 169`, class: 'bk-cream-hi' }, hub);
          // Without a key (a ring opened from the menu) the name and the file sit in the middle.
          const low = m.key ? 0 : 8;
          H.label(hub, 200, 184 + low, m.title, { maxWidth: 82, size: 17, minSize: 9, cls: 'bk-title', maxLines: 1 });
          H.label(hub, 200, 201 + low, m.file, {
            maxWidth: 78,
            size: 12.5,
            minSize: 9,
            cls: 'bk-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.3;
            H.s('rect', { x: f2(200 - kw / 2), y: 210, width: f2(kw), height: 16, rx: 8, class: 'bk-key' }, hub);
            H.text(hub, 200, 218.5, m.key, { class: 'bk-keytext' });
          }
        },

        update(root, m, st) {
          const uid = root.dataset.bkUid;
          root.querySelectorAll('.slice').forEach((g) => {
            const i = +g.dataset.slice;
            const fill = i === st.selected ? 'sel' : i === st.hover ? 'hov' : 'top';
            const top = g.querySelector('.bk-top');
            if (top.dataset.f !== fill) {
              top.dataset.f = fill;
              top.setAttribute('fill', `url(#${uid}-${fill})`);
            }
          });
        },
      },

      sounds: {
        // The copper tray is set down and wobbles to rest while the pieces settle in with a rustle.
        open: voice({
          name: 'open',
          len: 0.55,
          takes: 3,
          spread: 0.015,
          level: LEVEL.open,
          lp: 7000,
          draw(y, sr, rand) {
            copper(y, sr, rand, 0.06, 410, 0.28, 1);
            for (let k = 0; k < 8; k++) flake(y, sr, rand, 0.03 + k * 0.014, 0.02, 8, 2.5);
          },
        }),
        // A piece lifts from the tray: the flaky layers crackle, light and dry.
        tick: voice({
          name: 'tick',
          len: 0.06,
          takes: 8,
          spread: 0.05,
          level: LEVEL.tick,
          lp: 7000,
          draw(y, sr, rand) {
            flake(y, sr, rand, 0.002, 0.035, 90, 0.27, 2500, 5500);
            hiss(y, sr, rand, 0.002, 0.02, 1.2, (u) => [0.25 * (1 - u) ** 2, 1600]);
          },
        }),
        // A knife scores down through the layers, one crisp sheet after another, and touches the tray.
        enter: voice({
          name: 'enter',
          len: 0.24,
          takes: 4,
          spread: 0.04,
          level: LEVEL.enter,
          lp: 7000,
          draw(y, sr, rand) {
            for (let k = 0; k < 10; k++) {
              const lo = 4200 - 180 * k;
              flake(y, sr, rand, 0.004 + 0.12 * (k / 10) ** 0.85, 0.006, 8, 0.75, lo, lo + 2000, () => 1);
            }
            copper(y, sr, rand, 0.15, 900, 0.07, 0.12);
          },
        }),
        // Back out: the piece settles into its place with a soft flaky rustle.
        leave: voice({
          name: 'leave',
          len: 0.13,
          takes: 4,
          spread: 0.04,
          level: LEVEL.leave,
          lp: 7000,
          draw(y, sr, rand) {
            flake(y, sr, rand, 0.002, 0.03, 36, 0.25);
            hiss(y, sr, rand, 0.002, 0.03, 1, (u) => [0.3 * (1 - u) ** 2, 900]);
            copper(y, sr, rand, 0.03, 880, 0.03, 0.03);
          },
        }),
        // Syrup drizzled in a zigzag: a thick, smooth pour, the hot pastry sizzling as it drinks it,
        // and the glaze catching the light.
        success: voice({
          name: 'success',
          len: 0.85,
          takes: 3,
          spread: 0.015,
          level: LEVEL.success,
          lp: 7000,
          draw(y, sr, rand) {
            const flow = (u) => Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.3);
            pour(y, sr, rand, 0.002, 0.48, 1, (u) => flow(u) * (0.65 + 0.35 * Math.abs(Math.sin(Math.PI * 7 * u))));
            for (let k = 0; k < 3; k++) bubble(y, sr, 0.1 + rand() * 0.3, 280 + rand() * 140, 0.03, 0.15, 0.25);
            flake(y, sr, rand, 0.06, 0.5, 220, 0.45, 3500, 6500, (u) => Math.min(1, u * 3) * (1 - u) ** 1.5);
            ring(y, sr, 0.4, 2093, 0.18, 0.07);
            ring(y, sr, 0.4, 3136, 0.12, 0.035);
          },
        }),
      },
    });
  })();
}
