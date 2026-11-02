// SPDX-License-Identifier: MIT
// Trim video and Trim audio: the part between the in and out points stays; audio can also lose the
// silence at its ends.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaTool, Span } from '../../ipc';
import { Section } from '../controls';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { fullSpan, isFull, roundSpan, spanLength } from '../spans';
import { Stage } from '../Stage';
import { formatTime } from '../time';
import { useEditor } from '../useEditor';

export function Trim({ tool, ...props }: EditorProps & { tool: 'trim-video' | 'trim-audio' }) {
  const { t } = useTranslation();
  const audio = tool === 'trim-audio';
  const core = useEditor(props.paths[0] ?? '', audio);
  const [span, setSpan] = useState<Span | null>(null);
  const [silence, setSilence] = useState(false);
  const selection = span ?? fullSpan(core.duration);
  const whole = isFull(selection, core.duration);
  let request: MediaTool | null = null;
  if (core.info && audio && (!whole || silence)) {
    request = { tool: 'trim-audio', span: roundSpan(selection), removeSilence: silence };
  } else if (core.info && !audio && !whole) {
    request = { tool: 'trim-video', span: roundSpan(selection) };
  }
  return (
    <EditorShell
      tool={tool}
      core={core}
      request={request}
      selection={{ span: selection, set: setSpan }}
      stage={audio ? undefined : <Stage core={core} />}
      {...props}
    >
      <Section title={t('editor.trim.title')}>
        <p>
          {t('editor.trim.keep', {
            start: formatTime(selection.start, core.lang),
            end: formatTime(selection.end, core.lang),
          })}
        </p>
        <p className="muted">{t('editor.trim.length', { length: formatTime(spanLength(selection), core.lang) })}</p>
        {audio && (
          <label className="editor-check">
            <input type="checkbox" checked={silence} onChange={(event) => setSilence(event.target.checked)} />
            {t('editor.trim.silence')}
          </label>
        )}
        <p className="editor-hint muted">{t('editor.trim.hint')}</p>
      </Section>
    </EditorShell>
  );
}
