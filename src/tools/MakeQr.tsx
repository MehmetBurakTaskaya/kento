// SPDX-License-Identifier: MIT
// Make a QR code (SPEC 5.5 [+]): a PNG or SVG from text or a link, with a live preview drawn by
// the core's own encoder, the error-correction level, the size and two colours checked for
// contrast. It takes no files: Home opens it, as do the download dialog and the link ring of the
// floating wheel with their link.
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Segmented } from '../editors/controls';
import { rgbToHex } from '../editors/image/marks';
import { hexToRgb } from '../editors/levels';
import { api, type QrCorrection, type QrPicture, type QrPreview, type QrStyle } from '../ipc';
import { useApp } from '../state/store';
import '../styles/tools.css';

export const QR_SIZES = [256, 512, 1024, 2048];
export const QR_CORRECTIONS: QrCorrection[] = ['low', 'medium', 'quartile', 'high'];
export const QR_DEFAULT: QrStyle = { correction: 'medium', size: 1024, dark: [0, 0, 0], light: [255, 255, 255] };

/** How long typing rests before the preview is drawn again. */
const PREVIEW_PAUSE_MS = 120;

/** The message for a code that cannot be made, or for colours that may not scan. */
export function qrNote(preview: QrPreview | null): { key: string; error: boolean } | null {
  if (!preview) return null;
  if (preview.problem === 'too-long') return { key: 'tools.makeQr.tooLong', error: true };
  if (preview.problem === 'low-contrast') return { key: 'tools.makeQr.lowContrast', error: true };
  if (preview.problem === null && preview.inverted) return { key: 'tools.makeQr.inverted', error: false };
  return null;
}

/** The core's SVG as a picture source; the strict CSP allows data images, and an SVG shown as an
 *  image runs nothing. */
export function svgSource(svg: string | null | undefined): string | null {
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
}

export function MakeQrPanel({ text: initial, onClose }: { text: string; onClose(): void }) {
  const { t } = useTranslation();
  const started = useApp((state) => state.started);
  const ids = { correction: useId(), size: useId(), folder: useId() };
  const [text, setText] = useState(initial);
  const [style, setStyle] = useState<QrStyle>(QR_DEFAULT);
  const [picture, setPicture] = useState<QrPicture>('png');
  const [preview, setPreview] = useState<QrPreview | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [shown, setShown] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const image = useMemo(() => svgSource(preview?.svg), [preview]);
  const note = qrNote(preview);

  useEffect(() => {
    let live = true;
    void api.webDefaultFolder().then((path) => live && setShown(path));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      api
        .qrPreview(text, style)
        .then((next) => live && setPreview(next))
        .catch((reason: unknown) => live && setError(String(reason)));
    }, PREVIEW_PAUSE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [text, style]);

  const choose = () =>
    void api.webChooseFolder().then((path) => {
      if (!path) return;
      setFolder(path);
      setShown(path);
    });

  const save = () => {
    if (busy || !preview?.svg) return;
    setBusy(true);
    setError(null);
    api
      .makeQr(text, style, picture, folder)
      .then((id) => {
        started([id]);
        onClose();
      })
      .catch((reason: unknown) => {
        setError(String(reason));
        setBusy(false);
      });
  };

  return (
    <Dialog
      wide
      title={t('tool.make-qr')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button quiet" onClick={onClose}>
            {t('tools.cancel')}
          </button>
          <button type="button" className="button primary" disabled={busy || !preview?.svg} onClick={save}>
            {t('tools.makeQr.save', { format: picture.toUpperCase() })}
          </button>
        </>
      }
    >
      <div className="qr-make">
        <div className="qr-make-side">
          <label className="editor-field">
            <span>{t('tools.makeQr.text')}</span>
            <textarea
              className="qr-make-text"
              rows={4}
              value={text}
              placeholder={t('tools.makeQr.placeholder')}
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="form-row">
            <label htmlFor={ids.correction}>
              {t('tools.makeQr.correction')}
              <select
                id={ids.correction}
                value={style.correction}
                onChange={(event) => setStyle({ ...style, correction: event.target.value as QrCorrection })}
              >
                {QR_CORRECTIONS.map((level) => (
                  <option key={level} value={level}>
                    {t(`tools.makeQr.correction.${level}`)}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={ids.size}>
              {t('tools.makeQr.size')}
              <select
                id={ids.size}
                value={style.size}
                onChange={(event) => setStyle({ ...style, size: Number(event.target.value) })}
              >
                {QR_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {t('tools.makeQr.pixels', { size })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted compress-note">{t('tools.makeQr.correctionHint')}</p>
          <div className="form-row">
            <label className="editor-field editor-color">
              <span>{t('tools.makeQr.dark')}</span>
              <input
                type="color"
                value={rgbToHex(style.dark)}
                onChange={(event) => setStyle({ ...style, dark: hexToRgb(event.target.value) })}
              />
            </label>
            <label className="editor-field editor-color">
              <span>{t('tools.makeQr.light')}</span>
              <input
                type="color"
                value={rgbToHex(style.light)}
                onChange={(event) => setStyle({ ...style, light: hexToRgb(event.target.value) })}
              />
            </label>
            <button
              type="button"
              className="button quiet small qr-make-reset"
              disabled={rgbToHex(style.dark) === '#000000' && rgbToHex(style.light) === '#ffffff'}
              onClick={() => setStyle({ ...style, dark: QR_DEFAULT.dark, light: QR_DEFAULT.light })}
            >
              {t('tools.makeQr.resetColors')}
            </button>
          </div>
          <Segmented
            label={t('tools.makeQr.format')}
            value={picture}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'svg', label: 'SVG' },
            ]}
            onChange={setPicture}
          />
          <div className="web-folder" role="group" aria-labelledby={ids.folder}>
            <span id={ids.folder}>{t('web.folder.title')}</span>
            <span className="folder">
              <Icon name="folder" size={18} />
              <bdi className="folder-path" title={shown}>
                {shown}
              </bdi>
              <button type="button" className="button small" onClick={choose}>
                {t('web.folder.change')}
              </button>
            </span>
          </div>
        </div>
        <figure className="qr-make-preview" aria-live="polite">
          {image ? (
            <img src={image} alt={t('tools.makeQr.preview')} />
          ) : (
            <span className="qr-make-empty">
              <Icon name="qr" size={40} />
              {preview?.problem === 'empty' && <span className="muted">{t('tools.makeQr.empty')}</span>}
            </span>
          )}
          {note && (
            <figcaption className={note.error ? 'error-text' : 'muted'} role={note.error ? 'alert' : undefined}>
              {t(note.key)}
            </figcaption>
          )}
        </figure>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
