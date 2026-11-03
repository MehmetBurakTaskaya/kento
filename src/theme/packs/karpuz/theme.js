// SPDX-License-Identifier: MIT
// Theme: Karpuz. A round slice of watermelon: a striped green rind, pink-red flesh, and black
// seeds sitting on the borders between the slices. Applying takes a bite out of the slice with
// a crunch; the seeds beside it hop.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const ID = 'karpuz';
    // Radii in the 400 x 400 view box: flesh, white rind, light green layer, striped skin.
    const R = { hub: 50, flesh0: 52, flesh1: 164, white1: 171, light1: 179, skin1: 192, lbl: 112 };

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
    const reducedMotion = () => document.documentElement.classList.contains('reduce-motion');
    const dot = (x, y, r) =>
      `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
    function stop(grad, H, offset, token, op) {
      H.s('stop', { offset, style: `stop-color: var(${token})${op != null ? `; stop-opacity: ${op}` : ''}` }, grad);
    }

    // The bite: four overlapping tooth arcs at the outer edge of a slice, scaled by k (0 to 1).
    function bites(H, sl, k) {
      if (k <= 0) return [];
      // The teeth close in from outside the rim, so a half bite is a shallower bite.
      const out = (1 - k) * 30;
      return [
        [-10.8, 175, 14.5],
        [-3.6, 172, 15.5],
        [3.6, 172, 15.5],
        [10.8, 175, 14.5],
      ].map(([da, r, br]) => {
        const [x, y] = H.polar(r + out, sl.mid + da);
        return { x: x - 200, y: y - 200, r: br };
      });
    }
    // Distance from the center to the bite edge along the ray at angle a, or Infinity.
    function biteR(H, bs, a) {
      const t = H.rad(a);
      const ux = Math.sin(t),
        uy = -Math.cos(t);
      let best = Infinity;
      for (const b of bs) {
        const p = ux * b.x + uy * b.y;
        const disc = p * p - (b.x * b.x + b.y * b.y - b.r * b.r);
        if (disc < 0) continue;
        const t0 = p - Math.sqrt(disc);
        if (t0 > 0 && t0 < best) best = t0;
      }
      return best;
    }
    // The band between radii r0 and r1 over the slice, with the bite taken out of it.
    function band(H, sl, r0, r1, bs) {
      // A hair of overlap between neighbours hides anti-aliasing seams.
      const a0 = sl.a0 - 0.3;
      const a1 = sl.a1 + 0.3;
      if (!bs.length) return H.sector(r0, r1, a0, a1);
      const steps = 60;
      const outer = [];
      const inner = [];
      for (let k = 0; k <= steps; k++) {
        const a = a0 + ((a1 - a0) * k) / steps;
        outer.push(H.polar(Math.max(r0, Math.min(r1, biteR(H, bs, a))), a));
        inner.push(H.polar(r0, a));
      }
      const pts = outer.concat(inner.reverse());
      return 'M' + pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join('L') + 'Z';
    }
    // The fresh edge of the bite inside the flesh, as an open line.
    function biteEdge(H, sl, bs) {
      if (!bs.length) return '';
      let d = '';
      let on = false;
      for (let k = 0; k <= 90; k++) {
        const a = sl.a0 + ((sl.a1 - sl.a0) * k) / 90;
        const b = biteR(H, bs, a);
        if (b < R.light1) {
          const [x, y] = H.polar(b, a);
          d += (on ? 'L' : 'M') + f2(x) + ' ' + f2(y);
          on = true;
        } else on = false;
      }
      return d;
    }

    // A seed: a teardrop with its tip toward the center, at radius r on angle a.
    function seed(H, r, a, len, w) {
      const t = H.rad(a);
      const ux = Math.sin(t),
        uy = -Math.cos(t);
      const vx = Math.cos(t),
        vy = Math.sin(t);
      const [cx, cy] = H.polar(r, a);
      const P = (u, v) => `${f2(cx + ux * u + vx * v)} ${f2(cy + uy * u + vy * v)}`;
      return {
        body: `M${P(-len * 0.55, 0)}C${P(-len * 0.2, w * 0.55)} ${P(len * 0.42, w * 0.62)} ${P(len * 0.45, 0)}C${P(len * 0.42, -w * 0.62)} ${P(-len * 0.2, -w * 0.55)} ${P(-len * 0.55, 0)}Z`,
        hi: `M${P(len * 0.05, -w * 0.28)}C${P(len * 0.2, -w * 0.3)} ${P(len * 0.3, -w * 0.18)} ${P(len * 0.3, -w * 0.05)}`,
        cx,
        cy,
      };
    }

    Board.define({
      id: ID,
      fonts: {
        brand: "'Nunito'",
        display: "'Paytone One'",
        load: ["'Nunito'", "'Paytone One'"],
        credits: [
          { family: 'Paytone One', license: 'SIL Open Font License 1.1' },
          { family: 'Nunito', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 170, close: 110, stagger: 13, apply: 620 },
      palette: {
        light: {
          bg: '#f2fafb',
          surface: '#ffffff',
          'surface-2': '#eaf6f7',
          border: '#cfe5e6',
          'border-strong': '#93c3c3',
          text: '#10291a',
          'text-muted': '#4b6156',
          accent: '#c8102e',
          'on-accent': '#ffffff',
          focus: '#1d7a35',
          success: '#2b8a3e',
          'on-success': '#ffffff',
          'success-text': '#1f6b30',
          warning: '#c77700',
          'warning-text': '#7a4a00',
          danger: '#c8102e',
          desk: 'radial-gradient(120% 100% at 25% 10%, #ffffff 0%, #e4f6f8 40%, #c9ebee 100%)',
          'wheel-face': '#d9f2c4',
          'wheel-slice': '#ff7b8c',
          'wheel-slice-hover': '#ff5068',
          'wheel-slice-selected': '#c8102e',
          'wheel-text': '#0a2814',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#ffc6ce',
          'wheel-shadow': 'rgba(30, 90, 100, 0.28)',
          'kz-flesh-in': '#ff6f82',
          'kz-flesh-out': '#ff9aa8',
          'kz-hov-in': '#ff4b63',
          'kz-hov-out': '#ff7086',
          'kz-sel-in': '#b30e2b',
          'kz-sel-out': '#c41a37',
          'kz-white': '#eaf8dc',
          'kz-light': '#9fd27e',
          'kz-skin': '#2f8a3a',
          'kz-stripe': '#17602a',
          'kz-skin-edge': '#0f4a1f',
          'kz-fibre': '#ffd9de',
          'kz-grain': '#ffe3e7',
          'kz-grain-op': '0.55',
          'kz-bite': '#fff0f2',
          'kz-seed': '#15130f',
          'kz-seed-hi': '#ffffff',
          'kz-sub': '#082512',
          'kz-sub-sel': '#ffe6ea',
          'kz-hub': '#fff3f4',
          'kz-hub-edge': '#ffc0c9',
          'kz-hub-text': '#0a2814',
          'kz-hub-sub': '#7a2433',
          'kz-key': '#257631',
          'kz-key-text': '#ffffff',
          'kz-crumb': '#ff5a70',
          'kz-juice': '#ff8a9a',
        },
        dark: {
          bg: '#0c181d',
          surface: '#13242b',
          'surface-2': '#1a2f37',
          border: '#284650',
          'border-strong': '#3f6774',
          text: '#eef8f3',
          'text-muted': '#a8c2bb',
          accent: '#ff8597',
          'on-accent': '#2a0610',
          focus: '#8be29b',
          success: '#6fdc8c',
          'on-success': '#06210f',
          'success-text': '#8be29b',
          warning: '#ffbf47',
          'warning-text': '#ffcf70',
          danger: '#ff7286',
          desk: 'radial-gradient(110% 100% at 75% 10%, #1d3b47 0%, #10262f 45%, #08141a 100%)',
          'wheel-face': '#a9c99b',
          'wheel-slice': '#b21d3a',
          'wheel-slice-hover': '#7f0b25',
          'wheel-slice-selected': '#ff8597',
          'wheel-text': '#fff0f3',
          'wheel-text-selected': '#2a0610',
          'wheel-line': '#d84a63',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          'kz-flesh-in': '#a3122f',
          'kz-flesh-out': '#bd2b46',
          'kz-hov-in': '#740922',
          'kz-hov-out': '#8c1230',
          'kz-sel-in': '#ff7a8d',
          'kz-sel-out': '#ff9aa8',
          'kz-white': '#b9d6a8',
          'kz-light': '#4f8a40',
          'kz-skin': '#1b5a27',
          'kz-stripe': '#0c3416',
          'kz-skin-edge': '#06240e',
          'kz-fibre': '#d9506a',
          'kz-grain': '#ff8fa1',
          'kz-grain-op': '0.4',
          'kz-bite': '#ffb3c0',
          'kz-seed': '#0b0a08',
          'kz-seed-hi': '#ffd6de',
          'kz-sub': '#ffd7de',
          'kz-sub-sel': '#4a0c18',
          'kz-hub': '#3a0815',
          'kz-hub-edge': '#8c1a33',
          'kz-hub-text': '#ffe8ec',
          'kz-hub-sub': '#ff9fb0',
          'kz-key': '#2f7a3a',
          'kz-key-text': '#f2fff4',
          'kz-crumb': '#ff5a74',
          'kz-juice': '#ff3d5c',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['wheel-text', 'kz-flesh-in', 'text'],
        ['wheel-text', 'kz-flesh-out', 'text'],
        ['wheel-text', 'kz-hov-in', 'text'],
        ['wheel-text', 'kz-hov-out', 'text'],
        ['wheel-text-selected', 'kz-sel-in', 'text'],
        ['wheel-text-selected', 'kz-sel-out', 'text'],
        ['kz-sub', 'kz-flesh-in', 'text'],
        ['kz-sub', 'kz-hov-in', 'text'],
        ['kz-sub-sel', 'kz-sel-in', 'text'],
        ['kz-sub-sel', 'kz-sel-out', 'text'],
        ['kz-hub-text', 'kz-hub', 'text'],
        ['kz-hub-sub', 'kz-hub', 'text'],
        ['kz-key-text', 'kz-key', 'text'],
      ],

      // Gradients are built per wheel in render(): they read the palette tokens of their own card.
      defs: '',

      wheel: {
        render(root, m, H) {
          const uid = H.uid(ID);
          root.dataset.kzUid = uid;
          const rand = rng(77 + m.n);
          const defs = H.s('defs', {}, root);
          for (const [name, a, b] of [
            ['flesh', '--kz-flesh-in', '--kz-flesh-out'],
            ['hov', '--kz-hov-in', '--kz-hov-out'],
            ['sel', '--kz-sel-in', '--kz-sel-out'],
          ]) {
            const g = H.s(
              'radialGradient',
              { id: `${uid}-${name}`, gradientUnits: 'userSpaceOnUse', cx: 200, cy: 200, r: R.flesh1 },
              defs,
            );
            stop(g, H, 0.25, a);
            stop(g, H, 1, b);
          }
          const sh = H.s(
            'radialGradient',
            { id: `${uid}-shadow`, gradientUnits: 'userSpaceOnUse', cx: 204, cy: 210, r: R.skin1 + 12 },
            defs,
          );
          stop(sh, H, 0.78, '--wheel-shadow', 0);
          stop(sh, H, 0.93, '--wheel-shadow');
          stop(sh, H, 1, '--wheel-shadow', 0);
          const wg = H.s(
            'radialGradient',
            { id: `${uid}-white`, gradientUnits: 'userSpaceOnUse', cx: 200, cy: 200, r: R.white1 },
            defs,
          );
          stop(wg, H, 0.93, '--kz-flesh-out', 0.6);
          stop(wg, H, 0.97, '--kz-white');

          // A soft ring of shadow: under a bite it fades to a light shade, never a hard line.
          H.s('circle', { cx: 204, cy: 210, r: R.skin1 + 12, fill: `url(#${uid}-shadow)`, class: 'kz-shadow' }, root);
          // Flesh under the slices (shallower than any bite), so a lifted slice never shows a gap.
          H.s('circle', { cx: 200, cy: 200, r: 150, fill: `url(#${uid}-flesh)`, class: 'kz-shadow' }, root);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R.hub, R.skin1 + 2, sl.a0, sl.a1), class: 'kz-hit' }, g);
            const body = H.s('g', { class: 'kz-body' }, g);
            const chomp = H.s('g', { class: 'kz-chomp' }, body);
            H.s(
              'path',
              { d: band(H, sl, R.flesh0, R.flesh1 + 0.5, []), class: 'kz-flesh', fill: `url(#${uid}-flesh)` },
              chomp,
            );
            H.s(
              'path',
              { d: band(H, sl, R.flesh1, R.white1 + 0.5, []), class: 'kz-white', fill: `url(#${uid}-white)` },
              chomp,
            );
            H.s('path', { d: band(H, sl, R.white1, R.light1 + 0.5, []), class: 'kz-light' }, chomp);
            const skinD = band(H, sl, R.light1, R.skin1, []);
            H.s('path', { d: skinD, class: 'kz-skin' }, chomp);
            // Jagged stripes across the skin, clipped to it (the clip follows the bite).
            const clipId = `${uid}-c${sl.i}`;
            const clip = H.s('clipPath', { id: clipId }, chomp);
            H.s('path', { d: skinD, class: 'kz-skin-clip' }, clip);
            let stripes = '';
            for (let a = sl.a0 + 3; a < sl.a1; a += 10) {
              const w = 3.6 + rand() * 1.8;
              const pts = [];
              for (let r = R.light1 - 1, z = 0; r <= R.skin1 + 2; r += 3.3, z++)
                pts.push([r, a + (z % 2 ? 1.2 : -1.2) + (rand() - 0.5) * 0.8]);
              const left = pts.map(([r, b]) => H.polar(r, b - w / 2));
              const right = pts.map(([r, b]) => H.polar(r, b + w / 2)).reverse();
              stripes +=
                'M' +
                left
                  .concat(right)
                  .map(([x, y]) => `${f2(x)} ${f2(y)}`)
                  .join('L') +
                'Z';
            }
            H.s('path', { d: stripes, class: 'kz-stripes', 'clip-path': `url(#${clipId})` }, chomp);
            // Sparkling grain in the flesh.
            let grain = '';
            for (let k = 0; k < 26; k++) {
              const r = R.flesh0 + 8 + rand() * (R.flesh1 - R.flesh0 - 14);
              const a = sl.a0 + 2 + rand() * (sl.a1 - sl.a0 - 4);
              const [x, y] = H.polar(r, a);
              grain += dot(x, y, 0.6 + rand() * 0.9);
            }
            H.s('path', { d: grain, class: 'kz-grain' }, chomp);
            H.s('path', { d: '', class: 'kz-bite-edge' }, chomp);
            if (sl.off) H.s('path', { d: H.sector(R.flesh0, R.flesh1, sl.a0, sl.a1), class: 'kz-off' }, chomp);
            const c = H.s('g', { class: 'kz-content' }, chomp);
            if (m.kind === 'convert' && sl.sub) {
              H.block(c, sl, R.lbl, {
                size: 26,
                subSize: 13,
                gap: 0,
                maxWidth: 74,
                minSize: 11,
                cls: 'kz-lbl kz-fmt',
                subCls: 'kz-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 14,
                gap: 2,
                maxWidth: 74,
                minSize: 9.5,
                cls: 'kz-lbl kz-word',
                sub: null,
              });
            }
            H.s('g', { class: 'kz-fx' }, g);
          }

          // Pale fibres and black seeds on every border between two slices.
          const top = H.s('g', { class: 'kz-top', 'aria-hidden': 'true' }, root);
          let fib = '';
          for (const sl of m.slices) {
            const [x0, y0] = H.polar(R.hub + 3, sl.a0);
            const [x1, y1] = H.polar(R.flesh1 - 2, sl.a0);
            fib += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d: fib, class: 'kz-fibre' }, top);
          for (const sl of m.slices) {
            const b = H.s('g', { class: 'kz-border', 'data-b': sl.i }, top);
            [
              [86, -1.8, 11, 6.6],
              [124, 2, 12.5, 7.4],
              [150, -1.4, 11.5, 6.8],
            ].forEach(([r, da, len, w], k) => {
              const sd = seed(H, r, sl.a0 + da, len, w);
              const sg = H.s('g', { class: 'kz-seed' }, b);
              sg.style.setProperty('--sx', f2(sd.cx) + 'px');
              sg.style.setProperty('--sy', f2(sd.cy) + 'px');
              sg.style.setProperty('--k', k);
              sg.style.setProperty('--spin', (k % 2 ? -1 : 1) * (18 + k * 9) + 'deg');
              H.s('path', { d: sd.body, class: 'kz-seed-body' }, sg);
              H.s('path', { d: sd.hi, class: 'kz-seed-hi' }, sg);
            });
          }

          // The heart of the melon: name, file and key.
          const hub = H.s('g', { class: 'kz-hub' }, root);
          H.s('circle', { cx: 200, cy: 200, r: R.hub, class: 'kz-heart' }, hub);
          H.label(hub, 200, 183, m.title, { maxWidth: 86, size: 17, minSize: 11, cls: 'kz-title', maxLines: 1 });
          H.label(hub, 200, 201, m.file, {
            maxWidth: 80,
            size: 11.5,
            minSize: 9,
            cls: 'kz-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          const kw = 14 + m.key.length * 6.4;
          H.s('rect', { x: f2(200 - kw / 2), y: 211, width: f2(kw), height: 16, rx: 8, class: 'kz-key' }, hub);
          H.text(hub, 200, 219.5, m.key, { class: 'kz-keytext' });
        },

        update(root, m, st, H) {
          const uid = root.dataset.kzUid;
          root.querySelectorAll('.slice').forEach((g) => {
            const i = +g.dataset.slice;
            const fill = i === st.selected ? 'sel' : i === st.hover ? 'hov' : 'flesh';
            const fl = g.querySelector('.kz-flesh');
            if (fl.dataset.f !== fill) {
              fl.dataset.f = fill;
              fl.setAttribute('fill', `url(#${uid}-${fill})`);
            }
            const bitten = i === st.selected ? '1' : '';
            if (g.dataset.bite !== bitten && !g.__kzBiting) {
              g.dataset.bite = bitten;
              drawBite(g, m.slices[i], H, bitten ? 1 : 0);
            }
          });
        },

        // Two chomps cut the bite in (the bitten shape is drawn in JS), then CSS keyframes throw
        // crumbs and make the border seeds hop. For a still frame (t set) everything is drawn for moment t.
        onSelect(root, m, i, H, t) {
          const g = root.querySelector(`.slice[data-slice="${i}"]`);
          const sl = m.slices[i];
          root.querySelectorAll('.kz-fx').forEach((n) => (n.textContent = ''));
          root.querySelectorAll('.kz-border.is-hop').forEach((n) => n.classList.remove('is-hop'));
          // A bite still being chewed on another slice is finished at once.
          root.querySelectorAll('.slice').forEach((s) => {
            if (!s.__kzBiting) return;
            s.__kzBiting = false;
            s.dataset.bite = s.classList.contains('is-selected') ? '1' : '';
            drawBite(s, m.slices[+s.dataset.slice], H, s.dataset.bite ? 1 : 0);
          });
          clearTimeout(root.__kzT1);
          clearTimeout(root.__kzT2);
          clearTimeout(root.__kzT3);
          if (t == null && reducedMotion()) return;
          const k = (tt) => (tt < 40 ? 0 : tt < 130 ? 0.6 : 1);
          drawBite(g, sl, H, k(t || 0));
          for (const b of [i, (i + 1) % m.n]) root.querySelector(`.kz-border[data-b="${b}"]`).classList.add('is-hop');
          // Crumbs of flesh and drops of juice from the bite.
          const fx = g.querySelector('.kz-fx');
          const rand = rng(5 + i * 13);
          for (let n = 0; n < 13; n++) {
            const a = sl.mid + (rand() - 0.5) * 34;
            const [x, y] = H.polar(R.flesh1 - 4 - rand() * 6, a);
            const dist = 24 + rand() * 40;
            const [ex, ey] = H.polar(R.flesh1 + dist, a + (rand() - 0.5) * 16);
            const at = H.s('g', { transform: `translate(${f2(x)} ${f2(y)})` }, fx);
            const fly = H.s('g', { class: 'kz-crumb' }, at);
            fly.style.setProperty('--dx', f2(ex - x) + 'px');
            fly.style.setProperty('--dy', f2(ey - y) + 'px');
            fly.style.setProperty('--fall', f2(12 + rand() * 18) + 'px');
            fly.style.setProperty('--rot', Math.round((rand() - 0.5) * 300) + 'deg');
            fly.style.setProperty('--d', (n < 6 ? 40 : 130) + Math.round(rand() * 40) + 'ms');
            const fall = H.s('g', { class: 'kz-fall' }, fly);
            if (n % 3 === 2) {
              H.s('circle', { cx: 0, cy: 0, r: f2(2 + rand() * 1.6), class: 'kz-drop' }, fall);
            } else {
              const s = 2.6 + rand() * 2.6;
              let d = '';
              for (let q = 0; q < 5; q++) {
                const qa = (q / 5) * Math.PI * 2 + rand() * 0.6;
                const qr = s * (0.6 + rand() * 0.5);
                d += (q ? 'L' : 'M') + f2(Math.cos(qa) * qr) + ' ' + f2(Math.sin(qa) * qr);
              }
              H.s('path', { d: d + 'Z', class: 'kz-bit' }, fall);
            }
          }
          if (t != null) return;
          g.__kzBiting = true;
          root.__kzT1 = setTimeout(() => drawBite(g, sl, H, 0.6), 40);
          root.__kzT2 = setTimeout(() => {
            g.__kzBiting = false;
            drawBite(g, sl, H, g.classList.contains('is-selected') ? 1 : 0);
            g.dataset.bite = g.classList.contains('is-selected') ? '1' : '';
          }, 130);
          root.__kzT3 = setTimeout(() => {
            fx.textContent = '';
            root.querySelectorAll('.kz-border.is-hop').forEach((n) => n.classList.remove('is-hop'));
          }, 680);
        },
      },

      sounds: {
        // A hollow knock on a ripe melon.
        open(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'sine', f: 196, f2: 148, dur: 0.13, gain: 0.16, a: 0.003 });
          X.burst(ac, out, t, { type: 'bandpass', f: 420, q: 4, dur: 0.05, gain: 0.14 });
          X.tone(ac, out, t + 0.002, { type: 'triangle', f: 392, f2: 300, dur: 0.05, gain: 0.03, a: 0.002 });
        },
        // A dry seed tick.
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 2700, q: 7, dur: 0.012, gain: 0.22 });
          X.tone(ac, out, t, { type: 'triangle', f: 940, f2: 720, dur: 0.018, gain: 0.035, a: 0.001 });
        },
        // A crisp double crunch and two tiny hops.
        success(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'sine', f: 150, f2: 90, dur: 0.07, gain: 0.08, a: 0.002 });
          [0, 0.014, 0.03, 0.052, 0.09, 0.104, 0.12, 0.142].forEach((d, k) =>
            X.burst(ac, out, t + d, {
              type: k % 2 ? 'highpass' : 'bandpass',
              f: 2200 + ((k * 677) % 2400),
              q: 1.6,
              dur: 0.018 + (k % 3) * 0.008,
              gain: k < 4 ? 0.16 : 0.12,
            }),
          );
          X.tone(ac, out, t + 0.2, { type: 'sine', f: 1250, f2: 1700, dur: 0.03, gain: 0.04, a: 0.002 });
          X.tone(ac, out, t + 0.27, { type: 'sine', f: 1400, f2: 1900, dur: 0.03, gain: 0.035, a: 0.002 });
        },
      },
    });

    // Draws slice g with a bite of size k (0: whole, 1: full bite).
    function drawBite(g, sl, H, k) {
      const bs = bites(H, sl, k);
      const set = (sel, d) => g.querySelector(sel).setAttribute('d', d);
      set('.kz-flesh', band(H, sl, R.flesh0, R.flesh1 + 0.5, bs));
      set('.kz-white', band(H, sl, R.flesh1, R.white1 + 0.5, bs));
      set('.kz-light', band(H, sl, R.white1, R.light1 + 0.5, bs));
      const skin = band(H, sl, R.light1, R.skin1, bs);
      set('.kz-skin', skin);
      set('.kz-skin-clip', skin);
      set('.kz-bite-edge', biteEdge(H, sl, bs));
    }
  })();
}
