// SPDX-License-Identifier: MIT
// Minimal ring. No metaphor: a quiet acrylic ring that sits with Windows 11 Fluent and Mica.
export default function register(Board) {
  (function () {
    'use strict';

    Board.define({
      id: 'minimal',
      fonts: {
        brand: "'Onest Variable'",
        load: ["'Onest Variable'"],
        credits: [{ family: 'Onest', license: 'SIL Open Font License 1.1' }],
      },
      motion: { open: 150, close: 100, stagger: 10 },
      palette: {
        light: {
          bg: '#f3f4f7',
          surface: '#ffffff',
          'surface-2': '#f6f7fa',
          border: '#e1e3ea',
          'border-strong': '#b9becc',
          text: '#16181d',
          'text-muted': '#5a6070',
          accent: '#3b4bdb',
          'on-accent': '#ffffff',
          focus: '#3b4bdb',
          success: '#138a4b',
          'on-success': '#ffffff',
          'success-text': '#0f7a41',
          warning: '#c27c0e',
          'warning-text': '#8a5600',
          danger: '#c42b3b',
          desk: 'linear-gradient(135deg, #d9e1f2 0%, #ece4f2 55%, #e4eef0 100%)',
          'wheel-face': 'rgba(251, 251, 253, 0.8)',
          'wheel-slice': '#fafafc',
          'wheel-slice-hover': '#e7eafb',
          'wheel-slice-selected': '#3b4bdb',
          'wheel-text': '#16181d',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#e1e3ea',
          'wheel-shadow': 'rgba(20, 24, 40, 0.24)',
        },
        dark: {
          bg: '#1c1d22',
          surface: '#26272d',
          'surface-2': '#2e2f36',
          border: '#3a3c44',
          'border-strong': '#5a5d69',
          text: '#f2f3f6',
          'text-muted': '#a9adba',
          accent: '#8e9bff',
          'on-accent': '#0e1240',
          focus: '#a6b0ff',
          success: '#3ccb7f',
          'on-success': '#08240f',
          'success-text': '#5fd897',
          warning: '#f2b33d',
          'warning-text': '#f5c264',
          danger: '#ff6b78',
          desk: 'linear-gradient(135deg, #1e2336 0%, #2a2133 55%, #1d2a2e 100%)',
          'wheel-face': 'rgba(38, 39, 46, 0.84)',
          'wheel-slice': '#2a2b32',
          'wheel-slice-hover': '#363b60',
          'wheel-slice-selected': '#8e9bff',
          'wheel-text': '#f2f3f6',
          'wheel-text-selected': '#0e1240',
          'wheel-line': '#3a3c44',
          'wheel-shadow': 'rgba(0, 0, 0, 0.5)',
        },
      },
      defs: `
      <filter id="minimal-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>`,

      wheel: {
        render(root, m, H) {
          const R0 = 80,
            R1 = 186;
          H.s('circle', { cx: H.C, cy: H.C, r: R1 + 4, class: 'mn-rim' }, root);
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R0 + 4, R1, sl.a0, sl.a1, 4), class: 'mn-seg' }, g);
            H.s('path', { d: H.arc(R1 + 9, sl.a0 + 5, sl.a1 - 5), class: 'mn-ind' }, g);
            const c = H.s('g', { class: 'mn-content' }, g);
            // Formats read as their name, large, with a second line where they have one.
            if (sl.format) {
              H.block(c, sl, 136, {
                size: 22,
                subSize: 12.5,
                gap: 2,
                maxWidth: 84,
                cls: 'mn-lbl mn-fmt',
                subCls: 'mn-sub',
              });
            } else {
              H.block(c, sl, 136, {
                icon: true,
                iconSize: 25,
                size: 14,
                gap: 5,
                maxWidth: 82,
                minSize: 9,
                cls: 'mn-lbl',
                sub: null,
              });
            }
          }
          // Center: what wheel this is and which file it acts on.
          const ctr = H.s('g', { class: 'mn-center' }, root);
          H.s('circle', { cx: H.C, cy: H.C, r: R0 - 4, class: 'mn-hub' }, ctr);
          // Without a key the title and the file move down to the middle.
          const dy = m.key ? 0 : 9;
          H.label(ctr, H.C, H.C - 16 + dy, m.title, {
            maxWidth: 120,
            size: 15,
            minSize: 10,
            cls: 'mn-title',
            maxLines: 1,
          });
          H.label(ctr, H.C, H.C + 5 + dy, m.file, {
            maxWidth: 120,
            size: 11.5,
            minSize: 9,
            cls: 'mn-file',
            maxLines: 1,
          });
          // The key that opened the wheel; a ring opened without one shows none.
          if (m.key) {
            const kw = 12 + m.key.length * 7.5;
            H.s('rect', { x: H.C - kw / 2, y: H.C + 21, width: kw, height: 19, rx: 5, class: 'mn-key' }, ctr);
            H.text(ctr, H.C, H.C + 31, m.key, { class: 'mn-keytext' });
          }
        },
      },

      sounds: {
        open(ac, out, t, X) {
          X.burst(ac, out, t, { type: 'bandpass', f: 700, f2: 2600, q: 1.1, dur: 0.12, gain: 0.22, a: 0.02 });
          X.tone(ac, out, t + 0.01, { f: 660, f2: 990, dur: 0.09, gain: 0.04, a: 0.02 });
        },
        tick(ac, out, t, X) {
          X.tone(ac, out, t, { f: 2300, f2: 1900, dur: 0.028, gain: 0.1, a: 0.001 });
          X.burst(ac, out, t, { type: 'highpass', f: 5200, q: 0.7, dur: 0.012, gain: 0.05 });
        },
        success(ac, out, t, X) {
          X.tone(ac, out, t, { f: 784, dur: 0.2, gain: 0.13, a: 0.006 });
          X.tone(ac, out, t + 0.09, { f: 1175, dur: 0.34, gain: 0.11, a: 0.006 });
        },
      },
    });
  })();
}
