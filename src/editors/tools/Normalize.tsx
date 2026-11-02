// SPDX-License-Identifier: MIT
// Normalize loudness: an EBU R128 target with the loudness range and true peak, measured first and
// applied in a second pass by the engine.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaTool } from '../../ipc';
import { NumberField, Section } from '../controls';
import { EditorShell } from '../EditorShell';
import { LOUDNESS, LOUDNESS_PRESETS } from '../levels';
import type { EditorProps } from '../panels';
import { formatNumber } from '../time';
import { useEditor } from '../useEditor';

type Preset = (typeof LOUDNESS_PRESETS)[number]['id'] | 'custom';

export function Normalize(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', true);
  const { lang } = core;
  const [preset, setPreset] = useState<Preset>('podcast');
  const [custom, setCustom] = useState<number>(LOUDNESS.target.value);
  const [range, setRange] = useState<number>(LOUDNESS.range.value);
  const [peak, setPeak] = useState<number>(LOUDNESS.peak.value);
  const target = LOUDNESS_PRESETS.find((option) => option.id === preset)?.target ?? custom;
  const request: MediaTool | null = core.info ? { tool: 'normalize', loudness: { target, range, peak } } : null;
  const lufs = (value: number) => t('editor.normalize.lufs', { value: formatNumber(value, lang, 1) });

  return (
    <EditorShell tool="normalize" core={core} request={request} {...props}>
      <Section title={t('editor.normalize.target')}>
        <fieldset className="choices editor-choices">
          <legend className="visually-hidden">{t('editor.normalize.target')}</legend>
          {LOUDNESS_PRESETS.map((option) => (
            <label key={option.id} className="choice">
              <input
                type="radio"
                name="loudness"
                checked={preset === option.id}
                onChange={() => setPreset(option.id)}
              />
              <span>{t(`editor.normalize.${option.id}`)}</span>
              <span className="muted">{lufs(option.target)}</span>
            </label>
          ))}
          <label className="choice">
            <input type="radio" name="loudness" checked={preset === 'custom'} onChange={() => setPreset('custom')} />
            <span>{t('editor.normalize.custom')}</span>
          </label>
        </fieldset>
        {preset === 'custom' && (
          <NumberField
            label={t('editor.normalize.customValue')}
            value={custom}
            min={LOUDNESS.target.min}
            max={LOUDNESS.target.max}
            step={0.5}
            suffix={t('editor.normalize.unit')}
            onChange={setCustom}
          />
        )}
      </Section>
      <Section title={t('editor.normalize.more')}>
        <label className="editor-field">
          <span>
            {t('editor.normalize.range')}
            <output className="editor-value">
              {t('editor.normalize.lu', { value: formatNumber(range, lang, 1) })}
            </output>
          </span>
          <input
            type="range"
            className="editor-range"
            min={LOUDNESS.range.min}
            max={LOUDNESS.range.max}
            step={1}
            value={range}
            onChange={(event) => setRange(Number(event.target.value))}
          />
        </label>
        <label className="editor-field">
          <span>
            {t('editor.normalize.peak')}
            <output className="editor-value">
              {t('editor.normalize.dbtp', { value: formatNumber(peak, lang, 1) })}
            </output>
          </span>
          <input
            type="range"
            className="editor-range"
            min={LOUDNESS.peak.min}
            max={LOUDNESS.peak.max}
            step={0.5}
            value={peak}
            onChange={(event) => setPeak(Number(event.target.value))}
          />
        </label>
        <p className="editor-hint muted">{t('editor.normalize.text')}</p>
      </Section>
    </EditorShell>
  );
}
