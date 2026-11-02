// SPDX-License-Identifier: MIT
// Controls of the image editors' side column, beside the shared ones in ../controls.
import { useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Rgb } from '../../ipc';
import { hexToRgb } from '../levels';
import { rgbCss, rgbToHex, sameRgb } from './marks';

/** A labelled slider with its value written beside the label. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  text,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** The value as read out and shown. */
  text: string;
  onChange(value: number): void;
}) {
  // Not one wrapping label: an <output> inside it would take the label from the slider.
  const id = useId();
  return (
    <div className="editor-field">
      <span>
        <label htmlFor={id}>{label}</label>
        <output className="editor-value" htmlFor={id}>
          {text}
        </output>
      </span>
      <input
        id={id}
        type="range"
        className="editor-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export interface Swatch {
  id: string;
  rgb: Rgb;
}

/**
 * A row of colours to choose from, as radio buttons (the arrows move the choice), and a field for
 * any other colour.
 */
export function Swatches({
  label,
  swatches,
  value,
  onChange,
  name,
}: {
  label: string;
  swatches: Swatch[];
  value: Rgb;
  onChange(rgb: Rgb): void;
  /** The colour's name for a swatch id. */
  name(id: string): string;
}) {
  const { t } = useTranslation();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = swatches.findIndex((swatch) => sameRgb(swatch.rgb, value));
  const onKey = (event: KeyboardEvent, index: number) => {
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
    const next = (index + step + swatches.length) % swatches.length;
    onChange(swatches[next]!.rgb);
    buttons.current[next]?.focus();
  };
  return (
    <div className="image-swatches">
      <div className="image-swatch-row" role="radiogroup" aria-label={label}>
        {swatches.map((swatch, index) => (
          <button
            key={swatch.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            className="image-swatch"
            aria-checked={index === checked}
            aria-label={name(swatch.id)}
            title={name(swatch.id)}
            tabIndex={index === checked || (checked < 0 && index === 0) ? 0 : -1}
            style={{ background: rgbCss(swatch.rgb) }}
            onClick={() => onChange(swatch.rgb)}
            onKeyDown={(event) => onKey(event, index)}
          />
        ))}
      </div>
      <label className="image-custom" data-on={checked < 0 ? '' : undefined}>
        <input type="color" value={rgbToHex(value)} onChange={(event) => onChange(hexToRgb(event.target.value))} />
        <span>{t('image.color.custom')}</span>
      </label>
    </div>
  );
}

/** A switch-like check box in the editors' style. */
export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange(on: boolean): void }) {
  return (
    <label className="editor-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
