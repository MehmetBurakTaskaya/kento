// SPDX-License-Identifier: MIT
// Theme: Bauhaus. A white disc ruled by black lines, a ring of primary color segments, lowercase
// geometric type, and three primary shapes (a blue square, a red disc, a yellow triangle) resting on
// the rim in an asymmetric balance. Applying a slice slides the three shapes round the rim into a new
// composition: the triangle locks onto the chosen slice and the others balance it.
export default function register(Board) {
  (function () {
    'use strict';

    const R = { face: 160, band: 145, hub: 54, lbl: 101 };
    const f2 = (n) => Math.round(n * 100) / 100;
    // Each slice owns one primary; three repeat round the wheel so neighbors always differ.
    const HUES = ['red', 'yellow', 'blue'];
    const hue = (i, n) => HUES[(n % 3 === 1 && i === n - 1 ? 1 : i) % 3];
    // Where the three shapes rest, and where they go relative to an applied slice (degrees).
    const REST = { tri: 202, sq: 315, disc: 108 };
    const AIM = { tri: 0, sq: 142, disc: -128 };
    const lowerWord = (t, lang) => (t == null ? t : t.toLocaleLowerCase(lang));
    // Format names are Latin acronyms: plain lowercase, so ICO never becomes "ıco" in Turkish.
    const lowerFmt = (t) => t.toLowerCase();

    // Turns an orbit group to an angle the short way round; angles accumulate so a shape never spins back.
    function turn(g, goal, animate) {
      const prev = g.__angle;
      const next = prev == null ? goal : prev + ((((goal - prev) % 360) + 540) % 360) - 180;
      g.__angle = next;
      if (!animate) {
        g.style.transition = 'none';
        g.style.transform = `rotate(${f2(next)}deg)`;
        void g.getBoundingClientRect();
        g.style.transition = '';
      } else {
        g.style.transform = `rotate(${f2(next)}deg)`;
      }
      // The square turns back as it travels, so it stays square to the grid.
      const up = g.querySelector('.bh-upright');
      if (up) {
        if (!animate) up.style.transition = 'none';
        up.style.transform = `rotate(${f2(-next)}deg)`;
        if (!animate) {
          void up.getBoundingClientRect();
          up.style.transition = '';
        }
      }
    }

    Board.define({
      id: 'bauhaus',
      fonts: {
        brand: "'League Spartan'",
        load: ["'League Spartan'"],
        credits: [{ family: 'League Spartan', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 170, close: 110, stagger: 12, apply: 640 },
      palette: {
        light: {
          bg: '#f2f2f0',
          surface: '#ffffff',
          'surface-2': '#ebebe8',
          border: '#d2d2ce',
          'border-strong': '#8c8c88',
          text: '#141414',
          'text-muted': '#555552',
          accent: '#1f4fbf',
          'on-accent': '#ffffff',
          focus: '#1f4fbf',
          success: '#1d7f45',
          'on-success': '#ffffff',
          'success-text': '#18703c',
          warning: '#f6c21a',
          'warning-text': '#6e5300',
          danger: '#cf2a1f',
          desk: 'linear-gradient(#d8d8d5 1px, transparent 1px) -1px -1px / 40px 40px, linear-gradient(90deg, #d8d8d5 1px, transparent 1px) -1px -1px / 40px 40px, #e9e9e6',
          'wheel-face': '#fbfbf8',
          'wheel-slice': '#fbfbf8',
          'wheel-slice-hover': '#f6c21a',
          'wheel-slice-selected': '#141414',
          'wheel-text': '#141414',
          'wheel-text-selected': '#fbfbf8',
          'wheel-line': '#141414',
          'wheel-shadow': 'rgba(20, 20, 20, 0.18)',
          'bh-red': '#cf2a1f',
          'bh-yellow': '#f6c21a',
          'bh-blue': '#1f4fbf',
          'bh-on-red': '#ffffff',
          'bh-on-yellow': '#141414',
          'bh-on-blue': '#ffffff',
          'bh-sub': '#4a4a47',
          'bh-rule': '#141414',
          'bh-rim': '#141414',
          'bh-hub': '#141414',
          'bh-hub-text': '#fbfbf8',
          'bh-hub-muted': '#c8c8c4',
          'bh-key': '#f6c21a',
          'bh-key-text': '#141414',
          'bh-shadow': 'rgba(20, 20, 20, 0.16)',
        },
        dark: {
          bg: '#131418',
          surface: '#1c1d22',
          'surface-2': '#25262c',
          border: '#34363e',
          'border-strong': '#62656f',
          text: '#f1efe8',
          'text-muted': '#aeacA4',
          accent: '#ffd23a',
          'on-accent': '#121317',
          focus: '#ffd23a',
          success: '#4fd389',
          'on-success': '#0b2416',
          'success-text': '#6fe0a0',
          warning: '#ffd23a',
          'warning-text': '#ffdc66',
          danger: '#ff5a4a',
          desk: 'linear-gradient(#22242b 1px, transparent 1px) -1px -1px / 40px 40px, linear-gradient(90deg, #22242b 1px, transparent 1px) -1px -1px / 40px 40px, #15161b',
          'wheel-face': '#1e2027',
          'wheel-slice': '#1e2027',
          'wheel-slice-hover': '#ffd23a',
          'wheel-slice-selected': '#f1efe8',
          'wheel-text': '#f1efe8',
          'wheel-text-selected': '#121317',
          'wheel-line': '#f1efe8',
          'wheel-shadow': 'rgba(0, 0, 0, 0.5)',
          'bh-red': '#ff5a4a',
          'bh-yellow': '#ffd23a',
          'bh-blue': '#5b86ff',
          'bh-on-red': '#121317',
          'bh-on-yellow': '#121317',
          'bh-on-blue': '#121317',
          'bh-sub': '#bdbbb3',
          'bh-rule': '#5d606b',
          'bh-rim': '#f1efe8',
          'bh-hub': '#f1efe8',
          'bh-hub-text': '#121317',
          'bh-hub-muted': '#4b4d55',
          'bh-key': '#ff5a4a',
          'bh-key-text': '#121317',
          'bh-shadow': 'rgba(0, 0, 0, 0.45)',
        },
      },
      // Pointed-at slices take their own primary and a matching ink (bh-on-*), so the default
      // wheel-text / wheel-slice-hover pair is replaced by the three real pairs.
      contrast: [
        ...Board.DEFAULT_PAIRS.filter(([fg, bg]) => !(fg === 'wheel-text' && bg === 'wheel-slice-hover')),
        ['bh-on-yellow', 'wheel-slice-hover', 'text'],
        ['bh-on-red', 'bh-red', 'text'],
        ['bh-on-yellow', 'bh-yellow', 'text'],
        ['bh-on-blue', 'bh-blue', 'text'],
        ['bh-sub', 'wheel-slice', 'text'],
        ['bh-hub-text', 'bh-hub', 'text'],
        ['bh-hub-muted', 'bh-hub', 'text'],
        ['bh-key-text', 'bh-key', 'text'],
        ['bh-rim', 'wheel-face', 'ui'],
      ],
      // "More…" as the movement's three shapes.
      icons: {
        more: '<circle cx="4.6" cy="12.6" r="2.4" fill="currentColor" stroke="none"/><path d="M12 9.4l2.9 5.1H9.1z" fill="currentColor" stroke="none"/><rect x="17" y="10.3" width="4.6" height="4.6" fill="currentColor" stroke="none"/>',
      },
      defs: '',

      wheel: {
        render(root, m, H) {
          const s = H.s;
          const C = H.C;

          // A soft offset shadow, like a paper disc laid on the desk.
          s('circle', { cx: C + 5, cy: C + 7, r: R.face + 2, class: 'bh-drop' }, root);
          // The three shapes sit in turning groups; update() moves them, the open animation slides them in.
          const back = s('g', { class: 'bh-comp', 'aria-hidden': 'true' }, root);
          // Blue square behind the rim, half covered by the disc.
          const sqOrbit = s('g', { class: 'bh-orbit bh-orbit-sq' }, back);
          const sqUp = s('g', { class: 'bh-upright' }, s('g', { class: 'bh-orbit-in' }, sqOrbit));
          s('rect', { x: C - 25, y: C - R.face - 28, width: 50, height: 50, class: 'bh-sq' }, sqUp);
          turn(sqOrbit, REST.sq, false);

          s('circle', { cx: C, cy: C, r: R.face, class: 'bh-face' }, root);
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const h = hue(sl.i, m.n);
            g.classList.add('bh-' + h);
            s('path', { d: H.sector(R.hub, R.face, sl.a0, sl.a1), class: 'bh-hit' }, g);
            s('path', { d: H.sector(R.hub, R.band, sl.a0, sl.a1), class: 'bh-fill' }, g);
            s('path', { d: H.sector(R.hub, R.band, sl.a0, sl.a1), class: 'bh-selfill' }, g);
            s('path', { d: H.sector(R.band, R.face, sl.a0, sl.a1), class: 'bh-band' }, g);
            const ink = s('g', { class: 'bh-ink' }, g);
            const word = Object.assign({}, sl, {
              label: m.kind === 'convert' && sl.sub ? lowerFmt(sl.label) : lowerWord(sl.label, m.lang),
              sub: lowerWord(sl.sub, m.lang),
            });
            if (m.kind === 'convert' && sl.sub) {
              H.block(ink, word, R.lbl, {
                size: 26,
                subSize: 13.5,
                gap: 1,
                maxWidth: 76,
                minSize: 12,
                cls: 'bh-lbl bh-fmt',
                subCls: 'bh-sub',
              });
            } else {
              H.block(ink, word, R.lbl, {
                icon: true,
                iconSize: 24,
                size: 15,
                gap: 4,
                maxWidth: 76,
                minSize: 9.5,
                cls: 'bh-lbl bh-word',
                sub: null,
              });
            }
          }

          // The grid: radial rules between slices, the band's inner circle and the heavy rim.
          let rules = '';
          for (const sl of m.slices) {
            const [x0, y0] = H.polar(R.hub, sl.a0);
            const [x1, y1] = H.polar(R.face, sl.a0);
            rules += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          const grid = s('g', { class: 'bh-grid', 'aria-hidden': 'true' }, root);
          s('path', { d: rules, class: 'bh-rule' }, grid);
          s('circle', { cx: C, cy: C, r: R.band, class: 'bh-rule bh-rule-thin' }, grid);
          s('circle', { cx: C, cy: C, r: R.face, class: 'bh-rim' }, grid);

          // Red disc and yellow triangle in front of the rim.
          const front = s('g', { class: 'bh-comp bh-comp-front', 'aria-hidden': 'true' }, root);
          const orbitFront = (key) => {
            const g = s('g', { class: `bh-orbit bh-orbit-${key}` }, front);
            turn(g, REST[key], false);
            return s('g', { class: 'bh-orbit-in' }, g);
          };
          s('circle', { cx: C, cy: C - R.face - 14, r: 18, class: 'bh-disc' }, orbitFront('disc'));
          // The triangle's tip touches the band; its base stands outside the rim.
          const tip = C - R.band + 4;
          s(
            'path',
            { d: `M${C} ${tip}L${C + 24} ${tip - 44}L${C - 24} ${tip - 44}Z`, class: 'bh-tri' },
            orbitFront('tri'),
          );

          // Hub: a solid disc with the wheel's name, the file and the key on a yellow tag.
          const hub = s('g', { class: 'bh-hub' }, root);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'bh-hub-disc' }, hub);
          H.label(hub, C, C - 16, lowerWord(m.title, m.lang), {
            maxWidth: 88,
            size: 16,
            minSize: 10,
            cls: 'bh-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 3, m.file, { maxWidth: 84, size: 12, minSize: 9, cls: 'bh-file', maxLines: 1 });
          const key = lowerWord(m.key, m.lang);
          const kw = 14 + key.length * 7;
          s('rect', { x: f2(C - kw / 2), y: C + 16, width: f2(kw), height: 17, class: 'bh-key' }, hub);
          H.text(hub, C, C + 25.5, key, { class: 'bh-keytext' });
        },

        // The shapes stay put while pointing; an applied slice draws them into a new composition.
        update(root, m, st) {
          const sel = st.selected == null ? null : m.slices[st.selected];
          const was = root.__sel;
          root.__sel = sel ? sel.i : null;
          if (was === root.__sel) return;
          for (const key of Object.keys(REST)) {
            const g = root.querySelector(`.bh-orbit-${key}`);
            const goal = sel ? sel.mid + (m.dir === 'rtl' ? -AIM[key] : AIM[key]) : REST[key];
            turn(g, goal, !!sel);
          }
        },
      },

      sounds: {
        open(ac, out, t, X) {
          X.tone(ac, out, t, { f: 392, dur: 0.16, gain: 0.07, a: 0.004 });
          X.tone(ac, out, t + 0.03, { f: 587, dur: 0.14, gain: 0.05, a: 0.004 });
          X.burst(ac, out, t, { type: 'bandpass', f: 1400, q: 5, dur: 0.012, gain: 0.08 });
        },
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 1700, q: 9, dur: 0.016, gain: 0.12 });
          X.tone(ac, out, t, { f: 1180, f2: 1010, dur: 0.018, gain: 0.04, a: 0.001 });
        },
        success(ac, out, t, X) {
          // The shapes slide (a rising hiss), lock (two clicks), and the composition rings as one chord.
          X.burst(ac, out, t, { type: 'bandpass', f: 500, f2: 1700, q: 1.6, dur: 0.34, gain: 0.07, a: 0.06 });
          X.burst(ac, out, t + 0.38, { type: 'bandpass', f: 2200, q: 8, dur: 0.012, gain: 0.16 });
          X.burst(ac, out, t + 0.44, { type: 'bandpass', f: 1500, q: 8, dur: 0.014, gain: 0.13 });
          for (const [f, g] of [
            [523, 0.07],
            [659, 0.055],
            [784, 0.05],
          ])
            X.tone(ac, out, t + 0.42, { f, dur: 0.42, gain: g, a: 0.005 });
        },
      },
    });
  })();
}
