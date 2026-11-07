// SPDX-License-Identifier: MIT
// Stabilize video: a steadier picture in three strengths.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaTool, Strength } from '../../ipc';
import { Section, Segmented } from '../controls';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { Stage } from '../Stage';
import { useEditor } from '../useEditor';

const STRENGTHS: Strength[] = ['light', 'medium', 'strong'];

export function Stabilize(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const [strength, setStrength] = useState<Strength>('medium');
  const request: MediaTool | null = core.info?.video ? { tool: 'stabilize', strength } : null;
  return (
    <EditorShell tool="stabilize" core={core} request={request} stage={<Stage core={core} />} {...props}>
      <Section title={t('editor.stabilize.strength')}>
        <Segmented
          label={t('editor.stabilize.strength')}
          value={strength}
          options={STRENGTHS.map((value) => ({ value, label: t(`variant.strength.${value}`) }))}
          onChange={setStrength}
        />
        <p className="editor-hint muted">{t(`variant.stabilize.${strength}.hint`)}</p>
      </Section>
      <Section title={t('editor.stabilize.how')}>
        <p>{t('editor.stabilize.text')}</p>
        <p className="editor-hint muted">{t('editor.stabilize.time')}</p>
      </Section>
    </EditorShell>
  );
}
