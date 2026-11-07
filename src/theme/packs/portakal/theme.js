// SPDX-License-Identifier: MIT
// Theme: Portakal. A halved orange seen from above: a dimpled rind, a ring of white pith and
// translucent juicy segments as slices. Applying squeezes the segment: juice drops and a fine
// zest mist burst out of its rim. The dark palette is a blood orange at night.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const ID = 'portakal';
    // Radii in the 400 x 400 view box.
    const R = { hub: 52, seg0: 58, seg1: 168, pith: 178, rind: 191, lbl: 116 };

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

    // A segment: radial sides held `gap` apart, a rounded outer edge and a blunt inner tip.
    function segPath(H, r0, r1, a0, a1, gap, k) {
      const g = (r) => ((gap / 2 / r) * 180) / Math.PI;
      const P = (r, a) => H.polar(r, a).map(f2).join(' ');
      const ka = (((k * 1.3) / r1) * 180) / Math.PI;
      const s0 = a0 + g(r1);
      const s1 = a1 - g(r1);
      const i0 = a0 + g(r0);
      const i1 = a1 - g(r0);
      const im = (a0 + a1) / 2;
      return (
        `M${P(r0 + 4, i0)}L${P(r1 - k, a0 + g(r1 - k))}Q${P(r1, s0)} ${P(r1 + 0.5, s0 + ka)}` +
        `A${r1} ${r1} 0 0 1 ${P(r1 + 0.5, s1 - ka)}Q${P(r1, s1)} ${P(r1 - k, a1 - g(r1 - k))}` +
        `L${P(r0 + 4, i1)}Q${P(r0 - 2, im)} ${P(r0 + 4, i0)}Z`
      );
    }

    // Juice sacs: thin teardrops pointing at the core, scattered through a segment.
    function sacs(H, sl, rand, gap) {
      let d = '';
      const span = sl.a1 - sl.a0;
      // As many sacs per degree whatever the number of segments.
      const count = Math.round(22 * Math.min(4, span / 45));
      for (let k = 0; k < count; k++) {
        const r = R.seg0 + 14 + rand() * (R.seg1 - R.seg0 - 22);
        const g = (((gap / 2 + 4) / r) * 180) / Math.PI;
        const a = sl.a0 + g + rand() * (span - 2 * g);
        const len = 9 + rand() * 15;
        const w = 1.6 + rand() * 1.8;
        const t = H.rad(a);
        const ux = Math.sin(t),
          uy = -Math.cos(t);
        const [x, y] = H.polar(r, a);
        const tx = x - ux * len,
          ty = y - uy * len; // tip toward the core
        d +=
          `M${f2(tx)} ${f2(ty)}Q${f2(x - ux * len * 0.3 + uy * w * 1.4)} ${f2(y - uy * len * 0.3 - ux * w * 1.4)} ${f2(x + uy * w * 0.2)} ${f2(y - ux * w * 0.2)}` +
          `Q${f2(x - ux * len * 0.3 - uy * w * 1.4)} ${f2(y - uy * len * 0.3 + ux * w * 1.4)} ${f2(tx)} ${f2(ty)}Z`;
      }
      return d;
    }

    const dot = (x, y, r) =>
      `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;

    // A teardrop pointing along +y in local space, tip at the origin.
    const drop = (s) =>
      `M0 ${f2(-s * 1.7)}C${f2(s * 0.5)} ${f2(-s * 0.7)} ${f2(s)} ${f2(-s * 0.1)} ${f2(s)} ${f2(s * 0.35)}A${f2(s)} ${f2(s)} 0 0 1 ${f2(-s)} ${f2(s * 0.35)}C${f2(-s)} ${f2(-s * 0.1)} ${f2(-s * 0.5)} ${f2(-s * 0.7)} 0 ${f2(-s * 1.7)}Z`;

    function stop(grad, H, offset, token, op) {
      H.s('stop', { offset, style: `stop-color: var(${token})${op != null ? `; stop-opacity: ${op}` : ''}` }, grad);
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
    // Juice: a spurt of tiny bubbles, each ringing at the pitch its size gives it (small ones high and
    // short) and rising as it closes.
    function juice(y, sr, rand, at, len, count, lo, hi, amp) {
      for (let k = 0; k < count; k++) {
        const u = rand();
        const f = lo * (hi / lo) ** rand();
        const tau = 1 / (0.043 * f + 0.0014 * f ** 1.5);
        const a = amp * (0.3 + rand() * 0.7) * Math.sin(Math.PI * (0.1 + 0.9 * u));
        bubble(y, sr, at + u * len, f, tau, 0.05 + rand() * 0.15, a);
      }
    }
    // The zest's mist: countless tiny bright ticks, dense and soft; shape(u) thins them out.
    function mist(y, sr, rand, at, len, count, amp, shape) {
      for (let k = 0; k < count; k++) {
        const u = rand();
        if (rand() > shape(u)) continue;
        crack(y, sr, rand, at + u * len, 3200 + rand() * 3400, 1.4, amp * (0.3 + rand() * 0.7), 0.00015);
      }
    }
    // A drop landing: a quick rising plip and the smallest splash.
    function plip(y, sr, rand, at, amp) {
      bubble(y, sr, at, 1150 + rand() * 950, 0.007, 0.3, amp);
      crack(y, sr, rand, at, 2600, 1.2, 0.2 * amp, 0.0003);
    }
    // How loud each voice plays, measured so that the theme sits as loud as every other one.
    const LEVEL = { open: 0.081, tick: 0.103, enter: 0.066, leave: 0.082, success: 0.09 };

    Board.define({
      id: ID,
      fonts: {
        brand: "'Baloo 2'",
        load: ["'Baloo 2'"],
        credits: [{ family: 'Baloo 2', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 180, close: 110, stagger: 14, apply: 640 },
      palette: {
        light: {
          bg: '#fdf8ef',
          surface: '#ffffff',
          'surface-2': '#fff4e2',
          border: '#f1dcc0',
          'border-strong': '#d9a873',
          text: '#1e2a1c',
          'text-muted': '#5b6352',
          accent: '#c2410c',
          'on-accent': '#ffffff',
          focus: '#1f7a3e',
          success: '#2e8540',
          'on-success': '#ffffff',
          'success-text': '#1f6b31',
          warning: '#d97706',
          'warning-text': '#8a4b00',
          danger: '#c0262d',
          desk: 'radial-gradient(120% 90% at 30% 20%, #f4fbef 0%, #e3f3e2 45%, #cfe9dc 100%)',
          'wheel-face': '#fff6e6',
          'wheel-slice': '#ffbe5c',
          'wheel-slice-hover': '#ff9a2e',
          'wheel-slice-selected': '#c4440d',
          'wheel-text': '#173a20',
          'wheel-text-selected': '#fffaf0',
          'wheel-line': '#fff6e6',
          'wheel-shadow': 'rgba(46, 92, 52, 0.30)',
          'pk-flesh-in': '#ffd37a',
          'pk-flesh-out': '#ffad3d',
          'pk-hov-in': '#ffb447',
          'pk-hov-out': '#ff8c1f',
          'pk-sel-in': '#bf4410',
          'pk-sel-out': '#a8320a',
          'pk-sac': '#fff6cf',
          'pk-sac-op': '0.5',
          'pk-sac-sel': '#ff9a4d',
          'pk-pith': '#fff7e8',
          'pk-pith-edge': '#f6e2c4',
          'pk-rind-in': '#ffa424',
          'pk-rind-out': '#ef7a10',
          'pk-rind-edge': '#d4600b',
          'pk-pore': '#c9590a',
          'pk-pore-hi': '#ffd27a',
          'pk-sub': '#2f4d2a',
          'pk-sub-sel': '#fff3e3',
          'pk-hub-text': '#173a20',
          'pk-hub-sub': '#5d6b4f',
          'pk-key': '#ffe7c2',
          'pk-key-text': '#7a3b07',
          'pk-juice': '#ffa51f',
          'pk-juice-edge': '#e0700a',
          'pk-zest': '#ffc21a',
          'pk-gloss': '#ffffff',
          'pk-gloss-op': '0.55',
        },
        dark: {
          bg: '#150f1d',
          surface: '#211a2b',
          'surface-2': '#2a2135',
          border: '#3b2f49',
          'border-strong': '#5c4a70',
          text: '#fbefe6',
          'text-muted': '#c6b3bf',
          accent: '#ff8a4c',
          'on-accent': '#2a0a06',
          focus: '#ffb27a',
          success: '#6fd38c',
          'on-success': '#0b2413',
          'success-text': '#86e0a0',
          warning: '#ffb340',
          'warning-text': '#ffc56b',
          danger: '#ff6b6b',
          desk: 'radial-gradient(110% 90% at 70% 15%, #2c1f45 0%, #1a1230 45%, #0e0a1a 100%)',
          'wheel-face': '#f0d6cc',
          'wheel-slice': '#a8261f',
          'wheel-slice-hover': '#7a0d22',
          'wheel-slice-selected': '#ff9b45',
          'wheel-text': '#fff1e3',
          'wheel-text-selected': '#2b0609',
          'wheel-line': '#f0d6cc',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          'pk-flesh-in': '#c23a1f',
          'pk-flesh-out': '#8c1024',
          'pk-hov-in': '#9e1630',
          'pk-hov-out': '#5e0619',
          'pk-sel-in': '#ffb15a',
          'pk-sel-out': '#ff8a33',
          'pk-sac': '#ff7a5c',
          'pk-sac-op': '0.32',
          'pk-sac-sel': '#ffd28a',
          'pk-pith': '#f3d9cf',
          'pk-pith-edge': '#d9b0a6',
          'pk-rind-in': '#d4461a',
          'pk-rind-out': '#9c2410',
          'pk-rind-edge': '#6e1608',
          'pk-pore': '#5e1206',
          'pk-pore-hi': '#f27a45',
          'pk-sub': '#ffd9c4',
          'pk-sub-sel': '#4a0d10',
          'pk-hub-text': '#6b0f1c',
          'pk-hub-sub': '#8a3a3f',
          'pk-key': '#e6bfb4',
          'pk-key-text': '#6b0f1c',
          'pk-juice': '#ff5a3c',
          'pk-juice-edge': '#b3132b',
          'pk-zest': '#ffb067',
          'pk-gloss': '#ffd9c4',
          'pk-gloss-op': '0.35',
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
        ['wheel-text', 'pk-flesh-in', 'text'],
        ['wheel-text', 'pk-flesh-out', 'text'],
        ['wheel-text', 'pk-hov-in', 'text'],
        ['wheel-text', 'pk-hov-out', 'text'],
        ['wheel-text-selected', 'pk-sel-in', 'text'],
        ['wheel-text-selected', 'pk-sel-out', 'text'],
        ['pk-sub', 'wheel-slice', 'text'],
        ['pk-sub', 'pk-hov-in', 'text'],
        ['pk-sub-sel', 'pk-sel-in', 'text'],
        ['pk-hub-text', 'pk-pith', 'text'],
        ['pk-hub-sub', 'pk-pith', 'text'],
        ['pk-key-text', 'pk-key', 'text'],
      ],

      // Gradients are built per wheel in render(): they read the palette tokens of their own card.
      defs: '',

      wheel: {
        render(root, m, H) {
          const uid = H.uid(ID);
          const rand = rng(1907 + m.n);
          const defs = H.s('defs', {}, root);
          const radial = (name, a, b, r = R.seg1) => {
            const g = H.s(
              'radialGradient',
              { id: `${uid}-${name}`, gradientUnits: 'userSpaceOnUse', cx: 200, cy: 200, r },
              defs,
            );
            stop(g, H, 0.3, a);
            stop(g, H, 1, b);
          };
          radial('flesh', '--pk-flesh-in', '--pk-flesh-out');
          radial('hov', '--pk-hov-in', '--pk-hov-out');
          radial('sel', '--pk-sel-in', '--pk-sel-out');
          const rg = H.s(
            'radialGradient',
            { id: `${uid}-rind`, gradientUnits: 'userSpaceOnUse', cx: 186, cy: 182, r: R.rind + 8 },
            defs,
          );
          stop(rg, H, 0.86, '--pk-rind-in');
          stop(rg, H, 0.95, '--pk-rind-out');
          stop(rg, H, 1, '--pk-rind-edge');
          const sh = H.s(
            'radialGradient',
            { id: `${uid}-shadow`, gradientUnits: 'userSpaceOnUse', cx: 206, cy: 212, r: R.rind + 12 },
            defs,
          );
          stop(sh, H, 0.86, '--wheel-shadow');
          stop(sh, H, 1, '--wheel-shadow', 0);
          const pg = H.s(
            'radialGradient',
            { id: `${uid}-pith`, gradientUnits: 'userSpaceOnUse', cx: 200, cy: 200, r: R.pith },
            defs,
          );
          stop(pg, H, 0.9, '--pk-pith');
          stop(pg, H, 1, '--pk-pith-edge');
          root.dataset.pkUid = uid;

          // Shadow, the dimpled rind with a slightly bumpy edge, and the pith underneath the segments.
          const base = H.s('g', { class: 'pk-fruit', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: 206, cy: 212, r: R.rind + 12, fill: `url(#${uid}-shadow)`, class: 'pk-shadow' }, base);
          let edge = '';
          for (let k = 0; k <= 180; k++) {
            const a = k * 2;
            const r = R.rind + 0.9 * Math.sin(k * 2.7) + 0.6 * Math.sin(k * 7.3 + 1);
            const [x, y] = H.polar(r, a);
            edge += (k ? 'L' : 'M') + f2(x) + ' ' + f2(y);
          }
          H.s('path', { d: edge + 'Z', fill: `url(#${uid}-rind)`, class: 'pk-rind' }, base);
          let pores = '';
          let hi = '';
          for (let row = 0; row < 3; row++) {
            const count = 64 + row * 8;
            for (let k = 0; k < count; k++) {
              const a = (k + rand() * 0.8 + row * 0.37) * (360 / count);
              const r = R.pith + 3.2 + row * 3.4 + rand() * 1.2;
              const [x, y] = H.polar(r, a);
              const s = 0.55 + rand() * 0.5;
              pores += dot(x, y, s);
              if (rand() < 0.5) hi += dot(x - 0.6, y - 0.7, s * 0.55);
            }
          }
          H.s('path', { d: pores, class: 'pk-pores' }, base);
          H.s('path', { d: hi, class: 'pk-pores-hi' }, base);
          H.s('circle', { cx: 200, cy: 200, r: R.pith, fill: `url(#${uid}-pith)`, class: 'pk-pith' }, base);

          // Segments.
          const gap = 6;
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const [cx, cy] = H.polar(R.lbl, sl.mid);
            g.style.setProperty('--cx', f2(cx) + 'px');
            g.style.setProperty('--cy', f2(cy) + 'px');
            H.s('path', { d: H.sector(R.hub, R.pith, sl.a0, sl.a1), class: 'pk-hit' }, g);
            const body = H.s('g', { class: 'pk-body' }, g);
            const squeeze = H.s('g', { class: 'pk-squeeze' }, body);
            H.s(
              'path',
              { d: segPath(H, R.seg0, R.seg1, sl.a0, sl.a1, gap, 9), class: 'pk-seg', fill: `url(#${uid}-flesh)` },
              squeeze,
            );
            H.s('path', { d: sacs(H, sl, rand, gap), class: 'pk-sac' }, squeeze);
            // A wet highlight along the rim of the segment, shown on hover and selection.
            H.s('path', { d: H.arc(R.seg1 - 7, sl.a0 + 7, sl.a1 - 7), class: 'pk-gloss' }, squeeze);
            if (sl.off) H.s('path', { d: segPath(H, R.seg0, R.seg1, sl.a0, sl.a1, gap, 9), class: 'pk-off' }, squeeze);
            const c = H.s('g', { class: 'pk-content' }, squeeze);
            const maxWidth = room(H, sl, R.seg0, R.seg1, 5);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 25,
                subSize: 13,
                gap: -1,
                maxWidth,
                minSize: 11,
                cls: 'pk-lbl pk-fmt',
                subCls: 'pk-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 14.5,
                gap: 2,
                maxWidth,
                minSize: 8.5,
                cls: 'pk-lbl pk-word',
                sub: null,
              });
            }
            // More choices: an arrowhead edged in pith near the rind, squeezed with the segment.
            H.ringMark(squeeze, sl, m, { r: R.seg1 - 9, size: 8, halo: 1.3, cls: 'pk-ring-mark' });
            H.s('g', { class: 'pk-fx' }, g);
          }

          // The core: white pith with the wheel's name, the file and the key.
          const hub = H.s('g', { class: 'pk-hub' }, root);
          H.s('circle', { cx: 200, cy: 200, r: R.hub, class: 'pk-core' }, hub);
          let star = '';
          for (const sl of m.slices) {
            const [x0, y0] = H.polar(R.hub - 14, sl.a0);
            const [x1, y1] = H.polar(R.hub + 1, sl.a0);
            star += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d: star, class: 'pk-core-star' }, hub);
          // Without a key (a ring opened from the menu) the name and the file sit in the middle.
          const low = m.key ? 0 : 8;
          H.label(hub, 200, 184 + low, m.title, {
            maxWidth: 88,
            size: 16.5,
            minSize: 9,
            cls: 'pk-title',
            maxLines: 1,
          });
          H.label(hub, 200, 202 + low, m.file, {
            maxWidth: 82,
            size: 11.5,
            minSize: 9,
            cls: 'pk-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.4;
            H.s('rect', { x: f2(200 - kw / 2), y: 212, width: f2(kw), height: 16, rx: 8, class: 'pk-key' }, hub);
            H.text(hub, 200, 220.5, m.key, { class: 'pk-keytext' });
          }
        },

        update(root, m, st) {
          const uid = root.dataset.pkUid;
          root.querySelectorAll('.slice').forEach((g) => {
            const i = +g.dataset.slice;
            const fill = i === st.selected ? 'sel' : i === st.hover ? 'hov' : 'flesh';
            const seg = g.querySelector('.pk-seg');
            if (seg.dataset.f !== fill) {
              seg.dataset.f = fill;
              seg.setAttribute('fill', `url(#${uid}-${fill})`);
            }
          });
        },

        // Juice drops and a zest mist burst from the squeezed segment's rim. The drops are built
        // only for the effect and removed afterwards; CSS keyframes move them (frozen at --t in strips).
        onSelect(root, m, i, H, t) {
          const g = root.querySelector(`.slice[data-slice="${i}"]`);
          root.querySelectorAll('.pk-fx').forEach((n) => (n.textContent = ''));
          if (t == null && !applying(root)) return;
          const fx = g.querySelector('.pk-fx');
          const sl = m.slices[i];
          const rand = rng(31 + i * 17);
          // The mist: a cloud of fine dots that swells and fades.
          const [mx, my] = H.polar(R.seg1 + 4, sl.mid);
          let mist = '';
          for (let k = 0; k < 80; k++) {
            const a = sl.mid + (rand() - 0.5) * 80;
            const r = R.seg1 - 10 + rand() * 52;
            const [x, y] = H.polar(r, a);
            mist += dot(x, y, 0.6 + rand() * 1.4);
          }
          const mg = H.s('g', { class: 'pk-mist' }, fx);
          mg.style.setProperty('--ox', f2(mx) + 'px');
          mg.style.setProperty('--oy', f2(my) + 'px');
          H.s('path', { d: mist }, mg);
          // The splash: a crown of juice spikes that shoots out of the rim and falls back.
          let crown = '';
          for (let k = 0; k < 9; k++) {
            const a = sl.mid + (k - 4) * 9 + (rand() - 0.5) * 5;
            const len = 14 + rand() * 16 - Math.abs(k - 4) * 1.5;
            const [bx0, by0] = H.polar(R.seg1 - 2, a - 2.2);
            const [bx1, by1] = H.polar(R.seg1 - 2, a + 2.2);
            const [tx, ty] = H.polar(R.seg1 - 2 + len, a);
            crown += `M${f2(bx0)} ${f2(by0)}Q${f2((bx0 + tx) / 2)} ${f2((by0 + ty) / 2)} ${f2(tx)} ${f2(ty)}Q${f2((bx1 + tx) / 2)} ${f2((by1 + ty) / 2)} ${f2(bx1)} ${f2(by1)}Z`;
          }
          const cg = H.s('g', { class: 'pk-crown' }, fx);
          cg.style.setProperty('--ox', f2(mx) + 'px');
          cg.style.setProperty('--oy', f2(my) + 'px');
          H.s('path', { d: crown }, cg);
          // The drops: each flies out along its own line and falls a little.
          for (let k = 0; k < 12; k++) {
            const a = sl.mid + (k - 5.5) * 5.6 + (rand() - 0.5) * 4;
            const [x, y] = H.polar(R.seg1 - 6, a);
            const dist = 30 + rand() * 44;
            const [ex, ey] = H.polar(R.seg1 - 6 + dist, a);
            const at = H.s('g', { transform: `translate(${f2(x)} ${f2(y)})` }, fx);
            const fly = H.s('g', { class: 'pk-drop' }, at);
            fly.style.setProperty('--dx', f2(ex - x) + 'px');
            fly.style.setProperty('--dy', f2(ey - y) + 'px');
            fly.style.setProperty('--fall', f2(10 + rand() * 18) + 'px');
            fly.style.setProperty('--d', Math.round(rand() * 80) + 'ms');
            const fall = H.s('g', { class: 'pk-fall' }, fly);
            const s = 3.4 + rand() * 3.4;
            H.s('path', { d: drop(s), transform: `rotate(${f2(a + 180)})`, class: 'pk-drop-body' }, fall);
            H.s('circle', { cx: f2(-s * 0.3), cy: f2(s * 0.1), r: f2(s * 0.28), class: 'pk-drop-hi' }, fall);
          }
          if (t != null) return;
          clearTimeout(root.__pkFx);
          root.__pkFx = setTimeout(() => (fx.textContent = ''), 700);
        },
      },

      sounds: {
        // The halves part: a sticky, juicy tear through peel and pulp, then the half settles.
        open: voice({
          name: 'open',
          len: 0.36,
          takes: 3,
          spread: 0.02,
          level: LEVEL.open,
          lp: 7000,
          draw(y, sr, rand) {
            hiss(y, sr, rand, 0.002, 0.2, 1.1, (u) => [0.6 * Math.min(1, u * 8) * (1 - u) ** 1.5, 1700 - 1000 * u]);
            juice(y, sr, rand, 0.01, 0.16, 26, 700, 2400, 0.55);
            for (let k = 0; k < 10; k++)
              crack(y, sr, rand, 0.003 + rand() * 0.09, 1200 + rand() * 1800, 1.5, 0.25, 0.0004);
            ring(y, sr, 0.12, 200, 0.03, 0.6);
            ring(y, sr, 0.12, 380, 0.015, 0.3);
            hiss(y, sr, rand, 0.12, 0.04, 1, (u) => [0.4 * (1 - u) ** 2, 520]);
          },
        }),
        // The segment lifts: a small, juicy squish.
        tick: voice({
          name: 'tick',
          len: 0.07,
          takes: 8,
          spread: 0.06,
          level: LEVEL.tick,
          lp: 7000,
          draw(y, sr, rand) {
            hiss(y, sr, rand, 0.003, 0.04, 1.4, (u) => [0.5 * Math.min(1, u * 15) * (1 - u) ** 2, 900 + 700 * u]);
            juice(y, sr, rand, 0.004, 0.035, 8, 900, 2600, 0.3);
            crack(y, sr, rand, 0.003, 1600, 1.5, 0.15, 0.0006);
          },
        }),
        // A segment pulled from the others: its skin stretches with a little squeak and pops free.
        enter: voice({
          name: 'enter',
          len: 0.22,
          takes: 4,
          spread: 0.04,
          level: LEVEL.enter,
          lp: 7000,
          draw(y, sr, rand) {
            // Stick and slip: the band rises while the skin catches and lets go, ever faster.
            hiss(y, sr, rand, 0.004, 0.11, 7, (u) => {
              const slip = Math.abs(Math.sin(2 * Math.PI * 0.11 * (60 * u + 30 * u * u))) ** 3;
              return [0.9 * Math.sin(Math.PI * u) * slip, 900 + 1200 * u];
            });
            juice(y, sr, rand, 0.12, 0.03, 9, 900, 2600, 0.7);
            crack(y, sr, rand, 0.12, 1400, 1.2, 0.4, 0.0008);
            hiss(y, sr, rand, 0.12, 0.05, 1.2, (u) => [0.4 * Math.min(1, u * 10) * (1 - u) ** 2, 1300 - 600 * u]);
          },
        }),
        // Back out: the segment pressed back into place, with a soft suck of juice.
        leave: voice({
          name: 'leave',
          len: 0.15,
          takes: 4,
          spread: 0.04,
          level: LEVEL.leave,
          lp: 7000,
          draw(y, sr, rand) {
            hiss(y, sr, rand, 0.002, 0.05, 1.2, (u) => [0.5 * Math.min(1, u * 10) * (1 - u) ** 2, 1300 - 700 * u]);
            juice(y, sr, rand, 0.005, 0.04, 5, 700, 2000, 0.4);
            bubble(y, sr, 0.02, 520, 0.022, 0.25, 0.25);
          },
        }),
        // The squeeze: pulp crushed in a squelch, a spurt of juice, the zest's fine mist and the drops
        // landing one by one.
        success: voice({
          name: 'success',
          len: 0.7,
          takes: 3,
          spread: 0.02,
          level: LEVEL.success,
          lp: 7000,
          draw(y, sr, rand) {
            juice(y, sr, rand, 0.002, 0.16, 70, 600, 2600, 0.6);
            hiss(y, sr, rand, 0.002, 0.2, 1.1, (u) => [0.7 * Math.min(1, u * 10) * (1 - u) ** 2, 1500 - 900 * u]);
            for (let k = 0; k < 20; k++)
              crack(y, sr, rand, 0.003 + rand() * 0.12, 1000 + rand() * 2000, 1.5, 0.2, 0.0004);
            ring(y, sr, 0.01, 230, 0.03, 0.4);
            hiss(y, sr, rand, 0.05, 0.09, 0.9, (u) => [0.45 * Math.min(1, u * 20) * (1 - u) ** 3, 3600 + 800 * u]);
            mist(y, sr, rand, 0.04, 0.55, 260, 0.7, (u) => (1 - u) ** 2 * Math.min(1, u * 6));
            [0.3, 0.36, 0.42, 0.49, 0.56].forEach((at, k) => plip(y, sr, rand, at, 0.5 * (1 - k * 0.12)));
          },
        }),
      },
    });
  })();
}
