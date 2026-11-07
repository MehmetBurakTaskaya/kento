// SPDX-License-Identifier: MIT
// Theme: Nar. A pomegranate cut open: a leathery skin with a small crown, pale membranes, and
// every slice a compartment packed with glossy arils around a clearing that holds its label.
// Applying empties the compartment: the arils spill out and roll away, glinting.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const ID = 'nar';
    // Radii in the 400 x 400 view box. The crown rises above the skin at twelve o'clock.
    const R = { hub: 50, c0: 56, c1: 166, pith: 171, skin: 182, lbl: 113 };
    const GAP = 6;

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
    const dot = (x, y, r) =>
      `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
    // An ellipse as path data, rotated by rot degrees.
    function oval(cx, cy, rx, ry, rot) {
      const t = (rot * Math.PI) / 180;
      const dx = Math.cos(t) * rx,
        dy = Math.sin(t) * rx;
      return `M${f2(cx + dx)} ${f2(cy + dy)}A${f2(rx)} ${f2(ry)} ${f2(rot)} 1 0 ${f2(cx - dx)} ${f2(cy - dy)}A${f2(rx)} ${f2(ry)} ${f2(rot)} 1 0 ${f2(cx + dx)} ${f2(cy + dy)}Z`;
    }
    function stop(grad, H, offset, token, op) {
      H.s('stop', { offset, style: `stop-color: var(${token})${op != null ? `; stop-opacity: ${op}` : ''}` }, grad);
    }

    // A compartment: a sector with soft corners, its sides held GAP apart.
    function cell(H, r0, r1, a0, a1, gap, k) {
      const g = (r) => ((gap / 2 / r) * 180) / Math.PI;
      const P = (r, a) => H.polar(r, a).map(f2).join(' ');
      const ka = (((k * 1.2) / r1) * 180) / Math.PI;
      const s0 = a0 + g(r1),
        s1 = a1 - g(r1);
      const k0 = (((k * 0.8) / r0) * 180) / Math.PI;
      const i0 = a0 + g(r0),
        i1 = a1 - g(r0);
      return (
        `M${P(r0 + k * 0.8, a0 + g(r0 + k * 0.8))}L${P(r1 - k, a0 + g(r1 - k))}Q${P(r1, s0)} ${P(r1, s0 + ka)}` +
        `A${r1} ${r1} 0 0 1 ${P(r1, s1 - ka)}Q${P(r1, s1)} ${P(r1 - k, a1 - g(r1 - k))}` +
        `L${P(r0 + k * 0.8, a1 - g(r0 + k * 0.8))}Q${P(r0, i1)} ${P(r0, i1 - k0)}A${r0} ${r0} 0 0 0 ${P(r0, i0 + k0)}Q${P(r0, i0)} ${P(r0 + k * 0.8, a0 + g(r0 + k * 0.8))}Z`
      );
    }

    // Arils packed into a compartment around a clearing that fits the label box `box`: centers are
    // scattered first, then every aril grows until it touches a neighbour, a wall or the clearing,
    // so they sit squeezed together like the real thing.
    // The mark of a slice that opens a ring of choices: its point's radius and its length.
    const MARK = { r: 161.5, size: 10.5 };

    function pack(H, sl, rand, box) {
      const pts = [];
      // The arils also leave the mark of a slice that opens a ring a clearing of its own.
      const mark = sl.ring ? H.polar(MARK.r - MARK.size / 2, sl.mark) : null;
      const boxDist = (x, y) => {
        const dx = Math.max(Math.abs(x - box.cx) - box.hw, 0);
        const dy = Math.max(Math.abs(y - box.cy) - box.hh, 0);
        const clear = Math.sqrt(dx * dx + dy * dy);
        return mark ? Math.min(clear, Math.hypot(x - mark[0], y - mark[1]) - 7.5) : clear;
      };
      const wall = (r, a) => {
        const side = Math.min(a - sl.a0, sl.a1 - a);
        return Math.min(r * Math.sin(H.rad(side)) - GAP / 2, r - R.c0, R.c1 - r) - 0.8;
      };
      // As many arils per degree whatever the number of compartments; a grid of 12-unit cells keeps
      // the neighbour checks short on the wide compartments of a wheel with few slices.
      const share = Math.min(4, (sl.a1 - sl.a0) / 45);
      const cells = new Map();
      const cellOf = (x, y) => `${Math.floor(x / 12)},${Math.floor(y / 12)}`;
      const around = (x, y) => {
        const cx = Math.floor(x / 12);
        const cy = Math.floor(y / 12);
        const out = [];
        for (let i = -1; i <= 1; i++)
          for (let j = -1; j <= 1; j++) out.push(...(cells.get(`${cx + i},${cy + j}`) ?? []));
        return out;
      };
      for (let k = 0; k < 2400 * share && pts.length < 64 * share; k++) {
        const r = R.c0 + 5 + rand() * (R.c1 - R.c0 - 10);
        const a = sl.a0 + rand() * (sl.a1 - sl.a0);
        const [x, y] = H.polar(r, a);
        if (wall(r, a) < 4.6 || boxDist(x, y) < 9) continue;
        if (around(x, y).some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 11.8 * 11.8)) continue;
        const p = { x, y, rad: r, a };
        pts.push(p);
        const key = cellOf(x, y);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(p);
      }
      return pts
        .map((p) => {
          let near = Infinity;
          for (const q of around(p.x, p.y)) if (q !== p) near = Math.min(near, Math.hypot(p.x - q.x, p.y - q.y));
          const r = Math.min(9.5, near / 2 + 0.9, wall(p.rad, p.a) + 1.2, boxDist(p.x, p.y) - 3);
          return { x: p.x, y: p.y, r, e: 0.8 + rand() * 0.14, rot: rand() * 180, rad: p.rad };
        })
        .filter((p) => p.r >= 4.2);
    }
    function arilPaths(list) {
      let body = '',
        shade = '',
        hi = '',
        socket = '';
      for (const p of list) {
        shade += oval(p.x + 0.9, p.y + 1.3, p.r, p.r * p.e, p.rot);
        body += oval(p.x, p.y, p.r * 0.94, p.r * p.e * 0.9, p.rot);
        hi += oval(p.x - p.r * 0.34, p.y - p.r * 0.36, p.r * 0.3, p.r * 0.17, -38);
        socket += oval(p.x, p.y, p.r * 0.86, p.r * p.e * 0.84, p.rot);
      }
      return { body, shade, hi, socket };
    }

    // A four-point glint.
    const glint = (s) =>
      `M0 ${-s}L${f2(s * 0.22)} ${f2(-s * 0.22)}L${s} 0L${f2(s * 0.22)} ${f2(s * 0.22)}L0 ${s}L${f2(-s * 0.22)} ${f2(s * 0.22)}L${-s} 0L${f2(-s * 0.22)} ${f2(-s * 0.22)}Z`;

    // The crown (calyx) on top of the fruit, in view box units, its base on the skin at twelve.
    function crownPath() {
      return (
        'M181 28C180 21 177 15 171 7C178 9 182 12 185 15C186 9 188 4 192 0C195 6 197 10 198 14C199 9 200 5 200 2' +
        'C200 5 201 9 202 14C203 10 205 6 208 0C212 4 214 9 215 15C218 12 222 9 229 7C223 15 220 21 219 28Z'
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
    // An aril: a small glossy seed in its sac of juice knocking on another, a soft, slightly wet tick.
    function aril(y, sr, rand, at, amp) {
      const f = 1700 + rand() * 1300;
      crack(y, sr, rand, at, 2600 + rand() * 1600, 1.6, 0.6 * amp, 0.00025);
      ring(y, sr, at, f, 0.004, 0.7 * amp);
      ring(y, sr, at, f * (1.85 + rand() * 0.15), 0.0025, 0.35 * amp);
      bubble(y, sr, at + 0.0005, f * 0.7, 0.003, 0.15, 0.25 * amp);
    }
    // A tear through skin or membrane: cracks between lo and hi Hz, swelling and fading over len;
    // long ones rasp like leather, short ones crinkle like paper.
    function tear(y, sr, rand, at, len, count, lo, hi, amp, grain) {
      for (let k = 0; k < count; k++) {
        const u = rand();
        const a = amp * (0.3 + rand() * 0.7) * Math.sin(Math.PI * u) ** 0.7;
        crack(y, sr, rand, at + u * len, lo * (hi / lo) ** rand(), 1.4, a, grain * (0.4 + rand()));
      }
    }
    // A glint: a small, clear ping a fifth above itself.
    function sparkle(y, sr, at, f, amp) {
      ring(y, sr, at, f, 0.05, amp);
      ring(y, sr, at, f * 1.5, 0.03, 0.4 * amp);
    }
    // How loud each voice plays, measured so that the theme sits as loud as every other one.
    const LEVEL = { open: 0.074, tick: 0.1, enter: 0.059, leave: 0.061, success: 0.044 };

    Board.define({
      id: ID,
      fonts: {
        brand: "'Figtree'",
        display: "'Gloock'",
        load: ["'Figtree'", "'Gloock'"],
        credits: [
          { family: 'Gloock', license: 'SIL Open Font License 1.1' },
          { family: 'Figtree', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 120, stagger: 14, apply: 680 },
      palette: {
        light: {
          bg: '#fbf6f8',
          surface: '#ffffff',
          'surface-2': '#f8eef2',
          border: '#ecd7df',
          'border-strong': '#c99aab',
          text: '#2a0d17',
          'text-muted': '#6b4a57',
          accent: '#a3122f',
          'on-accent': '#ffffff',
          focus: '#a3122f',
          success: '#2e7d4f',
          'on-success': '#ffffff',
          'success-text': '#23663f',
          warning: '#b86e00',
          'warning-text': '#7a4800',
          danger: '#c0262d',
          desk: 'radial-gradient(120% 100% at 30% 12%, #ffffff 0%, #f5edf3 45%, #e5d6e3 100%)',
          'wheel-face': '#f6e2c6',
          'wheel-slice': '#fbeedd',
          'wheel-slice-hover': '#ffd8de',
          'wheel-slice-selected': '#9b0f2e',
          'wheel-text': '#6e0a20',
          'wheel-text-selected': '#fff4f6',
          'wheel-line': '#e8caa0',
          'wheel-shadow': 'rgba(90, 20, 50, 0.28)',
          'nr-membrane': '#ecd2ab',
          'nr-aril': '#c8173f',
          'nr-aril-hov': '#e3204c',
          'nr-aril-shade': '#6e0720',
          'nr-aril-hi': '#ffffff',
          'nr-hi-op': '0.78',
          'nr-socket': '#d9576f',
          'nr-skin': '#a8142e',
          'nr-skin-hi': '#dd5a5f',
          'nr-skin-edge': '#6a0a1c',
          'nr-speck': '#f6c784',
          'nr-speck-dark': '#5e0716',
          'nr-crown': '#93132c',
          'nr-crown-tip': '#e58a7a',
          'nr-crown-in': '#3f0410',
          'nr-sub': '#7d2337',
          'nr-sub-sel': '#ffdbe2',
          'nr-hub': '#f8e7cf',
          'nr-hub-edge': '#e3c497',
          'nr-hub-text': '#6e0a20',
          'nr-hub-sub': '#7d4a3c',
          'nr-key': '#9b0f2e',
          'nr-key-text': '#fff4f6',
          'nr-glint': '#ffffff',
        },
        dark: {
          bg: '#140a12',
          surface: '#1f1220',
          'surface-2': '#2a1729',
          border: '#3d2238',
          'border-strong': '#643a5a',
          text: '#fbeef2',
          'text-muted': '#c9a9b8',
          accent: '#ff6b88',
          'on-accent': '#2a0610',
          focus: '#ff9fb3',
          success: '#6fd39a',
          'on-success': '#062214',
          'success-text': '#86e0ad',
          warning: '#ffbf5a',
          'warning-text': '#ffd080',
          danger: '#ff6b7d',
          desk: 'radial-gradient(110% 100% at 70% 10%, #301530 0%, #1a0b1c 50%, #0b050d 100%)',
          'wheel-face': '#3a1527',
          'wheel-slice': '#2b0e1e',
          'wheel-slice-hover': '#521838',
          'wheel-slice-selected': '#ff5a7a',
          'wheel-text': '#ffe4ea',
          'wheel-text-selected': '#2a0610',
          'wheel-line': '#4a2033',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'nr-membrane': '#1c0814',
          'nr-aril': '#e3214c',
          'nr-aril-hov': '#ff4a70',
          'nr-aril-shade': '#5c0420',
          'nr-aril-hi': '#ffe0e8',
          'nr-hi-op': '0.85',
          'nr-socket': '#8a2a4a',
          'nr-skin': '#5e0b20',
          'nr-skin-hi': '#9a2238',
          'nr-skin-edge': '#2a0310',
          'nr-speck': '#d98a7a',
          'nr-speck-dark': '#24020c',
          'nr-crown': '#4e0819',
          'nr-crown-tip': '#b8495a',
          'nr-crown-in': '#140107',
          'nr-sub': '#ffb7c6',
          'nr-sub-sel': '#4a0a18',
          'nr-hub': '#2b0e1e',
          'nr-hub-edge': '#5c2140',
          'nr-hub-text': '#ffe4ea',
          'nr-hub-sub': '#e7a5b5',
          'nr-key': '#ff5a7a',
          'nr-key-text': '#2a0610',
          'nr-glint': '#fff2f6',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['nr-sub', 'wheel-slice', 'text'],
        ['nr-sub', 'wheel-slice-hover', 'text'],
        ['nr-sub-sel', 'wheel-slice-selected', 'text'],
        ['nr-hub-text', 'nr-hub', 'text'],
        ['nr-hub-sub', 'nr-hub', 'text'],
        ['nr-key-text', 'nr-key', 'text'],
      ],

      // Gradients are built per wheel in render(): they read the palette tokens of their own card.
      defs: '',

      wheel: {
        render(root, m, H) {
          const uid = H.uid(ID);
          const rand = rng(4242 + m.n);
          const defs = H.s('defs', {}, root);
          const sk = H.s(
            'radialGradient',
            { id: `${uid}-skin`, gradientUnits: 'userSpaceOnUse', cx: 168, cy: 150, r: 240 },
            defs,
          );
          stop(sk, H, 0.45, '--nr-skin-hi');
          stop(sk, H, 0.72, '--nr-skin');
          stop(sk, H, 0.9, '--nr-skin-edge');
          const sh = H.s(
            'radialGradient',
            { id: `${uid}-shadow`, gradientUnits: 'userSpaceOnUse', cx: 205, cy: 211, r: R.skin + 14 },
            defs,
          );
          stop(sh, H, 0.86, '--wheel-shadow');
          stop(sh, H, 1, '--wheel-shadow', 0);
          const cr = H.s(
            'linearGradient',
            { id: `${uid}-crown`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 0, y2: 30 },
            defs,
          );
          stop(cr, H, 0, '--nr-crown-tip');
          stop(cr, H, 0.6, '--nr-crown');

          // Shadow, the leathery skin with a slightly lobed edge, speckles, and the membrane.
          const fruit = H.s('g', { class: 'nr-fruit', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: 205, cy: 211, r: R.skin + 14, fill: `url(#${uid}-shadow)` }, fruit);
          let edge = '';
          for (let k = 0; k <= 180; k++) {
            const a = k * 2;
            const r = R.skin + 1.6 * Math.cos(H.rad(a * 6)) + 0.5 * Math.sin(k * 1.9);
            const [x, y] = H.polar(r, a);
            edge += (k ? 'L' : 'M') + f2(x) + ' ' + f2(y);
          }
          H.s('path', { d: edge + 'Z', fill: `url(#${uid}-skin)`, class: 'nr-skin' }, fruit);
          let spl = '';
          let spd = '';
          for (let k = 0; k < 150; k++) {
            const a = rand() * 360;
            const r = R.pith + 2 + rand() * (R.skin - R.pith - 3.5);
            const [x, y] = H.polar(r, a);
            if (rand() < 0.62) spl += dot(x, y, 0.35 + rand() * 0.55);
            else spd += dot(x, y, 0.3 + rand() * 0.5);
          }
          H.s('path', { d: spl, class: 'nr-speck' }, fruit);
          H.s('path', { d: spd, class: 'nr-speck-dark' }, fruit);
          H.s('circle', { cx: 200, cy: 200, r: R.pith, class: 'nr-membrane' }, fruit);

          // Compartments.
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.hub, R.skin, sl.a0, sl.a1), class: 'nr-hit' }, g);
            const body = H.s('g', { class: 'nr-body' }, g);
            const shape = cell(H, R.c0, R.c1, sl.a0, sl.a1, GAP, 8);
            H.s('path', { d: shape, class: 'nr-cell' }, body);
            // The label first: its box decides the clearing the arils leave free.
            const c = H.s('g', { class: 'nr-content' }, body);
            const maxWidth = room(H, sl, R.c0, R.c1, 6);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 26,
                subSize: 12.5,
                gap: 1,
                maxWidth,
                minSize: 11,
                cls: 'nr-lbl nr-fmt',
                subCls: 'nr-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 14,
                gap: 2,
                maxWidth,
                minSize: 8.5,
                cls: 'nr-lbl nr-word',
                sub: null,
              });
            }
            let bb;
            try {
              bb = c.getBBox();
            } catch (e) {
              bb = null;
            }
            const [lx, ly] = H.polar(R.lbl, sl.mid);
            const box =
              bb && bb.width
                ? { cx: bb.x + bb.width / 2, cy: bb.y + bb.height / 2, hw: bb.width / 2 + 2, hh: bb.height / 2 - 0.5 }
                : { cx: lx, cy: ly, hw: 36, hh: 22 };
            const list = pack(H, sl, rand, box);
            g.__arils = list;
            const p = arilPaths(list);
            body.insertBefore(H.s('path', { d: p.socket, class: 'nr-socket' }), c);
            const ar = H.s('g', { class: 'nr-arils' });
            body.insertBefore(ar, c);
            H.s('path', { d: p.shade, class: 'nr-aril-shade' }, ar);
            H.s('path', { d: p.body, class: 'nr-aril' }, ar);
            H.s('path', { d: p.hi, class: 'nr-aril-hi' }, ar);
            if (sl.off) body.insertBefore(H.s('path', { d: shape, class: 'nr-off' }), c);
            // More choices: an arrowhead near the pith, in a clearing among the arils.
            H.ringMark(body, sl, m, { ...MARK, cls: 'nr-ring-mark' });
            H.s('g', { class: 'nr-fx' }, g);
          }

          // The crown at twelve o'clock, then the spongy core with the name, file and key.
          const crown = H.s('g', { class: 'nr-crown', 'aria-hidden': 'true' }, root);
          H.s('path', { d: crownPath(), fill: `url(#${uid}-crown)`, class: 'nr-crown-body' }, crown);
          H.s(
            'path',
            {
              d: 'M186 18C190 15 196 14 200 14C204 14 210 15 214 18C210 21 205 22 200 22C195 22 190 21 186 18Z',
              class: 'nr-crown-in',
            },
            crown,
          );
          const hub = H.s('g', { class: 'nr-hub' }, root);
          H.s('circle', { cx: 200, cy: 200, r: R.hub, class: 'nr-core' }, hub);
          // Without a key (a ring opened from the menu) the name and the file sit in the middle.
          const low = m.key ? 0 : 8;
          H.label(hub, 200, 183 + low, m.title, { maxWidth: 86, size: 17, minSize: 9, cls: 'nr-title', maxLines: 1 });
          H.label(hub, 200, 201 + low, m.file, {
            maxWidth: 80,
            size: 11.5,
            minSize: 9,
            cls: 'nr-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.4;
            H.s('rect', { x: f2(200 - kw / 2), y: 211, width: f2(kw), height: 16, rx: 8, class: 'nr-key' }, hub);
            H.text(hub, 200, 219.5, m.key, { class: 'nr-keytext' });
          }
        },

        // The arils of the chosen compartment are cloned one by one and sent rolling out; the
        // compartment itself already shows its emptied, stained state. Glints flash on a few.
        onSelect(root, m, i, H, t) {
          root.querySelectorAll('.nr-fx').forEach((n) => (n.textContent = ''));
          if (t == null && !applying(root)) return;
          const g = root.querySelector(`.slice[data-slice="${i}"]`);
          const sl = m.slices[i];
          const fx = g.querySelector('.nr-fx');
          const rand = rng(17 + i * 31);
          const t0 = H.rad(sl.mid);
          const ux = Math.sin(t0);
          const uy = -Math.cos(t0);
          const list = g.__arils || [];
          list.forEach((p) => {
            const at = H.s('g', { transform: `translate(${f2(p.x)} ${f2(p.y)})` }, fx);
            // Outer arils leave first; each gets its own push, spin and drop.
            const out = (p.rad - R.c0) / (R.c1 - R.c0);
            const dist = 34 + rand() * 46 + out * 18;
            const side = (rand() - 0.5) * 44;
            const d = Math.round((1 - out) * 120 + rand() * 50) + 'ms';
            const roll = H.s('g', { class: 'nr-roll' }, at);
            roll.style.setProperty('--dx', f2(ux * dist - uy * side) + 'px');
            roll.style.setProperty('--dy', f2(uy * dist + ux * side) + 'px');
            roll.style.setProperty('--d', d);
            const fall = H.s('g', { class: 'nr-drop' }, roll);
            fall.style.setProperty('--fall', f2(18 + rand() * 30) + 'px');
            const spin = H.s('g', { class: 'nr-spin' }, fall);
            spin.style.setProperty('--spin', Math.round((rand() < 0.5 ? -1 : 1) * (160 + rand() * 260)) + 'deg');
            H.s('path', { d: oval(0.9, 1.3, p.r, p.r * p.e, p.rot), class: 'nr-aril-shade' }, spin);
            H.s('path', { d: oval(0, 0, p.r * 0.94, p.r * p.e * 0.9, p.rot), class: 'nr-aril' }, spin);
            H.s('path', { d: oval(-p.r * 0.34, -p.r * 0.36, p.r * 0.3, p.r * 0.17, -38), class: 'nr-aril-hi' }, spin);
          });
          // Glints flash along the arils' way out.
          for (let k = 0; k < 6 && list.length; k++) {
            const p = list[Math.floor(rand() * list.length)];
            const dist = 14 + rand() * 44;
            const gx = p.x + ux * dist + (rand() - 0.5) * 20;
            const gy = p.y + uy * dist + (rand() - 0.5) * 20;
            const at = H.s('g', { transform: `translate(${f2(gx)} ${f2(gy)})` }, fx);
            const gl = H.s('path', { d: glint(5 + rand() * 4), class: 'nr-glint' }, at);
            gl.style.setProperty('--d', Math.round(90 + k * 70 + rand() * 40) + 'ms');
          }
          if (t != null) return;
          clearTimeout(root.__nrFx);
          root.__nrFx = setTimeout(() => (fx.textContent = ''), 760);
        },
      },

      sounds: {
        // The leathery skin cracks open and the arils settle into their compartments.
        open: voice({
          name: 'open',
          len: 0.38,
          takes: 3,
          spread: 0.02,
          level: LEVEL.open,
          lp: 7000,
          draw(y, sr, rand) {
            tear(y, sr, rand, 0.002, 0.09, 22, 500, 1600, 0.8, 0.002);
            hiss(y, sr, rand, 0.002, 0.08, 1.5, (u) => [0.3 * Math.sin(Math.PI * u), 700]);
            ring(y, sr, 0.004, 170, 0.02, 0.5);
            for (let k = 0; k < 12; k++) aril(y, sr, rand, 0.08 + k * 0.014 + rand() * 0.012, 0.6 - k * 0.035);
          },
        }),
        // A pinch of arils jostling as the compartment lifts.
        tick: voice({
          name: 'tick',
          len: 0.06,
          takes: 8,
          spread: 0.05,
          level: LEVEL.tick,
          lp: 7000,
          draw(y, sr, rand) {
            aril(y, sr, rand, 0.002, 1);
            aril(y, sr, rand, 0.008 + rand() * 0.006, 0.6);
            if (rand() < 0.6) aril(y, sr, rand, 0.02 + rand() * 0.01, 0.35);
          },
        }),
        // The pale membrane peels back with a papery crinkle, baring two arils.
        enter: voice({
          name: 'enter',
          len: 0.2,
          takes: 4,
          spread: 0.04,
          level: LEVEL.enter,
          lp: 7000,
          draw(y, sr, rand) {
            tear(y, sr, rand, 0.003, 0.12, 60, 2000, 5000, 0.6, 0.0003);
            aril(y, sr, rand, 0.125, 0.4);
            aril(y, sr, rand, 0.15, 0.25);
          },
        }),
        // Back out: a few arils fall back into place.
        leave: voice({
          name: 'leave',
          len: 0.14,
          takes: 4,
          spread: 0.04,
          level: LEVEL.leave,
          lp: 7000,
          draw(y, sr, rand) {
            [0.002, 0.022, 0.047, 0.078].forEach((at, k) => aril(y, sr, rand, at, 1 - k * 0.25));
          },
        }),
        // The compartment splits with a juicy pop and empties: the arils tumble out, bounce and roll
        // away, and glints flash along their way.
        success: voice({
          name: 'success',
          len: 0.78,
          takes: 3,
          spread: 0.02,
          level: LEVEL.success,
          lp: 7000,
          draw(y, sr, rand) {
            bubble(y, sr, 0.002, 650, 0.015, 0.15, 0.5);
            crack(y, sr, rand, 0.002, 1500, 1.2, 0.5, 0.0008);
            hiss(y, sr, rand, 0.002, 0.04, 1, (u) => [0.4 * (1 - u) ** 2, 900]);
            for (let k = 0; k < 28; k++) {
              // Outer arils leave first, as on the wheel; each lands, bounces and rolls away.
              const at = (1 - rand()) * 0.12 + rand() * 0.05 + 0.02 + rand() * 0.03;
              const a = 0.4 + rand() * 0.6;
              aril(y, sr, rand, at, a);
              aril(y, sr, rand, at + 0.05 + rand() * 0.04, 0.45 * a);
              aril(y, sr, rand, at + 0.12 + rand() * 0.08, 0.2 * a);
            }
            for (let k = 0; k < 6; k++) sparkle(y, sr, 0.09 + k * 0.07 + rand() * 0.04, 2700 + rand() * 800, 0.18);
          },
        }),
      },
    });
  })();
}
