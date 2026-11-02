// SPDX-License-Identifier: MIT
// Settings › Updates (SPEC 5.16, 5.17): the version, the last check, where an update stands, "Check
// now" and why updates are not optional. The core looks, downloads and installs, and sends every
// change; a Mac app Kento may not change installs on "Update and restart", a translocated one asks
// to be moved to Applications, and a development build points to the release page.
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelative } from '../i18n/format';
import { api, type UpdateView } from '../ipc';
import { useApp } from '../state/store';
import { Group, Row } from './Settings';
import { useNow } from './useNow';

/** Where the update stands, a line each. Pure, so it is tested. */
export function updateLines(view: UpdateView, t: TFunction): string[] {
  const status = view.status;
  switch (status.state) {
    case 'idle':
      return [t('settings.updates.status.idle')];
    case 'checking':
      return [t('settings.updates.status.checking')];
    case 'upToDate':
      return [t('settings.updates.status.upToDate')];
    case 'available':
      return [t('settings.updates.status.available', { version: status.version })];
    case 'downloading':
      return [t('settings.updates.status.downloading', { version: status.version })];
    case 'confirm':
      return [t('settings.updates.status.confirm', { version: status.version })];
    case 'waiting':
      return [
        t('settings.updates.status.waiting', { version: status.version }),
        ...(status.jobs > 0 ? [t('settings.updates.waiting.jobs', { count: status.jobs })] : []),
        ...(status.jobs > 0 && status.paused ? [t('settings.updates.waiting.paused')] : []),
        ...(status.editing ? [t('settings.updates.waiting.editing')] : []),
        ...(status.installs ? [t('settings.updates.waiting.installs')] : []),
      ];
    case 'restarting':
      return [t('settings.updates.status.restarting', { version: status.version })];
    case 'failed':
      return [t(`settings.updates.failed.${status.reason}`)];
  }
}

/** Ctrl+U (⌘U on macOS), which looks for a new version from any Kento window. */
export function isUpdateShortcut(event: KeyboardEvent, mac: boolean): boolean {
  return (mac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'u';
}

/** What this kind of copy adds to the policy: why it waits, cannot update or never does. */
const KIND_NOTES: Partial<Record<UpdateView['kind'], string>> = {
  lockedBundle: 'settings.updates.locked',
  translocated: 'settings.updates.translocated',
  development: 'settings.updates.development',
};

export function UpdateSettings() {
  const { t } = useTranslation();
  const { boot, language, revealUpdates } = useApp();
  const [view, setView] = useState<UpdateView | null>(null);
  const now = useNow();

  useEffect(() => {
    void api.updatesView().then(setView);
    const stop = api.onUpdates(setView);
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  // Ctrl+U and the tray menu bring this group into view, once it has something to show.
  useEffect(() => {
    if (!view || !revealUpdates) return;
    document.getElementById('updates')?.scrollIntoView({ block: 'start' });
    useApp.setState({ revealUpdates: false });
  }, [view, revealUpdates]);

  if (!view) return null;
  const mac = boot?.app.platform === 'macos';
  const status = view.status;
  const busy = ['checking', 'downloading', 'confirm', 'waiting', 'restarting'].includes(status.state);
  const kindNote = KIND_NOTES[view.kind];

  return (
    <Group title={t('settings.updates.title')} anchor="updates">
      <Row label={t('settings.updates.version')}>
        <span>{view.current}</span>
      </Row>
      <Row label={t('settings.updates.lastCheck')}>
        <span className="muted">
          {view.lastCheck == null ? t('settings.updates.never') : formatRelative(view.lastCheck, now, language)}
        </span>
      </Row>
      <div className="update-status" role="status" aria-live="polite">
        {updateLines(view, t).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {status.state === 'downloading' && (
          <span
            className="scale"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status.total ? Math.round((status.received / status.total) * 100) : undefined}
            data-indeterminate={!status.total || undefined}
          >
            <span
              style={{ inlineSize: status.total ? `${Math.min(100, (status.received / status.total) * 100)}%` : '0%' }}
            />
          </span>
        )}
      </div>
      <div className="links">
        <button
          type="button"
          className="button"
          disabled={busy}
          aria-keyshortcuts={mac ? 'Meta+U' : 'Control+U'}
          onClick={() => void api.updatesCheck(false)}
        >
          {t('settings.updates.check')}
        </button>
        {status.state === 'confirm' && (
          <button type="button" className="button primary" onClick={() => void api.updatesInstall()}>
            {t('settings.updates.install')}
          </button>
        )}
        {view.kind === 'development' && (
          <button type="button" className="button" onClick={() => void api.openLink('releases')}>
            {t('settings.updates.releases')}
          </button>
        )}
      </div>
      {kindNote && <p className="note">{t(kindNote)}</p>}
      <p className="muted note">{t('settings.updates.policy')}</p>
      <p className="muted note">{t('settings.updates.shortcut', { shortcut: mac ? '⌘U' : 'Ctrl+U' })}</p>
    </Group>
  );
}
