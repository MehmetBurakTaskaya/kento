// SPDX-License-Identifier: MIT
// Theme: Ayçiçeği (sunflower). The slices are petals around a seed head laid out on the golden
// angle. Applying a slice lifts its petal toward the light and spirals seeds into the hub.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const GOLDEN = 137.50776;
    // Radii in the 400 x 400 wheel: seed disc, petal base, widest point, tip, label line.
    const R = { disc: 80, base: 72, wide: 132, tip: 195, label: 140 };

    const reducedMotion = () =>
      document.documentElement.classList.contains('reduce-motion') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    // A petal pointing up from the center (C, C): base at radius r0, widest (half-width w) at rw,
    // a soft point at r1. Its group rotates it into place.
    function petal(r0, rw, r1, w, C = 200) {
      const y = (r) => f2(C - r);
      const x = (d) => f2(C + d);
      const lo = rw - r0;
      const hi = r1 - rw;
      return (
        `M${C} ${y(r0)}` +
        `C${x(w * 0.5)} ${y(r0 + lo * 0.18)} ${x(w)} ${y(rw - lo * 0.5)} ${x(w)} ${y(rw)}` +
        `C${x(w)} ${y(rw + hi * 0.42)} ${x(w * 0.2)} ${y(r1 - hi * 0.1)} ${C} ${y(r1)}` +
        `C${x(-w * 0.2)} ${y(r1 - hi * 0.1)} ${x(-w)} ${y(rw + hi * 0.42)} ${x(-w)} ${y(rw)}` +
        `C${x(-w)} ${y(rw - lo * 0.5)} ${x(-w * 0.5)} ${y(r0 + lo * 0.18)} ${C} ${y(r0)}Z`
      );
    }

    // Seeds on the golden angle (Vogel's model): seed k sits at radius c * sqrt(k). One path for
    // the whole band keeps the node count low.
    function seedPath(cx, cy, c, rMin, rMax, s0, s1) {
      let d = '';
      const k0 = Math.ceil((rMin / c) ** 2);
      const k1 = Math.floor((rMax / c) ** 2);
      for (let k = Math.max(1, k0); k <= k1; k++) {
        const r = c * Math.sqrt(k);
        const a = (k * GOLDEN * Math.PI) / 180;
        const x = cx + r * Math.sin(a);
        const y = cy - r * Math.cos(a);
        const s = s0 + ((s1 - s0) * (r - rMin)) / Math.max(1, rMax - rMin);
        d += `M${f2(x - s)} ${f2(y)}a${f2(s)} ${f2(s)} 0 1 0 ${f2(2 * s)} 0a${f2(s)} ${f2(s)} 0 1 0 ${f2(-2 * s)} 0`;
      }
      return d;
    }

    // Short grooves near the tip of a petal (upright, like petal()).
    function veins(C = 200) {
      const y = (r) => f2(C - r);
      return (
        `M${C} ${y(160)}L${C} ${y(185)}` +
        `M${C - 14} ${y(156)}Q${C - 12} ${y(172)} ${C - 5} ${y(182)}` +
        `M${C + 14} ${y(156)}Q${C + 12} ${y(172)} ${C + 5} ${y(182)}` +
        `M${C - 8} ${y(86)}L${C - 9} ${y(100)}M${C + 8} ${y(86)}L${C + 9} ${y(100)}`
      );
    }

    function stops(parent, H, list) {
      for (const [o, v] of list) H.s('stop', { offset: o, style: `stop-color: var(--${v})` }, parent);
    }

    Board.define({
      id: 'aycicegi',
      fonts: {
        brand: "'Playpen Sans Variable'",
        display: "'Playpen Sans Variable'",
        load: ["'Playpen Sans Variable'"],
        credits: [{ family: 'Playpen Sans', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 180, close: 120, stagger: 12, apply: 680 },

      palette: {
        light: {
          bg: '#f4f7ef',
          surface: '#ffffff',
          'surface-2': '#eef3e4',
          border: '#d8e1c8',
          'border-strong': '#a6b58a',
          text: '#1f2a10',
          'text-muted': '#535e3c',
          accent: '#3f6f12',
          'on-accent': '#ffffff',
          focus: '#2a6db0',
          success: '#2e7d32',
          'on-success': '#ffffff',
          'success-text': '#256b29',
          warning: '#b8770b',
          'warning-text': '#7a4e00',
          danger: '#c0362c',
          desk: 'linear-gradient(180deg, #8fcdef 0%, #bfe3f4 52%, #e6f2d4 100%)',
          'wheel-face': '#2c3810',
          'wheel-slice': '#fcc93a',
          'wheel-slice-hover': '#ffe37e',
          'wheel-slice-selected': '#ff9a2e',
          'wheel-text': '#2a2706',
          'wheel-text-selected': '#2a1400',
          'wheel-sub': '#5a4808',
          'wheel-line': '#e3940c',
          'wheel-shadow': 'rgba(34, 62, 22, 0.32)',
          'petal-base': '#f0a314',
          'petal-mid': '#fbc632',
          'petal-tip': '#ffdb57',
          'petal-edge': '#e08d0a',
          'back-base': '#de8a0c',
          'back-tip': '#f4b22a',
          glow: '#fff3a3',
          flash: '#fff8d6',
          'disc-in': '#3e4c18',
          'disc-out': '#202a0a',
          seed: '#71822a',
          floret: '#e9b83d',
          'hub-text': '#fff3c9',
          'hub-muted': '#d9d09b',
          'key-bg': 'rgba(255, 243, 201, 0.12)',
          'key-line': 'rgba(255, 243, 201, 0.5)',
        },
        dark: {
          bg: '#10132e',
          surface: '#181c3d',
          'surface-2': '#20254b',
          border: '#2e3460',
          'border-strong': '#4a5290',
          text: '#f4efd9',
          'text-muted': '#b8b49c',
          accent: '#f5b83a',
          'on-accent': '#1d1500',
          focus: '#9fb7ff',
          success: '#6fd07a',
          'on-success': '#0b2210',
          'success-text': '#7fdc8a',
          warning: '#f2b84b',
          'warning-text': '#f5c869',
          danger: '#ff7b6e',
          desk: 'radial-gradient(1.6px 1.6px at 14% 20%, #ffffff 40%, transparent 100%), radial-gradient(1.2px 1.2px at 78% 12%, #fff6d8 40%, transparent 100%), radial-gradient(1.8px 1.8px at 88% 70%, #ffffff 40%, transparent 100%), radial-gradient(1.2px 1.2px at 8% 82%, #dfe6ff 40%, transparent 100%), radial-gradient(1.4px 1.4px at 46% 6%, #ffffff 40%, transparent 100%), radial-gradient(1.2px 1.2px at 30% 94%, #fff6d8 40%, transparent 100%), radial-gradient(120% 95% at 50% 0%, #2b3274 0%, #171b47 55%, #0b0e2b 100%)',
          'wheel-face': '#1b2309',
          'wheel-slice': '#e0a12c',
          'wheel-slice-hover': '#ffcd57',
          'wheel-slice-selected': '#ff9d3c',
          'wheel-text': '#1c1500',
          'wheel-text-selected': '#1f0f00',
          'wheel-sub': '#3d2c00',
          'wheel-line': '#b36f0c',
          'wheel-shadow': 'rgba(0, 0, 8, 0.6)',
          'petal-base': '#c06d0e',
          'petal-mid': '#df9c26',
          'petal-tip': '#f7d47c',
          'petal-edge': 'rgba(206, 218, 255, 0.7)',
          'back-base': '#a65f0c',
          'back-tip': '#cf8c22',
          glow: '#ffe7a0',
          flash: '#fff4cc',
          'disc-in': '#2c3611',
          'disc-out': '#121805',
          seed: '#5b6c24',
          floret: '#cfa032',
          'hub-text': '#fff0c2',
          'hub-muted': '#cfc697',
          'key-bg': 'rgba(255, 240, 194, 0.1)',
          'key-line': 'rgba(255, 240, 194, 0.42)',
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
        ['wheel-text', 'petal-base', 'text'],
        ['wheel-sub', 'wheel-slice', 'text'],
        ['wheel-sub', 'wheel-slice-hover', 'text'],
        ['hub-text', 'wheel-face', 'text'],
        ['hub-muted', 'wheel-face', 'text'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const defs = H.s('defs', {}, root);
          const pid = H.uid('aycicegi-p');
          const bid = H.uid('aycicegi-b');
          const did = H.uid('aycicegi-d');
          // Gradients in the upright petal space: every rotated petal shares them.
          stops(
            H.s(
              'linearGradient',
              { id: pid, gradientUnits: 'userSpaceOnUse', x1: C, y1: C - R.base, x2: C, y2: C - R.tip },
              defs,
            ),
            H,
            [
              [0, 'petal-base'],
              [0.45, 'petal-mid'],
              [1, 'petal-tip'],
            ],
          );
          stops(
            H.s(
              'linearGradient',
              { id: bid, gradientUnits: 'userSpaceOnUse', x1: C, y1: C - 90, x2: C, y2: C - 196 },
              defs,
            ),
            H,
            [
              [0, 'back-base'],
              [1, 'back-tip'],
            ],
          );
          stops(H.s('radialGradient', { id: did, cx: 0.5, cy: 0.5, r: 0.5 }, defs), H, [
            [0, 'disc-in'],
            [0.7, 'disc-in'],
            [1, 'disc-out'],
          ]);

          // Back row: narrower petals at the slice borders, reaching a little further out. Wide slices
          // (fewer than six) get more of them, so the flower stays full with two petals or eight.
          const back = H.s('g', { class: 'ay-back', 'aria-hidden': 'true' }, root);
          for (const sl of m.slices) {
            const per = Math.max(1, Math.round(sl.step / 30));
            const bp = petal(86, 150, 197, Math.min(34, 25 + (sl.step - 45) * 0.3));
            for (let j = 0; j < per; j++) {
              const a = sl.a0 + (j * sl.step) / per;
              if (Math.abs(a - sl.mid) < 10) continue;
              H.s(
                'path',
                { d: bp, fill: `url(#${bid})`, class: 'ay-bp', transform: `rotate(${f2(a)} ${C} ${C})` },
                back,
              );
            }
          }

          const vein = veins();
          for (const sl of m.slices) {
            // The petal widens with its slice, up to a point where it still reads as a petal.
            const w = Math.min(60, 47 + (sl.step - 45) * 0.3);
            const front = petal(R.base, R.wide, R.tip, w);
            const glow = petal(R.base, R.wide + 4, R.tip + 10, w + 8);
            const room = Math.round(w * 1.55);
            const g = H.slice(root, sl, m);
            g.style.setProperty('--ux', f2(Math.sin(H.rad(sl.mid))));
            g.style.setProperty('--uy', f2(-Math.cos(H.rad(sl.mid))));
            H.s('path', { d: H.sector(R.disc, 199, sl.a0, sl.a1), class: 'ay-hit' }, g);
            const unf = H.s('g', { class: 'ay-unfurl' }, g);
            const lift = H.s('g', { class: 'ay-lift' }, unf);
            const rot = H.s('g', { transform: `rotate(${f2(sl.mid)} ${C} ${C})` }, lift);
            H.s('path', { d: glow, class: 'ay-glow' }, rot);
            H.s('path', { d: front, class: 'ay-petal', fill: `url(#${pid})` }, rot);
            H.s('path', { d: front, class: 'ay-tint' }, rot);
            H.s('path', { d: vein, class: 'ay-vein' }, rot);
            const ink = H.s('g', { class: 'ay-ink' }, lift);
            if (sl.format) {
              H.block(ink, sl, R.label, {
                size: 23,
                subSize: 12.5,
                gap: 1,
                maxWidth: room + 2,
                minSize: 9,
                cls: 'ay-lbl',
                subCls: 'ay-sub',
              });
            } else {
              H.block(ink, sl, R.label, {
                icon: true,
                iconSize: 22,
                size: 14,
                gap: 3,
                maxWidth: room,
                minSize: 9,
                cls: 'ay-lbl ay-lbl-s',
                sub: null,
              });
            }
          }

          // The seed head: florets at the rim, seeds on the golden angle, a calm middle for the text.
          const disc = H.s('g', { class: 'ay-disc', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: C, cy: C, r: R.disc, fill: `url(#${did})`, class: 'ay-head' }, disc);
          H.s('path', { d: seedPath(C, C, 3.5, 2, 49, 1.1, 1.5), class: 'ay-seeds-in' }, disc);
          H.s('path', { d: seedPath(C, C, 3.5, 49, 70, 1.5, 2.3), class: 'ay-seeds' }, disc);
          H.s('path', { d: seedPath(C, C, 3.5, 70, 78.5, 2.3, 2.5), class: 'ay-florets' }, disc);
          H.s('circle', { cx: C, cy: C, r: R.disc - 0.5, class: 'ay-rim' }, disc);

          // The hub: title, file and the key that opened the wheel (none for some wheels).
          const hub = H.s('g', { class: 'ay-hub' }, root);
          const dy = m.key ? 0 : 9;
          H.label(hub, C, C - 15 + dy, m.title, {
            maxWidth: 88,
            size: 16.5,
            minSize: 10,
            cls: 'ay-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 5.5 + dy, m.file, {
            maxWidth: 82,
            size: 11.5,
            minSize: 8.5,
            cls: 'ay-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.6;
            H.s('rect', { x: f2(C - kw / 2), y: C + 18, width: f2(kw), height: 17, rx: 8.5, class: 'ay-key' }, hub);
            H.text(hub, C, C + 26.8, m.key, { class: 'ay-keytext' });
          }

          H.s('g', { class: 'ay-fx', 'aria-hidden': 'true' }, root);
        },

        onOpen(root) {
          const wrap = root.closest('.wheel');
          if (wrap && wrap.classList.contains('has-selected')) return;
          const fx = root.querySelector('.ay-fx');
          if (fx) fx.textContent = '';
        },

        // Rays at the petal tip and ten seeds that spiral from the petal into the head. The motion
        // itself is CSS (rotate + translate interpolate into a spiral); frozen frames use --t.
        onSelect(root, m, i, H, t) {
          const fx = root.querySelector('.ay-fx');
          fx.textContent = '';
          if (t == null && reducedMotion()) return;
          const sl = m.slices[i];
          const C = H.C;
          for (let k = 0; k < 5; k++) {
            const g = H.s('g', { transform: `rotate(${f2(sl.mid + (k - 2) * 7.5)} ${C} ${C})` }, fx);
            const long = k === 2 ? 36 : k % 2 ? 28 : 21;
            H.s(
              'path',
              {
                class: 'ay-ray',
                style: `--k: ${Math.abs(k - 2)}`,
                d: `M${C - 4.5} ${C - 200}L${C} ${C - 200 - long}L${C + 4.5} ${C - 200}Z`,
              },
              g,
            );
          }
          const turn = m.dir === 'rtl' ? -1 : 1;
          for (let k = 0; k < 12; k++) {
            const a0 = sl.mid + ((k % 5) - 2) * 5;
            const a1 = a0 + turn * (220 + k * 8);
            const r0 = 104 + ((k * 23) % 70);
            const seed = H.s(
              'g',
              { class: 'ay-fly', style: `--a0: ${f2(a0)}deg; --a1: ${f2(a1)}deg; --r0: ${r0}; --d: ${30 + k * 21}ms` },
              fx,
            );
            H.s(
              'path',
              {
                class: 'ay-fly-shell',
                d: `M${C} ${C - 6}C${C + 4.2} ${C - 3} ${C + 3.6} ${C + 4} ${C} ${C + 5.5}C${C - 3.6} ${C + 4} ${C - 4.2} ${C - 3} ${C} ${C - 6}Z`,
              },
              seed,
            );
            H.s('path', { class: 'ay-fly-stripe', d: `M${C} ${C - 4.5}L${C} ${C + 4}` }, seed);
          }
        },
      },

      sounds: {
        open(ac, out, t, X) {
          // Petals unfurling: a papery rustle and a warm rising tone.
          X.burst(ac, out, t, { type: 'bandpass', f: 1800, f2: 3600, q: 0.9, dur: 0.11, gain: 0.1, a: 0.015 });
          X.burst(ac, out, t + 0.04, { type: 'bandpass', f: 2600, f2: 1400, q: 1.2, dur: 0.08, gain: 0.06, a: 0.01 });
          X.tone(ac, out, t, { type: 'triangle', f: 392, f2: 523, dur: 0.14, gain: 0.035, a: 0.02 });
        },
        tick(ac, out, t, X) {
          // A petal brushed by a fingertip.
          X.burst(ac, out, t, { type: 'bandpass', f: 4200, q: 2.5, dur: 0.014, gain: 0.08 });
          X.tone(ac, out, t, { type: 'sine', f: 1320, f2: 1480, dur: 0.02, gain: 0.025, a: 0.001 });
        },
        success(ac, out, t, X) {
          // Seeds pattering into the head, faster as they go, then a warm open chord.
          [0, 0.07, 0.125, 0.17, 0.205, 0.235, 0.26, 0.28].forEach((h, k) =>
            X.burst(ac, out, t + h, {
              type: 'bandpass',
              f: 2400 + (k % 3) * 650,
              q: 4,
              dur: 0.012,
              gain: 0.075 - k * 0.004,
            }),
          );
          for (const [f, d] of [
            [523.25, 0],
            [659.25, 0.035],
            [783.99, 0.07],
          ])
            X.tone(ac, out, t + 0.33 + d, { type: 'sine', f, dur: 0.5, gain: 0.038, a: 0.02 });
        },
      },
    });
  })();
}
