// SPDX-License-Identifier: MIT
// Opens the wheel in the main window for the chosen files (SPEC 5.3): the Convert wheel shows the
// targets valid for every file, by category when the selection is mixed; the Tools wheel shows the
// tools that fit; the file actions wheel works on any files and folders.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ActionEntry, type Category, type TargetGroup, type ToolEntry } from '../ipc';
import { useApp, type PanelTool } from '../state/store';
import { isMediaPanel } from '../editors';
import { Wheel } from '../wheel/Wheel';
import { actionSlices, categorySlices, NEEDS_SETUP, PANEL_TOOLS, remember, targetSlices, toolSlices } from './slices';

type Opened = NonNullable<ReturnType<typeof useApp.getState>['wheel']>;

interface Loaded {
  wheel: Opened;
  groups?: TargetGroup[];
  tools?: ToolEntry[];
  actions?: ActionEntry[];
}

export function WheelHost() {
  const { t, i18n } = useTranslation();
  const { wheel, files, settings, boot, closeWheel, openPanel, openSetup, started, toast } = useApp();
  // Results and choices belong to the wheel they were made for, so a new wheel starts clean.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [choice, setChoice] = useState<{ wheel: Opened; category: Category | null } | null>(null);
  const current = loaded?.wheel === wheel ? loaded : null;
  const groups = current?.groups ?? null;
  const category =
    choice?.wheel === wheel ? choice.category : groups?.length === 1 ? (groups[0]?.category ?? null) : null;
  const setCategory = (next: Category | null) => wheel && setChoice({ wheel, category: next });
  // Choosing a category swaps rings; the closing of the category ring must not end the session.
  const advanced = useRef(false);

  useEffect(() => {
    if (!wheel) return;
    let live = true;
    const fail = (error: unknown) => {
      void api.log('warn', `wheel not filled: ${String(error)}`);
      closeWheel();
    };
    const empty = (key: string) => {
      toast({ kind: 'info', message: t(key) });
      closeWheel();
    };
    if (wheel.kind === 'convert') {
      api
        .targets(wheel.paths)
        .then((found) => {
          if (!live) return;
          const usable = found.filter((group) => group.targets.length);
          if (usable.length) setLoaded({ wheel, groups: usable });
          else empty('run.none');
        })
        .catch(fail);
    } else if (wheel.kind === 'tools') {
      api
        .tools(wheel.paths)
        .then((found) => {
          if (!live) return;
          if (found.length) setLoaded({ wheel, tools: found });
          else empty('run.noTools');
        })
        .catch(fail);
    } else {
      api
        .actions()
        .then((found) => live && setLoaded({ wheel, actions: found }))
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

  if (!wheel || !settings || !current) return null;
  const mac = boot?.app.platform === 'macos';
  const subtitle =
    paths.length === 1
      ? (files.find((file) => file.path === paths[0])?.name ?? '')
      : t('wheel.files', { count: paths.length });
  const common = {
    subtitle,
    sound: settings.sound,
    reducedMotion: document.documentElement.classList.contains('reduce-motion'),
    size: settings.wheelSize,
    onClose: closeWheel,
    onTick: mac ? () => void api.haptic() : undefined,
  };
  const failed = (error: unknown) => toast({ kind: 'info', message: String(error) });

  if (current.groups) {
    const group = current.groups.find((g) => g.category === category);
    if (!group) {
      return (
        <Wheel
          key="groups"
          kind="convert"
          title={t('wheel.convert')}
          slices={categorySlices(current.groups, t)}
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
    return (
      <Wheel
        key={group.category}
        kind="convert"
        title={t('wheel.convert')}
        slices={targetSlices(group, t, (key) => i18n.exists(key))}
        {...common}
        onBack={current.groups.length > 1 ? () => setCategory(null) : undefined}
        onApply={(to) => {
          if (to.startsWith(NEEDS_SETUP)) return openSetup();
          remember(group.category, to);
          api.convert(paths, to).then(started).catch(failed);
        }}
      />
    );
  }

  if (current.tools) {
    return (
      <Wheel
        key="tools"
        kind="tools"
        title={t('wheel.tools')}
        slices={toolSlices(current.tools, t)}
        {...common}
        onApply={(id) => {
          if (id.startsWith(NEEDS_SETUP)) return openSetup();
          remember('tools', id);
          if (PANEL_TOOLS.includes(id) || isMediaPanel(id)) openPanel(id as PanelTool, paths);
          else if (id === 'extract') api.extract(paths).then(started).catch(failed);
          else if (id === 'mute') api.runMediaTool({ tool: 'mute' }, paths).then(started).catch(failed);
        }}
      />
    );
  }

  return (
    <Wheel
      key="actions"
      kind="tools"
      title={t('wheel.actions')}
      slices={actionSlices(current.actions ?? [], t, mac)}
      {...common}
      onApply={(id) => {
        remember('actions', id);
        api
          .runAction(id, paths)
          .then((ids) => {
            started(ids);
            if (id === 'copy-path') toast({ kind: 'info', message: t('action.copied') });
          })
          .catch(failed);
      }}
    />
  );
}
