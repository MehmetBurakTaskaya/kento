// SPDX-License-Identifier: MIT
// Theme: Portakal. A halved orange seen from above: a dimpled rind, a ring of white pith and
// translucent juicy segments as slices. Applying squeezes the segment: juice drops and a fine
// zest mist burst out of its rim. The dark palette is a blood orange at night.
export default function register(Board) {
  (function () {
    'use strict';

    const f2 = (n) => Math.round(n * 100) / 100;
    const ID = 'portakal';
    // Radii in the 400 x 400 view box.
    const R = { hub: 52, seg0: 58, seg1: 168, pith: 178, rind: 191, lbl: 116 };

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

    // A segment: radial sides held `gap` apart, a rounded outer edge and a blunt inner tip.
    function segPath(H, r0, r1, a0, a1, gap, k) {
      const g = (r) => ((gap / 2 / r) * 180) / Math.PI;
      const P = (r, a) => H.polar(r, a).map(f2).join(' ');
      const ka = (((k * 1.3) / r1) * 180) / Math.PI;
      const s0 = a0 + g(r1);
      const s1 = a1 - g(r1);
      const i0 = a0 + g(r0);
      const i1 = a1 - g(r0);
      const im = (a0 + a1) / 2;
      return (
        `M${P(r0 + 4, i0)}L${P(r1 - k, a0 + g(r1 - k))}Q${P(r1, s0)} ${P(r1 + 0.5, s0 + ka)}` +
        `A${r1} ${r1} 0 0 1 ${P(r1 + 0.5, s1 - ka)}Q${P(r1, s1)} ${P(r1 - k, a1 - g(r1 - k))}` +
        `L${P(r0 + 4, i1)}Q${P(r0 - 2, im)} ${P(r0 + 4, i0)}Z`
      );
    }

    // Juice sacs: thin teardrops pointing at the core, scattered through a segment.
    function sacs(H, sl, rand, gap) {
      let d = '';
      const span = sl.a1 - sl.a0;
      for (let k = 0; k < 22; k++) {
        const r = R.seg0 + 14 + rand() * (R.seg1 - R.seg0 - 22);
        const g = (((gap / 2 + 4) / r) * 180) / Math.PI;
        const a = sl.a0 + g + rand() * (span - 2 * g);
        const len = 9 + rand() * 15;
        const w = 1.6 + rand() * 1.8;
        const t = H.rad(a);
        const ux = Math.sin(t),
          uy = -Math.cos(t);
        const [x, y] = H.polar(r, a);
        const tx = x - ux * len,
          ty = y - uy * len; // tip toward the core
        d +=
          `M${f2(tx)} ${f2(ty)}Q${f2(x - ux * len * 0.3 + uy * w * 1.4)} ${f2(y - uy * len * 0.3 - ux * w * 1.4)} ${f2(x + uy * w * 0.2)} ${f2(y - ux * w * 0.2)}` +
          `Q${f2(x - ux * len * 0.3 - uy * w * 1.4)} ${f2(y - uy * len * 0.3 + ux * w * 1.4)} ${f2(tx)} ${f2(ty)}Z`;
      }
      return d;
    }

    const dot = (x, y, r) =>
      `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;

    // A teardrop pointing along +y in local space, tip at the origin.
    const drop = (s) =>
      `M0 ${f2(-s * 1.7)}C${f2(s * 0.5)} ${f2(-s * 0.7)} ${f2(s)} ${f2(-s * 0.1)} ${f2(s)} ${f2(s * 0.35)}A${f2(s)} ${f2(s)} 0 0 1 ${f2(-s)} ${f2(s * 0.35)}C${f2(-s)} ${f2(-s * 0.1)} ${f2(-s * 0.5)} ${f2(-s * 0.7)} 0 ${f2(-s * 1.7)}Z`;

    function stop(grad, H, offset, token, op) {
      H.s('stop', { offset, style: `stop-color: var(${token})${op != null ? `; stop-opacity: ${op}` : ''}` }, grad);
    }

    Board.define({
      id: ID,
      fonts: {
        brand: "'Baloo 2'",
        load: ["'Baloo 2'"],
        credits: [{ family: 'Baloo 2', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 180, close: 110, stagger: 14, apply: 640 },
      palette: {
        light: {
          bg: '#fdf8ef',
          surface: '#ffffff',
          'surface-2': '#fff4e2',
          border: '#f1dcc0',
          'border-strong': '#d9a873',
          text: '#1e2a1c',
          'text-muted': '#5b6352',
          accent: '#c2410c',
          'on-accent': '#ffffff',
          focus: '#1f7a3e',
          success: '#2e8540',
          'on-success': '#ffffff',
          'success-text': '#1f6b31',
          warning: '#d97706',
          'warning-text': '#8a4b00',
          danger: '#c0262d',
          desk: 'radial-gradient(120% 90% at 30% 20%, #f4fbef 0%, #e3f3e2 45%, #cfe9dc 100%)',
          'wheel-face': '#fff6e6',
          'wheel-slice': '#ffbe5c',
          'wheel-slice-hover': '#ff9a2e',
          'wheel-slice-selected': '#c4440d',
          'wheel-text': '#173a20',
          'wheel-text-selected': '#fffaf0',
          'wheel-line': '#fff6e6',
          'wheel-shadow': 'rgba(46, 92, 52, 0.30)',
          'pk-flesh-in': '#ffd37a',
          'pk-flesh-out': '#ffad3d',
          'pk-hov-in': '#ffb447',
          'pk-hov-out': '#ff8c1f',
          'pk-sel-in': '#bf4410',
          'pk-sel-out': '#a8320a',
          'pk-sac': '#fff6cf',
          'pk-sac-op': '0.5',
          'pk-sac-sel': '#ff9a4d',
          'pk-pith': '#fff7e8',
          'pk-pith-edge': '#f6e2c4',
          'pk-rind-in': '#ffa424',
          'pk-rind-out': '#ef7a10',
          'pk-rind-edge': '#d4600b',
          'pk-pore': '#c9590a',
          'pk-pore-hi': '#ffd27a',
          'pk-sub': '#2f4d2a',
          'pk-sub-sel': '#fff3e3',
          'pk-hub-text': '#173a20',
          'pk-hub-sub': '#5d6b4f',
          'pk-key': '#ffe7c2',
          'pk-key-text': '#7a3b07',
          'pk-juice': '#ffa51f',
          'pk-juice-edge': '#e0700a',
          'pk-zest': '#ffc21a',
          'pk-gloss': '#ffffff',
          'pk-gloss-op': '0.55',
        },
        dark: {
          bg: '#150f1d',
          surface: '#211a2b',
          'surface-2': '#2a2135',
          border: '#3b2f49',
          'border-strong': '#5c4a70',
          text: '#fbefe6',
          'text-muted': '#c6b3bf',
          accent: '#ff8a4c',
          'on-accent': '#2a0a06',
          focus: '#ffb27a',
          success: '#6fd38c',
          'on-success': '#0b2413',
          'success-text': '#86e0a0',
          warning: '#ffb340',
          'warning-text': '#ffc56b',
          danger: '#ff6b6b',
          desk: 'radial-gradient(110% 90% at 70% 15%, #2c1f45 0%, #1a1230 45%, #0e0a1a 100%)',
          'wheel-face': '#f0d6cc',
          'wheel-slice': '#a8261f',
          'wheel-slice-hover': '#7a0d22',
          'wheel-slice-selected': '#ff9b45',
          'wheel-text': '#fff1e3',
          'wheel-text-selected': '#2b0609',
          'wheel-line': '#f0d6cc',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          'pk-flesh-in': '#c23a1f',
          'pk-flesh-out': '#8c1024',
          'pk-hov-in': '#9e1630',
          'pk-hov-out': '#5e0619',
          'pk-sel-in': '#ffb15a',
          'pk-sel-out': '#ff8a33',
          'pk-sac': '#ff7a5c',
          'pk-sac-op': '0.32',
          'pk-sac-sel': '#ffd28a',
          'pk-pith': '#f3d9cf',
          'pk-pith-edge': '#d9b0a6',
          'pk-rind-in': '#d4461a',
          'pk-rind-out': '#9c2410',
          'pk-rind-edge': '#6e1608',
          'pk-pore': '#5e1206',
          'pk-pore-hi': '#f27a45',
          'pk-sub': '#ffd9c4',
          'pk-sub-sel': '#4a0d10',
          'pk-hub-text': '#6b0f1c',
          'pk-hub-sub': '#8a3a3f',
          'pk-key': '#e6bfb4',
          'pk-key-text': '#6b0f1c',
          'pk-juice': '#ff5a3c',
          'pk-juice-edge': '#b3132b',
          'pk-zest': '#ffb067',
          'pk-gloss': '#ffd9c4',
          'pk-gloss-op': '0.35',
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
        ['wheel-text', 'pk-flesh-in', 'text'],
        ['wheel-text', 'pk-flesh-out', 'text'],
        ['wheel-text', 'pk-hov-in', 'text'],
        ['wheel-text', 'pk-hov-out', 'text'],
        ['wheel-text-selected', 'pk-sel-in', 'text'],
        ['wheel-text-selected', 'pk-sel-out', 'text'],
        ['pk-sub', 'wheel-slice', 'text'],
        ['pk-sub', 'pk-hov-in', 'text'],
        ['pk-sub-sel', 'pk-sel-in', 'text'],
        ['pk-hub-text', 'pk-pith', 'text'],
        ['pk-hub-sub', 'pk-pith', 'text'],
        ['pk-key-text', 'pk-key', 'text'],
      ],

      // Gradients are built per wheel in render(): they read the palette tokens of their own card.
      defs: '',

      wheel: {
        render(root, m, H) {
          const uid = H.uid(ID);
          const rand = rng(1907 + m.n);
          const defs = H.s('defs', {}, root);
          const radial = (name, a, b, r = R.seg1) => {
            const g = H.s(
              'radialGradient',
              { id: `${uid}-${name}`, gradientUnits: 'userSpaceOnUse', cx: 200, cy: 200, r },
              defs,
            );
            stop(g, H, 0.3, a);
            stop(g, H, 1, b);
          };
          radial('flesh', '--pk-flesh-in', '--pk-flesh-out');
          radial('hov', '--pk-hov-in', '--pk-hov-out');
          radial('sel', '--pk-sel-in', '--pk-sel-out');
          const rg = H.s(
            'radialGradient',
            { id: `${uid}-rind`, gradientUnits: 'userSpaceOnUse', cx: 186, cy: 182, r: R.rind + 8 },
            defs,
          );
          stop(rg, H, 0.86, '--pk-rind-in');
          stop(rg, H, 0.95, '--pk-rind-out');
          stop(rg, H, 1, '--pk-rind-edge');
          const sh = H.s(
            'radialGradient',
            { id: `${uid}-shadow`, gradientUnits: 'userSpaceOnUse', cx: 206, cy: 212, r: R.rind + 12 },
            defs,
          );
          stop(sh, H, 0.86, '--wheel-shadow');
          stop(sh, H, 1, '--wheel-shadow', 0);
          const pg = H.s(
            'radialGradient',
            { id: `${uid}-pith`, gradientUnits: 'userSpaceOnUse', cx: 200, cy: 200, r: R.pith },
            defs,
          );
          stop(pg, H, 0.9, '--pk-pith');
          stop(pg, H, 1, '--pk-pith-edge');
          root.dataset.pkUid = uid;

          // Shadow, the dimpled rind with a slightly bumpy edge, and the pith underneath the segments.
          const base = H.s('g', { class: 'pk-fruit', 'aria-hidden': 'true' }, root);
          H.s('circle', { cx: 206, cy: 212, r: R.rind + 12, fill: `url(#${uid}-shadow)`, class: 'pk-shadow' }, base);
          let edge = '';
          for (let k = 0; k <= 180; k++) {
            const a = k * 2;
            const r = R.rind + 0.9 * Math.sin(k * 2.7) + 0.6 * Math.sin(k * 7.3 + 1);
            const [x, y] = H.polar(r, a);
            edge += (k ? 'L' : 'M') + f2(x) + ' ' + f2(y);
          }
          H.s('path', { d: edge + 'Z', fill: `url(#${uid}-rind)`, class: 'pk-rind' }, base);
          let pores = '';
          let hi = '';
          for (let row = 0; row < 3; row++) {
            const count = 64 + row * 8;
            for (let k = 0; k < count; k++) {
              const a = (k + rand() * 0.8 + row * 0.37) * (360 / count);
              const r = R.pith + 3.2 + row * 3.4 + rand() * 1.2;
              const [x, y] = H.polar(r, a);
              const s = 0.55 + rand() * 0.5;
              pores += dot(x, y, s);
              if (rand() < 0.5) hi += dot(x - 0.6, y - 0.7, s * 0.55);
            }
          }
          H.s('path', { d: pores, class: 'pk-pores' }, base);
          H.s('path', { d: hi, class: 'pk-pores-hi' }, base);
          H.s('circle', { cx: 200, cy: 200, r: R.pith, fill: `url(#${uid}-pith)`, class: 'pk-pith' }, base);

          // Segments.
          const gap = 6;
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const [cx, cy] = H.polar(R.lbl, sl.mid);
            g.style.setProperty('--cx', f2(cx) + 'px');
            g.style.setProperty('--cy', f2(cy) + 'px');
            H.s('path', { d: H.sector(R.hub, R.pith, sl.a0, sl.a1), class: 'pk-hit' }, g);
            const body = H.s('g', { class: 'pk-body' }, g);
            const squeeze = H.s('g', { class: 'pk-squeeze' }, body);
            H.s(
              'path',
              { d: segPath(H, R.seg0, R.seg1, sl.a0, sl.a1, gap, 9), class: 'pk-seg', fill: `url(#${uid}-flesh)` },
              squeeze,
            );
            H.s('path', { d: sacs(H, sl, rand, gap), class: 'pk-sac' }, squeeze);
            // A wet highlight along the rim of the segment, shown on hover and selection.
            H.s('path', { d: H.arc(R.seg1 - 7, sl.a0 + 7, sl.a1 - 7), class: 'pk-gloss' }, squeeze);
            if (sl.off) H.s('path', { d: segPath(H, R.seg0, R.seg1, sl.a0, sl.a1, gap, 9), class: 'pk-off' }, squeeze);
            const c = H.s('g', { class: 'pk-content' }, squeeze);
            if (m.kind === 'convert' && sl.sub) {
              H.block(c, sl, R.lbl, {
                size: 25,
                subSize: 13,
                gap: -1,
                maxWidth: 74,
                minSize: 11,
                cls: 'pk-lbl pk-fmt',
                subCls: 'pk-sub',
              });
            } else {
              H.block(c, sl, R.lbl, {
                icon: true,
                iconSize: 22,
                size: 14.5,
                gap: 2,
                maxWidth: 74,
                minSize: 9.5,
                cls: 'pk-lbl pk-word',
                sub: null,
              });
            }
            H.s('g', { class: 'pk-fx' }, g);
          }

          // The core: white pith with the wheel's name, the file and the key.
          const hub = H.s('g', { class: 'pk-hub' }, root);
          H.s('circle', { cx: 200, cy: 200, r: R.hub, class: 'pk-core' }, hub);
          let star = '';
          for (const sl of m.slices) {
            const [x0, y0] = H.polar(R.hub - 14, sl.a0);
            const [x1, y1] = H.polar(R.hub + 1, sl.a0);
            star += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          H.s('path', { d: star, class: 'pk-core-star' }, hub);
          H.label(hub, 200, 184, m.title, { maxWidth: 88, size: 16.5, minSize: 11, cls: 'pk-title', maxLines: 1 });
          H.label(hub, 200, 202, m.file, {
            maxWidth: 82,
            size: 11.5,
            minSize: 9,
            cls: 'pk-file',
            maxLines: 1,
            attrs: { direction: 'ltr', 'unicode-bidi': 'plaintext' },
          });
          const kw = 14 + m.key.length * 6.4;
          H.s('rect', { x: f2(200 - kw / 2), y: 212, width: f2(kw), height: 16, rx: 8, class: 'pk-key' }, hub);
          H.text(hub, 200, 220.5, m.key, { class: 'pk-keytext' });
        },

        update(root, m, st) {
          const uid = root.dataset.pkUid;
          root.querySelectorAll('.slice').forEach((g) => {
            const i = +g.dataset.slice;
            const fill = i === st.selected ? 'sel' : i === st.hover ? 'hov' : 'flesh';
            const seg = g.querySelector('.pk-seg');
            if (seg.dataset.f !== fill) {
              seg.dataset.f = fill;
              seg.setAttribute('fill', `url(#${uid}-${fill})`);
            }
          });
        },

        // Juice drops and a zest mist burst from the squeezed segment's rim. The drops are built
        // only for the effect and removed afterwards; CSS keyframes move them (frozen at --t in strips).
        onSelect(root, m, i, H, t) {
          const g = root.querySelector(`.slice[data-slice="${i}"]`);
          root.querySelectorAll('.pk-fx').forEach((n) => (n.textContent = ''));
          if (t == null && reducedMotion()) return;
          const fx = g.querySelector('.pk-fx');
          const sl = m.slices[i];
          const rand = rng(31 + i * 17);
          // The mist: a cloud of fine dots that swells and fades.
          const [mx, my] = H.polar(R.seg1 + 4, sl.mid);
          let mist = '';
          for (let k = 0; k < 80; k++) {
            const a = sl.mid + (rand() - 0.5) * 80;
            const r = R.seg1 - 10 + rand() * 52;
            const [x, y] = H.polar(r, a);
            mist += dot(x, y, 0.6 + rand() * 1.4);
          }
          const mg = H.s('g', { class: 'pk-mist' }, fx);
          mg.style.setProperty('--ox', f2(mx) + 'px');
          mg.style.setProperty('--oy', f2(my) + 'px');
          H.s('path', { d: mist }, mg);
          // The splash: a crown of juice spikes that shoots out of the rim and falls back.
          let crown = '';
          for (let k = 0; k < 9; k++) {
            const a = sl.mid + (k - 4) * 9 + (rand() - 0.5) * 5;
            const len = 14 + rand() * 16 - Math.abs(k - 4) * 1.5;
            const [bx0, by0] = H.polar(R.seg1 - 2, a - 2.2);
            const [bx1, by1] = H.polar(R.seg1 - 2, a + 2.2);
            const [tx, ty] = H.polar(R.seg1 - 2 + len, a);
            crown += `M${f2(bx0)} ${f2(by0)}Q${f2((bx0 + tx) / 2)} ${f2((by0 + ty) / 2)} ${f2(tx)} ${f2(ty)}Q${f2((bx1 + tx) / 2)} ${f2((by1 + ty) / 2)} ${f2(bx1)} ${f2(by1)}Z`;
          }
          const cg = H.s('g', { class: 'pk-crown' }, fx);
          cg.style.setProperty('--ox', f2(mx) + 'px');
          cg.style.setProperty('--oy', f2(my) + 'px');
          H.s('path', { d: crown }, cg);
          // The drops: each flies out along its own line and falls a little.
          for (let k = 0; k < 12; k++) {
            const a = sl.mid + (k - 5.5) * 5.6 + (rand() - 0.5) * 4;
            const [x, y] = H.polar(R.seg1 - 6, a);
            const dist = 30 + rand() * 44;
            const [ex, ey] = H.polar(R.seg1 - 6 + dist, a);
            const at = H.s('g', { transform: `translate(${f2(x)} ${f2(y)})` }, fx);
            const fly = H.s('g', { class: 'pk-drop' }, at);
            fly.style.setProperty('--dx', f2(ex - x) + 'px');
            fly.style.setProperty('--dy', f2(ey - y) + 'px');
            fly.style.setProperty('--fall', f2(10 + rand() * 18) + 'px');
            fly.style.setProperty('--d', Math.round(rand() * 80) + 'ms');
            const fall = H.s('g', { class: 'pk-fall' }, fly);
            const s = 3.4 + rand() * 3.4;
            H.s('path', { d: drop(s), transform: `rotate(${f2(a + 180)})`, class: 'pk-drop-body' }, fall);
            H.s('circle', { cx: f2(-s * 0.3), cy: f2(s * 0.1), r: f2(s * 0.28), class: 'pk-drop-hi' }, fall);
          }
          if (t != null) return;
          clearTimeout(root.__pkFx);
          root.__pkFx = setTimeout(() => (fx.textContent = ''), 700);
        },
      },

      sounds: {
        // A soft tear of peel and a small pop as the fruit opens.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 2400, f2: 900, q: 1.4, dur: 0.09, gain: 0.16, a: 0.008 });
          X.tone(ac, out, t + 0.03, { type: 'sine', f: 260, f2: 170, dur: 0.07, gain: 0.07, a: 0.004 });
        },
        // A tiny wet plip: a falling sine with a soft attack.
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'sine', f: 1500, f2: 640, dur: 0.032, gain: 0.08, a: 0.0015 });
        },
        // The squeeze: a low squelch, three drops landing and a fizz of zest.
        success(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'lowpass', f: 1500, f2: 320, q: 3.5, dur: 0.17, gain: 0.2, a: 0.012 });
          X.tone(ac, out, t + 0.02, { type: 'sine', f: 190, f2: 120, dur: 0.12, gain: 0.06, a: 0.01 });
          [
            [0.1, 760, 1450],
            [0.16, 980, 1760],
            [0.235, 860, 1600],
          ].forEach(([d, f, f3]) =>
            X.tone(ac, out, t + d, { type: 'sine', f, f2: f3, dur: 0.045, gain: 0.05, a: 0.002 }),
          );
          X.burst(ac, out, t + 0.05, { type: 'highpass', f: 5200, q: 0.6, dur: 0.28, gain: 0.035, a: 0.04 });
        },
      },
    });
  })();
}
