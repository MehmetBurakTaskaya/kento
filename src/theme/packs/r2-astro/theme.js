// SPDX-License-Identifier: MIT
// Astronomy: three variants of one idea. The wheel is a piece of the sky, and applying
// a slice sends its light into the center, where something settles.
//   astro-a  Star atlas: the slice's constellation streaks into the pole and forms a new star.
//   astro-b  Galaxy and black hole: the slice's light spirals into the hole, which flashes a lensing ring.
//   astro-c  Orrery: the slice's planet slingshots into the sun, which flares and keeps a corona.
// Every constellation, planet, glyph and icon here is our own construction.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const f1 = (n) => Math.round(n * 10) / 10;
    const f2 = (n) => Math.round(n * 100) / 100;
    const f3 = (n) => Math.round(n * 1000) / 1000;
    const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
    const lerp = (a, b, u) => a + (b - a) * u;
    const span = (t, t0, t1) => clamp((t - t0) / (t1 - t0)); // progress of t between t0 and t1
    const easeOut = (u) => 1 - (1 - u) ** 3;
    const easeInOut = (u) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);
    const rad = (a) => (a * Math.PI) / 180;
    // Angles in degrees from twelve o'clock, clockwise, like the engine's H.polar.
    const P = (r, a, cx = C, cy = C) => [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))];
    const pt = (p) => `${f2(p[0])} ${f2(p[1])}`;
    const poly = (pts) => 'M' + pts.map(pt).join('L');
    const angDiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;
    const reducedMotion = () => document.documentElement.classList.contains('reduce-motion');

    // Seeded generator: star fields land in the same places on every render and in every still frame.
    function rng(seed) {
      let s = seed % 2147483647 || 1;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    }

    // A full circle starting at twelve o'clock, so it can be drawn in with pathLength 1.
    function circlePath(r, ccw) {
      const sw = ccw ? 0 : 1;
      return `M${C} ${C - r}a${r} ${r} 0 1 ${sw} 0 ${2 * r}a${r} ${r} 0 1 ${sw} 0 ${-2 * r}`;
    }
    const dotPath = (x, y, r) =>
      `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0`;

    // A four-pointed star with concave sides. k moves the curve controls along the diagonals:
    // 0 gives a waist of 0.35 r, negative values a slimmer star, positive values a fuller one.
    function sparkle(x, y, r, k = -0.2, rot = 0) {
      const tips = [0, 90, 180, 270].map((a) => P(r, a + rot, x, y));
      const ctl = [45, 135, 225, 315].map((a) => P(r * k, a + rot, x, y));
      let d = `M${pt(tips[0])}`;
      for (let q = 0; q < 4; q++) d += `Q${pt(ctl[q])} ${pt(tips[(q + 1) % 4])}`;
      return d + 'Z';
    }

    // A filled outline around a center line whose width follows w(u): a soft arm or a tapered trail.
    function taper(pts, w) {
      const n = pts.length - 1;
      const left = [];
      const right = [];
      pts.forEach((p, k) => {
        const a = pts[Math.max(0, k - 1)];
        const b = pts[Math.min(n, k + 1)];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        const h = w(p[2]) / 2;
        left.push([p[0] - (dy / len) * h, p[1] + (dx / len) * h]);
        right.push([p[0] + (dy / len) * h, p[1] - (dx / len) * h]);
      });
      return poly(left) + 'L' + right.reverse().map(pt).join('L') + 'Z';
    }

    // Gradients are made per wheel, inside its own SVG, so their stop colors come from the theme tokens
    // of the element the wheel sits in (a gradient in the shared defs would resolve them at the root).
    function gradient(H, defs, type, id, attrs, stops) {
      const g = H.s(type, Object.assign({ id }, attrs), defs);
      for (const [offset, cls, op] of stops)
        H.s('stop', { offset, class: cls, 'stop-opacity': op == null ? 1 : op }, g);
      return `url(#${id})`;
    }

    // Ellipses around each label: field stars stay out of them, so labels never sit on a speck.
    const labelZones = (m, r, twist = () => 0) =>
      m.slices.map((sl) => {
        const [x, y] = P(r, sl.mid + twist(r));
        return m.kind === 'convert' && sl.sub ? [x, y, 40, 27] : [x, y, 44, 29];
      });
    const inZone = (x, y, zones) => zones.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1);

    // ------------------------------------------------------------------ hub text, shared
    // Wheel name, the dragged file and the key; on Convert the key gives way to a pill that previews
    // the result ("photo.png") while a format is hovered or chosen.
    function hubText(H, parent, m, o) {
      const txt = H.s('g', { class: 'ast-hubtext' }, parent);
      H.label(txt, C, o.yTitle, m.title, {
        maxWidth: o.wTitle,
        size: o.sTitle,
        minSize: 11,
        cls: 'ast-title',
        maxLines: 1,
      });
      H.label(txt, C, o.yFile, m.file, {
        maxWidth: o.wFile,
        size: o.sFile || 12,
        minSize: 9,
        cls: 'ast-file',
        maxLines: 1,
      });
      const kw = 16 + m.key.length * 6.6;
      const key = H.s('g', { class: 'ast-key' }, txt);
      H.s(
        'rect',
        {
          x: f1(C - kw / 2),
          y: o.yKey - 9,
          width: f1(kw),
          height: 18,
          rx: o.keyRx == null ? 4 : o.keyRx,
          class: 'ast-keycap',
        },
        key,
      );
      H.text(key, C, o.yKey + 0.5, m.key, { class: 'ast-keytext' });
      if (m.kind === 'convert') {
        const res = H.s('g', { class: 'ast-result', 'data-max': o.wPill || 104 }, txt);
        H.s('rect', { x: C - 40, y: o.yKey - 10.5, width: 80, height: 21, rx: 10.5, class: 'ast-pill' }, res);
        H.text(res, C, o.yKey + 0.5, '', { class: 'ast-result-text' });
      }
      return txt;
    }

    function updateResult(root, m, st, H) {
      const res = root.querySelector('.ast-result');
      if (!res) return;
      const cur = st.hover == null ? st.selected : st.hover;
      const sl = cur == null ? null : m.slices[cur];
      const on = !!(sl && !sl.off && sl.sub);
      root.querySelector('.ast-hub').classList.toggle('has-result', on);
      if (!on) return;
      const t = res.querySelector('.ast-result-text');
      t.textContent = m.file.replace(/\.[^.]+$/, '') + '.' + sl.id;
      const max = +res.dataset.max;
      H.fitWidth(t, max - 22, 12, 9);
      const w = Math.min(max, t.getComputedTextLength() + 22);
      const pill = res.querySelector('.ast-pill');
      pill.setAttribute('x', f1(C - w / 2));
      pill.setAttribute('width', f1(w));
    }

    // Every slice: a generous hit area, the visible segment and a flash layer for the apply effect.
    function sliceLabel(H, g, sl, m, r, o = {}) {
      const c = H.s('g', { class: 'ast-content' }, g);
      if (m.kind === 'convert' && sl.sub) {
        H.block(c, sl, r, {
          size: o.fmt || 24,
          subSize: o.subSize || 11.5,
          gap: o.gapF == null ? 1 : o.gapF,
          maxWidth: o.maxWidth || 78,
          minSize: 12,
          cls: 'ast-lbl ast-fmt',
          subCls: 'ast-lbl ast-sub',
        });
      } else {
        H.block(c, sl, r, {
          icon: true,
          iconSize: o.iconSize || 22,
          size: o.word || 14,
          gap: 4,
          maxWidth: o.maxWidth || 80,
          minSize: 9.5,
          cls: 'ast-lbl ast-word',
          sub: null,
        });
      }
      return c;
    }

    // ------------------------------------------------------------------ apply effect runner, shared
    // build(under, over, set) returns frame(ms), which draws the moment ms after the click. Live it runs
    // on requestAnimationFrame; for a still frame (t set) it draws one frame and leaves it. While .ast-fx
    // is on the wheel the effect draws the lasting result itself; CSS takes over when the class goes.
    // set(node, prop, value) styles a persistent node and remembers it, so the end of the effect resets it.
    function stopFx(root) {
      const wheel = root.closest('.wheel');
      if (!wheel) return;
      if (wheel.astRaf) cancelAnimationFrame(wheel.astRaf);
      wheel.astRaf = 0;
      root.querySelectorAll('.ast-burst').forEach((n) => n.remove());
      if (wheel.astTouched) wheel.astTouched.forEach((props, n) => props.forEach((p) => n.style.removeProperty(p)));
      wheel.astTouched = new Map();
      wheel.classList.remove('ast-fx');
    }
    function runFx(root, H, t, dur, build) {
      const wheel = root.closest('.wheel');
      stopFx(root);
      const live = t == null;
      if (live && (reducedMotion() || !window.requestAnimationFrame)) return;
      wheel.classList.add('ast-fx');
      const under = H.s('g', { class: 'ast-burst' }, root.querySelector('.ast-fx-under'));
      const over = H.s('g', { class: 'ast-burst' }, root.querySelector('.ast-fx-over'));
      const touched = wheel.astTouched;
      const set = (n, p, v) => {
        if (!n) return;
        n.style.setProperty(p, v);
        if (!touched.has(n)) touched.set(n, new Set());
        touched.get(n).add(p);
      };
      const frame = build(under, over, set);
      if (!live) {
        frame(clamp(t, 0, dur));
        return;
      }
      const t0 = performance.now();
      frame(0);
      const tick = (now) => {
        if (!under.isConnected) return;
        const ms = now - t0;
        frame(Math.min(ms, dur));
        if (ms < dur) wheel.astRaf = requestAnimationFrame(tick);
        else stopFx(root);
      };
      wheel.astRaf = requestAnimationFrame(tick);
    }

    const FAMILY = {};

    const STATUS_PAIRS = [
      ['accent', 'surface', 'text'],
      ['text-muted', 'surface-2', 'text'],
      ['success-text', 'surface', 'text'],
      ['warning-text', 'surface', 'text'],
      ['wheel-sub', 'wheel-slice', 'text'],
      ['wheel-sub', 'wheel-slice-hover', 'text'],
      ['wheel-sub-selected', 'wheel-slice-selected', 'text'],
      ['ast-hub-text', 'ast-hub', 'text'],
      ['ast-hub-sub', 'ast-hub', 'text'],
      ['ast-pill-text', 'ast-pill', 'text'],
    ];

    // ================================================================== A: Star atlas
    const ATL = { HUB: 72, IN: 79, OUT: 182, LBL: 119, B0: 145, B1: 175, S0: 184, S1: 191, APPLY: 660 };
    // Our own constellations, one per slice: stars as [u, v, magnitude] (u across the slice from -1 to 1,
    // v from the inner to the outer edge of the star band, magnitude 1 brightest) and the lines between them.
    const ATL_PATTERNS = [
      {
        s: [
          [-0.82, 0.28, 2],
          [-0.38, 0.66, 1],
          [0.08, 0.42, 2],
          [0.5, 0.82, 3],
          [0.8, 0.3, 2],
        ],
        e: [
          [0, 1],
          [1, 2],
          [2, 3],
          [2, 4],
        ],
      },
      {
        s: [
          [-0.75, 0.74, 2],
          [-0.25, 0.3, 2],
          [0.22, 0.64, 1],
          [0.72, 0.36, 3],
          [-0.02, 0.98, 3],
        ],
        e: [
          [0, 1],
          [1, 2],
          [2, 3],
          [2, 4],
        ],
      },
      {
        s: [
          [-0.62, 0.2, 2],
          [-0.05, 0.84, 1],
          [0.42, 0.3, 2],
          [0.86, 0.62, 3],
        ],
        e: [
          [0, 1],
          [1, 2],
          [2, 0],
          [2, 3],
        ],
      },
      {
        s: [
          [-0.86, 0.55, 3],
          [-0.45, 0.88, 2],
          [0.1, 0.8, 2],
          [0.55, 0.5, 1],
          [0.3, 0.1, 3],
        ],
        e: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
        ],
      },
      {
        s: [
          [-0.58, 0.62, 2],
          [-0.12, 0.94, 2],
          [0.36, 0.6, 1],
          [-0.18, 0.22, 3],
          [0.84, 0.18, 2],
        ],
        e: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
          [2, 4],
        ],
      },
      {
        s: [
          [-0.88, 0.16, 3],
          [-0.48, 0.42, 2],
          [-0.02, 0.36, 2],
          [0.4, 0.68, 1],
          [0.64, 0.98, 3],
          [0.86, 0.48, 2],
        ],
        e: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [3, 5],
        ],
      },
      {
        s: [
          [-0.7, 0.86, 2],
          [-0.18, 0.55, 1],
          [0.42, 0.86, 2],
          [-0.06, 0.08, 3],
          [0.62, 0.26, 3],
        ],
        e: [
          [0, 1],
          [1, 2],
          [1, 3],
          [3, 4],
        ],
      },
      {
        s: [
          [-0.8, 0.5, 2],
          [-0.3, 0.18, 3],
          [0.18, 0.46, 1],
          [0.12, 0.9, 2],
          [0.7, 0.72, 3],
        ],
        e: [
          [0, 1],
          [1, 2],
          [2, 3],
          [2, 4],
        ],
      },
    ];
    // "More…" is a loose cluster with no lines: more stars than can be named.
    const ATL_CLUSTER = {
      s: [
        [-0.32, 0.5, 2],
        [-0.06, 0.7, 2],
        [0.18, 0.44, 1],
        [-0.12, 0.24, 3],
        [0.32, 0.8, 3],
        [0.46, 0.24, 3],
        [-0.5, 0.82, 3],
      ],
      e: [],
    };
    const ATL_R = { 1: 2.5, 2: 1.85, 3: 1.3 };
    const ATL_SHIFT = { convert: 0, tools: 3, actions: 5 };

    function atlasStars(sl, m) {
      const pat = sl.id === 'more' ? ATL_CLUSTER : ATL_PATTERNS[(sl.i + ATL_SHIFT[m.kind]) % ATL_PATTERNS.length];
      const sgn = m.dir === 'rtl' ? -1 : 1;
      const half = m.step / 2 - 6;
      const pts = pat.s.map(([u, v, mag]) => {
        const [x, y] = P(lerp(ATL.B0, ATL.B1, v), sl.mid + sgn * u * half);
        return { x, y, mag, r: ATL_R[mag] };
      });
      return { pts, edges: pat.e };
    }

    // A soft band of the galaxy crossing the chart: an arc of a large off-center circle, filled with a
    // radial gradient around that circle's center so the band fades out on both sides.
    const ATL_BAND = { dx: 250, dy: 300, R: 372, half: 40 };
    function atlasBand(m) {
      const cx = C + (m.dir === 'rtl' ? -1 : 1) * ATL_BAND.dx;
      const cy = C + ATL_BAND.dy;
      const ring = (r, sw) => `M${cx} ${cy - r}a${r} ${r} 0 1 ${sw} 0 ${2 * r}a${r} ${r} 0 1 ${sw} 0 ${-2 * r}Z`;
      return { cx, cy, d: ring(ATL_BAND.R + ATL_BAND.half, 1) + ring(ATL_BAND.R - ATL_BAND.half, 0) };
    }

    Board.define(
      Object.assign({}, FAMILY, {
        id: 'astro-a',
        fonts: {
          brand: "'IBM Plex Sans Variable'",
          display: "'Literata Variable'",
          load: ["'IBM Plex Sans Variable'", "'Literata Variable'"],
          credits: [
            { family: 'IBM Plex Sans', license: 'SIL Open Font License 1.1' },
            { family: 'Literata', license: 'SIL Open Font License 1.1' },
          ],
        },
        motion: { open: 180, close: 110, stagger: 12, apply: ATL.APPLY },
        palette: {
          light: {
            bg: '#eef3fa',
            surface: '#ffffff',
            'surface-2': '#f3f6fb',
            border: '#d6dfec',
            'border-strong': '#7d93b8',
            text: '#0d1b3e',
            'text-muted': '#4a5876',
            accent: '#1d43b0',
            'on-accent': '#ffffff',
            focus: '#1d43b0',
            success: '#127c56',
            'on-success': '#ffffff',
            'success-text': '#0e6a49',
            warning: '#c26a0c',
            'warning-text': '#8d4a00',
            danger: '#c0283a',
            desk: 'linear-gradient(160deg, #f8fafe 0%, #e7eef8 55%, #d5e0f0 100%)',
            'wheel-face': '#fbfdff',
            'wheel-slice': '#fbfdff',
            'wheel-slice-hover': '#e1e9f8',
            'wheel-slice-selected': '#17378f',
            'wheel-text': '#0d1b3e',
            'wheel-text-selected': '#ffffff',
            'wheel-sub': '#4a5876',
            'wheel-sub-selected': '#d5e0fb',
            'wheel-line': '#3a5a9c',
            'wheel-shadow': 'rgba(20, 42, 96, 0.22)',
            'ast-face': 'radial-gradient(circle at 50% 42%, #ffffff 0%, #f9fbff 55%, #eef3fb 100%)',
            'ast-face-edge': 'rgba(29, 67, 176, 0.32)',
            'ast-flash': '#7fa2ff',
            'ast-halo-idle': '#fafcff',
            'ast-halo-hover': '#e1e9f8',
            'ast-halo-selected': '#17378f',
            'ast-hub': '#f1f5fc',
            'ast-hub-text': '#0d1b3e',
            'ast-hub-sub': '#4a5876',
            'ast-pill': '#17378f',
            'ast-pill-text': '#ffffff',
            'atl-grid': 'rgba(29, 67, 176, 0.22)',
            'atl-milky': 'rgba(72, 118, 230, 0.13)',
            'atl-field': '#27478c',
            'atl-con': '#2c55bd',
            'atl-star': '#0f2a70',
            'atl-sel-star': '#ffffff',
            'atl-sel-con': 'rgba(214, 226, 255, 0.85)',
            'atl-scale': '#3a5a9c',
            'atl-scale-hi': '#1d43b0',
            'atl-nova': '#1d43b0',
            'atl-nova-core': '#ffffff',
            'atl-nova-halo': 'rgba(29, 67, 176, 0.2)',
            'atl-nova-ring': '#1d43b0',
            'atl-streak': '#ffffff',
            'atl-streak-line': '#3a6cf4',
            'atl-streak-halo': 'rgba(58, 108, 244, 0.6)',
            'atl-pulse': '#1d43b0',
            'atl-hub-ring': '#3a5a9c',
            'atl-field-opacity': '0.55',
            'atl-paper': 'rgba(29, 67, 176, 0.06)',
            'ast-mica': 'rgba(255, 255, 255, 0.75)',
          },
          dark: {
            bg: '#070d1f',
            surface: '#0e1730',
            'surface-2': '#152140',
            border: '#22304f',
            'border-strong': '#5a6c92',
            text: '#e9f0ff',
            'text-muted': '#a2b1cf',
            accent: '#8db2ff',
            'on-accent': '#071330',
            focus: '#b3cbff',
            success: '#4fcf9f',
            'on-success': '#03251a',
            'success-text': '#6ddcb3',
            warning: '#f2b057',
            'warning-text': '#f5c07a',
            danger: '#ff7b88',
            desk: 'radial-gradient(120% 100% at 30% 8%, #16284f 0%, #0a1431 50%, #050a1a 100%)',
            'wheel-face': '#0a1430',
            'wheel-slice': '#0a1430',
            'wheel-slice-hover': '#182a52',
            'wheel-slice-selected': '#d4e2ff',
            'wheel-text': '#eef3ff',
            'wheel-text-selected': '#0a1636',
            'wheel-sub': '#a9b9da',
            'wheel-sub-selected': '#2b3f6e',
            'wheel-line': '#7c99d3',
            'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
            'ast-face': 'radial-gradient(circle at 50% 42%, #14244c 0%, #0b1534 55%, #070e25 100%)',
            'ast-face-edge': 'rgba(141, 178, 255, 0.3)',
            'ast-flash': '#e6efff',
            'ast-halo-idle': '#0b1534',
            'ast-halo-hover': '#182a52',
            'ast-halo-selected': '#d4e2ff',
            'ast-hub': '#081128',
            'ast-hub-text': '#eef3ff',
            'ast-hub-sub': '#a9b9da',
            'ast-pill': '#d4e2ff',
            'ast-pill-text': '#0a1636',
            'atl-grid': 'rgba(141, 178, 255, 0.17)',
            'atl-milky': 'rgba(150, 182, 255, 0.12)',
            'atl-field': '#cfdcff',
            'atl-con': '#86a9f2',
            'atl-star': '#f2f6ff',
            'atl-sel-star': '#17378f',
            'atl-sel-con': 'rgba(23, 55, 143, 0.55)',
            'atl-scale': '#7c99d3',
            'atl-scale-hi': '#d4e2ff',
            'atl-nova': '#ffffff',
            'atl-nova-core': '#ffffff',
            'atl-nova-halo': 'rgba(160, 192, 255, 0.3)',
            'atl-nova-ring': '#a9c4ff',
            'atl-streak': '#ffffff',
            'atl-streak-line': '#3f72ff',
            'atl-streak-halo': 'rgba(70, 120, 255, 0.7)',
            'atl-pulse': '#cfe0ff',
            'atl-hub-ring': '#7c99d3',
            'atl-field-opacity': '0.8',
            'atl-paper': 'rgba(141, 178, 255, 0.05)',
            'ast-mica': 'rgba(141, 178, 255, 0.07)',
          },
        },
        contrast: Board.DEFAULT_PAIRS.concat(STATUS_PAIRS, [
          ['atl-con', 'wheel-face', 'ui'],
          ['atl-star', 'wheel-face', 'ui'],
          ['atl-sel-star', 'wheel-slice-selected', 'ui'],
          ['atl-nova', 'ast-hub', 'ui'],
        ]),

        wheel: {
          render(root, m, H) {
            const s = H.s;
            const ccw = m.dir === 'rtl';
            const uid = H.uid('astro-a');
            const defs = s('defs', {}, root);
            const clip = s('clipPath', { id: uid + '-clip' }, defs);
            s('circle', { cx: C, cy: C, r: ATL.S0 - 1 }, clip);

            // The sky: a soft galactic band, the graticule and faint field stars. It turns into place on open.
            const sky = s('g', { class: 'atl-sky ast-turn' }, root);
            const bd = atlasBand(m);
            const r1 = ATL_BAND.R + ATL_BAND.half;
            const k0 = f3((ATL_BAND.R - ATL_BAND.half) / r1);
            const k1 = f3(ATL_BAND.R / r1);
            const bandFill = gradient(
              H,
              defs,
              'radialGradient',
              uid + '-band',
              { gradientUnits: 'userSpaceOnUse', cx: bd.cx, cy: bd.cy, r: r1 },
              [
                [k0, 'atl-s-milky', 0],
                [f3((k0 + 2 * k1) / 3), 'atl-s-milky', 0.8],
                [k1, 'atl-s-milky', 1],
                [f3((1 + 2 * k1) / 3), 'atl-s-milky', 0.8],
                [1, 'atl-s-milky', 0],
              ],
            );
            s('path', { d: bd.d, fill: bandFill, 'clip-path': `url(#${uid}-clip)`, class: 'atl-milky' }, sky);
            s('circle', { cx: C, cy: C, r: 100, class: 'atl-grat atl-grat-dot' }, sky);
            s('circle', { cx: C, cy: C, r: ATL.B0 - 6, class: 'atl-grat' }, sky);
            let tk = '';
            for (let k = 0; k < 48; k++)
              tk += `M${pt(P(ATL.B0 - 6, k * 7.5))}L${pt(P(ATL.B0 - 6 + (k % 2 ? 2.5 : 4.5), k * 7.5))}`;
            s('path', { d: tk, class: 'atl-grat' }, sky);

            const zones = labelZones(m, ATL.LBL);
            const conStars = m.slices.flatMap((sl) => atlasStars(sl, m).pts);
            const rand = rng(211 + m.kind.length * 37);
            const field = ['', '', ''];
            for (let k = 0, kept = 0; k < 1400 && kept < 110; k++) {
              const r = Math.sqrt((ATL.HUB + 9) ** 2 + rand() * ((ATL.S0 - 3) ** 2 - (ATL.HUB + 9) ** 2));
              const a = rand() * 360;
              const [x, y] = P(r, a);
              const mag = rand();
              if (inZone(x, y, zones)) continue;
              if (conStars.some((c) => Math.hypot(x - c.x, y - c.y) < 7)) continue;
              if (m.slices.some((sl) => Math.abs(angDiff(a, sl.a0)) * rad(1) * r < 3.2)) continue;
              kept++;
              const cls = mag < 0.12 ? 0 : mag < 0.45 ? 1 : 2;
              field[cls] += dotPath(x, y, [1.05, 0.72, 0.48][cls]);
            }
            field.forEach((d, k) => d && s('path', { d, class: 'atl-field atl-field-' + k }, sky));

            // Ink: the graduated border and the slice dividers.
            const ink = s('g', { class: 'atl-ink' }, root);
            const ringP = (r, cls, delay) => {
              const p = s('path', { d: circlePath(r, ccw), class: cls + ' ast-draw', pathLength: 1 }, ink);
              p.style.setProperty('--d', delay + 'ms');
            };
            ringP(ATL.S0, 'atl-ring', 0);
            ringP(ATL.S1, 'atl-ring atl-ring-out', 20);
            let ticks = '';
            for (let k = 0; k < 120; k++) {
              const a = k * 3;
              ticks += `M${pt(P(ATL.S0, a))}L${pt(P(ATL.S0 + (k % 5 === 0 ? 4.6 : 2.4), a))}`;
            }
            s('path', { d: ticks, class: 'atl-ticks' }, ink);
            for (const sl of m.slices) {
              const p = s(
                'path',
                { d: `M${pt(P(ATL.IN, sl.a0))}L${pt(P(ATL.S0, sl.a0))}`, class: 'atl-div ast-draw', pathLength: 1 },
                ink,
              );
              p.style.setProperty('--d', `calc(${sl.i} * var(--stagger) + 20ms)`);
            }

            // Slices: segment, scale band on the border, constellation and label.
            for (const sl of m.slices) {
              const g = H.slice(root, sl, m);
              s('path', { d: H.sector(ATL.IN - 6, 197, sl.a0, sl.a1), class: 'ast-hit' }, g);
              const seg = H.sector(ATL.IN + 1.5, ATL.OUT, sl.a0, sl.a1, 3);
              s('path', { d: seg, class: 'ast-seg' }, g);
              s('path', { d: seg, class: 'ast-flash' }, g);
              s('path', { d: H.sector(ATL.S0 + 1.2, ATL.S1 - 1.2, sl.a0, sl.a1, 3), class: 'atl-scaleband' }, g);
              const { pts, edges } = atlasStars(sl, m);
              const con = s('g', { class: 'atl-con' }, g);
              if (edges.length) {
                let d = '';
                for (const [a, b] of edges) {
                  const p = pts[a];
                  const q = pts[b];
                  const len = Math.hypot(q.x - p.x, q.y - p.y);
                  const ux = (q.x - p.x) / len;
                  const uy = (q.y - p.y) / len;
                  // Atlas style: lines stop short of the stars.
                  d += `M${f2(p.x + ux * (p.r + 2.2))} ${f2(p.y + uy * (p.r + 2.2))}L${f2(q.x - ux * (q.r + 2.2))} ${f2(q.y - uy * (q.r + 2.2))}`;
                }
                s('path', Object.assign({ d, class: 'atl-con-lines' }, sl.off ? {} : { pathLength: 1 }), con);
              }
              const stars = s('g', { class: 'atl-con-stars' }, con);
              for (const p of pts) s('circle', { cx: f2(p.x), cy: f2(p.y), r: p.r, class: 'atl-cstar' }, stars);
              const br = pts.reduce((a, b) => (b.mag < a.mag ? b : a));
              s('path', { d: sparkle(br.x, br.y, 7, -0.25), class: 'atl-con-spark' }, con);
              sliceLabel(H, g, sl, m, ATL.LBL, { fmt: 24, subSize: 11.5 });
            }

            // Hub: the pole of the chart, with an equator hairline and the pole mark where the new star forms.
            const hub = s('g', { class: 'ast-hub atl-hub' }, root);
            s('circle', { cx: C, cy: C, r: ATL.HUB, class: 'atl-hubdisc' }, hub);
            s('path', { d: circlePath(ATL.HUB, ccw), class: 'atl-hubring ast-draw', pathLength: 1 }, hub);
            s('circle', { cx: C, cy: C, r: ATL.HUB - 4.5, class: 'atl-hubdots' }, hub);
            s('path', { d: `M${C - 58} ${C}H${C - 21}M${C + 21} ${C}H${C + 58}`, class: 'atl-equator' }, hub);
            const pole = s('g', { class: 'atl-pole' }, hub);
            s('circle', { cx: C, cy: C, r: 4, class: 'atl-pole-ring' }, pole);
            s(
              'path',
              {
                d: `M${C} ${C - 10}V${C - 6.5}M${C} ${C + 6.5}V${C + 10}M${C - 10} ${C}H${C - 6.5}M${C + 6.5} ${C}H${C + 10}`,
                class: 'atl-pole-ring',
              },
              pole,
            );
            s('g', { class: 'ast-fx-under' }, hub);
            hubText(H, hub, m, {
              yTitle: C - 31,
              wTitle: 112,
              sTitle: 20,
              yFile: C + 25,
              wFile: 104,
              yKey: C + 45,
              wPill: 90,
            });
            const nova = s('g', { class: 'atl-nova ast-lasting' }, hub);
            atlasNova(H, nova);
            s('g', { class: 'ast-fx-over' }, root);
          },

          update(root, m, st, H) {
            updateResult(root, m, st, H);
          },

          onOpen(root, m, H, reduced, t) {
            if (t == null) stopFx(root);
          },

          // The stars streak into the pole one after another; when the last arrives a new star pops there.
          onSelect(root, m, i, H, t) {
            const sl = m.slices[i];
            const g = root.querySelector(`.slice[data-slice="${i}"]`);
            const pts = atlasStars(sl, m).pts;
            const n = pts.length;
            const S0 = 30;
            const STG = 18;
            const TRAV = 280;
            const arrive = (k) => S0 + k * STG + TRAV;
            const tFirst = arrive(0);
            const tLast = arrive(n - 1);
            runFx(root, H, t, ATL.APPLY, (under, over, set) => {
              const flash = g.querySelector('.ast-flash');
              const text = root.querySelector('.ast-hubtext');
              const cstars = g.querySelectorAll('.atl-cstar');
              const lines = g.querySelector('.atl-con-lines');
              const nova = H.s('g', { class: 'atl-nova' }, under);
              const parts = atlasNova(H, nova);
              const pulse = H.s('circle', { cx: C, cy: C, r: 6, class: 'atl-pulse' }, over);
              const streaks = pts.map((p) => ({
                p,
                halo: H.s('line', { class: 'atl-streak-halo' }, over),
                core: H.s('line', { class: 'atl-streak' }, over),
                head: H.s('circle', { cx: f2(p.x), cy: f2(p.y), r: 2.6, class: 'atl-streak-head' }, over),
              }));
              return (ms) => {
                set(flash, 'opacity', f2(0.85 * (1 - easeOut(span(ms, 0, 260)))));
                const back = span(ms, tLast + 60, ATL.APPLY - 30);
                if (lines) set(lines, 'opacity', f2(Math.max(1 - 0.75 * span(ms, S0, S0 + 160), back)));
                let arrived = 0;
                streaks.forEach((st, k) => {
                  const q = span(ms, S0 + k * STG, arrive(k));
                  if (cstars[k]) set(cstars[k], 'opacity', f2(Math.max(1 - 0.8 * span(q, 0, 0.25), back)));
                  const show = q < 1;
                  if (!show) arrived++;
                  for (const n2 of [st.halo, st.core, st.head]) n2.style.opacity = show ? 1 : 0;
                  if (!show) return;
                  const e = q ** 1.6;
                  const e0 = Math.max(0, q - 0.38) ** 1.6;
                  const hx = lerp(st.p.x, C, e);
                  const hy = lerp(st.p.y, C, e);
                  for (const l of [st.halo, st.core]) {
                    l.setAttribute('x1', f2(lerp(st.p.x, C, e0)));
                    l.setAttribute('y1', f2(lerp(st.p.y, C, e0)));
                    l.setAttribute('x2', f2(hx));
                    l.setAttribute('y2', f2(hy));
                  }
                  st.head.setAttribute('cx', f2(hx));
                  st.head.setAttribute('cy', f2(hy));
                  st.head.setAttribute('r', f2(2.6 - 1.1 * e));
                });
                const pop = span(ms, tLast, tLast + 230);
                let sc = 0;
                if (ms >= tFirst && ms < tLast) sc = 0.3 + 0.4 * (arrived / n);
                else if (ms >= tLast)
                  sc = pop < 0.3 ? lerp(0.7, 1.45, easeOut(pop / 0.3)) : lerp(1.45, 1, easeInOut((pop - 0.3) / 0.7));
                nova.style.opacity = ms >= tFirst ? 1 : 0;
                nova.setAttribute(
                  'transform',
                  `translate(${C} ${C}) rotate(${f1(35 * (1 - pop))}) scale(${f3(sc)}) translate(${-C} ${-C})`,
                );
                parts.halo.setAttribute('r', f2(14 + 13 * Math.sin(Math.PI * pop)));
                const pr = span(ms, tLast, tLast + 260);
                pulse.setAttribute('r', f2(6 + 52 * easeOut(pr)));
                pulse.style.opacity = pr > 0 && pr < 1 ? f2(0.9 * (1 - pr)) : 0;
                pulse.style.strokeWidth = f2(2.8 - 2.2 * pr);
                const dim = span(ms, tFirst - 90, tFirst) * (1 - span(ms, tLast + 60, tLast + 220));
                set(text, 'opacity', f2(1 - 0.6 * dim));
              };
            });
          },
        },

        sounds: {
          open(ac, out, t, X) {
            X.burst(ac, out, t, { type: 'highpass', f: 4200, f2: 7400, q: 0.8, dur: 0.14, gain: 0.05, a: 0.03 });
            X.tone(ac, out, t + 0.015, { f: 2637, dur: 0.16, gain: 0.022, a: 0.006 });
            X.tone(ac, out, t + 0.06, { f: 3951, dur: 0.14, gain: 0.016, a: 0.006 });
          },
          tick(ac, out, t, X) {
            X.tone(ac, out, t, { f: 3136, dur: 0.032, gain: 0.05, a: 0.001 });
            X.tone(ac, out, t, { f: 6272, dur: 0.012, gain: 0.012, a: 0.001 });
          },
          success(ac, out, t, X) {
            X.burst(ac, out, t, { type: 'bandpass', f: 2600, f2: 6800, q: 3, dur: 0.3, gain: 0.05, a: 0.12 });
            X.tone(ac, out, t + 0.38, { f: 1046.5, dur: 0.45, gain: 0.08 });
            X.tone(ac, out, t + 0.38, { f: 2093, dur: 0.22, gain: 0.022 });
            X.tone(ac, out, t + 0.47, { f: 1568, dur: 0.6, gain: 0.065 });
          },
        },
      }),
    );

    // The lasting star at the pole (and the copy the apply effect animates).
    function atlasNova(H, g) {
      const halo = H.s('circle', { cx: C, cy: C, r: 14, class: 'atl-nova-halo' }, g);
      H.s('circle', { cx: C, cy: C, r: 17.5, class: 'atl-nova-ring' }, g);
      H.s('path', { d: sparkle(C, C, 14, -0.24), class: 'atl-nova-star' }, g);
      H.s('path', { d: sparkle(C, C, 7.5, -0.1, 45), class: 'atl-nova-star atl-nova-diag' }, g);
      H.s('circle', { cx: C, cy: C, r: 2.4, class: 'atl-nova-core' }, g);
      return { halo };
    }

    // ================================================================== B: Galaxy and black hole
    const GAL = { HOLE: 57, PHOTON: 60.5, ACC0: 63, ACC1: 80, IN: 90, OUT: 184, LBL: 135, TWIST: 30, APPLY: 700 };
    // The slices curve like the arms: the outer edge is turned TWIST degrees from the inner one.
    const galTwist = (r, m) => (m.dir === 'rtl' ? -1 : 1) * GAL.TWIST * clamp((r - GAL.IN) / (GAL.OUT - GAL.IN));

    function galSector(m, sl, r0, r1, gap) {
      const N = 12;
      const side = (a, sign) => {
        const out = [];
        for (let k = 0; k <= N; k++) {
          const r = lerp(r0, r1, k / N);
          out.push(P(r, a + galTwist(r, m) + (sign * gap * 90) / (Math.PI * r)));
        }
        return out;
      };
      const L = side(sl.a0, 1);
      const R = side(sl.a1, -1);
      return `${poly(L)}A${r1} ${r1} 0 0 1 ${pt(R[N])}L${R.slice(0, N).reverse().map(pt).join('L')}A${r0} ${r0} 0 0 0 ${pt(L[0])}Z`;
    }
    const galEdge = (m, a, r0, r1) => {
      const out = [];
      for (let k = 0; k <= 12; k++) {
        const r = lerp(r0, r1, k / 12);
        out.push(P(r, a + galTwist(r, m)));
      }
      return poly(out);
    };

    // A logarithmic spiral arm from r0 to r1, turning `wind` degrees.
    function armPts(m, a0, r0, r1, wind, steps = 48) {
      const sgn = m.dir === 'rtl' ? -1 : 1;
      const pts = [];
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const [x, y] = P(r0 * (r1 / r0) ** u, a0 + sgn * wind * u);
        pts.push([x, y, u]);
      }
      return pts;
    }
    const armWidth = (wMax) => (u) => wMax * u ** 0.6 * (1 - u ** 3);
    const GAL_ARMS = [
      {
        a0: 18,
        r0: 64,
        r1: 196,
        wind: 250,
        layers: [
          [58, 'gal-arm-0'],
          [34, 'gal-arm-1'],
          [14, 'gal-arm-2'],
        ],
      },
      {
        a0: 198,
        r0: 64,
        r1: 196,
        wind: 250,
        layers: [
          [58, 'gal-arm-0'],
          [34, 'gal-arm-1'],
          [14, 'gal-arm-2'],
        ],
      },
      {
        a0: 108,
        r0: 72,
        r1: 188,
        wind: 215,
        layers: [
          [36, 'gal-arm-0'],
          [16, 'gal-arm-1'],
        ],
      },
      {
        a0: 288,
        r0: 72,
        r1: 188,
        wind: 215,
        layers: [
          [36, 'gal-arm-0'],
          [16, 'gal-arm-1'],
        ],
      },
    ];

    Board.define(
      Object.assign({}, FAMILY, {
        id: 'astro-b',
        fonts: {
          brand: "'Manrope Variable'",
          display: "'Unbounded Variable'",
          load: ["'Manrope Variable'", "'Unbounded Variable'"],
          credits: [
            { family: 'Manrope', license: 'SIL Open Font License 1.1' },
            { family: 'Unbounded', license: 'SIL Open Font License 1.1' },
          ],
        },
        motion: { open: 190, close: 120, stagger: 12, apply: GAL.APPLY },
        palette: {
          light: {
            bg: '#f5f2fd',
            surface: '#ffffff',
            'surface-2': '#f4f0fd',
            border: '#e1d9f4',
            'border-strong': '#9b8dc8',
            text: '#1b1236',
            'text-muted': '#5a5078',
            accent: '#5a33d4',
            'on-accent': '#ffffff',
            focus: '#5a33d4',
            success: '#127c56',
            'on-success': '#ffffff',
            'success-text': '#0e6a49',
            warning: '#c2620c',
            'warning-text': '#8d4400',
            danger: '#c0283a',
            desk: 'linear-gradient(150deg, #fdfcff 0%, #efe9fc 50%, #f9e9f3 100%)',
            'wheel-face': '#fcfaff',
            'wheel-slice': '#fcfaff',
            'wheel-slice-hover': '#ebe4fc',
            'wheel-slice-selected': '#a32f86',
            'wheel-text': '#1b1236',
            'wheel-text-selected': '#ffffff',
            'wheel-sub': '#584e78',
            'wheel-sub-selected': '#fcefff',
            'wheel-line': '#7a67c8',
            'wheel-shadow': 'rgba(60, 30, 120, 0.2)',
            'ast-face': 'radial-gradient(circle at 50% 50%, #f6ecff 0%, #fdfbff 46%, #f2edfc 100%)',
            'ast-face-edge': 'rgba(90, 51, 212, 0.24)',
            'ast-flash': '#c8b4ff',
            'ast-halo-idle': '#f8f4ff',
            'ast-halo-hover': '#ebe4fc',
            'ast-halo-selected': '#7a2ea8',
            'ast-hub': '#0d0821',
            'ast-hub-text': '#f7f3ff',
            'ast-hub-sub': '#c3b8e8',
            'ast-pill': '#3a1d1a',
            'ast-pill-text': '#ffd9bf',
            'gal-sel-0': '#4f2cc4',
            'gal-sel-1': '#a32f86',
            'gal-hover': 'rgba(110, 80, 230, 0.15)',
            'gal-arm': '#8b6ef0',
            'gal-arm-2': '#ee8cc4',
            'gal-core': '#ffc6a6',
            'gal-arm-opacity': '0.62',
            'gal-star': '#2b1f5e',
            'gal-star-bright': '#3a2a8e',
            'gal-field-opacity': '0.62',
            'gal-hole': '#0d0821',
            'gal-photon': '#fff1e0',
            'gal-ring-hot': '#ffd9b8',
            'gal-ring-mid': '#ff8a52',
            'gal-ring-cool': '#d9458a',
            'gal-lens': '#ff8a52',
            'gal-edge': '#5a33d4',
            'gal-div': 'rgba(90, 51, 212, 0.28)',
            'gal-mote': '#5a33d4',
            'gal-mote-halo': 'rgba(120, 80, 240, 0.25)',
            'ast-mica': 'rgba(255, 255, 255, 0.7)',
            'gal-glow-a': 'rgba(150, 110, 255, 0.24)',
            'gal-glow-b': 'rgba(255, 140, 190, 0.2)',
          },
          dark: {
            bg: '#0a0819',
            surface: '#141029',
            'surface-2': '#1c1736',
            border: '#2d2652',
            'border-strong': '#665c95',
            text: '#f2eeff',
            'text-muted': '#b1a8d2',
            accent: '#b9a2ff',
            'on-accent': '#170d36',
            focus: '#cdbcff',
            success: '#5ed6a7',
            'on-success': '#04261a',
            'success-text': '#7ae2bb',
            warning: '#ffb066',
            'warning-text': '#ffc58f',
            danger: '#ff7a93',
            desk: 'radial-gradient(110% 90% at 72% 16%, #2c1b55 0%, #130d2c 45%, #07051a 100%)',
            'wheel-face': '#0f0b24',
            'wheel-slice': '#0f0b24',
            'wheel-slice-hover': '#2a2150',
            'wheel-slice-selected': '#a8358c',
            'wheel-text': '#f7f3ff',
            'wheel-text-selected': '#ffffff',
            'wheel-sub': '#c3b8e6',
            'wheel-sub-selected': '#fbeeff',
            'wheel-line': '#8a78d8',
            'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
            'ast-face': 'radial-gradient(circle at 50% 50%, #26184a 0%, #130d2d 44%, #0b0821 100%)',
            'ast-face-edge': 'rgba(185, 162, 255, 0.24)',
            'ast-flash': '#ffe0f2',
            'ast-halo-idle': '#120c2b',
            'ast-halo-hover': '#2a2150',
            'ast-halo-selected': '#7f36b0',
            'ast-hub': '#05030d',
            'ast-hub-text': '#f7f3ff',
            'ast-hub-sub': '#bdb2e3',
            'ast-pill': '#3a1d1a',
            'ast-pill-text': '#ffd9bf',
            'gal-sel-0': '#5b36d2',
            'gal-sel-1': '#a8358c',
            'gal-hover': 'rgba(170, 140, 255, 0.26)',
            'gal-arm': '#8f74ff',
            'gal-arm-2': '#e46fc1',
            'gal-core': '#ffd8bb',
            'gal-arm-opacity': '0.9',
            'gal-star': '#efeaff',
            'gal-star-bright': '#ffffff',
            'gal-field-opacity': '0.85',
            'gal-hole': '#05030d',
            'gal-photon': '#fff3e4',
            'gal-ring-hot': '#fff0dc',
            'gal-ring-mid': '#ffa071',
            'gal-ring-cool': '#e0508f',
            'gal-lens': '#ffe2cc',
            'gal-edge': '#efe4ff',
            'gal-div': 'rgba(185, 162, 255, 0.24)',
            'gal-mote': '#fff4fb',
            'gal-mote-halo': 'rgba(255, 170, 220, 0.35)',
            'ast-mica': 'rgba(185, 162, 255, 0.07)',
            'gal-glow-a': 'rgba(143, 116, 255, 0.2)',
            'gal-glow-b': 'rgba(228, 111, 193, 0.14)',
          },
        },
        contrast: Board.DEFAULT_PAIRS.concat(STATUS_PAIRS, [
          ['wheel-text-selected', 'gal-sel-0', 'text'],
          ['wheel-sub-selected', 'gal-sel-0', 'text'],
          ['gal-star', 'wheel-face', 'ui'],
          ['gal-photon', 'gal-hole', 'ui'],
        ]),

        wheel: {
          render(root, m, H) {
            const s = H.s;
            const uid = H.uid('astro-b');
            const sgn = m.dir === 'rtl' ? -1 : 1;
            const defs = s('defs', {}, root);
            const armFill = gradient(
              H,
              defs,
              'radialGradient',
              uid + '-arm',
              { gradientUnits: 'userSpaceOnUse', cx: C, cy: C, r: 196 },
              [
                [0.3, 'gal-s-core', 1],
                [0.5, 'gal-s-arm', 0.95],
                [0.78, 'gal-s-arm2', 0.6],
                [1, 'gal-s-arm2', 0],
              ],
            );
            const coreFill = gradient(
              H,
              defs,
              'radialGradient',
              uid + '-core',
              { gradientUnits: 'userSpaceOnUse', cx: C, cy: C, r: 150 },
              [
                [0, 'gal-s-core', 0.7],
                [0.5, 'gal-s-arm', 0.18],
                [1, 'gal-s-arm', 0],
              ],
            );
            const accFill = gradient(
              H,
              defs,
              'linearGradient',
              uid + '-acc',
              sgn > 0 ? { x1: 0, y1: 0.25, x2: 1, y2: 0.75 } : { x1: 1, y1: 0.25, x2: 0, y2: 0.75 },
              [
                [0, 'gal-s-hot', 1],
                [0.38, 'gal-s-mid', 0.95],
                [0.78, 'gal-s-cool', 0.7],
                [1, 'gal-s-cool', 0.45],
              ],
            );
            const glowFill = gradient(
              H,
              defs,
              'radialGradient',
              uid + '-glow',
              { gradientUnits: 'userSpaceOnUse', cx: C, cy: C, r: 104 },
              [
                [0.55, 'gal-s-mid', 0],
                [0.66, 'gal-s-mid', 0.5],
                [0.82, 'gal-s-cool', 0.2],
                [1, 'gal-s-cool', 0],
              ],
            );
            const selFill = gradient(
              H,
              defs,
              'radialGradient',
              uid + '-sel',
              { gradientUnits: 'userSpaceOnUse', cx: C, cy: C, r: 190 },
              [
                [0.45, 'gal-s-sel0', 1],
                [1, 'gal-s-sel1', 1],
              ],
            );

            // The galaxy: core glow, four arms in soft layers and a field of stars that follows the arms.
            const galaxy = s('g', { class: 'gal-galaxy' }, root);
            s('circle', { cx: C, cy: C, r: 150, fill: coreFill, class: 'gal-core' }, galaxy);
            const arms = s('g', { class: 'gal-arms' }, galaxy);
            const armLines = GAL_ARMS.map((a) => armPts(m, a.a0, a.r0, a.r1, a.wind));
            GAL_ARMS.forEach((a, k) => {
              for (const [w, cls] of a.layers)
                s('path', { d: taper(armLines[k], armWidth(w)), fill: armFill, class: 'gal-arm ' + cls }, arms);
            });
            const zones = labelZones(m, GAL.LBL, (r) => galTwist(r, m));
            const rand = rng(509 + m.kind.length * 71);
            const field = ['', '', ''];
            let bright = '';
            for (let k = 0, kept = 0; k < 2200 && kept < 230; k++) {
              let x;
              let y;
              if (rand() < 0.62) {
                const ai = rand() < 0.72 ? Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2);
                const line = armLines[ai];
                const j = Math.floor(lerp(0.12, 0.98, rand()) * (line.length - 1));
                const [ax, ay] = line[j];
                const [bx, by] = line[Math.min(line.length - 1, j + 1)];
                const len = Math.hypot(bx - ax, by - ay) || 1;
                const off = (rand() + rand() + rand() - 1.5) * 0.55 * armWidth(GAL_ARMS[ai].layers[0][0])(line[j][2]);
                x = ax - ((by - ay) / len) * off;
                y = ay + ((bx - ax) / len) * off;
              } else {
                [x, y] = P(Math.sqrt(GAL.IN ** 2 + rand() * (190 ** 2 - GAL.IN ** 2)), rand() * 360);
              }
              const r = Math.hypot(x - C, y - C);
              const mag = rand();
              if (r < GAL.ACC1 + 9 || r > 190 || inZone(x, y, zones)) continue;
              kept++;
              if (kept % 26 === 0) bright += sparkle(x, y, 3.4, -0.2);
              else {
                const cls = mag < 0.1 ? 0 : mag < 0.42 ? 1 : 2;
                field[cls] += dotPath(x, y, [1.1, 0.72, 0.45][cls]);
              }
            }
            const stars = s('g', { class: 'gal-field' }, galaxy);
            field.forEach((d, k) => d && s('path', { d, class: 'gal-star gal-star-' + k }, stars));
            if (bright) s('path', { d: bright, class: 'gal-star gal-star-bright' }, stars);

            // Rim and the faint spiral dividers between slices.
            const deco = s('g', { class: 'gal-deco' }, root);
            s('circle', { cx: C, cy: C, r: 191, class: 'gal-rim' }, deco);
            let divs = '';
            let dots = '';
            for (const sl of m.slices) {
              divs += galEdge(m, sl.a0, GAL.IN + 4, GAL.OUT);
              dots += dotPath(...P(191, sl.a0 + galTwist(GAL.OUT, m)), 1.6);
            }
            s('path', { d: divs, class: 'gal-div' }, deco);
            s('path', { d: dots, class: 'gal-rimdots' }, deco);

            // Slices: curved like the arms; the selected one fills with a nebula gradient.
            for (const sl of m.slices) {
              const g = H.slice(root, sl, m);
              s('path', { d: galSector(m, sl, GAL.IN - 8, 197, 0), class: 'ast-hit' }, g);
              const seg = galSector(m, sl, GAL.IN + 1, GAL.OUT, 3);
              s('path', { d: seg, class: 'ast-seg' }, g);
              s('path', { d: seg, fill: selFill, class: 'gal-selfill' }, g);
              s('path', { d: seg, class: 'ast-flash' }, g);
              if (sl.off) s('path', { d: galSector(m, sl, GAL.IN + 4, GAL.OUT - 3, 9), class: 'gal-offline' }, g);
              const tw = galTwist(GAL.OUT, m);
              s('path', { d: H.arc(GAL.OUT + 4, sl.a0 + tw + 2.5, sl.a1 + tw - 2.5), class: 'gal-edge' }, g);
              sliceLabel(H, g, Object.assign({}, sl, { mid: sl.mid + galTwist(GAL.LBL, m) }), m, GAL.LBL, {
                fmt: 19,
                subSize: 11.5,
                gapF: 3,
                maxWidth: 82,
              });
            }

            // The black hole: soft halo, accretion ring brighter on the approaching side, photon ring, horizon.
            const hole = s('g', { class: 'gal-holegroup' }, root);
            s('circle', { cx: C, cy: C, r: 104, fill: glowFill, class: 'gal-glow' }, hole);
            s('path', { d: H.ring(GAL.ACC0, GAL.ACC1), fill: accFill, class: 'gal-acc' }, hole);
            s('path', { d: H.ring(GAL.ACC0, GAL.ACC1), class: 'gal-acc-lit ast-lasting' }, hole);
            s('circle', { cx: C, cy: C, r: GAL.PHOTON, class: 'gal-photon' }, hole);
            s('circle', { cx: C, cy: C, r: GAL.HOLE, class: 'gal-hole' }, hole);
            s('circle', { cx: C, cy: C, r: 94, class: 'gal-lensring ast-lasting' }, root);
            const hub = s('g', { class: 'ast-hub gal-hub' }, root);
            s('g', { class: 'ast-fx-under' }, hub);
            hubText(H, hub, m, {
              yTitle: C - 16,
              wTitle: 92,
              sTitle: 15.5,
              yFile: C + 3,
              wFile: 88,
              sFile: 11,
              yKey: C + 23,
              keyRx: 9,
              wPill: 90,
            });
            s('g', { class: 'ast-fx-over' }, root);
          },

          update(root, m, st, H) {
            updateResult(root, m, st, H);
          },

          onOpen(root, m, H, reduced, t) {
            if (t == null) stopFx(root);
          },

          // Seven motes of the arm's light spiral into the hole; the hole gulps and a lensing ring flashes.
          onSelect(root, m, i, H, t) {
            const sl = m.slices[i];
            const g = root.querySelector(`.slice[data-slice="${i}"]`);
            const sgn = m.dir === 'rtl' ? -1 : 1;
            const rand = rng(31 + i * 17);
            const motes = [];
            for (let k = 0; k < 7; k++) {
              const r = lerp(116, 178, rand());
              motes.push({ r, a: sl.mid + galTwist(r, m) + sgn * lerp(-0.7, 0.7, rand()) * (m.step / 2 - 6) });
            }
            motes.sort((p, q) => p.r - q.r);
            const S0 = 20;
            const STG = 18;
            const TRAV = 340;
            const arrive = (k) => S0 + k * STG + TRAV;
            const tLast = arrive(motes.length - 1);
            const at = (mo, q) => P(GAL.PHOTON + (mo.r - GAL.PHOTON) * (1 - q) ** 1.5, mo.a - sgn * 135 * q ** 2.2);
            runFx(root, H, t, GAL.APPLY, (under, over, set) => {
              const flash = g.querySelector('.ast-flash');
              const text = root.querySelector('.ast-hubtext');
              const holeG = root.querySelector('.gal-holegroup');
              const accLit = H.s('path', { d: H.ring(GAL.ACC0, GAL.ACC1), class: 'gal-acc-lit' }, under);
              const photon = H.s('circle', { cx: C, cy: C, r: GAL.PHOTON, class: 'gal-photon-fx' }, under);
              const lens1 = H.s('circle', { cx: C, cy: C, r: 62, class: 'gal-lens-fx' }, under);
              const lens2 = H.s('circle', { cx: C, cy: C, r: 62, class: 'gal-lensring' }, under);
              const trails = motes.map((mo) => ({
                mo,
                halo: H.s('path', { class: 'gal-trail-halo' }, over),
                core: H.s('path', { class: 'gal-trail' }, over),
                head: H.s('circle', { r: 2.6, class: 'gal-mote' }, over),
              }));
              return (ms) => {
                set(flash, 'opacity', f2(0.8 * (1 - easeOut(span(ms, 0, 260)))));
                let impact = 0;
                trails.forEach((tr, k) => {
                  const q = span(ms, S0 + k * STG, arrive(k));
                  if (ms >= arrive(k)) impact += 1 - span(ms, arrive(k), arrive(k) + 160);
                  const show = q < 1;
                  for (const n2 of [tr.halo, tr.core, tr.head]) n2.style.opacity = show ? 1 : 0;
                  if (!show) return;
                  const q0 = Math.max(0, q - 0.34);
                  const pts = [];
                  for (let j = 0; j <= 8; j++) pts.push(at(tr.mo, lerp(q0, q, j / 8)));
                  const d = poly(pts);
                  tr.halo.setAttribute('d', d);
                  tr.core.setAttribute('d', d);
                  const [hx, hy] = pts[8];
                  tr.head.setAttribute('cx', f2(hx));
                  tr.head.setAttribute('cy', f2(hy));
                  tr.head.setAttribute('r', f2(2.6 - 1.2 * q));
                });
                photon.style.opacity = f2(Math.min(1, impact * 0.7));
                let sc = 1;
                if (ms >= tLast - 50 && ms < tLast + 20)
                  sc = lerp(1, 0.93, easeInOut(span(ms, tLast - 50, tLast + 20)));
                else if (ms >= tLast + 20 && ms < tLast + 110)
                  sc = lerp(0.93, 1.05, easeOut(span(ms, tLast + 20, tLast + 110)));
                else if (ms >= tLast + 110) sc = lerp(1.05, 1, easeInOut(span(ms, tLast + 110, tLast + 210)));
                set(holeG, 'transform', `scale(${f3(sc)})`);
                const l1 = span(ms, tLast + 10, tLast + 250);
                lens1.setAttribute('r', f2(62 + 60 * easeOut(l1)));
                lens1.style.opacity = l1 > 0 && l1 < 1 ? f2(1 - l1) : 0;
                lens1.style.strokeWidth = f2(4.5 - 3.6 * l1);
                const l2 = span(ms, tLast + 50, GAL.APPLY);
                lens2.setAttribute('r', f2(62 + 32 * easeOut(l2)));
                lens2.style.opacity = ms > tLast + 50 ? 1 : 0;
                accLit.style.opacity = f2(easeOut(span(ms, tLast - 10, tLast + 60)));
                const dim = span(ms, tLast - 140, tLast - 20) * (1 - span(ms, tLast + 80, tLast + 220));
                set(text, 'opacity', f2(1 - 0.6 * dim));
              };
            });
          },
        },

        sounds: {
          open(ac, out, t, X) {
            X.burst(ac, out, t, { type: 'lowpass', f: 1100, f2: 320, q: 0.7, dur: 0.22, gain: 0.12, a: 0.04 });
            X.tone(ac, out, t, { f: 110, f2: 82, dur: 0.26, gain: 0.05, a: 0.03 });
            X.tone(ac, out, t + 0.04, { f: 660, dur: 0.16, gain: 0.012, a: 0.02 });
          },
          tick(ac, out, t, X) {
            X.tone(ac, out, t, { f: 540, f2: 430, dur: 0.045, gain: 0.07, a: 0.002 });
            X.burst(ac, out, t, { type: 'bandpass', f: 1800, q: 2, dur: 0.012, gain: 0.025 });
          },
          success(ac, out, t, X) {
            X.tone(ac, out, t, { f: 880, f2: 150, dur: 0.42, gain: 0.05, a: 0.02 });
            X.burst(ac, out, t, { type: 'lowpass', f: 1400, f2: 220, q: 1, dur: 0.4, gain: 0.06, a: 0.05 });
            X.tone(ac, out, t + 0.46, { f: 1760, dur: 0.42, gain: 0.05, a: 0.004 });
            X.tone(ac, out, t + 0.46, { f: 2637, dur: 0.3, gain: 0.022, a: 0.004 });
          },
        },
      }),
    );

    // ================================================================== C: Orrery
    const ORR = { SUN: 63, IN: 74, OUT: 183, LBL: 115, R0: 187, R1: 192, ORBITS: [159, 148, 171], APPLY: 680 };
    const ORR_SIZE = [8.4, 7, 9.4, 6.4, 7.8, 8.8, 6.8, 8.2];
    const ORR_KIND = ['band', 'ring', 'moon', 'crater', 'plain', 'ring', 'moon', 'band'];

    function orrPlanet(sl) {
      return {
        r: ORR.ORBITS[sl.i % 3],
        size: ORR_SIZE[sl.i % 8],
        kind: sl.id === 'more' ? 'cluster' : ORR_KIND[sl.i % 8],
      };
    }

    // A planet drawn around 0, 0 with "up" pointing away from the sun; the parent group places and turns it.
    // The lit side faces the sun (down); the shade is a crescent on the outer side.
    function orrBody(H, parent, info, fill) {
      const z = info.size;
      const b = H.s('g', { class: 'orr-body' }, parent);
      if (info.kind === 'cluster') {
        for (const [x, y, r] of [
          [-6.4, 1.8, 4.2],
          [4.4, -3.4, 3.4],
          [4, 5.6, 2.6],
        ])
          H.s('circle', { cx: x, cy: y, r, fill, class: 'orr-ball' }, b);
        return b;
      }
      if (info.kind === 'ring')
        H.s(
          'ellipse',
          { cx: 0, cy: 0, rx: f2(z * 1.95), ry: f2(z * 0.55), transform: 'rotate(-22)', class: 'orr-ringback' },
          b,
        );
      H.s('circle', { cx: 0, cy: 0, r: z, fill, class: 'orr-ball' }, b);
      H.s('path', { d: `M${-z} 0A${z} ${z} 0 0 1 ${z} 0A${z} ${f2(z * 0.42)} 0 0 0 ${-z} 0Z`, class: 'orr-shade' }, b);
      if (info.kind === 'band')
        H.s(
          'path',
          {
            d: `M${f2(-z * 0.94)} ${f2(z * 0.32)}Q0 ${f2(z * 0.52)} ${f2(z * 0.94)} ${f2(z * 0.32)}`,
            class: 'orr-mark',
          },
          b,
        );
      if (info.kind === 'crater')
        for (const [x, y, r] of [
          [-0.32, 0.36, 0.2],
          [0.34, 0.12, 0.13],
        ])
          H.s('circle', { cx: f2(x * z), cy: f2(y * z), r: f2(r * z), class: 'orr-crater' }, b);
      if (info.kind === 'ring')
        H.s(
          'path',
          {
            d: `M${f2(-z * 1.95)} 0A${f2(z * 1.95)} ${f2(z * 0.55)} 0 0 0 ${f2(z * 1.95)} 0`,
            transform: 'rotate(-22)',
            class: 'orr-ringfront',
          },
          b,
        );
      if (info.kind === 'moon') H.s('circle', { cx: f2(z + 4.4), cy: f2(-z * 0.5), r: 2.1, class: 'orr-moon' }, b);
      return b;
    }

    function orrRays(len) {
      let d = '';
      for (let k = 0; k < 16; k++) {
        const a = k * 22.5 + 11.25;
        d += `M${pt(P(ORR.SUN + 9, a))}L${pt(P(ORR.SUN + 9 + len, a))}`;
      }
      return d;
    }

    Board.define(
      Object.assign({}, FAMILY, {
        id: 'astro-c',
        fonts: {
          brand: "'Geologica Variable'",
          load: ["'Geologica Variable'"],
          credits: [{ family: 'Geologica', license: 'SIL Open Font License 1.1' }],
        },
        motion: { open: 180, close: 110, stagger: 12, apply: ORR.APPLY },
        palette: {
          light: {
            bg: '#f1f4f9',
            surface: '#ffffff',
            'surface-2': '#f4f6fa',
            border: '#dae0eb',
            'border-strong': '#8b99b6',
            text: '#0e1938',
            'text-muted': '#4b5874',
            accent: '#1a2a62',
            'on-accent': '#ffffff',
            focus: '#1a2a62',
            success: '#127c56',
            'on-success': '#ffffff',
            'success-text': '#0e6a49',
            warning: '#c2620c',
            'warning-text': '#8d4400',
            danger: '#c0283a',
            desk: 'radial-gradient(90% 70% at 50% -12%, rgba(255, 196, 112, 0.32) 0%, rgba(255, 196, 112, 0) 62%), linear-gradient(170deg, #fbfcfe 0%, #e9eef6 55%, #dce4f1 100%)',
            'wheel-face': '#fcfdff',
            'wheel-slice': '#fcfdff',
            'wheel-slice-hover': '#ebeff7',
            'wheel-slice-selected': '#1a2a62',
            'wheel-text': '#0e1938',
            'wheel-text-selected': '#ffffff',
            'wheel-sub': '#4b5874',
            'wheel-sub-selected': '#cfd8ee',
            'wheel-line': '#45577f',
            'wheel-shadow': 'rgba(20, 34, 80, 0.22)',
            'ast-face': 'radial-gradient(circle at 50% 50%, #fff6e6 0%, #fdfdff 36%, #f3f6fb 100%)',
            'ast-face-edge': 'rgba(26, 42, 98, 0.28)',
            'ast-flash': '#ffffff',
            'ast-halo-idle': '#fcfdff',
            'ast-halo-hover': '#ebeff7',
            'ast-halo-selected': '#1a2a62',
            'ast-hub': '#ffcb6a',
            'ast-hub-text': '#14204a',
            'ast-hub-sub': '#36406a',
            'ast-pill': '#14204a',
            'ast-pill-text': '#ffe2a8',
            'orr-sun-0': '#fffbea',
            'orr-sun-1': '#ffd772',
            'orr-sun-2': '#ff9d42',
            'orr-corona': '#ffad4a',
            'orr-ray': '#f08a26',
            'orr-bright': '#fffdf2',
            'orr-orbit': '#45577f',
            'orr-orbit-hi': '#1a2a62',
            'orr-rim': '#45577f',
            'orr-tick': '#8492b0',
            'orr-pl-hi': '#ffffff',
            'orr-pl': '#8190b4',
            'orr-pl-lo': '#33456f',
            'orr-pl-shade': 'rgba(16, 26, 64, 0.45)',
            'orr-pl-line': '#1a2a62',
            'orr-ghost': '#cfd8ee',
            'orr-line-soft': 'rgba(26, 42, 98, 0.11)',
            'orr-trail': '#f08a26',
            'orr-trail-halo': 'rgba(255, 168, 64, 0.28)',
            'orr-sun-glow': 'rgba(255, 186, 96, 0.28)',
            'ast-mica': 'rgba(255, 255, 255, 0.7)',
          },
          dark: {
            bg: '#0a1126',
            surface: '#111a35',
            'surface-2': '#18234a',
            border: '#27355e',
            'border-strong': '#66779f',
            text: '#eef2fa',
            'text-muted': '#a8b3cb',
            accent: '#e6ebf6',
            'on-accent': '#0e1938',
            focus: '#ffffff',
            success: '#59cf9f',
            'on-success': '#03251a',
            'success-text': '#73dcb2',
            warning: '#f3b25a',
            'warning-text': '#f6c27d',
            danger: '#ff7b88',
            desk: 'radial-gradient(100% 80% at 50% -12%, #1f2e5c 0%, #0c1532 55%, #060b1c 100%)',
            'wheel-face': '#0d1634',
            'wheel-slice': '#0d1634',
            'wheel-slice-hover': '#1d2a52',
            'wheel-slice-selected': '#e7ecf7',
            'wheel-text': '#f1f4fb',
            'wheel-text-selected': '#0e1938',
            'wheel-sub': '#a9b5cf',
            'wheel-sub-selected': '#3d4a6e',
            'wheel-line': '#9cadd2',
            'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
            'ast-face': 'radial-gradient(circle at 50% 50%, #2a2d50 0%, #141e42 32%, #0b1430 100%)',
            'ast-face-edge': 'rgba(190, 205, 235, 0.26)',
            'ast-flash': '#ffe2a6',
            'ast-halo-idle': '#0f1838',
            'ast-halo-hover': '#1d2a52',
            'ast-halo-selected': '#e7ecf7',
            'ast-hub': '#ffcb6a',
            'ast-hub-text': '#14204a',
            'ast-hub-sub': '#36406a',
            'ast-pill': '#14204a',
            'ast-pill-text': '#ffe2a8',
            'orr-sun-0': '#fffbea',
            'orr-sun-1': '#ffd772',
            'orr-sun-2': '#ff9d42',
            'orr-corona': '#ffad4a',
            'orr-ray': '#ffb54f',
            'orr-bright': '#fffdf2',
            'orr-orbit': '#8d9ec4',
            'orr-orbit-hi': '#e7ecf7',
            'orr-rim': '#9cadd2',
            'orr-tick': '#56668e',
            'orr-pl-hi': '#ffffff',
            'orr-pl': '#c8d2e8',
            'orr-pl-lo': '#56668f',
            'orr-pl-shade': 'rgba(8, 14, 40, 0.55)',
            'orr-pl-line': '#e7ecf7',
            'orr-ghost': '#3d4a6e',
            'orr-line-soft': 'rgba(190, 205, 235, 0.1)',
            'orr-trail': '#ffffff',
            'orr-trail-halo': 'rgba(255, 190, 100, 0.38)',
            'orr-sun-glow': 'rgba(255, 176, 80, 0.16)',
            'ast-mica': 'rgba(190, 205, 235, 0.06)',
          },
        },
        contrast: Board.DEFAULT_PAIRS.concat(STATUS_PAIRS, [
          ['ast-hub-text', 'orr-sun-2', 'text'],
          ['orr-orbit', 'wheel-face', 'ui'],
          ['orr-pl', 'wheel-face', 'ui'],
          ['orr-ghost', 'wheel-slice-selected', 'ui'],
        ]),

        wheel: {
          render(root, m, H) {
            const s = H.s;
            const ccw = m.dir === 'rtl';
            const uid = H.uid('astro-c');
            const defs = s('defs', {}, root);
            const sunFill = gradient(
              H,
              defs,
              'radialGradient',
              uid + '-sun',
              { cx: 0.5, cy: 0.5, r: 0.5, fx: 0.42, fy: 0.38 },
              [
                [0, 'orr-s-0', 1],
                [0.55, 'orr-s-1', 1],
                [1, 'orr-s-2', 1],
              ],
            );
            const corFill = gradient(
              H,
              defs,
              'radialGradient',
              uid + '-cor',
              { gradientUnits: 'userSpaceOnUse', cx: C, cy: C, r: 96 },
              [
                [0.6, 'orr-s-cor', 0.55],
                [0.78, 'orr-s-cor', 0.16],
                [1, 'orr-s-cor', 0],
              ],
            );
            const plFill = gradient(
              H,
              defs,
              'radialGradient',
              uid + '-pl',
              { cx: 0.5, cy: 0.6, r: 0.62, fx: 0.5, fy: 0.84 },
              [
                [0, 'orr-s-plhi', 1],
                [0.5, 'orr-s-pl', 1],
                [1, 'orr-s-pllo', 1],
              ],
            );

            // Instrument: rim with a fine scale, the orbits and the slice dividers.
            const deco = s('g', { class: 'orr-deco' }, root);
            const ringP = (r, cls, delay) => {
              const p = s('path', { d: circlePath(r, ccw), class: cls + ' ast-draw', pathLength: 1 }, deco);
              p.style.setProperty('--d', delay + 'ms');
            };
            ringP(ORR.R0, 'orr-rim', 0);
            ringP(ORR.R1, 'orr-rim orr-rim-out', 20);
            let ticks = '';
            for (let k = 0; k < 144; k++)
              ticks += `M${pt(P(ORR.R0, k * 2.5))}L${pt(P(ORR.R0 + (k % 6 === 0 ? 5 : 2.2), k * 2.5))}`;
            s('path', { d: ticks, class: 'orr-ticks' }, deco);
            let divs = '';
            for (const sl of m.slices) divs += `M${pt(P(ORR.IN + 4, sl.a0))}L${pt(P(ORR.R0 - 1, sl.a0))}`;
            s('path', { d: divs, class: 'orr-div' }, deco);
            const orbits = s('g', { class: 'orr-orbits' }, deco);
            s('circle', { cx: C, cy: C, r: 90, class: 'orr-orbit orr-orbit-dot' }, orbits);
            for (const r of ORR.ORBITS) s('circle', { cx: C, cy: C, r, class: 'orr-orbit' }, orbits);
            // A few distant stars outside the orbits.
            const rand = rng(83 + m.kind.length * 13);
            let field = '';
            for (let k = 0; k < 40; k++) {
              const a = rand() * 360;
              const r = lerp(ORR.ORBITS[2] + 3, ORR.R0 - 2.5, rand());
              if (
                m.slices.some(
                  (sl) =>
                    Math.abs(angDiff(a, sl.a0)) * rad(1) * r < 3 || Math.abs(angDiff(a, sl.mid)) * rad(1) * r < 12,
                )
              )
                continue;
              field += dotPath(...P(r, a), f2(0.4 + rand() * 0.55));
            }
            s('path', { d: field, class: 'orr-field' }, deco);

            // The sun's corona and disc sit under the slices; the hub text and flare sit above them.
            const sun = s('g', { class: 'orr-sun' }, root);
            s('circle', { cx: C, cy: C, r: 96, fill: corFill, class: 'orr-corona' }, sun);
            s('circle', { cx: C, cy: C, r: ORR.SUN, fill: sunFill, class: 'orr-disc' }, sun);
            s('circle', { cx: C, cy: C, r: ORR.SUN - 0.6, class: 'orr-limb' }, sun);

            for (const sl of m.slices) {
              const g = H.slice(root, sl, m);
              s('path', { d: H.sector(ORR.IN - 6, 197, sl.a0, sl.a1), class: 'ast-hit' }, g);
              const seg = H.sector(ORR.IN + 1.5, ORR.OUT, sl.a0, sl.a1, 3);
              s('path', { d: seg, class: 'ast-seg' }, g);
              s('path', { d: seg, class: 'ast-flash' }, g);
              s('path', { d: H.sector(ORR.R0 + 1, ORR.R1 - 1, sl.a0, sl.a1, 3), class: 'orr-band' }, g);
              const info = orrPlanet(sl);
              s('path', { d: H.arc(info.r, sl.a0 + 3, sl.a1 - 3), class: 'orr-arc' }, g);
              const [px, py] = P(info.r, sl.mid);
              s(
                'circle',
                { cx: f2(px), cy: f2(py), r: f2(info.kind === 'cluster' ? 10.5 : info.size + 2.4), class: 'orr-ghost' },
                g,
              );
              const swing = s('g', { class: 'orr-swing' }, g);
              const place = s(
                'g',
                { class: 'orr-planet', transform: `translate(${f2(px)} ${f2(py)}) rotate(${f1(sl.mid)})` },
                swing,
              );
              orrBody(H, place, info, plFill);
              sliceLabel(H, g, sl, m, ORR.LBL, { fmt: 23, subSize: 11.5 });
            }

            const hub = s('g', { class: 'ast-hub orr-hub' }, root);
            s('g', { class: 'ast-fx-under' }, hub);
            hubText(H, hub, m, {
              yTitle: C - 17,
              wTitle: 100,
              sTitle: 18,
              yFile: C + 4,
              wFile: 96,
              sFile: 11.5,
              yKey: C + 25,
              keyRx: 9,
              wPill: 96,
            });
            const flare = s('g', { class: 'orr-flare ast-lasting' }, hub);
            s('circle', { cx: C, cy: C, r: ORR.SUN + 5, class: 'orr-crown' }, flare);
            s('path', { d: orrRays(7), class: 'orr-rays' }, flare);
            s('g', { class: 'ast-fx-over' }, root);
          },

          update(root, m, st, H) {
            updateResult(root, m, st, H);
          },

          onOpen(root, m, H, reduced, t) {
            if (t == null) stopFx(root);
          },

          // The planet edges forward on its orbit, falls inward around the sun and the sun flares.
          onSelect(root, m, i, H, t) {
            const sl = m.slices[i];
            const g = root.querySelector(`.slice[data-slice="${i}"]`);
            const sgn = m.dir === 'rtl' ? -1 : 1;
            const info = orrPlanet(sl);
            const T1 = 90;
            const T2 = 460;
            const pos = (ms) => {
              if (ms < T1) {
                const u = easeInOut(span(ms, 0, T1));
                return { r: info.r, a: sl.mid + sgn * 7 * u, s: 1 + 0.18 * u };
              }
              const q = span(ms, T1, T2);
              return {
                r: ORR.SUN + 3 + (info.r - ORR.SUN - 3) * (1 - q) ** 2.2,
                a: sl.mid + sgn * (7 + 200 * q ** 2.2),
                s: 1.18 - 0.6 * q,
              };
            };
            runFx(root, H, t, ORR.APPLY, (under, over, set) => {
              const flash = g.querySelector('.ast-flash');
              const sunG = root.querySelector('.orr-sun');
              const bright = H.s('circle', { cx: C, cy: C, r: ORR.SUN, class: 'orr-bright' }, under);
              const trailHalo = H.s('path', { class: 'orr-trail-halo' }, over);
              const trail = H.s('path', { class: 'orr-trail' }, over);
              const mover = H.s('g', {}, over);
              mover.appendChild(g.querySelector('.orr-body').cloneNode(true));
              const corona = H.s('circle', { cx: C, cy: C, r: ORR.SUN, class: 'orr-corona-fx' }, over);
              const flare = H.s('g', { class: 'orr-flare' }, over);
              const crown = H.s('circle', { cx: C, cy: C, r: ORR.SUN + 5, class: 'orr-crown' }, flare);
              const rays = H.s('path', { class: 'orr-rays' }, flare);
              return (ms) => {
                set(flash, 'opacity', f2(0.95 * (1 - easeOut(span(ms, 0, 200)))));
                if (ms < T2) {
                  const p = pos(ms);
                  const [x, y] = P(p.r, p.a);
                  mover.setAttribute('transform', `translate(${f2(x)} ${f2(y)}) rotate(${f1(p.a)}) scale(${f3(p.s)})`);
                  mover.style.opacity = 1;
                  const pts = [];
                  for (let k = 0; k <= 10; k++) {
                    const pp = pos(lerp(Math.max(0, ms - 150), ms, k / 10));
                    pts.push(P(pp.r, pp.a));
                  }
                  const d = poly(pts);
                  trail.setAttribute('d', d);
                  trailHalo.setAttribute('d', d);
                } else mover.style.opacity = 0;
                const tr = ms < T2 ? span(ms, 30, T1 + 40) : 1 - span(ms, T2, T2 + 90);
                trail.style.opacity = trailHalo.style.opacity = f2(tr);
                const fl = span(ms, T2, T2 + 220);
                corona.setAttribute('r', f2(ORR.SUN + 2 + 56 * easeOut(fl)));
                corona.style.opacity = fl > 0 && fl < 1 ? f2(0.95 * (1 - fl)) : 0;
                corona.style.strokeWidth = f2(5 - 4 * fl);
                const len =
                  ms < T2
                    ? 0
                    : fl < 0.35
                      ? lerp(0, 30, easeOut(fl / 0.35))
                      : lerp(30, 7, easeInOut((fl - 0.35) / 0.65));
                rays.setAttribute('d', len > 0.2 ? orrRays(len) : '');
                crown.style.opacity = f2(easeOut(span(ms, T2 + 30, T2 + 200)));
                const sc =
                  ms < T2
                    ? 1
                    : fl < 0.3
                      ? lerp(1, 1.08, easeOut(fl / 0.3))
                      : lerp(1.08, 1, easeInOut((fl - 0.3) / 0.7));
                set(sunG, 'transform', `scale(${f3(sc)})`);
                bright.style.opacity = ms < T2 ? 0 : f2(0.7 * Math.sin(Math.PI * fl));
              };
            });
          },
        },

        sounds: {
          open(ac, out, t, X) {
            X.burst(ac, out, t, { type: 'bandpass', f: 600, f2: 2200, q: 4, dur: 0.16, gain: 0.08, a: 0.03 });
            X.tone(ac, out, t + 0.12, { type: 'triangle', f: 1320, dur: 0.03, gain: 0.03, a: 0.001 });
          },
          tick(ac, out, t, X) {
            X.tone(ac, out, t, { type: 'triangle', f: 1900, f2: 1700, dur: 0.022, gain: 0.07, a: 0.001 });
            X.burst(ac, out, t, { type: 'highpass', f: 4500, q: 0.7, dur: 0.01, gain: 0.04 });
          },
          success(ac, out, t, X) {
            X.tone(ac, out, t + 0.05, { f: 1200, f2: 420, dur: 0.38, gain: 0.035, a: 0.02 });
            for (const [f, g] of [
              [523.25, 0.05],
              [659.25, 0.045],
              [783.99, 0.04],
              [1046.5, 0.02],
            ])
              X.tone(ac, out, t + 0.46, { f, dur: 0.7, gain: g, a: 0.03 });
            X.burst(ac, out, t + 0.46, { type: 'lowpass', f: 3000, f2: 700, q: 0.8, dur: 0.4, gain: 0.04, a: 0.03 });
          },
        },
      }),
    );
  })();
}
