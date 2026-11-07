// SPDX-License-Identifier: MIT
// Cut out parts: spans taken out of a video or an audio file, the rest joined. Spans come from the
// selection (I and O, then Add or M), show on the timeline and can be removed again.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import type { MediaTool, Span } from '../../ipc';
import { Section } from '../controls';
import { EditorShell } from '../EditorShell';
import { isAudio } from '../media';
import type { EditorProps } from '../panels';
import { keptLength } from '../sound';
import { addSpan, fullSpan, isFull, removeAt, roundSpan } from '../spans';
import { Stage } from '../Stage';
import { formatTime } from '../time';
import { useEditor } from '../useEditor';

export function CutOut(props: EditorProps) {
  const { t } = useTranslation();
  const path = props.paths[0] ?? '';
  const audio = isAudio(path);
  const core = useEditor(path, audio);
  const { lang, duration } = core;
  const [span, setSpan] = useState<Span | null>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const selection = span ?? fullSpan(duration);
  // The whole file is the selection until I or O sets one; cutting all of it leaves nothing.
  const ready = duration > 0 && !isFull(selection, duration);
  const add = () => {
    if (ready) setSpans((list) => addSpan(list, roundSpan(selection)));
  };
  const left = keptLength(spans, duration);
  const request: MediaTool | null = core.info && spans.length && left > 0 ? { tool: 'cut-out', spans } : null;
  const range = (item: Span) =>
    t('editor.range', { start: formatTime(item.start, lang), end: formatTime(item.end, lang) });

  return (
    <EditorShell
      tool="cut-out"
      core={core}
      request={request}
      selection={{ span: selection, set: setSpan }}
      mark={{ label: t('editor.cut.add'), run: add }}
      stage={audio ? undefined : <Stage core={core} />}
      timeline={{ spans: spans.map((item) => ({ span: item })) }}
      {...props}
    >
      <Section title={t('editor.cut.title')}>
        <button type="button" className="button small" disabled={!ready} onClick={add}>
          <Icon name="plus" size={16} />
          {t('editor.cut.add')}
        </button>
        {spans.length === 0 ? (
          <p className="editor-hint muted">{t('editor.cut.empty')}</p>
        ) : (
          <ol className="area-list">
            {spans.map((item, index) => (
              <li key={`${item.start}-${item.end}`} className="area-row">
                <button
                  type="button"
                  className="editor-link"
                  dir="ltr"
                  aria-label={t('editor.goTo', { time: formatTime(item.start, lang) })}
                  onClick={() => {
                    setSpan(item);
                    core.player.seek(item.start);
                  }}
                >
                  {range(item)}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('editor.cut.remove', { range: range(item) })}
                  onClick={() => setSpans((list) => removeAt(list, index))}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ol>
        )}
        {spans.length > 0 &&
          (left > 0 ? (
            <p>
              {t('editor.cut.result', { length: formatTime(left, lang), removed: formatTime(duration - left, lang) })}
            </p>
          ) : (
            <p className="error-text">{t('editor.cut.nothing')}</p>
          ))}
        <p className="editor-hint muted">{t('editor.cut.hint')}</p>
      </Section>
    </EditorShell>
  );
}
