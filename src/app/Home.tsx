// SPDX-License-Identifier: MIT
// Home: the drop zone, recent results, the tool groups' setup state and running jobs. Dropping,
// choosing and pasting files arrive with the engines in Phase 2.
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import { formatDuration } from '../i18n/format';
import { api } from '../ipc';
import { useApp } from '../state/store';

/** The deposit slot of the steel theme, with the blue arrow going in. */
function DepositSlot() {
  return (
    <svg className="deposit" viewBox="0 0 76 52" width="76" height="52" aria-hidden="true">
      <defs>
        <linearGradient id="deposit-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--steel-hi)" />
          <stop offset="0.55" stopColor="var(--steel-mid)" />
          <stop offset="1" stopColor="var(--steel-lo)" />
        </linearGradient>
      </defs>
      <rect x="4" y="30" width="68" height="20" rx="5" fill="url(#deposit-steel)" stroke="var(--border-strong)" />
      <rect x="14" y="38" width="48" height="5" rx="2.5" fill="var(--slot)" />
      <path
        d="M38 4v28M31 25.5 38 32.5 45 25.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const GROUPS = [
  { id: 'core', status: 'ready' },
  { id: 'media', status: 'missing' },
  { id: 'office', status: 'missing' },
  { id: 'extras', status: 'optional' },
] as const;

export function Home() {
  const { t } = useTranslation();
  const { boot, jobs, paused, language } = useApp();
  const mac = boot?.app.platform === 'macos';
  const active = Object.values(jobs).filter((job) => job.state === 'queued' || job.state === 'running');

  return (
    <div className="page home">
      <section className="drop" aria-labelledby="drop-title">
        <DepositSlot />
        <h1 id="drop-title" className="drop-title">
          {t('home.drop.title')}
        </h1>
        <div className="drop-actions">
          <button type="button" className="button primary" disabled>
            {t('home.drop.choose')}
          </button>
          <span className="muted">{t('home.drop.paste', { shortcut: mac ? '⌘V' : 'Ctrl+V' })}</span>
        </div>
      </section>

      <section className="card recent" aria-labelledby="recent-title">
        <h2 id="recent-title" className="card-title">
          {t('home.recent.title')}
        </h2>
        <p className="muted">{t('home.recent.empty')}</p>
      </section>

      <div className="home-row">
        <section className="card" aria-labelledby="tools-title">
          <h2 id="tools-title" className="card-title">
            {t('home.tools.title')}
          </h2>
          <ul className="groups">
            {GROUPS.map((group) => (
              <li key={group.id} className="group" data-status={group.status}>
                <span className="dot" aria-hidden="true" />
                <span className="group-name">{t(`group.${group.id}`)}</span>
                <span className="group-detail muted">{t(`group.${group.id}.detail`)}</span>
                <span className="group-status">{t(`home.tools.status.${group.status}`)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="jobs-title">
          <div className="card-head">
            <h2 id="jobs-title" className="card-title">
              {t('home.jobs.title')}
            </h2>
            {paused && <span className="badge">{t('home.jobs.paused')}</span>}
            <button type="button" className="button quiet small" onClick={() => void api.setJobsPaused(!paused)}>
              <Icon name={paused ? 'play' : 'pause'} size={16} />
              {t(paused ? 'tray.resume' : 'tray.pause')}
            </button>
          </div>
          {active.length === 0 ? (
            <p className="muted">{t('home.jobs.empty')}</p>
          ) : (
            <ul className="jobs">
              {active.map((job) => (
                <li key={job.id} className="job">
                  <bdi className="job-title">{job.title}</bdi>
                  {job.state === 'running' && (
                    <>
                      <span
                        className="scale"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={job.progress == null ? undefined : Math.round(job.progress * 100)}
                      >
                        <span style={{ inlineSize: `${Math.round((job.progress ?? 0) * 100)}%` }} />
                      </span>
                      {job.etaMs != null && <span className="muted">{formatDuration(job.etaMs, language)}</span>}
                    </>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('home.jobs.cancel', { name: job.title })}
                    onClick={() => void api.cancelJob(job.id)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
