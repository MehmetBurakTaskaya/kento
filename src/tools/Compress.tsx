// SPDX-License-Identifier: MIT
// Compress (SPEC 5.5): images, video, audio and PDF, each kept in its own format, by quality, by
// a share of the original size, or under a target size (which then holds for each file).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { FileIcon } from '../components/FileIcon';
import { Segmented } from '../editors/controls';
import { Slider } from '../editors/image/controls';
import { intlLocale } from '../i18n';
import { formatBytes } from '../i18n/format';
import { api, type Category, type Compression, type FileEntry } from '../ipc';
import { useApp } from '../state/store';

export type Mode = Compression['mode'];
export type SizeUnit = 'KB' | 'MB';

/** Decimal units, like every size Kento shows. */
const UNIT_BYTES: Record<string, number> = { K: 1e3, M: 1e6, G: 1e9 };

export const COMPRESSIBLE: Category[] = ['image', 'video', 'audio', 'pdf'];

export const QUALITY = { min: 1, max: 100, initial: 75 };
export const RATIO = { min: 5, max: 95, initial: 50 };

/**
 * A typed size in bytes: "25", "2,5" or "2.5" in the chosen unit, or with its own unit ("25 MB",
 * "800kb", "1 GB"). Null for anything else, and for nothing at all.
 */
export function parseSize(text: string, unit: SizeUnit): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?|[.,]\d+)\s*(?:([kmg])b?)?\s*$/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]!.replace(',', '.'));
  const scale = UNIT_BYTES[(match[2] ?? unit[0]!).toUpperCase()]!;
  const bytes = Math.round(value * scale);
  return Number.isFinite(bytes) && bytes >= 1 ? bytes : null;
}

/** A first target: half of the largest file, in the unit that reads best. */
export function suggestTarget(sizes: number[], lang: string): { text: string; unit: SizeUnit } {
  const half = Math.max(0, ...sizes) / 2;
  const unit: SizeUnit = half >= 1e6 ? 'MB' : 'KB';
  const value = Math.max(1, half / UNIT_BYTES[unit[0]!]!);
  const text = new Intl.NumberFormat(intlLocale(lang), {
    maximumFractionDigits: value < 10 ? 1 : 0,
    useGrouping: false,
  }).format(value);
  return { text, unit };
}

/** The request for the chosen mode, or null while the target size is not a size. */
export function compression(mode: Mode, quality: number, percent: number, bytes: number | null): Compression | null {
  if (mode === 'quality') return { mode, level: Math.round(quality) };
  if (mode === 'ratio') return { mode, percent: Math.round(percent) };
  return bytes ? { mode, bytes } : null;
}

export function CompressPanel({ entries, onClose }: { entries: FileEntry[]; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { started } = useApp();
  const files = entries.filter((entry) => entry.category && COMPRESSIBLE.includes(entry.category));
  const left = entries.length - files.length;
  const total = files.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  const [mode, setMode] = useState<Mode>('quality');
  const [quality, setQuality] = useState(QUALITY.initial);
  const [percent, setPercent] = useState(RATIO.initial);
  const [target, setTarget] = useState(() =>
    suggestTarget(
      files.map((entry) => entry.size ?? 0),
      lang,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bytes = parseSize(target.text, target.unit);
  const request = compression(mode, quality, percent, bytes);
  const has = (...categories: Category[]) =>
    files.some((entry) => entry.category && categories.includes(entry.category));
  const invalid = mode === 'size' && target.text.trim() !== '' && bytes === null;

  const start = () => {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    api
      .runCompress(
        request,
        files.map((entry) => entry.path),
      )
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
      title={t('tool.compress')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button quiet" onClick={onClose}>
            {t('tools.cancel')}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !request || files.length === 0}
            onClick={start}
          >
            {t('compress.run', { count: files.length })}
          </button>
        </>
      }
    >
      <p className="compress-summary">
        {t('compress.summary', { count: files.length, size: formatBytes(total, lang) })}
      </p>
      <ul className="compress-files" aria-label={t('compress.files')}>
        {files.map((entry) => (
          <li key={entry.path} className="compress-file">
            <FileIcon path={entry.path} category={entry.category} size={24} />
            <bdi className="file-name">{entry.name}</bdi>
            {entry.size != null && <span className="muted">{formatBytes(entry.size, lang)}</span>}
          </li>
        ))}
      </ul>
      {left > 0 && <p className="muted compress-note">{t('compress.left', { count: left })}</p>}
      <div className="compress-mode">
        <Segmented
          label={t('compress.mode')}
          value={mode}
          options={[
            { value: 'quality', label: t('compress.quality') },
            { value: 'ratio', label: t('compress.ratio') },
            { value: 'size', label: t('compress.size') },
          ]}
          onChange={setMode}
        />
      </div>
      {mode === 'quality' && (
        <div className="compress-choice">
          <Slider
            label={t('compress.qualityLevel')}
            value={quality}
            min={QUALITY.min}
            max={QUALITY.max}
            text={new Intl.NumberFormat(intlLocale(lang)).format(quality)}
            onChange={setQuality}
          />
          <p className="muted compress-note">{t('compress.qualityHint')}</p>
        </div>
      )}
      {mode === 'ratio' && (
        <div className="compress-choice">
          <Slider
            label={t('compress.ratioLevel')}
            value={percent}
            min={RATIO.min}
            max={RATIO.max}
            text={t('compress.percent', { value: percent / 100 })}
            onChange={setPercent}
          />
          {total > 0 && (
            <p className="muted compress-note">
              {t('compress.estimate', { size: formatBytes((total * percent) / 100, lang) })}
            </p>
          )}
        </div>
      )}
      {mode === 'size' && (
        <div className="compress-choice">
          <div className="compress-target">
            <label className="editor-field">
              <span>{t('compress.target')}</span>
              <input
                type="text"
                inputMode="decimal"
                value={target.text}
                aria-invalid={invalid}
                onChange={(event) => setTarget({ ...target, text: event.target.value })}
              />
            </label>
            <select
              aria-label={t('compress.unit')}
              value={target.unit}
              onChange={(event) => setTarget({ ...target, unit: event.target.value as SizeUnit })}
            >
              <option value="KB">{t('compress.kb')}</option>
              <option value="MB">{t('compress.mb')}</option>
            </select>
          </div>
          {invalid ? (
            <p className="error-text">{t('compress.invalid')}</p>
          ) : (
            <p className="muted compress-note">{t(files.length > 1 ? 'compress.eachFile' : 'compress.searchHint')}</p>
          )}
        </div>
      )}
      {has('video', 'audio') && <p className="muted compress-note">{t('compress.mediaNote')}</p>}
      {has('pdf') && <p className="muted compress-note">{t('compress.pdfNote')}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
