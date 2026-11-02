// SPDX-License-Identifier: MIT
// Change video speed: 0.25× to 4×, previewed at that speed with the pitch kept, as the result is.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaTool } from '../../ipc';
import { Section, Segmented } from '../controls';
import { EditorShell } from '../EditorShell';
import { lengthAtSpeed, sliderFromSpeed, SPEED_PRESETS, speedFromSlider } from '../levels';
import type { EditorProps } from '../panels';
import { Stage } from '../Stage';
import { formatTime } from '../time';
import { useEditor } from '../useEditor';

export function Speed(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const [factor, setFactor] = useState(1);
  const { setRate } = core.player;
  useEffect(() => setRate(factor), [factor, setRate]);
  const request: MediaTool | null = core.info && factor !== 1 ? { tool: 'speed', factor } : null;
  const label = (value: number) => t('editor.speed.factor', { factor: value });
  return (
    <EditorShell tool="speed" core={core} request={request} stage={<Stage core={core} />} {...props}>
      <Section title={t('editor.speed.title')}>
        <p className="editor-big" aria-hidden="true">
          {label(factor)}
        </p>
        <input
          type="range"
          className="editor-range"
          min={-2}
          max={2}
          step={0.01}
          value={sliderFromSpeed(factor)}
          aria-label={t('editor.speed.title')}
          aria-valuetext={label(factor)}
          onChange={(event) => setFactor(speedFromSlider(Number(event.target.value)))}
        />
        <Segmented
          label={t('editor.speed.presets')}
          value={factor}
          options={SPEED_PRESETS.map((value) => ({ value, label: label(value) }))}
          onChange={setFactor}
        />
        <p>{t('editor.speed.length', { length: formatTime(lengthAtSpeed(core.duration, factor), core.lang) })}</p>
        <p className="editor-hint muted">{t('editor.speed.pitch')}</p>
      </Section>
    </EditorShell>
  );
}
