// SPDX-License-Identifier: MIT
// Ebru: three variants of the paint-on-water wheel.
//   ebru-a  Wet drop: a fat drop slaps the slice, splatters, throws droplets and dries with a darker rim.
//   ebru-b  Spray: an airbrush burst of particles, a mist that drifts past the edges, a speckled stain.
//   ebru-c  Bloom and comb: drops bloom inside each other, then a comb drags the rings over the rim.
// The variants share the tray, the slice layout, the label layer, the Home styling and the splash
// plumbing: each variant has one draw(t) function per splash, used live (requestAnimationFrame),
// for still frames (t set) and for the lasting stain of the selected state.
export default function register(Board) {
  (function () {
    'use strict';

    // ---------------------------------------------------------------- math
    // Angles are degrees from twelve o'clock, clockwise, as in the engine.
    const C = 200;
    const rad = (a) => (a * Math.PI) / 180;
    const f1 = (n) => String(Math.round(n * 10) / 10);
    const f2 = (n) => String(Math.round(n * 100) / 100);
    const at = (cx, cy, r, a) => [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))];
    const pt = (p) => `${f1(p[0])} ${f1(p[1])}`;
    const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const out3 = (x) => 1 - (1 - clamp01(x)) ** 3;
    const out2 = (x) => 1 - (1 - clamp01(x)) ** 2;
    const inOut = (x) => {
      x = clamp01(x);
      return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
    };
    const smooth = (e0, e1, x) => {
      const t = clamp01((x - e0) / (e1 - e0));
      return t * t * (3 - 2 * t);
    };
    const angDist = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
    // Seeded random numbers, so a splash looks the same in every frame, live or still.
    function rng(seed) {
      let s = seed >>> 0 || 1;
      return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r() * 0.999)) * Math.cos(2 * Math.PI * r());
    const reducedMotion = () => document.documentElement.classList.contains('reduce-motion');

    // ---------------------------------------------------------------- geometry
    // Slices R0..R1, the rim RB0..RB1, the landing point of a drop (and the label center) RC.
    // RMAX bounds every splash so droplets land just outside the wheel, never far away.
    const R0 = 74,
      R1 = 172,
      RB0 = 176,
      RB1 = 190,
      RC = 124,
      GAP = 3,
      RMAX = 211;

    const ringD = (r0, r1, cx = C, cy = C) =>
      `M${f2(cx)} ${f2(cy - r1)}a${f2(r1)} ${f2(r1)} 0 1 1 0 ${f2(2 * r1)}a${f2(r1)} ${f2(r1)} 0 1 1 0 ${f2(-2 * r1)}Z` +
      (r0 > 0
        ? `M${f2(cx)} ${f2(cy - r0)}a${f2(r0)} ${f2(r0)} 0 1 0 0 ${f2(2 * r0)}a${f2(r0)} ${f2(r0)} 0 1 0 0 ${f2(-2 * r0)}Z`
        : '');
    const circleD = (x, y, r) =>
      `M${f1(x - r)} ${f1(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
    // An ellipse whose long axis runs along the unit vector (ux, uy).
    function ellipseD(x, y, rx, ry, ux, uy) {
      const deg = (Math.atan2(uy, ux) * 180) / Math.PI;
      const a = [x - ux * rx, y - uy * rx],
        b = [x + ux * rx, y + uy * rx];
      return `M${pt(a)}A${f2(rx)} ${f2(ry)} ${f1(deg)} 1 0 ${pt(b)}A${f2(rx)} ${f2(ry)} ${f1(deg)} 1 0 ${pt(a)}Z`;
    }
    // Smooth closed curve through points (Catmull-Rom as cubic Beziers).
    function closedCurve(pts) {
      const n = pts.length;
      let d = `M${pt(pts[0])}`;
      for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n],
          p1 = pts[i],
          p2 = pts[(i + 1) % n],
          p3 = pts[(i + 2) % n];
        d += `C${pt([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${pt([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${pt(p2)}`;
      }
      return d + 'Z';
    }
    const polyD = (pts) => 'M' + pts.map(pt).join('L') + 'Z';
    // Shortens a reach from P in direction a so that its end stays within max of the wheel center.
    function reach(P, a, len, max = RMAX) {
      for (let k = 0; k < 40; k++) {
        const q = at(P[0], P[1], len, a);
        if (Math.hypot(q[0] - C, q[1] - C) <= max) return len;
        len *= 0.95;
      }
      return len;
    }

    // An organic blob: a circle waved by a few low harmonics, with lobes where the paint pushed out.
    function blobProfile(r, o = {}) {
      const { n = 48, wob = 0.06, lobes = 5, ext = [0.12, 0.4], w = [10, 22] } = o;
      return {
        n,
        harm: [
          [2, 1],
          [3, 0.8],
          [5, 0.5],
          [8, 0.3],
        ].map(([h, k]) => [h, r() * 6.283, wob * k * (0.6 + r() * 0.8)]),
        lobes: Array.from({ length: lobes }, () => ({
          a: r() * 360,
          w: w[0] + r() * (w[1] - w[0]),
          e: ext[0] + r() * (ext[1] - ext[0]),
        })),
      };
    }
    function blobR(prof, a, kh = 1, kl = 1) {
      let m = 1;
      for (const [h, ph, amp] of prof.harm) m += kh * amp * Math.sin(h * rad(a) + ph);
      for (const l of prof.lobes) {
        const d = angDist(a, l.a) / l.w;
        if (d < 1) m += kl * l.e * (1 - d * d) ** 2;
      }
      return m;
    }
    function blobPts(prof, cx, cy, base, kh = 1, kl = 1) {
      const pts = [];
      for (let j = 0; j < prof.n; j++) {
        const a = (j * 360) / prof.n;
        pts.push(at(cx, cy, base * blobR(prof, a, kh, kl), a));
      }
      return pts;
    }
    // A circle around (cx, cy) waved by harmonics whose phases drift with k: neighbouring
    // contours swell, pinch and cross like floated paint.
    const WAVES = [
      [3, 2.2, 0.9, 0.23],
      [5, 1.5, 2.1, -0.31],
      [7, 1.0, 0.4, 0.47],
      [13, 0.6, 1.3, 0.61],
      [19, 0.4, 2.7, -0.53],
    ];
    function wavyCircle(cx, cy, r0, k, amp = 1, steps = 144) {
      const pts = [];
      for (let j = 0; j < steps; j++) {
        const a = (j * 360) / steps,
          t = rad(a);
        let r = r0;
        for (const [h, w, ph, drift] of WAVES) r += amp * w * Math.sin(h * t + ph + k * drift);
        pts.push(at(cx, cy, r, a));
      }
      return closedCurve(pts);
    }
    // A ring band boundary combed by radial tines, alternately outward and inward (gel-git).
    function combedRing(r0, tines, amp, lam, steps, phase = 0) {
      const pts = [];
      const step = 360 / tines;
      for (let j = 0; j < steps; j++) {
        const a = (j * 360) / steps;
        const k = Math.round((a - phase) / step);
        const d = (Math.abs(a - phase - k * step) * Math.PI * r0) / 180;
        const dir = k % 2 ? 1 : -1;
        pts.push(at(C, C, r0 + dir * amp * (lam / (d + lam)), a));
      }
      return polyD(pts);
    }

    // ---------------------------------------------------------------- shared wheel
    // Four pigments in turn round the tray; on a wheel of five the last slice takes the second, so
    // it differs from both of its neighbours.
    const fourPigments = (i, n) => (n % 4 === 1 && n > 1 && i === n - 1 ? 2 : (i % 4) + 1);

    // Per-slice pigment variables: --p (stain), --pd (deep, drying rim), --pw (idle wash),
    // --ph (hover wash), --op (text on the stain), --q (the second pigment, used by C).
    function pigmentVars(node, V, sl, n) {
      if (sl.off) {
        for (const [k, v] of [
          ['--p', 'var(--border-strong)'],
          ['--pd', 'var(--border-strong)'],
          ['--pw', 'transparent'],
          ['--ph', 'var(--surface-2)'],
          ['--op', 'var(--text)'],
          ['--q', 'var(--border-strong)'],
        ])
          node.style.setProperty(k, v);
        return;
      }
      const k = V.pig(sl.i, n),
        q = V.second ? V.second(sl.i) : k;
      node.style.setProperty('--p', `var(--p${k})`);
      node.style.setProperty('--pd', `var(--p${k}d)`);
      node.style.setProperty('--pw', V.neutral ? 'var(--wheel-slice)' : `var(--w${k})`);
      node.style.setProperty('--ph', V.neutral ? 'var(--wheel-slice-hover)' : `var(--h${k})`);
      node.style.setProperty('--op', `var(--on-p${k})`);
      node.style.setProperty('--q', `var(--p${q})`);
    }

    // Runs after the wheel is on screen: in a task after the next frame, or at once where there are
    // no frames (a page in the background still gets its hover paint).
    const afterFirstFrame = (fn) => {
      if (typeof requestAnimationFrame !== 'function' || document.visibilityState === 'hidden')
        return setTimeout(fn, 0);
      return requestAnimationFrame(() => setTimeout(fn, 0));
    };

    function makeRender(V) {
      return function render(root, m, H) {
        const id = H.uid(V.id + '-w');
        root._eb = { sel: null, raf: 0 };
        const defs = H.s('defs', {}, root);
        let clips = `<clipPath id="${id}-rim"><path d="${ringD(RB0, RB1)}"/></clipPath>`;
        for (const sl of m.slices)
          clips += `<clipPath id="${id}-w${sl.i}"><path d="${H.sector(R0 - 2, RMAX + 4, sl.a0, sl.a1)}"/></clipPath>`;
        defs.innerHTML = clips;

        H.s('circle', { cx: C, cy: C, r: RB1, class: 'eb-face' }, root);
        const bodies = H.s('g', { class: 'eb-bodies' }, root);
        const rim = H.s('g', { class: 'eb-rim' }, root);
        const gushes = H.s('g', { class: 'eb-gushes' }, root);
        H.s('g', { class: 'eb-paint' }, root);
        const hub = H.s('g', { class: 'eb-hub' }, root);
        const labels = H.s('g', { class: 'eb-labels' }, root);
        H.s('g', { class: 'eb-air' }, root); // paint in flight passes over the labels

        // Labels sit in their own top layer, above any paint, with a halo in the slice color. Formats
        // read as their name, large, with their second line where they have one.
        for (const sl of m.slices) {
          const lab = H.s('g', { class: 'eb-lab' + (sl.off ? ' is-off' : ''), 'data-for': sl.i }, labels);
          pigmentVars(lab, V, sl, m.n);
          lab.style.setProperty('--i', sl.i);
          const parts = sl.format
            ? H.block(lab, sl, RC, {
                size: V.fmtSize || 23,
                subSize: 12.5,
                gap: 1,
                maxWidth: 84,
                cls: 'eb-lbl eb-fmt',
                subCls: 'eb-sub',
              })
            : H.block(lab, sl, RC, {
                icon: true,
                iconSize: 24,
                size: 14.5,
                gap: 5,
                maxWidth: 82,
                minSize: 9,
                cls: 'eb-lbl',
                sub: null,
              });
          if (parts.icon) {
            const halo = parts.icon.cloneNode(true);
            halo.classList.add('eb-ico-halo');
            parts.icon.parentNode.insertBefore(halo, parts.icon);
          }
        }
        H.s('circle', { cx: C, cy: C, r: R0 - 3, class: 'eb-hub-bg' }, hub);
        H.s('g', { class: 'eb-hub-rings' }, hub).innerHTML = V.hubRings;
        const txt = H.s('g', { class: 'eb-hub-text' }, hub);
        // Without a key the title and the file move down to the middle of the hub.
        const dy = m.key ? 0 : 9;
        H.label(txt, C, C - 17 + dy, m.title, { maxWidth: 104, size: 17, minSize: 10, cls: 'eb-title', maxLines: 1 });
        H.label(txt, C, C + 4 + dy, m.file, { maxWidth: 104, size: 12, minSize: 9, cls: 'eb-file', maxLines: 1 });
        if (m.key) {
          const kw = 14 + m.key.length * 7.5;
          H.s('rect', { x: C - kw / 2, y: C + 20, width: kw, height: 19, rx: 9.5, class: 'eb-key' }, txt);
          H.text(txt, C, C + 30, m.key, { class: 'eb-keytext' });
        }

        H.s('use', { href: `#${V.id}-rim`, 'clip-path': `url(#${id}-rim)` }, rim);
        H.s('path', { d: ringD(RB0 - 0.6, RB0) + ringD(RB1 - 0.8, RB1), class: 'eb-rim-line' }, rim);
        const hovers = [];
        for (const sl of m.slices) {
          const P = at(C, C, RC, sl.mid);
          const g = H.slice(bodies, sl, m);
          pigmentVars(g, V, sl, m.n);
          H.s('path', { d: H.sector(R0, RB0, sl.a0, sl.a1), class: 'eb-hit' }, g);
          H.s('path', { d: H.sector(R0, R1, sl.a0, sl.a1, GAP), class: 'eb-seg' }, g);
          if (V.band) H.s('path', { d: H.sector(R1 - V.band, R1, sl.a0, sl.a1, GAP), class: 'eb-band' }, g);
          H.s('path', { d: H.sector(R1 - 5, R1, sl.a0, sl.a1, GAP), class: 'eb-edge' }, g);
          if (!sl.off) {
            hovers.push({ g, sl, P });
            // The open spill: the pigment squeezed out of its landing point, clipped to its
            // wedge (drops press against each other at the slice borders) but free to run
            // over the rim and past the edge of the tray.
            const gc = H.s('g', { 'clip-path': `url(#${id}-w${sl.i})` }, gushes);
            const gg = H.s('g', { class: 'eb-gush' }, gc);
            pigmentVars(gg, V, sl, m.n);
            gg.style.setProperty('--i', sl.i);
            gg.style.transformOrigin = `${f1(P[0])}px ${f1(P[1])}px`;
            V.gush(gg, { H, P, sl, rnd: rng(V.seed * 7 + sl.i * 29 + 5) });
          }
        }

        // The paint a slice shows under the pointer is not needed to open the wheel: it is laid on
        // once the wheel is on screen, long before a pointer can rest on a slice.
        const lay = () => {
          if (!root.isConnected || root._eb.hovers) return;
          root._eb.hovers = true;
          let more = '';
          for (const { sl } of hovers)
            more += `<clipPath id="${id}-s${sl.i}"><path d="${H.sector(R0, R1, sl.a0, sl.a1, GAP)}"/></clipPath>`;
          defs.insertAdjacentHTML('beforeend', more);
          for (const { g, sl, P } of hovers) {
            const hov = H.s('g', { class: 'eb-hov', 'clip-path': `url(#${id}-s${sl.i})` }, g);
            V.hover(hov, { H, P, sl, rnd: rng(V.seed * 53 + sl.i * 11 + 7), id: `${id}-h${sl.i}` });
          }
        };
        root._eb.lay = lay;
        afterFirstFrame(lay);
      };
    }

    // The splash plumbing shared by the variants. V.splash(ctx) builds the elements of one splash
    // and returns draw(t); draw(V.T) is the lasting stain.
    function stainHooks(V) {
      function clear(root) {
        for (const sel of ['.eb-paint', '.eb-air']) {
          const n = root.querySelector(sel);
          if (n) n.textContent = '';
        }
        root.querySelectorAll('.eb-lab.is-stained').forEach((l) => l.classList.remove('is-stained'));
      }
      function make(root, m, i, H) {
        clear(root);
        const sl = m.slices[i];
        const g = H.s('g', { class: 'eb-stain' }, root.querySelector('.eb-paint'));
        const air = H.s('g', { class: 'eb-stain-air' }, root.querySelector('.eb-air'));
        pigmentVars(g, V, sl, m.n);
        pigmentVars(air, V, sl, m.n);
        const lab = root.querySelector(`.eb-lab[data-for="${i}"]`);
        const P = at(C, C, RC, sl.mid);
        const out = [Math.sin(rad(sl.mid)), -Math.cos(rad(sl.mid))];
        const draw = V.splash({ g, air, H, P, out, sl, rnd: rng(V.seed * 1009 + i * 71 + 11) });
        return (t) => {
          draw(t);
          if (lab) lab.classList.toggle('is-stained', t >= V.coverAt);
        };
      }
      return {
        update(root, m, st, H) {
          // A pointer that rests on a slice before its hover paint was laid gets it now.
          if (st.hover != null && root._eb && !root._eb.hovers) root._eb.lay();
          root.querySelectorAll('.eb-lab').forEach((l) => {
            const i = +l.dataset.for;
            l.classList.toggle('is-hover', i === st.hover);
            l.classList.toggle('is-selected', i === st.selected);
          });
          const s = root._eb;
          if (!s || st.selected === s.sel) return;
          const wrap = root.closest('.wheel');
          if (st.selected == null) {
            // Paint that has landed stays until the effect ends; the wheel closes right after.
            if (wrap && wrap.classList.contains('is-applying')) return;
            cancelAnimationFrame(s.raf);
            clear(root);
            s.sel = null;
            return;
          }
          cancelAnimationFrame(s.raf);
          s.sel = st.selected;
          make(root, m, st.selected, H)(V.T);
        },
        onSelect(root, m, i, H, t) {
          const s = root._eb;
          cancelAnimationFrame(s.raf);
          s.sel = i;
          const draw = make(root, m, i, H);
          if (t != null) return draw(t);
          if (reducedMotion()) return draw(V.T);
          const t0 = performance.now();
          draw(0);
          const step = (now) => {
            if (!root.isConnected) return;
            const e = now - t0;
            draw(Math.min(e, V.T));
            if (e < V.T) s.raf = requestAnimationFrame(step);
          };
          s.raf = requestAnimationFrame(step);
        },
        onOpen(root) {
          const s = root._eb;
          const wrap = root.closest('.wheel');
          if (!s || !wrap || wrap.classList.contains('has-selected')) return;
          cancelAnimationFrame(s.raf);
          clear(root);
          s.sel = null;
        },
      };
    }

    // ================================================================ A: wet drop
    // A fat drop slaps the slice: the splat flattens with lobes, throws spatter rays and droplets
    // past the slice, the rim and the tray, then dries with a darker rim while its gloss fades.
    const A_IMPACT = 34; // ms of fall before the drop hits; the paint is on the slice right after
    function splashA(x) {
      const { g, air, H, P, rnd } = x;
      const base = 44;
      const prof = blobProfile(rnd, { n: 72, wob: 0.05, lobes: 7, ext: [0.14, 0.38], w: [8, 16] });
      const dir = (a) => [Math.sin(rad(a)), -Math.cos(rad(a))];
      // The crown: short fat tongues of paint with round ends, and a few long thin streaks.
      const tongue = (long) => {
        const a = rnd() * 360,
          e = base * blobR(prof, a);
        return long
          ? {
              a,
              len: Math.max(8, reach(P, a, e + 30 + rnd() * 36) - e),
              w: 1.8 + rnd() * 1.4,
              bead: 1.4 + rnd() * 1.3,
              d: 6 + rnd() * 20,
            }
          : {
              a,
              len: Math.max(4, reach(P, a, e + 6 + rnd() * 22) - e),
              w: 5 + rnd() * 5,
              bead: 2.6 + rnd() * 2.4,
              d: rnd() * 16,
            };
      };
      const tongues = Array.from({ length: 20 }, (_, k) => tongue(k >= 15));
      const drops = Array.from({ length: 28 }, (_, k) => {
        const a = rnd() * 360,
          near = k < 13;
        return {
          a,
          u: dir(a),
          dist: reach(P, a, near ? 54 + rnd() * 22 : 74 + rnd() * 62),
          r: near ? 1.6 + rnd() * 3 : 0.9 + rnd() * 2.6,
          d: rnd() * 30,
          dur: 70 + rnd() * (near ? 60 : 130),
        };
      });
      const el = (cls, parent = g) => H.s('path', { class: cls }, parent);
      const bleed = el('eb-a-bleed'),
        body = el('eb-a-paint'),
        tong = el('eb-a-paint'),
        beads = el('eb-a-paint'),
        landed = el('eb-a-paint');
      const rimP = el('eb-a-rim'),
        dry = el('eb-a-dry'),
        sheen = el('eb-a-sheen');
      const ring = H.s('circle', { class: 'eb-a-ring', cx: f1(P[0]), cy: f1(P[1]) }, g);
      const shadow = el('eb-a-shadow', air),
        fall = el('eb-a-paint', air),
        fallHi = el('eb-a-sheen', air),
        fly = el('eb-a-paint', air);
      const all = [bleed, body, tong, beads, landed, rimP, dry, sheen, shadow, fall, fallHi, fly];
      return (t) => {
        const u = t - A_IMPACT;
        if (u < 0) {
          // A fat glossy drop falls toward its shadow on the paper.
          for (const e of all) e.setAttribute('d', '');
          const f = clamp01(t / A_IMPACT);
          const x0 = P[0] - 15 * (1 - f),
            y0 = P[1] - 26 * (1 - f);
          shadow.setAttribute('d', ellipseD(P[0] + 2, P[1] + 2, 11 + 5 * f, 9 + 5 * f, 1, 0));
          shadow.style.opacity = f2(0.12 + 0.2 * f);
          fall.setAttribute('d', ellipseD(x0, y0, 19, 16, 0.5, 0.866));
          fallHi.setAttribute('d', ellipseD(x0 - 6, y0 - 6, 6.5, 3, 0.8, -0.6));
          fallHi.style.opacity = '0.6';
          ring.style.opacity = '0';
          return;
        }
        shadow.setAttribute('d', '');
        fall.setAttribute('d', '');
        fallHi.setAttribute('d', '');
        // The drop flattens at a third of its final size, overshoots and settles back.
        const s = u < 110 ? 0.4 + 0.67 * out3(u / 110) : u < 240 ? 1.07 - 0.07 * inOut((u - 110) / 130) : 1;
        const kh = 0.35 + 0.65 * clamp01(u / 90),
          kl = out3((u - 4) / 140);
        const coreD = closedCurve(blobPts(prof, P[0], P[1], base * s, kh, kl));
        body.setAttribute('d', coreD);
        rimP.setAttribute('d', coreD);
        rimP.style.opacity = f2(smooth(140, 470, u));
        // Drying: pigment moves to the edge (a darker rim, a paler middle) and wicks a little out.
        const dr = smooth(170, 560, u);
        dry.setAttribute(
          'd',
          dr > 0.01 ? closedCurve(blobPts(prof, P[0] + 1, P[1] + 1, base * s * 0.8, kh, kl * 0.7)) : '',
        );
        dry.style.opacity = f2(0.2 * dr);
        const bl = smooth(120, 600, u);
        bleed.setAttribute(
          'd',
          bl > 0.01 ? closedCurve(blobPts(prof, P[0], P[1], base * s * (1 + 0.075 * bl), kh, kl)) : '',
        );
        bleed.style.opacity = f2(0.3 * bl);
        let td = '',
          bd = '';
        for (const r of tongues) {
          const q = out3((u - r.d) / 110);
          if (q <= 0.03) continue;
          const e = base * s * blobR(prof, r.a, kh, kl);
          const e0 = e * 0.8,
            e1 = e + r.len * q;
          const v = dir(r.a),
            n = [-v[1], v[0]];
          const hw = r.w / 2;
          const tip = Math.min(hw, r.bead) * 0.55;
          const p = (rr, side) => [P[0] + v[0] * rr + n[0] * side, P[1] + v[1] * rr + n[1] * side];
          td += `M${pt(p(e0, hw))}Q${pt(p(e + (e1 - e) * 0.35, hw * 0.55))} ${pt(p(e1, tip))}L${pt(p(e1, -tip))}Q${pt(p(e + (e1 - e) * 0.35, -hw * 0.55))} ${pt(p(e0, -hw))}Z`;
          const br = r.bead * (0.5 + 0.5 * q);
          bd += circleD(P[0] + v[0] * (e1 + br * 0.35), P[1] + v[1] * (e1 + br * 0.35), br);
        }
        tong.setAttribute('d', td);
        beads.setAttribute('d', bd);
        // Droplets fly in the air (above the labels) and land as small stains.
        let fd = '',
          ld = '';
        for (const p of drops) {
          const q = clamp01((u - p.d) / p.dur);
          if (q <= 0) continue;
          const r0 = base * s * 0.85;
          const dist = r0 + (p.dist - r0) * out3(q);
          const xx = P[0] + p.u[0] * dist,
            yy = P[1] + p.u[1] * dist;
          if (q < 1) fd += ellipseD(xx, yy, p.r * (1.15 + 1.7 * (1 - q)), p.r * (1.1 - 0.4 * (1 - q)), p.u[0], p.u[1]);
          else ld += circleD(xx, yy, p.r * 1.08);
        }
        fly.setAttribute('d', fd);
        landed.setAttribute('d', ld);
        // Wet gloss, gone once the stain is dry.
        const so = 0.5 * (1 - smooth(60, 420, u));
        sheen.style.opacity = f2(so);
        const rr = base * s;
        sheen.setAttribute(
          'd',
          so > 0.01
            ? ellipseD(P[0] - 0.34 * rr, P[1] - 0.36 * rr, 0.34 * rr, 0.11 * rr, 0.8, -0.6) +
                circleD(P[0] - 0.02 * rr, P[1] - 0.6 * rr, 0.05 * rr)
            : '',
        );
        // The impact ring on the wet size.
        ring.setAttribute('r', f1(20 + u * 0.7));
        ring.style.opacity = f2(u < 110 ? 0.65 * (1 - u / 110) : 0);
      };
    }

    function gushA(g, { H, P, sl, rnd }) {
      const prof = blobProfile(rnd, { n: 40, wob: 0.07, lobes: 5, ext: [0.18, 0.42], w: [12, 22] });
      H.s('path', { d: closedCurve(blobPts(prof, P[0], P[1], 66)), class: 'eb-gush-paint' }, g);
      for (let k = 0; k < 3; k++) {
        const a = sl.mid + (rnd() - 0.5) * 36;
        const q = at(P[0], P[1], reach(P, a, 84 + rnd() * 6, RMAX), a);
        H.s('circle', { cx: f1(q[0]), cy: f1(q[1]), r: f1(2.4 + rnd() * 2.6), class: 'eb-gush-paint' }, g);
      }
    }

    // Hover: rings run over the water from the landing point, the slice deepens.
    function hoverA(g, { H, P }) {
      for (const k of [1, 2]) {
        const c = H.s('circle', { cx: f1(P[0]), cy: f1(P[1]), r: 20, class: `eb-rip eb-rip-${k}` }, g);
        c.style.transformOrigin = `${f1(P[0])}px ${f1(P[1])}px`;
      }
    }

    // The marbled rim: bands of every pigment with veins of water between them, all moved by one
    // smooth displacement field whose phase shifts with the radius, so the bands swell, pinch and
    // shear together like floated paint and never cross. Plain paths, no filter.
    const FIELD = [
      [3, 1.6, 0.9, 0.05],
      [7, 1.2, 2.1, -0.09],
      [12, 0.9, 0.4, 0.13],
      [19, 0.7, 1.3, -0.17],
      [31, 0.5, 2.7, 0.22],
      [47, 0.3, 4.1, -0.27],
    ];
    function marbled(r0, steps = 360) {
      const pts = [];
      for (let j = 0; j < steps; j++) {
        const a = (j * 360) / steps,
          t = rad(a);
        let r = r0;
        for (const [h, w, ph, k] of FIELD) r += w * Math.sin(h * t + ph + k * r0);
        pts.push(at(C, C, r, a));
      }
      return polyD(pts);
    }
    function rimA(id) {
      const r = rng(17);
      const seq = [
        'p1',
        'f',
        'p3',
        'p2',
        'f',
        'p4',
        'w3',
        'p1',
        'f',
        'p2',
        'p3',
        'f',
        'p4',
        'w1',
        'p2',
        'f',
        'p1',
        'p4',
        'f',
        'p3',
        'w2',
      ];
      let rr = 200,
        k = 0,
        out = '';
      while (rr > 168) {
        const key = seq[k % seq.length];
        out += `<path d="${marbled(rr, 360)}" style="fill: var(--${key === 'f' ? 'wheel-face' : key})"/>`;
        rr -= key === 'f' ? 0.55 + r() * 0.45 : key[0] === 'w' ? 1.2 + r() * 1.2 : 0.9 + r() * 1.5;
        k++;
      }
      return `<g id="${id}-rim">${out}</g>`;
    }

    // ================================================================ B: spray
    // An airbrush burst: hundreds of particles fan out from the slice center with a dense core
    // and a density falloff; a mist drifts past the edges; a speckled stain stays.
    const gradStops = (stops) =>
      stops.map(([o, a]) => `<stop offset="${o}" style="stop-color: var(--p); stop-opacity: ${a}"/>`).join('');
    function splashB(x) {
      const { g, air, H, P, out, rnd } = x;
      const id = H.uid('ebru-b-s');
      const defs = H.s('defs', {}, g);
      defs.innerHTML =
        `<radialGradient id="${id}-c">${gradStops([
          [0, 1],
          [0.62, 1],
          [0.8, 0.6],
          [1, 0],
        ])}</radialGradient>` +
        `<radialGradient id="${id}-m">${gradStops([
          [0, 0.45],
          [0.5, 0.18],
          [1, 0],
        ])}</radialGradient>`;
      const mist = H.s('circle', { class: 'eb-b-mist', fill: `url(#${id}-m)` }, g);
      const core = H.s('circle', { class: 'eb-b-core', cx: f1(P[0]), cy: f1(P[1]), fill: `url(#${id}-c)` }, g);
      const landed = [0, 1, 2].map((k) => H.s('path', { class: `eb-b-dot${k}` }, g));
      const flying = [0, 1, 2].map((k) => H.s('path', { class: `eb-b-dot${k}` }, air));
      const parts = [];
      for (let k = 0; k < 720; k++) {
        const u = rnd(),
          a = rnd() * 360;
        let p;
        // The dense core, a halo with a density falloff, fine overspray that drifts, and a few
        // heavy spits from the nozzle near the core.
        if (u < 0.5)
          p = {
            dist: Math.min(52, 4 + Math.abs(gauss(rnd)) * 20),
            size: 0.9 + rnd() * 1.6,
            d: rnd() * 40,
            dur: 60 + rnd() * 90,
            drift: 0,
          };
        else if (u < 0.84)
          p = {
            dist: Math.min(100, 30 + Math.abs(gauss(rnd)) * 28),
            size: 0.8 + rnd() * 1.3,
            d: 6 + rnd() * 60,
            dur: 110 + rnd() * 140,
            drift: 2 + rnd() * 5,
          };
        else if (u < 0.985)
          p = {
            dist: 64 + rnd() * 86,
            size: 0.55 + rnd() * 0.9,
            d: 20 + rnd() * 110,
            dur: 200 + rnd() * 240,
            drift: 4 + rnd() * 10,
          };
        else p = { dist: 46 + rnd() * 26, size: 2.4 + rnd() * 2, d: rnd() * 30, dur: 90 + rnd() * 60, drift: 0 };
        p.dist = reach(P, a, p.dist, RMAX - p.drift);
        p.u = [Math.sin(rad(a)), -Math.cos(rad(a))];
        p.tone = rnd() < 0.6 ? 0 : rnd() < 0.55 ? 1 : 2;
        parts.push(p);
      }
      return (t) => {
        const tt = t + 22; // the burst has just left the nozzle at t = 0
        core.setAttribute('r', f1(8 + 46 * out3((tt - 10) / 200)));
        const drift = 14 * smooth(0, 660, t);
        mist.setAttribute('cx', f1(P[0] + out[0] * drift));
        mist.setAttribute('cy', f1(P[1] + out[1] * drift));
        mist.setAttribute('r', f1(30 + 96 * out2(tt / 470)));
        mist.style.opacity = f2(smooth(0, 70, tt) * (1 - 0.3 * smooth(220, 660, t)));
        const ls = ['', '', ''],
          fs = ['', '', ''];
        for (const p of parts) {
          const q = clamp01((tt - p.d) / p.dur);
          if (q <= 0) continue;
          const e = out3(q);
          const dr = p.drift * smooth(0, 1, (tt - p.d - p.dur) / 380);
          const d = circleD(
            P[0] + p.u[0] * p.dist * e + out[0] * dr,
            P[1] + p.u[1] * p.dist * e + out[1] * dr,
            p.size * (0.6 + 0.4 * e),
          );
          if (q < 1) fs[p.tone] += d;
          else ls[p.tone] += d;
        }
        ls.forEach((d, k) => landed[k].setAttribute('d', d));
        fs.forEach((d, k) => flying[k].setAttribute('d', d));
      };
    }

    function gushB(g, { H, P, rnd }) {
      const id = H.uid('ebru-b-g');
      H.s('defs', {}, g).innerHTML = `<radialGradient id="${id}">${gradStops([
        [0, 0.95],
        [0.55, 0.8],
        [1, 0],
      ])}</radialGradient>`;
      H.s('circle', { cx: f1(P[0]), cy: f1(P[1]), r: 66, fill: `url(#${id})` }, g);
      let d = '';
      for (let k = 0; k < 110; k++) {
        const a = rnd() * 360,
          dist = Math.abs(gauss(rnd)) * 38 + 18;
        const q = at(P[0], P[1], reach(P, a, dist, RMAX), a);
        d += circleD(q[0], q[1], 0.8 + rnd() * 2);
      }
      H.s('path', { d, class: 'eb-gush-paint' }, g);
    }

    // Hover: a light mist breathes over the slice with a first dusting of paint, as when the
    // nozzle is tried, and the pigment band at the edge widens.
    function hoverB(g, { H, P, sl, rnd, id }) {
      H.s('defs', {}, g).innerHTML = `<radialGradient id="${id}">${gradStops([
        [0, 0.5],
        [0.55, 0.2],
        [1, 0],
      ])}</radialGradient>`;
      const mist = H.s('circle', { cx: f1(P[0]), cy: f1(P[1]), r: 64, fill: `url(#${id})`, class: 'eb-mist' }, g);
      mist.style.transformOrigin = `${f1(P[0])}px ${f1(P[1])}px`;
      let d = '';
      for (let k = 0; k < 70; k++) {
        const a = rnd() * 360,
          dist = 26 + Math.abs(gauss(rnd)) * 24;
        const q = at(P[0], P[1], dist, a);
        d += circleD(q[0], q[1], 0.7 + rnd() * 1.3);
      }
      H.s('path', { d, class: 'eb-dust' }, g);
      H.s('path', { d: H.sector(R1 - 15, R1, sl.a0, sl.a1, GAP), class: 'eb-band2' }, g);
    }

    function rimB(id) {
      const r = rng(29);
      const d = ['', '', '', ''];
      for (let k = 0; k < 420; k++) {
        const a = r() * 360,
          rr = RB0 + 0.5 + r() * (RB1 - RB0 - 1),
          s = 0.45 + r() * 1.35;
        const q = at(C, C, rr, a);
        d[k % 4] += circleD(q[0], q[1], s);
      }
      return `<g id="${id}-rim"><path d="${ringD(RB0, RB1)}" style="fill: var(--rim-base)"/>${d.map((dd, k) => `<path d="${dd}" style="fill: var(--p${k + 1})"/>`).join('')}</g>`;
    }

    // ================================================================ C: bloom and comb
    // Drops land inside each other and push the earlier ones out into rings (equal areas, as on
    // water), then a comb is drawn through the outer rings toward the rim, pulling them into
    // feathered points that spill over the edge. The core stays whole, under the label.
    function splashC(x) {
      const { g, H, P, out, rnd } = x;
      const tan = [-out[1], out[0]];
      const ring = (r1, r0) => Math.PI * (r1 * r1 - r0 * r0);
      const drops = [
        { cls: 'eb-c-q', A: ring(62, 49), t: 0 },
        { cls: 'eb-c-w', A: ring(49, 46), t: 34 },
        { cls: 'eb-c-p', A: ring(46, 42), t: 58 },
        { cls: 'eb-c-g', A: ring(42, 39.5), t: 82 },
        { cls: 'eb-c-w', A: ring(39.5, 36.5), t: 106 },
        { cls: 'eb-c-p', A: ring(36.5, 0), t: 130 },
      ];
      const els = drops.map((d) => H.s('path', { class: 'eb-c-drop ' + d.cls }, g));
      const wob = drops.map(() => [rnd() * 6.28, rnd() * 6.28]);
      // A hand-held comb: fine tines about 8 units apart, each pulling a little differently.
      const N = 300,
        S = 8.5,
        LAM = 2.1,
        AMAX = 44,
        LEAN = 0.12;
      const off = (rnd() - 0.5) * 3;
      const pull = Array.from({ length: 16 }, () => 0.65 + rnd() * 0.6);
      const lam = Array.from({ length: 16 }, () => LAM * (0.75 + rnd() * 0.6));
      return (t) => {
        // The first drop is already spreading at t = 0; the others land inside it.
        const e = drops.map((d) => out3((t - d.t + 40) / 120));
        const alpha = AMAX * inOut((t - 230) / 340);
        const R = [];
        let acc = 0;
        for (let k = drops.length - 1; k >= 0; k--) {
          acc += drops[k].A * e[k];
          R[k] = Math.sqrt(acc / Math.PI);
        }
        for (let k = 0; k < drops.length; k++) {
          if (e[k] <= 0 || R[k] < 0.4) {
            els[k].setAttribute('d', '');
            continue;
          }
          const pts = [];
          for (let j = 0; j < N; j++) {
            const th = (j / N) * 2 * Math.PI;
            const rr = R[k] * (1 + 0.012 * Math.sin(3 * th + wob[k][0]) + 0.008 * Math.sin(5 * th + wob[k][1]));
            const rx = Math.cos(th) * rr,
              ry = Math.sin(th) * rr;
            const v = rx * out[0] + ry * out[1],
              u = rx * tan[0] + ry * tan[1];
            let dv = 0;
            if (alpha > 0) {
              const w = (u - off) / S - 0.5;
              const ti = Math.round(w);
              const ix = (((ti + 8) % 16) + 16) % 16;
              const dist = Math.abs(w - ti) * S;
              // Stronger in the middle of the comb, weaker at its ends; the core is never touched.
              const env = 0.55 + 0.45 * Math.exp(-((u / 40) ** 2));
              dv = alpha * pull[ix] * env * (lam[ix] / (dist + lam[ix])) * smooth(-10, 22, v) * smooth(37, 46, rr);
            }
            // The hand moves in a slight arc, so the feathers lean; past the rim they slow down.
            let x = P[0] + rx + out[0] * dv + tan[0] * dv * LEAN,
              y = P[1] + ry + out[1] * dv + tan[1] * dv * LEAN;
            const dc = Math.hypot(x - C, y - C);
            if (dc > 196) {
              const k2 = (196 + (dc - 196) * 0.4) / dc;
              x = C + (x - C) * k2;
              y = C + (y - C) * k2;
            }
            pts.push([x, y]);
          }
          els[k].setAttribute('d', polyD(pts));
        }
      };
    }

    function gushC(g, { H, P }) {
      H.s('circle', { cx: f1(P[0]), cy: f1(P[1]), r: 72, class: 'eb-gush-q' }, g);
      H.s('circle', { cx: f1(P[0]), cy: f1(P[1]), r: 56, class: 'eb-gush-w' }, g);
      H.s('circle', { cx: f1(P[0]), cy: f1(P[1]), r: 52, class: 'eb-gush-g' }, g);
      H.s('circle', { cx: f1(P[0]), cy: f1(P[1]), r: 48, class: 'eb-gush-w' }, g);
      H.s('circle', { cx: f1(P[0]), cy: f1(P[1]), r: 43, class: 'eb-gush-paint' }, g);
    }

    // Hover: faint combed lines run across the slice and sway back and forth (gel-git), a
    // preview of the comb.
    function hoverC(g, { H, sl }) {
      const sway = H.s('g', { class: 'eb-sway' }, g);
      let d = '';
      for (let r = R0 + 7; r < R1 - 3; r += 7.5) {
        const pts = [];
        for (let a = sl.a0 - 2; a <= sl.a1 + 2; a += 0.5) {
          const k = Math.round(a / 7.5);
          const dd = (Math.abs(a - k * 7.5) * Math.PI * r) / 180;
          pts.push(at(C, C, r + (k % 2 ? 1 : -1) * 3.4 * (2.2 / (dd + 2.2)), a));
        }
        d += 'M' + pts.map(pt).join('L');
      }
      H.s('path', { d, class: 'eb-comb-lines' }, sway);
    }

    function rimC(id) {
      const seq = [
        ['p1', 2.6],
        ['f', 1.0],
        ['p2', 2.2],
        ['f', 0.9],
        ['gold', 1.1],
        ['f', 0.9],
        ['p1', 2.4],
        ['f', 1.0],
        ['p2', 2.0],
        ['f', 0.9],
        ['p1', 2.6],
        ['f', 1.0],
        ['p2', 2.4],
      ];
      let rr = 200,
        out = '',
        k = 0;
      while (rr > 168) {
        const [key, w] = seq[k % seq.length];
        out += `<path d="${combedRing(rr, 64, 3.2, 2.2, 768)}" style="fill: var(--${key === 'f' ? 'wheel-face' : key})"/>`;
        rr -= w;
        k++;
      }
      return `<g id="${id}-rim">${out}</g>`;
    }

    // ================================================================ palettes
    // Text pairs on every pigment and wash, on top of the default pairs.
    const pairs = (n, washes) =>
      Board.DEFAULT_PAIRS.concat(
        Array.from({ length: n }, (_, j) => j + 1).flatMap((k) => [
          [`on-p${k}`, `p${k}`, 'text'],
          ...(washes
            ? [
                ['wheel-text', `w${k}`, 'text'],
                ['wheel-text', `h${k}`, 'text'],
                ['wheel-sub', `w${k}`, 'text'],
                ['wheel-sub', `h${k}`, 'text'],
              ]
            : []),
        ]),
      );

    // A: the four classic pigments. 1 indigo, 2 madder, 3 saffron ochre, 4 teal.
    const palA = {
      light: {
        bg: '#f5f1e8',
        surface: '#fdfbf6',
        'surface-2': '#efe9dc',
        border: '#e1d9c8',
        'border-strong': '#a19580',
        text: '#1d2233',
        'text-muted': '#575c6a',
        accent: '#2e3f8f',
        'on-accent': '#ffffff',
        focus: '#2e3f8f',
        success: '#1f7a5a',
        'on-success': '#ffffff',
        'success-text': '#186649',
        warning: '#b8781a',
        'warning-text': '#85550c',
        danger: '#b3302a',
        desk: 'linear-gradient(150deg, #d6dde9 0%, #e8e1d4 55%, #d5e3df 100%)',
        'wheel-face': '#fbf8f1',
        'wheel-slice': '#e5e8f4',
        'wheel-slice-hover': '#cbd2ee',
        'wheel-slice-selected': '#2e3f8f',
        'wheel-text': '#1d2233',
        'wheel-text-selected': '#ffffff',
        'wheel-sub': '#4c5160',
        'wheel-line': '#d9d0bf',
        'wheel-shadow': 'rgba(52, 40, 20, 0.2)',
        p1: '#2e3f8f',
        p2: '#b0332b',
        p3: '#d69c26',
        p4: '#1d6f6a',
        p1d: '#1b275f',
        p2d: '#771b15',
        p3d: '#9a6608',
        p4d: '#0f4541',
        w1: '#e5e8f4',
        w2: '#f6e2dd',
        w3: '#f7ebcf',
        w4: '#dcede9',
        h1: '#cbd2ee',
        h2: '#efc8c0',
        h3: '#f1d9a0',
        h4: '#bfe0d9',
        'on-p1': '#ffffff',
        'on-p2': '#ffffff',
        'on-p3': '#1d2233',
        'on-p4': '#ffffff',
        'rim-edge': 'rgba(40, 44, 70, 0.3)',
        dim: '0.62',
      },
      dark: {
        bg: '#12161f',
        surface: '#1a1f2a',
        'surface-2': '#232937',
        border: '#2e3544',
        'border-strong': '#5b6576',
        text: '#eeede7',
        'text-muted': '#a8aeb9',
        accent: '#a9b6f5',
        'on-accent': '#141b3d',
        focus: '#b9c4ff',
        success: '#4cc79b',
        'on-success': '#06231a',
        'success-text': '#6dd6b0',
        warning: '#e5b351',
        'warning-text': '#edc373',
        danger: '#f2837a',
        desk: 'linear-gradient(150deg, #131c27 0%, #1e1b24 55%, #11211f 100%)',
        'wheel-face': '#161b25',
        'wheel-slice': '#222943',
        'wheel-slice-hover': '#344281',
        'wheel-slice-selected': '#4458c2',
        'wheel-text': '#eeede7',
        'wheel-text-selected': '#ffffff',
        'wheel-sub': '#c4c9d1',
        'wheel-line': '#2c3640',
        'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
        p1: '#4458c2',
        p2: '#c4463c',
        p3: '#e3aa3a',
        p4: '#237a74',
        p1d: '#27367f',
        p2d: '#82241d',
        p3d: '#a06d0c',
        p4d: '#124e49',
        w1: '#222943',
        w2: '#3a2228',
        w3: '#302b20',
        w4: '#1a3532',
        h1: '#344281',
        h2: '#6c2d34',
        h3: '#5e4a1a',
        h4: '#1f5b55',
        'on-p1': '#ffffff',
        'on-p2': '#ffffff',
        'on-p3': '#1a1508',
        'on-p4': '#ffffff',
        'rim-edge': 'rgba(220, 228, 240, 0.22)',
        dim: '0.6',
      },
    };

    // B: a bold contemporary set on dark water. 1 ultramarine, 2 tangerine, 3 aqua, 4 magenta.
    const palB = {
      light: {
        bg: '#f4f4f7',
        surface: '#ffffff',
        'surface-2': '#eeeff4',
        border: '#dcdee6',
        'border-strong': '#8b91a4',
        text: '#14161e',
        'text-muted': '#555a6a',
        accent: '#2f4de0',
        'on-accent': '#ffffff',
        focus: '#2f4de0',
        success: '#14845a',
        'on-success': '#ffffff',
        'success-text': '#0f6e4a',
        warning: '#c26d00',
        'warning-text': '#8f4f00',
        danger: '#cc2f3f',
        desk: 'linear-gradient(160deg, #dfe4f2 0%, #f1e6ee 50%, #dcefee 100%)',
        'wheel-face': '#fbfbfd',
        'wheel-slice': '#eff0f5',
        'wheel-slice-hover': '#e1e4ee',
        'wheel-slice-selected': '#3354f0',
        'wheel-text': '#14161e',
        'wheel-text-selected': '#ffffff',
        'wheel-sub': '#4e5363',
        'wheel-line': '#dcdee6',
        'wheel-shadow': 'rgba(20, 24, 50, 0.18)',
        p1: '#3354f0',
        p2: '#ff7a1a',
        p3: '#12b3ad',
        p4: '#d22a74',
        p1d: '#1f36b4',
        p2d: '#c45500',
        p3d: '#0a7f7a',
        p4d: '#951550',
        'on-p1': '#ffffff',
        'on-p2': '#1a0c02',
        'on-p3': '#04201f',
        'on-p4': '#ffffff',
        'rim-base': '#e9ebf1',
        'rim-edge': 'rgba(20, 24, 50, 0.16)',
        dim: '0.7',
      },
      dark: {
        bg: '#0f1117',
        surface: '#171a23',
        'surface-2': '#1f2330',
        border: '#2b3040',
        'border-strong': '#5b6279',
        text: '#f2f2f5',
        'text-muted': '#a7abba',
        accent: '#8a9dff',
        'on-accent': '#0c1233',
        focus: '#a6b4ff',
        success: '#3fcf9a',
        'on-success': '#04241a',
        'success-text': '#5edcae',
        warning: '#ffb547',
        'warning-text': '#ffc670',
        danger: '#ff6e6e',
        desk: 'linear-gradient(160deg, #151b2c 0%, #1c1424 50%, #0f1d22 100%)',
        'wheel-face': '#12151d',
        'wheel-slice': '#1b1f2b',
        'wheel-slice-hover': '#272d40',
        'wheel-slice-selected': '#3d5cf5',
        'wheel-text': '#f2f2f5',
        'wheel-text-selected': '#ffffff',
        'wheel-sub': '#b8bccb',
        'wheel-line': '#2b3040',
        'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
        p1: '#3d5cf5',
        p2: '#ff7a1a',
        p3: '#17bdb7',
        p4: '#d22a74',
        p1d: '#2338b8',
        p2d: '#c95500',
        p3d: '#0e8783',
        p4d: '#9c1652',
        'on-p1': '#ffffff',
        'on-p2': '#1a0c02',
        'on-p3': '#04201f',
        'on-p4': '#ffffff',
        'rim-base': '#1a1e29',
        'rim-edge': 'rgba(220, 228, 255, 0.14)',
        dim: '0.7',
      },
    };

    // C: a refined pair, indigo and rose madder, with a thread of gold.
    const palC = {
      light: {
        bg: '#f2f1ed',
        surface: '#fcfbf8',
        'surface-2': '#ecebe5',
        border: '#dddad1',
        'border-strong': '#9a9689',
        text: '#1b2034',
        'text-muted': '#565a68',
        accent: '#27387f',
        'on-accent': '#ffffff',
        focus: '#27387f',
        success: '#1e7656',
        'on-success': '#ffffff',
        'success-text': '#18634a',
        warning: '#b07418',
        'warning-text': '#82530a',
        danger: '#b4302c',
        desk: 'linear-gradient(155deg, #d9dfec 0%, #ece4e4 55%, #e1e6ea 100%)',
        'wheel-face': '#fbfaf6',
        'wheel-slice': '#e6e9f3',
        'wheel-slice-hover': '#cfd5ed',
        'wheel-slice-selected': '#27387f',
        'wheel-text': '#1b2034',
        'wheel-text-selected': '#ffffff',
        'wheel-sub': '#4b4f5e',
        'wheel-line': '#dcd7cb',
        'wheel-shadow': 'rgba(30, 30, 60, 0.18)',
        p1: '#27387f',
        p2: '#b03e52',
        p1d: '#18245c',
        p2d: '#7f2536',
        gold: '#cf9f3c',
        w1: '#e6e9f3',
        w2: '#f5e6e7',
        h1: '#cfd5ed',
        h2: '#efccd2',
        'on-p1': '#ffffff',
        'on-p2': '#ffffff',
        'rim-edge': 'rgba(30, 36, 70, 0.28)',
        dim: '0.62',
      },
      dark: {
        bg: '#11141c',
        surface: '#181c26',
        'surface-2': '#20252f',
        border: '#2c323e',
        'border-strong': '#5c6474',
        text: '#eeeef0',
        'text-muted': '#a8adba',
        accent: '#aab7f2',
        'on-accent': '#141c44',
        focus: '#bcc6ff',
        success: '#4cc79b',
        'on-success': '#06231a',
        'success-text': '#6dd6b0',
        warning: '#e5b351',
        'warning-text': '#edc373',
        danger: '#f2837a',
        desk: 'linear-gradient(155deg, #131a28 0%, #1e1820 55%, #141b22 100%)',
        'wheel-face': '#141822',
        'wheel-slice': '#1e2440',
        'wheel-slice-hover': '#2f3a72',
        'wheel-slice-selected': '#5468cc',
        'wheel-text': '#eeeef0',
        'wheel-text-selected': '#ffffff',
        'wheel-sub': '#c3c8d2',
        'wheel-line': '#2c323e',
        'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
        p1: '#5468cc',
        p2: '#c24a5f',
        p1d: '#33438f',
        p2d: '#86283b',
        gold: '#d9ad55',
        w1: '#1e2440',
        w2: '#30202a',
        h1: '#2f3a72',
        h2: '#57293a',
        'on-p1': '#ffffff',
        'on-p2': '#ffffff',
        'rim-edge': 'rgba(220, 228, 240, 0.2)',
        dim: '0.6',
      },
    };

    const hubA = `<path d="${wavyCircle(C, C, R0 - 7, 2, 0.22)}" class="eb-hr eb-hr-1"/><path d="${wavyCircle(C, C, R0 - 11.5, 5, 0.18)}" class="eb-hr eb-hr-3"/>`;
    const hubB = (() => {
      const d = ['', '', '', ''];
      for (let k = 0; k < 64; k++) {
        const q = at(C, C, R0 - 8, k * 5.625 + 2);
        d[k % 4] += circleD(q[0], q[1], k % 2 ? 1.2 : 1.7);
      }
      return d.map((dd, k) => `<path d="${dd}" class="eb-hd eb-hd-${k + 1}"/>`).join('');
    })();
    const hubC = `<circle cx="${C}" cy="${C}" r="${R0 - 7}" class="eb-hr eb-hr-1"/><circle cx="${C}" cy="${C}" r="${R0 - 10}" class="eb-hr eb-hr-g"/><circle cx="${C}" cy="${C}" r="${R0 - 12.5}" class="eb-hr eb-hr-2"/>`;

    // ================================================================ variants
    const FONTS = {
      a: {
        brand: "'Ysabeau Office Variable'",
        display: "'Literata Variable'",
        load: ["'Ysabeau Office Variable'", "'Literata Variable'"],
        credits: [
          { family: 'Ysabeau Office', license: 'SIL Open Font License 1.1' },
          { family: 'Literata', license: 'SIL Open Font License 1.1' },
        ],
      },
      b: {
        brand: "'Onest Variable'",
        display: "'Onest Variable'",
        load: ["'Onest Variable'"],
        credits: [{ family: 'Onest', license: 'SIL Open Font License 1.1' }],
      },
      c: {
        brand: "'Ysabeau Office Variable'",
        display: "'Ysabeau Variable'",
        load: ["'Ysabeau Office Variable'", "'Ysabeau Variable'"],
        credits: [
          { family: 'Ysabeau Office', license: 'SIL Open Font License 1.1' },
          { family: 'Ysabeau', license: 'SIL Open Font License 1.1' },
        ],
      },
    };
    const FAMILY = {};

    function define(V, spec) {
      const hooks = stainHooks(V);
      Board.define(
        Object.assign({}, FAMILY, spec, {
          defs: V.defs,
          wheel: { render: makeRender(V), update: hooks.update, onSelect: hooks.onSelect, onOpen: hooks.onOpen },
        }),
      );
    }

    // ---------------------------------------------------------------- A
    define(
      {
        id: 'ebru-a',
        seed: 1,
        T: 640,
        coverAt: 44,
        pig: fourPigments,
        hover: hoverA,
        gush: gushA,
        splash: splashA,
        hubRings: hubA,
        defs: rimA('ebru-a'),
      },
      {
        id: 'ebru-a',
        fonts: FONTS.a,
        motion: { open: 190, close: 110, stagger: 11, apply: 640 },
        palette: palA,
        contrast: pairs(4, true),
        sounds: {
          open(ac, out, t, X) {
            X.tone(ac, out, t, { type: 'sine', f: 380, f2: 1150, dur: 0.07, gain: 0.12, a: 0.002 });
            X.burst(ac, out, t, { type: 'lowpass', f: 900, f2: 280, q: 0.7, dur: 0.14, gain: 0.05, a: 0.01 });
          },
          tick(ac, out, t, X) {
            X.tone(ac, out, t, { type: 'sine', f: 1450, f2: 2250, dur: 0.025, gain: 0.06, a: 0.001 });
          },
          success(ac, out, t, X) {
            X.burst(ac, out, t, { type: 'lowpass', f: 2400, f2: 260, q: 0.9, dur: 0.11, gain: 0.16, a: 0.002 });
            X.tone(ac, out, t, { type: 'sine', f: 190, f2: 70, dur: 0.09, gain: 0.12, a: 0.002 });
            X.tone(ac, out, t + 0.08, { type: 'sine', f: 1300, f2: 2100, dur: 0.03, gain: 0.05, a: 0.001 });
            X.tone(ac, out, t + 0.13, { type: 'sine', f: 1700, f2: 2500, dur: 0.025, gain: 0.04, a: 0.001 });
            X.tone(ac, out, t + 0.24, { type: 'sine', f: 1046.5, dur: 0.55, gain: 0.04, a: 0.01 });
          },
        },
      },
    );

    // ---------------------------------------------------------------- B
    define(
      {
        id: 'ebru-b',
        seed: 2,
        T: 660,
        coverAt: 40,
        neutral: true,
        band: 7,
        fmtSize: 22,
        pig: fourPigments,
        hover: hoverB,
        gush: gushB,
        splash: splashB,
        hubRings: hubB,
        defs: rimB('ebru-b'),
      },
      {
        id: 'ebru-b',
        fonts: FONTS.b,
        motion: { open: 190, close: 110, stagger: 11, apply: 660 },
        palette: palB,
        contrast: pairs(4, false).concat([
          ['wheel-sub', 'wheel-slice', 'text'],
          ['wheel-sub', 'wheel-slice-hover', 'text'],
        ]),
        sounds: {
          open(ac, out, t, X) {
            X.burst(ac, out, t, { type: 'bandpass', f: 5200, f2: 3600, q: 0.8, dur: 0.09, gain: 0.06, a: 0.01 });
            X.tone(ac, out, t, { type: 'sine', f: 520, f2: 880, dur: 0.06, gain: 0.05, a: 0.003 });
          },
          tick(ac, out, t, X) {
            X.burst(ac, out, t, { type: 'highpass', f: 6500, q: 0.7, dur: 0.022, gain: 0.05, a: 0.001 });
          },
          success(ac, out, t, X) {
            X.burst(ac, out, t, { type: 'bandpass', f: 4800, f2: 2600, q: 0.9, dur: 0.3, gain: 0.1, a: 0.015 });
            X.burst(ac, out, t, { type: 'lowpass', f: 900, q: 0.7, dur: 0.06, gain: 0.06, a: 0.002 });
            X.tone(ac, out, t + 0.3, { type: 'triangle', f: 1320, dur: 0.05, gain: 0.04, a: 0.002 });
            X.tone(ac, out, t + 0.34, { type: 'sine', f: 1760, dur: 0.35, gain: 0.025, a: 0.01 });
          },
        },
      },
    );

    // ---------------------------------------------------------------- C
    define(
      {
        id: 'ebru-c',
        seed: 3,
        T: 680,
        coverAt: 0,
        pig: (i) => (i % 2) + 1,
        second: (i) => ((i + 1) % 2) + 1,
        hover: hoverC,
        gush: gushC,
        splash: splashC,
        hubRings: hubC,
        defs: rimC('ebru-c'),
      },
      {
        id: 'ebru-c',
        fonts: FONTS.c,
        motion: { open: 190, close: 110, stagger: 11, apply: 680 },
        palette: palC,
        contrast: pairs(2, true),
        sounds: {
          open(ac, out, t, X) {
            X.tone(ac, out, t, { type: 'sine', f: 520, f2: 1300, dur: 0.06, gain: 0.11, a: 0.002 });
            X.tone(ac, out, t + 0.035, { type: 'sine', f: 800, f2: 1750, dur: 0.045, gain: 0.04, a: 0.002 });
          },
          tick(ac, out, t, X) {
            X.tone(ac, out, t, { type: 'sine', f: 1600, f2: 2400, dur: 0.022, gain: 0.055, a: 0.001 });
          },
          success(ac, out, t, X) {
            [0, 0.05, 0.09, 0.12, 0.15].forEach((d, k) =>
              X.tone(ac, out, t + d, {
                type: 'sine',
                f: 620 + k * 120,
                f2: 1500 + k * 160,
                dur: 0.035,
                gain: 0.06 - k * 0.006,
                a: 0.002,
              }),
            );
            X.burst(ac, out, t + 0.26, { type: 'bandpass', f: 900, f2: 2600, q: 3.5, dur: 0.2, gain: 0.05, a: 0.02 });
            X.tone(ac, out, t + 0.48, { type: 'sine', f: 1174.7, dur: 0.5, gain: 0.035, a: 0.01 });
          },
        },
      },
    );
  })();
}
