// SPDX-License-Identifier: MIT
// Extract text (SPEC 5.5, OCR [+]): the system's own text recognition reads images and PDF pages
// on this computer, one TXT per file. The language starts as the interface language when the
// system reads it, else the system's; a language the system cannot read is named, with where
// Windows adds it (macOS reads what its version reads).
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { FileIcon } from '../components/FileIcon';
import { api, type FileEntry, type OcrLanguages } from '../ipc';
import { useApp } from '../state/store';
import '../styles/tools.css';

/** "tr-TR" and "tr" are the same language here; scripts stay apart ("zh-Hans", "zh-Hant"). */
export function baseLanguage(tag: string): string {
  const [language = '', next] = tag.replace('_', '-').split('-');
  return next && next.length === 4 ? `${language.toLowerCase()}-${next.toLowerCase()}` : language.toLowerCase();
}

/** The installed tag that reads `tag`, if any. */
export function installed(tag: string, available: string[]): string | null {
  return (
    available.find((have) => have.toLowerCase() === tag.toLowerCase()) ??
    available.find((have) => baseLanguage(have) === baseLanguage(tag)) ??
    null
  );
}

/** What the list offers: every installed language, then the interface and system languages when
 *  the system cannot read them, so choosing one says what is missing. */
export function languageChoices(languages: OcrLanguages): { tag: string; missing: boolean }[] {
  const choices = languages.available.map((tag) => ({ tag, missing: false }));
  for (const tag of [languages.interface, languages.system]) {
    if (
      tag &&
      !installed(tag, languages.available) &&
      !choices.some((c) => baseLanguage(c.tag) === baseLanguage(tag))
    ) {
      choices.push({ tag: baseLanguage(tag), missing: true });
    }
  }
  return choices;
}

/** A language's name in the interface language ("Türkçe" in Turkish, "Turkish" in English). */
export function languageName(tag: string, lang: string): string {
  try {
    const name = new Intl.DisplayNames([lang], { type: 'language', languageDisplay: 'standard' }).of(tag);
    return name ? name.charAt(0).toLocaleUpperCase(lang) + name.slice(1) : tag;
  } catch {
    return tag;
  }
}

export function OcrPanel({ entries, onClose }: { entries: FileEntry[]; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const mac = useApp((state) => state.boot?.app.platform === 'macos');
  const started = useApp((state) => state.started);
  const id = useId();
  const files = entries.filter((entry) => entry.category === 'image' || entry.category === 'pdf');
  const [languages, setLanguages] = useState<OcrLanguages | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .ocrLanguages()
      .then((found) => {
        if (!live) return;
        setLanguages(found);
        setLanguage(found.suggested ?? languageChoices(found)[0]?.tag ?? null);
      })
      .catch((reason: unknown) => live && setError(String(reason)));
    return () => {
      live = false;
    };
  }, []);

  const choices = languages ? languageChoices(languages) : [];
  const missing = choices.find((choice) => choice.tag === language)?.missing ?? false;
  // The interface language without a recogniser is said even when another one is chosen.
  const absent = missing
    ? language
    : languages && !installed(languages.interface, languages.available)
      ? languages.interface
      : null;

  const start = () => {
    if (!language || missing || busy) return;
    setBusy(true);
    setError(null);
    api
      .runOcr(
        files.map((entry) => entry.path),
        language,
      )
      .then((ids) => {
        started(ids);
        onClose();
      })
      .catch((reason: unknown) => {
        setError(String(reason));
        setBusy(false);
      });
  };

  return (
    <Dialog
      title={t('tool.ocr')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button quiet" onClick={onClose}>
            {t('tools.cancel')}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !language || missing || files.length === 0}
            onClick={start}
          >
            {t('tools.ocr.run', { count: files.length })}
          </button>
        </>
      }
    >
      <ul className="compress-files tool-files" aria-label={t('tools.ocr.files')}>
        {files.map((entry) => (
          <li key={entry.path} className="compress-file">
            <FileIcon path={entry.path} category={entry.category} size={24} />
            <bdi className="file-name">{entry.name}</bdi>
          </li>
        ))}
      </ul>
      <div className="ocr-language">
        <label htmlFor={id}>{t('tools.ocr.language')}</label>
        <select
          id={id}
          value={language ?? ''}
          disabled={!languages}
          aria-invalid={missing}
          onChange={(event) => setLanguage(event.target.value)}
        >
          {choices.map((choice) => (
            <option key={choice.tag} value={choice.tag}>
              {choice.missing
                ? t('tools.ocr.notInstalled', { name: languageName(choice.tag, lang) })
                : languageName(choice.tag, lang)}
            </option>
          ))}
        </select>
      </div>
      {languages && languages.available.length === 0 && (
        <p className="error-text" role="alert">
          {t(mac ? 'tools.ocr.none.mac' : 'tools.ocr.none.windows')}
        </p>
      )}
      {absent && (
        <p className={missing ? 'error-text ocr-missing' : 'muted ocr-missing'} role={missing ? 'alert' : 'note'}>
          {t(mac ? 'tools.ocr.missing.mac' : 'tools.ocr.missing.windows', { name: languageName(absent, lang) })}
        </p>
      )}
      <p className="muted compress-note">{t(mac ? 'tools.ocr.local.mac' : 'tools.ocr.local.windows')}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
