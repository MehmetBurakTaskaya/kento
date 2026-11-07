// SPDX-License-Identifier: MIT
// Rotate video: quarter and half turns, a mirror (left and right swap) and a flip (upside down),
// shown on the picture as the result will be.
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import type { MediaTool, Turn } from '../../ipc';
import { Section } from '../controls';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { isQuarter, turnBy, turnTransform, unchanged } from '../picture';
import { Stage } from '../Stage';
import { formatNumber } from '../time';
import { useEditor } from '../useEditor';

export function RotateVideo(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const video = core.info?.video;
  const [turn, setTurn] = useState<Turn>('none');
  const [mirror, setMirror] = useState(false);
  const [flip, setFlip] = useState(false);
  const same = unchanged(turn, mirror, flip);
  const request: MediaTool | null = video && !same ? { tool: 'rotate-video', turn, mirror, flip } : null;
  const quarter = isQuarter(turn);
  const size = video ? (quarter ? [video.height, video.width] : [video.width, video.height]) : null;
  const toggle = (on: boolean, set: (on: boolean) => void, label: string) => (
    <button type="button" className="button rotate-toggle" aria-pressed={on} onClick={() => set(!on)}>
      {label}
    </button>
  );

  return (
    <EditorShell
      tool="rotate-video"
      core={core}
      request={request}
      stage={
        <div
          className="rotate-preview"
          data-quarter={quarter ? '' : undefined}
          style={{ '--turn': turnTransform(turn, mirror, flip) } as CSSProperties}
        >
          <Stage core={core} />
        </div>
      }
      {...props}
    >
      <Section title={t('editor.rotate.turn')}>
        <div className="rotate-buttons">
          <button type="button" className="button" onClick={() => setTurn(turnBy(turn, -1))}>
            <Icon name="rotate-left" size={18} />
            {t('editor.rotate.left')}
          </button>
          <button type="button" className="button" onClick={() => setTurn(turnBy(turn, 1))}>
            <Icon name="rotate-right" size={18} />
            {t('editor.rotate.right')}
          </button>
        </div>
        <p aria-live="polite">{t(`editor.rotate.now.${turn}`)}</p>
      </Section>
      <Section title={t('editor.rotate.mirrorTitle')}>
        <div className="rotate-buttons">
          {toggle(mirror, setMirror, t('editor.rotate.mirror'))}
          {toggle(flip, setFlip, t('editor.rotate.flip'))}
        </div>
        <p className="editor-hint muted">{t('editor.rotate.hint')}</p>
      </Section>
      <Section title={t('editor.rotate.result')}>
        {size && (
          <p>
            {t('editor.rotate.size', {
              width: formatNumber(size[0]!, core.lang),
              height: formatNumber(size[1]!, core.lang),
            })}
          </p>
        )}
        {same && (turn !== 'none' || mirror || flip) && <p className="editor-hint muted">{t('editor.rotate.same')}</p>}
        <button
          type="button"
          className="button small rotate-reset"
          disabled={turn === 'none' && !mirror && !flip}
          onClick={() => {
            setTurn('none');
            setMirror(false);
            setFlip(false);
          }}
        >
          {t('editor.rotate.reset')}
        </button>
        <p className="editor-hint muted">{t('editor.rotate.keep')}</p>
      </Section>
    </EditorShell>
  );
}
