// SPDX-License-Identifier: MIT
// The floating wheel (SPEC 5.2, 5.3): its own transparent window, moved under the pointer by the
// core when a wheel key is pressed during a drag. The drag itself tells what it carries when it
// enters the window: files get the wheel of the key held, and a link or a media card out of a
// browser gets the download ring whichever key is held (SPEC 5.10). The drop on a slice runs the
// choice; resting on a slice with choices opens them, and resting on the hub comes back. Without a drag (the selection shortcut, Send To) the files come with the session and
// the wheel takes the keyboard; with nothing selected and window layouts on, the selection
// shortcut opens the Window ring for the window that was in front (SPEC 5.12).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadRing, slicesFor, subtitleFor, type Plan, type Ring } from '../app/slices';
import { windowRing } from '../app/windowRing';
import { isRtl } from '../i18n';
import { api, type DragOver, type FileEntry, type WheelKey, type WheelSession } from '../ipc';
import { useApp } from '../state/store';
import { siteName } from '../web/links';
import { useLook } from '../theme/registry';
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
  // A web address the drag carries instead of files.
  const [link, setLink] = useState<string | null>(null);
  const [ring, setRing] = useState<Ring | null>(null);
  // The theme's pack loaded with the window, so the wheel opens at once in any theme.
  const look = useLook(settings?.theme ?? 'steel', settings?.appearance ?? 'system');
  const control = useRef<WheelControl>(null);
  const sessionRef = useRef<WheelSession | null>(null);

  // Sessions from the core, and the drag over this window.
  useEffect(() => {
    // A wheel on screen closes with its animation; a session that never showed one (nothing was
    // known yet, or nothing fits) ends at once, so the window does not wait under the pointer.
    const dismiss = () => {
      if (control.current) return control.current.close();
      sessionRef.current = null;
      setSession(null);
      setFiles([]);
      setLink(null);
      setRing(null);
      void api.wheelClosed();
    };
    const open = (next: WheelSession) => {
      const same = sessionRef.current?.id === next.id;
      sessionRef.current = next;
      setSession(next);
      setRing(null);
      if (!same) setLink(null);
      if (next.paths.length) void api.inspect(next.paths).then(setFiles);
      else if (!same) setFiles([]);
    };
    const onDrag = (event: DragOver) => {
      if (!sessionRef.current) return;
      if (event.type === 'enter') {
        if (event.link) {
          setFiles([]);
          setLink(event.link);
        } else if (event.paths.length) {
          setLink(null);
          void api.inspect(event.paths).then(setFiles);
        } else {
          // Neither files nor a link (a piece of text): the wheel has nothing to offer.
          return dismiss();
        }
        control.current?.point(event.x, event.y);
      } else if (event.type === 'over') {
        control.current?.point(event.x, event.y);
      } else if (event.type === 'drop') {
        // Dropped before the ring was ready: nothing was chosen.
        if (!control.current) return dismiss();
        void api.wheelDropped();
        control.current.drop(event.x, event.y);
      } else {
        control.current?.leave();
      }
    };
    void api.wheelSession().then((current) => current && open(current));
    const stops = [api.onWheelOpen(open), api.onWheelClose(dismiss), api.onDrag(onDrag)];
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, []);

  // The ring for the session's wheel and files, or the download ring for a link.
  const paths = files.map((file) => file.path);
  const key = session ? `${session.id}:${link ? `link:${link}` : `${session.kind}:${paths.join('\u0001')}`}` : '';
  useEffect(() => {
    // The Window ring needs nothing loaded; it is drawn as it is below.
    if (!session || session.kind === 'window' || (!files.length && !link)) return;
    let live = true;
    void (link ? downloadRing(link) : slicesFor(session.kind, files)).then((next) => {
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

  // Without a drag the wheel has the keyboard: a wheel key switches wheels (not from the Window
  // ring, which has no files), leaving closes it.
  useEffect(() => {
    if (session?.mode !== 'click' || !settings) return;
    const onKey = (event: KeyboardEvent) => {
      if (session.kind === 'window') return;
      const pressed = KEY_OF[event.key];
      const kind = (['convert', 'tools', 'actions'] as const).find((k) => settings.wheels[k] === pressed);
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
    setLink(null);
    setRing(null);
    void api.wheelClosed();
  };

  // The slices are made once per ring and language: a choice reorders the recent ones, and the
  // ring on screen must not change under its apply animation.
  const lang = i18n.language;
  const windowKind = session?.kind === 'window';
  const view = useMemo(() => {
    const shown = windowKind ? windowRing(isRtl(lang)) : ring;
    return shown?.view(t, (k) => i18n.exists(k), mac, lang) ?? null;
  }, [windowKind, ring, t, i18n, mac, lang]);
  if (!session || !settings || !view) return null;
  const run = (promise: Promise<unknown>) =>
    promise.catch((error) => void api.log('warn', `wheel choice failed: ${String(error)}`));
  const subtitle = link
    ? siteName(link)
    : session.kind === 'window'
      ? (session.window ?? '')
      : subtitleFor(view, files, t);
  // The main window opens tool windows; the core tells how jobs and reports went in the corner.
  const carry = (plan: Plan) => {
    if (plan.kind === 'setup') run(api.openSetup());
    else if (plan.kind === 'panel') run(api.openTool(plan.tool, plan.paths));
    else if (plan.kind === 'run') run(plan.start());
    else if (plan.kind === 'qr-report')
      run(api.scanQr(plan.paths).then((found) => api.saveQrReport(found, plan.report)));
  };

  return (
    <Wheel
      key={link ? `${session.id}:link` : `${session.id}:${session.kind}`}
      kind={session.kind === 'convert' && !link ? 'convert' : 'tools'}
      title={view.title}
      subtitle={subtitle}
      slices={view.slices}
      overlay
      control={control}
      sound={settings.sound}
      reducedMotion={reducedMotion()}
      size={settings.wheelSize}
      look={look}
      keyName={session.kind === 'window' ? '' : t(`key.${settings.wheels[session.kind]}.${mac ? 'mac' : 'windows'}`)}
      onTick={mac ? () => void api.haptic() : undefined}
      onClose={finish}
      onApply={(id, trail) => carry(view.choose(id, trail))}
    />
  );
}
