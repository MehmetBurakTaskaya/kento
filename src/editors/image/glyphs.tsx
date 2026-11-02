// SPDX-License-Identifier: MIT
// The image editors' own 24 x 24 stroke icons, drawn like the app's icon set (design/DESIGN.md,
// section 5). Undo and redo are directional and mirror in right-to-left layouts.
import { Icon, type IconName } from '../../components/Icon';

const GLYPHS = {
  select: 'M6.5 3.5l11 8.2-5 .9 2.9 6.2-2.4 1.1-2.9-6.2-3.6 3.6z',
  highlighter: 'M4 20.5h8M8.2 16.8l-3-3L15.6 3.4l3 3zM5.2 13.8l-1.6 4.4 1.2 1.2 4.4-1.6',
  rectangle: 'M4 6h16v12H4z',
  ellipse: 'M21 12c0 3.9-4 7-9 7s-9-3.1-9-7 4-7 9-7 9 3.1 9 7z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L18 6M10 5h9v9',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  'flip-h': 'M12 3v18M9 7L3.5 17H9zM15 7l5.5 10H15z',
  'flip-v': 'M3 12h18M7 9L17 3.5V9zM7 15l10 5.5V15z',
  'zoom-in': 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.9-4.9M8 10.5h5M10.5 8v5',
  'zoom-out': 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.9-4.9M8 10.5h5',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
} as const;

export type GlyphName = keyof typeof GLYPHS | IconName;

const MIRRORED = new Set<GlyphName>(['undo', 'redo']);

export function Glyph({ name, size = 18 }: { name: GlyphName; size?: number }) {
  if (!(name in GLYPHS)) return <Icon name={name as IconName} size={size} />;
  return (
    <svg
      className={MIRRORED.has(name) ? 'icon flip' : 'icon'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path d={GLYPHS[name as keyof typeof GLYPHS]} />
    </svg>
  );
}
