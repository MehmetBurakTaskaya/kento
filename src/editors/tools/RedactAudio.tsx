// SPDX-License-Identifier: MIT
// Redact audio: spans taken from the selection, shown on the waveform, become a beep or silence.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import type { MediaTool, Span } from '../../ipc';
import { Section, Segmented } from '../controls';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { addSpan, fullSpan, removeAt, roundSpan } from '../spans';
import { formatTime } from '../time';
import { useEditor } from '../useEditor';

export function RedactAudio(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', true);
  const { lang } = core;
  const [span, setSpan] = useState<Span | null>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const [beep, setBeep] = useState(true);
  const selection = span ?? fullSpan(core.duration);
  const request: MediaTool | null = spans.length ? { tool: 'redact-audio', spans, beep } : null;
  const range = (item: Span) =>
    t('editor.range', { start: formatTime(item.start, lang), end: formatTime(item.end, lang) });

  return (
    <EditorShell
      tool="redact-audio"
      core={core}
      request={request}
      selection={{ span: selection, set: setSpan }}
      timeline={{ spans: spans.map((item) => ({ span: item })) }}
      {...props}
    >
      <Section title={t('editor.redactAudio.spans')}>
        <button
          type="button"
          className="button small"
          disabled={core.duration <= 0}
          onClick={() => setSpans((list) => addSpan(list, roundSpan(selection)))}
        >
          <Icon name="plus" size={16} />
          {t('editor.redactAudio.add')}
        </button>
        {spans.length === 0 ? (
          <p className="editor-hint muted">{t('editor.redactAudio.empty')}</p>
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
                  aria-label={t('editor.redactAudio.remove', { range: range(item) })}
                  onClick={() => setSpans((list) => removeAt(list, index))}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title={t('editor.redactAudio.with')}>
        <Segmented
          label={t('editor.redactAudio.with')}
          value={beep ? 'beep' : 'silence'}
          options={[
            { value: 'beep', label: t('editor.redactAudio.beep') },
            { value: 'silence', label: t('editor.redactAudio.silence') },
          ]}
          onChange={(value) => setBeep(value === 'beep')}
        />
      </Section>
    </EditorShell>
  );
}
