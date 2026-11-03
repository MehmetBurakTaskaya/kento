// SPDX-License-Identifier: MIT
// Retro technology: Radyo kadranı. The round tuning dial of an old valve radio: a ring of glass printed with
// station names and a medium-wave scale, a red pointer moving behind the glass and a speaker-cloth hub with a
// small brass plate. Applying a slice tunes in: the pointer hunts through
// the static, snaps to the station, and the station's window lights up warm while the signal comes in.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const R = { cab: 198, trim: 185.5, glass: 184, scaleIn: 157, scaleOut: 181, hub: 62, lbl: 111, tip: 180 };
    const APPLY = 650;
    // Medium-wave figures (kHz / 10) printed at the slice centers, as on old dials.
    const BAND = ['54', '60', '70', '80', '100', '120', '140', '160'];
    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    const pol = (r, a) => [C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))];
    // The pointer rests on the boundary before the first slice, so at rest it never seems to choose.
    const restAngle = (m) => ((m.dir === 'rtl' ? 1 : -1) * m.step) / 2;

    function render(root, m, H) {
      const u = H.uid('radyo');
      const defs = H.s('defs', {}, root);
      defs.innerHTML = `
      <linearGradient id="${u}-shell" gradientUnits="userSpaceOnUse" x1="40" y1="10" x2="360" y2="390">
        <stop offset="0" style="stop-color:var(--ry-shell-hi)"/><stop offset=".55" style="stop-color:var(--ry-shell)"/><stop offset="1" style="stop-color:var(--ry-shell-lo)"/></linearGradient>
      <linearGradient id="${u}-chrome" gradientUnits="userSpaceOnUse" x1="70" y1="40" x2="330" y2="360">
        <stop offset="0" style="stop-color:var(--ry-chrome-hi)"/><stop offset=".5" style="stop-color:var(--ry-chrome)"/><stop offset="1" style="stop-color:var(--ry-chrome-lo)"/></linearGradient>
      <radialGradient id="${u}-glass" gradientUnits="userSpaceOnUse" cx="200" cy="200" r="184">
        <stop offset=".3" style="stop-color:var(--ry-glass-in)"/><stop offset=".85" style="stop-color:var(--wheel-face)"/><stop offset="1" style="stop-color:var(--ry-glass-out)"/></radialGradient>
      <radialGradient id="${u}-lamp" gradientUnits="userSpaceOnUse" cx="200" cy="200" r="184">
        <stop offset=".3" style="stop-color:var(--ry-lamp)" stop-opacity="0"/><stop offset=".62" style="stop-color:var(--ry-lamp)" stop-opacity=".9"/><stop offset="1" style="stop-color:var(--ry-lamp)" stop-opacity="0"/></radialGradient>
      <radialGradient id="${u}-lit" gradientUnits="userSpaceOnUse" cx="200" cy="200" r="160">
        <stop offset=".38" style="stop-color:var(--ry-lit-in)"/><stop offset=".72" style="stop-color:var(--wheel-slice-selected)"/><stop offset="1" style="stop-color:var(--ry-lit-out)"/></radialGradient>
      <pattern id="${u}-cloth" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45 200 200)">
        <rect width="4" height="4" style="fill:var(--ry-cloth)"/>
        <path d="M0 1H4M0 3H4" style="stroke:var(--ry-cloth-a)" stroke-width="1.1"/>
        <path d="M1 0V4M3 0V4" style="stroke:var(--ry-cloth-b)" stroke-width="0.9"/></pattern>
      <linearGradient id="${u}-brass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--ry-plate-hi)"/><stop offset="1" style="stop-color:var(--ry-plate)"/></linearGradient>`;

      // Bakelite cabinet ring with a few highlight lines, and the chrome trim round the glass.
      const cab = H.s('g', { class: 'ry-cab' }, root);
      H.s('circle', { cx: C, cy: C, r: R.cab, fill: `url(#${u}-shell)` }, cab);
      let sheen = '';
      [
        [189.5, 200, 330],
        [191.8, 20, 120],
        [193.6, 140, 250],
        [190.6, 262, 352],
        [195.4, 300, 30],
      ].forEach(([r, a0, a1]) => {
        sheen += H.arc(r, a0, a1 < a0 ? a1 + 360 : a1);
      });
      H.s('path', { d: sheen, class: 'ry-sheen' }, cab);
      H.s('circle', { cx: C, cy: C, r: R.cab - 0.6, class: 'ry-cab-edge' }, cab);
      H.s('circle', { cx: C, cy: C, r: R.trim, class: 'ry-trim', stroke: `url(#${u}-chrome)` }, cab);

      // Glass, lit from behind; the lamp layer is what flickers in the static.
      H.s('circle', { cx: C, cy: C, r: R.glass, fill: `url(#${u}-glass)`, class: 'ry-glass' }, root);
      H.s('circle', { cx: C, cy: C, r: R.glass, fill: `url(#${u}-lamp)`, class: 'ry-lamp' }, root);

      // Slices: hit wedge and the station's window, lit when tuned.
      const wins = H.s('g', { class: 'ry-wins' }, root);
      for (const sl of m.slices) {
        const g = H.slice(wins, sl, m);
        H.s('path', { d: H.sector(R.hub + 2, R.cab, sl.a0, sl.a1), class: 'ry-hit' }, g);
        H.s('path', { d: H.sector(R.hub + 5, R.scaleIn - 2, sl.a0 + 1.2, sl.a1 - 1.2, 0), class: 'ry-win' }, g);
        H.s(
          'path',
          {
            d: H.sector(R.hub + 5, R.scaleIn - 2, sl.a0 + 1.2, sl.a1 - 1.2, 0),
            fill: `url(#${u}-lit)`,
            class: 'ry-win-lit',
          },
          g,
        );
      }

      // The pointer, behind the printed glass: update() turns the outer group, the apply effect makes the
      // inner one hunt; the signal arcs at its tip show while a station is tuned.
      const needle = H.s('g', { class: 'ry-needle' }, root);
      const hunt = H.s('g', { class: 'ry-hunt' }, needle);
      H.s('path', { d: `M${C} ${C - R.hub + 2}V${C - R.tip}`, class: 'ry-n-edge' }, hunt);
      H.s('path', { d: `M${C} ${C - R.hub + 2}V${C - R.tip}`, class: 'ry-n' }, hunt);
      H.s('circle', { cx: C, cy: C - R.tip + 3, r: 3.6, class: 'ry-bead' }, hunt);
      const sig = H.s('g', { class: 'ry-signal' }, hunt);
      for (let k = 0; k < 3; k++)
        H.s(
          'path',
          { d: H.arc(R.tip + 6 + k * 4.6, -(2.6 + k * 1.3), 2.6 + k * 1.3), class: `ry-wave ry-wave-${k}` },
          sig,
        );

      // The print on the glass: rules, the scale, its figures and the station names.
      const print = H.s('g', { class: 'ry-print' }, root);
      H.s('circle', { cx: C, cy: C, r: R.scaleIn, class: 'ry-rule' }, print);
      H.s('circle', { cx: C, cy: C, r: R.scaleOut, class: 'ry-rule ry-rule-thin' }, print);
      let ticks = '';
      const per = 10;
      for (let k = 0; k < m.n * per; k++) {
        const a = k * (m.step / per) + m.slices[0].a0;
        const major = k % per === per / 2;
        const len = major ? 7 : k % 5 === 0 ? 4.5 : 2.6;
        const [x0, y0] = pol(R.scaleIn + 0.5, a);
        const [x1, y1] = pol(R.scaleIn + 0.5 + len, a);
        ticks += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
      }
      H.s('path', { d: ticks, class: 'ry-ticks' }, print);
      const labels = H.s('g', { class: 'ry-names' }, print);
      m.slices.forEach((sl, k) => {
        // Figures sit a quarter slice after the station mark, where the pointer never rests.
        const [x, y] = pol(172.5, sl.mid + (m.dir === 'rtl' ? -1 : 1) * (m.step / 4));
        H.text(print, f2(x), f2(y), BAND[k % BAND.length], { class: 'ry-fig' });
        const lg = H.s('g', { class: 'ry-name' + (sl.off ? ' is-off' : ''), 'data-for': sl.i }, labels);
        lg.style.setProperty('--i', sl.i);
        if (m.kind === 'convert' && sl.sub) {
          H.block(lg, sl, R.lbl, {
            size: 21,
            subSize: 13,
            gap: 1.5,
            maxWidth: 70,
            minSize: 9,
            cls: 'ry-lbl ry-fmt',
            subCls: 'ry-sub',
          });
        } else {
          H.block(lg, sl, R.lbl, {
            icon: true,
            iconSize: 20,
            size: 13.5,
            gap: 3,
            maxWidth: 72,
            minSize: 8.5,
            cls: 'ry-lbl',
            sub: null,
          });
        }
      });
      // A small band legend under twelve o'clock's figure.
      const [bx, by] = pol(R.scaleIn + 13, (m.dir === 'rtl' ? 1 : -1) * (m.step / 4));
      H.text(print, f2(bx), f2(by), 'kHz', { class: 'ry-band' });

      // Hub: speaker cloth, a brass plate with the wheel's name and the file, the key below it.
      const hub = H.s('g', { class: 'ry-hub' }, root);
      H.s('circle', { cx: C, cy: C, r: R.hub, fill: `url(#${u}-cloth)`, class: 'ry-cloth' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.hub - 0.8, class: 'ry-cloth-edge' }, hub);
      H.s(
        'rect',
        { x: C - 47, y: C - 30, width: 94, height: 40, rx: 6, fill: `url(#${u}-brass)`, class: 'ry-plate' },
        hub,
      );
      H.s('rect', { x: C - 43.5, y: C - 26.5, width: 87, height: 33, rx: 4, class: 'ry-plate-line' }, hub);
      H.label(hub, C, C - 16.5, m.title, { maxWidth: 80, size: 15, minSize: 9.5, cls: 'ry-title', maxLines: 1 });
      H.label(hub, C, C - 1, m.file, {
        maxWidth: 80,
        size: 10.5,
        minSize: 8,
        cls: 'ry-file',
        maxLines: 1,
        attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
      });
      const kt = H.text(hub, C, C + 27.6, m.key, { class: 'ry-keytext' });
      const kw = kt.getComputedTextLength() + 13;
      hub.insertBefore(
        H.s('rect', { x: f2(C - kw / 2), y: C + 20, width: f2(kw), height: 15, rx: 7.5, class: 'ry-key' }),
        kt,
      );

      // Light on the glass.
      H.s('path', { d: H.arc(176, 292, 336), class: 'ry-glint' }, root);
    }

    // The pointer follows the cursor the short way round, and the names mirror the slices' states.
    function update(root, m, st) {
      root.querySelectorAll('.ry-name').forEach((g) => {
        const i = +g.dataset.for;
        g.classList.toggle('is-hover', i === st.hover);
        g.classList.toggle('is-selected', i === st.selected);
      });
      const target = st.hover ?? st.selected;
      const goal = target == null ? restAngle(m) : m.slices[target].mid;
      const nd = root.querySelector('.ry-needle');
      const prev = nd.__a;
      const next = prev == null ? goal : prev + ((((goal - prev) % 360) + 540) % 360) - 180;
      nd.__a = next;
      if (prev == null) {
        nd.style.transition = 'none';
        nd.style.transform = `rotate(${f2(next)}deg)`;
        void nd.getBoundingClientRect();
        nd.style.transition = '';
      } else {
        nd.style.transform = `rotate(${f2(next)}deg)`;
      }
      root.classList.toggle('ry-tuned', st.selected != null);
    }

    // Every voice goes through a gate that stays shut until its start time. A new gain node starts at 1, so
    // without it a voice can click for one sample when its start falls exactly on a sample boundary.
    function gate(ac, out, t) {
      const g = ac.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(1, t);
      g.connect(out);
      return g;
    }
    const gatedSounds = (sounds) =>
      Object.fromEntries(
        Object.entries(sounds).map(([k, fn]) => [
          k,
          (ac, out, t, X) =>
            fn(
              ac,
              out,
              t,
              Object.assign({}, X, {
                tone: (a, o, at, opt) => X.tone(a, gate(a, o, at), at, opt),
                burst: (a, o, at, opt) => X.burst(a, gate(a, o, at), at, opt),
              }),
            ),
        ]),
      );

    Board.define({
      id: 'radyo',
      fonts: {
        brand: "'Josefin Sans'",
        display: "'Marcellus'",
        load: ["'Marcellus'", "'Josefin Sans'"],
        credits: [
          { family: 'Marcellus', license: 'SIL Open Font License 1.1' },
          { family: 'Josefin Sans', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 190, close: 120, stagger: 10, apply: APPLY },

      palette: {
        light: {
          bg: '#f4f1ea',
          surface: '#fffdf8',
          'surface-2': '#f4efe5',
          border: '#e0d8c8',
          'border-strong': '#ad9f86',
          text: '#1c2740',
          'text-muted': '#535b6b',
          accent: '#c4202f',
          'on-accent': '#ffffff',
          focus: '#1f3a6e',
          success: '#2b7a4b',
          'on-success': '#ffffff',
          'success-text': '#236a40',
          warning: '#b7791f',
          'warning-text': '#7a4f0f',
          danger: '#c4202f',
          desk: 'linear-gradient(160deg, #f7f3ec 0%, #eef0ee 50%, #e2e9ea 100%)',
          'wheel-face': '#faf4e4',
          'wheel-slice': '#faf4e4',
          'wheel-slice-hover': '#fcebb0',
          'wheel-slice-selected': '#ffcf5c',
          'wheel-text': '#1f2f4f',
          'wheel-text-selected': '#241a05',
          'wheel-line': '#1f2f4f',
          'wheel-shadow': 'rgba(50, 60, 70, 0.3)',
          'ry-sub': '#3d4a63',
          'ry-glass-in': '#fffdf6',
          'ry-glass-out': '#ecdfc0',
          'ry-lamp': '#fff7de',
          'ry-lit-in': '#fff1b8',
          'ry-lit-out': '#f7b93c',
          'ry-print': '#1f2f4f',
          'ry-shell': '#a9d3d6',
          'ry-shell-hi': '#dff1f1',
          'ry-shell-lo': '#79abb0',
          'ry-sheen': 'rgba(255, 255, 255, 0.3)',
          'ry-cab-edge': '#5f8f94',
          'ry-chrome-hi': '#ffffff',
          'ry-chrome': '#cfd5da',
          'ry-chrome-lo': '#7d878f',
          'ry-needle': '#c4202f',
          'ry-needle-edge': '#7a1019',
          'ry-bead': '#ff5a4a',
          'ry-wave': '#c4202f',
          'ry-cloth': '#d3dcde',
          'ry-cloth-a': '#b9c6c9',
          'ry-cloth-b': '#e8eeef',
          'ry-plate': '#d6b061',
          'ry-plate-hi': '#f3dc9c',
          'ry-plate-ink': '#2b1f07',
          'ry-plate-edge': '#9a7a34',
          'ry-key': '#faf4e4',
          'ry-glint-opacity': '0.7',
          'ry-lamp-opacity': '0.35',
        },
        dark: {
          bg: '#0e1416',
          surface: '#151d20',
          'surface-2': '#1b2529',
          border: '#28363b',
          'border-strong': '#44565d',
          text: '#f3ead6',
          'text-muted': '#adb3ae',
          accent: '#ffb84d',
          'on-accent': '#221402',
          focus: '#ffc970',
          success: '#5cc58e',
          'on-success': '#07200f',
          'success-text': '#6fd39f',
          warning: '#ffb84d',
          'warning-text': '#ffc970',
          danger: '#ff6b5b',
          desk: 'radial-gradient(circle at 30% 18%, #22302f 0%, #131b1d 55%, #0b1012 100%)',
          'wheel-face': '#123036',
          'wheel-slice': '#123036',
          'wheel-slice-hover': '#2c3c2c',
          'wheel-slice-selected': '#ffc45a',
          'wheel-text': '#f6e7c4',
          'wheel-text-selected': '#1f1404',
          'wheel-line': '#f6e7c4',
          'wheel-shadow': 'rgba(0, 0, 0, 0.66)',
          'ry-sub': '#d6c49e',
          'ry-glass-in': '#1d4249',
          'ry-glass-out': '#08181c',
          'ry-lamp': '#ffb84d',
          'ry-lit-in': '#ffe7a8',
          'ry-lit-out': '#f39a2c',
          'ry-print': '#f6e7c4',
          'ry-shell': '#1f3c3c',
          'ry-shell-hi': '#41696a',
          'ry-shell-lo': '#0b1b1c',
          'ry-sheen': 'rgba(255, 255, 255, 0.05)',
          'ry-cab-edge': '#071112',
          'ry-chrome-hi': '#e9eef1',
          'ry-chrome': '#8f989f',
          'ry-chrome-lo': '#3e464c',
          'ry-needle': '#ff5a3c',
          'ry-needle-edge': '#8a1d0e',
          'ry-bead': '#ffd27a',
          'ry-wave': '#ffc45a',
          'ry-cloth': '#2f3a35',
          'ry-cloth-a': '#26302c',
          'ry-cloth-b': '#3a4741',
          'ry-plate': '#c9a14f',
          'ry-plate-hi': '#ecd08a',
          'ry-plate-ink': '#241904',
          'ry-plate-edge': '#7e6127',
          'ry-key': '#1a2a2b',
          'ry-glint-opacity': '0.22',
          'ry-lamp-opacity': '0.16',
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
        ['ry-sub', 'wheel-slice', 'text'],
        ['ry-sub', 'wheel-slice-hover', 'text'],
        ['ry-plate-ink', 'ry-plate', 'text'],
      ],

      // No shared defs: every gradient and pattern is made per wheel in render(), because its colors come
      // from the palette tokens of the wheel's own light or dark figure.
      defs: '',
      wheel: { render, update },

      sounds: gatedSounds({
        open(ac, out, t, X) {
          // The power switch, a short warm-up hum and a breath of static.
          X.burst(ac, out, t, { type: 'bandpass', f: 1800, q: 2.5, dur: 0.02, gain: 0.13 });
          X.tone(ac, out, t + 0.01, { type: 'sine', f: 100, dur: 0.16, gain: 0.035, a: 0.03 });
          X.burst(ac, out, t + 0.03, { type: 'bandpass', f: 3200, q: 0.8, dur: 0.14, gain: 0.014, a: 0.04 });
        },
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 2200, q: 2.2, dur: 0.012, gain: 0.2 });
          X.burst(ac, out, t + 0.004, { type: 'bandpass', f: 5200, q: 1, dur: 0.02, gain: 0.025 });
        },
        success(ac, out, t, X) {
          // Static while the pointer hunts, then the station: a calm fifth.
          X.burst(ac, out, t, { type: 'bandpass', f: 1300, f2: 3600, q: 1.3, dur: 0.15, gain: 0.04, a: 0.01 });
          X.burst(ac, out, t + 0.14, { type: 'bandpass', f: 3600, f2: 900, q: 1.6, dur: 0.14, gain: 0.032 });
          X.tone(ac, out, t + 0.27, { f: 659.3, dur: 0.55, gain: 0.05, a: 0.03 });
          X.tone(ac, out, t + 0.33, { f: 987.8, dur: 0.48, gain: 0.03, a: 0.03 });
          X.tone(ac, out, t + 0.27, { type: 'triangle', f: 329.6, dur: 0.4, gain: 0.015, a: 0.04 });
        },
      }),
    });
  })();
}
