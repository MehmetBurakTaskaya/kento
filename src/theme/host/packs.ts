// SPDX-License-Identifier: MIT
// Loads theme packs on demand. A pack is src/theme/packs/<pack>/: theme.js (its wheels), theme.css (their
// styles, used inside each wheel's shadow root) and fonts.ts (its faces). Each window loads the active
// theme's pack when it starts, before its first paint, so a wheel opens as fast in every theme; another
// pack loads only when it is chosen or shown in Settings.
import type { WheelTimings } from '../../wheel/motion';
import { definePack, type Register } from './board';
import type { ThemeConcept } from './contract';
import { facesReady } from './fonts';
import { themeTimings } from './model';

const MODULES = import.meta.glob<{ default: Register }>('../packs/*/theme.js');
const STYLES = import.meta.glob<string>('../packs/*/theme.css', { query: '?inline', import: 'default' });
const FACES = import.meta.glob('../packs/*/fonts.ts');

export interface PackTheme {
  id: string;
  concept: ThemeConcept;
  /** The pack's styles. */
  css: string;
  timings: WheelTimings;
}

const where = (pack: string, file: string) => `../packs/${pack}/${file}`;

/** The packs in the repository, by folder. */
export function packNames(): string[] {
  return Object.keys(MODULES).map((key) => key.split('/')[2]!);
}

const loads = new Map<string, Promise<Map<string, PackTheme>>>();
const ready = new Map<string, PackTheme>();

/** Loads a pack's code, styles and faces, and returns its themes by id. */
export function loadPack(pack: string): Promise<Map<string, PackTheme>> {
  let load = loads.get(pack);
  if (!load) {
    const module = MODULES[where(pack, 'theme.js')];
    if (!module) return Promise.reject(new Error(`no theme pack named ${pack}`));
    load = Promise.all([module(), STYLES[where(pack, 'theme.css')]?.() ?? '', FACES[where(pack, 'fonts.ts')]?.()]).then(
      ([code, css]) => {
        const themes = new Map<string, PackTheme>();
        for (const concept of definePack(code.default)) {
          themes.set(concept.id, { id: concept.id, concept, css, timings: themeTimings(concept.motion) });
        }
        return themes;
      },
    );
    // A pack that failed may load on a later try.
    load.catch(() => loads.delete(pack));
    loads.set(pack, load);
  }
  return load;
}

/** Loads one theme of a pack and waits for its faces, so its labels measure right at once. */
export async function loadPackTheme(pack: string, id: string): Promise<PackTheme> {
  const known = ready.get(id);
  if (known) return known;
  const theme = (await loadPack(pack)).get(id);
  if (!theme) throw new Error(`theme pack ${pack} defines no theme ${id}`);
  await facesReady(theme.concept.fonts.load ?? []);
  ready.set(id, theme);
  return theme;
}

/** A theme whose pack and faces have loaded, or null. */
export function loadedPackTheme(id: string): PackTheme | null {
  return ready.get(id) ?? null;
}
