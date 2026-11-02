// SPDX-License-Identifier: MIT
// The enamel face: the chapter ring with the slice numerals and the slice windows with their labels.
// The face never moves (design/DESIGN.md, "precise pointing"); only the slices' states change. It is
// also the menu for assistive technology: each slice is a menu item with its own label. When a ring
// of choices opens or closes, the ring left behind is drawn once more over the new one while it
// goes (the ghost), and the label of the slice that opened it flies between the slice and the hub.
import { useMemo, type CSSProperties, type Ref } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { arcPath, C, fx, polar, R, rayPath, sectorPath, spread, VIEW, type SliceGeometry } from './geometry';
import type { LabelBlock } from './labels';

/** How the slices on the face came: with a ring opened ('in') or closed ('out'). */
export type Entrance = 'in' | 'out';

export interface FaceSlice {
  key: string;
  geometry: SliceGeometry;
  numeral: string;
  icon?: IconName;
  /** Directional icons mirror in right-to-left layouts. */
  flipIcon: boolean;
  disabled: boolean;
  dimmed?: boolean;
  /** The slice holds a ring of choices: the angle of the small mark near its trailing edge (a submenu
   *  for screen readers). */
  ringMark?: number;
  format: boolean;
  block: LabelBlock;
  name: string;
  describedBy?: string;
}

interface FaceProps {
  uid: string;
  slices: FaceSlice[];
  hover: number | null;
  selected: number | null;
  /** Bumped when the ring's contents change, so the labels fade in again. */
  generation: number;
  /** This generation came with a ring opened or closed: its slices enter from `origin` outward. */
  entrance: Entrance | null;
  /** The slice at the angle of the slice that opened the ring: the new ring unfolds from it, or the
   *  ring below returns to it. */
  origin: number | null;
  /** The slice that lights up as its ring returns, when nothing points at it. */
  wash: number | null;
  label: string;
  describedBy: string;
  menuRef: Ref<SVGSVGElement>;
  itemRef: (index: number, element: SVGGElement | null) => void;
}

function Engraving({ slices }: { slices: SliceGeometry[] }) {
  const paths = useMemo(() => {
    let windows = '';
    let major = '';
    let minor = '';
    for (const { start, step } of slices) {
      windows += rayPath(R.WINDOW, R.CHAPTER, start);
      major += rayPath(R.CHAPTER, R.FACE, start);
      // Fine ticks between the boundaries, leaving room for the numeral.
      for (let k = 1; k < 10; k++) if (k < 4 || k > 6) minor += rayPath(R.FACE - 5, R.FACE, start + (k * step) / 10);
    }
    return { windows, major, minor };
  }, [slices]);
  return (
    <g className="wheel-engraving">
      <path d={paths.windows} className="wheel-division" />
      <circle cx={C} cy={C} r={R.CHAPTER} className="wheel-chapter" />
      <path d={paths.minor} className="wheel-tick-minor" />
      <path d={paths.major} className="wheel-tick-major" />
      <circle cx={C} cy={C} r={R.FACE - 1.5} className="wheel-face-shade" />
    </g>
  );
}

/** A small arrowhead pointing outwards just inside the chapter ring: more choices lie beyond. */
function ringMarkPath(at: number): string {
  const point = (r: number, a: number) => polar(r, a).map(fx).join(' ');
  return `M${point(R.CHAPTER - 4.5, at)}L${point(R.CHAPTER - 10.5, at - 1.5)}L${point(R.CHAPTER - 10.5, at + 1.5)}Z`;
}

