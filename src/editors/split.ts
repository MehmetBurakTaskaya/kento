// SPDX-License-Identifier: MIT
// The parts of Split video (SPEC 5.5): at markers, into equal parts or every n seconds. Each part
// is kept unless the user drops it; a dropped part is remembered by its start, so adding a marker
// elsewhere does not move the choice to another part.
import type { MediaTool, Span } from '../ipc';

export type SplitAt = Extract<MediaTool, { tool: 'split-video' }>['at'];

/** More parts than this make an unusable list and folder. */
export const MAX_PARTS = 200;

/** How many parts a choice makes, without building them. */
export function countParts(at: SplitAt, duration: number): number {
  if (duration <= 0) return 0;
  switch (at.kind) {
    case 'markers':
      return insideMarkers(at.at, duration).length + 1;
    case 'parts':
      return Math.max(1, Math.floor(at.count));
    case 'every':
      return at.seconds > 0 ? Math.max(1, Math.ceil(duration / at.seconds - 1e-9)) : 1;
  }
}

function insideMarkers(markers: number[], duration: number): number[] {
  return [...new Set(markers)].filter((at) => at > 0 && at < duration).sort((a, b) => a - b);
}

/** The parts of the file, in order; call it only when `countParts` is within `MAX_PARTS`. */
export function splitParts(at: SplitAt, duration: number): Span[] {
  if (duration <= 0) return [];
  let bounds: number[];
  switch (at.kind) {
    case 'markers':
      bounds = insideMarkers(at.at, duration);
      break;
    case 'parts': {
      const count = countParts(at, duration);
      bounds = Array.from({ length: count - 1 }, (_, i) => ((i + 1) * duration) / count);
      break;
    }
    case 'every': {
      const count = countParts(at, duration);
      bounds = Array.from({ length: count - 1 }, (_, i) => (i + 1) * at.seconds).filter((b) => b < duration);
      break;
    }
  }
  const edges = [0, ...bounds, duration];
  return edges.slice(1).map((end, i) => ({ start: edges[i]!, end }));
}

/** The key a part is remembered by: its start in milliseconds. */
export const partKey = (part: Span) => Math.round(part.start * 1000);

/** One flag per part: true keeps it. */
export const keepFlags = (parts: Span[], dropped: ReadonlySet<number>) =>
  parts.map((part) => !dropped.has(partKey(part)));
