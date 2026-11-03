// SPDX-License-Identifier: MIT
// Theme: Pop-art comic. The wheel is a round speech balloon with a tail, split into wedge-shaped
// comic panels with thick black ink and white gutters. Ben-Day halftone dots grow toward each
// panel's outer edge. Pointing floods a panel with its flat color; applying it pops a jagged
// comic burst over the panel (no words), which stays behind the label.
export default function register(Board) {
  (function () {
    'use strict';

    const R = { balloon: 184, panel: 172, inner: 64, hub: 55, lbl: 114, gap: 9 };
    const HUES = ['red', 'yellow', 'blue'];
    const hue = (i, n) => HUES[(n % 3 === 1 && i === n - 1 ? 1 : i) % 3];
    const C = 200;
    const f2 = (n) => Math.round(n * 100) / 100;
    const rad = (a) => (a * Math.PI) / 180;
    const caps = (t, lang) => (/^(ja|zh|ko|ar)/.test(lang) ? t : t.toLocaleUpperCase(lang));

    // The balloon: a circle with a curved tail at the lower left.
    function balloon(r) {
      const a1 = 214,
        a2 = 236; // where the tail leaves and rejoins the circle
      const p = (rr, a) => [C + rr * Math.sin(rad(a)), C - rr * Math.cos(rad(a))];
      const [x1, y1] = p(r, a1);
      const [x2, y2] = p(r, a2);
      const tip = [C - 196, C + 194];
      return `M${f2(x2)} ${f2(y2)}A${r} ${r} 0 1 1 ${f2(x1)} ${f2(y1)}Q${f2(C - 92)} ${f2(C + 186)} ${f2(tip[0])} ${f2(tip[1])}Q${f2(C - 150)} ${f2(C + 120)} ${f2(x2)} ${f2(y2)}Z`;
    }

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

    // Ben-Day dots on a 45-degree screen, growing from nothing near the label to full at the rim.
    // The mark of a slice that opens a ring of choices: its point's radius and its length.
    const MARK = { r: 165, size: 11 };

    function dots(sl) {
      const step = 8.4;
      let d = '';
      const cs = Math.SQRT1_2;
      // The dots leave the mark of a slice that opens a ring a clear patch.
      const mark = sl.ring
        ? [C + (MARK.r - MARK.size / 2) * Math.sin(rad(sl.mark)), C - (MARK.r - MARK.size / 2) * Math.cos(rad(sl.mark))]
        : null;
      for (let i = -26; i <= 26; i++) {
        for (let j = -26; j <= 26; j++) {
          const x = (i - j) * step * cs;
          const y = (i + j) * step * cs;
          const r = Math.hypot(x, y);
          if (r < 112 || r > R.panel - 4) continue;
          const ang = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
          const rel = (((ang - sl.a0) % 360) + 360) % 360;
          if (rel > sl.a1 - sl.a0) continue;
          const rho = Math.min(1, (r - 112) / 52) * 3.3;
          if (rho < 0.55) continue;
          // Keep clear of the panel's ink border.
          const edge = Math.min(rel, sl.a1 - sl.a0 - rel);
          if (r * Math.sin(rad(edge)) < R.gap / 2 + rho + 2.5) continue;
          if (R.panel - r < rho + 3) continue;
          if (mark && Math.hypot(C + x - mark[0], C + y - mark[1]) < 10 + rho) continue;
          d += `M${f2(C + x - rho)} ${f2(C + y)}a${f2(rho)} ${f2(rho)} 0 1 0 ${f2(2 * rho)} 0a${f2(rho)} ${f2(rho)} 0 1 0 ${f2(-2 * rho)} 0`;
        }
      }
      return d;
    }

    // A jagged comic burst around 0 0: uneven spikes, never the same twice round.
    function burst(rx, ry, spikes, seed) {
      let s = seed;
      const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      let d = '';
      for (let k = 0; k < spikes * 2; k++) {
        const a = (k / (spikes * 2)) * Math.PI * 2 + (rnd() - 0.5) * 0.18;
        const f = k % 2 ? 0.6 + rnd() * 0.08 : 0.94 + rnd() * 0.16;
        d += (k ? 'L' : 'M') + `${f2(Math.sin(a) * rx * f)} ${f2(-Math.cos(a) * ry * f)}`;
      }
      return d + 'Z';
    }

    Board.define({
      id: 'popart',
      // Lettering: Bangers for the big words, Playpen Sans for the small ones (both with every Turkish
      // letter); Bangers has no Cyrillic, so Sofia Sans Condensed draws those letters.
      fonts: {
        brand: "'Playpen Sans'",
        display: "'Bangers', 'Sofia Sans Condensed'",
        load: ["'Playpen Sans'", "'Bangers', 'Sofia Sans Condensed'"],
        credits: [
          { family: 'Playpen Sans', license: 'SIL Open Font License 1.1' },
          { family: 'Bangers', license: 'SIL Open Font License 1.1' },
          { family: 'Sofia Sans Condensed', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 170, close: 110, stagger: 12, apply: 600 },
      palette: {
        light: {
          bg: '#eef6fc',
          surface: '#ffffff',
          'surface-2': '#e6f1fa',
          border: '#c8d9e8',
          'border-strong': '#6f8399',
          text: '#111111',
          'text-muted': '#4b5563',
          accent: '#d11f26',
          'on-accent': '#ffffff',
          focus: '#1a5fc7',
          success: '#1f8a4c',
          'on-success': '#ffffff',
          'success-text': '#17733f',
          warning: '#ffd200',
          'warning-text': '#6b5600',
          danger: '#d11f26',
          desk: 'radial-gradient(#a6d6f2 1.7px, transparent 2.1px) 0 0 / 9px 9px, #e9f5fd',
          'wheel-face': '#ffffff',
          'wheel-slice': '#ffffff',
          'wheel-slice-hover': '#ffd200',
          'wheel-slice-selected': '#ffe14a',
          'wheel-text': '#111111',
          'wheel-text-selected': '#111111',
          'wheel-line': '#111111',
          'wheel-shadow': 'rgba(17, 17, 17, 0.9)',
          'pa-ink': '#111111',
          'pa-paper': '#ffffff',
          'pa-panel': '#ffffff',
          'pa-sub': '#2b2f36',
          'pa-red': '#d11f26',
          'pa-yellow': '#ffd200',
          'pa-blue': '#1a5fc7',
          'pa-red-dot': '#d11f26',
          'pa-yellow-dot': '#e0a800',
          'pa-blue-dot': '#1a5fc7',
          'pa-red-dark': '#8e0f14',
          'pa-yellow-dark': '#e88a00',
          'pa-blue-dark': '#0d3a85',
          'pa-on-red': '#ffffff',
          'pa-on-yellow': '#111111',
          'pa-on-blue': '#ffffff',
          'pa-red-halo': '#111111',
          'pa-yellow-halo': '#ffd200',
          'pa-blue-halo': '#111111',
          'pa-burst': '#ffe14a',
          'pa-burst-edge': '#111111',
          'pa-impact': '#111111',
          'pa-hub': '#ffffff',
          'pa-hub-text': '#111111',
          'pa-hub-muted': '#3d434c',
          'pa-key': '#d11f26',
          'pa-key-text': '#ffffff',
        },
        dark: {
          bg: '#0e1024',
          surface: '#171a36',
          'surface-2': '#20244a',
          border: '#2f3567',
          'border-strong': '#5f67a8',
          text: '#f4f4ff',
          'text-muted': '#b5b9e0',
          accent: '#ff3fa4',
          'on-accent': '#111111',
          focus: '#33d6f5',
          success: '#5be39a',
          'on-success': '#0b2416',
          'success-text': '#74ebad',
          warning: '#ffe14a',
          'warning-text': '#ffe14a',
          danger: '#ff5c7a',
          desk: 'radial-gradient(#3a2a6e 1.7px, transparent 2.1px) 0 0 / 9px 9px, #12142e',
          'wheel-face': '#2a2f6e',
          'wheel-slice': '#0f1022',
          'wheel-slice-hover': '#33d6f5',
          'wheel-slice-selected': '#ffe14a',
          'wheel-text': '#f4f4ff',
          'wheel-text-selected': '#111111',
          'wheel-line': '#05050c',
          'wheel-shadow': 'rgba(255, 63, 164, 0.9)',
          'pa-ink': '#05050c',
          'pa-paper': '#2a2f6e',
          'pa-panel': '#0f1022',
          'pa-sub': '#cfd2f2',
          'pa-red': '#ff3fa4',
          'pa-yellow': '#ffe14a',
          'pa-blue': '#33d6f5',
          'pa-red-dot': '#ff3fa4',
          'pa-yellow-dot': '#ffe14a',
          'pa-blue-dot': '#33d6f5',
          'pa-red-dark': '#b0006a',
          'pa-yellow-dark': '#d9a400',
          'pa-blue-dark': '#0097b8',
          'pa-on-red': '#111111',
          'pa-on-yellow': '#111111',
          'pa-on-blue': '#111111',
          'pa-red-halo': '#ff3fa4',
          'pa-yellow-halo': '#ffe14a',
          'pa-blue-halo': '#33d6f5',
          'pa-burst': '#ffe14a',
          'pa-burst-edge': '#05050c',
          'pa-impact': '#ffe14a',
          'pa-hub': '#f4f4ff',
          'pa-hub-text': '#111111',
          'pa-hub-muted': '#3d4170',
          'pa-key': '#ff3fa4',
          'pa-key-text': '#111111',
        },
      },
      // Pointed-at panels take their own primary and ink (pa-on-*), so the default
      // wheel-text / wheel-slice-hover pair is replaced by the three real pairs.
      contrast: [
        ...Board.DEFAULT_PAIRS.filter(([fg, bg]) => !(fg === 'wheel-text' && bg === 'wheel-slice-hover')),
        ['pa-on-red', 'pa-red', 'text'],
        ['pa-on-yellow', 'pa-yellow', 'text'],
        ['pa-on-blue', 'pa-blue', 'text'],
        ['wheel-text', 'pa-panel', 'text'],
        ['pa-sub', 'pa-panel', 'text'],
        ['wheel-text-selected', 'pa-burst', 'text'],
        ['pa-hub-text', 'pa-hub', 'text'],
        ['pa-hub-muted', 'pa-hub', 'text'],
        ['pa-key-text', 'pa-key', 'text'],
      ],
      icons: {
        more: '<path d="M3 12l2.2-2.2L7.4 12l-2.2 2.2zM9.8 12L12 9.8l2.2 2.2-2.2 2.2zM16.6 12l2.2-2.2L21 12l-2.2 2.2z" fill="currentColor" stroke="none"/>',
      },
      defs: '',

      wheel: {
        render(root, m, H) {
          const s = H.s;
          // A hard offset shadow, the balloon (its paper shows in the gutters), then the panels.
          s('path', { d: balloon(R.balloon), class: 'pa-drop', transform: 'translate(6 6)' }, root);
          s('path', { d: balloon(R.balloon), class: 'pa-balloon' }, root);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            g.classList.add('pa-' + hue(sl.i, m.n));
            const panel = H.sector(R.inner, R.panel, sl.a0, sl.a1, R.gap);
            s('path', { d: H.sector(R.inner - 4, R.balloon, sl.a0, sl.a1), class: 'pa-hit' }, g);
            const lift = s('g', { class: 'pa-lift' }, g);
            lift.style.setProperty('--dx', f2(5 * Math.sin(rad(sl.mid))) + 'px');
            lift.style.setProperty('--dy', f2(-5 * Math.cos(rad(sl.mid))) + 'px');
            s('path', { d: panel, class: 'pa-panel' }, lift);
            s('path', { d: dots(sl), class: 'pa-dots' }, lift);
            s('path', { d: panel, class: 'pa-ink-edge' }, lift);
            // The burst and its impact lines, centered on the label.
            const fx = s('g', { class: 'pa-fx' }, lift);
            const lines = s('g', { class: 'pa-impact' }, fx);
            let ld = '';
            for (let k = 0; k < 10; k++) {
              const a = (k / 10) * Math.PI * 2 + 0.2;
              ld += `M${f2(Math.sin(a) * 62)} ${f2(-Math.cos(a) * 52)}L${f2(Math.sin(a) * 80)} ${f2(-Math.cos(a) * 67)}`;
            }
            s('path', { d: ld, class: 'pa-impact-line' }, lines);
            const b = s('g', { class: 'pa-burst' }, fx);
            s('path', { d: burst(56, 46, 11, sl.i * 97 + 11), class: 'pa-burst-shape' }, b);
            const ink = s('g', { class: 'pa-ink' }, lift);
            const wide = sl.step >= 70;
            const radii = [R.lbl, R.lbl + 6, R.lbl - 6, R.lbl - 12];
            const o = sl.format
              ? { size: sl.sub ? 27 : 32, subSize: 13.5, gap: 0, minSize: 12, cls: 'pa-lbl pa-fmt', subCls: 'pa-sub' }
              : {
                  icon: true,
                  iconSize: wide ? 28 : 23,
                  size: wide ? 16 : 14,
                  gap: 4,
                  minSize: 9.5,
                  cls: 'pa-lbl pa-word',
                  sub: null,
                };
            // The ink border and the gutter take about seven units off each side of a panel.
            const fitted = fitBlock(
              H,
              ink,
              sl.format ? { ...sl, label: caps(sl.label, m.lang) } : sl,
              radii,
              o,
              R.inner,
              R.panel,
              112,
              7,
            );
            const [bx, by] = H.polar(fitted.r, sl.mid);
            fx.setAttribute('transform', `translate(${f2(bx)} ${f2(by)})`);
            // More choices: a bold ink arrowhead near the top of the panel, on a patch the dots leave.
            H.ringMark(lift, sl, m, { ...MARK, cls: 'pa-ring-mark' });
          }

          // Hub: a small round caption with the wheel's name, the file and the key.
          const hub = s('g', { class: 'pa-hubg' }, root);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'pa-hub' }, hub);
          H.label(hub, C, C - 16, caps(m.title, m.lang), {
            // As wide as the disc allows: a long title (Russian "Convert") shrinks rather than shortens.
            maxWidth: 94,
            size: 19,
            minSize: 9,
            cls: 'pa-title',
            maxLines: 1,
          });
          H.label(hub, C, C + (m.key ? 4 : 9), m.file, {
            maxWidth: 84,
            size: 12.5,
            minSize: 9,
            cls: 'pa-file',
            maxLines: 1,
          });
          if (m.key) {
            const tag = s('rect', { y: C + 17, height: 17, class: 'pa-key' }, hub);
            const text = H.text(hub, C, C + 26, caps(m.key, 'en'), { class: 'pa-keytext' });
            const kw = Math.min(92, Math.ceil(text.getComputedTextLength()) + 16);
            tag.setAttribute('x', f2(C - kw / 2));
            tag.setAttribute('width', f2(kw));
          }
        },

        // The pointed and the applied panel come to the front, so the burst can spill over its neighbors.
        update(root, m, st) {
          const hub = root.querySelector('.pa-hubg');
          for (const k of [st.selected, st.hover]) {
            if (k == null) continue;
            const g = root.querySelector(`.slice[data-slice="${k}"]`);
            if (g && g.nextElementSibling !== hub) root.insertBefore(g, hub);
          }
        },
      },

      sounds: {
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 3200, f2: 900, q: 1.2, dur: 0.09, gain: 0.12, a: 0.01 });
        },
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { f: 620, f2: 1500, dur: 0.022, gain: 0.06, a: 0.002 });
        },
        success(ac, out, t, X) {
          // A soft thump, a little crash and a rising zing.
          X.tone(ac, out, t, { f: 150, f2: 48, dur: 0.14, gain: 0.16, a: 0.002 });
          X.burst(ac, out, t, { type: 'lowpass', f: 900, q: 0.8, dur: 0.06, gain: 0.12 });
          X.burst(ac, out, t + 0.01, { type: 'highpass', f: 4000, q: 0.6, dur: 0.16, gain: 0.04 });
          X.tone(ac, out, t + 0.06, { type: 'triangle', f: 700, f2: 2100, dur: 0.18, gain: 0.04, a: 0.01 });
        },
      },
    });
  })();
}
