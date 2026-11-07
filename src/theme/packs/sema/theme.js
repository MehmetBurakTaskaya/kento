// SPDX-License-Identifier: MIT
// Sema: a whirling skirt seen from above. The slices are its pleats, curving outward as the fabric
// trails the turn, with a wavy hem; the felt hat's crown is the hub. Applying a slice turns the
// skirt a quarter round under the labels, its hem flaring out and settling, while a soft reed note sounds.
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const f2 = (n) => Math.round(n * 100) / 100;
    const R = { hat: 54, belt: 61, waist: 66, hem: 181, wave: 5.5, lbl: 128 };
    const TWIST = 17; // degrees the fold has trailed by the time it reaches the hem
    const polar = (r, a) => [C + r * Math.sin((a * Math.PI) / 180), C - r * Math.cos((a * Math.PI) / 180)];
    const twist = (r) => TWIST * Math.pow(Math.max(0, Math.min(1, (r - R.waist) / (R.hem - R.waist))), 1.5);

    // The hem: crests on the pleats' ridges, troughs at their valleys.
    function hemR(a, valley, period) {
      return R.hem + R.wave * Math.cos(((a - TWIST - valley) / period) * 2 * Math.PI + Math.PI);
    }
    // A fold-shaped band between two waist angles b0 < b1: trailing edges, wavy outer edge.
    function band(b0, b1, valley, period, rIn = R.waist) {
      const pts = [];
      const N = 10;
      for (let k = 0; k <= N; k++) {
        const r = rIn + ((R.hem - rIn) * k) / N;
        pts.push(polar(k === N ? hemR(b0 + TWIST, valley, period) : r, b0 + twist(r)));
      }
      for (let a = b0 + TWIST; a <= b1 + TWIST + 1e-6; a += Math.min(1.2, (b1 - b0) / 4))
        pts.push(polar(hemR(a, valley, period), a));
      pts.push(polar(hemR(b1 + TWIST, valley, period), b1 + TWIST));
      for (let k = N; k >= 0; k--) {
        const r = rIn + ((R.hem - rIn) * k) / N;
        pts.push(polar(k === N ? hemR(b1 + TWIST, valley, period) : r, b1 + twist(r)));
      }
      return 'M' + pts.map(([x, y]) => f2(x) + ' ' + f2(y)).join('L') + 'Z';
    }
    // A fold line from the waist to the hem.
    function foldLine(b, valley, period, r0 = R.waist + 3, r1 = R.hem) {
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const r = r0 + ((r1 - r0) * k) / 10;
        pts.push(polar(k === 10 ? hemR(b + TWIST, valley, period) - 2 : r, b + twist(r)));
      }
      return 'M' + pts.map(([x, y]) => f2(x) + ' ' + f2(y)).join('L');
    }
    function hemPath(valley, period, inset = 0) {
      let d = '';
      for (let a = 0; a <= 360; a += 1) {
        const [x, y] = polar(hemR(a, valley, period) - inset, a);
        d += (a ? 'L' : 'M') + f2(x) + ' ' + f2(y);
      }
      return d + 'Z';
    }

    // About sixteen pleats whatever the number of slices, with a valley on every slice boundary.
    const pleat = (m) => m.step / Math.max(1, Math.round(m.step / 22.5));

    // The fabric: cloth, graded shadow on the falling side of every pleat, creases and ridges.
    function fabric(parent, m, H, ids) {
      const valley = m.slices[0].a0;
      const period = pleat(m);
      const g = H.s('g', { class: 'se-fabric' }, parent);
      H.s('path', { d: hemPath(valley, period), class: 'se-cloth', fill: `url(#${ids.cloth})` }, g);
      const shade = ['', '', ''];
      let creases = '';
      let ridges = '';
      for (let v = valley; v < valley + 360 - 1e-6; v += period) {
        const ridge = v + period / 2;
        // Three overlapping bands, darkest next to the valley the fabric falls into.
        shade[0] += band(ridge, v + period, valley, period);
        shade[1] += band(ridge + period / 6, v + period, valley, period);
        shade[2] += band(ridge + period / 3, v + period, valley, period);
        creases += foldLine(v, valley, period);
        ridges += foldLine(ridge, valley, period, R.waist + 14);
      }
      shade.forEach((d, k) => H.s('path', { d, class: 'se-shade se-shade-' + k }, g));
      H.s('path', { d: ridges, class: 'se-ridge' }, g);
      H.s('path', { d: creases, class: 'se-crease' }, g);
      H.s('path', { d: hemPath(valley, period), class: 'se-hem' }, g);
      H.s('path', { d: hemPath(valley, period, 7), class: 'se-hem-in' }, g);
      // Motion streaks beyond the hem, seen only while the skirt turns.
      let streaks = '';
      for (let k = 0; k < 3; k++) {
        const a0 = k * 120 + 20;
        const [x0, y0] = polar(R.hem + 11, a0);
        const [x1, y1] = polar(R.hem + 11, a0 + 46);
        streaks += `M${f2(x0)} ${f2(y0)}A${R.hem + 11} ${R.hem + 11} 0 0 1 ${f2(x1)} ${f2(y1)}`;
      }
      H.s('path', { d: streaks, class: 'se-streak' }, g);
      return g;
    }

    function hub(root, m, H, ids) {
      const g = H.s('g', { class: 'se-hub' }, root);
      H.s('circle', { cx: C, cy: C, r: R.belt + 4, class: 'se-collar' }, g);
      H.s('circle', { cx: C, cy: C, r: R.belt, class: 'se-belt' }, g);
      H.s('circle', { cx: C, cy: C + 1.5, r: R.hat + 1, class: 'se-hat-shadow' }, g);
      H.s('circle', { cx: C, cy: C, r: R.hat, class: 'se-hat', fill: `url(#${ids.hat})` }, g);
      H.s('circle', { cx: C, cy: C, r: R.hat - 5, class: 'se-hat-crown' }, g);
      // Without a key the title and file sit lower, in the middle of the crown.
      const dy = m.key ? 0 : 8;
      H.label(g, C, C - 15 + dy, m.title, { maxWidth: 86, size: 19, minSize: 12, maxLines: 1, cls: 'se-title' });
      H.label(g, C, C + 4 + dy, m.file, { maxWidth: 80, size: 11.5, minSize: 8.5, maxLines: 1, cls: 'se-file' });
      if (!m.key) return;
      const kw = 16 + m.key.length * 6.4;
      H.s('rect', { x: f2(C - kw / 2), y: C + 15, width: f2(kw), height: 17, rx: 8.5, class: 'se-key' }, g);
      H.text(g, C, C + 23.9, m.key, { class: 'se-keytext' });
    }

    // ---------------------------------------------------------------- sound
    // The ceremony: the ney (a reed flute, soft and breathy), the cloth of the turning skirt and the skin
    // of the kudüm drum. Every gain starts silent and ramps, and every source is stopped, so nothing
    // clicks. Each voice's `v` sets its level, balanced by measurement against the other themes.
    // A gain that rises in `a` seconds, holds, then dies away over `d`.
    function gate(ac, out, t, a, hold, d, peak) {
      const g = ac.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      if (hold > 0) g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
      g.connect(out);
      return g;
    }
    function bandpass(ac, f, q) {
      const n = ac.createBiquadFilter();
      n.type = 'bandpass';
      n.frequency.value = f;
      n.Q.value = q;
      return n;
    }
    // The ney: a soft tone with weak upper partials, the breath around it and a puff of air as the note
    // speaks. `notes` lists [seconds in, pitch] to glide through; a vibrato of `vib` hertz grows in while
    // the note holds.
    function ney(ac, out, t, X, notes, { a, hold, d, gain, vib = 0 }) {
      const end = t + a + hold + d;
      const o = ac.createOscillator();
      o.setPeriodicWave(ac.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0.3, 0.14, 0.05, 0.03])));
      o.frequency.setValueAtTime(notes[0][1], t);
      for (const [s, f] of notes.slice(1)) o.frequency.exponentialRampToValueAtTime(f, t + s);
      o.connect(gate(ac, out, t, a, hold, d, gain));
      o.start(t);
      o.stop(end + 0.03);
      if (vib) {
        const lfo = ac.createOscillator();
        lfo.frequency.value = 5.2;
        const depth = ac.createGain();
        depth.gain.value = 0;
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(vib, t + a + hold);
        lfo.connect(depth).connect(o.frequency);
        lfo.start(t);
        lfo.stop(end + 0.03);
      }
      const air = ac.createBufferSource();
      air.buffer = X.noise(ac);
      air.loop = true;
      air.connect(bandpass(ac, 1500, 0.8)).connect(gate(ac, out, t, a, hold, d, gain * 0.35));
      air.start(t, Math.random() * 0.5);
      air.stop(end + 0.03);
      X.burst(ac, out, t, { type: 'bandpass', f: 2400, q: 1, dur: 0.03, gain: gain * 0.5, a: 0.005 });
    }
    // The skirt's cloth turning: a soft swish whose band climbs with the swirl to `peak` and settles.
    function cloth(ac, out, t, X, { f, peak, f2, a, d, gain, q = 1.1 }) {
      const shape = bandpass(ac, f, q);
      shape.frequency.setValueAtTime(f, t);
      shape.frequency.exponentialRampToValueAtTime(peak, t + a);
      shape.frequency.exponentialRampToValueAtTime(f2, t + a + d);
      const src = ac.createBufferSource();
      src.buffer = X.noise(ac);
      src.loop = true;
      src.connect(shape).connect(gate(ac, out, t, a, 0, d, gain));
      src.start(t, Math.random() * 0.5);
      src.stop(t + a + d + 0.05);
    }
    // A muted kudüm stroke: the skin's two lowest modes (a drum's are not harmonic) and the slap of the hand.
    function kudum(ac, out, t, X, f, gain) {
      X.tone(ac, out, t, { f, f2: f * 0.9, dur: 0.05, gain, a: Math.min(0.004, 1 / f) });
      X.tone(ac, out, t, { f: f * 1.59, dur: 0.03, gain: gain * 0.5, a: 0.002 });
      X.burst(ac, out, t, { type: 'bandpass', f: 1300, q: 1.2, dur: 0.012, gain: gain * 0.8 });
    }

    Board.define({
      id: 'sema',
      fonts: {
        brand: "'Mulish'",
        display: "'Cormorant'",
        load: ["'Cormorant'", "'Mulish'"],
        credits: [
          { family: 'Cormorant', license: 'SIL Open Font License 1.1' },
          { family: 'Mulish', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 190, close: 130, stagger: 12, apply: 680 },
      palette: {
        light: {
          bg: '#f4f4f6',
          surface: '#ffffff',
          'surface-2': '#f1f0f4',
          border: '#dddbe3',
          'border-strong': '#a9a5b6',
          text: '#1d2030',
          'text-muted': '#5b5d6e',
          accent: '#7e2440',
          'on-accent': '#ffffff',
          focus: '#7e2440',
          success: '#2d7a5a',
          'on-success': '#ffffff',
          'success-text': '#236248',
          warning: '#c98a12',
          'warning-text': '#875800',
          danger: '#b3261e',
          desk: 'radial-gradient(120% 100% at 50% 28%, #fdfcfb 0%, #ebe8ee 58%, #d9d5e0 100%)',
          'wheel-face': '#ffffff',
          'wheel-slice': '#ffffff',
          'wheel-slice-hover': '#f5e4ec',
          'wheel-slice-selected': '#7e2440',
          'wheel-text': '#1d2133',
          'wheel-text-selected': '#ffffff',
          'wheel-line': 'rgba(52, 40, 80, 0.26)',
          'wheel-shadow': 'rgba(60, 40, 80, 0.24)',
          'se-sub': '#7a3b56',
          'se-sub-selected': '#f8dbe5',
          'se-cloth-in': '#ffffff',
          'se-cloth-out': '#efecf3',
          'se-fold': '#3b2f5c',
          'se-fold-opacity': '0.045',
          'se-ridge': '#ffffff',
          'se-ridge-opacity': '0.95',
          'se-hem': 'rgba(60, 44, 92, 0.32)',
          'se-collar': '#ffffff',
          'se-belt': '#2c2f45',
          'se-hat': '#e4cfa9',
          'se-hat-in': '#efe2c8',
          'se-hat-edge': '#bfa173',
          'se-title': '#2a2030',
          'se-file': '#4f4458',
          'se-key': '#f8f1e4',
          'se-key-line': '#c9b28a',
          'se-keytext': '#3a2f45',
          'se-streak': 'rgba(70, 50, 100, 0.35)',
          'se-seg-opacity': '0.92',
          'se-glow-y': '14px',
          'se-glow-blur': '30px',
        },
        dark: {
          bg: '#0f0e1a',
          surface: '#181726',
          'surface-2': '#201f33',
          border: '#302e47',
          'border-strong': '#55527a',
          text: '#f0eef7',
          'text-muted': '#aeaac4',
          accent: '#e07a9a',
          'on-accent': '#2a0b17',
          focus: '#f0a0b8',
          success: '#5cc98a',
          'on-success': '#08240f',
          'success-text': '#7ad6a1',
          warning: '#f2c14e',
          'warning-text': '#f6d37d',
          danger: '#ff7a85',
          desk: 'radial-gradient(75% 72% at 50% 46%, #2e2a4c 0%, #19172e 52%, #0b0a15 100%)',
          'wheel-face': '#d8dcec',
          'wheel-slice': '#d8dcec',
          'wheel-slice-hover': '#d9cff2',
          'wheel-slice-selected': '#9c2f52',
          'wheel-text': '#161a2e',
          'wheel-text-selected': '#ffffff',
          'wheel-line': 'rgba(24, 26, 70, 0.34)',
          'wheel-shadow': 'rgba(150, 160, 255, 0.3)',
          'se-sub': '#6a2945',
          'se-sub-selected': '#ffd9e5',
          'se-cloth-in': '#e9ecf6',
          'se-cloth-out': '#b8bed8',
          'se-fold': '#141844',
          'se-fold-opacity': '0.075',
          'se-ridge': '#ffffff',
          'se-ridge-opacity': '0.8',
          'se-hem': 'rgba(20, 22, 60, 0.4)',
          'se-collar': '#e9ecf6',
          'se-belt': '#1d1f38',
          'se-hat': '#d2bd97',
          'se-hat-in': '#e2d2b3',
          'se-hat-edge': '#a48b62',
          'se-title': '#231a2a',
          'se-file': '#493e52',
          'se-key': '#efe6d6',
          'se-key-line': '#b39c74',
          'se-keytext': '#33293e',
          'se-streak': 'rgba(200, 205, 255, 0.45)',
          'se-seg-opacity': '0.9',
          'se-glow-y': '0px',
          'se-glow-blur': '50px',
        },
      },
      contrast: Board.DEFAULT_PAIRS.concat([
        ['se-sub', 'wheel-slice', 'text'],
        ['se-sub', 'wheel-slice-hover', 'text'],
        ['se-sub-selected', 'wheel-slice-selected', 'text'],
        ['wheel-text', 'se-cloth-out', 'text'],
        ['se-title', 'se-hat', 'text'],
        ['se-file', 'se-hat', 'text'],
      ]),

      wheel: {
        render(root, m, H) {
          const uid = H.uid('sema');
          const ids = { cloth: uid + '-cloth', hat: uid + '-hat' };
          const defs = H.s('defs', {}, root);
          const cl = H.s(
            'radialGradient',
            { id: ids.cloth, cx: C, cy: C, r: R.hem + R.wave, gradientUnits: 'userSpaceOnUse' },
            defs,
          );
          H.s('stop', { offset: 0.3, class: 'se-st-in' }, cl);
          H.s('stop', { offset: 1, class: 'se-st-out' }, cl);
          const ht = H.s('radialGradient', { id: ids.hat, cx: 0.42, cy: 0.38, r: 0.7 }, defs);
          H.s('stop', { offset: 0, class: 'se-st-hat-in' }, ht);
          H.s('stop', { offset: 1, class: 'se-st-hat' }, ht);

          const turn = H.s('g', { class: 'se-turn' }, root);
          fabric(turn, m, H, ids);

          const valley = m.slices[0].a0;
          const period = pleat(m);
          // The apply turn is four whole pleats, so the fabric ends where it started.
          turn.style.setProperty('--se-whirl', f2(-4 * period) + 'deg');
          const tl = twist(R.lbl);
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: band(sl.a0, sl.a1, valley, period, R.waist - 2), class: 'se-seg' }, g);
            const c = H.s('g', { class: 'se-ink' }, g);
            const at = Object.assign({}, sl, { mid: sl.mid + tl });
            if (sl.format) {
              H.block(c, at, R.lbl, {
                size: 26,
                subSize: 13.5,
                gap: 0,
                maxWidth: 76,
                minSize: 12,
                cls: 'se-lbl se-fmt',
                subCls: 'se-sub',
              });
            } else {
              H.block(c, at, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 15,
                gap: 4,
                maxWidth: 78,
                minSize: 10,
                cls: 'se-lbl se-word',
                sub: null,
              });
            }
            // More choices: an arrowhead near the hem, turned with the fold as it swirls; a little off the
            // fold's middle, since the swirl carries it towards the next label.
            H.ringMark(c, sl, m, { r: R.hem - 11, size: 9.5, offset: 6, turn: twist(R.hem - 16), cls: 'se-ring-mark' });
          }
          hub(root, m, H, ids);
        },
      },

      sounds: {
        // The skirt spins into place with a swish of cloth, and a breath goes through the ney.
        open(ac, out, t, X) {
          const v = 1;
          cloth(ac, out, t, X, { f: 500, peak: 1600, f2: 800, a: 0.08, d: 0.16, gain: 0.06 * v });
          X.burst(ac, out, t + 0.06, { type: 'bandpass', f: 1300, q: 2.5, dur: 0.22, gain: 0.04 * v, a: 0.08 });
          ney(ac, out, t + 0.1, X, [[0, 587.3]], { a: 0.08, hold: 0, d: 0.2, gain: 0.012 * v });
        },
        // A muted kudüm stroke, a little different each time.
        tick(ac, out, t, X) {
          const v = 0.78;
          kudum(ac, out, t, X, 235 * (0.96 + Math.random() * 0.08), 0.06 * v);
        },
        // Into a ring: the ney steps up from D to the E above it.
        enter(ac, out, t, X) {
          const v = 0.26;
          ney(
            ac,
            out,
            t,
            X,
            [
              [0, 587.3],
              [0.06, 587.3],
              [0.11, 650],
            ],
            { a: 0.03, hold: 0.1, d: 0.08, gain: 0.05 * v },
          );
        },
        // Back out: the ney steps down from E to D.
        leave(ac, out, t, X) {
          const v = 0.26;
          ney(
            ac,
            out,
            t,
            X,
            [
              [0, 650],
              [0.06, 650],
              [0.11, 587.3],
            ],
            { a: 0.03, hold: 0.1, d: 0.08, gain: 0.05 * v },
          );
        },
        // The skirt whirls a quarter turn, its cloth swishing up to the flare and settling, while the ney
        // sounds one breathy note: it falls from a grace note on the E above onto D (a little flat of the
        // piano's E, as the makam has it) and a slow vibrato grows in.
        success(ac, out, t, X) {
          const v = 1;
          cloth(ac, out, t, X, { f: 420, peak: 1500, f2: 650, a: 0.28, d: 0.4, gain: 0.07 * v });
          ney(
            ac,
            out,
            t + 0.02,
            X,
            [
              [0, 650],
              [0.08, 650],
              [0.16, 587.3],
            ],
            { a: 0.1, hold: 0.45, d: 0.5, gain: 0.055 * v, vib: 5 },
          );
        },
      },
    });
  })();
}
