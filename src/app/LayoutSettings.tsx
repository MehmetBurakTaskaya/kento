// SPDX-License-Identifier: MIT
// Settings › Window layouts (SPEC 5.12, 5.17): the switch (off by default), the shortcuts and
// whether another app holds one, and on macOS the Accessibility permission with a way to System
// Settings. On macOS, switching the feature on without the permission first says why Kento asks,
// then shows the system's prompt.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { api, type LayoutStatus, type Settings as SettingsData } from '../ipc';
import { useApp } from '../state/store';
import { Group, Row, Switch } from './Settings';
import './layouts.css';

type Layouts = SettingsData['layouts'];

export function LayoutSettings() {
  const { t } = useTranslation();
  const { boot, settings, update } = useApp();
  const [status, setStatus] = useState<LayoutStatus | null>(null);
  const [explaining, setExplaining] = useState(false);
  const layouts = settings?.layouts;

  // Which shortcuts another app holds changes with the settings; the permission can change in
  // System Settings while Kento waits, so it is read again when the window comes back.
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void api
        .layoutsStatus()
        .then((next) => live && setStatus(next))
        .catch(() => {});
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      window.removeEventListener('focus', refresh);
    };
  }, [layouts?.enabled, layouts?.shortcuts]);

  if (!boot || !layouts) return null;
  const mac = boot.app.platform === 'macos';
  const set = (patch: Partial<Layouts>) => void update({ layouts: { ...layouts, ...patch } });
  const switchOn = (enabled: boolean) => {
    if (enabled && status?.permission === 'missing') setExplaining(true);
    else set({ enabled });
  };
  // The system's prompt comes only now, after Kento has said why it asks.
  const allow = () => {
    setExplaining(false);
    set({ enabled: true });
    void api
      .layoutsAskPermission()
      .then(setStatus)
      .catch(() => {});
  };
  const active = layouts.enabled && layouts.shortcuts;

  return (
    <Group title={t('settings.layouts.title')}>
      <Row label={t('settings.layouts.enabled')}>
        <Switch label={t('settings.layouts.enabled')} checked={layouts.enabled} onChange={switchOn} />
      </Row>
      <Row label={t('settings.layouts.shortcuts')}>
        <Switch
          label={t('settings.layouts.shortcuts')}
          checked={layouts.shortcuts}
          onChange={(shortcuts) => set({ shortcuts })}
        />
      </Row>
      {status && (
        <dl className={active ? 'layout-keys' : 'layout-keys is-off'} aria-label={t('settings.layouts.list')}>
          {status.shortcuts.map((shortcut) => (
            <div key={shortcut.layout} className="layout-key">
              <dt>{t(`layout.${shortcut.layout}`)}</dt>
              <dd>
                <kbd dir="ltr">{shortcut.keys}</kbd>
                {active && shortcut.taken && <span className="layout-taken">{t('settings.layouts.taken')}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {mac && status && status.permission !== 'not-needed' && (
        <Row label={t('settings.layouts.permission')}>
          <span className="layout-permission">
            <span className="muted" role="status">
              {t(
                status.permission === 'granted'
                  ? 'settings.layouts.permission.granted'
                  : 'settings.layouts.permission.missing',
              )}
            </span>
            <button type="button" className="button small" onClick={() => void api.layoutsOpenPermissionSettings()}>
              {t('settings.layouts.permission.open')}
            </button>
          </span>
        </Row>
      )}
      <p className="note muted">
        {t('settings.layouts.ring', { shortcut: mac ? '⌃⇧Space' : 'Ctrl+Shift+Space' })}
        {!mac && ` ${t('settings.layouts.snap')}`}
      </p>
      {explaining && (
        <Dialog
          title={t('settings.layouts.ask.title')}
          onClose={() => setExplaining(false)}
          footer={
            <>
              <button type="button" className="button" onClick={() => setExplaining(false)}>
                {t('settings.layouts.ask.later')}
              </button>
              <button type="button" className="button primary" onClick={allow}>
                {t('settings.layouts.ask.continue')}
              </button>
            </>
          }
        >
          <p className="prose">{t('settings.layouts.ask.text')}</p>
          <p className="prose muted">{t('settings.layouts.ask.scope')}</p>
        </Dialog>
      )}
    </Group>
  );
}
