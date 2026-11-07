// SPDX-License-Identifier: MIT
// Remove noise: FFT noise reduction in three strengths, and optionally the lowest rumble taken away.
// The preview plays the file as it is; the change is heard in the saved file.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaTool, Strength } from '../../ipc';
import { Section, Segmented } from '../controls';
import { EditorShell } from '../EditorShell';
import { Check } from '../image/controls';
import { isAudio } from '../media';
import type { EditorProps } from '../panels';
import { Stage } from '../Stage';
import { useEditor } from '../useEditor';

const STRENGTHS: Strength[] = ['light', 'medium', 'strong'];

export function Denoise(props: EditorProps) {
  const { t } = useTranslation();
  const path = props.paths[0] ?? '';
  const audio = isAudio(path);
  const core = useEditor(path, audio);
  const [strength, setStrength] = useState<Strength>('medium');
  const [rumble, setRumble] = useState(false);
  const silent = core.info !== null && !core.info.audio;
  const request: MediaTool | null = core.info?.audio ? { tool: 'denoise', strength, rumble } : null;

  return (
    <EditorShell
      tool="denoise"
      core={core}
      request={request}
      stage={audio ? undefined : <Stage core={core} />}
      {...props}
    >
      <Section title={t('editor.denoise.strength')}>
        <Segmented
          label={t('editor.denoise.strength')}
          value={strength}
          options={STRENGTHS.map((value) => ({ value, label: t(`variant.strength.${value}`) }))}
          onChange={setStrength}
        />
        <p className="muted">{t(`variant.denoise.${strength}.hint`)}</p>
        <Check label={t('editor.denoise.rumble')} checked={rumble} onChange={setRumble} />
        <p className="editor-hint muted">{t('editor.denoise.rumbleHint')}</p>
        {silent ? (
          <p className="error-text">{t('editor.denoise.noSound')}</p>
        ) : (
          <p className="sound-note">{t('editor.denoise.preview')}</p>
        )}
      </Section>
    </EditorShell>
  );
}
