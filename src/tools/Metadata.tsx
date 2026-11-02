// SPDX-License-Identifier: MIT
// Metadata (SPEC 5.5): what a file carries, the common fields to edit, and removing everything or
// only the location; the result is a new copy. Video and audio also edit their chapters.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { api, type Chapter, type FileEntry, type MetadataChange, type MetadataField, type MetadataInfo } from '../ipc';
import { useApp } from '../state/store';
import '../styles/metadata.css';

/** One heading of the read-only list and its fields, in the order the file gave them. */
export interface FieldGroup {
  group: string;
  fields: MetadataField[];
}

/** The fields to show under headings: everything but the editable ones, which have the form. */
export function groupFields(fields: MetadataField[]): FieldGroup[] {
  const groups: FieldGroup[] = [];
  for (const field of fields) {
    if (field.editable) continue;
    const found = groups.find((group) => group.group === field.group);
    if (found) found.fields.push(field);
    else groups.push({ group: field.group, fields: [field] });
  }
  return groups;
}

/** A chapter while it is typed: times as text, an id that survives reordering. */
export interface ChapterDraft {
  id: number;
  start: string;
  end: string;
  title: string;
}

/** Seconds as people read them: `1:05`, `1:02:05.5`. */
export function formatTime(seconds: number): string {
  const millis = Math.round(Math.max(0, seconds) * 1000);
  const whole = Math.floor(millis / 1000);
  const fraction = millis % 1000;
  const [h, m, s] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  const two = (n: number) => String(n).padStart(2, '0');
  const tail = fraction ? `.${String(fraction).padStart(3, '0').replace(/0+$/, '')}` : '';
  return h ? `${h}:${two(m)}:${two(s)}${tail}` : `${m}:${two(s)}${tail}`;
}

/** `1:05`, `0:01:05.5`, `65` or `65,5` → seconds; null for anything else. */
export function parseTime(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  // Only the seconds may have a fraction, and minutes and seconds stay under 60 after an hour.
  if (parts.slice(0, -1).some((part) => part.includes('.'))) return null;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((n) => n >= 60)) return null;
  return numbers.reduce((total, n) => total * 60 + n, 0);
}

export function toDrafts(chapters: Chapter[]): ChapterDraft[] {
  return chapters.map((chapter, id) => ({
    id,
    start: formatTime(chapter.start),
    end: formatTime(chapter.end),
    title: chapter.title,
  }));
}

/** The rows whose times do not make sense: unreadable, empty, past the end, or overlapping the
 *  row before. */
export function chapterIssues(drafts: ChapterDraft[], duration: number | null): Set<number> {
  const issues = new Set<number>();
  let previousEnd = 0;
  drafts.forEach((draft, at) => {
    const start = parseTime(draft.start);
    const end = parseTime(draft.end);
    const inside = duration == null || (end != null && end <= duration + 0.001);
    if (start == null || end == null || end <= start || !inside || start < previousEnd - 0.0005) {
      issues.add(at);
    }
    previousEnd = end ?? previousEnd;
  });
  return issues;
}

/** The typed chapters, when every row is valid. */
export function parseDrafts(drafts: ChapterDraft[], duration: number | null): Chapter[] | null {
  if (chapterIssues(drafts, duration).size) return null;
  return drafts.map((draft) => ({
    start: parseTime(draft.start)!,
    end: parseTime(draft.end)!,
    title: draft.title.trim(),
  }));
}

export function sameChapters(a: Chapter[], b: Chapter[]): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) < 0.0005;
  return (
    a.length === b.length &&
    a.every((chapter, at) => {
      const other = b[at]!;
      return close(chapter.start, other.start) && close(chapter.end, other.end) && chapter.title === other.title;
    })
  );
}

/** A new chapter after the last one: a minute long, or up to the end when that is closer. None
 *  when the last one already reaches the end. */
