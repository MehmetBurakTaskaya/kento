// SPDX-License-Identifier: MIT
// Home (SPEC 5.9): the drop zone, the files to work on, recent results, the tool groups' setup
// state and running jobs. Files arrive by dropping, choosing (Ctrl+O) or pasting (Ctrl+V).
import { useTranslation } from 'react-i18next';
import { FileIcon } from '../components/FileIcon';
import { Icon } from '../components/Icon';
import { formatDuration } from '../i18n/format';
import { api } from '../ipc';
import { useApp } from '../state/store';
import { FileList } from './FileList';
import { chooseFiles } from './input';

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
  const { boot, jobs, paused, language, files, selected, library, openWheel, target, removeFiles } = useApp();
  const mac = boot?.app.platform === 'macos';
  const active = Object.values(jobs).filter((job) => job.state === 'queued' || job.state === 'running');
  const recent = library.filter((item) => item.exists).slice(0, 6);
  const count = selected.size || files.length;

  return (
    <div className="page home">
      <section className={files.length ? 'drop compact' : 'drop'} aria-labelledby="drop-title">
        <DepositSlot />
        <h1 id="drop-title" className="drop-title">
          {t('home.drop.title')}
        </h1>
        <div className="drop-actions">
          <button
            type="button"
            className={files.length ? 'button' : 'button primary'}
            aria-keyshortcuts={mac ? 'Meta+O' : 'Control+O'}
            onClick={() => void chooseFiles()}
          >
            {t('home.drop.choose')}
          </button>
          <span className="muted">{t('home.drop.paste', { shortcut: mac ? '⌘V' : 'Ctrl+V' })}</span>
        </div>
      </section>

      {files.length > 0 && (
        <section className="card files" aria-labelledby="files-title">
          <div className="card-head">
            <h2 id="files-title" className="card-title">
              {t('home.files.title', { count: files.length })}
            </h2>
            <div className="card-actions">
              <button
                type="button"
                className="button primary small"
                aria-keyshortcuts="Enter"
                onClick={() => openWheel('convert', target())}
              >
                <Icon name="dial" size={16} />
                {t('home.files.convert', { count })}
              </button>
              <button
                type="button"
                className="button small"
                aria-keyshortcuts={mac ? 'Meta+Space' : 'Control+Space'}
                onClick={() => openWheel('tools', target())}
              >
                <Icon name="sliders" size={16} />
                {t('home.files.tools')}
              </button>
              <button
                type="button"
                className="button small"
                aria-keyshortcuts="Alt+Enter"
                onClick={() => openWheel('actions', target())}
              >
                <Icon name="share" size={16} />
                {t('wheel.actions')}
              </button>
              <button
                type="button"
                className="button quiet small"
                onClick={() => removeFiles(files.map((f) => f.path))}
              >
                {t('home.files.clear')}
              </button>
            </div>
          </div>
          <FileList />
        </section>
      )}

      <section className="card recent" aria-labelledby="recent-title">
        <h2 id="recent-title" className="card-title">
          {t('home.recent.title')}
        </h2>
        {recent.length === 0 ? (
          <p className="muted">{t('home.recent.empty')}</p>
        ) : (
          <ul className="recent-strip">
            {recent.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="recent-item"
                  title={item.name}
                  onClick={() => void api.libraryOpen(item.id)}
                >
                  <FileIcon path={item.path} category={item.category} folder={item.folder} size={48} />
                  <bdi className="recent-name">{item.name}</bdi>
                </button>
              </li>
            ))}
          </ul>
        )}
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
                        data-indeterminate={job.progress == null || undefined}
                      >
                        <span style={{ inlineSize: `${Math.round((job.progress ?? 0) * 100)}%` }} />
                      </span>
                      {job.etaMs != null && (
                        <span className="muted">
                          {t('home.jobs.left', { time: formatDuration(job.etaMs, language) })}
                        </span>
                      )}
                    </>
                  )}
                  {job.state === 'queued' && <span className="muted">{t('home.jobs.queued')}</span>}
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
