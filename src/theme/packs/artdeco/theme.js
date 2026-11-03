// SPDX-License-Identifier: MIT
// Theme: Art Deco. A medallion of black lacquer (ivory in the light theme) ruled in gold: every
// slice carries a faint sunburst of gold rays and ends in a stepped crown, so the outline is a ring
// of small ziggurats. Applying a slice opens its sunburst like a fan and lays gold (or lacquer) over it.
export default function register(Board) {
  (function () {
    'use strict';

    const R = { hub: 52, hubRing: 60, ray0: 64, face: 168, crown: [170, 179, 188], lbl: 112 };
    // Nine rays fan across a slice of 45 degrees; wider slices get more, at the same spacing.
    const RAYS = 9;
    const f2 = (n) => Math.round(n * 100) / 100;
    const C = 200;
    const rad = (a) => (a * Math.PI) / 180;
    const P = (r, a) => [C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))];
    const pt = (r, a) => P(r, a).map(f2).join(' ');
    // Uppercase for display type; scripts without case keep their text.
    const caps = (t, lang) => (/^(ja|zh|ko|ar)/.test(lang) ? t : t.toLocaleUpperCase(lang));

    // The stepped crown of one slice, as an open path from a0 to a1, inset by `inset` units. The crown
    // keeps the size it has on a slice of 45 degrees, centred on the slice; a wider slice runs flat
    // on either side of it.
    function crown(a0, a1, inset) {
      const mid = (a0 + a1) / 2;
      const w = Math.min(a1 - a0, 45);
      const [r0, r1, r2] = R.crown.map((r) => r - inset);
      const steps = [
        [mid - 0.26 * w, r1],
        [mid - 0.14 * w, r2],
        [mid + 0.14 * w, r1],
        [mid + 0.26 * w, r0],
      ];
      let d = `M${pt(r0, a0)}`;
      let prevR = r0;
      let prevA = a0;
      for (const [a, r] of steps) {
        d += `A${prevR} ${prevR} 0 ${a - prevA > 180 ? 1 : 0} 1 ${pt(prevR, a)}L${pt(r, a)}`;
        prevR = r;
        prevA = a;
      }
      return d + `A${prevR} ${prevR} 0 ${a1 - prevA > 180 ? 1 : 0} 1 ${pt(prevR, a1)}`;
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

    Board.define({
      id: 'artdeco',
      // Limelight has no Cyrillic; Yeseva One, as high in contrast, draws those letters.
      fonts: {
        brand: "'Raleway'",
        display: "'Limelight', 'Yeseva One'",
        load: ["'Raleway'", "'Limelight', 'Yeseva One'"],
        credits: [
          { family: 'Raleway', license: 'SIL Open Font License 1.1' },
          { family: 'Limelight', license: 'SIL Open Font License 1.1' },
          { family: 'Yeseva One', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 120, stagger: 12, apply: 680 },
      palette: {
        light: {
          bg: '#f7f2e6',
          surface: '#fffcf4',
          'surface-2': '#f1eadb',
          border: '#ddd2b8',
          'border-strong': '#a8987a',
          text: '#1a1814',
          'text-muted': '#5b5446',
          accent: '#1a1814',
          'on-accent': '#f0d690',
          focus: '#8a6a22',
          success: '#2f7a55',
          'on-success': '#ffffff',
          'success-text': '#256646',
          warning: '#b8861c',
          'warning-text': '#6e5000',
          danger: '#a8322a',
          desk: 'radial-gradient(circle at 50% 42%, #fbf7ec 0%, #efe6d0 75%)',
          'wheel-face': '#fbf7ec',
          'wheel-slice': '#fbf7ec',
          'wheel-slice-hover': '#f1e4bd',
          'wheel-slice-selected': '#16161a',
          'wheel-text': '#1a1814',
          'wheel-text-selected': '#ecd08a',
          'wheel-line': '#a8843a',
          'wheel-shadow': 'rgba(80, 60, 20, 0.22)',
          'ad-slice-b': '#f5efe0',
          'ad-slice-c': '#f8f1de',
          'ad-gold': '#a8843a',
          'ad-gold-hi': '#d7b562',
          'ad-gold-lo': '#7d6020',
          'ad-ray': '#b9963f',
          'ad-ray-idle': '0.2',
          'ad-ray-hover': '0.42',
          'ad-ray-sel': '0.62',
          'ad-sel-ray': '#c9a550',
          'ad-sub': '#5b5446',
          'ad-crown': '#f3ead2',
          'ad-crown-sel': '#16161a',
          'ad-hub': '#16161a',
          'ad-hub-text': '#ecd08a',
          'ad-hub-muted': '#c9bfa6',
          'ad-glint': '#fff3c8',
          'ad-sel-hi': '#26262c',
          'ad-sel-mid': '#18181c',
          'ad-sel-lo': '#0f0f12',
          'ad-fan': '#a8843a',
        },
        dark: {
          bg: '#0f0f12',
          surface: '#18181c',
          'surface-2': '#202026',
          border: '#34322c',
          'border-strong': '#6c624a',
          text: '#f2ead6',
          'text-muted': '#bdb39b',
          accent: '#e2c071',
          'on-accent': '#141210',
          focus: '#e2c071',
          success: '#6fcf9a',
          'on-success': '#0c2417',
          'success-text': '#86dbab',
          warning: '#e8b84a',
          'warning-text': '#f0c96a',
          danger: '#ff7a6b',
          desk: 'radial-gradient(circle at 50% 42%, #24242b 0%, #0c0c10 72%)',
          'wheel-face': '#141417',
          'wheel-slice': '#141417',
          'wheel-slice-hover': '#2a2517',
          'wheel-slice-selected': '#e2c071',
          'wheel-text': '#ecd08a',
          'wheel-text-selected': '#141210',
          'wheel-line': '#c9a550',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          'ad-slice-b': '#19191d',
          'ad-slice-c': '#1d1c1a',
          'ad-gold': '#c9a550',
          'ad-gold-hi': '#f3d98f',
          'ad-gold-lo': '#8a6a2a',
          'ad-ray': '#d4b05a',
          'ad-ray-idle': '0.16',
          'ad-ray-hover': '0.38',
          'ad-ray-sel': '0.5',
          'ad-sel-ray': '#9a7630',
          'ad-sub': '#cfc5ac',
          'ad-crown': '#101013',
          'ad-crown-sel': '#e2c071',
          'ad-hub': '#0c0c0f',
          'ad-hub-text': '#ecd08a',
          'ad-hub-muted': '#b5ab92',
          'ad-glint': '#fff6d6',
          'ad-sel-hi': '#f3d98f',
          'ad-sel-mid': '#e2c071',
          'ad-sel-lo': '#c79f4c',
          'ad-fan': '#f3d98f',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['wheel-text', 'ad-slice-b', 'text'],
        ['wheel-text', 'ad-slice-c', 'text'],
        ['ad-sub', 'ad-slice-c', 'text'],
        ['ad-sub', 'wheel-slice', 'text'],
        ['ad-sub', 'ad-slice-b', 'text'],
        ['ad-sub', 'wheel-slice-hover', 'text'],
        ['ad-hub-text', 'ad-hub', 'text'],
        ['ad-hub-muted', 'ad-hub', 'text'],
        ['ad-gold', 'wheel-face', 'ui'],
      ],
      // "More…" as three stepped diamonds.
      icons: {
        more: '<path d="M5 9.5l2.5 2.5L5 14.5 2.5 12zM12 8.5l3.5 3.5-3.5 3.5L8.5 12zM19 9.5l2.5 2.5-2.5 2.5-2.5-2.5z" fill="currentColor" stroke="none"/>',
      },
      defs: '',

      wheel: {
        render(root, m, H) {
          const s = H.s;
          const uid = H.uid('artdeco');
          const defs = s('defs', {}, root);
          // Gilding: a vertical sheen from bright to deep gold, used by the applied slice and the hub rings.
          const gg = s('linearGradient', { id: uid + '-gild', x1: 0, y1: 0, x2: 0.35, y2: 1 }, defs);
          s('stop', { offset: 0, class: 'ad-s-hi' }, gg);
          s('stop', { offset: 0.5, class: 'ad-s-mid' }, gg);
          s('stop', { offset: 1, class: 'ad-s-lo' }, gg);
          root.style.setProperty('--ad-gild', `url(#${uid}-gild)`);

          // Silhouette: the ring of stepped crowns, filled, with a soft shadow.
          // The crowns joined clockwise, whichever way the slices run (right to left they run the other way).
          let outline = '';
          const spans = m.slices.map((sl) => [((sl.a0 % 360) + 360) % 360, sl.a1 - sl.a0]).sort((p, q) => p[0] - q[0]);
          for (const [a0, step] of spans)
            outline += outline ? crown(a0, a0 + step, 0).replace(/^M/, 'L') : crown(a0, a0 + step, 0);
          outline += 'Z';
          s('path', { d: outline, class: 'ad-shadow', transform: 'translate(0 6)' }, root);
          s('path', { d: outline, class: 'ad-crownfill' }, root);
          s('circle', { cx: C, cy: C, r: R.face, class: 'ad-face' }, root);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            // Neighbours alternate; an odd count gives the last slice a third tone.
            if (m.n % 2 && sl.i === m.n - 1 && m.n > 1) g.classList.add('ad-c');
            else if (sl.i % 2) g.classList.add('ad-b');
            s('path', { d: H.sector(R.hubRing, R.crown[0], sl.a0, sl.a1), class: 'ad-hit' }, g);
            s('path', { d: H.sector(R.hubRing, R.face, sl.a0, sl.a1), class: 'ad-fill' }, g);
            s('path', { d: H.sector(R.hubRing, R.face, sl.a0, sl.a1), class: 'ad-gilt' }, g);
            // The crown cap of this slice, gilded when applied.
            s(
              'path',
              {
                d: crown(sl.a0, sl.a1, 0) + `L${pt(R.face, sl.a1)}A${R.face} ${R.face} 0 0 0 ${pt(R.face, sl.a0)}Z`,
                class: 'ad-cap',
              },
              g,
            );
            // Sunburst: thin wedges fanning out from the hub.
            const rays = s('g', { class: 'ad-rays' }, g);
            const count = 2 * Math.round(((RAYS - 1) / 2) * Math.max(1, sl.step / 45)) + 1;
            const centre = (count - 1) / 2;
            for (let k = 0; k < count; k++) {
              const off = (k - centre) * (Math.min(sl.step, 45) / (RAYS + 0.6));
              const a = sl.mid + off;
              const w = k % 2 ? 0.55 : 1.15;
              const ray = s(
                'path',
                { d: `M${pt(R.ray0, a)}L${pt(R.face - 2, a - w)}L${pt(R.face - 2, a + w)}Z`, class: 'ad-ray' },
                rays,
              );
              ray.style.setProperty('--fan', f2(-off) + 'deg');
              // The fan opens from the centre line; the outermost rays start about 70 ms later.
              ray.style.setProperty('--k', f2((Math.abs(k - centre) / Math.max(1, centre)) * 4));
            }
            // The crown's inner gold line, brighter when the slice is pointed at or applied.
            s('path', { d: crown(sl.a0, sl.a1, 5.5), class: 'ad-crownline' }, g);
            s('path', { d: crown(sl.a0, sl.a1, 0), class: 'ad-glint', pathLength: 120 }, g);
            const ink = s('g', { class: 'ad-ink' }, g);
            const wide = sl.step >= 70;
            const radii = [R.lbl, R.lbl + 6, R.lbl - 6, R.lbl - 12];
            if (sl.format) {
              const o = {
                size: sl.sub ? 21 : 25,
                subSize: 12.5,
                gap: 4,
                minSize: 10,
                cls: 'ad-lbl ad-fmt',
                subCls: 'ad-sub',
              };
              fitBlock(H, ink, { ...sl, label: caps(sl.label, m.lang) }, radii, o, R.hubRing, R.face, 112);
            } else {
              const o = {
                icon: true,
                iconSize: wide ? 27 : 22,
                size: wide ? 16 : 14,
                gap: 4,
                minSize: 9.5,
                cls: 'ad-lbl ad-word',
                sub: null,
              };
              fitBlock(H, ink, sl, radii, o, R.hubRing, R.face, 112);
            }
            // More choices: a gilded double chevron under the crown, pointing out.
            H.ringMark(g, sl, m, { r: R.face - 5, size: 10.5, shape: 'double', halo: 1.4, cls: 'ad-ring-mark' });
          }

          // Gold rules: the slice dividers, the face ring and the stepped outline.
          let rules = '';
          for (const sl of m.slices) rules += `M${pt(R.hubRing, sl.a0)}L${pt(R.crown[0], sl.a0)}`;
          const lines = s('g', { class: 'ad-lines', 'aria-hidden': 'true' }, root);
          s('path', { d: rules, class: 'ad-rule' }, lines);
          s('circle', { cx: C, cy: C, r: R.face, class: 'ad-rule ad-rule-thin' }, lines);
          s('path', { d: outline, class: 'ad-edge' }, lines);

          // Hub: stepped gold rings round a lacquer disc.
          const hub = s('g', { class: 'ad-hubg' }, root);
          s('circle', { cx: C, cy: C, r: R.hubRing, class: 'ad-hub-ring' }, hub);
          s('circle', { cx: C, cy: C, r: R.hubRing - 4, class: 'ad-hub' }, hub);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'ad-hub-ring2' }, hub);
          H.label(hub, C, C - 15, caps(m.title, m.lang), {
            // As wide as the disc allows: a long title (Russian "Convert") shrinks rather than shortens.
            maxWidth: 94,
            size: 13,
            minSize: 7,
            cls: 'ad-title',
            maxLines: 1,
          });
          H.label(hub, C, C + (m.key ? 4 : 9), m.file, {
            maxWidth: 78,
            size: 12,
            minSize: 9,
            cls: 'ad-file',
            maxLines: 1,
          });
          if (m.key) {
            const plate = s('path', { class: 'ad-key' }, hub);
            const text = H.text(hub, C, C + 24, caps(m.key, m.lang), { class: 'ad-keytext' });
            const kw = Math.min(90, Math.ceil(text.getComputedTextLength()) + 16);
            const x0 = C - kw / 2;
            const y0 = C + 16;
            const h = 15;
            const n = 3;
            plate.setAttribute(
              'd',
              `M${f2(x0 + n)} ${y0}H${f2(x0 + kw - n)}V${y0 + n}H${f2(x0 + kw)}V${y0 + h - n}H${f2(x0 + kw - n)}V${y0 + h}H${f2(x0 + n)}V${y0 + h - n}H${f2(x0)}V${y0 + n}H${f2(x0 + n)}Z`,
            );
          }
        },
      },

      sounds: {
        open(ac, out, t, X) {
          // A short harp run up a major sixth chord.
          [523, 659, 880, 1047].forEach((f, k) =>
            X.tone(ac, out, t + k * 0.028, { type: 'triangle', f, dur: 0.18, gain: 0.04, a: 0.002 }),
          );
        },
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { f: 3150, dur: 0.03, gain: 0.04, a: 0.001 });
          X.tone(ac, out, t, { f: 4720, dur: 0.018, gain: 0.015, a: 0.001 });
        },
        success(ac, out, t, X) {
          // A vibraphone chord (C, E, G, B) rolled upward, each bar with a slow tremolo.
          const trem = ac.createOscillator();
          const depth = ac.createGain();
          const bus = ac.createGain();
          trem.frequency.value = 5.2;
          depth.gain.value = 0.35;
          bus.gain.value = 0.75;
          trem.connect(depth).connect(bus.gain);
          bus.connect(out);
          trem.start(t);
          trem.stop(t + 1.2);
          [523, 659, 784, 988].forEach((f, k) => {
            X.tone(ac, bus, t + k * 0.045, { f, dur: 0.9, gain: 0.06, a: 0.004 });
            X.tone(ac, bus, t + k * 0.045, { f: f * 4, dur: 0.12, gain: 0.012, a: 0.001 });
          });
          X.tone(ac, out, t + 0.2, { f: 2637, dur: 0.25, gain: 0.012, a: 0.002 });
        },
      },
    });
  })();
}
