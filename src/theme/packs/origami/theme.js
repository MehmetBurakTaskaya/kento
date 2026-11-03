// SPDX-License-Identifier: MIT
// Origami: the wheel as a pleated paper rosette. Every slice is a pleat of two facets that catch
// the light from the upper left, the rim is the zigzag of the folds, and the hub is a small square
// sheet with its creases. Hover lifts a pleat; applying it folds the pleat over and opens it again
// on its coloured side, which stays up.
export default function register(Board) {
  (function () {
    'use strict';

    const ID = 'origami';
    const f2 = (n) => Math.round(n * 100) / 100;

    if (typeof document !== 'undefined' && document.fonts) {
      for (const f of ["500 16px 'Zen Maru Gothic'", "700 16px 'Zen Maru Gothic'", "900 16px 'Zen Maru Gothic'"])
        document.fonts.load(f, 'AaĞşı').catch(() => null);
    }

    // Radii in the 400 x 400 view box.
    const R = { hub: 62, under: 40, valley: 172, peak: 192, lbl: 127, hit1: 186 };
    // Light from the upper left: a facet facing it is bright, one facing away is in shade.
    const LIGHT = (() => {
      const v = [-0.62, -0.78];
      const l = Math.hypot(v[0], v[1]);
      return [v[0] / l, v[1] / l];
    })();

    // Brightness (0 shade to 100 light) of a facet that faces tangentially at angle th, ccw or cw.
    function facetLight(th, dir) {
      const r = (th * Math.PI) / 180;
      const n = dir < 0 ? [-Math.cos(r), -Math.sin(r)] : [Math.cos(r), Math.sin(r)];
      const d = n[0] * LIGHT[0] + n[1] * LIGHT[1];
      return Math.round(52 + 46 * d);
    }

    const pt = (p) => `${f2(p[0])} ${f2(p[1])}`;

    Board.define({
      id: ID,
      fonts: {
        brand: "'Zen Maru Gothic'",
        load: ["'Zen Maru Gothic'"],
        credits: [{ family: 'Zen Maru Gothic', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 190, close: 120, stagger: 11, apply: 600 },

      palette: {
        light: {
          bg: '#eef1f2',
          surface: '#ffffff',
          'surface-2': '#f4f6f7',
          border: '#d9dee2',
          'border-strong': '#a8b1b9',
          text: '#1b2030',
          'text-muted': '#596173',
          accent: '#2f3f8f',
          'on-accent': '#ffffff',
          focus: '#2f3f8f',
          success: '#1d7d4f',
          'on-success': '#ffffff',
          'success-text': '#186a43',
          warning: '#b0700f',
          'warning-text': '#774b06',
          danger: '#bf3a3a',
          desk: 'linear-gradient(160deg, #e6eeec 0%, #d4e0de 100%)',
          'wheel-face': '#f4f5f8',
          'paper-hi': '#ffffff',
          'paper-lo': '#d7dbe4',
          'wheel-slice': '#d7dbe4',
          'wheel-slice-hover': '#ffffff',
          'wheel-slice-selected': '#2f3f8f',
          'back-hi': '#4a5bb0',
          'back-lo': '#232f70',
          'back-dot': 'rgba(255, 255, 255, 0.16)',
          'wheel-text': '#1b2030',
          'wheel-sub': '#4a5266',
          'wheel-text-selected': '#ffffff',
          'wheel-sub-selected': '#e1e6ff',
          'wheel-line': 'rgba(255, 255, 255, 0.85)',
          'valley-line': 'rgba(60, 70, 95, 0.22)',
          'wheel-shadow': 'rgba(40, 60, 70, 0.28)',
          'lift-shadow': 'rgba(30, 40, 60, 0.35)',
          'hub-paper': '#fbfbfd',
          'hub-edge': '#c9ced9',
          'paper-base': '#b9bfcb',
          'hover-tint': 'rgba(70, 100, 210, 0.07)',
          'hub-crease': 'rgba(60, 70, 95, 0.14)',
          'fold-shade': 'rgba(20, 26, 50, 0.4)',
        },
        dark: {
          bg: '#13162a',
          surface: '#1b1f38',
          'surface-2': '#232847',
          border: '#323858',
          'border-strong': '#535b84',
          text: '#f1eee6',
          'text-muted': '#aeb1c6',
          accent: '#f2b33d',
          'on-accent': '#1b1a2e',
          focus: '#f2b33d',
          success: '#6fd19d',
          'on-success': '#0b2216',
          'success-text': '#80d9aa',
          warning: '#f2b84a',
          'warning-text': '#f5c66c',
          danger: '#ff8a80',
          desk: 'radial-gradient(120% 95% at 40% 10%, #20254a 0%, #151935 60%, #0f1226 100%)',
          'wheel-face': '#2d3560',
          'paper-hi': '#46528a',
          'paper-lo': '#262d52',
          'wheel-slice': '#46528a',
          'wheel-slice-hover': '#4e5b96',
          'wheel-slice-selected': '#f2b33d',
          'back-hi': '#ffcd63',
          'back-lo': '#e09a22',
          'back-dot': 'rgba(255, 255, 255, 0.22)',
          'wheel-text': '#f6f3ec',
          'wheel-sub': '#d9dcef',
          'wheel-text-selected': '#1b1a2e',
          'wheel-sub-selected': '#2c2a3f',
          'wheel-line': 'rgba(190, 200, 255, 0.45)',
          'valley-line': 'rgba(5, 8, 25, 0.45)',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          'lift-shadow': 'rgba(0, 0, 0, 0.55)',
          'hub-paper': '#384274',
          'hub-edge': '#1f2547',
          'paper-base': '#181d38',
          'hover-tint': 'rgba(220, 228, 255, 0.1)',
          'hub-crease': 'rgba(200, 210, 255, 0.16)',
          'fold-shade': 'rgba(0, 0, 10, 0.5)',
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
        ['wheel-text', 'paper-lo', 'text'],
        ['wheel-text', 'paper-hi', 'text'],
        ['wheel-sub', 'paper-lo', 'text'],
        ['wheel-sub', 'paper-hi', 'text'],
        ['wheel-text-selected', 'back-hi', 'text'],
        ['wheel-text-selected', 'back-lo', 'text'],
        ['wheel-sub-selected', 'back-hi', 'text'],
        ['wheel-sub-selected', 'back-lo', 'text'],
        ['wheel-text', 'hub-paper', 'text'],
        ['wheel-sub', 'hub-paper', 'text'],
      ],

      // A soft shadow under a lifted pleat.
      defs: `<filter id="origami-lift" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3.4"/><feOffset dx="2" dy="4.5" result="b"/>
        <feFlood flood-color="#000" flood-opacity=".36"/><feComposite in2="b" operator="in" result="s"/>
        <feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="origami-blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="4.5"/></filter>`,

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const s = H.s;
          const uid = H.uid(ID);
          const defs = s('defs', {}, root);
          // Small dots printed on the coloured back of the paper.
          const pat = s(
            'pattern',
            { id: uid + '-dots', width: 9, height: 9, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(30)' },
            defs,
          );
          s('circle', { cx: 2.2, cy: 2.2, r: 1.05, class: 'og-dot' }, pat);
          s('circle', { cx: 6.7, cy: 6.7, r: 1.05, class: 'og-dot' }, pat);
          const sh = s('radialGradient', { id: uid + '-sh', cx: 0.5, cy: 0.5, r: 0.5 }, defs);
          s('stop', { offset: 0.8, class: 'og-st-sh' }, sh);
          s('stop', { offset: 1, class: 'og-st-sh0' }, sh);

          // The sheet's shadow on the desk, following the star outline.
          let star = '';
          m.slices.forEach((sl, k) => {
            star += `${k ? 'L' : 'M'}${pt(H.polar(R.valley, sl.a0))}L${pt(H.polar(R.peak, sl.mid))}`;
          });
          star += 'Z';
          const under = s('g', { class: 'og-under', 'aria-hidden': 'true' }, root);
          s('path', { d: star, class: 'og-shadow', transform: 'translate(2 5)' }, under);
          // The sheet below the pleats, seen when one folds over.
          s('path', { d: star, class: 'og-base' }, under);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            // A still hit area, so a lifted pleat never slides out from under the pointer.
            s('path', { d: H.sector(R.hub, R.hit1, sl.a0, sl.a1), class: 'og-hit' }, g);
            const u = [Math.sin(H.rad(sl.mid)), -Math.cos(H.rad(sl.mid))];
            const body = s('g', { class: 'og-body' }, g);
            body.style.setProperty('--lx', f2(u[0] * 6) + 'px');
            body.style.setProperty('--ly', f2(u[1] * 6) + 'px');
            const fold = s('g', { class: 'og-fold' }, body);
            // The pleats start under the hub sheet, so no gap shows round it.
            const L = [
              H.polar(R.under, sl.a0),
              H.polar(R.valley, sl.a0),
              H.polar(R.peak, sl.mid),
              H.polar(R.under, sl.mid),
            ];
            const Rr = [
              H.polar(R.under, sl.mid),
              H.polar(R.peak, sl.mid),
              H.polar(R.valley, sl.a1),
              H.polar(R.under, sl.a1),
            ];
            const face = (p, extra) => `M${pt(p[0])}L${pt(p[1])}L${pt(p[2])}L${pt(p[3])}${extra}Z`;
            const dA = face(L, `A${R.under} ${R.under} 0 0 0 ${pt(L[0])}`);
            const dB = face(Rr, `A${R.under} ${R.under} 0 0 0 ${pt(Rr[0])}`);
            const lA = facetLight((sl.a0 + sl.mid) / 2, -1),
              lB = facetLight((sl.mid + sl.a1) / 2, 1);
            // Front: white (or indigo) paper; back: the coloured side, shown once the slice is applied.
            const front = s('g', { class: 'og-front' }, fold);
            s('path', { d: dA, style: `fill: color-mix(in srgb, var(--paper-hi) ${lA}%, var(--paper-lo))` }, front);
            s('path', { d: dB, style: `fill: color-mix(in srgb, var(--paper-hi) ${lB}%, var(--paper-lo))` }, front);
            const back = s('g', { class: 'og-back' }, fold);
            s('path', { d: dA, style: `fill: color-mix(in srgb, var(--back-hi) ${lA}%, var(--back-lo))` }, back);
            s('path', { d: dB, style: `fill: color-mix(in srgb, var(--back-hi) ${lB}%, var(--back-lo))` }, back);
            s('path', { d: dA + dB, fill: `url(#${uid}-dots)` }, back);
            // Creases: the mountain fold down the middle, the valley folds at the sides.
            const crease = s('path', { class: 'og-crease' }, fold);
            s(
              'path',
              {
                d: `M${pt(H.polar(R.hub, sl.a0))}L${pt(L[1])}M${pt(H.polar(R.hub, sl.a1))}L${pt(Rr[2])}`,
                class: 'og-valley',
              },
              fold,
            );
            s('path', { d: dA + dB, class: 'og-hl' }, front);
            s('path', { d: dA + dB, class: 'og-turn' }, fold);
            const ink = s('g', { class: 'og-ink' }, fold);
            if (m.kind === 'convert' && sl.sub) {
              H.block(ink, sl, R.lbl, {
                size: 21,
                subSize: 12.5,
                gap: 2,
                maxWidth: 74,
                minSize: 10,
                cls: 'og-lbl og-fmt',
                subCls: 'og-sub',
              });
            } else {
              H.block(ink, sl, R.lbl, {
                icon: true,
                iconSize: 23,
                size: 13.5,
                gap: 4,
                maxWidth: 76,
                minSize: 9,
                cls: 'og-lbl og-word',
                sub: null,
              });
            }
            // The crease breaks round the lettering, like a fold that runs under a printed word.
            const bb = ink.getBBox();
            const [ux, uy] = u;
            const hits = [];
            for (const [lo, hi, o, d] of [
              [bb.x - 3, bb.x + bb.width + 3, C, ux],
              [bb.y - 3, bb.y + bb.height + 3, C, uy],
            ]) {
              if (Math.abs(d) < 1e-6)
                hits.push([o >= lo && o <= hi ? -Infinity : Infinity, o >= lo && o <= hi ? Infinity : -Infinity]);
              else {
                const a = (lo - o) / d,
                  b = (hi - o) / d;
                hits.push([Math.min(a, b), Math.max(a, b)]);
              }
            }
            const t0 = Math.max(hits[0][0], hits[1][0]),
              t1 = Math.min(hits[0][1], hits[1][1]);
            const seg = (r0, r1) => (r1 - r0 > 2 ? `M${pt(H.polar(r0, sl.mid))}L${pt(H.polar(r1, sl.mid))}` : '');
            crease.setAttribute(
              'd',
              bb.width && t0 < t1 ? seg(R.hub, t0) + seg(t1, R.peak - 1) : seg(R.hub, R.peak - 1),
            );
          }

          // Hub: a small square sheet with its creases, corners tucked into the valleys.
          const hub = s('g', { class: 'og-hub' }, root);
          const side = 104;
          const turn = m.slices[0].a0 + 45;
          const sq = s('g', { transform: `rotate(${f2(turn)} ${C} ${C})` }, hub);
          s('rect', { x: C - side / 2, y: C - side / 2, width: side, height: side, rx: 2, class: 'og-hub-paper' }, sq);
          s(
            'path',
            {
              d: `M${C - side / 2} ${C - side / 2}L${C + side / 2} ${C + side / 2}M${C + side / 2} ${C - side / 2}L${C - side / 2} ${C + side / 2}`,
              class: 'og-hub-crease',
            },
            sq,
          );
          s(
            'path',
            {
              d: `M${C} ${C - side / 2}V${C + side / 2}M${C - side / 2} ${C}H${C + side / 2}`,
              class: 'og-hub-crease og-hub-valley',
            },
            sq,
          );
          // One corner folded in, a dog-ear.
          const e = 15;
          s(
            'path',
            {
              d: `M${C + side / 2 - e} ${C + side / 2}L${C + side / 2} ${C + side / 2 - e}L${C + side / 2 - e} ${C + side / 2 - e}Z`,
              class: 'og-hub-ear',
            },
            sq,
          );
          H.label(hub, C, C - 15, m.title, { maxWidth: 92, size: 16, minSize: 10, cls: 'og-title', maxLines: 1 });
          H.label(hub, C, C + 5, m.file, { maxWidth: 88, size: 12, minSize: 9, cls: 'og-file', maxLines: 1 });
          const kt = H.text(hub, C, C + 26, m.key, { class: 'og-keytext' });
          const kw = kt.getComputedTextLength() + 16;
          hub.insertBefore(
            s('rect', { x: f2(C - kw / 2), y: C + 18, width: f2(kw), height: 16, rx: 3, class: 'og-key' }),
            kt,
          );
        },
      },

      sounds: {
        // A paper fan opening: a quick run of soft ticks over a swish.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 900, f2: 2400, q: 0.9, dur: 0.14, gain: 0.09, a: 0.02 });
          for (let k = 0; k < 7; k++)
            X.burst(ac, out, t + 0.012 + k * 0.017, {
              type: 'bandpass',
              f: 2600 + k * 120,
              q: 2.2,
              dur: 0.008,
              gain: 0.05,
            });
        },
        // A light paper tap.
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 1500, q: 1.1, dur: 0.012, gain: 0.11 });
          X.burst(ac, out, t, { type: 'highpass', f: 6000, q: 0.7, dur: 0.005, gain: 0.03 });
        },
        // Crinkle, the swish of the fold, a crease pressed flat, the pleat flicking open.
        success(ac, out, t, X) {
          [0, 0.018, 0.031, 0.05, 0.066, 0.083].forEach((dt, k) =>
            X.burst(ac, out, t + dt, { type: 'highpass', f: 3800 + (k % 3) * 900, q: 0.8, dur: 0.007, gain: 0.06 }),
          );
          X.burst(ac, out, t + 0.08, { type: 'bandpass', f: 700, f2: 3000, q: 1.2, dur: 0.16, gain: 0.1, a: 0.03 });
          X.tone(ac, out, t + 0.27, { type: 'sine', f: 150, f2: 95, dur: 0.07, gain: 0.1, a: 0.002 });
          X.burst(ac, out, t + 0.27, { type: 'lowpass', f: 1200, q: 0.7, dur: 0.03, gain: 0.12 });
          X.burst(ac, out, t + 0.42, { type: 'bandpass', f: 2200, f2: 3200, q: 1.5, dur: 0.05, gain: 0.07, a: 0.004 });
        },
      },
    });
  })();
}
