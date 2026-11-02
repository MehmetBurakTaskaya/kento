// SPDX-License-Identifier: MIT
// The picture on the stage: fitting it, zooming around a point, the size of the preview to ask
// for, and pointer positions in source pixels of the upright picture, which every request uses.
import type { Area } from '../../ipc';
import { clampArea, moveArea, type Point, type Size } from '../crop';
import { clamp } from '../time';

/** The zoom steps, as multiples of the fitted size. */
export const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16];

/** Never more than this many screen pixels per source pixel. */
export const MAX_SCALE = 8;

/** The scale at which the whole picture fits the box; 1 shows the source pixels as they are. */
export function fitScale(source: Size, box: Size): number {
  if (source.width <= 0 || source.height <= 0 || box.width <= 0 || box.height <= 0) return 1;
  return Math.min(box.width / source.width, box.height / source.height);
}

/** The highest zoom that keeps within `MAX_SCALE`, never below the fitted size. */
export const maxZoom = (fit: number) => Math.max(1, MAX_SCALE / fit);

/** The next zoom step in or out, within 1 (fitted) and `limit`. */
export function stepZoom(zoom: number, direction: 1 | -1, limit: number): number {
  if (direction > 0) return Math.min(ZOOMS.find((step) => step > zoom + 1e-6) ?? limit, limit);
  const lower = [...ZOOMS].reverse().find((step) => step < zoom - 1e-6) ?? 1;
  return Math.min(lower, limit);
}

/** The picture's size on screen and its offset when it is smaller than the box (it is centred). */
export function canvasLayout(source: Size, box: Size, scale: number) {
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  return {
    width,
    height,
    left: Math.max(0, (box.width - width) / 2),
    top: Math.max(0, (box.height - height) / 2),
  };
}

export type Layout = ReturnType<typeof canvasLayout>;

/**
 * The scroll position after a zoom that keeps the picture point under `anchor` (a point in the box,
 * such as the pointer) where it was.
 */
export function zoomScroll(anchor: Point, scroll: Point, before: Layout, after: Layout, box: Size): Point {
  const fx = clamp((scroll.x + anchor.x - before.left) / before.width, 0, 1);
  const fy = clamp((scroll.y + anchor.y - before.top) / before.height, 0, 1);
  return {
    x: clamp(fx * after.width + after.left - anchor.x, 0, Math.max(0, after.width - box.width)),
    y: clamp(fy * after.height + after.top - anchor.y, 0, Math.max(0, after.height - box.height)),
  };
}

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A point on screen (clientX, clientY) in source pixels, from the picture's box on screen. The box
 * already moves with scrolling and zooming, so this holds at any view.
 */
export function toSource(client: Point, rect: ScreenRect, source: Size): Point {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: ((client.x - rect.left) / rect.width) * source.width,
    y: ((client.y - rect.top) / rect.height) * source.height,
  };
}

/** A point in source pixels on screen; the inverse of `toSource`. */
export function toScreen(point: Point, rect: ScreenRect, source: Size): Point {
  if (source.width <= 0 || source.height <= 0) return { x: rect.left, y: rect.top };
  return {
    x: rect.left + (point.x / source.width) * rect.width,
    y: rect.top + (point.y / source.height) * rect.height,
  };
}

/**
 * The preview's longer side: enough for the fitted picture on a sharp screen, more when zoomed, up
 * to the engine's limit (it answers between 64 and 2048 px).
 */
export const PREVIEW_SIDE = 1600;
export const PREVIEW_MIN = 64;
export const PREVIEW_MAX = 2048;

export function previewSize(source: Size | null, zoom = 1): number {
  // Steps of 400 px, so small zoom changes reuse the picture already loaded.
  const want = Math.min(PREVIEW_MAX, Math.ceil((PREVIEW_SIDE * zoom) / 400) * 400);
  const side = source ? Math.max(source.width, source.height) : 0;
  return side > 0 ? Math.max(PREVIEW_MIN, Math.min(want, side)) : want;
}

/** An area in whole pixels inside the picture, at least one pixel on each side. */
export function pixelArea(area: Area, frame: Size): Area {
  // Edges are rounded, not the size, so the right and bottom edges stay where they were drawn.
  const x = clamp(Math.round(area.x), 0, Math.max(0, frame.width - 1));
  const y = clamp(Math.round(area.y), 0, Math.max(0, frame.height - 1));
  const right = clamp(Math.round(area.x + area.width), x + 1, Math.max(x + 1, frame.width));
  const bottom = clamp(Math.round(area.y + area.height), y + 1, Math.max(y + 1, frame.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** The arrow keys' step: 1 % of the picture, or one pixel with Shift, as on the video frame. */
export function nudge(area: Area, dx: number, dy: number, fine: boolean, frame: Size): Area {
  const sx = fine ? 1 : Math.max(1, Math.round(frame.width / 100));
  const sy = fine ? 1 : Math.max(1, Math.round(frame.height / 100));
  return moveArea(area, dx * sx, dy * sy, frame);
}

/** A typed side; with a fixed ratio the other side follows, both within the picture. */
export function withSide(area: Area, side: 'width' | 'height', value: number, ratio: number | null, frame: Size): Area {
  if (!ratio) return clampArea({ ...area, [side]: value }, frame);
  let width = side === 'width' ? value : value * ratio;
  width = Math.min(width, frame.width, frame.height * ratio);
  return clampArea({ ...area, width, height: width / ratio }, frame);
}
