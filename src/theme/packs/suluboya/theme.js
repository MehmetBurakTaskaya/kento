// SPDX-License-Identifier: MIT
// Theme: Suluboya (watercolor). Eight loose washes from a paint box laid on textured paper, each
// with a darker dried edge, a few granules of pigment and a strip of bare paper between them; a
// pencil under-drawing circles the wheel. Pointing adds pigment; applying drops water into the
// slice, and a bloom spreads through it and dries with a dark tide line.
export default function register(Board) {
  (function () {
    'use strict';

    const R = { inner: 66, outer: 172, hub: 56, lbl: 116, sketch: 186 };
    const C = 200;
    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    // Paper grain, rasterized once by the browser: fractal noise tinted like cold-press paper.
    const grain = (r, g, b, a) =>
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='suluboya-n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 ${a} 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23suluboya-n)'/%3E%3C/svg%3E") 0 0 / 220px 220px`;

    function rng(seed) {
      let s = (seed * 2654435761) % 2147483647 || 1;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    }
    // A smooth wobble along a closed outline: a few sines with random phases.
    function wobble(rand, n) {
      const waves = [1, 2, 3, 5].map((k) => [k, rand() * Math.PI * 2, 1 / (k * 0.9 + 0.4)]);
      return (t) => waves.reduce((sum, [k, ph, w]) => sum + w * Math.sin(k * n * t * Math.PI * 2 + ph), 0) / 2.2;
    }
    // Closed Catmull-Rom spline through points, as cubic Beziers.
    function smooth(pts) {
      const n = pts.length;
      let d = `M${f2(pts[0][0])} ${f2(pts[0][1])}`;
      for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n],
          p1 = pts[i],
          p2 = pts[(i + 1) % n],
          p3 = pts[(i + 2) % n];
        d += `C${f2(p1[0] + (p2[0] - p0[0]) / 6)} ${f2(p1[1] + (p2[1] - p0[1]) / 6)} ${f2(p2[0] - (p3[0] - p1[0]) / 6)} ${f2(p2[1] - (p3[1] - p1[1]) / 6)} ${f2(p2[0])} ${f2(p2[1])}`;
      }
      return d + 'Z';
    }
    // The outline of one wash: a sector with bare paper at its sides and a loose, bleeding outer edge.
    function washPath(a0, a1, seed) {
      const rand = rng(seed);
      const side = 3.2; // half the strip of bare paper, in viewBox units
      const pts = [];
      const outer = wobble(rand, 1);
      const inner = wobble(rand, 1);
      const sideA = wobble(rand, 1);
      const sideB = wobble(rand, 1);
      const g0 = (r) => ((side / r) * 180) / Math.PI;
      // Outer edge, a0 to a1.
      // A fine fringe on top of the slow wobble, where pigment bled into damp paper.
      const fringe = [rand() * 6.3, rand() * 6.3];
      for (let k = 0; k <= 18; k++) {
        const t = k / 18;
        const a = a0 + g0(R.outer) + t * (a1 - a0 - 2 * g0(R.outer));
        const r = R.outer + 6 * outer(t) + 2 + 1.6 * Math.sin(t * 37 + fringe[0]) * Math.sin(t * 13 + fringe[1]);
        pts.push([C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))]);
      }
      // Side at a1, outward to inward.
      for (let k = 1; k < 7; k++) {
        const t = k / 7;
        const r = R.outer - t * (R.outer - R.inner);
        const a = a1 - g0(r) + ((2.2 * sideB(t)) / r) * (180 / Math.PI);
        pts.push([C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))]);
      }
      // Inner edge, a1 back to a0.
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        const a = a1 - g0(R.inner) - t * (a1 - a0 - 2 * g0(R.inner));
        const r = R.inner + 2.5 * inner(t);
        pts.push([C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))]);
      }
      // Side at a0, inward to outward.
      for (let k = 1; k < 7; k++) {
        const t = k / 7;
        const r = R.inner + t * (R.outer - R.inner);
        const a = a0 + g0(r) + ((2.2 * sideA(t)) / r) * (180 / Math.PI);
        pts.push([C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))]);
      }
      return smooth(pts);
    }
    // A soft irregular blob around cx, cy.
    function blob(cx, cy, r, seed, lobes = 9, amp = 0.16) {
      const rand = rng(seed);
      const w = wobble(rand, 1);
      const pts = [];
      for (let k = 0; k < lobes * 2; k++) {
        const t = k / (lobes * 2);
        const rr = r * (1 + amp * w(t));
        pts.push([cx + rr * Math.sin(t * Math.PI * 2), cy - rr * Math.cos(t * Math.PI * 2)]);
      }
      return smooth(pts);
    }

    Board.define({
      id: 'suluboya',
      fonts: {
        brand: "'Caveat'",
        load: ["'Caveat'"],
        credits: [{ family: 'Caveat', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 190, close: 130, stagger: 16, apply: 700 },
      palette: {
        light: {
          bg: '#f7f6f2',
          surface: '#ffffff',
          'surface-2': '#f0efea',
          border: '#dcdad2',
          'border-strong': '#9a978c',
          text: '#1d2030',
          'text-muted': '#555a6b',
          accent: '#3d5fbf',
          'on-accent': '#ffffff',
          focus: '#3d5fbf',
          success: '#2f8a5f',
          'on-success': '#ffffff',
          'success-text': '#24724d',
          warning: '#d9a41e',
          'warning-text': '#6b4f00',
          danger: '#c8456b',
          desk: `${grain(0.42, 0.4, 0.36, 0.11)}, radial-gradient(circle at 45% 40%, #fdfcf9 0%, #f3f2ec 80%)`,
          'wheel-face': '#fbfaf6',
          'wheel-slice': '#dce4f6',
          'wheel-slice-hover': '#bccbef',
          'wheel-slice-selected': '#8ea6e3',
          'wheel-text': '#161929',
          'wheel-text-selected': '#11131f',
          'wheel-line': '#8a8f9c',
          'wheel-shadow': 'rgba(60, 60, 80, 0.12)',
          'su-1': '#4f72cf',
          'su-2': '#2f9e93',
          'su-3': '#e0679a',
          'su-4': '#f0b93a',
          'su-5': '#8d6fd6',
          'su-6': '#6fae55',
          'su-7': '#3ea6d6',
          'su-8': '#ef7f68',
          'su-idle': '0.3',
          'su-hover': '0.5',
          'su-sel': '0.62',
          'su-edge': '0.55',
          'su-granule': '0.4',
          'su-sub': '#2a2e40',
          'su-pencil': '#7f8494',
          'su-hub': '#6b7187',
          'su-hub-wash': '0.14',
          'su-hub-text': '#161929',
          'su-hub-muted': '#4a4f61',
          'su-ink-sel': '#11131f',
          'su-tide-mix': '#1d2030',
        },
        dark: {
          bg: '#15161f',
          surface: '#1d1f2b',
          'surface-2': '#252836',
          border: '#343747',
          'border-strong': '#646a80',
          text: '#f1eee6',
          'text-muted': '#b3b0a6',
          accent: '#9db4ff',
          'on-accent': '#11131f',
          focus: '#9db4ff',
          success: '#71d3a0',
          'on-success': '#0d2418',
          'success-text': '#86dcae',
          warning: '#ffd36b',
          'warning-text': '#ffd980',
          danger: '#ff8fb0',
          desk: `${grain(0.85, 0.85, 0.9, 0.07)}, radial-gradient(circle at 45% 40%, #1d1f2b 0%, #12131b 80%)`,
          'wheel-face': '#1a1c27',
          'wheel-slice': '#2a3150',
          'wheel-slice-hover': '#3a4778',
          'wheel-slice-selected': '#7d93df',
          'wheel-text': '#f3f0e8',
          'wheel-text-selected': '#11131f',
          'wheel-line': '#8d92a8',
          'wheel-shadow': 'rgba(0, 0, 0, 0.4)',
          'su-1': '#8fa8ff',
          'su-2': '#5fe0cf',
          'su-3': '#ff9cd0',
          'su-4': '#d6a8ff',
          'su-5': '#a6b4ff',
          'su-6': '#8ff0b0',
          'su-7': '#78d0ff',
          'su-8': '#ff94b4',
          'su-idle': '0.26',
          'su-hover': '0.42',
          'su-sel': '0.86',
          'su-edge': '0.6',
          'su-granule': '0.45',
          'su-sub': '#e2ded3',
          'su-pencil': '#8d92a8',
          'su-hub': '#c9c4b8',
          'su-hub-wash': '0.12',
          'su-hub-text': '#f3f0e8',
          'su-hub-muted': '#c4c0b5',
          'su-ink-sel': '#11131f',
          'su-tide-mix': '#2a1f3a',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['su-sub', 'wheel-slice', 'text'],
        ['su-sub', 'wheel-slice-hover', 'text'],
        ['su-hub-text', 'wheel-face', 'text'],
        ['su-hub-muted', 'wheel-face', 'text'],
      ],
      icons: {
        more: '<path d="M3.2 12.4c.6-1.6 2.6-1.8 3.2-.2.5 1.4-1.2 2.6-2.4 1.9-.6-.3-1-1-.8-1.7zM10.3 12c.5-1.5 2.7-1.7 3.3-.2.6 1.5-1.3 2.7-2.5 1.9-.7-.4-1-1.1-.8-1.7zM17.4 12.3c.5-1.6 2.7-1.6 3.3 0 .5 1.4-1.3 2.4-2.5 1.7-.6-.4-1-1-.8-1.7z" fill="currentColor" stroke="none"/>',
      },
      defs: '',

      wheel: {
        render(root, m, H) {
          const s = H.s;
          const uid = H.uid('suluboya');
          const defs = s('defs', {}, root);
          // Pencil under-drawing: a loose circle drawn twice, with an overshoot.
          const pencil = s('g', { class: 'su-pencil', 'aria-hidden': 'true' }, root);
          s('path', { d: blob(C, C, R.sketch, 7, 6, 0.012), class: 'su-pencil-line' }, pencil);
          s(
            'path',
            { d: blob(C + 1.5, C - 1, R.sketch + 3, 19, 5, 0.014), class: 'su-pencil-line su-pencil-2' },
            pencil,
          );

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            g.classList.add('su-p' + ((sl.i % 8) + 1));
            const d = washPath(sl.a0, sl.a1, sl.i * 31 + 5);
            s('path', { d: H.sector(R.inner - 6, R.outer + 8, sl.a0, sl.a1), class: 'su-hit' }, g);
            const wash = s('g', { class: 'su-washg' }, g);
            // Pigment settles toward the outer edge: a radial gradient in the slice's own color.
            const gid = `${uid}-g${sl.i}`;
            const grad = s(
              'radialGradient',
              { id: gid, gradientUnits: 'userSpaceOnUse', cx: C, cy: C, r: R.outer + 8 },
              g,
            );
            s('stop', { offset: 0.38, style: 'stop-color: var(--su-c); stop-opacity: 0.5' }, grad);
            s('stop', { offset: 0.8, style: 'stop-color: var(--su-c); stop-opacity: 0.85' }, grad);
            s('stop', { offset: 1, style: 'stop-color: var(--su-c); stop-opacity: 1' }, grad);
            s('path', { d, class: 'su-wash', style: `fill: url(#${gid})` }, wash);
            // Uneven pigment: one denser patch toward the outer edge.
            const [px, py] = H.polar(R.outer - 26, sl.mid + (sl.i % 2 ? 6 : -6));
            s('path', { d: blob(px, py, 22, sl.i * 7 + 3, 7, 0.22), class: 'su-pool' }, wash);
            // Granules of pigment, scattered away from the label.
            const rand = rng(sl.i * 13 + 2);
            let gd = '';
            for (let k = 0; k < 26; k++) {
              const r = k % 3 ? R.outer - 4 - rand() * 30 : R.inner + 4 + rand() * 16;
              const a = sl.a0 + 4 + rand() * (sl.a1 - sl.a0 - 8);
              const [x, y] = H.polar(r, a);
              const rr = 0.5 + rand() * 0.9;
              gd += `M${f2(x - rr)} ${f2(y)}a${f2(rr)} ${f2(rr)} 0 1 0 ${f2(2 * rr)} 0a${f2(rr)} ${f2(rr)} 0 1 0 ${f2(-2 * rr)} 0`;
            }
            s('path', { d: gd, class: 'su-granules' }, wash);
            s('path', { d, class: 'su-edge' }, wash);
            // A second, broken edge: dried pigment is darker in some places than others.
            s(
              'path',
              {
                d,
                class: 'su-edge su-edge-2',
                'stroke-dasharray': `${18 + (sl.i % 3) * 7} 14 9 ${22 - (sl.i % 4) * 3}`,
              },
              wash,
            );

            // The bloom: clipped to the wash, it spreads from a drop near the label and dries with a tide line.
            const clipId = `${uid}-c${sl.i}`;
            s('path', { d }, s('clipPath', { id: clipId }, defs));
            const [bx, by] = H.polar(R.lbl + 4, sl.mid);
            const bloom = s('g', { class: 'su-bloom', 'clip-path': `url(#${clipId})` }, g);
            // The transform attribute places it; the inner group carries the CSS scale of the spread.
            const spread = s(
              'g',
              { class: 'su-spread' },
              s('g', { transform: `translate(${f2(bx)} ${f2(by)})` }, bloom),
            );
            const bd = blob(0, 0, 45, sl.i * 17 + 9, 8, 0.2);
            s('path', { d: bd, class: 'su-bloom-fill' }, spread);
            s('path', { d: bd, class: 'su-tide' }, spread);
            s('path', { d: blob(0, 0, 24, sl.i * 5 + 1, 7, 0.25), class: 'su-backrun' }, spread);
            const drop = s('g', { class: 'su-drop' }, s('g', { transform: `translate(${f2(bx)} ${f2(by)})` }, g));
            s('circle', { cx: 0, cy: 0, r: 9, class: 'su-drop-ring' }, drop);

            const ink = s('g', { class: 'su-ink' }, g);
            if (m.kind === 'convert' && sl.sub) {
              H.block(ink, sl, R.lbl, {
                size: 30,
                subSize: 18,
                gap: -2,
                maxWidth: 76,
                minSize: 14,
                cls: 'su-lbl su-fmt',
                subCls: 'su-sub',
              });
            } else {
              H.block(ink, sl, R.lbl, {
                icon: true,
                iconSize: 24,
                size: 19,
                gap: 2,
                maxWidth: 76,
                minSize: 12,
                cls: 'su-lbl su-word',
                sub: null,
              });
            }
          }

          // Hub: a pale gray wash with the wheel's name, the file and the key in a pencil box.
          const hub = s('g', { class: 'su-hubg' }, root);
          s('path', { d: blob(C, C, R.hub, 41, 8, 0.07), class: 'su-hub' }, hub);
          s('path', { d: blob(C, C, R.hub, 41, 8, 0.07), class: 'su-hub-edge' }, hub);
          H.label(hub, C, C - 17, m.title, { maxWidth: 92, size: 23, minSize: 14, cls: 'su-title', maxLines: 1 });
          H.label(hub, C, C + 3, m.file, { maxWidth: 88, size: 17, minSize: 12, cls: 'su-file', maxLines: 1 });
          const kw = 18 + m.key.length * 8;
          s(
            'path',
            { d: `M${f2(C - kw / 2)} ${C + 18.5}l${f2(kw + 1.5)} -0.8l-0.6 18.6l${f2(-kw - 1)} 0.6z`, class: 'su-key' },
            hub,
          );
          H.text(hub, C, C + 28, m.key, { class: 'su-keytext' });
        },
      },

      sounds: {
        open(ac, out, t, X) {
          X.tone(ac, out, t, { f: 700, f2: 1500, dur: 0.05, gain: 0.05, a: 0.002 });
          X.burst(ac, out, t + 0.01, { type: 'lowpass', f: 1200, q: 0.7, dur: 0.12, gain: 0.05, a: 0.02 });
        },
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 2600, q: 1.4, dur: 0.025, gain: 0.07, a: 0.004 });
        },
        success(ac, out, t, X) {
          // A drop lands (a quick rising blip), then the wash spreads (a soft, falling swish) and a faint bell.
          X.tone(ac, out, t, { f: 520, f2: 1350, dur: 0.06, gain: 0.07, a: 0.002 });
          X.tone(ac, out, t + 0.07, { f: 900, f2: 1700, dur: 0.04, gain: 0.025, a: 0.002 });
          X.burst(ac, out, t + 0.05, { type: 'bandpass', f: 1800, f2: 500, q: 0.8, dur: 0.5, gain: 0.05, a: 0.08 });
          X.tone(ac, out, t + 0.12, { f: 1319, dur: 0.6, gain: 0.025, a: 0.01 });
        },
      },
    });
  })();
}