export function nextChapter(drafts: ChapterDraft[], duration: number | null): ChapterDraft | null {
  const last = drafts[drafts.length - 1];
  const start = last ? (parseTime(last.end) ?? parseTime(last.start) ?? 0) : 0;
  const end = duration == null ? start + 60 : Math.min(start + 60, duration);
  if (end <= start) return null;
  const id = drafts.reduce((max, draft) => Math.max(max, draft.id), -1) + 1;
  return { id, start: formatTime(start), end: formatTime(end), title: '' };
}

/** Mirrors the engine: a date with an optional time and time zone, `2024-05-01 14:30`. */
export function isPictureDate(text: string): boolean {
  const match =
    /^(\d{4})[-:./](\d{1,2})[-:./](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(
      text.trim(),
    );
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  return (
    year! >= 1 &&
    month! >= 1 &&
    month! <= 12 &&
    day! >= 1 &&
    day! <= 31 &&
    hour! <= 23 &&
    minute! <= 59 &&
    second! <= 60
  );
}

/** What Save sends: only the fields that changed; removing everything leaves nothing else to do.
 *  Null when nothing would change. */
export function buildChange(
  fields: MetadataField[],
  values: Record<string, string>,
  removeAll: boolean,
  removeLocation: boolean,
  chapters: Chapter[] | null,
): MetadataChange | null {
  if (removeAll) return { set: {}, removeAll: true, removeLocation: false, chapters: null };
  const set: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.editable && value !== undefined && value.trim() !== field.value.trim()) set[field.key] = value.trim();
  }
  if (!Object.keys(set).length && !removeLocation && chapters == null) return null;
  return { set, removeAll: false, removeLocation, chapters };
}

/** Fields typed over several lines. */
const LONG = new Set(['description', 'comment']);

