// SPDX-License-Identifier: MIT
// Türk kahvesi: a coffee cup on its saucer, seen from above, on a hammered copper tray. The slices
// lie on the porcelain saucer, split by dotted gold lines inside a gilded band; the cup is the hub,
// full to the brim with foam. The cup's handle turns toward the slice under the pointer and stays
// on the chosen one. Applying a slice swirls the foam, lifts the cup a touch and sends steam up.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const f2 = (n) => Math.round(n * 100) / 100;
    const R = {
      tray: 197,
      trayIn: 186,
      saucer: 184,
      band1: 180,
      band0: 172.5,
      slice1: 170,
      slice0: 91,
      cupShadow: 90,
      lip: 78,
      gold: 76.4,
      wall: 69,
      coffee: 65,
      foam: 61.5,
      lbl: 131,
    };
    const polar = (r, a) => [C + r * Math.sin((a * Math.PI) / 180), C - r * Math.cos((a * Math.PI) / 180)];
    const dot = (x, y, r) => `M${f2(x - r)} ${f2(y)}a${r} ${r} 0 1 0 ${f2(2 * r)} 0a${r} ${r} 0 1 0 ${f2(-2 * r)} 0Z`;
    function rng(seed) {
      let s = seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
    }
    // Where the handle rests when nothing is chosen: on the slice boundary nearest to low on the right
    // (low on the left right to left), so it never seems to point at a slice. Rings may be turned, so
    // the boundaries come from the slices themselves.
    function restAngle(m) {
      const want = m.dir === 'rtl' ? 225 : 135;
      const off = (a) => Math.abs(((((a - want) % 360) + 540) % 360) - 180);
      let best = m.slices.length ? m.slices[0].a1 : want;
      for (const sl of m.slices) if (off(sl.a1) < off(best)) best = sl.a1;
      return best;
    }

    function stops(H, grad, list) {
      for (const [o, cls] of list) H.s('stop', { offset: o, class: cls }, grad);
    }

    function tray(root, H, ids) {
      const g = H.s('g', { class: 'kv-tray', 'aria-hidden': 'true' }, root);
      H.s('circle', { cx: C, cy: C, r: R.tray, class: 'kv-tray-body', fill: `url(#${ids.tray})` }, g);
      // Hammer dents: small facets catching or losing the light.
      const rand = rng(41);
      let hi = '';
      let lo = '';
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * 360 + rand() * 4;
        const [x, y] = polar(R.trayIn + 3 + rand() * 7, a);
        const r = f2(1.6 + rand() * 1.6);
        if (k % 2) hi += dot(x, y, r);
        else lo += dot(x, y, r);
      }
      H.s('path', { d: hi, class: 'kv-dent-hi' }, g);
      H.s('path', { d: lo, class: 'kv-dent-lo' }, g);
      H.s('circle', { cx: C, cy: C, r: R.tray - 0.8, class: 'kv-tray-edge' }, g);
    }

    function saucer(root, H, ids) {
      const g = H.s('g', { class: 'kv-saucer', 'aria-hidden': 'true' }, root);
      H.s('circle', { cx: C, cy: C + 2.5, r: R.saucer + 1, class: 'kv-saucer-shadow' }, g);
      H.s('circle', { cx: C, cy: C, r: R.saucer, class: 'kv-porcelain', fill: `url(#${ids.porcelain})` }, g);
      return g;
    }

    // The gilded band of the saucer: a coloured ring between two gold lines, with gold dots.
    function band(root, H) {
      const g = H.s('g', { class: 'kv-band', 'aria-hidden': 'true' }, root);
      H.s('path', { d: H.ring(R.band0, R.band1), class: 'kv-band-fill', 'fill-rule': 'evenodd' }, g);
      let dots = '';
      for (let k = 0; k < 48; k++) {
        const [x, y] = polar((R.band0 + R.band1) / 2, k * 7.5 + 3.75);
        dots += dot(x, y, k % 2 ? 1 : 1.6);
      }
      H.s('path', { d: dots, class: 'kv-gold-fill' }, g);
      H.s('circle', { cx: C, cy: C, r: R.band0, class: 'kv-gold-line' }, g);
      H.s('circle', { cx: C, cy: C, r: R.band1, class: 'kv-gold-line' }, g);
      H.s('circle', { cx: C, cy: C, r: R.saucer - 1.6, class: 'kv-gold-hair' }, g);
    }

    function cup(root, m, H, ids) {
      const g = H.s('g', { class: 'kv-cup' }, root);
      H.s('circle', { cx: C, cy: C, r: R.cupShadow, class: 'kv-cup-shadow', fill: 'url(#kahve-cup-shadow)' }, g);
      // The handle turns with the choice; it is drawn under the lip.
      const turn = H.s('g', { class: 'kv-handle' }, g);
      const handle = `M${C - 7.5} ${C - R.lip + 3}C${C - 10.5} ${C - R.lip - 7} ${C - 6.5} ${C - R.lip - 15} ${C} ${C - R.lip - 15}C${C + 6.5} ${C - R.lip - 15} ${C + 10.5} ${C - R.lip - 7} ${C + 7.5} ${C - R.lip + 3}`;
      H.s('path', { d: handle, class: 'kv-handle-shadow', transform: 'translate(1.5 2.5)' }, turn);
      H.s('path', { d: handle, class: 'kv-handle-gold' }, turn);
      H.s('path', { d: handle, class: 'kv-handle-body' }, turn);
      const lift = H.s('g', { class: 'kv-lift' }, g);
      H.s('circle', { cx: C, cy: C, r: R.lip, class: 'kv-lip' }, lift);
      H.s('circle', { cx: C, cy: C, r: R.gold, class: 'kv-lip-gold' }, lift);
      H.s('circle', { cx: C, cy: C, r: R.wall, class: 'kv-wall', fill: `url(#${ids.wall})` }, lift);
      H.s('circle', { cx: C, cy: C, r: R.coffee, class: 'kv-coffee' }, lift);
      H.s('circle', { cx: C, cy: C, r: R.foam, class: 'kv-foam', fill: `url(#${ids.foam})` }, lift);
      // Foam: a marbled swirl and bubbles crowding toward the rim; it turns when a slice is applied.
      const swirl = H.s('g', { class: 'kv-swirl' }, lift);
      let marb = '';
      for (let k = 0; k < 3; k++) {
        const pts = [];
        for (let s = 0; s <= 22; s++) {
          const u = s / 22;
          pts.push(polar(16 + u * 42, k * 120 + u * 230));
        }
        marb += 'M' + pts.map(([x, y]) => f2(x) + ' ' + f2(y)).join('L');
      }
      H.s('path', { d: marb, class: 'kv-marble' }, swirl);
      const rand = rng(7);
      let big = '';
      let small = '';
      for (let k = 0; k < 46; k++) {
        const r = 43 + Math.sqrt(rand()) * 17;
        const [x, y] = polar(r, rand() * 360);
        if (k % 3 === 0) big += dot(x, y, f2(1.3 + rand() * 1.1));
        else small += dot(x, y, f2(0.6 + rand() * 0.7));
      }
      H.s('path', { d: big, class: 'kv-bubble' }, swirl);
      H.s('path', { d: small, class: 'kv-bubble-s' }, swirl);
      // Hub text floats on the foam.
      const txt = H.s('g', { class: 'kv-hubtext' }, lift);
      // Without a key the title and file sit lower, in the middle of the foam.
      const dy = m.key ? 0 : 8;
      H.label(txt, C, C - 14 + dy, m.title, { maxWidth: 88, size: 16.5, minSize: 11, maxLines: 1, cls: 'kv-title' });
      H.label(txt, C, C + 4 + dy, m.file, { maxWidth: 80, size: 11.5, minSize: 8.5, maxLines: 1, cls: 'kv-file' });
      if (m.key) {
        const kw = 16 + m.key.length * 6.4;
        H.s('rect', { x: f2(C - kw / 2), y: C + 14, width: f2(kw), height: 17, rx: 8.5, class: 'kv-key' }, txt);
        H.text(txt, C, C + 22.9, m.key, { class: 'kv-keytext' });
      }
      // Steam, seen only while a slice is applied.
      const steam = H.s('g', { class: 'kv-steam' }, g);
      [
        [-27, 0],
        [2, 1],
        [28, 2],
      ].forEach(([dx, k]) => {
        const x = C + dx;
        const y = C - 26 + Math.abs(dx) * 0.3;
        const d = `M${x} ${y}C${x - 11} ${y - 14} ${x + 11} ${y - 26} ${x} ${y - 40}S${x - 10} ${y - 64} ${x + 3} ${y - 82}`;
        const w = H.s('g', { class: 'kv-wisp kv-wisp-' + k }, steam);
        H.s('path', { d, class: 'kv-wisp-soft' }, w);
        H.s('path', { d, class: 'kv-wisp-core' }, w);
      });
      return g;
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
    // Porcelain: a dull "tk" where it touches, then the clear partials of a cup or saucer.
    function china(y, sr, rand, at, f, tau, amp, hard = 0.5) {
      crack(y, sr, rand, at, 2600 + rand() * 900, 1.3, hard * amp, 0.0003);
      [
        [1, 1, 1],
        [2.32, 0.45, 0.55],
        [4.03, 0.2, 0.3],
      ].forEach(([r, a, d]) => {
        if (f * r < 7600) ring(y, sr, at, f * r * (0.995 + rand() * 0.01), tau * d, amp * a);
      });
    }
    // The teaspoon: thin steel, brighter and shorter than the cup it touches.
    function spoon(y, sr, rand, at, f, tau, amp) {
      crack(y, sr, rand, at, 4500, 2, 0.5 * amp, 0.0002);
      ring(y, sr, at, f, tau, amp);
      ring(y, sr, at, f * 2.76, tau * 0.5, 0.35 * amp);
    }
    // The foam: tiny bubbles breaking, each a short high plip.
    function foam(y, sr, rand, at, len, count, amp) {
      for (let k = 0; k < count; k++) {
        const f = 2000 + rand() * 3000;
        bubble(y, sr, at + rand() * len, f, 1 / (0.043 * f + 0.0014 * f ** 1.5), 0.15, amp * (0.3 + rand() * 0.7));
      }
    }
    // How loud each voice plays, measured so that the theme sits as loud as every other one.
    const LEVEL = { open: 0.058, tick: 0.046, enter: 0.025, leave: 0.03, success: 0.058 };

    Board.define({
      id: 'kahve',
      fonts: {
        brand: "'Karla'",
        display: "'Young Serif'",
        load: ["'Young Serif'", "'Karla'"],
        credits: [
          { family: 'Young Serif', license: 'SIL Open Font License 1.1' },
          { family: 'Karla', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 120, stagger: 10, apply: 680 },
      palette: {
        light: {
          bg: '#f1f3f2',
          surface: '#ffffff',
          'surface-2': '#eef1f0',
          border: '#d6dcd9',
          'border-strong': '#a2ada8',
          text: '#1f2624',
          'text-muted': '#56605c',
          accent: '#a5522b',
          'on-accent': '#ffffff',
          focus: '#13615e',
          success: '#2f7d55',
          'on-success': '#ffffff',
          'success-text': '#246843',
          warning: '#c98a12',
          'warning-text': '#875800',
          danger: '#b3261e',
          desk: 'linear-gradient(160deg, #eef2f0 0%, #d8e0dc 100%)',
          'wheel-face': '#ffffff',
          'wheel-slice': '#ffffff',
          'wheel-slice-hover': '#f7e7d8',
          'wheel-slice-selected': '#9c4b26',
          'wheel-text': '#24201e',
          'wheel-text-selected': '#fffaf3',
          'wheel-line': '#c39a45',
          'wheel-shadow': 'rgba(40, 50, 45, 0.3)',
          'kv-sub': '#13615e',
          'kv-sub-selected': '#ffead6',
          'kv-porc-0': '#f4f6f6',
          'kv-porc-1': '#ffffff',
          'kv-porc-2': '#f2f4f5',
          'kv-porc-3': '#dfe4e6',
          'kv-band': '#13615e',
          'kv-gold': '#c39a45',
          'kv-gold-hi': '#e5c77a',
          'kv-copper': '#c97a4b',
          'kv-copper-hi': '#efb48a',
          'kv-copper-lo': '#9a5532',
          'kv-cup': '#ffffff',
          'kv-wall-0': '#f4f4f2',
          'kv-wall-1': '#d9dcdc',
          'kv-coffee': '#4e2e1d',
          'kv-foam-0': '#f2e2c4',
          'kv-foam-1': '#e1c79d',
          'kv-marble': '#f8eedb',
          'kv-bubble': '#c9ab7c',
          'kv-title': '#2c1d14',
          'kv-file': '#5c4434',
          'kv-key': '#fbf4e8',
          'kv-key-line': '#c9ad80',
          'kv-keytext': '#3d2a1e',
          'kv-steam': 'rgba(120, 132, 140, 0.32)',
          'kv-steam-core': 'rgba(255, 255, 255, 0.95)',
        },
        dark: {
          bg: '#0e1414',
          surface: '#151d1d',
          'surface-2': '#1b2626',
          border: '#29393a',
          'border-strong': '#4c6464',
          text: '#f1eee7',
          'text-muted': '#a9b8b5',
          accent: '#e08a55',
          'on-accent': '#2a160b',
          focus: '#f0b27f',
          success: '#5cc98a',
          'on-success': '#08240f',
          'success-text': '#7ad6a1',
          warning: '#f2c14e',
          'warning-text': '#f6d37d',
          danger: '#ff7a6b',
          desk: 'radial-gradient(90% 80% at 50% 38%, #213133 0%, #131c1d 58%, #0a0f10 100%)',
          'wheel-face': '#155550',
          'wheel-slice': '#155550',
          'wheel-slice-hover': '#1d655f',
          'wheel-slice-selected': '#e08a55',
          'wheel-text': '#fbf5ea',
          'wheel-text-selected': '#2a160b',
          'wheel-line': '#d9b45a',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'kv-sub': '#f6dc9c',
          'kv-sub-selected': '#4a220c',
          'kv-porc-0': '#13504b',
          'kv-porc-1': '#1a615b',
          'kv-porc-2': '#145650',
          'kv-porc-3': '#0c3c38',
          'kv-band': '#0b3532',
          'kv-gold': '#d9b45a',
          'kv-gold-hi': '#f3d98f',
          'kv-copper': '#c27348',
          'kv-copper-hi': '#eaa77b',
          'kv-copper-lo': '#83472a',
          'kv-cup': '#1a615b',
          'kv-wall-0': '#f1efe9',
          'kv-wall-1': '#cfd2cf',
          'kv-coffee': '#3b2216',
          'kv-foam-0': '#f0dfc0',
          'kv-foam-1': '#d9be92',
          'kv-marble': '#f7ecd6',
          'kv-bubble': '#bf9f70',
          'kv-title': '#2c1d14',
          'kv-file': '#5a4232',
          'kv-key': '#fbf4e8',
          'kv-key-line': '#c9ad80',
          'kv-keytext': '#3d2a1e',
          'kv-steam': 'rgba(220, 235, 232, 0.28)',
          'kv-steam-core': 'rgba(255, 255, 255, 0.85)',
        },
      },
      contrast: Board.DEFAULT_PAIRS.concat([
        ['kv-sub', 'wheel-slice', 'text'],
        ['kv-sub', 'wheel-slice-hover', 'text'],
        ['kv-sub-selected', 'wheel-slice-selected', 'text'],
        ['wheel-text', 'kv-porc-3', 'text'],
        ['kv-title', 'kv-foam-1', 'text'],
        ['kv-file', 'kv-foam-0', 'text'],
        ['kv-gold-hi', 'kv-band', 'ui'],
      ]),
      defs: `
      <radialGradient id="kahve-cup-shadow" cx=".5" cy=".53" r=".5">
        <stop offset=".8" stop-color="#1c140e" stop-opacity=".22"/>
        <stop offset="1" stop-color="#1c140e" stop-opacity="0"/>
      </radialGradient>`,

      wheel: {
        render(root, m, H) {
          const uid = H.uid('kahve');
          const ids = { porcelain: uid + '-p', wall: uid + '-w', foam: uid + '-f', tray: uid + '-t' };
          const defs = H.s('defs', {}, root);
          stops(
            H,
            H.s(
              'radialGradient',
              { id: ids.porcelain, cx: C, cy: C, r: R.saucer, gradientUnits: 'userSpaceOnUse' },
              defs,
            ),
            [
              [0.5, 'kv-st-p0'],
              [0.72, 'kv-st-p1'],
              [0.9, 'kv-st-p2'],
              [1, 'kv-st-p3'],
            ],
          );
          stops(H, H.s('linearGradient', { id: ids.tray, x1: 0.15, y1: 0.05, x2: 0.85, y2: 0.95 }, defs), [
            [0, 'kv-st-t0'],
            [0.5, 'kv-st-t1'],
            [1, 'kv-st-t2'],
          ]);
          stops(H, H.s('radialGradient', { id: ids.wall, cx: 0.5, cy: 0.5, r: 0.5 }, defs), [
            [0.86, 'kv-st-w1'],
            [1, 'kv-st-w0'],
          ]);
          stops(H, H.s('radialGradient', { id: ids.foam, cx: 0.44, cy: 0.4, r: 0.62 }, defs), [
            [0, 'kv-st-f0'],
            [1, 'kv-st-f1'],
          ]);

          tray(root, H, ids);
          saucer(root, H, ids);
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.lip, R.saucer, sl.a0, sl.a1), class: 'kv-hit' }, g);
            H.s('path', { d: H.sector(R.slice0, R.slice1, sl.a0, sl.a1, 3), class: 'kv-seg' }, g);
            H.s('path', { d: H.arc(R.slice1 - 3, sl.a0 + 2.5, sl.a1 - 2.5), class: 'kv-seg-gold' }, g);
            const c = H.s('g', { class: 'kv-ink' }, g);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 21,
                subSize: 13.5,
                gap: 2.5,
                maxWidth: 66,
                minSize: 11,
                cls: 'kv-lbl kv-fmt',
                subCls: 'kv-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 14,
                gap: 4,
                maxWidth: 68,
                minSize: 9,
                cls: 'kv-lbl kv-word',
                sub: null,
              });
            }
            // More choices: a gilt arrowhead pointing to the saucer's gold rim.
            H.ringMark(c, sl, m, { r: R.slice1 - 7.5, size: 10.5, cls: 'kv-ring-mark' });
          }
          // Dotted gold lines between the slices.
          let d = '';
          for (const sl of m.slices) {
            const [x0, y0] = polar(R.slice0 + 4, sl.a0);
            const [x1, y1] = polar(R.slice1 - 1, sl.a0);
            d += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d, class: 'kv-div', 'aria-hidden': 'true' }, root);
          band(root, H);
          cup(root, m, H, ids);
        },

        // The handle swings to the slice under the pointer and stays on the chosen one.
        update(root, m, st) {
          const target = st.hover ?? st.selected;
          const goal = target == null ? restAngle(m) : m.slices[target].mid;
          const h = root.querySelector('.kv-handle');
          const prev = h.__angle;
          const next = prev == null ? goal : prev + ((((goal - prev) % 360) + 540) % 360) - 180;
          h.__angle = next;
          if (prev == null) {
            h.style.transition = 'none';
            h.style.transform = `rotate(${f2(next)}deg)`;
            void h.getBoundingClientRect();
            h.style.transition = '';
          } else h.style.transform = `rotate(${f2(next)}deg)`;
        },
      },

      sounds: {
        // The saucer is set down on the copper tray and the cup rattles on it before it settles.
        open: voice({
          name: 'open',
          len: 0.4,
          takes: 3,
          spread: 0.015,
          level: LEVEL.open,
          lp: 7500,
          draw(y, sr, rand) {
            china(y, sr, rand, 0.07, 1150, 0.09, 1, 0.6);
            ring(y, sr, 0.07, 520, 0.15, 0.15);
            ring(y, sr, 0.07, 860, 0.1, 0.1);
            china(y, sr, rand, 0.085, 1600, 0.03, 0.4);
            china(y, sr, rand, 0.1, 1620, 0.025, 0.22);
            china(y, sr, rand, 0.112, 1610, 0.02, 0.1);
          },
        }),
        // The cup turns its handle on the saucer: porcelain touching porcelain, a dry little tk.
        tick: voice({
          name: 'tick',
          len: 0.045,
          takes: 8,
          spread: 0.05,
          level: LEVEL.tick,
          lp: 7500,
          draw(y, sr, rand) {
            china(y, sr, rand, 0.002, 2100 + rand() * 400, 0.012, 0.6, 0.8);
            hiss(y, sr, rand, 0.002, 0.012, 1, (u) => [0.15 * (1 - u), 3000]);
          },
        }),
        // The teaspoon taps the rim: the cup rings clear.
        enter: voice({
          name: 'enter',
          len: 0.25,
          takes: 4,
          spread: 0.03,
          level: LEVEL.enter,
          lp: 7500,
          draw(y, sr, rand) {
            china(y, sr, rand, 0.002, 1480, 0.05, 1, 0.4);
            spoon(y, sr, rand, 0.002, 2600, 0.03, 0.35);
          },
        }),
        // Back out: the spoon laid on the saucer, a lower clink and a small settle.
        leave: voice({
          name: 'leave',
          len: 0.16,
          takes: 4,
          spread: 0.03,
          level: LEVEL.leave,
          lp: 7500,
          draw(y, sr, rand) {
            china(y, sr, rand, 0.002, 1100, 0.03, 0.8, 0.6);
            spoon(y, sr, rand, 0.002, 2300, 0.025, 0.3);
            china(y, sr, rand, 0.03, 1110, 0.02, 0.25);
          },
        }),
        // A stir: coffee swirls round, the spoon clinks twice on the cup, the cup is lifted and set
        // back down, and the foam fizzes under a breath of steam.
        success: voice({
          name: 'success',
          len: 0.9,
          takes: 3,
          spread: 0.015,
          level: LEVEL.success,
          lp: 7500,
          draw(y, sr, rand) {
            hiss(y, sr, rand, 0.002, 0.5, 1.1, (u) => {
              const turn = Math.sin(2 * Math.PI * 2.5 * u);
              return [1 * Math.sin(Math.PI * u) ** 0.7 * (0.7 + 0.3 * turn), 600 + 200 * turn];
            });
            // The coffee sloshes round the cup in small, soft blips.
            for (let k = 0; k < 24; k++) {
              const f = 450 + rand() * 800;
              bubble(y, sr, 0.01 + rand() * 0.45, f, 1 / (0.043 * f + 0.0014 * f ** 1.5), 0.1, 0.12 + rand() * 0.12);
            }
            china(y, sr, rand, 0.06, 1500, 0.1, 0.7);
            spoon(y, sr, rand, 0.06, 2650, 0.04, 0.3);
            china(y, sr, rand, 0.2, 1480, 0.09, 0.6);
            spoon(y, sr, rand, 0.2, 2620, 0.035, 0.25);
            china(y, sr, rand, 0.33, 1200, 0.06, 0.55, 0.7);
            china(y, sr, rand, 0.345, 1210, 0.03, 0.15);
            hiss(y, sr, rand, 0.12, 0.62, 0.7, (u) => [0.5 * Math.min(1, u * 4) * (1 - u) ** 2, 2800 + 600 * u]);
            foam(y, sr, rand, 0.02, 0.5, 120, 0.15);
          },
        }),
      },
    });
  })();
}
