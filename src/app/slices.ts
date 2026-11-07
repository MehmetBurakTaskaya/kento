// SPDX-License-Identifier: MIT
// The wheel's rings for a selection, shared by the main window and the floating wheel: the Convert
// wheel (by category in a mixed selection), the Tools wheel, the file actions wheel and the
// download ring of a link. Slices with choices carry them as a ring a level further in
// (variants.ts); a category and Favorites are such slices too. Recent choices come first; that
// learning stays in this window's local storage (SPEC 5.3). Favorites come before everything on
// the Tools wheel: one slice that opens the recipes fitting the files (SPEC 5.11).
import type { TFunction } from 'i18next';
import { describeSteps } from '../automation/describe';
import { kindIcon } from '../components/FileIcon';
import type { IconName } from '../components/Icon';
import {
  api,
  type ActionEntry,
  type Category,
  type FileEntry,
  type QrReport,
  type RecipeEntry,
  type TargetGroup,
  type ToolEntry,
  type ToolGroup,
  type WheelKind,
} from '../ipc';
import { QUICK_CHOICES } from '../web/links';
import type { WheelSlice } from '../wheel/Wheel';
import {
  actionChoices,
  ARCHIVE_FORMATS,
  COMPRESS_CHOICES,
  downloadChoice,
  downloadChoices,
  folderOf,
  isPreset,
  MEDIA_CHOICES,
  METADATA_CHOICES,
  ONE_PDF,
  OTHER,
  PDF_LAYOUT,
  QR_REPORTS,
  SEPARATE_PDFS,
  SPEED_CHOICES,
  targetChoices,
  toolChoices,
  withChoices,
  type ArchiveFormat,
} from './variants';

const RECENT_KEY = 'kento.recent';

export const TOOL_ICONS: Record<string, IconName> = {
  'merge-pdf': 'merge',
  'split-pdf': 'split',
  'edit-pdf': 'doc',
  'images-to-pdf': 'layers',
  'read-qr': 'qr',
  extract: 'zip',
  mute: 'mute',
  'trim-video': 'scissors',
  'crop-video': 'crop',
  speed: 'speed',
  'merge-video': 'merge',
  frames: 'image',
  'split-video': 'split',
  'redact-video': 'redact',
  normalize: 'music',
  'trim-audio': 'scissors',
  channels: 'music',
  'redact-audio': 'redact',
  'audio-to-video': 'video',
  compress: 'compress',
  metadata: 'tag',
  'edit-image': 'sliders',
  markup: 'pen',
  frame: 'frame',
  'crop-image': 'crop',
  collage: 'grid',
  'redact-image': 'redact',
  'remove-background': 'cutout',
  'make-qr': 'qr',
  ocr: 'text',
  'burn-subtitles': 'captions',
  'make-vertical': 'crop',
  'cut-out': 'scissors',
  'remove-pauses': 'scissors',
  'add-music': 'music',
  'add-overlay': 'text',
  fade: 'music',
  denoise: 'music',
  'rotate-video': 'rotate-right',
  'loop-video': 'restart',
  'color-video': 'sliders',
  'merge-audio': 'merge',
  ringtone: 'music',
  stabilize: 'video',
};

const ACTION_ICONS: Record<string, IconName> = {
  share: 'share',
  shelf: 'shelf',
  copy: 'copy',
  move: 'move',
  'copy-path': 'link',
  terminal: 'terminal',
  reveal: 'folder',
  zip: 'zip',
};

/** Tools that ask for choices in a panel of the main window before they run. */
export const PANEL_TOOLS = [
  'merge-pdf',
  'split-pdf',
  'edit-pdf',
  'images-to-pdf',
  'read-qr',
  'compress',
  'metadata',
  'remove-background',
  'ocr',
  'burn-subtitles',
];

/** Media tools with an editor; Remove audio runs at once. */
export { MEDIA_PANELS } from '../editors';

/** The id of a slice whose tool group is not installed: choosing it opens the setup. */
export const NEEDS_SETUP = '\u0001setup';

