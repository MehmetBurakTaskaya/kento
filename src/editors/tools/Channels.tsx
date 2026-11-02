// SPDX-License-Identifier: MIT
// Audio channels: mono, stereo, or left and right levels, with a picture of each channel after the
// change.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaTool } from '../../ipc';
import { Section, Segmented } from '../controls';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { Waveform } from '../Timeline';
import { useEditor } from '../useEditor';

type Mode = 'mono' | 'stereo' | 'levels';

export function Channels(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', true);
  const source = core.info?.audio?.channels ?? 0;
  const [mode, setMode] = useState<Mode | null>(null);
  const [left, setLeft] = useState(1);
  const [right, setRight] = useState(1);
  // A mono file most likely wants stereo, anything else mono.
  const chosen = mode ?? (source === 1 ? 'stereo' : 'mono');
  const changes = chosen === 'mono' ? source !== 1 : chosen === 'stereo' ? source !== 2 : left !== 1 || right !== 1;
  const request: MediaTool | null =
    core.info && changes
      ? { tool: 'channels', channels: chosen === 'levels' ? { kind: 'levels', left, right } : { kind: chosen } }
      : null;
  const gains = chosen === 'levels' ? [left, right] : [1, 1];
  const peaks = core.media.peaks ?? [];

  const level = (label: string, value: number, set: (value: number) => void) => (
    <label className="editor-field">
      <span>
        {label}
        <output className="editor-value">{t('editor.channels.level', { value })}</output>
      </span>
      <input
        type="range"
        className="editor-range"
        min={0}
        max={2}
        step={0.05}
        value={value}
        aria-valuetext={t('editor.channels.level', { value })}
        onChange={(event) => set(Number(event.target.value))}
      />
    </label>
  );

  return (
    <EditorShell
      tool="channels"
      core={core}
      request={request}
      stage={
        <section className="channel-preview" aria-label={t('editor.channels.preview')}>
          <h3 className="editor-heading">{t('editor.channels.preview')}</h3>
          <div className="channel-lanes" dir="ltr">
            {[t('editor.channels.leftShort'), t('editor.channels.rightShort')].map((name, i) => (
              <div key={name} className="channel-lane">
                <span className="channel-name">{name}</span>
                {peaks.length > 0 && <Waveform peaks={peaks} gain={gains[i]} />}
              </div>
            ))}
          </div>
        </section>
      }
      {...props}
    >
      <Section title={t('editor.channels.title')}>
        {source > 0 && <p className="muted">{t('editor.channels.source', { count: source })}</p>}
        <Segmented
          label={t('editor.channels.title')}
          value={chosen}
          options={[
            { value: 'mono', label: t('editor.channels.mono'), disabled: source === 1 },
            { value: 'stereo', label: t('editor.channels.stereo'), disabled: source === 2 },
            { value: 'levels', label: t('editor.channels.levels') },
          ]}
          onChange={setMode}
        />
        {chosen === 'levels' && (
          <>
            {level(t('editor.channels.left'), left, setLeft)}
            {level(t('editor.channels.right'), right, setRight)}
          </>
        )}
        <p className="editor-hint muted">{t('editor.channels.hint')}</p>
      </Section>
    </EditorShell>
  );
}
