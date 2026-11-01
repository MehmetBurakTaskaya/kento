// SPDX-License-Identifier: MIT
// A ring holds at most eight slices (design/DESIGN.md, section 5). With more, each page shows seven
// and an eighth "More…" slice turns to the next page; on the last page it goes back to the first.
import { MAX_SLICES } from './geometry';

export const PAGE_SIZE = MAX_SLICES - 1;

export type PageItem<T> =
  | { type: 'slice'; slice: T }
  /** The paging slice: `target` is the page it opens, `remaining` the slices after this page. */
  | { type: 'more'; target: number; remaining: number; wraps: boolean };

export function pageCount(total: number): number {
  return total <= MAX_SLICES ? 1 : Math.ceil(total / PAGE_SIZE);
}

/** The page as a number the slices allow, so a shorter list never leaves the wheel on an empty page. */
export function clampPage(page: number, total: number): number {
  return Math.min(Math.max(0, Math.trunc(page)), pageCount(total) - 1);
}

export function pageItems<T>(slices: readonly T[], page: number): PageItem<T>[] {
  const pages = pageCount(slices.length);
  if (pages === 1) return slices.map((slice) => ({ type: 'slice', slice }));
  const p = clampPage(page, slices.length);
  const start = p * PAGE_SIZE;
  const items: PageItem<T>[] = slices.slice(start, start + PAGE_SIZE).map((slice) => ({ type: 'slice', slice }));
  const last = p === pages - 1;
  items.push({
    type: 'more',
    target: last ? 0 : p + 1,
    remaining: last ? 0 : slices.length - start - PAGE_SIZE,
    wraps: last,
  });
  return items;
}
