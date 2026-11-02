// SPDX-License-Identifier: MIT
// Merge videos: the clips in the order of the result; the first one sets its size, frame rate and
// sound. Any clip can be previewed.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type FileEntry, type MediaInfo, type MediaTool } from '../../ipc';
import { isolate } from '../../i18n/format';
import { OrderList } from '../../tools/OrderList';
import { Section } from '../controls';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { Stage } from '../Stage';
import { formatNumber, formatTime } from '../time';
import { fileName, useEditor } from '../useEditor';

const entry = (path: string): FileEntry => ({
  path,
  name: fileName(path),
  folder: false,
  format: fileName(path).split('.').pop()?.toLowerCase() ?? null,
  category: 'video',
  size: null,
});

/** What ffprobe says about each clip, once all have answered. */
function useProbes(paths: string[]) {
  const key = paths.join('\n');
  const [found, setFound] = useState<{ key: string; infos: Record<string, MediaInfo> } | null>(null);
  useEffect(() => {
    let live = true;
    const list = key.split('\n');
    Promise.all(list.map((path) => api.mediaProbe(path)))
      .then((infos) => live && setFound({ key, infos: Object.fromEntries(list.map((path, i) => [path, infos[i]!])) }))
      .catch((reason) => void api.log('warn', `clips not probed: ${String(reason)}`));
    return () => {
      live = false;
    };
  }, [key]);
  return found?.key === key ? found.infos : null;
}

export function Merge({ paths, ...props }: EditorProps) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<FileEntry[]>(() => paths.map(entry));
  const [previewed, setPreviewed] = useState(paths[0] ?? '');
  const core = useEditor(previewed, false);
  const infos = useProbes(paths);
  const first = infos?.[order[0]?.path ?? ''];
  const total = infos ? order.reduce((sum, clip) => sum + (infos[clip.path]?.duration ?? 0), 0) : null;
  const request: MediaTool | null = order.length >= 2 ? { tool: 'merge-video' } : null;
  return (
    <EditorShell
      tool="merge-video"
      core={core}
      request={request}
      runPaths={order.map((clip) => clip.path)}
      stage={<Stage core={core} />}
      paths={paths}
      {...props}
    >
      <Section title={t('editor.merge.order')}>
        <p className="editor-hint muted">{t('editor.merge.text')}</p>
        <OrderList items={order} onChange={setOrder} />
        {total != null && (
          <p>{t('editor.merge.total', { count: order.length, length: formatTime(total, core.lang) })}</p>
        )}
        {first?.video && (
          <p className="muted">
            {t('editor.merge.size', {
              width: formatNumber(first.video.width, core.lang),
              height: formatNumber(first.video.height, core.lang),
              fps: formatNumber(first.video.fps, core.lang, 2),
            })}
          </p>
        )}
      </Section>
      <Section title={t('editor.merge.preview')}>
        <select
          aria-label={t('editor.merge.preview')}
          value={previewed}
          onChange={(event) => {
            core.player.pause();
            core.player.seek(0);
            setPreviewed(event.target.value);
          }}
        >
          {order.map((clip, index) => (
            <option key={clip.path} value={clip.path}>
              {t('editor.merge.clip', { index: index + 1, name: isolate(clip.name) })}
            </option>
          ))}
        </select>
      </Section>
    </EditorShell>
  );
}
