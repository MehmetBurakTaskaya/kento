// SPDX-License-Identifier: MIT
// Theme: Art Deco. A medallion of black lacquer (ivory in the light theme) ruled in gold: every
// slice carries a faint sunburst of gold rays and ends in a stepped crown, so the outline is a ring
// of small ziggurats. Applying a slice opens its sunburst like a fan and lays gold (or lacquer) over it.
export default function register(Board) {
  (function () {
    'use strict';

    const R = { hub: 52, hubRing: 60, ray0: 64, face: 168, crown: [170, 179, 188], lbl: 112 };
    const RAYS = 9;
    const f2 = (n) => Math.round(n * 100) / 100;
    const C = 200;
    const rad = (a) => (a * Math.PI) / 180;
    const P = (r, a) => [C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a))];
    const pt = (r, a) => P(r, a).map(f2).join(' ');
    // Uppercase for display type; scripts without case keep their text.
    const caps = (t, lang) => (/^(ja|zh|ko|ar)/.test(lang) ? t : t.toLocaleUpperCase(lang));

    // The stepped crown of one slice, as an open path from a0 to a1, inset by `inset` units.
    function crown(a0, a1, inset) {
      const w = a1 - a0;
      const [r0, r1, r2] = R.crown.map((r) => r - inset);
      const steps = [
        [0, r0],
        [0.24, r1],
        [0.36, r2],
        [0.64, r1],
        [0.76, r0],
      ];
      let d = `M${pt(r0, a0)}`;
      let prevR = r0;
      for (let k = 1; k < steps.length; k++) {
        const [fa, r] = steps[k];
        const a = a0 + fa * w;
        d += `A${prevR} ${prevR} 0 0 1 ${pt(prevR, a)}L${pt(r, a)}`;
        prevR = r;
      }
      return d + `A${prevR} ${prevR} 0 0 1 ${pt(prevR, a1)}`;
    }

    Board.define({
      id: 'artdeco',
      fonts: {
        brand: "'Raleway'",
        display: "'Limelight'",
        load: ["'Raleway'", "'Limelight'"],
        credits: [
          { family: 'Raleway', license: 'SIL Open Font License 1.1' },
          { family: 'Limelight', license: 'SIL Open Font License 1.1' },
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
          let outline = '';
          for (const sl of m.slices)
            outline += outline ? crown(sl.a0, sl.a1, 0).replace(/^M/, 'L') : crown(sl.a0, sl.a1, 0);
          outline += 'Z';
          s('path', { d: outline, class: 'ad-shadow', transform: 'translate(0 6)' }, root);
          s('path', { d: outline, class: 'ad-crownfill' }, root);
          s('circle', { cx: C, cy: C, r: R.face, class: 'ad-face' }, root);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            if (sl.i % 2) g.classList.add('ad-b');
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
            for (let k = 0; k < RAYS; k++) {
              const off = (k - (RAYS - 1) / 2) * (sl.step / (RAYS + 0.6));
              const a = sl.mid + off;
              const w = k % 2 ? 0.55 : 1.15;
              const ray = s(
                'path',
                { d: `M${pt(R.ray0, a)}L${pt(R.face - 2, a - w)}L${pt(R.face - 2, a + w)}Z`, class: 'ad-ray' },
                rays,
              );
              ray.style.setProperty('--fan', f2(-off) + 'deg');
              ray.style.setProperty('--k', Math.abs(k - (RAYS - 1) / 2));
            }
            // The crown's inner gold line, brighter when the slice is pointed at or applied.
            s('path', { d: crown(sl.a0, sl.a1, 5.5), class: 'ad-crownline' }, g);
            s('path', { d: crown(sl.a0, sl.a1, 0), class: 'ad-glint', pathLength: 120 }, g);
            const ink = s('g', { class: 'ad-ink' }, g);
            const lab = Object.assign({}, sl, { label: caps(sl.label, m.lang) });
            if (m.kind === 'convert' && sl.sub) {
              H.block(ink, lab, R.lbl, {
                size: 21,
                subSize: 12.5,
                gap: 4,
                maxWidth: 76,
                minSize: 10,
                cls: 'ad-lbl ad-fmt',
                subCls: 'ad-sub',
              });
            } else {
              H.block(ink, Object.assign({}, sl), R.lbl, {
                icon: true,
                iconSize: 23,
                size: 14,
                gap: 5,
                maxWidth: 76,
                minSize: 9.5,
                cls: 'ad-lbl ad-word',
                sub: null,
              });
            }
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
            maxWidth: 82,
            size: 13,
            minSize: 8.5,
            cls: 'ad-title',
            maxLines: 1,
          });
          H.label(hub, C, C + 4, m.file, { maxWidth: 78, size: 12, minSize: 9, cls: 'ad-file', maxLines: 1 });
          const key = caps(m.key, m.lang);
          const kw = 16 + key.length * 7.2;
          const x0 = C - kw / 2,
            y0 = C + 16,
            h = 15,
            n = 3;
          s(
            'path',
            {
              d: `M${f2(x0 + n)} ${y0}H${f2(x0 + kw - n)}V${y0 + n}H${f2(x0 + kw)}V${y0 + h - n}H${f2(x0 + kw - n)}V${y0 + h}H${f2(x0 + n)}V${y0 + h - n}H${f2(x0)}V${y0 + n}H${f2(x0 + n)}Z`,
              class: 'ad-key',
            },
            hub,
          );
          H.text(hub, C, C + 24, key, { class: 'ad-keytext' });
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