function needsHint(t: TFunction, group: string | null) {
  return group ? t('wheel.needs', { name: t(`group.${group}`) }) : undefined;
}

function recent(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}') as Record<string, string[]>;
  } catch {
    return {};
  }
}

export function remember(scope: string, id: string) {
  try {
    const all = recent();
    all[scope] = [id, ...(all[scope] ?? []).filter((x) => x !== id)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(all));
  } catch {
    // Without storage the wheel simply keeps the catalog order.
  }
}

function byRecent<T>(items: T[], id: (item: T) => string, scope: string): T[] {
  const order = recent()[scope] ?? [];
  const rank = (item: T) => {
    const index = order.indexOf(id(item));
    return index < 0 ? order.length : index;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** What a choice on the wheel does; each host carries it out in its own window. */
export type Plan =
  /** The tool setup, for a slice whose tool group is missing. */
  | { kind: 'setup' }
  /** A tool's window in the main window. */
  | { kind: 'panel'; tool: string; paths: string[] }
  /** A request to the core: its answer is a job id, a list of them, or nothing. `note` is a
   *  message for the main window once it is done (the core tells the floating wheel's user). */
  | { kind: 'run'; start: () => Promise<unknown>; note?: string }
  /** Read QR codes: scan, then save the report next to the first file. */
  | { kind: 'qr-report'; paths: string[]; report: QrReport }
  | { kind: 'none' };

const run = (start: () => Promise<unknown>, note?: string): Plan => ({ kind: 'run', start, note });

/** One wheel: its slices (some with rings of their own), the files they act on, and what each
 *  choice does. */
export interface RingView {
  key: string;
  /** The hub title. */
  title: string;
  slices: WheelSlice[];
  /** Every file the wheel was opened for. */
  paths: string[];
  /** What the choice `id`, reached through the slices of `trail`, does; it is learned for the
   *  next time. */
  choose(id: string, trail: string[]): Plan;
}

export interface Ring {
  view(t: TFunction, has: (key: string) => boolean, mac: boolean, lang: string): RingView;
}

/** "photo.jpg" for one file, "3 files" for more. */
function filesLabel(paths: string[], files: FileEntry[], t: TFunction) {
  return paths.length === 1
    ? (files.find((file) => file.path === paths[0])?.name ?? '')
    : t('wheel.files', { count: paths.length });
}

// ---------------------------------------------------------------- Convert

/** The targets of one category, with their choices. `alone`: the category is the whole selection
 *  (several pictures become one PDF only then). */
export function targetSlices(
  group: TargetGroup,
  t: TFunction,
  has: (key: string) => boolean,
  alone = true,
): WheelSlice[] {
  return byRecent(group.targets, (target) => target.to, group.category).map((target) => {
    const slice: WheelSlice = {
      id: target.needs ? `${NEEDS_SETUP}:${target.to}` : target.to,
      label: target.label,
      hint: needsHint(t, target.needs) ?? (has(`format.hint.${target.to}`) ? t(`format.hint.${target.to}`) : undefined),
      dimmed: !!target.needs,
    };
    if (target.needs) return slice;
    return withChoices(slice, targetChoices(group.category, target.to, group.count, alone, t), t);
  });
}

/** A mixed selection first shows its categories; each opens the targets for its files. */
export function categorySlices(
  groups: TargetGroup[],
  t: TFunction,
  has: (key: string) => boolean,
  subtitle: (category: Category) => string,
): WheelSlice[] {
  return groups.map((group) => ({
    id: group.category,
    label: t(`category.${group.category}`),
    sublabel: t('wheel.files', { count: group.count }),
    icon: kindIcon(group.category),
    subtitle: subtitle(group.category),
    variants: targetSlices(group, t, has, false),
  }));
}

/** The paths of a selection that belong to one category. */
export function inCategory(paths: string[], categoryOf: (path: string) => Category | null, category: Category) {
  return paths.filter((path) => categoryOf(path) === category);
}

/** What a Convert choice runs: `to` itself, or a choice of `to` (its preset, one PDF of every
 *  picture, or one PDF each). */
function convertPlan(paths: string[], to: string, choice: string | null): Plan {
  if (to.startsWith(NEEDS_SETUP)) return { kind: 'setup' };
  if (choice === ONE_PDF) return run(() => api.imagesToPdf(paths, PDF_LAYOUT));
  if (choice && choice !== SEPARATE_PDFS && isPreset(choice)) return run(() => api.convert(paths, to, choice));
  return run(() => api.convert(paths, to));
}

function convertRing(groups: TargetGroup[], files: FileEntry[]): Ring {
  const paths = files.map((file) => file.path);
  const pathsOf = (category: string) =>
    inCategory(paths, (path) => files.find((file) => file.path === path)?.category ?? null, category as Category);
  const only = groups.length === 1 ? groups[0]! : null;
  return {
    view: (t, has) => ({
      key: only ? only.category : 'categories',
      title: t('wheel.convert'),
      slices: only
        ? targetSlices(only, t, has)
        : categorySlices(groups, t, has, (category) => filesLabel(pathsOf(category), files, t)),
      paths,
      choose: (id, trail) => {
        // [category], then the target whose choices these are.
        const [category, target] = only ? [only.category, trail[0]] : [trail[0] ?? '', trail[1]];
        const to = target ?? id;
        if (!to.startsWith(NEEDS_SETUP)) remember(category, to);
        return convertPlan(pathsOf(category), to, target ? id : null);
      },
    }),
  };
}

// ---------------------------------------------------------------- Tools

/** The tools, with their choices for files of these `kinds`. */
export function toolSlices(tools: ToolEntry[], t: TFunction, lang = 'en', kinds: Category[] = []): WheelSlice[] {
  return byRecent(tools, (tool) => tool.id, 'tools').map((tool) => {
    const slice: WheelSlice = {
      id: tool.needs ? `${NEEDS_SETUP}:${tool.id}` : tool.id,
      label: t(`tool.${tool.id}`),
      icon: TOOL_ICONS[tool.id] ?? 'sliders',
      hint: needsHint(t, tool.needs),
      dimmed: !!tool.needs,
    };
    return tool.needs ? slice : withChoices(slice, toolChoices(tool.id, t, lang, kinds), t);
  });
}

/** The id of the Tools wheel's Favorites slice; it opens the recipes ring. */
export const FAVORITES = '\u0001favorites';
const RECIPE = 'recipe:';

/** The recipe a slice runs, or null for any other slice. */
export function recipeOf(id: string): string | null {
  return id.startsWith(RECIPE) ? id.slice(RECIPE.length) : null;
}

/** The recipes in the user's order; the bubble and the screen reader say their steps. A recipe
 *  that needs a missing tool group is dimmed and opens the setup, like any other slice. */
export function recipeSlices(recipes: RecipeEntry[], t: TFunction, lang: string): WheelSlice[] {
  return recipes.map((recipe) => ({
    id: recipe.needs ? `${NEEDS_SETUP}:${RECIPE}${recipe.id}` : `${RECIPE}${recipe.id}`,
    label: recipe.name,
    icon: 'layers',
    hint: needsHint(t, recipe.needs) ?? describeSteps(recipe.steps, t, lang),
    dimmed: !!recipe.needs,
  }));
}

/** Favorites, first on the Tools wheel when recipes fit the files; its ring holds them. */
export function favoritesSlice(recipes: RecipeEntry[], t: TFunction, lang = 'en'): WheelSlice {
  return {
    id: FAVORITES,
    label: t('wheel.favorites'),
    sublabel: t('wheel.recipes', { count: recipes.length }),
    icon: 'star',
    hint: t('wheel.favorites.hint', { count: recipes.length }),
    variants: recipeSlices(recipes, t, lang),
  };
}

/** The Tools wheel's slices: Favorites first when recipes fit, then the tools. */
export function toolWheelSlices(
  tools: ToolEntry[],
  recipes: RecipeEntry[],
  t: TFunction,
  lang = 'en',
  kinds: Category[] = [],
): WheelSlice[] {
  return [...(recipes.length ? [favoritesSlice(recipes, t, lang)] : []), ...toolSlices(tools, t, lang, kinds)];
}

/** A tool on its own: Extract and Remove audio run at once, every other tool opens its window. */
function toolPlan(tool: string, paths: string[]): Plan {
  if (tool === 'extract') return run(() => api.extract(paths));
  if (tool === 'mute') return run(() => api.runMediaTool({ tool: 'mute' }, paths));
  return { kind: 'panel', tool, paths };
}

/** A recipe, a tool, or one of a tool's choices. */
function toolChoicePlan(id: string, trail: string[], paths: string[]): Plan {
  if (id.startsWith(NEEDS_SETUP)) return { kind: 'setup' };
  const recipe = recipeOf(id);
  if (recipe) return run(() => api.runRecipe(recipe, paths));
  const tool = trail[trail.length - 1];
  if (!tool || tool === FAVORITES) return toolPlan(id, paths);
  if (id === OTHER || (tool === 'metadata' && id === 'edit')) return toolPlan(tool, paths);
  const compression = tool === 'compress' ? COMPRESS_CHOICES[id] : undefined;
  if (compression) return run(() => api.runCompress(compression, paths));
  const factor = tool === 'speed' ? SPEED_CHOICES[id] : undefined;
  if (factor) return run(() => api.runMediaTool({ tool: 'speed', factor }, paths));
  const media = MEDIA_CHOICES[tool]?.[id];
  if (media) return run(() => api.runMediaTool(media, paths));
  const change = tool === 'metadata' ? METADATA_CHOICES[id] : undefined;
  // Metadata takes one file at a time.
  if (change && paths[0]) return run(() => api.runMetadata(paths[0]!, change));
  const report = QR_REPORTS.find((format) => format === id);
  if (tool === 'read-qr' && report) return { kind: 'qr-report', paths, report };
  return { kind: 'none' };
}

function toolsRing(tools: ToolEntry[], recipes: RecipeEntry[], files: FileEntry[]): Ring {
  const paths = files.map((file) => file.path);
  const kinds = files.flatMap((file) => (file.category ? [file.category] : []));
  return {
    view: (t, _has, _mac, lang) => ({
      // Only recipes fit: the wheel opens on them.
      key: tools.length ? 'tools' : 'favorites',
      title: t(tools.length ? 'wheel.tools' : 'wheel.favorites'),
      slices: tools.length ? toolWheelSlices(tools, recipes, t, lang, kinds) : recipeSlices(recipes, t, lang),
      paths,
      choose: (id, trail) => {
        const top = trail[0] ?? id;
        if (top !== FAVORITES && !recipeOf(top) && !top.startsWith(NEEDS_SETUP)) remember('tools', top);
        return toolChoicePlan(id, trail, paths);
      },
    }),
  };
}

// ---------------------------------------------------------------- File actions

export function actionSlices(actions: ActionEntry[], t: TFunction, mac: boolean): WheelSlice[] {
  return byRecent(actions, (action) => action.id, 'actions').map((action) => {
    const slice: WheelSlice = {
      id: action.id,
      label: t(action.id === 'reveal' ? `action.reveal.${mac ? 'mac' : 'windows'}` : `action.${action.id}`),
      icon: ACTION_ICONS[action.id] ?? 'file',
    };
    return withChoices(slice, actionChoices(action.id, action.folders ?? [], t), t);
  });
}

function actionPlan(id: string, trail: string[], paths: string[]): Plan {
  const action = trail[0] ?? id;
  if (!trail.length) return run(() => api.runAction(id, paths), id === 'copy-path' ? 'action.copied' : undefined);
  if (action === 'zip') {
    const format = ARCHIVE_FORMATS.find((f) => f === id) as ArchiveFormat | undefined;
    return run(() => api.runAction('zip', paths, format && format !== 'zip' ? { format } : {}));
  }
  const folder = folderOf(id);
  return run(() => api.runAction(action, paths, folder ? { folder } : {}));
}

function actionsRing(actions: ActionEntry[], paths: string[]): Ring {
  return {
    view: (t, _has, mac) => ({
      key: 'actions',
      title: t('wheel.actions'),
      slices: actionSlices(actions, t, mac),
      paths,
      choose: (id, trail) => {
        remember('actions', trail[0] ?? id);
        return actionPlan(id, trail, paths);
      },
    }),
  };
}

// ---------------------------------------------------------------- Downloads

const DOWNLOAD_ICONS: Record<string, IconName> = { video: 'video', audio: 'music', original: 'image' };

/** The download ring of a link dragged out of a browser (SPEC 5.10): Video (the best quality up to
 *  1080 lines, or a quality of its ring), Audio (MP3, or M4A or the sound as served) and Original
 *  (a picture stays a picture) download at once with the dialog's defaults; QR code makes a code
 *  of the link; More… opens the dialog with every choice. Without the web tools the quick slices
 *  are dimmed and open the setup. */
export function downloadSlices(t: TFunction, needs: ToolGroup | null): WheelSlice[] {
  const quick = byRecent(['video', 'audio', 'original'], (id) => id, 'download').map((id) => {
    const slice: WheelSlice = {
      id: needs ? `${NEEDS_SETUP}:${id}` : id,
      label: t(`wheel.download.${id}`),
      icon: DOWNLOAD_ICONS[id] ?? 'file',
      hint: needsHint(t, needs) ?? t(`wheel.download.${id}.hint`),
      dimmed: !!needs,
    };
    return needs ? slice : withChoices(slice, downloadChoices(id, t), t);
  });
  return [
    ...quick,
    { id: 'qr', label: t('wheel.download.qr'), icon: 'qr', hint: t('wheel.download.qr.hint') },
    { id: 'more', label: t('wheel.download.more'), icon: 'more', hint: t('wheel.download.more.hint') },
  ];
}

function downloadPlan(link: string, id: string, trail: string[]): Plan {
  if (id.startsWith(NEEDS_SETUP)) return { kind: 'setup' };
  if (id === 'qr') return run(() => api.qrOpen(link));
  if (id === 'more') return run(() => api.webOpen(link));
  const choice = trail[0] ? downloadChoice(trail[0], id) : (QUICK_CHOICES[id as keyof typeof QUICK_CHOICES] ?? null);
  return choice ? run(() => api.webDownload(link, choice, null)) : { kind: 'none' };
}

/** The ring for a link; the web tools are checked once, when it opens. */
export async function downloadRing(link: string): Promise<Ring> {
  const needs = await api.webNeeds();
  return {
    view: (t) => ({
      key: 'download',
      title: t('wheel.download'),
      slices: downloadSlices(t, needs),
      paths: [],
      choose: (id, trail) => {
        const top = trail[0] ?? id;
        if (top !== 'more' && top !== 'qr' && !top.startsWith(NEEDS_SETUP)) remember('download', top);
        return downloadPlan(link, id, trail);
      },
    }),
  };
}

// ---------------------------------------------------------------- Rings for files

/** The ring for a wheel and the files a drag or a selection brought; null when nothing fits. */
export async function slicesFor(kind: WheelKind, files: FileEntry[]): Promise<Ring | null> {
  const paths = files.map((file) => file.path);
  if (kind === 'convert') {
    const groups = (await api.targets(paths)).filter((group) => group.targets.length);
    return groups.length ? convertRing(groups, files) : null;
  }
  if (kind === 'tools') {
    const [tools, recipes] = await Promise.all([api.tools(paths), api.recipesFor(paths).catch(() => [])]);
    return tools.length || recipes.length ? toolsRing(tools, recipes, files) : null;
  }
  return actionsRing(await api.actions(), paths);
}

/** The hub's second line for the files of a ring: the file's name, or how many there are. */
export function subtitleFor(view: RingView, files: FileEntry[], t: TFunction): string {
  return filesLabel(view.paths, files, t);
}
