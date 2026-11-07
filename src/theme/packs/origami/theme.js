// SPDX-License-Identifier: MIT
// Origami: the wheel as a pleated paper rosette. Every slice is a pleat of two facets that catch
// the light from the upper left, the rim is the zigzag of the folds, and the hub is a small square
// sheet with its creases. Hover lifts a pleat; applying it folds the pleat over and opens it again
// on its coloured side, which stays up.
export default function register(Board) {
  (function () {
    'use strict';

    const ID = 'origami';
    const f2 = (n) => Math.round(n * 100) / 100;

    if (typeof document !== 'undefined' && document.fonts) {
      for (const f of ["500 16px 'Nunito Variable'", "700 16px 'Nunito Variable'", "900 16px 'Nunito Variable'"])
        document.fonts.load(f, 'AaĞşı').catch(() => null);
    }

    // Radii in the 400 x 400 view box.
    const R = { hub: 62, under: 40, valley: 172, peak: 192, lbl: 127, hit1: 186 };
    // Light from the upper left: a facet facing it is bright, one facing away is in shade.
    const LIGHT = (() => {
      const v = [-0.62, -0.78];
      const l = Math.hypot(v[0], v[1]);
      return [v[0] / l, v[1] / l];
    })();

    // Brightness (0 shade to 100 light) of a facet that faces tangentially at angle th, ccw or cw.
    function facetLight(th, dir) {
      const r = (th * Math.PI) / 180;
      const n = dir < 0 ? [-Math.cos(r), -Math.sin(r)] : [Math.cos(r), Math.sin(r)];
      const d = n[0] * LIGHT[0] + n[1] * LIGHT[1];
      return Math.round(52 + 46 * d);
    }

    const pt = (p) => `${f2(p[0])} ${f2(p[1])}`;

    // The gap between two slices' sheets, in degrees.
    const SEAM = 0.9;

    // The width a label may take at radius r: the slice's chord there, less a margin, within a cap.
    function roomAt(sl, r, margin, cap) {
      const half = Math.min(sl.step / 2, 70);
      return Math.max(40, Math.min(cap, 2 * r * Math.sin((half * Math.PI) / 180) - margin));
    }

    // A fold line along angle a from r0 to r1, with a gap where it would cross the box of a label.
    function breakRound(H, a, r0, r1, bb) {
      const C = H.C;
      const u = [Math.sin(H.rad(a)), -Math.cos(H.rad(a))];
      const seg = (p, q) => (q - p > 2 ? `M${pt(H.polar(p, a))}L${pt(H.polar(q, a))}` : '');
      if (!bb.width) return seg(r0, r1);
      let t0 = -Infinity,
        t1 = Infinity;
      for (const [lo, hi, d] of [
        [bb.x - 3, bb.x + bb.width + 3, u[0]],
        [bb.y - 3, bb.y + bb.height + 3, u[1]],
      ]) {
        if (Math.abs(d) < 1e-6) {
          if (C < lo || C > hi) return seg(r0, r1);
        } else {
          const p = (lo - C) / d,
            q = (hi - C) / d;
          t0 = Math.max(t0, Math.min(p, q));
          t1 = Math.min(t1, Math.max(p, q));
        }
      }
      if (t0 >= t1 || t1 <= r0 || t0 >= r1) return seg(r0, r1);
      return seg(r0, Math.max(r0, t0)) + seg(Math.min(r1, t1), r1);
    }

    // Sounds: paper, drawn sample by sample at the context's rate. One buffer per sound keeps a flick
    // to two nodes however fast the pointer sweeps, and lets every flick differ a little; the opening
    // and the applying sound alike each time, so they are drawn once per rate and kept (`keep`). Each
    // buffer starts and ends at zero and its gain opens from silence, so nothing clicks.
    function play(ac, out, t, dur, level, keep, draw) {
      const sr = ac.sampleRate;
      let buf = keep && keep.get(sr);
      if (!buf) {
        random = keep ? seeded(7) : Math.random;
        const n = Math.ceil(dur * sr);
        buf = ac.createBuffer(1, n, sr);
        const d = buf.getChannelData(0);
        draw(d, sr);
        const fade = Math.min(n, Math.round(sr * 0.004));
        for (let i = 1; i <= fade; i++) d[n - i] *= (i - 1) / fade;
        random = Math.random;
        if (keep) keep.set(sr, buf);
      }
      const src = ac.createBufferSource();
      const g = ac.createGain();
      src.buffer = buf;
      g.gain.value = 0;
      g.gain.setValueAtTime(0, Math.max(0, t - 0.004));
      g.gain.linearRampToValueAtTime(level, t);
      src.connect(g).connect(out);
      src.start(t);
      src.stop(t + dur + 0.02);
    }
    // Chance: Math.random for the sounds that vary, a fixed sequence while a kept sound is drawn, so
    // the opening and the applying sound the same in every session.
    let random = Math.random;
    function seeded(seed) {
      return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    }
    // White noise, -1 to 1, from a fresh seed each time.
    function white() {
      let s = (random() * 4294967295) >>> 0 || 1;
      return () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return (s | 0) / 2147483648;
      };
    }
    // A state-variable filter that stays stable while its frequency moves. Returns the band-pass at
    // unity peak; the low-pass is left on `lp`. Its coefficients are worked out again only when the
    // frequency has moved by a fifth of a percent, which no ear can follow.
    function svf() {
      let a = 0;
      let b = 0;
      let at = 0;
      let qa = 0;
      let g = 0;
      let k = 1;
      let h = 1;
      const f = (x, hz, q, sr) => {
        if (q !== qa || Math.abs(hz - at) > at * 0.002) {
          at = hz;
          qa = q;
          g = Math.tan((Math.PI * Math.min(hz, sr * 0.45)) / sr);
          k = 1 / q;
          h = 1 / (1 + g * (g + k));
        }
        const v1 = h * (a + g * (x - b));
        const v2 = b + g * v1;
        a = 2 * v1 - a;
        b = 2 * v2 - b;
        f.lp = v2;
        return k * v1;
      };
      return f;
    }
    // Runs fn(i, s, u, end) over len seconds from at, inside the buffer: the sample, seconds in, 0..1
    // progress and a fade over the last fifth.
    function span(d, sr, at, len, fn) {
      const i0 = Math.round(at * sr);
      const m = Math.min(Math.round(len * sr), d.length - i0);
      for (let i = 0; i < m; i++) fn(i0 + i, i / sr, i / m, Math.min(1, (m - i) / (0.2 * m)));
    }
    // Paper crackling as it bends: the fibres snap at random moments, a few loudly, most faintly, in a
    // wide bright band. `shape` sets how busy it is over its length.
    function crinkle(d, sr, at, len, { rate = 900, f = 3200, gain = 1, shape = (u) => Math.sin(Math.PI * u) }) {
      const rnd = white();
      const band = svf();
      const top = svf();
      span(d, sr, at, len, (i, s, u, end) => {
        const v = shape(u);
        const snap = random() < (rate * v) / sr ? (random() < 0.5 ? -1 : 1) * (0.15 + 2.5 * random() ** 3) : 0;
        top(band(8 * snap + 0.05 * v * rnd(), f, 0.6, sr), 7000, 0.6, sr);
        d[i] += gain * end * top.lp;
      });
    }
    // Air pushed by a moving sheet: a smooth band of noise sliding with the sheet, loudest where it
    // moves fastest (`peak`, 0..1 along it).
    function swish(d, sr, at, len, { f0, f1 = f0, gain = 1, peak = 0.5 }) {
      const rnd = white();
      const band = svf();
      span(d, sr, at, len, (i, s, u) => {
        const e =
          u < peak
            ? Math.sin((Math.PI / 2) * (u / peak)) ** 2
            : Math.cos((Math.PI / 2) * ((u - peak) / (1 - peak))) ** 2;
        d[i] += gain * e * band(rnd(), f0 * (f1 / f0) ** u, 0.8, sr);
      });
    }
    // A stiff pleat flicked straight: a soft thwap of air with the paper's own snap in it.
    function flap(d, sr, at, gain) {
      const rnd = white();
      const band = svf();
      span(d, sr, at, 0.04, (i, s, u, end) => {
        const air = band(rnd(), 650, 1.4, sr) * Math.exp(-s / 0.008);
        const thud = 0.5 * Math.sin(2 * Math.PI * 190 * s) * Math.exp(-s / 0.007);
        d[i] += gain * end * Math.min(1, s / 0.0008) * (2 * air + thud);
      });
      crinkle(d, sr, at, 0.012, { rate: 2500, gain: 0.5 * gain });
    }
    const KEPT = { open: new Map(), success: new Map() };

    Board.define({
      id: ID,
      fonts: {
        brand: "'Nunito Variable'",
        load: ["'Nunito Variable'"],
        credits: [{ family: 'Nunito', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 190, close: 120, stagger: 11, apply: 600 },

      palette: {
        light: {
          bg: '#eef1f2',
          surface: '#ffffff',
          'surface-2': '#f4f6f7',
          border: '#d9dee2',
          'border-strong': '#a8b1b9',
          text: '#1b2030',
          'text-muted': '#596173',
          accent: '#2f3f8f',
          'on-accent': '#ffffff',
          focus: '#2f3f8f',
          success: '#1d7d4f',
          'on-success': '#ffffff',
          'success-text': '#186a43',
          warning: '#b0700f',
          'warning-text': '#774b06',
          danger: '#bf3a3a',
          desk: 'linear-gradient(160deg, #e6eeec 0%, #d4e0de 100%)',
          'wheel-face': '#f4f5f8',
          'paper-hi': '#ffffff',
          'paper-lo': '#d7dbe4',
          'wheel-slice': '#d7dbe4',
          'wheel-slice-hover': '#ffffff',
          'wheel-slice-selected': '#2f3f8f',
          'back-hi': '#4a5bb0',
          'back-lo': '#232f70',
          'back-dot': 'rgba(255, 255, 255, 0.16)',
          'wheel-text': '#1b2030',
          'wheel-sub': '#4a5266',
          'wheel-text-selected': '#ffffff',
          'wheel-sub-selected': '#e1e6ff',
          'wheel-line': 'rgba(255, 255, 255, 0.85)',
          'valley-line': 'rgba(60, 70, 95, 0.22)',
          'wheel-shadow': 'rgba(40, 60, 70, 0.28)',
          'lift-shadow': 'rgba(30, 40, 60, 0.35)',
          'hub-paper': '#fbfbfd',
          'hub-edge': '#c9ced9',
          'paper-base': '#b9bfcb',
          'hover-tint': 'rgba(70, 100, 210, 0.07)',
          'hub-crease': 'rgba(60, 70, 95, 0.14)',
          'fold-shade': 'rgba(20, 26, 50, 0.4)',
        },
        dark: {
          bg: '#13162a',
          surface: '#1b1f38',
          'surface-2': '#232847',
          border: '#323858',
          'border-strong': '#535b84',
          text: '#f1eee6',
          'text-muted': '#aeb1c6',
          accent: '#f2b33d',
          'on-accent': '#1b1a2e',
          focus: '#f2b33d',
          success: '#6fd19d',
          'on-success': '#0b2216',
          'success-text': '#80d9aa',
          warning: '#f2b84a',
          'warning-text': '#f5c66c',
          danger: '#ff8a80',
          desk: 'radial-gradient(120% 95% at 40% 10%, #20254a 0%, #151935 60%, #0f1226 100%)',
          'wheel-face': '#2d3560',
          'paper-hi': '#46528a',
          'paper-lo': '#262d52',
          'wheel-slice': '#46528a',
          'wheel-slice-hover': '#4e5b96',
          'wheel-slice-selected': '#f2b33d',
          'back-hi': '#ffcd63',
          'back-lo': '#e09a22',
          'back-dot': 'rgba(255, 255, 255, 0.22)',
          'wheel-text': '#f6f3ec',
          'wheel-sub': '#d9dcef',
          'wheel-text-selected': '#1b1a2e',
          'wheel-sub-selected': '#2c2a3f',
          'wheel-line': 'rgba(190, 200, 255, 0.45)',
          'valley-line': 'rgba(5, 8, 25, 0.45)',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          'lift-shadow': 'rgba(0, 0, 0, 0.55)',
          'hub-paper': '#384274',
          'hub-edge': '#1f2547',
          'paper-base': '#181d38',
          'hover-tint': 'rgba(220, 228, 255, 0.1)',
          'hub-crease': 'rgba(200, 210, 255, 0.16)',
          'fold-shade': 'rgba(0, 0, 10, 0.5)',
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
        ['wheel-text', 'paper-lo', 'text'],
        ['wheel-text', 'paper-hi', 'text'],
        ['wheel-sub', 'paper-lo', 'text'],
        ['wheel-sub', 'paper-hi', 'text'],
        ['wheel-text-selected', 'back-hi', 'text'],
        ['wheel-text-selected', 'back-lo', 'text'],
        ['wheel-sub-selected', 'back-hi', 'text'],
        ['wheel-sub-selected', 'back-lo', 'text'],
        ['wheel-text', 'hub-paper', 'text'],
        ['wheel-sub', 'hub-paper', 'text'],
      ],

      // A soft shadow under a lifted pleat.
      defs: `<filter id="origami-lift" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3.4"/><feOffset dx="2" dy="4.5" result="b"/>
        <feFlood flood-color="#000" flood-opacity=".36"/><feComposite in2="b" operator="in" result="s"/>
        <feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="origami-blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="4.5"/></filter>`,

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const s = H.s;
          const uid = H.uid(ID);
          const defs = s('defs', {}, root);
          // Small dots printed on the coloured back of the paper.
          const pat = s(
            'pattern',
            { id: uid + '-dots', width: 9, height: 9, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(30)' },
            defs,
          );
          s('circle', { cx: 2.2, cy: 2.2, r: 1.05, class: 'og-dot' }, pat);
          s('circle', { cx: 6.7, cy: 6.7, r: 1.05, class: 'og-dot' }, pat);
          const sh = s('radialGradient', { id: uid + '-sh', cx: 0.5, cy: 0.5, r: 0.5 }, defs);
          s('stop', { offset: 0.8, class: 'og-st-sh' }, sh);
          s('stop', { offset: 1, class: 'og-st-sh0' }, sh);

          // A slice is folded from about one pleat per 45 degrees, so two or three wide slices still
          // make a many-pointed rosette; each pleat is two facets meeting in a mountain fold.
          const pleatsOf = (sl) => Math.max(1, Math.round(sl.step / 45));
          let star = '';
          for (const sl of m.slices) {
            const p = pleatsOf(sl);
            for (let k = 0; k < p; k++) {
              const a0 = sl.a0 + (sl.step * k) / p;
              star += `${star ? 'L' : 'M'}${pt(H.polar(R.valley, a0))}L${pt(H.polar(R.peak, a0 + sl.step / p / 2))}`;
            }
          }
          star += 'Z';
          // The sheet's shadow on the desk, and the sheet below the pleats, seen when one folds over.
          const under = s('g', { class: 'og-under', 'aria-hidden': 'true' }, root);
          s('path', { d: star, class: 'og-shadow', transform: 'translate(2 5)' }, under);
          s('path', { d: star, class: 'og-base' }, under);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            // A still hit area, so a lifted pleat never slides out from under the pointer.
            s('path', { d: H.sector(R.hub, R.hit1, sl.a0, sl.a1), class: 'og-hit' }, g);
            const u = [Math.sin(H.rad(sl.mid)), -Math.cos(H.rad(sl.mid))];
            const body = s('g', { class: 'og-body' }, g);
            body.style.setProperty('--lx', f2(u[0] * 6) + 'px');
            body.style.setProperty('--ly', f2(u[1] * 6) + 'px');
            const fold = s('g', { class: 'og-fold' }, body);
            // Front: white (or indigo) paper; back: the coloured side, shown once the slice is applied.
            // The pleats start under the hub sheet, so no gap shows round it.
            const front = s('g', { class: 'og-front' }, fold);
            const back = s('g', { class: 'og-back' }, fold);
            const face = (q, extra) => `M${pt(q[0])}L${pt(q[1])}L${pt(q[2])}L${pt(q[3])}${extra}Z`;
            const p = pleatsOf(sl);
            const w = sl.step / p;
            const folds = [];
            let all = '';
            for (let k = 0; k < p; k++) {
              // Each slice is its own sheet: a hair's gap at its sides lets the sheet below show as a seam.
              const mid = sl.a0 + w * k + w / 2,
                a0 = sl.a0 + w * k + (k === 0 ? SEAM : 0),
                a1 = sl.a0 + w * (k + 1) - (k === p - 1 ? SEAM : 0);
              const L = [H.polar(R.under, a0), H.polar(R.valley, a0), H.polar(R.peak, mid), H.polar(R.under, mid)];
              const Rr = [H.polar(R.under, mid), H.polar(R.peak, mid), H.polar(R.valley, a1), H.polar(R.under, a1)];
              const dA = face(L, `A${R.under} ${R.under} 0 0 0 ${pt(L[0])}`);
              const dB = face(Rr, `A${R.under} ${R.under} 0 0 0 ${pt(Rr[0])}`);
              const lA = facetLight((a0 + mid) / 2, -1),
                lB = facetLight((mid + a1) / 2, 1);
              s('path', { d: dA, style: `fill: color-mix(in srgb, var(--paper-hi) ${lA}%, var(--paper-lo))` }, front);
              s('path', { d: dB, style: `fill: color-mix(in srgb, var(--paper-hi) ${lB}%, var(--paper-lo))` }, front);
              s('path', { d: dA, style: `fill: color-mix(in srgb, var(--back-hi) ${lA}%, var(--back-lo))` }, back);
              s('path', { d: dB, style: `fill: color-mix(in srgb, var(--back-hi) ${lB}%, var(--back-lo))` }, back);
              all += dA + dB;
              folds.push([mid, R.peak - 1, 'og-crease']);
              if (k) folds.push([a0, R.valley, 'og-valley']);
            }
            s('path', { d: all, fill: `url(#${uid}-dots)` }, back);
            // Creases: mountain folds down each pleat, valley folds between them and at the sides.
            const crease = s('path', { class: 'og-crease' }, fold);
            const valley = s('path', { class: 'og-valley' }, fold);
            s('path', { d: all, class: 'og-hl' }, front);
            s('path', { d: all, class: 'og-turn' }, fold);
            const ink = s('g', { class: 'og-ink' }, fold);
            const room = roomAt(sl, R.lbl, 20, 128);
            if (sl.format) {
              H.block(ink, sl, R.lbl, {
                size: 21,
                subSize: 12.5,
                gap: 2,
                maxWidth: room,
                minSize: 10,
                cls: 'og-lbl og-fmt',
                subCls: 'og-sub',
              });
            } else {
              H.block(ink, sl, R.lbl, {
                icon: true,
                iconSize: 23,
                size: 13.5,
                gap: 4,
                maxWidth: room + 2,
                minSize: 9,
                cls: 'og-lbl og-word',
                sub: null,
              });
            }
            // The folds break round the lettering, like a fold that runs under a printed word.
            const bb = ink.getBBox();
            const lines = { 'og-crease': '', 'og-valley': '' };
            for (const [a, r1, cls] of folds) lines[cls] += breakRound(H, a, R.hub, r1, bb);
            crease.setAttribute('d', lines['og-crease']);
            valley.setAttribute('d', lines['og-valley']);
            // More choices: an arrowhead printed near the tip of the sheet, on a facet towards the next
            // slice, clear of the folds: past the first ridge after the middle when a slice has several.
            const ridge = Array.from({ length: p }, (_, k) => w * (k + 0.5) - sl.step / 2).find((x) => x > 0);
            const offset = p > 1 && ridge !== undefined ? ridge + w / 4 : undefined;
            H.ringMark(ink, sl, m, { r: R.valley - 5, size: 9.5, offset, cls: 'og-ring-mark' });
          }

          // Hub: a small square sheet with its creases, corners tucked into the valleys.
          const hub = s('g', { class: 'og-hub' }, root);
          const side = 104;
          const turn = m.slices[0].a0 + 45;
          const sq = s('g', { transform: `rotate(${f2(turn)} ${C} ${C})` }, hub);
          s('rect', { x: C - side / 2, y: C - side / 2, width: side, height: side, rx: 2, class: 'og-hub-paper' }, sq);
          s(
            'path',
            {
              d: `M${C - side / 2} ${C - side / 2}L${C + side / 2} ${C + side / 2}M${C + side / 2} ${C - side / 2}L${C - side / 2} ${C + side / 2}`,
              class: 'og-hub-crease',
            },
            sq,
          );
          s(
            'path',
            {
              d: `M${C} ${C - side / 2}V${C + side / 2}M${C - side / 2} ${C}H${C + side / 2}`,
              class: 'og-hub-crease og-hub-valley',
            },
            sq,
          );
          // One corner folded in, a dog-ear.
          const e = 15;
          s(
            'path',
            {
              d: `M${C + side / 2 - e} ${C + side / 2}L${C + side / 2} ${C + side / 2 - e}L${C + side / 2 - e} ${C + side / 2 - e}Z`,
              class: 'og-hub-ear',
            },
            sq,
          );
          const dy = m.key ? 0 : 8;
          H.label(hub, C, C - 15 + dy, m.title, { maxWidth: 92, size: 16, minSize: 10, cls: 'og-title', maxLines: 1 });
          H.label(hub, C, C + 5 + dy, m.file, { maxWidth: 88, size: 12, minSize: 9, cls: 'og-file', maxLines: 1 });
          if (m.key) {
            const kt = H.text(hub, C, C + 26, m.key, { class: 'og-keytext' });
            const kw = kt.getComputedTextLength() + 16;
            hub.insertBefore(
              s('rect', { x: f2(C - kw / 2), y: C + 18, width: f2(kw), height: 16, rx: 3, class: 'og-key' }),
              kt,
            );
          }
        },
      },

      sounds: {
        // A paper fan snapping open: a swish with a quick run of pleats crackling out, and a last flap.
        open(ac, out, t) {
          play(ac, out, t, 0.32, 0.016, KEPT.open, (d, sr) => {
            swish(d, sr, 0, 0.22, { f0: 700, f1: 2200, peak: 0.35, gain: 1.8 });
            for (let k = 0; k < 8; k++)
              crinkle(d, sr, 0.01 + k * 0.011 + 0.004 * random(), 0.014, { rate: 2200, gain: 0.3 + k * 0.03 });
            flap(d, sr, 0.2, 0.5);
          });
        },
        // A pleat lifted: a light, crisp flick of paper, never twice the same.
        tick(ac, out, t) {
          const f = 1500 + 1000 * random();
          play(ac, out, t, 0.05, 0.009, null, (d, sr) => {
            swish(d, sr, 0, 0.035, { f0: f, f1: f * 1.3, peak: 0.25 });
            crinkle(d, sr, 0.002, 0.018, { rate: 1500 + 1500 * random(), f: 2800 + 800 * random() });
          });
        },
        // Into a ring: a sheet folded over with a swish and its crease pressed flat.
        enter(ac, out, t) {
          play(ac, out, t, 0.2, 0.0076, null, (d, sr) => {
            swish(d, sr, 0, 0.12, { f0: 600, f1: 1800, peak: 0.7 });
            crinkle(d, sr, 0.105, 0.03, { rate: 3500, shape: (u) => 1 - u });
            flap(d, sr, 0.108, 0.4);
          });
        },
        // Back out: the crease lets go with a crackle and the sheet swings open.
        leave(ac, out, t) {
          play(ac, out, t, 0.2, 0.009, null, (d, sr) => {
            crinkle(d, sr, 0, 0.035, { rate: 1600, shape: (u) => 1 - u });
            swish(d, sr, 0.02, 0.15, { f0: 1800, f1: 700, peak: 0.3 });
            flap(d, sr, 0.155, 0.3);
          });
        },
        // The pleat folds over with a swish, its crease is pressed edge-on, and it swings open and
        // flaps out on its coloured side.
        success(ac, out, t) {
          play(ac, out, t, 0.62, 0.021, KEPT.success, (d, sr) => {
            swish(d, sr, 0, 0.26, { f0: 700, f1: 2400, peak: 0.8 });
            crinkle(d, sr, 0.235, 0.04, { rate: 4000, shape: (u) => 1 - u });
            flap(d, sr, 0.24, 0.6);
            swish(d, sr, 0.25, 0.31, { f0: 2200, f1: 800, peak: 0.25 });
            flap(d, sr, 0.42, 0.8);
            crinkle(d, sr, 0.54, 0.04, { rate: 900, gain: 0.6 });
          });
        },
      },
    });
  })();
}
