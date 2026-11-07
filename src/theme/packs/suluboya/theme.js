// SPDX-License-Identifier: MIT
// Theme: Suluboya (watercolor). Eight loose washes from a paint box laid on textured paper, each
// with a darker dried edge, a few granules of pigment and a strip of bare paper between them; a
// pencil under-drawing circles the wheel. Pointing adds pigment; applying drops water into the
// slice, and a bloom spreads through it and dries with a dark tide line.
export default function register(Board) {
  (function () {
    'use strict';

    const R = { inner: 66, outer: 172, hub: 56, lbl: 116, sketch: 186 };
    const C = 200;
    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    // Paper grain, rasterized once by the browser: fractal noise tinted like cold-press paper.
    const grain = (r, g, b, a) =>
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='suluboya-n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 ${a} 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23suluboya-n)'/%3E%3C/svg%3E") 0 0 / 220px 220px`;

    function rng(seed) {
      let s = (seed * 2654435761) % 2147483647 || 1;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    }
    // A smooth wobble along a closed outline: a few sines with random phases.
    function wobble(rand, n) {
      const waves = [1, 2, 3, 5].map((k) => [k, rand() * Math.PI * 2, 1 / (k * 0.9 + 0.4)]);
      return (t) => waves.reduce((sum, [k, ph, w]) => sum + w * Math.sin(k * n * t * Math.PI * 2 + ph), 0) / 2.2;
    }
    // Closed Catmull-Rom spline through points, as cubic Beziers.
    function smooth(pts) {
      const n = pts.length;
      let d = `M${f2(pts[0][0])} ${f2(pts[0][1])}`;
      for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n],
          p1 = pts[i],
          p2 = pts[(i + 1) % n],
          p3 = pts[(i + 2) % n];
        d += `C${f2(p1[0] + (p2[0] - p0[0]) / 6)} ${f2(p1[1] + (p2[1] - p0[1]) / 6)} ${f2(p2[0] - (p3[0] - p1[0]) / 6)} ${f2(p2[1] - (p3[1] - p1[1]) / 6)} ${f2(p2[0])} ${f2(p2[1])}`;
      }
      return d + 'Z';
    }
    // The outline of one wash: a sector with bare paper at its sides and a loose, bleeding outer edge.
    function washPath(a0, a1, seed) {
      const rand = rng(seed);
      const side = 3.2; // half the strip of bare paper, in viewBox units
      const pts = [];
      const outer = wobble(rand, 1);
      const inner = wobble(rand, 1);
      const sideA = wobble(rand, 1);
      const sideB = wobble(rand, 1);
      const g0 = (r) => ((side / r) * 180) / Math.PI;
      // Outer edge, a0 to a1.
      // A fine fringe on top of the slow wobble, where pigment bled into damp paper.
      const fringe = [rand() * 6.3, rand() * 6.3];
      // As many points, and as fine a fringe, per degree on a wide slice as on one of 45 degrees.
      const span = (a1 - a0) / 45;
      const count = Math.max(18, Math.round(18 * span));
      for (let k = 0; k <= count; k++) {
        const t = k / count;
        const a = a0 + g0(R.outer) + t * (a1 - a0 - 2 * g0(R.outer));
        const u = t * span;
        const r = R.outer + 6 * outer(t) + 2 + 1.6 * Math.sin(u * 37 + fringe[0]) * Math.sin(u * 13 + fringe[1]);
        pts.push([C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))]);
      }
      // Side at a1, outward to inward.
      for (let k = 1; k < 7; k++) {
        const t = k / 7;
        const r = R.outer - t * (R.outer - R.inner);
        const a = a1 - g0(r) + ((2.2 * sideB(t)) / r) * (180 / Math.PI);
        pts.push([C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))]);
      }
      // Inner edge, a1 back to a0.
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        const a = a1 - g0(R.inner) - t * (a1 - a0 - 2 * g0(R.inner));
        const r = R.inner + 2.5 * inner(t);
        pts.push([C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))]);
      }
      // Side at a0, inward to outward.
      for (let k = 1; k < 7; k++) {
        const t = k / 7;
        const r = R.inner + t * (R.outer - R.inner);
        const a = a0 + g0(r) + ((2.2 * sideA(t)) / r) * (180 / Math.PI);
        pts.push([C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))]);
      }
      return smooth(pts);
    }

    // Whether a point (relative to the centre) lies m inside a slice, between radii rin and rout.
    // Tests the slice's own angles, so it holds for any number of slices and any turn.
    function inSlice(sl, rin, rout, m) {
      const toRad = (a) => (a * Math.PI) / 180;
      const step = sl.a1 - sl.a0;
      const away = (a, rr) => (a < 90 ? rr * Math.sin(toRad(a)) : rr);
      return (x, y) => {
        const rr = Math.hypot(x, y);
        if (rr < rin + m || rr > rout - m) return false;
        if (step >= 359.9) return true;
        const rel = ((((Math.atan2(x, -y) * 180) / Math.PI - sl.a0) % 360) + 360) % 360;
        return rel <= step && away(rel, rr) >= m && away(step - rel, rr) >= m;
      };
    }

    // How wide a level label may be: its lines, centred dy below the point at radius r on the slice's
    // centre line and hh high on each side, must stay inside the slice.
    function room(sl, r, dy, hh, rin, rout, cap, m = 4) {
      const inside = inSlice(sl, rin, rout, m);
      const cx = r * Math.sin((sl.mid * Math.PI) / 180);
      const cy = -r * Math.cos((sl.mid * Math.PI) / 180) + dy;
      const fits = (w) => [-1, 0, 1].every((u) => [-1, 0, 1].every((v) => inside(cx + u * w, cy + v * hh)));
      if (fits(cap / 2)) return cap;
      let lo = 0;
      let hi = cap / 2;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      return Math.max(2 * lo, 40);
    }

    // Draws a slice's label block where it has the most room, at whichever of the given radii lets its
    // lines be widest (outward where the slice runs up or down, nearer the middle where it runs
    // across), then checks the lines as drawn and narrows them until they sit inside the slice. A label
    // is never shortened to fit: if only an ellipsis would make it fit, the last whole one is kept.
    // A single word too long for the slice goes a size smaller before it is shortened.
    function fitBlock(H, parent, sl, radii, o, rin, rout, cap, m = 2) {
      const inside = inSlice(sl, rin, rout, m);
      const iconH = o.icon ? o.iconSize + o.gap : 0;
      const sub = o.sub === undefined ? sl.sub : o.sub;
      const subH = sub ? o.gap + o.subSize * 1.1 : 0;
      const best = (lines) =>
        radii
          .map((r) => [r, room(sl, r, iconH / 2, (lines * o.size * 1.1 + subH) / 2, rin, rout, cap, m + 2)])
          .reduce((a, b) => (b[1] > a[1] + 1 ? b : a));
      const draw = (r, width) => {
        parent.textContent = '';
        return H.block(parent, sl, r, { ...o, maxWidth: width });
      };
      // How wide each line as drawn may be where it sits, and whether every line is within that.
      const lines = (parts) => {
        const spans = [...parts.label.querySelectorAll('tspan')];
        const list = (spans.length ? spans : [parts.label]).map((line) => [line, parts.label]);
        if (parts.sub) list.push([parts.sub, parts.sub]);
        return list.map(([line, text]) => {
          const hh = +text.getAttribute('font-size') * 0.42;
          const cx = +text.getAttribute('x') - 200;
          const cy = line.getStartPositionOfChar(0).y - 200;
          const ok = (half) => [-1, 0, 1].every((u) => [-1, 1].every((v) => inside(cx + u * half, cy + v * hh)));
          let allowed = cap;
          if (!ok(cap / 2)) {
            let lo = 0;
            let hi = cap / 2;
            for (let k = 0; k < 10; k++) {
              const half = (lo + hi) / 2;
              if (ok(half)) lo = half;
              else hi = half;
            }
            allowed = 2 * lo;
          }
          return { width: line.getComputedTextLength(), allowed };
        });
      };
      const shortened = () => !!parent.querySelector('[data-fit="shortened"]');
      let [r, width] = best(1);
      let parts = draw(r, width);
      // A single long word that would need an ellipsis may go a size smaller first.
      if (shortened()) {
        o = { ...o, minSize: Math.max(8.5, o.minSize - 1.5) };
        parts = draw(r, width);
      }
      for (let k = 0; k < 4 && !shortened(); k++) {
        const drawn = lines(parts);
        const over = drawn.filter((line) => line.width > line.allowed + 0.5);
        if (!over.length) break;
        const last = [r, width];
        r = best(drawn.length - (parts.sub ? 1 : 0))[0];
        width = Math.max(30, Math.min(width * 0.96, ...over.map((line) => line.allowed)));
        parts = draw(r, width);
        if (shortened()) {
          [r, width] = last;
          parts = draw(r, width);
          break;
        }
      }
      parts.r = r;
      return parts;
    }

    // A soft irregular blob around cx, cy.
    function blob(cx, cy, r, seed, lobes = 9, amp = 0.16) {
      const rand = rng(seed);
      const w = wobble(rand, 1);
      const pts = [];
      for (let k = 0; k < lobes * 2; k++) {
        const t = k / (lobes * 2);
        const rr = r * (1 + amp * w(t));
        pts.push([cx + rr * Math.sin(t * Math.PI * 2), cy - rr * Math.cos(t * Math.PI * 2)]);
      }
      return smooth(pts);
    }

    // Sounds: bristles, water and pigment, drawn sample by sample at the context's rate. One buffer
    // per sound keeps a dab to two nodes however fast the pointer sweeps, and lets every dab differ a
    // little; the opening and the applying sound alike each time, so they are drawn once per rate and
    // kept (`keep`). Each buffer starts and ends at zero and its gain opens from silence, so nothing
    // clicks.
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
    // A smooth rise over the first `rise` of a sound and a fall over the rest, 0 to 1 and back.
    const hump = (u, rise) =>
      u < rise ? Math.sin((Math.PI / 2) * (u / rise)) ** 2 : Math.cos((Math.PI / 2) * ((u - rise) / (1 - rise))) ** 2;
    // Bristles dragged over cold-press paper: noise through a band that moves with the stroke, its level
    // jostled by the paper's tooth, over a soft low body where the brush is wet. Water dulls the top.
    function bristles(d, sr, at, len, { f0, f1 = f0, q = 0.9, tooth = 0.5, wet = 0.4, rise = 0.2, gain = 1 }) {
      const rnd = white();
      const band = svf();
      const body = svf();
      const dull = svf();
      const top = 2.2 * Math.max(f0, f1);
      const i0 = Math.round(at * sr);
      const m = Math.round(len * sr);
      const step = Math.round(sr / 230);
      const glide = 1 - Math.exp((-2 * Math.PI * 180) / sr);
      let bump = 1;
      let aim = 1;
      for (let i = 0; i < m && i0 + i < d.length; i++) {
        const u = i / m;
        if (i % step === 0) aim = 1 + tooth * rnd();
        bump += (aim - bump) * glide;
        const x = rnd();
        dull(band(x, f0 * (f1 / f0) ** u, q, sr) + wet * body(x, 430, 0.8, sr), top, 0.7, sr);
        d[i0 + i] += gain * hump(u, rise) * bump * dull.lp;
      }
    }
    // A bubble of water: a sine whose pitch rises as the bubble closes, gone in a few hundredths.
    function plip(d, sr, at, f0, f1, len, gain) {
      const i0 = Math.round(at * sr);
      const m = Math.round(len * sr);
      let ph = 0;
      for (let i = 0; i < m && i0 + i < d.length; i++) {
        const s = i / sr;
        ph += (2 * Math.PI * f0 * (f1 / f0) ** Math.min(1, (1.5 * i) / m)) / sr;
        d[i0 + i] += gain * Math.min(1, s / 0.0015) * Math.exp(-s / (len * 0.28)) * Math.sin(ph);
      }
    }
    // Water spreading through wet pigment: a hush that sinks and slows as the bloom widens, with a
    // faint fizz where the paper drinks it in.
    function bloom(d, sr, at, len, gain) {
      const rnd = white();
      const band = svf();
      const fizz = svf();
      const dull = svf();
      const i0 = Math.round(at * sr);
      const m = Math.round(len * sr);
      for (let i = 0; i < m && i0 + i < d.length; i++) {
        const s = i / sr;
        const e = Math.min(1, s / 0.11) ** 2 * Math.exp(-Math.max(0, s - 0.11) / 0.2) * hump(i / m, 0.02);
        const crack = random() < (340 * Math.exp(-s / 0.22)) / sr ? (0.4 + random()) * 9 : 0;
        dull(band(rnd(), 760 + 1650 * Math.exp(-s / 0.17), 1.1, sr) + 0.5 * fizz(crack, 2700, 1.4, sr), 2800, 0.7, sr);
        d[i0 + i] += gain * e * dull.lp;
      }
    }
    const KEPT = { open: new Map(), success: new Map() };

    Board.define({
      id: 'suluboya',
      fonts: {
        brand: "'Caveat'",
        load: ["'Caveat'"],
        credits: [{ family: 'Caveat', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 190, close: 130, stagger: 16, apply: 700 },
      palette: {
        light: {
          bg: '#f7f6f2',
          surface: '#ffffff',
          'surface-2': '#f0efea',
          border: '#dcdad2',
          'border-strong': '#9a978c',
          text: '#1d2030',
          'text-muted': '#555a6b',
          accent: '#3d5fbf',
          'on-accent': '#ffffff',
          focus: '#3d5fbf',
          success: '#2f8a5f',
          'on-success': '#ffffff',
          'success-text': '#24724d',
          warning: '#d9a41e',
          'warning-text': '#6b4f00',
          danger: '#c8456b',
          desk: `${grain(0.42, 0.4, 0.36, 0.11)}, radial-gradient(circle at 45% 40%, #fdfcf9 0%, #f3f2ec 80%)`,
          'wheel-face': '#fbfaf6',
          'wheel-slice': '#dce4f6',
          'wheel-slice-hover': '#bccbef',
          'wheel-slice-selected': '#8ea6e3',
          'wheel-text': '#161929',
          'wheel-text-selected': '#11131f',
          'wheel-line': '#8a8f9c',
          'wheel-shadow': 'rgba(60, 60, 80, 0.12)',
          'su-1': '#4f72cf',
          'su-2': '#2f9e93',
          'su-3': '#e0679a',
          'su-4': '#f0b93a',
          'su-5': '#8d6fd6',
          'su-6': '#6fae55',
          'su-7': '#3ea6d6',
          'su-8': '#ef7f68',
          'su-idle': '0.3',
          'su-hover': '0.5',
          'su-sel': '0.62',
          'su-edge': '0.55',
          'su-granule': '0.4',
          'su-sub': '#2a2e40',
          'su-pencil': '#7f8494',
          'su-hub': '#6b7187',
          'su-hub-wash': '0.14',
          'su-hub-text': '#161929',
          'su-hub-muted': '#4a4f61',
          'su-ink-sel': '#11131f',
          'su-tide-mix': '#1d2030',
        },
        dark: {
          bg: '#15161f',
          surface: '#1d1f2b',
          'surface-2': '#252836',
          border: '#343747',
          'border-strong': '#646a80',
          text: '#f1eee6',
          'text-muted': '#b3b0a6',
          accent: '#9db4ff',
          'on-accent': '#11131f',
          focus: '#9db4ff',
          success: '#71d3a0',
          'on-success': '#0d2418',
          'success-text': '#86dcae',
          warning: '#ffd36b',
          'warning-text': '#ffd980',
          danger: '#ff8fb0',
          desk: `${grain(0.85, 0.85, 0.9, 0.07)}, radial-gradient(circle at 45% 40%, #1d1f2b 0%, #12131b 80%)`,
          'wheel-face': '#1a1c27',
          'wheel-slice': '#2a3150',
          'wheel-slice-hover': '#3a4778',
          'wheel-slice-selected': '#7d93df',
          'wheel-text': '#f3f0e8',
          'wheel-text-selected': '#11131f',
          'wheel-line': '#8d92a8',
          'wheel-shadow': 'rgba(0, 0, 0, 0.4)',
          'su-1': '#8fa8ff',
          'su-2': '#5fe0cf',
          'su-3': '#ff9cd0',
          'su-4': '#d6a8ff',
          'su-5': '#a6b4ff',
          'su-6': '#8ff0b0',
          'su-7': '#78d0ff',
          'su-8': '#ff94b4',
          'su-idle': '0.26',
          'su-hover': '0.42',
          'su-sel': '0.86',
          'su-edge': '0.6',
          'su-granule': '0.45',
          'su-sub': '#e2ded3',
          'su-pencil': '#8d92a8',
          'su-hub': '#c9c4b8',
          'su-hub-wash': '0.12',
          'su-hub-text': '#f3f0e8',
          'su-hub-muted': '#c4c0b5',
          'su-ink-sel': '#11131f',
          'su-tide-mix': '#2a1f3a',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['su-sub', 'wheel-slice', 'text'],
        ['su-sub', 'wheel-slice-hover', 'text'],
        ['su-hub-text', 'wheel-face', 'text'],
        ['su-hub-muted', 'wheel-face', 'text'],
      ],
      icons: {
        more: '<path d="M3.2 12.4c.6-1.6 2.6-1.8 3.2-.2.5 1.4-1.2 2.6-2.4 1.9-.6-.3-1-1-.8-1.7zM10.3 12c.5-1.5 2.7-1.7 3.3-.2.6 1.5-1.3 2.7-2.5 1.9-.7-.4-1-1.1-.8-1.7zM17.4 12.3c.5-1.6 2.7-1.6 3.3 0 .5 1.4-1.3 2.4-2.5 1.7-.6-.4-1-1-.8-1.7z" fill="currentColor" stroke="none"/>',
      },
      defs: '',

      wheel: {
        render(root, m, H) {
          const s = H.s;
          const uid = H.uid('suluboya');
          const defs = s('defs', {}, root);
          // Pencil under-drawing: a loose circle drawn twice, with an overshoot.
          const pencil = s('g', { class: 'su-pencil', 'aria-hidden': 'true' }, root);
          s('path', { d: blob(C, C, R.sketch, 7, 6, 0.012), class: 'su-pencil-line' }, pencil);
          s(
            'path',
            { d: blob(C + 1.5, C - 1, R.sketch + 3, 19, 5, 0.014), class: 'su-pencil-line su-pencil-2' },
            pencil,
          );

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            g.classList.add('su-p' + ((sl.i % 8) + 1));
            const d = washPath(sl.a0, sl.a1, sl.i * 31 + 5);
            s('path', { d: H.sector(R.inner - 6, R.outer + 8, sl.a0, sl.a1), class: 'su-hit' }, g);
            const wash = s('g', { class: 'su-washg' }, g);
            // Pigment settles toward the outer edge: a radial gradient in the slice's own color.
            const gid = `${uid}-g${sl.i}`;
            const grad = s(
              'radialGradient',
              { id: gid, gradientUnits: 'userSpaceOnUse', cx: C, cy: C, r: R.outer + 8 },
              g,
            );
            s('stop', { offset: 0.38, style: 'stop-color: var(--su-c); stop-opacity: 0.5' }, grad);
            s('stop', { offset: 0.8, style: 'stop-color: var(--su-c); stop-opacity: 0.85' }, grad);
            s('stop', { offset: 1, style: 'stop-color: var(--su-c); stop-opacity: 1' }, grad);
            s('path', { d, class: 'su-wash', style: `fill: url(#${gid})` }, wash);
            // Uneven pigment: one denser patch toward the outer edge.
            const [px, py] = H.polar(R.outer - 26, sl.mid + (sl.i % 2 ? 6 : -6));
            s('path', { d: blob(px, py, 22, sl.i * 7 + 3, 7, 0.22), class: 'su-pool' }, wash);
            // Granules of pigment, scattered away from the label.
            const rand = rng(sl.i * 13 + 2);
            let gd = '';
            const granules = Math.min(80, Math.round((26 * sl.step) / 45));
            for (let k = 0; k < granules; k++) {
              const r = k % 3 ? R.outer - 4 - rand() * 30 : R.inner + 4 + rand() * 16;
              const a = sl.a0 + 4 + rand() * (sl.a1 - sl.a0 - 8);
              const [x, y] = H.polar(r, a);
              const rr = 0.5 + rand() * 0.9;
              gd += `M${f2(x - rr)} ${f2(y)}a${f2(rr)} ${f2(rr)} 0 1 0 ${f2(2 * rr)} 0a${f2(rr)} ${f2(rr)} 0 1 0 ${f2(-2 * rr)} 0`;
            }
            s('path', { d: gd, class: 'su-granules' }, wash);
            s('path', { d, class: 'su-edge' }, wash);
            // A second, broken edge: dried pigment is darker in some places than others.
            s(
              'path',
              {
                d,
                class: 'su-edge su-edge-2',
                'stroke-dasharray': `${18 + (sl.i % 3) * 7} 14 9 ${22 - (sl.i % 4) * 3}`,
              },
              wash,
            );

            // The bloom: clipped to the wash, it spreads from a drop near the label and dries with a tide line.
            const clipId = `${uid}-c${sl.i}`;
            s('path', { d }, s('clipPath', { id: clipId }, defs));
            const bloom = s('g', { class: 'su-bloom', 'clip-path': `url(#${clipId})` }, g);
            // A transform attribute places it on the label once the label has its place; the inner group
            // carries the CSS scale of the spread.
            const bloomAt = s('g', {}, bloom);
            const spread = s('g', { class: 'su-spread' }, bloomAt);
            const bd = blob(0, 0, 45, sl.i * 17 + 9, 8, 0.2);
            s('path', { d: bd, class: 'su-bloom-fill' }, spread);
            s('path', { d: bd, class: 'su-tide' }, spread);
            s('path', { d: blob(0, 0, 24, sl.i * 5 + 1, 7, 0.25), class: 'su-backrun' }, spread);
            const dropAt = s('g', {}, g);
            const drop = s('g', { class: 'su-drop' }, dropAt);
            s('circle', { cx: 0, cy: 0, r: 9, class: 'su-drop-ring' }, drop);

            const ink = s('g', { class: 'su-ink' }, g);
            const wide = sl.step >= 70;
            const o = sl.format
              ? { size: sl.sub ? 30 : 36, subSize: 18, gap: -2, minSize: 14, cls: 'su-lbl su-fmt', subCls: 'su-sub' }
              : {
                  icon: true,
                  iconSize: wide ? 28 : 23,
                  size: wide ? 21 : 19,
                  gap: 2,
                  minSize: 13,
                  cls: 'su-lbl su-word',
                  sub: null,
                };
            // The washes wobble and leave a strip of paper between them, so labels keep a wider margin.
            const fitted = fitBlock(H, ink, sl, [R.lbl, R.lbl + 6, R.lbl - 6, R.lbl - 12], o, R.inner, R.outer, 116, 6);
            const [bx, by] = H.polar(fitted.r + 4, sl.mid);
            bloomAt.setAttribute('transform', `translate(${f2(bx)} ${f2(by)})`);
            dropAt.setAttribute('transform', `translate(${f2(bx)} ${f2(by)})`);
            // More choices: a brushed chevron near the outer edge of the wash, pointing out.
            H.ringMark(g, sl, m, {
              r: R.outer - 11,
              size: 10,
              shape: (l) => `M${-l * 0.8} ${l}Q${-l * 0.3} ${l * 0.45} 0 0Q${l * 0.35} ${l * 0.5} ${l * 0.8} ${l}`,
              line: true,
              cls: 'su-ring-mark',
            });
          }

          // Hub: a pale gray wash with the wheel's name, the file and the key in a pencil box.
          const hub = s('g', { class: 'su-hubg' }, root);
          s('path', { d: blob(C, C, R.hub, 41, 8, 0.07), class: 'su-hub' }, hub);
          s('path', { d: blob(C, C, R.hub, 41, 8, 0.07), class: 'su-hub-edge' }, hub);
          // As wide as the wash allows: a long title (Russian "Convert") shrinks rather than shortens.
          H.label(hub, C, C - 17, m.title, { maxWidth: 98, size: 23, minSize: 12, cls: 'su-title', maxLines: 1 });
          H.label(hub, C, C + (m.key ? 3 : 8), m.file, {
            maxWidth: 88,
            size: 17,
            minSize: 12,
            cls: 'su-file',
            maxLines: 1,
          });
          if (m.key) {
            const box = s('path', { class: 'su-key' }, hub);
            const text = H.text(hub, C, C + 28, m.key, { class: 'su-keytext' });
            const kw = Math.min(92, Math.ceil(text.getComputedTextLength()) + 18);
            box.setAttribute('d', `M${f2(C - kw / 2)} ${C + 18.5}l${f2(kw + 1.5)} -0.8l-0.6 18.6l${f2(-kw - 1)} 0.6z`);
          }
        },
      },

      sounds: {
        open(ac, out, t) {
          // A loaded brush laid on damp paper in one broad stroke as the washes spread: a soft wet swish.
          play(ac, out, t, 0.42, 0.036, KEPT.open, (d, sr) => {
            bristles(d, sr, 0, 0.36, { f0: 850, f1: 1650, q: 0.8, tooth: 0.55, wet: 0.7, rise: 0.3 });
            plip(d, sr, 0.19, 880, 1320, 0.05, 0.1);
          });
        },
        tick(ac, out, t) {
          // A dab of pigment: the bristles touch the paper with a tiny wet plip, never twice the same.
          const f = 1500 + 700 * random();
          const p = 950 + 450 * random();
          play(ac, out, t, 0.08, 0.021, null, (d, sr) => {
            bristles(d, sr, 0, 0.006, { f0: 2600, q: 0.8, tooth: 0, wet: 0, rise: 0.3, gain: 1.6 });
            bristles(d, sr, 0, 0.045 + 0.02 * random(), { f0: f, f1: f * 0.8, q: 1, tooth: 0.5, rise: 0.05 });
            plip(d, sr, 0.004 + 0.008 * random(), p, p * 1.4, 0.03, 0.18 + 0.15 * random());
          });
        },
        enter(ac, out, t) {
          // The brush dipped into the water jar: a soft plunk and a swirl of water round the bristles.
          play(ac, out, t, 0.25, 0.019, null, (d, sr) => {
            plip(d, sr, 0, 430, 760, 0.075, 0.5);
            plip(d, sr, 0.055, 820, 1250, 0.04, 0.2);
            bristles(d, sr, 0.02, 0.2, { f0: 650, f1: 1050, q: 1.2, tooth: 0.9, wet: 0.8, rise: 0.25 });
          });
        },
        leave(ac, out, t) {
          // The brush lifted out of the jar: a light drag of the bristles and two drips falling back.
          play(ac, out, t, 0.23, 0.023, null, (d, sr) => {
            bristles(d, sr, 0, 0.065, { f0: 1700, f1: 2300, q: 0.9, tooth: 0.4, wet: 0.3, rise: 0.2 });
            plip(d, sr, 0.075, 1200, 1750, 0.035, 0.35);
            plip(d, sr, 0.165, 1000, 1500, 0.035, 0.22);
          });
        },
        success(ac, out, t) {
          // A drop of water lands in the wash, and the bloom creeps out through the pigment and slows as it dries.
          play(ac, out, t, 0.95, 0.107, KEPT.success, (d, sr) => {
            bristles(d, sr, 0, 0.014, { f0: 900, q: 0.7, tooth: 0, wet: 1, rise: 0.15, gain: 0.8 });
            plip(d, sr, 0.002, 620, 1180, 0.065, 0.6);
            plip(d, sr, 0.07, 1250, 1800, 0.04, 0.2);
            bloom(d, sr, 0.05, 0.85, 0.85);
          });
        },
      },
    });
  })();
}
