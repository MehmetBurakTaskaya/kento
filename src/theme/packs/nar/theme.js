// SPDX-License-Identifier: MIT
// Theme: Nar. A pomegranate cut open: a leathery skin with a small crown, pale membranes, and
// every slice a compartment packed with glossy arils around a clearing that holds its label.
// Applying empties the compartment: the arils spill out and roll away, glinting.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const ID = 'nar';
    // Radii in the 400 x 400 view box. The crown rises above the skin at twelve o'clock.
    const R = { hub: 50, c0: 56, c1: 166, pith: 171, skin: 182, lbl: 113 };
    const GAP = 6;

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
    // The effect plays only while the wheel is applying: with reduced motion the app never sets it.
    const applying = (root) => {
      const wheel = root.closest('.wheel');
      return !!wheel && wheel.classList.contains('is-applying');
    };
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
    const dot = (x, y, r) =>
      `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
    // An ellipse as path data, rotated by rot degrees.
    function oval(cx, cy, rx, ry, rot) {
      const t = (rot * Math.PI) / 180;
      const dx = Math.cos(t) * rx,
        dy = Math.sin(t) * rx;
      return `M${f2(cx + dx)} ${f2(cy + dy)}A${f2(rx)} ${f2(ry)} ${f2(rot)} 1 0 ${f2(cx - dx)} ${f2(cy - dy)}A${f2(rx)} ${f2(ry)} ${f2(rot)} 1 0 ${f2(cx + dx)} ${f2(cy + dy)}Z`;
    }
    function stop(grad, H, offset, token, op) {
      H.s('stop', { offset, style: `stop-color: var(${token})${op != null ? `; stop-opacity: ${op}` : ''}` }, grad);
    }

    // A compartment: a sector with soft corners, its sides held GAP apart.
    function cell(H, r0, r1, a0, a1, gap, k) {
      const g = (r) => ((gap / 2 / r) * 180) / Math.PI;
      const P = (r, a) => H.polar(r, a).map(f2).join(' ');
      const ka = (((k * 1.2) / r1) * 180) / Math.PI;
      const s0 = a0 + g(r1),
        s1 = a1 - g(r1);
      const k0 = (((k * 0.8) / r0) * 180) / Math.PI;
      const i0 = a0 + g(r0),
        i1 = a1 - g(r0);
      return (
        `M${P(r0 + k * 0.8, a0 + g(r0 + k * 0.8))}L${P(r1 - k, a0 + g(r1 - k))}Q${P(r1, s0)} ${P(r1, s0 + ka)}` +
        `A${r1} ${r1} 0 0 1 ${P(r1, s1 - ka)}Q${P(r1, s1)} ${P(r1 - k, a1 - g(r1 - k))}` +
        `L${P(r0 + k * 0.8, a1 - g(r0 + k * 0.8))}Q${P(r0, i1)} ${P(r0, i1 - k0)}A${r0} ${r0} 0 0 0 ${P(r0, i0 + k0)}Q${P(r0, i0)} ${P(r0 + k * 0.8, a0 + g(r0 + k * 0.8))}Z`
      );
    }

    // Arils packed into a compartment around a clearing that fits the label box `box`: centers are
    // scattered first, then every aril grows until it touches a neighbour, a wall or the clearing,
    // so they sit squeezed together like the real thing.
    function pack(H, sl, rand, box) {
      const pts = [];
      const boxDist = (x, y) => {
        const dx = Math.max(Math.abs(x - box.cx) - box.hw, 0);
        const dy = Math.max(Math.abs(y - box.cy) - box.hh, 0);
        return Math.sqrt(dx * dx + dy * dy);
      };
      const wall = (r, a) => {
        const side = Math.min(a - sl.a0, sl.a1 - a);
        return Math.min(r * Math.sin(H.rad(side)) - GAP / 2, r - R.c0, R.c1 - r) - 0.8;
      };
      // As many arils per degree whatever the number of compartments; a grid of 12-unit cells keeps
      // the neighbour checks short on the wide compartments of a wheel with few slices.
      const share = Math.min(4, (sl.a1 - sl.a0) / 45);
      const cells = new Map();
      const cellOf = (x, y) => `${Math.floor(x / 12)},${Math.floor(y / 12)}`;
      const around = (x, y) => {
        const cx = Math.floor(x / 12);
        const cy = Math.floor(y / 12);
        const out = [];
        for (let i = -1; i <= 1; i++)
          for (let j = -1; j <= 1; j++) out.push(...(cells.get(`${cx + i},${cy + j}`) ?? []));
        return out;
      };
      for (let k = 0; k < 2400 * share && pts.length < 64 * share; k++) {
        const r = R.c0 + 5 + rand() * (R.c1 - R.c0 - 10);
        const a = sl.a0 + rand() * (sl.a1 - sl.a0);
        const [x, y] = H.polar(r, a);
        if (wall(r, a) < 4.6 || boxDist(x, y) < 9) continue;
        if (around(x, y).some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 11.8 * 11.8)) continue;
        const p = { x, y, rad: r, a };
        pts.push(p);
        const key = cellOf(x, y);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(p);
      }
      return pts
        .map((p) => {
          let near = Infinity;
          for (const q of around(p.x, p.y)) if (q !== p) near = Math.min(near, Math.hypot(p.x - q.x, p.y - q.y));
          const r = Math.min(9.5, near / 2 + 0.9, wall(p.rad, p.a) + 1.2, boxDist(p.x, p.y) - 3);
          return { x: p.x, y: p.y, r, e: 0.8 + rand() * 0.14, rot: rand() * 180, rad: p.rad };
        })
        .filter((p) => p.r >= 4.2);
    }
    function arilPaths(list) {
      let body = '',
        shade = '',
        hi = '',
        socket = '';
      for (const p of list) {
        shade += oval(p.x + 0.9, p.y + 1.3, p.r, p.r * p.e, p.rot);
        body += oval(p.x, p.y, p.r * 0.94, p.r * p.e * 0.9, p.rot);
        hi += oval(p.x - p.r * 0.34, p.y - p.r * 0.36, p.r * 0.3, p.r * 0.17, -38);
        socket += oval(p.x, p.y, p.r * 0.86, p.r * p.e * 0.84, p.rot);
      }
      return { body, shade, hi, socket };
    }

    // A four-point glint.
    const glint = (s) =>
      `M0 ${-s}L${f2(s * 0.22)} ${f2(-s * 0.22)}L${s} 0L${f2(s * 0.22)} ${f2(s * 0.22)}L0 ${s}L${f2(-s * 0.22)} ${f2(s * 0.22)}L${-s} 0L${f2(-s * 0.22)} ${f2(-s * 0.22)}Z`;

    // The crown (calyx) on top of the fruit, in view box units, its base on the skin at twelve.
    function crownPath() {
      return (
        'M181 28C180 21 177 15 171 7C178 9 182 12 185 15C186 9 188 4 192 0C195 6 197 10 198 14C199 9 200 5 200 2' +
        'C200 5 201 9 202 14C203 10 205 6 208 0C212 4 214 9 215 15C218 12 222 9 229 7C223 15 220 21 219 28Z'
      );
    }

    Board.define({
      id: ID,
      fonts: {
        brand: "'Figtree'",
        display: "'Gloock'",
        load: ["'Figtree'", "'Gloock'"],
        credits: [
          { family: 'Gloock', license: 'SIL Open Font License 1.1' },
          { family: 'Figtree', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 120, stagger: 14, apply: 680 },
      palette: {
        light: {
          bg: '#fbf6f8',
          surface: '#ffffff',
          'surface-2': '#f8eef2',
          border: '#ecd7df',
          'border-strong': '#c99aab',
          text: '#2a0d17',
          'text-muted': '#6b4a57',
          accent: '#a3122f',
          'on-accent': '#ffffff',
          focus: '#a3122f',
          success: '#2e7d4f',
          'on-success': '#ffffff',
          'success-text': '#23663f',
          warning: '#b86e00',
          'warning-text': '#7a4800',
          danger: '#c0262d',
          desk: 'radial-gradient(120% 100% at 30% 12%, #ffffff 0%, #f5edf3 45%, #e5d6e3 100%)',
          'wheel-face': '#f6e2c6',
          'wheel-slice': '#fbeedd',
          'wheel-slice-hover': '#ffd8de',
          'wheel-slice-selected': '#9b0f2e',
          'wheel-text': '#6e0a20',
          'wheel-text-selected': '#fff4f6',
          'wheel-line': '#e8caa0',
          'wheel-shadow': 'rgba(90, 20, 50, 0.28)',
          'nr-membrane': '#ecd2ab',
          'nr-aril': '#c8173f',
          'nr-aril-hov': '#e3204c',
          'nr-aril-shade': '#6e0720',
          'nr-aril-hi': '#ffffff',
          'nr-hi-op': '0.78',
          'nr-socket': '#d9576f',
          'nr-skin': '#a8142e',
          'nr-skin-hi': '#dd5a5f',
          'nr-skin-edge': '#6a0a1c',
          'nr-speck': '#f6c784',
          'nr-speck-dark': '#5e0716',
          'nr-crown': '#93132c',
          'nr-crown-tip': '#e58a7a',
          'nr-crown-in': '#3f0410',
          'nr-sub': '#7d2337',
          'nr-sub-sel': '#ffdbe2',
          'nr-hub': '#f8e7cf',
          'nr-hub-edge': '#e3c497',
          'nr-hub-text': '#6e0a20',
          'nr-hub-sub': '#7d4a3c',
          'nr-key': '#9b0f2e',
          'nr-key-text': '#fff4f6',
          'nr-glint': '#ffffff',
        },
        dark: {
          bg: '#140a12',
          surface: '#1f1220',
          'surface-2': '#2a1729',
          border: '#3d2238',
          'border-strong': '#643a5a',
          text: '#fbeef2',
          'text-muted': '#c9a9b8',
          accent: '#ff6b88',
          'on-accent': '#2a0610',
          focus: '#ff9fb3',
          success: '#6fd39a',
          'on-success': '#062214',
          'success-text': '#86e0ad',
          warning: '#ffbf5a',
          'warning-text': '#ffd080',
          danger: '#ff6b7d',
          desk: 'radial-gradient(110% 100% at 70% 10%, #301530 0%, #1a0b1c 50%, #0b050d 100%)',
          'wheel-face': '#3a1527',
          'wheel-slice': '#2b0e1e',
          'wheel-slice-hover': '#521838',
          'wheel-slice-selected': '#ff5a7a',
          'wheel-text': '#ffe4ea',
          'wheel-text-selected': '#2a0610',
          'wheel-line': '#4a2033',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'nr-membrane': '#1c0814',
          'nr-aril': '#e3214c',
          'nr-aril-hov': '#ff4a70',
          'nr-aril-shade': '#5c0420',
          'nr-aril-hi': '#ffe0e8',
          'nr-hi-op': '0.85',
          'nr-socket': '#8a2a4a',
          'nr-skin': '#5e0b20',
          'nr-skin-hi': '#9a2238',
          'nr-skin-edge': '#2a0310',
          'nr-speck': '#d98a7a',
          'nr-speck-dark': '#24020c',
          'nr-crown': '#4e0819',
          'nr-crown-tip': '#b8495a',
          'nr-crown-in': '#140107',
          'nr-sub': '#ffb7c6',
          'nr-sub-sel': '#4a0a18',
          'nr-hub': '#2b0e1e',
          'nr-hub-edge': '#5c2140',
          'nr-hub-text': '#ffe4ea',
          'nr-hub-sub': '#e7a5b5',
          'nr-key': '#ff5a7a',
          'nr-key-text': '#2a0610',
          'nr-glint': '#fff2f6',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['nr-sub', 'wheel-slice', 'text'],
        ['nr-sub', 'wheel-slice-hover', 'text'],
        ['nr-sub-sel', 'wheel-slice-selected', 'text'],
        ['nr-hub-text', 'nr-hub', 'text'],
        ['nr-hub-sub', 'nr-hub', 'text'],
        ['nr-key-text', 'nr-key', 'text'],
      ],

      // Gradients are built per wheel in render(): they read the palette tokens of their own card.
      defs: '',

      wheel: {
        render(root, m, H) {
          const uid = H.uid(ID);
          const rand = rng(4242 + m.n);
          const defs = H.s('defs', {}, root);
          const sk = H.s(
            'radialGradient',
            { id: `${uid}-skin`, gradientUnits: 'userSpaceOnUse', cx: 168, cy: 150, r: 240 },
            defs,
          );
          stop(sk, H, 0.45, '--nr-skin-hi');
          stop(sk, H, 0.72, '--nr-skin');
          stop(sk, H, 0.9, '--nr-skin-edge');
          const sh = H.s(
            'radialGradient',
            { id: `${uid}-shadow`, gradientUnits: 'userSpaceOnUse', cx: 205, cy: 211, r: R.skin + 14 },
            defs,
          );
          stop(sh, H, 0.86, '--wheel-shadow');
          stop(sh, H, 1, '--wheel-shadow', 0);
          const cr = H.s(
            'linearGradient',
            { id: `${uid}-crown`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 0, y2: 30 },
            defs,
          );
          stop(cr, H, 0, '--nr-crown-tip');
          stop(cr, H, 0.6, '--nr-crown');

          // Shadow, the leathery skin with a slightly lobed edge, speckles, and the membrane.
          const fruit = H.s('g', { class: 'nr-fruit', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: 205, cy: 211, r: R.skin + 14, fill: `url(#${uid}-shadow)` }, fruit);
          let edge = '';
          for (let k = 0; k <= 180; k++) {
            const a = k * 2;
            const r = R.skin + 1.6 * Math.cos(H.rad(a * 6)) + 0.5 * Math.sin(k * 1.9);
            const [x, y] = H.polar(r, a);
            edge += (k ? 'L' : 'M') + f2(x) + ' ' + f2(y);
          }
          H.s('path', { d: edge + 'Z', fill: `url(#${uid}-skin)`, class: 'nr-skin' }, fruit);
          let spl = '';
          let spd = '';
          for (let k = 0; k < 150; k++) {
            const a = rand() * 360;
            const r = R.pith + 2 + rand() * (R.skin - R.pith - 3.5);
            const [x, y] = H.polar(r, a);
            if (rand() < 0.62) spl += dot(x, y, 0.35 + rand() * 0.55);
            else spd += dot(x, y, 0.3 + rand() * 0.5);
          }
          H.s('path', { d: spl, class: 'nr-speck' }, fruit);
          H.s('path', { d: spd, class: 'nr-speck-dark' }, fruit);
          H.s('circle', { cx: 200, cy: 200, r: R.pith, class: 'nr-membrane' }, fruit);

          // Compartments.
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.hub, R.skin, sl.a0, sl.a1), class: 'nr-hit' }, g);
            const body = H.s('g', { class: 'nr-body' }, g);
            const shape = cell(H, R.c0, R.c1, sl.a0, sl.a1, GAP, 8);
            H.s('path', { d: shape, class: 'nr-cell' }, body);
            // The label first: its box decides the clearing the arils leave free.
            const c = H.s('g', { class: 'nr-content' }, body);
            const maxWidth = room(H, sl, R.c0, R.c1, 6);
            if (sl.format) {
              H.block(c, sl, R.lbl, {
                size: 26,
                subSize: 12.5,
                gap: 1,
                maxWidth,
                minSize: 11,
                cls: 'nr-lbl nr-fmt',
                subCls: 'nr-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 14,
                gap: 2,
                maxWidth,
                minSize: 8.5,
                cls: 'nr-lbl nr-word',
                sub: null,
              });
            }
            let bb;
            try {
              bb = c.getBBox();
            } catch (e) {
              bb = null;
            }
            const [lx, ly] = H.polar(R.lbl, sl.mid);
            const box =
              bb && bb.width
                ? { cx: bb.x + bb.width / 2, cy: bb.y + bb.height / 2, hw: bb.width / 2 + 2, hh: bb.height / 2 - 0.5 }
                : { cx: lx, cy: ly, hw: 36, hh: 22 };
            const list = pack(H, sl, rand, box);
            g.__arils = list;
            const p = arilPaths(list);
            body.insertBefore(H.s('path', { d: p.socket, class: 'nr-socket' }), c);
            const ar = H.s('g', { class: 'nr-arils' });
            body.insertBefore(ar, c);
            H.s('path', { d: p.shade, class: 'nr-aril-shade' }, ar);
            H.s('path', { d: p.body, class: 'nr-aril' }, ar);
            H.s('path', { d: p.hi, class: 'nr-aril-hi' }, ar);
            if (sl.off) body.insertBefore(H.s('path', { d: shape, class: 'nr-off' }), c);
            H.s('g', { class: 'nr-fx' }, g);
          }

          // The crown at twelve o'clock, then the spongy core with the name, file and key.
          const crown = H.s('g', { class: 'nr-crown', 'aria-hidden': 'true' }, root);
          H.s('path', { d: crownPath(), fill: `url(#${uid}-crown)`, class: 'nr-crown-body' }, crown);
          H.s(
            'path',
            {
              d: 'M186 18C190 15 196 14 200 14C204 14 210 15 214 18C210 21 205 22 200 22C195 22 190 21 186 18Z',
              class: 'nr-crown-in',
            },
            crown,
          );
          const hub = H.s('g', { class: 'nr-hub' }, root);
          H.s('circle', { cx: 200, cy: 200, r: R.hub, class: 'nr-core' }, hub);
          // Without a key (a ring opened from the menu) the name and the file sit in the middle.
          const low = m.key ? 0 : 8;
          H.label(hub, 200, 183 + low, m.title, { maxWidth: 86, size: 17, minSize: 9, cls: 'nr-title', maxLines: 1 });
          H.label(hub, 200, 201 + low, m.file, {
            maxWidth: 80,
            size: 11.5,
            minSize: 9,
            cls: 'nr-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          if (m.key) {
            const kw = 14 + m.key.length * 6.4;
            H.s('rect', { x: f2(200 - kw / 2), y: 211, width: f2(kw), height: 16, rx: 8, class: 'nr-key' }, hub);
            H.text(hub, 200, 219.5, m.key, { class: 'nr-keytext' });
          }
        },

        // The arils of the chosen compartment are cloned one by one and sent rolling out; the
        // compartment itself already shows its emptied, stained state. Glints flash on a few.
        onSelect(root, m, i, H, t) {
          root.querySelectorAll('.nr-fx').forEach((n) => (n.textContent = ''));
          if (t == null && !applying(root)) return;
          const g = root.querySelector(`.slice[data-slice="${i}"]`);
          const sl = m.slices[i];
          const fx = g.querySelector('.nr-fx');
          const rand = rng(17 + i * 31);
          const t0 = H.rad(sl.mid);
          const ux = Math.sin(t0);
          const uy = -Math.cos(t0);
          const list = g.__arils || [];
          list.forEach((p) => {
            const at = H.s('g', { transform: `translate(${f2(p.x)} ${f2(p.y)})` }, fx);
            // Outer arils leave first; each gets its own push, spin and drop.
            const out = (p.rad - R.c0) / (R.c1 - R.c0);
            const dist = 34 + rand() * 46 + out * 18;
            const side = (rand() - 0.5) * 44;
            const d = Math.round((1 - out) * 120 + rand() * 50) + 'ms';
            const roll = H.s('g', { class: 'nr-roll' }, at);
            roll.style.setProperty('--dx', f2(ux * dist - uy * side) + 'px');
            roll.style.setProperty('--dy', f2(uy * dist + ux * side) + 'px');
            roll.style.setProperty('--d', d);
            const fall = H.s('g', { class: 'nr-drop' }, roll);
            fall.style.setProperty('--fall', f2(18 + rand() * 30) + 'px');
            const spin = H.s('g', { class: 'nr-spin' }, fall);
            spin.style.setProperty('--spin', Math.round((rand() < 0.5 ? -1 : 1) * (160 + rand() * 260)) + 'deg');
            H.s('path', { d: oval(0.9, 1.3, p.r, p.r * p.e, p.rot), class: 'nr-aril-shade' }, spin);
            H.s('path', { d: oval(0, 0, p.r * 0.94, p.r * p.e * 0.9, p.rot), class: 'nr-aril' }, spin);
            H.s('path', { d: oval(-p.r * 0.34, -p.r * 0.36, p.r * 0.3, p.r * 0.17, -38), class: 'nr-aril-hi' }, spin);
          });
          // Glints flash along the arils' way out.
          for (let k = 0; k < 6 && list.length; k++) {
            const p = list[Math.floor(rand() * list.length)];
            const dist = 14 + rand() * 44;
            const gx = p.x + ux * dist + (rand() - 0.5) * 20;
            const gy = p.y + uy * dist + (rand() - 0.5) * 20;
            const at = H.s('g', { transform: `translate(${f2(gx)} ${f2(gy)})` }, fx);
            const gl = H.s('path', { d: glint(5 + rand() * 4), class: 'nr-glint' }, at);
            gl.style.setProperty('--d', Math.round(90 + k * 70 + rand() * 40) + 'ms');
          }
          if (t != null) return;
          clearTimeout(root.__nrFx);
          root.__nrFx = setTimeout(() => (fx.textContent = ''), 760);
        },
      },

      sounds: {
        // A leathery crack of the skin.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 700, f2: 280, q: 2.6, dur: 0.12, gain: 0.16, a: 0.004 });
          X.burst(ac, out, t + 0.012, { type: 'highpass', f: 3200, q: 0.8, dur: 0.025, gain: 0.07 });
          X.tone(ac, out, t, { type: 'sine', f: 140, f2: 95, dur: 0.08, gain: 0.06, a: 0.003 });
        },
        // A small glassy bead.
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'sine', f: 1760, dur: 0.05, gain: 0.055, a: 0.001 });
          X.tone(ac, out, t, { type: 'sine', f: 2794, dur: 0.028, gain: 0.022, a: 0.001 });
        },
        // A patter of beads spilling, and a faint shimmer.
        success(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 900, q: 2, dur: 0.05, gain: 0.08 });
          [2093, 1760, 2349, 1568, 1976, 2637, 1661, 2217, 1865, 2489, 1480, 2093].forEach((f, k) => {
            const d = 0.03 + k * 0.032 + ((k * 7) % 5) * 0.006;
            X.tone(ac, out, t + d, {
              type: k % 2 ? 'triangle' : 'sine',
              f,
              dur: 0.035,
              gain: 0.05 - k * 0.0028,
              a: 0.001,
            });
          });
          X.tone(ac, out, t + 0.22, { type: 'sine', f: 3520, dur: 0.3, gain: 0.016, a: 0.03 });
          X.tone(ac, out, t + 0.3, { type: 'sine', f: 5274, dur: 0.24, gain: 0.01, a: 0.03 });
        },
      },
    });
  })();
}
