// SPDX-License-Identifier: MIT
// Theme: Art Deco. A medallion of black lacquer (ivory in the light theme) ruled in gold: every
// slice carries a faint sunburst of gold rays and ends in a stepped crown, so the outline is a ring
// of small ziggurats. Applying a slice opens its sunburst like a fan and lays gold (or lacquer) over it.
export default function register(Board) {
  (function () {
    'use strict';

    const R = { hub: 52, hubRing: 60, ray0: 64, face: 168, crown: [170, 179, 188], lbl: 112 };
    // Nine rays fan across a slice of 45 degrees; wider slices get more, at the same spacing.
    const RAYS = 9;
    const f2 = (n) => Math.round(n * 100) / 100;
    const C = 200;
    const rad = (a) => (a * Math.PI) / 180;
    const P = (r, a) => [C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))];
    const pt = (r, a) => P(r, a).map(f2).join(' ');
    // Uppercase for display type; scripts without case keep their text.
    const caps = (t, lang) => (/^(ja|zh|ko|ar)/.test(lang) ? t : t.toLocaleUpperCase(lang));

    // The stepped crown of one slice, as an open path from a0 to a1, inset by `inset` units. The crown
    // keeps the size it has on a slice of 45 degrees, centred on the slice; a wider slice runs flat
    // on either side of it.
    function crown(a0, a1, inset) {
      const mid = (a0 + a1) / 2;
      const w = Math.min(a1 - a0, 45);
      const [r0, r1, r2] = R.crown.map((r) => r - inset);
      const steps = [
        [mid - 0.26 * w, r1],
        [mid - 0.14 * w, r2],
        [mid + 0.14 * w, r1],
        [mid + 0.26 * w, r0],
      ];
      let d = `M${pt(r0, a0)}`;
      let prevR = r0;
      let prevA = a0;
      for (const [a, r] of steps) {
        d += `A${prevR} ${prevR} 0 ${a - prevA > 180 ? 1 : 0} 1 ${pt(prevR, a)}L${pt(r, a)}`;
        prevR = r;
        prevA = a;
      }
      return d + `A${prevR} ${prevR} 0 ${a1 - prevA > 180 ? 1 : 0} 1 ${pt(prevR, a1)}`;
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

    // Sounds: struck gold, drawn sample by sample at the context's rate into one stereo buffer per
    // sound, so a tick costs two nodes however fast the pointer sweeps and every call can differ a
    // little; the opening and the applying sound alike each time, so they are drawn once per rate and
    // kept (`keep`). Each buffer starts and ends at zero and its gain opens from silence, so nothing
    // clicks.
    function play(ac, out, t, dur, level, keep, draw) {
      const sr = ac.sampleRate;
      let buf = keep && keep.get(sr);
      if (!buf) {
        random = keep ? seeded(7) : Math.random;
        const n = Math.ceil(dur * sr);
        buf = ac.createBuffer(2, n, sr);
        const ch = [buf.getChannelData(0), buf.getChannelData(1)];
        draw(ch, sr);
        const fade = Math.min(n, Math.round(sr * 0.004));
        for (const d of ch) for (let i = 1; i <= fade; i++) d[n - i] *= (i - 1) / fade;
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
    // The notes of a D-flat six-nine chord, the dance band's glamour; any of them sound well together.
    const SIX_NINE = [277.18, 311.13, 349.23, 415.3, 466.16];
    const note = (k) => SIX_NINE[((k % 5) + 5) % 5] * 2 ** Math.floor(k / 5);
    // A sine table read by phase in turns: a chord of gold is a hundred thousand samples, and the table
    // is several times cheaper than Math.sin and as clean (its error is far below hearing).
    const SINE = Float32Array.from({ length: 4097 }, (v, i) => Math.sin((2 * Math.PI * i) / 4096));
    const sine = (p) => {
      const x = (p - Math.floor(p)) * 4096;
      const i = x | 0;
      return SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i);
    };
    // A struck bar of gold: a sine phase-modulated at an inharmonic ratio, bright and metallic at the
    // stroke and mellowing as it rings, with the faint fourth harmonic of a tuned bar. `trem` adds the
    // slow beat of a vibraphone's fans.
    function gold(ch, sr, at, f, { ring = 0.1, bright = 1, gain = 1, a = 0.0015, trem = 0, pan = 0, len = ring * 6 }) {
      const gl = gain * Math.min(1, 1 - pan);
      const gr = gain * Math.min(1, 1 + pan);
      const i0 = Math.round(at * sr);
      const m = Math.min(Math.round(len * sr), ch[0].length - i0);
      const turn = f / sr;
      // Each part of the sound fades by its own factor every sample.
      const fall = Math.exp(-1 / (ring * sr));
      const dim = Math.exp(-1 / (ring * 0.2 * sr));
      const thin = Math.exp(-1 / (ring * 0.3 * sr));
      let e = 1;
      let index = bright / (2 * Math.PI);
      let over = 4 * f < 8000 ? 0.18 : 0;
      for (let i = 0; i < m; i++) {
        const s = i / sr;
        const p = turn * i;
        const beat = trem ? 1 - trem * (0.5 - 0.5 * sine(5.4 * s + 0.25)) : 1;
        const v = (sine(p + index * sine(1.41 * p)) + over * sine(4 * p)) * e * beat;
        const shape = Math.min(1, s / a, (m - i) / (0.25 * m));
        ch[0][i0 + i] += gl * shape * v;
        ch[1][i0 + i] += gr * shape * v;
        e *= fall;
        index *= dim;
        over *= thin;
      }
    }
    // Light running along gilt: a breath of noise through a narrow band (Q 3) sweeping upward.
    function sheen(ch, sr, at, len, f0, f1, gain) {
      let seed = (random() * 4294967295) >>> 0 || 1;
      let a = 0;
      let b = 0;
      let g = 0;
      const i0 = Math.round(at * sr);
      const m = Math.min(Math.round(len * sr), ch[0].length - i0);
      for (let i = 0; i < m; i++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        const u = i / m;
        // A state-variable band-pass; its centre moves slowly enough to be set every 32 samples.
        if (i % 32 === 0) g = Math.tan((Math.PI * f0 * (f1 / f0) ** u) / sr);
        const v1 = (a + g * ((seed | 0) / 2147483648 - b)) / (1 + g * (g + 1 / 3));
        const v2 = b + g * v1;
        a = 2 * v1 - a;
        b = 2 * v2 - b;
        const v = (gain / 3) * v1 * Math.sin(Math.PI * u) ** 2;
        ch[0][i0 + i] += v;
        ch[1][i0 + i] += v;
      }
    }
    const KEPT = { open: new Map(), success: new Map() };

    Board.define({
      id: 'artdeco',
      // Limelight has no Cyrillic; Yeseva One, as high in contrast, draws those letters.
      fonts: {
        brand: "'Raleway'",
        display: "'Limelight', 'Yeseva One'",
        load: ["'Raleway'", "'Limelight', 'Yeseva One'"],
        credits: [
          { family: 'Raleway', license: 'SIL Open Font License 1.1' },
          { family: 'Limelight', license: 'SIL Open Font License 1.1' },
          { family: 'Yeseva One', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 120, stagger: 12, apply: 680 },
      palette: {
        light: {
          bg: '#f7f2e6',
          surface: '#fffcf4',
          'surface-2': '#f1eadb',
          border: '#ddd2b8',
          'border-strong': '#a8987a',
          text: '#1a1814',
          'text-muted': '#5b5446',
          accent: '#1a1814',
          'on-accent': '#f0d690',
          focus: '#8a6a22',
          success: '#2f7a55',
          'on-success': '#ffffff',
          'success-text': '#256646',
          warning: '#b8861c',
          'warning-text': '#6e5000',
          danger: '#a8322a',
          desk: 'radial-gradient(circle at 50% 42%, #fbf7ec 0%, #efe6d0 75%)',
          'wheel-face': '#fbf7ec',
          'wheel-slice': '#fbf7ec',
          'wheel-slice-hover': '#f1e4bd',
          'wheel-slice-selected': '#16161a',
          'wheel-text': '#1a1814',
          'wheel-text-selected': '#ecd08a',
          'wheel-line': '#a8843a',
          'wheel-shadow': 'rgba(80, 60, 20, 0.22)',
          'ad-slice-b': '#f5efe0',
          'ad-slice-c': '#f8f1de',
          'ad-gold': '#a8843a',
          'ad-gold-hi': '#d7b562',
          'ad-gold-lo': '#7d6020',
          'ad-ray': '#b9963f',
          'ad-ray-idle': '0.2',
          'ad-ray-hover': '0.42',
          'ad-ray-sel': '0.62',
          'ad-sel-ray': '#c9a550',
          'ad-sub': '#5b5446',
          'ad-crown': '#f3ead2',
          'ad-crown-sel': '#16161a',
          'ad-hub': '#16161a',
          'ad-hub-text': '#ecd08a',
          'ad-hub-muted': '#c9bfa6',
          'ad-glint': '#fff3c8',
          'ad-sel-hi': '#26262c',
          'ad-sel-mid': '#18181c',
          'ad-sel-lo': '#0f0f12',
          'ad-fan': '#a8843a',
        },
        dark: {
          bg: '#0f0f12',
          surface: '#18181c',
          'surface-2': '#202026',
          border: '#34322c',
          'border-strong': '#6c624a',
          text: '#f2ead6',
          'text-muted': '#bdb39b',
          accent: '#e2c071',
          'on-accent': '#141210',
          focus: '#e2c071',
          success: '#6fcf9a',
          'on-success': '#0c2417',
          'success-text': '#86dbab',
          warning: '#e8b84a',
          'warning-text': '#f0c96a',
          danger: '#ff7a6b',
          desk: 'radial-gradient(circle at 50% 42%, #24242b 0%, #0c0c10 72%)',
          'wheel-face': '#141417',
          'wheel-slice': '#141417',
          'wheel-slice-hover': '#2a2517',
          'wheel-slice-selected': '#e2c071',
          'wheel-text': '#ecd08a',
          'wheel-text-selected': '#141210',
          'wheel-line': '#c9a550',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'ad-slice-b': '#19191d',
          'ad-slice-c': '#1d1c1a',
          'ad-gold': '#c9a550',
          'ad-gold-hi': '#f3d98f',
          'ad-gold-lo': '#8a6a2a',
          'ad-ray': '#d4b05a',
          'ad-ray-idle': '0.16',
          'ad-ray-hover': '0.38',
          'ad-ray-sel': '0.5',
          'ad-sel-ray': '#9a7630',
          'ad-sub': '#cfc5ac',
          'ad-crown': '#101013',
          'ad-crown-sel': '#e2c071',
          'ad-hub': '#0c0c0f',
          'ad-hub-text': '#ecd08a',
          'ad-hub-muted': '#b5ab92',
          'ad-glint': '#fff6d6',
          'ad-sel-hi': '#f3d98f',
          'ad-sel-mid': '#e2c071',
          'ad-sel-lo': '#c79f4c',
          'ad-fan': '#f3d98f',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['wheel-text', 'ad-slice-b', 'text'],
        ['wheel-text', 'ad-slice-c', 'text'],
        ['ad-sub', 'ad-slice-c', 'text'],
        ['ad-sub', 'wheel-slice', 'text'],
        ['ad-sub', 'ad-slice-b', 'text'],
        ['ad-sub', 'wheel-slice-hover', 'text'],
        ['ad-hub-text', 'ad-hub', 'text'],
        ['ad-hub-muted', 'ad-hub', 'text'],
        ['ad-gold', 'wheel-face', 'ui'],
      ],
      // "More…" as three stepped diamonds.
      icons: {
        more: '<path d="M5 9.5l2.5 2.5L5 14.5 2.5 12zM12 8.5l3.5 3.5-3.5 3.5L8.5 12zM19 9.5l2.5 2.5-2.5 2.5-2.5-2.5z" fill="currentColor" stroke="none"/>',
      },
      defs: '',

      wheel: {
        render(root, m, H) {
          const s = H.s;
          const uid = H.uid('artdeco');
          const defs = s('defs', {}, root);
          // Gilding: a vertical sheen from bright to deep gold, used by the applied slice and the hub rings.
          const gg = s('linearGradient', { id: uid + '-gild', x1: 0, y1: 0, x2: 0.35, y2: 1 }, defs);
          s('stop', { offset: 0, class: 'ad-s-hi' }, gg);
          s('stop', { offset: 0.5, class: 'ad-s-mid' }, gg);
          s('stop', { offset: 1, class: 'ad-s-lo' }, gg);
          root.style.setProperty('--ad-gild', `url(#${uid}-gild)`);

          // Silhouette: the ring of stepped crowns, filled, with a soft shadow.
          // The crowns joined clockwise, whichever way the slices run (right to left they run the other way).
          let outline = '';
          const spans = m.slices.map((sl) => [((sl.a0 % 360) + 360) % 360, sl.a1 - sl.a0]).sort((p, q) => p[0] - q[0]);
          for (const [a0, step] of spans)
            outline += outline ? crown(a0, a0 + step, 0).replace(/^M/, 'L') : crown(a0, a0 + step, 0);
          outline += 'Z';
          s('path', { d: outline, class: 'ad-shadow', transform: 'translate(0 6)' }, root);
          s('path', { d: outline, class: 'ad-crownfill' }, root);
          s('circle', { cx: C, cy: C, r: R.face, class: 'ad-face' }, root);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            // Neighbours alternate; an odd count gives the last slice a third tone.
            if (m.n % 2 && sl.i === m.n - 1 && m.n > 1) g.classList.add('ad-c');
            else if (sl.i % 2) g.classList.add('ad-b');
            s('path', { d: H.sector(R.hubRing, R.crown[0], sl.a0, sl.a1), class: 'ad-hit' }, g);
            s('path', { d: H.sector(R.hubRing, R.face, sl.a0, sl.a1), class: 'ad-fill' }, g);
            s('path', { d: H.sector(R.hubRing, R.face, sl.a0, sl.a1), class: 'ad-gilt' }, g);
            // The crown cap of this slice, gilded when applied.
            s(
              'path',
              {
                d: crown(sl.a0, sl.a1, 0) + `L${pt(R.face, sl.a1)}A${R.face} ${R.face} 0 0 0 ${pt(R.face, sl.a0)}Z`,
                class: 'ad-cap',
              },
              g,
            );
            // Sunburst: thin wedges fanning out from the hub.
            const rays = s('g', { class: 'ad-rays' }, g);
            const count = 2 * Math.round(((RAYS - 1) / 2) * Math.max(1, sl.step / 45)) + 1;
            const centre = (count - 1) / 2;
            for (let k = 0; k < count; k++) {
              const off = (k - centre) * (Math.min(sl.step, 45) / (RAYS + 0.6));
              const a = sl.mid + off;
              const w = k % 2 ? 0.55 : 1.15;
              const ray = s(
                'path',
                { d: `M${pt(R.ray0, a)}L${pt(R.face - 2, a - w)}L${pt(R.face - 2, a + w)}Z`, class: 'ad-ray' },
                rays,
              );
              ray.style.setProperty('--fan', f2(-off) + 'deg');
              // The fan opens from the centre line; the outermost rays start about 70 ms later.
              ray.style.setProperty('--k', f2((Math.abs(k - centre) / Math.max(1, centre)) * 4));
            }
            // The crown's inner gold line, brighter when the slice is pointed at or applied.
            s('path', { d: crown(sl.a0, sl.a1, 5.5), class: 'ad-crownline' }, g);
            s('path', { d: crown(sl.a0, sl.a1, 0), class: 'ad-glint', pathLength: 120 }, g);
            const ink = s('g', { class: 'ad-ink' }, g);
            const wide = sl.step >= 70;
            const radii = [R.lbl, R.lbl + 6, R.lbl - 6, R.lbl - 12];
            if (sl.format) {
              const o = {
                size: sl.sub ? 21 : 25,
                subSize: 12.5,
                gap: 4,
                minSize: 10,
                cls: 'ad-lbl ad-fmt',
                subCls: 'ad-sub',
              };
              fitBlock(H, ink, { ...sl, label: caps(sl.label, m.lang) }, radii, o, R.hubRing, R.face, 112);
            } else {
              const o = {
                icon: true,
                iconSize: wide ? 27 : 22,
                size: wide ? 16 : 14,
                gap: 4,
                minSize: 9.5,
                cls: 'ad-lbl ad-word',
                sub: null,
              };
              fitBlock(H, ink, sl, radii, o, R.hubRing, R.face, 112);
            }
            // More choices: a gilded double chevron under the crown, pointing out.
            H.ringMark(g, sl, m, { r: R.face - 5, size: 10.5, shape: 'double', halo: 1.4, cls: 'ad-ring-mark' });
          }

          // Gold rules: the slice dividers, the face ring and the stepped outline.
          let rules = '';
          for (const sl of m.slices) rules += `M${pt(R.hubRing, sl.a0)}L${pt(R.crown[0], sl.a0)}`;
          const lines = s('g', { class: 'ad-lines', 'aria-hidden': 'true' }, root);
          s('path', { d: rules, class: 'ad-rule' }, lines);
          s('circle', { cx: C, cy: C, r: R.face, class: 'ad-rule ad-rule-thin' }, lines);
          s('path', { d: outline, class: 'ad-edge' }, lines);

          // Hub: stepped gold rings round a lacquer disc.
          const hub = s('g', { class: 'ad-hubg' }, root);
          s('circle', { cx: C, cy: C, r: R.hubRing, class: 'ad-hub-ring' }, hub);
          s('circle', { cx: C, cy: C, r: R.hubRing - 4, class: 'ad-hub' }, hub);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'ad-hub-ring2' }, hub);
          H.label(hub, C, C - 15, caps(m.title, m.lang), {
            // As wide as the disc allows: a long title (Russian "Convert") shrinks rather than shortens.
            maxWidth: 94,
            size: 13,
            minSize: 7,
            cls: 'ad-title',
            maxLines: 1,
          });
          H.label(hub, C, C + (m.key ? 4 : 9), m.file, {
            maxWidth: 78,
            size: 12,
            minSize: 9,
            cls: 'ad-file',
            maxLines: 1,
          });
          if (m.key) {
            const plate = s('path', { class: 'ad-key' }, hub);
            const text = H.text(hub, C, C + 24, caps(m.key, 'en'), { class: 'ad-keytext' });
            const kw = Math.min(90, Math.ceil(text.getComputedTextLength()) + 16);
            const x0 = C - kw / 2;
            const y0 = C + 16;
            const h = 15;
            const n = 3;
            plate.setAttribute(
              'd',
              `M${f2(x0 + n)} ${y0}H${f2(x0 + kw - n)}V${y0 + n}H${f2(x0 + kw)}V${y0 + h - n}H${f2(x0 + kw - n)}V${y0 + h}H${f2(x0 + n)}V${y0 + h - n}H${f2(x0)}V${y0 + n}H${f2(x0 + n)}Z`,
            );
          }
        },
      },

      sounds: {
        open(ac, out, t) {
          // The medallion settles from its turn: a quick gilded strum up the chord into a warm chime.
          play(ac, out, t, 0.6, 0.037, KEPT.open, (ch, sr) => {
            [3, 5, 7, 8, 10].forEach((k, j) =>
              gold(ch, sr, j * 0.026, note(k), { ring: 0.1 + j * 0.015, bright: 1.1, gain: 0.5, pan: -0.3 + j * 0.15 }),
            );
            sheen(ch, sr, 0.05, 0.3, 2400, 5200, 0.25);
          });
        },
        tick(ac, out, t) {
          // A gilded rule catching the light: a small warm ting on a note of the chord picked at random.
          const f = note(10 + Math.floor(random() * 5));
          const pan = (random() - 0.5) * 0.3;
          play(ac, out, t, 0.09, 0.033, null, (ch, sr) =>
            gold(ch, sr, 0, f, { ring: 0.012 + 0.006 * random(), bright: 1.3, pan, len: 0.09 }),
          );
        },
        enter(ac, out, t) {
          // The sunburst opens a ring: a quick fan of gold flicked open up the chord, with a gleam.
          play(ac, out, t, 0.25, 0.016, null, (ch, sr) => {
            [8, 10, 12, 14].forEach((k, j) =>
              gold(ch, sr, j * 0.022, note(k), {
                ring: 0.04 + j * 0.008,
                bright: 1.1,
                gain: 0.6 + j * 0.1,
                pan: -0.3 + j * 0.2,
              }),
            );
            sheen(ch, sr, 0.02, 0.16, 2600, 5600, 0.3);
          });
        },
        leave(ac, out, t) {
          // Back out of the ring: two tings folding down the chord, softer.
          play(ac, out, t, 0.2, 0.018, null, (ch, sr) =>
            [13, 10].forEach((k, j) =>
              gold(ch, sr, j * 0.05, note(k), { ring: 0.04, bright: 0.8, gain: 1 - j * 0.3, pan: 0.15 - j * 0.3 }),
            ),
          );
        },
        success(ac, out, t) {
          // The rays fan open in a glissando of gold, the gilding swells into a vibraphone chord and a
          // glint runs along the crown.
          play(ac, out, t, 1.2, 0.084, KEPT.success, (ch, sr) => {
            for (let k = 0; k < 9; k++)
              gold(ch, sr, k * 0.016, note(5 + k), {
                ring: 0.14,
                bright: 1.2,
                gain: 0.4,
                pan: -0.5 + k / 8,
                len: 0.65,
              });
            // The gilding: D-flat six-nine, voiced from the low D-flat up to the B-flat.
            [0, 3, 6, 7, 9].forEach((k, j) =>
              gold(ch, sr, 0.2 + j * 0.012, note(k), {
                ring: 0.4,
                bright: 0.4,
                a: 0.1,
                trem: 0.4,
                gain: 0.3,
                len: 0.9,
              }),
            );
            [15, 16, 17, 18].forEach((k, j) =>
              gold(ch, sr, 0.4 + j * 0.045, note(k), { ring: 0.06, bright: 0.7, gain: 0.22, pan: -0.3 + j * 0.2 }),
            );
            sheen(ch, sr, 0.4, 0.3, 3000, 6800, 0.35);
          });
        },
      },
    });
  })();
}
