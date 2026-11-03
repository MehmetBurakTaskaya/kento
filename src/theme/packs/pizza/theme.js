// SPDX-License-Identifier: MIT
// Theme: Pizza. A round pizza on a peel: a puffy crust with charred spots, melted cheese and
// abstract toppings on every slice. Applying pulls the slice out of the pie with stretching
// strings of cheese. The dark palette is a pizza at the mouth of a wood-fired oven, on a steel peel.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const ID = 'pizza';
    // Radii in the 400 x 400 view box: hub (mozzarella), slice, cheese edge, crust, peel.
    const R = { hub: 46, s0: 49, cheese: 158, sauce: 166, crust: 183, peel: 197, lbl: 108 };
    const PULL = 12; // how far the chosen slice stays pulled out

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
    const dot = (x, y, r) =>
      `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
    function stop(grad, H, offset, token, op) {
      H.s('stop', { offset, style: `stop-color: var(${token})${op != null ? `; stop-opacity: ${op}` : ''}` }, grad);
    }
    // The widest label the slice holds around the point at radius R.lbl on its centre line: on each
    // line the label covers, the distance to the nearer edge of the slice (between radii r0 and r1,
    // less `pad`), so a slice on the side of the wheel, where text runs along the radius, gets more
    // room than one at the top. Labels stay upright, so this is what fits whatever the angle.
    const room = (H, sl, r0, r1, pad, twist = () => 0) => {
      const [cx, cy] = H.polar(R.lbl, sl.mid);
      const inside = (x, y) => {
        const r = Math.hypot(x - 200, y - 200);
        if (r < r0 || r > r1) return false;
        const a = (Math.atan2(x - 200, 200 - y) * 180) / Math.PI - twist(r);
        return (((a - sl.a0) % 360) + 360) % 360 <= sl.a1 - sl.a0;
      };
      let half = 66;
      for (const y of [cy - 11, cy, cy + 11]) {
        let left = 0;
        let right = 0;
        while (left < 66 + pad && inside(cx - left - 1, y)) left += 1;
        while (right < 66 + pad && inside(cx + right + 1, y)) right += 1;
        half = Math.min(half, Math.min(left, right) - pad);
      }
      return Math.max(44, 2 * half);
    };
    // A closed outline over a slice from radius r0 to an outer edge given by fn(angle).
    function wedge(H, r0, a0, a1, fn, gap) {
      const g = (r) => ((gap / 2 / r) * 180) / Math.PI;
      const b0 = a0 + g(R.crust),
        b1 = a1 - g(R.crust);
      let d = '';
      const steps = 36;
      for (let k = 0; k <= steps; k++) {
        const a = b0 + ((b1 - b0) * k) / steps;
        const [x, y] = H.polar(fn(a), a);
        d += (k ? 'L' : 'M') + f2(x) + ' ' + f2(y);
      }
      const [x1, y1] = H.polar(r0, a1 - g(r0));
      const [x2, y2] = H.polar(r0, a0 + g(r0));
      return d + `L${f2(x1)} ${f2(y1)}A${r0} ${r0} 0 0 0 ${f2(x2)} ${f2(y2)}Z`;
    }
    // A basil leaf, pointing along angle rot (degrees), centered at x, y.
    function leaf(x, y, len, w, rot) {
      const t = (rot * Math.PI) / 180;
      const ux = Math.cos(t),
        uy = Math.sin(t);
      const P = (u, v) => `${f2(x + ux * u - uy * v)} ${f2(y + uy * u + ux * v)}`;
      return {
        body: `M${P(-len / 2, 0)}C${P(-len / 4, -w)} ${P(len / 4, -w)} ${P(len / 2, 0)}C${P(len / 4, w * 0.9)} ${P(-len / 4, w * 0.9)} ${P(-len / 2, 0)}Z`,
        vein: `M${P(-len / 2 + 1, 0)}L${P(len / 2 - 2, 0)}`,
      };
    }

    // Toppings: scattered over the cheese, away from the label box and from each other.
    function toppings(H, sl, rand, box) {
      const placed = [];
      const ok = (x, y, r, rad, a) => {
        const side = Math.min(a - sl.a0, sl.a1 - a);
        if (rad * Math.sin(H.rad(side)) - 3 < r || rad - r < R.s0 + 6 || rad + r > R.cheese - 3) return false;
        const dx = Math.max(Math.abs(x - box.cx) - box.hw, 0);
        const dy = Math.max(Math.abs(y - box.cy) - box.hh, 0);
        if (Math.hypot(dx, dy) < r + 2) return false;
        return !placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + 2.5);
      };
      const put = (kind, r, count) => {
        for (let k = 0, n = 0; k < 400 && n < count; k++) {
          const rad = R.s0 + 8 + rand() * (R.cheese - R.s0 - 12);
          const a = sl.a0 + rand() * (sl.a1 - sl.a0);
          const [x, y] = H.polar(rad, a);
          if (!ok(x, y, r, rad, a)) continue;
          placed.push({ kind, x, y, r, rot: rand() * 360 });
          n++;
        }
      };
      // As many toppings per degree whatever the number of slices.
      const share = Math.min(4, (sl.a1 - sl.a0) / 45);
      put('pep', 10.5, Math.round(2 * share));
      put('basil', 7.5, Math.max(1, Math.round(share)));
      put('olive', 4.6, Math.round(2 * share));
      put('pepper', 5, Math.max(1, Math.round(share)));
      let pep = '',
        pepDot = '',
        basil = '',
        vein = '',
        olive = '',
        pepper = '',
        herb = '';
      for (const p of placed) {
        if (p.kind === 'pep') {
          pep += dot(p.x, p.y, p.r);
          for (let q = 0; q < 4; q++) {
            const qa = rand() * Math.PI * 2,
              qr = rand() * p.r * 0.6;
            pepDot += dot(p.x + Math.cos(qa) * qr, p.y + Math.sin(qa) * qr, 0.8 + rand() * 0.9);
          }
        } else if (p.kind === 'basil') {
          const l = leaf(p.x, p.y, 17, 6.5, p.rot);
          basil += l.body;
          vein += l.vein;
        } else if (p.kind === 'olive') {
          olive += dot(p.x, p.y, p.r);
        } else {
          const t = (p.rot * Math.PI) / 180;
          const ux = Math.cos(t) * 6,
            uy = Math.sin(t) * 6;
          pepper += `M${f2(p.x - ux)} ${f2(p.y - uy)}Q${f2(p.x - uy * 0.5)} ${f2(p.y + ux * 0.5)} ${f2(p.x + ux)} ${f2(p.y + uy)}`;
        }
      }
      for (let k = 0; k < 9 * share; k++) {
        const rad = R.s0 + 8 + rand() * (R.cheese - R.s0 - 14);
        const a = sl.a0 + 3 + rand() * (sl.a1 - sl.a0 - 6);
        const [x, y] = H.polar(rad, a);
        const dx = Math.max(Math.abs(x - box.cx) - box.hw, 0);
        const dy = Math.max(Math.abs(y - box.cy) - box.hh, 0);
        if (Math.hypot(dx, dy) < 3) continue;
        herb += dot(x, y, 0.7 + rand() * 0.6);
      }
      return { pep, pepDot, basil, vein, olive, pepper, herb };
    }

    Board.define({
      id: ID,
      fonts: {
        brand: "'Barlow Semi Condensed'",
        display: "'Alfa Slab One'",
        load: ["'Barlow Semi Condensed'", "'Alfa Slab One'"],
        credits: [
          { family: 'Alfa Slab One', license: 'SIL Open Font License 1.1' },
          { family: 'Barlow Semi Condensed', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 120, stagger: 12, apply: 680 },
      palette: {
        light: {
          bg: '#fbf7f0',
          surface: '#ffffff',
          'surface-2': '#f6efe3',
          border: '#eadcc6',
          'border-strong': '#cfb48b',
          text: '#2a1610',
          'text-muted': '#6a5348',
          accent: '#c4301c',
          'on-accent': '#ffffff',
          focus: '#2f7d3a',
          success: '#2f7d3a',
          'on-success': '#ffffff',
          'success-text': '#256830',
          warning: '#b86e00',
          'warning-text': '#7a4800',
          danger: '#c4301c',
          desk: 'repeating-linear-gradient(0deg, rgba(196, 48, 28, 0.07) 0 22px, transparent 22px 44px), repeating-linear-gradient(90deg, rgba(196, 48, 28, 0.07) 0 22px, transparent 22px 44px), #fffaf2',
          'wheel-face': '#ffe08a',
          'wheel-slice': '#ffe28f',
          'wheel-slice-hover': '#ffd466',
          'wheel-slice-selected': '#ffb733',
          'wheel-text': '#6b1206',
          'wheel-text-selected': '#4d0b03',
          'wheel-line': '#c4301c',
          'wheel-shadow': 'rgba(90, 50, 20, 0.30)',
          'pz-cheese': '#ffe28f',
          'pz-cheese-hi': '#fff3c4',
          'pz-cheese-brown': '#f2b54e',
          'pz-sauce': '#c9301e',
          'pz-sauce-dark': '#8f1a0e',
          'pz-crust-in': '#d98a37',
          'pz-crust': '#f0b765',
          'pz-crust-edge': '#c77a2c',
          'pz-char': '#4a2a14',
          'pz-flour': '#fff7e6',
          'pz-pep': '#c8321f',
          'pz-pep-dot': '#8f1a0e',
          'pz-basil': '#2f8a3a',
          'pz-vein': '#a6dd8f',
          'pz-olive': '#232019',
          'pz-pepper': '#f5c518',
          'pz-herb': '#4f7a2a',
          'pz-peel': '#f2dcb4',
          'pz-peel-edge': '#d9b780',
          'pz-grain': '#c9a26b',
          'pz-grain-op': '0.35',
          'pz-hole': '#d9b780',
          'pz-hole-op': '0',
          'pz-glow': 'rgba(255, 140, 40, 0)',
          'pz-string': '#fff1b8',
          'pz-string-edge': '#f2c766',
          'pz-sub': '#6b1206',
          'pz-hub': '#fffaf0',
          'pz-hub-edge': '#efe1c4',
          'pz-hub-text': '#6b1206',
          'pz-hub-sub': '#7a5a48',
          'pz-key': '#2f7d3a',
          'pz-key-text': '#ffffff',
        },
        dark: {
          bg: '#121319',
          surface: '#1c1d25',
          'surface-2': '#25262f',
          border: '#353742',
          'border-strong': '#545766',
          text: '#f7efe6',
          'text-muted': '#b9ada3',
          accent: '#ff8a3d',
          'on-accent': '#231005',
          focus: '#ffb067',
          success: '#6fd38c',
          'on-success': '#06210f',
          'success-text': '#86e0a0',
          warning: '#ffbf5a',
          'warning-text': '#ffd080',
          danger: '#ff6b5a',
          desk: 'radial-gradient(90% 70% at 50% 100%, #8a2a08 0%, #3d1408 30%, #16141c 62%, #0e0d13 100%)',
          'wheel-face': '#ffd36b',
          'wheel-slice': '#ffd779',
          'wheel-slice-hover': '#ffc54d',
          'wheel-slice-selected': '#ff9f2e',
          'wheel-text': '#5c0e04',
          'wheel-text-selected': '#3d0802',
          'wheel-line': '#ff7a2a',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'pz-cheese': '#ffd779',
          'pz-cheese-hi': '#fff0b8',
          'pz-cheese-brown': '#e8952e',
          'pz-sauce': '#b8260f',
          'pz-sauce-dark': '#6e1206',
          'pz-crust-in': '#c46a22',
          'pz-crust': '#f0a54a',
          'pz-crust-edge': '#9a4a16',
          'pz-char': '#1e0f08',
          'pz-flour': '#ffe6c4',
          'pz-pep': '#d13a1f',
          'pz-pep-dot': '#7a1206',
          'pz-basil': '#3c9a40',
          'pz-vein': '#b6e89a',
          'pz-olive': '#16130f',
          'pz-pepper': '#ffd23a',
          'pz-herb': '#5f8a2a',
          'pz-peel': '#5d6270',
          'pz-peel-edge': '#8a909e',
          'pz-grain': '#2d3039',
          'pz-grain-op': '0',
          'pz-hole': '#16141c',
          'pz-hole-op': '0.9',
          'pz-glow': 'rgba(255, 120, 30, 0.55)',
          'pz-string': '#ffeaa6',
          'pz-string-edge': '#f0b347',
          'pz-sub': '#5c0e04',
          'pz-hub': '#fff6e3',
          'pz-hub-edge': '#f5d9a8',
          'pz-hub-text': '#5c0e04',
          'pz-hub-sub': '#7a4a30',
          'pz-key': '#2f7d3a',
          'pz-key-text': '#ffffff',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['pz-sub', 'wheel-slice', 'text'],
        ['pz-sub', 'wheel-slice-hover', 'text'],
        ['pz-sub', 'pz-cheese-brown', 'large'],
        ['pz-hub-text', 'pz-hub', 'text'],
        ['pz-hub-sub', 'pz-hub', 'text'],
        ['pz-key-text', 'pz-key', 'text'],
      ],

      // Gradients are built per wheel in render(): they read the palette tokens of their own card.
      defs: '',

      wheel: {
        render(root, m, H) {
          const uid = H.uid(ID);
          const rand = rng(31337 + m.n);
          const defs = H.s('defs', {}, root);
          const crust = H.s(
            'radialGradient',
            { id: `${uid}-crust`, gradientUnits: 'userSpaceOnUse', cx: 200, cy: 200, r: R.crust + 2 },
            defs,
          );
          stop(crust, H, 0.88, '--pz-crust-in');
          stop(crust, H, 0.95, '--pz-crust');
          stop(crust, H, 1, '--pz-crust-edge');
          const sh = H.s(
            'radialGradient',
            { id: `${uid}-shadow`, gradientUnits: 'userSpaceOnUse', cx: 204, cy: 208, r: R.crust + 10 },
            defs,
          );
          stop(sh, H, 0.86, '--wheel-shadow');
          stop(sh, H, 1, '--wheel-shadow', 0);
          const glow = H.s(
            'radialGradient',
            { id: `${uid}-glow`, gradientUnits: 'userSpaceOnUse', cx: 200, cy: 230, r: 215 },
            defs,
          );
          stop(glow, H, 0.6, '--pz-glow');
          stop(glow, H, 1, '--pz-glow', 0);
          const peelG = H.s(
            'radialGradient',
            { id: `${uid}-peel`, gradientUnits: 'userSpaceOnUse', cx: 180, cy: 170, r: 240 },
            defs,
          );
          stop(peelG, H, 0.5, '--pz-peel');
          stop(peelG, H, 0.85, '--pz-peel-edge');
          const hubG = H.s(
            'radialGradient',
            { id: `${uid}-hub`, gradientUnits: 'userSpaceOnUse', cx: 192, cy: 190, r: R.hub + 6 },
            defs,
          );
          stop(hubG, H, 0.55, '--pz-hub');
          stop(hubG, H, 1, '--pz-hub-edge');

          // The peel: a round board (wood by day, perforated steel at night) with its handle.
          const peel = H.s('g', { class: 'pz-peel', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: 200, cy: 230, r: 215, fill: `url(#${uid}-glow)`, class: 'pz-glow' }, peel);
          const ha = 225;
          const hw = 15;
          const [h0x, h0y] = H.polar(R.peel - 6, ha);
          const [h1x, h1y] = H.polar(R.peel + 64, ha);
          const t = H.rad(ha);
          const px = Math.cos(t) * hw,
            py = Math.sin(t) * hw;
          H.s(
            'path',
            {
              d: `M${f2(h0x - px)} ${f2(h0y - py)}L${f2(h1x - px)} ${f2(h1y - py)}A${hw} ${hw} 0 0 1 ${f2(h1x + px)} ${f2(h1y + py)}L${f2(h0x + px)} ${f2(h0y + py)}Z`,
              fill: `url(#${uid}-peel)`,
              class: 'pz-board',
            },
            peel,
          );
          const [hx, hy] = H.polar(R.peel + 50, ha);
          H.s('circle', { cx: f2(hx), cy: f2(hy), r: 4.5, class: 'pz-handle-hole' }, peel);
          H.s('circle', { cx: 200, cy: 200, r: R.peel, fill: `url(#${uid}-peel)`, class: 'pz-board' }, peel);
          let grain = '';
          for (let k = 0; k < 9; k++) {
            const y = 22 + k * 44 + rand() * 10;
            const half = Math.sqrt(Math.max(0, R.peel * R.peel - (y - 200) ** 2)) - 4;
            if (half < 20) continue;
            grain += `M${f2(200 - half)} ${f2(y)}C${f2(200 - half / 3)} ${f2(y - 5 - rand() * 4)} ${f2(200 + half / 3)} ${f2(y + 5 + rand() * 4)} ${f2(200 + half)} ${f2(y)}`;
          }
          H.s('path', { d: grain, class: 'pz-grain' }, peel);
          let holes = '';
          for (let ring = 0; ring < 2; ring++) {
            const n = 46 + ring * 6;
            for (let k = 0; k < n; k++) {
              const [x, y] = H.polar(R.crust + 5 + ring * 5.5, (k + ring * 0.5) * (360 / n));
              holes += dot(x, y, 1.2);
            }
          }
          H.s('path', { d: holes, class: 'pz-holes' }, peel);
          H.s('circle', { cx: 204, cy: 208, r: R.crust + 10, fill: `url(#${uid}-shadow)` }, peel);
          // The base under the slices: sauce shows in the cuts and where a slice has been pulled.
          H.s('circle', { cx: 200, cy: 200, r: R.sauce - 0.5, class: 'pz-base' }, peel);

          // Slices.
          const GAPS = 2.4;
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const [ux, uy] = [Math.sin(H.rad(sl.mid)), -Math.cos(H.rad(sl.mid))];
            g.style.setProperty('--px', f2(ux * PULL) + 'px');
            g.style.setProperty('--py', f2(uy * PULL) + 'px');
            g.style.setProperty('--ux', f2(ux));
            g.style.setProperty('--uy', f2(uy));
            H.s('path', { d: H.sector(R.hub, R.crust + 2, sl.a0, sl.a1), class: 'pz-hit' }, g);
            // Cheese strings live under the slice; they stretch from the center to its tip.
            const str = H.s('g', { class: 'pz-strings', transform: `rotate(${f2(sl.mid)} 200 200)` }, g);
            const sg = H.s('g', { class: 'pz-str' }, str);
            // Drawn three units long from just inside the hub; CSS stretches them along the slice.
            const strand = ([x, sag]) =>
              `M${f2(200 + x * 0.5)} ${200 - R.hub + 2}C${f2(200 + x * 0.6 + sag)} ${200 - R.hub - 0.2} ${f2(200 + x * 0.85 + sag)} ${200 - R.hub - 0.6} ${f2(200 + x)} ${200 - R.hub - 1}`;
            const snap = [
              [-10, 3.4],
              [1, -3],
              [13, 2.4],
            ]
              .map(strand)
              .join('');
            const stay = [
              [-4.5, -2.6],
              [7, 3.2],
            ]
              .map(strand)
              .join('');
            for (const [d, cls] of [
              [snap, 'pz-snap'],
              [stay, 'pz-stay'],
            ]) {
              H.s('path', { d, class: 'pz-strand-edge ' + cls }, sg);
              H.s('path', { d, class: 'pz-strand ' + cls }, sg);
            }
            const body = H.s('g', { class: 'pz-body' }, g);
            H.s(
              'path',
              { d: H.sector(R.s0 + 1, R.crust - 1, sl.a0 + 1.4, sl.a1 - 1.4), class: 'pz-lift-shadow' },
              body,
            );
            const pie = H.s('g', { class: 'pz-pie' }, body);
            const bumps = (a) => R.crust + 1.6 * Math.sin(H.rad((a - sl.a0) * 8)) + (rand() - 0.5) * 0.6;
            H.s(
              'path',
              { d: wedge(H, R.s0, sl.a0, sl.a1, bumps, GAPS), fill: `url(#${uid}-crust)`, class: 'pz-crust' },
              pie,
            );
            H.s('path', { d: wedge(H, R.s0, sl.a0, sl.a1, () => R.sauce, GAPS + 1), class: 'pz-sauce' }, pie);
            const melt = (a) =>
              R.cheese + 2.6 * Math.sin(H.rad((a - sl.a0) * 11 + sl.i * 40)) + 1.6 * Math.sin(H.rad((a - sl.a0) * 23));
            const cheese = wedge(H, R.s0, sl.a0, sl.a1, melt, GAPS + 1);
            H.s('path', { d: cheese, class: 'pz-cheese' }, pie);
            // Toasted spots and charred bubbles on the crust, browned bits and sheen on the cheese.
            let ch = '',
              fl = '',
              br = '',
              hi = '';
            const share = Math.min(4, (sl.a1 - sl.a0) / 45);
            for (let k = 0; k < 7 * share; k++) {
              const a = sl.a0 + 2 + rand() * (sl.a1 - sl.a0 - 4);
              const [x, y] = H.polar(R.sauce + 3 + rand() * (R.crust - R.sauce - 5), a);
              ch += dot(x, y, 0.8 + rand() * 1.6);
            }
            for (let k = 0; k < 6 * share; k++) {
              const a = sl.a0 + 2 + rand() * (sl.a1 - sl.a0 - 4);
              const [x, y] = H.polar(R.sauce + 4 + rand() * (R.crust - R.sauce - 6), a);
              fl += dot(x, y, 0.5 + rand() * 0.6);
            }
            for (let k = 0; k < 4 * share; k++) {
              const a = sl.a0 + 4 + rand() * (sl.a1 - sl.a0 - 8);
              const [x, y] = H.polar(R.cheese - 8 - rand() * 18, a);
              br += dot(x, y, 1.6 + rand() * 2.4);
            }
            for (let k = 0; k < 3 * share; k++) {
              const a = sl.a0 + 5 + rand() * (sl.a1 - sl.a0 - 10);
              const [x, y] = H.polar(R.s0 + 12 + rand() * 30, a);
              hi += dot(x, y, 2 + rand() * 2.5);
            }
            H.s('path', { d: ch, class: 'pz-char' }, pie);
            H.s('path', { d: fl, class: 'pz-flour' }, pie);
            H.s('path', { d: br, class: 'pz-brown' }, pie);
            H.s('path', { d: hi, class: 'pz-cheese-hi' }, pie);
            // The label first, then toppings around its box.
            const c = H.s('g', { class: 'pz-content' }, pie);
            const maxWidth = room(H, sl, R.s0, R.cheese, 5);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 23,
                subSize: 13.5,
                gap: 1,
                maxWidth,
                minSize: 11,
                cls: 'pz-lbl pz-fmt',
                subCls: 'pz-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 15,
                gap: 2,
                maxWidth,
                minSize: 8.5,
                cls: 'pz-lbl pz-word',
                sub: null,
              });
            }
            let bb = null;
            try {
              bb = c.getBBox();
            } catch (e) {
              bb = null;
            }
            const [lx, ly] = H.polar(R.lbl, sl.mid);
            const box =
              bb && bb.width
                ? { cx: bb.x + bb.width / 2, cy: bb.y + bb.height / 2, hw: bb.width / 2 + 2, hh: bb.height / 2 }
                : { cx: lx, cy: ly, hw: 38, hh: 22 };
            const tp = toppings(H, sl, rand, box);
            const tg = H.s('g', { class: 'pz-tops' });
            pie.insertBefore(tg, c);
            H.s('path', { d: tp.herb, class: 'pz-herb' }, tg);
            H.s('path', { d: tp.pepper, class: 'pz-pepper' }, tg);
            H.s('path', { d: tp.pep, class: 'pz-pep' }, tg);
            H.s('path', { d: tp.pepDot, class: 'pz-pep-dot' }, tg);
            H.s('path', { d: tp.olive, class: 'pz-olive' }, tg);
            H.s('path', { d: tp.basil, class: 'pz-basil' }, tg);
            H.s('path', { d: tp.vein, class: 'pz-vein' }, tg);
            if (sl.off) pie.insertBefore(H.s('path', { d: cheese, class: 'pz-off' }), c);
          }

          // The hub: a ball of fresh mozzarella with a basil leaf.
          const hub = H.s('g', { class: 'pz-hub' }, root);
          H.s('circle', { cx: 200, cy: 200, r: R.hub, fill: `url(#${uid}-hub)`, class: 'pz-mozz' }, hub);
          const lf = leaf(176, 166, 22, 8, -40);
          H.s('path', { d: lf.body, class: 'pz-basil' }, hub);
          H.s('path', { d: lf.vein, class: 'pz-vein' }, hub);
          // Without a key (a ring opened from the menu) the name and the file sit in the middle.
          const low = m.key ? 0 : 8;
          H.label(hub, 200, 185 + low, m.title, { maxWidth: 80, size: 15, minSize: 9, cls: 'pz-title', maxLines: 1 });
          H.label(hub, 200, 202 + low, m.file, {
            maxWidth: 76,
            size: 12,
            minSize: 9,
            cls: 'pz-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.2;
            H.s('rect', { x: f2(200 - kw / 2), y: 211, width: f2(kw), height: 15, rx: 4, class: 'pz-key' }, hub);
            H.text(hub, 200, 219, m.key, { class: 'pz-keytext' });
          }
        },
      },

      sounds: {
        // The pie scrapes onto the peel, with a soft knock.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'lowpass', f: 500, f2: 1600, q: 0.9, dur: 0.14, gain: 0.13, a: 0.02 });
          X.tone(ac, out, t + 0.1, { type: 'sine', f: 210, f2: 170, dur: 0.06, gain: 0.07, a: 0.003 });
        },
        // A crisp crackle of crust.
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'highpass', f: 3800, q: 1, dur: 0.009, gain: 0.12 });
          X.burst(ac, out, t + 0.006, { type: 'bandpass', f: 1900, q: 3, dur: 0.007, gain: 0.08 });
        },
        // A stretchy squelch, rising, then a small snap.
        success(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 760, f2: 330, q: 4, dur: 0.22, gain: 0.11, a: 0.015 });
          X.tone(ac, out, t + 0.02, { type: 'triangle', f: 150, f2: 320, dur: 0.32, gain: 0.05, a: 0.03 });
          X.tone(ac, out, t + 0.04, { type: 'sine', f: 300, f2: 640, dur: 0.28, gain: 0.025, a: 0.03 });
          X.burst(ac, out, t + 0.36, { type: 'highpass', f: 2800, q: 1.2, dur: 0.014, gain: 0.08 });
          X.tone(ac, out, t + 0.37, { type: 'sine', f: 520, f2: 380, dur: 0.05, gain: 0.03, a: 0.002 });
        },
      },
    });
  })();
}
