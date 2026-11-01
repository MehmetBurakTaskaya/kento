// SPDX-License-Identifier: MIT
// The floating wheel (SPEC 5.2, 5.3): its own transparent window, moved under the pointer by the
// core when a wheel key is pressed during a file drag. The drag itself tells which files it
// carries when it enters the window; the drop on a slice runs the choice. Without a drag (the
// selection shortcut, Send To) the files come with the session and the wheel takes the keyboard.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { slicesFor, type Ring } from '../app/slices';
import { api, type DragOver, type FileEntry, type WheelKey, type WheelKind, type WheelSession } from '../ipc';
import { useApp } from '../state/store';
import { Wheel, type WheelControl } from '../wheel/Wheel';
import { reducedMotion, useSurface } from './useSurface';

const KEY_OF: Record<string, WheelKey> = { Shift: 'shift', Control: 'control', Alt: 'alt', Meta: 'command' };

export function WheelSurface() {
  useSurface();
  const { t, i18n } = useTranslation();
  const settings = useApp((state) => state.settings);
  const mac = useApp((state) => state.boot?.app.platform === 'macos');
  const [session, setSession] = useState<WheelSession | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [ring, setRing] = useState<Ring | null>(null);
  const control = useRef<WheelControl>(null);
  const sessionRef = useRef<WheelSession | null>(null);

  // Sessions from the core, and the drag over this window.
  useEffect(() => {
    const open = (next: WheelSession) => {
      const same = sessionRef.current?.id === next.id;
      sessionRef.current = next;
      setSession(next);
      setRing(null);
      if (next.paths.length) void api.inspect(next.paths).then(setFiles);
      else if (!same) setFiles([]);
    };
    const onDrag = (event: DragOver) => {
      if (!sessionRef.current) return;
      if (event.type === 'enter') {
        // Not files (text, a link): the wheel has nothing to offer.
        if (!event.paths.length) return control.current?.close();
        void api.inspect(event.paths).then(setFiles);
        control.current?.point(event.x, event.y);
      } else if (event.type === 'over') {
        control.current?.point(event.x, event.y);
      } else if (event.type === 'drop') {
        void api.wheelDropped();
        control.current?.drop(event.x, event.y);
      } else {
        control.current?.leave();
      }
    };
    void api.wheelSession().then((current) => current && open(current));
    const stops = [api.onWheelOpen(open), api.onWheelClose(() => control.current?.close()), api.onDragOver(onDrag)];
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, []);

  // The ring for the session's wheel and files.
  const paths = files.map((file) => file.path);
  const key = session ? `${session.id}:${session.kind}:${paths.join('\u0001')}` : '';
  useEffect(() => {
    if (!session || !files.length) return;
    let live = true;
    void slicesFor(session.kind, files).then((next) => {
      if (!live) return;
      if (next) {
        setRing(next);
        return;
      }
      // Nothing fits these files: the wheel never shows.
      sessionRef.current = null;
      setSession(null);
      void api.wheelClosed();
    });
    return () => {
      live = false;
    };
    // The key holds everything the ring depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Without a drag the wheel has the keyboard: a wheel key switches wheels, leaving closes it.
  useEffect(() => {
    if (session?.mode !== 'click' || !settings) return;
    const onKey = (event: KeyboardEvent) => {
      const pressed = KEY_OF[event.key];
      const kind = (['convert', 'tools', 'actions'] as WheelKind[]).find((k) => settings.wheels[k] === pressed);
      if (kind && kind !== session.kind) void api.wheelSwitch(kind);
    };
    const onBlur = () => control.current?.close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [session, settings]);

  const finish = () => {
    sessionRef.current = null;
    setSession(null);
    setFiles([]);
    setRing(null);
    void api.wheelClosed();
  };

  if (!session || !settings || !ring) return null;
  const run = (promise: Promise<unknown>) =>
    promise.catch((error) => void api.log('warn', `wheel choice failed: ${String(error)}`));
  const view = ring.view(t, (k) => i18n.exists(k), mac);
  const subtitle = view.paths.length === 1 ? (files.find((f) => f.path === view.paths[0])?.name ?? '') : undefined;

  return (
    <Wheel
      key={`${session.id}:${session.kind}`}
      kind={session.kind === 'convert' ? 'convert' : 'tools'}
      title={t(`wheel.${session.kind}`)}
      subtitle={subtitle ?? t('wheel.files', { count: view.paths.length })}
      slices={view.slices}
      overlay
      control={control}
      sound={settings.sound}
      reducedMotion={reducedMotion()}
      size={settings.wheelSize}
      onTick={mac ? () => void api.haptic() : undefined}
      onBack={view.back ? () => setRing(view.back!()) : undefined}
      onClose={finish}
      onApply={(id) => {
        const next = view.apply(id);
        // A category opens its ring in place: the wheel turns to the new slices and stays open.
        if (next) {
          setRing(next);
          return;
        }
        if (session.kind === 'convert') run(api.convert(view.paths, id));
        else if (session.kind === 'tools') {
          run(id === 'extract' ? api.extract(view.paths) : api.openTool(id, view.paths));
        } else run(api.runAction(id, view.paths));
      }}
    />
  );
}
