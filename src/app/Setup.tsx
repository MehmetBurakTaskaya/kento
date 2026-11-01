// SPDX-License-Identifier: MIT
// Tool setup (SPEC 5.15): the optional tool groups, what each holds and needs to download, and an
// install that shows its progress, can be cancelled, resumes and can be retried. Tools already on
// the computer are used as they are. Kento goes online only when the user starts an install.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { formatBytes } from '../i18n/format';
import { api, type InstallProgress, type ToolGroupStatus } from '../ipc';
import { useApp } from '../state/store';

export function useToolStatus() {
  const [groups, setGroups] = useState<ToolGroupStatus[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api.toolsStatus().then((status) => live && setGroups(status));
    load();
    const stop = api.onToolsProgress((progress) => progress.state === 'ready' && load());
    return () => {
      live = false;
      void stop.then((unlisten) => unlisten());
    };
  }, []);
  return [groups, setGroups] as const;
}

export function Setup() {
  const { t } = useTranslation();
  const { setup, closeSetup, language } = useApp();
  const [groups] = useToolStatus();
  const [progress, setProgress] = useState<Record<string, InstallProgress>>({});

  useEffect(() => {
    const stop = api.onToolsProgress((next) => setProgress((current) => ({ ...current, [next.group]: next })));
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  if (!setup) return null;
  return (
    <Dialog title={t('setup.title')} onClose={closeSetup}>
      <p className="muted">{t('setup.text')}</p>
      <ul className="setup-groups">
        {(groups ?? []).map((group) => {
          const state = progress[group.id];
          const busy =
            state && (state.state === 'downloading' || state.state === 'verifying' || state.state === 'unpacking');
          return (
            <li key={group.id} className="setup-group" data-ready={group.ready || undefined}>
              <div className="setup-head">
                <span className="dot" aria-hidden="true" />
                <strong>{t(`group.${group.id}`)}</strong>
                <span className="muted">{t(`group.${group.id}.detail`)}</span>
              </div>
              {group.ready ? (
                <p className="setup-state">
                  <Icon name="check" size={16} />
                  {t('setup.ready')}
                  {group.tools.some((tool) => tool.source === 'system') && (
                    <span className="muted"> · {t('setup.system')}</span>
                  )}
                </p>
              ) : !group.available ? (
                <p className="muted">{t('setup.later')}</p>
              ) : busy ? (
                <div className="setup-progress">
                  <span
                    className="scale"
                    role="progressbar"
                    aria-label={t('setup.downloading')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={
                      state.state === 'downloading' && state.total
                        ? Math.round((state.done / state.total) * 100)
                        : undefined
                    }
                    data-indeterminate={state.state !== 'downloading' || undefined}
                  >
                    <span
                      style={{
                        inlineSize:
                          state.state === 'downloading' && state.total ? `${(state.done / state.total) * 100}%` : '0%',
                      }}
                    />
                  </span>
                  <span className="muted">
                    {state.state === 'downloading'
                      ? t('setup.progress', {
                          done: formatBytes(state.done, language),
                          total: formatBytes(state.total, language),
                        })
                      : t(`setup.${state.state}`)}
                  </span>
                  <button type="button" className="button quiet small" onClick={() => void api.toolsCancel(group.id)}>
                    {t('tools.cancel')}
                  </button>
                </div>
              ) : (
                <div className="setup-actions">
                  {state?.state === 'failed' && <p className="error-text">{state.message}</p>}
                  <button type="button" className="button primary" onClick={() => void api.toolsInstall(group.id)}>
                    {t(state?.state === 'failed' ? 'setup.retry' : 'setup.install', {
                      size: formatBytes(group.download, language),
                    })}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="note muted">{t('setup.privacy')}</p>
    </Dialog>
  );
}
