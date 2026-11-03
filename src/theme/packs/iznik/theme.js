// SPDX-License-Identifier: MIT
// İznik: a glazed tile rosette. White fritware panels outlined in cobalt, a cobalt border band of
// lobed cartouches holding our own tulip and carnation, and a petal rosette round the hub.
// Applying a slice floods it with cobalt glaze from the hub outward, then a glaze shine sweeps across.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    // Radii in the 400 x 400 view box.
    const R = { hub: 55, rose: 74, in: 77, out: 154, band0: 158, band1: 195, lbl: 114, cart: 176.5 };

    // ---------------------------------------------------------------- motifs
    // Drawn pointing up (outward from the hub), centered on (0, 0), about 30 units tall.
    const TULIP = {
      stem: 'M0 14C.6 9-.6 5 0 1.5',
      leaf: 'M0 12.5C-4.2 10.6-9.6 6.4-11.4-.6C-7.2 1.6-3 5.2 0 9.6ZM0 12.5C4.2 10.6 9.6 6.4 11.4-.6C7.2 1.6 3 5.2 0 9.6Z',
      head: 'M0 2.4C-5.4 2.4-8 -2.8-7.6-9.4L-4.6-6.6C-4.2-10.6-2.2-13.8 0-16C2.2-13.8 4.2-10.6 4.6-6.6L7.6-9.4C8-2.8 5.4 2.4 0 2.4Z',
      heart: 'M0 .2C-2.6-1.8-3-6-0-10.4C3-6 2.6-1.8 0 .2Z',
    };
    const CARNATION = {
      stem: 'M0 14C.6 9-.6 6 0 2',
      leaf: 'M0 11C-3.6 10.4-8.4 8-10.6 3.4C-6.6 4.4-2.8 6.6 0 8.6ZM0 11C3.6 10.4 8.4 8 10.6 3.4C6.6 4.4 2.8 6.6 0 8.6Z',
      cup: 'M-3.6 2.2L-2.7-3.6H2.7L3.6 2.2C2 3.8-2 3.8-3.6 2.2Z',
      head: 'M-2.7-3.6C-6.4-4.6-9.4-8-9.8-12.4L-7.6-11.2-6.6-14.6-4.4-12.2-2.4-16 0-12.8 2.4-16 4.4-12.2 6.6-14.6 7.6-11.2 9.8-12.4C9.4-8 6.4-4.6 2.7-3.6Z',
      stripes: 'M0-4.6V-12.2M-1.6-4.6L-4.4-11.4M1.6-4.6L4.4-11.4M-2.4-4.4L-7.2-10.2M2.4-4.4L7.2-10.2',
    };
    // A lobed cartouche, long side along the band.
    const CART =
      'M-37 0C-33-4-28-14.2-16-15.2C-9-15.8-4-13.8 0-16C4-13.8 9-15.8 16-15.2C28-14.2 33-4 37 0C33 4 28 14.2 16 15.2C9 15.8 4 13.8 0 16C-4 13.8-9 15.8-16 15.2C-28 14.2-33 4-37 0Z';
    // Saz-leaf sprigs either side of the flower, lying along the band.
    const SPRIG = {
      stem: 'M10.5 4.6C16 2.4 22 2.2 30.5 .4M-10.5 4.6C-16 2.4-22 2.2-30.5 .4',
      leaf: 'M13 4C16.4-2.6 22.4-5.6 29.4-4.6C24.8-2.4 19.4 .6 13 4ZM-13 4C-16.4-2.6-22.4-5.6-29.4-4.6C-24.8-2.4-19.4 .6-13 4Z',
      bud: 'M22.6 5.8a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0ZM-22.6 5.8a2.3 2.3 0 1 0 -4.6 0a2.3 2.3 0 1 0 4.6 0Z',
    };
    // Four small petals where two cartouches meet.
    const QUAT =
      'M0-5.6C1.6-3.2 1.6-1.6 0 0C-1.6-1.6-1.6-3.2 0-5.6ZM0 5.6C1.6 3.2 1.6 1.6 0 0C-1.6 1.6-1.6 3.2 0 5.6ZM-5.6 0C-3.2 1.6-1.6 1.6 0 0C-1.6-1.6-3.2-1.6-5.6 0ZM5.6 0C3.2 1.6 1.6 1.6 0 0C1.6-1.6 3.2-1.6 5.6 0Z';
    const SPARK = 'M0-9L1.6-1.6 9 0 1.6 1.6 0 9-1.6 1.6-9 0-1.6-1.6Z';

    function flower(parent, H, i) {
      const t = i % 2 === 0 ? TULIP : CARNATION;
      const g = H.s('g', { class: 'iz-flower' }, parent);
      H.s('path', { d: t.leaf, class: 'iz-leaf' }, g);
      H.s('path', { d: t.stem, class: 'iz-stem' }, g);
      if (t === TULIP) {
        H.s('path', { d: t.head, class: 'iz-red' }, g);
        H.s('path', { d: t.heart, class: 'iz-heart' }, g);
      } else {
        H.s('path', { d: t.cup, class: 'iz-cup' }, g);
        H.s('path', { d: t.head, class: 'iz-red' }, g);
        H.s('path', { d: t.stripes, class: 'iz-stripe' }, g);
      }
      return g;
    }

    const dot = (x, y, r) => `M${f2(x - r)} ${f2(y)}a${r} ${r} 0 1 0 ${f2(2 * r)} 0a${r} ${r} 0 1 0 ${f2(-2 * r)} 0Z`;

    // The rosette round the hub: sixteen teardrop petals, cobalt and turquoise in turn, red dots between.
    function rosette(parent, H) {
      const C = H.C;
      const g = H.s('g', { class: 'iz-rosette' }, parent);
      H.s('circle', { cx: C, cy: C, r: R.rose + 1.5, class: 'iz-rose-bed' }, g);
      const petal = `M${C - 8.6} ${C - R.hub - 1.5}C${C - 8.6} ${C - R.hub - 9} ${C - 3.6} ${C - R.rose + 6} ${C} ${C - R.rose + 0.5}C${C + 3.6} ${C - R.rose + 6} ${C + 8.6} ${C - R.hub - 9} ${C + 8.6} ${C - R.hub - 1.5}Q${C} ${C - R.hub + 1.2} ${C - 8.6} ${C - R.hub - 1.5}Z`;
      for (let k = 0; k < 16; k++) {
        H.s(
          'path',
          { d: petal, class: k % 2 ? 'iz-petal-b' : 'iz-petal-a', transform: `rotate(${k * 22.5} ${C} ${C})` },
          g,
        );
      }
      let dots = '';
      for (let k = 0; k < 16; k++) {
        const [x, y] = H.polar(R.rose - 4.5, k * 22.5 + 11.25);
        dots += dot(x, y, 1.9);
      }
      H.s('path', { d: dots, class: 'iz-rose-dot' }, g);
      return g;
    }

    function hub(root, m, H) {
      const C = H.C;
      const g = H.s('g', { class: 'iz-hub' }, root);
      rosette(g, H);
      H.s('circle', { cx: C, cy: C, r: R.hub, class: 'iz-hub-disc' }, g);
      H.s('circle', { cx: C, cy: C, r: R.hub - 4.5, class: 'iz-hub-ring' }, g);
      // Without a key (a ring opened from the keyboard, say) the title and file sit lower.
      const dy = m.key ? 0 : 9;
      H.label(g, C, C - 15 + dy, m.title, { maxWidth: 88, size: 18, minSize: 11, maxLines: 1, cls: 'iz-title' });
      H.label(g, C, C + 4.5 + dy, m.file, { maxWidth: 86, size: 12.5, minSize: 9, maxLines: 1, cls: 'iz-file' });
      if (!m.key) return;
      const kw = 16 + m.key.length * 6.6;
      H.s('rect', { x: f2(C - kw / 2), y: C + 16, width: f2(kw), height: 18, rx: 9, class: 'iz-key' }, g);
      H.text(g, C, C + 25.4, m.key, { class: 'iz-keytext' });
    }

    Board.define({
      id: 'iznik',
      fonts: {
        brand: "'Alegreya Sans'",
        display: "'Alegreya'",
        load: ["'Alegreya'", "'Alegreya Sans'"],
        credits: [
          { family: 'Alegreya', license: 'SIL Open Font License 1.1' },
          { family: 'Alegreya Sans', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 170, close: 110, stagger: 12, apply: 640 },
      palette: {
        light: {
          bg: '#f3f7f8',
          surface: '#ffffff',
          'surface-2': '#edf3f5',
          border: '#d3dee4',
          'border-strong': '#9cb0bd',
          text: '#14213d',
          'text-muted': '#4b5b72',
          accent: '#1f45a8',
          'on-accent': '#ffffff',
          focus: '#1f45a8',
          success: '#18806e',
          'on-success': '#ffffff',
          'success-text': '#126a5b',
          warning: '#c98a12',
          'warning-text': '#875800',
          danger: '#c0392b',
          desk: 'radial-gradient(130% 100% at 28% 18%, #eef7f7 0%, #d9e9ee 55%, #c6dbe5 100%)',
          'wheel-face': '#fbfcfd',
          'wheel-slice': '#fbfcfd',
          'wheel-slice-hover': '#d6efed',
          'wheel-slice-selected': '#1f45a8',
          'wheel-text': '#162a6e',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#1f3a8a',
          'wheel-shadow': 'rgba(18, 40, 86, 0.3)',
          'iz-sub': '#3b4a72',
          'iz-sub-selected': '#dbe6ff',
          'iz-band': '#1d3c94',
          'iz-band-hover': '#2a4fb0',
          'iz-band-line': '#ffffff',
          'iz-cart': '#ffffff',
          'iz-cart-hover': '#e4f6f4',
          'iz-cart-selected': '#c3ece8',
          'iz-cart-line': '#1f3a8a',
          'iz-red': '#cf3b2a',
          'iz-red-edge': '#8f2116',
          'iz-turq': '#1497a0',
          'iz-green': '#2d8656',
          'iz-stem': '#1f3a8a',
          'iz-petal-a': '#1f45a8',
          'iz-petal-b': '#1497a0',
          'iz-rose-dot': '#cf3b2a',
          'iz-rose-bed': '#ffffff',
          'iz-hub': '#ffffff',
          'iz-hub-ring': '#1497a0',
          'iz-title': '#162a6e',
          'iz-file': '#46557a',
          'iz-key': '#eaf3f6',
          'iz-key-line': '#9fb6c8',
          'iz-keytext': '#2c3c66',
          'iz-flood': '#1f45a8',
          'iz-gloss-opacity': '1',
          'iz-glaze-opacity': '0.55',
        },
        dark: {
          bg: '#0b1430',
          surface: '#121d40',
          'surface-2': '#18264f',
          border: '#26386a',
          'border-strong': '#4a62a0',
          text: '#eef2ff',
          'text-muted': '#a9b6d8',
          accent: '#4fd1c5',
          'on-accent': '#06201f',
          focus: '#7fe0d6',
          success: '#4fd1a0',
          'on-success': '#04261a',
          'success-text': '#6fe0b4',
          warning: '#f2c14e',
          'warning-text': '#f6d37d',
          danger: '#ff7a6b',
          desk: 'radial-gradient(130% 100% at 28% 18%, #1a2a62 0%, #0f1a3d 58%, #0a1129 100%)',
          'wheel-face': '#14307c',
          'wheel-slice': '#16337f',
          'wheel-slice-hover': '#2347a6',
          'wheel-slice-selected': '#46c9c0',
          'wheel-text': '#f5f8ff',
          'wheel-text-selected': '#04201f',
          'wheel-line': '#dfe8ff',
          'wheel-shadow': 'rgba(0, 4, 20, 0.6)',
          'iz-sub': '#c7d4f6',
          'iz-sub-selected': '#0b3431',
          'iz-band': '#0b1846',
          'iz-band-hover': '#13256a',
          'iz-band-line': '#7fd8d0',
          'iz-cart': '#1b3a8e',
          'iz-cart-hover': '#2550b4',
          'iz-cart-selected': '#2b5fc8',
          'iz-cart-line': '#7fd8d0',
          'iz-red': '#ff6f58',
          'iz-red-edge': '#ffd0c4',
          'iz-turq': '#5ad8cd',
          'iz-green': '#6fd39a',
          'iz-stem': '#dfe8ff',
          'iz-petal-a': '#e9efff',
          'iz-petal-b': '#4fd1c5',
          'iz-rose-dot': '#ff6f58',
          'iz-rose-bed': '#0f2468',
          'iz-hub': '#f4f7ff',
          'iz-hub-ring': '#1497a0',
          'iz-title': '#13286b',
          'iz-file': '#3e4d78',
          'iz-key': '#e2eaf8',
          'iz-key-line': '#91a6cf',
          'iz-keytext': '#22335e',
          'iz-flood': '#46c9c0',
          'iz-gloss-opacity': '0.9',
          'iz-glaze-opacity': '0.2',
        },
      },
      contrast: Board.DEFAULT_PAIRS.concat([
        ['iz-sub', 'wheel-slice', 'text'],
        ['iz-sub', 'wheel-slice-hover', 'text'],
        ['iz-sub-selected', 'wheel-slice-selected', 'text'],
        ['iz-title', 'iz-hub', 'text'],
        ['iz-file', 'iz-hub', 'text'],
        ['iz-red', 'iz-cart', 'ui'],
        ['iz-band-line', 'iz-band', 'ui'],
      ]),
      defs: `
      <linearGradient id="iznik-gloss" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".3" stop-color="#ffffff" stop-opacity=".22"/>
        <stop offset=".46" stop-color="#ffffff" stop-opacity=".85"/>
        <stop offset=".52" stop-color="#ffffff" stop-opacity="1"/>
        <stop offset=".58" stop-color="#ffffff" stop-opacity=".6"/>
        <stop offset=".64" stop-color="#ffffff" stop-opacity=".12"/>
        <stop offset=".76" stop-color="#ffffff" stop-opacity=".45"/>
        <stop offset=".8" stop-color="#ffffff" stop-opacity=".1"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="iznik-glaze" cx=".38" cy=".3" r=".8">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".5"/>
        <stop offset=".55" stop-color="#ffffff" stop-opacity=".08"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>`,

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const defs = H.s('defs', {}, root);
          // The tile body (its shadow is the wrapper's ::before).
          H.s('circle', { cx: C, cy: C, r: R.band1, class: 'iz-face' }, root);

          // The band holds one cartouche for about every 36 degrees, so a wheel of two slices is as rich as
          // one of eight; tulips and carnations take turns all the way round.
          const perSlice = (sl) => Math.max(1, Math.floor(sl.step / 36));
          let flowers = 0;
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.in, R.out, sl.a0, sl.a1), class: 'iz-seg' }, g);
            H.s('path', { d: H.sector(R.band0, R.band1, sl.a0, sl.a1), class: 'iz-band' }, g);

            // Apply effect layer, clipped to the panel; shown only while the slice is applied.
            const clipId = H.uid('iznik-clip');
            H.s('path', { d: H.sector(R.in - 1, R.band1, sl.a0, sl.a1) }, H.s('clipPath', { id: clipId }, defs));
            const fx = H.s('g', { class: 'iz-fx', 'clip-path': `url(#${clipId})` }, g);
            H.s('path', { d: H.sector(R.in - 1, R.out + 0.5, sl.a0, sl.a1), class: 'iz-flood' }, fx);
            const [gx, gy] = H.polar((R.in + R.band1) / 2, sl.mid);
            const gw = H.s('g', { transform: `translate(${f2(gx)} ${f2(gy)}) rotate(28)` }, fx);
            // A wide slice needs a longer sweep for the shine to cross all of it.
            const sweep = Math.round(140 + Math.max(0, Math.min(sl.step, 180) - 45) * 0.75);
            const gloss = H.s(
              'rect',
              { x: -30, y: -210, width: 60, height: 420, class: 'iz-gloss', fill: 'url(#iznik-gloss)' },
              gw,
            );
            gloss.style.setProperty('--iz-sweep', sweep + 'px');

            // Cartouches and flowers in the border band, pointing outward like a rosette.
            const k = perSlice(sl);
            for (let j = 0; j < k; j++) {
              const a = sl.a0 + (sl.step * (j + 0.5)) / k;
              const [cx, cy] = H.polar(R.cart, a);
              const cart = H.s(
                'g',
                { class: 'iz-cart', transform: `translate(${f2(cx)} ${f2(cy)}) rotate(${f2(a)})` },
                g,
              );
              H.s('path', { d: CART, class: 'iz-cart-bg' }, cart);
              H.s('path', { d: SPRIG.stem, class: 'iz-stem' }, cart);
              H.s('path', { d: SPRIG.leaf, class: 'iz-sprig' }, cart);
              H.s('path', { d: SPRIG.bud, class: 'iz-bud' }, cart);
              const fl = H.s('g', { class: 'iz-bloom', transform: 'translate(0 .4) scale(.95)' }, cart);
              flower(fl, H, flowers++);
            }

            const [sx, sy] = H.polar(R.out - 12, sl.mid + Math.min(sl.step * 0.28, 16));
            H.s('path', { d: SPARK, class: 'iz-spark' }, H.s('g', { transform: `translate(${f2(sx)} ${f2(sy)})` }, g));

            const c = H.s('g', { class: 'iz-ink' }, g);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 23.5,
                subSize: 13.5,
                gap: 1.5,
                maxWidth: 74,
                minSize: 11,
                cls: 'iz-lbl iz-fmt',
                subCls: 'iz-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 14.5,
                gap: 4,
                maxWidth: 76,
                minSize: 9.5,
                cls: 'iz-lbl iz-word',
                sub: null,
              });
            }
          }

          // Line work over the panels: cobalt dividers, the band's edges and a small quatrefoil where cartouches meet.
          const lines = H.s('g', { class: 'iz-lines', 'aria-hidden': 'true' }, root);
          let d = '';
          for (const sl of m.slices) {
            const [x0, y0] = H.polar(R.in, sl.a0);
            const [x1, y1] = H.polar(R.out, sl.a0);
            d += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d, class: 'iz-div' }, lines);
          H.s('circle', { cx: C, cy: C, r: R.out, class: 'iz-ring' }, lines);
          H.s('circle', { cx: C, cy: C, r: R.band0 - 2, class: 'iz-ring-turq' }, lines);
          H.s('circle', { cx: C, cy: C, r: R.band0 + 2.6, class: 'iz-band-edge' }, lines);
          H.s('circle', { cx: C, cy: C, r: R.band1 - 2.6, class: 'iz-band-edge' }, lines);
          H.s('circle', { cx: C, cy: C, r: R.band1, class: 'iz-rim' }, lines);
          for (const sl of m.slices) {
            const k = perSlice(sl);
            for (let j = 0; j < k; j++) {
              const a = sl.a0 + (sl.step * j) / k;
              const [qx, qy] = H.polar(R.cart, a);
              H.s(
                'path',
                {
                  d: QUAT,
                  class: j ? 'iz-quat iz-quat-in' : 'iz-quat',
                  transform: `translate(${f2(qx)} ${f2(qy)}) rotate(${f2(a + 45)}) scale(1.2)`,
                },
                lines,
              );
            }
          }
          H.s('circle', { cx: C, cy: C, r: R.band1, class: 'iz-glaze', fill: 'url(#iznik-glaze)' }, lines);

          hub(root, m, H);
        },
      },

      sounds: {
        // A soft clink of glazed tile: two inharmonic partials and a little contact noise.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 3200, q: 2.2, dur: 0.025, gain: 0.07 });
          X.tone(ac, out, t + 0.004, { f: 1568, dur: 0.16, gain: 0.05, a: 0.002 });
          X.tone(ac, out, t + 0.004, { f: 2494, dur: 0.09, gain: 0.025, a: 0.002 });
        },
        // A dry tap on a tile edge.
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'triangle', f: 2900, f2: 2650, dur: 0.022, gain: 0.05, a: 0.001 });
          X.burst(ac, out, t, { type: 'bandpass', f: 5200, q: 3, dur: 0.008, gain: 0.04 });
        },
        // Two porcelain strikes, then a faint glassy shimmer as the shine passes.
        success(ac, out, t, X) {
          X.tone(ac, out, t, { f: 1046.5, dur: 0.5, gain: 0.075, a: 0.003 });
          X.tone(ac, out, t, { f: 1661, dur: 0.22, gain: 0.025, a: 0.003 });
          X.tone(ac, out, t + 0.13, { f: 1568, dur: 0.6, gain: 0.06, a: 0.003 });
          X.tone(ac, out, t + 0.13, { f: 2489, dur: 0.25, gain: 0.02, a: 0.003 });
          X.burst(ac, out, t + 0.22, { type: 'highpass', f: 6500, f2: 10500, q: 0.7, dur: 0.34, gain: 0.018, a: 0.09 });
        },
      },
    });
  })();
}
