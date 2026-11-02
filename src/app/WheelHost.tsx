// SPDX-License-Identifier: MIT
// Opens the wheel in the main window for the chosen files (SPEC 5.3), with the same rings as the
// floating wheel: the Convert wheel shows the targets valid for every file, by category when the
// selection is mixed; the Tools wheel shows the tools that fit, after a Favorites slice that opens
// the recipes fitting the files (SPEC 5.11); the file actions wheel works on any files and
// folders. Slices with choices open them in place; tool windows open here.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isImagePanel, isMediaPanel } from '../editors';
import { isolate } from '../i18n/format';
import { api, type FileEntry } from '../ipc';
import { useApp, type PanelTool } from '../state/store';
import { Wheel } from '../wheel/Wheel';
import { PANEL_TOOLS, slicesFor, subtitleFor, type Plan, type Ring } from './slices';

type Opened = NonNullable<ReturnType<typeof useApp.getState>['wheel']>;

interface Loaded {
  wheel: Opened;
  ring: Ring;
  files: FileEntry[];
}

const isPanel = (tool: string) => PANEL_TOOLS.includes(tool) || isMediaPanel(tool) || isImagePanel(tool);

/** The answer of a request, as job ids for the cards in the corner. */
function jobIds(result: unknown): number[] {
  if (typeof result === 'number') return [result];
  return Array.isArray(result) ? result.filter((id): id is number => typeof id === 'number') : [];
}

export function WheelHost() {
  const { t, i18n } = useTranslation();
  const { wheel, settings, boot, closeWheel, openPanel, openSetup, started, toast } = useApp();
  // The ring belongs to the wheel it was made for, so a new wheel starts clean.
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!wheel) return;
    let live = true;
    const fail = (error: unknown) => {
      void api.log('warn', `wheel not filled: ${String(error)}`);
      closeWheel();
    };
    api
      .inspect(wheel.paths)
      .then(async (files) => {
        const ring = await slicesFor(wheel.kind, files);
        if (!live) return;
        if (ring) setLoaded({ wheel, ring, files });
        else {
          toast({ kind: 'info', message: t(wheel.kind === 'convert' ? 'run.none' : 'run.noTools') });
          closeWheel();
        }
      })
      .catch(fail);
    return () => {
      live = false;
    };
  }, [wheel, closeWheel, toast, t]);

  const current = loaded?.wheel === wheel ? loaded : null;
  const mac = boot?.app.platform === 'macos';
  const lang = i18n.language;
  // Made once per ring and language: a choice reorders the recent slices, and the jobs it starts
  // re-render this host while the ring on screen plays its apply animation.
  const view = useMemo(
    () => current?.ring.view(t, (key) => i18n.exists(key), mac, lang) ?? null,
    [current, t, i18n, mac, lang],
  );
  if (!wheel || !settings || !current || !view) return null;
  const failed = (error: unknown) => toast({ kind: 'info', message: String(error) });

  const carry = (plan: Plan) => {
    switch (plan.kind) {
      case 'setup':
        return openSetup();
      case 'panel':
        if (isPanel(plan.tool)) openPanel(plan.tool as PanelTool, plan.paths);
        return;
      case 'run':
        return void plan
          .start()
          .then((result) => {
            started(jobIds(result));
            if (plan.note) toast({ kind: 'info', message: t(plan.note) });
          })
          .catch(failed);
      case 'qr-report':
        return void api
          .scanQr(plan.paths)
          .then(async (found) => {
            if (!found.length) return toast({ kind: 'info', message: t('tools.qr.none') });
            const saved = await api.saveQrReport(found, plan.report);
            toast({ kind: 'info', message: t('tools.qr.saved', { name: isolate(saved.name) }) });
          })
          .catch(failed);
    }
  };

  return (
    <Wheel
      key={view.key}
      kind={wheel.kind === 'convert' ? 'convert' : 'tools'}
      title={view.title}
      subtitle={subtitleFor(view, current.files, t)}
      slices={view.slices}
      sound={settings.sound}
      reducedMotion={document.documentElement.classList.contains('reduce-motion')}
      size={settings.wheelSize}
      onClose={closeWheel}
      onTick={mac ? () => void api.haptic() : undefined}
      onApply={(id, trail) => carry(view.choose(id, trail))}
    />
  );
}
