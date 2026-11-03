// SPDX-License-Identifier: MIT
// Theme: Bal peteği (honeycomb). The wheel is a round piece of comb: hexagonal wax cells, each
// slice a group of cells with a capped patch for its label. Applying a slice fills its cells
// with honey, one after another from the hub outward, and a drop falls from the rim.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    const S = 12.6; // cell circumradius (pointy-top hexagons)
    const R = { hub: 56, outer: 187, label: 131 };

    const reducedMotion = () =>
      document.documentElement.classList.contains('reduce-motion') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    function hex(x, y, r, dx = 0, dy = 0) {
      let d = '';
      for (let j = 0; j < 6; j++) {
        const a = rad(j * 60 + 30);
        d += `${j ? 'L' : 'M'}${f2(x + dx + r * Math.cos(a))} ${f2(y + dy + r * Math.sin(a))}`;
      }
      return d + 'Z';
    }

    // Every cell of the comb between the hub and the rim, with its angle (degrees from twelve
    // o'clock, clockwise) and its distance from the center.
    // `ring` is the axial distance from the center cell: rings 0 to 2 make the hub.
    function cells(cx = 200, cy = 200, s = S, rmin = 0, rmax = R.outer) {
      const out = [];
      const w = Math.sqrt(3) * s;
      const rows = Math.ceil(rmax / (1.5 * s)) + 1;
      for (let r = -rows; r <= rows; r++) {
        for (let q = -rows * 2; q <= rows * 2; q++) {
          const x = cx + w * (q + r / 2);
          const y = cy + 1.5 * s * r;
          const dist = Math.hypot(x - cx, y - cy);
          if (dist < rmin || dist > rmax) continue;
          const ang = ((Math.atan2(x - cx, cy - y) * 180) / Math.PI + 360) % 360;
          out.push({ x, y, q, r, dist, ang, ring: (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 });
        }
      }
      return out;
    }
    const HUB_RING = 2;
    const inSlice = (ang, sl) => (((ang - sl.a0) % 360) + 360) % 360 < sl.a1 - sl.a0;

    // The walls between two slices: every cell edge whose neighbour belongs to another slice, so the
    // slices read as groups of cells with any number of them. Neighbours in axial steps, each with
    // the direction (degrees, y down) its shared edge faces.
    const NEAR = [
      [1, 0, 0],
      [0, 1, 60],
      [-1, 1, 120],
      [-1, 0, 180],
      [0, -1, 240],
      [1, -1, 300],
    ];
    function seams(list, owner, s = S) {
      const at = new Map(list.map((c) => [`${c.q},${c.r}`, c]));
      let d = '';
      for (const c of list) {
        const mine = owner(c);
        for (const [dq, dr, face] of NEAR) {
          const n = at.get(`${c.q + dq},${c.r + dr}`);
          if (!n) continue;
          const theirs = owner(n);
          if (theirs < 0 || theirs <= mine) continue;
          const p = (a) => `${f2(c.x + s * Math.cos(rad(a)))} ${f2(c.y + s * Math.sin(rad(a)))}`;
          d += `M${p(face - 30)}L${p(face + 30)}`;
        }
      }
      return d;
    }

    // The capped patch under a slice's label: wider in a wide slice (fewer slices), so a long
    // label gets more room; `room` is the label's width.
    function cap(sl, H) {
      const [x, y] = H.polar(R.label, sl.mid);
      const chord = 2 * R.label * Math.sin(rad(Math.min(sl.step, 180) / 2));
      const rx = Math.max(40, Math.min(54, chord * 0.42));
      const ry = rx > 46 ? 29 : 27;
      return {
        has: (c) => ((c.x - x) / rx) ** 2 + ((c.y - y) / ry) ** 2 <= 1,
        room: Math.round(rx * 1.8),
      };
    }

    // The cell that carries the mark of a slice that opens a ring of choices: the one of its cells
    // nearest the mark's place near the rim, outside the label's patch. Capped like the patch.
    function markCell(mine, sl, patch, H) {
      if (!sl.ring) return null;
      const [x, y] = H.polar(R.outer - 16, sl.mark);
      const free = mine.filter((c) => !patch.has(c) && c.dist <= R.outer - 8);
      return free.reduce((a, c) => (!a || Math.hypot(c.x - x, c.y - y) < Math.hypot(a.x - x, a.y - y) ? c : a), null);
    }

    // A hanging honey drop, its tip at (x, y + len).
    const dropPath = (x, y, w, len) =>
      `M${f2(x - w)} ${f2(y)}C${f2(x - w)} ${f2(y + len * 0.45)} ${f2(x - w * 1.05)} ${f2(y + len * 0.72)} ${f2(x)} ${f2(y + len)}C${f2(x + w * 1.05)} ${f2(y + len * 0.72)} ${f2(x + w)} ${f2(y + len * 0.45)} ${f2(x + w)} ${f2(y)}Z`;

    Board.define({
      id: 'balpetegi',
      fonts: {
        brand: "'Nunito Variable'",
        display: "'Nunito Variable'",
        load: ["'Nunito Variable'"],
        credits: [{ family: 'Nunito', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 170, close: 120, stagger: 14, apply: 700 },

      palette: {
        light: {
          bg: '#f6f8ef',
          surface: '#ffffff',
          'surface-2': '#f0f3e4',
          border: '#dde3cb',
          'border-strong': '#b0b991',
          text: '#2a2208',
          'text-muted': '#5d5636',
          accent: '#9a5806',
          'on-accent': '#ffffff',
          focus: '#3d6b2a',
          success: '#2f7a3d',
          'on-success': '#ffffff',
          'success-text': '#296b36',
          warning: '#b8770b',
          'warning-text': '#7a4e00',
          danger: '#c0362c',
          desk: 'radial-gradient(60% 55% at 70% 20%, rgba(255, 252, 230, 0.9), transparent 70%), linear-gradient(170deg, #e8f1d8 0%, #f1f5e4 50%, #d8e7c3 100%)',
          'wheel-face': '#fff1c4',
          'wheel-slice': '#fbe8ad',
          'wheel-slice-hover': '#fff4cf',
          'wheel-slice-selected': '#ffcc58',
          'wheel-text': '#2a1e05',
          'wheel-text-selected': '#2a1800',
          'wheel-sub': '#5a4716',
          'wheel-line': '#e3b54a',
          'wheel-shadow': 'rgba(90, 80, 20, 0.3)',
          wax: '#fff2c8',
          'wax-edge': '#e6b44a',
          seam: '#c98a1c',
          cell: '#f5e1a2',
          'cell-deep': '#e7c26a',
          'cell-hover': '#ffd261',
          'cell-hover-deep': '#f0b23a',
          cap: '#fbe8ad',
          'cap-hover': '#fff4cf',
          'cap-seam': 'rgba(214, 170, 70, 0.35)',
          honey: '#f4a21c',
          'honey-deep': '#d47f08',
          'honey-cap': '#ffcc58',
          gloss: '#ffffff',
          plate: '#fff3cf',
          'plate-line': '#e3b54a',
          'hub-text': '#2a1e05',
          'hub-muted': '#5a4716',
          'key-bg': '#fffaf0',
          'key-line': '#e3b54a',
        },
        dark: {
          bg: '#141022',
          surface: '#1c172d',
          'surface-2': '#241e38',
          border: '#342c4c',
          'border-strong': '#54497a',
          text: '#fbefd6',
          'text-muted': '#bdb2a0',
          accent: '#ffb93d',
          'on-accent': '#24160a',
          focus: '#c6b3ff',
          success: '#6fd08a',
          'on-success': '#0a2414',
          'success-text': '#7ddb98',
          warning: '#f2b84b',
          'warning-text': '#f5c869',
          danger: '#ff7b6e',
          desk: 'radial-gradient(55% 50% at 50% 50%, rgba(255, 168, 40, 0.16), transparent 72%), linear-gradient(170deg, #201936 0%, #171228 55%, #0f0c1c 100%)',
          'wheel-face': '#d08f22',
          'wheel-slice': '#3a2f43',
          'wheel-slice-hover': '#4b3d52',
          'wheel-slice-selected': '#ffc24d',
          'wheel-text': '#ffecbf',
          'wheel-text-selected': '#24160a',
          'wheel-sub': '#e4cfa3',
          'wheel-line': '#d08f22',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          wax: '#c58a22',
          'wax-edge': '#e9a93a',
          seam: '#ffd57a',
          cell: '#2c2434',
          'cell-deep': '#1d1824',
          'cell-hover': '#6a4a2c',
          'cell-hover-deep': '#4d3624',
          cap: '#3a2f43',
          'cap-hover': '#4b3d52',
          'cap-seam': 'rgba(233, 169, 58, 0.22)',
          honey: '#ffb02a',
          'honey-deep': '#e0860a',
          'honey-cap': '#ffc24d',
          gloss: '#fff6dc',
          plate: '#30273a',
          'plate-line': '#d39424',
          'hub-text': '#ffecbf',
          'hub-muted': '#e4cfa3',
          'key-bg': '#251e2e',
          'key-line': '#d39424',
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
        ['wheel-text-selected', 'honey', 'text'],
        ['hub-text', 'plate', 'text'],
        ['hub-muted', 'plate', 'text'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const every = cells();
          const all = every.filter((c) => c.ring > HUB_RING);
          const comb = H.s('g', { class: 'bp-comb', 'aria-hidden': 'true' }, root);
          H.s('path', { d: every.map((c) => hex(c.x, c.y, S + 1)).join(''), class: 'bp-rim' }, comb);
          H.s('path', { d: every.map((c) => hex(c.x, c.y, S)).join(''), class: 'bp-wax' }, comb);

          const owner = (c) => (c.ring <= HUB_RING ? -1 : m.slices.findIndex((sl) => inSlice(c.ang, sl)));
          H.s('path', { d: seams(every, owner), class: 'bp-seam' }, comb);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.hub, R.outer + 10, sl.a0, sl.a1), class: 'bp-hit' }, g);
            const mine = all.filter((c) => inSlice(c.ang, sl));
            // Cells under the label are capped with wax so the text sits on a calm patch.
            const patch = cap(sl, H);
            const marked = markCell(mine, sl, patch, H);
            const open = mine.filter((c) => !patch.has(c) && c !== marked);
            const caps = mine.filter((c) => patch.has(c) || c === marked);
            const grp = H.s('g', { class: 'bp-cells' }, g);
            H.s('path', { d: open.map((c) => hex(c.x, c.y, S - 1.35)).join(''), class: 'bp-cell' }, grp);
            H.s('path', { d: open.map((c) => hex(c.x, c.y, S * 0.56, 0.7, 1.3)).join(''), class: 'bp-deep' }, grp);
            H.s(
              'path',
              {
                d: open
                  .map(
                    (c) =>
                      `M${f2(c.x - S * 0.5)} ${f2(c.y - S * 0.12)}q${f2(S * 0.12)} ${f2(-S * 0.36)} ${f2(S * 0.46)} ${f2(-S * 0.38)}`,
                  )
                  .join(''),
                class: 'bp-gloss',
              },
              grp,
            );
            // The capped patch is one smooth wax surface (cells drawn over their walls) with faint seams.
            H.s('path', { d: caps.map((c) => hex(c.x, c.y, S + 0.6)).join(''), class: 'bp-cap' }, grp);
            H.s('path', { d: caps.map((c) => hex(c.x, c.y, S - 0.6)).join(''), class: 'bp-cap-seam' }, grp);
            const ink = H.s('g', { class: 'bp-ink' }, g);
            if (sl.format) {
              H.block(ink, sl, R.label, {
                size: 22,
                subSize: 12.5,
                gap: 1,
                maxWidth: patch.room + 2,
                minSize: 9,
                cls: 'bp-lbl',
                subCls: 'bp-sub',
              });
            } else {
              H.block(ink, sl, R.label, {
                icon: true,
                iconSize: 21,
                size: 14,
                gap: 3,
                maxWidth: patch.room,
                minSize: 9,
                cls: 'bp-lbl bp-lbl-s',
                sub: null,
              });
            }
            // More choices: an arrowhead on a capped cell near the rim, pointing out.
            if (marked) {
              const turn = ((((marked.ang - sl.mid) % 360) + 540) % 360) - 180;
              H.ringMark(ink, sl, m, {
                r: marked.dist + 4.5,
                size: 9,
                offset: turn * (m.dir === 'rtl' ? -1 : 1),
                cls: 'bp-ring-mark',
              });
            }
          }

          // Hub: the middle nineteen cells capped into one wax plate, with a flat-topped hexagon inlaid.
          const hub = H.s('g', { class: 'bp-hub' }, root);
          const core = every.filter((c) => c.ring <= HUB_RING);
          H.s('path', { d: core.map((c) => hex(c.x, c.y, S + 2.2)).join(''), class: 'bp-plate-rim' }, hub);
          H.s('path', { d: core.map((c) => hex(c.x, c.y, S + 0.7)).join(''), class: 'bp-plate' }, hub);
          let inlay = '';
          for (let j = 0; j < 6; j++) {
            const a = rad(j * 60);
            inlay += `${j ? 'L' : 'M'}${f2(C + 47 * Math.cos(a))} ${f2(C + 47 * Math.sin(a))}`;
          }
          H.s('path', { d: inlay + 'Z', class: 'bp-plate-line' }, hub);
          const dy = m.key ? 0 : 9;
          H.label(hub, C, C - 14 + dy, m.title, {
            maxWidth: 86,
            size: 16.5,
            minSize: 10,
            cls: 'bp-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 5.5 + dy, m.file, {
            maxWidth: 80,
            size: 11.5,
            minSize: 8.5,
            cls: 'bp-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.6;
            H.s('rect', { x: f2(C - kw / 2), y: C + 17, width: f2(kw), height: 17, rx: 8.5, class: 'bp-key' }, hub);
            H.text(hub, C, C + 26, m.key, { class: 'bp-keytext' });
          }

          H.s('g', { class: 'bp-fx', 'aria-hidden': 'true' }, root);
        },

        onOpen(root) {
          const wrap = root.closest('.wheel');
          if (wrap && wrap.classList.contains('has-selected')) return;
          const fx = root.querySelector('.bp-fx');
          if (fx) fx.textContent = '';
          root.querySelectorAll('.bp-fill').forEach((n) => n.remove());
        },

        // Honey wells up cell by cell (nearest the hub first) and a drop falls from the rim cell.
        onSelect(root, m, i, H, t) {
          const fx = root.querySelector('.bp-fx');
          fx.textContent = '';
          root.querySelectorAll('.bp-fill').forEach((n) => n.remove());
          if (t == null && reducedMotion()) return;
          const sl = m.slices[i];
          const deep = root.querySelector(`.slice[data-slice="${i}"] .bp-deep`);
          const fills = H.s('g', { class: 'bp-fill' });
          deep.parentNode.insertBefore(fills, deep);
          const mine = cells().filter((c) => c.ring > HUB_RING && inSlice(c.ang, sl));
          const patch = cap(sl, H);
          const marked = markCell(mine, sl, patch, H);
          const near = Math.min(...mine.map((c) => c.dist));
          const far = Math.max(...mine.map((c) => c.dist));
          for (const c of mine) {
            if (patch.has(c) || c === marked) continue;
            const d = Math.round(((c.dist - near) / (far - near)) * 300 + ((c.ang * 7) % 40));
            H.s(
              'path',
              {
                d: hex(c.x, c.y, S - 1.35),
                class: 'bp-fill-cell',
                style: `--d: ${d}ms; transform-origin: ${f2(c.x)}px ${f2(c.y + S * 0.6)}px`,
              },
              fills,
            );
          }
          // The outermost cell, a little below the slice's middle when it can, sheds the drop.
          const rim = mine.filter((c) => c.dist > far - S * 1.2).sort((a, b) => b.y - a.y)[0];
          const x = rim.x;
          const y = rim.y + S * 0.62;
          const drop = H.s('g', { class: 'bp-drop', style: `transform-origin: ${f2(x)}px ${f2(y)}px` }, fx);
          H.s('path', { d: dropPath(x, y, 6, 19), class: 'bp-drop-body' }, drop);
          H.s('path', { d: `M${f2(x - 2.4)} ${f2(y + 4)}q-0.6 5 0.9 8.5`, class: 'bp-drop-hi' }, drop);
        },
      },

      sounds: {
        open(ac, out, t) {
          // A short bee buzz: a buzzy tone through a soft filter with a fast wing flutter.
          const o = ac.createOscillator();
          const lfo = ac.createOscillator();
          const depth = ac.createGain();
          const flt = ac.createBiquadFilter();
          const g = ac.createGain();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(190, t);
          o.frequency.linearRampToValueAtTime(235, t + 0.16);
          lfo.frequency.value = 38;
          depth.gain.value = 14;
          lfo.connect(depth).connect(o.frequency);
          flt.type = 'lowpass';
          flt.frequency.value = 1100;
          flt.Q.value = 2;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.035, t + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
          o.connect(flt).connect(g).connect(out);
          o.start(t);
          lfo.start(t);
          o.stop(t + 0.22);
          lfo.stop(t + 0.22);
        },
        tick(ac, out, t, X) {
          // A soft tap on wax.
          X.tone(ac, out, t, { type: 'sine', f: 780, f2: 600, dur: 0.03, gain: 0.055, a: 0.001 });
          X.burst(ac, out, t, { type: 'lowpass', f: 1800, q: 0.7, dur: 0.01, gain: 0.03 });
        },
        success(ac, out, t, X) {
          // Two thick bloops of honey, then a drop falls: plip.
          X.tone(ac, out, t, { type: 'sine', f: 240, f2: 480, dur: 0.09, gain: 0.07, a: 0.004 });
          X.tone(ac, out, t + 0.12, { type: 'sine', f: 290, f2: 560, dur: 0.08, gain: 0.05, a: 0.004 });
          X.tone(ac, out, t + 0.5, { type: 'sine', f: 1500, f2: 720, dur: 0.05, gain: 0.05, a: 0.002 });
          X.burst(ac, out, t + 0.55, { type: 'bandpass', f: 2600, q: 2, dur: 0.02, gain: 0.03 });
        },
      },
    });
  })();
}
