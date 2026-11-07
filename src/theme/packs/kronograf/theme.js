// SPDX-License-Identifier: MIT
// Retro technology: Kronograf. A mechanical stopwatch held slightly tilted: a polished case with the crown
// and two pushers, a tachymeter bezel, a fine seconds track, the slices on the dial and a counter subdial as
// the hub (white dial and black subdial by day, the reverse at night). The chrono hand waits by the crown;
// applying a slice presses start, the hand sweeps round to the slice and stop clicks it in place.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const R = { case: 197, caseIn: 186, bezIn: 170, track: 168, trackIn: 158, hub: 59, lbl: 111, hand: 171, pop: 157 };
    const APPLY = 700;
    const TACHY = [500, 400, 300, 250, 200, 180, 150, 120, 100, 90, 80, 70, 60];
    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    const pol = (r, a) => [C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))];
    const clamp = (x) => Math.max(0, Math.min(1, x));
    const reducedMotion = () =>
      document.documentElement.classList.contains('reduce-motion') ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    // The watch is held a little turned: its crown, and the zero of its scales, sit at half past eleven
    // (half past twelve right to left, where the hand also runs the other way), the same on every wheel.
    const crownAngle = (m) => (m.dir === 'rtl' ? 22.5 : -22.5);
    // The hand rests on the slice boundary nearest the crown, so at rest it never seems to choose, however
    // many slices there are and however a ring of choices is turned. With eight slices that is the zero.
    function restAngle(m) {
      const target = crownAngle(m);
      let best = target;
      let gap = Infinity;
      for (const sl of m.slices) {
        const d = Math.abs(((((sl.a0 - target) % 360) + 540) % 360) - 180);
        if (d < gap - 1e-6) {
          gap = d;
          best = target + ((((sl.a0 - target) % 360) + 540) % 360) - 180;
        }
      }
      return best;
    }

    // One run of the chrono hand: from rest to the slice, the time it takes and when it arrives (ms).
    function runFor(m, i) {
      const sgn = m.dir === 'rtl' ? -1 : 1;
      const rest = restAngle(m);
      const d = (((sgn * (m.slices[i].mid - rest)) % 360) + 360) % 360 || 360;
      const dur = 150 + 260 * (d / 337.5);
      return { sgn, rest, d, start: 50, arrive: 50 + dur };
    }
    // The success sound ticks while the hand runs and clicks when it stops, so it reads the last run; before
    // the first, a run of half a turn.
    let lastRun = { sgn: 1, rest: -22.5, d: 180, start: 50, arrive: 339 };

    // The hand's angle at time t (ms): eases out of the start, settles into the slice with a small recoil.
    function handAt(k, t) {
      if (t <= k.start) return k.rest;
      if (t < k.arrive) {
        const u = (t - k.start) / (k.arrive - k.start);
        const e =
          u < 0.35 ? (u / 0.35) * (u / 0.35) * 0.35 * 0.6 : 0.21 + 0.79 * (1 - Math.pow(1 - (u - 0.35) / 0.65, 2.4));
        return k.rest + k.sgn * k.d * e;
      }
      const v = (t - k.arrive) / 140;
      const kick = v < 1 ? 2.2 * Math.sin(Math.PI * v * 1.5) * (1 - v) : 0;
      return k.rest + k.sgn * (k.d + kick);
    }
    const pushAt = (t, t0) => {
      const v = (t - t0) / 90;
      return v > 0 && v < 1 ? 4.5 * Math.sin(Math.PI * v) : 0;
    };

    // Which half of the escapement's beat the next tick is: tick and tock sound a little apart.
    let beat = 0;
    // A value changed by up to ±r of itself, so a run of the same sound never repeats exactly.
    const vary = (v, r) => v * (1 + (Math.random() * 2 - 1) * r);

    // One tooth of the gear train: a tiny steel part struck, ringing for a few milliseconds. A full beat of
    // the escapement adds a second partial, a dry edge and the pallet's second, higher click just after.
    function escape(ac, out, t, X, f, gain, full) {
      X.tone(ac, out, t, { f, dur: 0.006, gain, a: 0.001 });
      if (!full) return;
      X.tone(ac, out, t, { f: f * 1.47, dur: 0.004, gain: gain * 0.6, a: 0.001 });
      X.burst(ac, out, t, { type: 'bandpass', f: f * 1.2, q: 3, dur: 0.002, gain: gain * 2.2 });
      X.tone(ac, out, t + 0.0045, { f: f * 1.32, dur: 0.004, gain: gain * 0.5, a: 0.001 });
    }
    // The steel case ringing softly: three partials, the higher ones dying sooner.
    function ring(ac, out, t, X, gain, dur) {
      for (const [r, a] of [
        [1, 1],
        [1.51, 0.5],
        [2.27, 0.25],
      ]) {
        X.tone(ac, out, t, { f: 2650 * r, dur: dur * (1.2 - r * 0.3), gain: gain * a, a: 0.0015 });
      }
    }
    // A pusher: a firm click as it goes in, with the case's body and ring, and the clutch engaging just
    // after it.
    function pusher(ac, out, t, X, f, gain) {
      X.burst(ac, out, t, { type: 'bandpass', f, q: 2, dur: 0.008, gain });
      X.tone(ac, out, t, { f: 920, f2: 860, dur: 0.02, gain: gain * 0.2, a: 0.001 });
      X.burst(ac, out, t + 0.022, { type: 'bandpass', f: f * 0.7, q: 2.5, dur: 0.01, gain: gain * 0.45 });
      ring(ac, out, t + 0.001, X, gain * 0.06, 0.08);
    }

    function paintRun(root, k, t) {
      const a = handAt(k, t);
      root.querySelector('.kr-hand').setAttribute('transform', `rotate(${f2(a)} ${C} ${C})`);
      root.querySelector('.kr-push-start').setAttribute('transform', `translate(0 ${f2(pushAt(t, 0))})`);
      root.querySelector('.kr-push-stop').setAttribute('transform', `translate(0 ${f2(pushAt(t, k.arrive - 20))})`);
      const run = root.querySelector('.kr-run');
      const lo = k.sgn > 0 ? k.rest : Math.min(a, k.rest);
      const hi = k.sgn > 0 ? Math.max(a, k.rest + 0.01) : k.rest;
      run.setAttribute('d', hi - lo > 0.5 ? root.__krArc(R.trackIn + 4.5, lo, hi) : '');
      run.style.opacity = t < k.arrive ? '1' : f2(1 - clamp((t - k.arrive - 60) / 200));
      root.classList.toggle('kr-arrived', t >= k.arrive);
    }

    function stopFx(root) {
      if (root.__krStop) root.__krStop();
    }

    function render(root, m, H) {
      const u = H.uid('kronograf');
      const sgn = m.dir === 'rtl' ? -1 : 1;
      const zero = crownAngle(m);
      // Wider slices (fewer of them) give their labels more room, up to what the dial between the subdial
      // and the track holds.
      const wide = Math.min(86, Math.max(70, 2 * R.lbl * Math.sin(rad(Math.min(m.step, 180) / 2)) * 0.8));
      root.__krArc = H.arc;
      const defs = H.s('defs', {}, root);
      defs.innerHTML = `
      <linearGradient id="${u}-steel" gradientUnits="userSpaceOnUse" x1="70" y1="10" x2="330" y2="390">
        <stop offset="0" style="stop-color:var(--kr-steel-hi)"/><stop offset=".3" style="stop-color:var(--kr-steel)"/><stop offset=".55" style="stop-color:var(--kr-steel-hi)"/><stop offset="1" style="stop-color:var(--kr-steel-lo)"/></linearGradient>
      <linearGradient id="${u}-knurl" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style="stop-color:var(--kr-steel-lo)"/><stop offset=".45" style="stop-color:var(--kr-steel-hi)"/><stop offset="1" style="stop-color:var(--kr-steel-lo)"/></linearGradient>
      <radialGradient id="${u}-dial" gradientUnits="userSpaceOnUse" cx="170" cy="150" r="230">
        <stop offset="0" style="stop-color:var(--kr-dial-hi)"/><stop offset=".7" style="stop-color:var(--wheel-face)"/><stop offset="1" style="stop-color:var(--kr-dial-lo)"/></radialGradient>`;

      // Crown and pushers stick out of the case; drawn first so the case overlaps their stems.
      const parts = H.s('g', { class: 'kr-parts' }, root);
      const crown = H.s('g', { transform: `rotate(${f2(zero)} ${C} ${C})` }, parts);
      H.s('rect', { x: C - 5.5, y: C - 204, width: 11, height: 10, class: 'kr-stem', fill: `url(#${u}-knurl)` }, crown);
      H.s(
        'rect',
        { x: C - 13, y: C - 219, width: 26, height: 16, rx: 3.5, class: 'kr-crown', fill: `url(#${u}-knurl)` },
        crown,
      );
      let knurl = '';
      for (let x = -10; x <= 10; x += 2.5) knurl += `M${f2(C + x)} ${C - 217.5}V${C - 204.5}`;
      H.s('path', { d: knurl, class: 'kr-knurl' }, crown);
      for (const [side, cls] of [
        [1, 'kr-push-start'],
        [-1, 'kr-push-stop'],
      ]) {
        const g = H.s('g', { transform: `rotate(${f2(zero + sgn * side * 42)} ${C} ${C})` }, parts);
        const p = H.s('g', { class: cls }, g);
        H.s('rect', { x: C - 4, y: C - 204, width: 8, height: 10, class: 'kr-stem', fill: `url(#${u}-knurl)` }, p);
        H.s(
          'rect',
          { x: C - 8, y: C - 211, width: 16, height: 9, rx: 2.5, class: 'kr-pusher', fill: `url(#${u}-knurl)` },
          p,
        );
      }

      // Case and tachymeter bezel.
      const cs = H.s('g', { class: 'kr-case' }, root);
      H.s('circle', { cx: C, cy: C, r: R.case, fill: `url(#${u}-steel)` }, cs);
      H.s('circle', { cx: C, cy: C, r: R.case - 0.6, class: 'kr-case-edge' }, cs);
      H.s('circle', { cx: C, cy: C, r: R.caseIn + 0.4, class: 'kr-bezel' }, cs);
      let bt = '';
      for (let s = 6; s < 60; s += 1) {
        const a = zero + sgn * s * 6;
        const [x0, y0] = pol(R.caseIn - 1, a);
        const [x1, y1] = pol(R.caseIn - (s % 5 === 0 ? 4 : 2.4), a);
        bt += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
      }
      H.s('path', { d: bt, class: 'kr-bez-ticks' }, cs);
      for (const v of TACHY) {
        const a = zero + sgn * (3600 / v) * 6;
        const [x, y] = pol(176.6, a);
        const up = ((a % 360) + 360) % 360;
        const turn = up > 95 && up < 265 ? a + 180 : a;
        H.text(cs, f2(x), f2(y), String(v), { class: 'kr-tachy', transform: `rotate(${f2(turn)} ${f2(x)} ${f2(y)})` });
      }
      H.s('circle', { cx: C, cy: C, r: R.bezIn, class: 'kr-bez-in' }, cs);

      // Dial, seconds track.
      H.s('circle', { cx: C, cy: C, r: R.track + 1.5, fill: `url(#${u}-dial)`, class: 'kr-dial' }, root);
      let tr = '';
      for (let k = 0; k < 300; k++) {
        const a = zero + sgn * k * 1.2;
        const len = k % 25 === 0 ? 9 : k % 5 === 0 ? 5.5 : 2.4;
        const [x0, y0] = pol(R.track, a);
        const [x1, y1] = pol(R.track - len, a);
        tr += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
      }
      const track = H.s('g', { class: 'kr-track' }, root);
      H.s('path', { d: tr, class: 'kr-ticks' }, track);
      H.s('circle', { cx: C, cy: C, r: R.track, class: 'kr-track-line' }, track);
      H.s('circle', { cx: C, cy: C, r: R.trackIn, class: 'kr-track-line kr-track-thin' }, track);
      H.s('path', { d: '', class: 'kr-run' }, track);

      // Slices: a cell of the dial between the subdial and the track, its label and a lit arc on the track.
      for (const sl of m.slices) {
        const g = H.slice(root, sl, m);
        H.s('path', { d: H.sector(R.hub + 1, R.case, sl.a0, sl.a1), class: 'kr-hit' }, g);
        H.s('path', { d: H.sector(R.hub + 4, R.trackIn - 2.5, sl.a0 + 0.8, sl.a1 - 0.8), class: 'kr-cell' }, g);
        H.s('path', { d: H.arc(R.trackIn + 4.5, sl.a0 + 2, sl.a1 - 2), class: 'kr-mark' }, g);
      }
      // Boundaries as fine printed rules.
      let rules = '';
      for (const sl of m.slices) {
        const [x0, y0] = pol(R.hub + 4, sl.a0);
        const [x1, y1] = pol(R.trackIn - 2, sl.a0);
        rules += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
      }
      H.s('path', { d: rules, class: 'kr-rules' }, root);

      // The chrono hand: a thin needle with a counterweight hidden under the subdial and a ring near its tip.
      const hand = H.s('g', { class: 'kr-hand' }, root);
      H.s('path', { d: `M${C} ${C - R.hub + 3}V${C - R.hand}`, class: 'kr-hand-edge' }, hand);
      H.s('path', { d: `M${C} ${C - R.hub + 3}V${C - R.hand}`, class: 'kr-hand-line' }, hand);
      H.s('circle', { cx: C, cy: C - R.pop, r: 4, class: 'kr-pop' }, hand);

      // The labels lie over the hand, with a halo in the cell's color, so the hand passes under the words;
      // update() mirrors each slice's state onto its label here.
      const names = H.s('g', { class: 'kr-names' }, root);
      for (const sl of m.slices) {
        const c = H.s('g', { class: 'kr-ink' + (sl.off ? ' is-off' : ''), 'data-for': sl.i }, names);
        c.style.setProperty('--i', sl.i);
        // A format is printed large, with its second line where it has one; tools and actions get an icon.
        if (sl.format) {
          H.block(c, sl, R.lbl, {
            size: 21,
            subSize: 12.5,
            gap: 1.5,
            maxWidth: wide,
            minSize: 9,
            cls: 'kr-lbl kr-fmt',
            subCls: 'kr-sub',
          });
        } else {
          H.block(c, sl, R.lbl, {
            icon: true,
            iconSize: 20,
            size: 13,
            gap: 3,
            maxWidth: wide,
            minSize: 8.5,
            cls: 'kr-lbl',
            sub: null,
          });
        }
        // More choices: an arrowhead at the top of the cell, just under the track, above the hand.
        H.ringMark(c, sl, m, { r: R.trackIn - 5.5, size: 9.5, halo: 1.3, cls: 'kr-ring-mark' });
      }

      // Hub: the counter subdial with its own fine track and the wheel's name.
      const hub = H.s('g', { class: 'kr-hub' }, root);
      H.s('circle', { cx: C, cy: C, r: R.hub + 1.5, class: 'kr-hub-rim' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.hub, class: 'kr-hub-face' }, hub);
      let az = '';
      for (let r = 8; r < R.hub - 9; r += 3.2)
        az += `M${C} ${f2(C - r)}a${f2(r)} ${f2(r)} 0 1 1 0 ${f2(2 * r)}a${f2(r)} ${f2(r)} 0 1 1 0 ${f2(-2 * r)}`;
      H.s('path', { d: az, class: 'kr-azurage' }, hub);
      let ht = '';
      for (let k = 0; k < 30; k++) {
        const a = zero + sgn * k * 12;
        const [x0, y0] = pol(R.hub - 1.5, a);
        const [x1, y1] = pol(R.hub - (k % 5 === 0 ? 7 : 4), a);
        ht += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
      }
      H.s('path', { d: ht, class: 'kr-hub-ticks' }, hub);
      H.label(hub, C, C - 16.5, m.title.toLocaleUpperCase(m.lang), {
        maxWidth: 84,
        size: 12,
        minSize: 8,
        cls: 'kr-title',
        maxLines: 1,
      });
      H.label(hub, C, C + 1.5, m.file, {
        maxWidth: 84,
        size: 11,
        minSize: 8,
        cls: 'kr-file',
        maxLines: 1,
        attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
      });
      // The key that opened the wheel, when one did.
      if (m.key) {
        const kt = H.text(hub, C, C + 22.4, m.key.toLocaleUpperCase('en'), { class: 'kr-keytext' });
        const kw = kt.getComputedTextLength() + 12;
        hub.insertBefore(
          H.s('rect', { x: f2(C - kw / 2), y: C + 15, width: f2(kw), height: 15, rx: 3, class: 'kr-key' }),
          kt,
        );
      }
      H.s('circle', { cx: C, cy: C, r: 2.6, class: 'kr-pin' }, hub);
      // Crystal: light on the glass.
      H.s('path', { d: H.arc(R.bezIn - 6, 296, 338), class: 'kr-glint' }, root);
    }

    // The hand rests by the crown and stays on the chosen slice; hovering only marks the slice.
    function update(root, m, st) {
      root.querySelectorAll('.kr-ink').forEach((g) => {
        const i = +g.dataset.for;
        g.classList.toggle('is-hover', i === st.hover);
        g.classList.toggle('is-selected', i === st.selected);
      });
      if (root.__krStop) return;
      const a = st.selected == null ? restAngle(m) : m.slices[st.selected].mid;
      root.querySelector('.kr-hand').setAttribute('transform', `rotate(${f2(a)} ${C} ${C})`);
      root.classList.toggle('kr-arrived', st.selected != null);
    }

    Board.define({
      id: 'kronograf',
      fonts: {
        brand: "'Sofia Sans'",
        display: "'Sofia Sans Condensed'",
        load: ["'Sofia Sans Condensed'", "'Sofia Sans'"],
        credits: [
          { family: 'Sofia Sans Condensed', license: 'SIL Open Font License 1.1' },
          { family: 'Sofia Sans', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 110, stagger: 9, apply: APPLY },

      palette: {
        light: {
          bg: '#f1f2f3',
          surface: '#ffffff',
          'surface-2': '#f5f6f7',
          border: '#dadde1',
          'border-strong': '#a3a9b0',
          text: '#15171a',
          'text-muted': '#545a62',
          accent: '#c4420f',
          'on-accent': '#ffffff',
          focus: '#c4420f',
          success: '#1f7a4f',
          'on-success': '#ffffff',
          'success-text': '#196942',
          warning: '#b7791f',
          'warning-text': '#7a4f0f',
          danger: '#c4302b',
          desk: 'linear-gradient(155deg, #f5f3ef 0%, #e9ebee 55%, #dde2e7 100%)',
          'wheel-face': '#f5f4f0',
          'wheel-slice': '#f5f4f0',
          'wheel-slice-hover': '#e6e4dd',
          'wheel-slice-selected': '#17191c',
          'wheel-text': '#15171a',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#15171a',
          'wheel-shadow': 'rgba(30, 36, 44, 0.32)',
          'kr-sub': '#4b5058',
          'kr-dial-hi': '#ffffff',
          'kr-dial-lo': '#e3e2dc',
          'kr-print': '#15171a',
          'kr-steel-hi': '#fbfcfd',
          'kr-steel': '#c3c9cf',
          'kr-steel-lo': '#7b848d',
          'kr-steel-edge': '#5f6870',
          'kr-bezel': '#1a1c1f',
          'kr-bezel-ink': '#f3f1ea',
          'kr-hub': '#17191c',
          'kr-hub-ink': '#f5f4f0',
          'kr-hub-line': 'rgba(245, 244, 240, 0.55)',
          'kr-azurage': 'rgba(255, 255, 255, 0.07)',
          'kr-hand': '#f05a1a',
          'kr-hand-edge': '#7a2405',
          'kr-mark': '#f05a1a',
          'kr-key': '#2a2d31',
          'kr-glint-opacity': '0.75',
        },
        dark: {
          bg: '#101113',
          surface: '#18191c',
          'surface-2': '#1f2124',
          border: '#2c2f33',
          'border-strong': '#4a4e54',
          text: '#f1ece1',
          'text-muted': '#aaa9a4',
          accent: '#ff8a3d',
          'on-accent': '#1d0c03',
          focus: '#ffa060',
          success: '#5cc58e',
          'on-success': '#07200f',
          'success-text': '#6fd39f',
          warning: '#e9b44c',
          'warning-text': '#f0c46a',
          danger: '#ff6b5b',
          desk: 'radial-gradient(circle at 34% 20%, #2a2b2e 0%, #17181b 55%, #0e0f11 100%)',
          'wheel-face': '#141619',
          'wheel-slice': '#141619',
          'wheel-slice-hover': '#272a2f',
          'wheel-slice-selected': '#ece4cf',
          'wheel-text': '#f1ebdc',
          'wheel-text-selected': '#17150f',
          'wheel-line': '#f1ebdc',
          'wheel-shadow': 'rgba(0, 0, 0, 0.66)',
          'kr-sub': '#bdb6a6',
          'kr-dial-hi': '#24272b',
          'kr-dial-lo': '#0b0c0e',
          'kr-print': '#efe8d6',
          'kr-steel-hi': '#c7cdd3',
          'kr-steel': '#6c747c',
          'kr-steel-lo': '#2c3136',
          'kr-steel-edge': '#1a1d20',
          'kr-bezel': '#0c0d0f',
          'kr-bezel-ink': '#e6dfcc',
          'kr-hub': '#ece4cf',
          'kr-hub-ink': '#17150f',
          'kr-hub-line': 'rgba(23, 21, 15, 0.5)',
          'kr-azurage': 'rgba(0, 0, 0, 0.06)',
          'kr-hand': '#ff8a3d',
          'kr-hand-edge': '#5c2206',
          'kr-mark': '#ff8a3d',
          'kr-key': '#dcd3bb',
          'kr-glint-opacity': '0.28',
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
        ['kr-sub', 'wheel-slice', 'text'],
        ['kr-sub', 'wheel-slice-hover', 'text'],
        ['kr-hub-ink', 'kr-hub', 'text'],
        ['kr-bezel-ink', 'kr-bezel', 'text'],
      ],

      // No shared defs: every gradient and pattern is made per wheel in render(), because its colors come
      // from the palette tokens of the wheel's own light or dark figure.
      defs: '',
      wheel: {
        render,
        update,
        onOpen(root) {
          stopFx(root);
        },
        onSelect(root, m, i, H, t) {
          stopFx(root);
          const k = runFor(m, i);
          lastRun = k;
          if (t == null && (reducedMotion() || !window.requestAnimationFrame)) return;
          if (t != null) {
            paintRun(root, k, t);
            return;
          }
          const t0 = performance.now();
          root.__krStop = () => {
            cancelAnimationFrame(root.__krRaf);
            root.__krStop = null;
            paintRun(root, k, APPLY);
            root.querySelector('.kr-run').setAttribute('d', '');
          };
          const step = () => {
            const tt = performance.now() - t0;
            if (!root.isConnected || tt >= APPLY) return stopFx(root);
            paintRun(root, k, tt);
            root.__krRaf = requestAnimationFrame(step);
          };
          paintRun(root, k, 0);
          root.__krRaf = requestAnimationFrame(step);
        },
      },

      // Fine steel: tiny escapement ticks, alternately tick and tock, firm pushers and the case's small ring.
      sounds: {
        open(ac, out, t, X) {
          // The crown is wound as the glint turns in (kronograf-glint): fine ratchet clicks, the spring
          // settles with a small ring of steel, and the escapement starts: tick, tock.
          for (let k = 0; k < 6; k++) {
            escape(ac, out, t + 0.012 * k * (1 + 0.15 * k), X, 2900 + 160 * k, 0.0132 + 0.003 * k, false);
          }
          ring(ac, out, t + 0.15, X, 0.01, 0.22);
          escape(ac, out, t + 0.27, X, 4200, 0.023, true);
          escape(ac, out, t + 0.41, X, 3600, 0.019, true);
        },
        tick(ac, out, t, X) {
          // One beat of the escapement, alternately tick and tock, never twice the same.
          beat = 1 - beat;
          escape(ac, out, t, X, vary(beat ? 4200 : 3600, 0.02), vary(0.046, 0.1), true);
        },
        enter(ac, out, t, X) {
          // Into a ring: a pusher goes in, a firm two-part click with the case's small ring.
          pusher(ac, out, t, X, 2500, 0.16);
        },
        leave(ac, out, t, X) {
          // Back out: reset, the hammer snaps the hand back to zero in a quick whirr of tiny clicks.
          X.burst(ac, out, t, { type: 'bandpass', f: 3100, q: 2.2, dur: 0.006, gain: 0.08 });
          for (let k = 0; k < 6; k++) escape(ac, out, t + 0.01 + 0.007 * k, X, 4800 - 150 * k, 0.012, false);
          X.burst(ac, out, t + 0.06, { type: 'bandpass', f: 2400, q: 2, dur: 0.01, gain: 0.14 });
          X.tone(ac, out, t + 0.06, { f: 880, f2: 800, dur: 0.02, gain: 0.03, a: 0.001 });
        },
        success(ac, out, t, X) {
          const k = lastRun;
          const at = (ms) => t + ms / 1000;
          // Start: the pusher goes in and the clutch engages.
          pusher(ac, out, t, X, 2500, 0.12);
          // The hand runs: the gear train ticks once per mark of the seconds track it passes, quickening
          // into a buzz and slowing again.
          let mark = 0;
          let last = -Infinity;
          for (let ms = k.start; ms < k.arrive - 12; ms++) {
            const now = Math.floor((k.sgn * (handAt(k, ms) - k.rest)) / 7.5);
            if (now > mark && ms - last >= 5) {
              escape(ac, out, at(ms), X, vary(5000, 0.04), 0.0105, false);
              last = ms;
            }
            mark = Math.max(mark, now);
          }
          // Stop: the other pusher, a touch higher, the hand's two recoil ticks, and the case ringing
          // softly as the slice is stamped (kronograf-stamp).
          pusher(ac, out, at(k.arrive - 10), X, 2800, 0.13);
          escape(ac, out, at(k.arrive + 25), X, 4400, 0.012, false);
          escape(ac, out, at(k.arrive + 62), X, 4000, 0.008, false);
          ring(ac, out, at(k.arrive), X, 0.0088, 0.26);
        },
      },
    });
  })();
}
