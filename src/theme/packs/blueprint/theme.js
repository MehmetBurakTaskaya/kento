// SPDX-License-Identifier: MIT
// Mavi kopya: the wheel as a technical drawing. White lines on cyanotype blue (dark) or blue
// lines on a white print (light), over a drafting grid, with centre lines, a diameter dimension
// and a radius leader. Hover hatches the slice like a section cut; applying it dimensions the
// slice with an arc and arrowheads and ticks it off in a balloon, in marking pencil.
export default function register(Board) {
  (function () {
    'use strict';

    const ID = 'blueprint';
    const f2 = (n) => Math.round(n * 100) / 100;

    if (typeof document !== 'undefined' && document.fonts) {
      for (const f of ["500 16px 'Martian Mono'", "600 16px 'Martian Mono'", "700 16px 'Martian Mono'"]) {
        document.fonts.load(f, 'AaĞşı°Ø').catch(() => null);
      }
    }

    // The width a label may take at radius r: the slice's chord there, less a margin, within a cap.
    function roomAt(sl, r, margin, cap) {
      const half = Math.min(sl.step / 2, 70);
      return Math.max(40, Math.min(cap, 2 * r * Math.sin((half * Math.PI) / 180) - margin));
    }

    // Radii in the 400 x 400 view box.
    const R = { paper: 186, rim: 178, hub: 70, lbl: 126, dim: 196, ball_r: 8.5 };

    // Where the balloon goes: inside the slice, clear of the label's box, as far from it as the
    // slice allows (ties go to the clockwise side, so every slice reads the same way).
    function balloonSpot(H, sl, bb) {
      const rb = R.ball_r + 2.5;
      let best = null;
      for (let r = R.hub + rb + 1; r <= R.rim - rb - 1; r += 3) {
        const half = sl.step / 2 - ((rb / r) * 180) / Math.PI;
        if (half <= 0) continue;
        for (let u = -1; u <= 1.001; u += 0.125) {
          const a = sl.mid + u * half;
          const [x, y] = H.polar(r, a);
          const dx = Math.max(bb.x - x, 0, x - (bb.x + bb.width));
          const dy = Math.max(bb.y - y, 0, y - (bb.y + bb.height));
          const clear = Math.hypot(dx, dy) - rb;
          const score = Math.min(clear, 14) + u * 0.6 - Math.abs(r - 150) * 0.02;
          if (!best || score > best.score) best = { score, x, y };
        }
      }
      return [best.x, best.y];
    }

    // A small filled arrowhead with its tip at angle a on radius r, pointing along the circle
    // (dir 1 = clockwise, -1 = counterclockwise).
    function arrowhead(H, r, a, dir, len = 8, half = 2.4) {
      const da = ((len / r) * 180) / Math.PI;
      const [tx, ty] = H.polar(r, a);
      const [b1x, b1y] = H.polar(r - half, a - dir * da);
      const [b2x, b2y] = H.polar(r + half, a - dir * da);
      return `M${f2(tx)} ${f2(ty)}L${f2(b1x)} ${f2(b1y)}L${f2(b2x)} ${f2(b2y)}Z`;
    }
    function line(p, q) {
      return `M${f2(p[0])} ${f2(p[1])}L${f2(q[0])} ${f2(q[1])}`;
    }

    Board.define({
      id: ID,
      fonts: {
        brand: "'Martian Mono'",
        load: ["'Martian Mono'"],
        credits: [{ family: 'Martian Mono', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 170, close: 110, stagger: 12, apply: 620 },

      palette: {
        light: {
          bg: '#eef2f7',
          surface: '#ffffff',
          'surface-2': '#f3f6fa',
          border: '#d3dce8',
          'border-strong': '#9fb0c8',
          text: '#11294f',
          'text-muted': '#4b5f7f',
          accent: '#1b4fa3',
          'on-accent': '#ffffff',
          focus: '#1b4fa3',
          success: '#18804a',
          'on-success': '#ffffff',
          'success-text': '#156c3f',
          warning: '#b5700f',
          'warning-text': '#7c4c05',
          danger: '#c63b2c',
          desk: 'repeating-linear-gradient(0deg, rgba(27, 79, 163, 0.05) 0 1px, transparent 1px 22px), repeating-linear-gradient(90deg, rgba(27, 79, 163, 0.05) 0 1px, transparent 1px 22px), linear-gradient(160deg, #e9eff6 0%, #d9e2ec 100%)',
          'wheel-face': '#fafcff',
          paper: '#fafcff',
          'paper-edge': '#dfe7f2',
          'wheel-slice': '#fafcff',
          'wheel-slice-hover': '#eef4fd',
          'wheel-slice-selected': '#fafcff',
          'slice-tint': 'rgba(27, 79, 163, 0.06)',
          'grid-minor': 'rgba(27, 79, 163, 0.075)',
          'grid-major': 'rgba(27, 79, 163, 0.16)',
          hatch: 'rgba(27, 79, 163, 0.42)',
          'hatch-sel': 'rgba(208, 64, 47, 0.42)',
          'wheel-text': '#123a7c',
          'wheel-sub': '#33578f',
          'wheel-text-selected': '#a52d20',
          'wheel-line': '#1b4fa3',
          'wheel-thin': 'rgba(27, 79, 163, 0.6)',
          'wheel-shadow': 'rgba(27, 60, 110, 0.22)',
          mark: '#cc3b2a',
          'mark-text': '#a52d20',
          note: '#3c5e95',
        },
        dark: {
          bg: '#0b1a33',
          surface: '#102446',
          'surface-2': '#152d55',
          border: '#24406c',
          'border-strong': '#4466a0',
          text: '#eef4ff',
          'text-muted': '#a9bddc',
          accent: '#ffd166',
          'on-accent': '#1a1a10',
          focus: '#ffd166',
          success: '#7ddba3',
          'on-success': '#0b2416',
          'success-text': '#8fe3b1',
          warning: '#ffc35c',
          'warning-text': '#ffcf7a',
          danger: '#ff8a7a',
          desk: 'radial-gradient(120% 90% at 50% 10%, #12305c 0%, #0a1a35 70%, #081428 100%)',
          'wheel-face': '#174c92',
          paper: '#174c92',
          'paper-edge': '#0f3a74',
          'wheel-slice': '#174c92',
          'wheel-slice-hover': '#1d58a4',
          'wheel-slice-selected': '#174c92',
          'slice-tint': 'rgba(255, 255, 255, 0.055)',
          'grid-minor': 'rgba(255, 255, 255, 0.075)',
          'grid-major': 'rgba(255, 255, 255, 0.17)',
          hatch: 'rgba(255, 255, 255, 0.4)',
          'hatch-sel': 'rgba(255, 209, 102, 0.5)',
          'wheel-text': '#ffffff',
          'wheel-sub': '#d3e3fb',
          'wheel-text-selected': '#ffe08f',
          'wheel-line': '#f2f7ff',
          'wheel-thin': 'rgba(242, 247, 255, 0.62)',
          'wheel-shadow': 'rgba(0, 0, 0, 0.5)',
          mark: '#ffd166',
          'mark-text': '#ffe08f',
          note: '#b9cff0',
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
        ['mark-text', 'paper', 'text'],
        ['mark', 'paper', 'ui'],
        ['wheel-line', 'paper', 'ui'],
        ['note', 'bg', 'ui'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const s = H.s;
          const uid = H.uid(ID);
          const defs = s('defs', {}, root);
          const clip = s('clipPath', { id: uid + '-paper' }, defs);
          s('circle', { cx: C, cy: C, r: R.paper }, clip);
          // Section hatching: two patterns, the plain one for hover and the pencil one once selected.
          for (const [suffix, cls, gap] of [
            ['-hatch', 'bp-hl', 6.5],
            ['-hatch-sel', 'bp-hl-sel', 5.5],
          ]) {
            const pat = s(
              'pattern',
              {
                id: uid + suffix,
                width: gap,
                height: gap,
                patternUnits: 'userSpaceOnUse',
                patternTransform: 'rotate(45)',
              },
              defs,
            );
            s('line', { x1: 0, y1: 0, x2: 0, y2: gap, class: cls }, pat);
          }
          const shadow = s('radialGradient', { id: uid + '-sh', cx: 0.5, cy: 0.5, r: 0.5 }, defs);
          s('stop', { offset: 0.9, class: 'bp-st-sh' }, shadow);
          s('stop', { offset: 1, class: 'bp-st-sh0' }, shadow);

          // Sheet: shadow, paper, grid.
          const sheet = s('g', { class: 'bp-sheet', 'aria-hidden': 'true' }, root);
          s('circle', { cx: C, cy: C + 5, r: R.paper + 8, fill: `url(#${uid}-sh)` }, sheet);
          s('circle', { cx: C, cy: C, r: R.paper, class: 'bp-paper' }, sheet);
          let minor = '',
            major = '';
          for (let v = 10; v < 400; v += 10) {
            const seg = `M${v} 10V390M10 ${v}H390`;
            if (v % 50 === 0) major += seg;
            else minor += seg;
          }
          const grid = s('g', { class: 'bp-grid', 'clip-path': `url(#${uid}-paper)` }, sheet);
          s('path', { d: minor, class: 'bp-grid-minor' }, grid);
          s('path', { d: major, class: 'bp-grid-major' }, grid);

          // Slices: tint, hatching, a knockout behind the words, the dimension, the balloon, the words.
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const wedge = H.sector(R.hub, R.rim, sl.a0, sl.a1);
            s('path', { d: wedge, class: 'bp-fill' }, g);
            s('path', { d: wedge, class: 'bp-hatch', fill: `url(#${uid}-hatch)` }, g);
            s('path', { d: wedge, class: 'bp-hatch-sel', fill: `url(#${uid}-hatch-sel)` }, g);
            const ko = s('rect', { class: 'bp-knock', rx: 2 }, g);
            // Angular dimension outside the rim, as on a drawing: extension lines carry the slice
            // lines past the rim, the arc runs between them with arrowheads, the angle sits on it.
            const dim = s('g', { class: 'bp-dim' }, g);
            const txt = `${Math.round(sl.step)}°`;
            const gapDeg = ((13 / R.dim) * 180) / Math.PI;
            s(
              'path',
              {
                d:
                  line(H.polar(R.rim + 3, sl.a0), H.polar(R.dim + 6, sl.a0)) +
                  line(H.polar(R.rim + 3, sl.a1), H.polar(R.dim + 6, sl.a1)),
                class: 'bp-dim-ext',
              },
              dim,
            );
            // Each half is drawn from the middle out to its arrowhead.
            s(
              'path',
              { d: H.arc(R.dim, sl.a0 + 0.3, sl.mid - gapDeg), class: 'bp-dim-line bp-dim-a', pathLength: 1 },
              dim,
            );
            s(
              'path',
              { d: H.arc(R.dim, sl.mid + gapDeg, sl.a1 - 0.3), class: 'bp-dim-line bp-dim-b', pathLength: 1 },
              dim,
            );
            s(
              'path',
              { d: arrowhead(H, R.dim, sl.a0 + 0.3, -1) + arrowhead(H, R.dim, sl.a1 - 0.3, 1), class: 'bp-dim-heads' },
              dim,
            );
            const [tx, ty] = H.polar(R.dim, sl.mid);
            H.text(dim, tx, ty + 0.5, txt, { class: 'bp-dim-text' });
            const ball = s('g', { class: 'bp-ball' }, g);
            const ink = s('g', { class: 'bp-ink' }, g);
            const room = roomAt(sl, R.lbl, 20, 124);
            if (sl.format) {
              H.block(ink, sl, R.lbl, {
                size: 20,
                subSize: 11,
                gap: 3,
                maxWidth: room,
                minSize: 9,
                cls: 'bp-lbl bp-fmt',
                subCls: 'bp-sub',
              });
            } else {
              H.block(ink, sl, R.lbl, {
                icon: true,
                iconSize: 23,
                size: 11.5,
                gap: 4,
                maxWidth: room + 4,
                minSize: 8,
                cls: 'bp-lbl bp-word',
                sub: null,
              });
            }
            // The knockout: hatching breaks around lettering on a drawing.
            const bb = ink.getBBox();
            if (bb.width) {
              ko.setAttribute('x', f2(bb.x - 4));
              ko.setAttribute('y', f2(bb.y - 2));
              ko.setAttribute('width', f2(bb.width + 8));
              ko.setAttribute('height', f2(bb.height + 4));
            }
            // Balloon with a tick: the spot in the slice farthest from the lettering.
            const [bx, by] = balloonSpot(H, sl, bb);
            s('circle', { cx: f2(bx), cy: f2(by), r: R.ball_r, class: 'bp-ball-ring', pathLength: 1 }, ball);
            s(
              'path',
              {
                d: `M${f2(bx - 4.2)} ${f2(by + 0.2)}L${f2(bx - 1.2)} ${f2(by + 3.3)}L${f2(bx + 4.6)} ${f2(by - 3.6)}`,
                class: 'bp-ball-tick',
                pathLength: 1,
              },
              ball,
            );
          }

          // Object lines: the rim (thick), an inner rule, slice lines drawn from the hub out, the hub.
          const lines = s('g', { class: 'bp-lines', 'aria-hidden': 'true' }, root);
          s('circle', { cx: C, cy: C, r: R.paper, class: 'bp-obj bp-rim' }, lines);
          s('circle', { cx: C, cy: C, r: R.rim, class: 'bp-thin' }, lines);
          m.slices.forEach((sl, k) => {
            const p = s(
              'path',
              { d: line(H.polar(R.hub, sl.a0), H.polar(R.rim, sl.a0)), class: 'bp-obj bp-div', pathLength: 1 },
              lines,
            );
            p.style.setProperty('--i', k);
          });
          s('circle', { cx: C, cy: C, r: R.hub, class: 'bp-obj' }, lines);
          s('circle', { cx: C, cy: C, r: R.hub - 4, class: 'bp-thin' }, lines);
          // Centre lines past the rim on the four axes.
          let cl = '';
          for (const a of [0, 90, 180, 270]) cl += line(H.polar(R.paper - 12, a), H.polar(R.paper + 13, a));
          s('path', { d: cl, class: 'bp-center' }, lines);

          // Margin notes: diameter dimension below, radius leader top left, slice count top right.
          const notes = s('g', { class: 'bp-notes', 'aria-hidden': 'true' }, root);
          const x0 = C - R.paper,
            x1 = C + R.paper,
            yd = 395;
          s('path', { d: `M${x0} ${C + 6}V${yd + 4}M${x1} ${C + 6}V${yd + 4}`, class: 'bp-note-line' }, notes);
          s('path', { d: `M${x0 + 1} ${yd}H${C - 22}M${C + 22} ${yd}H${x1 - 1}`, class: 'bp-note-line' }, notes);
          s('path', { d: `M${x0} ${yd}l7 -2.2v4.4zM${x1} ${yd}l-7 -2.2v4.4z`, class: 'bp-note-head' }, notes);
          H.text(notes, C, yd + 0.5, `Ø${R.paper * 2}`, { class: 'bp-note-text' });
          const lead = m.dir === 'rtl' ? 45 : 315;
          const [lx, ly] = H.polar(R.paper, lead);
          const side = m.dir === 'rtl' ? 1 : -1;
          s(
            'path',
            {
              d: `M${f2(lx)} ${f2(ly)}L${f2(lx + side * 26)} ${f2(ly - 26)}H${f2(lx + side * 52)}`,
              class: 'bp-note-line',
            },
            notes,
          );
          // Arrowhead at the rim, pointing back down the leader.
          const ux = -side / Math.SQRT2,
            uy = 1 / Math.SQRT2;
          const bxm = lx - 7 * ux,
            bym = ly - 7 * uy;
          s(
            'path',
            {
              d: `M${f2(lx)} ${f2(ly)}L${f2(bxm - 2.4 * uy)} ${f2(bym + 2.4 * ux)}L${f2(bxm + 2.4 * uy)} ${f2(bym - 2.4 * ux)}Z`,
              class: 'bp-note-head',
            },
            notes,
          );
          H.text(notes, f2(lx + side * 39), f2(ly - 32), `R${R.paper}`, { class: 'bp-note-text' });
          H.text(notes, m.dir === 'rtl' ? 26 : 374, 28, `${m.n}×${Math.round(m.step)}°`, { class: 'bp-note-text' });

          // Hub as a small title block: name, file, and the key in its own cell.
          const hub = s('g', { class: 'bp-hub' }, root);
          const chord = (y) => {
            const w = Math.sqrt(Math.max(0, (R.hub - 4) ** 2 - (y - C) ** 2));
            return `M${f2(C - w)} ${y}H${f2(C + w)}`;
          };
          if (m.key) {
            s('path', { d: chord(C - 2) + chord(C + 17), class: 'bp-thin' }, hub);
            H.label(hub, C, C - 19, m.title, { maxWidth: 104, size: 13.5, minSize: 9, cls: 'bp-title', maxLines: 1 });
            H.label(hub, C, C + 7.5, m.file, { maxWidth: 100, size: 10, minSize: 7.5, cls: 'bp-file', maxLines: 1 });
            const kt = H.text(hub, C, C + 29, m.key.toUpperCase(), { class: 'bp-keytext' });
            const kw = kt.getComputedTextLength() + 12;
            s('rect', { x: f2(C - kw / 2), y: C + 22, width: f2(kw), height: 14, class: 'bp-key' }, hub);
          } else {
            // No key: two cells, the name over the file.
            s('path', { d: chord(C + 4), class: 'bp-thin' }, hub);
            H.label(hub, C, C - 12, m.title, { maxWidth: 104, size: 13.5, minSize: 9, cls: 'bp-title', maxLines: 1 });
            H.label(hub, C, C + 16, m.file, { maxWidth: 100, size: 10, minSize: 7.5, cls: 'bp-file', maxLines: 1 });
          }
        },
      },

      sounds: {
        // A drafting sheet laid flat on the table.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'lowpass', f: 900, f2: 300, q: 0.7, dur: 0.12, gain: 0.2, a: 0.012 });
          X.burst(ac, out, t + 0.01, { type: 'bandpass', f: 4200, q: 1.2, dur: 0.07, gain: 0.025, a: 0.02 });
        },
        // A precise pen tick against a straightedge.
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'highpass', f: 4200, q: 0.8, dur: 0.008, gain: 0.12 });
          X.tone(ac, out, t, { type: 'sine', f: 2450, dur: 0.014, gain: 0.03, a: 0.0008 });
        },
        // The dimension line hisses out, two arrowheads tick, a pencil check, a soft stamp.
        success(ac, out, t, X) {
          X.burst(ac, out, t + 0.02, { type: 'bandpass', f: 3200, f2: 5200, q: 3, dur: 0.22, gain: 0.05, a: 0.03 });
          X.burst(ac, out, t + 0.22, { type: 'highpass', f: 4600, q: 0.8, dur: 0.008, gain: 0.11 });
          X.burst(ac, out, t + 0.27, { type: 'highpass', f: 4300, q: 0.8, dur: 0.008, gain: 0.1 });
          X.burst(ac, out, t + 0.37, { type: 'bandpass', f: 2600, f2: 3600, q: 2.2, dur: 0.035, gain: 0.07 });
          X.burst(ac, out, t + 0.415, { type: 'bandpass', f: 3400, f2: 4400, q: 2.2, dur: 0.05, gain: 0.08 });
          X.tone(ac, out, t + 0.5, { type: 'sine', f: 170, f2: 110, dur: 0.1, gain: 0.12, a: 0.003 });
          X.burst(ac, out, t + 0.5, { type: 'lowpass', f: 700, q: 0.7, dur: 0.05, gain: 0.08 });
        },
      },
    });
  })();
}
