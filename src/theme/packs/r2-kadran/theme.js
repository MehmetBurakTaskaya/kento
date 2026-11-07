// SPDX-License-Identifier: MIT
// Kadran: the safe dial, in steel. One file, three variants (kadran-a, kadran-b, kadran-c).
// All three keep the anatomy of a combination dial: a bezel with a grip edge, its own graduations and an
// index turns to the slice in use and clicks into place, while the face (slices, chapter ring, hub) never
// moves, so pointing stays precise. Material, light, type and motion differ per variant.
export default function register(Board) {
  (function () {
    'use strict';

    // ---------------------------------------------------------------- shared geometry
    const fx = (n) => String(Math.round(n * 100) / 100);
    const rad = (a) => (a * Math.PI) / 180;
    // Angles in degrees from twelve o'clock, clockwise.
    const pt = (cx, cy, r, a) => `${fx(cx + r * Math.sin(rad(a)))} ${fx(cy - r * Math.cos(rad(a)))}`;
    const ray = (cx, cy, r0, r1, a) => `M${pt(cx, cy, r0, a)}L${pt(cx, cy, r1, a)}`;
    const circ = (cx, cy, r) =>
      `M${fx(cx)} ${fx(cy - r)}a${fx(r)} ${fx(r)} 0 1 1 0 ${fx(2 * r)}a${fx(r)} ${fx(r)} 0 1 1 0 ${fx(-2 * r)}Z`;
    // Regular polygon with n corners on radius r, the first corner at angle a.
    function poly(cx, cy, r, n, a = 0) {
      let d = '';
      for (let k = 0; k < n; k++) d += (k ? 'L' : 'M') + pt(cx, cy, r, a + (k * 360) / n);
      return d + 'Z';
    }
    // Seeded random numbers, so textures look the same on every render.
    function rng(seed) {
      let s = seed;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    }
    function numeral(n, lang, pad) {
      try {
        return new Intl.NumberFormat(lang, { minimumIntegerDigits: pad ? 2 : 1, useGrouping: false }).format(n);
      } catch (e) {
        return pad ? String(n).padStart(2, '0') : String(n);
      }
    }

    // Circular brushing seen under one light from the top left: two bright lobes facing the light
    // and the opposite side, darker lobes between. Returns -1 … 1 for an angle.
    const lobe = (a, light = 315) => Math.cos(rad(2 * (a - light))) * 0.78 + Math.cos(rad(a - light)) * 0.22;

    // ---------------------------------------------------------------- shared wheel parts
    // At rest the bezel parks on the boundary before slice 1, so the index never seems to choose a
    // slice by itself. It turns the shortest way to the slice in use and stays there afterwards. A ring
    // of choices may be turned, so the boundary comes from slice 1 itself, not from twelve o'clock.
    const restAngle = (m) => {
      const first = m.slices[0];
      if (!first) return 0;
      return m.dir === 'rtl' ? first.a1 : first.a0;
    };
    function startBezel(bez, m) {
      bez._k2 = restAngle(m);
      bez.style.transform = `rotate(${fx(bez._k2)}deg)`;
    }
    function turn(root, m, st) {
      const bez = root.querySelector('.k2-bezel');
      if (!bez) return;
      if (bez._k2 == null) bez._k2 = restAngle(m);
      const cur = st.hover ?? st.selected;
      if (cur != null) bez._k2 += ((((m.slices[cur].mid - bez._k2) % 360) + 540) % 360) - 180;
      for (const el of root.querySelectorAll('.k2-turn')) el.style.transform = `rotate(${fx(bez._k2)}deg)`;
      root.classList.toggle('k2-live', cur != null && !m.slices[cur].off);
      root.classList.toggle('k2-muted', cur != null && m.slices[cur].off);
    }

    // Icon, label and sub-label of one slice, kept upright at every angle by H.block. A format of the
    // Convert wheel is its name, engraved large, with its sub-label where it has one. Wider slices (fewer
    // of them) give a label more room before it shrinks or wraps, and a face with a width axis sets a
    // label that would have to shrink (a long German word) in its narrow width instead.
    function content(g, sl, m, H, o) {
      const c = H.s('g', { class: 'k2-content' }, g);
      const fit = H.s('g', {}, c);
      const chord = sl.step >= 180 ? Infinity : 2 * o.r * Math.sin(rad(sl.step / 2)) * 0.8;
      const w = Math.max(o.w, Math.min(o.w * 1.45, chord));
      const size = sl.format ? o.fmt : o.lbl;
      const block = (narrow) =>
        sl.format
          ? H.block(fit, sl, o.r, {
              size,
              subSize: o.subSize,
              gap: 2,
              maxWidth: w,
              minSize: o.fmtMin || 8,
              cls: 'k2-lbl k2-fmt' + narrow,
              subCls: 'k2-sub',
            })
          : H.block(fit, sl, o.r, {
              icon: true,
              iconSize: o.icon,
              size,
              gap: o.gap || 4,
              maxWidth: w,
              minSize: 9,
              cls: 'k2-lbl' + narrow,
              sub: null,
            });
      const parts = block('');
      if (o.narrow && +parts.label.getAttribute('font-size') < size * 0.92) {
        fit.textContent = '';
        block(' k2-narrow');
      }
      return { fit, sl, r: o.r };
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

    // Keeps each slice's content inside its window: clear of the hub collar, the chapter ring and the
    // dividers. A block that does not fit (a long German word, a two-line label in a narrow slice) moves
    // out or in along its slice's centre line, and only when that is not enough is it drawn smaller. All
    // boxes are read first and all moves written after, so the text is laid out once.
    function settle(items, m, H, rIn, rOut) {
      const C = H.C;
      const pad = 3;
      const measured = items.map((it) => ({ ...it, rects: boxes(it.fit) }));
      for (const { fit, sl, r, rects } of measured) {
        if (!rects.length) continue;
        const [px, py] = H.polar(r, sl.mid);
        const ux = Math.sin(rad(sl.mid));
        const uy = -Math.cos(rad(sl.mid));
        const sides =
          m.n > 1
            ? [
                [Math.cos(rad(sl.a0)), Math.sin(rad(sl.a0))],
                [-Math.cos(rad(sl.a1)), -Math.sin(rad(sl.a1))],
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
        fit.setAttribute('transform', `matrix(${fx(best.s)} 0 0 ${fx(best.s)} ${fx(ex)} ${fx(ey)})`);
      }
    }

    // Wheel title, file name and the modifier key on a small cap, centered in the hub. Without a key (a
    // wheel opened from the keyboard shortcut or a menu) the title and the file move down to the middle.
    function hubText(hub, m, H, o) {
      const C = H.C;
      const key = (m.key || '').toLocaleUpperCase('en');
      const dy = key ? 0 : (o.k + o.kh - o.f - o.fs / 2) / 2;
      H.label(hub, C, C - o.t + dy, m.title.toLocaleUpperCase(m.lang), {
        maxWidth: o.w,
        size: o.ts,
        minSize: 7.5,
        cls: 'k2-title',
        maxLines: 1,
      });
      if (m.file)
        H.label(hub, C, C + o.f + dy, m.file, {
          maxWidth: o.w + 4,
          size: o.fs,
          minSize: 8,
          cls: 'k2-file',
          maxLines: 1,
        });
      if (!key) return;
      const y = C + o.k + o.kh / 2;
      const t = H.text(hub, C, fx(y + 0.4), key, { class: 'k2-keytext' });
      const kw = t.getComputedTextLength() + o.pad * 2;
      const cap = H.s(
        'rect',
        { x: fx(C - kw / 2), y: fx(C + o.k), width: fx(kw), height: o.kh, rx: o.kr, class: 'k2-keycap' },
        null,
      );
      hub.insertBefore(cap, t);
    }

    const PAIRS_BASE = [
      ...Board.DEFAULT_PAIRS,
      ['success-text', 'surface', 'text'],
      ['warning-text', 'surface', 'text'],
      ['on-success', 'success', 'ui'],
      ['wheel-text-muted', 'wheel-slice', 'text'],
      ['wheel-text-muted', 'wheel-slice-hover', 'text'],
    ];

    // ================================================================ A: brushed steel
    const RA = { OUT: 197, KN: 192.75, BEZ: 176, CHAP: 151, WIN: 70, HUB: 62, LBL: 110.5, NUM: 163.6 };

    function renderA(root, m, H) {
      const C = H.C;
      const R = RA;
      const u = H.uid('kadran-a');
      const defs = H.s('defs', {}, root);
      defs.innerHTML = `
      <radialGradient id="${u}-enamel" gradientUnits="userSpaceOnUse" cx="150" cy="105" r="300">
        <stop offset="0" style="stop-color:var(--enamel-hi)"/><stop offset="0.6" style="stop-color:var(--wheel-face)"/><stop offset="1" style="stop-color:var(--enamel-lo)"/></radialGradient>
      <linearGradient id="${u}-blue" gradientUnits="userSpaceOnUse" x1="80" y1="50" x2="320" y2="350">
        <stop offset="0" style="stop-color:var(--blue-hi)"/><stop offset="0.5" style="stop-color:var(--wheel-slice-selected)"/><stop offset="1" style="stop-color:var(--blue-lo)"/></linearGradient>
      <linearGradient id="${u}-steel" gradientUnits="userSpaceOnUse" x1="150" y1="132" x2="250" y2="268">
        <stop offset="0" style="stop-color:var(--steel-hi)"/><stop offset="0.45" style="stop-color:var(--steel-mid)"/><stop offset="1" style="stop-color:var(--steel-lo)"/></linearGradient>
      <radialGradient id="${u}-dome" gradientUnits="userSpaceOnUse" cx="184" cy="170" r="78">
        <stop offset="0" stop-color="#fff" style="stop-opacity:var(--dome)"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <pattern id="${u}-hatch" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
        <path d="M0 0V5" style="stroke:var(--wheel-tick)" stroke-opacity="0.3" stroke-width="0.8"/></pattern>`;

      // White enamel face (smoked in dark mode). The steel bezel under it is a CSS layer (.wheel::before).
      const face = H.s('g', { class: 'k2-face' }, root);
      H.s('circle', { cx: C, cy: C, r: R.BEZ, fill: `url(#${u}-enamel)` }, face);

      const items = [];
      for (const sl of m.slices) {
        const g = H.slice(root, sl, m);
        H.s('path', { d: H.sector(R.WIN, R.OUT, sl.a0, sl.a1), class: 'k2-hit' }, g);
        H.s('path', { d: H.sector(R.CHAP, R.BEZ, sl.a0, sl.a1), class: 'k2-cell' }, g);
        H.s('path', { d: H.sector(R.WIN, R.CHAP, sl.a0, sl.a1), class: 'k2-win' }, g);
        H.s('path', { d: H.sector(R.WIN - 3, R.CHAP, sl.a0, sl.a1), class: 'k2-inlay', fill: `url(#${u}-blue)` }, g);
        H.s('path', { d: H.arc(R.CHAP - 1.7, sl.a0 + 0.9, sl.a1 - 0.9), class: 'k2-keyline' }, g);
        if (sl.off)
          H.s('path', { d: H.sector(R.WIN, R.BEZ, sl.a0, sl.a1), class: 'k2-hatch', fill: `url(#${u}-hatch)` }, g);
        const [nx, ny] = H.polar(R.NUM, sl.mid);
        H.s('circle', { cx: fx(nx), cy: fx(ny), r: 9, class: 'k2-lock' }, g);
        H.s('circle', { cx: fx(nx), cy: fx(ny), r: 8.6, class: 'k2-disc' }, g);
        H.text(g, fx(nx), fx(ny + 0.4), numeral(sl.i + 1, m.lang), { class: 'k2-num' });
        items.push(content(g, sl, m, H, { r: R.LBL, fmt: 21, subSize: 11, w: 76, icon: 23, lbl: 13, narrow: true }));
        // More choices: the steel wheel's arrowhead, just inside the chapter ring.
        H.ringMark(g, sl, m, { r: R.CHAP - 4.5, size: 7.5, cls: 'k2-ring-mark' });
      }
      settle(items, m, H, R.WIN, R.CHAP);

      // Fixed graduations: hairlines through the windows, a strong tick at each slice boundary and
      // fine ticks between them, leaving room for the numeral.
      let div = '',
        maj = '',
        min = '';
      for (const sl of m.slices) {
        div += ray(C, C, R.WIN, R.CHAP, sl.a0);
        maj += ray(C, C, R.CHAP, R.BEZ, sl.a0);
        for (let k = 1; k < 10; k++)
          if (k < 4 || k > 6) min += ray(C, C, R.BEZ - 5.5, R.BEZ, sl.a0 + (k * sl.step) / 10);
      }
      const grad = H.s('g', { class: 'k2-grad' }, root);
      H.s('path', { d: div, class: 'k2-div' }, grad);
      H.s('circle', { cx: C, cy: C, r: R.CHAP, class: 'k2-chap' }, grad);
      H.s('path', { d: min, class: 'k2-minor' }, grad);
      H.s('path', { d: maj, class: 'k2-major' }, grad);
      const under = H.s('g', { class: 'k2-fixed' }, root);
      H.s('circle', { cx: C, cy: C, r: R.BEZ - 1.5, class: 'k2-face-shade' }, under);
      H.s('circle', { cx: C, cy: C, r: R.BEZ + 0.5, class: 'k2-edge-in' }, under);

      // The turning bezel: a 100-step scale engraved on its flat, the straight knurl and the blued index.
      const spin = H.s('g', { class: 'k2-spin' }, root);
      const bez = H.s('g', { class: 'k2-bezel k2-turn' }, spin);
      startBezel(bez, m);
      const snap = H.s('g', { class: 'k2-snap' }, bez);
      let t1 = '',
        t10 = '';
      for (let k = 1; k < 100; k++) {
        const a = k * 3.6;
        if (k % 10 === 0) t10 += ray(C, C, R.BEZ + 1.5, 186.2, a);
        else if (k % 5 === 0) t10 += ray(C, C, R.BEZ + 1.5, 183.8, a);
        else t1 += ray(C, C, R.BEZ + 1.5, 181, a);
      }
      H.s('path', { d: t1, class: 'k2-bt1' }, snap);
      H.s('path', { d: t10, class: 'k2-bt10' }, snap);
      const per = (2 * Math.PI * R.KN) / 180;
      H.s(
        'circle',
        { cx: C, cy: C, r: R.KN, class: 'k2-knurl', 'stroke-dasharray': `${fx(per * 0.42)} ${fx(per * 0.58)}` },
        snap,
      );
      H.s(
        'circle',
        {
          cx: C,
          cy: C,
          r: R.KN,
          class: 'k2-knurl-hi',
          'stroke-dasharray': `${fx(per * 0.16)} ${fx(per * 0.84)}`,
          'stroke-dashoffset': fx(-per * 0.47),
        },
        snap,
      );
      const idx = H.s('g', { class: 'k2-index' }, snap);
      H.s(
        'path',
        {
          d: `M${C - 4.8} ${C - 188}H${C + 4.8}V${C - 181.4}L${C} ${C - 173.4}L${C - 4.8} ${C - 181.4}Z`,
          class: 'k2-pointer',
        },
        idx,
      );
      H.s(
        'path',
        { d: `M${C - 3.3} ${C - 186.7}H${C - 0.5}V${C - 175.8}L${C - 3.3} ${C - 181.1}Z`, class: 'k2-pointer-hi' },
        idx,
      );

      const over = H.s('g', { class: 'k2-fixed' }, root);
      H.s('circle', { cx: C, cy: C, r: 188, class: 'k2-groove' }, over);
      H.s('circle', { cx: C, cy: C, r: R.OUT - 0.5, class: 'k2-edge-out' }, over);
      // A glint that runs once round the steel when a slice is applied.
      const glint = H.s('g', { class: 'k2-glint' }, root);
      for (const [w, o] of [
        [24, 0.16],
        [12, 0.3],
        [4.5, 0.6],
      ])
        H.s('path', { d: H.sector(R.BEZ + 0.6, R.OUT - 0.6, -w, w), fill: '#fff', 'fill-opacity': o }, glint);

      // Hub: a white enamel cap in a polished steel collar.
      const hub = H.s('g', { class: 'k2-hub' }, root);
      H.s('path', { d: H.ring(R.HUB, R.WIN), fill: `url(#${u}-steel)` }, hub);
      H.s('circle', { cx: C, cy: C, r: R.WIN - 0.4, class: 'k2-hub-edge' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.HUB, class: 'k2-hub-face' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.HUB, fill: `url(#${u}-dome)` }, hub);
      H.s('circle', { cx: C, cy: C, r: R.HUB + 0.4, class: 'k2-hub-edge' }, hub);
      hubText(hub, m, H, { t: 17, ts: 11.5, f: 1.5, fs: 11, w: 94, k: 15.5, kh: 15, pad: 6, kr: 2.5 });
    }

    // ================================================================ B: brutalist
    const RB = { OUT: 197, BEZ: 168, CHAP: 140, WIN: 60, HUB: 51, LBL: 100, NUM: 154 };
    const FACETS = 16;
    const CAST = [7, 9]; // the hard shadow's offset

    function pores(size, seed, count) {
      const r = rng(seed);
      let s = '';
      for (let k = 0; k < count; k++) {
        const x = fx(r() * size);
        const y = fx(r() * size);
        const rr = fx(0.35 + r() * r() * 1.3);
        s += `<circle cx="${x}" cy="${y}" r="${rr}" class="${r() < 0.28 ? 'k2-pore-lt' : 'k2-pore'}"/>`;
      }
      return s;
    }

    function renderB(root, m, H) {
      const C = H.C;
      const R = RB;
      const u = H.uid('kadran-b');
      const defs = H.s('defs', {}, root);
      defs.innerHTML = `
      <pattern id="${u}-pores" patternUnits="userSpaceOnUse" width="70" height="70">${pores(70, 11, 54)}</pattern>
      <pattern id="${u}-hatch" patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(45)">
        <rect width="3.4" height="9" style="fill:var(--wheel-line)" fill-opacity="0.2"/></pattern>`;
      const bolts = [45, 135, 225, 315];

      // The hard shadow: the faceted outline, offset, turning with the bezel. Bolt shadows join it.
      const cast = H.s('g', { class: 'k2-cast' }, root);
      const castSpin = H.s('g', { class: 'k2-spin k2-spin-cast' }, cast);
      H.s('path', { d: poly(C + CAST[0], C + CAST[1], R.OUT, FACETS), class: 'k2-shadow k2-turn' }, castSpin);
      for (const a of bolts) {
        const g = H.s('g', { transform: `translate(${CAST[0]} ${CAST[1]}) rotate(${a} ${C} ${C})` }, cast);
        H.s(
          'rect',
          { x: C - 11, y: C - 191, width: 22, height: 23, class: 'k2-bolt-sh' },
          H.s('g', { class: 'k2-throw' }, g),
        );
      }

      // Everything that moves when the dial is slammed shut.
      const body = H.s('g', { class: 'k2-body' }, root);
      const boltG = H.s('g', { class: 'k2-bolts' }, body);
      for (const a of bolts) {
        const g = H.s('g', { class: 'k2-throw' }, H.s('g', { transform: `rotate(${a} ${C} ${C})` }, boltG));
        H.s('rect', { x: C - 11, y: C - 191, width: 22, height: 23, class: 'k2-bolt' }, g);
        H.s('path', { d: `M${C - 11} ${C - 185}H${C + 11}M${C - 11} ${C - 180}H${C + 11}`, class: 'k2-bolt-line' }, g);
      }

      // Raw concrete face (cast iron in dark mode).
      const face = H.s('g', { class: 'k2-face' }, body);
      H.s('circle', { cx: C, cy: C, r: R.BEZ, class: 'k2-concrete' }, face);
      H.s('circle', { cx: C, cy: C, r: R.BEZ, fill: `url(#${u}-pores)` }, face);

      const items = [];
      for (const sl of m.slices) {
        const g = H.slice(body, sl, m);
        H.s('path', { d: H.sector(R.WIN, R.OUT, sl.a0, sl.a1), class: 'k2-hit' }, g);
        H.s('path', { d: H.sector(R.CHAP, R.BEZ, sl.a0, sl.a1), class: 'k2-cell' }, g);
        H.s('path', { d: H.sector(R.WIN, R.CHAP, sl.a0, sl.a1), class: 'k2-win' }, g);
        if (sl.off)
          H.s('path', { d: H.sector(R.WIN, R.BEZ, sl.a0, sl.a1), class: 'k2-hatch', fill: `url(#${u}-hatch)` }, g);
        const [nx, ny] = H.polar(R.NUM, sl.mid);
        H.text(g, fx(nx), fx(ny + 0.5), numeral(sl.i + 1, m.lang, true), { class: 'k2-num' });
        items.push(
          content(g, sl, m, H, { r: R.LBL, fmt: 19, subSize: 10, w: 70, icon: 24, lbl: 12, gap: 5, narrow: true }),
        );
        // More choices: a cast block arrow, just inside the chapter ring.
        H.ringMark(g, sl, m, {
          r: R.CHAP - 4.5,
          size: 10.5,
          shape: (l) =>
            `M0 0L${fx(l * 0.6)} ${fx(l * 0.52)}H${fx(l * 0.25)}V${fx(l)}H${fx(-l * 0.25)}V${fx(l * 0.52)}H${fx(-l * 0.6)}Z`,
          cls: 'k2-ring-mark',
        });
      }
      settle(items, m, H, R.WIN, R.CHAP);

      // Thick cast dividers, a heavy chapter line and square ticks.
      let div = '',
        min = '';
      for (const sl of m.slices) {
        div += ray(C, C, R.WIN, R.BEZ, sl.a0);
        for (const k of [1, 2, 6, 7]) min += ray(C, C, R.BEZ - 6, R.BEZ, sl.a0 + (k * sl.step) / 8);
      }
      const grad = H.s('g', { class: 'k2-grad' }, body);
      H.s('path', { d: min, class: 'k2-minor' }, grad);
      H.s('path', { d: div, class: 'k2-div' }, grad);
      H.s('circle', { cx: C, cy: C, r: R.CHAP, class: 'k2-chap' }, grad);

      // The faceted iron bezel with milled grip slots and the hi-vis index block.
      const spin = H.s('g', { class: 'k2-spin' }, body);
      const bez = H.s('g', { class: 'k2-bezel k2-turn' }, spin);
      startBezel(bez, m);
      castSpin.querySelector('.k2-turn').style.transform = bez.style.transform;
      const snap = H.s('g', { class: 'k2-snap' }, bez);
      H.s('path', { d: poly(C, C, R.OUT, FACETS) + circ(C, C, R.BEZ), 'fill-rule': 'evenodd', class: 'k2-iron' }, snap);
      let slots = '',
        ticks = '';
      for (let k = 0; k < FACETS; k++) slots += ray(C, C, 177, 189.5, 11.25 + k * 22.5);
      for (let k = 1; k < 48; k++) if (k % 3) ticks += ray(C, C, R.BEZ + 2, R.BEZ + 6.5, k * 7.5);
      H.s('path', { d: slots, class: 'k2-slot' }, snap);
      H.s('path', { d: ticks, class: 'k2-bt' }, snap);
      const idx = H.s('g', { class: 'k2-index' }, snap);
      H.s('rect', { x: C - 6.5, y: C - 192, width: 13, height: 29, class: 'k2-block' }, idx);
      H.s('path', { d: `M${C} ${C - 188}V${C - 167}`, class: 'k2-block-mark' }, idx);

      // Hub: a concrete plug in a heavy black collar.
      const hub = H.s('g', { class: 'k2-hub' }, body);
      H.s('circle', { cx: C, cy: C, r: R.WIN + 0.5, class: 'k2-collar' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.HUB, class: 'k2-concrete' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.HUB, fill: `url(#${u}-pores)` }, hub);
      hubText(hub, m, H, { t: 14.5, ts: 11, f: 1.5, fs: 9.5, w: 80, k: 13, kh: 15, pad: 5, kr: 0 });
    }

    // ================================================================ C: graphite and titanium
    const RC = { OUT: 197, FL: 192.6, BEZ: 172, CHAP: 149, WIN: 67, HUB: 58, LBL: 108, NUM: 160.5 };

    function frost(size, seed, count) {
      const r = rng(seed);
      let s = '';
      for (let k = 0; k < count; k++) {
        s += `<circle cx="${fx(r() * size)}" cy="${fx(r() * size)}" r="${fx(0.3 + r() * 0.55)}" class="${r() < 0.5 ? 'k2-fr-a' : 'k2-fr-b'}"/>`;
      }
      return s;
    }

    function renderC(root, m, H) {
      const C = H.C;
      const R = RC;
      const u = H.uid('kadran-c');
      const defs = H.s('defs', {}, root);
      defs.innerHTML = `
      <pattern id="${u}-frost" patternUnits="userSpaceOnUse" width="48" height="48">${frost(48, 5, 70)}</pattern>
      <radialGradient id="${u}-edge" gradientUnits="userSpaceOnUse" cx="${C}" cy="${C}" r="${R.CHAP}">
        <stop offset="0.45" style="stop-color:var(--lume)" stop-opacity="0"/><stop offset="0.9" style="stop-color:var(--lume);stop-opacity:var(--edge-glow)"/><stop offset="1" style="stop-color:var(--lume);stop-opacity:var(--edge-glow-max)"/></radialGradient>
      <linearGradient id="${u}-sheen" gradientUnits="userSpaceOnUse" x1="0" y1="${C - R.BEZ}" x2="0" y2="${C + 30}">
        <stop offset="0" stop-color="#fff" style="stop-opacity:var(--sheen)"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <linearGradient id="${u}-ti" gradientUnits="userSpaceOnUse" x1="70" y1="30" x2="330" y2="370">
        <stop offset="0" style="stop-color:var(--ti-hi)"/><stop offset="0.5" style="stop-color:var(--ti-mid)"/><stop offset="1" style="stop-color:var(--ti-lo)"/></linearGradient>
      <radialGradient id="${u}-gun" gradientUnits="userSpaceOnUse" cx="182" cy="172" r="96">
        <stop offset="0" style="stop-color:var(--gun-hi)"/><stop offset="1" style="stop-color:var(--gun-lo)"/></radialGradient>
      <pattern id="${u}-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <circle cx="3" cy="3" r="0.85" style="fill:var(--wheel-tick)" fill-opacity="0.5"/></pattern>`;

      // Frosted glass face: a tint over the blurred desk (.wheel::before), a fine frost grain and a top sheen.
      const face = H.s('g', { class: 'k2-face' }, root);
      H.s('circle', { cx: C, cy: C, r: R.BEZ, class: 'k2-glass' }, face);
      H.s('circle', { cx: C, cy: C, r: R.BEZ, fill: `url(#${u}-frost)`, class: 'k2-frost' }, face);
      H.s('circle', { cx: C, cy: C, r: R.BEZ, fill: `url(#${u}-sheen)` }, face);

      const items = [];
      for (const sl of m.slices) {
        const g = H.slice(root, sl, m);
        H.s('path', { d: H.sector(R.WIN, R.OUT, sl.a0, sl.a1), class: 'k2-hit' }, g);
        H.s('path', { d: H.sector(R.CHAP, R.BEZ, sl.a0, sl.a1), class: 'k2-cell' }, g);
        H.s('path', { d: H.sector(R.WIN, R.CHAP, sl.a0, sl.a1), class: 'k2-win' }, g);
        H.s('path', { d: H.sector(R.WIN, R.CHAP, sl.a0, sl.a1), class: 'k2-edge', fill: `url(#${u}-edge)` }, g);
        H.s('path', { d: H.arc(R.CHAP - 1.6, sl.a0 + 1.2, sl.a1 - 1.2), class: 'k2-keyline' }, g);
        if (sl.off)
          H.s('path', { d: H.sector(R.WIN, R.BEZ, sl.a0, sl.a1), class: 'k2-hatch', fill: `url(#${u}-hatch)` }, g);
        const [nx, ny] = H.polar(R.NUM, sl.mid);
        H.text(g, fx(nx), fx(ny + 0.4), numeral(sl.i + 1, m.lang), { class: 'k2-num' });
        items.push(content(g, sl, m, H, { r: R.LBL, fmt: 21, subSize: 11, w: 76, icon: 23, lbl: 13 }));
        // More choices: a lume-filled arrowhead, just inside the chapter ring.
        H.ringMark(g, sl, m, { r: R.CHAP - 4.5, size: 8.5, cls: 'k2-ring-mark' });
      }
      settle(items, m, H, R.WIN, R.CHAP);

      let div = '',
        min = '';
      for (const sl of m.slices) {
        div += ray(C, C, R.WIN + 2, R.BEZ, sl.a0);
        for (let k = 1; k < 6; k++) if (k !== 3) min += ray(C, C, R.BEZ - 4, R.BEZ, sl.a0 + (k * sl.step) / 6);
      }
      const grad = H.s('g', { class: 'k2-grad' }, root);
      H.s('path', { d: div, class: 'k2-div' }, grad);
      H.s('path', { d: min, class: 'k2-minor' }, grad);
      H.s('circle', { cx: C, cy: C, r: R.CHAP, class: 'k2-chap' }, grad);

      // A light ring that runs out from the hub when a slice is applied.
      H.s('circle', { cx: C, cy: C, r: R.HUB + 4, class: 'k2-wave' }, root);

      // Satin titanium: a base gradient and fixed light lobes; only the engraving and grip turn.
      const ti = H.s('g', { class: 'k2-fixed' }, root);
      H.s('path', { d: H.ring(R.BEZ, R.OUT), fill: `url(#${u}-ti)` }, ti);
      const n = 72;
      let hi = '',
        lo = '';
      for (let k = 0; k < n; k++) {
        const a0 = (k * 360) / n;
        const L = lobe(a0 + 180 / n, 318);
        const d = `<path d="${H.sector(R.BEZ, R.OUT, a0, a0 + 360 / n)}" fill-opacity="${fx(Math.abs(L) * 0.55)}"/>`;
        if (L > 0.04) hi += d;
        else if (L < -0.04) lo += d;
      }
      H.s('g', { class: 'k2-ti-hi', html: hi }, ti);
      H.s('g', { class: 'k2-ti-lo', html: lo }, ti);

      const spin = H.s('g', { class: 'k2-spin' }, root);
      const bez = H.s('g', { class: 'k2-bezel k2-turn' }, spin);
      startBezel(bez, m);
      const snap = H.s('g', { class: 'k2-snap' }, bez);
      let t1 = '',
        t5 = '';
      for (let k = 1; k < 60; k++) {
        if (k % 5 === 0) t5 += ray(C, C, R.BEZ + 2.5, 184, k * 6);
        else t1 += ray(C, C, R.BEZ + 2.5, 180, k * 6);
      }
      H.s('path', { d: t1, class: 'k2-bt1' }, snap);
      H.s('path', { d: t5, class: 'k2-bt5' }, snap);
      // Wide flutes on the grip edge: a shadow and a highlight per flute.
      const per = (2 * Math.PI * R.FL) / 72;
      H.s(
        'circle',
        { cx: C, cy: C, r: R.FL, class: 'k2-flute', 'stroke-dasharray': `${fx(per * 0.3)} ${fx(per * 0.7)}` },
        snap,
      );
      H.s(
        'circle',
        {
          cx: C,
          cy: C,
          r: R.FL,
          class: 'k2-flute-hi',
          'stroke-dasharray': `${fx(per * 0.14)} ${fx(per * 0.86)}`,
          'stroke-dashoffset': fx(-per * 0.32),
        },
        snap,
      );
      // The index: a luminous pip in a small triangle, like the lume on a dive bezel.
      const idx = H.s('g', { class: 'k2-index' }, snap);
      H.s('path', { d: `M${C - 7} ${C - 186.5}H${C + 7}L${C} ${C - 173.6}Z`, class: 'k2-tri' }, idx);
      H.s('circle', { cx: C, cy: C - 181.6, r: 9, class: 'k2-halo' }, idx);
      H.s('circle', { cx: C, cy: C - 182.2, r: 3.4, class: 'k2-lume' }, idx);

      const over = H.s('g', { class: 'k2-fixed' }, root);
      H.s('circle', { cx: C, cy: C, r: 186.5, class: 'k2-groove' }, over);
      H.s('circle', { cx: C, cy: C, r: R.OUT - 0.5, class: 'k2-edge-out' }, over);
      H.s('circle', { cx: C, cy: C, r: R.BEZ + 0.5, class: 'k2-edge-in' }, over);
      const sheen = H.s('g', { class: 'k2-glint' }, root);
      for (const [w, o] of [
        [40, 0.12],
        [20, 0.22],
        [8, 0.4],
      ])
        H.s(
          'path',
          { d: H.sector(R.BEZ + 0.6, R.OUT - 0.6, 318 - w, 318 + w), fill: '#fff', 'fill-opacity': o },
          sheen,
        );

      // Hub: a domed gunmetal cap with a titanium handle ring that turns a quarter when applied.
      const hub = H.s('g', { class: 'k2-hub' }, root);
      H.s('circle', { cx: C, cy: C, r: R.WIN, fill: `url(#${u}-gun)` }, hub);
      H.s('circle', { cx: C, cy: C, r: R.WIN - 0.5, class: 'k2-hub-edge' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.HUB + 4.5, class: 'k2-hub-glow' }, hub);
      const handle = H.s('g', { class: 'k2-handle' }, hub);
      H.s('circle', { cx: C, cy: C, r: R.HUB, class: 'k2-handle-ring' }, handle);
      let notches = '';
      for (const a of [22.5, 112.5, 202.5, 292.5]) notches += ray(C, C, R.HUB - 3.5, R.HUB + 3.5, a);
      H.s('path', { d: notches, class: 'k2-notch' }, handle);
      hubText(hub, m, H, { t: 16, ts: 11.5, f: 1.5, fs: 10.5, w: 84, k: 14, kh: 15, pad: 6, kr: 7.5 });
    }

    // ================================================================ sounds
    // A voice is drawn sample by sample into a short buffer: struck modes (each a sine dying away at its own
    // rate), filtered noise and contact clicks, so it plays from one source node however rich it is. A buffer
    // is drawn once and kept for its sample rate. A voice with variants plays one at random (never the same
    // twice running) a little faster or slower, so a quick sweep never repeats itself.
    // Envelopes start and end at zero and a DC blocker runs last, so nothing clicks and nothing rumbles.
    const TAU = 2 * Math.PI;
    const drawnSounds = new Map();
    let noiseSeed = 1;
    // Seeded white noise from -1 to 1.
    function noise(seed) {
      let x = seed >>> 0 || 1;
      return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2147483648 - 1;
    }
    // Envelopes for hiss(), of t seconds and u (0 to 1) into it: a hit rises in a seconds and falls by 1/e
    // every tau seconds; a swell rises to its peak at p and falls back to zero.
    const hit = (a, tau) => (t) => (t < a ? Math.sin((Math.PI / 2) * (t / a)) ** 2 : Math.exp((a - t) / tau));
    const swell = (p) => (t, u) =>
      (u < p ? Math.sin((Math.PI / 2) * (u / p)) : Math.cos((Math.PI / 2) * ((u - p) / (1 - p)))) ** 2;
    // A struck mode from t0: a sine at f Hz falling by 1/e every tau seconds after an attack of o.a seconds (a
    // long one swells like a bowed note). o.to glides the pitch there with time constant o.glide, or o.freq(t)
    // sets it outright. A tone that does not die by itself lasts o.len seconds under o.env, an envelope as for
    // hiss().
    function mode(d, sr, t0, f, amp, tau, o = {}) {
      const i0 = Math.round(t0 * sr);
      const n = Math.min(d.length - i0, Math.ceil((o.len ?? tau * 7) * sr));
      const att = Math.max(1, (o.a ?? 0.0007) * sr);
      const tail = 0.002 * sr;
      const k = Math.exp(-1 / (tau * sr));
      let c = 1,
        s = 0,
        cw = 1,
        sw = 0,
        env = amp;
      for (let i = 0; i < n; i++) {
        if (i % 32 === 0) {
          const t = i / sr;
          const fi = o.freq ? o.freq(t) : o.to ? o.to + (f - o.to) * Math.exp(-t / (o.glide ?? 0.03)) : f;
          cw = Math.cos((TAU * fi) / sr);
          sw = Math.sin((TAU * fi) / sr);
          const m = 1 / Math.hypot(c, s);
          c *= m;
          s *= m;
        }
        const nc = c * cw - s * sw;
        s = c * sw + s * cw;
        c = nc;
        let g = env;
        if (i < att) g *= 0.5 - 0.5 * Math.cos((Math.PI * i) / att);
        if (n - i < tail) g *= (n - i) / tail;
        if (o.env) g *= o.env(i / sr, i / n);
        d[i0 + i] += g * s;
        env *= k;
      }
    }
    // A contact click at t0: a windowed burst of `cycles` cycles at f Hz, its energy around f.
    function tap(d, sr, t0, f, amp, cycles = 1.5) {
      const i0 = Math.round(t0 * sr);
      const n = Math.min(d.length - i0, Math.round((cycles / f) * sr) + 1);
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        d[i0 + i] += amp * (0.5 - 0.5 * Math.cos(TAU * u)) * Math.sin(TAU * cycles * (u - 0.5));
      }
    }
    // Filtered noise for dur seconds from t0: a band at o.f Hz (all below it with o.type 'low'), swept to o.to
    // along o.path (0 to 1, straight unless given), resonance o.q, shaped by o.env (a quick hit unless given)
    // and o.am. o.grain from 0 to 1 thins it into a crackle of separate grains, as grit, paper and leaf make.
    function hiss(d, sr, t0, dur, amp, o = {}) {
      const i0 = Math.round(t0 * sr);
      const n = Math.min(d.length - i0, Math.round(dur * sr));
      const rnd = noise((noiseSeed += 7919));
      const env = o.env ?? hit(0.002, dur / 4);
      const k = 1 / (o.q ?? 1);
      const fade = 0.003 * sr;
      let a1 = 0,
        a2 = 0,
        a3 = 0,
        z1 = 0,
        z2 = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        if (i % 16 === 0) {
          const f = o.to ? o.f * (o.to / o.f) ** (o.path ? o.path(u) : u) : o.f;
          const g = Math.tan((Math.PI * Math.min(f, 0.45 * sr)) / sr);
          a1 = 1 / (1 + g * (g + k));
          a2 = g * a1;
          a3 = g * a2;
        }
        let x = rnd();
        if (o.grain) x = Math.abs(rnd()) < o.grain ? x / Math.sqrt(o.grain) : 0;
        // A state-variable filter, stable however fast its frequency moves.
        const v3 = x - z2;
        const v1 = a1 * z1 + a2 * v3;
        const v2 = z2 + a2 * z1 + a3 * v3;
        z1 = 2 * v1 - z1;
        z2 = 2 * v2 - z2;
        const y = o.type === 'low' ? v2 : k * v1;
        const t = i / sr;
        d[i0 + i] += amp * y * env(t, u) * (o.am ? o.am(t) : 1) * Math.min(1, (n - i) / fade);
      }
    }
    // A voice drawn by draw(d, sr, v, r) into dur seconds at o.gain: o.vary variants (v, each with seeded noise
    // r of its own) played o.rate faster or slower at random; o.next(last) may choose the variant instead. Its
    // key starts with the theme's id: the first sound of a theme draws the rest of its voices in idle moments
    // after the wheel has opened, so applying a slice never waits for a drawing.
    const drawers = new Map();
    function drawn(key, dur, draw, o = {}) {
      const vary = o.vary ?? 1;
      const theme = key.split(':')[0];
      let last = -1;
      const pick = () => {
        if (vary < 2) return 0;
        const v = Math.floor(Math.random() * (last < 0 ? vary : vary - 1));
        return last >= 0 && v >= last ? v + 1 : v;
      };
      const make = (ac, v) => {
        const sr = ac.sampleRate;
        const id = `${key}:${v}:${sr}`;
        let buf = drawnSounds.get(id);
        if (buf) return buf;
        buf = ac.createBuffer(1, Math.ceil(dur * sr), sr);
        const d = buf.getChannelData(0);
        draw(d, sr, v, noise(v * 7919 + 101));
        // A DC blocker, the voice's gain and a fade over its last moments.
        const R = Math.exp((-TAU * 20) / sr);
        const fade = Math.max(1, (o.fade ?? 0.004) * sr);
        let x1 = 0,
          y1 = 0;
        for (let i = 0; i < d.length; i++) {
          y1 = d[i] - x1 + R * y1;
          x1 = d[i];
          const left = d.length - 1 - i;
          d[i] = (o.gain ?? 1) * y1 * (left < fade ? Math.sin((Math.PI / 2) * (left / fade)) ** 2 : 1);
        }
        drawnSounds.set(id, buf);
        return buf;
      };
      if (!drawers.has(theme)) drawers.set(theme, { list: [], rates: new Set() });
      for (let v = 0; v < vary; v++) drawers.get(theme).list.push((ac) => make(ac, v));
      return (ac, out, t) => {
        const v = o.next ? o.next(last) : pick();
        last = v;
        const buf = make(ac, v);
        const all = drawers.get(theme);
        if (!all.rates.has(ac.sampleRate)) {
          all.rates.add(ac.sampleRate);
          const queue = [...all.list];
          const idle = (f) => (window.requestIdleCallback ? window.requestIdleCallback(f) : setTimeout(f, 20));
          // A drawing takes up to a few milliseconds: only when the page has that much time to spare.
          const next = (spare) => {
            if (!queue.length) return;
            if (!spare || spare.timeRemaining() > 8) queue.shift()(ac);
            idle(next);
          };
          setTimeout(() => idle(next), 400);
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 1 + (o.rate ?? 0) * (2 * Math.random() - 1);
        src.connect(out);
        src.start(t);
        src.stop(t + buf.duration / src.playbackRate.value + 0.02);
      };
    }
    // A run of teeth (knurl, flutes, gear) passing, as a gain for hiss(): pos(t) counts the teeth passed by t
    // seconds, and each is a bump, smooth at sharp 1 and a click of its own at 8.
    const teeth = (pos, depth, sharp) => (t) => 1 - depth + depth * (0.5 + 0.5 * Math.cos(TAU * pos(t))) ** sharp;
    // Teeth passing at r0 a second, slowing (or quickening) to r1 over T seconds.
    function slowing(r0, r1, T) {
      const l = Math.log(r0 / r1) / T;
      return (t) => (r0 * (1 - Math.exp(-l * t))) / l;
    }
    // Ayar's steel: the thin bezel rings at f and 2.83 f over a short knock of the enamel plate under it.
    function steelRing(d, sr, t, f, amp, tau) {
      mode(d, sr, t, f, amp, tau);
      mode(d, sr, t, f * 2.83, amp * 0.3, tau * 0.4);
      mode(d, sr, t, f * 0.385, amp * 0.6, 0.005);
    }
    // Beton's materials: a cast-iron clank (the damped modes of a thick block) and a concrete slab's thud,
    // with the grit that concrete sheds.
    function clank(d, sr, t, f, k) {
      tap(d, sr, t, f * 4.2, 0.35 * k);
      mode(d, sr, t, f, 0.07 * k, 0.02);
      mode(d, sr, t, f * 2.95, 0.035 * k, 0.01);
      mode(d, sr, t, f * 6.4, 0.012 * k, 0.005);
    }
    function slab(d, sr, t, k) {
      mode(d, sr, t, 140, 0.12 * k, 0.05, { a: 0.002 });
      mode(d, sr, t, 310, 0.08 * k, 0.03, { a: 0.0015 });
      mode(d, sr, t, 720, 0.04 * k, 0.015);
      hiss(d, sr, t, 0.09, 0.15 * k, { f: 900, q: 0.7, env: hit(0.002, 0.025) });
      hiss(d, sr, t, 0.14, 0.05 * k, { f: 3000, q: 0.8, grain: 0.2, env: hit(0.002, 0.04) });
    }
    // Titan's titanium: a cushioned detent (a soft click over two damped modes), and the frosted glass of the
    // face, which only breathes.
    function cushion(d, sr, t, f, k) {
      tap(d, sr, t, f * 1.7, 0.3 * k, 2);
      mode(d, sr, t, f, 0.07 * k, 0.008, { a: 0.0012 });
      mode(d, sr, t, f * 2.6, 0.022 * k, 0.004);
    }
    const breath = (d, sr, t, dur, amp) => hiss(d, sr, t, dur, amp, { f: 4600, q: 1.5, env: hit(0.003, dur / 3) });

    const SOUNDS = {
      a: {
        // The knurled bezel spun by a thumb: a brushed-steel swish with the knurl running in it, slowing,
        // then the index seats with a clear little ring and settles just past it.
        open: drawn(
          'kadran-a:open',
          0.4,
          (d, sr) => {
            hiss(d, sr, 0, 0.212, 0.09, {
              f: 4600,
              to: 1700,
              q: 1.6,
              env: swell(0.3),
              am: teeth(slowing(450, 30, 0.212), 0.6, 4),
            });
            tap(d, sr, 0.205, 4200, 0.12);
            tap(d, sr, 0.211, 3300, 0.36);
            steelRing(d, sr, 0.211, 1725, 0.07, 0.05);
            tap(d, sr, 0.25, 3000, 0.1);
            mode(d, sr, 0.25, 1725, 0.015, 0.03);
          },
          { gain: 0.156 },
        ),
        // A light pawl lifting and dropping into the next tooth (two fine clicks) and the thin steel bezel
        // ringing a moment under them.
        tick: drawn(
          'kadran-a:tick',
          0.075,
          (d, sr, v, r) => {
            const j = 1 + 0.015 * r();
            const gap = 0.0055 + 0.0015 * r();
            tap(d, sr, 0, 4300 * j, 0.25);
            tap(d, sr, gap, 3300 * j, 0.7);
            steelRing(d, sr, gap, 2050 * j, 0.04, 0.018);
          },
          { vary: 6, rate: 0.02, gain: 0.155 },
        ),
        // Down into a deeper stop: a firmer double click, the ring a fourth lower with more body, and the
        // spring settling a moment later.
        enter: drawn(
          'kadran-a:enter',
          0.16,
          (d, sr, v, r) => {
            const j = 1 + 0.015 * r();
            tap(d, sr, 0, 3800 * j, 0.28);
            tap(d, sr, 0.009, 2500 * j, 0.7);
            steelRing(d, sr, 0.009, 1540 * j, 0.05, 0.026);
            mode(d, sr, 0.009, 520 * j, 0.03, 0.012);
            tap(d, sr, 0.05, 3300 * j, 0.1);
            mode(d, sr, 0.05, 1540 * j, 0.014, 0.02);
          },
          { vary: 3, gain: 0.148 },
        ),
        // Up out of the stop: a light click and a short ring a fourth higher that lifts a little as it goes.
        leave: drawn(
          'kadran-a:leave',
          0.1,
          (d, sr, v, r) => {
            const j = 1 + 0.015 * r();
            tap(d, sr, 0, 4800 * j, 0.24);
            tap(d, sr, 0.012, 3900 * j, 0.6);
            mode(d, sr, 0.012, 2740 * j, 0.035, 0.016, { to: 2820 * j, glide: 0.02 });
            mode(d, sr, 0.012, 1050 * j, 0.03, 0.005);
          },
          { vary: 3, gain: 0.177 },
        ),
        // The detent snaps home and jiggles, the index drops, the lock ring closes on the numeral with a rising
        // zing, and the steel disc rings a clear note as it pops; a faint glint runs round the steel.
        success: drawn(
          'kadran-a:success',
          0.95,
          (d, sr) => {
            tap(d, sr, 0, 2700, 0.5);
            mode(d, sr, 0, 520, 0.07, 0.02);
            mode(d, sr, 0, 1310, 0.04, 0.014);
            tap(d, sr, 0.062, 3600, 0.2);
            steelRing(d, sr, 0.062, 2050, 0.03, 0.02);
            tap(d, sr, 0.1, 2000, 0.2, 2);
            mode(d, sr, 0.1, 760, 0.035, 0.012);
            tap(d, sr, 0.134, 3900, 0.09);
            mode(d, sr, 0.08, 1400, 0.03, 0.2, { a: 0.12, to: 2100, glide: 0.09 });
            hiss(d, sr, 0.09, 0.43, 0.012, { f: 3800, to: 6200, q: 3, env: swell(0.4) });
            // The disc: the modes of a free plate (1, 1.73, 2.33, 3.91), the first doubled a few hertz apart
            // so it shimmers.
            tap(d, sr, 0.25, 3200, 0.25);
            for (const [k, a, tau] of [
              [1, 0.1, 0.32],
              [1.003, 0.03, 0.3],
              [1.73, 0.05, 0.2],
              [2.33, 0.045, 0.15],
              [3.91, 0.018, 0.07],
            ])
              mode(d, sr, 0.25, 1046.5 * k, a, tau);
          },
          { fade: 0.25, gain: 0.267 },
        ),
      },
      b: {
        // The slab lands with a gritty concrete thud, then the iron bezel ratchets round in three dull clanks,
        // a little lower each time, as the dial steps in.
        open: drawn(
          'kadran-b:open',
          0.36,
          (d, sr) => {
            slab(d, sr, 0, 0.6);
            [0.047, 0.094, 0.14].forEach((t, k) => clank(d, sr, t, 380 * (1 - 0.03 * k), 1 - 0.15 * k));
            hiss(d, sr, 0.02, 0.3, 0.02, { f: 3200, q: 0.9, grain: 0.03, env: swell(0.15) });
          },
          { gain: 0.304 },
        ),
        // The iron block steps into a concrete notch: a dull, heavy thock with a little grit and no ring.
        tick: drawn(
          'kadran-b:tick',
          0.07,
          (d, sr, v, r) => {
            const j = 1 + 0.05 * r();
            tap(d, sr, 0, 1350 * j, 0.45);
            mode(d, sr, 0, 235 * j, 0.11, 0.014, { a: 0.0012 });
            mode(d, sr, 0, 610 * j, 0.06, 0.008);
            mode(d, sr, 0, 1480 * j, 0.03, 0.004);
            hiss(d, sr, 0, 0.035, 0.07, { f: 2600, q: 0.8, grain: 0.25, env: hit(0.001, 0.008) });
          },
          { vary: 6, rate: 0.03, gain: 0.236 },
        ),
        // A heavy bolt slides into the wall: a short gritty scrape, then a deep clunk.
        enter: drawn(
          'kadran-b:enter',
          0.2,
          (d, sr, v, r) => {
            const j = 1 + 0.03 * r();
            hiss(d, sr, 0, 0.055, 0.07, { f: 1900, to: 1100, q: 1.2, grain: 0.35, env: swell(0.6) });
            tap(d, sr, 0.05, 1100 * j, 0.75);
            mode(d, sr, 0.05, 172 * j, 0.13, 0.03, { a: 0.0015 });
            mode(d, sr, 0.05, 420 * j, 0.07, 0.015);
            mode(d, sr, 0.05, 990 * j, 0.035, 0.008);
          },
          { vary: 3, gain: 0.158 },
        ),
        // The bolt is drawn back: a lighter clack, then a quick scrape upward.
        leave: drawn(
          'kadran-b:leave',
          0.13,
          (d, sr, v, r) => {
            const j = 1 + 0.03 * r();
            tap(d, sr, 0, 1700 * j, 0.4);
            mode(d, sr, 0, 300 * j, 0.08, 0.012, { a: 0.001 });
            mode(d, sr, 0, 860 * j, 0.04, 0.006);
            hiss(d, sr, 0.015, 0.06, 0.05, { f: 1200, to: 2300, q: 1.2, grain: 0.35, env: swell(0.4) });
          },
          { vary: 3, gain: 0.291 },
        ),
        // The dial is slammed into the wall (a gritty concrete thud), four bolts are thrown in two hard steps,
        // each a scrape and a flam of iron clunks, and dust and a few crumbs settle after. No chime.
        success: drawn(
          'kadran-b:success',
          0.62,
          (d, sr, v, r) => {
            slab(d, sr, 0.07, 1.1);
            for (const [t, f, k] of [
              [0.083, 420, 1],
              [0.146, 380, 1.15],
            ]) {
              hiss(d, sr, t - 0.022, 0.026, 0.06 * k, { f: 2300, to: 1500, q: 1.3, grain: 0.4, env: swell(0.7) });
              tap(d, sr, t, 1700, 0.5 * k, 2);
              for (let b = 0; b < 4; b++) clank(d, sr, t + b * 0.0026, f * (1 + 0.025 * b), 0.65 * k);
            }
            hiss(d, sr, 0.19, 0.4, 0.035, { f: 3200, q: 1, grain: 0.012, env: swell(0.1) });
            for (let c = 0; c < 5; c++)
              tap(d, sr, 0.21 + 0.055 * c + 0.03 * r(), 2600 + 1200 * Math.abs(r()), 0.09 * (1 - c * 0.15));
          },
          { fade: 0.1, gain: 0.24 },
        ),
      },
      c: {
        // The titanium bezel glides round on its bearing: a smooth airy whirr whose wide flutes pass slower and
        // slower, then a soft magnetic stop and the little spring past it.
        open: drawn(
          'kadran-c:open',
          0.32,
          (d, sr) => {
            hiss(d, sr, 0, 0.235, 0.1, {
              f: 1500,
              to: 650,
              q: 1.4,
              env: swell(0.22),
              am: teeth(slowing(170, 18, 0.235), 0.55, 1),
            });
            hiss(d, sr, 0, 0.22, 0.02, { f: 4200, q: 1.5, env: swell(0.3) });
            cushion(d, sr, 0.228, 900, 0.38);
            cushion(d, sr, 0.262, 1000, 0.15);
          },
          { gain: 0.564 },
        ),
        // A soft, damped detent of titanium on a ceramic bearing: a rounded tuk, then a breath of frosted glass.
        tick: drawn(
          'kadran-c:tick',
          0.06,
          (d, sr, v, r) => {
            cushion(d, sr, 0, 1050 * (1 + 0.04 * r()), 1);
            breath(d, sr, 0.004, 0.03, 0.02);
          },
          { vary: 6, rate: 0.02, gain: 0.379 },
        ),
        // Into a deeper, cushioned stop: a soft thum of titanium with a cool glass note under it.
        enter: drawn(
          'kadran-c:enter',
          0.2,
          (d, sr, v, r) => {
            const j = 1 + 0.02 * r();
            cushion(d, sr, 0, 760 * j, 1.2);
            mode(d, sr, 0, 380 * j, 0.05, 0.02, { a: 0.002 });
            mode(d, sr, 0.004, 1975 * j, 0.022, 0.07, { a: 0.004 });
            breath(d, sr, 0.01, 0.06, 0.015);
          },
          { vary: 3, gain: 0.294 },
        ),
        // A light lift out: a short airy rise with a soft tuk on top.
        leave: drawn(
          'kadran-c:leave',
          0.13,
          (d, sr, v, r) => {
            hiss(d, sr, 0, 0.065, 0.05, { f: 900, to: 2600, q: 1.5, env: swell(0.75) });
            cushion(d, sr, 0.058, 1300 * (1 + 0.02 * r()), 0.8);
          },
          { vary: 3, gain: 0.454 },
        ),
        // The handle ring turns a quarter on fine flutes and seats softly; a ring of light hums out through the
        // glass, brightening, and the lume flares with a cool chime a fifth wide.
        success: drawn(
          'kadran-c:success',
          1,
          (d, sr) => {
            // Eighteen flutes pass in the quarter turn, slow at both ends like the handle.
            const turn = (t) => {
              const u = Math.min(1, t / 0.24);
              return 18 * u * u * (3 - 2 * u);
            };
            hiss(d, sr, 0.024, 0.24, 0.05, { f: 2200, q: 2, env: swell(0.55), am: teeth(turn, 0.6, 4) });
            cushion(d, sr, 0.264, 700, 0.9);
            mode(d, sr, 0.06, 1175, 0.06, 0.3, { a: 0.14 });
            mode(d, sr, 0.06, 1175 * 2.71, 0.01, 0.15, { a: 0.12 });
            hiss(d, sr, 0.06, 0.35, 0.016, { f: 1500, to: 4500, q: 4, env: swell(0.6) });
            tap(d, sr, 0.3, 3400, 0.2, 2);
            mode(d, sr, 0.3, 1760, 0.09, 0.28, { a: 0.003 });
            mode(d, sr, 0.3, 1762.5, 0.03, 0.26, { a: 0.003 });
            mode(d, sr, 0.32, 2637, 0.06, 0.24, { a: 0.003 });
            mode(d, sr, 0.3, 1760 * 2.71, 0.01, 0.06);
          },
          { fade: 0.3, gain: 0.275 },
        ),
      },
    };

    // ================================================================ shared copy
    const FAMILY = {};

    // ================================================================ A
    Board.define(
      Object.assign({}, FAMILY, {
        id: 'kadran-a',
        fonts: {
          brand: "'IBM Plex Sans Variable'",
          load: ["'IBM Plex Sans Variable'"],
          credits: [{ family: 'IBM Plex Sans', license: 'SIL Open Font License 1.1' }],
        },
        motion: { open: 170, close: 110, stagger: 8, apply: 560 },
        palette: {
          light: {
            bg: '#f2f3f5',
            surface: '#ffffff',
            'surface-2': '#f5f6f8',
            border: '#dcdfe4',
            'border-strong': '#aab1ba',
            text: '#15181c',
            'text-muted': '#555c67',
            accent: '#2a4ea6',
            'accent-hi': '#3a62c2',
            'on-accent': '#ffffff',
            focus: '#2a4ea6',
            success: '#1c7a4b',
            'on-success': '#ffffff',
            'success-text': '#186a41',
            warning: '#d97706',
            'warning-text': '#15181c',
            danger: '#c2372d',
            desk: 'radial-gradient(120% 100% at 18% 0%, #f8f9fa 0%, #e7eaee 52%, #d4d9df 100%)',
            'wheel-face': '#f7f8f9',
            'wheel-slice': '#f7f8f9',
            'wheel-slice-hover': '#dbe2ec',
            'wheel-slice-selected': '#28499c',
            'wheel-text': '#111317',
            'wheel-text-selected': '#ffffff',
            'wheel-text-muted': '#4f5661',
            'wheel-num': '#2b3036',
            'wheel-line': '#d0d5db',
            'wheel-tick': '#22262b',
            'wheel-shadow': 'rgba(26, 34, 48, 0.3)',
            'wheel-shadow-near': 'rgba(26, 34, 48, 0.24)',
            'chapter-hover': '#e9edf3',
            'off-hover': '#eceef1',
            'enamel-hi': '#ffffff',
            'enamel-lo': '#e9ecef',
            'blue-hi': '#3d66c9',
            'blue-lo': '#1b3478',
            index: '#2a4ea6',
            'index-idle': '#646b75',
            'on-index': '#ffffff',
            'pointer-edge': 'rgba(12, 22, 48, 0.55)',
            'bezel-ring':
              'conic-gradient(from 0deg, #c7ccd2 0deg, #a8aeb6 35deg, #91979f 70deg, #b4bac1 108deg, #eef1f3 135deg, #c3c8ce 165deg, #a0a6ae 205deg, #8a9098 245deg, #aeb4bb 282deg, #f7f8fa 315deg, #d6dade 345deg, #c7ccd2 360deg)',
            'bezel-lines':
              'repeating-radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.07) 0 1px, rgba(20, 26, 34, 0.045) 1px 2px)',
            'bezel-tick': 'rgba(20, 24, 30, 0.6)',
            'knurl-dark': 'rgba(26, 31, 38, 0.46)',
            'knurl-light': 'rgba(255, 255, 255, 0.72)',
            'edge-dark': 'rgba(28, 34, 42, 0.5)',
            'face-shade': 'rgba(28, 34, 42, 0.1)',
            'steel-hi': '#ffffff',
            'steel-mid': '#c3c8ce',
            'steel-lo': '#7c838c',
            'hub-face': '#f3f5f7',
            dome: '0.85',
            keycap: '#e8ebef',
            'keycap-text': '#2b3036',
            'scale-tick': 'rgba(85, 92, 103, 0.42)',
          },
          dark: {
            bg: '#16181b',
            surface: '#1f2226',
            'surface-2': '#272b30',
            border: '#32373e',
            'border-strong': '#58606a',
            text: '#eef0f3',
            'text-muted': '#a3abb6',
            accent: '#89a7f5',
            'accent-hi': '#a3bbff',
            'on-accent': '#0a1530',
            focus: '#a3bbff',
            success: '#4fc28c',
            'on-success': '#05231a',
            'success-text': '#71d3a4',
            warning: '#e3a640',
            'warning-text': '#f0bd66',
            danger: '#ff7b70',
            desk: 'radial-gradient(120% 100% at 18% 0%, #353a40 0%, #1f2226 52%, #121417 100%)',
            'wheel-face': '#1d2024',
            'wheel-slice': '#1d2024',
            'wheel-slice-hover': '#2d333b',
            'wheel-slice-selected': '#3a5fc0',
            'wheel-text': '#f0f2f5',
            'wheel-text-selected': '#ffffff',
            'wheel-text-muted': '#b0b8c3',
            'wheel-num': '#c9cfd7',
            'wheel-line': '#30353c',
            'wheel-tick': '#d3d8de',
            'wheel-shadow': 'rgba(0, 0, 0, 0.62)',
            'wheel-shadow-near': 'rgba(0, 0, 0, 0.45)',
            'chapter-hover': '#272c33',
            'off-hover': '#24282d',
            'enamel-hi': '#2a2e34',
            'enamel-lo': '#17191c',
            'blue-hi': '#5a7fdc',
            'blue-lo': '#28448f',
            index: '#8fb0ff',
            'index-idle': '#8a929c',
            'on-index': '#0a1530',
            'pointer-edge': 'rgba(0, 0, 0, 0.55)',
            'bezel-ring':
              'conic-gradient(from 0deg, #6b7179 0deg, #555b63 35deg, #454b53 70deg, #5d646c 108deg, #9ba2aa 135deg, #676e76 165deg, #4d535b 205deg, #3f454c 245deg, #585e66 282deg, #a9b0b8 315deg, #7c838b 345deg, #6b7179 360deg)',
            'bezel-lines':
              'repeating-radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.045) 0 1px, rgba(0, 0, 0, 0.06) 1px 2px)',
            'bezel-tick': 'rgba(230, 236, 242, 0.55)',
            'knurl-dark': 'rgba(8, 10, 12, 0.55)',
            'knurl-light': 'rgba(255, 255, 255, 0.3)',
            'edge-dark': 'rgba(0, 0, 0, 0.6)',
            'face-shade': 'rgba(0, 0, 0, 0.35)',
            'steel-hi': '#c6ccd3',
            'steel-mid': '#6b727b',
            'steel-lo': '#2f343a',
            'hub-face': '#1b1e22',
            dome: '0.1',
            keycap: '#30353c',
            'keycap-text': '#dfe4ea',
            'scale-tick': 'rgba(163, 171, 182, 0.35)',
          },
        },
        contrast: [
          ...PAIRS_BASE,
          ['wheel-num', 'wheel-face', 'text'],
          ['index', 'wheel-face', 'ui'],
          ['index', 'chapter-hover', 'ui'],
          ['on-index', 'index', 'text'],
          ['keycap-text', 'keycap', 'text'],
        ],
        wheel: { render: renderA, update: turn },
        sounds: SOUNDS.a,
      }),
    );

    // ================================================================ B
    Board.define(
      Object.assign({}, FAMILY, {
        id: 'kadran-b',
        fonts: {
          brand: "'Inter Tight Variable'",
          display: "'Martian Mono Variable'",
          load: ["'Inter Tight Variable'", "'Martian Mono Variable'"],
          credits: [
            { family: 'Inter Tight', license: 'SIL Open Font License 1.1' },
            { family: 'Martian Mono', license: 'SIL Open Font License 1.1' },
          ],
        },
        motion: { open: 150, close: 100, stagger: 10, apply: 520 },
        palette: {
          light: {
            bg: '#d6d7d6',
            surface: '#ebecea',
            'surface-2': '#e0e1df',
            border: '#a6a8a7',
            'border-strong': '#17181a',
            text: '#131415',
            'text-muted': '#424548',
            accent: '#17181a',
            'on-accent': '#ffffff',
            focus: '#17181a',
            hivis: '#ffd60a',
            'on-hivis': '#131415',
            success: '#1b7a45',
            'on-success': '#ffffff',
            'success-text': '#14653a',
            warning: '#ffd60a',
            'warning-text': '#131415',
            danger: '#c4271c',
            desk: 'linear-gradient(160deg, #d1d3d2 0%, #c3c5c4 100%)',
            'wheel-face': '#d9dad8',
            'wheel-slice': '#d9dad8',
            'wheel-slice-hover': '#c3c5c3',
            'wheel-slice-selected': '#17181a',
            'wheel-text': '#131415',
            'wheel-text-selected': '#ffffff',
            'wheel-text-muted': '#3d4043',
            'wheel-num': '#131415',
            'wheel-line': '#17181a',
            'wheel-shadow': '#a2a4a3',
            'hard-shadow': '#a2a4a3',
            'cell-hover': '#17181a',
            'num-hover': '#ffd60a',
            flash: '#ffd60a',
            'flash-ink': '#131415',
            'index-idle': '#8d9195',
            iron: '#2b2d30',
            'iron-slot': '#121315',
            'iron-tick': '#8a8e92',
            ink: '#17181a',
            bolt: '#5b5f63',
            'bolt-line': '#3a3d40',
            concrete: '#d9dad8',
            'pore-dark': 'rgba(52, 55, 58, 0.34)',
            'pore-light': 'rgba(255, 255, 255, 0.55)',
            collar: '#17181a',
            'hub-text': '#131415',
            keycap: '#17181a',
            'keycap-text': '#ffffff',
            'off-hover': '#cfd0ce',
          },
          dark: {
            bg: '#18191a',
            surface: '#222325',
            'surface-2': '#2a2c2e',
            border: '#3e4144',
            'border-strong': '#8e9296',
            text: '#ecedee',
            'text-muted': '#a8acb0',
            accent: '#ffd60a',
            'on-accent': '#131415',
            focus: '#ffd60a',
            hivis: '#ffd60a',
            'on-hivis': '#131415',
            success: '#45c27a',
            'on-success': '#08200f',
            'success-text': '#5fcf8f',
            warning: '#ffd60a',
            'warning-text': '#ffd60a',
            danger: '#ff6b5e',
            desk: 'linear-gradient(160deg, #303234 0%, #242628 100%)',
            'wheel-face': '#1f2022',
            'wheel-slice': '#1f2022',
            'wheel-slice-hover': '#36393c',
            'wheel-slice-selected': '#ffd60a',
            'wheel-text': '#eceeef',
            'wheel-text-selected': '#131415',
            'wheel-text-muted': '#b4b8bc',
            'wheel-num': '#d6d9db',
            'wheel-line': '#76797c',
            'wheel-shadow': '#0e0f10',
            'hard-shadow': '#0e0f10',
            'cell-hover': '#ffd60a',
            'num-hover': '#131415',
            flash: '#ffffff',
            'flash-ink': '#131415',
            'index-idle': '#4a4d51',
            iron: '#8d9093',
            'iron-slot': '#5a5d61',
            'iron-tick': '#3a3d40',
            ink: '#0d0e0f',
            bolt: '#a3a6a9',
            'bolt-line': '#6b6e72',
            concrete: '#1f2022',
            'pore-dark': 'rgba(0, 0, 0, 0.5)',
            'pore-light': 'rgba(255, 255, 255, 0.07)',
            collar: '#0d0e0f',
            'hub-text': '#eceeef',
            keycap: '#ffd60a',
            'keycap-text': '#131415',
            'off-hover': '#28292b',
          },
        },
        contrast: [
          ...PAIRS_BASE,
          ['wheel-num', 'wheel-face', 'text'],
          ['num-hover', 'cell-hover', 'text'],
          ['on-hivis', 'hivis', 'text'],
          ['hub-text', 'concrete', 'text'],
          ['keycap-text', 'keycap', 'text'],
          ['wheel-line', 'wheel-face', 'ui'],
        ],
        wheel: { render: renderB, update: turn },
        sounds: SOUNDS.b,
      }),
    );

    // ================================================================ C
    Board.define(
      Object.assign({}, FAMILY, {
        id: 'kadran-c',
        fonts: {
          brand: "'Manrope Variable'",
          load: ["'Manrope Variable'"],
          credits: [{ family: 'Manrope', license: 'SIL Open Font License 1.1' }],
        },
        motion: { open: 190, close: 120, stagger: 7, apply: 600 },
        palette: {
          light: {
            bg: '#eceef0',
            surface: '#f8f9fa',
            'surface-2': '#f0f2f4',
            border: '#d5d9de',
            'border-strong': '#a5acb4',
            text: '#14181c',
            'text-muted': '#535d67',
            accent: '#0b7864',
            'accent-hi': '#119079',
            'on-accent': '#ffffff',
            focus: '#0b7864',
            success: '#1a7d4b',
            'on-success': '#ffffff',
            'success-text': '#166a40',
            warning: '#d97706',
            'warning-text': '#14181c',
            danger: '#c3372f',
            desk: 'radial-gradient(44% 48% at 74% 24%, rgba(80, 196, 170, 0.26) 0%, rgba(80, 196, 170, 0) 100%), radial-gradient(120% 100% at 15% 0%, #f5f7f8 0%, #e1e5e9 55%, #ced4da 100%)',
            'wheel-face': 'rgba(246, 248, 249, 0.74)',
            'wheel-slice': '#eef1f3',
            'wheel-slice-hover': '#dcece8',
            'wheel-slice-selected': '#0b7864',
            'wheel-text': '#12161a',
            'wheel-text-selected': '#ffffff',
            'wheel-text-muted': '#4b5560',
            'wheel-num': '#2e353c',
            'wheel-line': 'rgba(20, 30, 40, 0.13)',
            'wheel-tick': 'rgba(24, 31, 39, 0.5)',
            'wheel-shadow': 'rgba(24, 34, 44, 0.28)',
            'wheel-shadow-near': 'rgba(24, 34, 44, 0.2)',
            lume: '#0b9479',
            'lume-pip': '#d2f7ec',
            'lume-edge': '#0b6a58',
            'lume-text': '#0a6d5b',
            'halo-opacity': '0.0',
            'edge-glow': '0.22',
            'edge-glow-max': '0.42',
            sheen: '0.5',
            frost: '0.55',
            'chapter-hover': 'rgba(11, 120, 100, 0.08)',
            'ti-hi': '#9ea4ab',
            'ti-mid': '#686e75',
            'ti-lo': '#3c4147',
            'ti-sheen': '0.5',
            'ti-shade': '0.45',
            'ti-tick': 'rgba(240, 244, 247, 0.55)',
            'flute-dark': 'rgba(10, 13, 16, 0.34)',
            'flute-light': 'rgba(255, 255, 255, 0.18)',
            'edge-dark': 'rgba(14, 18, 22, 0.55)',
            'gun-hi': '#4b525a',
            'gun-lo': '#1d2125',
            'hub-text': '#f1f4f6',
            'hub-muted': '#b9c2ca',
            handle: '#a9b0b7',
            keycap: '#2f353b',
            'keycap-text': '#e9eef2',
            'art-face': '#f4f6f8',
            'off-hover': '#e6e9ec',
            tri: '#2a2f35',
            glass: 'rgba(255, 255, 255, 0.7)',
            'glass-border': 'rgba(20, 30, 40, 0.1)',
            'glass-hi': 'rgba(255, 255, 255, 0.9)',
            glow: 'rgba(11, 120, 100, 0.28)',
            'win-top': '#f6f7f9',
          },
          dark: {
            bg: '#111316',
            surface: '#1a1d21',
            'surface-2': '#21252a',
            border: '#2b3036',
            'border-strong': '#48515a',
            text: '#edf1f3',
            'text-muted': '#98a3ad',
            accent: '#7ee6cd',
            'accent-hi': '#9df0dc',
            'on-accent': '#062019',
            focus: '#9df0dc',
            success: '#58d39a',
            'on-success': '#04200f',
            'success-text': '#72dfab',
            warning: '#efb44b',
            'warning-text': '#f3c46e',
            danger: '#ff7f7a',
            desk: 'radial-gradient(44% 48% at 74% 24%, rgba(90, 200, 176, 0.17) 0%, rgba(90, 200, 176, 0) 100%), radial-gradient(120% 100% at 15% 0%, #2b3036 0%, #171a1e 55%, #0d0f11 100%)',
            'wheel-face': 'rgba(24, 28, 32, 0.74)',
            'wheel-slice': '#1a1e22',
            'wheel-slice-hover': '#1f2e2c',
            'wheel-slice-selected': '#7ee6cd',
            'wheel-text': '#f1f4f6',
            'wheel-text-selected': '#062019',
            'wheel-text-muted': '#a9b4bd',
            'wheel-num': '#c3ccd3',
            'wheel-line': 'rgba(255, 255, 255, 0.1)',
            'wheel-tick': 'rgba(230, 238, 243, 0.5)',
            'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
            'wheel-shadow-near': 'rgba(0, 0, 0, 0.4)',
            lume: '#8cf2d9',
            'lume-pip': '#9ff7e1',
            'lume-edge': '#2c6f61',
            'lume-text': '#8cf2d9',
            'halo-opacity': '1',
            'edge-glow': '0.18',
            'edge-glow-max': '0.5',
            sheen: '0.07',
            frost: '0.5',
            'chapter-hover': 'rgba(126, 230, 205, 0.07)',
            'ti-hi': '#c9ced3',
            'ti-mid': '#959ba1',
            'ti-lo': '#5b6167',
            'ti-sheen': '0.55',
            'ti-shade': '0.5',
            'ti-tick': 'rgba(18, 21, 25, 0.6)',
            'flute-dark': 'rgba(14, 17, 20, 0.3)',
            'flute-light': 'rgba(255, 255, 255, 0.28)',
            'edge-dark': 'rgba(0, 0, 0, 0.55)',
            'gun-hi': '#3b4148',
            'gun-lo': '#14171a',
            'hub-text': '#f1f4f6',
            'hub-muted': '#aab4bd',
            handle: '#b3bac1',
            keycap: '#2c3238',
            'keycap-text': '#e3e9ee',
            'art-face': '#1c2024',
            'off-hover': '#1d2125',
            tri: '#22272c',
            glass: 'rgba(255, 255, 255, 0.04)',
            'glass-border': 'rgba(255, 255, 255, 0.075)',
            'glass-hi': 'rgba(255, 255, 255, 0.05)',
            glow: 'rgba(126, 230, 205, 0.4)',
            'win-top': '#1d2125',
          },
        },
        contrast: [
          ...PAIRS_BASE,
          ['wheel-num', 'wheel-slice', 'text'],
          ['lume-text', 'wheel-slice', 'text'],
          ['hub-text', 'gun-lo', 'text'],
          ['hub-muted', 'gun-lo', 'text'],
          ['keycap-text', 'keycap', 'text'],
        ],
        wheel: { render: renderC, update: turn },
        sounds: SOUNDS.c,
      }),
    );
  })();
}
