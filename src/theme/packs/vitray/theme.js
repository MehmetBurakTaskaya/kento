// SPDX-License-Identifier: MIT
// Vitray: the wheel as a rose window. Each slice is a lancet petal of coloured glass in lead
// cames, set in stone tracery round a glass roundel. Daylight makes the glass pale and bright;
// at night it glows deep. Applying a slice sends a beam of light through its pane, down to a
// pool of its colour on the centre, with a small bell.
export default function register(Board) {
  (function () {
    'use strict';

    const ID = 'vitray';
    const f2 = (n) => Math.round(n * 100) / 100;

    if (typeof document !== 'undefined' && document.fonts) {
      for (const f of [
        "600 16px 'Cinzel'",
        "700 16px 'Cinzel'",
        "500 16px 'Vollkorn Variable'",
        "600 16px 'Vollkorn Variable'",
      ]) {
        document.fonts.load(f, 'AaĞşı').catch(() => null);
      }
    }

    // Radii in the 400 x 400 view box.
    const R = {
      outer: 198,
      ring: 184,
      hubStone: 70,
      hub: 62,
      inner: 73,
      shoulder: 146,
      apex: 181,
      med: 124,
      medR: 35,
      eye: 168.5,
      eyeR: 6.2,
      roundel: 170,
    };
    const MULLION = 3.6; // half the width of the stone between two petals
    const MED = ['cobalt', 'ruby', 'emerald', 'violet'];
    const SIDE = ['ruby', 'cobalt', 'violet', 'emerald'];
    // Colours go round the rose in turn; a last pane that would meet the first in the same colour
    // takes another one.
    function glassOf(list, i, n) {
      return list[n > 1 && n % list.length === 1 && i === n - 1 ? 2 : i % list.length];
    }
    // The medallion grows with its petal: eight narrow lancets hold a small one under an eye, two to
    // four wide lobes a large one. Returns its radius, the radius of its centre and whether the eye fits.
    function medallion(sl) {
      const r = sl.step >= 100 ? 48 : sl.step >= 70 ? 43 : 38;
      return { r, at: r > 40 ? 124 : 122, eye: r <= 40 };
    }

    // A point at radius r, `off` units to the side of the line at angle a (positive = clockwise).
    function offsetPt(H, r, a, off) {
      return H.polar(r, a + (Math.asin(Math.max(-1, Math.min(1, off / r))) * 180) / Math.PI);
    }
    const P = (p) => `${f2(p[0])} ${f2(p[1])}`;

    // A lancet petal between the slice lines, ending in a pointed arch.
    function petal(H, sl, inset = 0) {
      const m = MULLION + inset;
      const L0 = offsetPt(H, R.inner + inset, sl.a0, m);
      const L1 = offsetPt(H, R.shoulder, sl.a0, m);
      const A = H.polar(R.apex - inset * 1.2, sl.mid);
      const R1 = offsetPt(H, R.shoulder, sl.a1, -m);
      const R0 = offsetPt(H, R.inner + inset, sl.a1, -m);
      const c1 = offsetPt(H, R.shoulder + 16, sl.a0, m + 2);
      const c2 = H.polar(R.apex - 4 - inset, sl.mid - sl.step * 0.13);
      const c3 = H.polar(R.apex - 4 - inset, sl.mid + sl.step * 0.13);
      const c4 = offsetPt(H, R.shoulder + 16, sl.a1, -m - 2);
      const ri = R.inner + inset;
      return `M${P(L0)}L${P(L1)}C${P(c1)} ${P(c2)} ${P(A)}C${P(c3)} ${P(c4)} ${P(R1)}L${P(R0)}A${ri} ${ri} 0 0 0 ${P(L0)}Z`;
    }

    // A quatrefoil: four lobes of radius rr whose centres sit d from (x, y), turned by rot degrees.
    function quatrefoil(x, y, d, rr, rot) {
      const t = (d - Math.sqrt(Math.max(0, 2 * rr * rr - d * d))) / 2; // cusp between two lobes, along the diagonal
      const cusp = (k) => {
        const a = ((rot + 45 + k * 90) * Math.PI) / 180;
        const r = t * Math.SQRT2;
        return [x + r * Math.sin(a), y - r * Math.cos(a)];
      };
      let dd = `M${P(cusp(-1))}`;
      for (let k = 0; k < 4; k++) dd += `A${rr} ${rr} 0 1 1 ${P(cusp(k))}`;
      return dd + 'Z';
    }

    Board.define({
      id: ID,
      fonts: {
        brand: "'Vollkorn Variable'",
        display: "'Cinzel'",
        load: ["'Cinzel'", "'Vollkorn Variable'"],
        credits: [
          { family: 'Cinzel', license: 'SIL Open Font License 1.1' },
          { family: 'Vollkorn', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 120, stagger: 14, apply: 680 },

      palette: {
        light: {
          bg: '#efeeeb',
          surface: '#ffffff',
          'surface-2': '#f5f4f1',
          border: '#dcd9d2',
          'border-strong': '#aaa59a',
          text: '#1f1c33',
          'text-muted': '#575269',
          accent: '#3a3f9e',
          'on-accent': '#ffffff',
          focus: '#3a3f9e',
          success: '#1f7f4f',
          'on-success': '#ffffff',
          'success-text': '#1a6c43',
          warning: '#b06f10',
          'warning-text': '#774a06',
          danger: '#b8323f',
          desk: 'linear-gradient(175deg, #ebeae6 0%, #dedbd4 100%)',
          'wheel-face': '#e6e1d6',
          'wheel-slice': '#b3c6f5',
          'wheel-slice-hover': '#c9d7f8',
          'wheel-slice-selected': '#b3c6f5',
          'wheel-text': '#1d1a36',
          'wheel-sub': '#353058',
          'wheel-text-selected': '#1d1a36',
          'wheel-line': '#3b3946',
          'wheel-shadow': 'rgba(60, 55, 45, 0.28)',
          stone: '#e6e1d6',
          'stone-hi': '#f5f2ec',
          'stone-lo': '#c9c2b3',
          lead: '#3b3946',
          came: '#c7951f',
          'g-ruby': '#f3b3bf',
          'g-ruby-hi': '#ffdbe2',
          'g-ruby-lo': '#e8909f',
          'g-cobalt': '#b3c6f5',
          'g-cobalt-hi': '#dde7ff',
          'g-cobalt-lo': '#8fa9ea',
          'g-emerald': '#b0e2c6',
          'g-emerald-hi': '#ddf6e8',
          'g-emerald-lo': '#86cfa7',
          'g-violet': '#d4c2f2',
          'g-violet-hi': '#eee5ff',
          'g-violet-lo': '#b9a0e6',
          'g-teal': '#a6dfdc',
          'g-teal-hi': '#d6f5f3',
          'g-gold': '#f6d98a',
          'g-gold-hi': '#fff2c6',
          'g-gold-lo': '#ebc25a',
          'g-hub': '#fbefc6',
          'g-hub-hi': '#fffaea',
          'g-ruby-beam': '#e27a8d',
          'g-cobalt-beam': '#7392e4',
          'g-emerald-beam': '#5fc192',
          'g-violet-beam': '#a888e2',
          'hover-glow': 'rgba(255, 255, 255, 0.4)',
          'sel-glow': 'rgba(255, 252, 236, 0.6)',
          ray: 'rgba(255, 214, 120, 0.95)',
          'other-shade': 'rgba(52, 46, 40, 0.16)',
        },
        dark: {
          bg: '#121222',
          surface: '#1a1a2e',
          'surface-2': '#22223a',
          border: '#33334f',
          'border-strong': '#56567a',
          text: '#f4efe4',
          'text-muted': '#b2adbf',
          accent: '#f2c44a',
          'on-accent': '#1b1606',
          focus: '#f2c44a',
          success: '#6fd39a',
          'on-success': '#0b2214',
          'success-text': '#7fdca6',
          warning: '#f2b84a',
          'warning-text': '#f5c66c',
          danger: '#ff7f8c',
          desk: 'radial-gradient(120% 95% at 50% 10%, #22223c 0%, #141428 60%, #0d0d1c 100%)',
          'wheel-face': '#2c2b3a',
          'wheel-slice': '#1d3a9c',
          'wheel-slice-hover': '#30478f',
          'wheel-slice-selected': '#1d3a9c',
          'wheel-text': '#fff6e2',
          'wheel-sub': '#f3e5c8',
          'wheel-text-selected': '#fff6e2',
          'wheel-line': '#0e0d14',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          stone: '#2e2d3d',
          'stone-hi': '#45445a',
          'stone-lo': '#1e1d29',
          lead: '#0e0d14',
          came: '#f2c44a',
          'g-ruby': '#8c1631',
          'g-ruby-hi': '#c8445f',
          'g-ruby-lo': '#5c0d20',
          'g-cobalt': '#1d3a9c',
          'g-cobalt-hi': '#4570dc',
          'g-cobalt-lo': '#122566',
          'g-emerald': '#0f6646',
          'g-emerald-hi': '#2fa576',
          'g-emerald-lo': '#08412c',
          'g-violet': '#4f2687',
          'g-violet-hi': '#8456c6',
          'g-violet-lo': '#321657',
          'g-teal': '#0d6872',
          'g-teal-hi': '#2aa8b2',
          'g-gold': '#cf9418',
          'g-gold-hi': '#f7cc56',
          'g-gold-lo': '#8f630c',
          'g-hub': '#24215c',
          'g-hub-hi': '#3a3690',
          'g-ruby-beam': '#d9566f',
          'g-cobalt-beam': '#5a84ec',
          'g-emerald-beam': '#3cb886',
          'g-violet-beam': '#9466d6',
          'hover-glow': 'rgba(255, 244, 214, 0.13)',
          'sel-glow': 'rgba(255, 240, 200, 0.5)',
          ray: 'rgba(255, 236, 184, 0.95)',
          'other-shade': 'rgba(4, 4, 14, 0.36)',
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
        ['wheel-text', 'g-ruby', 'text'],
        ['wheel-text', 'g-emerald', 'text'],
        ['wheel-text', 'g-violet', 'text'],
        ['wheel-text', 'g-cobalt-lo', 'text'],
        ['wheel-text', 'g-ruby-lo', 'text'],
        ['wheel-text', 'g-emerald-lo', 'text'],
        ['wheel-text', 'g-violet-lo', 'text'],
        ['wheel-sub', 'g-ruby', 'text'],
        ['wheel-sub', 'g-emerald', 'text'],
        ['wheel-sub', 'g-cobalt', 'text'],
        ['wheel-sub', 'g-violet', 'text'],
        ['wheel-text', 'g-hub', 'text'],
        ['wheel-text', 'g-hub-hi', 'text'],
      ],

      // Soft edges for the beam and the halo of a lit medallion.
      defs: `<filter id="vitray-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4"/></filter>`,

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const s = H.s;
          const uid = H.uid(ID);
          const defs = s('defs', {}, root);
          // Glass: each colour is lit from its middle; medallions darken toward the lead instead,
          // so the lettering always sits on the plain colour.
          const radial = (id, stops, attrs = {}) => {
            const gr = s('radialGradient', Object.assign({ id: uid + id, cx: 0.5, cy: 0.5, r: 0.6 }, attrs), defs);
            for (const [o, cls] of stops) s('stop', { offset: o, class: cls }, gr);
          };
          for (const c of ['ruby', 'cobalt', 'emerald', 'violet', 'gold', 'teal']) {
            radial(`-${c}`, [
              [0, `vt-s-${c}-hi`],
              [1, `vt-s-${c}`],
            ]);
            radial(
              `-d-${c}`,
              [
                [0, `vt-s-${c}`],
                [1, `vt-s-${c}-lo`],
              ],
              { r: 0.7 },
            );
            radial(
              `-m-${c}`,
              [
                [0.55, `vt-s-${c}`],
                [1, `vt-s-${c}-lo`],
              ],
              { r: 0.5 },
            );
          }
          radial(
            '-hub',
            [
              [0, 'vt-s-hub-hi'],
              [1, 'vt-s-hub'],
            ],
            { r: 0.55 },
          );
          radial(
            '-stone',
            [
              [0.3, 'vt-s-stone-hi'],
              [1, 'vt-s-stone'],
            ],
            { cx: 0.38, cy: 0.3, r: 0.85 },
          );
          radial('-sh', [
            [0.9, 'vt-s-shadow'],
            [1, 'vt-s-shadow0'],
          ]);

          // Stone: shadow, the round frame with its mouldings, the tracery behind the glass.
          const stone = s('g', { class: 'vt-stone', 'aria-hidden': 'true' }, root);
          s('circle', { cx: C, cy: C + 6, r: R.outer + 6, fill: `url(#${uid}-sh)` }, stone);
          s('circle', { cx: C, cy: C, r: R.outer, fill: `url(#${uid}-stone)`, class: 'vt-stone-face' }, stone);
          s('circle', { cx: C, cy: C, r: R.outer - 4, class: 'vt-moulding' }, stone);
          s('circle', { cx: C, cy: C, r: R.ring + 2.5, class: 'vt-moulding' }, stone);
          s('circle', { cx: C, cy: C, r: R.hubStone + 1.5, class: 'vt-moulding' }, stone);
          // Small roundels in the stone between the arches.
          for (const sl of m.slices) {
            const [x, y] = H.polar(R.roundel, sl.a0);
            s('path', { d: quatrefoil(x, y, 4.6, 5.4, sl.a0), class: 'vt-roundel', fill: `url(#${uid}-teal)` }, stone);
            s('circle', { cx: f2(x), cy: f2(y), r: 2.6, class: 'vt-roundel-eye', fill: `url(#${uid}-gold)` }, stone);
          }

          // Petals.
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const med = glassOf(MED, sl.i, m.n);
            const side = glassOf(SIDE, sl.i, m.n);
            const md = medallion(sl);
            s('path', { d: H.sector(R.hubStone - 2, R.ring, sl.a0, sl.a1), class: 'vt-hit' }, g);
            const shape = petal(H, sl);
            const clipId = `${uid}-p${sl.i}`;
            s('path', { d: shape }, s('clipPath', { id: clipId }, g));
            const glass = s('g', { class: 'vt-glass', 'clip-path': `url(#${clipId})` }, g);
            s('path', { d: shape, fill: `url(#${uid}-d-${side})` }, glass);
            // Side panes left and right of the medallion, as wedges from its centre.
            const [mx, my] = H.polar(md.at, sl.mid);
            const reach = 260;
            const wedge = (a0, a1) => {
              const p0 = [mx + reach * Math.sin(H.rad(a0)), my - reach * Math.cos(H.rad(a0))];
              const p1 = [mx + reach * Math.sin(H.rad(a1)), my - reach * Math.cos(H.rad(a1))];
              return `M${f2(mx)} ${f2(my)}L${P(p0)}L${P(p1)}Z`;
            };
            s(
              'path',
              { d: wedge(sl.mid + 50, sl.mid + 130) + wedge(sl.mid - 130, sl.mid - 50), fill: `url(#${uid}-${side})` },
              glass,
            );
            const [ex, ey] = H.polar(R.eye, sl.mid);
            if (md.eye) s('circle', { cx: f2(ex), cy: f2(ey), r: R.eyeR, fill: `url(#${uid}-gold)` }, glass);
            s('circle', { cx: f2(mx), cy: f2(my), r: md.r, fill: `url(#${uid}-m-${med})`, class: 'vt-med' }, glass);
            // Lead: the cames between the panes, then the medallion ring.
            let cames = '';
            for (const a of [50, 130, -50, -130]) {
              const [x0, y0] = [mx + md.r * Math.sin(H.rad(sl.mid + a)), my - md.r * Math.cos(H.rad(sl.mid + a))];
              const [x1, y1] = [mx + reach * Math.sin(H.rad(sl.mid + a)), my - reach * Math.cos(H.rad(sl.mid + a))];
              cames += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
            }
            const [ax, ay] = H.polar(md.at + md.r, sl.mid);
            const [bx, by] = H.polar(md.eye ? R.eye - R.eyeR : R.apex, sl.mid);
            const [cx2, cy2] = H.polar(md.at - md.r, sl.mid);
            const [dx2, dy2] = H.polar(R.inner - 4, sl.mid);
            cames += `M${f2(ax)} ${f2(ay)}L${f2(bx)} ${f2(by)}M${f2(cx2)} ${f2(cy2)}L${f2(dx2)} ${f2(dy2)}`;
            s('path', { d: cames, class: 'vt-came' }, glass);
            if (md.eye) s('circle', { cx: f2(ex), cy: f2(ey), r: R.eyeR, class: 'vt-came' }, glass);
            s('circle', { cx: f2(mx), cy: f2(my), r: md.r, class: 'vt-came vt-med-ring' }, glass);
            s('path', { d: shape, class: 'vt-shade' }, glass);
            // Light falls on the glass round the medallion; the medallion keeps its colour for the lettering.
            const disc = `M${f2(mx - md.r)} ${f2(my)}a${md.r} ${md.r} 0 1 0 ${2 * md.r} 0a${md.r} ${md.r} 0 1 0 ${-2 * md.r} 0Z`;
            s('path', { d: shape + disc, 'fill-rule': 'evenodd', class: 'vt-glow' }, glass);
            s('path', { d: disc, class: 'vt-medglow' }, glass);
            s('path', { d: shape, class: 'vt-lead' }, g);
            s('path', { d: petal(H, sl, 2.2), class: 'vt-gilt' }, g);
            s('circle', { cx: f2(mx), cy: f2(my), r: md.r + 0.5, class: 'vt-halo' }, g);
            const ink = s('g', { class: 'vt-ink' }, g);
            const big = md.r > 40;
            if (sl.format) {
              H.block(ink, sl, md.at, {
                size: big ? 24 : 20,
                subSize: big ? 13.5 : 12.5,
                gap: 1,
                maxWidth: 2 * md.r - 12,
                minSize: 10,
                cls: 'vt-lbl vt-fmt',
                subCls: 'vt-sub',
              });
            } else {
              H.block(ink, sl, md.at, {
                icon: true,
                iconSize: big ? 24 : 21,
                size: big ? 14 : 12.5,
                gap: 3,
                maxWidth: 2 * md.r - 10,
                minSize: 8.5,
                cls: 'vt-lbl vt-word',
                sub: null,
              });
            }
            // More choices: a leaded piece of gold glass in the arch beside the medallion, pointing out.
            // A narrow petal keeps it nearer its middle, between the medallion and the lead.
            H.ringMark(g, sl, m, { r: 170, size: 10, offset: sl.step >= 70 ? 16 : 9, halo: 1.2, cls: 'vt-ring-mark' });
          }

          // Light that falls through a chosen pane: a beam per slice down to the centre (under the
          // hub lettering) and a burst of rays round its medallion (over everything).
          const under = s('g', { class: 'vt-fx-under', 'aria-hidden': 'true' }, root);
          const hub = s('g', { class: 'vt-hub' }, root);
          s('circle', { cx: C, cy: C, r: R.hub, fill: `url(#${uid}-hub)`, class: 'vt-hub-glass' }, hub);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'vt-pool' }, hub);
          let hubLead = '';
          for (let k = 0; k < 8; k++) {
            const a = k * 45 + 22.5;
            const [x0, y0] = H.polar(R.hub - 9, a);
            const [x1, y1] = H.polar(R.hub, a);
            hubLead += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          s('path', { d: hubLead, class: 'vt-came' }, hub);
          s('circle', { cx: C, cy: C, r: R.hub - 9, class: 'vt-came vt-hub-inner' }, hub);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'vt-lead' }, hub);
          const dy = m.key ? 0 : 8;
          H.label(hub, C, C - 13 + dy, m.title, { maxWidth: 92, size: 14, minSize: 9, cls: 'vt-title', maxLines: 1 });
          H.label(hub, C, C + 6 + dy, m.file, { maxWidth: 84, size: 12, minSize: 8.5, cls: 'vt-file', maxLines: 1 });
          if (m.key) {
            const kt = H.text(hub, C, C + 25, m.key, { class: 'vt-keytext' });
            const kw = kt.getComputedTextLength() + 14;
            hub.insertBefore(
              s('rect', { x: f2(C - kw / 2), y: C + 17.5, width: f2(kw), height: 15, rx: 7.5, class: 'vt-key' }),
              kt,
            );
          }
          const over = s('g', { class: 'vt-fx-over', 'aria-hidden': 'true' }, root);
          for (const sl of m.slices) {
            const md = medallion(sl);
            const [mx, my] = H.polar(md.at, sl.mid);
            const med = glassOf(MED, sl.i, m.n);
            const fu = s('g', { class: 'vt-fxs', 'data-i': sl.i }, under);
            const gid = `${uid}-b${sl.i}`;
            const [sx, sy] = H.polar(md.at - md.r - 2, sl.mid);
            const lg = s(
              'linearGradient',
              { id: gid, gradientUnits: 'userSpaceOnUse', x1: f2(sx), y1: f2(sy), x2: C, y2: C },
              fu,
            );
            [0, 0.55, 1].forEach((o, k) => s('stop', { offset: o, class: `vt-b vt-b${k} vt-s-${med}-beam` }, lg));
            const u = [Math.cos(H.rad(sl.mid)), Math.sin(H.rad(sl.mid))];
            const w0 = 24,
              w1 = 8;
            const [hx, hy] = H.polar(10, sl.mid);
            s(
              'path',
              {
                d: `M${f2(sx + u[0] * w0)} ${f2(sy + u[1] * w0)}L${f2(hx + u[0] * w1)} ${f2(hy + u[1] * w1)}L${f2(hx - u[0] * w1)} ${f2(hy - u[1] * w1)}L${f2(sx - u[0] * w0)} ${f2(sy - u[1] * w0)}Z`,
                fill: `url(#${gid})`,
                class: 'vt-beam',
              },
              fu,
            );
            const fo = s('g', { class: 'vt-fxs', 'data-i': sl.i }, over);
            let rays = '';
            for (let k = 0; k < 12; k++) {
              const a = H.rad(k * 30 + 15);
              const r0 = md.r + 5,
                r1 = md.r + (k % 2 ? 15 : 24);
              rays += `M${f2(mx + r0 * Math.sin(a))} ${f2(my - r0 * Math.cos(a))}L${f2(mx + r1 * Math.sin(a))} ${f2(my - r1 * Math.cos(a))}`;
            }
            s('path', { d: rays, class: 'vt-rays' }, fo);
          }
          // The beam layer belongs under the hub lettering but over the hub glass.
          hub.insertBefore(under, hub.querySelector('.vt-came'));
        },

        update(root, m, st) {
          const sel = st.selected;
          root.querySelectorAll('.vt-fxs').forEach((el) => el.classList.toggle('is-on', +el.dataset.i === sel));
          const pool = root.querySelector('.vt-pool');
          if (pool)
            pool.style.setProperty('--pool', sel == null ? 'transparent' : `var(--g-${glassOf(MED, sel, m.n)}-beam)`);
        },
      },

      sounds: {
        // A soft run of glass notes.
        open(ac, out, t, X) {
          [1568, 1976, 2349, 3136].forEach((f, k) =>
            X.tone(ac, out, t + k * 0.028, { type: 'sine', f, dur: 0.22, gain: 0.025, a: 0.006 }),
          );
          X.burst(ac, out, t, { type: 'highpass', f: 5000, q: 0.5, dur: 0.12, gain: 0.02, a: 0.03 });
        },
        // A tiny glass tink.
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'sine', f: 3520, dur: 0.05, gain: 0.04, a: 0.001 });
          X.tone(ac, out, t, { type: 'sine', f: 5280 * 1.03, dur: 0.03, gain: 0.015, a: 0.001 });
        },
        // A small bell: hum, prime, a minor-third tierce, quint and nominal, ringing on quietly.
        success(ac, out, t, X) {
          const f = 660;
          X.burst(ac, out, t, { type: 'bandpass', f: 3000, q: 1.5, dur: 0.012, gain: 0.08 });
          [
            [0.5, 0.05, 1.6],
            [1, 0.07, 1.2],
            [1.2, 0.05, 0.9],
            [1.5, 0.03, 0.7],
            [2, 0.045, 0.6],
            [2.51, 0.02, 0.4],
            [3.01, 0.012, 0.3],
          ].forEach(([r, g, d]) => X.tone(ac, out, t, { type: 'sine', f: f * r, dur: d, gain: g, a: 0.002 }));
          X.tone(ac, out, t + 0.03, { type: 'sine', f: f * 2.01, dur: 0.5, gain: 0.015, a: 0.004 });
        },
      },
    });
  })();
}
