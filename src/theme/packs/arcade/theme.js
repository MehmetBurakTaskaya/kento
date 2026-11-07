// SPDX-License-Identifier: MIT
// Retro technology: Arcade neon. At night the wheel is a sign of neon tubes on a black cabinet: every slice
// framed by its own tube in pink, cyan, yellow or orange, a ring of marquee bulbs round it and a glowing
// start button as the hub. By day the same shapes are cabinet side art: flat bold colors with black outlines
// on sunburst rays. Applying a slice floods it with its color, a score pops out of a starburst with pixel
// sparks, and the marquee lights chase once round the rim.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const R = { rim: 198, bulbs: 191, face: 183, tubeIn: 70, tubeOut: 172, lbl: 121, hub: 57 };
    const APPLY = 680;
    const BULBS = 28;
    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    const pol = (r, a) => [C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))];

    // A starburst of n points round (0, 0).
    function burst(n, r0, r1) {
      let d = '';
      for (let k = 0; k < n * 2; k++) {
        const a = (k * Math.PI) / n;
        const r = k % 2 ? r0 : r1 * (k % 4 === 0 ? 1 : 0.86);
        d += (k ? 'L' : 'M') + f2(r * Math.sin(a)) + ' ' + f2(-r * Math.cos(a));
      }
      return d + 'Z';
    }
    // The tube colours run round the sign in fours; with five slices the last takes the third colour, so no
    // two neighbours (the last and the first included) ever share one.
    const tubeOf = (i, n) => (n % 4 === 1 && i === n - 1 && n > 1 ? 2 : i % 4);
    // Pixel sparks: direction (degrees) and distance, fixed so every apply looks the same.
    const SPARKS = [
      [8, 58],
      [44, 48],
      [83, 62],
      [121, 46],
      [160, 56],
      [202, 50],
      [238, 60],
      [279, 44],
      [316, 56],
      [352, 46],
    ];

    function render(root, m, H) {
      // Wider slices (fewer of them) give their labels more room, up to what the tube band holds.
      const wide = Math.min(88, 2 * R.lbl * Math.sin(rad(Math.min(m.step, 180) / 2)) * 0.72);
      const u = H.uid('arcade');
      const defs = H.s('defs', {}, root);
      defs.innerHTML = `
      <radialGradient id="${u}-face" gradientUnits="userSpaceOnUse" cx="200" cy="170" r="210">
        <stop offset="0" style="stop-color:var(--ar-face-hi)"/><stop offset="1" style="stop-color:var(--wheel-face)"/></radialGradient>
      <radialGradient id="${u}-btn" gradientUnits="userSpaceOnUse" cx="184" cy="176" r="70">
        <stop offset="0" style="stop-color:var(--ar-hub-hi)"/><stop offset="1" style="stop-color:var(--ar-hub)"/></radialGradient>`;

      // Marquee ring with its bulbs.
      const rim = H.s('g', { class: 'ar-rim' }, root);
      H.s('circle', { cx: C, cy: C, r: R.rim, class: 'ar-band' }, rim);
      for (let b = 0; b < BULBS; b++) {
        const [x, y] = pol(R.bulbs, (b * 360) / BULBS + 360 / BULBS / 2);
        const c = H.s('circle', { cx: f2(x), cy: f2(y), r: 3.3, class: 'ar-bulb' + (b % 2 ? ' ar-bulb-b' : '') }, rim);
        c.style.setProperty('--b', m.dir === 'rtl' ? BULBS - b : b);
      }
      H.s('circle', { cx: C, cy: C, r: R.face + 0.8, class: 'ar-face-edge' }, rim);

      // Cabinet face with sunburst rays (visible by day, a faint sheen at night).
      H.s('circle', { cx: C, cy: C, r: R.face, fill: `url(#${u}-face)`, class: 'ar-face' }, root);
      let rays = '';
      for (let k = 0; k < 24; k++) {
        const a0 = k * 15 + 3.75;
        const [x0, y0] = pol(R.hub + 4, a0);
        const [x1, y1] = pol(R.face - 1, a0 - 3.2);
        const [x2, y2] = pol(R.face - 1, a0 + 3.2);
        rays += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}Z`;
      }
      H.s('path', { d: rays, class: 'ar-rays' }, root);

      // Slices: hit wedge, the flood fill, the tube (glow, body, core) and the label in the tube's color.
      for (const sl of m.slices) {
        const g = H.slice(root, sl, m);
        const tc = tubeOf(sl.i, m.n);
        g.style.setProperty('--tube', `var(--ar-c${tc})`);
        g.style.setProperty('--tube-soft', `var(--ar-s${tc})`);
        H.s('path', { d: H.sector(R.hub + 1, R.rim, sl.a0, sl.a1), class: 'ar-hit' }, g);
        const tube = H.sector(R.tubeIn, R.tubeOut, sl.a0, sl.a1, 13);
        const sign = H.s('g', { class: 'ar-sign' }, g);
        H.s('path', { d: tube, class: 'ar-fill' }, sign);
        H.s('path', { d: tube, class: 'ar-tube-glow' }, sign);
        H.s('path', { d: tube, class: 'ar-tube' }, sign);
        H.s('path', { d: tube, class: 'ar-tube-core' }, sign);
        const c = H.s('g', { class: 'ar-ink' }, sign);
        // A format is printed large, with its second line where it has one; tools and actions get an icon.
        if (sl.format) {
          H.block(c, sl, R.lbl, {
            size: 22,
            subSize: 13,
            gap: 1.5,
            maxWidth: wide,
            minSize: 9,
            cls: 'ar-lbl ar-fmt',
            subCls: 'ar-sub',
          });
        } else {
          H.block(c, sl, R.lbl, {
            icon: true,
            iconSize: 20,
            size: 13.5,
            gap: 3,
            maxWidth: wide,
            minSize: 8.5,
            cls: 'ar-lbl',
            sub: null,
          });
        }
        // More choices: a neon arrowhead in the tube's colour near the top of the sign.
        H.ringMark(c, sl, m, { r: R.tubeOut - 9.5, size: 10, cls: 'ar-ring-mark' });
      }

      // The apply burst: moved onto the chosen slice by onSelect, animated by CSS while is-applying.
      const fx = H.s('g', { class: 'ar-fx' }, root);
      const fxi = H.s('g', { class: 'ar-fx-in' }, fx);
      H.s('path', { d: burst(12, 22, 44), class: 'ar-burst' }, fxi);
      SPARKS.forEach(([a, dist], k) => {
        const [x, y] = [dist * Math.sin(rad(a)), -dist * Math.cos(rad(a))];
        const sp = H.s(
          'rect',
          { x: -2.6, y: -2.6, width: 5.2, height: 5.2, class: 'ar-spark' + (k % 2 ? ' ar-spark-b' : '') },
          fxi,
        );
        sp.style.setProperty('--sx', f2(x) + 'px');
        sp.style.setProperty('--sy', f2(y) + 'px');
      });
      H.text(fxi, 0, 0, '+100', { class: 'ar-score' });

      // Hub: a round start button with a neon ring.
      const hub = H.s('g', { class: 'ar-hub' }, root);
      H.s('circle', { cx: C, cy: C, r: R.hub, class: 'ar-hub-ring-glow' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.hub, class: 'ar-hub-ring' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.hub - 5, fill: `url(#${u}-btn)`, class: 'ar-btn' }, hub);
      H.s('path', { d: H.arc(R.hub - 11, 292, 344), class: 'ar-btn-shine' }, hub);
      H.label(hub, C, C - 16, m.title, { maxWidth: 84, size: 16, minSize: 9.5, cls: 'ar-title', maxLines: 1 });
      H.label(hub, C, C + 2.5, m.file, {
        maxWidth: 82,
        size: 11,
        minSize: 8,
        cls: 'ar-file',
        maxLines: 1,
        attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
      });
      // The key that opened the wheel, when one did.
      if (m.key) {
        const kt = H.text(hub, C, C + 23.5, m.key, { class: 'ar-keytext' });
        const kw = kt.getComputedTextLength() + 14;
        hub.insertBefore(
          H.s('rect', { x: f2(C - kw / 2), y: C + 15.5, width: f2(kw), height: 16, rx: 8, class: 'ar-key' }),
          kt,
        );
      }
    }

    // A value changed by up to ±r of itself, so a run of the same sound never repeats exactly.
    const vary = (v, r) => v * (1 + (Math.random() * 2 - 1) * r);
    // A coin's ring: partials of a small metal disc (ratio to 2400 Hz, level, decay in s).
    const COIN = [
      [1, 1, 0.18],
      [1.58, 0.7, 0.12],
      [2.13, 0.45, 0.09],
      [2.66, 0.3, 0.06],
    ];
    // The score's tally: a major pentatonic climbing from G4, one step per two marquee bulbs.
    const TALLY = [392, 440, 523.3, 587.3, 659.3, 784, 880, 1046.5, 1174.7, 1318.5, 1568, 1760, 2093, 2349.3];
    // The neon's buzz as [s, level] points: the tubes striking (arcade-strike's flickers), one tube
    // lighting under the pointer, and the chosen tube's flash.
    const STRIKE = [
      [0, 0],
      [0.035, 0.9],
      [0.054, 0.15],
      [0.083, 1],
      [0.102, 0.5],
      [0.125, 1],
      [0.3, 0],
    ];
    const FLICK = [
      [0, 0],
      [0.006, 1],
      [0.03, 0],
    ];
    const FLASH = [
      [0, 0],
      [0.004, 1],
      [0.05, 0.3],
      [0.09, 0],
    ];

    // A coin striking metal: a bright tick and its ring; pitch and length change for a bounce or a dull
    // landing.
    function coin(ac, out, t, X, gain, pitch = 1, length = 1) {
      X.burst(ac, out, t, { type: 'bandpass', f: 4200 * pitch, q: 2, dur: 0.003, gain: gain * 6 });
      for (const [r, a, d] of COIN) {
        X.tone(ac, out, t, { f: 2400 * pitch * r, dur: d * length, gain: gain * a, a: 0.001 });
      }
    }
    // The neon's ballast: a buzz of the mains' harmonics, following a list of [s, level] points.
    function neon(ac, out, t, points, gain) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = vary(120, 0.01);
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1500;
      band.Q.value = 1.2;
      const g = ac.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      for (const [dt, v] of points.slice(1)) g.gain.linearRampToValueAtTime(v * gain, t + dt);
      o.connect(band).connect(g).connect(out);
      o.start(t);
      o.stop(t + points[points.length - 1][0] + 0.02);
    }
    // A cabinet button: the plunger's chunky clack and the microswitch under it.
    function button(ac, out, t, X, gain) {
      X.burst(ac, out, t, { type: 'bandpass', f: 1800, q: 1.5, dur: 0.01, gain });
      X.tone(ac, out, t, { f: 420, f2: 360, dur: 0.025, gain: gain * 0.35, a: 0.0015 });
      X.burst(ac, out, t + 0.008, { type: 'bandpass', f: 3200, q: 2.5, dur: 0.004, gain: gain * 0.6 });
    }
    // The cabinet's voice: one square-wave channel, softened as its speaker does, playing notes a step
    // apart, each gated short; a single note can fall to `glide`.
    function voice(ac, out, t, notes, step, gain, glide) {
      const o = ac.createOscillator();
      o.type = 'square';
      const soft = ac.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 3200;
      soft.Q.value = 0.7;
      const g = ac.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, t);
      notes.forEach((f, i) => {
        const s = t + i * step;
        o.frequency.setValueAtTime(f, s);
        if (glide) o.frequency.exponentialRampToValueAtTime(glide, s + step);
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(gain, s + 0.002);
        g.gain.setValueAtTime(gain, s + step * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, s + step * 0.95);
      });
      o.connect(soft).connect(g).connect(out);
      o.start(t);
      o.stop(t + notes.length * step + 0.02);
    }

    Board.define({
      id: 'arcade',
      fonts: {
        brand: "'Comfortaa'",
        display: "'Unbounded'",
        load: ["'Comfortaa'", "'Unbounded'"],
        credits: [
          { family: 'Comfortaa', license: 'SIL Open Font License 1.1' },
          { family: 'Unbounded', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 160, close: 110, stagger: 14, apply: APPLY },

      palette: {
        light: {
          bg: '#f6f3ee',
          surface: '#ffffff',
          'surface-2': '#f6f4f0',
          border: '#e2ddd5',
          'border-strong': '#a59e92',
          text: '#141414',
          'text-muted': '#55524c',
          accent: '#d81b6a',
          'on-accent': '#ffffff',
          focus: '#0077a8',
          success: '#1f7a4f',
          'on-success': '#ffffff',
          'success-text': '#196942',
          warning: '#b7791f',
          'warning-text': '#7a4f0f',
          danger: '#c62828',
          desk: 'linear-gradient(160deg, #f7f2ea 0%, #f1eef2 50%, #e6f2f4 100%)',
          'wheel-face': '#fffdf7',
          'wheel-slice': '#fffdf7',
          'wheel-slice-hover': '#ffe0ec',
          'wheel-slice-selected': '#ff3d8b',
          'wheel-text': '#141414',
          'wheel-text-selected': '#141414',
          'wheel-line': '#141414',
          'wheel-shadow': 'rgba(40, 30, 50, 0.28)',
          'ar-c0': '#ff3d8b',
          'ar-c1': '#00b4d8',
          'ar-c2': '#ffc400',
          'ar-c3': '#ff6b1a',
          'ar-s0': '#ffe0ec',
          'ar-s1': '#d4f3fa',
          'ar-s2': '#fff2c2',
          'ar-s3': '#ffe2d0',
          'ar-sub': '#3a3835',
          'ar-sub-tube': '0%',
          'ar-glow-tube': '0%',
          'ar-glow-width': '8.5',
          'ar-flicker': '0',
          'ar-face-hi': '#ffffff',
          'ar-rays': '#ffefc0',
          'ar-rays-opacity': '0.85',
          'ar-outline': '#141414',
          'ar-tube-width': '5',
          'ar-glow-opacity': '1',
          'ar-core-opacity': '0',
          'ar-text-glow': '0',
          'ar-band': '#141414',
          'ar-bulb': '#fff4c9',
          'ar-bulb-b': '#fff4c9',
          'ar-bulb-dim': '1',
          'ar-bulb-edge': '#141414',
          'ar-bulb-lit': '#ffc400',
          'ar-hub': '#ffc400',
          'ar-hub-hi': '#ffe680',
          'ar-hub-ink': '#141414',
          'ar-hub-ring': '#141414',
          'ar-key': '#141414',
          'ar-key-ink': '#ffffff',
          'ar-score': '#141414',
          'ar-score-edge': '#ffffff',
          'ar-burst-edge': '#141414',
        },
        dark: {
          bg: '#0e0d11',
          surface: '#16151a',
          'surface-2': '#1d1c22',
          border: '#2b2a31',
          'border-strong': '#47454f',
          text: '#f6f1f4',
          'text-muted': '#aeaab2',
          accent: '#ff4fa3',
          'on-accent': '#1a0410',
          focus: '#3be8ff',
          success: '#5cc58e',
          'on-success': '#07200f',
          'success-text': '#6fd39f',
          warning: '#ffd93b',
          'warning-text': '#ffe27a',
          danger: '#ff6b6b',
          desk: 'radial-gradient(circle at 50% 28%, #1e1d24 0%, #111014 58%, #09090b 100%)',
          'wheel-face': '#121116',
          'wheel-slice': '#121116',
          'wheel-slice-hover': '#26232d',
          'wheel-slice-selected': '#ff4fa3',
          'wheel-text': '#fff4f9',
          'wheel-text-selected': '#160810',
          'wheel-line': '#ff4fa3',
          'wheel-shadow': 'rgba(0, 0, 0, 0.7)',
          'ar-c0': '#ff4fa3',
          'ar-c1': '#3be8ff',
          'ar-c2': '#ffd93b',
          'ar-c3': '#ff8a3b',
          'ar-s0': '#2b1a26',
          'ar-s1': '#13262c',
          'ar-s2': '#2a2614',
          'ar-s3': '#2b1e14',
          'ar-sub': '#fff4f9',
          'ar-sub-tube': '100%',
          'ar-glow-tube': '100%',
          'ar-glow-width': '11',
          'ar-flicker': '1',
          'ar-face-hi': '#1c1a22',
          'ar-rays': '#ffffff',
          'ar-rays-opacity': '0.025',
          'ar-outline': '#000000',
          'ar-tube-width': '3.6',
          'ar-glow-opacity': '0.22',
          'ar-core-opacity': '0.9',
          'ar-text-glow': '0.4',
          'ar-band': '#1b1a20',
          'ar-bulb': '#ffd93b',
          'ar-bulb-b': '#ff8a3b',
          'ar-bulb-dim': '0.55',
          'ar-bulb-edge': '#000000',
          'ar-bulb-lit': '#fff7d1',
          'ar-hub': '#1a1820',
          'ar-hub-hi': '#2c2935',
          'ar-hub-ink': '#fff4f9',
          'ar-hub-ring': '#3be8ff',
          'ar-key': '#121116',
          'ar-key-ink': '#ff8fc6',
          'ar-score': '#ffffff',
          'ar-score-edge': '#ff4fa3',
          'ar-burst-edge': 'transparent',
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
        ['wheel-text-selected', 'ar-c1', 'text'],
        ['wheel-text-selected', 'ar-c2', 'text'],
        ['wheel-text-selected', 'ar-c3', 'text'],
        ['wheel-text', 'ar-s1', 'text'],
        ['wheel-text', 'ar-s2', 'text'],
        ['wheel-text', 'ar-s3', 'text'],
        ['ar-hub-ink', 'ar-hub', 'text'],
      ],

      // No shared defs: every gradient and pattern is made per wheel in render(), because its colors come
      // from the palette tokens of the wheel's own light or dark figure.
      defs: '',
      wheel: {
        render,
        // Put the burst on the chosen slice (once per apply); CSS animates it while the wheel is applying.
        onSelect(root, m, i, H, t) {
          const sl = m.slices[i];
          const [x, y] = pol(R.lbl, sl.mid);
          const fx = root.querySelector('.ar-fx');
          fx.setAttribute('transform', `translate(${f2(x)} ${f2(y)})`);
          fx.style.setProperty('--tube', `var(--ar-c${tubeOf(i, m.n)})`);
          // The score starts just outside the label and flies out over the rim.
          const sx = Math.sin(rad(sl.mid));
          const sy = -Math.cos(rad(sl.mid));
          fx.style.setProperty('--dx0', f2(18 * sx) + 'px');
          fx.style.setProperty('--dy0', f2(18 * sy - 6) + 'px');
          fx.style.setProperty('--dx', f2(66 * sx) + 'px');
          fx.style.setProperty('--dy', f2(66 * sy - 14) + 'px');
        },
      },

      // The cabinet: coins, the neon's buzzing ballast, chunky buttons, a square-wave voice softened by its
      // speaker.
      sounds: {
        open(ac, out, t, X) {
          // A coin goes in as the tubes strike (arcade-strike): it rings off the slot, bounces, rattles and
          // drops into the coin box, over the neon's flickering buzz.
          neon(ac, out, t, STRIKE, 0.0067);
          coin(ac, out, t, X, 0.0126);
          coin(ac, out, t + 0.075, X, 0.0063, 1.02);
          coin(ac, out, t + 0.115, X, 0.0025, 0.98);
          coin(ac, out, t + 0.14, X, 0.0017, 1.03);
          X.burst(ac, out, t + 0.24, { type: 'bandpass', f: 700, q: 0.8, dur: 0.035, gain: 0.029 });
          X.tone(ac, out, t + 0.24, { f: 330, f2: 270, dur: 0.045, gain: 0.017, a: 0.002 });
          coin(ac, out, t + 0.242, X, 0.0034, 0.85, 0.35);
        },
        tick(ac, out, t, X) {
          // The joystick nudges onto a slice and its tube lights: a microswitch click, a short neon buzz.
          X.burst(ac, out, t, { type: 'bandpass', f: vary(3000, 0.05), q: 2.5, dur: 0.004, gain: vary(0.06, 0.12) });
          X.tone(ac, out, t, { f: vary(1250, 0.04), dur: 0.016, gain: 0.04, a: 0.0015 });
          neon(ac, out, t + 0.002, FLICK, vary(0.09, 0.15));
        },
        enter(ac, out, t, X) {
          // Into a ring: a cabinet button goes down with a chunky clack, and the voice blips up a fourth.
          button(ac, out, t, X, 0.075);
          voice(ac, out, t + 0.03, [784, 1046.5], 0.045, 0.009);
        },
        leave(ac, out, t, X) {
          // Back out: the button comes up with a lighter clack, and the voice blips down a fourth.
          button(ac, out, t, X, 0.0525);
          voice(ac, out, t + 0.03, [1046.5, 784], 0.045, 0.009);
        },
        success(ac, out, t, X) {
          // Score: the tube flashes and the starburst pops with a falling zap; +100 tallies up in quick
          // steps as the marquee bulbs chase round (28 bulbs, 15 ms apart); two coins ring as the run
          // lands, under a short major chord.
          neon(ac, out, t, FLASH, 0.017);
          voice(ac, out, t, [1600], 0.06, 0.011, 400);
          voice(ac, out, t + 0.03, TALLY, 0.03, 0.0062);
          const land = t + 0.45;
          coin(ac, out, land, X, 0.011);
          coin(ac, out, land + 0.065, X, 0.009, 1.06);
          for (const f of [523.3, 659.3, 784]) voice(ac, out, land, [f], 0.26, 0.0039);
          X.tone(ac, out, land, { type: 'triangle', f: 261.6, dur: 0.24, gain: 0.017, a: 0.003 });
        },
      },
    });
  })();
}
