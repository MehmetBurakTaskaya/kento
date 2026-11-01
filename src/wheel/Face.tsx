// SPDX-License-Identifier: MIT
// The enamel face: the chapter ring with the slice numerals and the slice windows with their labels.
// The face never moves (design/DESIGN.md, "precise pointing"); only the slices' states change. It is
// also the menu for assistive technology: each slice is a menu item with its own label.
import { useMemo, type CSSProperties, type Ref } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { arcPath, C, fx, polar, R, rayPath, sectorPath, VIEW, type SliceGeometry } from './geometry';
import type { LabelBlock } from './labels';

export interface FaceSlice {
  key: string;
  geometry: SliceGeometry;
  numeral: string;
  icon?: IconName;
  /** Directional icons mirror in right-to-left layouts. */
  flipIcon: boolean;
  disabled: boolean;
  dimmed?: boolean;
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

export function Face({ uid, slices, hover, selected, generation, label, describedBy, menuRef, itemRef }: FaceProps) {
  const geometry = useMemo(() => slices.map((slice) => slice.geometry), [slices]);
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
        return (
          <g
            key={slice.key}
            ref={(element) => itemRef(i, element)}
            className={classes.join(' ')}
            role="menuitem"
            tabIndex={-1}
            aria-label={slice.name}
            aria-describedby={slice.describedBy}
            aria-disabled={slice.disabled || undefined}
            aria-posinset={i + 1}
            aria-setsize={slices.length}
            style={{ '--i': i } as CSSProperties}
          >
            <path d={sectorPath(R.CHAPTER, R.FACE, start, end)} className="wheel-cell" />
            <path d={sectorPath(R.WINDOW, R.CHAPTER, start, end)} className="wheel-window" />
            <path
              d={sectorPath(R.WINDOW - 3, R.CHAPTER, start, end)}
              className="wheel-inlay"
              fill={`url(#${uid}-blue)`}
            />
            <path d={arcPath(R.CHAPTER - 1.7, start + 0.9, end - 0.9)} className="wheel-keyline" />
            {slice.disabled && (
              <path d={sectorPath(R.WINDOW, R.FACE, start, end)} className="wheel-hatch" fill={`url(#${uid}-hatch)`} />
            )}
            <circle cx={fx(nx)} cy={fx(ny)} r={8.6} className="wheel-lock" />
            <circle cx={fx(nx)} cy={fx(ny)} r={8.4} className="wheel-latch" />
            <g key={`n${generation}`} className="wheel-fade">
              <text x={fx(nx)} y={fx(ny + 0.4)} className="wheel-numeral">
                {slice.numeral}
              </text>
            </g>
            <g key={`c${generation}`} className="wheel-fade">
              <Content slice={slice} />
            </g>
          </g>
        );
      })}
      <Engraving slices={geometry} />
    </svg>
  );
}
