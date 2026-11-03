// SPDX-License-Identifier: MIT
// Retro technology: Radar. Dark: a round scope with amber phosphor on deep navy glass, range rings, bearing
// lines and a sweep that follows the pointer with its afterglow. Light: the same picture as a paper plotting
// board, with a clear plastic ruler for the sweep and grease-pencil marks. Applying a slice runs one full
// sweep round the scope; as it passes the slice the target locks: brackets close in (a pencil circle on
// paper), the wedge lights and two sonar rings spread from it.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const R = { bezel: 198, glass: 185, hub: 60, lbl: 124, blip: 167 };
    const RINGS = [100, 142];
    const APPLY = 700;
    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    const pol = (r, a) => [C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))];
    const reducedMotion = () =>
      document.documentElement.classList.contains('reduce-motion') ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    // The sweep rests on the boundary before the first slice (in reading order), so at rest it never seems
    // to pick one, however many slices there are and however a ring of choices is turned.
    const restAngle = (m) => (m.dir === 'rtl' ? m.slices[0].a1 : m.slices[0].a0);
    // The slice boundary nearest to an angle.
    function boundaryNear(m, target) {
      let best = target;
      let gap = Infinity;
      for (const sl of m.slices) {
        const d = Math.abs(((((sl.a0 - target) % 360) + 540) % 360) - 180);
        if (d < gap - 1e-6) {
          gap = d;
          best = sl.a0;
        }
      }
      return best;
    }
    // Contacts drawn on the scope at rest: two in the outer band, where no label reaches, and two near the
    // centre on bearing lines between slices, so none ever sits on a label.
    const contactsFor = (m, sgn) => [
      [sgn * 34, 172],
      [boundaryNear(m, sgn * 158), 90],
      [sgn * 207, 170],
      [boundaryNear(m, sgn * 304), 90],
    ];

    function lockBrackets(g, x, y, w, h) {
      const k = 9;
      const d = [
        `M${f2(x - w / 2)} ${f2(y - h / 2 + k)}V${f2(y - h / 2)}H${f2(x - w / 2 + k)}`,
        `M${f2(x + w / 2 - k)} ${f2(y - h / 2)}H${f2(x + w / 2)}V${f2(y - h / 2 + k)}`,
        `M${f2(x + w / 2)} ${f2(y + h / 2 - k)}V${f2(y + h / 2)}H${f2(x + w / 2 - k)}`,
        `M${f2(x - w / 2 + k)} ${f2(y + h / 2)}H${f2(x - w / 2)}V${f2(y + h / 2 - k)}`,
      ].join('');
      return d;
    }

    // A grease-pencil loop round the label: an ellipse drawn a little past its start, slightly uneven.
    function pencilLoop(x, y, rx, ry) {
      let d = '';
      for (let k = 0; k <= 26; k++) {
        const a = rad(200 + (k / 26) * 400);
        const wob = 1 + 0.035 * Math.sin(k * 1.7) + (k > 20 ? 0.06 * ((k - 20) / 6) : 0);
        const px = x + rx * wob * Math.cos(a);
        const py = y + ry * wob * Math.sin(a);
        d += (k ? 'L' : 'M') + f2(px) + ' ' + f2(py);
      }
      return d;
    }

    function render(root, m, H) {
      // Wider slices (fewer of them) give their labels more room, up to what the scope's band holds.
      const wide = Math.min(100, 2 * R.lbl * Math.sin(rad(Math.min(m.step, 180) / 2)) * 0.78);
      const u = H.uid('radar');
      const sgn = m.dir === 'rtl' ? -1 : 1;
      const defs = H.s('defs', {}, root);
      defs.innerHTML = `
      <radialGradient id="${u}-glass" gradientUnits="userSpaceOnUse" cx="200" cy="200" r="186">
        <stop offset="0" style="stop-color:var(--rd-glass-in)"/><stop offset=".78" style="stop-color:var(--wheel-face)"/><stop offset="1" style="stop-color:var(--rd-glass-out)"/></radialGradient>
      <linearGradient id="${u}-bezel" gradientUnits="userSpaceOnUse" x1="60" y1="20" x2="340" y2="380">
        <stop offset="0" style="stop-color:var(--rd-bezel-hi)"/><stop offset=".5" style="stop-color:var(--rd-bezel)"/><stop offset="1" style="stop-color:var(--rd-bezel-lo)"/></linearGradient>`;

      // Bezel with the bearing scale.
      const bezel = H.s('g', { class: 'rd-bezel' }, root);
      H.s('circle', { cx: C, cy: C, r: R.bezel, fill: `url(#${u}-bezel)` }, bezel);
      let ticks = '';
      for (let k = 0; k < 72; k++) {
        const a = k * 5;
        const len = k % 6 === 0 ? 0 : k % 2 === 0 ? 4.5 : 2.6;
        if (!len) continue;
        const [x0, y0] = pol(R.glass + 1.5, a);
        const [x1, y1] = pol(R.glass + 1.5 + len, a);
        ticks += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
      }
      H.s('path', { d: ticks, class: 'rd-ticks' }, bezel);
      for (let k = 0; k < 12; k++) {
        const a = k * 30;
        const [x, y] = pol(191.6, a);
        const n = String(a).padStart(3, '0');
        H.text(bezel, f2(x), f2(y), n, {
          class: 'rd-deg',
          transform: `rotate(${a > 90 && a < 270 ? a + 180 : a} ${f2(x)} ${f2(y)})`,
        });
      }

      // Glass (or paper), grid, contacts.
      H.s('circle', { cx: C, cy: C, r: R.glass, fill: `url(#${u}-glass)`, class: 'rd-glass' }, root);
      const grid = H.s('g', { class: 'rd-grid' }, root);
      let spokes = '';
      for (let k = 0; k < 24; k++) {
        const a = k * 15;
        const [x0, y0] = pol(R.hub + 2, a);
        const [x1, y1] = pol(R.glass, a);
        spokes += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
      }
      H.s('path', { d: spokes, class: 'rd-spokes' }, grid);
      let bounds = '';
      for (const sl of m.slices) {
        const [x0, y0] = pol(R.hub + 2, sl.a0);
        const [x1, y1] = pol(R.glass, sl.a0);
        bounds += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
      }
      H.s('path', { d: bounds, class: 'rd-bounds' }, grid);
      for (const r of RINGS) H.s('circle', { cx: C, cy: C, r, class: 'rd-ring' }, grid);
      H.s('circle', { cx: C, cy: C, r: R.glass - 1, class: 'rd-ring rd-ring-out' }, grid);

      // Slices: the hit wedge, the lit wedge, then (drawn above the sweep) the label and the lock marks.
      const wedgeLayer = H.s('g', { class: 'rd-wedges' }, root);
      const groups = [];
      for (const sl of m.slices) {
        const g = H.slice(wedgeLayer, sl, m);
        H.s('path', { d: H.sector(R.hub + 1, R.bezel, sl.a0, sl.a1), class: 'rd-hit' }, g);
        H.s('path', { d: H.sector(R.hub + 3, R.glass - 2, sl.a0 + 0.6, sl.a1 - 0.6), class: 'rd-wedge' }, g);
        groups.push(g);
      }

      const contacts = H.s('g', { class: 'rd-contacts' }, root);
      for (const [a, r] of contactsFor(m, sgn)) {
        const [x, y] = pol(r, a);
        H.s('circle', { cx: f2(x), cy: f2(y), r: 5.5, class: 'rd-c-glow' }, contacts);
        H.s('circle', { cx: f2(x), cy: f2(y), r: 2, class: 'rd-c-dot' }, contacts);
        H.s(
          'path',
          { d: `M${f2(x - 3.2)} ${f2(y - 3.2)}l6.4 6.4M${f2(x + 3.2)} ${f2(y - 3.2)}l-6.4 6.4`, class: 'rd-c-mark' },
          contacts,
        );
      }

      // The sweep: an afterglow (CSS conic gradient, drawn once) and the beam; update() turns the outer group,
      // the apply effect spins the inner one a full turn.
      const sweep = H.s('g', { class: 'rd-sweep' }, root);
      const spin = H.s('g', { class: 'rd-spin' }, sweep);
      spin.style.setProperty('--rd-dir', sgn);
      const fo = H.s(
        'foreignObject',
        { x: C - R.glass, y: C - R.glass, width: 2 * R.glass, height: 2 * R.glass, class: 'rd-trail-fo' },
        spin,
      );
      const trail = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
      trail.setAttribute('class', 'rd-trail' + (sgn < 0 ? ' rd-trail-rtl' : ''));
      fo.appendChild(trail);
      // On paper the sweep is a clear plastic ruler with a scale along its edge.
      const ruler = H.s('g', { class: 'rd-ruler' }, spin);
      const rw = 15 * sgn;
      H.s(
        'path',
        {
          d: `M${C - 1.5 * sgn} ${C - R.hub - 3}V${C - R.glass + 1}H${C + rw}V${C - R.hub - 3}Z`,
          class: 'rd-ruler-body',
        },
        ruler,
      );
      let rt = '';
      for (let k = 0, y = C - R.hub - 8; y > C - R.glass + 4; k++, y -= 6)
        rt += `M${C + rw}${' '}${y}h${f2(-(k % 5 === 0 ? 7 : 3.5) * sgn)}`;
      H.s('path', { d: rt, class: 'rd-ruler-ticks' }, ruler);
      H.s('path', { d: `M${C} ${C - R.hub - 2}V${C - R.glass + 1}`, class: 'rd-beam-glow' }, spin);
      H.s('path', { d: `M${C} ${C - R.hub - 2}V${C - R.glass + 1}`, class: 'rd-beam' }, spin);

      // Labels and lock marks sit above the beam, so it passes under the words; update() mirrors each slice's
      // state onto its group here.
      const tops = H.s('g', { class: 'rd-tops' }, root);
      groups.forEach((g, i) => {
        const sl = m.slices[i];
        const top = H.s('g', { class: 'rd-top' + (sl.off ? ' is-off' : ''), 'data-for': i }, tops);
        top.style.setProperty('--i', i);
        const [x, y] = pol(R.lbl, sl.mid);
        const [bx, by] = pol(R.blip, sl.mid);
        H.s('circle', { cx: f2(x), cy: f2(y), r: 8, class: 'rd-ping' }, top);
        H.s('circle', { cx: f2(x), cy: f2(y), r: 8, class: 'rd-ping rd-ping-2' }, top);
        const ink = H.s('g', { class: 'rd-ink' }, top);
        // A format is printed large, with its second line where it has one; tools and actions get an icon.
        if (sl.format) {
          H.block(ink, sl, R.lbl, {
            size: 19,
            subSize: 11.5,
            gap: 2.5,
            maxWidth: wide,
            minSize: 8.5,
            cls: 'rd-lbl rd-fmt',
            subCls: 'rd-sub',
          });
        } else {
          H.block(ink, sl, R.lbl, {
            icon: true,
            iconSize: 20,
            size: 11.5,
            gap: 3,
            maxWidth: wide,
            minSize: 8,
            cls: 'rd-lbl',
            sub: null,
          });
        }
        // The lock frames the label it was drawn round, however wide.
        let bw = 84;
        let bh = 52;
        try {
          const box = ink.getBBox();
          bw = Math.max(bw, box.width + 18);
          bh = Math.max(bh, box.height + 14);
        } catch {
          // Not measurable (not on screen): the usual frame.
        }
        const lock = H.s('g', { class: 'rd-lock' }, top);
        H.s('path', { d: lockBrackets(null, x, y, bw, bh), class: 'rd-lock-halo' }, lock);
        H.s('path', { d: lockBrackets(null, x, y, bw, bh), class: 'rd-lock-line' }, lock);
        H.s('path', { d: pencilLoop(x, y, bw / 2 + 6, bh / 2 + 5), class: 'rd-pencil', pathLength: 100 }, top);
        H.s('circle', { cx: f2(bx), cy: f2(by), r: 4.2, class: 'rd-target' }, top);
        H.s(
          'path',
          {
            d: `M${f2(bx - 5)} ${f2(by + 4.2)}L${f2(bx)} ${f2(by - 4.6)}L${f2(bx + 5)} ${f2(by + 4.2)}Z`,
            class: 'rd-target-tri',
          },
          top,
        );
        // More choices: an arrowhead just inside the glass's rim, above the beam like the label.
        H.ringMark(top, sl, m, { r: R.glass - 8, size: 9, halo: 1.2, cls: 'rd-ring-mark' });
      });

      // Hub: own position, the wheel's name, the file and the key.
      const hub = H.s('g', { class: 'rd-hub' }, root);
      H.s('circle', { cx: C, cy: C, r: R.hub, class: 'rd-hub-disc' }, hub);
      let hubTicks = '';
      for (let k = 0; k < 4; k++) {
        const [x0, y0] = pol(R.hub - 6, k * 90);
        const [x1, y1] = pol(R.hub, k * 90);
        hubTicks += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
      }
      H.s('path', { d: hubTicks, class: 'rd-hub-ticks' }, hub);
      H.label(hub, C, C - 17, m.title.toLocaleUpperCase(m.lang), {
        maxWidth: 88,
        size: 12.5,
        minSize: 8,
        cls: 'rd-title',
        maxLines: 1,
      });
      H.label(hub, C, C + 1.5, m.file, {
        maxWidth: 88,
        size: 10.5,
        minSize: 7.5,
        cls: 'rd-file',
        maxLines: 1,
        attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
      });
      // The key that opened the wheel, when one did.
      if (m.key) {
        const kt = H.text(hub, C, C + 21.6, m.key, { class: 'rd-keytext' });
        const kw = kt.getComputedTextLength() + 12;
        hub.insertBefore(
          H.s('rect', { x: f2(C - kw / 2), y: C + 14.5, width: f2(kw), height: 14.5, rx: 2, class: 'rd-key' }),
          kt,
        );
      }
    }

    // The sweep follows the pointer the short way round and rests on a boundary.
    function update(root, m, st) {
      root.querySelectorAll('.rd-top').forEach((g) => {
        const i = +g.dataset.for;
        g.classList.toggle('is-hover', i === st.hover);
        g.classList.toggle('is-selected', i === st.selected);
      });
      const target = st.hover ?? st.selected;
      const goal = target == null ? restAngle(m) : m.slices[target].mid;
      const sw = root.querySelector('.rd-sweep');
      const prev = sw.__a;
      const next = prev == null ? goal : prev + ((((goal - prev) % 360) + 540) % 360) - 180;
      sw.__a = next;
      if (prev == null) {
        sw.style.transition = 'none';
        sw.style.transform = `rotate(${f2(next)}deg)`;
        void sw.getBoundingClientRect();
        sw.style.transition = '';
      } else {
        // With reduced motion the sweep jumps instead of swinging.
        sw.style.transition = reducedMotion() ? 'transform 60ms linear' : '';
        sw.style.transform = `rotate(${f2(next)}deg)`;
      }
      root.classList.toggle('rd-aiming', target != null);
    }

    Board.define({
      id: 'radar',
      fonts: {
        brand: "'Martian Mono'",
        load: ["'Martian Mono'"],
        credits: [{ family: 'Martian Mono', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 170, close: 110, stagger: 11, apply: APPLY },

      palette: {
        light: {
          bg: '#eef2f4',
          surface: '#ffffff',
          'surface-2': '#f3f6f7',
          border: '#d3dde1',
          'border-strong': '#97abb3',
          text: '#14262e',
          'text-muted': '#4a5d65',
          accent: '#24576e',
          'on-accent': '#ffffff',
          focus: '#24576e',
          success: '#1f7a4f',
          'on-success': '#ffffff',
          'success-text': '#196942',
          warning: '#b7791f',
          'warning-text': '#7a4f0f',
          danger: '#d2382b',
          desk: 'linear-gradient(160deg, #f1f4f5 0%, #e3eaed 55%, #d6e0e4 100%)',
          'wheel-face': '#fbfaf5',
          'wheel-slice': '#fbfaf5',
          'wheel-slice-hover': '#e2eef2',
          'wheel-slice-selected': '#ffe27a',
          'wheel-text': '#173b4b',
          'wheel-text-selected': '#1c2a2f',
          'wheel-line': '#24576e',
          'wheel-shadow': 'rgba(30, 60, 75, 0.28)',
          'rd-sub': '#3d5f6d',
          'rd-glass-in': '#ffffff',
          'rd-glass-out': '#ece9de',
          'rd-bezel': '#f3f1e8',
          'rd-bezel-hi': '#ffffff',
          'rd-bezel-lo': '#d9d5c6',
          'rd-bezel-ink': '#24576e',
          'rd-edge': '#9aa9ae',
          'rd-grid': 'rgba(36, 87, 110, 0.42)',
          'rd-grid-faint': 'rgba(36, 87, 110, 0.16)',
          'rd-beam': '#24576e',
          'rd-trail': 'rgba(36, 87, 110, 0.13)',
          'rd-beam-glow': 'rgba(36, 87, 110, 0.12)',
          'rd-lock': '#d2382b',
          'rd-lock-halo': 'transparent',
          'rd-flash': '#ffd23f',
          'rd-ping': '#d2382b',
          'rd-target': '#d2382b',
          'rd-scope': '0',
          'rd-paper': '1',
          'rd-hub': '#f1efe6',
          'rd-hub-ink': '#173b4b',
          'rd-key': '#ffffff',
        },
        dark: {
          bg: '#0c1117',
          surface: '#141b23',
          'surface-2': '#1a232d',
          border: '#26323e',
          'border-strong': '#405060',
          text: '#f1e9da',
          'text-muted': '#a9b2ba',
          accent: '#ffb547',
          'on-accent': '#1a1004',
          focus: '#ffc56e',
          success: '#5cc58e',
          'on-success': '#07200f',
          'success-text': '#6fd39f',
          warning: '#ffb547',
          'warning-text': '#ffc56e',
          danger: '#ff6b5b',
          desk: 'radial-gradient(circle at 50% 38%, #18232f 0%, #0d141b 58%, #080b10 100%)',
          'wheel-face': '#0b1720',
          'wheel-slice': '#0b1720',
          'wheel-slice-hover': '#2b2919',
          'wheel-slice-selected': '#ffb547',
          'wheel-text': '#ffd89c',
          'wheel-text-selected': '#1a1004',
          'wheel-line': '#ffb547',
          'wheel-shadow': 'rgba(0, 0, 0, 0.66)',
          'rd-sub': '#d9a865',
          'rd-glass-in': '#11222e',
          'rd-glass-out': '#050c13',
          'rd-bezel': '#202a34',
          'rd-bezel-hi': '#3a4652',
          'rd-bezel-lo': '#0f151b',
          'rd-bezel-ink': '#a9b7c4',
          'rd-edge': '#05080b',
          'rd-grid': 'rgba(255, 181, 71, 0.3)',
          'rd-grid-faint': 'rgba(255, 181, 71, 0.11)',
          'rd-beam': '#ffd089',
          'rd-trail': 'rgba(255, 181, 71, 0.32)',
          'rd-beam-glow': 'rgba(255, 181, 71, 0.35)',
          'rd-lock': '#2a1904',
          'rd-lock-halo': '#ffd089',
          'rd-flash': '#ffe6b8',
          'rd-ping': '#ffb547',
          'rd-target': '#fff1d6',
          'rd-scope': '1',
          'rd-paper': '0',
          'rd-hub': '#0e1b25',
          'rd-hub-ink': '#ffd89c',
          'rd-key': '#16242f',
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
        ['rd-sub', 'wheel-slice', 'text'],
        ['rd-sub', 'wheel-slice-hover', 'text'],
        ['rd-hub-ink', 'rd-hub', 'text'],
      ],

      // No shared defs: every gradient and pattern is made per wheel in render(), because its colors come
      // from the palette tokens of the wheel's own light or dark figure.
      defs: '',
      wheel: { render, update },

      sounds: {
        open(ac, out, t, X) {
          // The scope powers up: a low thump and a soft rising tone.
          X.tone(ac, out, t, { type: 'triangle', f: 90, f2: 70, dur: 0.06, gain: 0.06, a: 0.003 });
          X.tone(ac, out, t + 0.01, { f: 240, f2: 720, dur: 0.16, gain: 0.03, a: 0.04 });
          X.burst(ac, out, t, { type: 'bandpass', f: 2400, q: 3, dur: 0.05, gain: 0.03, a: 0.01 });
        },
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { f: 1760, f2: 1700, dur: 0.026, gain: 0.04, a: 0.002 });
        },
        success(ac, out, t, X) {
          // The sweep comes round (0.36 s): two quick lock beeps, then a long falling sonar ping and its echo.
          X.tone(ac, out, t + 0.33, { type: 'square', f: 1568, dur: 0.028, gain: 0.014, a: 0.002 });
          X.tone(ac, out, t + 0.39, { type: 'square', f: 1568, dur: 0.028, gain: 0.014, a: 0.002 });
          X.tone(ac, out, t + 0.36, { f: 1180, f2: 1090, dur: 0.95, gain: 0.07, a: 0.004 });
          X.tone(ac, out, t + 0.36, { f: 2360, f2: 2180, dur: 0.3, gain: 0.012, a: 0.004 });
          X.tone(ac, out, t + 0.6, { f: 1170, f2: 1090, dur: 0.6, gain: 0.022, a: 0.01 });
        },
      },
    });
  })();
}
