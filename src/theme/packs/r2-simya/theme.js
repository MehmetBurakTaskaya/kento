// SPDX-License-Identifier: MIT
// Simya: the alchemical circle in three materials. Every variant keeps the same apply effect
// (a light runs from the chosen slice into the hub, then a seal pops and settles there) and gives it its
// own material, glyph system and motion:
//   simya-a  Lapis & gold leaf: a gold comet on an S-curve, a gilded seal struck with flying leaf flakes.
//   simya-b  Verdigris & copper: a copper drop falls into the hub, ripples spread, a copper-bezel seal rises.
//   simya-c  Obsidian & moonsilver: a silver ray shoots in, refracts into a burst, a faceted gem turns into place.
// The apply effect is one deterministic paint(t) per variant: live it runs on requestAnimationFrame, and the
// still frame (t set) calls it once for its time. Every glyph is our own, built from rings, beads and polygons; none
// is a letter, a historical sign or an alchemical symbol (no plain triangles, no circle with a center dot,
// no crescent, no line or cross through a circle).
export default function register(Board) {
  (function () {
    'use strict';

    const C = 200;
    const f1 = (n) => Math.round(n * 10) / 10;
    const f2 = (n) => Math.round(n * 100) / 100;
    const f3 = (n) => Math.round(n * 1000) / 1000;
    const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const seg = (t, a, b) => clamp01((t - a) / (b - a));
    const lerp = (a, b, u) => a + (b - a) * u;
    const ease = {
      outCubic: (u) => 1 - (1 - u) ** 3,
      inOutCubic: (u) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2),
      inOutSine: (u) => (1 - Math.cos(Math.PI * u)) / 2,
    };
    // The pop: from `from` to an overshoot, a small undershoot, then rest at 1.
    function pop(u, over = 1.16, under = 0.965, from = 0) {
      if (u <= 0) return from;
      if (u < 0.45) return lerp(from, over, ease.outCubic(u / 0.45));
      if (u < 0.72) return lerp(over, under, ease.inOutCubic((u - 0.45) / 0.27));
      if (u < 1) return lerp(under, 1, ease.inOutCubic((u - 0.72) / 0.28));
      return 1;
    }
    // 0 before a, rises to 1 at peak, back to 0 at b.
    const bell = (t, a, peak, b) =>
      t <= a || t >= b ? 0 : t < peak ? (t - a) / (peak - a) : 1 - (t - peak) / (b - peak);
    const reducedMotion = () => document.documentElement.classList.contains('reduce-motion');
    const op = (el, v) => (el.style.opacity = String(f3(clamp01(v))));
    const polarAt = (cx, cy, r, a) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];

    // Seeded generator, so textures land in the same places on every render.
    function rng(seed) {
      let s = seed % 2147483647 || 1;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    }
    // A full circle as a path from twelve o'clock, so it can be drawn in with pathLength 1.
    function circlePath(r, ccw) {
      const sw = ccw ? 0 : 1;
      return `M${C} ${C - r}a${r} ${r} 0 1 ${sw} 0 ${2 * r}a${r} ${r} 0 1 ${sw} 0 ${-2 * r}`;
    }
    const dotPath = (x, y, r) => `M${f2(x - r)} ${f2(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    const polyD = (pts, close) => 'M' + pts.map((p) => `${f2(p[0])} ${f2(p[1])}`).join('L') + (close ? 'Z' : '');
    // Textures only need a tenth of a unit.
    const polyD1 = (pts, close) => 'M' + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L') + (close ? 'Z' : '');
    function rhombus(H, r, a, len, wid) {
      const da = ((wid / r) * 180) / Math.PI;
      return polyD([H.polar(r + len, a), H.polar(r, a + da), H.polar(r - len, a), H.polar(r, a - da)], true);
    }
    // A polyline with its cumulative length, so a light can be placed at any fraction of it; the fractions
    // match stroke dashes on the same path drawn with pathLength 1.
    function track(pts) {
      const cum = [0];
      for (let k = 1; k < pts.length; k++)
        cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      const total = cum[cum.length - 1] || 1;
      return {
        d: polyD(pts),
        total,
        at(e) {
          const L = clamp01(e) * total;
          let k = 1;
          while (k < cum.length - 1 && cum[k] < L) k++;
          const u = (L - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
          const a = pts[k - 1];
          const b = pts[k];
          return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI];
        },
      };
    }
    // Shows the part [e0, e1] of a path drawn with pathLength 1.
    function dash(el, e0, e1) {
      const a = clamp01(e0);
      const b = Math.max(a, clamp01(e1));
      el.style.strokeDasharray = `${(b - a).toFixed(4)} 3`;
      el.style.strokeDashoffset = (-a).toFixed(4);
    }
    // A polyline as a filled ribbon whose width at point k is width(k); a texture, so to a tenth of a unit.
    function ribbon(pts, width) {
      const n = pts.length - 1;
      const left = [];
      const right = [];
      pts.forEach((p, k) => {
        const a = pts[Math.max(0, k - 1)];
        const b = pts[Math.min(n, k + 1)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const w = width(k) * Math.min(1, k / 3, (n - k) / 3 + 0.15) * 0.5;
        const ox = (-(b[1] - a[1]) / len) * w;
        const oy = ((b[0] - a[0]) / len) * w;
        left.push([p[0] + ox, p[1] + oy]);
        right.push([p[0] - ox, p[1] - oy]);
      });
      return polyD1(left.concat(right.reverse()), true);
    }
    // Label centers, so textures can keep away from them.
    const labelCenters = (H, m, r) => m.slices.map((sl) => H.polar(r, sl.mid));
    const nearLabel = (centers, x, y, d) => centers.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < d);
    const nearDivider = (m, r, a, px) =>
      m.slices.some((sl) => Math.abs(((((a - sl.a0) % 360) + 540) % 360) - 180) * (Math.PI / 180) * r < px);

    // ------------------------------------------------------------------ glyph systems (local units, 0, 0 on the band, -y outward)
    // A: gold-leaf studs. A ring with one inner figure, and a short rule on each side along the band.
    const STUDS = [
      '<path class="d" d="M0 -2.4L1.8 0L0 2.4L-1.8 0Z"/>', // small solid rhombus
      '<path class="d" d="M0 -3.1a.8 .8 0 1 0 .01 0M3.1 0a.8 .8 0 1 0 .01 0M0 3.1a.8 .8 0 1 0 .01 0M-3.1 0a.8 .8 0 1 0 .01 0"/>', // four beads
      '<circle cx="0" cy="0" r="2.6" stroke-dasharray="1.1 1.25"/>', // dotted inner ring
      '<path d="M0 -4.2V-2.2M0 2.2V4.2"/>', // two short radial ticks, not meeting
      '<rect x="-2" y="-2" width="4" height="4"/>', // small square
      '<circle cx="0" cy="0" r="2.9"/>', // double ring
      '<path class="d" d="M-2.6 0a.75 .75 0 1 0 .01 0M2.6 0a.75 .75 0 1 0 .01 0"/>', // two beads
      '<path d="M0 -2.9L2.9 0L0 2.9L-2.9 0Z"/>', // rhombus outline
    ];
    const studMarkup = (i) => `<circle cx="0" cy="0" r="5"/>${STUDS[i % STUDS.length]}<path d="M-7.6 0H-12M7.6 0H12"/>`;

    // B: condensation beads, engraved into the copper collar.
    const BEADS = [
      [[0, 0, 2.9]],
      [
        [-3.4, 0, 2.1],
        [3.4, 0, 2.1],
      ],
      [
        [-5.6, 0, 1.4],
        [0, 0, 2.5],
        [5.6, 0, 1.4],
      ],
      [[0, -0.2, 3.1, 'ring']],
      [
        [-4.2, 0.6, 1.5],
        [0, -0.6, 2.4],
        [4.2, 0.6, 1.5],
      ],
      [
        [-2.6, -1.4, 1.7],
        [2.6, 1.4, 1.7],
      ],
      [
        [-4.6, 0, 1.8, 'ring'],
        [0.8, 0, 2.4],
      ],
      [
        [-6.3, 0.8, 1.1],
        [-2.2, -0.4, 1.6],
        [2.2, -0.4, 1.6],
        [6.3, 0.8, 1.1],
      ],
    ];
    const beadMarkup = (i) =>
      BEADS[i % BEADS.length]
        .map(([x, y, r, ring]) =>
          ring ? `<circle class="o" cx="${x}" cy="${y}" r="${r}"/>` : `<circle cx="${x}" cy="${y}" r="${r}"/>`,
        )
        .join('');

    // C: crystal habits, drawn as facet outlines.
    const HABITS = [
      '<path d="M0 -6L3.6 0L0 6L-3.6 0Z"/><path d="M0 -2.6L1.5 0L0 2.6L-1.5 0Z"/>', // rhombus with its table
      '<path d="M-4.6 -2.6L0 -5.3L4.6 -2.6V2.6L0 5.3L-4.6 2.6Z"/>', // hexagon
      '<path d="M0 -7L3 -4V4L0 7L-3 4V-4Z"/><path d="M-3 -4H3M-3 4H3"/>', // prism
      '<path d="M-4.6 -2.6L0 -5.3L4.6 -2.6V2.6L0 5.3L-4.6 2.6Z"/><path d="M0 0V5.3M0 0L-4.6 -2.6M0 0L4.6 -2.6"/>', // cube
      '<path d="M-3.4 -3.4H3.4V3.4H-3.4Z"/><path d="M0 -2L2 0L0 2L-2 0Z"/>', // square with a turned table
      '<path d="M-2.4 -5.4L0.4 -1L-2.4 3.4L-5.2 -1Z"/><path d="M2.6 -3.2L5.2 0.8L2.6 4.8L0 0.8Z"/>', // twinned rhombi
      '<path d="M0 -5.6L5 0L0 5.6L-5 0Z"/><path d="M-5 0L0 -1.8L5 0M0 -1.8V5.6"/>', // cut gem in profile
      '<path d="M0 -7L2.6 0L0 7L-2.6 0Z"/><path d="M0 -7V7"/>', // bipyramid
    ];

    // ------------------------------------------------------------------ shared wheel
    // A Convert format names its file's new extension when its label is that extension in capitals ("JPG",
    // "TAR.GZ"); the choices of a ring ("Normal", "150 dpi") do not, and preview no file name.
    const plain = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    function extension(sl) {
      if (!sl || !sl.format || sl.off) return null;
      const label = sl.label.trim();
      if (!label || label !== label.toLocaleUpperCase('en') || plain(label) !== plain(sl.id)) return null;
      return label.toLowerCase();
    }
    // The dragged file under its new extension; the app hands the name isolated (U+2068 … U+2069).
    function renamed(file, ext) {
      const iso = /^\u2068([\s\S]*)\u2069$/.exec(file);
      const name = (iso ? iso[1] : file).replace(/\.[^.]+$/, '') + '.' + ext;
      return iso ? '\u2068' + name + '\u2069' : name;
    }

    // The boxes a slice's content covers: its icon and each line of its labels, as [x, y, w, h].
    function boxes(fit) {
      const out = [];
      for (const ico of fit.querySelectorAll('.ico')) {
        const t = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(ico.getAttribute('transform') || '');
        if (t) out.push([+t[1], +t[2], 24 * t[3], 24 * t[3]]);
      }
      for (const text of fit.querySelectorAll('text')) {
        const size = +text.getAttribute('font-size') || 12;
        const x = +text.getAttribute('x');
        let y = +text.getAttribute('y');
        const spans = text.querySelectorAll('tspan');
        for (const line of spans.length ? spans : [text]) {
          if (line !== text) y += +line.getAttribute('dy') || 0;
          const w = line.getComputedTextLength();
          out.push([x - w / 2, y - size * 0.52, w, size * 1.04]);
        }
      }
      return out;
    }

    // Keeps each slice's content inside its segment: clear of the hub ring and its node, the outer ring
    // and the dividers. A block that does not fit (a long German word, two lines in a narrow slice) moves
    // out or in along its slice's centre line, and only when that is not enough is it drawn smaller. All
    // boxes are read first and all moves written after, so the text is laid out once.
    function settle(items, m, H, rIn, rOut) {
      const pad = 3;
      const measured = items.map((it) => ({ ...it, rects: boxes(it.fit) }));
      for (const { fit, sl, r, rects } of measured) {
        if (!rects.length) continue;
        const [px, py] = H.polar(r, sl.mid);
        const ux = Math.sin((sl.mid * Math.PI) / 180);
        const uy = -Math.cos((sl.mid * Math.PI) / 180);
        const a0 = (sl.a0 * Math.PI) / 180;
        const a1 = (sl.a1 * Math.PI) / 180;
        const sides =
          m.n > 1
            ? [
                [Math.cos(a0), Math.sin(a0)],
                [-Math.cos(a1), -Math.sin(a1)],
              ]
            : [];
        const over = (s, d) => {
          let worst = -Infinity;
          for (const [x, y, w, h] of rects) {
            const x0 = px + (x - px) * s + ux * d - C;
            const y0 = py + (y - py) * s + uy * d - C;
            const x1 = x0 + w * s;
            const y1 = y0 + h * s;
            const nx = Math.max(x0, Math.min(0, x1));
            const ny = Math.max(y0, Math.min(0, y1));
            worst = Math.max(worst, rIn + pad - Math.hypot(nx, ny));
            for (const [cx, cy] of [
              [x0, y0],
              [x1, y0],
              [x0, y1],
              [x1, y1],
            ]) {
              worst = Math.max(worst, Math.hypot(cx, cy) - (rOut - pad));
              for (const [sx, sy] of sides) worst = Math.max(worst, pad - (cx * sx + cy * sy));
            }
          }
          return worst;
        };
        if (over(1, 0) <= 0) continue;
        let best = { s: 1, d: 0, v: over(1, 0) };
        search: for (const s of [1, 0.95, 0.9, 0.86, 0.82]) {
          for (let k = 1; k <= 48; k++) {
            const d = (k % 2 ? 1 : -1) * Math.ceil(k / 2);
            const v = over(s, d);
            if (v <= 0) {
              best = { s, d, v };
              break search;
            }
            if (v < best.v - 0.5) best = { s, d, v };
          }
        }
        const ex = (1 - best.s) * px + ux * best.d;
        const ey = (1 - best.s) * py + uy * best.d;
        fit.setAttribute('transform', `matrix(${f2(best.s)} 0 0 ${f2(best.s)} ${f2(ex)} ${f2(ey)})`);
      }
    }

    // V describes one variant: geometry, the hooks that draw its parts, and its apply effect.
    function makeWheel(V) {
      const G = V.geo;
      function sealContent(holder, m, sl, H) {
        holder.textContent = '';
        if (!sl) return;
        if (sl.format) {
          H.label(holder, 0, 0.5, sl.label, {
            maxWidth: G.sealText,
            size: V.sealFont,
            minSize: 9,
            cls: 's2-seal-fmt',
            maxLines: 1,
          });
        } else {
          H.icon(holder, sl.icon, 0, 0, V.sealIcon, 's2-seal-ico');
        }
      }
      function captionText(m, sl) {
        const ext = extension(sl);
        return ext && m.file ? renamed(m.file, ext) : sl.label;
      }

      return {
        render(root, m, H) {
          const s = H.s;
          const ccw = m.dir === 'rtl';
          const ctx = { m, H, G, ccw, uid: H.uid(V.id), wrap: root.ownerSVGElement && root.ownerSVGElement.parentNode };
          const defs = s('defs', {}, root);
          ctx.ids = V.defs ? V.defs(defs, ctx) : {};
          if (V.prepare) V.prepare(ctx);

          V.texture(s('g', { class: 's2-tex' }, root), ctx);
          V.ink(s('g', { class: 's2-ink' }, root), ctx);

          // Hub: wheel name, the dragged file and the key; Convert previews the result in a pill; the seal
          // and its caption replace them once a slice is applied.
          const hub = s('g', { class: 's2-hubc' }, root);
          V.hub(hub, ctx);
          s('g', { class: 's2-fx-below' }, hub);
          const txt = s('g', { class: 's2-hub-text' }, hub);
          // With nothing under them (no key, no result to preview) the title and the file sit lower, in the middle.
          const results = m.slices.some(extension);
          const dy = m.key || results ? 0 : 10;
          H.label(txt, C, C - 19 + dy, m.title, {
            maxWidth: 118,
            size: V.titleFont,
            minSize: 13,
            cls: 's2-title',
            maxLines: 1,
          });
          if (m.file)
            H.label(txt, C, C + 3 + dy, m.file, { maxWidth: 110, size: 12, minSize: 9, cls: 's2-file', maxLines: 1 });
          // The key that opened the wheel, on a cap; none when the wheel came from a shortcut or a menu.
          if (m.key) {
            const kw = 16 + m.key.length * 6.8;
            const key = s('g', { class: 's2-key' }, txt);
            s('rect', { x: f1(C - kw / 2), y: C + 18, width: f1(kw), height: 18, rx: 4, class: 's2-keycap' }, key);
            H.text(key, C, C + 27.5, m.key, { class: 's2-keytext' });
          }
          if (results) {
            const res = s('g', { class: 's2-result' }, txt);
            s('rect', { x: C - 40, y: C + 16, width: 80, height: 23, rx: 11.5, class: 's2-pill' }, res);
            H.text(res, C, C + 28, '', { class: 's2-result-text' });
          }
          const seal = s('g', { class: 's2-seal', transform: `translate(${C} ${C + G.sealY})` }, hub);
          V.sealBody(s('g', { class: 's2-seal-body' }, seal), ctx);
          s('g', { class: 's2-seal-content' }, seal);
          const clipId = ctx.uid + '-sc';
          const cp = s('clipPath', { id: clipId }, seal);
          s('circle', { cx: 0, cy: 0, r: G.sealR }, cp);
          const gl = s('g', { 'clip-path': `url(#${clipId})` }, seal);
          s(
            'rect',
            {
              x: -9,
              y: -G.sealR * 1.6,
              width: 18,
              height: G.sealR * 3.2,
              class: 's2-seal-glint',
              fill: `url(#${V.id}-glint)`,
            },
            gl,
          );
          H.text(hub, C, C + G.capY, '', { class: 's2-cap' });
          s('g', { class: 's2-fx-above' }, hub);

          // Slices.
          const items = [];
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const segD = H.sector(G.rin + 2, G.rout - 2, sl.a0, sl.a1, G.gap);
            s('path', { d: H.sector(G.rin - 4, G.rim + 7, sl.a0, sl.a1), class: 's2-hit' }, g);
            s('path', { d: segD, class: 's2-seg' }, g);
            s('path', { d: segD, class: 's2-sel', fill: `url(#${ctx.ids.sel || V.id + '-sel'})` }, g);
            if (V.selDeco) V.selDeco(g, segD, ctx);
            s('path', { d: segD, class: 's2-sheen', fill: `url(#${V.id}-sheen)` }, g);
            s('path', { d: V.bandSeg(sl, ctx), class: 's2-bandfill' }, g);
            if (sl.off) {
              const id = H.uid(V.id + '-off');
              const clip = s('clipPath', { id }, g);
              s('path', { d: segD }, clip);
              s('path', { d: V.hatch(), class: 's2-hatch', 'clip-path': `url(#${id})` }, g);
            }
            const edge = V.edge(sl, ctx);
            s('path', { d: edge, class: 's2-edge-glow' }, g);
            s('path', { d: edge, class: 's2-edge' }, g);
            const gt = s('g', { class: 's2-glyph s2-turn' }, g);
            const gi = s('g', { transform: `rotate(${f1(sl.mid)} ${C} ${C}) translate(${C} ${C - G.glyphR})` }, gt);
            const gm = V.glyph(sl.i);
            s('g', { class: 's2-glyph-glow', html: gm }, gi);
            s('g', { class: 's2-glyph-ink', html: gm }, gi);
            V.node(g, sl, ctx);
            // A Convert format is its name in the display face, large, with its sub-label where it has
            // one; everything else an icon over its label. Wider slices give a label more room.
            const c = s('g', { class: 's2-content' }, g);
            const fit = s('g', {}, c);
            const chord = sl.step >= 180 ? Infinity : 2 * G.lbl * Math.sin((sl.step * Math.PI) / 360) * 0.8;
            const maxWidth = Math.max(80, Math.min(116, chord));
            if (sl.format) {
              H.block(fit, sl, G.lbl, {
                size: V.fmtFont,
                subSize: 12,
                gap: 0,
                maxWidth,
                minSize: 13,
                cls: 's2-lbl s2-fmt',
                subCls: 's2-sub',
              });
            } else {
              H.block(fit, sl, G.lbl, {
                icon: true,
                iconSize: 24,
                size: 14.5,
                gap: 4,
                maxWidth,
                minSize: 9.5,
                cls: 's2-lbl s2-word',
                sub: null,
              });
            }
            items.push({ fit, sl, r: G.lbl });
          }
          settle(items, m, H, G.rin + 5, G.rout - 1);
          V.openFx(s('g', { class: 's2-fx' }, root), ctx);
        },

        update(root, m, st, H) {
          const res = root.querySelector('.s2-result');
          if (res) {
            const cur = st.hover ?? st.selected;
            const ext = cur == null ? null : extension(m.slices[cur]);
            const on = !!(ext && m.file);
            root.querySelector('.s2-hubc').classList.toggle('has-result', on);
            if (on) {
              const t = res.querySelector('.s2-result-text');
              t.textContent = renamed(m.file, ext);
              H.fitWidth(t, 98, 12.5, 9);
              const w = Math.min(118, t.getComputedTextLength() + 22);
              const pill = res.querySelector('.s2-pill');
              pill.setAttribute('x', f1(C - w / 2));
              pill.setAttribute('width', f1(w));
            }
          }
          // The seal in the hub always shows the selected slice.
          const seal = root.querySelector('.s2-seal');
          const key = st.selected == null ? '' : String(st.selected);
          if (seal.dataset.for !== key) {
            seal.dataset.for = key;
            const sl = st.selected == null ? null : m.slices[st.selected];
            sealContent(seal.querySelector('.s2-seal-content'), m, sl, H);
            const cap = root.querySelector('.s2-cap');
            cap.textContent = sl ? captionText(m, sl) : '';
            if (sl) H.fitWidth(cap, 118, 12.5, 9);
          }
        },

        // The apply effect. Live (t undefined) it runs on requestAnimationFrame and cleans up after itself;
        // for a still frame (t set) it draws the moment t and stays.
        onSelect(root, m, i, H, t) {
          const wheel = root.closest('.wheel');
          if (wheel.s2Stop) wheel.s2Stop();
          if (t == null && (reducedMotion() || !window.requestAnimationFrame)) return;
          const g = root.querySelector(`.slice[data-slice="${i}"]`);
          const sl = m.slices[i];
          const hub = root.querySelector('.s2-hubc');
          const env = {
            root,
            m,
            sl,
            g,
            H,
            G,
            sgn: m.dir === 'rtl' ? -1 : 1,
            under: H.s('g', { class: 's2-fxl' }),
            below: H.s('g', { class: 's2-fxl' }, hub.querySelector('.s2-fx-below')),
            above: H.s('g', { class: 's2-fxl' }, hub.querySelector('.s2-fx-above')),
            seal: hub.querySelector('.s2-seal'),
            glint: hub.querySelector('.s2-seal-glint'),
            cap: hub.querySelector('.s2-cap'),
            hubText: hub.querySelector('.s2-hub-text'),
          };
          g.insertBefore(env.under, g.querySelector('.s2-content'));
          // The selected material (gold leaf, copper, silver) fills in behind the light, from the rim inward,
          // so the light always travels over the idle slice and stays visible; the label keeps its idle
          // color until the fill has passed it.
          const mats = [...g.querySelectorAll('.s2-sel, .s2-seams, .s2-sheen')];
          const clipId = H.uid(V.id + '-rv');
          const clipPath = H.s('path', {}, H.s('clipPath', { id: clipId }, env.under));
          mats.forEach((n) => n.setAttribute('clip-path', `url(#${clipId})`));
          const frontHalo = H.s('path', { class: 's2-fx-front-halo' }, env.under);
          const front = H.s('path', { class: 's2-fx-front' }, env.under);
          env.reveal = G.rout;
          const paint = V.apply(env);
          const paintAll = (tt) => {
            paint(tt);
            const r = Math.max(G.rin + 2, Math.min(G.rout - 2, env.reveal));
            clipPath.setAttribute('d', H.sector(r <= G.rin + 2.5 ? G.rin - 2 : r, G.rim + 6, sl.a0 - 2, sl.a1 + 2));
            const moving = r > G.rin + 3 && r < G.rout - 3;
            if (moving) {
              const d = H.arc(r, sl.a0 + 2.2, sl.a1 - 2.2);
              front.setAttribute('d', d);
              frontHalo.setAttribute('d', d);
            }
            op(front, moving ? 1 : 0);
            op(frontHalo, moving ? 1 : 0);
            g.classList.toggle('s2-unlit', r > G.lbl - 4);
            op(env.hubText, 1 - seg(tt, V.timing.hubOut[0], V.timing.hubOut[1]));
            op(env.cap, seg(tt, V.timing.cap[0], V.timing.cap[1]));
            const gu = seg(tt, V.timing.glint[0], V.timing.glint[1]);
            env.glint.setAttribute(
              'transform',
              `rotate(28) translate(${f2(lerp(-1.7, 1.7, ease.inOutSine(gu)) * G.sealR)} 0)`,
            );
            op(env.glint, bell(gu, 0, 0.45, 1) * 0.9);
          };
          wheel.classList.add('s2-fx');
          const stop = () => {
            cancelAnimationFrame(wheel.s2Raf);
            for (const n of [env.under, env.below, env.above]) n.remove();
            mats.forEach((n) => n.removeAttribute('clip-path'));
            g.classList.remove('s2-unlit');
            for (const n of [env.seal, env.cap, env.hubText, env.glint]) n.style.opacity = '';
            env.seal.setAttribute('transform', `translate(${C} ${C + G.sealY})`);
            wheel.classList.remove('s2-fx');
            wheel.s2Stop = null;
          };
          if (t != null) {
            paintAll(t);
            return;
          }
          wheel.s2Stop = stop;
          const t0 = performance.now();
          const step = (now) => {
            if (!root.isConnected) return stop();
            const tt = now - t0;
            if (tt >= V.motion.apply) return stop();
            paintAll(tt);
            wheel.s2Raf = requestAnimationFrame(step);
          };
          paintAll(0);
          wheel.s2Raf = requestAnimationFrame(step);
        },
      };
    }

    // Shared pieces of the variants.
    const sectorBand = (r0, r1) => (sl, ctx) => ctx.H.sector(r0, r1, sl.a0, sl.a1, ctx.G.gap);
    const arcEdge =
      (r, inset = 1.6) =>
      (sl, ctx) =>
        ctx.H.arc(r, sl.a0 + inset, sl.a1 - inset);
    // Parallel hatch lines over the 400 x 400 view box; dir 1 leans right, -1 leans left.
    function hatchLines(step, dir) {
      let d = '';
      for (let x = -400; x <= 800; x += step) d += `M${f1(x)} 0L${f1(x + 400 * dir)} 400`;
      return d;
    }
    function dustLayer(tex, ctx, o) {
      const { m, H, G } = ctx;
      const rand = rng(o.seed + m.kind.length * 131);
      const centers = labelCenters(H, m, G.lbl);
      const dust = ['', '', ''];
      let glints = '';
      for (let k = 0, kept = 0; k < 700 && kept < o.count; k++) {
        const r = Math.sqrt((G.rin + 5) ** 2 + rand() * ((G.rout - 5) ** 2 - (G.rin + 5) ** 2));
        const a = rand() * 360;
        const [x, y] = H.polar(r, a);
        if (nearLabel(centers, x, y, o.keep) || nearDivider(m, r, a, 3.5)) continue;
        kept++;
        if (o.glint && kept % o.glint === 0) {
          const q = o.glintSize || 2.6;
          glints += `M${f1(x)} ${f1(y - q)}L${f1(x + q * 0.27)} ${f1(y - q * 0.27)}L${f1(x + q)} ${f1(y)}L${f1(x + q * 0.27)} ${f1(y + q * 0.27)}L${f1(x)} ${f1(y + q)}L${f1(x - q * 0.27)} ${f1(y + q * 0.27)}L${f1(x - q)} ${f1(y)}L${f1(x - q * 0.27)} ${f1(y - q * 0.27)}Z`;
        } else dust[Math.floor(rand() * 3)] += dotPath(x, y, f2(o.r0 + rand() * o.r1));
      }
      const dg = H.s('g', { class: 's2-dust' }, tex);
      dust.forEach((d, k) => d && H.s('path', { d, class: 's2-dust-' + k }, dg));
      if (glints) H.s('path', { d: glints, class: 's2-dust-glint' }, dg);
    }
    function drawRing(parent, H, r, cls, delay, ccw) {
      const p = H.s('path', { d: circlePath(r, ccw), class: cls + ' s2-draw', pathLength: 1 }, parent);
      p.style.setProperty('--d', delay);
      return p;
    }
    function dividers(parent, ctx, cls, offset = 0) {
      const { m, H, G } = ctx;
      for (const sl of m.slices) {
        for (const o of offset ? [-offset, offset] : [0]) {
          const da = ((o / G.rin) * 180) / Math.PI;
          const db = ((o / G.rout) * 180) / Math.PI;
          const [x1, y1] = H.polar(G.rin, sl.a0 + da);
          const [x2, y2] = H.polar(G.rout, sl.a0 + db);
          const p = H.s(
            'path',
            { d: `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`, class: cls + ' s2-draw', pathLength: 1 },
            parent,
          );
          p.style.setProperty('--d', `calc(${sl.i} * var(--stagger) + 30ms)`);
        }
      }
    }
    function glossCircle(parent, H, r, id) {
      H.s('circle', { cx: C, cy: C, r, class: 's2-gloss', fill: `url(#${id}-gloss)` }, parent);
    }
    // Theme-independent gradients (metals, sheens and glints) for one variant; theme-dependent ones are
    // made per wheel in V.defs, with stop colors taken from the palette tokens.
    function sharedDefs(id, metal) {
      return `
      <linearGradient id="${id}-sheen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="0.42" stop-color="#fff" stop-opacity="0"/>
        <stop offset="0.78" stop-color="#fff" stop-opacity="0.08"/><stop offset="1" stop-color="#fff" stop-opacity="0.24"/>
      </linearGradient>
      <linearGradient id="${id}-glint" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="${id}-gloss" cx="0.5" cy="0.12" r="0.8">
        <stop offset="0" stop-color="#fff" stop-opacity="0.24"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
      ${metal}`;
    }
    const CREDIT = (family) => ({ family, license: 'SIL Open Font License 1.1' });
    const FAMILY = {};

    // ================================================================== A · Lapis & gold leaf
    const A = {
      id: 'simya-a',
      geo: {
        hub: 79,
        rin: 84,
        rout: 170,
        band: 180,
        rim: 190,
        lbl: 127,
        gap: 3.5,
        glyphR: 180,
        sealY: -9,
        sealR: 35,
        sealText: 50,
        capY: 47,
      },
      titleFont: 22,
      fmtFont: 26,
      sealFont: 18,
      sealIcon: 26,
      motion: { open: 190, close: 120, stagger: 14, apply: 660 },
      timing: { hubOut: [220, 330], cap: [470, 620], glint: [470, 660] },
      texture(tex, ctx) {
        // Marble veins: long strands along one grain direction, meandering at two scales, each with a thin
        // companion that drifts off it; broken around the labels and the hub. Strong on porcelain, gone on
        // lapis: where the palette hides them (the dark face) they are not drawn at all.
        const scope = tex.closest('[data-concept]');
        if (!scope || scope.style.getPropertyValue('--s2-vein-opacity').trim() !== '0') A.veins(tex, ctx);
        // Pyrite flecks, the gold that lapis carries.
        dustLayer(tex, ctx, { seed: 97, count: 60, keep: 37, r0: 0.45, r1: 0.75, glint: 19 });
      },
      veins(tex, ctx) {
        const { m, H, G } = ctx;
        const rand = rng(41 + m.kind.length * 17);
        const centers = labelCenters(H, m, G.lbl);
        const grain = ((30 + rand() * 14) * Math.PI) / 180;
        const [gx, gy, nx, ny] = [Math.cos(grain), Math.sin(grain), -Math.sin(grain), Math.cos(grain)];
        // A point every 6 units is enough for curves this long; the swell keeps its length in units.
        const STEP = 6;
        const strand = (off, amp, freq, ph, s0, s1, w0, w1) => {
          const segs = [];
          let cur = [];
          for (let d = s0; d <= s1; d += STEP) {
            const o = off + amp * Math.sin(d * freq + ph) + amp * 0.35 * Math.sin(d * freq * 3.3 + ph * 1.7);
            const x = C + gx * d + nx * o;
            const y = C + gy * d + ny * o;
            const r = Math.hypot(x - C, y - C);
            if (r < 196 && r > G.hub + 5 && !nearLabel(centers, x, y, 31)) cur.push([x, y]);
            else if (cur.length) {
              if (cur.length > 1) segs.push(cur);
              cur = [];
            }
          }
          if (cur.length > 1) segs.push(cur);
          // Each piece is a ribbon whose width swells and thins along the grain, as marble veins do.
          const swell = (0.23 * STEP) / 4.5;
          return segs.map((p) => ribbon(p, (k) => w0 + w1 * (0.5 + 0.5 * Math.sin(k * swell + ph * 2)) ** 2)).join('');
        };
        const vg = H.s('g', { class: 's2-veins' }, tex);
        [-142, -70, 8, 84, 150].forEach((off, k) => {
          const ph = rand() * 6.28;
          const amp = 8 + rand() * 12;
          const fr = 0.01 + rand() * 0.007;
          const main = H.s(
            'path',
            { d: strand(off + (rand() - 0.5) * 24, amp, fr, ph, -230, 230, 0.25, 1.9), class: 's2-vein' },
            vg,
          );
          main.style.opacity = String(f2(0.55 + (0.45 * ((k * 37) % 5)) / 4));
          if (k % 2) return;
          const a = -160 + rand() * 120;
          H.s(
            'path',
            {
              d: strand(off + 4, amp * 1.6, fr * 1.7, ph + 0.9, a, a + 70 + rand() * 90, 0.15, 0.6),
              class: 's2-vein s2-vein-fine',
            },
            vg,
          );
        });
      },
      ink(ink, ctx) {
        const { m, H, G, ccw } = ctx;
        H.s('path', { d: H.ring(G.rout, G.rim), class: 's2-band' }, ink);
        H.s('path', { d: H.ring(G.rout, G.rim), class: 's2-band-gloss', fill: `url(#${A.id}-bandgloss)` }, ink);
        drawRing(ink, H, G.rin, 's2-ring', '12ms', ccw);
        drawRing(ink, H, G.rout, 's2-ring s2-ring-gold', '36ms', ccw);
        drawRing(ink, H, G.rim, 's2-rim', '48ms', ccw);
        // Twelve ticks a slice, the longer ones on its joints and quarters, counted from its first joint
        // so they stay in step with a turned ring of choices.
        let ticks = '';
        const nt = m.n * 12;
        const from = m.slices.length ? m.slices[0].a0 : 0;
        for (let k = 0; k < nt; k++) {
          const a = from + (k * 360) / nt;
          const [x1, y1] = H.polar(192, a);
          const [x2, y2] = H.polar(k % 3 === 0 ? 196.5 : 194.5, a);
          ticks += `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`;
        }
        H.s('path', { d: ticks, class: 's2-ticks' }, ink);
        dividers(ink, ctx, 's2-div');
        const band = H.s('g', { class: 's2-band-marks-g s2-turn' }, ink);
        let marks = '';
        for (const sl of m.slices) {
          marks += rhombus(H, G.band, sl.a0, 3.4, 1.9);
          for (const q of [-0.25, 0.25]) {
            const [x, y] = H.polar(G.band, sl.mid + q * m.step);
            marks += dotPath(x, y, 1.05);
          }
        }
        H.s('path', { d: marks, class: 's2-band-marks' }, band);
      },
      hub(hub, ctx) {
        const { H, G, ccw } = ctx;
        H.s('circle', { cx: C, cy: C, r: G.hub, class: 's2-hub' }, hub);
        glossCircle(hub, H, G.hub, A.id);
        drawRing(hub, H, G.hub, 's2-hub-ring', '0ms', ccw);
        H.s('circle', { cx: C, cy: C, r: 72.5, class: 's2-hub-dots' }, hub);
      },
      sealBody(g, ctx) {
        const { H, G } = ctx;
        const R = G.sealR;
        H.s('circle', { cx: 0, cy: 0, r: R + 5, class: 's2-seal-halo' }, g);
        H.s('circle', { cx: 0, cy: 0, r: R, fill: `url(#${A.id}-leafr)`, class: 's2-seal-disc' }, g);
        H.s('circle', { cx: 0, cy: 0, r: R, fill: `url(#${A.id}-seams)`, class: 's2-seal-seams' }, g);
        H.s('circle', { cx: 0, cy: 0, r: R - 0.6, class: 's2-seal-edge' }, g);
        H.s('circle', { cx: 0, cy: 0, r: R - 5, class: 's2-seal-beads' }, g);
        H.s('circle', { cx: 0, cy: 0, r: R - 9, class: 's2-seal-ring' }, g);
      },
      selDeco(g, segD, ctx) {
        ctx.H.s('path', { d: segD, class: 's2-seams', fill: `url(#${A.id}-seams)` }, g);
      },
      bandSeg: sectorBand(171.5, 188.5),
      edge: arcEdge(170),
      hatch: () => hatchLines(6.5, 1),
      glyph: studMarkup,
      node(g, sl, ctx) {
        const [nx, ny] = ctx.H.polar(ctx.G.rin, sl.mid);
        ctx.H.s('circle', { cx: f1(nx), cy: f1(ny), r: 7.5, class: 's2-node-halo' }, g);
        ctx.H.s('circle', { cx: f1(nx), cy: f1(ny), r: 3.2, class: 's2-node' }, g);
      },
      openFx(fx, ctx) {
        const { H, G, ccw } = ctx;
        H.s('path', { d: circlePath(G.rim, ccw), class: 's2-shimmer s2-shimmer-halo', pathLength: 1 }, fx);
        H.s('path', { d: circlePath(G.rim, ccw), class: 's2-shimmer', pathLength: 1 }, fx);
      },
      // The comet: the slice flashes to gold leaf, a gold comet curves through the slice into the hub, the hub
      // flares, the seal is struck (pop and settle) and a few leaf flakes fly off it.
      apply(env) {
        const { sl, H, G, sgn, under, above } = env;
        const s = H.s;
        const bandFlash = s('path', { d: A.bandSeg(sl, { H, G }), class: 's2-fx-flash' }, under);
        const pts = [];
        for (let k = 0; k <= 56; k++) {
          const u = k / 56;
          const [x, y] = H.polar(G.band * (1 - u), sl.mid + sgn * 15 * Math.sin(Math.PI * u));
          pts.push([x, y + G.sealY * u * u]);
        }
        const tr = track(pts);
        const mk = (cls) => s('path', { d: tr.d, class: cls, pathLength: 1 }, under);
        const resid = mk('s2-fx-resid');
        const halo = mk('s2-fx-halo');
        const tail = mk('s2-fx-tail');
        const core = mk('s2-fx-core');
        const headHalo = s('circle', { r: 14, class: 's2-fx-head-halo' }, under);
        const head = s('circle', { r: 4.8, class: 's2-fx-head' }, under);
        const flare = s('circle', { cx: C, cy: C, r: G.hub, class: 's2-fx-flare' }, env.below);
        const flakes = [];
        for (let k = 0; k < 10; k++)
          flakes.push(
            s('path', { d: 'M0 -3.2L1.7 0L0 3.2L-1.7 0Z', class: 's2-fx-flake' + (k % 3 ? '' : ' is-light') }, above),
          );
        return (t) => {
          op(bandFlash, 0.95 * (1 - ease.outCubic(seg(t, 40, 340))));
          const e = ease.inOutSine(seg(t, 0, 320));
          const alive = 1 - seg(t, 320, 400);
          dash(core, e - 0.08, e);
          dash(tail, e - 0.24, e);
          dash(halo, e - 0.38, e);
          dash(resid, 0, e);
          op(core, alive);
          op(tail, alive * 0.9);
          op(halo, alive * 0.85);
          op(resid, 0.55 * (1 - seg(t, 330, 600)));
          const [hx, hy] = tr.at(e);
          const [rx, ry] = tr.at(e - 0.22);
          env.reveal = t < 320 ? Math.hypot(rx - C, ry - C) : 0;
          for (const n of [head, headHalo]) {
            n.setAttribute('cx', f2(hx));
            n.setAttribute('cy', f2(hy));
            op(n, alive);
          }
          op(flare, bell(t, 290, 350, 540));
          const u = seg(t, 320, 610);
          env.seal.setAttribute('transform', `translate(${C} ${C + G.sealY}) scale(${f3(pop(u))})`);
          op(env.seal, seg(t, 320, 360));
          const fu = seg(t, 330, 580);
          flakes.forEach((n, k) => {
            const a = k * 36 + 14 + (k % 2) * 9;
            const r = lerp(G.sealR * 0.7, G.sealR + 12 + (k % 3) * 9, ease.outCubic(fu));
            const [x, y] = polarAt(C, C + G.sealY, r, a);
            n.setAttribute(
              'transform',
              `translate(${f2(x)} ${f2(y)}) rotate(${f1(a + fu * 160)}) scale(${f3(1 - 0.45 * fu)})`,
            );
            op(n, fu > 0 ? 1 - ease.outCubic(seg(t, 380, 580)) : 0);
          });
        };
      },
    };

    // ================================================================== B · Verdigris & copper
    const B = {
      id: 'simya-b',
      geo: {
        hub: 77,
        rin: 83,
        rout: 164,
        collar0: 167,
        collar1: 189,
        band: 178,
        rim: 189,
        lbl: 124,
        gap: 4,
        glyphR: 178,
        sealY: -9,
        sealR: 34,
        sealText: 40,
        capY: 46,
      },
      titleFont: 20,
      fmtFont: 23,
      sealFont: 15,
      sealIcon: 22,
      motion: { open: 190, close: 120, stagger: 14, apply: 680 },
      timing: { hubOut: [200, 300], cap: [480, 640], glint: [470, 680] },
      defs(defs, ctx) {
        const id = ctx.uid;
        ctx.H.s(
          'radialGradient',
          { id: id + '-pat', html: '<stop offset="0" class="s2-pat-0"/><stop offset="1" class="s2-pat-1"/>' },
          defs,
        );
        return { pat: id + '-pat' };
      },
      texture(tex, ctx) {
        const { m, H, G, ids } = ctx;
        const rand = rng(23 + m.kind.length * 29);
        // Patina: soft blotches, the green bloom on old copper.
        const pg = H.s('g', { class: 's2-patina' }, tex);
        for (let k = 0; k < 11; k++) {
          const [x, y] = H.polar(40 + rand() * 120, rand() * 360);
          H.s('circle', { cx: f1(x), cy: f1(y), r: f1(18 + rand() * 34), fill: `url(#${ids.pat})` }, pg);
        }
        // Crackle: the fine crazing of a celadon glaze; drawn in the light theme only.
        const centers = labelCenters(H, m, G.lbl);
        let d = '';
        for (let k = 0, made = 0; k < 160 && made < 26; k++) {
          const r0 = G.rin + 6 + rand() * (G.rout - G.rin - 12);
          const a0 = rand() * 360;
          let [x, y] = H.polar(r0, a0);
          if (nearLabel(centers, x, y, 33)) continue;
          made++;
          let head = rand() * Math.PI * 2;
          const pts = [[x, y]];
          const n = 3 + Math.floor(rand() * 4);
          for (let j = 0; j < n; j++) {
            head += (rand() - 0.5) * 1.5;
            x += Math.cos(head) * (6 + rand() * 7);
            y += Math.sin(head) * (6 + rand() * 7);
            const rr = Math.hypot(x - C, y - C);
            if (rr > G.rout - 3 || rr < G.rin + 3 || nearLabel(centers, x, y, 30)) break;
            pts.push([x, y]);
          }
          if (pts.length > 1) d += polyD(pts);
        }
        H.s('path', { d, class: 's2-crackle' }, tex);
      },
      ink(ink, ctx) {
        const { m, H, G, ccw } = ctx;
        // The copper collar: a turned ring with rivets at the slice joints and engraved beads.
        const col = H.s('g', { class: 's2-collar-g s2-turn' }, ink);
        H.s('path', { d: H.ring(G.collar0, G.collar1), class: 's2-collar', fill: `url(#${B.id}-copper)` }, col);
        H.s('circle', { cx: C, cy: C, r: G.collar0 + 1.1, class: 's2-collar-hi' }, col);
        H.s('circle', { cx: C, cy: C, r: G.collar0, class: 's2-collar-edge' }, col);
        H.s('circle', { cx: C, cy: C, r: G.collar1, class: 's2-collar-edge' }, col);
        let rivets = '';
        let rivetHi = '';
        for (const sl of m.slices) {
          const [x, y] = H.polar(G.band, sl.a0);
          rivets += dotPath(x, y, 3.3);
          rivetHi += dotPath(x - 0.9, y - 0.9, 1.1);
        }
        H.s('path', { d: rivets, class: 's2-rivet', fill: `url(#${B.id}-rivet)` }, col);
        H.s('path', { d: rivetHi, class: 's2-rivet-hi' }, col);
        drawRing(ink, H, G.rin, 's2-ring', '10ms', ccw);
        drawRing(ink, H, G.rout, 's2-ring', '30ms', ccw);
        drawRing(ink, H, 194, 's2-rim', '46ms', ccw);
        dividers(ink, ctx, 's2-div', 1.7);
      },
      hub(hub, ctx) {
        const { H, G, ccw } = ctx;
        H.s('circle', { cx: C, cy: C, r: G.hub, class: 's2-hub' }, hub);
        glossCircle(hub, H, G.hub, B.id);
        drawRing(hub, H, G.hub, 's2-hub-ring', '0ms', ccw);
        H.s('circle', { cx: C, cy: C, r: G.hub - 4.5, class: 's2-lathe' }, hub);
        H.s('circle', { cx: C, cy: C, r: G.hub - 7.5, class: 's2-lathe s2-lathe-2' }, hub);
      },
      sealBody(g, ctx) {
        const { H, G } = ctx;
        const R = G.sealR;
        H.s('circle', { cx: 0, cy: 0, r: R + 5, class: 's2-seal-halo' }, g);
        H.s('circle', { cx: 0, cy: 0, r: R, fill: `url(#${B.id}-bezel)`, class: 's2-seal-disc' }, g);
        for (const rr of [R - 2.2, R - 4.4]) H.s('circle', { cx: 0, cy: 0, r: rr, class: 's2-seal-lathe' }, g);
        H.s('circle', { cx: 0, cy: 0, r: R - 7, fill: `url(#${B.id}-enamel)`, class: 's2-seal-enamel' }, g);
        H.s('circle', { cx: 0, cy: 0, r: R - 7, class: 's2-seal-ring' }, g);
        H.s(
          'path',
          {
            d: `M${f2(-(R - 9.5) * 0.7)} ${f2(-(R - 9.5) * 0.7)}A${R - 9.5} ${R - 9.5} 0 0 1 ${f2((R - 9.5) * 0.7)} ${f2(-(R - 9.5) * 0.7)}`,
            class: 's2-seal-gleam',
          },
          g,
        );
      },
      bandSeg(sl, ctx) {
        return ctx.H.sector(ctx.G.collar0 + 0.8, ctx.G.collar1 - 0.8, sl.a0 + 2.2, sl.a1 - 2.2);
      },
      edge: arcEdge(165.2, 2),
      hatch() {
        let d = '';
        for (let y = 0; y <= 400; y += 6.5)
          for (let x = (y / 6.5) % 2 ? 3.25 : 0; x <= 400; x += 6.5) d += dotPath(x, y, 0.85);
        return d;
      },
      glyph: beadMarkup,
      node(g, sl, ctx) {
        const [nx, ny] = ctx.H.polar(ctx.G.rin, sl.mid);
        ctx.H.s('circle', { cx: f1(nx), cy: f1(ny), r: 8, class: 's2-node-halo' }, g);
        ctx.H.s('circle', { cx: f1(nx), cy: f1(ny), r: 3.6, class: 's2-node' }, g);
        ctx.H.s('circle', { cx: f1(nx), cy: f1(ny), r: 1.3, class: 's2-node-core' }, g);
      },
      openFx(fx, ctx) {
        ctx.H.s('circle', { cx: C, cy: C, r: ctx.G.rout - 4, class: 's2-wave' }, fx);
      },
      // Distillation: the collar segment heats, a copper drop gathers and falls straight into the hub,
      // leaving beads that evaporate; three ripples spread, and the copper-bezel seal surfaces with a pop.
      apply(env) {
        const { sl, H, G, under, below } = env;
        const s = H.s;
        const heat = s('path', { d: B.bandSeg(sl, { H, G }), class: 's2-fx-heat' }, under);
        const [x0, y0] = H.polar(G.rout - 1, sl.mid);
        const pts = [];
        for (let k = 0; k <= 30; k++) {
          const u = k / 30;
          pts.push([lerp(x0, C, u), lerp(y0, C + G.sealY, u)]);
        }
        const tr = track(pts);
        const stream = s('path', { d: tr.d, class: 's2-fx-stream', pathLength: 1 }, under);
        const streamHalo = s('path', { d: tr.d, class: 's2-fx-halo', pathLength: 1 }, under);
        under.insertBefore(streamHalo, stream);
        const beadsAt = [0.16, 0.3, 0.44, 0.58, 0.72];
        const beads = beadsAt.map(() => s('circle', { r: 2, class: 's2-fx-bead' }, under));
        const drop = s(
          'path',
          { d: 'M0 -11C2.2 -6 5 -3.2 5 0.4A5 5 0 0 1 -5 0.4C-5 -3.2 -2.2 -6 0 -11Z', class: 's2-fx-drop' },
          under,
        );
        const dropHi = s('path', { d: 'M-2.6 -0.6A2.8 2.8 0 0 1 -0.6 -3.4', class: 's2-fx-drop-hi' }, under);
        const ripples = [0, 1, 2].map(() =>
          s('circle', { cx: C, cy: C + G.sealY, r: 6, class: 's2-fx-ripple' }, below),
        );
        // e(t): the drop starts slowly and accelerates, like a falling drop.
        const T0 = 40;
        const T1 = 290;
        const fall = (u) => 0.25 * u + 0.75 * u * u;
        const when = (target) => T0 + (T1 - T0) * ((-0.25 + Math.sqrt(0.0625 + 3 * target)) / 1.5);
        return (t) => {
          op(heat, 1 - seg(t, 140, 380));
          const e = fall(seg(t, T0, T1));
          const falling = t < T1 ? 1 : 0;
          const [dx, dy, ang] = tr.at(e);
          const [rx, ry] = tr.at(e - 0.3);
          env.reveal = t < T1 ? Math.hypot(rx - C, ry - C) : 0;
          const form = 1.5 * (0.35 + 0.65 * ease.outCubic(seg(t, 0, T0)));
          const stretch = 1 + 0.4 * e;
          const tf = `translate(${f2(dx)} ${f2(dy)}) rotate(${f1(ang + 90)}) scale(${f3(form / Math.sqrt(stretch))} ${f3(form * stretch)})`;
          drop.setAttribute('transform', tf);
          dropHi.setAttribute('transform', tf);
          op(drop, falling);
          op(dropHi, falling);
          dash(stream, e - 0.42, e);
          dash(streamHalo, e - 0.3, e);
          const sOp = 1 - seg(t, T1, T1 + 100);
          op(stream, sOp);
          op(streamHalo, sOp * 0.8);
          beads.forEach((b, k) => {
            const born = when(beadsAt[k]);
            const [bx, by] = tr.at(beadsAt[k]);
            b.setAttribute('cx', f2(bx + (k % 2 ? 3 : -3)));
            b.setAttribute('cy', f2(by));
            const life = seg(t, born + 40, born + 260);
            b.setAttribute('r', f2(lerp(2.3 - k * 0.2, 0.4, life)));
            op(b, t >= born ? 1 - life : 0);
          });
          ripples.forEach((c, k) => {
            const u = seg(t, T1 + k * 55, T1 + k * 55 + 320);
            c.setAttribute('r', f2(lerp(6, G.hub + 12 - k * 6, ease.outCubic(u))));
            c.style.strokeWidth = f2(lerp(2.6, 0.5, u));
            op(c, u > 0 ? (1 - u) * (1 - k * 0.2) : 0);
          });
          const u = seg(t, 320, 640);
          const sc = pop(u, 1.12, 0.97, 0.25);
          const lift = lerp(12, 0, ease.outCubic(u));
          env.seal.setAttribute('transform', `translate(${C} ${f2(C + G.sealY + lift)}) scale(${f3(sc)})`);
          op(env.seal, seg(t, 320, 380));
        };
      },
    };

    // ================================================================== C · Obsidian & moonsilver
    // The cut: the rim is a regular polygon with an even number of facets per slice and ten or more in
    // all, so the stone keeps its cut with two or three slices instead of turning into a square. A facet
    // is centred on every slice joint and every slice middle, and the corners follow the slices, so a
    // turned ring of choices turns its stone with it.
    function cut(m, G) {
      const f = 2 * Math.max(1, Math.round(7 / Math.max(1, m.n)));
      const facet = m.step / f;
      const base = m.slices.length ? m.slices[0].a0 : -m.step / 2;
      const verts = [];
      for (let k = 0; k < m.n * f; k++) verts.push(base + (k + 0.5) * facet);
      return { facet, base, verts, ap: G.rv * Math.cos(((facet / 2) * Math.PI) / 180) };
    }

    const C_ = {
      id: 'simya-c',
      geo: {
        hub: 78,
        rin: 83,
        rout: 166,
        rv: 193,
        band: 179,
        rim: 193,
        lbl: 124,
        gap: 3,
        glyphR: 180.5,
        sealY: -9,
        sealR: 36,
        sealText: 40,
        capY: 48,
      },
      titleFont: 21,
      fmtFont: 25,
      sealFont: 14.5,
      sealIcon: 21,
      motion: { open: 180, close: 110, stagger: 13, apply: 600 },
      timing: { hubOut: [130, 220], cap: [430, 570], glint: [420, 600] },
      defs(defs, ctx) {
        const id = ctx.uid;
        ctx.H.s(
          'linearGradient',
          {
            id: id + '-sel',
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 1,
            html: '<stop offset="0" class="s2-sel-0"/><stop offset="0.5" class="s2-sel-1"/><stop offset="1" class="s2-sel-2"/>',
          },
          defs,
        );
        return { sel: id + '-sel' };
      },
      prepare(ctx) {
        const { m, G } = ctx;
        Object.assign(ctx, cut(m, G));
        if (ctx.wrap) {
          const pct = ctx.verts.map((a) => {
            const [x, y] = polarAt(50, 50, (G.rv / 400) * 100, a);
            return `${f2(x)}% ${f2(y)}%`;
          });
          ctx.wrap.style.setProperty('--s2-facets', `polygon(${pct.join(',')})`);
          // The round shadow under the stone stays inside its flats, so no disc shows between the corners.
          ctx.wrap.style.setProperty('--s2-stone-inset', `${f2(((C - ctx.ap + 1) / 400) * 100)}%`);
        }
      },
      texture(tex, ctx) {
        // Moon dust: a few four-point glints and fine specks.
        dustLayer(tex, ctx, { seed: 211, count: 26, keep: 38, r0: 0.35, r1: 0.5, glint: 4, glintSize: 3.2 });
      },
      ink(ink, ctx) {
        const { H, G, ccw } = ctx;
        const V = (a) => H.polar(G.rv, a);
        const rimPts = ctx.verts.map(V);
        const rim = H.s(
          'path',
          { d: polyD(ccw ? rimPts.reverse() : rimPts, true), class: 's2-rim s2-draw', pathLength: 1 },
          ink,
        );
        rim.style.setProperty('--d', '30ms');
        // The crown: a zigzag between the inner circle (at the middle of every facet, slice joints and
        // slice middles among them) and the rim corners.
        const z = [];
        for (let j = 0; j <= ctx.verts.length * 2; j++) {
          const a = ctx.base + (j * ctx.facet) / 2;
          z.push(j % 2 ? H.polar(G.rv, a) : H.polar(G.rout, a));
        }
        const crown = H.s('path', { d: polyD(ccw ? z.reverse() : z), class: 's2-crown s2-draw', pathLength: 1 }, ink);
        crown.style.setProperty('--d', '50ms');
        drawRing(ink, H, G.rout, 's2-ring', '20ms', ccw);
        drawRing(ink, H, G.rin, 's2-ring s2-ring-in', '8ms', ccw);
        dividers(ink, ctx, 's2-div');
        let vd = '';
        for (const a of ctx.verts) {
          const [x, y] = V(a);
          vd += dotPath(x, y, 1.5);
        }
        H.s('path', { d: vd, class: 's2-vert' }, ink);
      },
      hub(hub, ctx) {
        const { H, G, ccw } = ctx;
        H.s('circle', { cx: C, cy: C, r: G.hub + 3, class: 's2-hub-glow' }, hub);
        H.s('circle', { cx: C, cy: C, r: G.hub, class: 's2-hub' }, hub);
        glossCircle(hub, H, G.hub, C_.id);
        drawRing(hub, H, G.hub, 's2-hub-ring', '0ms', ccw);
        H.s('circle', { cx: C, cy: C, r: G.hub - 6, class: 's2-hub-inner' }, hub);
      },
      sealBody(g, ctx) {
        const { H, G } = ctx;
        const R = G.sealR;
        const T = R * 0.6; // the table facet
        H.s('circle', { cx: 0, cy: 0, r: R + 6, class: 's2-seal-halo' }, g);
        H.s('circle', { cx: 0, cy: 0, r: R, fill: `url(#${C_.id}-gem)`, class: 's2-seal-disc' }, g);
        const tv = [];
        for (let k = 0; k < 8; k++) tv.push(polarAt(0, 0, T, k * 45 + 22.5));
        let light = '';
        let shade = '';
        for (let k = 0; k < 8; k++) {
          const a = k * 45 + 22.5;
          const p0 = tv[k];
          const p1 = tv[(k + 1) % 8];
          const o0 = polarAt(0, 0, R, a);
          const o1 = polarAt(0, 0, R, a + 45);
          const mid = polarAt(0, 0, R, a + 22.5);
          // Each crown segment splits into two facets, one light and one shaded.
          light += polyD([p0, o0, mid, p1], true);
          shade += polyD([p1, mid, o1], true);
        }
        H.s('path', { d: light, class: 's2-facet-light' }, g);
        H.s('path', { d: shade, class: 's2-facet-shade' }, g);
        H.s('path', { d: polyD(tv, true), class: 's2-seal-table' }, g);
        H.s('circle', { cx: 0, cy: 0, r: R - 0.5, class: 's2-seal-edge' }, g);
      },
      bandSeg(sl, ctx) {
        const { H, G, m } = ctx;
        const { ap, facet } = cut(m, G);
        const pts = [H.polar(ap - 1, sl.a0 + 1)];
        for (let a = sl.a0 + facet / 2; a < sl.a1; a += facet) pts.push(H.polar(G.rv - 1.5, a));
        pts.push(H.polar(ap - 1, sl.a1 - 1));
        const [x4, y4] = H.polar(G.rout + 1.5, sl.a1 - 1);
        const [x5, y5] = H.polar(G.rout + 1.5, sl.a0 + 1);
        const big = sl.a1 - sl.a0 - 2 > 180 ? 1 : 0;
        return `${polyD(pts)}L${f2(x4)} ${f2(y4)}A${G.rout + 1.5} ${G.rout + 1.5} 0 ${big} 0 ${f2(x5)} ${f2(y5)}Z`;
      },
      edge(sl, ctx) {
        const { H, G, m } = ctx;
        const { ap, facet } = cut(m, G);
        const pts = [H.polar(ap - 0.4, sl.a0 + 2.5)];
        for (let a = sl.a0 + facet / 2; a < sl.a1; a += facet) pts.push(H.polar(G.rv - 0.6, a));
        pts.push(H.polar(ap - 0.4, sl.a1 - 2.5));
        return polyD(pts);
      },
      hatch: () => hatchLines(7.5, 1) + hatchLines(7.5, -1),
      glyph: (i) => HABITS[i % HABITS.length],
      node(g, sl, ctx) {
        const { H, G } = ctx;
        const [nx, ny] = H.polar(G.rin, sl.mid);
        H.s('circle', { cx: f1(nx), cy: f1(ny), r: 8, class: 's2-node-halo' }, g);
        H.s('path', { d: rhombus(H, G.rin, sl.mid, 4.2, 2.8), class: 's2-node' }, g);
      },
      openFx(fx, ctx) {
        const { H, G, ccw } = ctx;
        const rimPts = ctx.verts.map((a) => H.polar(G.rv, a));
        const d = polyD(ccw ? rimPts.reverse() : rimPts, true);
        H.s('path', { d, class: 's2-shimmer s2-shimmer-halo', pathLength: 1 }, fx);
        H.s('path', { d, class: 's2-shimmer', pathLength: 1 }, fx);
      },
      // Refraction: the facet clears, a silver ray shoots straight into the hub, splits into a burst of rays,
      // and a faceted gem turns into place with a pop.
      apply(env) {
        const { sl, H, G, under, below, above } = env;
        const s = H.s;
        const crownFlash = s('path', { d: C_.bandSeg(sl, { H, G, m: env.m }), class: 's2-fx-flash' }, under);
        const [x0, y0] = H.polar(G.glyphR - 4, sl.mid);
        const tr = track([
          [x0, y0],
          [C, C + G.sealY],
        ]);
        const halo = s('path', { d: tr.d, class: 's2-fx-halo', pathLength: 1 }, under);
        const core = s('path', { d: tr.d, class: 's2-fx-core', pathLength: 1 }, under);
        const star = s(
          'path',
          { d: 'M0 -11L1.6 -1.6L11 0L1.6 1.6L0 11L-1.6 1.6L-11 0L-1.6 -1.6Z', class: 's2-fx-star' },
          under,
        );
        const starHalo = s('circle', { r: 9, class: 's2-fx-head-halo' }, under);
        under.insertBefore(starHalo, star);
        const glow = s('circle', { cx: C, cy: C, r: G.hub, class: 's2-fx-flare' }, below);
        const rays = [];
        for (let k = 0; k < 12; k++) {
          const a = k * 30 + 15;
          const [ax, ay] = polarAt(C, C + G.sealY, G.sealR * 0.8, a);
          const [bx, by] = polarAt(C, C + G.sealY, G.sealR + (k % 2 ? 22 : 40), a);
          rays.push(
            s(
              'path',
              {
                d: `M${f2(ax)} ${f2(ay)}L${f2(bx)} ${f2(by)}`,
                class: 's2-fx-ray' + (k % 2 ? ' is-short' : ''),
                pathLength: 1,
              },
              k % 2 ? below : above,
            ),
          );
        }
        const T1 = 210;
        return (t) => {
          op(crownFlash, 1 - ease.outCubic(seg(t, 10, 240)));
          const e = ease.inOutCubic(seg(t, 0, T1));
          const fade = 1 - seg(t, T1, T1 + 130);
          dash(core, 0, e);
          dash(halo, Math.max(0, e - 0.55), e);
          core.style.strokeWidth = f2(lerp(2.2, 0.6, seg(t, T1, T1 + 130)));
          op(core, fade);
          op(halo, fade * 0.9);
          const [hx, hy] = tr.at(e);
          const [rx, ry] = tr.at(e - 0.35);
          env.reveal = t < T1 ? Math.hypot(rx - C, ry - C) : 0;
          const starOp = 1 - seg(t, T1, T1 + 60);
          star.setAttribute(
            'transform',
            `translate(${f2(hx)} ${f2(hy)}) rotate(${f1(e * 90)}) scale(${f3(0.7 + 0.5 * e)})`,
          );
          starHalo.setAttribute('cx', f2(hx));
          starHalo.setAttribute('cy', f2(hy));
          op(star, starOp);
          op(starHalo, starOp);
          op(glow, bell(t, 190, 250, 480));
          const ru = seg(t, T1, T1 + 170);
          rays.forEach((r) => {
            dash(r, 0.15 * ru, ease.outCubic(ru));
            op(r, ru > 0 ? 1 - seg(t, T1 + 90, T1 + 230) : 0);
          });
          const u = seg(t, 200, 470);
          const rot = lerp(-45, 0, ease.outCubic(u));
          env.seal.setAttribute(
            'transform',
            `translate(${C} ${C + G.sealY}) rotate(${f1(rot)}) scale(${f3(pop(u, 1.14, 0.97))})`,
          );
          op(env.seal, seg(t, 200, 240));
        };
      },
    };

    // ------------------------------------------------------------------ define the three variants
    const fontsA = {
      brand: "'Alegreya Sans'",
      display: "'Cormorant Garamond Variable'",
      load: ["'Alegreya Sans'", "'Cormorant Garamond Variable'"],
      credits: [CREDIT('Alegreya Sans'), CREDIT('Cormorant Garamond')],
    };
    const fontsB = {
      brand: "'Onest Variable'",
      display: "'Vollkorn Variable'",
      load: ["'Onest Variable'", "'Vollkorn Variable'"],
      credits: [CREDIT('Onest'), CREDIT('Vollkorn')],
    };
    const fontsC = {
      brand: "'Ysabeau Office Variable'",
      display: "'Ysabeau Variable'",
      load: ["'Ysabeau Office Variable'", "'Ysabeau Variable'"],
      credits: [CREDIT('Ysabeau Office'), CREDIT('Ysabeau')],
    };
    const EXTRA_PAIRS = [
      ['wheel-sub', 'wheel-slice', 'text'],
      ['wheel-sub', 'wheel-slice-hover', 'text'],
      ['wheel-sub-selected', 'wheel-slice-selected', 'text'],
      ['s2-hub-text', 's2-hub', 'text'],
      ['s2-hub-sub', 's2-hub', 'text'],
      ['s2-seal-ink', 's2-seal', 'text'],
      ['s2-on-primary', 's2-primary', 'text'],
      ['accent', 'surface', 'text'],
      ['text-muted', 'surface-2', 'text'],
      ['success-text', 'surface', 'text'],
      ['warning-text', 'surface', 'text'],
      ['wheel-ink-hi', 'wheel-face', 'ui'],
    ];

    Board.define(
      Object.assign({}, FAMILY, {
        id: 'simya-a',
        fonts: fontsA,
        motion: A.motion,
        palette: {
          light: {
            bg: '#f2f5fb',
            surface: '#ffffff',
            'surface-2': '#e9eef8',
            border: '#d3dbee',
            'border-strong': '#7586b8',
            text: '#0e1c4c',
            'text-muted': '#4a5677',
            accent: '#1f3a9e',
            'on-accent': '#ffffff',
            focus: '#1f3a9e',
            success: '#18805a',
            'on-success': '#ffffff',
            'success-text': '#136a4a',
            warning: '#b8661a',
            'warning-text': '#96500e',
            danger: '#b3261e',
            desk: 'radial-gradient(120% 95% at 30% 8%, #ffffff 0%, #e2e9f8 48%, #c2cee9 100%)',
            'wheel-face': '#fdfdff',
            'wheel-slice': '#fdfdff',
            'wheel-slice-hover': '#e6ecfb',
            'wheel-slice-selected': '#ddb55c',
            'wheel-text': '#132770',
            'wheel-text-selected': '#0c1a52',
            'wheel-sub': '#4a5683',
            'wheel-sub-selected': '#3a2c08',
            'wheel-line': '#2b46a6',
            'wheel-ink-hi': '#9a700e',
            'wheel-glow': '#c99216',
            'wheel-halo': 'rgba(226, 172, 52, 0.36)',
            'wheel-flash': '#fff3cc',
            'wheel-shadow': 'rgba(20, 42, 120, 0.24)',
            's2-face-hi': '#ffffff',
            's2-face-lo': '#e9eef9',
            's2-face-edge': 'rgba(176, 138, 46, 0.6)',
            's2-hub': '#1b3286',
            's2-hub-text': '#f4dc96',
            's2-hub-sub': '#cfd9f6',
            's2-hub-line': '#dcb862',
            's2-band': '#1b3184',
            's2-band-ink': '#e6c470',
            's2-gold': '#d9ad4c',
            's2-gold-hi': '#f6dd96',
            's2-gold-deep': '#8a6410',
            's2-gold-line': 'rgba(176, 138, 46, 0.5)',
            's2-seal': '#e4bf68',
            's2-seal-ink': '#13235f',
            's2-fx-core': '#fffaf0',
            's2-primary': '#1f3a9e',
            's2-on-primary': '#ffffff',
            's2-pill': 'rgba(230, 196, 112, 0.16)',
            's2-band-tint': 'rgba(246, 220, 152, 0.18)',
            's2-tip-border': 'rgba(176, 138, 46, 0.5)',
            's2-rule': 'rgba(176, 138, 46, 0.6)',
            's2-bar': 'linear-gradient(90deg, #1f3a9e, #3557c4 62%, #d9ad4c)',
            's2-primary-bg': 'linear-gradient(#2747b4, #1c3392)',
            's2-mica': 'rgba(255, 255, 255, 0.85)',
            's2-drop-glow': 'rgba(31, 58, 158, 0.08)',
            's2-vein': '#a7b6db',
            's2-dust-opacity': '0.5',
            's2-vein-opacity': '0.8',
            's2-line-opacity': '0.32',
            's2-hatch-opacity': '0.3',
            's2-ring-opacity': '0.85',
          },
          dark: {
            bg: '#09122d',
            surface: '#101c40',
            'surface-2': '#17264f',
            border: '#26366a',
            'border-strong': '#6877a8',
            text: '#f3ecdb',
            'text-muted': '#bdb7a5',
            accent: '#e5c06a',
            'on-accent': '#0a1330',
            focus: '#f2d488',
            success: '#5cc8a1',
            'on-success': '#04261b',
            'success-text': '#77d6b2',
            warning: '#f09a62',
            'warning-text': '#f5ad7c',
            danger: '#ff7b7b',
            desk: 'radial-gradient(120% 95% at 28% 12%, #203476 0%, #0e1a44 52%, #060d27 100%)',
            'wheel-face': '#122361',
            'wheel-slice': '#122361',
            'wheel-slice-hover': '#1f3680',
            'wheel-slice-selected': '#e2bb62',
            'wheel-text': '#f6ead0',
            'wheel-text-selected': '#0b1640',
            'wheel-sub': '#cdbf98',
            'wheel-sub-selected': '#3a2d0c',
            'wheel-line': '#c9a352',
            'wheel-ink-hi': '#f6dc98',
            'wheel-glow': '#fff1c8',
            'wheel-halo': 'rgba(246, 214, 140, 0.34)',
            'wheel-flash': '#fff1c4',
            'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
            's2-face-hi': '#1f388a',
            's2-face-lo': '#0a1640',
            's2-face-edge': 'rgba(228, 191, 108, 0.42)',
            's2-hub': '#0b173f',
            's2-hub-text': '#f6ead0',
            's2-hub-sub': '#cdbf98',
            's2-hub-line': '#d9b25e',
            's2-band': '#0c1a4a',
            's2-band-ink': '#d9b25e',
            's2-gold': '#e2bb62',
            's2-gold-hi': '#f6dc98',
            's2-gold-deep': '#b98d36',
            's2-gold-line': 'rgba(228, 191, 108, 0.3)',
            's2-seal': '#e4bf68',
            's2-seal-ink': '#13235f',
            's2-fx-core': '#ffffff',
            's2-primary': '#e5c06a',
            's2-on-primary': '#0a1330',
            's2-pill': 'rgba(228, 191, 108, 0.12)',
            's2-band-tint': 'rgba(246, 220, 152, 0.12)',
            's2-tip-border': 'rgba(228, 191, 108, 0.32)',
            's2-rule': 'rgba(228, 191, 108, 0.45)',
            's2-bar': 'linear-gradient(90deg, #b98d36, #e5c06a 70%, #f6dc98)',
            's2-primary-bg': 'linear-gradient(#efce80, #ddb35b)',
            's2-mica': 'rgba(228, 191, 108, 0.07)',
            's2-drop-glow': 'rgba(228, 191, 108, 0.1)',
            's2-vein': '#2a4598',
            's2-dust-opacity': '0.6',
            's2-vein-opacity': '0',
            's2-line-opacity': '0.5',
            's2-hatch-opacity': '0.22',
            's2-ring-opacity': '1',
          },
        },
        contrast: Board.DEFAULT_PAIRS.concat(EXTRA_PAIRS, [['s2-band-ink', 's2-band', 'ui']]),
        defs: sharedDefs(
          'simya-a',
          `
      <linearGradient id="simya-a-sel" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fbeab0"/><stop offset="0.28" stop-color="#e8c46c"/><stop offset="0.5" stop-color="#d6a84a"/>
        <stop offset="0.7" stop-color="#f3d78e"/><stop offset="1" stop-color="#cf9d42"/>
      </linearGradient>
      <radialGradient id="simya-a-leafr" cx="0.38" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#fdf0c2"/><stop offset="0.45" stop-color="#ebc876"/><stop offset="0.8" stop-color="#d4a548"/><stop offset="1" stop-color="#b8862e"/>
      </radialGradient>
      <linearGradient id="simya-a-bandgloss" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.2"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.07"/>
      </linearGradient>
      <pattern id="simya-a-seams" patternUnits="userSpaceOnUse" width="21" height="21" patternTransform="rotate(9)">
        <path d="M0 0.3H21M0.3 0V21" stroke="#7a560c" stroke-opacity="0.26" stroke-width="0.6" fill="none"/>
      </pattern>`,
        ),
        wheel: makeWheel(A),
        sounds: {
          open(ac, out, t, X) {
            X.burst(ac, out, t, { type: 'bandpass', f: 2200, f2: 6400, q: 2.4, dur: 0.16, gain: 0.11, a: 0.03 });
            X.tone(ac, out, t + 0.02, { f: 1568, dur: 0.24, gain: 0.03, a: 0.012 });
            X.tone(ac, out, t + 0.06, { f: 2349, dur: 0.2, gain: 0.022, a: 0.012 });
          },
          tick(ac, out, t, X) {
            X.tone(ac, out, t, { type: 'triangle', f: 3520, f2: 3000, dur: 0.03, gain: 0.06, a: 0.001 });
            X.tone(ac, out, t, { f: 5274, dur: 0.018, gain: 0.02, a: 0.001 });
          },
          success(ac, out, t, X) {
            // A small struck bell: each note has an inharmonic partial at 2.76 times its pitch.
            X.tone(ac, out, t, { f: 880, dur: 0.5, gain: 0.1, a: 0.004 });
            X.tone(ac, out, t, { f: 880 * 2.76, dur: 0.2, gain: 0.025, a: 0.002 });
            X.tone(ac, out, t + 0.11, { f: 1318.5, dur: 0.62, gain: 0.085, a: 0.004 });
            X.tone(ac, out, t + 0.11, { f: 1318.5 * 2.76, dur: 0.24, gain: 0.02, a: 0.002 });
          },
        },
      }),
    );

    Board.define(
      Object.assign({}, FAMILY, {
        id: 'simya-b',
        fonts: fontsB,
        motion: B.motion,
        palette: {
          light: {
            bg: '#edf6f1',
            surface: '#fbfefc',
            'surface-2': '#e1efe8',
            border: '#cbe0d6',
            'border-strong': '#6b998c',
            text: '#0c2f2c',
            'text-muted': '#45655f',
            accent: '#ad4f27',
            'on-accent': '#ffffff',
            focus: '#0f5e57',
            success: '#1b7d5d',
            'on-success': '#ffffff',
            'success-text': '#15684d',
            warning: '#b8661a',
            'warning-text': '#934d0f',
            danger: '#b3261e',
            desk: 'radial-gradient(120% 95% at 30% 8%, #f7fcfa 0%, #d5ebe1 50%, #b2d6c7 100%)',
            'wheel-face': '#f2faf6',
            'wheel-slice': '#f2faf6',
            'wheel-slice-hover': '#dbefe6',
            'wheel-slice-selected': '#e59a6b',
            'wheel-text': '#0d3a36',
            'wheel-text-selected': '#0b2c29',
            'wheel-sub': '#46675f',
            'wheel-sub-selected': '#3b1a08',
            'wheel-line': '#2a7466',
            'wheel-ink-hi': '#b4532a',
            'wheel-glow': '#d0682f',
            'wheel-halo': 'rgba(222, 120, 60, 0.3)',
            'wheel-flash': '#fff0e4',
            'wheel-shadow': 'rgba(10, 70, 60, 0.24)',
            's2-face-hi': '#fbfffd',
            's2-face-lo': '#d8ede3',
            's2-face-edge': 'rgba(176, 82, 42, 0.45)',
            's2-hub': '#f7fcf9',
            's2-hub-text': '#0d3a36',
            's2-hub-sub': '#46675f',
            's2-hub-line': '#b4592c',
            's2-band-ink': '#0f3b36',
            's2-collar-edge': '#6a2c10',
            's2-copper': '#c8693a',
            's2-copper-hi': '#f6c2a0',
            's2-copper-deep': '#8a3f1c',
            's2-copper-line': 'rgba(176, 82, 42, 0.42)',
            's2-seal': '#0e423c',
            's2-seal-ink': '#ffe0c8',
            's2-fx-core': '#fff4ea',
            's2-patina': '#8ccab6',
            's2-crackle': '#7fb5a3',
            's2-primary': '#ad4f27',
            's2-on-primary': '#ffffff',
            's2-pill': 'rgba(180, 89, 44, 0.1)',
            's2-band-tint': 'rgba(255, 255, 255, 0.34)',
            's2-tip-border': 'rgba(176, 82, 42, 0.35)',
            's2-rule': 'rgba(176, 82, 42, 0.5)',
            's2-bar': 'linear-gradient(90deg, #9a451f, #d0723f 65%, #f2ad80)',
            's2-primary-bg': 'linear-gradient(#b5552a, #9a451f)',
            's2-mica': 'rgba(255, 255, 255, 0.8)',
            's2-drop-glow': 'rgba(200, 105, 58, 0.1)',
            's2-patina-opacity': '0.32',
            's2-crackle-opacity': '0.75',
            's2-line-opacity': '0.4',
            's2-hatch-opacity': '0.5',
            's2-ring-opacity': '0.8',
          },
          dark: {
            bg: '#09211f',
            surface: '#0e2c29',
            'surface-2': '#143834',
            border: '#214f49',
            'border-strong': '#5d8e85',
            text: '#e8f5f0',
            'text-muted': '#a6c4bc',
            accent: '#f0a273',
            'on-accent': '#0a2220',
            focus: '#f6b98f',
            success: '#6fd0a5',
            'on-success': '#06281d',
            'success-text': '#86dbb5',
            warning: '#f2a65e',
            'warning-text': '#f5b77c',
            danger: '#ff8a80',
            desk: 'radial-gradient(120% 95% at 28% 12%, #22625a 0%, #0e3531 52%, #061b19 100%)',
            'wheel-face': '#123f39',
            'wheel-slice': '#123f39',
            'wheel-slice-hover': '#1b544b',
            'wheel-slice-selected': '#ec9e6d',
            'wheel-text': '#edf8f3',
            'wheel-text-selected': '#0a2622',
            'wheel-sub': '#acd2c6',
            'wheel-sub-selected': '#3b1a08',
            'wheel-line': '#e8956a',
            'wheel-ink-hi': '#ffc9a4',
            'wheel-glow': '#ffd9bd',
            'wheel-halo': 'rgba(255, 168, 116, 0.34)',
            'wheel-flash': '#ffe2cc',
            'wheel-shadow': 'rgba(0, 0, 0, 0.5)',
            's2-face-hi': '#22625a',
            's2-face-lo': '#0a2a26',
            's2-face-edge': 'rgba(240, 162, 115, 0.4)',
            's2-hub': '#0b2b27',
            's2-hub-text': '#edf8f3',
            's2-hub-sub': '#acd2c6',
            's2-hub-line': '#e8956a',
            's2-band-ink': '#2a1206',
            's2-collar-edge': '#2a1206',
            's2-copper': '#e08a57',
            's2-copper-hi': '#ffd2b2',
            's2-copper-deep': '#a9522b',
            's2-copper-line': 'rgba(240, 162, 115, 0.32)',
            's2-seal': '#0e423c',
            's2-seal-ink': '#ffe0c8',
            's2-fx-core': '#fffaf5',
            's2-patina': '#3f9c88',
            's2-crackle': '#3f9c88',
            's2-primary': '#f0a273',
            's2-on-primary': '#0a2220',
            's2-pill': 'rgba(232, 149, 106, 0.14)',
            's2-band-tint': 'rgba(255, 255, 255, 0.28)',
            's2-tip-border': 'rgba(240, 162, 115, 0.3)',
            's2-rule': 'rgba(240, 162, 115, 0.45)',
            's2-bar': 'linear-gradient(90deg, #b8602f, #f0a273 70%, #ffd2b2)',
            's2-primary-bg': 'linear-gradient(#f6b086, #e8915f)',
            's2-mica': 'rgba(240, 162, 115, 0.07)',
            's2-drop-glow': 'rgba(240, 162, 115, 0.1)',
            's2-patina-opacity': '0.55',
            's2-crackle-opacity': '0',
            's2-line-opacity': '0.5',
            's2-hatch-opacity': '0.4',
            's2-ring-opacity': '0.9',
          },
        },
        contrast: Board.DEFAULT_PAIRS.concat(EXTRA_PAIRS, [['s2-hub-line', 's2-hub', 'ui']]),
        defs: sharedDefs(
          'simya-b',
          `
      <linearGradient id="simya-b-copper" gradientUnits="userSpaceOnUse" x1="40" y1="20" x2="360" y2="380">
        <stop offset="0" stop-color="#f9cfb0"/><stop offset="0.16" stop-color="#e48f5c"/><stop offset="0.32" stop-color="#b85c31"/>
        <stop offset="0.5" stop-color="#f4ac7f"/><stop offset="0.66" stop-color="#c8693a"/><stop offset="0.83" stop-color="#f7c29e"/><stop offset="1" stop-color="#a9522b"/>
      </linearGradient>
      <linearGradient id="simya-b-sel" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fad3b8"/><stop offset="0.3" stop-color="#eba174"/><stop offset="0.52" stop-color="#f7c6a3"/>
        <stop offset="0.78" stop-color="#e4925f"/><stop offset="1" stop-color="#eda577"/>
      </linearGradient>
      <radialGradient id="simya-b-bezel" cx="0.38" cy="0.3" r="0.85">
        <stop offset="0" stop-color="#ffd9bd"/><stop offset="0.5" stop-color="#e58f5a"/><stop offset="0.85" stop-color="#b65a2f"/><stop offset="1" stop-color="#8f3f1d"/>
      </radialGradient>
      <radialGradient id="simya-b-enamel" cx="0.42" cy="0.32" r="0.75">
        <stop offset="0" stop-color="#1f6a5f"/><stop offset="1" stop-color="#0a332e"/>
      </radialGradient>
      <radialGradient id="simya-b-rivet" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#ffe2cc"/><stop offset="0.6" stop-color="#d27a48"/><stop offset="1" stop-color="#8a3f1c"/>
      </radialGradient>`,
        ),
        wheel: makeWheel(B),
        sounds: {
          open(ac, out, t, X) {
            X.tone(ac, out, t, { f: 330, f2: 620, dur: 0.12, gain: 0.07, a: 0.01 });
            X.tone(ac, out, t + 0.03, { f: 1244, dur: 0.22, gain: 0.018, a: 0.01 });
            X.burst(ac, out, t, { type: 'lowpass', f: 900, q: 1, dur: 0.1, gain: 0.05, a: 0.02 });
          },
          tick(ac, out, t, X) {
            X.tone(ac, out, t, { f: 1250, f2: 1900, dur: 0.035, gain: 0.07, a: 0.001 });
          },
          success(ac, out, t, X) {
            // The drop lands, then a warm copper bell (partials at 2 and 3.01 times the pitch).
            X.tone(ac, out, t, { f: 900, f2: 1700, dur: 0.05, gain: 0.07, a: 0.001 });
            X.tone(ac, out, t + 0.09, { f: 659.3, dur: 0.6, gain: 0.1, a: 0.004 });
            X.tone(ac, out, t + 0.09, { f: 659.3 * 2, dur: 0.3, gain: 0.03, a: 0.003 });
            X.tone(ac, out, t + 0.09, { f: 659.3 * 3.01, dur: 0.16, gain: 0.015, a: 0.002 });
          },
        },
      }),
    );

    Board.define(
      Object.assign({}, FAMILY, {
        id: 'simya-c',
        fonts: fontsC,
        motion: C_.motion,
        palette: {
          light: {
            bg: '#f4f1f9',
            surface: '#fdfcff',
            'surface-2': '#ebe5f4',
            border: '#dbd2e9',
            'border-strong': '#8778a3',
            text: '#23113a',
            'text-muted': '#584a6d',
            accent: '#5a2a8a',
            'on-accent': '#ffffff',
            focus: '#5a2a8a',
            success: '#1c7c5a',
            'on-success': '#ffffff',
            'success-text': '#16694b',
            warning: '#b0601a',
            'warning-text': '#914c0f',
            danger: '#b3261e',
            desk: 'radial-gradient(120% 95% at 30% 8%, #fefdff 0%, #e8e1f3 48%, #cbbde2 100%)',
            'wheel-face': '#faf8fd',
            'wheel-slice': '#faf8fd',
            'wheel-slice-hover': '#ebe3f6',
            'wheel-slice-selected': '#47226b',
            'wheel-text': '#2a1543',
            'wheel-text-selected': '#f8f3ff',
            'wheel-sub': '#5b4c70',
            'wheel-sub-selected': '#dccdf0',
            'wheel-line': '#6e6290',
            'wheel-ink-hi': '#6a33a8',
            'wheel-glow': '#7d4ee0',
            'wheel-halo': 'rgba(150, 110, 240, 0.32)',
            'wheel-flash': '#f1eaff',
            'wheel-shadow': 'rgba(60, 30, 100, 0.24)',
            's2-face-hi': '#ffffff',
            's2-face-lo': '#ebe4f5',
            's2-face-edge': 'rgba(90, 60, 140, 0.32)',
            's2-irid-1': 'rgba(255, 184, 222, 0.5)',
            's2-irid-2': 'rgba(196, 182, 255, 0.55)',
            's2-irid-3': 'rgba(166, 214, 255, 0.5)',
            's2-irid-4': 'rgba(180, 246, 222, 0.45)',
            's2-sheen-top': 'rgba(255, 255, 255, 0.7)',
            's2-hub': '#fdfbff',
            's2-hub-text': '#2a1543',
            's2-hub-sub': '#5b4c70',
            's2-hub-line': '#6e6290',
            's2-hub-glow': 'rgba(150, 110, 240, 0.28)',
            's2-sel-0': '#5b2f86',
            's2-sel-1': '#46226b',
            's2-sel-2': '#2e1447',
            's2-band-ink': '#5a4a80',
            's2-seal': '#dcdde8',
            's2-seal-ink': '#2a1640',
            's2-fx-core': '#ffffff',
            's2-silver': '#a9abbe',
            's2-primary': '#4b2378',
            's2-on-primary': '#ffffff',
            's2-pill': 'rgba(110, 98, 144, 0.1)',
            's2-band-tint': 'rgba(106, 51, 168, 0.1)',
            's2-tip-border': 'rgba(110, 98, 144, 0.35)',
            's2-rule': 'rgba(110, 98, 144, 0.5)',
            's2-calm': 'rgba(250, 248, 253, 0.8)',
            's2-bar': 'linear-gradient(90deg, #4b2378, #7d4ee0 65%, #c9b8ff)',
            's2-primary-bg': 'linear-gradient(#5d2f92, #43206c)',
            's2-mica': 'rgba(255, 255, 255, 0.8)',
            's2-drop-glow': 'rgba(150, 110, 240, 0.12)',
            's2-dust-opacity': '0.55',
            's2-line-opacity': '0.42',
            's2-hatch-opacity': '0.32',
            's2-ring-opacity': '0.8',
          },
          dark: {
            bg: '#0b0a11',
            surface: '#14121c',
            'surface-2': '#1c1928',
            border: '#2b273d',
            'border-strong': '#6a6487',
            text: '#eeecf6',
            'text-muted': '#b0abc3',
            accent: '#bba5ff',
            'on-accent': '#140c26',
            focus: '#c9b8ff',
            success: '#62d0a0',
            'on-success': '#04261b',
            'success-text': '#7fdcb4',
            warning: '#f0a35e',
            'warning-text': '#f5b67e',
            danger: '#ff7b86',
            desk: 'radial-gradient(120% 95% at 28% 12%, #2c2346 0%, #121019 52%, #050408 100%)',
            'wheel-face': '#0e0c15',
            'wheel-slice': '#0e0c15',
            'wheel-slice-hover': '#1e1a2d',
            'wheel-slice-selected': '#d9dbe8',
            'wheel-text': '#eeedf6',
            'wheel-text-selected': '#140f20',
            'wheel-sub': '#b4aeca',
            'wheel-sub-selected': '#3d3452',
            'wheel-line': '#b9bccb',
            'wheel-ink-hi': '#ebe6ff',
            'wheel-glow': '#f1ecff',
            'wheel-halo': 'rgba(160, 128, 255, 0.42)',
            'wheel-flash': '#f0ebff',
            'wheel-shadow': 'rgba(0, 0, 0, 0.62)',
            's2-face-hi': '#1f1a30',
            's2-face-lo': '#050408',
            's2-face-edge': 'rgba(200, 190, 255, 0.32)',
            's2-irid-1': 'rgba(150, 110, 255, 0.24)',
            's2-irid-2': 'rgba(80, 140, 255, 0.14)',
            's2-irid-3': 'rgba(200, 120, 255, 0.2)',
            's2-irid-4': 'rgba(90, 200, 255, 0.1)',
            's2-sheen-top': 'rgba(255, 255, 255, 0.07)',
            's2-hub': '#09080e',
            's2-hub-text': '#eeedf6',
            's2-hub-sub': '#b4aeca',
            's2-hub-line': '#b9bccb',
            's2-hub-glow': 'rgba(150, 110, 255, 0.4)',
            's2-sel-0': '#ffffff',
            's2-sel-1': '#d9dbe8',
            's2-sel-2': '#b7b9cc',
            's2-band-ink': '#c9cbd8',
            's2-seal': '#dcdde8',
            's2-seal-ink': '#2a1640',
            's2-fx-core': '#ffffff',
            's2-silver': '#c9cbd8',
            's2-primary': '#dcdeea',
            's2-on-primary': '#140f20',
            's2-pill': 'rgba(185, 188, 203, 0.12)',
            's2-band-tint': 'rgba(200, 185, 255, 0.12)',
            's2-tip-border': 'rgba(185, 188, 203, 0.3)',
            's2-rule': 'rgba(185, 188, 203, 0.45)',
            's2-calm': 'rgba(14, 12, 21, 0.72)',
            's2-bar': 'linear-gradient(90deg, #6b5aa8, #bba5ff 65%, #f1ecff)',
            's2-primary-bg': 'linear-gradient(#ffffff, #c9cbd9)',
            's2-mica': 'rgba(160, 128, 255, 0.07)',
            's2-drop-glow': 'rgba(160, 128, 255, 0.12)',
            's2-dust-opacity': '0.8',
            's2-line-opacity': '0.42',
            's2-hatch-opacity': '0.24',
            's2-ring-opacity': '0.9',
          },
        },
        contrast: Board.DEFAULT_PAIRS.concat(EXTRA_PAIRS, [
          ['wheel-text-selected', 's2-sel-2', 'text'],
          ['wheel-text-selected', 's2-sel-0', 'text'],
        ]),
        defs: sharedDefs(
          'simya-c',
          `
      <radialGradient id="simya-c-gem" cx="0.36" cy="0.28" r="0.85">
        <stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#e3e4ee"/><stop offset="0.8" stop-color="#b9bbcd"/><stop offset="1" stop-color="#9294ab"/>
      </radialGradient>`,
        ),
        wheel: makeWheel(C_),
        sounds: {
          open(ac, out, t, X) {
            X.burst(ac, out, t, { type: 'highpass', f: 5200, q: 0.8, dur: 0.12, gain: 0.05, a: 0.02 });
            X.tone(ac, out, t + 0.01, { type: 'triangle', f: 2637, dur: 0.16, gain: 0.025, a: 0.006 });
            X.tone(ac, out, t + 0.045, { type: 'triangle', f: 3951, dur: 0.14, gain: 0.018, a: 0.006 });
          },
          tick(ac, out, t, X) {
            X.tone(ac, out, t, { f: 4186, dur: 0.016, gain: 0.05, a: 0.001 });
          },
          success(ac, out, t, X) {
            // Three glass notes, a fifth and an octave apart, each with a faint high partial.
            [
              [1568, 0],
              [2349.3, 0.045],
              [3136, 0.09],
            ].forEach(([f, d], k) => {
              X.tone(ac, out, t + d, { f, dur: 0.55 - k * 0.08, gain: 0.07 - k * 0.015, a: 0.003 });
              X.tone(ac, out, t + d, { f: f * 2.4, dur: 0.12, gain: 0.012, a: 0.002 });
            });
          },
        },
      }),
    );
  })();
}
