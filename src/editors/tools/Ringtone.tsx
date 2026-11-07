// SPDX-License-Identifier: MIT
// Make a ringtone: at most 40 seconds of a song or of a video's sound, faded in and out, as M4R or
// MP3. The selection never grows past 40 seconds: the end that moves pulls the other along.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaTool, Span } from '../../ipc';
import { Section, Segmented } from '../controls';
import { EditorShell } from '../EditorShell';
import { Check } from '../image/controls';
import { isAudio } from '../media';
import type { EditorProps } from '../panels';
import { limitSpan, RINGTONE_FIRST, RINGTONE_MAX } from '../sound';
import { roundSpan, spanLength } from '../spans';
import { Stage } from '../Stage';
import { formatTime } from '../time';
import { useEditor } from '../useEditor';

type Format = 'm4r' | 'mp3';

/** The shortest ringtone worth saving. */
const SHORTEST = 0.5;

export function Ringtone(props: EditorProps) {
  const { t } = useTranslation();
  const path = props.paths[0] ?? '';
  const audio = isAudio(path);
  const core = useEditor(path, audio);
  const { lang, duration } = core;
  const [span, setSpan] = useState<Span | null>(null);
  const [limited, setLimited] = useState(false);
  const [fade, setFade] = useState(true);
  const [format, setFormat] = useState<Format>('m4r');
  const selection = span ?? { start: 0, end: Math.min(duration, RINGTONE_FIRST) };
  const length = spanLength(selection);
  const silent = core.info !== null && !core.info.audio;
  const request: MediaTool | null =
    core.info?.audio && length >= SHORTEST ? { tool: 'ringtone', span: roundSpan(selection), fade, format } : null;
  const choose = (next: Span) => {
    const kept = limitSpan(next, selection, RINGTONE_MAX, duration);
    setLimited(spanLength(next) > RINGTONE_MAX + 1e-6);
    setSpan(kept);
  };

  return (
    <EditorShell
      tool="ringtone"
      core={core}
      request={request}
      selection={{ span: selection, set: choose }}
      stage={audio ? undefined : <Stage core={core} />}
      {...props}
    >
      <Section title={t('editor.ringtone.part')}>
        <p>{t('editor.ringtone.length', { length: formatTime(length, lang) })}</p>
        <p className={limited ? 'sound-note' : 'muted'} role={limited ? 'status' : undefined}>
          {t(limited ? 'editor.ringtone.limited' : 'editor.ringtone.most', { max: RINGTONE_MAX })}
        </p>
        <Check label={t('editor.ringtone.fade')} checked={fade} onChange={setFade} />
        {silent && <p className="error-text">{t('editor.ringtone.noSound')}</p>}
      </Section>
      <Section title={t('editor.ringtone.format')}>
        <Segmented
          label={t('editor.ringtone.format')}
          value={format}
          options={[
            { value: 'm4r', label: t('editor.ringtone.m4r') },
            { value: 'mp3', label: t('editor.ringtone.mp3') },
          ]}
          onChange={setFormat}
        />
        <p className="editor-hint muted">{t(`editor.ringtone.${format}Hint`)}</p>
      </Section>
    </EditorShell>
  );
}