export function MetadataPanel({ entries, onClose }: { entries: FileEntry[]; onClose(): void }) {
  const { t } = useTranslation();
  const { started, openSetup } = useApp();
  const file = entries[0]!;
  const picture = file.category === 'image';
  const media = file.category === 'video' || file.category === 'audio';
  const [info, setInfo] = useState<MetadataInfo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [removeAll, setRemoveAll] = useState(false);
  const [removeLocation, setRemoveLocation] = useState(false);
  // Null until the first chapter edit: the file's own chapters are shown until then.
  const [drafts, setDrafts] = useState<ChapterDraft[] | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .metadataRead(file.path)
      .then((read) => {
        if (!live) return;
        setInfo(read);
        setValues(Object.fromEntries(read.fields.filter((f) => f.editable).map((f) => [f.key, f.value])));
      })
      .catch((reason) => live && setFailed(String(reason)));
    return () => {
      live = false;
    };
  }, [file.path]);

  useEffect(() => {
    if (!media) return;
    let live = true;
    api
      .mediaProbe(file.path)
      .then((probe) => live && setDuration(probe.duration > 0 ? probe.duration : null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [file.path, media]);

  const groups = useMemo(() => groupFields(info?.fields ?? []), [info]);
  const editable = info?.fields.filter((field) => field.editable) ?? [];
  const writable = editable.length > 0;
  const rows = drafts ?? toDrafts(info?.chapters ?? []);
  const issues = drafts ? chapterIssues(drafts, duration) : new Set<number>();
  const parsed = drafts ? parseDrafts(drafts, duration) : null;
  const chaptersChanged = drafts != null && (parsed == null || !sameChapters(parsed, info?.chapters ?? []));
  // Only a date that was typed is checked; the file's own stays as it is.
  const typedDate = values.date?.trim() ?? '';
  const fileDate = editable.find((field) => field.key === 'date')?.value.trim() ?? '';
  const badDate = picture && typedDate !== fileDate && typedDate !== '' && !isPictureDate(typedDate);
  const change = info
    ? buildChange(info.fields, values, removeAll, removeLocation, chaptersChanged ? parsed : null)
    : null;
  const invalid = !removeAll && (badDate || (chaptersChanged && parsed == null));
  const next = nextChapter(rows, duration);

  const editRows = (edit: (current: ChapterDraft[]) => ChapterDraft[]) => setDrafts(edit(rows));
  const setRow = (id: number, patch: Partial<ChapterDraft>) =>
    editRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const save = () => {
    if (!change) return;
    setBusy(true);
    setError(null);
    api
      .runMetadata(file.path, change)
      .then((ids) => {
        started(ids);
        onClose();
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusy(false));
  };
  // A picture's date is when it was taken; a recording's is its release or recording date.
  const label = (field: MetadataField) =>
    picture && field.key === 'date'
      ? t('metadata.field.dateTaken')
      : t(`metadata.field.${field.key}`, { defaultValue: field.name });
  const removeHint = t(
    picture ? 'metadata.removeAll.image' : media ? 'metadata.removeAll.media' : 'metadata.removeAll.pdf',
  );

  return (
    <Dialog
      wide
      title={t('tool.metadata')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button quiet" onClick={onClose}>
            {t('tools.cancel')}
          </button>
          {writable && (
            <button type="button" className="button primary" disabled={busy || !change || invalid} onClick={save}>
              {t('metadata.save')}
            </button>
          )}
        </>
      }
    >
      <div className="meta-panel">
        <p className="meta-file">
          <bdi>{file.name}</bdi>
          <span className="muted">{t(writable || !info ? 'metadata.intro' : 'metadata.readOnly')}</span>
        </p>
        {!info && !failed && <p className="muted">{t('metadata.loading')}</p>}
        {failed && (
          <div className="meta-section">
            <p className="error-text">{failed}</p>
            {file.category !== 'pdf' && (
              <p>
                <button
                  type="button"
                  className="button small"
                  onClick={() => {
                    onClose();
                    openSetup();
                  }}
                >
                  {t('setup.open')}
                </button>
              </p>
            )}
          </div>
        )}

        {info && writable && (
          <fieldset className="meta-section" disabled={removeAll}>
            <legend className="meta-heading">{t('metadata.common')}</legend>
            <div className="meta-form">
              {editable.map((field) => {
                const id = `meta-${field.key}`;
                const value = values[field.key] ?? '';
                const dateWrong = picture && field.key === 'date' && badDate;
                const hint =
                  field.key === 'keywords'
                    ? t('metadata.hint.keywords')
                    : picture && field.key === 'date'
                      ? t(dateWrong ? 'metadata.invalid.date' : 'metadata.hint.date')
                      : null;
                // Values follow their own direction: a Latin title stays left to right in an
                // Arabic interface.
                const props = {
                  id,
                  value,
                  dir: 'auto',
                  'aria-invalid': dateWrong || undefined,
                  'aria-describedby': hint ? `${id}-hint` : undefined,
                  onChange: (event: { target: { value: string } }) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value })),
                };
                // Label, field and hint sit in the form's grid directly.
                return (
                  <Fragment key={field.key}>
                    <label htmlFor={id}>{label(field)}</label>
                    {LONG.has(field.key) ? (
                      <textarea rows={2} {...props} />
                    ) : (
                      <input
                        type="text"
                        placeholder={field.key === 'date' && picture ? '2024-05-01 14:30' : undefined}
                        {...props}
                      />
                    )}
                    {hint && (
                      <span id={`${id}-hint`} className={dateWrong ? 'meta-hint error-text' : 'meta-hint muted'}>
                        {hint}
                      </span>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </fieldset>
        )}

        {info && media && (info.chaptersEditable || info.chapters.length > 0) && (
          <fieldset className="meta-section" disabled={removeAll || !info.chaptersEditable}>
            <legend className="meta-heading">
              {t('metadata.chapters')}
              {duration != null && (
                <span className="muted"> · {t('metadata.chapters.length', { time: formatTime(duration) })}</span>
              )}
            </legend>
            {!info.chaptersEditable && <p className="muted">{t('metadata.chapters.readOnly')}</p>}
            {rows.length === 0 ? (
              <p className="muted">{t('metadata.chapters.empty')}</p>
            ) : (
              <>
                <div className="meta-chapter-head" aria-hidden="true">
                  <span />
                  <span>{t('metadata.chapters.start')}</span>
                  <span>{t('metadata.chapters.end')}</span>
                  <span>{t('metadata.chapters.name')}</span>
                </div>
                <ol className="meta-chapters">
                  {rows.map((row, at) => {
                    const wrong = issues.has(at);
                    const number = at + 1;
                    return (
                      <li key={row.id} className="meta-chapter" aria-label={t('metadata.chapters.label', { number })}>
                        <span className="meta-chapter-number">{number}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          className="meta-chapter-times"
                          aria-label={t('metadata.chapters.start')}
                          aria-invalid={wrong || undefined}
                          value={row.start}
                          onChange={(event) => setRow(row.id, { start: event.target.value })}
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          className="meta-chapter-times"
                          aria-label={t('metadata.chapters.end')}
                          aria-invalid={wrong || undefined}
                          value={row.end}
                          onChange={(event) => setRow(row.id, { end: event.target.value })}
                        />
                        <input
                          type="text"
                          dir="auto"
                          aria-label={t('metadata.chapters.name')}
                          placeholder={t('metadata.chapters.placeholder', { number })}
                          value={row.title}
                          onChange={(event) => setRow(row.id, { title: event.target.value })}
                        />
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={t('metadata.chapters.remove', { number })}
                          onClick={() => editRows((current) => current.filter((item) => item.id !== row.id))}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            {info.chaptersEditable && (
              <div className="meta-chapter-actions">
                <button
                  type="button"
                  className="button small"
                  disabled={!next}
                  onClick={() => next && editRows((current) => [...current, next])}
                >
                  <Icon name="plus" size={14} />
                  {t('metadata.chapters.add')}
                </button>
                <span className="muted">{t('metadata.chapters.hint')}</span>
              </div>
            )}
            {issues.size > 0 && <p className="error-text">{t('metadata.chapters.invalid')}</p>}
          </fieldset>
        )}

        {info && writable && (
          <fieldset className="meta-options">
            <legend className="visually-hidden">{t('metadata.remove')}</legend>
            <label className="meta-option">
              <input type="checkbox" checked={removeAll} onChange={(event) => setRemoveAll(event.target.checked)} />
              <span>{t('metadata.removeAll')}</span>
              <span className="muted">{removeHint}</span>
            </label>
            {file.category !== 'pdf' && (
              <label className="meta-option">
                <input
                  type="checkbox"
                  checked={removeLocation || (removeAll && info.hasLocation)}
                  disabled={!info.hasLocation || removeAll}
                  onChange={(event) => setRemoveLocation(event.target.checked)}
                />
                <span>{t('metadata.removeLocation')}</span>
                <span className="muted">
                  {t(info.hasLocation ? 'metadata.removeLocation.hint' : 'metadata.noLocation')}
                </span>
              </label>
            )}
          </fieldset>
        )}

        {info && (
          <section className="meta-section" aria-labelledby="meta-all">
            <h3 id="meta-all" className="meta-heading">
              {t('metadata.all')}
            </h3>
            {groups.length === 0 ? (
              <p className="muted">{t('metadata.none')}</p>
            ) : (
              <div className="meta-groups">
                {groups.map((group) => (
                  <details key={group.group} className="meta-group" open={groups.length <= 2}>
                    <summary>
                      <bdi>{group.group}</bdi>
                      <span className="muted">{t('metadata.count', { count: group.fields.length })}</span>
                    </summary>
                    <dl className="meta-table">
                      {group.fields.map((field) => (
                        <div key={field.key} className="meta-row">
                          <dt>
                            <bdi>{field.name}</bdi>
                          </dt>
                          <dd title={field.value}>
                            <bdi>{field.value}</bdi>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ))}
              </div>
            )}
          </section>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </Dialog>
  );
}
