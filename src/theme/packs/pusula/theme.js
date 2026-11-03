// SPDX-License-Identifier: MIT
// Pusula. A compass rose drawn on chart paper: every slice is a direction, and a
// needle swings to the slice under the pointer or the keyboard.
export default function register(Board) {
  (function () {
    'use strict';

    // The italic and the heavier Fira weights are not in the engine's font wait list; ask for
    // them now so labels are measured in the right face (document.fonts.ready waits for them).
    if (document.fonts) {
      for (const f of [
        "italic 400 16px 'Vollkorn Variable'",
        "600 16px 'Vollkorn Variable'",
        "500 16px 'Fira Sans'",
        "600 16px 'Fira Sans'",
      ]) {
        document.fonts.load(f).catch(() => null);
      }
    }

    // Radii of the wheel (viewBox 400 x 400, center 200, 200).
    const R = { cap: 56, tip: 105, tail: 86, inner: 102, label: 141, outer: 180, band: 192, rim: 196 };
    const f2 = (n) => Math.round(n * 100) / 100;

    // A kite on the line at angle a: from radius r0 to r1, widest (half-width w) at radius rw.
    // Returns its two halves, counterclockwise side first, as path data.
    function kite(H, a, r0, r1, rw, w) {
      const rad = H.rad(a);
      const u = [Math.sin(rad), -Math.cos(rad)];
      const v = [Math.cos(rad), Math.sin(rad)];
      const p = (r, s) => `${f2(H.C + u[0] * r + v[0] * s)} ${f2(H.C + u[1] * r + v[1] * s)}`;
      return [`M${p(r0, 0)}L${p(rw, -w)}L${p(r1, 0)}Z`, `M${p(r0, 0)}L${p(rw, w)}L${p(r1, 0)}Z`];
    }

    // Where the needle rests when nothing is aimed at: the star point between the last slice and
    // the first one, so it never seems to pick a slice. Mirrored in right-to-left languages.
    const restAngle = (m) => ((m.dir === 'rtl' ? 1 : -1) * m.step) / 2;

    Board.define({
      id: 'pusula',
      fonts: {
        brand: "'Fira Sans'",
        display: "'Vollkorn Variable'",
        load: ["'Vollkorn Variable'", "'Fira Sans'"],
        // Fira Sans first: the type specimen is set in the brand face and labeled with credits[0].
        credits: [
          { family: 'Fira Sans', license: 'SIL Open Font License 1.1' },
          { family: 'Vollkorn', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 120, stagger: 9 },

      palette: {
        light: {
          bg: '#f5f0e6',
          layer: '#fbf8f1',
          surface: '#fffdf8',
          'surface-2': '#efe8da',
          border: '#e1d7c4',
          'border-strong': '#b3a385',
          text: '#1d2836',
          'text-muted': '#5c5649',
          accent: '#a83a22',
          'on-accent': '#fffaf1',
          focus: '#235d8c',
          success: '#2f7a4d',
          'on-success': '#ffffff',
          'success-text': '#256840',
          warning: '#b8781a',
          'warning-text': '#7c4f0c',
          danger: '#b0281c',
          desk: 'linear-gradient(135deg, #c3cdd0 0%, #d8d5ca 55%, #c2cccb 100%)',
          'wheel-face': '#f4ead4',
          'paper-edge': '#e5d3ae',
          'wheel-slice': '#f4ead4',
          'wheel-slice-hover': '#ebd5bf',
          'wheel-slice-selected': '#a83a22',
          'wheel-text': '#1d2836',
          'wheel-text-selected': '#fff6e6',
          'wheel-sub': '#5e5545',
          'wheel-muted': '#7a6f5c',
          'wheel-line': '#8c7b5e',
          'wheel-ink': '#1d2836',
          'wheel-shadow': 'rgba(52, 38, 14, 0.34)',
          needle: '#a83a22',
          'needle-dark': '#76261a',
          'needle-rest': '#4b5767',
          'needle-rest-dark': '#2c3746',
          rhumb: 'rgba(122, 98, 60, 0.3)',
          hatch: 'rgba(29, 40, 54, 0.26)',
          'grain-opacity': '0.55',
        },
        dark: {
          bg: '#0f1824',
          layer: '#132031',
          surface: '#18263a',
          'surface-2': '#1f2f44',
          border: '#2b3d53',
          'border-strong': '#4c6179',
          text: '#ece3cf',
          'text-muted': '#aeaa9e',
          accent: '#ef8b72',
          'on-accent': '#20100b',
          focus: '#8cc3ec',
          success: '#5cc98a',
          'on-success': '#0a2414',
          'success-text': '#6fd49a',
          warning: '#e9b155',
          'warning-text': '#f0c070',
          danger: '#ff7a6b',
          desk: 'linear-gradient(135deg, #0a1018 0%, #141b27 55%, #0c171c 100%)',
          'wheel-face': '#15273b',
          'paper-edge': '#0e1b2b',
          'wheel-slice': '#15273b',
          'wheel-slice-hover': '#284060',
          'wheel-slice-selected': '#ef8b72',
          'wheel-text': '#ece3cf',
          'wheel-text-selected': '#1a0f0a',
          'wheel-sub': '#a7b3bf',
          'wheel-muted': '#7d8a99',
          'wheel-line': '#7f95ad',
          'wheel-ink': '#d9cfb8',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          needle: '#ef8b72',
          'needle-dark': '#c25c46',
          'needle-rest': '#9aa7b5',
          'needle-rest-dark': '#71808f',
          rhumb: 'rgba(160, 186, 212, 0.22)',
          hatch: 'rgba(220, 210, 190, 0.24)',
          'grain-opacity': '0.8',
        },
      },
      contrast: [
        ['text', 'bg', 'text'],
        ['text', 'surface', 'text'],
        ['text-muted', 'bg', 'text'],
        ['text-muted', 'surface', 'text'],
        ['text-muted', 'layer', 'text'],
        ['text-muted', 'surface-2', 'text'],
        ['on-accent', 'accent', 'text'],
        ['accent', 'surface', 'ui'],
        ['focus', 'bg', 'ui'],
        ['success', 'surface', 'ui'],
        ['success-text', 'surface', 'text'],
        ['warning-text', 'surface', 'text'],
        ['on-success', 'success', 'text'],
        ['wheel-text', 'wheel-slice', 'text'],
        ['wheel-text', 'wheel-slice-hover', 'text'],
        ['wheel-text-selected', 'wheel-slice-selected', 'text'],
        ['wheel-sub', 'wheel-face', 'text'],
        ['wheel-sub', 'wheel-slice-hover', 'text'],
        ['wheel-ink', 'wheel-face', 'ui'],
        ['needle', 'wheel-face', 'ui'],
        ['needle-rest', 'wheel-face', 'ui'],
        ['wheel-muted', 'wheel-face', 'ui'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          // Chart lines under the slices: 32 rhumb lines, the slice ring rules, the degree ring.
          const face = H.s('g', { class: 'pu-face', 'aria-hidden': 'true' }, root);
          let rh = '';
          for (let k = 0; k < m.n * 4; k++) {
            const a = (k * m.step) / 4;
            const [x0, y0] = H.polar(R.cap + 2, a);
            const [x1, y1] = H.polar(R.outer, a);
            rh += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d: rh, class: 'pu-rhumbs' }, face);
          let ticks = '';
          const per = 12;
          for (let k = 0; k < m.n * per; k++) {
            const a = (k * m.step) / per;
            const len = k % per === 0 ? 9 : k % (per / 2) === 0 ? 7 : k % 3 === 0 ? 4.5 : 2.6;
            const [x0, y0] = H.polar(R.band - len, a);
            const [x1, y1] = H.polar(R.band, a);
            ticks += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d: ticks, class: 'pu-ticks' }, face);
          H.s('circle', { cx: C, cy: C, r: R.outer, class: 'pu-rule pu-rule-thin' }, face);
          H.s('circle', { cx: C, cy: C, r: R.band, class: 'pu-rule' }, face);
          H.s('circle', { cx: C, cy: C, r: R.rim, class: 'pu-rule pu-rim' }, face);
          H.s('circle', { cx: C, cy: C, r: R.inner, class: 'pu-rule' }, face);
          H.s('circle', { cx: C, cy: C, r: R.inner - 3.5, class: 'pu-rule pu-rule-thin' }, face);

          // Slices: a hit area from the hub to the rim, the visible wedge and the lubber mark.
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.cap, R.rim + 2, sl.a0, sl.a1), class: 'pu-hit' }, g);
            H.s('path', { d: H.sector(R.inner + 0.6, R.outer - 0.4, sl.a0, sl.a1), class: 'pu-wedge' }, g);
            if (sl.off) {
              // Not installed yet: hatched like uncharted water.
              const id = H.uid('pusula-clip');
              const cp = H.s('clipPath', { id }, g);
              H.s('path', { d: H.sector(R.inner + 1, R.outer - 1, sl.a0, sl.a1) }, cp);
              let d = '';
              for (let x = -400; x <= 400; x += 5.5) d += `M${x} 0L${x + 400} 400`;
              H.s('path', { d, class: 'pu-hatch', 'clip-path': `url(#${id})` }, g);
            }
            const d = 1.5;
            const [tx, ty] = H.polar(R.outer + 1.5, sl.mid);
            const [ax, ay] = H.polar(R.band - 0.5, sl.mid - d);
            const [bx, by] = H.polar(R.band - 0.5, sl.mid + d);
            H.s('path', { d: `M${f2(tx)} ${f2(ty)}L${f2(ax)} ${f2(ay)}L${f2(bx)} ${f2(by)}Z`, class: 'pu-mark' }, g);
            const c = H.s('g', { class: 'pu-ink' }, g);
            if (m.kind === 'convert' && sl.sub) {
              H.block(c, sl, R.label, {
                size: 22,
                subSize: 12.5,
                gap: 1,
                maxWidth: 68,
                minSize: 9,
                cls: 'pu-lbl pu-fmt pu-type',
                subCls: 'pu-sub pu-type',
              });
            } else {
              H.block(c, sl, R.label, {
                icon: true,
                iconSize: 23,
                size: 14.5,
                gap: 3.5,
                maxWidth: 70,
                minSize: 9.5,
                cls: 'pu-lbl pu-type',
                sub: null,
              });
            }
          }

          // Star points between the slices; the one where the needle rests is the north point.
          const rose = H.s('g', { class: 'pu-rose', 'aria-hidden': 'true' }, root);
          const rest = restAngle(m);
          for (const sl of m.slices) {
            // Each slice's a0 is one boundary; together they cover every boundary in both directions.
            const isNorth = Math.abs((((sl.a0 - rest) % 360) + 360) % 360) < 0.01;
            const [l, r] = isNorth
              ? kite(H, sl.a0, R.inner - 1, R.rim, R.inner + 13, 8)
              : kite(H, sl.a0, R.inner - 1, R.band - 1, R.inner + 11, 6.2);
            const g = H.s('g', { class: 'pu-pt' + (isNorth ? ' pu-north' : '') }, rose);
            H.s('path', { d: l, class: 'pu-pt-a' }, g);
            H.s('path', { d: r, class: 'pu-pt-b' }, g);
          }

          // The needle pivots under the hub; update() turns the outer group, the open
          // animation swings the inner one.
          const nd = H.s('g', { class: 'pu-needle', 'aria-hidden': 'true' }, root);
          const sw = H.s('g', { class: 'pu-swing' }, nd);
          const W = 17;
          H.s('path', { d: `M${C} ${C - R.tip}L${C - W} ${C}L${C} ${C}Z`, class: 'pu-n-a' }, sw);
          H.s('path', { d: `M${C} ${C - R.tip}L${C + W} ${C}L${C} ${C}Z`, class: 'pu-n-b' }, sw);
          H.s('path', { d: `M${C} ${C + R.tail}L${C - W} ${C}L${C} ${C}Z`, class: 'pu-n-c' }, sw);
          H.s('path', { d: `M${C} ${C + R.tail}L${C + W} ${C}L${C} ${C}Z`, class: 'pu-n-d' }, sw);

          // Hub: the pivot cap carries the wheel's name, the file and the key that opened it.
          const cap = H.s('g', { class: 'pu-cap' }, root);
          H.s('circle', { cx: C, cy: C, r: R.cap, class: 'pu-cap-disc' }, cap);
          H.s('circle', { cx: C, cy: C, r: R.cap - 4.5, class: 'pu-cap-ring' }, cap);
          H.label(cap, C, C - 17, m.title, {
            maxWidth: 86,
            size: 15.5,
            minSize: 10,
            cls: 'pu-title pu-type',
            maxLines: 1,
          });
          H.label(cap, C, C + 2, m.file, {
            maxWidth: 84,
            size: 11,
            minSize: 8.5,
            cls: 'pu-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          const kw = 14 + m.key.length * 6.6;
          H.s('rect', { x: f2(C - kw / 2), y: C + 15, width: f2(kw), height: 17, rx: 8.5, class: 'pu-key' }, cap);
          H.text(cap, C, C + 23.8, m.key, { class: 'pu-keytext' });
        },

        update(root, m, st) {
          const target = st.hover ?? st.selected;
          const goal = target == null ? restAngle(m) : m.slices[target].mid;
          const nd = root.querySelector('.pu-needle');
          const prev = nd.__angle;
          // Turn the short way round; the angle accumulates so the needle never spins back.
          const next = prev == null ? goal : prev + ((((goal - prev) % 360) + 540) % 360) - 180;
          nd.__angle = next;
          if (prev == null) {
            nd.style.transition = 'none';
            nd.style.transform = `rotate(${f2(next)}deg)`;
            void nd.getBoundingClientRect();
            nd.style.transition = '';
          } else {
            nd.style.transform = `rotate(${f2(next)}deg)`;
          }
          root.classList.toggle('pu-aiming', target != null);
          root.classList.toggle('pu-aim-off', target != null && m.slices[target].off);
        },

        onSelect(root) {
          root.classList.remove('pu-fix');
          void root.getBoundingClientRect();
          root.classList.add('pu-fix');
          clearTimeout(root.__fix);
          root.__fix = setTimeout(() => root.classList.remove('pu-fix'), 420);
        },
      },

      sounds: {
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 2400, f2: 800, q: 0.9, dur: 0.09, gain: 0.16, a: 0.006 });
          X.tone(ac, out, t + 0.012, { type: 'triangle', f: 240, f2: 190, dur: 0.06, gain: 0.07, a: 0.002 });
        },
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { f: 3300, f2: 2950, dur: 0.022, gain: 0.07, a: 0.001 });
          X.burst(ac, out, t, { type: 'highpass', f: 6200, q: 0.8, dur: 0.008, gain: 0.05 });
        },
        success(ac, out, t, X) {
          // Two light strikes of a small bell: inharmonic partials that die away at different rates.
          for (const s of [0, 0.19]) {
            X.tone(ac, out, t + s, { f: 988, dur: 0.62, gain: 0.085, a: 0.003 });
            X.tone(ac, out, t + s, { f: 988 * 2.76, dur: 0.3, gain: 0.03, a: 0.002 });
            X.tone(ac, out, t + s, { f: 988 * 5.4, dur: 0.12, gain: 0.012, a: 0.001 });
          }
        },
      },
    });
  })();
}
