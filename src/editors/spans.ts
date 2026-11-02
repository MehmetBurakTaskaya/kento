// SPDX-License-Identifier: MIT
// The selection (in/out), redaction spans and markers on a timeline, in seconds.
import type { Span } from '../ipc';
import { clamp, clampTime, roundTime } from './time';

/** The shortest selection; in and out never cross. */
export const MIN_SPAN = 0.1;

export const fullSpan = (duration: number): Span => ({ start: 0, end: Math.max(0, duration) });

export const spanLength = (span: Span) => Math.max(0, span.end - span.start);

/** Whether a span covers the whole file, give or take a few hundredths. */
export const isFull = (span: Span, duration: number, tolerance = 0.05) =>
  span.start <= tolerance && span.end >= duration - tolerance;

export const contains = (span: Span, at: number) => at >= span.start && at <= span.end;

export const roundSpan = (span: Span): Span => ({ start: roundTime(span.start), end: roundTime(span.end) });

/** I: the start jumps to the playhead; an end it would pass moves to the end of the file. */
export function setStart(span: Span, at: number, duration: number): Span {
  const start = clamp(at, 0, Math.max(0, duration - MIN_SPAN));
  return { start, end: span.end - start >= MIN_SPAN ? span.end : Math.max(0, duration) };
}

/** O: the end jumps to the playhead; a start it would pass moves to the start of the file. */
export function setEnd(span: Span, at: number, duration: number): Span {
  const end = clamp(at, Math.min(MIN_SPAN, duration), Math.max(0, duration));
  return { start: end - span.start >= MIN_SPAN ? span.start : 0, end };
}

/** Dragging the start handle: it stops short of the end. */
export const dragStart = (span: Span, at: number): Span => ({
  start: clamp(at, 0, Math.max(0, span.end - MIN_SPAN)),
  end: span.end,
});

/** Dragging the end handle: it stops short of the start. */
export const dragEnd = (span: Span, at: number, duration: number): Span => ({
  start: span.start,
  end: clamp(at, Math.min(span.start + MIN_SPAN, duration), Math.max(0, duration)),
});

/** Adds a span to a sorted list, merging the ones that overlap or touch. */
export function addSpan(spans: Span[], span: Span): Span[] {
  const all = [...spans, span]
    .map((s) => ({ start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const next of all) {
    const last = merged[merged.length - 1];
    if (last && next.start <= last.end) last.end = Math.max(last.end, next.end);
    else merged.push({ ...next });
  }
  return merged;
}

export const removeAt = <T>(items: T[], index: number): T[] => items.filter((_, i) => i !== index);

/**
 * Adds a time to a sorted list of points (split markers, frames). A point at the very start or end,
 * or within `gap` of one already there, adds nothing.
 */
export function addPoint(points: number[], at: number, duration: number, gap: number, ends = true): number[] {
  const time = roundTime(clampTime(at, duration));
  if (!ends && (time < gap || time > duration - gap)) return points;
  if (points.some((point) => Math.abs(point - time) < gap)) return points;
  return [...points, time].sort((a, b) => a - b);
}
