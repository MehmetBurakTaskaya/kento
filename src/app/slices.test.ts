// SPDX-License-Identifier: MIT
import i18next, { type TFunction } from 'i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, type FileEntry, type RecipeEntry, type ToolEntry } from '../ipc';
import { FAVORITES, favoritesSlice, NEEDS_SETUP, recipeOf, recipeSlices, slicesFor } from './slices';

const t: TFunction = i18next.t.bind(i18next);
const has = (key: string) => i18next.exists(key);

const INSTAGRAM: RecipeEntry = {
  id: 'ready-for-instagram',
  name: 'Instagram için hazır',
  steps: [
    { kind: 'crop', width: 4, height: 5 },
    { kind: 'resize', longSide: 1080 },
    { kind: 'compress', compression: { mode: 'size', bytes: 2_000_000 } },
  ],
  needs: null,
};
const TO_MP3: RecipeEntry = {
  id: 'r2',
  name: 'Sesi al 🎧',
  steps: [{ kind: 'convert', to: 'mp3' }],
  needs: 'media',
};
const COMPRESS: ToolEntry = { id: 'compress', icon: 'compress', group: 'core', enhancement: false, needs: null };
const PHOTO: FileEntry = {
  path: 'C:\\Users\\ayşe\\Pictures\\Kapadokya 🎈.jpg',
  name: 'Kapadokya 🎈.jpg',
  folder: false,
  format: 'jpg',
  category: 'image',
  size: 3_000_000,
};

beforeAll(async () => {
  await initI18n('en');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Favorites slice', () => {
  it('opens the recipes that fit and says how many', () => {
    const slice = favoritesSlice([INSTAGRAM, TO_MP3], t);
    expect(slice).toMatchObject({
      id: FAVORITES,
      label: 'Favorites',
      sublabel: '2 recipes',
      icon: 'star',
      opens: true,
    });
    expect(slice.hint).toBe('2 recipes fit these files');
  });

  it('names each recipe, says its steps and dims one that needs a tool group', () => {
    const [ready, audio] = recipeSlices([INSTAGRAM, TO_MP3], t, 'en');
    expect(ready).toMatchObject({ label: 'Instagram için hazır', dimmed: false });
    expect(ready!.hint).toBe('Crop 4:5 · Resize to 1080 px · Compress under 2 MB');
    expect(recipeOf(ready!.id)).toBe('ready-for-instagram');
    expect(audio!.dimmed).toBe(true);
    expect(audio!.id.startsWith(NEEDS_SETUP)).toBe(true);
    expect(audio!.hint).toBe('Needs the Media tools: install them first');
    expect(recipeOf('compress')).toBeNull();
  });
});

describe('the Tools wheel', () => {
  it('puts Favorites first and opens the recipes in place, with Back', async () => {
    vi.spyOn(api, 'tools').mockResolvedValue([COMPRESS]);
    const recipesFor = vi.spyOn(api, 'recipesFor').mockResolvedValue([INSTAGRAM]);
    const ring = await slicesFor('tools', [PHOTO]);
    expect(recipesFor).toHaveBeenCalledWith([PHOTO.path]);
    const view = ring!.view(t, has, false, 'en');
    expect(view.slices.map((slice) => slice.id)).toEqual([FAVORITES, 'compress']);
    const favorites = view.apply(FAVORITES)!.view(t, has, false, 'en');
    expect(favorites.key).toBe('favorites');
    expect(favorites.slices.map((slice) => slice.label)).toEqual(['Instagram için hazır']);
    expect(favorites.paths).toEqual([PHOTO.path]);
    expect(favorites.apply(favorites.slices[0]!.id)).toBeNull();
    expect(favorites.back!().view(t, has, false, 'en').key).toBe('tools');
  });

  it('leaves Favorites out when no recipe fits, and opens on the recipes when only they fit', async () => {
    vi.spyOn(api, 'tools').mockResolvedValue([COMPRESS]);
    vi.spyOn(api, 'recipesFor').mockResolvedValue([]);
    const plain = (await slicesFor('tools', [PHOTO]))!.view(t, has, false, 'en');
    expect(plain.slices.map((slice) => slice.id)).toEqual(['compress']);

    vi.spyOn(api, 'tools').mockResolvedValue([]);
    vi.spyOn(api, 'recipesFor').mockResolvedValue([INSTAGRAM]);
    const only = (await slicesFor('tools', [PHOTO]))!.view(t, has, false, 'en');
    expect(only.key).toBe('favorites');
    expect(only.back).toBeUndefined();

    vi.spyOn(api, 'recipesFor').mockResolvedValue([]);
    expect(await slicesFor('tools', [PHOTO])).toBeNull();
  });

  it('still offers the tools when the recipes cannot be read', async () => {
    vi.spyOn(api, 'tools').mockResolvedValue([COMPRESS]);
    vi.spyOn(api, 'recipesFor').mockRejectedValue(new Error('no recipes file'));
    const ring = (await slicesFor('tools', [PHOTO]))!.view(t, has, false, 'en');
    expect(ring.slices.map((slice) => slice.id)).toEqual(['compress']);
  });
});
