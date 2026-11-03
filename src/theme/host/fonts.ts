// SPDX-License-Identifier: MIT
// A theme's typefaces. Each pack's fonts.ts registers its faces from the Fontsource files (Latin, Latin
// Extended and Cyrillic only) under the family names the theme uses, when the pack loads; a face's file
// downloads only once text in its range is drawn. Labels are measured as they are drawn, so a theme's
// wheel waits for its faces first. Chinese, Japanese, Korean and Arabic use the system's faces.

export interface FaceSource {
  url: string;
  /** The unicode-range of the file's subset. */
  range: string;
}

export interface FaceSpec {
  family: string;
  /** One weight, or a range for a variable face ("100 900"). */
  weight: string;
  style?: 'normal' | 'italic';
  /** The width range of a face with a width axis ("75% 125%"). */
  stretch?: string;
  sources: FaceSource[];
}

const registered = new Set<string>();

export function registerFaces(specs: FaceSpec[]): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
  for (const spec of specs) {
    for (const source of spec.sources) {
      // The weight is part of the key: one variable file may stand in for several static weights.
      const key = `${spec.family}\u0001${spec.weight}\u0001${spec.style ?? 'normal'}\u0001${source.url}`;
      if (registered.has(key)) continue;
      registered.add(key);
      const face = new FontFace(spec.family, `url(${source.url}) format('woff2')`, {
        weight: spec.weight,
        style: spec.style ?? 'normal',
        stretch: spec.stretch ?? 'normal',
        unicodeRange: source.range,
        display: 'swap',
      });
      document.fonts.add(face);
    }
  }
}

/** Text that touches the Latin, Latin Extended and Cyrillic files of a face. */
const SAMPLE = 'AaĞşıЖ';
const STYLES = ['400', '600', '700', 'italic 400'];

/** Resolves once the families have loaded (or failed, or a second has passed: a face that never comes
 *  must not keep the wheel away). */
export function facesReady(families: readonly string[], timeout = 1000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts || !families.length) return Promise.resolve();
  const loads = families.flatMap((family) =>
    STYLES.map((style) => document.fonts.load(`${style} 16px ${family}`, SAMPLE).catch(() => null)),
  );
  const done = Promise.all(loads).then(() => undefined);
  const late = new Promise<void>((resolve) => window.setTimeout(resolve, timeout));
  return Promise.race([done, late]);
}
