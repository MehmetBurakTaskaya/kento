// SPDX-License-Identifier: MIT
// The corner card window (SPEC 5.13) for jobs started from the floating wheel, the shelf or
// Explorer. Clicking a card shows the file; a card can be dragged by its body; each leaves after a
// few seconds unless the pointer rests on it. The window takes the height of its cards.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import { api, type CornerCard, type LibraryEntry } from '../ipc';
import { useApp } from '../state/store';
import { useSurface } from './useSurface';

const STAY_MS = 4500;
const STAY_FAILED_MS = 12000;

function Card({ card, onGone }: { card: CornerCard; onGone(id: number): void }) {
  const { t } = useTranslation();
  const mac = useApp((state) => state.boot?.app.platform === 'macos');
  const [held, setHeld] = useState(false);
  const [item, setItem] = useState<LibraryEntry | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (card.kind === 'done') void api.libraryFind(card.outputs).then((found) => setItem(found[0] ?? null));
  }, [card]);

  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => onGone(card.id), card.kind === 'failed' ? STAY_FAILED_MS : STAY_MS);
    return () => clearTimeout(timer);
  }, [held, card, onGone]);

  return (
    <div
      className="toast"
      data-kind={card.kind}
      role={card.kind === 'failed' ? 'alert' : 'status'}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
    >
      <Icon name={card.kind === 'failed' ? 'close' : 'check'} size={18} className="toast-mark" />
      <div
        className="toast-text"
        data-tauri-drag-region
        onClick={() => item && void api.libraryReveal(item.id)}
        title={item ? t(mac ? 'action.reveal.mac' : 'action.reveal.windows') : undefined}
      >
        {card.kind === 'info' && <span data-tauri-drag-region>{card.message}</span>}
        {card.kind === 'done' && (
          <>
            <strong data-tauri-drag-region>{t('toast.ready')}</strong>
            <bdi data-tauri-drag-region>{item?.name ?? card.title}</bdi>
          </>
        )}
        {card.kind === 'failed' && (
          <>
            <strong data-tauri-drag-region>
              <bdi>{card.title}</bdi>
            </strong>
            <span data-tauri-drag-region>{card.message}</span>
          </>
        )}
      </div>
      <div className="toast-actions">
        {card.kind === 'done' && item && !item.folder && (
          <button type="button" className="button small" onClick={() => void api.libraryOpen(item.id)}>
            {t('library.open')}
          </button>
        )}
        {card.kind === 'failed' && card.details && (
          <button
            type="button"
            className="button quiet small"
            onClick={() =>
              void navigator.clipboard
                .writeText(`${card.title}\n${card.message}\n${card.details}`)
                .then(() => setCopied(true))
            }
          >
            {t(copied ? 'toast.copied' : 'toast.details')}
          </button>
        )}
        <button type="button" className="icon-button" aria-label={t('toast.close')} onClick={() => onGone(card.id)}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}

export function ToastSurface() {
  useSurface();
  const [cards, setCards] = useState<CornerCard[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.toastCards().then(setCards);
    const stop = api.onToast((card) =>
      setCards((current) => [...current.filter((c) => c.id !== card.id), card].slice(-4)),
    );
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  // The window fits its cards; with none left the core moves it away.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const report = () => void api.toastLayout(cards.length ? Math.ceil(element.getBoundingClientRect().height) : 0);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [cards]);

  const gone = (id: number) => {
    setCards((current) => current.filter((card) => card.id !== id));
    void api.toastDismiss(id);
  };

  return (
    <div ref={box} className="corner-cards">
      {cards.map((card) => (
        <Card key={card.id} card={card} onGone={gone} />
      ))}
    </div>
  );
}
