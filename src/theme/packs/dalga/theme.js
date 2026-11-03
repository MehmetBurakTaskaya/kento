// SPDX-License-Identifier: MIT
// Theme: Dalga (wave). A round woodblock-style sea: carved wave lines in indigo, and a ring of
// curling crests with foam claws that turns the wheel's edge into a pinwheel of waves. Applying a
// slice swells its crest, breaks foam over the slice and throws spray.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    // Radii: hub, water inner edge, rim where the crests stand, label line.
    const R = { hub: 62, in: 64, rim: 170, label: 121 };

    const reducedMotion = () =>
      document.documentElement.classList.contains('reduce-motion') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A point at radius r and angle u (degrees) in a slice drawn upright (its middle at twelve o'clock).
    const L = (r, u, cx = 200, cy = 200) => `${f2(cx + r * Math.sin(rad(u)))} ${f2(cy - r * Math.cos(rad(u)))}`;

    // One crest, upright: it rises from the rim at its start, curls over at its end and hooks down
    // just past it. `h` is half its span in degrees (drawn for 22.5: a longer crest stretches its rise
    // and keeps the curl the same size), `amp` its height, `k` mirrors it for right-to-left.
    function crest(k = 1, h = 22.5, amp = 1, cx = 200, cy = 200) {
      const shift = h - 22.5;
      const along = (u) => (u <= -1 ? -h + ((u + 22.5) * (2 * h - 23.5)) / 21.5 : u + shift);
      const p = (r, u) => L(R.rim + (r - R.rim) * amp, along(u) * k, cx, cy);
      const body =
        `M${p(R.rim, -22.5)}` +
        `C${p(173, -10)} ${p(191, -1)} ${p(197, 9)}` +
        `C${p(199.5, 15)} ${p(196, 22)} ${p(187.5, 23.6)}` +
        `Q${p(183.5, 21.2)} ${p(185.5, 17.8)}` +
        `C${p(181, 14)} ${p(176, 17)} ${p(R.rim, 22.5)}` +
        `A${R.rim} ${R.rim} 0 0 ${k > 0 ? 0 : 1} ${p(R.rim, -22.5)}Z`;
      const lip = `M${p(187, -3)}Q${p(194.5, 3.5)} ${p(197, 9)}C${p(199.5, 15)} ${p(196, 22)} ${p(187.5, 23.6)}Q${p(183.5, 21.2)} ${p(185.5, 17.8)}`;
      const grooves = `M${p(172.5, -15)}Q${p(183, -3)} ${p(190.5, 8.5)}M${p(171.5, -5)}Q${p(178.5, 4.5)} ${p(183.5, 12.5)}`;
      // Foam claws hanging forward off the lip.
      let claws = '';
      for (const [r, u, s] of [
        [198.4, 11.5, 1],
        [198, 16, 1.1],
        [194.6, 20.6, 1],
      ]) {
        claws += `M${p(r - 1.2, u - 1.6)}Q${p(r + 3.4 * s, u + 1.2)} ${p(r - 1.6 * s, u + 3.6 * s)}Q${p(r - 0.6, u + 1.4)} ${p(r - 2.6, u + 0.4)}Z`;
      }
      return { body, lip, grooves, claws };
    }

    // A slice's crests: one for a slice of about 45 degrees, more for a wider one, so the rim stays a
    // ring of breaking waves with any number of slices. The crest at the slice's end (in reading
    // order) is the full one; the others are smaller swells.
    function crestsOf(sl, k) {
      const per = Math.max(1, Math.floor(sl.step / 40));
      const span = sl.step / per;
      return Array.from({ length: per }, (_, j) => ({
        at: sl.a0 + (j + 0.5) * span,
        h: span / 2,
        big: k > 0 ? j === per - 1 : j === 0,
      }));
    }

    // Carved wave lines across a slice: rows of humps, each row cut twice, like grooves in a block.
    // The humps keep their width in a wider slice.
    function grooves(sl, rows) {
      let d = '';
      for (const [rb, base, amp] of rows) {
        const humps = Math.max(1, Math.round((base * sl.step) / 45));
        for (const off of [0, 4.2]) {
          let line = '';
          const n = 36;
          for (let j = 0; j <= n; j++) {
            const f = j / n;
            const a = sl.a0 + 1.5 + f * (sl.a1 - sl.a0 - 3);
            const r = rb - off + amp * Math.abs(Math.sin(Math.PI * humps * f));
            line += `${j ? 'L' : 'M'}${f2(200 + r * Math.sin(rad(a)))} ${f2(200 - r * Math.cos(rad(a)))}`;
          }
          d += line;
        }
      }
      return d;
    }

    Board.define({
      id: 'dalga',
      fonts: {
        brand: "'Alegreya Variable'",
        display: "'Alegreya Variable'",
        load: ["'Alegreya Variable'"],
        credits: [{ family: 'Alegreya', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 190, close: 120, stagger: 12, apply: 680 },

      palette: {
        light: {
          bg: '#eef1f2',
          surface: '#ffffff',
          'surface-2': '#e8edf0',
          border: '#d0d9e0',
          'border-strong': '#9aabbd',
          text: '#14213f',
          'text-muted': '#4b5872',
          accent: '#23468a',
          'on-accent': '#ffffff',
          focus: '#23468a',
          success: '#2a7a5e',
          'on-success': '#ffffff',
          'success-text': '#226a51',
          warning: '#b8770b',
          'warning-text': '#7a4e00',
          danger: '#c0362c',
          desk: 'repeating-linear-gradient(0deg, rgba(40, 50, 70, 0.018) 0 1px, transparent 1px 4px), linear-gradient(175deg, #e9eef0 0%, #e2e8ea 60%, #d8e1e6 100%)',
          'wheel-face': '#2a4a85',
          'wheel-slice': '#2a4a85',
          'wheel-slice-hover': '#36599b',
          'wheel-slice-selected': '#f4f0e4',
          'wheel-text': '#f7f3e8',
          'wheel-text-selected': '#18295a',
          'wheel-sub': '#dce6f7',
          'wheel-line': '#1a3266',
          'wheel-shadow': 'rgba(20, 40, 80, 0.35)',
          'water-in': '#3a61a2',
          'water-out': '#1f3a72',
          groove: '#5f86c4',
          'groove-sel': '#9fb7dc',
          crest: '#1a3266',
          'crest-line': '#4f78bb',
          foam: '#f7f3e8',
          'foam-edge': '#5e80bb',
          spray: '#ffffff',
          'hub-fill': '#f4f1e6',
          'hub-ring': '#1a3266',
          'hub-accent': '#d8553a',
          'hub-glow': 'rgba(244, 241, 230, 0)',
          'hub-text': '#18295a',
          'hub-muted': '#47557a',
          'key-bg': '#ffffff',
          'key-line': '#7f93b8',
        },
        dark: {
          bg: '#081226',
          surface: '#0e1a33',
          'surface-2': '#14223f',
          border: '#213459',
          'border-strong': '#3c5486',
          text: '#e9efff',
          'text-muted': '#a6b4d4',
          accent: '#a9c3ff',
          'on-accent': '#0b1630',
          focus: '#a9c3ff',
          success: '#5fd3a6',
          'on-success': '#05261a',
          'success-text': '#72dcb4',
          warning: '#f2c25b',
          'warning-text': '#f5cd73',
          danger: '#ff7b74',
          desk: 'radial-gradient(45% 35% at 50% 6%, rgba(240, 230, 200, 0.14), transparent 70%), linear-gradient(180deg, #0c1834 0%, #081229 60%, #050b1c 100%)',
          'wheel-face': '#152650',
          'wheel-slice': '#162a56',
          'wheel-slice-hover': '#26427e',
          'wheel-slice-selected': '#dfe8ff',
          'wheel-text': '#e9efff',
          'wheel-text-selected': '#0d1a3a',
          'wheel-sub': '#aebfe3',
          'wheel-line': '#091331',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'water-in': '#1e3263',
          'water-out': '#0d1a3a',
          groove: '#33549a',
          'groove-sel': '#9db3e0',
          crest: '#1f3870',
          'crest-line': '#4a70ba',
          foam: '#dfe8ff',
          'foam-edge': '#8ea6d6',
          spray: '#f3f6ff',
          'hub-fill': '#f0e7c6',
          'hub-ring': '#d9cb9c',
          'hub-accent': '#c9b98a',
          'hub-glow': 'rgba(240, 231, 198, 0.22)',
          'hub-text': '#13224a',
          'hub-muted': '#3f4a66',
          'key-bg': '#fbf6e6',
          'key-line': '#a99a6a',
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
        ['wheel-text', 'water-in', 'text'],
        ['wheel-sub', 'wheel-slice', 'text'],
        ['wheel-sub', 'wheel-slice-hover', 'text'],
        ['wheel-sub', 'water-in', 'text'],
        ['hub-text', 'hub-fill', 'text'],
        ['hub-muted', 'hub-fill', 'text'],
        ['foam', 'crest', 'ui'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const k = m.dir === 'rtl' ? -1 : 1;
          const defs = H.s('defs', {}, root);
          const wid = H.uid('dalga-w');
          const rg = H.s('radialGradient', { id: wid, gradientUnits: 'userSpaceOnUse', cx: C, cy: C, r: R.rim }, defs);
          H.s('stop', { offset: 0.3, style: 'stop-color: var(--water-in)' }, rg);
          H.s('stop', { offset: 1, style: 'stop-color: var(--water-out)' }, rg);

          H.s(
            'circle',
            { cx: C, cy: C, r: R.rim + 1, fill: `url(#${wid})`, class: 'dl-sea', 'aria-hidden': 'true' },
            root,
          );
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.hub, 199, sl.a0, sl.a1), class: 'dl-hit' }, g);
            H.s('path', { d: H.sector(R.in, R.rim, sl.a0, sl.a1), class: 'dl-water' }, g);
            H.s(
              'path',
              {
                d: H.sector(R.in, R.rim + 0.5, sl.a0, sl.a1),
                class: 'dl-foam',
                style: `transform-origin: ${L(R.rim, sl.mid).replace(' ', 'px ')}px`,
              },
              g,
            );
            H.s(
              'path',
              {
                d: grooves(sl, [
                  [86, 2, 5],
                  [152, 3, 6],
                  [163, 4, 4],
                ]),
                class: 'dl-grooves',
              },
              g,
            );
            // The crests, drawn upright and turned into place; each grows from the rim at its middle.
            for (const w of crestsOf(sl, k)) {
              const c = crest(k, w.h, w.big ? 1 : 0.74);
              const cg = H.s(
                'g',
                { class: 'dl-crest', style: `transform-origin: ${L(R.rim, w.at).replace(' ', 'px ')}px` },
                g,
              );
              const rot = H.s('g', { transform: `rotate(${f2(w.at)} ${C} ${C})` }, cg);
              H.s('path', { d: c.body, class: 'dl-crest-body' }, rot);
              H.s('path', { d: c.grooves, class: 'dl-crest-grooves' }, rot);
              H.s('path', { d: c.lip, class: 'dl-lip' }, rot);
              H.s('path', { d: c.claws, class: 'dl-claws' }, rot);
            }
            const ink = H.s('g', { class: 'dl-ink' }, g);
            // A wider slice (fewer slices) gives a long label more room.
            const chord = 2 * R.label * Math.sin(rad(Math.min(sl.step, 180) / 2));
            const room = Math.round(Math.max(74, Math.min(100, chord * 0.66)));
            if (sl.format) {
              H.block(ink, sl, R.label, {
                size: 22,
                subSize: 12.5,
                gap: 0.5,
                maxWidth: room,
                minSize: 9,
                cls: 'dl-lbl',
                subCls: 'dl-sub',
              });
            } else {
              H.block(ink, sl, R.label, {
                icon: true,
                iconSize: 21,
                size: 14,
                gap: 3,
                maxWidth: room - 2,
                minSize: 9,
                cls: 'dl-lbl dl-lbl-s',
                sub: null,
              });
            }
          }

          // Hub: a paper sky with a carved ring (a full moon in the dark palette).
          const hub = H.s('g', { class: 'dl-hub' }, root);
          H.s('circle', { cx: C, cy: C, r: R.hub + 9, class: 'dl-halo' }, hub);
          H.s('circle', { cx: C, cy: C, r: R.hub, class: 'dl-disc' }, hub);
          H.s('circle', { cx: C, cy: C, r: R.hub - 5, class: 'dl-ring' }, hub);
          const dy = m.key ? 0 : 9;
          H.label(hub, C, C - 14 + dy, m.title, {
            maxWidth: 90,
            size: 17,
            minSize: 10,
            cls: 'dl-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 5.5 + dy, m.file, {
            maxWidth: 84,
            size: 11.5,
            minSize: 8.5,
            cls: 'dl-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.6;
            H.s('rect', { x: f2(C - kw / 2), y: C + 17, width: f2(kw), height: 17, rx: 2, class: 'dl-key' }, hub);
            H.text(hub, C, C + 26.4, m.key, { class: 'dl-keytext' });
          }

          H.s('g', { class: 'dl-fx', 'aria-hidden': 'true' }, root);
        },

        onOpen(root) {
          const wrap = root.closest('.wheel');
          if (wrap && wrap.classList.contains('has-selected')) return;
          const fx = root.querySelector('.dl-fx');
          if (fx) fx.textContent = '';
        },

        // Spray: droplets and a few foam claws thrown off the crest, past the rim.
        onSelect(root, m, i, H, t) {
          const fx = root.querySelector('.dl-fx');
          fx.textContent = '';
          if (t == null && reducedMotion()) return;
          const sl = m.slices[i];
          const k = m.dir === 'rtl' ? -1 : 1;
          // The spray flies off the slice's full crest, around its curl.
          const big = crestsOf(sl, k).find((w) => w.big);
          const curl = big.at + k * (big.h - 22.5);
          let seed = 41 + i * 7;
          const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
          for (let j = 0; j < 22; j++) {
            const u = curl + k * (-10 + rnd() * 38);
            const r0 = 188 + rnd() * 10;
            const [x, y] = L(r0, u).split(' ').map(Number);
            const out = 20 + rnd() * 38;
            const dx = Math.sin(rad(u + k * 18)) * out;
            const dy = -Math.cos(rad(u + k * 18)) * out;
            const s = 1.8 + rnd() * 3;
            const claw = j % 5 === 0;
            const d = claw
              ? `M${f2(x - s)} ${f2(y)}q${f2(s * 1.6)} ${f2(-s * 1.8)} ${f2(s * 2.6)} ${f2(-s * 0.4)}q${f2(-s)} ${f2(-s * 0.2)} ${f2(-s * 1.2)} ${f2(s * 1.1)}z`
              : `M${f2(x - s)} ${f2(y)}a${f2(s)} ${f2(s)} 0 1 0 ${f2(2 * s)} 0a${f2(s)} ${f2(s)} 0 1 0 ${f2(-2 * s)} 0`;
            H.s(
              'path',
              {
                d,
                class: 'dl-spray',
                style: `--dx: ${f2(dx)}px; --dy: ${f2(dy)}px; --d: ${Math.round(180 + rnd() * 120)}ms; transform-origin: ${f2(x)}px ${f2(y)}px`,
              },
              fx,
            );
          }
        },
      },

      sounds: {
        open(ac, out, t, X) {
          // A slow swell of water.
          X.burst(ac, out, t, { type: 'lowpass', f: 260, f2: 1300, q: 0.8, dur: 0.2, gain: 0.1, a: 0.06 });
          X.tone(ac, out, t, { type: 'sine', f: 110, f2: 92, dur: 0.18, gain: 0.03, a: 0.05 });
        },
        tick(ac, out, t, X) {
          // A small water plip.
          X.tone(ac, out, t, { type: 'sine', f: 880, f2: 1500, dur: 0.022, gain: 0.045, a: 0.001 });
          X.burst(ac, out, t, { type: 'highpass', f: 5000, q: 0.7, dur: 0.006, gain: 0.02 });
        },
        success(ac, out, t, X) {
          // The wash rises, breaks into a crash, and the foam fizzes away.
          X.burst(ac, out, t, { type: 'bandpass', f: 500, f2: 2400, q: 0.7, dur: 0.13, gain: 0.08, a: 0.05 });
          X.burst(ac, out, t + 0.12, { type: 'lowpass', f: 4200, f2: 450, q: 0.6, dur: 0.5, gain: 0.11, a: 0.008 });
          X.tone(ac, out, t + 0.12, { type: 'sine', f: 85, f2: 48, dur: 0.16, gain: 0.07, a: 0.004 });
          X.burst(ac, out, t + 0.18, { type: 'highpass', f: 6200, q: 0.6, dur: 0.36, gain: 0.025, a: 0.02 });
        },
      },
    });
  })();
}
