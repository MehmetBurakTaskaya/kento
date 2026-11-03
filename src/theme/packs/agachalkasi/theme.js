// SPDX-License-Identifier: MIT
// Theme: Ağaç halkası (tree rings). A cross-section of a log in pale wood with birch bark; drying
// checks split it into the slices. Applying a slice brands it with a hot iron and puffs sawdust.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    // Radii: hub, wood face, sapwood, bark inner and outer, label line, brand ring.
    const R = { hub: 60, face: 177, sap: 181, bark: 197, label: 127, brand: 44 };
    const PITH = [-3.5, 2.5]; // the pith sits a little off center, as in a real log

    const reducedMotion = () =>
      document.documentElement.classList.contains('reduce-motion') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    function rnd(seed) {
      let s = seed;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    }

    // One growth ring: a closed wobbly loop around the (off-center) pith. The pith offset fades
    // toward the bark so the log stays round.
    function ringPath(r, phase, amp, cx = 200, cy = 200, rmax = 182) {
      const N = 90;
      const k = Math.max(0, 1 - r / rmax);
      let d = '';
      for (let j = 0; j < N; j++) {
        const t = (j / N) * Math.PI * 2;
        const rr =
          r +
          amp *
            (0.6 * Math.sin(2 * t + phase) +
              0.3 * Math.sin(5 * t + phase * 1.7) +
              0.16 * Math.sin(11 * t + phase * 2.3));
        d += `${j ? 'L' : 'M'}${f2(cx + PITH[0] * k + rr * Math.sin(t))} ${f2(cy + PITH[1] * k - rr * Math.cos(t))}`;
      }
      return d + 'Z';
    }

    // Ring radii with uneven spacing (good and lean years); every few rings a darker latewood line.
    function ringSet(r0, r1, seed) {
      const g = rnd(seed);
      const list = [];
      let r = r0;
      let n = 0;
      while (r < r1) {
        list.push({ r, late: n % 3 === 2 || g() > 0.82 });
        r += 4.2 + g() * 6.5;
        n++;
      }
      return list;
    }

    // The bark band: a wobbly outer edge (the silhouette) and the inner circle.
    function barkPath(cx = 200, cy = 200, r0 = R.sap, r1 = R.bark) {
      const N = 120;
      let d = '';
      for (let j = 0; j < N; j++) {
        const t = (j / N) * Math.PI * 2;
        const rr = r1 - 1.6 + 1.6 * Math.sin(5 * t + 1) + 1.1 * Math.sin(13 * t + 0.4) + 0.7 * Math.sin(29 * t);
        d += `${j ? 'L' : 'M'}${f2(cx + rr * Math.sin(t))} ${f2(cy - rr * Math.cos(t))}`;
      }
      d += 'Z';
      d += `M${cx} ${cy - r0}a${r0} ${r0} 0 1 0 0 ${2 * r0}a${r0} ${r0} 0 1 0 0 ${-2 * r0}Z`;
      return d;
    }

    // Birch lenticels (or, on charred wood, cracks): short dark arcs across the bark band.
    function lenticels(seed, cx = 200, cy = 200, r0 = R.sap + 2, r1 = R.bark - 3) {
      const g = rnd(seed);
      let d = '';
      for (let j = 0; j < 64; j++) {
        const a = g() * 360;
        const r = r0 + g() * (r1 - r0);
        const len = 3 + g() * 9;
        const a1 = a + (len / r) * (180 / Math.PI);
        const [x0, y0] = [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))];
        const [x1, y1] = [cx + r * Math.sin(rad(a1)), cy - r * Math.cos(rad(a1))];
        d += `M${f2(x0)} ${f2(y0)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x1)} ${f2(y1)}`;
      }
      return d;
    }

    // A drying check along angle a: a fine jagged line from r0 to r1.
    function check(a, r0, r1, seed, cx = 200, cy = 200) {
      const g = rnd(seed);
      const u = [Math.sin(rad(a)), -Math.cos(rad(a))];
      const v = [Math.cos(rad(a)), Math.sin(rad(a))];
      let d = '';
      for (let r = r0, j = 0; r <= r1; r += 5.5, j++) {
        const s = (g() - 0.5) * 2.4;
        d += `${j ? 'L' : 'M'}${f2(cx + u[0] * r + v[0] * s)} ${f2(cy + u[1] * r + v[1] * s)}`;
      }
      return d;
    }

    // How wide a wedge's label may be, and the brand ring that fits around it: wider wedges (fewer
    // slices) give a long label more room and a slightly larger brand.
    function fit(sl) {
      const chord = 2 * R.label * Math.sin(rad(Math.min(sl.step, 180) / 2));
      const room = Math.round(Math.max(66, Math.min(88, chord * 0.82)));
      return { room, ring: Math.max(R.brand, room / 2 + 6) };
    }

    // The brand: a double ring with four short bars, burned around the label.
    function brand(cx, cy, r) {
      let ticks = '';
      for (const a of [45, 135, 225, 315]) {
        const u = [Math.sin(rad(a)), -Math.cos(rad(a))];
        ticks += `M${f2(cx + u[0] * (r + 3))} ${f2(cy + u[1] * (r + 3))}L${f2(cx + u[0] * (r + 8.5))} ${f2(cy + u[1] * (r + 8.5))}`;
      }
      return ticks;
    }

    Board.define({
      id: 'agachalkasi',
      fonts: {
        brand: "'Vollkorn Variable'",
        display: "'Vollkorn Variable'",
        load: ["'Vollkorn Variable'"],
        credits: [{ family: 'Vollkorn', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 180, close: 120, stagger: 10, apply: 660 },

      palette: {
        light: {
          bg: '#f3f5ef',
          surface: '#ffffff',
          'surface-2': '#eef1e7',
          border: '#d6dccb',
          'border-strong': '#a7b096',
          text: '#262019',
          'text-muted': '#5b5348',
          accent: '#b2471f',
          'on-accent': '#ffffff',
          focus: '#2f6c4f',
          success: '#2f7a46',
          'on-success': '#ffffff',
          'success-text': '#27693c',
          warning: '#b8770b',
          'warning-text': '#7a4e00',
          danger: '#c0362c',
          desk: 'radial-gradient(70% 60% at 50% 40%, #e7efdf 0%, transparent 75%), linear-gradient(170deg, #d4e2c9 0%, #dfe9d4 50%, #c7d7bb 100%)',
          'wheel-face': '#f3e2c0',
          'wheel-slice': '#f2dfba',
          'wheel-slice-hover': '#fff3d9',
          'wheel-slice-selected': '#f1bf80',
          'wheel-text': '#2a221d',
          'wheel-text-selected': '#24170f',
          'wheel-sub': '#594a3f',
          'wheel-line': '#4a3a2e',
          'wheel-shadow': 'rgba(52, 70, 40, 0.35)',
          'wood-in': '#f7e9cb',
          'wood-out': '#efd5a6',
          sapwood: '#f9ecd0',
          ring: '#d6b37c',
          late: '#c39256',
          bark: '#f5f2ea',
          'bark-edge': '#a69f94',
          lenticel: '#3f3b36',
          check: '#5b4332',
          'check-hi': '#fff6e3',
          heart: '#ecd3a5',
          'heart-ring': '#d2ad72',
          'hub-text': '#2a221d',
          'hub-muted': '#5a4b3f',
          'key-bg': 'rgba(255, 250, 238, 0.7)',
          'key-line': '#b48f5d',
          char: '#2b1c14',
          scorch: '#6b3518',
          ember: '#ff7a2c',
          'ember-hot': '#ffd27a',
          smoke: 'rgba(96, 90, 84, 0.55)',
          dust: '#d7a35c',
          'dust-2': '#fff8ea',
          puff: 'rgba(250, 236, 205, 0.85)',
        },
        dark: {
          bg: '#121a17',
          surface: '#18221f',
          'surface-2': '#1f2b27',
          border: '#2c3a35',
          'border-strong': '#4a5c55',
          text: '#f2e8d8',
          'text-muted': '#b5ab9c',
          accent: '#ff9a52',
          'on-accent': '#24120a',
          focus: '#9fd6bd',
          success: '#68cf8e',
          'on-success': '#0a2414',
          'success-text': '#7bd99c',
          warning: '#f2b84b',
          'warning-text': '#f5c869',
          danger: '#ff7b6e',
          desk: 'radial-gradient(60% 50% at 50% 55%, rgba(255, 140, 70, 0.08), transparent 70%), linear-gradient(175deg, #1c2e29 0%, #14231f 55%, #0d1714 100%)',
          'wheel-face': '#2a2623',
          'wheel-slice': '#2b2724',
          'wheel-slice-hover': '#3c3631',
          'wheel-slice-selected': '#ff9150',
          'wheel-text': '#f4e9d8',
          'wheel-text-selected': '#1e0f08',
          'wheel-sub': '#c4b6a4',
          'wheel-line': '#0f0d0c',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'wood-in': '#2f2a26',
          'wood-out': '#231f1c',
          sapwood: '#3b342f',
          ring: '#4b443e',
          late: '#615850',
          bark: '#151312',
          'bark-edge': '#0a0909',
          lenticel: '#4a403a',
          check: '#0e0c0b',
          'check-hi': 'rgba(255, 150, 80, 0.35)',
          heart: '#36302b',
          'heart-ring': '#4d4640',
          'hub-text': '#f4e9d8',
          'hub-muted': '#c4b6a4',
          'key-bg': '#25211e',
          'key-line': '#6d6157',
          char: '#1d0f09',
          scorch: '#5a1f08',
          ember: '#ff6a1f',
          'ember-hot': '#ffe08a',
          smoke: 'rgba(200, 190, 180, 0.45)',
          dust: '#a59a90',
          'dust-2': '#ffad5c',
          puff: 'rgba(150, 140, 132, 0.6)',
        },
      },
      // A soft blur for the scorch around the brand (drawn only on the chosen wedge).
      defs: '<filter id="agachalkasi-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>',
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
        ['wheel-text', 'wood-out', 'text'],
        ['wheel-sub', 'wheel-slice', 'text'],
        ['wheel-sub', 'wheel-slice-hover', 'text'],
        ['hub-text', 'heart', 'text'],
        ['hub-muted', 'heart', 'text'],
        ['char', 'wheel-slice-selected', 'ui'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const defs = H.s('defs', {}, root);
          const wid = H.uid('agachalkasi-w');
          const rg = H.s(
            'radialGradient',
            { id: wid, gradientUnits: 'userSpaceOnUse', cx: C + PITH[0], cy: C + PITH[1], r: R.sap },
            defs,
          );
          H.s('stop', { offset: 0, style: 'stop-color: var(--wood-in)' }, rg);
          H.s('stop', { offset: 0.65, style: 'stop-color: var(--wood-in)' }, rg);
          H.s('stop', { offset: 1, style: 'stop-color: var(--wood-out)' }, rg);

          const log = H.s('g', { class: 'ag-log', 'aria-hidden': 'true' }, root);
          H.s('path', { d: barkPath(), class: 'ag-bark', 'fill-rule': 'evenodd' }, log);
          H.s('path', { d: lenticels(5), class: 'ag-lenticel' }, log);
          H.s('circle', { cx: C, cy: C, r: R.sap, class: 'ag-sap' }, log);
          H.s('circle', { cx: C, cy: C, r: R.face, fill: `url(#${wid})` }, log);
          const rings = ringSet(R.hub + 6, R.face - 2, 11);
          let early = '';
          let late = '';
          for (const x of rings) {
            const d = ringPath(x.r, 0.8 + x.r * 0.012, 1.2 + x.r * 0.014);
            if (x.late) late += d;
            else early += d;
          }
          H.s('path', { d: early, class: 'ag-ring' }, log);
          H.s('path', { d: late, class: 'ag-late' }, log);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.hub, R.bark, sl.a0, sl.a1), class: 'ag-hit' }, g);
            H.s('path', { d: H.sector(R.hub + 1, R.face, sl.a0, sl.a1), class: 'ag-face' }, g);
            // The brand that stays on the chosen wedge: scorch, double ring and four bars.
            const { room, ring } = fit(sl);
            const [bx, by] = H.polar(R.label, sl.mid);
            const br = H.s(
              'g',
              { class: 'ag-brand', 'aria-hidden': 'true', style: `transform-origin: ${f2(bx)}px ${f2(by)}px` },
              g,
            );
            H.s('circle', { cx: f2(bx), cy: f2(by), r: ring, class: 'ag-scorch' }, br);
            H.s('circle', { cx: f2(bx), cy: f2(by), r: ring, class: 'ag-ring1' }, br);
            H.s('circle', { cx: f2(bx), cy: f2(by), r: ring - 5.5, class: 'ag-ring2' }, br);
            H.s('path', { d: brand(bx, by, ring), class: 'ag-bars' }, br);
            const ink = H.s('g', { class: 'ag-ink' }, g);
            if (sl.format) {
              H.block(ink, sl, R.label, {
                size: 21,
                subSize: 12.5,
                gap: 1,
                maxWidth: room + 2,
                minSize: 9,
                cls: 'ag-lbl',
                subCls: 'ag-sub',
              });
            } else {
              H.block(ink, sl, R.label, {
                icon: true,
                iconSize: 21,
                size: 13.5,
                gap: 3,
                maxWidth: room,
                minSize: 8.5,
                cls: 'ag-lbl ag-lbl-s',
                sub: null,
              });
            }
            // More choices: an arrowhead burnt into the outer rings, pointing to the bark.
            H.ringMark(ink, sl, m, { r: R.face - 2.5, size: 8.5, cls: 'ag-ring-mark' });
          }

          // Drying checks along the slice borders, over the wedges.
          const checks = H.s('g', { class: 'ag-checks', 'aria-hidden': 'true' }, root);
          let cd = '';
          m.slices.forEach((sl, k) => (cd += check(sl.a0, R.hub + 2, R.sap + 1, 31 + k)));
          H.s('path', { d: cd, class: 'ag-check-hi', transform: 'translate(0.8 0.8)' }, checks);
          H.s('path', { d: cd, class: 'ag-check' }, checks);

          // Hub: the heartwood with its first rings and the pith.
          const hub = H.s('g', { class: 'ag-hub' }, root);
          H.s('circle', { cx: C, cy: C, r: R.hub, class: 'ag-heart' }, hub);
          let hr = '';
          for (const x of ringSet(9, R.hub - 4, 7)) hr += ringPath(x.r, 0.8 + x.r * 0.012, 0.8 + x.r * 0.012);
          H.s('path', { d: hr, class: 'ag-heart-rings' }, hub);
          H.s('circle', { cx: C, cy: C, r: R.hub, class: 'ag-heart-edge' }, hub);
          const dy = m.key ? 0 : 9;
          H.label(hub, C, C - 15 + dy, m.title, {
            maxWidth: 92,
            size: 16.5,
            minSize: 10,
            cls: 'ag-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 5 + dy, m.file, {
            maxWidth: 84,
            size: 11.5,
            minSize: 8.5,
            cls: 'ag-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.6;
            H.s('rect', { x: f2(C - kw / 2), y: C + 17, width: f2(kw), height: 17, rx: 2.5, class: 'ag-key' }, hub);
            H.text(hub, C, C + 26.3, m.key, { class: 'ag-keytext' });
          }

          H.s('g', { class: 'ag-fx', 'aria-hidden': 'true' }, root);
        },

        onOpen(root) {
          const wrap = root.closest('.wheel');
          if (wrap && wrap.classList.contains('has-selected')) return;
          const fx = root.querySelector('.ag-fx');
          if (fx) fx.textContent = '';
        },

        // Smoke curls and sawdust for the brand; the brand itself is the slice's own .ag-brand.
        onSelect(root, m, i, H, t) {
          const fx = root.querySelector('.ag-fx');
          fx.textContent = '';
          if (t == null && reducedMotion()) return;
          const sl = m.slices[i];
          const [bx, by] = H.polar(R.label, sl.mid);
          const edge = fit(sl).ring - 8;
          for (let k = 0; k < 3; k++) {
            const x = bx + (k - 1) * 15;
            const y = by - 30 + Math.abs(k - 1) * 8;
            const s = k % 2 ? -1 : 1;
            H.s(
              'path',
              {
                class: 'ag-smoke',
                style: `--k: ${k}`,
                d: `M${f2(x)} ${f2(y)}c${6 * s} -8 ${-6 * s} -13 0 -21s${-6 * s} -13 0 -21`,
              },
              fx,
            );
          }
          const g = rnd(97 + i);
          // A puff of fine dust, then chips thrown out of the brand's edge.
          for (let k = 0; k < 4; k++) {
            const a = sl.mid + (k - 1.5) * 50;
            const [px, py] = [bx + Math.sin(rad(a)) * edge, by - Math.cos(rad(a)) * edge];
            H.s(
              'circle',
              {
                class: 'ag-puff',
                cx: f2(px),
                cy: f2(py),
                r: 12 + k * 1.5,
                style: `--k: ${k}; transform-origin: ${f2(px)}px ${f2(py)}px`,
              },
              fx,
            );
          }
          for (let k = 0; k < 18; k++) {
            const a = g() * 360;
            const [sx, sy] = [bx + Math.sin(rad(a)) * edge, by - Math.cos(rad(a)) * edge];
            const dist = 24 + g() * 40;
            const dx = Math.sin(rad(a)) * dist;
            const dy = -Math.cos(rad(a)) * dist - 12;
            const r = 1.8 + g() * 2.4;
            H.s(
              'rect',
              {
                class: 'ag-dust' + (k % 3 === 0 ? ' ag-dust-2' : ''),
                x: f2(sx - r),
                y: f2(sy - r * 0.6),
                width: f2(r * 2),
                height: f2(r * 1.2),
                rx: f2(r * 0.4),
                style: `--dx: ${f2(dx)}px; --dy: ${f2(dy)}px; --rot: ${Math.round((g() - 0.5) * 300)}deg; --d: ${Math.round(110 + g() * 60)}ms; transform-origin: ${f2(sx)}px ${f2(sy)}px`,
              },
              fx,
            );
          }
        },
      },

      sounds: {
        open(ac, out, t, X) {
          // A hollow wooden knock, then a softer second one.
          X.tone(ac, out, t, { type: 'triangle', f: 230, f2: 170, dur: 0.07, gain: 0.09, a: 0.002 });
          X.burst(ac, out, t, { type: 'bandpass', f: 950, q: 3, dur: 0.035, gain: 0.08 });
          X.tone(ac, out, t + 0.065, { type: 'triangle', f: 330, f2: 260, dur: 0.05, gain: 0.04, a: 0.002 });
        },
        tick(ac, out, t, X) {
          // A dry twig tick.
          X.burst(ac, out, t, { type: 'bandpass', f: 2400, q: 9, dur: 0.012, gain: 0.1 });
          X.tone(ac, out, t, { type: 'triangle', f: 1150, f2: 880, dur: 0.014, gain: 0.02, a: 0.001 });
        },
        success(ac, out, t, X) {
          // The brand lands: a dull thud, a short sizzle and a few crackles.
          X.tone(ac, out, t, { type: 'sine', f: 150, f2: 55, dur: 0.12, gain: 0.16, a: 0.002 });
          X.burst(ac, out, t, { type: 'lowpass', f: 700, q: 0.8, dur: 0.05, gain: 0.1 });
          X.burst(ac, out, t + 0.03, { type: 'highpass', f: 4200, f2: 7500, q: 0.6, dur: 0.38, gain: 0.035, a: 0.03 });
          for (const h of [0.12, 0.2, 0.27, 0.37])
            X.burst(ac, out, t + h, { type: 'bandpass', f: 3000 + h * 4000, q: 6, dur: 0.006, gain: 0.045 });
        },
      },
    });
  })();
}
