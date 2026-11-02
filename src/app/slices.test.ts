// SPDX-License-Identifier: MIT
import i18next, { type TFunction } from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, type Category, type FileEntry, type RecipeEntry, type TargetGroup, type ToolEntry } from '../ipc';
import {
  downloadRing,
  FAVORITES,
  favoritesSlice,
  NEEDS_SETUP,
  recipeOf,
  recipeSlices,
  slicesFor,
  type Plan,
  type Ring,
} from './slices';
import { PDF_LAYOUT } from './variants';

const t: TFunction = i18next.t.bind(i18next);
const has = (key: string) => i18next.exists(key);
const view = (ring: Ring | null) => ring!.view(t, has, false, 'en');

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
const tool = (id: string): ToolEntry => ({ id, icon: id, group: 'core', enhancement: false, needs: null });
const COMPRESS = tool('compress');

function file(name: string, category: Category): FileEntry {
  return {
    path: `C:\\Users\\ayşe\\Pictures\\${name}`,
    name,
    folder: false,
    format: name.split('.').pop()!,
    category,
    size: 3_000_000,
  };
}
const PHOTO = file('Kapadokya 🎈.jpg', 'image');
const PHOTO_2 = file('Göreme.heic', 'image');
const VIDEO = file('Balon turu.mp4', 'video');
const REPORT = file('Rapor 2026.pdf', 'pdf');

const group = (category: Category, count: number, ...targets: string[]): TargetGroup => ({
  category,
  count,
  targets: targets.map((to) => ({
    to,
    label: to.toUpperCase(),
    group: 'core',
    enhancement: false,
    note: null,
    needs: null,
  })),
});

