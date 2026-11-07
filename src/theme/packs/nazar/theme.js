// SPDX-License-Identifier: MIT
// Nazar: a handmade glass eye bead seen from the front. The slices are the cobalt outer glass,
// split by trails of air bubbles; the white ring, the pale blue ring and the dark pupil make the hub.
// The rings wobble a little, as molten glass does. Applying a slice sends a ring of light out from
// the pupil; the slice catches it, turns pale blue glass and keeps a glint.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const f2 = (n) => Math.round(n * 100) / 100;
    const R = { rim: 186, white: 96, blue: 78, pupil: 61, lbl: 141 };

    // Seeded random numbers, so every wheel draws the same bead.
    function rng(seed) {
      let s = seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
    }
    // A closed, slightly wobbly circle: molten glass is never perfectly round.
    function wobble(r, amp, seed) {
      const rand = rng(seed);
      const k1 = 2 + Math.floor(rand() * 2),
        k2 = 5 + Math.floor(rand() * 3);
      const p1 = rand() * 6.28,
        p2 = rand() * 6.28;
      let d = '';
      const N = 72;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const rr = r + amp * (0.65 * Math.sin(k1 * a + p1) + 0.35 * Math.sin(k2 * a + p2));
        d += (i ? 'L' : 'M') + f2(C + rr * Math.sin(a)) + ' ' + f2(C - rr * Math.cos(a));
      }
      return d + 'Z';
    }
    const dot = (x, y, r) => `M${f2(x - r)} ${f2(y)}a${r} ${r} 0 1 0 ${f2(2 * r)} 0a${r} ${r} 0 1 0 ${f2(-2 * r)} 0Z`;
    const polar = (r, a) => [C + r * Math.sin((a * Math.PI) / 180), C - r * Math.cos((a * Math.PI) / 180)];
    const SPARK = 'M0-10C.6-3.4 3.4-.6 10 0C3.4.6.6 3.4 0 10C-.6 3.4-3.4.6-10 0C-3.4-.6-.6-3.4 0-10Z';

    function hub(root, m, H) {
      const g = H.s('g', { class: 'nz-hub' }, root);
      H.s('path', { d: wobble(R.white + 1, 1.6, 11), class: 'nz-halo' }, g);
      H.s('path', { d: wobble(R.white, 1.6, 11), class: 'nz-white' }, g);
      H.s('path', { d: wobble(R.blue, 1.3, 23), class: 'nz-blue' }, g);
      H.s('path', { d: wobble(R.pupil, 1.1, 37), class: 'nz-pupil' }, g);
      H.s('circle', { cx: C, cy: C, r: R.pupil - 2, class: 'nz-pupil-depth', fill: `url(#${root.__ids.pupil})` }, g);
      const [hx, hy] = polar(R.pupil - 13, -42);
      H.s(
        'ellipse',
        {
          cx: f2(hx),
          cy: f2(hy),
          rx: 5.2,
          ry: 3.4,
          transform: `rotate(-42 ${f2(hx)} ${f2(hy)})`,
          class: 'nz-pupil-hi',
        },
        g,
      );
      // Without a key the title and file sit lower, in the middle of the pupil.
      const dy = m.key ? 0 : 8;
      H.label(g, C, C - 14 + dy, m.title, { maxWidth: 104, size: 15.5, minSize: 9, maxLines: 1, cls: 'nz-title' });
      H.label(g, C, C + 4 + dy, m.file, { maxWidth: 86, size: 11.5, minSize: 8.5, maxLines: 1, cls: 'nz-file' });
      if (!m.key) return;
      const kw = 16 + m.key.length * 6.6;
      H.s('rect', { x: f2(C - kw / 2), y: C + 15, width: f2(kw), height: 17, rx: 8.5, class: 'nz-key' }, g);
      H.text(g, C, C + 23.9, m.key, { class: 'nz-keytext' });
    }

    // ---------------------------------------------------------------- sound
    // Blue glass: beads that clink, and the singing tone of glass rubbed round its rim. Every gain starts
    // silent and ramps, and every source is stopped, so nothing clicks. Each voice's `v` sets its level,
    // balanced by measurement against the other themes.
    // A gain that rises in `a` seconds, holds, then dies away over `d`.
    function gate(ac, out, t, a, hold, d, peak) {
      const g = ac.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      if (hold > 0) g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
      g.connect(out);
      return g;
    }
    // A glass bead struck: a bright partial, a twin a few hertz off that makes it shimmer as it dies, and
    // a high inharmonic one that fades first ([ratio, level, length]; the twin's ratio is set per pitch).
    const BEAD = [
      [1, 1, 1],
      [2.32, 0.22, 0.3],
    ];
    function bead(ac, out, t, f, gain, d, modes = BEAD, twin = true) {
      const all = twin ? modes.concat([[1 + 3.5 / f, 0.6, 0.9]]) : modes;
      for (const [r, k, dk] of all) {
        const o = ac.createOscillator();
        o.frequency.value = f * r;
        o.connect(gate(ac, out, t, 0.0008, 0, d * dk, gain * k));
        o.start(t);
        o.stop(t + d * dk + 0.03);
      }
    }
    // Glass singing: a pure tone that swells and fades while it glides from f to f2, with its octave a
    // few hertz sharp so the two beat softly, as a rubbed glass does.
    function sing(ac, out, t, f, f2, a, hold, d, gain) {
      for (const [m, k] of [
        [1, 1],
        [2, 0.22],
      ]) {
        const o = ac.createOscillator();
        o.frequency.setValueAtTime(f * m + (m - 1) * 2.5, t);
        o.frequency.exponentialRampToValueAtTime(f2 * m + (m - 1) * 2.5, t + a + hold);
        o.connect(gate(ac, out, t, a, hold, d, gain * k));
        o.start(t);
        o.stop(t + a + hold + d + 0.03);
      }
    }

    Board.define({
      id: 'nazar',
      fonts: {
        brand: "'Comfortaa'",
        load: ["'Comfortaa'"],
        credits: [{ family: 'Comfortaa', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 170, close: 110, stagger: 12, apply: 600 },
      palette: {
        light: {
          bg: '#f1f5fb',
          surface: '#ffffff',
          'surface-2': '#ecf1f9',
          border: '#d2dbea',
          'border-strong': '#9aabc8',
          text: '#0f1b3d',
          'text-muted': '#4c5a7a',
          accent: '#1546c0',
          'on-accent': '#ffffff',
          focus: '#1546c0',
          success: '#16805c',
          'on-success': '#ffffff',
          'success-text': '#106b4c',
          warning: '#c98a12',
          'warning-text': '#875800',
          danger: '#c62f3c',
          desk: 'radial-gradient(120% 100% at 30% 15%, #ffffff 0%, #e5eef9 50%, #cfdcf0 100%)',
          'wheel-face': '#1440b3',
          'wheel-slice': '#1440b3',
          'wheel-slice-hover': '#2758cc',
          'wheel-slice-selected': '#a6dcf4',
          'wheel-text': '#ffffff',
          'wheel-text-selected': '#0b1f4f',
          'wheel-line': 'rgba(255, 255, 255, 0.55)',
          'wheel-shadow': 'rgba(14, 40, 110, 0.38)',
          'nz-sub': '#d3e2ff',
          'nz-sub-selected': '#173a7a',
          'nz-glass-in': '#3168dc',
          'nz-glass-mid': '#1644b8',
          'nz-glass-out': '#0a2477',
          'nz-white': '#f8fafd',
          'nz-white-edge': '#c7d3e8',
          'nz-blue': '#8fcdec',
          'nz-pupil': '#0b1230',
          'nz-pupil-in': '#25345f',
          'nz-title': '#ffffff',
          'nz-file': '#b9c8ea',
          'nz-key': '#27345f',
          'nz-keytext': '#e3ebff',
          'nz-cord': '#b3262e',
          'nz-cord-hi': '#e25a62',
          'nz-light': '#d9f4ff',
          'nz-flash': '#f1fbff',
          'nz-bubble': '#ffffff',
          'nz-halo': '#ffffff',
          'nz-halo-opacity': '0',
          'nz-hi-opacity': '0.3',
          'nz-bubble-opacity': '1',
          'nz-shadow-y': '12px',
          'nz-shadow-blur': '30px',
        },
        dark: {
          bg: '#070b1c',
          surface: '#0f1630',
          'surface-2': '#152043',
          border: '#22305a',
          'border-strong': '#3f5288',
          text: '#eaf1ff',
          'text-muted': '#9fb0d6',
          accent: '#6fb4ff',
          'on-accent': '#04122e',
          focus: '#8cc4ff',
          success: '#43d19b',
          'on-success': '#03261a',
          'success-text': '#65dcae',
          warning: '#f2c14e',
          'warning-text': '#f6d37d',
          danger: '#ff7680',
          desk: 'radial-gradient(62% 62% at 50% 47%, #1d3f9c 0%, #0e1c4a 42%, #060a1e 78%, #04060f 100%)',
          'wheel-face': '#0d2a86',
          'wheel-slice': '#0d2a86',
          'wheel-slice-hover': '#1c48b8',
          'wheel-slice-selected': '#8fe2ff',
          'wheel-text': '#f2f8ff',
          'wheel-text-selected': '#03173d',
          'wheel-line': 'rgba(150, 225, 255, 0.6)',
          'wheel-shadow': 'rgba(60, 140, 255, 0.55)',
          'nz-sub': '#c4dcff',
          'nz-sub-selected': '#0b2d63',
          'nz-glass-in': '#2c64e2',
          'nz-glass-mid': '#0f2c88',
          'nz-glass-out': '#030b33',
          'nz-white': '#d9e9ff',
          'nz-white-edge': '#7fd6ff',
          'nz-blue': '#55c8f4',
          'nz-pupil': '#030716',
          'nz-pupil-in': '#132458',
          'nz-title': '#ffffff',
          'nz-file': '#a8bce8',
          'nz-key': '#16244f',
          'nz-keytext': '#d3e2ff',
          'nz-cord': '#e0525e',
          'nz-cord-hi': '#ff9aa2',
          'nz-light': '#a8eaff',
          'nz-flash': '#eafaff',
          'nz-bubble': '#a8eaff',
          'nz-halo': '#6fd4ff',
          'nz-halo-opacity': '0.45',
          'nz-hi-opacity': '0.14',
          'nz-bubble-opacity': '1',
          'nz-shadow-y': '0px',
          'nz-shadow-blur': '54px',
        },
      },
      contrast: Board.DEFAULT_PAIRS.concat([
        ['wheel-text', 'nz-glass-in', 'text'],
        ['nz-sub', 'wheel-slice', 'text'],
        ['nz-sub', 'wheel-slice-hover', 'text'],
        ['nz-sub-selected', 'wheel-slice-selected', 'text'],
        ['nz-title', 'nz-pupil', 'text'],
        ['nz-file', 'nz-pupil', 'text'],
      ]),

      wheel: {
        render(root, m, H) {
          const uid = H.uid('nazar');
          const ids = { glass: uid + '-glass', pupil: uid + '-pupil', rim: uid + '-rim' };
          root.__ids = ids;
          const defs = H.s('defs', {}, root);
          // Gradients live in the wheel so their stops take the wheel's palette.
          const gl = H.s(
            'radialGradient',
            { id: ids.glass, cx: C, cy: C + 6, r: R.rim, fx: C + 22, fy: C + 30, gradientUnits: 'userSpaceOnUse' },
            defs,
          );
          H.s('stop', { offset: 0.45, class: 'nz-st-in' }, gl);
          H.s('stop', { offset: 0.78, class: 'nz-st-mid' }, gl);
          H.s('stop', { offset: 1, class: 'nz-st-out' }, gl);
          const pu = H.s('radialGradient', { id: ids.pupil, cx: 0.5, cy: 0.5, r: 0.5, fx: 0.62, fy: 0.66 }, defs);
          H.s('stop', { offset: 0, class: 'nz-st-pin' }, pu);
          H.s('stop', { offset: 1, class: 'nz-st-pout' }, pu);

          // The cord the bead hangs from.
          const cord = H.s('g', { class: 'nz-cord', 'aria-hidden': 'true' }, root);
          H.s('path', { d: 'M195.4 17C186 4 189.4-7.6 200-7.6S214 4 204.6 17', class: 'nz-cord-line' }, cord);
          H.s('path', { d: 'M196.4 15.6C189.4 4.6 191.6-5.4 200-5.6', class: 'nz-cord-hi' }, cord);
          H.s('rect', { x: 194.6, y: 11.6, width: 10.8, height: 6, rx: 2.4, class: 'nz-crimp' }, cord);

          // The glass body.
          H.s('path', { d: wobble(R.rim, 1.4, 5), class: 'nz-glass', fill: `url(#${ids.glass})` }, root);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.white - 2, R.rim, sl.a0, sl.a1), class: 'nz-seg' }, g);
            const [sx, sy] = polar(R.rim - 13, sl.mid - sl.step * 0.24);
            H.s('path', { d: SPARK, class: 'nz-spark' }, H.s('g', { transform: `translate(${f2(sx)} ${f2(sy)})` }, g));
            const c = H.s('g', { class: 'nz-ink' }, g);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 22,
                subSize: 13.5,
                gap: 2.5,
                maxWidth: 80,
                minSize: 11,
                cls: 'nz-lbl nz-fmt',
                subCls: 'nz-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 14,
                gap: 4,
                maxWidth: 82,
                minSize: 9,
                cls: 'nz-lbl nz-word',
                sub: null,
              });
            }
            // More choices: a white arrowhead near the rim of the glass.
            H.ringMark(c, sl, m, { r: R.rim - 8, size: 10.5, cls: 'nz-ring-mark' });
          }

          // Air caught in the glass: bubble trails between the slices and a few strays near the rim.
          const rand = rng(97);
          let bub = '';
          for (const sl of m.slices) {
            let r = R.white + 9;
            while (r < R.rim - 8) {
              const size = 1.1 + rand() * 1.5 + (r - R.white) * 0.006;
              const [x, y] = polar(r, sl.a0 + (rand() - 0.5) * 1.6);
              bub += dot(x, y, f2(size));
              r += 9 + rand() * 7;
            }
            // Strays near the rim: as many for a wide slice as for two narrow ones.
            const strays = Math.max(2, Math.round(sl.step / 22));
            for (let k = 0; k < strays; k++) {
              const r = R.rim - 5 - rand() * 4;
              const a = sl.mid + (rand() - 0.5) * sl.step * 0.8;
              // None on the mark of a slice that opens a ring of choices.
              if (sl.ring && Math.abs(a - sl.mark) < 6) continue;
              const [x, y] = polar(r, a);
              bub += dot(x, y, f2(0.7 + rand() * 0.8));
            }
          }
          const fx = H.s('g', { class: 'nz-over', 'aria-hidden': 'true' }, root);
          H.s('path', { d: bub, class: 'nz-bubbles' }, fx);
          // The glass catches the light: a crescent on the upper rim and a window reflection.
          const [ax, ay] = polar(R.rim - 2, 12);
          const [bx, by] = polar(R.rim - 2, 283);
          H.s(
            'path',
            {
              d: `M${f2(ax)} ${f2(ay)}A${R.rim - 2} ${R.rim - 2} 0 0 0 ${f2(bx)} ${f2(by)}A221 221 0 0 1 ${f2(ax)} ${f2(ay)}Z`,
              class: 'nz-crescent',
            },
            fx,
          );
          const [wx, wy] = polar(R.rim - 11, -30);
          H.s(
            'rect',
            {
              x: f2(wx - 11),
              y: f2(wy - 3.6),
              width: 22,
              height: 7.2,
              rx: 3.6,
              transform: `rotate(-30 ${f2(wx)} ${f2(wy)})`,
              class: 'nz-window',
            },
            fx,
          );
          H.s('path', { d: wobble(R.rim, 1.4, 5), class: 'nz-rim' }, fx);

          hub(root, m, H);

          // The ring of light, shown only while a slice is applied.
          const pulse = H.s('g', { class: 'nz-pulse', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: C, cy: C, r: 100, class: 'nz-pulse-glow' }, pulse);
          H.s('circle', { cx: C, cy: C, r: 100, class: 'nz-pulse-core' }, pulse);
          const echo = H.s('g', { class: 'nz-pulse nz-echo', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: C, cy: C, r: 100, class: 'nz-pulse-core' }, echo);
        },
      },

      sounds: {
        // The bead swells out of the pupil: a warm glass tone blooms, and two beads clink as it settles.
        open(ac, out, t) {
          const v = 0.7;
          sing(ac, out, t, 1046.5, 1318.5, 0.06, 0.04, 0.3, 0.03 * v);
          bead(ac, out, t + 0.15, 3520, 0.06 * v, 0.06, BEAD.slice(0, 1), false);
          bead(ac, out, t + 0.162, 3729, 0.04 * v, 0.05, BEAD.slice(0, 1), false);
        },
        // Two glass beads on the string touch: a bright double clink, never quite the same twice.
        tick(ac, out, t) {
          const v = 0.9;
          const f = 3000 + Math.random() * 500;
          bead(ac, out, t, f, 0.04 * v, 0.022, BEAD, false);
          const again = t + 0.006 + Math.random() * 0.006;
          bead(ac, out, again, f * (1.06 + Math.random() * 0.04), 0.024 * v, 0.018, BEAD.slice(0, 1), false);
        },
        // Into a ring: light gathers in the glass and its singing tone rises.
        enter(ac, out, t) {
          const v = 0.23;
          sing(ac, out, t, 1174.7, 1568, 0.07, 0.03, 0.12, 0.05 * v);
        },
        // Back out: the glow sinks, its tone falls, and a bead clinks.
        leave(ac, out, t) {
          const v = 0.25;
          sing(ac, out, t, 1568, 1174.7, 0.03, 0.03, 0.14, 0.05 * v);
          bead(ac, out, t + 0.02, 3136, 0.02 * v, 0.05, BEAD.slice(0, 1), false);
        },
        // The bead is struck as the ring of light leaves the pupil, the glass sings while the light
        // spreads, the slice rings brighter as it catches it, and its glint sparkles.
        success(ac, out, t) {
          const v = 0.63;
          bead(ac, out, t, 1318.5, 0.07 * v, 0.7);
          sing(ac, out, t + 0.02, 1975.5, 1975.5, 0.12, 0.15, 0.4, 0.025 * v);
          bead(ac, out, t + 0.18, 1975.5, 0.05 * v, 0.5);
          bead(ac, out, t + 0.39, 3951, 0.02 * v, 0.15, BEAD.slice(0, 1));
        },
      },
    });
  })();
}
