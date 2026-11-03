// SPDX-License-Identifier: MIT
// Terrazzo: the wheel as a polished terrazzo slab. Each slice is a field of cement set with
// pastel stone chips, the fields divided by brass strips, the hub a darker medallion in a brass
// ring. Applying a slice makes its chips jump and settle into a neat new pattern, two arcs
// framing the label, and tints its field.
export default function register(Board) {
  (function () {
    'use strict';

    const ID = 'terrazzo';
    const f2 = (n) => Math.round(n * 100) / 100;

    if (typeof document !== 'undefined' && document.fonts) {
      for (const f of [
        "500 16px 'Bricolage Grotesque'",
        "700 16px 'Bricolage Grotesque'",
        "800 16px 'Bricolage Grotesque'",
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
    const R = { outer: 196, rim: 188, hub: 64, lbl: 127, arcOut: 165, arcIn: 89 };
    const CHIP_COLORS = 7;
    const pt = (p) => `${f2(p[0])} ${f2(p[1])}`;

    // The width a label may take at radius r: the slice's chord there, less a margin, within a cap.
    function roomAt(sl, r, margin, cap) {
      const half = Math.min(sl.step / 2, 70);
      return Math.max(40, Math.min(cap, 2 * r * Math.sin((half * Math.PI) / 180) - margin));
    }

    // An irregular stone chip round (0, 0): five to seven corners at uneven radii.
    function chipShape(rand, size) {
      const n = 5 + Math.floor(rand() * 3);
      const pts = [];
      const start = rand() * 360;
      for (let k = 0; k < n; k++) {
        const a = ((start + (k * 360) / n + (rand() - 0.5) * 30) * Math.PI) / 180;
        const r = size * (0.62 + rand() * 0.5);
        pts.push([r * Math.sin(a), -r * Math.cos(a)]);
      }
      return pts;
    }

    // Is (x, y) inside the slice, `pad` units clear of its edges, its rim and the hub?
    function inSlice(H, sl, x, y, pad) {
      const r = Math.hypot(x - H.C, y - H.C);
      if (r < R.hub + pad + 3 || r > R.rim - pad - 2) return false;
      let a = (Math.atan2(x - H.C, H.C - y) * 180) / Math.PI - sl.mid;
      a = ((a + 540) % 360) - 180;
      return Math.abs(a) * (Math.PI / 180) * r < (sl.step / 2) * (Math.PI / 180) * r - pad - 1.5;
    }

    Board.define({
      id: ID,
      fonts: {
        brand: "'Bricolage Grotesque'",
        load: ["'Bricolage Grotesque'"],
        credits: [{ family: 'Bricolage Grotesque', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 180, close: 120, stagger: 12, apply: 640 },

      palette: {
        light: {
          bg: '#f2f1ee',
          surface: '#ffffff',
          'surface-2': '#f7f6f3',
          border: '#dedbd5',
          'border-strong': '#aca79e',
          text: '#22252d',
          'text-muted': '#5c5f68',
          accent: '#2f6d74',
          'on-accent': '#ffffff',
          focus: '#2f6d74',
          success: '#1d7c4e',
          'on-success': '#ffffff',
          'success-text': '#186a42',
          warning: '#a8700f',
          'warning-text': '#744b06',
          danger: '#b8403a',
          desk: 'linear-gradient(160deg, #e4e8ea 0%, #d3d9dc 100%)',
          'wheel-face': '#f4f2ee',
          'field-a': '#f5f3ef',
          'field-b': '#e9ecef',
          'wheel-slice': '#e9ecef',
          'wheel-slice-hover': '#fbfaf8',
          'wheel-slice-selected': '#f8e4e1',
          'field-c': '#f2ece9',
          'field-sel': '#f8e4e1',
          'field-sel-b': '#e2eee3',
          'chip-1': '#f2a5a0',
          'chip-2': '#a7c8a2',
          'chip-3': '#f0cf73',
          'chip-4': '#98c0e3',
          'chip-5': '#c3aee0',
          'chip-6': '#4a4f5a',
          'chip-7': '#d8d4cc',
          speck: 'rgba(80, 84, 95, 0.45)',
          brass: '#c49a43',
          'brass-hi': '#f6e2a6',
          'brass-lo': '#9a7428',
          'hub-a': '#3b4150',
          'hub-b': '#454c5d',
          'hub-text': '#f7f5f0',
          'hub-sub': '#dfe2e8',
          'wheel-text': '#22252d',
          'wheel-sub': '#4a4e58',
          'wheel-text-selected': '#22252d',
          'wheel-sub-selected': '#3e424c',
          'wheel-line': '#c49a43',
          'wheel-shadow': 'rgba(40, 45, 50, 0.3)',
          gloss: 'rgba(255, 255, 255, 0.95)',
          'gloss-end': 'rgba(255, 255, 255, 0)',
        },
        dark: {
          bg: '#15171b',
          surface: '#1d2025',
          'surface-2': '#25292f',
          border: '#353a42',
          'border-strong': '#5a616c',
          text: '#f2f0ec',
          'text-muted': '#adb1ba',
          accent: '#f0cf73',
          'on-accent': '#1f1d16',
          focus: '#f0cf73',
          success: '#6fd09c',
          'on-success': '#0b2216',
          'success-text': '#80d9aa',
          warning: '#efb851',
          'warning-text': '#f2c46e',
          danger: '#ff8a80',
          desk: 'radial-gradient(120% 95% at 50% 10%, #2a2e35 0%, #1a1c21 65%, #121417 100%)',
          'wheel-face': '#2b2f3a',
          'field-a': '#2c303b',
          'field-b': '#253039',
          'wheel-slice': '#2c303b',
          'wheel-slice-hover': '#363b47',
          'wheel-slice-selected': '#3b2f3e',
          'field-c': '#302c3a',
          'field-sel': '#3b2f3e',
          'field-sel-b': '#2a3b38',
          'chip-1': '#f4a3a8',
          'chip-2': '#9cd0a3',
          'chip-3': '#f3d47c',
          'chip-4': '#8ec4ef',
          'chip-5': '#c3a8f0',
          'chip-6': '#e9e6e0',
          'chip-7': '#6c7280',
          speck: 'rgba(230, 230, 225, 0.4)',
          brass: '#c9a24e',
          'brass-hi': '#fbe6a8',
          'brass-lo': '#8d6a24',
          'hub-a': '#ece8e0',
          'hub-b': '#ddd8ce',
          'hub-text': '#20232b',
          'hub-sub': '#41444d',
          'wheel-text': '#f7f5f0',
          'wheel-sub': '#dadde3',
          'wheel-text-selected': '#ffffff',
          'wheel-sub-selected': '#ebe4ee',
          'wheel-line': '#c9a24e',
          'wheel-shadow': 'rgba(0, 0, 0, 0.55)',
          gloss: 'rgba(255, 255, 255, 0.22)',
          'gloss-end': 'rgba(255, 255, 255, 0)',
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
        ['wheel-text', 'field-a', 'text'],
        ['wheel-sub', 'field-a', 'text'],
        ['wheel-sub', 'field-b', 'text'],
        ['wheel-text', 'field-c', 'text'],
        ['wheel-sub', 'field-c', 'text'],
        ['wheel-text-selected', 'field-sel-b', 'text'],
        ['wheel-sub-selected', 'field-sel', 'text'],
        ['wheel-sub-selected', 'field-sel-b', 'text'],
        ['hub-text', 'hub-a', 'text'],
        ['hub-sub', 'hub-a', 'text'],
        ['hub-sub', 'hub-b', 'text'],
      ],

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const s = H.s;
          const uid = H.uid(ID);
          const defs = s('defs', {}, root);
          const grad = (id, tag, attrs, stops) => {
            const gr = s(tag, Object.assign({ id: uid + id }, attrs), defs);
            for (const [o, cls] of stops) s('stop', { offset: o, class: cls }, gr);
          };
          grad('-brass', 'linearGradient', { x1: 0, y1: 0, x2: 1, y2: 1 }, [
            [0, 'tz-st-brass-hi'],
            [0.45, 'tz-st-brass'],
            [0.7, 'tz-st-brass-lo'],
            [1, 'tz-st-brass-hi'],
          ]);
          grad('-gloss', 'linearGradient', { x1: 0.1, y1: 0, x2: 0.7, y2: 0.9 }, [
            [0, 'tz-st-gloss'],
            [0.55, 'tz-st-gloss0'],
          ]);
          grad('-sh', 'radialGradient', { cx: 0.5, cy: 0.5, r: 0.5 }, [
            [0.88, 'tz-st-sh'],
            [1, 'tz-st-sh0'],
          ]);
          grad('-hub', 'radialGradient', { cx: 0.4, cy: 0.35, r: 0.75 }, [
            [0, 'tz-st-hub-b'],
            [1, 'tz-st-hub-a'],
          ]);

          // Slab: shadow, brass rim, a polished gloss over the top left.
          const slabG = s('g', { class: 'tz-slab', 'aria-hidden': 'true' }, root);
          s('circle', { cx: C, cy: C + 6, r: R.outer + 6, fill: `url(#${uid}-sh)` }, slabG);
          s('circle', { cx: C, cy: C, r: R.outer, fill: `url(#${uid}-brass)`, class: 'tz-rim' }, slabG);
          s('circle', { cx: C, cy: C, r: R.rim + 0.5, class: 'tz-rim-inner' }, slabG);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const rand = rng(977 + sl.i * 7919 + m.kind.length * 31);
            const wedge = H.sector(R.hub, R.rim, sl.a0, sl.a1);
            // Two cement mixes take turns; with an odd count the last field gets a third, so no two
            // neighbours match.
            const mix = m.n % 2 === 1 && sl.i === m.n - 1 && m.n > 1 ? 'c' : sl.i % 2 ? 'b' : 'a';
            s('path', { d: wedge, class: `tz-field tz-field-${mix}` }, g);
            s('path', { d: wedge, class: `tz-sel tz-sel-${mix === 'c' ? 'a' : mix}` }, g);
            // Chips and specks keep the same density in a slice of any width.
            const share = sl.step / 45;
            // Lettering first (hidden in place), so the chips can keep clear of it.
            const ink = s('g', { class: 'tz-ink' }, g);
            const room = roomAt(sl, R.lbl, 22, 128);
            if (sl.format) {
              H.block(ink, sl, R.lbl, {
                size: 23,
                subSize: 12.5,
                gap: 2,
                maxWidth: room,
                minSize: 10,
                cls: 'tz-lbl tz-fmt',
                subCls: 'tz-sub',
              });
            } else {
              H.block(ink, sl, R.lbl, {
                icon: true,
                iconSize: 23,
                size: 14,
                gap: 4,
                maxWidth: room + 2,
                minSize: 9,
                cls: 'tz-lbl tz-word',
                sub: null,
              });
            }
            const bb = ink.getBBox();
            const clear = (x, y, pad) =>
              !(
                bb.width &&
                x > bb.x - pad &&
                x < bb.x + bb.width + pad &&
                y > bb.y - pad &&
                y < bb.y + bb.height + pad
              );
            // Fine specks of the cement, one path per colour.
            const specks = ['', ''];
            for (let k = 0, kept = 0; k < 400 * share && kept < Math.round(46 * share); k++) {
              const r = Math.sqrt(R.hub ** 2 + rand() * (R.rim ** 2 - R.hub ** 2));
              const a = sl.a0 + rand() * sl.step;
              const [x, y] = H.polar(r, a);
              if (!inSlice(H, sl, x, y, 1) || !clear(x, y, 3)) continue;
              kept++;
              const rr = f2(0.6 + rand() * 0.9);
              specks[kept % 2] +=
                `M${f2(x - rr)} ${f2(y)}a${rr} ${rr} 0 1 0 ${2 * rr} 0a${rr} ${rr} 0 1 0 ${-2 * rr} 0Z`;
            }
            s('path', { d: specks[0], class: 'tz-speck' }, g);
            s('path', { d: specks[1], class: 'tz-speck tz-speck-2' }, g);
            // Chips: scattered at rest; once applied they settle in two rows of evenly spaced places, by
            // the rim and by the hub. Each place slides along its spoke, within its row's band, to the
            // first radius clear of the label; a place with none is left out, so a tall or long label
            // simply gets fewer chips round it.
            const row = (count, span, radii, size) => {
              const out = [];
              for (let k = 0; k < count; k++) {
                const a = sl.mid - span / 2 + (span * (k + 0.5)) / count;
                const r = radii.find((rr) => {
                  const [x, y] = H.polar(rr, a);
                  return clear(x, y, size + 2);
                });
                if (r != null) out.push(H.polar(r, a));
              }
              return out;
            };
            const band = (from, to, by) => {
              const radii = [];
              for (let r = from; by > 0 ? r <= to : r >= to; r += by) radii.push(r);
              return radii;
            };
            const targets = [
              ...row(
                Math.min(28, Math.max(3, Math.round(7 * share))),
                sl.step - 12,
                [...band(R.arcOut, R.rim - 9, 2), ...band(R.arcOut - 3, R.arcOut - 12, -3)],
                7.5,
              ),
              ...row(
                Math.min(16, Math.max(2, Math.round(4 * share))),
                sl.step - 16,
                [...band(R.arcIn, R.hub + 7, -2), ...band(R.arcIn + 3, R.arcIn + 9, 3)],
                6,
              ),
            ];
            const outerCount = targets.filter(([x, y]) => Math.hypot(x - C, y - C) > R.lbl).length;
            const sizes = targets.map((_, k) => (k < outerCount ? 6.2 + rand() * 1.8 : 5 + rand() * 1.3));
            const chips = s('g', { class: 'tz-chips' }, g);
            const placed = [];
            targets.forEach((tg, k) => {
              const size = sizes[k];
              // At rest a chip lies anywhere in the field clear of the label and of the other chips;
              // where the field is crowded it settles for clear of the label, and else for its place.
              let spot = null;
              let fallback = null;
              for (let tries = 0; tries < 200 && !spot; tries++) {
                const r = Math.sqrt(R.hub ** 2 + rand() * (R.rim ** 2 - R.hub ** 2));
                const [px, py] = H.polar(r, sl.a0 + rand() * sl.step);
                if (!inSlice(H, sl, px, py, size + 1) || !clear(px, py, size + 3)) continue;
                if (placed.every(([qx, qy]) => Math.hypot(qx - px, qy - py) > size + 8)) spot = [px, py];
                else fallback = fallback || [px, py];
              }
              const [x, y] = spot || fallback || tg;
              placed.push([x, y]);
              const shape = chipShape(rand, size);
              const col = 1 + ((sl.i * 3 + k * 2) % CHIP_COLORS);
              const c = s(
                'path',
                { d: 'M' + shape.map(([u, v]) => pt([x + u, y + v])).join('L') + 'Z', class: `tz-chip tz-c${col}` },
                chips,
              );
              const out = Math.atan2(y - C, x - C);
              const jump = 9 + rand() * 9;
              c.style.setProperty('--sx', f2(Math.cos(out) * jump + (rand() - 0.5) * 10) + 'px');
              c.style.setProperty('--sy', f2(Math.sin(out) * jump + (rand() - 0.5) * 10 - 6) + 'px');
              c.style.setProperty('--sr', Math.round((rand() - 0.5) * 300) + 'deg');
              c.style.setProperty('--tx', f2(tg[0] - x) + 'px');
              c.style.setProperty('--ty', f2(tg[1] - y) + 'px');
              c.style.setProperty('--tr', Math.round((rand() - 0.5) * 40) + 'deg');
              c.style.setProperty('--d', Math.round(rand() * 70) + 'ms');
            });
            s('path', { d: wedge, class: 'tz-gloss', fill: `url(#${uid}-gloss)` }, g);
            s('path', { d: H.arc(R.rim + 4, sl.a0 + 1.2, sl.a1 - 1.2), class: 'tz-glint' }, g);
            g.appendChild(ink);
          }

          // Brass strips between the fields and round the hub.
          const strips = s('g', { class: 'tz-strips', 'aria-hidden': 'true' }, root);
          let d = '';
          for (const sl of m.slices) d += `M${pt(H.polar(R.hub, sl.a0))}L${pt(H.polar(R.rim, sl.a0))}`;
          s('path', { d, class: 'tz-strip-shade' }, strips);
          s('path', { d, class: 'tz-strip' }, strips);

          // Hub medallion.
          const hub = s('g', { class: 'tz-hub' }, root);
          s('circle', { cx: C, cy: C, r: R.hub + 3, fill: `url(#${uid}-brass)` }, hub);
          s('circle', { cx: C, cy: C, r: R.hub - 1, fill: `url(#${uid}-hub)` }, hub);
          const hr = rng(5);
          let hs = '';
          for (let k = 0; k < 40; k++) {
            const r = Math.sqrt(hr()) * (R.hub - 6);
            const [x, y] = H.polar(r, hr() * 360);
            if (Math.abs(y - C) < 30 && Math.abs(x - C) < 50) continue;
            const rr = f2(0.6 + hr() * 1);
            hs += `M${f2(x - rr)} ${f2(y)}a${rr} ${rr} 0 1 0 ${2 * rr} 0a${rr} ${rr} 0 1 0 ${-2 * rr} 0Z`;
          }
          s('path', { d: hs, class: 'tz-hub-speck' }, hub);
          const dy = m.key ? 0 : 8;
          H.label(hub, C, C - 15 + dy, m.title, {
            maxWidth: 100,
            size: 16.5,
            minSize: 10,
            cls: 'tz-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 4 + dy, m.file, { maxWidth: 92, size: 12, minSize: 9, cls: 'tz-file', maxLines: 1 });
          if (m.key) {
            const kt = H.text(hub, C, C + 25, m.key, { class: 'tz-keytext' });
            const kw = kt.getComputedTextLength() + 16;
            hub.insertBefore(
              s('rect', { x: f2(C - kw / 2), y: C + 17, width: f2(kw), height: 16, rx: 8, class: 'tz-key' }),
              kt,
            );
          }
        },
      },

      sounds: {
        // A stone slab slid into place, with a small clink.
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'lowpass', f: 420, f2: 160, q: 0.8, dur: 0.12, gain: 0.18, a: 0.01 });
          X.tone(ac, out, t + 0.07, { type: 'sine', f: 2860, dur: 0.05, gain: 0.015, a: 0.001 });
          X.tone(ac, out, t + 0.07, { type: 'sine', f: 4190, dur: 0.035, gain: 0.008, a: 0.001 });
        },
        // A pebble click: two tiny knocks.
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 3300, q: 5, dur: 0.005, gain: 0.12 });
          X.burst(ac, out, t + 0.014, { type: 'bandpass', f: 2700, q: 5, dur: 0.004, gain: 0.06 });
        },
        // Chips scattering, then settling with a last soft tok.
        success(ac, out, t, X) {
          const hits = [
            [0, 3600],
            [0.022, 4400],
            [0.041, 2900],
            [0.063, 5100],
            [0.08, 3300],
            [0.108, 4000],
            [0.13, 2600],
            [0.162, 4700],
            [0.2, 3100],
            [0.245, 3900],
          ];
          hits.forEach(([dt, f], k) =>
            X.burst(ac, out, t + dt, {
              type: 'bandpass',
              f,
              q: 6,
              dur: 0.004 + (k % 3) * 0.002,
              gain: 0.05 + (k % 4) * 0.012,
            }),
          );
          [
            [0.33, 3000],
            [0.38, 3500],
            [0.43, 2800],
          ].forEach(([dt, f]) => X.burst(ac, out, t + dt, { type: 'bandpass', f, q: 5, dur: 0.004, gain: 0.04 }));
          X.tone(ac, out, t + 0.5, { type: 'triangle', f: 420, f2: 360, dur: 0.06, gain: 0.07, a: 0.002 });
          X.burst(ac, out, t + 0.5, { type: 'lowpass', f: 900, q: 0.7, dur: 0.03, gain: 0.08 });
        },
      },
    });
  })();
}
