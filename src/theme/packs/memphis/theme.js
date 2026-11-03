// SPDX-License-Identifier: MIT
// Theme: Memphis. A party badge of the 1980s: a black zigzag rim, a band of black and white
// stripes, pastel tiles cut along squiggly lines, a hard colored shadow and a dot grid on the desk.
// Pointing lifts a tile like a sticker; applying it pops it with a springy boing and a burst of
// confetti, and the tile turns into terrazzo.
export default function register(Board) {
  (function () {
    'use strict';

    const R = { zigIn: 173, zigOut: 193, band: 157, tile: 155, inner: 60, hub: 55, lbl: 116 };
    const TEETH = 40;
    const WAVE = { amp: 3.8, len: 23.75 }; // four whole waves between the hub and the band
    const f2 = (n) => Math.round(n * 100) / 100;
    const C = 200;
    const rad = (a) => (a * Math.PI) / 180;
    const pt = (x, y) => `${f2(x)} ${f2(y)}`;

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

    // Four hues round the wheel; when the count leaves the last tile next to the first in the same hue,
    // the last one takes the second hue instead.
    const hue = (i, n) => (n > 1 && n % 4 === 1 && i === n - 1 ? 2 : (i % 4) + 1);

    // A point on the squiggle that runs along a slice boundary at angle b.
    function wavy(b, r) {
      const o = WAVE.amp * Math.sin((2 * Math.PI * (r - R.inner)) / WAVE.len);
      return [C + r * Math.sin(rad(b)) + o * Math.cos(rad(b)), C - r * Math.cos(rad(b)) + o * Math.sin(rad(b))];
    }
    // One tile: out along one squiggle, round the band, back along the next squiggle.
    function tilePath(a0, a1) {
      let d = `M${pt(...wavy(a0, R.inner))}`;
      for (let r = R.inner + 2.5; r <= R.tile; r += 2.5) d += `L${pt(...wavy(a0, Math.min(r, R.tile)))}`;
      const [x1, y1] = wavy(a1, R.tile);
      d += `A${R.tile} ${R.tile} 0 0 1 ${pt(x1, y1)}`;
      for (let r = R.tile - 2.5; r >= R.inner; r -= 2.5) d += `L${pt(...wavy(a1, Math.max(r, R.inner)))}`;
      const [x0, y0] = wavy(a0, R.inner);
      return d + `A${R.inner} ${R.inner} 0 0 0 ${pt(x0, y0)}Z`;
    }
    function zigzag() {
      let d = '';
      for (let k = 0; k <= TEETH * 2; k++) {
        const a = (k * 180) / TEETH;
        const r = k % 2 ? R.zigOut : R.zigIn;
        d += (k ? 'L' : 'M') + pt(C + r * Math.sin(rad(a)), C - r * Math.cos(rad(a)));
      }
      return d + 'Z';
    }
    function rng(seed) {
      let s = seed * 7919 + 13;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    }

    // Confetti shapes, centered on 0 0.
    const BITS = [
      'M-6 4L0 -6L6 4Z', // triangle
      'M-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z', // dot
      'M-7 2a7 7 0 0 1 14 0Z', // half moon
      'M-5 -5h10v10h-10Z', // square
      'M-9 0q2.25 -5 4.5 0t4.5 0t4.5 0t4.5 0', // squiggle (stroked)
      'M-8 -2.5h16v5h-16Z', // bar
    ];

    Board.define({
      id: 'memphis',
      // Quicksand and Righteous have no Cyrillic; Comfortaa, as round, draws those letters.
      fonts: {
        brand: "'Quicksand', 'Comfortaa'",
        display: "'Righteous', 'Comfortaa'",
        load: ["'Quicksand', 'Comfortaa'", "'Righteous', 'Comfortaa'"],
        credits: [
          { family: 'Quicksand', license: 'SIL Open Font License 1.1' },
          { family: 'Righteous', license: 'SIL Open Font License 1.1' },
          { family: 'Comfortaa', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 110, stagger: 14, apply: 680 },
      palette: {
        light: {
          bg: '#f6f2fb',
          surface: '#ffffff',
          'surface-2': '#efe9f7',
          border: '#d8cfe6',
          'border-strong': '#8f84a3',
          text: '#151515',
          'text-muted': '#544d5e',
          accent: '#d6336c',
          'on-accent': '#ffffff',
          focus: '#1f7f79',
          success: '#1d8a63',
          'on-success': '#ffffff',
          'success-text': '#167553',
          warning: '#ffd23f',
          'warning-text': '#735a00',
          danger: '#d6336c',
          desk: 'radial-gradient(#cfc4e2 1.3px, transparent 1.9px) 0 0 / 20px 20px, #f6f2fb',
          'wheel-face': '#ffffff',
          'wheel-slice': '#ffb8cc',
          'wheel-slice-hover': '#ffb8cc',
          'wheel-slice-selected': '#151515',
          'wheel-text': '#151515',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#151515',
          'wheel-shadow': '#5cc8c4',
          'mp-tile-1': '#ffb8cc',
          'mp-tile-2': '#a8ead4',
          'mp-tile-3': '#ffe27a',
          'mp-tile-4': '#cfbfff',
          'mp-label-1': '#151515',
          'mp-label-2': '#151515',
          'mp-label-3': '#151515',
          'mp-label-4': '#151515',
          'mp-lift-1': '#2fb3ad',
          'mp-lift-2': '#ff6f9f',
          'mp-lift-3': '#8f6bff',
          'mp-lift-4': '#ffc928',
          'mp-sel-1': '#151515',
          'mp-sel-2': '#151515',
          'mp-sel-3': '#151515',
          'mp-sel-4': '#151515',
          'mp-sub': '#3d3545',
          'mp-line': '#151515',
          'mp-zig': '#151515',
          'mp-band': '#ffffff',
          'mp-stripe': '#151515',
          'mp-drop': '#5cc8c4',
          'mp-hub': '#151515',
          'mp-hub-text': '#ffffff',
          'mp-hub-muted': '#d9d1e6',
          'mp-key': '#ffe27a',
          'mp-key-text': '#151515',
          'mp-speck-1': '#ff8fb1',
          'mp-speck-2': '#5cc8c4',
          'mp-speck-3': '#ffe27a',
          'mp-conf-1': '#ff7aa2',
          'mp-conf-2': '#38c3b6',
          'mp-conf-3': '#ffd23f',
          'mp-conf-4': '#9d7bff',
          'mp-conf-line': '#151515',
        },
        dark: {
          bg: '#15121c',
          surface: '#1f1b28',
          'surface-2': '#292434',
          border: '#3a3348',
          'border-strong': '#6f6585',
          text: '#f6f2fb',
          'text-muted': '#b9b0c9',
          accent: '#ff8fb1',
          'on-accent': '#151515',
          focus: '#7fe0d0',
          success: '#6fe0b0',
          'on-success': '#0e2a1f',
          'success-text': '#7fe8bb',
          warning: '#ffe27a',
          'warning-text': '#ffe27a',
          danger: '#ff7a9c',
          desk: 'radial-gradient(#3a3348 1.3px, transparent 1.9px) 0 0 / 20px 20px, #15121c',
          'wheel-face': '#1d1a25',
          'wheel-slice': '#211d2b',
          'wheel-slice-hover': '#2b2638',
          'wheel-slice-selected': '#ffb8cc',
          'wheel-text': '#ffb8cc',
          'wheel-text-selected': '#151515',
          'wheel-line': '#f6f2fb',
          'wheel-shadow': '#ff6f9f',
          'mp-tile-1': '#211d2b',
          'mp-tile-2': '#272233',
          'mp-tile-3': '#211d2b',
          'mp-tile-4': '#272233',
          'mp-label-1': '#ffb8cc',
          'mp-label-2': '#a8ead4',
          'mp-label-3': '#ffe27a',
          'mp-label-4': '#cfbfff',
          'mp-lift-1': '#38d6c4',
          'mp-lift-2': '#ff8fb1',
          'mp-lift-3': '#a98cff',
          'mp-lift-4': '#ffd23f',
          'mp-sel-1': '#ffb8cc',
          'mp-sel-2': '#a8ead4',
          'mp-sel-3': '#ffe27a',
          'mp-sel-4': '#cfbfff',
          'mp-sub': '#d4cce0',
          'mp-line': '#f6f2fb',
          'mp-zig': '#ffe27a',
          'mp-band': '#151515',
          'mp-stripe': '#ff8fb1',
          'mp-drop': '#ff6f9f',
          'mp-hub': '#ffe27a',
          'mp-hub-text': '#151515',
          'mp-hub-muted': '#4d4256',
          'mp-key': '#151515',
          'mp-key-text': '#ffe27a',
          'mp-speck-1': '#151515',
          'mp-speck-2': '#151515',
          'mp-speck-3': '#151515',
          'mp-conf-1': '#ff7aa2',
          'mp-conf-2': '#38d6c4',
          'mp-conf-3': '#ffd23f',
          'mp-conf-4': '#a98cff',
          'mp-conf-line': '#151515',
        },
      },
      contrast: [
        ...Board.DEFAULT_PAIRS,
        ['mp-label-1', 'mp-tile-1', 'text'],
        ['mp-label-2', 'mp-tile-2', 'text'],
        ['mp-label-3', 'mp-tile-3', 'text'],
        ['mp-label-4', 'mp-tile-4', 'text'],
        ['mp-sub', 'mp-tile-1', 'text'],
        ['mp-sub', 'mp-tile-2', 'text'],
        ['mp-sub', 'mp-tile-3', 'text'],
        ['mp-sub', 'mp-tile-4', 'text'],
        ['wheel-text-selected', 'mp-sel-1', 'text'],
        ['wheel-text-selected', 'mp-sel-2', 'text'],
        ['wheel-text-selected', 'mp-sel-3', 'text'],
        ['wheel-text-selected', 'mp-sel-4', 'text'],
        ['mp-hub-text', 'mp-hub', 'text'],
        ['mp-hub-muted', 'mp-hub', 'text'],
        ['mp-key-text', 'mp-key', 'text'],
      ],
      icons: { more: '<path d="M2.5 13.5q2.4 -5 4.8 0t4.8 0t4.8 0t4.8 0" stroke-width="2.4"/>' },
      defs: '',

      wheel: {
        render(root, m, H) {
          const s = H.s;
          const uid = H.uid('memphis');
          // Hard colored shadow of the whole badge, then the zigzag, the striped band and the tiles.
          s('path', { d: zigzag(), class: 'mp-drop', transform: 'translate(7 8)' }, root);
          s('path', { d: zigzag(), class: 'mp-zig' }, root);
          s('circle', { cx: C, cy: C, r: R.zigIn + 1, class: 'mp-band' }, root);
          const clip = s('clipPath', { id: uid + '-band' }, root);
          s('path', { d: H.ring(R.band - 2, R.zigIn + 1) }, clip);
          let stripes = '';
          for (let x = 0; x <= 800; x += 9) stripes += `M${x} 0L${x - 400} 400`;
          s('path', { d: stripes, class: 'mp-stripes', 'clip-path': `url(#${uid}-band)` }, root);
          s('circle', { cx: C, cy: C, r: R.zigIn + 1, class: 'mp-rule' }, root);
          s('circle', { cx: C, cy: C, r: R.tile, class: 'mp-face' }, root);

          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            g.classList.add('mp-h' + hue(sl.i, m.n));
            const d = tilePath(sl.a0, sl.a1);
            // The shadow stays put and is the hit area; the tile and its label lift off it.
            s('path', { d, class: 'mp-shade' }, g);
            // Lifting pushes the tile outward, so it never slides over a neighbor's label.
            const lift = s('g', { class: 'mp-lift' }, g);
            lift.style.setProperty('--lx', f2(7 * Math.sin(rad(sl.mid))) + 'px');
            lift.style.setProperty('--ly', f2(-7 * Math.cos(rad(sl.mid)) - 1) + 'px');
            s('path', { d, class: 'mp-tile' }, lift);
            s('path', { d, class: 'mp-selfill' }, lift);
            // Terrazzo specks shown once the tile is applied, kept clear of the label.
            const rand = rng(sl.i + 1);
            let specks = ['', '', ''];
            const count = Math.min(32, Math.round((12 * sl.step) / 45));
            for (let k = 0; k < count; k++) {
              const r = k % 2 ? 66 + rand() * 14 : 139 + rand() * 11;
              const a = sl.a0 + 7 + rand() * (sl.a1 - sl.a0 - 14);
              const [x, y] = H.polar(r, a);
              const w = 1.6 + rand() * 1.8;
              const turnA = rand() * 180;
              specks[k % 3] +=
                `M${f2(x - w)} ${f2(y)}l${f2(2 * w * Math.cos(rad(turnA)))} ${f2(2 * w * Math.sin(rad(turnA)))}`;
            }
            const sp = s('g', { class: 'mp-specks' }, lift);
            specks.forEach((dd, k) => s('path', { d: dd, class: `mp-speck mp-speck-${k + 1}` }, sp));
            s('path', { d, class: 'mp-outline' }, lift);
            const ink = s('g', { class: 'mp-ink' }, lift);
            const wide = sl.step >= 70;
            const o = sl.format
              ? { size: sl.sub ? 24 : 28, subSize: 13, gap: 2, minSize: 11, cls: 'mp-lbl mp-fmt', subCls: 'mp-sub' }
              : {
                  icon: true,
                  iconSize: wide ? 28 : 23,
                  size: wide ? 16.5 : 14.5,
                  gap: 4,
                  minSize: 10,
                  cls: 'mp-lbl mp-word',
                  sub: null,
                };
            // The squiggles swing about four units either way, so labels keep a wider margin.
            fitBlock(H, ink, sl, [R.lbl, R.lbl + 6, R.lbl - 6, R.lbl + 12, R.lbl - 12], o, R.inner, R.tile, 112, 6);
          }

          // Hub: a black disc with the wheel's name, the file and the key on a yellow pill.
          const hub = s('g', { class: 'mp-hubg' }, root);
          s('circle', { cx: C, cy: C, r: R.hub, class: 'mp-hub' }, hub);
          H.label(hub, C, C - 16, m.title, { maxWidth: 88, size: 16, minSize: 10, cls: 'mp-title', maxLines: 1 });
          H.label(hub, C, C + (m.key ? 3 : 8), m.file, {
            maxWidth: 84,
            size: 12.5,
            minSize: 9,
            cls: 'mp-file',
            maxLines: 1,
          });
          if (m.key) {
            const pill = s('rect', { y: C + 16, height: 18, rx: 9, class: 'mp-key' }, hub);
            const text = H.text(hub, C, C + 25.5, m.key, { class: 'mp-keytext' });
            const kw = Math.min(96, Math.ceil(text.getComputedTextLength()) + 20);
            pill.setAttribute('x', f2(C - kw / 2));
            pill.setAttribute('width', f2(kw));
          }

          // Confetti for the slice at twelve o'clock; update() turns the group to the applied slice.
          const fx = s('g', { class: 'mp-fx', 'aria-hidden': 'true' }, root);
          const rand = rng(29);
          for (let k = 0; k < 18; k++) {
            const a = (k - 8.5) * 9.5 + (rand() - 0.5) * 8;
            const dist = 80 + rand() * 80;
            const piece = s('g', { class: 'mp-bit' }, fx);
            piece.style.setProperty('--dx', f2(dist * Math.sin(rad(a))) + 'px');
            piece.style.setProperty('--dy', f2(-dist * Math.cos(rad(a))) + 'px');
            piece.style.setProperty('--rot', Math.round((rand() - 0.5) * 540) + 'deg');
            piece.style.setProperty('--d', Math.round(rand() * 60) + 'ms');
            const shape = BITS[k % BITS.length];
            const squiggle = k % BITS.length === 4;
            s(
              'path',
              {
                d: shape,
                class: squiggle ? 'mp-bit-line' : `mp-bit-fill mp-conf-${(k % 4) + 1}`,
                transform: `translate(${C} ${C - R.lbl - 6})`,
              },
              piece,
            );
          }
        },

        update(root, m, st) {
          // The pointed and the applied tile are drawn last, so their lift is never hidden by a neighbor.
          const hub = root.querySelector('.mp-hubg');
          for (const k of [st.selected, st.hover]) {
            if (k == null) continue;
            const g = root.querySelector(`.slice[data-slice="${k}"]`);
            if (g && g.nextElementSibling !== hub) root.insertBefore(g, hub);
          }
          const fx = root.querySelector('.mp-fx');
          if (st.selected != null) fx.style.transform = `rotate(${f2(m.slices[st.selected].mid)}deg)`;
        },
      },

      sounds: {
        open(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'triangle', f: 330, f2: 660, dur: 0.07, gain: 0.08, a: 0.003 });
          X.burst(ac, out, t, { type: 'bandpass', f: 900, q: 2, dur: 0.02, gain: 0.08 });
        },
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { type: 'triangle', f: 980, f2: 760, dur: 0.03, gain: 0.06, a: 0.002 });
        },
        success(ac, out, t, X) {
          // Pop, then a boing: a low tone whose pitch wobbles fast at first and settles.
          X.burst(ac, out, t, { type: 'highpass', f: 1200, q: 0.7, dur: 0.03, gain: 0.14 });
          X.tone(ac, out, t, { type: 'sine', f: 140, f2: 70, dur: 0.05, gain: 0.08, a: 0.001 });
          const o = ac.createOscillator();
          const lfo = ac.createOscillator();
          const depth = ac.createGain();
          const g = ac.createGain();
          const t0 = t + 0.03;
          o.type = 'sine';
          o.frequency.setValueAtTime(170, t0);
          o.frequency.exponentialRampToValueAtTime(300, t0 + 0.12);
          o.frequency.exponentialRampToValueAtTime(260, t0 + 0.42);
          lfo.frequency.setValueAtTime(24, t0);
          lfo.frequency.linearRampToValueAtTime(10, t0 + 0.42);
          depth.gain.setValueAtTime(70, t0);
          depth.gain.exponentialRampToValueAtTime(3, t0 + 0.42);
          lfo.connect(depth).connect(o.frequency);
          X.env(g.gain, t0, { a: 0.006, d: 0.42, peak: 0.09 });
          o.connect(g).connect(out);
          o.start(t0);
          lfo.start(t0);
          o.stop(t0 + 0.5);
          lfo.stop(t0 + 0.5);
          for (const [dt, f] of [
            [0.09, 2600],
            [0.15, 3300],
            [0.22, 2900],
          ])
            X.tone(ac, out, t + dt, { f, dur: 0.04, gain: 0.025, a: 0.001 });
        },
      },
    });
  })();
}
