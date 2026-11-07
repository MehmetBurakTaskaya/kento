// SPDX-License-Identifier: MIT
// Reverse and loop: backwards (the sound too), a boomerang (forwards then backwards, without sound) or
// the clip repeated, up to ten times.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LoopMode, MediaTool } from '../../ipc';
import { Section, Segmented } from '../controls';
import { EditorShell } from '../EditorShell';
import { Slider } from '../image/controls';
import type { EditorProps } from '../panels';
import { loopLength, MAX_LOOPS } from '../picture';
import { Stage } from '../Stage';
import { formatTime } from '../time';
import { useEditor } from '../useEditor';

export function LoopVideo(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const [mode, setMode] = useState<LoopMode>('reverse');
  const [count, setCount] = useState(3);
  const times = mode === 'reverse' ? 1 : count;
  const request: MediaTool | null = core.info?.video ? { tool: 'loop-video', mode, count: times } : null;
  const sound = Boolean(core.info?.audio);
  return (
    <EditorShell tool="loop-video" core={core} request={request} stage={<Stage core={core} />} {...props}>
      <Section title={t('editor.loop.mode')}>
        <Segmented
          label={t('editor.loop.mode')}
          value={mode}
          options={[
            { value: 'reverse', label: t('variant.loop.reverse') },
            { value: 'boomerang', label: t('variant.loop.boomerang') },
            { value: 'repeat', label: t('editor.loop.repeat') },
          ]}
          onChange={setMode}
        />
        <p className="editor-hint muted">{t(`editor.loop.${mode}Hint`)}</p>
        {mode !== 'reverse' && (
          <Slider
            label={t('editor.loop.count')}
            value={count}
            min={1}
            max={MAX_LOOPS}
            text={t('editor.loop.times', { count })}
            onChange={setCount}
          />
        )}
      </Section>
      <Section title={t('editor.loop.result')}>
        <p>{t('editor.loop.length', { length: formatTime(loopLength(mode, times, core.duration), core.lang) })}</p>
        {sound && mode === 'boomerang' && <p className="editor-hint muted">{t('editor.loop.silent')}</p>}
        {mode !== 'repeat' && <p className="editor-hint muted">{t('editor.loop.slow')}</p>}
      </Section>
    </EditorShell>
  );
}
