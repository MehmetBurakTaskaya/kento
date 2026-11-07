// SPDX-License-Identifier: MIT
// Merge videos: the clips in the order of the result, and how one goes into the next; the first
// one sets its size, frame rate and sound. Any clip can be previewed.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type FileEntry, type MediaInfo, type MediaTool, type TransitionKind } from '../../ipc';
import { isolate } from '../../i18n/format';
import { OrderList } from '../../tools/OrderList';
import { Section, Segmented } from '../controls';
import { EditorShell } from '../EditorShell';
import { Slider } from '../image/controls';
import type { EditorProps } from '../panels';
import { Stage } from '../Stage';
import { clamp, formatNumber, formatTime } from '../time';
import { fileName, useEditor } from '../useEditor';

const KINDS: TransitionKind[] = ['cut', 'fade', 'fade-black', 'slide', 'wipe'];

/** How long a transition lasts, as the engine takes it (media::Transition). */
export const TRANSITION_SECONDS = { min: 0.2, max: 2, default: 0.5 };

/**
 * The result's length: the clips' lengths less every overlap. As in the engine, each transition
 * lasts `seconds` (0.2 to 2) but never more than a third of the shorter of its two clips.
 */
export function mergedLength(lengths: number[], kind: TransitionKind, seconds: number): number {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (kind === 'cut') return total;
  const wanted = clamp(seconds, TRANSITION_SECONDS.min, TRANSITION_SECONDS.max);
  let overlaps = 0;
  for (let i = 1; i < lengths.length; i++) {
    overlaps += Math.min(wanted, Math.min(lengths[i - 1]!, lengths[i]!) / 3);
  }
  return total - overlaps;
}

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
  const [kind, setKind] = useState<TransitionKind>('cut');
  const [seconds, setSeconds] = useState(TRANSITION_SECONDS.default);
  const first = infos?.[order[0]?.path ?? ''];
  const total = infos
    ? mergedLength(
        order.map((clip) => infos[clip.path]?.duration ?? 0),
        kind,
        seconds,
      )
    : null;
  const request: MediaTool | null = order.length >= 2 ? { tool: 'merge-video', transition: { kind, seconds } } : null;
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
      <Section title={t('editor.merge.transition')}>
        <div className="merge-transition">
          <Segmented
            label={t('editor.merge.transition')}
            value={kind}
            options={KINDS.map((value) => ({ value, label: t(`editor.merge.transition.${value}`) }))}
            onChange={setKind}
          />
          {kind !== 'cut' && (
            <>
              <Slider
                label={t('editor.merge.transitionLength')}
                value={seconds}
                min={TRANSITION_SECONDS.min}
                max={TRANSITION_SECONDS.max}
                step={0.1}
                text={t('editor.merge.transitionSeconds', { seconds: formatNumber(seconds, core.lang, 1) })}
                onChange={setSeconds}
              />
              <p className="editor-hint muted">{t('editor.merge.transitionHint')}</p>
            </>
          )}
        </div>
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
