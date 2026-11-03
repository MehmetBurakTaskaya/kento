// SPDX-License-Identifier: MIT
// Tezgah. A workshop pegboard: every slice is a hook spot where a tool hangs, and the
// Convert wheel's formats are kraft-paper tags. Tools and tags hang straight down, so every label
// reads upright at every angle and in both directions.
export default function register(Board) {
  (function () {
    'use strict';

    // Wheel geometry in the 400 x 400 viewBox.
    const R_RIM = 196; // outer edge of the wooden frame
    const R_FACE = 184; // painted pegboard face
    const R_IN = 66; // inner edge of the slices
    const R_HUB = 58; // steel name plate in the center
    const RC = 124; // center line of the hanging tools and tags
    const TOOL = 46; // tool silhouette size
    const FIT = 177; // hanging things stay inside this radius
    const f2 = (n) => Math.round(n * 100) / 100;
    // Stamped labels are capitals; scripts without case keep their text.
    const caseless = /^(ja|zh|ko|ar)/;
    const stamp = (t, lang) => (caseless.test(lang) ? t : t.toLocaleUpperCase(lang));

    // ---------------------------------------------------------------- tool silhouettes
    // Our own filled 24 x 24 silhouettes. They replace the stroke icons wherever a tool hangs on the
    // wheel; the Home window keeps the shared stroke icons for navigation.
    const solid = (inner, transform) =>
      `<g fill="currentColor" stroke="none"${transform ? ` transform="${transform}"` : ''}>${inner}</g>`;
    const disc = (cx, cy, r) =>
      `M${f2(cx - r)} ${f2(cy)}a${r} ${r} 0 1 0 ${f2(2 * r)} 0a${r} ${r} 0 1 0 ${f2(-2 * r)} 0Z`;
    const key = (y) =>
      `<path fill-rule="evenodd" d="${disc(5.4, y, 3.3)}${disc(5.4, y, 1.3)}"/><rect x="8.2" y="${f2(y - 1)}" width="13.6" height="2" rx=".5"/>` +
      `<rect x="14.2" y="${f2(y + 0.6)}" width="1.7" height="2.6" rx=".3"/><rect x="17.3" y="${f2(y + 0.6)}" width="1.7" height="2" rx=".3"/><rect x="20.1" y="${f2(y + 0.6)}" width="1.7" height="2.9" rx=".3"/>`;

    const ICONS = {
      // Compress: a C-clamp.
      compress: solid(
        '<path d="M4 4.6A1.6 1.6 0 0 1 5.6 3H17.4V6.4H7.8V17.6H18.4V21H5.6A1.6 1.6 0 0 1 4 19.4Z"/><rect x="13.8" y="6.4" width="3.6" height="2.2" rx=".5"/><rect x="14.8" y="10.4" width="1.6" height="12.2"/><rect x="13.4" y="9.6" width="4.4" height="1.9" rx=".6"/><rect x="11.6" y="21.9" width="8" height="1.7" rx=".85"/>',
      ),
      // Crop: a hand saw, with the hole it hangs by.
      crop: solid(
        `<path fill-rule="evenodd" d="M2 8.4A2.4 2.4 0 0 1 4.4 6H8.6A1.4 1.4 0 0 1 10 7.4V16.6A1.4 1.4 0 0 1 8.6 18H4.4A2.4 2.4 0 0 1 2 15.6ZM4.4 9.2V14.8H7.4V9.2Z"/><path fill-rule="evenodd" d="M9.6 7.2L22.2 10.6V13.4L21.15 14.98L20.1 13.77L19.05 15.35L18 14.13L16.95 15.72L15.9 14.5L14.85 16.08L13.8 14.87L12.75 16.45L11.7 15.23L10.65 16.82L9.6 15.6Z${disc(20, 11.9, 0.75)}"/>`,
      ),
      // Edit: an adjustable wrench.
      sliders: solid(
        `<path d="M13.6 12C13.6 8.6 15.6 6.4 18.6 6.4H21.4A1.2 1.2 0 0 1 22.6 7.6V10H18.4V13.4H22.6V16.4A1.2 1.2 0 0 1 21.4 17.6H18.6C15.6 17.6 13.6 15.4 13.6 12Z"/><path fill-rule="evenodd" d="M3.1 10.3H15V13.7H3.1A1.7 1.7 0 0 1 3.1 10.3Z${disc(3.6, 12, 0.85)}"/>`,
        'rotate(-45 12 12)',
      ),
      // Mark up: a flat carpenter's pencil.
      pen: solid(
        '<path fill-rule="evenodd" d="M3 8.6H15.6V15.4H3A1 1 0 0 1 2 14.4V9.6A1 1 0 0 1 3 8.6ZM4 11.6H14V12.4H4Z"/><path d="M16.3 8.6L20.2 10.6V13.4L16.3 15.4Z"/><path d="M20.8 10.9L22.6 11.6V12.4L20.8 13.1Z"/>',
        'rotate(135 12 12)',
      ),
      // Redact: a paint roller.
      redact: solid(
        '<rect x="2.4" y="3" width="15.2" height="6.6" rx="2"/><path d="M17.6 6.3H20.9V12H12.2V14.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><rect x="10.6" y="14" width="3.2" height="8.6" rx="1.4"/>',
      ),
      // Read QR: a magnifier over a code.
      qr: solid(
        `<path fill-rule="evenodd" d="${disc(10, 10, 7.4)}${disc(10, 10, 5.3)}"/><rect x="6.9" y="6.9" width="2.4" height="2.4" rx=".3"/><rect x="10.7" y="6.9" width="2.4" height="2.4" rx=".3"/><rect x="6.9" y="10.7" width="2.4" height="2.4" rx=".3"/><rect x="11" y="11" width="1.8" height="1.8" rx=".3"/><path d="M14.4 16.3L16.3 14.4L21.9 20A1.35 1.35 0 0 1 20 21.9Z"/>`,
      ),
      // Remove background: scissors.
      cutout: solid(
        `<path fill-rule="evenodd" d="${disc(6.6, 18.2, 3.6)}${disc(6.6, 18.2, 1.75)}"/><path fill-rule="evenodd" d="${disc(17.4, 18.2, 3.6)}${disc(17.4, 18.2, 1.75)}"/><path d="M8.2 15.4L16 2.3L17.3 3L10.5 16.5Z"/><path d="M15.8 15.4L8 2.3L6.7 3L13.5 16.5Z"/>`,
      ),
      // More: a toolbox.
      more: solid(
        '<path fill-rule="evenodd" d="M3.6 8.6H20.4A1.6 1.6 0 0 1 22 10.2V19.4A1.6 1.6 0 0 1 20.4 21H3.6A1.6 1.6 0 0 1 2 19.4V10.2A1.6 1.6 0 0 1 3.6 8.6ZM2 12.6H22V13.4H2Z"/><rect x="10.3" y="11.3" width="3.4" height="3.4" rx=".6"/><path d="M8.2 8.6V6.4A1.8 1.8 0 0 1 10 4.6H14A1.8 1.8 0 0 1 15.8 6.4V8.6H14.2V6.3H9.8V8.6Z"/>',
      ),
      // Share: a megaphone.
      share: solid(
        '<path d="M2.6 9.4A1 1 0 0 1 3.6 8.4H6.4V15.6H3.6A1 1 0 0 1 2.6 14.6Z"/><path d="M7.2 8.4L16.6 3.6V20.4L7.2 15.6Z"/><rect x="16.2" y="2.6" width="2.4" height="18.8" rx="1.2"/><path d="M8.4 16.2H11L12 21.4H9.4Z"/><path d="M20.6 9.2Q22 12 20.6 14.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
      ),
      // Shelf: a wall shelf on two brackets.
      shelf: solid(
        '<rect x="1.8" y="12.4" width="20.4" height="2.4" rx=".6"/><path d="M3.6 14.8H8.2L3.6 19.4Z"/><path d="M20.4 14.8H15.8L20.4 19.4Z"/><rect x="3.2" y="14.8" width="1.6" height="5.6" rx=".4"/><rect x="19.2" y="14.8" width="1.6" height="5.6" rx=".4"/><rect x="4.6" y="6.6" width="4.6" height="5.8" rx="1.1"/><rect x="4.2" y="5" width="5.4" height="1.9" rx=".5"/><rect x="11.2" y="8.2" width="7.6" height="4.2" rx=".5"/>',
      ),
      // Copy to: two identical keys, as cut at a key bench.
      copy: solid(key(6) + key(16.4)),
      // Move to: a hand truck with a box.
      move: solid(
        `<path d="M4.2 2.4H6.6V16.8H15.8V18.6H4.2Z"/><rect x="2.2" y="2.2" width="4.4" height="2.2" rx="1"/><path fill-rule="evenodd" d="M8.2 7H17.6A.8.8 0 0 1 18.4 7.8V16.8H7.4V7.8A.8.8 0 0 1 8.2 7ZM7.4 11.4H18.4V12.2H7.4Z"/><path fill-rule="evenodd" d="${disc(5.4, 20.6, 2.9)}${disc(5.4, 20.6, 1.1)}"/>`,
      ),
      // Copy path: a tape measure.
      link: solid(
        `<path fill-rule="evenodd" d="M6 5.6H12.4A3.6 3.6 0 0 1 16 9.2V15.6A3.6 3.6 0 0 1 12.4 19.2H6A3.6 3.6 0 0 1 2.4 15.6V9.2A3.6 3.6 0 0 1 6 5.6Z${disc(9.2, 12.4, 2)}"/><path fill-rule="evenodd" d="M15.6 16H21V19.2H15.6ZM16.9 16H17.5V17.3H16.9ZM18.7 16H19.3V17.3H18.7Z"/><rect x="20.4" y="14.4" width="1.7" height="5.8" rx=".5"/>`,
      ),
      // Terminal: a steel plate with a punched prompt.
      terminal: solid(
        `<path fill-rule="evenodd" d="M4.4 4.6H19.6A2 2 0 0 1 21.6 6.6V17.4A2 2 0 0 1 19.6 19.4H4.4A2 2 0 0 1 2.4 17.4V6.6A2 2 0 0 1 4.4 4.6ZM6.2 8.8L10.8 12L6.2 15.2V13.1L7.9 12L6.2 10.9ZM11.8 13.8H17.8V15.4H11.8Z${disc(4.6, 6.8, 0.7)}${disc(19.4, 6.8, 0.7)}${disc(4.6, 17.2, 0.7)}${disc(19.4, 17.2, 0.7)}"/>`,
      ),
      // Show in Explorer: a flashlight.
      folder: solid(
        '<path fill-rule="evenodd" d="M3 9.6H10.2V14.4H3A1 1 0 0 1 2 13.4V10.6A1 1 0 0 1 3 9.6ZM4.6 11.4H7.4V12.6H4.6Z"/><path d="M10 9.4L14 7.4V16.6L10 14.6Z"/><rect x="13.8" y="7" width="1.8" height="10" rx=".6"/><path d="M17.6 12H21.8M17.2 8.1L20.4 5.5M17.2 15.9L20.4 18.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
        'rotate(28 12 12)',
      ),
      // Zip: a tool bag with a zipper.
      zip: solid(
        '<path d="M8.2 9.4V7.6A3.8 3.8 0 0 1 15.8 7.6V9.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path fill-rule="evenodd" d="M4.8 9H19.2L21.6 19.4A1.6 1.6 0 0 1 20 21.4H4A1.6 1.6 0 0 1 2.4 19.4ZM4.29 11.2H19.71L20.03 12.6H3.97Z"/><path d="M5.6 11.2h1.2v.7H5.6ZM8 11.9h1.2v.7H8ZM10.4 11.2h1.2v.7h-1.2ZM12.8 11.9H14v.7h-1.2ZM15.2 11.2h1.2v.7h-1.2ZM17.6 11.9h1.2v.7h-1.2Z"/><rect x="16" y="12.2" width="1.7" height="4" rx=".7"/>',
      ),
    };

    // ---------------------------------------------------------------- wheel parts
    function peg(parent, H, x, y, r = 3) {
      H.s('circle', { cx: f2(x + 0.7), cy: f2(y + 1.1), r: r + 0.3, class: 'tz-peg-shadow' }, parent);
      H.s('circle', { cx: f2(x), cy: f2(y), r, class: 'tz-peg' }, parent);
      H.s('circle', { cx: f2(x - r * 0.33), cy: f2(y - r * 0.36), r: f2(r * 0.4), class: 'tz-peg-hi' }, parent);
    }

    function screw(parent, H, x, y, r, rot) {
      H.s('circle', { cx: f2(x), cy: f2(y), r, class: 'tz-screw' }, parent);
      const dx = Math.cos((rot * Math.PI) / 180) * r * 0.72;
      const dy = Math.sin((rot * Math.PI) / 180) * r * 0.72;
      H.s('line', { x1: f2(x - dx), y1: f2(y - dy), x2: f2(x + dx), y2: f2(y + dy), class: 'tz-slot' }, parent);
    }

    // Convert: a kraft shipping tag on a twine loop, hung from one peg. Built first, laid out once
    // every tag is measured, so all tags on a wheel share one size.
    function tagParts(g, sl, m, H) {
      const [x, y] = H.polar(RC, sl.mid);
      const drop = H.s('g', { class: 'tz-drop' }, g);
      const swing = H.s('g', { class: 'tz-swing' }, drop);
      const shadow = H.s('path', { class: 'tz-tag-shadow' }, swing);
      const tag = H.s('path', { class: 'tz-tag' }, swing);
      // A format is stamped large; a choice or "More…" in words, smaller and on up to two lines.
      const more = !sl.format;
      const main = H.label(swing, x, 0, stamp(sl.label, m.lang), {
        maxWidth: 58,
        size: more ? 16 : 21,
        minSize: 10,
        maxLines: more ? 2 : 1,
        lh: 1.02,
        cls: 'tz-stamp tz-fmt',
      });
      const sub = sl.sub
        ? H.label(swing, x, 0, sl.sub, { maxWidth: 64, size: 16.5, minSize: 10, maxLines: 1, cls: 'tz-note' })
        : null;
      const ring = H.s('circle', { cx: f2(x), r: 4.4, class: 'tz-eyelet-ring' }, swing);
      const hole = H.s('circle', { cx: f2(x), r: 2, class: 'tz-eyelet' }, swing);
      const twine = H.s('path', { class: 'tz-twine' }, swing);
      const pegs = H.s('g', { class: 'tz-pegs' }, g);
      return { sl, x, y, swing, shadow, tag, main, sub, ring, hole, twine, pegs };
    }

    function layoutTags(parts, H) {
      const width = (t) => (t ? t.getBBox().width : 0);
      const lines = (t) => (t.querySelectorAll('tspan').length === 2 ? 2 : 1);
      // Handwriting only while it stays large; long words (German) switch every tag to print.
      const subs = parts.filter((p) => p.sub);
      if (subs.some((p) => +p.sub.getAttribute('font-size') < 13.5)) {
        for (const p of subs) {
          const t = H.label(p.swing, p.x, 0, p.sl.sub, {
            maxWidth: 64,
            size: 13.5,
            minSize: 9,
            maxLines: 1,
            cls: 'tz-note tz-print',
          });
          p.sub.remove();
          p.sub = t;
        }
      }
      let W = 0;
      let content = 0;
      for (const p of parts) {
        W = Math.max(W, width(p.main), width(p.sub));
        p.mainH = lines(p.main) * +p.main.getAttribute('font-size') * 1.02;
        p.subH = p.sub ? +p.sub.getAttribute('font-size') * 1.0 : 0;
        p.contentH = p.mainH + (p.sub ? 1 + p.subH : 0);
        content = Math.max(content, p.contentH);
      }
      W = Math.min(76, Math.max(60, W + 12));
      const EY = 12; // eyelet zone at the top of the tag
      const PAD = 7;
      const tagH = EY + content + PAD;
      const total = 13 + tagH; // peg and twine above the tag
      for (const p of parts) {
        [p.x, p.y] = fit(H, p.sl.mid, [[-W / 2, -total / 2, W / 2, total / 2]]);
        p.main.setAttribute('x', f2(p.x));
        p.main.querySelectorAll('tspan').forEach((t) => t.setAttribute('x', f2(p.x)));
        if (p.sub) p.sub.setAttribute('x', f2(p.x));
        p.ring.setAttribute('cx', f2(p.x));
        p.hole.setAttribute('cx', f2(p.x));
        const top = p.y - total / 2;
        const pegY = top + 3;
        const T = top + 13;
        const B = T + tagH;
        const L = p.x - W / 2;
        const R = p.x + W / 2;
        const c = 9;
        const d = `M${f2(L + c)} ${f2(T)}H${f2(R - c)}L${f2(R)} ${f2(T + c)}V${f2(B - 3)}Q${f2(R)} ${f2(B)} ${f2(R - 3)} ${f2(B)}H${f2(L + 3)}Q${f2(L)} ${f2(B)} ${f2(L)} ${f2(B - 3)}V${f2(T + c)}Z`;
        p.tag.setAttribute('d', d);
        p.shadow.setAttribute('d', d);
        p.shadow.setAttribute('transform', 'translate(1.4 2.2)');
        // Center the text block in the space under the eyelet.
        const y0 = T + EY + (content - p.contentH) / 2;
        p.main.setAttribute('y', f2(y0 + p.mainH / 2 + 0.8));
        if (p.sub) p.sub.setAttribute('y', f2(y0 + p.mainH + 1 + p.subH / 2));
        const ey = T + 6.5;
        p.ring.setAttribute('cy', f2(ey));
        p.hole.setAttribute('cy', f2(ey));
        p.twine.setAttribute(
          'd',
          `M${f2(p.x)} ${f2(pegY)}L${f2(p.x - 1.7)} ${f2(ey - 0.6)}M${f2(p.x)} ${f2(pegY)}L${f2(p.x + 1.7)} ${f2(ey - 0.6)}`,
        );
        p.swing.style.transformOrigin = `${f2(p.x)}px ${f2(pegY)}px`;
        peg(p.pegs, H, p.x, pegY, 2.8);
      }
    }

    // Moves a stack inward along its slice's center line until every corner is inside the face.
    // boxes are [x0, y0, x1, y1] relative to the stack's center.
    function fit(H, mid, boxes) {
      let rc = RC;
      for (; rc > RC - 16; rc -= 1) {
        const [x, y] = H.polar(rc, mid);
        const far = Math.max(
          ...boxes.flatMap(([x0, y0, x1, y1]) =>
            [
              [x0, y0],
              [x1, y0],
              [x0, y1],
              [x1, y1],
            ].map(([dx, dy]) => Math.hypot(x + dx - H.C, y + dy - H.C)),
          ),
        );
        if (far <= FIT) break;
      }
      return H.polar(rc, mid);
    }

    // Centers a 24-unit icon on (x, y) by its painted bounds, so every silhouette sits optically centered.
    function place(ico, x, y, size) {
      const bb = ico.getBBox();
      const k = size / 24;
      ico.setAttribute(
        'transform',
        `translate(${f2(x - (bb.x + bb.width / 2) * k)} ${f2(y - (bb.y + bb.height / 2) * k)}) scale(${f2(k)})`,
      );
      return { top: y - (bb.height * k) / 2, w: bb.width * k };
    }

    function hook(parent, H, x, top) {
      H.s('circle', { cx: f2(x), cy: f2(top + 6), r: 2.3, class: 'tz-hook-hole' }, parent);
      H.s('path', { d: `M${f2(x)} ${f2(top + 6)}V${f2(top - 3)}`, class: 'tz-hook' }, parent);
      H.s('path', { d: `M${f2(x - 0.55)} ${f2(top + 4)}V${f2(top - 2.6)}`, class: 'tz-hook-hi' }, parent);
    }

    // Tools and file actions: a silhouette hanging on two hooks over a strip of kraft label tape.
    function tool(g, sl, m, H) {
      const pegs = H.s('g', { class: 'tz-pegs' }, g);
      const shade = H.s('g', { class: 'tz-shade' }, g);
      const drop = H.s('g', { class: 'tz-drop' }, g);
      const lift = H.s('g', { class: 'tz-lift' }, drop);
      const lab = H.s('g', { class: 'tz-label' }, g);
      const tape = H.s('rect', { class: 'tz-tape' }, lab);
      const text = H.label(lab, 0, 0, stamp(sl.label, m.lang), {
        maxWidth: 70,
        size: 14.5,
        minSize: 9,
        lh: 1.06,
        cls: 'tz-stamp tz-lab',
      });
      const fs = +text.getAttribute('font-size');
      const n = text.querySelectorAll('tspan').length === 2 ? 2 : 1;
      const labH = n * fs * 1.06 + 6;
      const labW = text.getBBox().width + 12;
      const GAP = 5;
      const total = TOOL + GAP + labH;
      const [x, y] = fit(H, sl.mid, [
        [-TOOL / 2, -total / 2, TOOL / 2, -total / 2 + TOOL],
        [-labW / 2, total / 2 - labH, labW / 2, total / 2],
      ]);
      const top = y - total / 2;
      const cy = top + TOOL / 2;
      const ly = top + TOOL + GAP + labH / 2;
      text.setAttribute('x', f2(x));
      text.querySelectorAll('tspan').forEach((t) => t.setAttribute('x', f2(x)));
      text.setAttribute('y', f2(ly + 0.7));
      Object.entries({ x: f2(x - labW / 2), y: f2(ly - labH / 2), width: f2(labW), height: f2(labH), rx: 1.6 }).forEach(
        ([k, v]) => tape.setAttribute(k, v),
      );
      // The shadow stays on the board while the tool lifts off its hooks on hover.
      place(H.icon(shade, sl.icon, 0, 0, TOOL, 'tz-tool-shadow'), x + 1.4, cy + 2.4, TOOL);
      const at = place(H.icon(lift, sl.icon, 0, 0, TOOL, 'tz-tool'), x, cy, TOOL);
      const spread = Math.min(7.5, at.w / 3);
      hook(pegs, H, x - spread, at.top);
      hook(pegs, H, x + spread, at.top);
    }

    function hub(root, m, H) {
      const C = H.C;
      const g = H.s('g', { class: 'tz-hub' }, root);
      H.s('circle', { cx: C, cy: C + 2, r: R_HUB + 1, class: 'tz-plate-shadow' }, g);
      H.s('circle', { cx: C, cy: C, r: R_HUB, class: 'tz-plate' }, g);
      H.s('circle', { cx: C, cy: C, r: R_HUB, class: 'tz-sheen', fill: 'url(#tezgah-sheen)' }, g);
      H.s('circle', { cx: C, cy: C, r: R_HUB - 4.5, class: 'tz-plate-ring' }, g);
      [45, 135, 225, 315].forEach((a, k) => {
        const [sx, sy] = H.polar(R_HUB - 10.5, a);
        screw(g, H, sx, sy, 2.6, 25 + k * 50);
      });
      // Without a key the title and the file move down to the middle of the plate.
      const dy = m.key ? 0 : 8;
      H.label(g, C, C - 16 + dy, stamp(m.title, m.lang), {
        maxWidth: 86,
        size: 16,
        minSize: 10,
        maxLines: 1,
        cls: 'tz-stamp tz-hub-title',
      });
      H.label(g, C, C + 3 + dy, m.file, { maxWidth: 88, size: 12, minSize: 9, maxLines: 1, cls: 'tz-hub-file' });
      if (!m.key) return;
      const kw = 14 + m.key.length * 6.4;
      H.s('rect', { x: f2(C - kw / 2), y: C + 17, width: f2(kw), height: 18, rx: 4, class: 'tz-key-side' }, g);
      H.s('rect', { x: f2(C - kw / 2), y: C + 15, width: f2(kw), height: 17, rx: 4, class: 'tz-key' }, g);
      H.text(g, C, C + 23.8, m.key, { class: 'tz-keytext' });
    }

    Board.define({
      id: 'tezgah',
      fonts: {
        brand: "'Sofia Sans Variable'",
        display: "'Sofia Sans Condensed Variable'",
        accent: "'Caveat Variable'",
        load: ["'Sofia Sans Variable'", "'Sofia Sans Condensed Variable'", "'Caveat Variable'"],
        credits: [
          { family: 'Sofia Sans', license: 'SIL Open Font License 1.1' },
          { family: 'Sofia Sans Condensed', license: 'SIL Open Font License 1.1' },
          { family: 'Caveat', license: 'SIL Open Font License 1.1' },
        ],
      },
      motion: { open: 180, close: 110, stagger: 14 },
      icons: ICONS,
      contrast: [
        ['text', 'bg', 'text'],
        ['text', 'surface', 'text'],
        ['text-muted', 'bg', 'text'],
        ['text-muted', 'surface', 'text'],
        ['text-muted', 'surface-2', 'text'],
        ['on-accent', 'accent', 'text'],
        ['accent', 'surface', 'ui'],
        ['focus', 'bg', 'ui'],
        ['success', 'surface', 'ui'],
        ['success-text', 'surface', 'text'],
        ['warning-text', 'surface', 'text'],
        ['wheel-text', 'wheel-slice', 'text'],
        ['wheel-text', 'wheel-slice-hover', 'text'],
        ['wheel-text-selected', 'wheel-slice-selected', 'text'],
        ['tag-ink', 'kraft', 'text'],
        ['note-ink', 'kraft', 'text'],
        ['kraft-accent', 'kraft', 'text'],
        ['plate-text', 'plate', 'text'],
        ['plate-muted', 'plate', 'text'],
        ['thumb-ink', 'thumb', 'text'],
      ],
      palette: {
        light: {
          bg: '#f6f1e9',
          surface: '#fffdf9',
          'surface-2': '#f2ebe0',
          border: '#e4dacb',
          'border-strong': '#b3a48d',
          text: '#271e15',
          'text-muted': '#6a5b4a',
          accent: '#b2441c',
          'on-accent': '#ffffff',
          focus: '#9e3a15',
          success: '#2e7d4c',
          'on-success': '#ffffff',
          'success-text': '#256b40',
          warning: '#bf7a14',
          'warning-text': '#875300',
          danger: '#b42a1f',
          desk: 'linear-gradient(140deg, #e9e1d3 0%, #dcd1bf 52%, #e5dfd4 100%)',
          'wheel-face': '#efe8dc',
          'wheel-slice': '#efe8dc',
          'wheel-slice-hover': '#f7dfa9',
          'wheel-slice-selected': '#b2441c',
          'wheel-text': '#2f2a25',
          'wheel-text-selected': '#ffffff',
          'wheel-line': '#c9baa2',
          'wheel-shadow': 'rgba(64, 42, 20, 0.30)',
          kraft: '#d9bb8b',
          'kraft-hi': '#e4cb9f',
          'kraft-edge': '#ad8a56',
          eyelet: '#ece6da',
          twine: '#9c7c50',
          'tag-ink': '#2a1c0e',
          'note-ink': '#4a3520',
          'kraft-accent': '#7c2a0b',
          'tag-shadow': 'rgba(60, 40, 15, 0.22)',
          wood: '#c99a64',
          'wood-hi': '#dcb380',
          'wood-edge': '#8f6438',
          'wood-grain': 'rgba(110, 66, 28, 0.32)',
          hole: '#6c5844',
          'hole-lip': '#fffaf0',
          'hole-soft': 'rgba(120, 95, 65, 0.2)',
          speckle: '#5a4530',
          peg: '#a3a8ad',
          'peg-hi': '#f4f5f6',
          'peg-shadow': 'rgba(50, 35, 20, 0.3)',
          'tool-shadow': 'rgba(60, 40, 20, 0.26)',
          plate: '#d9dad8',
          'plate-edge': '#a6a9a6',
          'plate-text': '#22201d',
          'plate-muted': '#4f4b45',
          'plate-shadow': 'rgba(60, 40, 20, 0.22)',
          key: '#fbfaf7',
          'key-edge': '#a6a9a6',
          'screw-slot': '#5d6166',
          'paint-off': 'rgba(120, 100, 80, 0.15)',
          'paint-off-line': 'rgba(80, 62, 44, 0.6)',
          thumb: '#f1e4cb',
          'thumb-ink': '#5a4026',
          tick: 'rgba(90, 70, 45, 0.45)',
          'tick-on-accent': 'rgba(255, 255, 255, 0.45)',
          'speckle-opacity': '0.2',
        },
        dark: {
          bg: '#1b1815',
          surface: '#24201b',
          'surface-2': '#2d2923',
          border: '#3c362e',
          'border-strong': '#625949',
          text: '#f3ece0',
          'text-muted': '#b8ab97',
          accent: '#ef8b5d',
          'on-accent': '#2a1207',
          focus: '#f6a57f',
          success: '#63c58a',
          'on-success': '#0b2414',
          'success-text': '#80d4a0',
          warning: '#e8aa3e',
          'warning-text': '#f2c565',
          danger: '#ff7c6c',
          desk: 'linear-gradient(140deg, #1d1a17 0%, #29231d 52%, #1a1a1b 100%)',
          'wheel-face': '#2c2823',
          'wheel-slice': '#2c2823',
          'wheel-slice-hover': '#5c4a2c',
          'wheel-slice-selected': '#ef8b5d',
          'wheel-text': '#e7e2d9',
          'wheel-text-selected': '#2a1207',
          'wheel-line': '#4e473c',
          'wheel-shadow': 'rgba(0, 0, 0, 0.6)',
          kraft: '#c9a874',
          'kraft-hi': '#d6b886',
          'kraft-edge': '#8f7046',
          eyelet: '#d6d0c4',
          twine: '#b49466',
          'tag-ink': '#21160a',
          'note-ink': '#3d2b17',
          'kraft-accent': '#6e250a',
          'tag-shadow': 'rgba(0, 0, 0, 0.42)',
          wood: '#6b4a2f',
          'wood-hi': '#82603f',
          'wood-edge': '#3d2918',
          'wood-grain': 'rgba(18, 9, 0, 0.42)',
          hole: '#100e0c',
          'hole-lip': 'rgba(255, 240, 220, 0.09)',
          'hole-soft': 'rgba(255, 235, 205, 0.08)',
          speckle: '#a8957a',
          peg: '#8d949a',
          'peg-hi': '#e3e6e9',
          'peg-shadow': 'rgba(0, 0, 0, 0.5)',
          'tool-shadow': 'rgba(0, 0, 0, 0.5)',
          plate: '#3b3a37',
          'plate-edge': '#5f5d58',
          'plate-text': '#f1ece3',
          'plate-muted': '#c4bdb1',
          'plate-shadow': 'rgba(0, 0, 0, 0.45)',
          key: '#4a4844',
          'key-edge': '#232220',
          'screw-slot': '#2a2a2a',
          'paint-off': 'rgba(230, 220, 205, 0.07)',
          'paint-off-line': 'rgba(230, 220, 205, 0.5)',
          thumb: '#4a3c2a',
          'thumb-ink': '#edd9b5',
          tick: 'rgba(240, 225, 200, 0.35)',
          'tick-on-accent': 'rgba(42, 18, 7, 0.4)',
          'speckle-opacity': '0.3',
        },
      },
      // Theme-independent overlays; anything that follows the theme is defined per wheel in render().
      defs: `
      <linearGradient id="tezgah-bevel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".24"/></linearGradient>
      <radialGradient id="tezgah-sheen" cx=".36" cy=".28" r=".85"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></radialGradient>`,

      wheel: {
        render(root, m, H) {
          const C = H.C;
          const id = H.uid('tezgah-w');
          // Per-wheel defs, so their colors follow the theme of the surface the wheel sits on.
          const defs = H.s('defs', {}, root);
          defs.innerHTML =
            `<pattern id="${id}-holes" patternUnits="userSpaceOnUse" width="16" height="16"><circle class="tz-hole-lip" cx="8.5" cy="8.7" r="2.45"/><circle class="tz-hole" cx="8" cy="8" r="2.15"/></pattern>` +
            `<filter id="${id}-speckle" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
            `<feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" seed="11"/>` +
            `<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.6 0 0 0 -2.05"/>` +
            `<feComposite in2="SourceGraphic" operator="in" result="n"/><feFlood class="tz-speckle-color"/><feComposite in2="n" operator="in"/></filter>`;

          // Wooden frame with grain, then the painted pegboard face.
          H.s('path', { d: H.ring(R_FACE - 1, R_RIM), class: 'tz-rim' }, root);
          for (const [r, da, off] of [
            [186.2, '46 9 18 6 70 12', 0],
            [188.8, '62 12 20 8 30 5', 37],
            [191.4, '28 7 48 10 90 14', 80],
            [194, '55 14 30 6 22 9', 15],
          ]) {
            H.s(
              'circle',
              { cx: C, cy: C, r, class: 'tz-grain', 'stroke-dasharray': da, 'stroke-dashoffset': off },
              root,
            );
          }
          H.s('path', { d: H.ring(R_FACE - 1, R_RIM), class: 'tz-bevel', fill: 'url(#tezgah-bevel)' }, root);
          H.s('circle', { cx: C, cy: C, r: R_RIM - 0.5, class: 'tz-rim-edge' }, root);
          H.s('circle', { cx: C, cy: C, r: R_FACE, class: 'tz-face' }, root);
          H.s('circle', { cx: C, cy: C, r: R_FACE, class: 'tz-speckle', filter: `url(#${id}-speckle)` }, root);
          H.s('circle', { cx: C, cy: C, r: R_FACE - 7, class: 'tz-holes', fill: `url(#${id}-holes)` }, root);
          H.s('circle', { cx: C, cy: C, r: R_FACE - 2, class: 'tz-face-shade' }, root);
          // Chalk lines between the hook spots.
          for (const sl of m.slices) {
            const [x1, y1] = H.polar(R_IN + 2, sl.a0);
            const [x2, y2] = H.polar(R_FACE - 9, sl.a0);
            H.s('line', { x1: f2(x1), y1: f2(y1), x2: f2(x2), y2: f2(y2), class: 'tz-chalk' }, root);
          }

          const tags = [];
          for (const sl of m.slices) {
            const g = H.slice(root, sl, m);
            H.s('path', { d: H.sector(R_IN, R_FACE, sl.a0, sl.a1), class: 'tz-hit' }, g);
            const pd = H.sector(R_IN + 5, R_FACE - 6, sl.a0, sl.a1, 8);
            H.s('path', { d: pd, class: 'tz-paint' }, g);
            H.s('path', { d: pd, class: 'tz-paint-holes', fill: `url(#${id}-holes)` }, g);
            H.s('path', { d: H.arc(190, sl.a0 + 6, sl.a1 - 6), class: 'tz-mark' }, g);
            if (m.kind === 'convert') tags.push(tagParts(g, sl, m, H));
            else tool(g, sl, m, H);
          }
          if (tags.length) layoutTags(tags, H);
          // Screws hold the frame between the spots.
          m.slices.forEach((sl, k) => {
            const [x, y] = H.polar(190, sl.a0);
            screw(root, H, x, y, 2.6, 30 + k * 67);
          });
          hub(root, m, H);
        },
      },

      sounds: {
        open(ac, out, t, X) {
          // A soft knock as the board is hung, then two hooks jingle.
          X.burst(ac, out, t, { type: 'lowpass', f: 520, q: 0.9, dur: 0.07, gain: 0.32, a: 0.002 });
          X.tone(ac, out, t, { type: 'sine', f: 190, f2: 120, dur: 0.07, gain: 0.08, a: 0.002 });
          X.tone(ac, out, t + 0.035, { type: 'triangle', f: 3150, dur: 0.05, gain: 0.022, a: 0.001 });
          X.tone(ac, out, t + 0.07, { type: 'triangle', f: 3720, dur: 0.06, gain: 0.018, a: 0.001 });
        },
        tick(ac, out, t, X) {
          // A peg tapping the board.
          X.burst(ac, out, t, { type: 'bandpass', f: 1500, q: 3.5, dur: 0.018, gain: 0.22, a: 0.001 });
          X.tone(ac, out, t, { type: 'sine', f: 900, f2: 700, dur: 0.02, gain: 0.05, a: 0.001 });
        },
        success(ac, out, t, X) {
          // A rubber stamp thump, then a small metal ping.
          X.burst(ac, out, t, { type: 'lowpass', f: 380, q: 0.8, dur: 0.09, gain: 0.35, a: 0.003 });
          X.tone(ac, out, t + 0.06, { type: 'sine', f: 1568, dur: 0.42, gain: 0.07, a: 0.002 });
          X.tone(ac, out, t + 0.06, { type: 'sine', f: 4180, dur: 0.18, gain: 0.016, a: 0.002 });
        },
      },
    });
  })();
}
