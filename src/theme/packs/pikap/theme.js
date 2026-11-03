// SPDX-License-Identifier: MIT
// Retro technology: Pikap. A record on a turntable seen from above: the slices are wedges of the grooved
// disc, the paper label is the hub and a tonearm waits at the edge of the platter. Applying a slice spins
// the record until that slice comes round under the stylus; the arm swings in, the needle drops onto the
// slice's band, the track lights up and the record plays on with a crackle.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    // Radii: platter rim, record, groove area, label.
    const R = { platter: 198, rim: 186, rec: 183.5, grooveOut: 175, grooveIn: 74, label: 61.5, lbl: 123 };
    // Tonearm (left-to-right layout): pivot, arm joint and stylus at rest; the stylus lands at radius PLAY.
    const ARM = { px: 371, py: 34, jx: 386.5, jy: 186, sx: 390.5, sy: 212, play: 170 };
    const APPLY = 700;
    const TM = { spin: 460, swing: 300, drop0: 395, drop1: 440 };
    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    const deg = (r) => (r * 180) / Math.PI;
    const pol = (r, a) => [C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))];
    const clamp = (x) => Math.max(0, Math.min(1, x));
    const easeOut = (u) => 1 - Math.pow(1 - u, 3);
    const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
    const reducedMotion = () =>
      document.documentElement.classList.contains('reduce-motion') ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    // Where the stylus lands: the point at radius ARM.play that the arm can reach from its pivot, and the
    // arm's swing (degrees, clockwise on screen) from rest to that point. Mirrored for right-to-left.
    function armGeometry(sgn) {
      const mx = (x) => (sgn > 0 ? x : 400 - x);
      const P = [mx(ARM.px), ARM.py];
      const Q = [mx(ARM.sx), ARM.sy];
      const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
      const d = Math.hypot(P[0] - C, P[1] - C);
      const a = (d * d + ARM.play * ARM.play - L * L) / (2 * d);
      const h = Math.sqrt(ARM.play * ARM.play - a * a);
      const u = [(P[0] - C) / d, (P[1] - C) / d];
      const perp = [-u[1] * sgn, u[0] * sgn];
      const N = [C + a * u[0] + h * perp[0], C + a * u[1] + h * perp[1]];
      const swing = deg(Math.atan2(N[1] - P[1], N[0] - P[0]) - Math.atan2(Q[1] - P[1], Q[0] - P[0]));
      const needle = deg(Math.atan2(N[0] - C, C - N[1]));
      return { mx, P, Q, N, swing, needle };
    }

    // The record's turn for slice i: at least one whole turn, ending with the slice under the stylus.
    function spinFor(m, i, geo) {
      const sgn = m.dir === 'rtl' ? -1 : 1;
      const rest = (((sgn * (geo.needle - m.slices[i].mid)) % 360) + 360) % 360;
      return { sgn, total: sgn * (rest + 360), final: sgn * rest };
    }

    // One moment of the apply effect (t in ms): record angle, arm swing, how far the stylus has dropped,
    // and the ripple from the stylus.
    function stateAt(k, t) {
      let phi;
      if (t < TM.spin) phi = (k.total - k.sgn * 10) * easeOut(t / TM.spin);
      else phi = k.total - k.sgn * 10 + k.sgn * 10 * clamp((t - TM.spin) / (APPLY - TM.spin));
      return {
        phi,
        swing: easeInOut(clamp(t / TM.swing)),
        drop: clamp((t - TM.drop0) / (TM.drop1 - TM.drop0)),
        ripple: t > TM.drop1 ? clamp((t - TM.drop1) / (APPLY - TM.drop1)) : -1,
      };
    }

    function paintState(root, s) {
      const geo = root.__pk;
      const rot = `rotate(${f2(s.phi)} ${C} ${C})`;
      for (const g of geo.spinners) g.setAttribute('transform', rot);
      for (const l of geo.labels) l.node.setAttribute('transform', `rotate(${f2(-s.phi)} ${f2(l.x)} ${f2(l.y)})`);
      const sw = geo.swing * s.swing;
      const lift = 1 - s.drop;
      geo.arm.setAttribute('transform', `rotate(${f2(sw)} ${f2(geo.P[0])} ${f2(geo.P[1])})`);
      geo.shadow.setAttribute(
        'transform',
        `translate(${f2(1.8 + 3.4 * lift)} ${f2(2.2 + 4 * lift)}) rotate(${f2(sw)} ${f2(geo.P[0])} ${f2(geo.P[1])})`,
      );
      geo.ripple.style.opacity = s.ripple < 0 ? '0' : f2(1 - s.ripple);
      geo.ripples.forEach((c, j) => c.setAttribute('r', f2(3 + Math.max(0, s.ripple * 30 - j * 9))));
    }

    function stopFx(root) {
      if (root.__pkStop) root.__pkStop();
    }

    function render(root, m, H) {
      // Wider slices (fewer of them) give their labels more room, up to what the grooved band holds.
      const wide = Math.min(96, 2 * R.lbl * Math.sin(rad(Math.min(m.step, 180) / 2)) * 0.78);
      const u = H.uid('pikap');
      const sgn = m.dir === 'rtl' ? -1 : 1;
      const geo = armGeometry(sgn);
      const { mx } = geo;
      const defs = H.s('defs', {}, root);
      defs.innerHTML = `
      <radialGradient id="${u}-rec" gradientUnits="userSpaceOnUse" cx="200" cy="200" r="184">
        <stop offset=".3" style="stop-color:var(--pk-rec-in)"/><stop offset="1" style="stop-color:var(--pk-rec-out)"/></radialGradient>
      <linearGradient id="${u}-plat" gradientUnits="userSpaceOnUse" x1="40" y1="20" x2="360" y2="380">
        <stop offset="0" style="stop-color:var(--pk-metal-hi)"/><stop offset=".5" style="stop-color:var(--pk-metal)"/><stop offset="1" style="stop-color:var(--pk-metal-lo)"/></linearGradient>
      <linearGradient id="${u}-tube" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style="stop-color:var(--pk-metal-lo)"/><stop offset=".4" style="stop-color:var(--pk-metal-hi)"/><stop offset="1" style="stop-color:var(--pk-metal)"/></linearGradient>
      <radialGradient id="${u}-paper" gradientUnits="userSpaceOnUse" cx="186" cy="182" r="72">
        <stop offset="0" style="stop-color:var(--pk-label-hi)"/><stop offset="1" style="stop-color:var(--pk-label)"/></radialGradient>`;

      // Platter rim with its strobe dots; the dots turn with the record.
      const plat = H.s('g', { class: 'pk-platter' }, root);
      H.s('circle', { cx: C, cy: C, r: R.platter, fill: `url(#${u}-plat)` }, plat);
      H.s('circle', { cx: C, cy: C, r: R.platter - 0.6, class: 'pk-plat-edge' }, plat);
      const dots = H.s('g', { class: 'pk-dots' }, H.s('g', { class: 'pk-turn' }, plat));
      H.s('circle', { cx: C, cy: C, r: 192.2, class: 'pk-strobe' }, dots);
      H.s('circle', { cx: C, cy: C, r: R.rim, class: 'pk-plat-step' }, plat);

      // The disc. Slices are wedges that turn with it; the grooves and the light on them stay put.
      H.s('circle', { cx: C, cy: C, r: R.rec, fill: `url(#${u}-rec)`, class: 'pk-disc' }, root);
      const wedges = H.s('g', { class: 'pk-wedges' }, H.s('g', { class: 'pk-turn' }, root));
      const labelsLayer = H.s('g', { class: 'pk-labels' }, root);
      const labels = [];
      for (const sl of m.slices) {
        // The wedge and the label turn with the record; update() mirrors the slice's state onto them.
        H.s(
          'path',
          {
            d: H.sector(R.grooveIn - 2, R.grooveOut + 1, sl.a0 + 0.5, sl.a1 - 0.5),
            class: 'pk-wedge',
            'data-for': sl.i,
          },
          wedges,
        );
        H.s('path', { d: H.arc(179.3, sl.a0 + 4, sl.a1 - 4), class: 'pk-cue', 'data-for': sl.i }, wedges);
        const lg = H.s('g', { class: 'pk-lbl', 'data-for': sl.i }, labelsLayer);
        lg.style.setProperty('--i', sl.i);
        const [x, y] = pol(R.lbl, sl.mid);
        // A format is printed large, with its second line where it has one; tools and actions get an icon.
        if (sl.format) {
          H.block(lg, sl, R.lbl, {
            size: 22,
            subSize: 14.5,
            gap: 0.5,
            maxWidth: wide,
            minSize: 9,
            cls: 'pk-name pk-fmt',
            subCls: 'pk-sub',
          });
        } else {
          H.block(lg, sl, R.lbl, {
            icon: true,
            iconSize: 21,
            size: 14,
            gap: 3,
            maxWidth: wide,
            minSize: 9,
            cls: 'pk-name',
            sub: null,
          });
        }
        labels.push({ node: lg, x, y });
      }
      // Grooves and sheen above the wedges (one foreignObject, never redrawn while the record turns).
      const fo = H.s('foreignObject', {
        x: C - R.rec,
        y: C - R.rec,
        width: 2 * R.rec,
        height: 2 * R.rec,
        class: 'pk-vinyl-fo',
      });
      root.insertBefore(fo, labelsLayer);
      for (const cls of ['pk-grooves', 'pk-sheen']) {
        const d = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        d.setAttribute('class', cls);
        fo.appendChild(d);
      }
      // Track gaps: two smooth rings in the grooves, and the run-out and lead-in edges.
      const gaps = H.s('g', { class: 'pk-gaps' });
      root.insertBefore(gaps, labelsLayer);
      for (const r of [R.grooveIn - 1, R.grooveOut + 0.5]) H.s('circle', { cx: C, cy: C, r, class: 'pk-gap' }, gaps);
      H.s('circle', { cx: C, cy: C, r: R.rec - 0.6, class: 'pk-edge' }, gaps);

      // The paper label: printed rings that turn with the record, the text stays upright.
      const hub = H.s('g', { class: 'pk-hub' }, root);
      H.s('circle', { cx: C, cy: C, r: R.label, fill: `url(#${u}-paper)`, class: 'pk-paper' }, hub);
      const print = H.s('g', { class: 'pk-print' }, H.s('g', { class: 'pk-turn' }, hub));
      H.s('circle', { cx: C, cy: C, r: R.label - 4.5, class: 'pk-print-ring' }, print);
      H.s('path', { d: H.arc(R.label - 9, -58, 58), class: 'pk-print-arc' }, print);
      H.s('path', { d: H.arc(R.label - 9, 122, 238), class: 'pk-print-arc pk-print-thin' }, print);
      H.s('circle', { cx: C, cy: f2(C + R.label - 9), r: 2.2, class: 'pk-print-dot' }, print);
      H.label(hub, C, C - 22, m.title, { maxWidth: 82, size: 19, minSize: 11, cls: 'pk-title', maxLines: 1 });
      H.s('circle', { cx: C, cy: C, r: 4.4, class: 'pk-hole' }, hub);
      H.s('circle', { cx: C, cy: C, r: 2.6, class: 'pk-spindle' }, hub);
      H.label(hub, C, C + 15, m.file, {
        maxWidth: 82,
        size: 11.5,
        minSize: 8.5,
        cls: 'pk-file',
        maxLines: 1,
        attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
      });
      // The key that opened the wheel, when one did.
      if (m.key) {
        const kt = H.text(hub, C, C + 31.2, m.key, { class: 'pk-keytext' });
        const kw = kt.getComputedTextLength() + 12;
        hub.insertBefore(
          H.s('rect', { x: f2(C - kw / 2), y: C + 24.5, width: f2(kw), height: 13.5, rx: 6.75, class: 'pk-key' }),
          kt,
        );
      }

      // Where the stylus touches: a ripple, shown only as the needle lands.
      const ripple = H.s('g', { class: 'pk-ripple' }, root);
      const ripples = [0, 1, 2].map(() =>
        H.s('circle', { cx: f2(geo.N[0]), cy: f2(geo.N[1]), r: 3, class: 'pk-ripple-ring' }, ripple),
      );

      // Tonearm: shadow, then the arm (counterweight, tube, headshell), then the bearing on top.
      const [px, py] = geo.P;
      const J = [mx(ARM.jx), ARM.jy];
      const S = geo.Q;
      const dir = [(J[0] - px) / Math.hypot(J[0] - px, J[1] - py), (J[1] - py) / Math.hypot(J[0] - px, J[1] - py)];
      const cw0 = [px - dir[0] * 8, py - dir[1] * 8];
      const cw1 = [px - dir[0] * 27, py - dir[1] * 27];
      // Headshell: a short plate from the joint past the stylus, turned in toward the record.
      const hs = (dx, dy) => [S[0] + dx, S[1] + dy];
      const shell = [hs(-5 * sgn, -24), hs(5.5 * sgn, -23), hs(6.5 * sgn, 5), hs(-6.5 * sgn, 5.5)];
      const shellD = `M${shell.map((p) => f2(p[0]) + ' ' + f2(p[1])).join('L')}Z`;
      const tubeD = `M${f2(px)} ${f2(py)}L${f2(J[0])} ${f2(J[1])}L${f2(S[0] - 0.5 * sgn)} ${f2(S[1] - 20)}`;
      const lift = `M${f2(S[0] + 5.5 * sgn)} ${f2(S[1] - 14)}l${f2(8 * sgn)} -3.5`;
      const shadow = H.s('g', { class: 'pk-arm-shadow' }, root);
      H.s('path', { d: tubeD, class: 'pk-sh-tube' }, shadow);
      H.s('path', { d: shellD, class: 'pk-sh-shell' }, shadow);
      const arm = H.s('g', { class: 'pk-arm' }, root);
      H.s('path', { d: `M${f2(cw0[0])} ${f2(cw0[1])}L${f2(cw1[0])} ${f2(cw1[1])}`, class: 'pk-weight' }, arm);
      H.s('path', { d: `M${f2(cw0[0])} ${f2(cw0[1])}L${f2(cw1[0])} ${f2(cw1[1])}`, class: 'pk-weight-hi' }, arm);
      H.s('path', { d: tubeD, class: 'pk-tube-edge' }, arm);
      H.s('path', { d: tubeD, class: 'pk-tube', stroke: `url(#${u}-tube)` }, arm);
      H.s('path', { d: lift, class: 'pk-lift' }, arm);
      H.s('path', { d: shellD, class: 'pk-shell' }, arm);
      H.s(
        'path',
        { d: `M${f2(S[0] - 3.5 * sgn)} ${f2(S[1] - 9)}h${f2(7 * sgn)}v8h${f2(-7 * sgn)}Z`, class: 'pk-cart' },
        arm,
      );
      H.s('circle', { cx: f2(S[0]), cy: f2(S[1] + 1.5), r: 1.4, class: 'pk-stylus' }, arm);
      const base = H.s('g', { class: 'pk-base' }, root);
      H.s('circle', { cx: f2(px), cy: f2(py), r: 15, fill: `url(#${u}-plat)`, class: 'pk-bearing' }, base);
      H.s('circle', { cx: f2(px), cy: f2(py), r: 7.5, class: 'pk-bearing-in' }, base);

      // Hit areas stay put while the record spins, so the pointer keeps resting on the slice it chose.
      const hits = H.s('g', { class: 'pk-hits' }, root);
      for (const sl of m.slices)
        H.s('path', { d: H.sector(R.label + 3, R.platter, sl.a0, sl.a1), class: 'pk-hit' }, H.slice(hits, sl, m));

      root.__pk = {
        P: geo.P,
        N: geo.N,
        swing: geo.swing,
        needle: geo.needle,
        spinners: [dots, wedges, labelsLayer, print],
        labels,
        arm,
        shadow,
        ripple,
        ripples,
      };
    }

    // The lasting look of a choice: the record rests with the slice under the lowered stylus.
    function update(root, m, st) {
      const geo = root.__pk;
      root.querySelectorAll('.pk-lbl, .pk-wedge, .pk-cue').forEach((l) => {
        const i = +l.dataset.for;
        l.classList.toggle('is-hover', i === st.hover);
        l.classList.toggle('is-selected', i === st.selected);
      });
      if (root.__pkStop) return;
      if (st.selected == null) {
        paintState(root, { phi: 0, swing: 0, drop: 0, ripple: -1 });
        root.classList.remove('pk-playing');
      } else {
        const k = spinFor(m, st.selected, geo);
        paintState(root, { phi: k.final, swing: 1, drop: 1, ripple: -1 });
        root.classList.add('pk-playing');
      }
    }

    Board.define({
      id: 'pikap',
      fonts: {
        brand: "'Geologica'",
        display: "'Literata'",
        load: ["'Geologica'", "'Literata'"],
        credits: [
          { family: 'Geologica', license: 'SIL Open Font License 1.1' },
          { family: 'Literata', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 190, close: 120, stagger: 9, apply: APPLY },

      palette: {
        light: {
          bg: '#f1f4f7',
          surface: '#ffffff',
          'surface-2': '#f4f6f9',
          border: '#d8dee6',
          'border-strong': '#9eabb9',
          text: '#13202e',
          'text-muted': '#4b5867',
          accent: '#1d3f73',
          'on-accent': '#ffffff',
          focus: '#1d3f73',
          success: '#1f7a50',
          'on-success': '#ffffff',
          'success-text': '#196942',
          warning: '#b7791f',
          'warning-text': '#7a4f0f',
          danger: '#c8382c',
          desk: 'linear-gradient(150deg, #f7f4ef 0%, #edf0f4 50%, #dfe6ee 100%)',
          'wheel-face': '#a8cee7',
          'wheel-slice': '#a8cee7',
          'wheel-slice-hover': '#d4e9f6',
          'wheel-slice-selected': '#1d3f73',
          'wheel-text': '#112236',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#6e9fc2',
          'wheel-shadow': 'rgba(40, 60, 85, 0.3)',
          'pk-sub': '#1f3d5c',
          'pk-rec-in': '#bfdcef',
          'pk-rec-out': '#8fbcdc',
          'pk-groove': 'rgba(31, 70, 110, 0.2)',
          'pk-sheen': 'rgba(255, 255, 255, 0.55)',
          'pk-gap': 'rgba(255, 255, 255, 0.5)',
          'pk-edge': '#6e9fc2',
          'pk-metal-hi': '#fbfcfd',
          'pk-metal': '#d5dbe1',
          'pk-metal-lo': '#8e98a3',
          'pk-metal-edge': '#6f7a85',
          'pk-strobe': '#3a414a',
          'pk-strobe-glow': 'transparent',
          'pk-label': '#ec5a49',
          'pk-label-hi': '#f68a6f',
          'pk-label-ink': '#2a0c07',
          'pk-label-print': 'rgba(42, 12, 7, 0.5)',
          'pk-key': 'rgba(255, 255, 255, 0.4)',
          'pk-shell': '#24282e',
          'pk-arm-shadow': 'rgba(30, 50, 75, 0.28)',
          'pk-ripple': '#ffffff',
          'pk-flash': '#7fb2dc',
          'pk-cue': '#1d3f73',
        },
        dark: {
          bg: '#111214',
          surface: '#1a1b1f',
          'surface-2': '#212328',
          border: '#2e3036',
          'border-strong': '#4a4d55',
          text: '#efece6',
          'text-muted': '#a9a7a1',
          accent: '#f0b54a',
          'on-accent': '#1b1306',
          focus: '#f0b54a',
          success: '#5cc58e',
          'on-success': '#07200f',
          'success-text': '#6fd39f',
          warning: '#e9b44c',
          'warning-text': '#f0c46a',
          danger: '#ff6b5b',
          desk: 'radial-gradient(circle at 78% 14%, #2c2a26 0%, #19191c 52%, #0e0f11 100%)',
          'wheel-face': '#151517',
          'wheel-slice': '#151517',
          'wheel-slice-hover': '#303137',
          'wheel-slice-selected': '#f0b54a',
          'wheel-text': '#efebe3',
          'wheel-text-selected': '#1b1306',
          'wheel-line': '#3a3b40',
          'wheel-shadow': 'rgba(0, 0, 0, 0.65)',
          'pk-sub': '#bdb8ae',
          'pk-rec-in': '#1d1d20',
          'pk-rec-out': '#0d0d0f',
          'pk-groove': 'rgba(255, 255, 255, 0.07)',
          'pk-sheen': 'rgba(255, 255, 255, 0.16)',
          'pk-gap': 'rgba(255, 255, 255, 0.13)',
          'pk-edge': '#3a3b40',
          'pk-metal-hi': '#9aa1a9',
          'pk-metal': '#4a4f56',
          'pk-metal-lo': '#23262a',
          'pk-metal-edge': '#121315',
          'pk-strobe': '#ff7a3d',
          'pk-strobe-glow': 'rgba(255, 122, 61, 0.35)',
          'pk-label': '#b3261e',
          'pk-label-hi': '#d4483a',
          'pk-label-ink': '#fff3e0',
          'pk-label-print': 'rgba(255, 243, 224, 0.45)',
          'pk-key': 'rgba(0, 0, 0, 0.22)',
          'pk-shell': '#0b0c0e',
          'pk-arm-shadow': 'rgba(0, 0, 0, 0.55)',
          'pk-ripple': '#f0b54a',
          'pk-flash': '#ffe2a3',
          'pk-cue': '#f0b54a',
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
        ['pk-sub', 'wheel-slice', 'text'],
        ['pk-sub', 'wheel-slice-hover', 'text'],
        ['pk-label-ink', 'pk-label', 'text'],
      ],

      // No shared defs: every gradient and pattern is made per wheel in render(), because its colors come
      // from the palette tokens of the wheel's own light or dark figure.
      defs: '',
      wheel: {
        render,
        update,
        onOpen(root) {
          stopFx(root);
        },
        onSelect(root, m, i, H, t) {
          stopFx(root);
          if (t == null && (reducedMotion() || !window.requestAnimationFrame)) return;
          const k = spinFor(m, i, root.__pk);
          if (t != null) {
            paintState(root, stateAt(k, t));
            return;
          }
          const t0 = performance.now();
          root.__pkStop = () => {
            cancelAnimationFrame(root.__pkRaf);
            root.__pkStop = null;
            paintState(root, { phi: k.final, swing: 1, drop: 1, ripple: -1 });
          };
          const step = () => {
            const tt = performance.now() - t0;
            if (!root.isConnected || tt >= APPLY) return stopFx(root);
            paintState(root, stateAt(k, tt));
            root.__pkRaf = requestAnimationFrame(step);
          };
          paintState(root, stateAt(k, 0));
          root.__pkRaf = requestAnimationFrame(step);
        },
      },

      sounds: {
        open(ac, out, t, X) {
          // The start button and the platter coming up to speed.
          X.burst(ac, out, t, { type: 'bandpass', f: 2200, q: 2, dur: 0.018, gain: 0.12 });
          X.burst(ac, out, t + 0.01, { type: 'bandpass', f: 180, f2: 520, q: 1.2, dur: 0.2, gain: 0.07, a: 0.05 });
          X.tone(ac, out, t + 0.01, { type: 'sine', f: 55, f2: 75, dur: 0.18, gain: 0.05, a: 0.04 });
        },
        tick(ac, out, t, X) {
          // One dust pop in the groove.
          X.burst(ac, out, t, { type: 'highpass', f: 3200, q: 0.8, dur: 0.006, gain: 0.1 });
          X.burst(ac, out, t + 0.002, { type: 'bandpass', f: 1200, q: 2, dur: 0.008, gain: 0.05 });
        },
        success(ac, out, t, X) {
          const at = (ms) => t + ms / 1000;
          // The spin, then the needle drop: a soft low thump.
          X.burst(ac, out, t, { type: 'bandpass', f: 900, f2: 260, q: 1.4, dur: 0.42, gain: 0.03, a: 0.05 });
          X.tone(ac, out, at(TM.drop1), { type: 'sine', f: 95, f2: 55, dur: 0.12, gain: 0.09, a: 0.003 });
          X.burst(ac, out, at(TM.drop1), { type: 'lowpass', f: 400, q: 0.7, dur: 0.05, gain: 0.08 });
          // Crackle on a bed of surface hiss.
          X.burst(ac, out, at(TM.drop1), { type: 'bandpass', f: 4200, q: 0.6, dur: 0.5, gain: 0.012, a: 0.03 });
          const pops = [0.02, 0.07, 0.095, 0.16, 0.23, 0.27, 0.34, 0.41, 0.47];
          pops.forEach((p, j) =>
            X.burst(ac, out, at(TM.drop1) + p, {
              type: 'highpass',
              f: 2600 + (j % 3) * 900,
              q: 0.7,
              dur: 0.005,
              gain: 0.025 + (j % 2) * 0.02,
            }),
          );
          // The first warm chord of the track.
          for (const [f, g] of [
            [220, 0.022],
            [277.2, 0.016],
            [329.6, 0.016],
            [440, 0.008],
          ]) {
            X.tone(ac, out, at(TM.drop1 + 70), { type: 'triangle', f, dur: 0.42, gain: g, a: 0.06 });
          }
        },
      },
    });
  })();
}
