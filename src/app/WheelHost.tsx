// SPDX-License-Identifier: MIT
// Opens the wheel for the chosen files (SPEC 5.3): the Convert wheel shows the targets valid for
// every file, by category when the selection is mixed; the Tools wheel shows the tools that fit.
// Recent choices come first; that learning stays in this window's local storage.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { kindIcon } from '../components/FileIcon';
import type { IconName } from '../components/Icon';
import { api, type Category, type TargetGroup, type ToolEntry } from '../ipc';
import { useApp, type PanelTool } from '../state/store';

type Opened = NonNullable<ReturnType<typeof useApp.getState>['wheel']>;
import { Wheel, type WheelSlice } from '../wheel/Wheel';

const RECENT_KEY = 'kento.recent';
const PANEL_TOOLS: PanelTool[] = ['merge-pdf', 'split-pdf', 'edit-pdf', 'images-to-pdf', 'read-qr'];
const TOOL_ICONS: Record<string, IconName> = {
  'merge-pdf': 'merge',
  'split-pdf': 'split',
  'edit-pdf': 'doc',
  'images-to-pdf': 'layers',
  'read-qr': 'qr',
  extract: 'zip',
};

function recent(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}') as Record<string, string[]>;
  } catch {
    return {};
  }
}

function remember(scope: string, id: string) {
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

export function WheelHost() {
  const { t, i18n } = useTranslation();
  const { wheel, files, settings, closeWheel, openPanel, started, toast } = useApp();
  // Results and choices belong to the wheel they were made for, so a new wheel starts clean.
  const [loaded, setLoaded] = useState<{ wheel: Opened; groups?: TargetGroup[]; tools?: ToolEntry[] } | null>(null);
  const [choice, setChoice] = useState<{ wheel: Opened; category: Category | null } | null>(null);
  const current = loaded?.wheel === wheel ? loaded : null;
  const groups = current?.groups ?? null;
  const tools = current?.tools ?? null;
  const category =
    choice?.wheel === wheel ? choice.category : groups?.length === 1 ? (groups[0]?.category ?? null) : null;
  const setCategory = (next: Category | null) => wheel && setChoice({ wheel, category: next });
  // Choosing a category swaps wheels; the closing of the category wheel must not end the session.
  const advanced = useRef(false);

  useEffect(() => {
    if (!wheel) return;
    let live = true;
    const fail = (error: unknown) => {
      void api.log('warn', `wheel not filled: ${String(error)}`);
      closeWheel();
    };
    if (wheel.kind === 'convert') {
      api
        .targets(wheel.paths)
        .then((found) => {
          if (!live) return;
          const usable = found.filter((group) => group.targets.length);
          if (!usable.length) {
            toast({ kind: 'info', message: t('run.none') });
            closeWheel();
            return;
          }
          setLoaded({ wheel, groups: usable });
        })
        .catch(fail);
    } else {
      api
        .tools(wheel.paths)
        .then((found) => {
          if (!live) return;
          if (!found.length) {
            toast({ kind: 'info', message: t('run.noTools') });
            closeWheel();
            return;
          }
          setLoaded({ wheel, tools: found });
        })
        .catch(fail);
    }
    return () => {
      live = false;
    };
  }, [wheel, closeWheel, toast, t]);

  const paths = useMemo(() => {
    if (!wheel) return [];
    if (!category) return wheel.paths;
    const inGroup = new Set(files.filter((file) => file.category === category).map((file) => file.path));
    return wheel.paths.filter((path) => inGroup.has(path));
  }, [wheel, category, files]);

  if (!wheel || !settings) return null;
  const subtitle =
    paths.length === 1
      ? (files.find((file) => file.path === paths[0])?.name ?? '')
      : t('wheel.files', { count: paths.length });
  const reducedMotion = document.documentElement.classList.contains('reduce-motion');
  const common = {
    subtitle,
    sound: settings.sound,
    reducedMotion,
    size: settings.wheelSize,
    onClose: closeWheel,
  };

  if (wheel.kind === 'convert') {
    if (!groups) return null;
    const group = groups.find((g) => g.category === category);
    if (!group) {
      const slices: WheelSlice[] = groups.map((g) => ({
        id: g.category,
        label: t(`category.${g.category}`),
        sublabel: t('wheel.files', { count: g.count }),
        icon: kindIcon(g.category),
      }));
      return (
        <Wheel
          key="groups"
          kind="convert"
          title={t('wheel.convert')}
          slices={slices}
          {...common}
          onClose={() => {
            if (advanced.current) advanced.current = false;
            else closeWheel();
          }}
          onApply={(id) => {
            advanced.current = true;
            setCategory(id as Category);
          }}
        />
      );
    }
    const slices: WheelSlice[] = byRecent(group.targets, (target) => target.to, group.category).map((target) => ({
      id: target.to,
      label: target.label,
      hint: i18n.exists(`format.hint.${target.to}`) ? t(`format.hint.${target.to}`) : undefined,
    }));
    return (
      <Wheel
        key={group.category}
        kind="convert"
        title={t('wheel.convert')}
        slices={slices}
        {...common}
        onBack={groups.length > 1 ? () => setCategory(null) : undefined}
        onApply={(to) => {
          remember(group.category, to);
          api
            .convert(paths, to)
            .then(started)
            .catch((error) => toast({ kind: 'info', message: String(error) }));
        }}
      />
    );
  }

  if (!tools) return null;
  const slices: WheelSlice[] = byRecent(tools, (tool) => tool.id, 'tools').map((tool) => ({
    id: tool.id,
    label: t(`tool.${tool.id}`),
    icon: TOOL_ICONS[tool.id] ?? 'sliders',
  }));
  return (
    <Wheel
      key="tools"
      kind="tools"
      title={t('wheel.tools')}
      slices={slices}
      {...common}
      onApply={(id) => {
        remember('tools', id);
        if ((PANEL_TOOLS as string[]).includes(id)) {
          openPanel(id as PanelTool, paths);
        } else if (id === 'extract') {
          api
            .extract(paths)
            .then(started)
            .catch((error) => toast({ kind: 'info', message: String(error) }));
        }
      }}
    />
  );
}
