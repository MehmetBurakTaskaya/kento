// SPDX-License-Identifier: MIT
// Theme: Kar tanesi (snowflake). An ice crystal with branching arms lies on a disc of frosted
// glass; the slices are the panes between the arms. Applying a slice grows frost across it.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    // Radii: hub plate, pane inner and outer edge, label line, arm tip.
    const R = { hub: 62, in: 64, out: 180, label: 128, tip: 194 };

    // Frame on a line at angle a (degrees from twelve o'clock): u points outward, v clockwise.
    function frame(a, cx = 200, cy = 200) {
      const u = [Math.sin(rad(a)), -Math.cos(rad(a))];
      const v = [Math.cos(rad(a)), Math.sin(rad(a))];
      return (r, s) => [cx + u[0] * r + v[0] * s, cy + u[1] * r + v[1] * s];
    }
    const P = (p) => `${f2(p[0])} ${f2(p[1])}`;

    // One crystal arm along angle a: a spine, pairs of side branches at 60 degrees with twigs, and a
    // small six-sided plate at the tip. Shorter branches near the label line keep labels clear.
    function arm(a, k = 1, cx = 200, cy = 200, opt = {}) {
      const at = frame(a, cx, cy);
      const r0 = (opt.r0 ?? R.in - 2) * k;
      const r1 = (opt.r1 ?? R.tip - 8) * k;
      let d = `M${P(at(r0, 0))}L${P(at(r1, 0))}`;
      const branches = opt.branches ?? [
        [92, 15, 1],
        [121, 8, 0],
        [148, 17, 1],
        [170, 10, 0],
      ];
      for (const [r, len, twig] of branches) {
        for (const s of [-1, 1]) {
          const b = (t) => at((r + t * 0.5) * k, s * t * 0.866 * k);
          d += `M${P(at(r * k, 0))}L${P(b(len))}`;
          if (twig) {
            const m = len * 0.55;
            const base = [(r + m * 0.5) * k, s * m * 0.866 * k];
            const tw = at(base[0] + 5 * k, base[1] + s * 1.5 * k);
            d += `M${P(at(base[0], base[1]))}L${P(tw)}`;
          }
        }
      }
      // Tip plate: a small hexagon.
      const tr = (opt.plate ?? 7) * k;
      const tc = r1 + tr * 0.9;
      let hex = '';
      for (let j = 0; j < 6; j++) {
        const t = rad(j * 60);
        hex += `${j ? 'L' : 'M'}${P(at(tc + tr * Math.cos(t), tr * Math.sin(t)))}`;
      }
      return { lines: d, plate: hex + 'Z' };
    }

    // Frost ferns for one pane: feathery strokes growing from both arms and from the rim into the
    // pane. Each fern is one stroked path so it can draw itself in with a dash offset.
    function ferns(sl) {
      const out = [];
      const fern = (p0, dir, len, barb, k) => {
        let d = `M${P(p0)}L${P([p0[0] + dir[0] * len, p0[1] + dir[1] * len])}`;
        for (let t = 4.5; t < len - 1; t += 4.2) {
          const q = [p0[0] + dir[0] * t, p0[1] + dir[1] * t];
          const bl = barb * (1 - t / len) + 1.4;
          for (const s of [-1, 1]) {
            const c = Math.cos(rad(48)),
              sn = Math.sin(rad(48)) * s;
            const b = [dir[0] * c - dir[1] * sn, dir[0] * sn + dir[1] * c];
            d += `M${P(q)}L${P([q[0] + b[0] * bl, q[1] + b[1] * bl])}`;
          }
        }
        out.push({ d, k });
      };
      const fromArm = (a, side, r, len, barb, k) => {
        const at = frame(a);
        const u = [Math.sin(rad(a)), -Math.cos(rad(a))];
        const v = [Math.cos(rad(a)), Math.sin(rad(a))];
        const dir = [side * v[0] * 0.8 + u[0] * 0.6, side * v[1] * 0.8 + u[1] * 0.6];
        fern(at(r, side * 2), dir, len, barb, k);
      };
      fromArm(sl.a0, 1, 80, 26, 5.5, 0);
      fromArm(sl.a1, -1, 90, 24, 5.5, 1);
      fromArm(sl.a0, 1, 112, 16, 4, 2);
      fromArm(sl.a1, -1, 124, 16, 4, 3);
      fromArm(sl.a0, 1, 146, 22, 5, 4);
      fromArm(sl.a1, -1, 156, 24, 5, 5);
      fromArm(sl.a0, 1, 168, 14, 4, 6);
      // From the rim, pointing inward and fanning out: three in a narrow pane, more in a wide one.
      const count = Math.max(3, Math.round(sl.step / 15));
      for (let j = 0; j < count; j++) {
        const a = sl.a0 + ((j + 0.5) * sl.step) / count;
        const at = frame(a);
        const u = [Math.sin(rad(a)), -Math.cos(rad(a))];
        fern(at(R.out - 3, 0), [-u[0], -u[1]], j % 2 ? 16 : 22, 5, 6 + (j % 3));
      }
      return out;
    }

    // Four-pointed glint centered on (x, y).
    const glint = (x, y, r) =>
      `M${f2(x)} ${f2(y - r)}Q${f2(x + r * 0.16)} ${f2(y - r * 0.16)} ${f2(x + r)} ${f2(y)}Q${f2(x + r * 0.16)} ${f2(y + r * 0.16)} ${f2(x)} ${f2(y + r)}Q${f2(x - r * 0.16)} ${f2(y + r * 0.16)} ${f2(x - r)} ${f2(y)}Q${f2(x - r * 0.16)} ${f2(y - r * 0.16)} ${f2(x)} ${f2(y - r)}Z`;

    // A plate with its corners at the given angles (degrees from twelve o'clock, in order).
    function polygon(r, angles, cx = 200, cy = 200) {
      let d = '';
      angles.forEach((a, j) => {
        d += `${j ? 'L' : 'M'}${f2(cx + r * Math.sin(rad(a)))} ${f2(cy - r * Math.cos(rad(a)))}`;
      });
      return d + 'Z';
    }

    // The crystal's arms: a main arm on every slice border, and with fewer than six slices lighter
    // arms between them where they clear the labels, so the crystal keeps six-fold rhythm. Where a
    // light arm would run through a label, the hub plate only gets a corner there.
    function arms(m) {
      const main = m.slices.map((sl) => ({ a: sl.a0, kind: 'main' }));
      const minor = [];
      if (m.n < 6) {
        const k = Math.ceil(6 / m.n);
        for (const sl of m.slices)
          for (let j = 1; j < k; j++) {
            const a = sl.a0 + (j * sl.step) / k;
            minor.push({ a, kind: Math.abs(a - sl.mid) < 25 ? 'corner' : 'minor' });
          }
      }
      return [...main, ...minor].sort((p, q) => p.a - q.a);
    }

    // The room a label has across its pane: up to the nearest arm.
    function room(sl, all) {
      let half = 90;
      for (const x of all) {
        if (x.kind === 'corner') continue;
        const d = Math.abs(((((x.a - sl.mid) % 360) + 540) % 360) - 180);
        half = Math.min(half, d);
      }
      return Math.round(Math.min(92, 2 * (R.label * Math.sin(rad(half)) - 12)));
    }

    Board.define({
      id: 'kartanesi',
      fonts: {
        brand: "'Comfortaa Variable'",
        display: "'Comfortaa Variable'",
        load: ["'Comfortaa Variable'"],
        credits: [{ family: 'Comfortaa', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 190, close: 120, stagger: 11, apply: 640 },

      palette: {
        light: {
          bg: '#f1f6fa',
          surface: '#ffffff',
          'surface-2': '#eaf2f8',
          border: '#d2e1ec',
          'border-strong': '#9db8cf',
          text: '#10263a',
          'text-muted': '#4a6177',
          accent: '#1f5f93',
          'on-accent': '#ffffff',
          focus: '#1f5f93',
          success: '#227a5c',
          'on-success': '#ffffff',
          'success-text': '#1c6a50',
          warning: '#b8770b',
          'warning-text': '#7a4e00',
          danger: '#c0362c',
          desk: 'radial-gradient(70% 60% at 30% 20%, rgba(255, 255, 255, 0.9), transparent 70%), linear-gradient(165deg, #d9e7f2 0%, #eef4f9 55%, #d3e2ee 100%)',
          'wheel-face': 'rgba(248, 252, 255, 0.86)',
          'wheel-slice': '#eef5fb',
          'wheel-slice-hover': '#d2e6f6',
          'wheel-slice-selected': '#1f5f93',
          'wheel-text': '#0f2c47',
          'wheel-text-selected': '#ffffff',
          'wheel-sub': '#3c5c79',
          'wheel-line': '#b8d1e5',
          'wheel-shadow': 'rgba(40, 80, 120, 0.28)',
          'glass-in': '#fbfdff',
          'glass-out': '#e3eef7',
          'glass-edge': '#a9c7df',
          'frost-dot': '#b7cfe2',
          arm: '#5e90c0',
          'arm-hi': '#ffffff',
          'arm-lit': '#2f7fc4',
          frost: '#ffffff',
          flash: '#ffffff',
          'flash-ink': '#0f2c47',
          glint: '#ffffff',
          plate: '#e3eef8',
          'plate-line': '#a9c7df',
          'hub-text': '#0f2c47',
          'hub-muted': '#3c5c79',
          'key-bg': '#f6fafd',
          'key-line': '#a9c7df',
        },
        dark: {
          bg: '#0a1826',
          surface: '#102236',
          'surface-2': '#152b42',
          border: '#21405e',
          'border-strong': '#3c6a92',
          text: '#e6f4ff',
          'text-muted': '#9fbcd2',
          accent: '#8fd8ff',
          'on-accent': '#05213a',
          focus: '#8fd8ff',
          success: '#5fd3a6',
          'on-success': '#05261a',
          'success-text': '#72dcb4',
          warning: '#f2c25b',
          'warning-text': '#f5cd73',
          danger: '#ff7b74',
          desk: 'radial-gradient(80% 55% at 70% 0%, rgba(64, 214, 178, 0.2), transparent 70%), radial-gradient(60% 50% at 15% 10%, rgba(110, 140, 255, 0.14), transparent 70%), linear-gradient(180deg, #0a1b2d 0%, #0c2136 60%, #071523 100%)',
          'wheel-face': 'rgba(20, 46, 70, 0.84)',
          'wheel-slice': '#15304a',
          'wheel-slice-hover': '#214769',
          'wheel-slice-selected': '#a8e6ff',
          'wheel-text': '#e8f6ff',
          'wheel-text-selected': '#06233a',
          'wheel-sub': '#a9c8de',
          'wheel-line': '#3d7aa6',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          'glass-in': '#1b3a57',
          'glass-out': '#11283f',
          'glass-edge': '#5c9fcc',
          'frost-dot': '#4f84ad',
          arm: '#9fdcfb',
          'arm-hi': '#ffffff',
          'arm-lit': '#e4f8ff',
          frost: '#2f86bf',
          flash: '#ffffff',
          'flash-ink': '#06233a',
          glint: '#ffffff',
          plate: '#163754',
          'plate-line': '#4f8dbb',
          'hub-text': '#e8f6ff',
          'hub-muted': '#a9c8de',
          'key-bg': '#0f2a43',
          'key-line': '#4f8dbb',
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
        ['wheel-sub', 'wheel-slice', 'text'],
        ['wheel-sub', 'wheel-slice-hover', 'text'],
        ['hub-text', 'plate', 'text'],
        ['hub-muted', 'plate', 'text'],
        ['arm', 'wheel-slice', 'ui'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const defs = H.s('defs', {}, root);
          const gid = H.uid('kartanesi-g');
          const pid = H.uid('kartanesi-p');
          const rg = H.s('radialGradient', { id: gid, cx: 0.42, cy: 0.38, r: 0.62 }, defs);
          H.s('stop', { offset: 0, style: 'stop-color: var(--glass-in)' }, rg);
          H.s('stop', { offset: 1, style: 'stop-color: var(--glass-out)' }, rg);
          // Frost speckle: a few dots in a small tile, drawn once over the glass.
          const pat = H.s(
            'pattern',
            { id: pid, width: 13, height: 11, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(17)' },
            defs,
          );
          H.s(
            'path',
            {
              d: 'M2 2.5h.9v.9H2zM8.4 1.2h.6v.6h-.6zM5.6 6.7h1.1v1.1H5.6zM11 8.6h.6v.6H11zM1.2 9.2h.7v.7h-.7z',
              class: 'ka-speck',
            },
            pat,
          );

          const glass = H.s('g', { class: 'ka-glass', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: C, cy: C, r: R.out + 6, class: 'ka-halo' }, glass);
          H.s('circle', { cx: C, cy: C, r: R.out, fill: `url(#${gid})`, class: 'ka-disc' }, glass);
          H.s('circle', { cx: C, cy: C, r: R.out, fill: `url(#${pid})`, class: 'ka-specks' }, glass);
          let rim = '';
          for (let j = 0; j < 72; j++) {
            const a = j * 5 + (j % 3) * 1.3;
            const at = frame(a);
            const len = 6 + ((j * 7) % 5) * 2.2;
            rim += `M${P(at(R.out - 1, 0))}L${P(at(R.out - 1 - len, 0))}`;
            for (let t = 3; t < len; t += 3)
              rim += `M${P(at(R.out - 1 - t, 0))}L${P(at(R.out - 1 - t + 2.2, 2.2))}M${P(at(R.out - 1 - t, 0))}L${P(at(R.out - 1 - t + 2.2, -2.2))}`;
          }
          H.s('path', { d: rim, class: 'ka-rimfrost' }, glass);
          H.s('circle', { cx: C, cy: C, r: R.out - 0.5, class: 'ka-edge' }, glass);
          H.s('circle', { cx: C, cy: C, r: R.out - 5, class: 'ka-edge-in' }, glass);

          const all = arms(m);
          for (const sl of m.slices) {
            const width = room(sl, all);
            const g = H.slice(root, sl, m);
            const pane = H.s('g', { class: 'ka-pane-g' }, g);
            H.s('path', { d: H.sector(R.in, R.out, sl.a0, sl.a1), class: 'ka-pane' }, pane);
            H.s('path', { d: H.arc(R.out - 6, sl.a0 + 3, sl.a1 - 3), class: 'ka-rimlight' }, pane);
            const fr = H.s('g', { class: 'ka-frost', 'aria-hidden': 'true' }, pane);
            for (const f of ferns(sl))
              H.s('path', { d: f.d, pathLength: 1, style: `--k: ${f.k}`, class: 'ka-fern' }, fr);
            const sp = H.s('g', { class: 'ka-sparks', 'aria-hidden': 'true' }, g);
            [
              [0.32, 106, 6.5],
              [-0.28, 158, 8],
              [0.12, 176, 5],
            ].forEach(([da, r, s], k) => {
              // The glint by the rim keeps clear of the mark of a slice that opens a ring of choices.
              const away = sl.ring && k === 2 ? (m.dir === 'rtl' ? 1 : -1) : 1;
              const [x, y] = H.polar(r, sl.mid + away * da * sl.step);
              H.s('path', { d: glint(x, y, s), class: 'ka-glint', style: `--k: ${k}` }, sp);
            });
            const ink = H.s('g', { class: 'ka-ink' }, g);
            if (sl.format) {
              H.block(ink, sl, R.label, {
                size: 22,
                subSize: 13,
                gap: 1.5,
                maxWidth: width,
                minSize: 9,
                cls: 'ka-lbl',
                subCls: 'ka-sub',
              });
            } else {
              H.block(ink, sl, R.label, {
                icon: true,
                iconSize: 22,
                size: 14,
                gap: 4,
                maxWidth: width,
                minSize: 9,
                cls: 'ka-lbl ka-lbl-s',
                sub: null,
              });
            }
            // More choices: an icicle arrowhead pointing out, just inside the rim light and nearer the
            // middle of the pane than the snowflake's twigs.
            H.ringMark(g, sl, m, {
              r: R.out - 10,
              size: 10,
              offset: 10,
              shape: 'dart',
              halo: 1.4,
              cls: 'ka-ring-mark',
            });
          }

          // The crystal: an arm on every slice border (and lighter ones between few slices), drawn
          // twice (body and a bright core).
          const crystal = H.s('g', { class: 'ka-crystal', 'aria-hidden': 'true' }, root);
          let lines = '';
          let plates = '';
          let light = '';
          let lightPlates = '';
          for (const x of all) {
            if (x.kind === 'main') {
              const a = arm(x.a);
              lines += a.lines;
              plates += a.plate;
            } else if (x.kind === 'minor') {
              const a = arm(x.a, 1, C, C, {
                branches: [
                  [92, 12, 0],
                  [148, 13, 1],
                ],
                plate: 5,
              });
              light += a.lines;
              lightPlates += a.plate;
            }
          }
          if (light) {
            H.s('path', { d: light, class: 'ka-arm ka-arm-minor' }, crystal);
            H.s('path', { d: lightPlates, class: 'ka-plate-tip ka-plate-minor' }, crystal);
            H.s('path', { d: light, class: 'ka-arm-hi' }, crystal);
          }
          H.s('path', { d: lines, class: 'ka-arm' }, crystal);
          H.s('path', { d: plates, class: 'ka-plate-tip' }, crystal);
          H.s('path', { d: lines, class: 'ka-arm-hi' }, crystal);
          // The two arms beside a slice light up while it is chosen (toggled in update).
          for (const sl of m.slices) {
            const lit = [sl.a0, sl.a1]
              .map(
                (a) =>
                  arm(a, 1, C, C, {
                    branches: [
                      [92, 15, 0],
                      [148, 17, 0],
                    ],
                  }).lines,
              )
              .join('');
            H.s('path', { d: lit, class: 'ka-lit', 'data-k': sl.i }, crystal);
          }

          // Hub: a faceted plate with a corner on every arm (six at least, so it stays a plate).
          const hub = H.s('g', { class: 'ka-hub' }, root);
          const corners = all.map((x) => x.a);
          let facets = '';
          for (const a of corners) {
            const [x0, y0] = H.polar(R.hub, a);
            const [x1, y1] = H.polar(R.hub - 9, a);
            facets += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d: polygon(R.hub, corners), class: 'ka-hubplate' }, hub);
          H.s('path', { d: polygon(R.hub - 9, corners) + facets, class: 'ka-hubfacet' }, hub);
          const dy = m.key ? 0 : 9;
          H.label(hub, C, C - 14 + dy, m.title, {
            maxWidth: 88,
            size: 16,
            minSize: 10,
            cls: 'ka-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 5.5 + dy, m.file, {
            maxWidth: 82,
            size: 11.5,
            minSize: 8.5,
            cls: 'ka-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.6;
            H.s('rect', { x: f2(C - kw / 2), y: C + 17, width: f2(kw), height: 17, rx: 3, class: 'ka-key' }, hub);
            H.text(hub, C, C + 26.3, m.key, { class: 'ka-keytext' });
          }
        },

        update(root, m, st) {
          root.querySelectorAll('.ka-lit').forEach((p) => {
            const k = +p.dataset.k;
            p.classList.toggle('is-on', k === st.selected);
            p.classList.toggle('is-near', k === st.hover && k !== st.selected);
          });
        },
      },

      sounds: {
        open(ac, out, t, X) {
          // A breath of cold air and two faint high notes.
          X.burst(ac, out, t, { type: 'highpass', f: 5200, f2: 8000, q: 0.7, dur: 0.13, gain: 0.05, a: 0.03 });
          X.tone(ac, out, t + 0.02, { type: 'sine', f: 2637, dur: 0.09, gain: 0.02, a: 0.004 });
          X.tone(ac, out, t + 0.06, { type: 'sine', f: 3951, dur: 0.08, gain: 0.014, a: 0.004 });
        },
        tick(ac, out, t, X) {
          // A tiny glass tink.
          X.tone(ac, out, t, { type: 'sine', f: 3520, dur: 0.026, gain: 0.04, a: 0.001 });
          X.tone(ac, out, t, { type: 'sine', f: 5274, dur: 0.012, gain: 0.014, a: 0.001 });
        },
        success(ac, out, t, X) {
          // Frost crackle under a rising run of crystal chimes (inharmonic partials, like small bells).
          [0.0, 0.05, 0.09, 0.16, 0.21, 0.3].forEach((h, k) =>
            X.burst(ac, out, t + h, { type: 'highpass', f: 6500 + (k % 2) * 1500, q: 1, dur: 0.006, gain: 0.04 }),
          );
          [1568, 2093, 2349, 3136, 4186].forEach((f, k) => {
            const s = t + 0.03 + k * 0.065;
            X.tone(ac, out, s, { type: 'sine', f, dur: 0.42 - k * 0.04, gain: 0.03, a: 0.002 });
            X.tone(ac, out, s, { type: 'sine', f: f * 2.76, dur: 0.12, gain: 0.008, a: 0.001 });
          });
        },
      },
    });
  })();
}
