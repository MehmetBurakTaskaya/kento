// SPDX-License-Identifier: MIT
// Extract frames: moments chosen at the playhead (M), each saved as a PNG; the list shows them.
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { api, type MediaTool } from '../../ipc';
import { Picture, Section, useBlobUrl } from '../controls';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { addPoint, removeAt } from '../spans';
import { Stage } from '../Stage';
import { formatTime } from '../time';
import { useEditor } from '../useEditor';

// The list re-renders on every frame of playback; a thumbnail only when its moment changes.
const FrameThumb = memo(function FrameThumb({ path, at }: { path: string; at: number }) {
  const src = useBlobUrl(() => api.mediaFrame(path, at, 240), `${path}|${at}`);
  return (
    <span className="frame-thumb">
      <Picture src={src} icon="image" />
    </span>
  );
});

export function Frames(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const [frames, setFrames] = useState<number[]>([]);
  const add = () => setFrames((list) => addPoint(list, core.player.time, core.duration, core.fine / 2));
  const request: MediaTool | null = frames.length ? { tool: 'frames', at: frames } : null;
  return (
    <EditorShell
      tool="frames"
      core={core}
      request={request}
      mark={{ label: t('editor.frames.add'), run: add }}
      stage={<Stage core={core} />}
      timeline={{ markers: frames }}
      {...props}
    >
      <Section title={t('editor.frames.count', { count: frames.length })}>
        {frames.length === 0 ? (
          <p className="editor-hint muted">{t('editor.frames.empty')}</p>
        ) : (
          <ul className="frame-list">
            {frames.map((at, index) => {
              const time = formatTime(at, core.lang);
              return (
                <li key={at} className="frame-card">
                  <FrameThumb path={core.path} at={at} />
                  <button
                    type="button"
                    className="editor-link"
                    aria-label={t('editor.goTo', { time })}
                    onClick={() => core.player.seek(at)}
                  >
                    {time}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('editor.frames.remove', { time })}
                    onClick={() => setFrames((list) => removeAt(list, index))}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {frames.length > 0 && (
          <button type="button" className="button small quiet" onClick={() => setFrames([])}>
            {t('editor.frames.clear')}
          </button>
        )}
      </Section>
    </EditorShell>
  );
}
