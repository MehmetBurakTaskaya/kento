// SPDX-License-Identifier: MIT
// The wheel's menu for assistive technology when a theme draws the wheel: the same menu items, labels,
// descriptions and focus as the steel face, on invisible slices over the theme's drawing. The theme's
// own drawing is decoration only.
import type { CSSProperties, Ref } from 'react';
import type { FaceSlice } from './Face';
import { R, sectorPath, VIEW } from './geometry';

interface MenuProps {
  slices: FaceSlice[];
  label: string;
  describedBy: string;
  menuRef: Ref<SVGSVGElement>;
  itemRef: (index: number, element: SVGGElement | null) => void;
}

export function Menu({ slices, label, describedBy, menuRef, itemRef }: MenuProps) {
  return (
    <svg
      ref={menuRef}
      className="wheel-layer wheel-menu"
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="menu"
      aria-label={label}
      aria-describedby={describedBy}
      tabIndex={-1}
    >
      {slices.map((slice, i) => {
        const { start, end } = slice.geometry;
        return (
          <g
            key={slice.key}
            ref={(element) => itemRef(i, element)}
            className="wheel-slice"
            role="menuitem"
            tabIndex={-1}
            aria-label={slice.name}
            aria-describedby={slice.describedBy}
            aria-haspopup={slice.ringMark === undefined ? undefined : 'menu'}
            aria-disabled={slice.disabled || undefined}
            aria-posinset={i + 1}
            aria-setsize={slices.length}
            style={{ '--i': i } as CSSProperties}
          >
            <path d={sectorPath(R.WINDOW, R.OUT, start, end)} />
          </g>
        );
      })}
    </svg>
  );
}
