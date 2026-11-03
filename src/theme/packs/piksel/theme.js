// SPDX-License-Identifier: MIT
// Theme: 8-bit piksel. The whole wheel sits on one crisp 40 x 40 pixel grid with a tiny palette:
// an ink outline, a rim shaded by checkerboard dithering, slices split by stair-stepped ink lines and
// raised like game buttons, and a pixel button in the hub. Applying a slice presses the button in,
// blinks it and throws a burst of square pixels; a pixel star stays on the rim.
export default function register(Board) {
  (function () {
    'use strict';

    const P = 10; // one grid pixel in viewBox units: 8 screen pixels on a 320 px wheel
    const N = 400 / P;
    // Radii (viewBox units) tested against each cell's center.
    const R = { out: 197, ink: 187, rim: 167, rimInk: 157, hubInk: 70, hub: 60, lbl: 117 };
    const LIGHT = [-Math.SQRT1_2, -Math.SQRT1_2]; // light falls from the top left

    // A rectangle with one-step notched corners: the pixel version of a rounded rect.
    const notch = (x, y, w, h, n) =>
      `M${x + n} ${y}H${x + w - n}V${y + n}H${x + w}V${y + h - n}H${x + w - n}V${y + h}H${x + n}V${y + h - n}H${x}V${y + n}H${x + n}Z`;

    // Merges each row's consecutive matching cells into one rectangle; cell size p.
    function cellPath(rows, cols, test, p, ox = 0, oy = 0) {
      let d = '';
      for (let r = 0; r < rows; r++) {
        let start = -1;
        for (let c = 0; c <= cols; c++) {
          const on = c < cols && test(r, c);
          if (on && start < 0) start = c;
          if (!on && start >= 0) {
            d += `M${ox + start * p} ${oy + r * p}h${(c - start) * p}v${p}h${-(c - start) * p}z`;
            start = -1;
          }
        }
      }
      return d;
    }

    // Which slice owns an angle (degrees, clockwise from twelve o'clock).
    function owner(m, ang) {
      for (const sl of m.slices) {
        const rel = (((ang - sl.a0) % 360) + 360) % 360;
        if (rel < sl.a1 - sl.a0) return sl.i;
      }
      return 0;
    }

    // Classifies every grid cell: 'ink', rim and hub shades, or a slice index.
    function buildGrid(m) {
      const g = [];
      const bounds = m.slices.map((sl) => sl.a0);
      for (let r = 0; r < N; r++) {
        const row = [];
        for (let c = 0; c < N; c++) {
          const dx = c * P + P / 2 - 200;
          const dy = r * P + P / 2 - 200;
          const d = Math.hypot(dx, dy);
          const ang = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
          const lit = d ? (dx * LIGHT[0] + dy * LIGHT[1]) / d : 0;
          const chk = (r + c) % 2 === 0;
          let k = null;
          if (d >= R.out) k = null;
          else if (d >= R.ink) k = 'ink';
          else if (d >= R.rim)
            k =
              lit > 0.62
                ? 'rimH'
                : lit > 0.22
                  ? chk
                    ? 'rimH'
                    : 'rim'
                  : lit < -0.62
                    ? 'rimL'
                    : lit < -0.22
                      ? chk
                        ? 'rimL'
                        : 'rim'
                      : 'rim';
          else if (d >= R.rimInk) k = 'ink';
          else if (d >= R.hubInk) {
            let edge = false;
            for (const b of bounds) {
              const da = Math.abs(((((ang - b) % 360) + 540) % 360) - 180);
              if ((da * Math.PI * d) / 180 < 4.7) edge = true;
            }
            k = edge ? 'ink' : owner(m, ang);
          } else if (d >= R.hub) k = 'ink';
          else k = d >= 48 && lit > 0.55 ? 'hubH' : d >= 48 && lit < -0.6 ? 'hubL' : 'hub';
          row.push(k);
        }
        g.push(row);
      }
      return g;
    }

    // Cell (column, row) of the grid that holds a point.
    const cellAt = (x, y) => [Math.floor(x / P), Math.floor(y / P)];

    // A seeded pseudo-random sequence so every copy of a wheel throws the same burst.
    function rng(seed) {
      let s = seed * 9301 + 49297;
      return () => (s = (s * 9301 + 49297) % 233280) / 233280;
    }

    Board.define({
      id: 'piksel',
      fonts: {
        brand: "'Pixelify Sans'",
        display: "'Silkscreen'",
        load: ["'Pixelify Sans'", "'Silkscreen'"],
        credits: [
          { family: 'Pixelify Sans', license: 'SIL Open Font License 1.1' },
          { family: 'Silkscreen', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 160, close: 110, stagger: 14, apply: 620 },
      palette: {
        light: {
          bg: '#eef4fc',
          surface: '#ffffff',
          'surface-2': '#e3ecf8',
          border: '#c4d0e4',
          'border-strong': '#7f8db0',
          text: '#1b1838',
          'text-muted': '#4b5273',
          accent: '#d6213f',
          'on-accent': '#ffffff',
          focus: '#2d55d6',
          success: '#1f9d55',
          'on-success': '#ffffff',
          'success-text': '#167a42',
          warning: '#e2a100',
          'warning-text': '#7a5600',
          danger: '#d6213f',
          desk: 'repeating-conic-gradient(#b2dfff 0 25%, #c0e6ff 0 50%) 50% 50% / 32px 32px',
          'wheel-face': '#ffffff',
          'wheel-slice': '#ffffff',
          'wheel-slice-hover': '#ffe14d',
          'wheel-slice-selected': '#d6213f',
          'wheel-text': '#1b1838',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#1b1838',
          'wheel-shadow': 'rgba(27, 24, 56, 0.3)',
          'px-ink': '#1b1838',
          'px-a': '#ffffff',
          'px-b': '#d9edff',
          'px-hi': 'rgba(255, 255, 255, 0.9)',
          'px-lo': 'rgba(27, 24, 56, 0.16)',
          'px-hov-hi': '#fff6bf',
          'px-hov-lo': '#d6a400',
          'px-sel-hi': '#8a0f27',
          'px-sel-lo': '#ff8a9c',
          'px-rim': '#2d55d6',
          'px-rim-hi': '#8db8ff',
          'px-rim-lo': '#162a7c',
          'px-hub': '#1b1838',
          'px-hub-hi': '#3c3775',
          'px-hub-lo': '#0c0a1f',
          'px-hub-text': '#ffffff',
          'px-hub-muted': '#c3caf0',
          'px-key': '#ffe14d',
          'px-key-text': '#1b1838',
          'px-sub': '#3a4263',
          'px-flash': '#ffffff',
          'px-spark': '#ffd23f',
          'px-spark-core': '#ffffff',
          'px-bit-1': '#ffd23f',
          'px-bit-2': '#d6213f',
          'px-bit-3': '#2d55d6',
        },
        dark: {
          bg: '#14112a',
          surface: '#1e1a3a',
          'surface-2': '#28234b',
          border: '#3a3466',
          'border-strong': '#6a62a8',
          text: '#f3f0ff',
          'text-muted': '#b4add9',
          accent: '#ffd23f',
          'on-accent': '#1a1530',
          focus: '#ffd23f',
          success: '#4de8a0',
          'on-success': '#0b2a1a',
          'success-text': '#6ff0b2',
          warning: '#ffb84d',
          'warning-text': '#ffc978',
          danger: '#ff5c7a',
          desk: 'repeating-conic-gradient(#191534 0 25%, #1e1a3e 0 50%) 50% 50% / 32px 32px',
          'wheel-face': '#2b2363',
          'wheel-slice': '#2b2363',
          'wheel-slice-hover': '#5141b8',
          'wheel-slice-selected': '#ffd23f',
          'wheel-text': '#f6f3ff',
          'wheel-text-selected': '#1a1530',
          'wheel-line': '#0a0818',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          'px-ink': '#0a0818',
          'px-a': '#2b2363',
          'px-b': '#3a2e85',
          'px-hi': 'rgba(176, 158, 255, 0.3)',
          'px-lo': 'rgba(6, 4, 24, 0.5)',
          'px-hov-hi': '#9384f5',
          'px-hov-lo': '#2b2270',
          'px-sel-hi': '#a77a00',
          'px-sel-lo': '#fff1a6',
          'px-rim': '#b13ee0',
          'px-rim-hi': '#ec9eff',
          'px-rim-lo': '#5c1683',
          'px-hub': '#0a0818',
          'px-hub-hi': '#2c2554',
          'px-hub-lo': '#000000',
          'px-hub-text': '#ffffff',
          'px-hub-muted': '#b4add9',
          'px-key': '#ffd23f',
          'px-key-text': '#1a1530',
          'px-sub': '#d2cbf7',
          'px-flash': '#ffffff',
          'px-spark': '#ffd23f',
          'px-spark-core': '#ffffff',
          'px-bit-1': '#ffd23f',
          'px-bit-2': '#ff5c8a',
          'px-bit-3': '#4de8c2',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['wheel-text', 'px-b', 'text'],
        ['px-sub', 'px-a', 'text'],
        ['px-sub', 'px-b', 'text'],
        ['px-sub', 'wheel-slice-hover', 'text'],
        ['px-hub-text', 'px-hub', 'text'],
        ['px-hub-muted', 'px-hub', 'text'],
        ['px-key-text', 'px-key', 'text'],
        ['px-ink', 'px-flash', 'text'],
      ],
      // Square dots for "More…".
      icons: {
        more: '<path d="M3.5 10.5h4v4h-4zM10 10.5h4v4h-4zM16.5 10.5h4v4h-4z" fill="currentColor" stroke="none"/>',
      },
      defs: '',

      wheel: {
        render(root, m, H) {
          const s = H.s;
          const C = H.C;
          const grid = buildGrid(m);
          const at = (r, c) => (r < 0 || c < 0 || r >= N || c >= N ? null : grid[r][c]);
          const path = (test, cls, parent, extra = {}) => {
            const d = cellPath(N, N, test, P);
            return d ? s('path', Object.assign({ d, class: cls }, extra), parent) : null;
          };
          root.classList.add('px-root');

          // Hard drop shadow: the silhouette one pixel down and right.
          path((r, c) => at(r, c) !== null, 'px-shadow', root, { transform: `translate(${P} ${P})` });
          const base = s('g', { class: 'px-base', 'aria-hidden': 'true' }, root);
          path((r, c) => at(r, c) === 'ink', 'px-ink', base);
          path((r, c) => at(r, c) === 'rim', 'px-rim', base);
          path((r, c) => at(r, c) === 'rimH', 'px-rim-hi', base);
          path((r, c) => at(r, c) === 'rimL', 'px-rim-lo', base);

          for (const sl of m.slices) {
            const i = sl.i;
            const g = H.slice(root, sl, m);
            g.classList.add(i % 2 ? 'px-b' : 'px-a');
            s('path', { d: H.sector(R.hubInk - 6, R.rim, sl.a0, sl.a1), class: 'px-hit' }, g);
            const mine = (r, c) => at(r, c) === i;
            path(mine, 'px-fill', g);
            // Bevel: cells on the slice's top or left border catch the light, bottom or right ones the shade.
            const lit = (r, c) => mine(r, c) && (!mine(r - 1, c) || !mine(r, c - 1));
            path(lit, 'px-edge-hi', g);
            path((r, c) => mine(r, c) && !lit(r, c) && (!mine(r + 1, c) || !mine(r, c + 1)), 'px-edge-lo', g);

            const ink = s('g', { class: 'px-label' }, g);
            if (m.kind === 'convert' && sl.sub) {
              H.block(ink, sl, R.lbl, {
                size: 23,
                subSize: 13.5,
                gap: 4,
                maxWidth: 78,
                minSize: 11,
                cls: 'px-lbl px-fmt',
                subCls: 'px-sub',
              });
            } else {
              H.block(ink, sl, R.lbl, {
                icon: true,
                iconSize: 24,
                size: 14,
                gap: 5,
                maxWidth: 78,
                minSize: 9,
                cls: 'px-lbl px-word',
                sub: null,
              });
            }

            // The star that marks the applied slice: a plus of five cells on the rim.
            const [sx, sy] = H.polar((R.rim + R.ink) / 2, sl.mid);
            const [sc, sr] = cellAt(sx, sy);
            const spark = s('g', { class: 'px-spark' }, g);
            s(
              'path',
              {
                d: `M${(sc - 1) * P} ${sr * P}h${3 * P}v${P}h${-3 * P}zM${sc * P} ${(sr - 1) * P}h${P}v${3 * P}h${-P}z`,
                class: 'px-spark-arm',
              },
              spark,
            );
            s('rect', { x: sc * P, y: sr * P, width: P, height: P, class: 'px-spark-core' }, spark);
          }

          // Hub: a dark pixel button with the wheel's name, the file and the key.
          const hub = s('g', { class: 'px-hub' }, root);
          path((r, c) => at(r, c) === 'hub', 'px-hub-fill', hub);
          path((r, c) => at(r, c) === 'hubH', 'px-hub-hi', hub);
          path((r, c) => at(r, c) === 'hubL', 'px-hub-lo', hub);
          H.label(hub, C, C - 18, m.title.toLocaleUpperCase(m.lang), {
            maxWidth: 96,
            size: 12.5,
            minSize: 8,
            cls: 'px-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 2, m.file, { maxWidth: 92, size: 13, minSize: 9, cls: 'px-file', maxLines: 1 });
          const kw = Math.max(44, 16 + m.key.length * 8);
          s('path', { d: notch(C - kw / 2, C + 17, kw, 18, 3), class: 'px-key' }, hub);
          H.text(hub, C, C + 26.5, m.key.toLocaleUpperCase(m.lang), { class: 'px-keytext' });

          // Bursts sit above everything, one per slice; update() arms the applied slice's burst.
          // The pixels fly out past the rim in a wide fan.
          const fx = s('g', { class: 'px-fx', 'aria-hidden': 'true' }, root);
          for (const sl of m.slices) {
            const [bx, by] = H.polar(R.rimInk - 6, sl.mid);
            const [bc, br] = cellAt(bx, by);
            const burst = s('g', { class: 'px-burst', 'data-for': sl.i }, fx);
            const rand = rng(sl.i + 3);
            for (let k = 0; k < 16; k++) {
              // Two rings of pixels in a wide fan: a near ring and a far one, alternating.
              const a = sl.mid + (k - 7.5) * 11.5 + (rand() - 0.5) * 6;
              const dist = (k % 2 ? 6 + Math.floor(rand() * 3) : 10 + Math.floor(rand() * 4)) * P;
              const dx = Math.round((dist * Math.sin(H.rad(a))) / P) * P;
              const dy = Math.round((-dist * Math.cos(H.rad(a))) / P) * P;
              const sz = k % 4 === 3 ? P / 2 : P;
              const bit = s(
                'rect',
                {
                  x: bc * P + (P - sz) / 2,
                  y: br * P + (P - sz) / 2,
                  width: sz,
                  height: sz,
                  class: `px-bit px-bit-${(k % 3) + 1}`,
                },
                burst,
              );
              bit.style.setProperty('--dx', dx + 'px');
              bit.style.setProperty('--dy', dy + 'px');
            }
          }
        },

        update(root, m, st) {
          const sel = st.selected == null ? '' : String(st.selected);
          root.querySelectorAll('.px-burst').forEach((b) => b.classList.toggle('is-on', b.dataset.for === sel));
        },
      },

      sounds: {
        open(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'square', f: 659, dur: 0.035, gain: 0.03, a: 0.001 });
          X.tone(ac, out, t + 0.045, { type: 'square', f: 988, dur: 0.05, gain: 0.03, a: 0.001 });
          X.tone(ac, out, t, { type: 'triangle', f: 196, f2: 392, dur: 0.08, gain: 0.06, a: 0.002 });
        },
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'square', f: 1760, f2: 1480, dur: 0.014, gain: 0.022, a: 0.001 });
        },
        success(ac, out, t, X) {
          // A rising arpeggio with a quieter echo of the last note, like a small console's delay.
          const notes = [784, 1047, 1319, 1568, 2093];
          notes.forEach((f, k) =>
            X.tone(ac, out, t + k * 0.05, {
              type: 'square',
              f,
              dur: k === notes.length - 1 ? 0.16 : 0.04,
              gain: 0.028,
              a: 0.001,
            }),
          );
          X.tone(ac, out, t + 0.36, { type: 'square', f: 2093, dur: 0.1, gain: 0.011, a: 0.001 });
          X.tone(ac, out, t, { type: 'triangle', f: 262, dur: 0.2, gain: 0.07, a: 0.002 });
          X.tone(ac, out, t + 0.2, { type: 'triangle', f: 523, dur: 0.16, gain: 0.05, a: 0.002 });
        },
      },
    });
  })();
}
