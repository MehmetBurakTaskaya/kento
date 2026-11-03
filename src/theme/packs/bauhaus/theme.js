// SPDX-License-Identifier: MIT
// Theme: Bauhaus. A white disc ruled by black lines, a ring of primary color segments, lowercase
// geometric type, and three primary shapes (a blue square, a red disc, a yellow triangle) resting on
// the rim in an asymmetric balance. Applying a slice slides the three shapes round the rim into a new
// composition: the triangle locks onto the chosen slice and the others balance it.
export default function register(Board) {
  (function () {
    'use strict';

    const R = { face: 160, band: 145, hub: 54, lbl: 101 };
    const f2 = (n) => Math.round(n * 100) / 100;
    // Each slice owns one primary; three repeat round the wheel so neighbors always differ.
    const HUES = ['red', 'yellow', 'blue'];
    const hue = (i, n) => HUES[(n % 3 === 1 && i === n - 1 ? 1 : i) % 3];
    // Where the three shapes rest, measured from the first slice the way the slices run, and where they
    // go relative to an applied slice (degrees). At rest the triangle sits on a boundary between two
    // slices, so it never seems to choose one, however many slices there are and however a ring turns.
    const REST = { tri: 202, sq: 315, disc: 108 };
    const AIM = { tri: 0, sq: 142, disc: -128 };
    // Format names are Latin acronyms: plain lowercase, so ICO never becomes "ıco" in Turkish. A ring's
    // title can be one ("JPG"), so any all-capital Latin word is treated the same way.
    const lowerFmt = (t) => t.toLowerCase();
    // Scripts without case keep their text as it is, Latin words inside them included.
    const lowerWord = (t, lang) =>
      t == null || /^(ja|zh|ko|ar)/.test(lang) ? t : /^[A-Z0-9]{2,}$/.test(t) ? lowerFmt(t) : t.toLocaleLowerCase(lang);

    // Whether a point (relative to the centre) lies m inside a slice, between radii rin and rout.
    // Tests the slice's own angles, so it holds for any number of slices and any turn.
    function inSlice(sl, rin, rout, m) {
      const toRad = (a) => (a * Math.PI) / 180;
      const step = sl.a1 - sl.a0;
      const away = (a, rr) => (a < 90 ? rr * Math.sin(toRad(a)) : rr);
      return (x, y) => {
        const rr = Math.hypot(x, y);
        if (rr < rin + m || rr > rout - m) return false;
        if (step >= 359.9) return true;
        const rel = ((((Math.atan2(x, -y) * 180) / Math.PI - sl.a0) % 360) + 360) % 360;
        return rel <= step && away(rel, rr) >= m && away(step - rel, rr) >= m;
      };
    }

    // How wide a level label may be: its lines, centred dy below the point at radius r on the slice's
    // centre line and hh high on each side, must stay inside the slice.
    function room(sl, r, dy, hh, rin, rout, cap, m = 4) {
      const inside = inSlice(sl, rin, rout, m);
      const cx = r * Math.sin((sl.mid * Math.PI) / 180);
      const cy = -r * Math.cos((sl.mid * Math.PI) / 180) + dy;
      const fits = (w) => [-1, 0, 1].every((u) => [-1, 0, 1].every((v) => inside(cx + u * w, cy + v * hh)));
      if (fits(cap / 2)) return cap;
      let lo = 0;
      let hi = cap / 2;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      return Math.max(2 * lo, 40);
    }

    // Draws a slice's label block where it has the most room, at whichever of the given radii lets its
    // lines be widest (outward where the slice runs up or down, nearer the middle where it runs
    // across), then checks the lines as drawn and narrows them until they sit inside the slice. A label
    // is never shortened to fit: if only an ellipsis would make it fit, the last whole one is kept.
    // A single word too long for the slice goes a size smaller before it is shortened.
    function fitBlock(H, parent, sl, radii, o, rin, rout, cap, m = 2) {
      const inside = inSlice(sl, rin, rout, m);
      const iconH = o.icon ? o.iconSize + o.gap : 0;
      const sub = o.sub === undefined ? sl.sub : o.sub;
      const subH = sub ? o.gap + o.subSize * 1.1 : 0;
      const best = (lines) =>
        radii
          .map((r) => [r, room(sl, r, iconH / 2, (lines * o.size * 1.1 + subH) / 2, rin, rout, cap, m + 2)])
          .reduce((a, b) => (b[1] > a[1] + 1 ? b : a));
      const draw = (r, width) => {
        parent.textContent = '';
        return H.block(parent, sl, r, { ...o, maxWidth: width });
      };
      // How wide each line as drawn may be where it sits, and whether every line is within that.
      const lines = (parts) => {
        const spans = [...parts.label.querySelectorAll('tspan')];
        const list = (spans.length ? spans : [parts.label]).map((line) => [line, parts.label]);
        if (parts.sub) list.push([parts.sub, parts.sub]);
        return list.map(([line, text]) => {
          const hh = +text.getAttribute('font-size') * 0.42;
          const cx = +text.getAttribute('x') - 200;
          const cy = line.getStartPositionOfChar(0).y - 200;
          const ok = (half) => [-1, 0, 1].every((u) => [-1, 1].every((v) => inside(cx + u * half, cy + v * hh)));
          let allowed = cap;
          if (!ok(cap / 2)) {
            let lo = 0;
            let hi = cap / 2;
            for (let k = 0; k < 10; k++) {
              const half = (lo + hi) / 2;
              if (ok(half)) lo = half;
              else hi = half;
            }
            allowed = 2 * lo;
          }
          return { width: line.getComputedTextLength(), allowed };
        });
      };
      const shortened = () => !!parent.querySelector('[data-fit="shortened"]');
      let [r, width] = best(1);
      let parts = draw(r, width);
      // A single long word that would need an ellipsis may go a size smaller first.
      if (shortened()) {
        o = { ...o, minSize: Math.max(8.5, o.minSize - 1.5) };
        parts = draw(r, width);
      }
      for (let k = 0; k < 4 && !shortened(); k++) {
        const drawn = lines(parts);
        const over = drawn.filter((line) => line.width > line.allowed + 0.5);
        if (!over.length) break;
        const last = [r, width];
        r = best(drawn.length - (parts.sub ? 1 : 0))[0];
        width = Math.max(30, Math.min(width * 0.96, ...over.map((line) => line.allowed)));
        parts = draw(r, width);
        if (shortened()) {
          [r, width] = last;
          parts = draw(r, width);
          break;
        }
      }
      parts.r = r;
      return parts;
    }

    function restAngles(m) {
      const sign = m.dir === 'rtl' ? -1 : 1;
      const base = m.slices.length ? m.slices[0].mid : 0;
      const rest = {};
      for (const key of Object.keys(REST)) rest[key] = base + sign * REST[key];
      if (m.n > 1) {
        const gap = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
        rest.tri = m.slices.map((sl) => sl.a0).reduce((a, b) => (gap(b, rest.tri) < gap(a, rest.tri) ? b : a));
      }
      return rest;
    }

    // Turns an orbit group to an angle the short way round; angles accumulate so a shape never spins back.
    function turn(g, goal, animate) {
      const prev = g.__angle;
      const next = prev == null ? goal : prev + ((((goal - prev) % 360) + 540) % 360) - 180;
      g.__angle = next;
      if (!animate) {
        g.style.transition = 'none';
        g.style.transform = `rotate(${f2(next)}deg)`;
        void g.getBoundingClientRect();
        g.style.transition = '';
      } else {
        g.style.transform = `rotate(${f2(next)}deg)`;
      }
      // The square turns back as it travels, so it stays square to the grid.
      const up = g.querySelector('.bh-upright');
      if (up) {
        if (!animate) up.style.transition = 'none';
        up.style.transform = `rotate(${f2(-next)}deg)`;
        if (!animate) {
          void up.getBoundingClientRect();
          up.style.transition = '';
        }
      }
    }

    Board.define({
      id: 'bauhaus',
      // League Spartan has no Cyrillic; Jost, as geometric, draws those letters.
      fonts: {
        brand: "'League Spartan', 'Jost'",
        load: ["'League Spartan', 'Jost'"],
        credits: [
          { family: 'League Spartan', license: 'SIL Open Font License 1.1' },
          { family: 'Jost', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 170, close: 110, stagger: 12, apply: 640 },
      palette: {
        light: {
          bg: '#f2f2f0',
          surface: '#ffffff',
          'surface-2': '#ebebe8',
          border: '#d2d2ce',
          'border-strong': '#8c8c88',
          text: '#141414',
          'text-muted': '#555552',
          accent: '#1f4fbf',
          'on-accent': '#ffffff',
          focus: '#1f4fbf',
          success: '#1d7f45',
          'on-success': '#ffffff',
          'success-text': '#18703c',
          warning: '#f6c21a',
          'warning-text': '#6e5300',
          danger: '#cf2a1f',
          desk: 'linear-gradient(#d8d8d5 1px, transparent 1px) -1px -1px / 40px 40px, linear-gradient(90deg, #d8d8d5 1px, transparent 1px) -1px -1px / 40px 40px, #e9e9e6',
          'wheel-face': '#fbfbf8',
          'wheel-slice': '#fbfbf8',
          'wheel-slice-hover': '#f6c21a',
          'wheel-slice-selected': '#141414',
          'wheel-text': '#141414',
          'wheel-text-selected': '#fbfbf8',
          'wheel-line': '#141414',
          'wheel-shadow': 'rgba(20, 20, 20, 0.18)',
          'bh-red': '#cf2a1f',
          'bh-yellow': '#f6c21a',
          'bh-blue': '#1f4fbf',
          'bh-on-red': '#ffffff',
          'bh-on-yellow': '#141414',
          'bh-on-blue': '#ffffff',
          'bh-sub': '#4a4a47',
          'bh-rule': '#141414',
          'bh-rim': '#141414',
          'bh-hub': '#141414',
          'bh-hub-text': '#fbfbf8',
          'bh-hub-muted': '#c8c8c4',
          'bh-key': '#f6c21a',
          'bh-key-text': '#141414',
          'bh-shadow': 'rgba(20, 20, 20, 0.16)',
        },
        dark: {
          bg: '#131418',
          surface: '#1c1d22',
          'surface-2': '#25262c',
          border: '#34363e',
          'border-strong': '#62656f',
          text: '#f1efe8',
          'text-muted': '#aeacA4',
          accent: '#ffd23a',
          'on-accent': '#121317',
          focus: '#ffd23a',
          success: '#4fd389',
          'on-success': '#0b2416',
          'success-text': '#6fe0a0',
          warning: '#ffd23a',
          'warning-text': '#ffdc66',
          danger: '#ff5a4a',
          desk: 'linear-gradient(#22242b 1px, transparent 1px) -1px -1px / 40px 40px, linear-gradient(90deg, #22242b 1px, transparent 1px) -1px -1px / 40px 40px, #15161b',
          'wheel-face': '#1e2027',
          'wheel-slice': '#1e2027',
          'wheel-slice-hover': '#ffd23a',
          'wheel-slice-selected': '#f1efe8',
          'wheel-text': '#f1efe8',
          'wheel-text-selected': '#121317',
          'wheel-line': '#f1efe8',
          'wheel-shadow': 'rgba(0, 0, 0, 0.5)',
          'bh-red': '#ff5a4a',
          'bh-yellow': '#ffd23a',
          'bh-blue': '#5b86ff',
          'bh-on-red': '#121317',
          'bh-on-yellow': '#121317',
          'bh-on-blue': '#121317',
          'bh-sub': '#bdbbb3',
          'bh-rule': '#5d606b',
          'bh-rim': '#f1efe8',
          'bh-hub': '#f1efe8',
          'bh-hub-text': '#121317',
          'bh-hub-muted': '#4b4d55',
          'bh-key': '#ff5a4a',
          'bh-key-text': '#121317',
          'bh-shadow': 'rgba(0, 0, 0, 0.45)',
        },
      },
      // Pointed-at slices take their own primary and a matching ink (bh-on-*), so the default
      // wheel-text / wheel-slice-hover pair is replaced by the three real pairs.
      contrast: [
        ...Board.DEFAULT_PAIRS.filter(([fg, bg]) => !(fg === 'wheel-text' && bg === 'wheel-slice-hover')),
        ['bh-on-yellow', 'wheel-slice-hover', 'text'],
        ['bh-on-red', 'bh-red', 'text'],
        ['bh-on-yellow', 'bh-yellow', 'text'],
        ['bh-on-blue', 'bh-blue', 'text'],
        ['bh-sub', 'wheel-slice', 'text'],
        ['bh-hub-text', 'bh-hub', 'text'],
        ['bh-hub-muted', 'bh-hub', 'text'],
        ['bh-key-text', 'bh-key', 'text'],
        ['bh-rim', 'wheel-face', 'ui'],
      ],
      // "More…" as the movement's three shapes.
      icons: {
        more: '<circle cx="4.6" cy="12.6" r="2.4" fill="currentColor" stroke="none"/><path d="M12 9.4l2.9 5.1H9.1z" fill="currentColor" stroke="none"/><rect x="17" y="10.3" width="4.6" height="4.6" fill="currentColor" stroke="none"/>',
      },
      defs: '',

      wheel: {
        render(root, m, H) {
          const s = H.s;
          const C = H.C;
          const rest = restAngles(m);
          root.__rest = rest;

          // A soft offset shadow, like a paper disc laid on the desk.
          s('circle', { cx: C + 5, cy: C + 7, r: R.face + 2, class: 'bh-drop' }, root);
          // The three shapes sit in turning groups; update() moves them, the open animation slides them in.
          const back = s('g', { class: 'bh-comp', 'aria-hidden': 'true' }, root);
          // Blue square behind the rim, half covered by the disc.
          const sqOrbit = s('g', { class: 'bh-orbit bh-orbit-sq' }, back);
          const sqUp = s('g', { class: 'bh-upright' }, s('g', { class: 'bh-orbit-in' }, sqOrbit));
          s('rect', { x: C - 25, y: C - R.face - 28, width: 50, height: 50, class: 'bh-sq' }, sqUp);
          turn(sqOrbit, rest.sq, false);

          s('circle', { cx: C, cy: C, r: R.face, class: 'bh-face' }, root);
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            const h = hue(sl.i, m.n);
            g.classList.add('bh-' + h);
            s('path', { d: H.sector(R.hub, R.face, sl.a0, sl.a1), class: 'bh-hit' }, g);
            s('path', { d: H.sector(R.hub, R.band, sl.a0, sl.a1), class: 'bh-fill' }, g);
            s('path', { d: H.sector(R.hub, R.band, sl.a0, sl.a1), class: 'bh-selfill' }, g);
            s('path', { d: H.sector(R.band, R.face, sl.a0, sl.a1), class: 'bh-band' }, g);
            const ink = s('g', { class: 'bh-ink' }, g);
            const word = Object.assign({}, sl, {
              label: sl.format ? lowerFmt(sl.label) : lowerWord(sl.label, m.lang),
              sub: lowerWord(sl.sub, m.lang),
            });
            const wide = sl.step >= 70;
            const o = sl.format
              ? { size: sl.sub ? 26 : 30, subSize: 13.5, gap: 1, minSize: 12, cls: 'bh-lbl bh-fmt', subCls: 'bh-sub' }
              : {
                  icon: true,
                  iconSize: wide ? 28 : 23,
                  size: wide ? 17 : 15,
                  gap: 4,
                  minSize: 10,
                  cls: 'bh-lbl bh-word',
                  sub: null,
                };
            fitBlock(H, ink, word, [R.lbl, R.lbl + 6, R.lbl - 6, R.lbl - 12], o, R.hub, R.band, 116);
            // More choices: a solid triangle on the slice's coloured band, pointing out.
            H.ringMark(g, sl, m, { r: R.face - 2, size: 11, cls: 'bh-ring-mark' });
          }

          // The grid: radial rules between slices, the band's inner circle and the heavy rim.
          let rules = '';
          for (const sl of m.slices) {
            const [x0, y0] = H.polar(R.hub, sl.a0);
            const [x1, y1] = H.polar(R.face, sl.a0);
            rules += `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
          }
          const grid = s('g', { class: 'bh-grid', 'aria-hidden': 'true' }, root);
          s('path', { d: rules, class: 'bh-rule' }, grid);
          s('circle', { cx: C, cy: C, r: R.band, class: 'bh-rule bh-rule-thin' }, grid);
          s('circle', { cx: C, cy: C, r: R.face, class: 'bh-rim' }, grid);

          // Red disc and yellow triangle in front of the rim.
          const front = s('g', { class: 'bh-comp bh-comp-front', 'aria-hidden': 'true' }, root);
          const orbitFront = (key, angle) => {
            const g = s('g', { class: `bh-orbit bh-orbit-${key}` }, front);
            turn(g, angle, false);
            return s('g', { class: 'bh-orbit-in' }, g);
          };
          s('circle', { cx: C, cy: C - R.face - 14, r: 18, class: 'bh-disc' }, orbitFront('disc', rest.disc));
          // The triangle's tip touches the band; its base stands outside the rim.
          const tip = C - R.band + 4;
          s(
            'path',
            { d: `M${C} ${tip}L${C + 24} ${tip - 44}L${C - 24} ${tip - 44}Z`, class: 'bh-tri' },
            orbitFront('tri', rest.tri),
          );

          // Hub: a solid disc with the wheel's name, the file and the key on a yellow tag.
          const hub = s('g', { class: 'bh-hub' }, root);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'bh-hub-disc' }, hub);
          H.label(hub, C, C - 16, lowerWord(m.title, m.lang), {
            maxWidth: 88,
            size: 16,
            minSize: 10,
            cls: 'bh-title',
            maxLines: 1,
          });
          H.label(hub, C, C + (m.key ? 3 : 8), m.file, {
            maxWidth: 84,
            size: 12,
            minSize: 9,
            cls: 'bh-file',
            maxLines: 1,
          });
          if (m.key) {
            const tag = s('rect', { y: C + 16, height: 17, class: 'bh-key' }, hub);
            const text = H.text(hub, C, C + 25.5, lowerWord(m.key, m.lang), { class: 'bh-keytext' });
            const kw = Math.min(96, Math.ceil(text.getComputedTextLength()) + 16);
            tag.setAttribute('x', f2(C - kw / 2));
            tag.setAttribute('width', f2(kw));
          }
        },

        // The shapes stay put while pointing; an applied slice draws them into a new composition.
        update(root, m, st) {
          const sel = st.selected == null ? null : m.slices[st.selected];
          const was = root.__sel;
          root.__sel = sel ? sel.i : null;
          if (was === root.__sel) return;
          for (const key of Object.keys(REST)) {
            const g = root.querySelector(`.bh-orbit-${key}`);
            const goal = sel ? sel.mid + (m.dir === 'rtl' ? -AIM[key] : AIM[key]) : root.__rest[key];
            turn(g, goal, !!sel);
          }
        },
      },

      sounds: {
        open(ac, out, t, X) {
          X.tone(ac, out, t, { f: 392, dur: 0.16, gain: 0.07, a: 0.004 });
          X.tone(ac, out, t + 0.03, { f: 587, dur: 0.14, gain: 0.05, a: 0.004 });
          X.burst(ac, out, t, { type: 'bandpass', f: 1400, q: 5, dur: 0.012, gain: 0.08 });
        },
        tick(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 1700, q: 9, dur: 0.016, gain: 0.12 });
          X.tone(ac, out, t, { f: 1180, f2: 1010, dur: 0.018, gain: 0.04, a: 0.001 });
        },
        success(ac, out, t, X) {
          // The shapes slide (a rising hiss), lock (two clicks), and the composition rings as one chord.
          X.burst(ac, out, t, { type: 'bandpass', f: 500, f2: 1700, q: 1.6, dur: 0.34, gain: 0.07, a: 0.06 });
          X.burst(ac, out, t + 0.38, { type: 'bandpass', f: 2200, q: 8, dur: 0.012, gain: 0.16 });
          X.burst(ac, out, t + 0.44, { type: 'bandpass', f: 1500, q: 8, dur: 0.014, gain: 0.13 });
          for (const [f, g] of [
            [523, 0.07],
            [659, 0.055],
            [784, 0.05],
          ])
            X.tone(ac, out, t + 0.42, { f, dur: 0.42, gain: g, a: 0.005 });
        },
      },
    });
  })();
}
