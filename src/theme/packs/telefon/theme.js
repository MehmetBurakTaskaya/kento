// SPDX-License-Identifier: MIT
// Retro technology: Çevirmeli telefon. A rotary phone dial seen from the front: the slices are printed on
// the number plate under the finger holes of a turning finger wheel, a chrome finger stop waits at five
// o'clock and the hub is the paper number card behind its clear cover. Applying a slice winds the finger
// wheel to the stop; it ratchets back one hole per click, and the bell answers with a faint ting.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    // Radii in the 400 x 400 viewBox: phone body, finger wheel (outer and inner edge), holes (radius and
    // the circle their centers sit on), chrome retaining ring and the number card.
    const R = { body: 197, fw: 180, fwIn: 64, hole: 39.5, at: 127.5, ret: 64, card: 54.5 };
    const T = { apply: 700, hold: 34, pulse: 40, bell: 260 };
    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    const pol = (r, a) => [C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))];
    const circ = (x, y, r) => `M${f2(x)} ${f2(y - r)}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}Z`;
    const reducedMotion = () =>
      document.documentElement.classList.contains('reduce-motion') ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    // The finger stop sits on the slice boundary nearest to five o'clock (seven o'clock right to left, where
    // the finger wheel also turns the other way), so it stays in a gap between two holes whatever the number
    // of slices and however a ring of choices is turned.
    function stopAngle(m) {
      const target = m.dir === 'rtl' ? -150 : 150;
      let best = target;
      let gap = Infinity;
      for (const sl of m.slices) {
        const d = Math.abs(((((sl.a0 - target) % 360) + 540) % 360) - 180);
        if (d < gap - 1e-6) {
          gap = d;
          best = sl.a0;
        }
      }
      return best;
    }
    // Fewer slices leave room for larger finger holes, and larger holes for longer labels.
    const holeFor = (m) => (m.n <= 6 ? 44 : m.n === 7 ? 42 : R.hole);

    // One dial turn: how far the selected hole travels to the stop, how many holes it clicks back over,
    // and when the turn and the ratchet end (ms).
    function turnFor(m, i) {
      const sgn = m.dir === 'rtl' ? -1 : 1;
      const d = (((sgn * (stopAngle(m) - m.slices[i].mid)) % 360) + 360) % 360 || 360;
      const pulses = Math.max(1, Math.round((d - m.step / 2) / m.step) + 1);
      const tt = 80 + 170 * (d / 337.5);
      return { sgn, d, step: m.step, pulses, tt, te: tt + T.hold + pulses * T.pulse };
    }
    // The success sound clicks once per hole on the way back, so it reads the last turn.
    let lastTurn = { d: 157.5, pulses: 4, tt: 159, te: 353 };

    // Finger wheel angle at time t (ms) of the apply effect: wind up, knock against the stop, then fall
    // back in steps, one hole per step, each step a quick move and a short rest.
    function angleAt(k, t) {
      if (t <= 0) return 0;
      if (t < k.tt) {
        const u = t / k.tt;
        return k.d * (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
      }
      if (t < k.tt + T.hold) return k.d - 1.8 * Math.sin((Math.PI * (t - k.tt)) / T.hold);
      const r = (t - k.tt - T.hold) / T.pulse;
      if (r >= k.pulses) return 0;
      const p = Math.floor(r);
      const pos = (q) => (q <= 0 ? k.d : Math.max(0, k.d - k.step / 2 - k.step * (q - 1)));
      const u = Math.min(1, (r - p) / 0.6);
      return pos(p) + (pos(p + 1) - pos(p)) * (1 - Math.pow(1 - u, 3));
    }

    function stopFx(root) {
      if (root.__tlStop) root.__tlStop();
    }

    // The two gongs of the bell (Hz), a major third apart.
    const GONG = [1680, 2120];
    // A value changed by up to ±r of itself, so a run of the same sound never repeats exactly.
    const vary = (v, r) => v * (1 + (Math.random() * 2 - 1) * r);
    // When the wind-up reaches a share y of its angle, as a share of its time: angleAt's ease, inverted.
    const windAt = (y) => (y < 0.5 ? Math.sqrt(y / 2) : 1 - Math.sqrt(2 * (1 - y)) / 2);

    // A bakelite click: a dry snap with the hollow shell's body under it.
    function clack(ac, out, t, X, f, gain) {
      X.burst(ac, out, t, { type: 'bandpass', f, q: 2.6, dur: 0.012, gain });
      X.tone(ac, out, t, { f: 610, f2: 540, dur: 0.03, gain: gain * 0.3, a: 0.001 });
    }
    // The finger wheel against the stop or back at rest: a firmer, lower plastic knock.
    function knock(ac, out, t, X, gain) {
      X.burst(ac, out, t, { type: 'bandpass', f: 900, q: 0.8, dur: 0.025, gain });
      X.burst(ac, out, t, { type: 'bandpass', f: 2400, q: 2, dur: 0.008, gain: gain * 0.5 });
      X.tone(ac, out, t, { f: 240, f2: 175, dur: 0.045, gain: gain * 0.55, a: 0.0015 });
    }
    // One fine tooth of the wind-up ratchet.
    function ratchet(ac, out, t, X, f, gain) {
      X.burst(ac, out, t, { type: 'bandpass', f, q: 4, dur: 0.004, gain });
    }
    // One dial pulse on the way back: the contacts click and the bell's gongs, p-th of the run, tinkle.
    function pulse(ac, out, t, X, gain, p = 0) {
      X.burst(ac, out, t, { type: 'bandpass', f: vary(2500, 0.04), q: 3, dur: 0.007, gain });
      X.tone(ac, out, t, { f: 520, f2: 470, dur: 0.018, gain: gain * 0.25, a: 0.001 });
      X.tone(ac, out, t + 0.001, { f: GONG[p % 2], dur: 0.09, gain: gain * 0.05, a: 0.002 });
    }
    // The governor that holds the finger wheel's return steady: a whirr that spins up and runs until the
    // wheel is back, its brake shoes rubbing at the speed they turn.
    function whirr(ac, out, start, end, gain) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(190, start);
      o.frequency.exponentialRampToValueAtTime(245, start + Math.min(0.04, (end - start) / 2));
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1050;
      band.Q.value = 0.9;
      const rub = ac.createGain();
      rub.gain.value = 0.7;
      const spin = ac.createOscillator();
      spin.frequency.value = 33;
      const depth = ac.createGain();
      depth.gain.value = 0.3;
      spin.connect(depth).connect(rub.gain);
      const g = ac.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
      g.gain.setValueAtTime(gain, Math.max(start + 0.012, end - 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, end + 0.012);
      o.connect(band).connect(rub).connect(g).connect(out);
      for (const n of [o, spin]) {
        n.start(start);
        n.stop(end + 0.03);
      }
    }
    // The bell after dialling: the clapper strikes the two gongs in turn, ten times in 260 ms and each
    // time softer, as the card shakes; each gong rings on its own three steel partials.
    function bell(ac, out, t) {
      const tau = 0.07;
      GONG.forEach((f, j) => {
        const g = ac.createGain();
        g.gain.value = 0;
        g.gain.setValueAtTime(0.00001, t);
        let level = 0.00001;
        let last = t;
        for (let k = j; k < 10; k += 2) {
          const s = t + 0.013 + 0.026 * k;
          level = Math.max(0.00001, level * Math.exp(-(s - last) / tau));
          g.gain.exponentialRampToValueAtTime(level, s);
          level += 0.016 * (1 - (k + 0.5) / 10);
          g.gain.linearRampToValueAtTime(level, s + 0.0015);
          last = s + 0.0015;
        }
        g.gain.exponentialRampToValueAtTime(0.00001, last + 0.3);
        g.connect(out);
        for (const [r, a] of [
          [1, 1],
          [2.32, 0.4],
          [4.25, 0.15],
        ]) {
          const o = ac.createOscillator();
          o.frequency.value = f * r;
          const pg = ac.createGain();
          pg.gain.value = a;
          o.connect(pg).connect(g);
          o.start(t);
          o.stop(last + 0.32);
        }
      });
    }

    function render(root, m, H) {
      const u = H.uid('telefon');
      const sgn = m.dir === 'rtl' ? -1 : 1;
      const hole = holeFor(m);
      const wide = hole * 1.57;
      const defs = H.s('defs', {}, root);
      defs.innerHTML = `
      <radialGradient id="${u}-body" gradientUnits="userSpaceOnUse" cx="128" cy="96" r="330">
        <stop offset="0" style="stop-color:var(--tl-body-hi)"/><stop offset=".5" style="stop-color:var(--tl-body)"/><stop offset="1" style="stop-color:var(--tl-body-lo)"/></radialGradient>
      <radialGradient id="${u}-fw" gradientUnits="userSpaceOnUse" cx="200" cy="200" r="180">
        <stop offset=".35" style="stop-color:var(--tl-fw-lo)"/><stop offset=".47" style="stop-color:var(--tl-fw)"/><stop offset=".8" style="stop-color:var(--tl-fw-hi)"/><stop offset=".94" style="stop-color:var(--tl-fw)"/><stop offset="1" style="stop-color:var(--tl-fw-lo)"/></radialGradient>
      <linearGradient id="${u}-chrome" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color:var(--tl-chrome-hi)"/><stop offset=".45" style="stop-color:var(--tl-chrome)"/><stop offset="1" style="stop-color:var(--tl-chrome-lo)"/></linearGradient>
      <linearGradient id="${u}-ret" gradientUnits="userSpaceOnUse" x1="150" y1="138" x2="250" y2="262">
        <stop offset="0" style="stop-color:var(--tl-chrome-hi)"/><stop offset=".5" style="stop-color:var(--tl-chrome)"/><stop offset="1" style="stop-color:var(--tl-chrome-lo)"/></linearGradient>
`;

      // The phone body around the dial, and the number plate the slices are printed on.
      const body = H.s('g', { class: 'tl-body' }, root);
      H.s('circle', { cx: C, cy: C, r: R.body, fill: `url(#${u}-body)` }, body);
      H.s('circle', { cx: C, cy: C, r: R.body - 0.7, class: 'tl-body-edge' }, body);
      H.s('circle', { cx: C, cy: C, r: R.fw + 0.5, class: 'tl-plate' }, body);

      // Slices: the whole wedge is the hit area; what shows is the printed disc under each finger hole.
      for (const sl of m.slices) {
        const g = H.slice(root, sl, m);
        H.s('path', { d: H.sector(R.ret, R.body, sl.a0, sl.a1), class: 'tl-hit' }, g);
        const [x, y] = pol(R.at, sl.mid);
        H.s('circle', { cx: f2(x), cy: f2(y), r: hole + 1.5, class: 'tl-disc' }, g);
        H.s('circle', { cx: f2(x), cy: f2(y), r: hole - 4, class: 'tl-ring' }, g);
        const c = H.s('g', { class: 'tl-ink' }, g);
        // A format is printed large, with its second line where it has one; tools and actions get an icon.
        if (sl.format) {
          H.block(c, sl, R.at, {
            size: 22,
            subSize: 12.8,
            gap: 1.5,
            maxWidth: wide,
            minSize: 9,
            cls: 'tl-lbl tl-fmt',
            subCls: 'tl-sub',
          });
        } else {
          H.block(c, sl, R.at, {
            icon: true,
            iconSize: 21,
            size: 13.5,
            gap: 2.5,
            maxWidth: wide,
            minSize: 8.5,
            cls: 'tl-lbl',
            sub: null,
          });
        }
      }

      // The finger wheel: one ring with a hole over every slice. The outer group carries the open
      // animation, the inner one the apply turn.
      const fwOpen = H.s('g', { class: 'tl-fw-open' }, root);
      const fw = H.s('g', { class: 'tl-fw' }, fwOpen);
      let d = circ(C, C, R.fw) + circ(C, C, R.fwIn);
      for (const sl of m.slices) d += circ(...pol(R.at, sl.mid), hole);
      H.s('path', { d, 'fill-rule': 'evenodd', fill: `url(#${u}-fw)`, class: 'tl-fw-face' }, fw);
      for (const sl of m.slices) {
        const [x, y] = pol(R.at, sl.mid);
        H.s('circle', { cx: f2(x), cy: f2(y), r: hole + 0.4, class: 'tl-bevel' }, fw);
        // A small paint dot between the holes, as on many dials.
        const [dx, dy] = pol(R.at + 4, sl.a1);
        H.s('circle', { cx: f2(dx), cy: f2(dy), r: 2.1, class: 'tl-dot' }, fw);
        // More choices: an arrowhead printed on the finger wheel's outer band, beside the hole.
        H.ringMark(fw, sl, m, { r: R.fw - 2, size: 9.5, cls: 'tl-ring-mark' });
      }
      H.s('circle', { cx: C, cy: C, r: R.fw - 0.6, class: 'tl-fw-edge' }, fw);
      // Light on the finger wheel's outer band stays put while the wheel turns.
      const spec = H.s('g', { class: 'tl-spec' }, root);
      H.s('path', { d: H.arc(174, 286, 344), class: 'tl-spec-hi' }, spec);
      H.s('path', { d: H.arc(174, 106, 164), class: 'tl-spec-lo' }, spec);

      // The finger stop: a curved chrome hook screwed to the body, reaching over the finger wheel.
      const hook = `M${C} ${C - 190}C${C + 9 * sgn} ${C - 176} ${C + 8 * sgn} ${C - 157} ${C + 2 * sgn} ${C - 141}`;
      const rot = `rotate(${f2(stopAngle(m))} ${C} ${C})`;
      const shade = H.s('g', { class: 'tl-stop-shade', transform: 'translate(2 3)' }, root);
      H.s('path', { d: hook, transform: rot }, shade);
      const stop = H.s('g', { class: 'tl-stop', transform: rot }, root);
      H.s('path', { d: hook, class: 'tl-stop-edge' }, stop);
      H.s('path', { d: hook, class: 'tl-stop-metal', stroke: `url(#${u}-chrome)` }, stop);
      H.s('path', { d: hook, class: 'tl-stop-hi', transform: `translate(${-1.6 * sgn} -0.6)` }, stop);
      H.s('circle', { cx: C, cy: C - 188.5, r: 5.4, class: 'tl-screw', fill: `url(#${u}-chrome)` }, stop);
      H.s('path', { d: `M${C - 3.4} ${C - 190}L${C + 3.4} ${C - 187}`, class: 'tl-screw-slot' }, stop);

      // Hub: the chrome retaining ring and the paper number card under its clear cover.
      const hub = H.s('g', { class: 'tl-hub' }, root);
      H.s('circle', { cx: C, cy: C, r: R.ret, fill: `url(#${u}-ret)` }, hub);
      H.s('circle', { cx: C, cy: C, r: R.ret - 0.6, class: 'tl-ret-edge' }, hub);
      const card = H.s('g', { class: 'tl-card' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.card, class: 'tl-card-paper' }, card);
      H.s('circle', { cx: C, cy: C, r: R.card - 4.6, class: 'tl-card-frame' }, card);
      H.s('path', { d: `M${C - 41} ${C + 8.5}H${C + 41}`, class: 'tl-card-rule' }, card);
      H.label(card, C, C - 21, m.title, { maxWidth: 74, size: 13.5, minSize: 9, cls: 'tl-title', maxLines: 1 });
      H.label(card, C, C - 1.5, m.file, {
        maxWidth: 80,
        size: 18,
        minSize: 11,
        cls: 'tl-file',
        maxLines: 1,
        attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
      });
      // The key that opened the wheel, when one did.
      if (m.key) {
        const kt = H.text(card, C, C + 22.6, m.key, { class: 'tl-keytext' });
        const kw = kt.getComputedTextLength() + 13;
        card.insertBefore(
          H.s('rect', { x: f2(C - kw / 2), y: C + 15, width: f2(kw), height: 15.5, rx: 7.75, class: 'tl-key' }),
          kt,
        );
      }
      // The clear cover over the card catches the light along its upper rim.
      H.s('path', { d: H.arc(R.card - 3, 292, 338), class: 'tl-cover' }, hub);
      H.s('path', { d: H.arc(R.card - 3, 112, 136), class: 'tl-cover tl-cover-lo' }, hub);
      // The bell's ring, drawn only while it tings.
      const bell = H.s('g', { class: 'tl-bell' }, hub);
      for (const s of [-1, 1]) {
        H.s('path', { d: H.arc(71, s < 0 ? -62 : 34, s < 0 ? -34 : 62), class: 'tl-bell-arc' }, bell);
        H.s('path', { d: H.arc(79, s < 0 ? -56 : 40, s < 0 ? -40 : 56), class: 'tl-bell-arc' }, bell);
      }
    }

    Board.define({
      id: 'telefon',
      fonts: {
        brand: "'Jost'",
        display: "'Jost'",
        accent: "'Caveat'",
        load: ["'Jost'", "'Caveat'"],
        credits: [
          { family: 'Jost', license: 'SIL Open Font License 1.1' },
          { family: 'Caveat', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 110, stagger: 10, apply: T.apply },

      palette: {
        light: {
          bg: '#eef3f0',
          surface: '#ffffff',
          'surface-2': '#f3f7f5',
          border: '#d5e0db',
          'border-strong': '#9fb5ab',
          text: '#18231f',
          'text-muted': '#4f5f58',
          accent: '#c4253a',
          'on-accent': '#ffffff',
          focus: '#1f6f8b',
          success: '#1d7a4c',
          'on-success': '#ffffff',
          'success-text': '#17683f',
          warning: '#b7791f',
          'warning-text': '#7a4f0f',
          danger: '#c4253a',
          desk: 'linear-gradient(155deg, #f6f0ea 0%, #ebf1ee 52%, #dce9e5 100%)',
          'wheel-face': '#fbfaf4',
          'wheel-slice': '#fbfaf4',
          'wheel-slice-hover': '#ffecb3',
          'wheel-slice-selected': '#c4253a',
          'wheel-text': '#1b2622',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#6fa48d',
          'wheel-shadow': 'rgba(34, 74, 60, 0.34)',
          'tl-sub': '#4b5b55',
          'tl-ring': '#c4253a',
          'tl-body': '#97cbb3',
          'tl-body-hi': '#d3eee1',
          'tl-body-lo': '#5f9d83',
          'tl-fw': '#c2e5d5',
          'tl-fw-hi': '#eaf8f1',
          'tl-fw-lo': '#93c6af',
          'tl-bevel': '#5e9580',
          'tl-dot': '#fbfaf4',
          'tl-chrome-hi': '#ffffff',
          'tl-chrome': '#d3dadc',
          'tl-chrome-lo': '#87949a',
          'tl-chrome-edge': '#6d7a80',
          'tl-card': '#fffdf6',
          'tl-print': '#2f3d38',
          'tl-ink': '#2a4e9c',
          'tl-rule': '#d65a52',
          'tl-key': '#e9efec',
          'tl-spec-opacity': '0.55',
          'tl-shade': 'rgba(30, 70, 55, 0.3)',
        },
        dark: {
          bg: '#121517',
          surface: '#1b1f22',
          'surface-2': '#22272b',
          border: '#30373c',
          'border-strong': '#4c565d',
          text: '#efeae0',
          'text-muted': '#aab0b2',
          accent: '#ef5a64',
          'on-accent': '#1d0a0c',
          focus: '#e9c46a',
          success: '#4cc38a',
          'on-success': '#06200f',
          'success-text': '#5fd49b',
          warning: '#e9b44c',
          'warning-text': '#f0c46a',
          danger: '#ff6b6b',
          desk: 'radial-gradient(circle at 32% 22%, #2c3130 0%, #191d1f 58%, #101315 100%)',
          'wheel-face': '#ebe3d1',
          'wheel-slice': '#ebe3d1',
          'wheel-slice-hover': '#f6d47f',
          'wheel-slice-selected': '#c92f3b',
          'wheel-text': '#1e1a13',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#3b4045',
          'wheel-shadow': 'rgba(0, 0, 0, 0.62)',
          'tl-sub': '#4d4537',
          'tl-ring': '#c92f3b',
          'tl-body': '#1b1d1f',
          'tl-body-hi': '#4b5156',
          'tl-body-lo': '#09090a',
          'tl-fw': '#232629',
          'tl-fw-hi': '#43494e',
          'tl-fw-lo': '#121416',
          'tl-bevel': '#000000',
          'tl-dot': '#c92f3b',
          'tl-chrome-hi': '#f7f9fa',
          'tl-chrome': '#b5bdc2',
          'tl-chrome-lo': '#596268',
          'tl-chrome-edge': '#2b3034',
          'tl-card': '#f2ecde',
          'tl-print': '#2d2a24',
          'tl-ink': '#264a92',
          'tl-rule': '#c9343f',
          'tl-key': '#e2dccd',
          'tl-spec-opacity': '0.32',
          'tl-shade': 'rgba(0, 0, 0, 0.5)',
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
        ['tl-sub', 'wheel-slice', 'text'],
        ['tl-sub', 'wheel-slice-hover', 'text'],
        ['tl-print', 'tl-card', 'text'],
        ['tl-ink', 'tl-card', 'text'],
      ],

      // No shared defs: every gradient and pattern is made per wheel in render(), because its colors come
      // from the palette tokens of the wheel's own light or dark figure.
      defs: '',
      wheel: {
        render,
        onOpen(root) {
          stopFx(root);
        },
        // Live (t undefined) the turn runs on requestAnimationFrame for the length of the apply effect and
        // then clears itself; for a still frame (t set) it draws the moment t and stays.
        onSelect(root, m, i, H, t) {
          stopFx(root);
          const k = turnFor(m, i);
          lastTurn = k;
          if (t == null && (reducedMotion() || !window.requestAnimationFrame)) return;
          const fw = root.querySelector('.tl-fw');
          const card = root.querySelector('.tl-card');
          const bell = root.querySelector('.tl-bell');
          const paint = (tt) => {
            fw.style.transform = `rotate(${f2(k.sgn * angleAt(k, tt))}deg)`;
            const b = (tt - k.te - 12) / T.bell;
            if (b > 0 && b < 1) {
              card.style.transform = `rotate(${f2(2.6 * Math.sin(b * Math.PI * 10) * (1 - b))}deg)`;
              bell.style.opacity = f2(Math.min(1, b * 6) * (1 - b));
            } else {
              card.style.transform = '';
              bell.style.opacity = '';
            }
          };
          if (t != null) {
            paint(t);
            return;
          }
          const t0 = performance.now();
          root.__tlStop = () => {
            cancelAnimationFrame(root.__tlRaf);
            fw.style.transform = '';
            card.style.transform = '';
            bell.style.opacity = '';
            root.__tlStop = null;
          };
          const step = () => {
            const tt = performance.now() - t0;
            if (!root.isConnected || tt >= T.apply) return stopFx(root);
            paint(tt);
            root.__tlRaf = requestAnimationFrame(step);
          };
          paint(0);
          root.__tlRaf = requestAnimationFrame(step);
        },
      },

      // Bakelite, a spring and a bell: hollow plastic clicks, the governor's whirr, two gongs that tinkle.
      sounds: {
        open(ac, out, t, X) {
          // The handset lifts: the cradle switch clacks up, the finger wheel whirrs back into place
          // (telefon-swing) and knocks at rest, and a soft breath of dial tone comes on the line.
          clack(ac, out, t, X, 2300, 0.165);
          clack(ac, out, t + 0.022, X, 2900, 0.088);
          whirr(ac, out, t + 0.03, t + 0.16, 0.0175);
          pulse(ac, out, t + 0.07, X, 0.073);
          pulse(ac, out, t + 0.115, X, 0.058);
          knock(ac, out, t + 0.165, X, 0.1);
          X.tone(ac, out, t + 0.2, { f: 425, dur: 0.3, gain: 0.029, a: 0.05 });
          X.tone(ac, out, t + 0.2, { f: 850, dur: 0.22, gain: 0.0058, a: 0.05 });
        },
        tick(ac, out, t, X) {
          // A fingertip finds a hole: a hollow bakelite click, the bell inside answering with a faint tink.
          X.burst(ac, out, t, { type: 'bandpass', f: vary(2100, 0.06), q: 3, dur: 0.008, gain: vary(0.196, 0.15) });
          const body = vary(640, 0.04);
          X.tone(ac, out, t, { f: body, f2: body * 0.9, dur: 0.022, gain: 0.047, a: 0.001 });
          X.tone(ac, out, t + 0.002, { f: vary(GONG[0], 0.01), dur: 0.07, gain: vary(0.0035, 0.3), a: 0.002 });
        },
        enter(ac, out, t, X) {
          // Into a ring: the finger pulls the wheel round a notch, three ratchet clicks and a soft stop.
          for (let k = 0; k < 3; k++) ratchet(ac, out, t + k * 0.011, X, 1800 + k * 160, 0.058 + k * 0.012);
          knock(ac, out, t + 0.045, X, 0.069);
        },
        leave(ac, out, t, X) {
          // Back out: the wheel slips back to rest, a short whirr, one pulse and the knock at rest.
          whirr(ac, out, t, t + 0.085, 0.012);
          pulse(ac, out, t + 0.04, X, 0.055);
          knock(ac, out, t + 0.095, X, 0.06);
        },
        success(ac, out, t, X) {
          const k = lastTurn;
          const at = (ms) => t + ms / 1000;
          // Winding up: a fine ratchet click every 15 degrees of the turn, then the knock against the stop.
          for (let a = 15; a < k.d - 4; a += 15) {
            ratchet(ac, out, at(windAt(a / k.d) * k.tt), X, vary(1900, 0.05), 0.039);
          }
          knock(ac, out, at(k.tt), X, 0.075);
          X.tone(ac, out, at(k.tt), { f: 3240, dur: 0.05, gain: 0.0052, a: 0.001 });
          // The way back: the governor whirrs, the contacts click once per hole, each pulse tinkling the
          // bell, and the wheel knocks at rest.
          whirr(ac, out, at(k.tt + T.hold), at(k.te), 0.018);
          for (let p = 0; p < k.pulses; p++) pulse(ac, out, at(k.tt + T.hold + p * T.pulse + 6), X, 0.0975, p);
          knock(ac, out, at(k.te), X, 0.065);
          // The bell answers: the clapper rattles between the gongs as the card shakes, to a faint ting.
          bell(ac, out, at(k.te + 12));
        },
      },
    });
  })();
}