function Content({ slice }: { slice: FaceSlice }) {
  const { block, icon, flipIcon, format } = slice;
  const iconBox = block.icon && icon ? block.icon : null;
  return (
    <g className="wheel-content">
      {iconBox && icon && (
        <g
          transform={
            flipIcon
              ? `translate(${fx(block.x + iconBox.size / 2)} ${fx(iconBox.y - iconBox.size / 2)}) scale(-1 1)`
              : `translate(${fx(block.x - iconBox.size / 2)} ${fx(iconBox.y - iconBox.size / 2)})`
          }
        >
          <Icon name={icon} size={iconBox.size} />
        </g>
      )}
      {block.label.lines.map((line, k) => (
        <text
          key={k}
          x={fx(block.x)}
          y={fx(line.y)}
          fontSize={block.label.size}
          className={format ? 'wheel-label wheel-format' : 'wheel-label'}
        >
          {line.text}
        </text>
      ))}
      {block.sub?.lines.map((line, k) => (
        <text key={`s${k}`} x={fx(block.x)} y={fx(line.y)} fontSize={block.sub!.size} className="wheel-sub">
          {line.text}
        </text>
      ))}
    </g>
  );
}

export function Face({
  uid,
  slices,
  hover,
  selected,
  generation,
  entrance,
  origin,
  wash,
  label,
  describedBy,
  menuRef,
  itemRef,
}: FaceProps) {
  const geometry = useMemo(() => slices.map((slice) => slice.geometry), [slices]);
  // The entrance belongs to the generation, so the groups keyed by it never change their animation.
  const fade = entrance ? `wheel-fade is-${entrance}` : 'wheel-fade';
  return (
    <svg
      ref={menuRef}
      className="wheel-layer wheel-face"
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="menu"
      aria-label={label}
      aria-describedby={describedBy}
      tabIndex={-1}
    >
      <defs>
        <radialGradient id={`${uid}-enamel`} gradientUnits="userSpaceOnUse" cx="152" cy="108" r="290">
          <stop offset={0} style={{ stopColor: 'var(--enamel-hi)' }} />
          <stop offset={0.6} style={{ stopColor: 'var(--wheel-face)' }} />
          <stop offset={1} style={{ stopColor: 'var(--enamel-lo)' }} />
        </radialGradient>
        <linearGradient id={`${uid}-blue`} gradientUnits="userSpaceOnUse" x1="80" y1="50" x2="320" y2="350">
          <stop offset={0} style={{ stopColor: 'var(--blue-hi)' }} />
          <stop offset={0.5} style={{ stopColor: 'var(--wheel-slice-selected)' }} />
          <stop offset={1} style={{ stopColor: 'var(--blue-lo)' }} />
        </linearGradient>
        <pattern id={`${uid}-hatch`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
          <path d="M0 0V5" className="wheel-hatch-line" />
        </pattern>
      </defs>
      <circle cx={C} cy={C} r={R.FACE} fill={`url(#${uid}-enamel)`} className="wheel-enamel" />
      {slices.map((slice, i) => {
        const { start, end, mid } = slice.geometry;
        const [nx, ny] = polar(R.NUMERAL, mid);
        const classes = ['wheel-slice'];
        if (i === hover) classes.push('is-hover');
        if (i === selected) classes.push('is-selected');
        if (slice.disabled) classes.push('is-off');
        if (slice.dimmed) classes.push('is-dimmed');
        if (entrance && i === origin) classes.push('is-origin');
        if (i === wash) classes.push('is-wash');
        const sweep = entrance && origin !== null ? spread(i, origin, slices.length) : 0;
        return (
          <g
            key={slice.key}
            ref={(element) => itemRef(i, element)}
            className={classes.join(' ')}
            role="menuitem"
            tabIndex={-1}
            aria-label={slice.name}
            aria-describedby={slice.describedBy}
            aria-haspopup={slice.ringMark === undefined ? undefined : 'menu'}
            aria-disabled={slice.disabled || undefined}
            aria-posinset={i + 1}
            aria-setsize={slices.length}
            style={{ '--i': i, '--sweep': fx(sweep) } as CSSProperties}
          >
            <path d={sectorPath(R.CHAPTER, R.FACE, start, end)} className="wheel-cell" />
            <path d={sectorPath(R.WINDOW, R.CHAPTER, start, end)} className="wheel-window" />
            {i === wash && <path d={sectorPath(R.WINDOW, R.CHAPTER, start, end)} className="wheel-wash" />}
            <path
              d={sectorPath(R.WINDOW - 3, R.CHAPTER, start, end)}
              className="wheel-inlay"
              fill={`url(#${uid}-blue)`}
            />
            <path d={arcPath(R.CHAPTER - 1.7, start + 0.9, end - 0.9)} className="wheel-keyline" />
            {slice.disabled && (
              <path d={sectorPath(R.WINDOW, R.FACE, start, end)} className="wheel-hatch" fill={`url(#${uid}-hatch)`} />
            )}
            {slice.ringMark !== undefined && <path d={ringMarkPath(slice.ringMark)} className="wheel-ring-mark" />}
            <circle cx={fx(nx)} cy={fx(ny)} r={8.6} className="wheel-lock" />
            <circle cx={fx(nx)} cy={fx(ny)} r={8.4} className="wheel-latch" />
            <g key={`n${generation}`} className={fade}>
              <Numeral slice={slice} />
            </g>
            <g key={`c${generation}`} className={fade}>
              <Content slice={slice} />
            </g>
          </g>
        );
      })}
      <Engraving slices={geometry} />
    </svg>
  );
}

function Numeral({ slice }: { slice: FaceSlice }) {
  const [x, y] = polar(R.NUMERAL, slice.geometry.mid);
  return (
    <text x={fx(x)} y={fx(y + 0.4)} className="wheel-numeral">
      {slice.numeral}
    </text>
  );
}

/** The ring a level change leaves, over the new one while it goes: its numerals and labels. Going in,
 *  it fades at once, but for the slice that opened the new ring, which flies to the hub instead.
 *  Going back, it folds into the slice at `origin`, the farthest slices first. */
export function Ghost({ slices, entrance, origin }: { slices: FaceSlice[]; entrance: Entrance; origin: number }) {
  return (
    <svg className={`wheel-layer wheel-ghost is-${entrance}`} viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true">
      {slices.map((slice, i) => {
        if (entrance === 'in' && i === origin) return null;
        const classes = ['wheel-slice'];
        if (slice.disabled) classes.push('is-off');
        if (slice.dimmed) classes.push('is-dimmed');
        const fold = entrance === 'out' ? 1 - spread(i, origin, slices.length) : 0;
        return (
          <g key={slice.key} className={classes.join(' ')} style={{ '--fold': fx(fold) } as CSSProperties}>
            <g className="wheel-ghost-part">
              <Numeral slice={slice} />
            </g>
            <g className="wheel-ghost-part">
              <Content slice={slice} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** The icon and label of the slice that opened a ring, flying from it into the hub's title as the
 *  ring opens, or back out of the hub into it as the ring closes. The whole layer moves, so the
 *  flight is a transform the compositor runs alone. */
export function Flyer({
  slice,
  hub,
  size,
  entrance,
}: {
  slice: FaceSlice;
  /** The middle of the hub's title. */
  hub: [number, number];
  /** The hub title's font size: the label shrinks to it. */
  size: number;
  entrance: Entrance;
}) {
  // The icon and the label fly; the sub-label stays behind.
  const block = { ...slice.block, sub: null };
  const lines = block.label.lines;
  const y = lines.reduce((sum, line) => sum + line.y, 0) / Math.max(1, lines.length);
  const share = (n: number) => `${fx((n * 100) / VIEW)}%`;
  const style = {
    transformOrigin: `${share(block.x)} ${share(y)}`,
    '--fly-x': share(hub[0] - block.x),
    '--fly-y': share(hub[1] - y),
    '--fly-s': fx(Math.min(1, Math.max(0.4, size / block.label.size))),
  } as CSSProperties;
  return (
    <svg
      className={`wheel-layer wheel-flyer is-${entrance}`}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      aria-hidden="true"
      style={style}
    >
      <Content slice={{ ...slice, block }} />
    </svg>
  );
}
