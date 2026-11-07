// SPDX-License-Identifier: MIT
// Hologram: the wheel as a projected HUD. Segmented iridescent rings, chamfered cells, scanlines
// and a projector glow below; by day it is a pearly holographic film with ink lines. Hover
// brackets a cell with a colour-split ghost of its label; applying it makes the cell glitch apart
// in strips and rebuild under a scan line.
export default function register(Board) {
  (function () {
    'use strict';

    const ID = 'hologram';
    const f2 = (n) => Math.round(n * 100) / 100;
    const reducedMotion = () => document.documentElement.classList.contains('reduce-motion');

    if (typeof document !== 'undefined' && document.fonts) {
      for (const f of ["500 16px 'Oxanium'", "600 16px 'Oxanium'", "700 16px 'Oxanium'"])
        document.fonts.load(f, 'AaĞşı').catch(() => null);
    }

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

    // The width a label may take at radius r: the slice's chord there, less a margin, within a cap.
    function roomAt(sl, r, margin, cap) {
      const half = Math.min(sl.step / 2, 70);
      return Math.max(40, Math.min(cap, 2 * r * Math.sin((half * Math.PI) / 180) - margin));
    }

    // Radii in the 400 x 400 view box.
    const R = {
      disc: 188,
      ringOut: 186,
      ringIn: 180,
      ticks: 194,
      cellOut: 175,
      cellIn: 74,
      hubRing: 66,
      hub: 60,
      lbl: 126,
    };
    const pt = (p) => `${f2(p[0])} ${f2(p[1])}`;

    // A cell: the slice between two radii with its four corners cut off.
    function cell(H, sl, r0, r1, gap, cut) {
      const g0 = ((gap / 2 / r0) * 180) / Math.PI,
        g1 = ((gap / 2 / r1) * 180) / Math.PI;
      const c0 = ((cut / r0) * 180) / Math.PI,
        c1 = ((cut / r1) * 180) / Math.PI;
      const a = sl.a0,
        b = sl.a1;
      const P = [
        H.polar(r1 - cut, a + g1),
        H.polar(r1, a + g1 + c1),
        H.polar(r1, b - g1 - c1),
        H.polar(r1 - cut, b - g1),
        H.polar(r0 + cut, b - g0),
        H.polar(r0, b - g0 - c0),
        H.polar(r0, a + g0 + c0),
        H.polar(r0 + cut, a + g0),
      ];
      return `M${pt(P[0])}L${pt(P[1])}A${r1} ${r1} 0 0 1 ${pt(P[2])}L${pt(P[3])}L${pt(P[4])}L${pt(P[5])}A${r0} ${r0} 0 0 0 ${pt(P[6])}L${pt(P[7])}Z`;
    }

    // Corner brackets just outside a cell.
    function brackets(H, sl, r0, r1, gap, len) {
      const g0 = ((gap / 2 / r0) * 180) / Math.PI,
        g1 = ((gap / 2 / r1) * 180) / Math.PI;
      const l0 = ((len / r0) * 180) / Math.PI,
        l1 = ((len / r1) * 180) / Math.PI;
      const a = sl.a0,
        b = sl.a1;
      const corner = (r, ang, dirA, dr, la) => {
        const p = H.polar(r, ang);
        return `M${pt(H.polar(r, ang + dirA * la))}L${pt(p)}L${pt(H.polar(r + dr * len, ang))}`;
      };
      return (
        corner(r1, a + g1, 1, -1, l1) +
        corner(r1, b - g1, -1, -1, l1) +
        corner(r0, b - g0, -1, 1, l0) +
        corner(r0, a + g0, 1, 1, l0)
      );
    }

    // Sounds: a projection's blips, glitches and shimmer, drawn sample by sample at the context's rate
    // into one stereo buffer per sound, so a tick costs two nodes however fast the pointer sweeps and
    // every call can differ a little; the opening and the applying sound alike each time, so they are
    // drawn once per rate and kept (`keep`). Each buffer starts and ends at zero and its gain opens
    // from silence, so nothing clicks.
    function play(ac, out, t, dur, level, keep, draw) {
      const sr = ac.sampleRate;
      let buf = keep && keep.get(sr);
      if (!buf) {
        random = keep ? seeded(7) : Math.random;
        const n = Math.ceil(dur * sr);
        buf = ac.createBuffer(2, n, sr);
        const ch = [buf.getChannelData(0), buf.getChannelData(1)];
        draw(ch, sr);
        const fade = Math.min(n, Math.round(sr * 0.004));
        for (const d of ch) for (let i = 1; i <= fade; i++) d[n - i] *= (i - 1) / fade;
        random = Math.random;
        if (keep) keep.set(sr, buf);
      }
      const src = ac.createBufferSource();
      const g = ac.createGain();
      src.buffer = buf;
      g.gain.value = 0;
      g.gain.setValueAtTime(0, Math.max(0, t - 0.004));
      g.gain.linearRampToValueAtTime(level, t);
      src.connect(g).connect(out);
      src.start(t);
      src.stop(t + dur + 0.02);
    }
    // Chance: Math.random for the sounds that vary, a fixed sequence while a kept sound is drawn, so
    // the opening and the applying sound the same in every session.
    let random = Math.random;
    function seeded(seed) {
      return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    }
    // A sine table read by phase in turns: several times cheaper than Math.sin, and as clean.
    const SINE = Float32Array.from({ length: 4097 }, (v, i) => Math.sin((2 * Math.PI * i) / 4096));
    const sine = (p) => {
      const x = (p - Math.floor(p)) * 4096;
      const i = x | 0;
      return SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i);
    };
    // Runs fn(i, s, u, end) over len seconds from at, inside the buffer: the sample, seconds in, 0..1
    // progress and a fade over the last fifth.
    function span(ch, sr, at, len, fn) {
      const i0 = Math.round(at * sr);
      const m = Math.min(Math.round(len * sr), ch[0].length - i0);
      for (let i = 0; i < m; i++) fn(i0 + i, i / sr, i / m, Math.min(1, (m - i) / (0.2 * m)));
    }
    // Adds v to the stereo buffer at sample i, placed by pan (-1 left to 1 right).
    function put(ch, i, v, pan) {
      ch[0][i] += v * Math.min(1, 1 - pan);
      ch[1][i] += v * Math.min(1, 1 + pan);
    }
    // The mirage's notes: a whole-tone scale on C, with no home note to settle on.
    const WHOLE = [261.63, 293.66, 329.63, 369.99, 415.3, 466.16];
    const note = (k) => WHOLE[((k % 6) + 6) % 6] * 2 ** Math.floor(k / 6);
    // A projected blip: a sine phase-modulated at twice its pitch, bright for an instant and then clean.
    function blip(ch, sr, at, f, { len = 0.03, index = 1.2, gain = 1, pan = 0 }) {
      span(ch, sr, at, len, (i, s, u, end) => {
        const p = f * s;
        const e = Math.min(1, s / 0.001) * Math.exp(-s / (len * 0.3)) * end;
        put(ch, i, gain * e * sine(p + (index / 6.283) * Math.exp(-s / 0.006) * sine(2 * p)), pan);
      });
    }
    // A torn strip of the picture: a buzzy burst whose samples are held and coarsely stepped like a
    // dropped frame, then smoothed below the shrill top.
    function glitch(ch, sr, at, f, { len = 0.022, gain = 1, pan = 0 }) {
      let a = 0;
      let b = 0;
      let x1 = 0;
      let y1 = 0;
      const g = Math.tan((Math.PI * 6000) / sr);
      const pole = 1 - (2 * Math.PI * 150) / sr;
      const hold = Math.max(1, Math.round(sr / 5500));
      let held = 0;
      let k = 0;
      span(ch, sr, at, len, (i, s, u, end) => {
        if (k++ % hold === 0) held = Math.round(4 * sine(f * s + (3 / 6.283) * sine(1.5 * f * s))) / 4;
        // A state-variable low-pass at 6 kHz takes the hard edges off the steps, and a one-pole
        // high-pass at 150 Hz the thump a lopsided burst would leave.
        const v1 = (a + g * (held - b)) / (1 + g * (g + 1.4));
        const v2 = b + g * v1;
        a = 2 * v1 - a;
        b = 2 * v2 - b;
        y1 = v2 - x1 + pole * y1;
        x1 = v2;
        put(ch, i, gain * Math.min(1, s / 0.001) * end * y1, pan);
      });
    }
    // The projection's shimmer: notes split into a cyan and a pink copy, a hair apart in pitch and set
    // left and right, flickering a little like a picture made of light.
    function shimmer(ch, sr, at, len, notes, { gain = 1, rise = 0.01, dip = null }) {
      let flick = 1;
      let aim = 1;
      let k = 0;
      const step = Math.round(sr / 45);
      span(ch, sr, at, len, (i, s, u, end) => {
        if (k++ % step === 0) aim = 0.8 + 0.2 * random();
        flick += (aim - flick) * 0.004;
        let e = gain * Math.min(1, s / rise) * Math.exp(-s / (len * 0.35)) * end * flick;
        if (dip && s > dip[0] && s < dip[1]) e *= 1 - 0.4 * Math.sin((Math.PI * (s - dip[0])) / (dip[1] - dip[0]));
        let l = 0;
        let r = 0;
        for (const f of notes) {
          l += sine(f * 0.9977 * s);
          r += sine(f * 1.0023 * s);
        }
        ch[0][i] += e * l;
        ch[1][i] += e * r;
      });
    }
    const KEPT = { open: new Map(), success: new Map() };

    Board.define({
      id: ID,
      fonts: {
        brand: "'Oxanium'",
        load: ["'Oxanium'"],
        credits: [{ family: 'Oxanium', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 170, close: 110, stagger: 10, apply: 640 },

      palette: {
        light: {
          bg: '#eef1f5',
          surface: '#ffffff',
          'surface-2': '#f4f6f9',
          border: '#d6dce6',
          'border-strong': '#a3aebf',
          text: '#0f1830',
          'text-muted': '#4f5b72',
          accent: '#0b6b86',
          'on-accent': '#ffffff',
          focus: '#0b6b86',
          success: '#127a4f',
          'on-success': '#ffffff',
          'success-text': '#0f6a44',
          warning: '#a86b0c',
          'warning-text': '#714605',
          danger: '#bd2f5a',
          desk: 'linear-gradient(160deg, #eef2f7 0%, #dce3ec 100%)',
          'wheel-face': '#f4f7fb',
          'wheel-slice': '#f2f5fa',
          'wheel-slice-hover': '#e2f3f8',
          'wheel-slice-selected': '#d5eff5',
          'face-a': 'rgba(255, 255, 255, 0.92)',
          'face-b': 'rgba(232, 238, 248, 0.92)',
          'ir-1': '#0aa2c2',
          'ir-2': '#3f7fe0',
          'ir-3': '#d8418f',
          'ir-4': '#6f9e12',
          'sheen-1': 'rgba(90, 220, 240, 0.32)',
          'sheen-2': 'rgba(255, 140, 210, 0.28)',
          'sheen-3': 'rgba(190, 240, 120, 0.3)',
          cell: 'rgba(255, 255, 255, 0.55)',
          'cell-hover': 'rgba(150, 225, 240, 0.35)',
          'cell-sel': 'rgba(120, 215, 235, 0.45)',
          'cell-line': 'rgba(13, 80, 105, 0.55)',
          bracket: '#0b6b86',
          'bracket-sel': '#c2337d',
          'wheel-text': '#0f1830',
          'wheel-sub': '#2d4561',
          'wheel-text-selected': '#062b38',
          'wheel-sub-selected': '#1c4152',
          'ghost-c': 'rgba(0, 170, 210, 0.55)',
          'ghost-m': 'rgba(220, 40, 140, 0.45)',
          'wheel-line': '#0d5b73',
          scan: 'rgba(20, 70, 100, 0.06)',
          'scan-bright': 'rgba(10, 150, 190, 0.85)',
          'wheel-shadow': 'rgba(30, 50, 80, 0.25)',
          beam: 'rgba(80, 200, 230, 0.16)',
          'beam-0': 'rgba(80, 200, 230, 0)',
          'text-glow': 'none',
          'hub-fill': 'rgba(255, 255, 255, 0.85)',
          'split-blend': 'multiply',
        },
        dark: {
          bg: '#070b14',
          surface: '#0d1322',
          'surface-2': '#131b2e',
          border: '#22304a',
          'border-strong': '#3c5276',
          text: '#e8f6ff',
          'text-muted': '#94a8c1',
          accent: '#6ef3ff',
          'on-accent': '#03141a',
          focus: '#6ef3ff',
          success: '#6cf0b0',
          'on-success': '#04190f',
          'success-text': '#7ff3bd',
          warning: '#ffcf6a',
          'warning-text': '#ffd885',
          danger: '#ff7bb0',
          desk: 'radial-gradient(110% 80% at 50% 105%, #12304a 0%, #08111f 55%, #04070d 100%)',
          'wheel-face': '#0a1626',
          'wheel-slice': '#0a1828',
          'wheel-slice-hover': '#0f2a3d',
          'wheel-slice-selected': '#123a4e',
          'face-a': 'rgba(40, 150, 200, 0.1)',
          'face-b': 'rgba(20, 60, 110, 0.22)',
          'ir-1': '#5ef2ff',
          'ir-2': '#8fb6ff',
          'ir-3': '#ff7bd5',
          'ir-4': '#d4ff7a',
          'sheen-1': 'rgba(94, 242, 255, 0.07)',
          'sheen-2': 'rgba(255, 123, 213, 0.06)',
          'sheen-3': 'rgba(198, 255, 122, 0.05)',
          cell: 'rgba(60, 200, 255, 0.045)',
          'cell-hover': 'rgba(80, 220, 255, 0.13)',
          'cell-sel': 'rgba(90, 230, 255, 0.2)',
          'cell-line': 'rgba(110, 243, 255, 0.45)',
          bracket: '#6ef3ff',
          'bracket-sel': '#ff7bd5',
          'wheel-text': '#e9fdff',
          'wheel-sub': '#a9dbe8',
          'wheel-text-selected': '#ffffff',
          'wheel-sub-selected': '#d4f6ff',
          'ghost-c': 'rgba(94, 242, 255, 0.6)',
          'ghost-m': 'rgba(255, 90, 200, 0.55)',
          'wheel-line': '#6ef3ff',
          scan: 'rgba(120, 230, 255, 0.06)',
          'scan-bright': 'rgba(200, 255, 255, 0.95)',
          'wheel-shadow': 'rgba(0, 0, 0, 0.5)',
          beam: 'rgba(90, 220, 255, 0.14)',
          'beam-0': 'rgba(90, 220, 255, 0)',
          'text-glow': 'url(#hologram-glow)',
          'hub-fill': 'rgba(8, 20, 36, 0.85)',
          'split-blend': 'screen',
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
        ['wheel-sub', 'wheel-slice', 'text'],
        ['wheel-sub', 'wheel-slice-hover', 'text'],
        ['wheel-sub-selected', 'wheel-slice-selected', 'text'],
        ['wheel-line', 'wheel-face', 'ui'],
        ['bracket', 'wheel-face', 'ui'],
        ['bracket-sel', 'wheel-face', 'ui'],
      ],

      // A soft glow for projected lettering, and the two tints of the colour-split ghosts.
      defs: `<filter id="hologram-glow" x="-15%" y="-30%" width="130%" height="160%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b"/>
        <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.75 0" result="g"/>
        <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="hologram-cyan" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0.3  0 0.6 0.4 0 0.3  0 0.4 0.6 0 0.35  0 0 0 0.6 0"/></filter>
      <filter id="hologram-pink" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.6 0.4 0 0 0.35  0 0 0 0 0.05  0.3 0 0.5 0 0.25  0 0 0 0.55 0"/></filter>`,

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const s = H.s;
          const uid = H.uid(ID);
          const defs = s('defs', {}, root);
          const grad = (id, tag, attrs, stops) => {
            const gr = s(tag, Object.assign({ id: uid + id }, attrs), defs);
            for (const [o, cls] of stops) s('stop', { offset: o, class: cls }, gr);
            return gr;
          };
          grad('-ir', 'linearGradient', { x1: 0, y1: 0, x2: 1, y2: 1 }, [
            [0, 'hg-i1'],
            [0.3, 'hg-i4'],
            [0.62, 'hg-i3'],
            [0.85, 'hg-i2'],
            [1, 'hg-i1'],
          ]);
          grad('-face', 'radialGradient', { cx: 0.5, cy: 0.45, r: 0.55 }, [
            [0, 'hg-fa'],
            [1, 'hg-fb'],
          ]);
          grad('-sheen', 'linearGradient', { x1: 0, y1: 0.1, x2: 1, y2: 0.9 }, [
            [0.1, 'hg-s1'],
            [0.45, 'hg-s2'],
            [0.8, 'hg-s3'],
          ]);
          grad('-beam', 'linearGradient', { x1: 0, y1: 1, x2: 0, y2: 0 }, [
            [0, 'hg-beam'],
            [1, 'hg-beam0'],
          ]);
          const scanPat = s(
            'pattern',
            { id: uid + '-scan', width: 4, height: 3.2, patternUnits: 'userSpaceOnUse' },
            defs,
          );
          s('rect', { x: 0, y: 0, width: 4, height: 1.1, class: 'hg-scanline' }, scanPat);

          // Projector: a glow on the desk below and a faint cone up into the disc.
          const proj = s('g', { class: 'hg-proj', 'aria-hidden': 'true' }, root);
          s(
            'path',
            { d: `M${C - 150} ${C + 60}L${C - 46} 398L${C + 46} 398L${C + 150} ${C + 60}Z`, fill: `url(#${uid}-beam)` },
            proj,
          );
          s('ellipse', { cx: C, cy: 398, rx: 64, ry: 5, class: 'hg-emitter' }, proj);

          // Disc: pearly film or projected glass, the sheen, scanlines, rings and ticks.
          const disc = s('g', { class: 'hg-disc', 'aria-hidden': 'true' }, root);
          s('circle', { cx: C, cy: C, r: R.disc, fill: `url(#${uid}-face)` }, disc);
          s('circle', { cx: C, cy: C, r: R.disc, fill: `url(#${uid}-sheen)` }, disc);
          s('circle', { cx: C, cy: C, r: R.disc, fill: `url(#${uid}-scan)` }, disc);
          let segs = '';
          const N = 24;
          for (let k = 0; k < N; k++) {
            const a0 = (k * 360) / N + 1.4,
              a1 = ((k + 1) * 360) / N - 1.4;
            const r = k % 3 === 0 ? R.ringOut : R.ringOut - 1.5;
            segs += H.arc(r, a0, a1);
          }
          s('path', { d: segs, class: 'hg-ring', stroke: `url(#${uid}-ir)` }, disc);
          s('path', { d: H.arc(R.ringIn, 0, 359.9), class: 'hg-ring-thin', stroke: `url(#${uid}-ir)` }, disc);
          let ticks = '';
          for (let a = 0; a < 360; a += 5) {
            const long = a % 45 === 0;
            ticks += `M${pt(H.polar(R.ticks - (long ? 5 : 2.5), a))}L${pt(H.polar(R.ticks, a))}`;
          }
          s('path', { d: ticks, class: 'hg-ticks', stroke: `url(#${uid}-ir)` }, disc);
          // A few short readout bars in the tick ring, our own HUD dressing.
          let bars = '';
          for (let k = 0; k < 6; k++) {
            const a = 200 + k * 4.2;
            const len = 3 + ((k * 7) % 5) * 1.6;
            bars += `M${pt(H.polar(R.ticks + 3, a))}L${pt(H.polar(R.ticks + 3 + len, a))}`;
          }
          s('path', { d: bars, class: 'hg-bars' }, disc);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            s('path', { d: H.sector(R.hubRing, R.ringIn, sl.a0, sl.a1), class: 'hg-hit' }, g);
            const vis = s('g', { class: 'hg-vis' }, g);
            const shape = cell(H, sl, R.cellIn, R.cellOut, 6, 7);
            s('path', { d: shape, class: 'hg-cell' }, vis);
            s('path', { d: shape, class: 'hg-cell-line' }, vis);
            s('path', { d: brackets(H, sl, R.cellIn - 3, R.cellOut + 3, 6, 9), class: 'hg-br' }, vis);
            // Ghosts behind the label for the colour split, then the label itself.
            const ink = s('g', { class: 'hg-ink' }, vis);
            const room = roomAt(sl, R.lbl, 22, 128);
            if (sl.format) {
              H.block(ink, sl, R.lbl, {
                size: 22,
                subSize: 12,
                gap: 2,
                maxWidth: room,
                minSize: 10,
                cls: 'hg-lbl hg-fmt',
                subCls: 'hg-sub',
              });
            } else {
              H.block(ink, sl, R.lbl, {
                icon: true,
                iconSize: 23,
                size: 13.5,
                gap: 4,
                maxWidth: room + 2,
                minSize: 9,
                cls: 'hg-lbl hg-word',
                sub: null,
              });
            }
            const gc = ink.cloneNode(true);
            gc.setAttribute('class', 'hg-ghost hg-ghost-c');
            const gm = ink.cloneNode(true);
            gm.setAttribute('class', 'hg-ghost hg-ghost-m');
            vis.insertBefore(gm, ink);
            vis.insertBefore(gc, gm);
            // A small lock marker at the outer edge, lit once the slice is applied.
            const [mx, my] = H.polar(R.cellOut - 8, sl.mid);
            s(
              'path',
              {
                d: `M${f2(mx)} ${f2(my - 3.6)}L${f2(mx + 3.6)} ${f2(my)}L${f2(mx)} ${f2(my + 3.6)}L${f2(mx - 3.6)} ${f2(my)}Z`,
                class: 'hg-lock',
              },
              vis,
            );
            // More choices: a thin chevron near the outer edge of the cell, pointing out.
            H.ringMark(vis, sl, m, { r: R.cellOut - 6.5, size: 9, shape: 'chevron', cls: 'hg-ring-mark' });
          }

          // Hub: a dashed ring, a thin ring, the name, the file and the key.
          const hub = s('g', { class: 'hg-hub' }, root);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'hg-hub-fill' }, hub);
          s('circle', { cx: C, cy: C, r: R.hubRing, class: 'hg-hub-dash', stroke: `url(#${uid}-ir)` }, hub);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'hg-hub-ring' }, hub);
          const ht = s('g', { class: 'hg-hub-ink' }, hub);
          const dy = m.key ? 0 : 8;
          H.label(ht, C, C - 15 + dy, m.title, { maxWidth: 98, size: 16, minSize: 10, cls: 'hg-title', maxLines: 1 });
          H.label(ht, C, C + 4 + dy, m.file, { maxWidth: 92, size: 11.5, minSize: 8.5, cls: 'hg-file', maxLines: 1 });
          if (!m.key) return;
          const kt = H.text(ht, C, C + 25, m.key.toUpperCase(), { class: 'hg-keytext' });
          const kw = kt.getComputedTextLength() + 16;
          const ky = C + 17.5;
          s(
            'path',
            {
              d: `M${f2(C - kw / 2 + 4)} ${ky}H${f2(C + kw / 2)}V${ky + 11}L${f2(C + kw / 2 - 4)} ${ky + 15}H${f2(C - kw / 2)}V${ky + 4}Z`,
              class: 'hg-key',
            },
            hub,
          );
        },

        onOpen(root) {
          const wheel = root.closest('.wheel');
          if (wheel && wheel.hgStop) wheel.hgStop();
        },

        // The glitch: copies of the cell cut into strips jump sideways while the cell itself is
        // hidden, then everything snaps back under a scan line. CSS runs the motion; this only builds
        // the strips for the chosen slice and removes them afterwards.
        onSelect(root, m, i, H, t) {
          const wheel = root.closest('.wheel');
          if (wheel.hgStop) wheel.hgStop();
          if (t == null && reducedMotion()) return;
          const g = root.querySelector(`.slice[data-slice="${i}"]`);
          const vis = g && g.querySelector('.hg-vis');
          if (!vis) return;
          const bb = vis.getBBox();
          const s = H.s;
          const rand = rng(97 + i * 131);
          const layer = s('g', { class: 'hg-glitch', 'aria-hidden': 'true' }, root);
          const defs = s('defs', {}, layer);
          const tear = s('g', { class: 'hg-tear' }, layer);
          const copy = () => {
            const c = vis.cloneNode(true);
            c.setAttribute('class', 'hg-vis hg-copy');
            return c;
          };
          // Ghost copies, tinted and offset.
          for (const tint of ['cyan', 'pink']) {
            const gg = s('g', { class: `hg-split hg-split-${tint}` }, tear);
            gg.appendChild(copy());
          }
          // Strips of uneven height.
          const n = 7;
          let y = bb.y - 4;
          const h = (bb.height + 8) / n;
          for (let k = 0; k < n; k++) {
            const hh = h * (0.7 + rand() * 0.6);
            const id = H.uid('hologram-strip');
            s(
              'rect',
              {
                x: f2(bb.x - 30),
                y: f2(y),
                width: f2(bb.width + 60),
                height: f2(k === n - 1 ? bb.y + bb.height + 8 - y : hh),
              },
              s('clipPath', { id }, defs),
            );
            const strip = s('g', { class: 'hg-strip', 'clip-path': `url(#${id})` }, tear);
            const inner = s('g', { class: 'hg-strip-move' }, strip);
            inner.style.setProperty('--gx', f2((rand() < 0.5 ? -1 : 1) * (12 + rand() * 30)) + 'px');
            inner.style.setProperty('--gx2', f2((rand() < 0.5 ? -1 : 1) * (6 + rand() * 20)) + 'px');
            inner.style.setProperty('--gy', f2((rand() - 0.5) * 3) + 'px');
            inner.appendChild(copy());
            y += hh;
          }
          // The rebuild scan line.
          s(
            'rect',
            { x: f2(bb.x - 6), y: f2(bb.y), width: f2(bb.width + 12), height: 2.2, class: 'hg-scanbar' },
            layer,
          ).style.setProperty('--h', f2(bb.height) + 'px');
          const stop = () => {
            clearTimeout(wheel.hgTimer);
            layer.remove();
            wheel.hgStop = null;
          };
          if (t != null) return;
          wheel.hgStop = stop;
          wheel.hgTimer = setTimeout(stop, 700);
        },
      },

      sounds: {
        // The projection flickers on: a crackle of the projector, a rising power-up that dims once and
        // steadies, then the picture's shimmer.
        open(ac, out, t) {
          play(ac, out, t, 0.55, 0.014, KEPT.open, (ch, sr) => {
            glitch(ch, sr, 0, note(9), { len: 0.014, gain: 1.6 });
            let p = 0;
            span(ch, sr, 0, 0.2, (i, s, u, end) => {
              p += (260 * 4 ** Math.min(1, s / 0.12)) / sr;
              // On over 60 ms, a dip to half at 85 ms, steady from 120 ms, as the picture does.
              const on =
                s < 0.06
                  ? (s / 0.06) * 0.8
                  : s < 0.085
                    ? 0.8 - 14 * (s - 0.06)
                    : Math.min(1, 0.45 + 15.7 * (s - 0.085));
              put(ch, i, on * end * sine(p + 0.15 * sine(2 * p)), 0);
            });
            shimmer(ch, sr, 0.1, 0.45, [note(12), note(14), note(16)], { gain: 0.35, rise: 0.03 });
          });
        },
        // The brackets lock on: a soft blip and its colour-split ghost a moment later in the other ear.
        tick(ac, out, t) {
          const f = note(12 + Math.floor(random() * 6));
          const side = random() < 0.5 ? -0.3 : 0.3;
          play(ac, out, t, 0.05, 0.017, null, (ch, sr) => {
            blip(ch, sr, 0, f, { len: 0.018, index: 1.6, pan: side });
            blip(ch, sr, 0.011, f * 1.006, { len: 0.018, index: 1.6, gain: 0.45, pan: -side });
          });
        },
        // Into a ring: three blips stepping up the whole-tone scale, each with a grain of static.
        enter(ac, out, t) {
          play(ac, out, t, 0.14, 0.0095, null, (ch, sr) =>
            [14, 16, 18].forEach((k, j) => {
              blip(ch, sr, j * 0.045, note(k), { len: 0.035, gain: 0.8 + j * 0.1, pan: -0.2 + j * 0.2 });
              glitch(ch, sr, j * 0.045, note(k - 6), { len: 0.01, gain: 0.15 });
            }),
          );
        },
        // Back out: three blips stepping down.
        leave(ac, out, t) {
          play(ac, out, t, 0.14, 0.0097, null, (ch, sr) =>
            [16, 14, 12].forEach((k, j) => {
              blip(ch, sr, j * 0.045, note(k), { len: 0.035, gain: 1 - j * 0.15, pan: 0.2 - j * 0.2 });
              glitch(ch, sr, j * 0.045, note(k - 6), { len: 0.01, gain: 0.12 });
            }),
          );
        },
        // The cell tears apart: a stutter of crushed glitches, one for each jump of the strips, then a
        // rising tone rides the scan line down and the rebuilt picture shimmers in, flickering once.
        success(ac, out, t) {
          play(ac, out, t, 1.12, 0.043, KEPT.success, (ch, sr) => {
            [0, 0.034, 0.084, 0.134, 0.193, 0.252, 0.319, 0.378].forEach((when, k) =>
              glitch(ch, sr, when, note(6 + Math.floor(random() * 13)), {
                len: 0.016 + 0.012 * random(),
                gain: 1 - k * 0.06,
                pan: k % 2 ? 0.5 : -0.5,
              }),
            );
            let p = 0;
            span(ch, sr, 0.397, 0.19, (i, s, u) => {
              p += (700 * 3 ** u) / sr;
              put(ch, i, 0.25 * Math.sin(Math.PI * u) ** 2 * sine(p), 0);
            });
            shimmer(ch, sr, 0.41, 0.7, [note(12), note(14), note(16), note(18)], {
              gain: 0.3,
              rise: 0.008,
              dip: [0.038, 0.064],
            });
          });
        },
      },
    });
  })();
}
