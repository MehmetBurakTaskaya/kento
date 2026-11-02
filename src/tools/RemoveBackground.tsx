// SPDX-License-Identifier: MIT
// Remove background (SPEC 5.5 [+]): the pictures, one of them shown cut out on a checkerboard, and
// one job per picture, each writing a PNG with a transparent background. The model runs once for
// a preview; saving that picture afterwards uses the same result.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { FileIcon } from '../components/FileIcon';
import { Icon } from '../components/Icon';
import { api, type FileEntry } from '../ipc';
import { useApp } from '../state/store';
import '../styles/cutout.css';

/** The preview's longer side, in pixels. */
export const PREVIEW_SIZE = 720;

interface Cutout {
  url: string | null;
  error: string | null;
  working: boolean;
}

/** The preview of one picture; it changes with the picture, and its object URL is let go then. */
function useCutout(path: string | null): Cutout {
  const [result, setResult] = useState<{ path: string; url: string | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    let url: string | null = null;
    api
      .backgroundPreview(path, PREVIEW_SIZE)
      .then((png) => {
        if (!live) return;
        url = URL.createObjectURL(png);
        setResult({ path, url, error: null });
      })
      .catch((reason) => live && setResult({ path, url: null, error: String(reason) }));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  const mine = result && result.path === path ? result : null;
  return { url: mine?.url ?? null, error: mine?.error ?? null, working: Boolean(path) && !mine };
}

export function RemoveBackgroundPanel({ entries, onClose }: { entries: FileEntry[]; onClose(): void }) {
  const { t } = useTranslation();
  const { started } = useApp();
  const pictures = entries.filter((entry) => entry.category === 'image');
  const [shown, setShown] = useState(0);
  const current = pictures[shown] ?? pictures[0] ?? null;
  const preview = useCutout(current?.path ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    if (busy || pictures.length === 0) return;
    setBusy(true);
    setError(null);
    api
      .removeBackground(pictures.map((entry) => entry.path))
      .then((ids) => {
        started(ids);
        onClose();
      })
      .catch((reason) => {
        setError(String(reason));
        setBusy(false);
      });
  };

  return (
    <Dialog
      wide
      title={t('tool.remove-background')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button quiet" onClick={onClose}>
            {t('tools.cancel')}
          </button>
          <button type="button" className="button primary" disabled={busy || pictures.length === 0} onClick={start}>
            {t('cutout.run', { count: pictures.length })}
          </button>
        </>
      }
    >
      <div className="cutout-panel">
        <figure className="cutout-stage" aria-busy={preview.working}>
          {preview.url ? (
            <img src={preview.url} alt={t('cutout.preview', { name: current?.name ?? '' })} />
          ) : (
            <div className="stage-placeholder" role="status">
              <Icon name="cutout" size={32} />
              <span>{preview.error ?? t(preview.working ? 'cutout.working' : 'cutout.none')}</span>
            </div>
          )}
        </figure>
        <div className="cutout-side">
          {pictures.length > 1 && (
            <ul className="cutout-files" aria-label={t('cutout.pictures')}>
              {pictures.map((entry, index) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className="cutout-file"
                    aria-pressed={entry.path === current?.path}
                    onClick={() => setShown(index)}
                  >
                    <FileIcon path={entry.path} category={entry.category} size={24} />
                    <bdi className="file-name">{entry.name}</bdi>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pictures.length === 1 && current && (
            <p>
              <bdi className="file-name">{current.name}</bdi>
            </p>
          )}
          <p className="muted">{t('cutout.text')}</p>
          <p className="muted">{t('cutout.slow')}</p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
