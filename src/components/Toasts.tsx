// SPDX-License-Identifier: MIT
// The cards in the corner (SPEC 5.13): "Ready" with Show and Open when a job ends, a plain
// explanation with "Copy details" when it fails, and short notes. A card leaves after a few
// seconds unless the pointer or focus is on it.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type LibraryEntry } from '../ipc';
import { useApp, type Toast } from '../state/store';
import { Icon } from './Icon';

const STAY_MS = 4000;
const STAY_FAILED_MS = 12000;

function Card({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const { dismiss, boot } = useApp();
  const [held, setHeld] = useState(false);
  const [items, setItems] = useState<LibraryEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const mac = boot?.app.platform === 'macos';

  useEffect(() => {
    if (toast.kind === 'done') void api.libraryFind(toast.outputs).then(setItems);
  }, [toast]);

  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.kind === 'failed' ? STAY_FAILED_MS : STAY_MS);
    return () => clearTimeout(timer);
  }, [held, toast, dismiss]);

  const first = items[0];
  return (
    <div
      className="toast"
      data-kind={toast.kind}
      role={toast.kind === 'failed' ? 'alert' : 'status'}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <Icon name={toast.kind === 'failed' ? 'close' : 'check'} size={18} className="toast-mark" />
      <div className="toast-text">
        {toast.kind === 'info' && <span>{toast.message}</span>}
        {toast.kind === 'done' && (
          <>
            <strong>{t('toast.ready')}</strong>
            <bdi>{first ? first.name : toast.title}</bdi>
          </>
        )}
        {toast.kind === 'failed' && (
          <>
            <strong>
              <bdi>{toast.title}</bdi>
            </strong>
            <span>{toast.message}</span>
          </>
        )}
      </div>
      <div className="toast-actions">
        {toast.kind === 'done' && first && (
          <>
            <button type="button" className="button small" onClick={() => void api.libraryReveal(first.id)}>
              {t(mac ? 'action.reveal.mac' : 'action.reveal.windows')}
            </button>
            {!first.folder && (
              <button type="button" className="button quiet small" onClick={() => void api.libraryOpen(first.id)}>
                {t('library.open')}
              </button>
            )}
          </>
        )}
        {toast.kind === 'failed' && toast.details && (
          <button
            type="button"
            className="button quiet small"
            onClick={() =>
              void navigator.clipboard
                .writeText(`${toast.title}\n${toast.message}\n${toast.details}`)
                .then(() => setCopied(true))
            }
          >
            {t(copied ? 'toast.copied' : 'toast.details')}
          </button>
        )}
        <button type="button" className="icon-button" aria-label={t('toast.close')} onClick={() => dismiss(toast.id)}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((state) => state.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <Card key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
