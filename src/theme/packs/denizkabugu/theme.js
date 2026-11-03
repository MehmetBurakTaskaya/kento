// SPDX-License-Identifier: MIT
// Theme: Deniz kabuğu (seashell). A nautilus-like shell cut in half: pearly chambers divided by
// curved septa are the slices, the shell wall grows around them and the inner coil is the hub.
// Applying a slice sends a shimmer over the chamber and rolls a pearl along the spiral to the center.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    // Radii: inner whorl (hub), chamber inner edge, shell wall thickness, outer edge at the aperture
    // and its growth over one turn, label line.
    const R = { hub: 64, in: 66, wall: 13, out0: 173, grow: 23, label: 125, siph: 88 };

    const reducedMotion = () =>
      document.documentElement.classList.contains('reduce-motion') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pt = (r, a, cx = 200, cy = 200) => [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))];
    const P = (p) => `${f2(p[0])} ${f2(p[1])}`;

    // The shell grows clockwise from the aperture (counterclockwise in right-to-left layouts).
    function shell(m) {
      const rtl = m.dir === 'rtl';
      const ap = rtl ? m.slices[0].a1 : m.slices[0].a0;
      const dir = rtl ? -1 : 1;
      // phase 0..1 around the turn; `side` nudges a border angle into the chamber it belongs to.
      const phase = (a) => (((((a - ap) * dir) % 360) + 360) % 360) / 360;
      const rOut = (a, side = 0) => R.out0 + R.grow * phase(a + side * 0.01 * dir);
      return { ap, dir, phase, rOut, rWall: (a, side) => rOut(a, side) - R.wall };
    }

    // A septum from the inner edge to the shell wall along border angle a, bowed toward the growth.
    function septum(sh, a, side) {
      const r1 = sh.rWall(a, side);
      const p0 = pt(R.in, a);
      const p1 = pt(r1, a);
      const c = pt((R.in + r1) / 2, a + sh.dir * 7.5);
      return { p0, p1, c, d: `M${P(p0)}Q${P(c)} ${P(p1)}` };
    }

    // One chamber: septum out, along the wall, septum back, along the inner edge.
    function chamber(sh, sl) {
      const s0 = septum(sh, sl.a0, 1);
      const s1 = septum(sh, sl.a1, -1);
      let d = `M${P(s0.p0)}Q${P(s0.c)} ${P(s0.p1)}`;
      for (let a = sl.a0 + 2; a < sl.a1 - 0.5; a += 2) d += `L${P(pt(sh.rWall(a, 0), a))}`;
      d += `L${P(s1.p1)}Q${P(s1.c)} ${P(s1.p0)}`;
      d += `A${R.in} ${R.in} 0 0 0 ${P(s0.p0)}Z`;
      return d;
    }

    // The shell wall: outer spiral edge, the step at the aperture, inner spiral edge back.
    function wall(sh) {
      let outer = '';
      let inner = '';
      for (let k = 0; k <= 180; k++) {
        const a = sh.ap + sh.dir * k * 2;
        const side = k === 0 ? 1 : k === 180 ? -1 : 0;
        outer += `${k ? 'L' : 'M'}${P(pt(sh.rOut(a, side), a))}`;
        inner = `L${P(pt(sh.rWall(a, side), a))}` + inner;
      }
      return outer + inner + 'Z';
    }

    // Flame stripes across the wall, leaning back like growth lines; they fade toward the aperture.
    function stripes(sh) {
      let d = '';
      for (let k = 0; k < 24; k++) {
        // Irregular spacing and width, thinning out toward the aperture end of the turn.
        const a = sh.ap + sh.dir * (6 + k * 13.6 + ((k * 37) % 7) - 2);
        const w = (1.6 + ((k * 13) % 5) * 0.75) * (1 - k / 34);
        const lean = -sh.dir * (3 + (k % 3));
        const q = [
          pt(sh.rWall(a, 0) + 1, a),
          pt(sh.rOut(a, 0) - 0.6, a + lean),
          pt(sh.rOut(a, 0) - 0.6, a + lean + sh.dir * w),
          pt(sh.rWall(a, 0) + 1, a + sh.dir * w * 0.8),
        ];
        d += `M${P(q[0])}L${P(q[1])}L${P(q[2])}L${P(q[3])}Z`;
      }
      return d;
    }

    // The inner coil: a logarithmic spiral from the hub edge inward, with small septa between turns.
    function coil(sh, r0 = R.hub - 2, turns = 2.4, cx = 200, cy = 200) {
      const b = Math.log(r0 / 5) / (turns * 2 * Math.PI);
      const r = (phi) => r0 * Math.exp(-b * phi);
      let line = '';
      const N = Math.round(turns * 72);
      for (let k = 0; k <= N; k++) {
        const phi = (k / N) * turns * 2 * Math.PI;
        const a = sh.ap - sh.dir * ((phi * 180) / Math.PI);
        line += `${k ? 'L' : 'M'}${P(pt(r(phi), a, cx, cy))}`;
      }
      let septa = '';
      for (let phi = 0.45; phi < (turns - 1) * 2 * Math.PI; phi += 0.52) {
        const a = sh.ap - sh.dir * ((phi * 180) / Math.PI);
        const a2 = a - sh.dir * 360;
        const p0 = pt(r(phi), a, cx, cy);
        const p1 = pt(r(phi + 2 * Math.PI), a2, cx, cy);
        const c = pt((r(phi) + r(phi + 2 * Math.PI)) / 2, a + sh.dir * 9, cx, cy);
        septa += `M${P(p0)}Q${P(c)} ${P(p1)}`;
      }
      return { line, septa };
    }

    Board.define({
      id: 'denizkabugu',
      fonts: {
        brand: "'Spectral'",
        display: "'Spectral'",
        load: ["'Spectral'"],
        credits: [{ family: 'Spectral', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 190, close: 120, stagger: 10, apply: 700 },

      palette: {
        light: {
          bg: '#f2f7f6',
          surface: '#ffffff',
          'surface-2': '#ebf3f2',
          border: '#d3e2e0',
          'border-strong': '#9fbcb8',
          text: '#1d2238',
          'text-muted': '#4f566e',
          accent: '#7c4f8c',
          'on-accent': '#ffffff',
          focus: '#2a7d84',
          success: '#2a7a5e',
          'on-success': '#ffffff',
          'success-text': '#226a51',
          warning: '#b8770b',
          'warning-text': '#7a4e00',
          danger: '#c0362c',
          desk: 'radial-gradient(80% 60% at 30% 15%, rgba(255, 255, 255, 0.85), transparent 70%), linear-gradient(170deg, #cfece8 0%, #e6f4f1 50%, #d2e8ea 100%)',
          'wheel-face': '#f7f1f3',
          'wheel-slice': '#f6f0f2',
          'wheel-slice-hover': '#ead9ec',
          'wheel-slice-selected': '#a596dd',
          'wheel-text': '#262a46',
          'wheel-text-selected': '#17142c',
          'wheel-sub': '#565a74',
          'wheel-line': '#b9a2b6',
          'wheel-shadow': 'rgba(40, 90, 96, 0.3)',
          'nacre-1': '#fcf2f1',
          'nacre-2': '#efe7fa',
          'nacre-3': '#e2f3ee',
          'nacre-4': '#fbf3e6',
          'abalone-1': '#86d0cc',
          'abalone-2': '#a596dd',
          'abalone-3': '#eda3c0',
          hover: '#e8d6ee',
          'hover-2': '#d3efe9',
          septum: '#a88aa6',
          'septum-hi': '#ffffff',
          'wall-fill': '#fdf9f4',
          'wall-line': '#b9a2b6',
          stripe: '#e39a88',
          'hub-in': '#fffdfb',
          'hub-out': '#f1e7ef',
          coil: '#a88aa6',
          'hub-text': '#262a46',
          'hub-muted': '#565a74',
          'key-bg': '#fffaf6',
          'key-line': '#b9a2b6',
          glow: '#ffffff',
          ripple: '#c6a7d8',
        },
        dark: {
          bg: '#06141f',
          surface: '#0c1f2c',
          'surface-2': '#122836',
          border: '#1d3a4c',
          'border-strong': '#3b6478',
          text: '#eef2ff',
          'text-muted': '#a6b6c6',
          accent: '#d9b8f0',
          'on-accent': '#1d1230',
          focus: '#7fd6d9',
          success: '#5fd3a6',
          'on-success': '#05261a',
          'success-text': '#72dcb4',
          warning: '#f2c25b',
          'warning-text': '#f5cd73',
          danger: '#ff7b74',
          desk: 'radial-gradient(70% 55% at 50% -5%, rgba(120, 200, 220, 0.18), transparent 70%), linear-gradient(180deg, #08222f 0%, #061824 55%, #040f18 100%)',
          'wheel-face': '#1c2a42',
          'wheel-slice': '#1d2944',
          'wheel-slice-hover': '#2e3f66',
          'wheel-slice-selected': '#efe4fb',
          'wheel-text': '#eef0ff',
          'wheel-text-selected': '#1d1a33',
          'wheel-sub': '#b9c1dc',
          'wheel-line': '#6f7fa8',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          'nacre-1': '#1d2844',
          'nacre-2': '#262447',
          'nacre-3': '#183741',
          'nacre-4': '#202d47',
          'abalone-1': '#f6eefe',
          'abalone-2': '#e5f6f3',
          'abalone-3': '#fbe3ee',
          hover: '#33406b',
          'hover-2': '#22495a',
          septum: '#8f9cc8',
          'septum-hi': 'rgba(220, 230, 255, 0.35)',
          'wall-fill': '#222a40',
          'wall-line': '#6f7fa8',
          stripe: '#b8676a',
          'hub-in': '#2a3352',
          'hub-out': '#1a2238',
          coil: '#8f9cc8',
          'hub-text': '#eef0ff',
          'hub-muted': '#b9c1dc',
          'key-bg': '#1a2238',
          'key-line': '#6f7fa8',
          glow: '#ffffff',
          ripple: '#e9dcff',
        },
      },
      defs:
        '<radialGradient id="denizkabugu-pearl" cx=".36" cy=".32" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#fbf1f4"/><stop offset=".75" stop-color="#e3d7ee"/><stop offset="1" stop-color="#bfb0d6"/></radialGradient>' +
        '<linearGradient id="denizkabugu-band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".85"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>',
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
        ['wheel-text', 'nacre-2', 'text'],
        ['wheel-text', 'nacre-3', 'text'],
        ['wheel-text', 'hover-2', 'text'],
        ['wheel-sub', 'wheel-slice', 'text'],
        ['wheel-sub', 'wheel-slice-hover', 'text'],
        ['wheel-text-selected', 'abalone-1', 'text'],
        ['wheel-text-selected', 'abalone-3', 'text'],
        ['hub-text', 'hub-out', 'text'],
        ['hub-muted', 'hub-out', 'text'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const sh = shell(m);
          const defs = H.s('defs', {}, root);
          const grad = (kind, attrs, stops) => {
            const id = H.uid('denizkabugu-' + kind);
            const g = H.s(kind === 'r' ? 'radialGradient' : 'linearGradient', Object.assign({ id }, attrs), defs);
            stops.forEach(([o, v]) => H.s('stop', { offset: o, style: `stop-color: var(--${v})` }, g));
            return `url(#${id})`;
          };
          const nacre = grad('l', { x1: 0, y1: 0, x2: 1, y2: 1 }, [
            [0, 'nacre-1'],
            [0.35, 'nacre-2'],
            [0.7, 'nacre-3'],
            [1, 'nacre-4'],
          ]);
          const hover = grad('l', { x1: 0, y1: 1, x2: 1, y2: 0 }, [
            [0, 'hover'],
            [1, 'hover-2'],
          ]);
          const sel = grad('l', { x1: 0, y1: 0, x2: 1, y2: 1 }, [
            [0, 'abalone-1'],
            [0.5, 'abalone-2'],
            [1, 'abalone-3'],
          ]);
          const hubFill = grad('r', { cx: 0.42, cy: 0.38, r: 0.7 }, [
            [0, 'hub-in'],
            [1, 'hub-out'],
          ]);
          // A soft pearly veil over the middle of the coil, so the hub text sits on a calm patch.
          const veil = H.uid('denizkabugu-veil');
          const vg = H.s('radialGradient', { id: veil, cx: 0.5, cy: 0.5, r: 0.5 }, defs);
          H.s('stop', { offset: 0, style: 'stop-color: var(--hub-in); stop-opacity: 0.94' }, vg);
          H.s('stop', { offset: 0.62, style: 'stop-color: var(--hub-in); stop-opacity: 0.8' }, vg);
          H.s('stop', { offset: 1, style: 'stop-color: var(--hub-in); stop-opacity: 0' }, vg);

          const shellG = H.s('g', { class: 'dk-shell', 'aria-hidden': 'true' }, root);
          H.s('path', { d: wall(sh), class: 'dk-wall' }, shellG);
          H.s('path', { d: stripes(sh), class: 'dk-stripes' }, shellG);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const d = chamber(sh, sl);
            const body = H.s('g', { class: 'dk-body' }, g);
            H.s('path', { d, class: 'dk-ch', fill: nacre }, body);
            H.s('path', { d, class: 'dk-hov', fill: hover }, body);
            H.s('path', { d, class: 'dk-sel', fill: sel }, body);
            const ink = H.s('g', { class: 'dk-ink' }, g);
            // A wider chamber (fewer slices) gives a long label more room.
            const chord = 2 * R.label * Math.sin(rad(Math.min(sl.step, 180) / 2));
            const room = Math.round(Math.max(70, Math.min(96, chord * 0.62)));
            if (sl.format) {
              H.block(ink, sl, R.label, {
                size: 22,
                subSize: 12.5,
                gap: 0.5,
                maxWidth: room,
                minSize: 9,
                cls: 'dk-lbl',
                subCls: 'dk-sub',
              });
            } else {
              H.block(ink, sl, R.label, {
                icon: true,
                iconSize: 21,
                size: 14,
                gap: 3,
                maxWidth: room + 2,
                minSize: 9,
                cls: 'dk-lbl dk-lbl-s',
                sub: null,
              });
            }
          }

          // Septa, the siphuncle beads that thread through them, and the aperture lip.
          const lines = H.s('g', { class: 'dk-lines', 'aria-hidden': 'true' }, root);
          let sd = '';
          let beads = '';
          for (const sl of m.slices) {
            const s = septum(sh, sl.a0, 1);
            sd += s.d;
            const [bx, by] = pt(R.siph, sl.a0 + sh.dir * 3.4);
            beads += `M${f2(bx - 3.2)} ${f2(by)}a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0`;
          }
          const lip = [pt(sh.rWall(sh.ap, 1), sh.ap), pt(sh.rOut(sh.ap, -1), sh.ap)];
          H.s('path', { d: sd, class: 'dk-septa-hi', transform: 'translate(0.9 0.9)' }, lines);
          H.s('path', { d: sd, class: 'dk-septa' }, lines);
          H.s('path', { d: beads, class: 'dk-beads' }, lines);
          H.s('path', { d: `M${P(lip[0])}L${P(lip[1])}`, class: 'dk-lip' }, lines);

          // Hub: the inner coil on a pearly disc.
          const hub = H.s('g', { class: 'dk-hub' }, root);
          H.s('circle', { cx: C, cy: C, r: R.hub, fill: hubFill, class: 'dk-hubdisc' }, hub);
          const c = coil(sh);
          H.s('path', { d: c.septa, class: 'dk-coil-septa' }, hub);
          H.s('path', { d: c.line, class: 'dk-coil' }, hub);
          H.s('circle', { cx: C, cy: C, r: 52, fill: `url(#${veil})` }, hub);
          H.s('circle', { cx: C, cy: C, r: R.hub, class: 'dk-hubrim' }, hub);
          const dy = m.key ? 0 : 9;
          H.label(hub, C, C - 14 + dy, m.title, {
            maxWidth: 92,
            size: 17,
            minSize: 10,
            cls: 'dk-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 5.5 + dy, m.file, {
            maxWidth: 84,
            size: 11.5,
            minSize: 8.5,
            cls: 'dk-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.6;
            H.s('rect', { x: f2(C - kw / 2), y: C + 17, width: f2(kw), height: 17, rx: 8.5, class: 'dk-key' }, hub);
            H.text(hub, C, C + 26.3, m.key, { class: 'dk-keytext' });
          }

          H.s('g', { class: 'dk-fx', 'aria-hidden': 'true' }, root);
        },

        onOpen(root) {
          const wrap = root.closest('.wheel');
          if (wrap && wrap.classList.contains('has-selected')) return;
          const fx = root.querySelector('.dk-fx');
          if (fx) fx.textContent = '';
        },

        // A shimmer band clipped to the chamber, then a pearl that rolls along the spiral into the
        // center (rotate + translate interpolate into a spiral; the counter-rotation keeps its
        // highlight toward the light) and a ripple where it lands.
        onSelect(root, m, i, H, t) {
          const fx = root.querySelector('.dk-fx');
          fx.textContent = '';
          if (t == null && reducedMotion()) return;
          const sl = m.slices[i];
          const sh = shell(m);
          const C = H.C;
          const clip = H.uid('denizkabugu-clip');
          H.s('path', { d: chamber(sh, sl) }, H.s('clipPath', { id: clip }, fx));
          const band = H.s('g', { 'clip-path': `url(#${clip})` }, fx);
          const [cx, cy] = pt(R.label, sl.mid);
          H.s(
            'rect',
            {
              class: 'dk-band',
              x: f2(cx - 30),
              y: f2(cy - 160),
              width: 60,
              height: 320,
              fill: 'url(#denizkabugu-band)',
              style: `transform-origin: ${f2(cx)}px ${f2(cy)}px`,
            },
            band,
          );
          const a0 = sl.mid + sh.dir * 6;
          const a1 = a0 - sh.dir * 430;
          const pearl = H.s(
            'g',
            {
              class: 'dk-pearl',
              style: `--a0: ${f2(a0)}deg; --a1: ${f2(a1)}deg; --na0: ${f2(-a0)}deg; --na1: ${f2(-a1)}deg`,
            },
            fx,
          );
          H.s('circle', { cx: C, cy: C, r: 10, class: 'dk-pearl-shadow' }, pearl);
          H.s('circle', { cx: C, cy: C, r: 9.5, fill: 'url(#denizkabugu-pearl)', class: 'dk-pearl-body' }, pearl);
          H.s('circle', { cx: C - 3.1, cy: C - 3.3, r: 2.1, class: 'dk-pearl-spec' }, pearl);
          H.s('circle', { cx: C, cy: C, r: 20, class: 'dk-ripple' }, fx);
          H.s('circle', { cx: C, cy: C, r: 20, class: 'dk-ripple dk-ripple-2' }, fx);
        },
      },

      sounds: {
        open(ac, out, t, X) {
          // The hush of the sea in a shell, with a faint hollow ring.
          X.burst(ac, out, t, { type: 'lowpass', f: 380, f2: 1100, q: 0.9, dur: 0.18, gain: 0.09, a: 0.04 });
          X.tone(ac, out, t + 0.02, { type: 'sine', f: 520, f2: 610, dur: 0.12, gain: 0.018, a: 0.02 });
        },
        tick(ac, out, t, X) {
          // A porcelain click.
          X.tone(ac, out, t, { type: 'sine', f: 2650, dur: 0.018, gain: 0.04, a: 0.001 });
          X.tone(ac, out, t, { type: 'triangle', f: 1320, dur: 0.012, gain: 0.02, a: 0.001 });
        },
        success(ac, out, t, X) {
          // A pearl rolling round the spiral (its purr rises as the turns tighten), a few glints,
          // and a small glass ting where it lands.
          X.burst(ac, out, t + 0.08, { type: 'bandpass', f: 700, f2: 2600, q: 3, dur: 0.46, gain: 0.03, a: 0.06 });
          [2637, 3136, 3520, 4186].forEach((f, k) =>
            X.tone(ac, out, t + 0.04 + k * 0.05, { type: 'sine', f, dur: 0.06, gain: 0.014, a: 0.002 }),
          );
          X.tone(ac, out, t + 0.56, { type: 'sine', f: 1568, dur: 0.45, gain: 0.04, a: 0.002 });
          X.tone(ac, out, t + 0.56, { type: 'sine', f: 1568 * 2.4, dur: 0.18, gain: 0.01, a: 0.001 });
        },
      },
    });
  })();
}
