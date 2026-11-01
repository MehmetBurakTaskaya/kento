// SPDX-License-Identifier: MIT
// Files in an order the user sets: drag a row, or use its up and down buttons (Alt+↑/↓ on a row).
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FileIcon } from '../components/FileIcon';
import { Icon } from '../components/Icon';
import type { FileEntry } from '../ipc';

export function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function OrderList({ items, onChange }: { items: FileEntry[]; onChange(items: FileEntry[]): void }) {
  const { t } = useTranslation();
  const [dragged, setDragged] = useState<number | null>(null);

  const onKey = (event: KeyboardEvent, index: number) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    onChange(move(items, index, to));
    requestAnimationFrame(() => document.getElementById(`order-${to}`)?.focus());
  };

  return (
    <ol className="order-list">
      {items.map((item, index) => (
        <li
          key={item.path}
          id={`order-${index}`}
          tabIndex={0}
          draggable
          className="order-row"
          data-dragging={dragged === index || undefined}
          aria-label={t('tools.order.position', { name: item.name, position: index + 1, count: items.length })}
          onKeyDown={(event) => onKey(event, index)}
          onDragStart={() => setDragged(index)}
          onDragEnd={() => setDragged(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (dragged != null) onChange(move(items, dragged, index));
            setDragged(null);
          }}
        >
          <Icon name="grip" size={16} className="order-grip" />
          <span className="order-index">{index + 1}</span>
          <FileIcon path={item.path} category={item.category} size={28} />
          <bdi className="file-name">{item.name}</bdi>
          <button
            type="button"
            className="icon-button"
            tabIndex={-1}
            disabled={index === 0}
            aria-label={t('tools.order.up', { name: item.name })}
            onClick={() => onChange(move(items, index, index - 1))}
          >
            <Icon name="up" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            tabIndex={-1}
            disabled={index === items.length - 1}
            aria-label={t('tools.order.down', { name: item.name })}
            onClick={() => onChange(move(items, index, index + 1))}
          >
            <Icon name="down" size={16} />
          </button>
        </li>
      ))}
    </ol>
  );
}
