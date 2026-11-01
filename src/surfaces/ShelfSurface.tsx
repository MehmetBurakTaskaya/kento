// SPDX-License-Identifier: MIT
// The shelf (SPEC 5.8): files on their way somewhere, in a narrow panel at the screen edge. Files
// are dropped on it and dragged out of it into a folder; the history below keeps what left, and
// both can be searched. Moved or deleted files say so.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FileIcon } from '../components/FileIcon';
import { Icon } from '../components/Icon';
import { formatRelative, matchesSearch } from '../i18n/format';
import { api, type ShelfItem, type ShelfView } from '../ipc';
import { useApp } from '../state/store';
import { useNow } from '../app/useNow';
import { useSurface } from './useSurface';

/** How far the pointer moves before pressing an item becomes dragging it out. */
const DRAG_START = 5;

export function ShelfSurface() {
  useSurface();
  const { t } = useTranslation();
  const language = useApp((state) => state.language);
  const mac = useApp((state) => state.boot?.app.platform === 'macos');
  const [view, setView] = useState<ShelfView>({ items: [], history: [] });
  const [query, setQuery] = useState('');
  const [over, setOver] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const now = useNow();

  useEffect(() => {
    const load = () => void api.shelfView().then(setView);
    load();
    const stops = [
      api.onShelf(load),
      api.onDragOver((event) => {
        if (event.type === 'enter' || event.type === 'over') setOver(true);
        else setOver(false);
        if (event.type === 'drop' && event.paths.length) void api.shelfAdd(event.paths);
      }),
    ];
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, []);

  const matches = (item: ShelfItem) => !query || matchesSearch(item.name, query, language);
  const items = view.items.filter(matches);
  const history = view.history.filter(matches);

  const onPointerDown = (event: PointerEvent, item: ShelfItem) => {
    if (event.button === 0 && item.present) press.current = { id: item.id, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent) => {
    const start = press.current;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_START) return;
    press.current = null;
    void api.shelfDrag([start.id]);
  };

  const row = (item: ShelfItem, inHistory: boolean) => (
    <li
      key={item.id}
      className="shelf-item"
      data-missing={!item.present || undefined}
      onPointerDown={(event) => onPointerDown(event, item)}
      onPointerMove={onPointerMove}
      onPointerUp={() => (press.current = null)}
      title={item.present ? t('shelf.drag') : t('library.missing')}
    >
      <FileIcon path={item.path} category={item.category} size={32} />
      <span className="shelf-text">
        <bdi className="file-name">{item.name}</bdi>
        <span className="muted">
          {item.present ? formatRelative(item.added, now, language) : t('library.missing')}
          {item.copy && ` · ${t('shelf.copy')}`}
        </span>
      </span>
      <span className="shelf-actions">
        {item.present && (
          <>
            <button
              type="button"
              className="icon-button"
              aria-label={t(mac ? 'action.reveal.mac' : 'action.reveal.windows')}
              onClick={() => void api.shelfReveal(item.id)}
            >
              <Icon name="folder" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t('library.wheel')}
              onClick={() => void api.shelfToWheel([item.id])}
            >
              <Icon name="dial" size={16} />
            </button>
          </>
        )}
        {!inHistory && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('shelf.remove', { name: item.name })}
            onClick={() => void api.shelfRemove(item.id)}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </span>
    </li>
  );

  return (
    <div className="shelf" data-over={over || undefined}>
      <header className="shelf-head" data-tauri-drag-region>
        <Icon name="shelf" size={18} />
        <h1 className="shelf-title" data-tauri-drag-region>
          {t('shelf.title')}
        </h1>
        <span className="muted" data-tauri-drag-region>
          {view.items.length}
        </span>
        <button type="button" className="icon-button" aria-label={t('shelf.hide')} onClick={() => void api.shelfHide()}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <label className="search">
        <Icon name="search" size={14} />
        <input
          type="search"
          value={query}
          placeholder={t('shelf.search')}
          aria-label={t('shelf.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {items.length === 0 ? (
        <p className="shelf-empty muted">{t('shelf.empty')}</p>
      ) : (
        <ul className="shelf-list">{items.map((item) => row(item, false))}</ul>
      )}
      {view.items.length > 0 && (
        <button type="button" className="button quiet small" onClick={() => void api.shelfClear()}>
          {t('shelf.clear')}
        </button>
      )}
      {view.history.length > 0 && (
        <section className="shelf-history">
          <button
            type="button"
            className="button quiet small"
            aria-expanded={showHistory}
            onClick={() => setShowHistory(!showHistory)}
          >
            <Icon name={showHistory ? 'up' : 'down'} size={14} />
            {t('shelf.history', { count: view.history.length })}
          </button>
          {showHistory && <ul className="shelf-list">{history.map((item) => row(item, true))}</ul>}
        </section>
      )}
    </div>
  );
}
