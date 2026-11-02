// SPDX-License-Identifier: MIT
// Split video: at markers (M at the playhead), into equal parts or every n seconds; each part is
// kept or dropped.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import type { MediaTool, Span } from '../../ipc';
import { NumberField, Section, Segmented } from '../controls';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { addPoint, removeAt } from '../spans';
import { countParts, keepFlags, MAX_PARTS, partKey, splitParts, type SplitAt } from '../split';
import { Stage } from '../Stage';
import { formatTime } from '../time';
import { useEditor } from '../useEditor';

type Mode = SplitAt['kind'];

export function Split(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const { duration, lang } = core;
  const [mode, setMode] = useState<Mode>('markers');
  const [markers, setMarkers] = useState<number[]>([]);
  const [count, setCount] = useState(2);
  const [seconds, setSeconds] = useState(10);
  const [dropped, setDropped] = useState<ReadonlySet<number>>(new Set());

  const at: SplitAt =
    mode === 'markers'
      ? { kind: 'markers', at: markers }
      : mode === 'parts'
        ? { kind: 'parts', count }
        : { kind: 'every', seconds };
  const total = countParts(at, duration);
  const tooMany = total > MAX_PARTS;
  const parts = tooMany ? [] : splitParts(at, duration);
  const keep = keepFlags(parts, dropped);
  const kept = keep.filter(Boolean).length;
  const request: MediaTool | null =
    core.info && parts.length >= 2 && kept > 0
      ? { tool: 'split-video', at, keep: kept === parts.length ? null : keep }
      : null;

  const addMarker = () => {
    setMode('markers');
    setMarkers((list) => addPoint(list, core.player.time, duration, Math.max(core.fine, 0.1), false));
  };
  const toggle = (part: Span) =>
    setDropped((current) => {
      const next = new Set(current);
      const key = partKey(part);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <EditorShell
      tool="split-video"
      core={core}
      request={request}
      mark={{ label: t('editor.split.add'), run: addMarker }}
      stage={<Stage core={core} />}
      timeline={{
        markers: mode === 'markers' ? markers : undefined,
        parts: parts.length > 1 ? parts.map((span, i) => ({ span, kept: keep[i]! })) : undefined,
      }}
      {...props}
    >
      <Section title={t('editor.split.how')}>
        <Segmented
          label={t('editor.split.how')}
          value={mode}
          options={[
            { value: 'markers', label: t('editor.split.markers') },
            { value: 'parts', label: t('editor.split.parts') },
            { value: 'every', label: t('editor.split.every') },
          ]}
          onChange={setMode}
        />
        {mode === 'markers' &&
          (markers.length === 0 ? (
            <p className="editor-hint muted">{t('editor.split.noMarkers')}</p>
          ) : (
            <ul className="editor-chips">
              {markers.map((marker, index) => {
                const time = formatTime(marker, lang);
                return (
                  <li key={marker} className="editor-chip">
                    <button
                      type="button"
                      className="editor-link"
                      aria-label={t('editor.goTo', { time })}
                      onClick={() => core.player.seek(marker)}
                    >
                      {time}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t('editor.split.removeMarker', { time })}
                      onClick={() => setMarkers((list) => removeAt(list, index))}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}
        {mode === 'parts' && (
          <NumberField
            label={t('editor.split.count')}
            value={count}
            min={2}
            max={MAX_PARTS}
            onChange={(value) => setCount(Math.round(value))}
          />
        )}
        {mode === 'every' && (
          <NumberField
            label={t('editor.split.seconds')}
            value={seconds}
            min={1}
            max={Math.max(1, Math.floor(duration))}
            step={1}
            onChange={setSeconds}
          />
        )}
        {tooMany && <p className="error-text">{t('editor.split.tooMany', { max: MAX_PARTS })}</p>}
      </Section>
      {parts.length > 1 && (
        <Section title={t('editor.split.summary', { count: parts.length, kept })}>
          <ol className="part-list">
            {parts.map((part, index) => {
              const start = formatTime(part.start, lang);
              return (
                <li key={partKey(part)} className="part-row" data-dropped={keep[index] ? undefined : ''}>
                  <label className="editor-check">
                    <input type="checkbox" checked={keep[index]} onChange={() => toggle(part)} />
                    {t('editor.split.part', { index: index + 1 })}
                  </label>
                  <button
                    type="button"
                    className="editor-link"
                    dir="ltr"
                    aria-label={t('editor.goTo', { time: start })}
                    onClick={() => core.player.seek(part.start)}
                  >
                    {t('editor.range', { start, end: formatTime(part.end, lang) })}
                  </button>
                </li>
              );
            })}
          </ol>
          {kept === 0 && <p className="error-text">{t('editor.split.none')}</p>}
        </Section>
      )}
    </EditorShell>
  );
}
