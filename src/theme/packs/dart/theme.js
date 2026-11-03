// SPDX-License-Identifier: MIT
// Dart tahtası: a dartboard of our own design. Eight sectors alternate chalk and navy sisal, each
// with a teal or coral treble and double segment, under a silver wire spider; the bullseye is the
// hub and the outer ring carries a chevron for each sector instead of numbers. Applying a slice
// throws a dart into its double ring: it lands with a thud, the board jolts and the dart wobbles still.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const f2 = (n) => Math.round(n * 100) / 100;
    const R = { rim: 197, ring: 181, d1: 180, d0: 170, t1: 82, t0: 70, bullOut: 69, bull: 58, lbl: 126, tip: 175 };
    const polar = (r, a) => [C + r * Math.sin((a * Math.PI) / 180), C - r * Math.cos((a * Math.PI) / 180)];

    // Our dart, drawn pointing up from its tip at (0, 0), foreshortened as if it leans toward you.
    function dart(parent, H) {
      const fly = H.s('g', { class: 'dt-fly' }, parent);
      const wob = H.s('g', { class: 'dt-wob' }, fly);
      H.s('path', { d: 'M0 0L-1.1-9.5H1.1Z', class: 'dt-point' }, wob);
      H.s('path', { d: 'M-2.6-9.5H2.6L3.3-12.5V-24.5L2.2-27H-2.2L-3.3-24.5V-12.5Z', class: 'dt-barrel' }, wob);
      H.s('path', { d: 'M-3.3-15H3.3M-3.3-18H3.3M-3.3-21H3.3', class: 'dt-knurl' }, wob);
      H.s('path', { d: 'M-1.2-27H1.2V-36H-1.2Z', class: 'dt-shaft' }, wob);
      H.s('path', { d: 'M0-31L-9.5-41.5L-8-46L0-39.5Z', class: 'dt-flight-a' }, wob);
      H.s('path', { d: 'M0-31L9.5-41.5L8-46L0-39.5Z', class: 'dt-flight-b' }, wob);
      H.s('path', { d: 'M-1.4-33.4L0-48L1.4-33.4Z', class: 'dt-flight-c' }, wob);
      return fly;
    }

    function hub(root, m, H) {
      const g = H.s('g', { class: 'dt-hub' }, root);
      H.s('circle', { cx: C, cy: C, r: R.bullOut, class: 'dt-bull-out' }, g);
      H.s('circle', { cx: C, cy: C, r: R.bull, class: 'dt-bull' }, g);
      H.s('circle', { cx: C, cy: C, r: R.bull - 3.5, class: 'dt-bull-ring' }, g);
      H.s('circle', { cx: C, cy: C, r: R.bullOut, class: 'dt-wire-c' }, g);
      H.s('circle', { cx: C, cy: C, r: R.bull, class: 'dt-wire-c' }, g);
      // Without a key the title and file sit lower, in the middle of the bull.
      const dy = m.key ? 0 : 8;
      H.label(g, C, C - 14 + dy, m.title, { maxWidth: 84, size: 19, minSize: 12, maxLines: 1, cls: 'dt-title' });
      H.label(g, C, C + 4 + dy, m.file, { maxWidth: 76, size: 12, minSize: 9, maxLines: 1, cls: 'dt-file' });
      if (!m.key) return;
      const kw = 14 + m.key.length * 6.2;
      H.s('rect', { x: f2(C - kw / 2), y: C + 14, width: f2(kw), height: 16, rx: 3, class: 'dt-key' }, g);
      H.text(g, C, C + 22.4, m.key, { class: 'dt-keytext' });
    }

    Board.define({
      id: 'dart',
      fonts: {
        brand: "'Barlow Condensed'",
        load: ["'Barlow Condensed'"],
        credits: [{ family: 'Barlow Condensed', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 160, close: 110, stagger: 9, apply: 640 },
      palette: {
        light: {
          bg: '#f1f2f4',
          surface: '#ffffff',
          'surface-2': '#eef0f3',
          border: '#d6dae1',
          'border-strong': '#9aa3b1',
          text: '#161c2a',
          'text-muted': '#525c6e',
          accent: '#c93a2a',
          'on-accent': '#ffffff',
          focus: '#1f6f8b',
          success: '#1d7f5f',
          'on-success': '#ffffff',
          'success-text': '#18694f',
          warning: '#c98a12',
          'warning-text': '#875800',
          danger: '#c0392b',
          desk: 'linear-gradient(170deg, #eaeef3 0%, #d2d9e2 100%)',
          'wheel-face': '#141c2e',
          'wheel-slice': '#f0ebdf',
          'wheel-slice-hover': '#fde7b0',
          'wheel-slice-selected': '#f5c33b',
          'wheel-text': '#18223a',
          'wheel-text-selected': '#18223a',
          'wheel-line': '#bcc4cf',
          'wheel-shadow': 'rgba(20, 28, 46, 0.34)',
          'dt-sub': '#8a2f22',
          'dt-sub-selected': '#5a1e14',
          'dt-alt': '#1f2b45',
          'dt-alt-hover': '#30436e',
          'dt-text-alt': '#f4efe4',
          'dt-sub-alt': '#ffb8a8',
          'dt-red': '#d6402f',
          'dt-green': '#14857a',
          'dt-third': '#3d5573',
          'dt-third-hover': '#4a6488',
          'dt-sub-third': '#ffd8cf',
          'dt-chalk': '#e8e1d1',
          'dt-red-sel': '#ffdf7e',
          'dt-green-sel': '#ffdf7e',
          'dt-wire-hi': '#ffffff',
          'dt-ring': '#141c2e',
          'dt-chevron': '#e6eaf0',
          'dt-bull-out': '#14857a',
          'dt-bull': '#141c2e',
          'dt-bull-ring': '#d6402f',
          'dt-title': '#ffffff',
          'dt-file': '#bcc6d8',
          'dt-key': '#2b3652',
          'dt-keytext': '#e6ebf3',
          'dt-steel': '#c7ccd4',
          'dt-steel-dark': '#6b7484',
          'dt-flight': '#d6402f',
          'dt-flight-2': '#a52a1d',
          'dt-shaft': '#1b2233',
          'dt-spot-opacity': '0',
          'dt-sisal-opacity': '1',
        },
        dark: {
          bg: '#0d0f14',
          surface: '#151922',
          'surface-2': '#1c212c',
          border: '#2a303d',
          'border-strong': '#4a5366',
          text: '#eef1f6',
          'text-muted': '#a3abba',
          accent: '#ff6b57',
          'on-accent': '#2a0d07',
          focus: '#ffd166',
          success: '#4cc99a',
          'on-success': '#04261a',
          'success-text': '#6dd8ae',
          warning: '#f2c14e',
          'warning-text': '#f6d37d',
          danger: '#ff7066',
          desk: 'radial-gradient(56% 56% at 50% 46%, #333a4a 0%, #191d26 50%, #0a0b0f 100%)',
          'wheel-face': '#07090e',
          'wheel-slice': '#e4ddcd',
          'wheel-slice-hover': '#ffe9a8',
          'wheel-slice-selected': '#ffd166',
          'wheel-text': '#131a2c',
          'wheel-text-selected': '#131a2c',
          'wheel-line': '#dfe5ee',
          'wheel-shadow': 'rgba(0, 0, 0, 0.7)',
          'dt-sub': '#8a2c1e',
          'dt-sub-selected': '#5a1e14',
          'dt-alt': '#121a2d',
          'dt-alt-hover': '#24345c',
          'dt-text-alt': '#f2ece0',
          'dt-sub-alt': '#ff9d88',
          'dt-red': '#ff5a45',
          'dt-green': '#1fb5a3',
          'dt-third': '#28405e',
          'dt-third-hover': '#35537a',
          'dt-sub-third': '#ffc4b5',
          'dt-chalk': '#d9d1bf',
          'dt-red-sel': '#ffe08a',
          'dt-green-sel': '#ffe08a',
          'dt-wire-hi': '#ffffff',
          'dt-ring': '#07090e',
          'dt-chevron': '#ffd166',
          'dt-bull-out': '#1fb5a3',
          'dt-bull': '#07090e',
          'dt-bull-ring': '#ff5a45',
          'dt-title': '#ffffff',
          'dt-file': '#aeb9cf',
          'dt-key': '#212a40',
          'dt-keytext': '#e6ebf3',
          'dt-steel': '#dfe4ea',
          'dt-steel-dark': '#7c8596',
          'dt-flight': '#ffd166',
          'dt-flight-2': '#d9a52c',
          'dt-shaft': '#0d121e',
          'dt-spot-opacity': '0.55',
          'dt-sisal-opacity': '1',
        },
      },
      contrast: Board.DEFAULT_PAIRS.concat([
        ['dt-sub', 'wheel-slice', 'text'],
        ['dt-sub', 'wheel-slice-hover', 'text'],
        ['dt-sub-selected', 'wheel-slice-selected', 'text'],
        ['dt-text-alt', 'dt-alt', 'text'],
        ['dt-text-alt', 'dt-alt-hover', 'text'],
        ['dt-sub-alt', 'dt-alt', 'text'],
        ['dt-sub-alt', 'dt-alt-hover', 'text'],
        ['dt-text-alt', 'dt-third', 'text'],
        ['dt-text-alt', 'dt-third-hover', 'text'],
        ['dt-sub-third', 'dt-third', 'text'],
        ['dt-sub-third', 'dt-third-hover', 'text'],
        ['dt-title', 'dt-bull', 'text'],
        ['dt-file', 'dt-bull', 'text'],
      ]),
      // Sisal: short fibres at random angles, as a tiny tile.
      defs: `
      <pattern id="dart-sisal" width="7" height="7" patternUnits="userSpaceOnUse">
        <path d="M1 1.2l1.4.7M4.6 2.4l.6 1.3M2.2 4.8l1.3-.5M5.4 5.6l1.2.6M.6 6.2l.4-1.2" stroke="#000000" stroke-opacity=".09" stroke-width=".6" stroke-linecap="round"/>
        <path d="M3 .4l.9 1M6.2.8l-.9.8M1.4 3.4l1 .6M4.2 6.4l1.1-.4" stroke="#ffffff" stroke-opacity=".1" stroke-width=".6" stroke-linecap="round"/>
      </pattern>`,

      wheel: {
        render(root, m, H) {
          const uid = H.uid('dart');
          const defs = H.s('defs', {}, root);
          const spot = H.s(
            'radialGradient',
            { id: uid + '-spot', cx: C, cy: C - 20, r: R.rim + 20, gradientUnits: 'userSpaceOnUse' },
            defs,
          );
          H.s('stop', { offset: 0.35, 'stop-color': '#000000', 'stop-opacity': 0 }, spot);
          H.s('stop', { offset: 1, 'stop-color': '#000000', 'stop-opacity': 0.75 }, spot);

          // The surround ring with a chevron for each sector.
          const base = H.s('g', { class: 'dt-base', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: C, cy: C, r: R.rim, class: 'dt-ring' }, base);
          let chev = '';
          for (const sl of m.slices) {
            const [x, y] = polar((R.ring + R.rim) / 2, sl.mid);
            const a = (sl.mid * Math.PI) / 180;
            const ux = Math.sin(a),
              uy = -Math.cos(a),
              vx = Math.cos(a),
              vy = Math.sin(a);
            const P = (u, v) => f2(x + ux * u + vx * v) + ' ' + f2(y + uy * u + vy * v);
            chev += `M${P(4.4, -6.6)}L${P(-3.6, 0)}L${P(4.4, 6.6)}L${P(1.4, 0)}Z`;
          }
          H.s('path', { d: chev, class: 'dt-chevron' }, base);

          // Sectors alternate; with an odd count the last one, which would match the first, takes a third
          // colour with its own rings, so no two neighbours are ever alike.
          for (const sl of m.slices) {
            const third = m.n > 1 && m.n % 2 === 1 && sl.i === m.n - 1;
            const alt = !third && sl.i % 2 === 1;
            const rings = third ? 'dt-chalk' : alt ? 'dt-red' : 'dt-green';
            const g = H.slice(root, sl, m);
            g.classList.add(third ? 'dt-third' : alt ? 'dt-odd' : 'dt-even');
            H.s('path', { d: H.sector(R.t0, R.d1, sl.a0, sl.a1), class: 'dt-single' }, g);
            H.s('path', { d: H.sector(R.t0, R.t1, sl.a0, sl.a1), class: 'dt-treble ' + rings }, g);
            H.s('path', { d: H.sector(R.d0, R.d1, sl.a0, sl.a1), class: 'dt-double ' + rings }, g);
            H.s('path', { d: H.sector(R.t0, R.d1, sl.a0, sl.a1), class: 'dt-sisal', fill: 'url(#dart-sisal)' }, g);
            const c = H.s('g', { class: 'dt-ink' }, g);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 27,
                subSize: 15,
                gap: 0,
                maxWidth: 74,
                minSize: 12,
                cls: 'dt-lbl dt-fmt',
                subCls: 'dt-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 23,
                size: 17,
                gap: 3,
                maxWidth: 76,
                minSize: 10,
                cls: 'dt-lbl dt-word',
                sub: null,
              });
            }
            // More choices: a flight-shaped arrowhead in the sector just under the double ring, pointing
            // out, in the sector's lettering colour.
            H.ringMark(c, sl, m, { r: R.d0 - 3, size: 10.5, shape: 'dart', cls: 'dt-ring-mark' });
          }

          // Spotlight falloff (dark mode), then the wire spider.
          H.s('circle', { cx: C, cy: C, r: R.rim, class: 'dt-spot', fill: `url(#${uid}-spot)` }, root);
          const wires = H.s('g', { class: 'dt-wires', 'aria-hidden': 'true' }, root);
          let d = '';
          for (const sl of m.slices) {
            const [x0, y0] = polar(R.t0, sl.a0);
            const [x1, y1] = polar(R.ring, sl.a0);
            d += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d, class: 'dt-wire' }, wires);
          for (const r of [R.t0, R.t1, R.d0, R.d1]) H.s('circle', { cx: C, cy: C, r, class: 'dt-wire-c' }, wires);
          H.s('circle', { cx: C, cy: C, r: R.ring + 0.6, class: 'dt-catch' }, wires);

          hub(root, m, H);

          // One dart per sector, in its double ring, shown only for the chosen one; it sits above the wires
          // and leans out over the surround, clear of the labels.
          const darts = H.s('g', { class: 'dt-darts', 'aria-hidden': 'true' }, root);
          for (const sl of m.slices) {
            const [tx, ty] = polar(R.tip, sl.mid - sl.step * 0.2);
            const holder = H.s(
              'g',
              { class: 'dt-dart', 'data-for': sl.i, transform: `translate(${f2(tx)} ${f2(ty)})` },
              darts,
            );
            H.s('circle', { cx: 0, cy: 0, r: 9, class: 'dt-puff' }, holder);
            H.s('path', { d: 'M0 0L11 7', class: 'dt-shadow' }, holder);
            dart(H.s('g', { transform: `rotate(${f2(sl.mid + 66)}) scale(1.4)` }, holder), H);
          }
        },

        update(root, m, st) {
          root.querySelectorAll('.dt-dart').forEach((d) => d.classList.toggle('is-on', +d.dataset.for === st.selected));
        },
      },

      sounds: {
        // A short whoosh and a soft knock as the board comes up.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 2600, f2: 800, q: 1.4, dur: 0.09, gain: 0.07, a: 0.01 });
          X.tone(ac, out, t + 0.07, { f: 150, f2: 92, dur: 0.05, gain: 0.04, a: 0.002 });
        },
        // A light tick on the wire.
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'triangle', f: 3600, f2: 3300, dur: 0.014, gain: 0.035, a: 0.001 });
          X.burst(ac, out, t, { type: 'highpass', f: 6000, q: 0.7, dur: 0.006, gain: 0.02 });
        },
        // Whoosh, a solid thud into sisal, then the dart's wobbling twang.
        success(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 3200, f2: 900, q: 1.6, dur: 0.15, gain: 0.07, a: 0.03 });
          const hit = t + 0.16;
          X.tone(ac, out, hit, { f: 125, f2: 52, dur: 0.13, gain: 0.1, a: 0.002 });
          X.burst(ac, out, hit, { type: 'lowpass', f: 650, q: 0.8, dur: 0.06, gain: 0.11 });
          X.burst(ac, out, hit, { type: 'bandpass', f: 2200, q: 2, dur: 0.02, gain: 0.05 });
          const o = ac.createOscillator();
          o.type = 'triangle';
          o.frequency.setValueAtTime(205, hit + 0.02);
          o.frequency.exponentialRampToValueAtTime(188, hit + 0.42);
          const g = ac.createGain();
          g.gain.setValueAtTime(0.0001, hit);
          g.gain.exponentialRampToValueAtTime(0.035, hit + 0.025);
          g.gain.exponentialRampToValueAtTime(0.0001, hit + 0.45);
          const trem = ac.createGain();
          trem.gain.value = 0.5;
          const lfo = ac.createOscillator();
          lfo.frequency.setValueAtTime(19, hit);
          lfo.frequency.linearRampToValueAtTime(11, hit + 0.45);
          const lg = ac.createGain();
          lg.gain.value = 0.5;
          lfo.connect(lg).connect(trem.gain);
          o.connect(g).connect(trem).connect(out);
          o.start(hit);
          lfo.start(hit);
          o.stop(hit + 0.5);
          lfo.stop(hit + 0.5);
        },
      },
    });
  })();
}
