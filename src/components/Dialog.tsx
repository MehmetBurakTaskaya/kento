// SPDX-License-Identifier: MIT
// A modal panel: Esc or the backdrop closes it, focus starts inside and comes back afterwards. An
// open dialog holds the user's work (a tool's choices, an editor, a rule being written), so an
// update that is ready to install waits until the last one closes.
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../ipc';
import { Icon } from './Icon';

/** The dialogs open in this window. */
let open = 0;

function useHoldsWork() {
  useEffect(() => {
    if (open++ === 0) void api.updatesEditing(true);
    return () => {
      if (--open === 0) void api.updatesEditing(false);
    };
  }, []);
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  useHoldsWork();

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input, select, button:not(.dialog-close), [tabindex="0"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      before?.focus();
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className={wide ? 'dialog wide' : 'dialog'}
      >
        <header className="dialog-head">
          <h2 id="dialog-title" className="card-title">
            {title}
          </h2>
          <button type="button" className="icon-button dialog-close" aria-label={t('toast.close')} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}
