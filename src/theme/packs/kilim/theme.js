// SPDX-License-Identifier: MIT
// Kilim: a round flat-woven medallion. Everything sits on one weave grid, so every edge steps like
// real slit tapestry: a stepped diamond at the hub, wool-white fields split by stepped madder lines,
// a madder border band with one Anatolian motif per slice, and warp fringes top and bottom.
// Applying a slice weaves its new colour in row by row from the bottom, the shuttle turning at each row.
export default function register(Board) {
  (function () {
    'use strict';

    const S = 4; // one woven cell in view-box units
    const C = 200;
    const f2 = (n) => Math.round(n * 100) / 100;
    const R = {
      hub: 60,
      hubRing: 64,
      hubEdge: 72,
      field: 146,
      ring: 151,
      band: 181,
      border: 189,
      motif: 166,
      lbl: 110,
    };

    // Motifs on a 7 x 7 grid: '#' main yarn, '+' second yarn, '.' ground. Our own drawings of
    // traditional Anatolian kilim motifs.
    const MOTIFS = [
      // Göz (eye): wards off harm.
      ['...#...', '..#+#..', '.#+.+#.', '#+.#.+#', '.#+.+#.', '..#+#..', '...#...'],
      // Elibelinde (hands on hips): the mother figure.
      ['...#...', '..###..', '#..#..#', '##+#+##', '..###..', '.#+.+#.', '##...##'],
      // Koçboynuzu (ram's horn): strength.
      ['##...##', '#.#.#.#', '..#+#..', '...#...', '..#+#..', '#.#.#.#', '##...##'],
      // Yıldız (star): happiness.
      ['...#...', '.#.#.#.', '..#+#..', '###+###', '..#+#..', '.#.#.#.', '...#...'],
      // Su yolu (water path): life flowing on.
      ['#...#..', '.#.#.#.', '..#...#', '.......', '#...#..', '.#.#.#.', '..#...#'],
      // Muska (amulet): protection.
      ['...#...', '..#+#..', '.#+++#.', '#######', '.#.#.#.', '.#.#.#.', '.......'],
      // Kurt izi (wolf track): safe flocks.
      ['#.#.#.#', '.#####.', '##+.+##', '.#.#.#.', '##+.+##', '.#####.', '#.#.#.#'],
      // Pıtrak (burdock): keeps the evil eye off.
      ['.#.#.#.', '##.#.##', '...#...', '#######', '...#...', '##.#.##', '.#.#.#.'],
    ];

    // ---------------------------------------------------------------- the weave grid
    const angleOf = (dx, dy) => ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const inSlice = (a, sl) => (((a - sl.a0) % 360) + 360) % 360 < sl.a1 - sl.a0;
    // Distance from a cell centre to the boundary ray at angle b (only on the ray's side).
    function nearBoundary(m, dx, dy) {
      const r = Math.hypot(dx, dy);
      const a = angleOf(dx, dy);
      for (const sl of m.slices) {
        const d = ((a - sl.a0) * Math.PI) / 180;
        if (Math.cos(d) > 0 && Math.abs(r * Math.sin(d)) < 2.05) return true;
      }
      return false;
    }
    // Runs of cells per row, as one path of abutting rectangles.
    function cellsPath(cells) {
      const rows = new Map();
      for (const [x, y] of cells) {
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push(x);
      }
      let d = '';
      for (const [y, xs] of rows) {
        xs.sort((a, b) => a - b);
        let start = xs[0];
        let prev = xs[0];
        for (let k = 1; k <= xs.length; k++) {
          if (k < xs.length && xs[k] === prev + S) {
            prev = xs[k];
            continue;
          }
          d += `M${start - S / 2} ${y - S / 2}h${prev - start + S}v${S}h${-(prev - start + S)}Z`;
          if (k < xs.length) start = prev = xs[k];
        }
      }
      return d;
    }

    // Sorts every cell of the wheel into its part once per wheel.
    function weave(m) {
      const P = {
        hub: [],
        hubRing: [],
        hubEdge: [],
        ring: [],
        border: [],
        dots: [],
        div: [],
        bandDiv: [],
        fringe: [],
        field: m.slices.map(() => []),
        band: m.slices.map(() => []),
      };
      for (let y = S / 2; y < 400; y += S) {
        for (let x = S / 2; x < 400; x += S) {
          const dx = x - C,
            dy = y - C;
          const r = Math.hypot(dx, dy);
          const l1 = Math.abs(dx) + Math.abs(dy);
          if (r > R.border) continue;
          const cell = [x, y];
          if (l1 <= R.hub) P.hub.push(cell);
          else if (l1 <= R.hubRing) P.hubRing.push(cell);
          else if (l1 <= R.hubEdge) P.hubEdge.push(cell);
          else if (r <= R.field || (r > R.ring && r <= R.band)) {
            const band = r > R.ring;
            if (nearBoundary(m, dx, dy)) (band ? P.bandDiv : P.div).push(cell);
            else {
              const a = angleOf(dx, dy);
              const sl = m.slices.find((s) => inSlice(a, s));
              if (sl) (band ? P.band : P.field)[sl.i].push(cell);
            }
          } else if (r <= R.ring) P.ring.push(cell);
          else if (((x - 2) / S + (y - 2) / S) % 4 === 0 && r > R.band + 2.5 && r <= R.border - 2.5) P.dots.push(cell);
          else P.border.push(cell);
        }
      }
      // Motif cells, snapped to the grid round each slice's place in the band.
      // Motif cells, snapped to the grid. The band holds a motif for about every 45 degrees, so a wheel of
      // two slices is woven as densely as one of eight; the motifs follow one another round the band.
      const snap = (r, a) => [
        Math.round((C + r * Math.sin((a * Math.PI) / 180) - 2) / S) * S + 2,
        Math.round((C - r * Math.cos((a * Math.PI) / 180) - 2) / S) * S + 2,
      ];
      const inBand = (x, y) => {
        const r = Math.hypot(x - C, y - C);
        return r > R.ring + 1 && r <= R.band;
      };
      const EYE = [
        [0, -2],
        [-1, -1],
        [1, -1],
        [-2, 0],
        [0, 0, 1],
        [2, 0],
        [-1, 1],
        [1, 1],
        [0, 2],
      ];
      let woven = 0;
      P.motif = m.slices.map((sl) => {
        const main = [];
        const second = [];
        const k = Math.max(1, Math.round(sl.step / 45));
        const span = sl.step / k;
        for (let q = 0; q < k; q++) {
          const at = sl.a0 + span * (q + 0.5);
          const [cx, cy] = snap(R.motif, at);
          const rows = MOTIFS[woven++ % MOTIFS.length];
          rows.forEach((row, i) => {
            [...row].forEach((ch, j) => {
              if (ch === '.') return;
              const x = cx + (j - 3) * S,
                y = cy + (i - 3) * S;
              if (inBand(x, y)) (ch === '#' ? main : second).push([x, y]);
            });
          });
          // Two small eyes flank the motif along the band.
          for (const side of [-1, 1]) {
            const [ex, ey] = snap(R.motif, at + side * Math.min(11.5, span * 0.27));
            for (const [dx, dy, two] of EYE) {
              const x = ex + dx * S,
                y = ey + dy * S;
              if (inBand(x, y)) (two ? second : main).push([x, y]);
            }
          }
        }
        return { main, second };
      });
      // Warp ends hanging from the top and bottom edges, tied in tassels of three.
      for (let x = C - 66; x <= C + 66; x += S) {
        const k = Math.round((x - C + 66) / S);
        const edge = Math.sqrt(R.border * R.border - (x - C) * (x - C));
        P.fringe.push([x, C - edge, -1, k], [x, C + edge, 1, k]);
      }
      return P;
    }

    function fringePaths(P) {
      let threads = '';
      let knots = '';
      for (const [x, y, dir, k] of P.fringe) {
        const len = 8.5 + ((k * 5) % 3) * 1.2;
        const splay = ((k % 3) - 1) * 1.1;
        threads += `M${f2(x)} ${f2(y - dir * 1.5)}L${f2(x)} ${f2(y + dir * 3.6)}L${f2(x + splay)} ${f2(y + dir * len)}`;
        if (k % 3 === 1) knots += `M${f2(x - 5.2)} ${f2(y + dir * 3)}h10.4`;
      }
      return { threads, knots };
    }

    // The selected slice, rewoven: one group per weft row, bottom row first.
    function weaveRows(g, P, sl, H) {
      const holder = H.s('g', { class: 'kl-rows' });
      const rows = new Map();
      const add = (cells, kind) => {
        for (const [x, y] of cells) {
          if (!rows.has(y)) rows.set(y, { field: [], main: [], second: [] });
          rows.get(y)[kind].push([x, y]);
        }
      };
      add(P.field[sl.i], 'field');
      add(P.motif[sl.i].main, 'main');
      add(P.motif[sl.i].second, 'second');
      const ys = [...rows.keys()].sort((a, b) => b - a);
      const per = Math.min(16, 400 / ys.length);
      ys.forEach((y, k) => {
        const row = rows.get(y);
        const rg = H.s('g', { class: 'kl-row ' + (k % 2 ? 'kl-row-r' : 'kl-row-l') }, holder);
        rg.style.setProperty('--k', k);
        rg.style.setProperty('--per', f2(per) + 'ms');
        if (row.field.length) H.s('path', { d: cellsPath(row.field), class: 'kl-sel-field' }, rg);
        if (row.main.length) H.s('path', { d: cellsPath(row.main), class: 'kl-sel-main' }, rg);
        if (row.second.length) H.s('path', { d: cellsPath(row.second), class: 'kl-sel-second' }, rg);
      });
      g.insertBefore(holder, g.querySelector('.kl-tex'));
    }

    function hub(root, m, H, P) {
      const g = H.s('g', { class: 'kl-hub' }, root);
      H.s('path', { d: cellsPath(P.hubEdge), class: 'kl-hub-edge' }, g);
      H.s('path', { d: cellsPath(P.hubRing), class: 'kl-hub-ring' }, g);
      H.s('path', { d: cellsPath(P.hub), class: 'kl-hub-fill' }, g);
      H.s(
        'path',
        { d: cellsPath([...P.hub, ...P.hubRing, ...P.hubEdge]), class: 'kl-tex', fill: 'url(#kilim-weave)' },
        g,
      );
      // Without a key the title and file sit lower, in the middle of the diamond.
      const dy = m.key ? 0 : 8;
      H.label(g, C, C - 13 + dy, m.title, { maxWidth: 86, size: 15, minSize: 9, maxLines: 1, cls: 'kl-title' });
      H.label(g, C, C + 4 + dy, m.file, { maxWidth: 70, size: 11.5, minSize: 8.5, maxLines: 1, cls: 'kl-file' });
      if (!m.key) return;
      const kw = 14 + m.key.length * 6.4;
      H.s('rect', { x: f2(C - kw / 2), y: C + 14, width: f2(kw), height: 16, class: 'kl-key' }, g);
      H.text(g, C, C + 22.4, m.key, { class: 'kl-keytext' });
    }

    Board.define({
      id: 'kilim',
      fonts: {
        brand: "'Kufam'",
        load: ["'Kufam'"],
        credits: [{ family: 'Kufam', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 180, close: 120, stagger: 10, apply: 600 },
      palette: {
        light: {
          bg: '#f2f2ee',
          surface: '#ffffff',
          'surface-2': '#f0efe9',
          border: '#dcd9d0',
          'border-strong': '#a9a497',
          text: '#1f2147',
          'text-muted': '#575a74',
          accent: '#a8202e',
          'on-accent': '#ffffff',
          focus: '#2a3580',
          success: '#2f7d4f',
          'on-success': '#ffffff',
          'success-text': '#256b42',
          warning: '#d99a13',
          'warning-text': '#875a00',
          danger: '#b3261e',
          desk: 'linear-gradient(165deg, #eef0ea 0%, #dce1d8 100%)',
          'wheel-face': '#f8f5ee',
          'wheel-slice': '#f8f5ee',
          'wheel-slice-hover': '#f7e2ab',
          'wheel-slice-selected': '#27337a',
          'wheel-text': '#222a66',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#a8202e',
          'wheel-shadow': 'rgba(40, 30, 50, 0.3)',
          'kl-sub': '#961c29',
          'kl-sub-selected': '#f6cd68',
          'kl-band': '#a8202e',
          'kl-band-div': '#27337a',
          'kl-motif': '#fbf6ea',
          'kl-motif-2': '#27337a',
          'kl-sel-motif': '#f2b630',
          'kl-sel-motif-2': '#fbf6ea',
          'kl-ring': '#27337a',
          'kl-border': '#27337a',
          'kl-dot': '#f2b630',
          'kl-hub': '#27337a',
          'kl-hub-ring': '#f2b630',
          'kl-hub-edge': '#a8202e',
          'kl-title': '#ffffff',
          'kl-file': '#dfe2f5',
          'kl-key': '#f2b630',
          'kl-keytext': '#1b2150',
          'kl-fringe': '#b9a785',
          'kl-knot': '#27337a',
          'kl-weave-opacity': '1',
        },
        dark: {
          bg: '#12142a',
          surface: '#1a1d38',
          'surface-2': '#22264a',
          border: '#33385e',
          'border-strong': '#5a608f',
          text: '#f3efe6',
          'text-muted': '#b7b4c6',
          accent: '#f2b630',
          'on-accent': '#1b1730',
          focus: '#f6c95c',
          success: '#5cc98a',
          'on-success': '#08240f',
          'success-text': '#7ad6a1',
          warning: '#f2b630',
          'warning-text': '#f6c95c',
          danger: '#ff6b6b',
          desk: 'radial-gradient(120% 100% at 50% 18%, #262a52 0%, #16182f 60%, #0f1023 100%)',
          'wheel-face': '#1f2760',
          'wheel-slice': '#1f2760',
          'wheel-slice-hover': '#303c8c',
          'wheel-slice-selected': '#f2b630',
          'wheel-text': '#f7f2e8',
          'wheel-text-selected': '#1b1d45',
          'wheel-line': '#c9303f',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          'kl-sub': '#f6c95c',
          'kl-sub-selected': '#7a1622',
          'kl-band': '#8e1b28',
          'kl-band-div': '#141942',
          'kl-motif': '#f2b630',
          'kl-motif-2': '#f7f2e8',
          'kl-sel-motif': '#f7f2e8',
          'kl-sel-motif-2': '#f2b630',
          'kl-ring': '#f2b630',
          'kl-border': '#141942',
          'kl-dot': '#c9303f',
          'kl-hub': '#a8202e',
          'kl-hub-ring': '#f2b630',
          'kl-hub-edge': '#141942',
          'kl-title': '#ffffff',
          'kl-file': '#ffe3b5',
          'kl-key': '#f2b630',
          'kl-keytext': '#1b1d45',
          'kl-fringe': '#d8ccb4',
          'kl-knot': '#f2b630',
          'kl-weave-opacity': '0.8',
        },
      },
      contrast: Board.DEFAULT_PAIRS.concat([
        ['kl-sub', 'wheel-slice', 'text'],
        ['kl-sub', 'wheel-slice-hover', 'text'],
        ['kl-sub-selected', 'wheel-slice-selected', 'text'],
        ['kl-title', 'kl-hub', 'text'],
        ['kl-file', 'kl-hub', 'text'],
        ['kl-keytext', 'kl-key', 'text'],
        ['kl-motif', 'kl-band', 'ui'],
      ]),
      // One woven cell: a lighter weft at the top, a shaded weft at the bottom, a warp thread at the side.
      defs: `
      <pattern id="kilim-weave" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect x="0" y="0" width="4" height="0.9" fill="#ffffff" fill-opacity=".13"/>
        <rect x="0" y="3" width="4" height="1" fill="#000000" fill-opacity=".13"/>
        <rect x="0" y="0.9" width="0.7" height="2.1" fill="#000000" fill-opacity=".07"/>
      </pattern>`,

      wheel: {
        render(root, m, H) {
          const P = weave(m);
          root.__kilim = P;
          const fr = fringePaths(P);
          const fringe = H.s('g', { class: 'kl-fringe', 'aria-hidden': 'true' }, root);
          H.s('path', { d: fr.threads, class: 'kl-thread' }, fringe);
          H.s('path', { d: fr.knots, class: 'kl-knot' }, fringe);

          const base = H.s('g', { class: 'kl-base', 'aria-hidden': 'true' }, root);
          H.s('path', { d: cellsPath(P.border), class: 'kl-border' }, base);
          H.s('path', { d: cellsPath(P.dots), class: 'kl-dot' }, base);
          H.s('path', { d: cellsPath(P.ring), class: 'kl-ring' }, base);
          H.s('path', { d: cellsPath(P.div), class: 'kl-div' }, base);
          H.s('path', { d: cellsPath(P.bandDiv), class: 'kl-band-div' }, base);
          H.s(
            'path',
            {
              d: cellsPath([...P.border, ...P.dots, ...P.ring, ...P.div, ...P.bandDiv]),
              class: 'kl-tex',
              fill: 'url(#kilim-weave)',
            },
            base,
          );

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: cellsPath(P.field[sl.i]), class: 'kl-field' }, g);
            H.s('path', { d: cellsPath(P.band[sl.i]), class: 'kl-band' }, g);
            const mo = P.motif[sl.i];
            H.s('path', { d: cellsPath(mo.main), class: 'kl-motif' }, g);
            if (mo.second.length) H.s('path', { d: cellsPath(mo.second), class: 'kl-motif-2' }, g);
            H.s(
              'path',
              { d: cellsPath([...P.field[sl.i], ...P.band[sl.i]]), class: 'kl-tex', fill: 'url(#kilim-weave)' },
              g,
            );
            const c = H.s('g', { class: 'kl-ink' }, g);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 21,
                subSize: 13,
                gap: 3,
                maxWidth: 72,
                minSize: 11,
                cls: 'kl-lbl kl-fmt',
                subCls: 'kl-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 13.5,
                gap: 4,
                maxWidth: 74,
                minSize: 9,
                cls: 'kl-lbl kl-word',
                sub: null,
              });
            }
            // More choices: a little woven arrow at the edge of the field, on the weave's own grid.
            H.ringMark(c, sl, m, { r: R.field - 9, size: 12, shape: 'pixel', grid: S, cls: 'kl-ring-mark' });
          }
          hub(root, m, H, P);
        },

        // The lasting look of the selected slice is its rewoven rows; they animate only while applying.
        update(root, m, st, H) {
          const key = st.selected == null ? '' : String(st.selected);
          if (root.dataset.klSel === key) return;
          root.dataset.klSel = key;
          root.querySelectorAll('.kl-rows').forEach((n) => n.remove());
          if (st.selected == null) return;
          const g = root.querySelector(`.slice[data-slice="${st.selected}"]`);
          if (!root.__kilim) root.__kilim = weave(m);
          if (g) weaveRows(g, root.__kilim, m.slices[st.selected], H);
        },
      },

      sounds: {
        // The shuttle thrown through the shed, and a soft wooden knock.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 800, f2: 2600, q: 1.3, dur: 0.13, gain: 0.13, a: 0.03 });
          X.tone(ac, out, t + 0.12, { type: 'triangle', f: 330, f2: 250, dur: 0.05, gain: 0.05, a: 0.002 });
        },
        // The beater comb packing one row: a muffled thud.
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'lowpass', f: 700, q: 0.8, dur: 0.03, gain: 0.1 });
          X.tone(ac, out, t, { f: 170, f2: 115, dur: 0.035, gain: 0.05, a: 0.002 });
        },
        // A shuttle pass, then three packing beats, the last one fullest.
        success(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 1000, f2: 2800, q: 1.2, dur: 0.1, gain: 0.09, a: 0.02 });
          [0.14, 0.27, 0.42].forEach((d, k) => {
            X.burst(ac, out, t + d, { type: 'lowpass', f: 800 + k * 150, q: 0.8, dur: 0.05, gain: 0.08 + k * 0.02 });
            X.tone(ac, out, t + d, { f: 150 - k * 10, f2: 92, dur: 0.07, gain: 0.05 + k * 0.018, a: 0.002 });
          });
          X.tone(ac, out, t + 0.42, { type: 'triangle', f: 392, dur: 0.3, gain: 0.03, a: 0.004 });
        },
      },
    });
  })();
}
