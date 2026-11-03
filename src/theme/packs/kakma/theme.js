// SPDX-License-Identifier: MIT
// Ahşap kakma: the wheel as a marquetry panel. Slices are veneers of pale maple and ash (silver
// harewood at night) with their grain laid in turn along and across, divided by black-and-white
// stringing, inside a banded border set with mother-of-pearl dots round an inlaid star.
// Applying a slice turns it to mother-of-pearl, with a pearly shine passing over it.
export default function register(Board) {
  (function () {
    'use strict';

    const ID = 'kakma';
    const f2 = (n) => Math.round(n * 100) / 100;

    if (typeof document !== 'undefined' && document.fonts) {
      for (const f of [
        "700 16px 'Alegreya SC'",
        "800 16px 'Alegreya SC'",
        "500 16px 'Alegreya Sans'",
        "700 16px 'Alegreya Sans'",
      ]) {
        document.fonts.load(f, 'AaĞşı').catch(() => null);
      }
    }

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

    // Radii in the 400 x 400 view box.
    const R = { outer: 198, band1: 196, band0: 185, field: 182, hub: 66, lbl: 126, dotBand: 190.5, dotHub: 71 };
    const pt = (p) => `${f2(p[0])} ${f2(p[1])}`;

    // The width a label may take at radius r: the slice's chord there, less a margin, within a cap.
    function roomAt(sl, r, margin, cap) {
      const half = Math.min(sl.step / 2, 70);
      return Math.max(40, Math.min(cap, 2 * r * Math.sin((half * Math.PI) / 180) - margin));
    }

    // Grain for one veneer: lines along the slice (radial) or across it (rings), gently wavy.
    function grainPath(H, sl, along, rand) {
      let d = '';
      if (along) {
        const n = 13;
        for (let k = 0; k < n; k++) {
          const off = (k / (n - 1) - 0.5) * 1.1; // spread a little past the slice edges; the clip trims it
          const amp = 0.8 + rand() * 1.6,
            ph = rand() * 6.28,
            fr = 0.03 + rand() * 0.03;
          const pts = [];
          for (let r = R.hub - 4; r <= R.field + 4; r += 9) {
            const a = sl.mid + off * sl.step + ((amp * Math.sin(r * fr + ph)) / r) * 57.3;
            pts.push(H.polar(r, a));
          }
          d += 'M' + pts.map(pt).join('L');
        }
      } else {
        for (let r = R.hub + 3; r < R.field; r += 6 + rand() * 4) {
          const amp = 0.6 + rand() * 1.2,
            ph = rand() * 6.28;
          const pts = [];
          for (let a = sl.a0 - 3; a <= sl.a1 + 3; a += 4) pts.push(H.polar(r + amp * Math.sin(a * 0.25 + ph), a));
          d += 'M' + pts.map(pt).join('L');
        }
      }
      return d;
    }

    // Bookmatched grain in the slice's own frame (slice pointing up): straight-grained leaves laid
    // at an angle to the centre line, mirrored on the two halves so the grain forms a chevron.
    function chevronGrain(H, sl, side, rand) {
      const C = H.C;
      const th = (34 * Math.PI) / 180;
      const d = [Math.sin(th), -Math.cos(th)];
      const n = [Math.cos(th), Math.sin(th)];
      // Only the part over this half is kept (the clip does the exact edge), so the slice's
      // bounding box stays the slice.
      const a0 = side < 0 ? -sl.step / 2 - 2 : -2,
        a1 = side < 0 ? 2 : sl.step / 2 + 2;
      const inside = ([x, y]) => {
        const r = Math.hypot(x - C, y - C);
        const a = (Math.atan2(x - C, C - y) * 180) / Math.PI;
        return r >= R.hub - 4 && r <= R.field + 4 && a >= a0 && a <= a1;
      };
      let out = '';
      for (let c = -192; c <= 192; c += 4.5 + rand() * 4) {
        const ph = rand() * 6.28,
          amp = 0.4 + rand() * 0.8;
        const pts = [];
        for (let t = -192; t <= 192; t += 7) {
          const w = amp * Math.sin(t * 0.05 + ph);
          const x = C + n[0] * (c + w) + d[0] * t,
            y = C + n[1] * (c + w) + d[1] * t;
          pts.push([side < 0 ? 2 * C - x : x, y]);
        }
        out += trimmed(pts, inside);
      }
      return out;
    }

    // Polyline runs of the points that pass `inside`.
    function trimmed(pts, inside) {
      let out = '',
        run = [];
      const flush = () => {
        if (run.length > 1) out += 'M' + run.map(pt).join('L');
        run = [];
      };
      for (const p of pts) inside(p) ? run.push(p) : flush();
      flush();
      return out;
    }

    // Nacre: fine wavy layers round a point near the slice's outer corner.
    function nacre(H, sl, rand) {
      const C = H.C;
      const [cx, cy] = H.polar(R.field + 30, sl.a1 - sl.step * 0.2);
      const inside = ([x, y]) => {
        const r = Math.hypot(x - C, y - C);
        let a = (Math.atan2(x - C, C - y) * 180) / Math.PI - sl.mid;
        a = ((a + 540) % 360) - 180;
        return r >= R.hub - 4 && r <= R.field + 4 && Math.abs(a) <= sl.step / 2 + 2;
      };
      let out = '';
      for (let r = 26; r < 380; r += 7 + rand() * 6) {
        const pts = [];
        const ph = rand() * 6.28;
        for (let a = 0; a <= 360; a += 5) {
          const rr = r + 1.6 * Math.sin((a * Math.PI) / 45 + ph);
          pts.push([cx + rr * Math.sin((a * Math.PI) / 180), cy - rr * Math.cos((a * Math.PI) / 180)]);
        }
        out += trimmed(pts, inside);
      }
      return out;
    }

    // An eight-point star of two squares, centred on (cx, cy).
    function star8(cx, cy, r, rot = 0) {
      let d = '';
      for (const base of [0, 45]) {
        const pts = [0, 90, 180, 270].map((a) => {
          const t = ((a + base + 45 + rot) * Math.PI) / 180;
          return [cx + r * Math.sin(t), cy - r * Math.cos(t)];
        });
        d += 'M' + pts.map(pt).join('L') + 'Z';
      }
      return d;
    }

    Board.define({
      id: ID,
      fonts: {
        brand: "'Alegreya Sans'",
        display: "'Alegreya SC'",
        load: ["'Alegreya SC'", "'Alegreya Sans'"],
        credits: [
          { family: 'Alegreya SC', license: 'SIL Open Font License 1.1' },
          { family: 'Alegreya Sans', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 170, close: 120, stagger: 12, apply: 660 },

      palette: {
        light: {
          bg: '#f1f0ec',
          surface: '#ffffff',
          'surface-2': '#f6f5f1',
          border: '#dcd8ce',
          'border-strong': '#a9a396',
          text: '#221f1b',
          'text-muted': '#5a554d',
          accent: '#2b6767',
          'on-accent': '#ffffff',
          focus: '#2b6767',
          success: '#1f7a4c',
          'on-success': '#ffffff',
          'success-text': '#1a6840',
          warning: '#a86c10',
          'warning-text': '#744906',
          danger: '#b53a36',
          desk: 'linear-gradient(165deg, #e8ece9 0%, #d6dcd8 100%)',
          'wheel-face': '#f2e1bd',
          'wheel-slice': '#ecd9b2',
          'wheel-slice-hover': '#f4e9d2',
          'wheel-slice-selected': '#e6e9f5',
          'wood-a': '#f2e1bd',
          'wood-a2': '#ecd9b2',
          'wood-b': '#ece7dc',
          'grain-a': 'rgba(150, 110, 52, 0.2)',
          'grain-b': 'rgba(110, 100, 80, 0.2)',
          holly: '#f8f4ec',
          ebony: '#221e1a',
          'band-a': '#f1e2c3',
          'band-b': '#a7acad',
          'pearl-1': '#fbf9ff',
          'pearl-2': '#cfeee8',
          'pearl-3': '#f4d9ea',
          'pearl-4': '#d9e1fa',
          'pearl-edge': '#7f8c96',
          nacre: 'rgba(255, 255, 255, 0.7)',
          'hub-wood': '#f8f4ec',
          'hub-star': '#ecdcbc',
          'wheel-text': '#221d18',
          'wheel-sub': '#48433c',
          'wheel-text-selected': '#1e1a26',
          'wheel-sub-selected': '#3b3646',
          'wheel-line': '#221e1a',
          'wheel-shadow': 'rgba(50, 55, 50, 0.3)',
          'hover-glow': 'rgba(255, 255, 255, 0.42)',
          sheen: 'rgba(255, 255, 255, 0.95)',
        },
        dark: {
          bg: '#16181b',
          surface: '#1e2125',
          'surface-2': '#262a2f',
          border: '#353a41',
          'border-strong': '#59606a',
          text: '#f2efe8',
          'text-muted': '#adb2b9',
          accent: '#9fd6cf',
          'on-accent': '#10201e',
          focus: '#9fd6cf',
          success: '#6fd09c',
          'on-success': '#0b2216',
          'success-text': '#80d9aa',
          warning: '#efb851',
          'warning-text': '#f2c46e',
          danger: '#ff8a80',
          desk: 'radial-gradient(120% 95% at 50% 10%, #2b3036 0%, #1b1e22 65%, #121417 100%)',
          'wheel-face': '#59626b',
          'wheel-slice': '#59626b',
          'wheel-slice-hover': '#677079',
          'wheel-slice-selected': '#e2e6f3',
          'wood-a': '#59626b',
          'wood-a2': '#535c65',
          'wood-b': '#474f57',
          'grain-a': 'rgba(215, 225, 235, 0.15)',
          'grain-b': 'rgba(215, 225, 235, 0.13)',
          holly: '#e6e2d8',
          ebony: '#0f1012',
          'band-a': '#7b848d',
          'band-b': '#2a2e33',
          'pearl-1': '#f6f2fc',
          'pearl-2': '#c9ebe5',
          'pearl-3': '#efd6e7',
          'pearl-4': '#d3dcf7',
          'pearl-edge': '#eef3f8',
          nacre: 'rgba(255, 255, 255, 0.65)',
          'hub-wood': '#3d444b',
          'hub-star': '#4b545c',
          'wheel-text': '#f8f5ee',
          'wheel-sub': '#e6e9ed',
          'wheel-text-selected': '#1e1a26',
          'wheel-sub-selected': '#383445',
          'wheel-line': '#0f1012',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          'hover-glow': 'rgba(255, 255, 255, 0.11)',
          sheen: 'rgba(255, 255, 255, 0.9)',
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
        ['wheel-text', 'wood-a', 'text'],
        ['wheel-text', 'wood-a2', 'text'],
        ['wheel-text', 'wood-b', 'text'],
        ['wheel-sub', 'wood-a', 'text'],
        ['wheel-sub', 'wood-a2', 'text'],
        ['wheel-sub', 'wood-b', 'text'],
        ['wheel-text-selected', 'pearl-2', 'text'],
        ['wheel-text-selected', 'pearl-3', 'text'],
        ['wheel-sub-selected', 'pearl-2', 'text'],
        ['wheel-sub-selected', 'pearl-3', 'text'],
        ['wheel-text', 'hub-wood', 'text'],
        ['wheel-text', 'hub-star', 'text'],
        ['wheel-sub', 'hub-star', 'text'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const s = H.s;
          const uid = H.uid(ID);
          const rand = rng(2711 + m.kind.length * 13);
          const defs = s('defs', {}, root);
          // Mother-of-pearl: soft bands of rose, mint and lavender over a milky white.
          const pearl = s('linearGradient', { id: uid + '-pearl', x1: 0, y1: 0, x2: 1, y2: 0.8 }, defs);
          [
            [0, 'kk-p1'],
            [0.28, 'kk-p2'],
            [0.5, 'kk-p1'],
            [0.72, 'kk-p3'],
            [1, 'kk-p4'],
          ].forEach(([o, c]) => s('stop', { offset: o, class: c }, pearl));
          const dot = s('radialGradient', { id: uid + '-dot', cx: 0.38, cy: 0.35, r: 0.7 }, defs);
          [
            [0, 'kk-p1'],
            [0.45, 'kk-p2'],
            [0.75, 'kk-p3'],
            [1, 'kk-p4'],
          ].forEach(([o, c]) => s('stop', { offset: o, class: c }, dot));
          // The shine that crosses a slice on apply: clear, a bright core with a rainbow edge, clear.
          const sh = s('linearGradient', { id: uid + '-sheen', x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
          [
            [0, 'kk-sh0'],
            [0.35, 'kk-p3'],
            [0.5, 'kk-sh'],
            [0.65, 'kk-p2'],
            [1, 'kk-sh0'],
          ].forEach(([o, c]) => s('stop', { offset: o, class: c }, sh));
          const shadow = s('radialGradient', { id: uid + '-shadow', cx: 0.5, cy: 0.5, r: 0.5 }, defs);
          s('stop', { offset: 0.9, class: 'kk-st-sh' }, shadow);
          s('stop', { offset: 1, class: 'kk-st-sh0' }, shadow);

          // Panel: shadow, ebony edge, the chevron banding between stringing.
          const frame = s('g', { class: 'kk-frame', 'aria-hidden': 'true' }, root);
          s('circle', { cx: C, cy: C + 6, r: R.outer + 6, fill: `url(#${uid}-shadow)` }, frame);
          s('circle', { cx: C, cy: C, r: R.outer, class: 'kk-ebony' }, frame);
          s('circle', { cx: C, cy: C, r: R.band1, class: 'kk-band-a' }, frame);
          let chev = '';
          const N = 64;
          for (let k = 0; k < N; k++) {
            const a = (k * 360) / N;
            const w = 360 / N / 2;
            chev += `M${pt(H.polar(R.band0, a))}L${pt(H.polar(R.band1, a + w))}L${pt(H.polar(R.band1, a + 2 * w))}L${pt(H.polar(R.band0, a + w))}Z`;
          }
          s('path', { d: chev, class: 'kk-band-b' }, frame);
          s('circle', { cx: C, cy: C, r: R.band1, class: 'kk-string' }, frame);
          s('circle', { cx: C, cy: C, r: R.band0, class: 'kk-string' }, frame);
          s('circle', { cx: C, cy: C, r: R.field + 1.5, class: 'kk-holly-ring' }, frame);

          // Veneers.
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const wedge = H.sector(R.hub, R.field, sl.a0, sl.a1);
            // Bookmatched and ring-cut veneers take turns; with an odd count the last slice is
            // bookmatched in the second wood, so it differs from both neighbours.
            const odd = m.n % 2 === 1 && sl.i === m.n - 1;
            const along = sl.i % 2 === 0;
            const clipId = `${uid}-c${sl.i}`;
            s('path', { d: wedge }, s('clipPath', { id: clipId }, g));
            if (along) {
              // Two leaves of maple, bookmatched: each half catches the light a little differently.
              const local = s('g', { transform: `rotate(${f2(sl.mid)} ${C} ${C})` }, g);
              for (const side of [-1, 1]) {
                const half = H.sector(R.hub, R.field, side < 0 ? -sl.step / 2 : 0, side < 0 ? 0 : sl.step / 2);
                const cid = `${uid}-h${sl.i}${side < 0 ? 'l' : 'r'}`;
                s('path', { d: half }, s('clipPath', { id: cid }, local));
                s(
                  'path',
                  { d: half, class: odd ? 'kk-wood kk-wood-b' : side < 0 ? 'kk-wood kk-wood-a' : 'kk-wood kk-wood-a2' },
                  local,
                );
                s(
                  'path',
                  { d: chevronGrain(H, sl, side, rand), class: 'kk-grain kk-grain-a', 'clip-path': `url(#${cid})` },
                  local,
                );
              }
            } else {
              s('path', { d: wedge, class: 'kk-wood kk-wood-b' }, g);
              s(
                'path',
                { d: grainPath(H, sl, false, rand), class: 'kk-grain kk-grain-b', 'clip-path': `url(#${clipId})` },
                g,
              );
            }
            s('path', { d: wedge, class: 'kk-glow' }, g);
            const pearlG = s('g', { class: 'kk-pearl', 'clip-path': `url(#${clipId})` }, g);
            s('path', { d: wedge, fill: `url(#${uid}-pearl)` }, pearlG);
            // Nacre is drawn when the slice is first applied (update), not for every slice up front.
            s('path', { class: 'kk-nacre' }, pearlG);
            // The shine: a slanted band laid across the slice, moved from one edge to the other.
            const shine = s('g', { class: 'kk-shine-clip', 'clip-path': `url(#${clipId})` }, g);
            const rot = s('g', { transform: `rotate(${f2(sl.mid)} ${C} ${C})` }, shine);
            const halfW = R.field * Math.sin(H.rad(Math.min(sl.step / 2, 90)));
            s(
              'path',
              {
                d: `M${f2(C - halfW - 58)} ${C - R.field - 4}h44l30 ${R.field - R.hub + 8}h-44z`,
                class: 'kk-shine',
                fill: `url(#${uid}-sheen)`,
                style: `--travel: ${f2(2 * halfW + 90)}px`,
              },
              rot,
            );
            s('path', { d: H.sector(R.hub + 1.6, R.field - 1.6, sl.a0, sl.a1, 3.2), class: 'kk-edge' }, g);
            // Pearl dots: on the banding at both corners, and on the hub ring.
            const dots = s('g', { class: 'kk-dots' }, g);
            for (const [r, a] of [
              [R.dotBand, sl.a0],
              [R.dotBand, sl.a1],
              [R.dotHub, sl.mid],
            ]) {
              const [x, y] = H.polar(r, a);
              s(
                'circle',
                { cx: f2(x), cy: f2(y), r: r === R.dotHub ? 2.6 : 3.4, class: 'kk-dot', fill: `url(#${uid}-dot)` },
                dots,
              );
            }
            const ink = s('g', { class: 'kk-ink' }, g);
            const room = roomAt(sl, R.lbl, 20, 128);
            if (sl.format) {
              H.block(ink, sl, R.lbl, {
                size: 23,
                subSize: 13,
                gap: 1,
                maxWidth: room,
                minSize: 10,
                cls: 'kk-lbl kk-fmt',
                subCls: 'kk-sub',
              });
            } else {
              H.block(ink, sl, R.lbl, {
                icon: true,
                iconSize: 23,
                size: 14.5,
                gap: 4,
                maxWidth: room + 2,
                minSize: 9,
                cls: 'kk-lbl kk-word',
                sub: null,
              });
            }
            // More choices: a mother-of-pearl arrowhead inlaid near the stringing, pointing out.
            H.ringMark(ink, sl, m, { r: R.field - 5.5, size: 10.5, halo: 1.1, cls: 'kk-ring-mark' });
          }

          // Stringing between the veneers: ebony with a line of holly each side.
          const lines = s('g', { class: 'kk-lines', 'aria-hidden': 'true' }, root);
          let d = '';
          for (const sl of m.slices) d += `M${pt(H.polar(R.hub, sl.a0))}L${pt(H.polar(R.field, sl.a0))}`;
          s('path', { d, class: 'kk-holly' }, lines);
          s('path', { d, class: 'kk-string' }, lines);
          s('circle', { cx: C, cy: C, r: R.field, class: 'kk-string' }, lines);

          // Hub: a holly roundel with an inlaid star, ringed in ebony.
          const hub = s('g', { class: 'kk-hub' }, root);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'kk-hub-wood' }, hub);
          s('path', { d: star8(C, C, R.hub - 7, m.slices[0].a0 + 22.5), class: 'kk-star' }, hub);
          s('circle', { cx: C, cy: C, r: R.hub - 0.8, class: 'kk-string kk-hub-ring' }, hub);
          s('circle', { cx: C, cy: C, r: R.hub - 3.5, class: 'kk-holly-thin' }, hub);
          const dy = m.key ? 0 : 8;
          H.label(hub, C, C - 15 + dy, m.title, { maxWidth: 104, size: 17, minSize: 11, cls: 'kk-title', maxLines: 1 });
          H.label(hub, C, C + 5 + dy, m.file, { maxWidth: 96, size: 13, minSize: 9, cls: 'kk-file', maxLines: 1 });
          if (m.key) {
            const kt = H.text(hub, C, C + 26, m.key, { class: 'kk-keytext' });
            const kw = kt.getComputedTextLength() + 16;
            hub.insertBefore(
              s('rect', { x: f2(C - kw / 2), y: C + 18, width: f2(kw), height: 16, rx: 3, class: 'kk-key' }),
              kt,
            );
          }
        },

        update(root, m, st, H) {
          if (st.selected == null) return;
          const path = root.querySelector(`.slice[data-slice="${st.selected}"] .kk-nacre`);
          if (path && !path.getAttribute('d'))
            path.setAttribute('d', nacre(H, m.slices[st.selected], rng(5099 + st.selected * 37)));
        },
      },

      sounds: {
        // A wooden lid settling.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'lowpass', f: 520, q: 0.8, dur: 0.07, gain: 0.2, a: 0.004 });
          X.tone(ac, out, t + 0.004, { type: 'triangle', f: 300, f2: 250, dur: 0.06, gain: 0.07, a: 0.002 });
        },
        // A small woodblock tap.
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'sine', f: 1180, dur: 0.035, gain: 0.06, a: 0.001 });
          X.tone(ac, out, t, { type: 'triangle', f: 2360, dur: 0.012, gain: 0.02, a: 0.001 });
          X.burst(ac, out, t, { type: 'bandpass', f: 2500, q: 2, dur: 0.006, gain: 0.05 });
        },
        // A wooden tok, then a quiet rising shimmer as the pearl catches the light.
        success(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'triangle', f: 520, f2: 470, dur: 0.07, gain: 0.08, a: 0.002 });
          X.burst(ac, out, t, { type: 'bandpass', f: 1800, q: 1.6, dur: 0.012, gain: 0.07 });
          [2093, 2637, 3136, 3951, 4699].forEach((f, k) => {
            X.tone(ac, out, t + 0.09 + k * 0.045, { type: 'sine', f, dur: 0.3, gain: 0.022, a: 0.01 });
            X.tone(ac, out, t + 0.09 + k * 0.045, { type: 'sine', f: f * 1.006, dur: 0.26, gain: 0.012, a: 0.01 });
          });
        },
      },
    });
  })();
}
