// SPDX-License-Identifier: MIT
// The files on Home (SPEC 5.2): click, Ctrl/⌘-click and Shift-click select; arrows move;
// Enter opens the Convert wheel, Ctrl+Space the Tools wheel, Delete takes files off the list
// (never off the disk).
import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FileIcon } from '../components/FileIcon';
import { Icon } from '../components/Icon';
import { formatBytes } from '../i18n/format';
import { useApp } from '../state/store';

export function FileList() {
  const { t } = useTranslation();
  const { files, selected, select, removeFiles, openWheel, language, boot } = useApp();
  const anchor = useRef<string | null>(null);
  const mac = boot?.app.platform === 'macos';

  const choose = (event: MouseEvent, path: string) => {
    const paths = files.map((file) => file.path);
    if (event.shiftKey && anchor.current) {
      const from = paths.indexOf(anchor.current);
      const to = paths.indexOf(path);
      select(paths.slice(Math.min(from, to), Math.max(from, to) + 1));
      return;
    }
    if (mac ? event.metaKey : event.ctrlKey) {
      const next = new Set(selected);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      select([...next]);
    } else {
      select([path]);
    }
    anchor.current = path;
  };

  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const paths = files.map((file) => file.path);
    const current = paths.findIndex((path) => selected.has(path));
    const chosen = paths.filter((path) => selected.has(path));
    const command = mac ? event.metaKey : event.ctrlKey;
    const move = (index: number) => {
      const path = paths[Math.max(0, Math.min(paths.length - 1, index))];
      if (!path) return;
      select([path]);
      anchor.current = path;
      document.getElementById(rowId(path))?.focus();
    };
    if (event.key === 'ArrowDown') move(current + 1);
    else if (event.key === 'ArrowUp') move(current - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(paths.length - 1);
    else if (event.key === 'Enter' && event.altKey) openWheel('actions', chosen);
    else if (event.key === 'Enter') openWheel('convert', chosen);
    else if (event.key === ' ' && command) openWheel('tools', chosen);
    else if (event.key === 'Delete' || (mac && event.key === 'Backspace')) removeFiles(chosen);
    else if (event.key === 'a' && command) select(paths);
    else return;
    event.preventDefault();
  };

  if (!files.length) return null;
  return (
    <ul
      className="file-list"
      role="listbox"
      aria-multiselectable="true"
      aria-label={t('home.files.label')}
      onKeyDown={onKey}
    >
      {files.map((file) => {
        const isSelected = selected.has(file.path);
        return (
          <li
            key={file.path}
            id={rowId(file.path)}
            role="option"
            aria-selected={isSelected}
            tabIndex={isSelected || (!selected.size && file === files[0]) ? 0 : -1}
            className="file-row"
            onClick={(event) => choose(event, file.path)}
            onDoubleClick={() => openWheel('convert', [file.path])}
          >
            <FileIcon path={file.path} category={file.category} folder={file.folder} size={32} />
            <bdi className="file-name">{file.name}</bdi>
            <span className="file-meta muted">
              {file.format ? file.format.toUpperCase() : t(file.folder ? 'home.files.folder' : 'home.files.unknown')}
              {file.size != null && ` · ${formatBytes(file.size, language)}`}
            </span>
            <button
              type="button"
              className="icon-button"
              tabIndex={-1}
              aria-label={t('home.files.remove', { name: file.name })}
              onClick={(event) => {
                event.stopPropagation();
                removeFiles([file.path]);
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function rowId(path: string) {
  return `file-${encodeURIComponent(path)}`;
}
