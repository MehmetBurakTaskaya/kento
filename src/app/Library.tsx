// SPDX-License-Identifier: MIT
// Library (SPEC 5.9): the last 50 exports and clipboard imports, with search (Ctrl+F) and a filter
// by kind. Removing an item takes it off the list only; the file stays where it is.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileIcon } from '../components/FileIcon';
import { Icon } from '../components/Icon';
import { formatBytes, formatRelative, isolate, matchesSearch } from '../i18n/format';
import { api, type Category, type LibraryEntry } from '../ipc';
import { useApp } from '../state/store';
import { useNow } from './useNow';

type Filter = 'all' | Category | 'folder';

function kindOf(item: LibraryEntry): Filter {
  return item.folder ? 'folder' : (item.category ?? 'all');
}

export function Library() {
  const { t } = useTranslation();
  const { library, language, boot, addFiles, openWheel } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const search = useRef<HTMLInputElement>(null);
  const mac = boot?.app.platform === 'macos';
  const now = useNow();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((mac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mac]);

  const kinds = useMemo(() => [...new Set(library.map(kindOf))].filter((kind) => kind !== 'all'), [library]);
  const shown = library.filter(
    (item) =>
      (filter === 'all' || kindOf(item) === filter) &&
      (!query || matchesSearch(`${item.name} ${item.source ?? ''}`, query, language)),
  );

  const sendToWheel = async (item: LibraryEntry) => {
    const [entry] = await addFiles([item.path]);
    if (entry) openWheel('convert', [entry.path]);
  };

  return (
    <div className="page library">
      <header className="page-head">
        <h1 className="page-title">{t('nav.library')}</h1>
        <span className="muted">{t('library.count', { count: library.length })}</span>
      </header>

      {library.length === 0 ? (
        <section className="card empty">
          <Icon name="library" size={32} />
          <h2 className="card-title">{t('library.empty.title')}</h2>
          <p className="muted">{t('library.empty.text')}</p>
        </section>
      ) : (
        <>
          <div className="library-bar">
            <label className="search">
              <Icon name="search" size={16} />
              <input
                ref={search}
                type="search"
                value={query}
                placeholder={t('library.search')}
                aria-label={t('library.search')}
                aria-keyshortcuts={mac ? 'Meta+F' : 'Control+F'}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="chips" role="radiogroup" aria-label={t('library.filter')}>
              {(['all', ...kinds] as Filter[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={filter === kind}
                  className="chip"
                  onClick={() => setFilter(kind)}
                >
                  {t(kind === 'all' ? 'library.all' : kind === 'folder' ? 'library.folders' : `category.${kind}`)}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="muted">{t('library.none')}</p>
          ) : (
            <ul className="library-list">
              {shown.map((item) => (
                <li key={item.id} className="library-item" data-missing={!item.exists || undefined}>
                  <FileIcon path={item.path} category={item.category} folder={item.folder} size={48} />
                  <div className="library-text">
                    <bdi className="file-name">{item.name}</bdi>
                    <span className="muted">
                      {item.exists ? (
                        <>
                          {item.source && <bdi>{t('library.from', { name: isolate(item.source) })} · </bdi>}
                          {item.size != null && `${formatBytes(item.size, language)} · `}
                          {formatRelative(item.created, now, language)}
                        </>
                      ) : (
                        t('library.missing')
                      )}
                    </span>
                  </div>
                  <div className="library-actions">
                    {item.exists && (
                      <>
                        <button type="button" className="button small" onClick={() => void api.libraryOpen(item.id)}>
                          <Icon name="external" size={16} />
                          {t('library.open')}
                        </button>
                        <button
                          type="button"
                          className="button quiet small"
                          onClick={() => void api.libraryReveal(item.id)}
                        >
                          <Icon name="folder" size={16} />
                          {t(mac ? 'action.reveal.mac' : 'action.reveal.windows')}
                        </button>
                        {!item.folder && (
                          <button type="button" className="button quiet small" onClick={() => void sendToWheel(item)}>
                            <Icon name="dial" size={16} />
                            {t('library.wheel')}
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t('library.remove', { name: item.name })}
                      onClick={() => void api.libraryRemove(item.id)}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
