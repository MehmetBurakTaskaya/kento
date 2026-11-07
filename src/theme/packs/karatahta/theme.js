// SPDX-License-Identifier: MIT
// Kara tahta: a round slate board in a pale ash frame, the wheel drawn on it by hand in chalk.
// The light palette is a white board in an aluminium frame, drawn with marker. Applying a slice
// rings its label with a hand-drawn circle and knocks a little chalk dust off the board.
export default function register(Board) {
  (function () {
    'use strict';

    const ID = 'karatahta';
    const f2 = (n) => Math.round(n * 100) / 100;

    // The heavier weights are not in the engine's font wait list; ask for them before labels are measured.
    if (typeof document !== 'undefined' && document.fonts) {
      for (const f of ["500 16px 'Playpen Sans'", "600 16px 'Playpen Sans'", "700 16px 'Playpen Sans'"]) {
        document.fonts.load(f, 'AaĞşı').catch(() => null);
      }
    }

    // The width a label may take at radius r: the slice's chord there, less a margin, within a cap,
    // so two or three wide slices get roomy labels and eight narrow ones stay inside their lines.
    function roomAt(sl, r, margin, cap) {
      const half = Math.min(sl.step / 2, 70);
      return Math.max(40, Math.min(cap, 2 * r * Math.sin((half * Math.PI) / 180) - margin));
    }

    // Small seeded random source, so every wheel draws the same hand-made wobble.
    function rng(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // A smooth path through points (Catmull-Rom written as cubic curves).
    function smooth(pts, closed) {
      const n = pts.length;
      const P = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
      let d = `M${f2(pts[0][0])} ${f2(pts[0][1])}`;
      const last = closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const p0 = P(i - 1),
          p1 = P(i),
          p2 = P(i + 1),
          p3 = P(i + 2);
        d += `C${f2(p1[0] + (p2[0] - p0[0]) / 6)} ${f2(p1[1] + (p2[1] - p0[1]) / 6)} ${f2(p2[0] - (p3[0] - p1[0]) / 6)} ${f2(p2[1] - (p3[1] - p1[1]) / 6)} ${f2(p2[0])} ${f2(p2[1])}`;
      }
      return closed ? d + 'Z' : d;
    }

    // A hand-drawn arc or ellipse: angles in degrees from twelve o'clock, clockwise; `drift`
    // widens the radius from start to end, the way a quick hand circle never quite closes.
    function wobArc(cx, cy, rx, ry, a0, a1, rand, o = {}) {
      const { amp = 1, drift = 0, stepDeg = 8 } = o;
      const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) / stepDeg));
      const ph1 = rand() * 6.283,
        ph2 = rand() * 6.283;
      const k1 = 2 + Math.floor(rand() * 2),
        k2 = 5 + Math.floor(rand() * 3);
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        const t = ((a0 + (a1 - a0) * u) * Math.PI) / 180;
        const w = amp * (0.65 * Math.sin(k1 * t + ph1) + 0.35 * Math.sin(k2 * t + ph2)) + drift * u;
        pts.push([cx + (rx + w) * Math.sin(t), cy - (ry + w) * Math.cos(t)]);
      }
      return { d: smooth(pts, false), end: pts[pts.length - 1], pts };
    }

    // A hand-drawn straight line: a slight bow and a tremble, ends exact.
    function wobLine(p0, p1, rand, amp = 0.9) {
      const dx = p1[0] - p0[0],
        dy = p1[1] - p0[1];
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L,
        ny = dx / L;
      const bow = (rand() - 0.5) * amp * 2;
      const pts = [];
      for (let k = 0; k <= 5; k++) {
        const u = k / 5;
        const w = k === 0 || k === 5 ? 0 : bow * Math.sin(u * Math.PI) + (rand() - 0.5) * amp * 0.7;
        pts.push([p0[0] + dx * u + nx * w, p0[1] + dy * u + ny * w]);
      }
      return smooth(pts, false);
    }

    // Radii in the 400 x 400 view box.
    const R = { shadow: 203, frameOut: 197, frameIn: 185, rim: 175, hub: 63, hit0: 66, hit1: 175.5, lbl: 127 };

    // Sounds: chalk on slate, drawn sample by sample at the context's rate. One buffer per sound keeps
    // a tap to two nodes however fast the pointer sweeps, and lets every tap differ a little; the
    // opening and the applying sound alike each time, so they are drawn once per rate and kept
    // (`keep`). Each buffer starts and ends at zero and its gain opens from silence, so nothing clicks.
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
    // How fast a hand draws a quick line: slow off the mark, quickest before the middle, easing out.
    const pace = (u) => Math.sin(Math.PI * u ** 0.8) ** 1.5;
    // Chalk dragged over slate: grit breaking off the stick at random moments, never at a steady rate
    // (a steady stick-slip is what squeals), over a faint dry hiss; denser and louder where the hand is
    // fastest, and kept below the shrill top. `turn` swings the colour round a drawn circle.
    function chalk(d, sr, at, len, { f = 1900, rate = 1500, gain = 1, turn = 0 }) {
      const rnd = white();
      const band = svf();
      const top = svf();
      span(d, sr, at, len, (i, s, u) => {
        const v = pace(u);
        const grit = random() < (rate * v) / sr ? (random() < 0.5 ? -1 : 1) * (0.25 + 1.5 * random() ** 2) : 0;
        top(band(7 * grit + 0.3 * v * rnd(), f * (1 + turn * Math.sin(2 * Math.PI * u)), 0.8, sr), 4200, 0.6, sr);
        d[i] += gain * (0.3 + 0.7 * v) * top.lp;
      });
    }
    // The chalk's tip knocking on the slate: a dry click with a small thump of the board behind it.
    function tap(d, sr, at, { f = 2400, body = 260, gain = 1, thump = 1 }) {
      const rnd = white();
      const band = svf();
      span(d, sr, at, 0.045, (i, s, u, end) => {
        const click = s < 0.0012 ? rnd() * (1 - s / 0.0012) : 0;
        const board =
          0.55 * Math.sin(2 * Math.PI * body * s) * Math.exp(-s / 0.011) +
          0.25 * Math.sin(2 * Math.PI * 2.3 * body * s) * Math.exp(-s / 0.005);
        d[i] += gain * end * (3 * band(click, f, 1.2, sr) + thump * Math.min(1, s / 0.0006) * board);
      });
    }
    // A felt eraser swept over the slate: a soft, dull rub that wavers with the hand.
    function felt(d, sr, at, len, gain) {
      const rnd = white();
      const band = svf();
      const dull = svf();
      const glide = 1 - Math.exp((-2 * Math.PI * 30) / sr);
      const step = Math.round(sr / 28);
      let k = 0;
      let wob = 1;
      let aim = 1;
      span(d, sr, at, len, (i, s, u) => {
        if (k++ % step === 0) aim = 1 + 0.45 * rnd();
        wob += (aim - wob) * glide;
        dull(band(rnd(), 650, 0.6, sr), 1600, 0.6, sr);
        d[i] += gain * Math.sin(Math.PI * u) ** 2 * wob * dull.lp;
      });
    }
    // Chalk dust drifting off the board: the faintest breath of air.
    function dust(d, sr, at, len, gain) {
      const rnd = white();
      const band = svf();
      const dull = svf();
      span(d, sr, at, len, (i, s, u) => {
        dull(band(rnd(), 1500, 0.5, sr), 3000, 0.6, sr);
        d[i] += gain * Math.sin(Math.PI * u ** 0.6) ** 2 * dull.lp;
      });
    }
    const KEPT = { open: new Map(), success: new Map() };

    Board.define({
      id: ID,
      fonts: {
        brand: "'Playpen Sans'",
        load: ["'Playpen Sans'"],
        credits: [{ family: 'Playpen Sans', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 170, close: 120, stagger: 14, apply: 640 },

      palette: {
        light: {
          bg: '#eef1f3',
          surface: '#ffffff',
          'surface-2': '#f5f7f9',
          border: '#d7dde3',
          'border-strong': '#a6b0bb',
          text: '#18212e',
          'text-muted': '#566170',
          accent: '#1f56c9',
          'on-accent': '#ffffff',
          focus: '#1f56c9',
          success: '#1d8049',
          'on-success': '#ffffff',
          'success-text': '#17703f',
          warning: '#b77812',
          'warning-text': '#7d5208',
          danger: '#c8322b',
          desk: 'linear-gradient(170deg, #e6ecf0 0%, #d3dce3 100%)',
          'wheel-face': '#fbfcfd',
          'face-hi': '#ffffff',
          'wheel-slice': '#fbfcfd',
          'wheel-slice-hover': '#e8eefb',
          'wheel-slice-selected': '#fcebe9',
          'slice-haze': 'rgba(36, 92, 214, 0.1)',
          'slice-sel': 'rgba(214, 58, 46, 0.085)',
          'wheel-text': '#16213a',
          'wheel-sub': '#2a4c9c',
          'wheel-text-selected': '#b3271f',
          'wheel-line': 'rgba(28, 40, 66, 0.82)',
          'wheel-shadow': 'rgba(30, 45, 60, 0.3)',
          mark: '#d3392d',
          dust: 'rgba(110, 122, 140, 0.85)',
          puff: 'rgba(150, 160, 175, 0.22)',
          smudge: 'rgba(110, 128, 156, 0.075)',
          gloss: 'rgba(255, 255, 255, 0.95)',
          'gloss-end': 'rgba(255, 255, 255, 0)',
          'frame-a': '#f4f6f8',
          'frame-b': '#b9c2cc',
          'frame-edge': '#7f8a96',
          'frame-grain': 'rgba(255, 255, 255, 0.75)',
          'frame-inner': 'rgba(40, 52, 66, 0.35)',
          'piece-a': '#fbfbfb',
          'piece-tip': '#d3392d',
          'piece-b': '#2457c9',
          'piece-line': 'rgba(20, 30, 50, 0.4)',
          'line-filter': 'none',
          'text-filter': 'none',
          'line-w': '2.4',
          'key-fill': 'rgba(36, 92, 214, 0.06)',
        },
        dark: {
          bg: '#151d1a',
          surface: '#1c2622',
          'surface-2': '#24302b',
          border: '#33423b',
          'border-strong': '#55685e',
          text: '#eef2ea',
          'text-muted': '#a7b5ab',
          accent: '#f3dc74',
          'on-accent': '#1d241f',
          focus: '#9fd0f0',
          success: '#8fd6a4',
          'on-success': '#0f2318',
          'success-text': '#9fdcb1',
          warning: '#f4c870',
          'warning-text': '#f5cf86',
          danger: '#ff8f86',
          desk: 'radial-gradient(130% 100% at 50% 15%, #2d3a37 0%, #1c2523 60%, #141a19 100%)',
          'wheel-face': '#213028',
          'face-hi': '#2a3b32',
          'wheel-slice': '#213028',
          'wheel-slice-hover': '#36463e',
          'wheel-slice-selected': '#29382f',
          'slice-haze': 'rgba(232, 242, 232, 0.12)',
          'slice-sel': 'rgba(255, 226, 122, 0.045)',
          'wheel-text': '#f3f5ee',
          'wheel-sub': '#c4d1c7',
          'wheel-text-selected': '#ffe27a',
          'wheel-line': 'rgba(240, 244, 236, 0.82)',
          'wheel-shadow': 'rgba(0, 0, 0, 0.5)',
          mark: '#ffe27a',
          dust: 'rgba(246, 244, 230, 0.92)',
          puff: 'rgba(240, 240, 228, 0.2)',
          smudge: 'rgba(225, 236, 228, 0.06)',
          gloss: 'rgba(255, 255, 255, 0.05)',
          'gloss-end': 'rgba(255, 255, 255, 0)',
          'frame-a': '#efe3c6',
          'frame-b': '#d3bc90',
          'frame-edge': '#9d865c',
          'frame-grain': 'rgba(150, 120, 74, 0.32)',
          'frame-inner': 'rgba(0, 0, 0, 0.45)',
          'piece-a': '#f3f2ea',
          'piece-tip': '#d9d9cf',
          'piece-b': '#f4bac7',
          'piece-line': 'rgba(0, 0, 0, 0.3)',
          'line-filter': 'url(#karatahta-chalk)',
          'text-filter': 'url(#karatahta-chalk-soft)',
          'line-w': '2.7',
          'key-fill': 'rgba(240, 244, 236, 0.05)',
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
        ['wheel-sub', 'wheel-slice', 'text'],
        ['wheel-sub', 'wheel-slice-hover', 'text'],
        ['wheel-sub', 'wheel-slice-selected', 'text'],
        ['mark', 'wheel-face', 'ui'],
      ],

      // Chalk: the stroke edge is pushed about by fine noise and the same noise eats holes into it.
      defs: `
      <filter id="karatahta-chalk" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed="4" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="d"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.4 0 0 0 -0.92" result="g"/>
        <feComposite in="d" in2="g" operator="in"/>
      </filter>
      <filter id="karatahta-chalk-soft" x="-4%" y="-8%" width="108%" height="116%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="1" seed="9" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="0.9" xChannelSelector="R" yChannelSelector="G" result="d"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.2 0 0 0 -0.05" result="g"/>
        <feComposite in="d" in2="g" operator="in"/>
      </filter>`,

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const s = H.s;
          const uid = H.uid(ID);
          const rand = rng(4099 + m.n * 31 + m.kind.length * 7);
          const defs = s('defs', {}, root);

          // Per-wheel gradients take their colors from the palette through CSS.
          const grad = (id, tag, attrs, stops) => {
            const gr = s(tag, Object.assign({ id: uid + id }, attrs), defs);
            for (const [o, cls] of stops) s('stop', { offset: o, class: cls }, gr);
          };
          grad('-sha', 'radialGradient', { cx: 0.5, cy: 0.5, r: 0.5 }, [
            [0.86, 'kt-st-shadow'],
            [1, 'kt-st-clear'],
          ]);
          grad('-fr', 'linearGradient', { x1: 0.2, y1: 0, x2: 0.8, y2: 1 }, [
            [0, 'kt-st-fra'],
            [0.55, 'kt-st-frb'],
            [1, 'kt-st-fra'],
          ]);
          grad('-face', 'radialGradient', { cx: 0.42, cy: 0.32, r: 0.75 }, [
            [0, 'kt-st-facehi'],
            [1, 'kt-st-face'],
          ]);
          grad('-gloss', 'linearGradient', { x1: 0, y1: 0, x2: 0.55, y2: 0.6 }, [
            [0, 'kt-st-gloss'],
            [0.5, 'kt-st-glossend'],
          ]);
          grad('-smudge', 'radialGradient', { cx: 0.5, cy: 0.5, r: 0.5 }, [
            [0, 'kt-st-smudge'],
            [1, 'kt-st-smudge0'],
          ]);

          // Frame, shadow and the chalk tray pieces resting on the rim.
          const frame = s('g', { class: 'kt-frame', 'aria-hidden': 'true' }, root);
          s('circle', { cx: C, cy: C + 7, r: R.shadow, fill: `url(#${uid}-sha)` }, frame);
          s('path', { d: H.ring(R.frameIn, R.frameOut), fill: `url(#${uid}-fr)`, class: 'kt-frame-ring' }, frame);
          let grain = '';
          for (const r of [187.5, 190.2, 192.6, 195])
            grain += wobArc(C, C, r, r, rand() * 360, rand() * 360 + 220, rand, { amp: 0.5, stepDeg: 12 }).d;
          s('path', { d: grain, class: 'kt-frame-grain' }, frame);
          s('circle', { cx: C, cy: C, r: R.frameOut - 0.5, class: 'kt-frame-edge' }, frame);

          // Board face: slate (or white board), a soft sheen, eraser smudges.
          const face = s('g', { class: 'kt-face', 'aria-hidden': 'true' }, root);
          s('circle', { cx: C, cy: C, r: R.frameIn, fill: `url(#${uid}-face)` }, face);
          for (const [a, r, w, h, rot] of [
            [300, 120, 70, 34, -25],
            [125, 140, 62, 28, 40],
            [215, 60, 46, 22, 10],
          ]) {
            const [x, y] = H.polar(r, a);
            s(
              'ellipse',
              {
                cx: f2(x),
                cy: f2(y),
                rx: w,
                ry: h,
                transform: `rotate(${rot} ${f2(x)} ${f2(y)})`,
                fill: `url(#${uid}-smudge)`,
              },
              face,
            );
          }
          s('path', { d: wobArc(C, C, 152, 152, 32, 96, rand, { amp: 2 }).d, class: 'kt-swipe' }, face);
          s('path', { d: wobArc(C, C, 98, 98, 200, 248, rand, { amp: 2 }).d, class: 'kt-swipe' }, face);
          s('circle', { cx: C, cy: C, r: R.frameIn, fill: `url(#${uid}-gloss)`, class: 'kt-gloss' }, face);
          s('circle', { cx: C, cy: C, r: R.frameIn - 0.6, class: 'kt-frame-inner' }, face);

          // Slices: a fill that takes the hover haze, the arrow, the ring, the dust and the words.
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            s('path', { d: H.sector(R.hit0, R.hit1, sl.a0, sl.a1), class: 'kt-fill' }, g);
            const r1 = rng(97 + sl.i * 131 + m.kind.length);
            // Arrow from the hub toward the slice, chalked on hover; drawn once the label is measured.
            const arrow = s('path', { class: 'kt-arrow' }, g);
            const ink = s('g', { class: 'kt-ink' }, g);
            const room = roomAt(sl, R.lbl, 22, 124);
            if (sl.format) {
              H.block(ink, sl, R.lbl, {
                size: 23,
                subSize: 12.5,
                gap: 2,
                maxWidth: room,
                minSize: 10,
                cls: 'kt-lbl kt-fmt',
                subCls: 'kt-sub',
              });
            } else {
              H.block(ink, sl, R.lbl, {
                icon: true,
                iconSize: 24,
                size: 14,
                gap: 4,
                maxWidth: room + 2,
                minSize: 9,
                cls: 'kt-lbl kt-word',
                sub: null,
              });
            }
            // The ring round the label, sized to it, drawn on apply and kept while selected; dust is
            // knocked off along it. Both go under the lettering.
            const bb = ink.getBBox();
            // The arrow stops short of the label, wherever the label's box begins along the slice.
            let reach = R.hub + 28;
            if (bb.width) {
              const u = [Math.sin(H.rad(sl.mid)), -Math.cos(H.rad(sl.mid))];
              let t0 = -Infinity;
              let t1 = Infinity;
              for (const [lo, hi, d] of [
                [bb.x - 4, bb.x + bb.width + 4, u[0]],
                [bb.y - 4, bb.y + bb.height + 4, u[1]],
              ]) {
                if (Math.abs(d) < 1e-6) {
                  if (C < lo || C > hi) t0 = Infinity;
                } else {
                  t0 = Math.max(t0, Math.min((lo - C) / d, (hi - C) / d));
                  t1 = Math.min(t1, Math.max((lo - C) / d, (hi - C) / d));
                }
              }
              if (t0 < t1) reach = Math.min(reach, t0 - 2);
            }
            const p0 = H.polar(R.hub + 5, sl.mid + (r1() - 0.5) * 4);
            const p1 = H.polar(reach, sl.mid);
            const head = (dir) => {
              const [x, y] = p1;
              const a = H.rad(sl.mid + 180 + dir * 28);
              return wobLine([x, y], [x + 8 * Math.sin(a), y - 8 * Math.cos(a)], r1, 0.4);
            };
            // A label that reaches almost to the hub leaves no room: the hover haze is enough there.
            if (reach - R.hub >= 18) arrow.setAttribute('d', wobLine(p0, p1, r1, 1.2) + head(1) + head(-1));
            // More choices: a small chalk arrow near the frame, pointing out.
            const r2 = rng(311 + sl.i * 53);
            H.ringMark(g, sl, m, {
              r: R.rim - 6,
              size: 15,
              shape: (l) =>
                wobLine([0, l], [0, 0], r2, 0.5) +
                wobLine([-5.4, 6], [0, 0], r2, 0.3) +
                wobLine([5.4, 6], [0, 0], r2, 0.3),
              line: true,
              cls: 'kt-ring-mark',
            });
            const [lx, ly] = bb.width ? [bb.x + bb.width / 2, bb.y + bb.height / 2] : H.polar(R.lbl, sl.mid);
            const rx = Math.max(40, (bb.width || 70) / 2 + 15);
            const ry = Math.max(26, (bb.height || 40) / 2 + 10);
            const start = -50 + r1() * 30;
            const loop = wobArc(lx, ly + 1, rx, ry, start, start + 384, r1, { amp: 1.4, drift: 4.5, stepDeg: 14 });
            g.insertBefore(s('path', { d: loop.d, class: 'kt-loop', pathLength: 1 }), ink);
            const dust = s('g', { class: 'kt-dust' });
            g.insertBefore(dust, ink);
            const N = 14;
            for (let k = 0; k < N; k++) {
              const p = loop.pts[Math.floor(((k + 0.5) / N) * (loop.pts.length - 1))];
              const out = Math.atan2(p[1] - ly, p[0] - lx);
              const dist = 7 + r1() * 13;
              const dot = s(
                'circle',
                { cx: f2(p[0]), cy: f2(p[1]), r: f2(1.1 + r1() * 1.5), class: k % 5 === 2 ? 'kt-puff' : null },
                dust,
              );
              if (k % 5 === 2) dot.setAttribute('r', f2(5 + r1() * 3));
              dot.style.setProperty('--dx', f2(Math.cos(out) * dist) + 'px');
              dot.style.setProperty('--dy', f2(Math.sin(out) * dist * 0.6 + 6 + r1() * 8) + 'px');
              dot.style.setProperty('--d', Math.round(220 + (k / N) * 170 + r1() * 40) + 'ms');
            }
          }

          // Chalk lines over everything: two passes round the rim, the dividers, the hub ring.
          const lines = s('g', { class: 'kt-lines', 'aria-hidden': 'true' }, root);
          s(
            'path',
            {
              d: wobArc(C, C, R.rim, R.rim, -12 + rand() * 8, 352, rand, { amp: 1.3, drift: 1.2 }).d,
              class: 'kt-line kt-rim',
            },
            lines,
          );
          s(
            'path',
            { d: wobArc(C, C, R.rim + 2.2, R.rim + 2.2, 60, 300, rand, { amp: 1.6 }).d, class: 'kt-line kt-rim2' },
            lines,
          );
          m.slices.forEach((sl, k) => {
            const a = sl.a0 + (rand() - 0.5) * 1.2;
            const p = s(
              'path',
              {
                d: wobLine(H.polar(R.hub + 1, a), H.polar(R.rim + 1, a + (rand() - 0.5) * 1.5), rand, 1.1),
                class: 'kt-line kt-div',
                pathLength: 1,
              },
              lines,
            );
            p.style.setProperty('--i', k);
          });
          s(
            'path',
            { d: wobArc(C, C, R.hub, R.hub, -20, 352, rand, { amp: 0.9, drift: 1.4 }).d, class: 'kt-line kt-hubring' },
            lines,
          );

          // Hub: wheel name, the dragged file and the key in a hand-drawn box.
          const hub = s('g', { class: 'kt-hub' }, root);
          const ht = s('g', { class: 'kt-hub-ink' }, hub);
          // Without a key (a ring opened from the keyboard, the window ring) the name and file sit lower.
          const dy = m.key ? 0 : 9;
          H.label(ht, C, C - 15 + dy, m.title, { maxWidth: 104, size: 18, minSize: 11, cls: 'kt-title', maxLines: 1 });
          H.label(ht, C, C + 5 + dy, m.file, { maxWidth: 98, size: 12, minSize: 9, cls: 'kt-file', maxLines: 1 });
          if (m.key) {
            const kt = H.text(ht, C, C + 27, m.key, { class: 'kt-keytext' });
            const kw = Math.max(34, kt.getComputedTextLength() + 16);
            const kr = rng(31);
            const box = [
              [C - kw / 2, C + 18],
              [C + kw / 2, C + 18.6],
              [C + kw / 2 + 0.6, C + 36],
              [C - kw / 2, C + 35.4],
            ];
            let bd = '';
            for (let k = 0; k < 4; k++) bd += wobLine(box[k], box[(k + 1) % 4], kr, 0.5);
            s('path', { d: bd, class: 'kt-key' }, hub);
          }
          // Tray pieces lying on the frame: a stick of chalk and a stub (a marker and a cap on the white board).
          const tray = s('g', { class: 'kt-tray', 'aria-hidden': 'true' }, root);
          const piece = (a, len, tip, cls) => {
            const [x, y] = H.polar(191, a);
            const pg = s('g', { transform: `rotate(${a} ${f2(x)} ${f2(y)})` }, tray);
            s('rect', { x: f2(x - len / 2), y: f2(y - 4.4), width: len, height: 8.8, rx: 4, class: cls }, pg);
            if (tip)
              s(
                'rect',
                { x: f2(x + len / 2 - tip), y: f2(y - 4.7), width: tip, height: 9.4, rx: 3, class: 'kt-piece-tip' },
                pg,
              );
          };
          piece(m.dir === 'rtl' ? -158 : 158, 46, 12, 'kt-piece');
          piece(m.dir === 'rtl' ? -196 : 196, 17, 0, 'kt-piece-b');
        },
      },

      sounds: {
        // The dividers chalked out from the hub: a tap, two quick dry strokes and a breath of dust.
        open(ac, out, t) {
          play(ac, out, t, 0.4, 0.028, KEPT.open, (d, sr) => {
            tap(d, sr, 0, { f: 2300, body: 240 });
            chalk(d, sr, 0.006, 0.17, { f: 1800, rate: 1500 });
            chalk(d, sr, 0.05, 0.16, { f: 1500, rate: 1100, gain: 0.6 });
            dust(d, sr, 0.13, 0.25, 0.12);
          });
        },
        // A dry tap of chalk on slate and the flick of its arrow, never twice the same.
        tick(ac, out, t) {
          const r = random();
          play(ac, out, t, 0.07, 0.038, null, (d, sr) => {
            tap(d, sr, 0, { f: 2000 + 700 * r, body: 220 + 80 * random(), gain: 1.4, thump: 0.4 });
            chalk(d, sr, 0.003, 0.022 + 0.014 * random(), { f: 1700 + 500 * random(), rate: 1700, gain: 0.5 });
          });
        },
        // A chalk arrowhead struck in two short strokes into the ring.
        enter(ac, out, t) {
          play(ac, out, t, 0.16, 0.024, null, (d, sr) => {
            tap(d, sr, 0, { f: 2400, body: 250, gain: 0.8 });
            chalk(d, sr, 0.002, 0.045, { f: 1800, rate: 1700, gain: 0.9 });
            tap(d, sr, 0.075, { f: 2700, body: 280, gain: 0.6 });
            chalk(d, sr, 0.077, 0.05, { f: 2100, rate: 1700, gain: 0.9 });
          });
        },
        // Back out: one swipe of the felt eraser.
        leave(ac, out, t) {
          play(ac, out, t, 0.2, 0.051, null, (d, sr) => felt(d, sr, 0, 0.19, 1));
        },
        // The circle scratched round the word in one quick turn, then the chalk lifts with a tap and the
        // dust drifts off.
        success(ac, out, t) {
          play(ac, out, t, 0.75, 0.027, KEPT.success, (d, sr) => {
            chalk(d, sr, 0, 0.4, { f: 1900, rate: 1700, turn: 0.12 });
            tap(d, sr, 0.385, { f: 2200, body: 250, gain: 0.8 });
            dust(d, sr, 0.23, 0.42, 0.25);
          });
        },
      },
    });
  })();
}