/** Runs what a choice asks for, as a host does. */
async function carry(plan: Plan) {
  if (plan.kind === 'run') await plan.start();
  return plan;
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Favorites slice', () => {
  it('holds the recipes that fit and says how many', () => {
    const slice = favoritesSlice([INSTAGRAM, TO_MP3], t);
    expect(slice).toMatchObject({
      id: FAVORITES,
      label: 'Favorites',
      sublabel: '2 recipes',
      icon: 'star',
    });
    expect(slice.hint).toBe('2 recipes fit these files');
    expect(slice.variants?.map((recipe) => recipe.label)).toEqual(['Instagram için hazır', 'Sesi al 🎧']);
    // Resting on it opens the recipes; a drop on it runs none.
    expect(slice.default).toBeUndefined();
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
  it('puts Favorites first, with the recipes as its ring', async () => {
    vi.spyOn(api, 'tools').mockResolvedValue([COMPRESS]);
    const recipesFor = vi.spyOn(api, 'recipesFor').mockResolvedValue([INSTAGRAM]);
    const run = vi.spyOn(api, 'runRecipe').mockResolvedValue([4]);
    const tools = view(await slicesFor('tools', [PHOTO]));
    expect(recipesFor).toHaveBeenCalledWith([PHOTO.path]);
    expect(tools.title).toBe('Tools');
    expect(tools.slices.map((slice) => slice.id)).toEqual([FAVORITES, 'compress']);
    const recipe = tools.slices[0]!.variants![0]!;
    await carry(tools.choose(recipe.id, [FAVORITES]));
    expect(run).toHaveBeenCalledWith('ready-for-instagram', [PHOTO.path]);
  });

  it('leaves Favorites out when no recipe fits, and opens on the recipes when only they fit', async () => {
    vi.spyOn(api, 'tools').mockResolvedValue([COMPRESS]);
    vi.spyOn(api, 'recipesFor').mockResolvedValue([]);
    const plain = view(await slicesFor('tools', [PHOTO]));
    expect(plain.slices.map((slice) => slice.id)).toEqual(['compress']);

    vi.spyOn(api, 'tools').mockResolvedValue([]);
    vi.spyOn(api, 'recipesFor').mockResolvedValue([INSTAGRAM]);
    const only = view(await slicesFor('tools', [PHOTO]));
    expect(only.key).toBe('favorites');
    expect(only.title).toBe('Favorites');
    expect(only.slices.map((slice) => slice.label)).toEqual(['Instagram için hazır']);

    vi.spyOn(api, 'recipesFor').mockResolvedValue([]);
    expect(await slicesFor('tools', [PHOTO])).toBeNull();
  });

  it('still offers the tools when the recipes cannot be read', async () => {
    vi.spyOn(api, 'tools').mockResolvedValue([COMPRESS]);
    vi.spyOn(api, 'recipesFor').mockRejectedValue(new Error('no recipes file'));
    const ring = view(await slicesFor('tools', [PHOTO]));
    expect(ring.slices.map((slice) => slice.id)).toEqual(['compress']);
  });

  it('offers Compress presets, and its window as the default and as Other…', async () => {
    vi.spyOn(api, 'tools').mockResolvedValue([COMPRESS]);
    vi.spyOn(api, 'recipesFor').mockResolvedValue([]);
    const compress = vi.spyOn(api, 'runCompress').mockResolvedValue([1]);
    const ring = view(await slicesFor('tools', [PHOTO, VIDEO]));
    const slice = ring.slices[0]!;
    expect(slice.variants?.map((v) => v.label)).toEqual([
      'High quality',
      'Balanced',
      'Smallest',
      'Under 25 MB',
      'Other…',
    ]);
    expect(slice.default).toBe('other');
    expect(slice.hint).toBe('Rest here for more choices');
    expect(ring.choose('other', ['compress'])).toEqual({
      kind: 'panel',
      tool: 'compress',
      paths: [PHOTO.path, VIDEO.path],
    });
    await carry(ring.choose('under-25', ['compress']));
    expect(compress).toHaveBeenLastCalledWith({ mode: 'size', bytes: 25_000_000 }, [PHOTO.path, VIDEO.path]);
    await carry(ring.choose('smallest', ['compress']));
    expect(compress).toHaveBeenLastCalledWith({ mode: 'quality', level: 35 }, [PHOTO.path, VIDEO.path]);
    // A plain drop on Compress: its window, as before.
    expect(ring.choose('compress', [])).toEqual({ kind: 'panel', tool: 'compress', paths: [PHOTO.path, VIDEO.path] });
  });

  it('offers no choices on a tool whose group is missing', async () => {
    vi.spyOn(api, 'tools').mockResolvedValue([{ ...tool('speed'), needs: 'media' }]);
    vi.spyOn(api, 'recipesFor').mockResolvedValue([]);
    const ring = view(await slicesFor('tools', [VIDEO]));
    expect(ring.slices[0]!.variants).toBeUndefined();
    expect(ring.choose(ring.slices[0]!.id, [])).toEqual({ kind: 'setup' });
  });

  it('runs a speed, a metadata clean-up, and a QR report at once', async () => {
    vi.spyOn(api, 'tools').mockResolvedValue([tool('speed'), tool('metadata'), tool('read-qr')]);
    vi.spyOn(api, 'recipesFor').mockResolvedValue([]);
    const media = vi.spyOn(api, 'runMediaTool').mockResolvedValue([1]);
    const metadata = vi.spyOn(api, 'runMetadata').mockResolvedValue([2]);
    const ring = view(await slicesFor('tools', [VIDEO]));
    const [speed, meta, qr] = ring.slices;
    expect(speed!.variants?.map((v) => v.label)).toEqual(['0.5×', '1.5×', '2×', 'Other…']);
    expect(meta!.variants?.map((v) => v.label)).toEqual(['Remove location', 'Remove all', 'Edit…']);
    expect(meta!.default).toBe('edit');
    expect(qr!.variants?.map((v) => v.label)).toEqual(['TXT', 'CSV', 'JSON', 'Other…']);
    await carry(ring.choose('x0.5', ['speed']));
    expect(media).toHaveBeenCalledWith({ tool: 'speed', factor: 0.5 }, [VIDEO.path]);
    expect(ring.choose('other', ['speed'])).toEqual({ kind: 'panel', tool: 'speed', paths: [VIDEO.path] });
    await carry(ring.choose('remove-location', ['metadata']));
    expect(metadata).toHaveBeenLastCalledWith(VIDEO.path, {
      set: {},
      removeAll: false,
      removeLocation: true,
      chapters: null,
    });
    await carry(ring.choose('remove-all', ['metadata']));
    expect(metadata.mock.lastCall?.[1]).toMatchObject({ removeAll: true, removeLocation: false });
    expect(ring.choose('edit', ['metadata'])).toEqual({ kind: 'panel', tool: 'metadata', paths: [VIDEO.path] });
    expect(ring.choose('csv', ['read-qr'])).toEqual({ kind: 'qr-report', paths: [VIDEO.path], report: 'csv' });
    // A PDF holds no position to remove.
    const pdf = view(await slicesFor('tools', [REPORT]));
    expect(pdf.slices[1]!.variants?.map((v) => v.id)).toEqual(['remove-all', 'edit']);
    expect(ring.choose('other', ['read-qr'])).toEqual({ kind: 'panel', tool: 'read-qr', paths: [VIDEO.path] });
  });
});

describe('the Convert wheel', () => {
  it('offers one PDF or one each for several pictures, one PDF by default', async () => {
    vi.spyOn(api, 'targets').mockResolvedValue([group('image', 2, 'png', 'pdf')]);
    const toPdf = vi.spyOn(api, 'imagesToPdf').mockResolvedValue(7);
    const convert = vi.spyOn(api, 'convert').mockResolvedValue([1, 2]);
    const ring = view(await slicesFor('convert', [PHOTO, PHOTO_2]));
    const pdf = ring.slices.find((slice) => slice.id === 'pdf')!;
    expect(pdf.default).toBe('one-pdf');
    expect(pdf.variants?.map((v) => [v.id, v.label])).toEqual([
      ['one-pdf', 'One PDF'],
      ['separate-pdfs', 'Separate PDFs'],
    ]);
    expect(pdf.hint).toBe('One page per image or document · Rest here for more choices');
    expect(ring.slices.find((slice) => slice.id === 'png')!.variants).toBeUndefined();
    // In the selection's order, with the tool's own page layout: one job, one file.
    await carry(ring.choose('one-pdf', ['pdf']));
    expect(toPdf).toHaveBeenCalledWith([PHOTO.path, PHOTO_2.path], PDF_LAYOUT);
    expect(PDF_LAYOUT).toEqual({ size: 'fit-image', marginMm: 0 });
    await carry(ring.choose('separate-pdfs', ['pdf']));
    expect(convert).toHaveBeenLastCalledWith([PHOTO.path, PHOTO_2.path], 'pdf');
  });

  it('keeps one picture, and pictures in a mixed selection, to one PDF each', async () => {
    vi.spyOn(api, 'targets').mockResolvedValue([group('image', 1, 'pdf')]);
    expect(view(await slicesFor('convert', [PHOTO])).slices[0]!.variants).toBeUndefined();

    vi.spyOn(api, 'targets').mockResolvedValue([group('image', 2, 'pdf', 'jpg'), group('video', 1, 'mp4')]);
    const convert = vi.spyOn(api, 'convert').mockResolvedValue([1]);
    const mixed = view(await slicesFor('convert', [PHOTO, VIDEO, PHOTO_2]));
    expect(mixed.key).toBe('categories');
    const image = mixed.slices[0]!;
    expect(image).toMatchObject({ id: 'image', label: 'Image', sublabel: '2 files', subtitle: '2 files' });
    expect(image.default).toBeUndefined();
    expect(image.variants?.find((slice) => slice.id === 'pdf')?.variants).toBeUndefined();
    expect(mixed.slices[1]).toMatchObject({ id: 'video', subtitle: 'Balon turu.mp4' });
    // A target of a category acts on that category's files only, with its choices.
    await carry(mixed.choose('pdf', ['image']));
    expect(convert).toHaveBeenLastCalledWith([PHOTO.path, PHOTO_2.path], 'pdf');
    await carry(mixed.choose('small', ['image', 'jpg']));
    expect(convert).toHaveBeenLastCalledWith([PHOTO.path, PHOTO_2.path], 'jpg', 'small');
  });

  it('offers picture quality, page resolution, GIF size and bit rate, the usual one by default', async () => {
    const convert = vi.spyOn(api, 'convert').mockResolvedValue([1]);
    const choices = async (files: FileEntry[], ...groups: TargetGroup[]) => {
      vi.spyOn(api, 'targets').mockResolvedValue(groups);
      return view(await slicesFor('convert', files));
    };
    const photo = await choices([PHOTO], group('image', 1, 'jpg', 'webp', 'avif', 'png'));
    for (const slice of photo.slices.slice(0, 3)) {
      expect(slice.variants?.map((v) => v.label)).toEqual(['High quality', 'Balanced', 'Small file']);
      expect(slice.default).toBe('balanced');
    }
    expect(photo.slices[3]!.variants).toBeUndefined();
    await carry(photo.choose('high', ['webp']));
    expect(convert).toHaveBeenLastCalledWith([PHOTO.path], 'webp', 'high');

    const pages = await choices([REPORT], group('pdf', 1, 'png', 'jpg', 'docx'));
    expect(pages.slices[0]!.variants?.map((v) => [v.label, v.sublabel])).toEqual([
      ['Screen', '96 dpi'],
      ['Normal', '150 dpi'],
      ['Print', '300 dpi'],
    ]);
    expect(pages.slices[1]!.default).toBe('normal');
    expect(pages.slices[2]!.variants).toBeUndefined();
    await carry(pages.choose('print', ['png']));
    expect(convert).toHaveBeenLastCalledWith([REPORT.path], 'png', 'print');

    const clip = await choices([VIDEO], group('video', 1, 'gif', 'mp3', 'm4a', 'mp4'));
    const [gif, mp3, m4a, mp4] = clip.slices;
    expect(gif!.variants?.map((v) => [v.label, v.sublabel])).toEqual([
      ['Small', '320 px · 10 fps'],
      ['Medium', '480 px · 12 fps'],
      ['Large', '720 px · 15 fps'],
    ]);
    expect(gif!.default).toBe('gif-medium');
    expect(mp3!.variants?.map((v) => v.label)).toEqual(['128', '192', '320']);
    expect(mp3!.variants?.[1]!.hint).toContain('variable');
    expect(m4a!.variants?.[1]!.hint).not.toContain('variable');
    expect(mp3!.default).toBe('kbps192');
    expect(mp4!.variants).toBeUndefined();
    await carry(clip.choose('gif-large', ['gif']));
    expect(convert).toHaveBeenLastCalledWith([VIDEO.path], 'gif', 'gif-large');
    await carry(clip.choose('kbps320', ['m4a']));
    expect(convert).toHaveBeenLastCalledWith([VIDEO.path], 'm4a', 'kbps320');
    // A plain target without choices converts as always.
    await carry(clip.choose('mp4', []));
    expect(convert).toHaveBeenLastCalledWith([VIDEO.path], 'mp4');
  });
});

describe('the file actions wheel', () => {
  it('offers the recent folders for Copy and Move, and ZIP’s other formats', async () => {
    vi.spyOn(api, 'actions').mockResolvedValue([
      { id: 'copy', icon: 'copy', folders: ['C:\\Users\\ayşe\\Desktop\\Arşiv 2026', 'D:\\'] },
      { id: 'move', icon: 'move', folders: [] },
      { id: 'zip', icon: 'zip', folders: [] },
      { id: 'copy-path', icon: 'link', folders: [] },
    ]);
    const run = vi.spyOn(api, 'runAction').mockResolvedValue([3]);
    const ring = view(await slicesFor('actions', [PHOTO]));
    const [copy, move, zip] = ring.slices;
    expect(copy!.variants?.map((v) => [v.label, v.hint])).toEqual([
      ['Arşiv 2026', 'C:\\Users\\ayşe\\Desktop\\Arşiv 2026'],
      ['D:', 'D:\\'],
      ['Choose folder…', 'Any folder'],
    ]);
    expect(copy!.default).toBe('choose');
    // Without a recent folder, Move asks as always.
    expect(move!.variants).toBeUndefined();
    expect(zip!.variants?.map((v) => v.label)).toEqual(['ZIP', '7Z', 'TAR.GZ']);
    expect(zip!.default).toBe('zip');

    await carry(ring.choose(copy!.variants![0]!.id, ['copy']));
    expect(run).toHaveBeenLastCalledWith('copy', [PHOTO.path], { folder: 'C:\\Users\\ayşe\\Desktop\\Arşiv 2026' });
    await carry(ring.choose('choose', ['copy']));
    expect(run).toHaveBeenLastCalledWith('copy', [PHOTO.path], {});
    await carry(ring.choose('tar-gz', ['zip']));
    expect(run).toHaveBeenLastCalledWith('zip', [PHOTO.path], { format: 'tar-gz' });
    await carry(ring.choose('zip', ['zip']));
    expect(run).toHaveBeenLastCalledWith('zip', [PHOTO.path], {});
    const copied = await carry(ring.choose('copy-path', []));
    expect(copied).toMatchObject({ kind: 'run', note: 'action.copied' });
  });
});

describe('the download ring', () => {
  const LINK = 'https://www.youtube.com/watch?v=abc';

  it('offers the video’s quality and the sound’s format, with the quick defaults', async () => {
    vi.spyOn(api, 'webNeeds').mockResolvedValue(null);
    const download = vi.spyOn(api, 'webDownload').mockResolvedValue(5);
    const ring = view(await downloadRing(LINK));
    expect(ring.title).toBe('Download');
    const [video, audio, original] = ring.slices;
    expect(video!.variants?.map((v) => [v.label, v.sublabel ?? null])).toEqual([
      ['Best', null],
      ['4K', '2160p'],
      ['1080p', 'Full HD'],
      ['720p', 'HD'],
      ['480p', 'SD'],
    ]);
    expect(video!.default).toBe('1080');
    expect(audio!.variants?.map((v) => v.label)).toEqual(['MP3', 'M4A', 'Original']);
    expect(audio!.default).toBe('mp3');
    expect(original!.variants).toBeUndefined();

    const chosen = async (id: string, trail: string[]) => {
      await carry(ring.choose(id, trail));
      return download.mock.lastCall?.[1];
    };
    expect(await chosen('1080', ['video'])).toEqual({ kind: 'video', maxHeight: 1080 });
    expect(await chosen('720', ['video'])).toEqual({ kind: 'video', maxHeight: 720 });
    expect(await chosen('2160', ['video'])).toEqual({ kind: 'video', maxHeight: 2160 });
    expect(await chosen('best', ['video'])).toEqual({ kind: 'video', maxHeight: null });
    expect(await chosen('mp3', ['audio'])).toEqual({ kind: 'audio' });
    expect(await chosen('m4a', ['audio'])).toEqual({ kind: 'audioAs', format: 'm4a' });
    expect(await chosen('original', ['audio'])).toEqual({ kind: 'audioAs', format: 'original' });
    expect(await chosen('original', [])).toEqual({ kind: 'original' });
  });
});
