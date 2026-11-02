// SPDX-License-Identifier: MIT
// The wheel's slices for a selection, shared by the main window and the floating wheel: the
// Convert wheel by category, the Tools wheel and the file actions wheel. Recent choices come
// first; that learning stays in this window's local storage (SPEC 5.3).
import type { TFunction } from 'i18next';
import { kindIcon } from '../components/FileIcon';
import type { IconName } from '../components/Icon';
import {
  api,
  type ActionEntry,
  type Category,
  type FileEntry,
  type TargetGroup,
  type ToolEntry,
  type ToolGroup,
  type WheelKind,
} from '../ipc';
import type { WheelSlice } from '../wheel/Wheel';

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
export const PANEL_TOOLS = ['merge-pdf', 'split-pdf', 'edit-pdf', 'images-to-pdf', 'read-qr', 'compress', 'metadata'];

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

/** A mixed selection first shows its categories; each opens the targets for its files. */
export function categorySlices(groups: TargetGroup[], t: TFunction): WheelSlice[] {
  return groups.map((group) => ({
    id: group.category,
    label: t(`category.${group.category}`),
    sublabel: t('wheel.files', { count: group.count }),
    icon: kindIcon(group.category),
    opens: true,
  }));
}

export function targetSlices(group: TargetGroup, t: TFunction, has: (key: string) => boolean): WheelSlice[] {
  return byRecent(group.targets, (target) => target.to, group.category).map((target) => ({
    id: target.needs ? `${NEEDS_SETUP}:${target.to}` : target.to,
    label: target.label,
    hint: needsHint(t, target.needs) ?? (has(`format.hint.${target.to}`) ? t(`format.hint.${target.to}`) : undefined),
    dimmed: !!target.needs,
  }));
}

export function toolSlices(tools: ToolEntry[], t: TFunction): WheelSlice[] {
  return byRecent(tools, (tool) => tool.id, 'tools').map((tool) => ({
    id: tool.needs ? `${NEEDS_SETUP}:${tool.id}` : tool.id,
    label: t(`tool.${tool.id}`),
    icon: TOOL_ICONS[tool.id] ?? 'sliders',
    hint: needsHint(t, tool.needs),
    dimmed: !!tool.needs,
  }));
}

export function actionSlices(actions: ActionEntry[], t: TFunction, mac: boolean): WheelSlice[] {
  return byRecent(actions, (action) => action.id, 'actions').map((action) => ({
    id: action.id,
    label: t(action.id === 'reveal' ? `action.reveal.${mac ? 'mac' : 'windows'}` : `action.${action.id}`),
    icon: ACTION_ICONS[action.id] ?? 'file',
  }));
}

const DOWNLOAD_ICONS: Record<string, IconName> = { video: 'video', audio: 'music', original: 'image' };

/** The download ring of a link dragged out of a browser (SPEC 5.10): Video (the best quality up to
 *  1080 lines), Audio (MP3) and Original (a picture stays a picture) download at once with the
 *  dialog's defaults; More… opens the dialog with every choice. Without the web tools the quick
 *  slices are dimmed and open the setup. */
export function downloadSlices(t: TFunction, needs: ToolGroup | null): WheelSlice[] {
  const quick = byRecent(['video', 'audio', 'original'], (id) => id, 'download').map((id) => ({
    id: needs ? `${NEEDS_SETUP}:${id}` : id,
    label: t(`wheel.download.${id}`),
    icon: DOWNLOAD_ICONS[id] ?? 'file',
    hint: needsHint(t, needs) ?? t(`wheel.download.${id}.hint`),
    dimmed: !!needs,
  }));
  return [...quick, { id: 'more', label: t('wheel.download.more'), icon: 'more', hint: t('wheel.download.more.hint') }];
}

/** The ring for a link; the web tools are checked once, when it opens. */
export async function downloadRing(): Promise<Ring> {
  const needs = await api.webNeeds();
  return {
    view: (t) => ({
      key: 'download',
      slices: downloadSlices(t, needs),
      paths: [],
      apply: (id) => {
        if (id !== 'more' && !id.startsWith(NEEDS_SETUP)) remember('download', id);
        return null;
      },
    }),
  };
}

/** The paths of a selection that belong to one category. */
export function inCategory(paths: string[], categoryOf: (path: string) => Category | null, category: Category) {
  return paths.filter((path) => categoryOf(path) === category);
}

/** One ring of the floating wheel: its slices, the files they act on, and the ring a slice opens. */
export interface RingView {
  key: string;
  slices: WheelSlice[];
  paths: string[];
  /** A slice that opens another ring (a category) returns it; any other slice returns null. */
  apply(id: string): Ring | null;
  back?: () => Ring;
}

export interface Ring {
  view(t: TFunction, has: (key: string) => boolean, mac: boolean): RingView;
}

function targetsRing(group: TargetGroup, paths: string[], parent: Ring | null): Ring {
  return {
    view: (t, has) => ({
      key: group.category,
      slices: targetSlices(group, t, has),
      paths,
      apply: (to) => {
        remember(group.category, to);
        return null;
      },
      back: parent ? () => parent : undefined,
    }),
  };
}

/** The ring for a wheel and the files a drag or a selection brought; null when nothing fits. */
export async function slicesFor(kind: WheelKind, files: FileEntry[]): Promise<Ring | null> {
  const paths = files.map((file) => file.path);
  if (kind === 'convert') {
    const groups = (await api.targets(paths)).filter((group) => group.targets.length);
    const pathsOf = (category: Category) =>
      inCategory(paths, (path) => files.find((file) => file.path === path)?.category ?? null, category);
    if (!groups.length) return null;
    if (groups.length === 1) return targetsRing(groups[0]!, pathsOf(groups[0]!.category), null);
    const categories: Ring = {
      view: (t) => ({
        key: 'categories',
        slices: categorySlices(groups, t),
        paths,
        apply: (id) => {
          const group = groups.find((g) => g.category === id);
          return group ? targetsRing(group, pathsOf(group.category), categories) : null;
        },
      }),
    };
    return categories;
  }
  if (kind === 'tools') {
    const tools = await api.tools(paths);
    if (!tools.length) return null;
    return {
      view: (t) => ({
        key: 'tools',
        slices: toolSlices(tools, t),
        paths,
        apply: (id) => {
          remember('tools', id);
          return null;
        },
      }),
    };
  }
  const actions = await api.actions();
  return {
    view: (t, _has, mac) => ({
      key: 'actions',
      slices: actionSlices(actions, t, mac),
      paths,
      apply: (id) => {
        remember('actions', id);
        return null;
      },
    }),
  };
}
