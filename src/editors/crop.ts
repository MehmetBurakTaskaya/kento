// SPDX-License-Identifier: MIT
// Rectangles on a video frame, in the pixels of the displayed video (MediaInfo.video): drawing,
// moving and resizing them inside the frame, with an optional fixed ratio (width / height).
import type { Area } from '../ipc';
import { clamp } from './time';

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A resize grip: an edge or a corner, by compass direction. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The crop presets of SPEC 5.5; null is free. */
export const RATIOS: { id: string; ratio: number | null }[] = [
  { id: 'free', ratio: null },
  { id: '1:1', ratio: 1 },
  { id: '4:5', ratio: 4 / 5 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
  { id: '3:2', ratio: 3 / 2 },
];

/** The smallest side a drawn rectangle keeps, in video pixels. */
export const MIN_SIDE = 8;

export const fullArea = (frame: Size): Area => ({ x: 0, y: 0, width: frame.width, height: frame.height });

export const center = (area: Area): Point => ({ x: area.x + area.width / 2, y: area.y + area.height / 2 });

export const clampPoint = (point: Point, frame: Size): Point => ({
  x: clamp(point.x, 0, frame.width),
  y: clamp(point.y, 0, frame.height),
});

/** An area moved and shrunk until it lies inside the frame, at least `MIN_SIDE` on each side. */
export function clampArea(area: Area, frame: Size): Area {
  const width = clamp(area.width, Math.min(MIN_SIDE, frame.width), frame.width);
  const height = clamp(area.height, Math.min(MIN_SIDE, frame.height), frame.height);
  return {
    x: clamp(area.x, 0, frame.width - width),
    y: clamp(area.y, 0, frame.height - height),
    width,
    height,
  };
}

/** The largest area of a ratio inside the frame, centred on a point as far as the frame allows. */
export function fitRatio(frame: Size, ratio: number, at: Point = { x: frame.width / 2, y: frame.height / 2 }): Area {
  const width = Math.min(frame.width, frame.height * ratio);
  const height = width / ratio;
  return {
    x: clamp(at.x - width / 2, 0, frame.width - width),
    y: clamp(at.y - height / 2, 0, frame.height - height),
    width,
    height,
  };
}

/**
 * The area between a fixed corner and the pointer, inside the frame. With a ratio the larger of the
 * two directions leads and the other follows, then both shrink to what fits on that side.
 */
export function drawArea(anchor: Point, point: Point, frame: Size, ratio: number | null, min = 0): Area {
  const a = clampPoint(anchor, frame);
  const right = point.x >= a.x;
  const down = point.y >= a.y;
  const roomX = right ? frame.width - a.x : a.x;
  const roomY = down ? frame.height - a.y : a.y;
  let width = Math.min(Math.max(Math.abs(point.x - a.x), min), roomX);
  let height = Math.min(Math.max(Math.abs(point.y - a.y), min), roomY);
  if (ratio) {
    width = Math.min(Math.max(width, height * ratio), roomX, roomY * ratio);
    height = width / ratio;
  }
  return { x: right ? a.x : a.x - width, y: down ? a.y : a.y - height, width, height };
}

/** One side of an area dragged to the pointer, the opposite side fixed; it may flip past it. */
function resizeSide(start: Area, handle: 'n' | 's' | 'e' | 'w', point: Point, frame: Size, ratio: number | null): Area {
  const horizontal = handle === 'e' || handle === 'w';
  // Measured along the dragged axis ("main") and across it ("cross").
  const mainSize = horizontal ? frame.width : frame.height;
  const crossSize = horizontal ? frame.height : frame.width;
  const anchor = horizontal
    ? handle === 'e'
      ? start.x
      : start.x + start.width
    : handle === 's'
      ? start.y
      : start.y + start.height;
  const reach = clamp(horizontal ? point.x : point.y, 0, mainSize);
  const forward = reach >= anchor;
  const room = forward ? mainSize - anchor : anchor;
  let main = Math.min(Math.max(Math.abs(reach - anchor), MIN_SIDE), room);
  let cross = horizontal ? start.height : start.width;
  let crossStart = horizontal ? start.y : start.x;
  if (ratio) {
    // The other side follows the ratio, centred where it was.
    const k = horizontal ? 1 / ratio : ratio;
    const mid = crossStart + cross / 2;
    const crossRoom = 2 * Math.min(mid, crossSize - mid);
    cross = main * k;
    if (cross > crossRoom) {
      cross = crossRoom;
      main = cross / k;
    }
    crossStart = mid - cross / 2;
  }
  const mainStart = forward ? anchor : anchor - main;
  return horizontal
    ? { x: mainStart, y: crossStart, width: main, height: cross }
    : { x: crossStart, y: mainStart, width: cross, height: main };
}

/** An area resized by one of its grips; corners draw from the opposite corner. */
export function resizeArea(start: Area, handle: Handle, point: Point, frame: Size, ratio: number | null): Area {
  if (handle.length === 1) return resizeSide(start, handle as 'n' | 's' | 'e' | 'w', point, frame, ratio);
  const anchor = {
    x: handle.includes('w') ? start.x + start.width : start.x,
    y: handle.includes('n') ? start.y + start.height : start.y,
  };
  return drawArea(anchor, point, frame, ratio, MIN_SIDE);
}

/** An area moved by an offset, stopping at the edges of the frame. */
export const moveArea = (start: Area, dx: number, dy: number, frame: Size): Area => ({
  ...start,
  x: clamp(start.x + dx, 0, frame.width - start.width),
  y: clamp(start.y + dy, 0, frame.height - start.height),
});

/** Whole pixels, with an even width and height as H.264 and most encoders require. */
export function roundArea(area: Area, frame: Size): Area {
  const even = (value: number, limit: number) => Math.max(2, Math.floor(Math.min(value, limit) / 2) * 2);
  const width = even(Math.round(area.width), frame.width);
  const height = even(Math.round(area.height), frame.height);
  return {
    x: clamp(Math.round(area.x), 0, Math.max(0, frame.width - width)),
    y: clamp(Math.round(area.y), 0, Math.max(0, frame.height - height)),
    width,
    height,
  };
}

/** Whether two areas match to the pixel. */
export const sameArea = (a: Area, b: Area, tolerance = 1) =>
  Math.abs(a.x - b.x) < tolerance &&
  Math.abs(a.y - b.y) < tolerance &&
  Math.abs(a.width - b.width) < tolerance &&
  Math.abs(a.height - b.height) < tolerance;
