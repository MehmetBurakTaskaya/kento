// SPDX-License-Identifier: MIT
// Dart tahtası: a dartboard of our own design. Eight sectors alternate chalk and navy sisal, each
// with a teal or coral treble and double segment, under a silver wire spider; the bullseye is the
// hub and the outer ring carries a chevron for each sector instead of numbers. Applying a slice
// throws a dart into its double ring: it lands with a thud, the board jolts and the dart wobbles still.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const f2 = (n) => Math.round(n * 100) / 100;
    const R = { rim: 197, ring: 181, d1: 180, d0: 170, t1: 82, t0: 70, bullOut: 69, bull: 58, lbl: 126, tip: 175 };
    const polar = (r, a) => [C + r * Math.sin((a * Math.PI) / 180), C - r * Math.cos((a * Math.PI) / 180)];

    // Our dart, drawn pointing up from its tip at (0, 0), foreshortened as if it leans toward you.
    function dart(parent, H) {
      const fly = H.s('g', { class: 'dt-fly' }, parent);
      const wob = H.s('g', { class: 'dt-wob' }, fly);
      H.s('path', { d: 'M0 0L-1.1-9.5H1.1Z', class: 'dt-point' }, wob);
      H.s('path', { d: 'M-2.6-9.5H2.6L3.3-12.5V-24.5L2.2-27H-2.2L-3.3-24.5V-12.5Z', class: 'dt-barrel' }, wob);
      H.s('path', { d: 'M-3.3-15H3.3M-3.3-18H3.3M-3.3-21H3.3', class: 'dt-knurl' }, wob);
      H.s('path', { d: 'M-1.2-27H1.2V-36H-1.2Z', class: 'dt-shaft' }, wob);
      H.s('path', { d: 'M0-31L-9.5-41.5L-8-46L0-39.5Z', class: 'dt-flight-a' }, wob);
      H.s('path', { d: 'M0-31L9.5-41.5L8-46L0-39.5Z', class: 'dt-flight-b' }, wob);
      H.s('path', { d: 'M-1.4-33.4L0-48L1.4-33.4Z', class: 'dt-flight-c' }, wob);
      return fly;
    }

    function hub(root, m, H) {
      const g = H.s('g', { class: 'dt-hub' }, root);
      H.s('circle', { cx: C, cy: C, r: R.bullOut, class: 'dt-bull-out' }, g);
      H.s('circle', { cx: C, cy: C, r: R.bull, class: 'dt-bull' }, g);
      H.s('circle', { cx: C, cy: C, r: R.bull - 3.5, class: 'dt-bull-ring' }, g);
      H.s('circle', { cx: C, cy: C, r: R.bullOut, class: 'dt-wire-c' }, g);
      H.s('circle', { cx: C, cy: C, r: R.bull, class: 'dt-wire-c' }, g);
      // Without a key the title and file sit lower, in the middle of the bull.
      const dy = m.key ? 0 : 8;
      H.label(g, C, C - 14 + dy, m.title, { maxWidth: 84, size: 19, minSize: 12, maxLines: 1, cls: 'dt-title' });
      H.label(g, C, C + 4 + dy, m.file, { maxWidth: 76, size: 12, minSize: 9, maxLines: 1, cls: 'dt-file' });
      if (!m.key) return;
      const kw = 14 + m.key.length * 6.2;
      H.s('rect', { x: f2(C - kw / 2), y: C + 14, width: f2(kw), height: 16, rx: 3, class: 'dt-key' }, g);
      H.text(g, C, C + 22.4, m.key, { class: 'dt-keytext' });
    }

    // A value changed by up to ±r of itself, so a run of the same sound never repeats exactly.
    const vary = (v, r) => v * (1 + (Math.random() * 2 - 1) * r);

    // The wire spider shimmering: three thin steel partials, the higher ones dying sooner.
    function wires(ac, out, t, X, gain, dur) {
      X.tone(ac, out, t, { f: vary(2380, 0.02), dur, gain, a: 0.002 });
      X.tone(ac, out, t, { f: vary(3270, 0.02), dur: dur * 0.75, gain: gain * 0.7, a: 0.002 });
      X.tone(ac, out, t, { f: vary(4410, 0.02), dur: dur * 0.5, gain: gain * 0.5, a: 0.002 });
    }

    // The dart in flight: air that rises in pitch and grows as it comes closer, pulsed by its fluttering
    // flights, cut off as it lands.
    function flight(ac, out, t, hit, X) {
      const src = ac.createBufferSource();
      src.buffer = X.noise(ac);
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.1;
      band.frequency.setValueAtTime(650, t);
      band.frequency.exponentialRampToValueAtTime(2300, hit);
      const flutter = ac.createGain();
      flutter.gain.value = 0.65;
      const lfo = ac.createOscillator();
      lfo.frequency.setValueAtTime(38, t);
      lfo.frequency.linearRampToValueAtTime(56, hit);
      const depth = ac.createGain();
      depth.gain.value = 0.35;
      const g = ac.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.041, hit - 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, hit + 0.025);
      lfo.connect(depth).connect(flutter.gain);
      src.connect(band).connect(flutter).connect(g).connect(out);
      src.start(t, Math.random() * 0.4);
      lfo.start(t);
      src.stop(hit + 0.06);
      lfo.stop(hit + 0.06);
    }

    // The dart quivering in the board after it lands (470 ms, as dart-wobble): a buzzing twang whose
    // pitch sways with the swing, loud twice per swing as the dart passes upright, darkening and dying.
    function quiver(ac, out, t) {
      const end = t + 0.47;
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(194, t);
      o.frequency.exponentialRampToValueAtTime(181, end);
      const sway = ac.createOscillator();
      sway.frequency.value = 6.4;
      const swayDepth = ac.createGain();
      swayDepth.gain.value = 3;
      sway.connect(swayDepth).connect(o.frequency);
      const tone = ac.createBiquadFilter();
      tone.type = 'lowpass';
      tone.Q.value = 0.9;
      tone.frequency.setValueAtTime(1700, t);
      tone.frequency.exponentialRampToValueAtTime(650, end);
      const beat = ac.createGain();
      beat.gain.value = 0.5;
      const lfo = ac.createOscillator();
      lfo.frequency.setValueAtTime(12.8, t);
      lfo.frequency.linearRampToValueAtTime(9, end);
      const lfoDepth = ac.createGain();
      lfoDepth.gain.value = 0.5;
      lfo.connect(lfoDepth).connect(beat.gain);
      const g = ac.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.027, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(tone).connect(beat).connect(g).connect(out);
      for (const n of [o, sway, lfo]) {
        n.start(t);
        n.stop(end + 0.03);
      }
    }

    Board.define({
      id: 'dart',
      fonts: {
        brand: "'Barlow Condensed'",
        load: ["'Barlow Condensed'"],
        credits: [{ family: 'Barlow Condensed', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 160, close: 110, stagger: 9, apply: 640 },
      palette: {
        light: {
          bg: '#f1f2f4',
          surface: '#ffffff',
          'surface-2': '#eef0f3',
          border: '#d6dae1',
          'border-strong': '#9aa3b1',
          text: '#161c2a',
          'text-muted': '#525c6e',
          accent: '#c93a2a',
          'on-accent': '#ffffff',
          focus: '#1f6f8b',
          success: '#1d7f5f',
          'on-success': '#ffffff',
          'success-text': '#18694f',
          warning: '#c98a12',
          'warning-text': '#875800',
          danger: '#c0392b',
          desk: 'linear-gradient(170deg, #eaeef3 0%, #d2d9e2 100%)',
          'wheel-face': '#141c2e',
          'wheel-slice': '#f0ebdf',
          'wheel-slice-hover': '#fde7b0',
          'wheel-slice-selected': '#f5c33b',
          'wheel-text': '#18223a',
          'wheel-text-selected': '#18223a',
          'wheel-line': '#bcc4cf',
          'wheel-shadow': 'rgba(20, 28, 46, 0.34)',
          'dt-sub': '#8a2f22',
          'dt-sub-selected': '#5a1e14',
          'dt-alt': '#1f2b45',
          'dt-alt-hover': '#30436e',
          'dt-text-alt': '#f4efe4',
          'dt-sub-alt': '#ffb8a8',
          'dt-red': '#d6402f',
          'dt-green': '#14857a',
          'dt-third': '#3d5573',
          'dt-third-hover': '#4a6488',
          'dt-sub-third': '#ffd8cf',
          'dt-chalk': '#e8e1d1',
          'dt-red-sel': '#ffdf7e',
          'dt-green-sel': '#ffdf7e',
          'dt-wire-hi': '#ffffff',
          'dt-ring': '#141c2e',
          'dt-chevron': '#e6eaf0',
          'dt-bull-out': '#14857a',
          'dt-bull': '#141c2e',
          'dt-bull-ring': '#d6402f',
          'dt-title': '#ffffff',
          'dt-file': '#bcc6d8',
          'dt-key': '#2b3652',
          'dt-keytext': '#e6ebf3',
          'dt-steel': '#c7ccd4',
          'dt-steel-dark': '#6b7484',
          'dt-flight': '#d6402f',
          'dt-flight-2': '#a52a1d',
          'dt-shaft': '#1b2233',
          'dt-spot-opacity': '0',
          'dt-sisal-opacity': '1',
        },
        dark: {
          bg: '#0d0f14',
          surface: '#151922',
          'surface-2': '#1c212c',
          border: '#2a303d',
          'border-strong': '#4a5366',
          text: '#eef1f6',
          'text-muted': '#a3abba',
          accent: '#ff6b57',
          'on-accent': '#2a0d07',
          focus: '#ffd166',
          success: '#4cc99a',
          'on-success': '#04261a',
          'success-text': '#6dd8ae',
          warning: '#f2c14e',
          'warning-text': '#f6d37d',
          danger: '#ff7066',
          desk: 'radial-gradient(56% 56% at 50% 46%, #333a4a 0%, #191d26 50%, #0a0b0f 100%)',
          'wheel-face': '#07090e',
          'wheel-slice': '#e4ddcd',
          'wheel-slice-hover': '#ffe9a8',
          'wheel-slice-selected': '#ffd166',
          'wheel-text': '#131a2c',
          'wheel-text-selected': '#131a2c',
          'wheel-line': '#dfe5ee',
          'wheel-shadow': 'rgba(0, 0, 0, 0.7)',
          'dt-sub': '#8a2c1e',
          'dt-sub-selected': '#5a1e14',
          'dt-alt': '#121a2d',
          'dt-alt-hover': '#24345c',
          'dt-text-alt': '#f2ece0',
          'dt-sub-alt': '#ff9d88',
          'dt-red': '#ff5a45',
          'dt-green': '#1fb5a3',
          'dt-third': '#28405e',
          'dt-third-hover': '#35537a',
          'dt-sub-third': '#ffc4b5',
          'dt-chalk': '#d9d1bf',
          'dt-red-sel': '#ffe08a',
          'dt-green-sel': '#ffe08a',
          'dt-wire-hi': '#ffffff',
          'dt-ring': '#07090e',
          'dt-chevron': '#ffd166',
          'dt-bull-out': '#1fb5a3',
          'dt-bull': '#07090e',
          'dt-bull-ring': '#ff5a45',
          'dt-title': '#ffffff',
          'dt-file': '#aeb9cf',
          'dt-key': '#212a40',
          'dt-keytext': '#e6ebf3',
          'dt-steel': '#dfe4ea',
          'dt-steel-dark': '#7c8596',
          'dt-flight': '#ffd166',
          'dt-flight-2': '#d9a52c',
          'dt-shaft': '#0d121e',
          'dt-spot-opacity': '0.55',
          'dt-sisal-opacity': '1',
        },
      },
      contrast: Board.DEFAULT_PAIRS.concat([
        ['dt-sub', 'wheel-slice', 'text'],
        ['dt-sub', 'wheel-slice-hover', 'text'],
        ['dt-sub-selected', 'wheel-slice-selected', 'text'],
        ['dt-text-alt', 'dt-alt', 'text'],
        ['dt-text-alt', 'dt-alt-hover', 'text'],
        ['dt-sub-alt', 'dt-alt', 'text'],
        ['dt-sub-alt', 'dt-alt-hover', 'text'],
        ['dt-text-alt', 'dt-third', 'text'],
        ['dt-text-alt', 'dt-third-hover', 'text'],
        ['dt-sub-third', 'dt-third', 'text'],
        ['dt-sub-third', 'dt-third-hover', 'text'],
        ['dt-title', 'dt-bull', 'text'],
        ['dt-file', 'dt-bull', 'text'],
      ]),
      // Sisal: short fibres at random angles, as a tiny tile.
      defs: `
      <pattern id="dart-sisal" width="7" height="7" patternUnits="userSpaceOnUse">
        <path d="M1 1.2l1.4.7M4.6 2.4l.6 1.3M2.2 4.8l1.3-.5M5.4 5.6l1.2.6M.6 6.2l.4-1.2" stroke="#000000" stroke-opacity=".09" stroke-width=".6" stroke-linecap="round"/>
        <path d="M3 .4l.9 1M6.2.8l-.9.8M1.4 3.4l1 .6M4.2 6.4l1.1-.4" stroke="#ffffff" stroke-opacity=".1" stroke-width=".6" stroke-linecap="round"/>
      </pattern>`,

      wheel: {
        render(root, m, H) {
          const uid = H.uid('dart');
          const defs = H.s('defs', {}, root);
          const spot = H.s(
            'radialGradient',
            { id: uid + '-spot', cx: C, cy: C - 20, r: R.rim + 20, gradientUnits: 'userSpaceOnUse' },
            defs,
          );
          H.s('stop', { offset: 0.35, 'stop-color': '#000000', 'stop-opacity': 0 }, spot);
          H.s('stop', { offset: 1, 'stop-color': '#000000', 'stop-opacity': 0.75 }, spot);

          // The surround ring with a chevron for each sector.
          const base = H.s('g', { class: 'dt-base', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: C, cy: C, r: R.rim, class: 'dt-ring' }, base);
          let chev = '';
          for (const sl of m.slices) {
            const [x, y] = polar((R.ring + R.rim) / 2, sl.mid);
            const a = (sl.mid * Math.PI) / 180;
            const ux = Math.sin(a),
              uy = -Math.cos(a),
              vx = Math.cos(a),
              vy = Math.sin(a);
            const P = (u, v) => f2(x + ux * u + vx * v) + ' ' + f2(y + uy * u + vy * v);
            chev += `M${P(4.4, -6.6)}L${P(-3.6, 0)}L${P(4.4, 6.6)}L${P(1.4, 0)}Z`;
          }
          H.s('path', { d: chev, class: 'dt-chevron' }, base);

          // Sectors alternate; with an odd count the last one, which would match the first, takes a third
          // colour with its own rings, so no two neighbours are ever alike.
          for (const sl of m.slices) {
            const third = m.n > 1 && m.n % 2 === 1 && sl.i === m.n - 1;
            const alt = !third && sl.i % 2 === 1;
            const rings = third ? 'dt-chalk' : alt ? 'dt-red' : 'dt-green';
            const g = H.slice(root, sl, m);
            g.classList.add(third ? 'dt-third' : alt ? 'dt-odd' : 'dt-even');
            H.s('path', { d: H.sector(R.t0, R.d1, sl.a0, sl.a1), class: 'dt-single' }, g);
            H.s('path', { d: H.sector(R.t0, R.t1, sl.a0, sl.a1), class: 'dt-treble ' + rings }, g);
            H.s('path', { d: H.sector(R.d0, R.d1, sl.a0, sl.a1), class: 'dt-double ' + rings }, g);
            H.s('path', { d: H.sector(R.t0, R.d1, sl.a0, sl.a1), class: 'dt-sisal', fill: 'url(#dart-sisal)' }, g);
            const c = H.s('g', { class: 'dt-ink' }, g);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 27,
                subSize: 15,
                gap: 0,
                maxWidth: 74,
                minSize: 12,
                cls: 'dt-lbl dt-fmt',
                subCls: 'dt-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 23,
                size: 17,
                gap: 3,
                maxWidth: 76,
                minSize: 10,
                cls: 'dt-lbl dt-word',
                sub: null,
              });
            }
            // More choices: a flight-shaped arrowhead in the sector just under the double ring, pointing
            // out, in the sector's lettering colour.
            H.ringMark(c, sl, m, { r: R.d0 - 3, size: 10.5, shape: 'dart', cls: 'dt-ring-mark' });
          }

          // Spotlight falloff (dark mode), then the wire spider.
          H.s('circle', { cx: C, cy: C, r: R.rim, class: 'dt-spot', fill: `url(#${uid}-spot)` }, root);
          const wires = H.s('g', { class: 'dt-wires', 'aria-hidden': 'true' }, root);
          let d = '';
          for (const sl of m.slices) {
            const [x0, y0] = polar(R.t0, sl.a0);
            const [x1, y1] = polar(R.ring, sl.a0);
            d += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d, class: 'dt-wire' }, wires);
          for (const r of [R.t0, R.t1, R.d0, R.d1]) H.s('circle', { cx: C, cy: C, r, class: 'dt-wire-c' }, wires);
          H.s('circle', { cx: C, cy: C, r: R.ring + 0.6, class: 'dt-catch' }, wires);

          hub(root, m, H);

          // One dart per sector, in its double ring, shown only for the chosen one; it sits above the wires
          // and leans out over the surround, clear of the labels.
          const darts = H.s('g', { class: 'dt-darts', 'aria-hidden': 'true' }, root);
          for (const sl of m.slices) {
            const [tx, ty] = polar(R.tip, sl.mid - sl.step * 0.2);
            const holder = H.s(
              'g',
              { class: 'dt-dart', 'data-for': sl.i, transform: `translate(${f2(tx)} ${f2(ty)})` },
              darts,
            );
            H.s('circle', { cx: 0, cy: 0, r: 9, class: 'dt-puff' }, holder);
            H.s('path', { d: 'M0 0L11 7', class: 'dt-shadow' }, holder);
            dart(H.s('g', { transform: `rotate(${f2(sl.mid + 66)}) scale(1.4)` }, holder), H);
          }
        },

        update(root, m, st) {
          root.querySelectorAll('.dt-dart').forEach((d) => d.classList.toggle('is-on', +d.dataset.for === st.selected));
        },
      },

      // Sisal, steel and feathers: dull fibre knocks, the thin ring of the wire spider and the barrel, air.
      sounds: {
        // The board swings up on its hook: a breath of air, a soft knock on the wall, the wires shimmering.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 520, f2: 1500, q: 0.9, dur: 0.05, gain: 0.021, a: 0.07 });
          const k = t + 0.115;
          X.burst(ac, out, k, { type: 'lowpass', f: 760, q: 0.8, dur: 0.045, gain: 0.042 });
          X.tone(ac, out, k, { f: 182, f2: 138, dur: 0.085, gain: 0.042, a: 0.002 });
          X.burst(ac, out, k + 0.06, { type: 'lowpass', f: 620, q: 0.8, dur: 0.03, gain: 0.015 });
          X.tone(ac, out, k + 0.06, { f: 164, f2: 140, dur: 0.05, gain: 0.015, a: 0.002 });
          wires(ac, out, k + 0.004, X, 0.0036, 0.2);
        },
        // The pointer brushes a wire: a muted tap on sisal with a faint ring of thin steel.
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: vary(1150, 0.08), q: 1.2, dur: 0.012, gain: vary(0.11, 0.15) });
          const body = vary(410, 0.05);
          X.tone(ac, out, t, { f: body, f2: body * 0.82, dur: 0.02, gain: 0.03, a: 0.001 });
          X.tone(ac, out, t + 0.001, { f: vary(3150, 0.04), dur: 0.035, gain: vary(0.009, 0.2), a: 0.001 });
        },
        // Into a ring: a dart pressed into the sisal, a firm thock and its barrel's brief ring.
        enter(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'lowpass', f: 1300, q: 0.9, dur: 0.028, gain: 0.043 });
          X.burst(ac, out, t, { type: 'bandpass', f: 2300, q: 1.6, dur: 0.01, gain: 0.016 });
          X.tone(ac, out, t, { f: 235, f2: 150, dur: 0.06, gain: 0.027, a: 0.002 });
          X.tone(ac, out, t + 0.003, { type: 'triangle', f: 1240, dur: 0.07, gain: 0.0032, a: 0.002 });
          X.tone(ac, out, t + 0.003, { f: 1262, dur: 0.06, gain: 0.0022, a: 0.002 });
        },
        // Back out: the dart pulled out, a dry fibrous scrape, then the tip slips free.
        leave(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 1300, f2: 2500, q: 2.2, dur: 0.03, gain: 0.04, a: 0.02 });
          X.burst(ac, out, t + 0.018, {
            type: 'bandpass',
            f: 1900,
            f2: 3000,
            q: 2.6,
            dur: 0.025,
            gain: 0.035,
            a: 0.01,
          });
          const free = t + 0.06;
          X.burst(ac, out, free, { type: 'bandpass', f: 2900, q: 3, dur: 0.006, gain: 0.07 });
          X.tone(ac, out, free, { f: 880, f2: 640, dur: 0.02, gain: 0.025, a: 0.001 });
          X.tone(ac, out, free + 0.002, { type: 'triangle', f: 1240, dur: 0.05, gain: 0.004, a: 0.002 });
        },
        // The throw: the flight's air grows for 170 ms, a thud into sisal, the board knocks on the wall as
        // it jolts, and the dart quivers still with a buzzing twang (dart-wobble).
        success(ac, out, t, X) {
          const hit = t + 0.17;
          flight(ac, out, t, hit, X);
          X.tone(ac, out, hit, { f: 205, f2: 118, dur: 0.12, gain: 0.082, a: 0.002 });
          X.burst(ac, out, hit, { type: 'lowpass', f: 1000, q: 0.7, dur: 0.05, gain: 0.082 });
          X.burst(ac, out, hit, { type: 'bandpass', f: 2400, q: 1.5, dur: 0.018, gain: 0.034 });
          X.burst(ac, out, hit + 0.028, { type: 'lowpass', f: 520, q: 0.8, dur: 0.035, gain: 0.027 });
          X.tone(ac, out, hit + 0.028, { f: 158, f2: 130, dur: 0.05, gain: 0.02, a: 0.002 });
          wires(ac, out, hit + 0.002, X, 0.0027, 0.16);
          quiver(ac, out, hit + 0.004);
        },
      },
    });
  })();
}
