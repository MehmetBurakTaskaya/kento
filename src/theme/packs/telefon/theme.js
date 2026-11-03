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

    // The finger stop sits on the boundary three and a half slices after twelve o'clock (five o'clock with
    // eight slices), mirrored in right-to-left languages, where the finger wheel also turns the other way.
    const stopAngle = (m) => (m.dir === 'rtl' ? -1 : 1) * m.step * 3.5;

    // One dial turn: how far the selected hole travels to the stop, how many holes it clicks back over,
    // and when the turn and the ratchet end (ms).
    function turnFor(m, i) {
      const sgn = m.dir === 'rtl' ? -1 : 1;
      const d = (((sgn * (stopAngle(m) - m.slices[i].mid)) % 360) + 360) % 360 || 360;
      const pulses = Math.round((d - m.step / 2) / m.step) + 1;
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

    function render(root, m, H) {
      const u = H.uid('telefon');
      const sgn = m.dir === 'rtl' ? -1 : 1;
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
        H.s('circle', { cx: f2(x), cy: f2(y), r: R.hole + 1.5, class: 'tl-disc' }, g);
        H.s('circle', { cx: f2(x), cy: f2(y), r: R.hole - 4, class: 'tl-ring' }, g);
        const c = H.s('g', { class: 'tl-ink' }, g);
        if (m.kind === 'convert' && sl.sub) {
          H.block(c, sl, R.at, {
            size: 22,
            subSize: 12.8,
            gap: 1.5,
            maxWidth: 62,
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
            maxWidth: 62,
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
      for (const sl of m.slices) d += circ(...pol(R.at, sl.mid), R.hole);
      H.s('path', { d, 'fill-rule': 'evenodd', fill: `url(#${u}-fw)`, class: 'tl-fw-face' }, fw);
      for (const sl of m.slices) {
        const [x, y] = pol(R.at, sl.mid);
        H.s('circle', { cx: f2(x), cy: f2(y), r: R.hole + 0.4, class: 'tl-bevel' }, fw);
        // A small paint dot between the holes, as on many dials.
        const [dx, dy] = pol(R.at + 4, sl.a1);
        H.s('circle', { cx: f2(dx), cy: f2(dy), r: 2.1, class: 'tl-dot' }, fw);
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
      const kt = H.text(card, C, C + 22.6, m.key, { class: 'tl-keytext' });
      const kw = kt.getComputedTextLength() + 13;
      card.insertBefore(
        H.s('rect', { x: f2(C - kw / 2), y: C + 15, width: f2(kw), height: 15.5, rx: 7.75, class: 'tl-key' }),
        kt,
      );
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

      sounds: gatedSounds({
        open(ac, out, t, X) {
          // The handset lifts: a plastic clack and a short, soft breath of dial tone.
          X.burst(ac, out, t, { type: 'bandpass', f: 1700, q: 1.6, dur: 0.035, gain: 0.15 });
          X.tone(ac, out, t, { type: 'triangle', f: 150, f2: 110, dur: 0.05, gain: 0.08, a: 0.002 });
          X.tone(ac, out, t + 0.05, { f: 425, dur: 0.15, gain: 0.028, a: 0.025 });
        },
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 3100, q: 2.4, dur: 0.012, gain: 0.2 });
          X.tone(ac, out, t, { type: 'triangle', f: 1500, f2: 1200, dur: 0.014, gain: 0.025, a: 0.001 });
        },
        success(ac, out, t, X) {
          const k = lastTurn;
          const at = (ms) => t + ms / 1000;
          // Winding up, then the knock against the finger stop.
          X.burst(ac, out, t, { type: 'bandpass', f: 700, f2: 1500, q: 2.5, dur: k.tt / 1000, gain: 0.035, a: 0.03 });
          X.burst(ac, out, at(k.tt), { type: 'lowpass', f: 900, q: 0.8, dur: 0.03, gain: 0.12 });
          X.tone(ac, out, at(k.tt), { type: 'triangle', f: 190, f2: 140, dur: 0.035, gain: 0.06 });
          // One governor click per hole on the way back.
          for (let p = 0; p < k.pulses; p++) {
            const c = at(k.tt + T.hold + p * T.pulse + 6);
            X.burst(ac, out, c, { type: 'bandpass', f: 2600, q: 3, dur: 0.011, gain: 0.1 });
            X.tone(ac, out, c, { type: 'square', f: 900, dur: 0.008, gain: 0.01 });
          }
          // The bell answers with a faint ting.
          const b = at(k.te + 12);
          X.tone(ac, out, b, { f: 2240, dur: 0.38, gain: 0.03, a: 0.002 });
          X.tone(ac, out, b, { f: 2240 * 2.37, dur: 0.16, gain: 0.011, a: 0.001 });
          X.tone(ac, out, b + 0.07, { f: 2240, dur: 0.24, gain: 0.014, a: 0.002 });
        },
      }),
    });
  })();
}
