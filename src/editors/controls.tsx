// SPDX-License-Identifier: MIT
// Small controls of the editors' side column.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api } from '../ipc';
import { Icon, type IconName } from '../components/Icon';

export interface Option<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** A row of mutually exclusive buttons; arrows move the choice, as in any radio group. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Option<NoInfer<T>>[];
  onChange(value: NoInfer<T>): void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = options.findIndex((option) => option.value === value);
  const onKey = (event: KeyboardEvent, index: number) => {
    // Left and right follow the reading direction.
    const rtl = document.documentElement.dir === 'rtl';
    const steps: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: 1,
      ArrowUp: -1,
    };
    const step = steps[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    let next = index;
    for (let tries = 0; tries < options.length; tries++) {
      next = (next + step + options.length) % options.length;
      if (!options[next]!.disabled) break;
    }
    onChange(options[next]!.value);
    buttons.current[next]?.focus();
  };
  return (
    <div className="segmented editor-segmented" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={index === checked}
          tabIndex={index === checked || (checked < 0 && index === 0) ? 0 : -1}
          disabled={option.disabled}
          className={index === checked ? 'is-on' : undefined}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKey(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A number typed freely and taken on Enter or when the field is left, so a value on its way
 * ("1" before "120") is never clamped under the user's fingers.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
  suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft.replace(',', '.'));
    if (draft.trim() !== '' && Number.isFinite(parsed)) onChange(Math.min(Math.max(parsed, min), max));
    setDraft(null);
  };
  return (
    <label className="editor-field">
      <span>{label}</span>
      <span className="editor-input">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft ?? String(value)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="editor-section">
      <h3 className="editor-heading">{title}</h3>
      {children}
    </section>
  );
}

/** A picture of a file from the core (a frame, an image), or an icon while there is none. */
export function useBlobUrl(load: (() => Promise<Blob | null>) | null, key: string): string | null {
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  useEffect(() => {
    const read = latest.current;
    if (!read) return;
    let live = true;
    let url: string | null = null;
    read()
      .then((blob) => {
        if (!live || !blob) return;
        url = URL.createObjectURL(blob);
        setLoaded({ key, url });
      })
      .catch((reason) => void api.log('warn', `picture not loaded: ${String(reason)}`));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [key]);
  return loaded?.key === key ? loaded.url : null;
}

export function Picture({ src, icon, label }: { src: string | null; icon: IconName; label?: string }) {
  return src ? (
    <img src={src} alt={label ?? ''} />
  ) : (
    <span className="picture-empty" role={label ? 'img' : undefined} aria-label={label}>
      <Icon name={icon} size={22} />
    </span>
  );
}
