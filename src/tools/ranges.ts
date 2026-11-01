// SPDX-License-Identifier: MIT
// Page ranges as people type them: "1-3, 5, 8–10". Pages are 1-based; anything outside
// 1..pages or out of order makes the whole text invalid.

export function parseRanges(text: string, pages: number): [number, number][] | null {
  const parts = text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const ranges: [number, number][] = [];
  for (const part of parts) {
    const match = /^(\d+)\s*(?:[-–—]\s*(\d+))?$/.exec(part);
    if (!match) return null;
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    if (first < 1 || last < first || last > pages) return null;
    ranges.push([first, last]);
  }
  return ranges;
}
