// SPDX-License-Identifier: MIT
// Theme: Lolipop. A big swirl candy on a stick: every slice is one twisting pastel arm between
// white sugar stripes, under a glossy shine and a dusting of sugar. Applying cracks the arm:
// a zigzag crack splits it, the outer shard jumps, and sugar crystals sparkle out.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const ID = 'lolipop';
    // Radii in the 400 x 400 view box. The arms twist by TW degrees from the hub to the rim,
    // centered on the label radius, so every label still sits on its slice's own angle.
    const R = { hub: 46, disc: 176, lbl: 111, crack: 151 };
    const TW = 32;
    const tw = (r) => TW * ((r - R.hub) / (R.disc - R.hub) - 0.5);
    const STICK = 135; // the stick leaves the candy toward the lower right

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
    const reducedMotion = () => document.documentElement.classList.contains('reduce-motion');
    const dot = (x, y, r) =>
      `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
    const star = (x, y, s) =>
      `M${f2(x)} ${f2(y - s)}L${f2(x + s * 0.24)} ${f2(y - s * 0.24)}L${f2(x + s)} ${f2(y)}L${f2(x + s * 0.24)} ${f2(y + s * 0.24)}L${f2(x)} ${f2(y + s)}L${f2(x - s * 0.24)} ${f2(y + s * 0.24)}L${f2(x - s)} ${f2(y)}L${f2(x - s * 0.24)} ${f2(y - s * 0.24)}Z`;
    function stop(grad, H, offset, token, op) {
      H.s('stop', { offset, style: `stop-color: var(${token})${op != null ? `; stop-opacity: ${op}` : ''}` }, grad);
    }

    // Points along the twisted boundary that starts at angle a, from radius r0 to r1.
    function edge(H, a, r0, r1, steps = 14) {
      const pts = [];
      for (let k = 0; k <= steps; k++) {
        const r = r0 + ((r1 - r0) * k) / steps;
        pts.push(H.polar(r, a + tw(r)));
      }
      return pts;
    }
    const line = (pts, first = 'M') => pts.map(([x, y], k) => (k ? 'L' : first) + f2(x) + ' ' + f2(y)).join('');
    // The crack across an arm at radius R.crack, from its a0 edge to its a1 edge.
    function crackPts(H, sl) {
      const pts = [];
      const n = 7;
      for (let k = 0; k <= n; k++) {
        const a = sl.a0 + ((sl.a1 - sl.a0) * k) / n;
        const r = R.crack + (k === 0 || k === n ? 0 : k % 2 ? 5 : -4);
        pts.push(H.polar(r, a + tw(r)));
      }
      return pts;
    }
    function armPath(H, sl, r0, r1) {
      const a = edge(H, sl.a0, r0, r1);
      const b = edge(H, sl.a1, r0, r1).reverse();
      return (
        line(a) +
        `A${r1} ${r1} 0 0 1 ${f2(b[0][0])} ${f2(b[0][1])}` +
        line(b.slice(1), 'L') +
        `A${r0} ${r0} 0 0 0 ${f2(a[0][0])} ${f2(a[0][1])}Z`
      );
    }
    // The arm broken in two along the crack.
    function innerPiece(H, sl) {
      const a = edge(H, sl.a0, R.hub, R.crack, 10);
      const b = edge(H, sl.a1, R.hub, R.crack, 10).reverse();
      return (
        line(a) +
        line(crackPts(H, sl).slice(1), 'L') +
        line(b.slice(1), 'L') +
        `A${R.hub} ${R.hub} 0 0 0 ${f2(a[0][0])} ${f2(a[0][1])}Z`
      );
    }
    function outerPiece(H, sl) {
      const a = edge(H, sl.a0, R.crack, R.disc, 4);
      const b = edge(H, sl.a1, R.crack, R.disc, 4).reverse();
      return (
        line(a) +
        `A${R.disc} ${R.disc} 0 0 1 ${f2(b[0][0])} ${f2(b[0][1])}` +
        line(b.slice(1), 'L') +
        line(crackPts(H, sl).reverse().slice(1), 'L') +
        'Z'
      );
    }

    Board.define({
      id: ID,
      fonts: {
        brand: "'Sour Gummy'",
        load: ["'Sour Gummy'"],
        credits: [{ family: 'Sour Gummy', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 190, close: 120, stagger: 12, apply: 640 },
      palette: {
        light: {
          bg: '#fdf7fb',
          surface: '#ffffff',
          'surface-2': '#faf0f7',
          border: '#efd9e8',
          'border-strong': '#d3a7c6',
          text: '#2e1238',
          'text-muted': '#6b4f73',
          accent: '#b3124f',
          'on-accent': '#ffffff',
          focus: '#7a3fc4',
          success: '#2f8a5a',
          'on-success': '#ffffff',
          'success-text': '#22704a',
          warning: '#b86e00',
          'warning-text': '#7a4800',
          danger: '#c8243b',
          desk: 'radial-gradient(120% 100% at 20% 10%, #ffffff 0%, #fdf0f7 40%, #e8eefc 100%)',
          'wheel-face': '#fffaf3',
          'wheel-slice': '#ffbfd2',
          'wheel-slice-hover': '#ff8fb3',
          'wheel-slice-selected': '#b3124f',
          'wheel-text': '#341040',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#fffaf3',
          'wheel-shadow': 'rgba(120, 60, 140, 0.25)',
          'lp-c1': '#ffbfd2',
          'lp-c2': '#b4ecd6',
          'lp-c3': '#fff0a0',
          'lp-c4': '#dccbf5',
          'lp-h1': '#ff8fb3',
          'lp-h2': '#7fdcb8',
          'lp-h3': '#ffdc5c',
          'lp-h4': '#c3a6f0',
          'lp-stripe': '#fffaf3',
          'lp-core': '#fffaf3',
          'lp-rim': 'rgba(150, 70, 140, 0.35)',
          'lp-gloss': '#ffffff',
          'lp-gloss-op': '0.6',
          'lp-sugar': '#ffffff',
          'lp-sugar-op': '0.9',
          'lp-crack': '#fffaf3',
          'lp-sub': '#4a1a55',
          'lp-sub-sel': '#ffe3ee',
          'lp-stick': '#fffdf8',
          'lp-stick-line': '#f4c2d6',
          'lp-stick-edge': '#e6d6de',
          'lp-bow': '#ff7aa8',
          'lp-bow-dark': '#d94c82',
          'lp-hub-text': '#341040',
          'lp-hub-sub': '#6b4f73',
          'lp-key': '#b3124f',
          'lp-key-text': '#ffffff',
          'lp-ring': '#ffbfd2',
          'lp-crystal-a': '#ffffff',
          'lp-crystal-b': '#ff8fb3',
          'lp-crystal-c': '#7fdcb8',
        },
        dark: {
          bg: '#120d1e',
          surface: '#1c1530',
          'surface-2': '#251c3c',
          border: '#372a55',
          'border-strong': '#56447f',
          text: '#f6effc',
          'text-muted': '#bcaed6',
          accent: '#ff8fbe',
          'on-accent': '#2a0618',
          focus: '#c9a6ff',
          success: '#6fd3a0',
          'on-success': '#06210f',
          'success-text': '#86e0b4',
          warning: '#ffbf5a',
          'warning-text': '#ffd080',
          danger: '#ff6b85',
          desk: 'radial-gradient(110% 100% at 75% 10%, #2e2152 0%, #1a1233 45%, #0c0918 100%)',
          'wheel-face': '#f6eaf6',
          'wheel-slice': '#8e1650',
          'wheel-slice-hover': '#b01d66',
          'wheel-slice-selected': '#ffb8d4',
          'wheel-text': '#ffffff',
          'wheel-text-selected': '#3a0a22',
          'wheel-line': '#f6eaf6',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'lp-c1': '#8e1650',
          'lp-c2': '#0e6a63',
          'lp-c3': '#a8360b',
          'lp-c4': '#5b2a9e',
          'lp-h1': '#b01d66',
          'lp-h2': '#0f7d74',
          'lp-h3': '#c2410c',
          'lp-h4': '#7438c0',
          'lp-stripe': '#f6eaf6',
          'lp-core': '#f6eaf6',
          'lp-rim': 'rgba(255, 255, 255, 0.25)',
          'lp-gloss': '#ffffff',
          'lp-gloss-op': '0.4',
          'lp-sugar': '#ffffff',
          'lp-sugar-op': '0.85',
          'lp-crack': '#2a0a22',
          'lp-sub': '#fff4f9',
          'lp-sub-sel': '#5a1238',
          'lp-stick': '#efe6f0',
          'lp-stick-line': '#b86a9a',
          'lp-stick-edge': '#9a8aa6',
          'lp-bow': '#ff7aa8',
          'lp-bow-dark': '#c43c74',
          'lp-hub-text': '#3a0a22',
          'lp-hub-sub': '#6b3a58',
          'lp-key': '#8e1650',
          'lp-key-text': '#ffffff',
          'lp-ring': '#b01d66',
          'lp-crystal-a': '#ffffff',
          'lp-crystal-b': '#ffb8d4',
          'lp-crystal-c': '#9ff0d8',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['wheel-text', 'lp-c1', 'text'],
        ['wheel-text', 'lp-c2', 'text'],
        ['wheel-text', 'lp-c3', 'text'],
        ['wheel-text', 'lp-c4', 'text'],
        ['wheel-text', 'lp-h1', 'text'],
        ['wheel-text', 'lp-h2', 'text'],
        ['wheel-text', 'lp-h3', 'text'],
        ['wheel-text', 'lp-h4', 'text'],
        ['lp-sub', 'lp-c1', 'text'],
        ['lp-sub', 'lp-c2', 'text'],
        ['lp-sub', 'lp-c3', 'text'],
        ['lp-sub', 'lp-c4', 'text'],
        ['lp-sub', 'lp-h1', 'text'],
        ['lp-sub', 'lp-h2', 'text'],
        ['lp-sub', 'lp-h3', 'text'],
        ['lp-sub', 'lp-h4', 'text'],
        ['lp-sub-sel', 'wheel-slice-selected', 'text'],
        ['lp-hub-text', 'lp-core', 'text'],
        ['lp-hub-sub', 'lp-core', 'text'],
        ['lp-key-text', 'lp-key', 'text'],
      ],
      // Gradients are built per wheel in render(): they read the palette tokens of their own card.
      defs: '',

      wheel: {
        render(root, m, H) {
          const uid = H.uid(ID);
          const rand = rng(2718 + m.n);
          const defs = H.s('defs', {}, root);
          const sh = H.s(
            'radialGradient',
            { id: `${uid}-shadow`, gradientUnits: 'userSpaceOnUse', cx: 206, cy: 212, r: R.disc + 14 },
            defs,
          );
          stop(sh, H, 0.85, '--wheel-shadow');
          stop(sh, H, 1, '--wheel-shadow', 0);
          const gl = H.s(
            'radialGradient',
            { id: `${uid}-gloss`, gradientUnits: 'userSpaceOnUse', cx: 150, cy: 120, r: 190 },
            defs,
          );
          stop(gl, H, 0, '--lp-gloss', 0.32);
          stop(gl, H, 0.55, '--lp-gloss', 0);

          // The stick with its bow, under the candy.
          const back = H.s('g', { class: 'lp-back', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: 206, cy: 212, r: R.disc + 14, fill: `url(#${uid}-shadow)` }, back);
          const [s0x, s0y] = H.polar(R.disc - 20, STICK);
          const [s1x, s1y] = H.polar(R.disc + 96, STICK);
          H.s('path', { d: `M${f2(s0x)} ${f2(s0y)}L${f2(s1x)} ${f2(s1y)}`, class: 'lp-stick-edge' }, back);
          H.s('path', { d: `M${f2(s0x)} ${f2(s0y)}L${f2(s1x)} ${f2(s1y)}`, class: 'lp-stick' }, back);
          let lines = '';
          for (let k = 0; k < 7; k++) {
            const [x, y] = H.polar(R.disc + 14 + k * 12, STICK);
            lines += `M${f2(x - 6)} ${f2(y + 1)}L${f2(x + 1)} ${f2(y - 6)}`;
          }
          H.s('path', { d: lines, class: 'lp-stick-line' }, back);
          const [bx, by] = H.polar(R.disc + 6, STICK);
          const bow = H.s('g', { class: 'lp-bow', transform: `translate(${f2(bx)} ${f2(by)}) rotate(-45)` }, back);
          H.s(
            'path',
            {
              d: 'M0 0C-6 -14 -20 -14 -20 -3C-20 6 -8 6 0 0ZM0 0C6 -14 20 -14 20 -3C20 6 8 6 0 0Z',
              class: 'lp-bow-loop',
            },
            bow,
          );
          H.s('path', { d: 'M-2 2L-9 16L-4 15L-1 19ZM2 2L9 16L4 15L1 19Z', class: 'lp-bow-tail' }, bow);
          H.s('circle', { cx: 0, cy: 0, r: 3.6, class: 'lp-bow-knot' }, bow);
          // The candy under the arms shows through the cracks.
          H.s('circle', { cx: 200, cy: 200, r: R.disc + 1, class: 'lp-base' }, root);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const fam = (sl.i % 4) + 1;
            g.style.setProperty('--arm', `var(--lp-c${fam})`);
            g.style.setProperty('--arm-h', `var(--lp-h${fam})`);
            const t = H.rad(sl.mid);
            g.style.setProperty('--ux', f2(Math.sin(t)));
            g.style.setProperty('--uy', f2(-Math.cos(t)));
            const lift = H.s('g', { class: 'lp-lift' }, g);
            H.s('path', { d: armPath(H, sl, R.hub, R.disc), class: 'lp-arm' }, lift);
            const broken = H.s('g', { class: 'lp-broken' }, lift);
            H.s('path', { d: innerPiece(H, sl), class: 'lp-piece' }, broken);
            const shard = H.s('g', { class: 'lp-shard' }, broken);
            H.s('path', { d: outerPiece(H, sl), class: 'lp-piece' }, shard);
            H.s('path', { d: line(crackPts(H, sl)), class: 'lp-crack', pathLength: 1 }, broken);
            // A bright lick of light along the rim of the arm under the pointer.
            const [q0x, q0y] = H.polar(R.disc - 9, sl.a0 + tw(R.disc - 9) + 6);
            const [q1x, q1y] = H.polar(R.disc - 9, sl.a1 + tw(R.disc - 9) - 6);
            H.s(
              'path',
              {
                d: `M${f2(q0x)} ${f2(q0y)}A${R.disc - 9} ${R.disc - 9} 0 0 1 ${f2(q1x)} ${f2(q1y)}`,
                class: 'lp-rimlight',
              },
              lift,
            );
            // The shine sits under the label, so the text keeps its full color.
            H.s('path', { d: armPath(H, sl, R.hub, R.disc), fill: `url(#${uid}-gloss)`, class: 'lp-sheen' }, lift);
            if (sl.off) H.s('path', { d: armPath(H, sl, R.hub, R.disc), class: 'lp-off' }, lift);
            const c = H.s('g', { class: 'lp-content' }, lift);
            if (m.kind === 'convert' && sl.sub) {
              const parts = H.block(c, sl, R.lbl, {
                size: 27,
                subSize: 13,
                gap: -1,
                maxWidth: 68,
                minSize: 11,
                cls: 'lp-lbl lp-fmt',
                subCls: 'lp-sub',
              });
              // The sub-label sits where the swirl narrows the arm a little, so it gets less room.
              if (parts.sub) H.fitWidth(parts.sub, 60, +parts.sub.getAttribute('font-size'), 10);
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 15,
                gap: 2,
                maxWidth: 60,
                minSize: 9.5,
                cls: 'lp-lbl lp-word',
                sub: null,
              });
            }
            H.s('g', { class: 'lp-fx' }, g);
          }

          // Sugar stripes along the swirl, the shine, a dusting of sugar and the rim.
          const top = H.s('g', { class: 'lp-top', 'aria-hidden': 'true' }, root);
          let stripes = '';
          for (const sl of m.slices) stripes += line(edge(H, sl.a0, R.hub, R.disc, 16));
          H.s('path', { d: stripes, class: 'lp-stripes' }, top);
          const [g0x, g0y] = H.polar(R.disc - 14, 284);
          const [g1x, g1y] = H.polar(R.disc - 14, 338);
          H.s(
            'path',
            {
              d: `M${f2(g0x)} ${f2(g0y)}A${R.disc - 14} ${R.disc - 14} 0 0 1 ${f2(g1x)} ${f2(g1y)}`,
              class: 'lp-gloss',
            },
            top,
          );
          let sugar = '';
          let sparks = '';
          for (let k = 0; k < 46; k++) {
            const ring = rand() < 0.62;
            const r = ring ? R.disc - 26 + rand() * 22 : R.hub + 6 + rand() * 20;
            const [x, y] = H.polar(r, rand() * 360);
            if (k % 6 === 0) sparks += star(x, y, 2.6 + rand() * 2.2);
            else sugar += dot(x, y, 0.5 + rand() * 0.8);
          }
          H.s('path', { d: sugar, class: 'lp-sugar' }, top);
          H.s('path', { d: sparks, class: 'lp-spark' }, top);
          H.s('circle', { cx: 200, cy: 200, r: R.disc, class: 'lp-rim' }, top);

          // The hub: a round of plain candy with the name, the file and the key.
          const hub = H.s('g', { class: 'lp-hub' }, root);
          H.s('circle', { cx: 200, cy: 200, r: R.hub, class: 'lp-core' }, hub);
          H.label(hub, 200, 184, m.title, { maxWidth: 80, size: 17, minSize: 11, cls: 'lp-title', maxLines: 1 });
          H.label(hub, 200, 201, m.file, {
            maxWidth: 76,
            size: 12,
            minSize: 9,
            cls: 'lp-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          const kw = 14 + m.key.length * 6.3;
          H.s('rect', { x: f2(200 - kw / 2), y: 210, width: f2(kw), height: 16, rx: 8, class: 'lp-key' }, hub);
          H.text(hub, 200, 218.5, m.key, { class: 'lp-keytext' });
        },

        // Sugar crystals burst from the crack and twinkle away; built for the effect only.
        onSelect(root, m, i, H, t) {
          root.querySelectorAll('.lp-fx').forEach((n) => (n.textContent = ''));
          if (t == null && reducedMotion()) return;
          const g = root.querySelector(`.slice[data-slice="${i}"]`);
          const sl = m.slices[i];
          const fx = g.querySelector('.lp-fx');
          const rand = rng(99 + i * 7);
          const pts = crackPts(H, sl);
          const cols = ['a', 'b', 'c'];
          for (let k = 0; k < 18; k++) {
            const [px, py] = pts[1 + Math.floor(rand() * (pts.length - 2))];
            const a = sl.mid + (rand() - 0.5) * 120;
            const dist = 20 + rand() * 46;
            const ta = H.rad(a);
            const at = H.s('g', { transform: `translate(${f2(px)} ${f2(py)})` }, fx);
            const fly = H.s('g', { class: 'lp-crystal' }, at);
            fly.style.setProperty('--dx', f2(Math.sin(ta) * dist) + 'px');
            fly.style.setProperty('--dy', f2(-Math.cos(ta) * dist) + 'px');
            fly.style.setProperty('--rot', Math.round((rand() - 0.5) * 360) + 'deg');
            fly.style.setProperty('--d', Math.round(90 + rand() * 60) + 'ms');
            const s = 2 + rand() * 2.6;
            H.s(
              'path',
              {
                d: `M0 ${f2(-s * 1.3)}L${f2(s * 0.8)} 0L0 ${f2(s * 1.3)}L${f2(-s * 0.8)} 0Z`,
                class: 'lp-crystal-' + cols[k % 3],
              },
              fly,
            );
          }
          for (let k = 0; k < 4; k++) {
            const [px, py] = pts[1 + Math.floor(rand() * (pts.length - 2))];
            const ox = (rand() - 0.5) * 50;
            const oy = (rand() - 0.5) * 50;
            const at = H.s('g', { transform: `translate(${f2(px + ox)} ${f2(py + oy)})` }, fx);
            const tw2 = H.s('path', { d: star(0, 0, 6 + rand() * 4), class: 'lp-twinkle' }, at);
            tw2.style.setProperty('--d', Math.round(120 + k * 90 + rand() * 40) + 'ms');
          }
          if (t != null) return;
          clearTimeout(root.__lpFx);
          root.__lpFx = setTimeout(() => (fx.textContent = ''), 720);
        },
      },

      sounds: {
        // A crinkle of cellophane wrapper.
        open(ac, out, t, X) {
          [0, 0.018, 0.031, 0.052, 0.07, 0.088].forEach((d, k) =>
            X.burst(ac, out, t + d, {
              type: 'highpass',
              f: 4800 + ((k * 911) % 2200),
              q: 0.7,
              dur: 0.012 + (k % 3) * 0.006,
              gain: 0.07 - k * 0.006,
            }),
          );
          X.tone(ac, out, t + 0.02, { type: 'sine', f: 620, f2: 940, dur: 0.06, gain: 0.03, a: 0.004 });
        },
        // A small bubble pop.
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'sine', f: 520, f2: 1150, dur: 0.03, gain: 0.07, a: 0.001 });
        },
        // A sharp crack, then a sparkling arpeggio.
        success(ac, out, t, X) {
          X.burst(ac, out, t + 0.08, { type: 'highpass', f: 2400, q: 0.8, dur: 0.03, gain: 0.2 });
          X.burst(ac, out, t + 0.095, { type: 'bandpass', f: 1300, q: 2, dur: 0.02, gain: 0.1 });
          X.tone(ac, out, t + 0.08, { type: 'sine', f: 280, f2: 150, dur: 0.06, gain: 0.06, a: 0.002 });
          [2093, 2637, 3136, 4186].forEach((f, k) =>
            X.tone(ac, out, t + 0.16 + k * 0.045, { type: 'sine', f, dur: 0.14, gain: 0.028 - k * 0.003, a: 0.004 }),
          );
        },
      },
    });
  })();
}
