// SPDX-License-Identifier: MIT
// One mark of Mark up as SVG, by the rules in marks.ts, which the engine follows too. With `hit`,
// a wider invisible outline is added so thin strokes are easy to pick with the pointer.
import type { Mark } from '../../ipc';
import {
  alpha,
  arrowHead,
  FONT_FAMILY,
  FONT_WEIGHT,
  isDrawn,
  markBounds,
  normalArea,
  rgbCss,
  textLines,
  type Measure,
} from './marks';

const points = (list: [number, number][]) => list.map((p) => `${p[0]},${p[1]}`).join(' ');

export function MarkShape({
  mark,
  id,
  hit,
  measure,
}: {
  mark: Mark;
  id?: number;
  /** The width of the invisible outline that picks the mark, in source pixels; 0 for none. */
  hit: number;
  measure: Measure;
}) {
  const color = rgbCss(mark.color);
  const stroke = { stroke: color, fill: 'none', pointerEvents: 'none' as const };
  let shape;
  let target = null;
  switch (mark.kind) {
    case 'pen':
    case 'highlighter':
      shape = (
        <polyline
          points={points(mark.points)}
          {...stroke}
          strokeWidth={mark.width}
          strokeLinecap={mark.kind === 'pen' ? 'round' : 'butt'}
          strokeLinejoin="round"
        />
      );
      if (hit) {
        target = (
          <polyline
            className="mark-hit"
            points={points(mark.points)}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(mark.width, hit)}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="stroke"
          />
        );
      }
      break;
    case 'rectangle':
      shape = (
        <rect
          {...normalArea(mark.area)}
          {...stroke}
          fill={mark.filled ? color : 'none'}
          strokeWidth={mark.width}
          strokeLinejoin="miter"
        />
      );
      break;
    case 'ellipse': {
      const { x, y, width, height } = normalArea(mark.area);
      shape = (
        <ellipse
          cx={x + width / 2}
          cy={y + height / 2}
          rx={width / 2}
          ry={height / 2}
          {...stroke}
          fill={mark.filled ? color : 'none'}
          strokeWidth={mark.width}
        />
      );
      break;
    }
    case 'line':
    case 'arrow': {
      const head = mark.kind === 'arrow' ? arrowHead(mark.from, mark.to, mark.width) : null;
      const end = head ? head.base : mark.to;
      shape = (
        <>
          <line
            x1={mark.from[0]}
            y1={mark.from[1]}
            x2={end[0]}
            y2={end[1]}
            {...stroke}
            strokeWidth={mark.width}
            strokeLinecap="round"
          />
          {head && (
            <polygon points={points([head.tip, ...head.corners])} fill={color} stroke="none" pointerEvents="none" />
          )}
        </>
      );
      if (hit) {
        target = (
          <line
            className="mark-hit"
            x1={mark.from[0]}
            y1={mark.from[1]}
            x2={mark.to[0]}
            y2={mark.to[1]}
            stroke="transparent"
            strokeWidth={Math.max(mark.width, hit)}
            strokeLinecap="round"
            pointerEvents="stroke"
          />
        );
      }
      break;
    }
    case 'text':
      shape = (
        <text
          fontFamily={FONT_FAMILY}
          fontWeight={FONT_WEIGHT}
          fontSize={mark.size}
          fill={color}
          textAnchor="start"
          pointerEvents="none"
          xmlSpace="preserve"
          style={{ whiteSpace: 'pre' }}
        >
          {textLines(mark).map((line, i) => (
            <tspan key={i} x={line.x} y={line.y}>
              {line.text}
            </tspan>
          ))}
        </text>
      );
      break;
  }
  // Areas and text are picked anywhere inside their box.
  if (hit && !target) {
    const box = markBounds(mark, measure);
    target = <rect className="mark-hit" {...box} fill="transparent" stroke="none" pointerEvents="all" />;
  }
  return (
    <g data-mark={id} opacity={alpha(mark.color)}>
      {isDrawn(mark) && shape}
      {target}
    </g>
  );
}
