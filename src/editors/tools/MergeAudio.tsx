// SPDX-License-Identifier: MIT
// Merge audio: audio files in the order of the result, joined end to end or overlapping by a
// crossfade; the first one sets the format, rate and channels. Any file can be previewed.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileEntry, MediaTool } from '../../ipc';
import { isolate } from '../../i18n/format';
import { OrderList } from '../../tools/OrderList';
import { Section } from '../controls';
import { EditorShell } from '../EditorShell';
import { Slider } from '../image/controls';
import type { EditorProps } from '../panels';
import { CROSSFADE_MAX, crossfadeFor, mergedLength, useProbes } from '../sound';
import { formatNumber, formatTime } from '../time';
import { fileName, useEditor } from '../useEditor';

const entry = (path: string): FileEntry => ({
  path,
  name: fileName(path),
  folder: false,
  format: fileName(path).split('.').pop()?.toLowerCase() ?? null,
  category: 'audio',
  size: null,
});

export function MergeAudio({ paths, ...props }: EditorProps) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<FileEntry[]>(() => paths.map(entry));
  const [previewed, setPreviewed] = useState(paths[0] ?? '');
  const [crossfade, setCrossfade] = useState(0);
  const core = useEditor(previewed, true);
  const { lang } = core;
  const infos = useProbes(paths);
  const lengths = infos ? order.map((file) => infos[file.path]?.duration ?? 0) : null;
  const overlap = lengths ? crossfadeFor(crossfade, lengths) : 0;
  const capped = lengths !== null && overlap < Math.min(crossfade, CROSSFADE_MAX) - 0.001;
  const first = infos?.[order[0]?.path ?? '']?.audio;
  const request: MediaTool | null = order.length >= 2 && lengths ? { tool: 'merge-audio', crossfade: overlap } : null;
  const seconds = (value: number) => t('editor.mergeAudio.seconds', { value: formatNumber(value, lang, 1) });

  return (
    <EditorShell
      tool="merge-audio"
      core={core}
      request={request}
      runPaths={order.map((file) => file.path)}
      paths={paths}
      {...props}
    >
      <Section title={t('editor.mergeAudio.order')}>
        <p className="editor-hint muted">{t('editor.mergeAudio.text')}</p>
        <OrderList items={order} onChange={setOrder} />
        {lengths && (
          <p>
            {t('editor.mergeAudio.total', {
              count: order.length,
              length: formatTime(mergedLength(lengths, overlap), lang),
            })}
          </p>
        )}
        {first && (
          <p className="muted">
            {t('editor.mergeAudio.format', {
              channels: first.channels,
              rate: formatNumber(first.sampleRate / 1000, lang, 1),
            })}
          </p>
        )}
      </Section>
      <Section title={t('editor.mergeAudio.crossfade')}>
        <Slider
          label={t('editor.mergeAudio.overlap')}
          value={crossfade}
          min={0}
          max={CROSSFADE_MAX}
          step={0.5}
          text={crossfade > 0 ? seconds(crossfade) : t('editor.mergeAudio.none')}
          onChange={setCrossfade}
        />
        <p className={capped ? 'sound-note' : 'editor-hint muted'}>
          {capped ? t('editor.mergeAudio.capped', { value: seconds(overlap) }) : t('editor.mergeAudio.hint')}
        </p>
      </Section>
      <Section title={t('editor.mergeAudio.preview')}>
        <select
          aria-label={t('editor.mergeAudio.preview')}
          value={previewed}
          onChange={(event) => {
            core.player.pause();
            core.player.seek(0);
            setPreviewed(event.target.value);
          }}
        >
          {order.map((file, index) => (
            <option key={file.path} value={file.path}>
              {t('editor.mergeAudio.file', { index: index + 1, name: isolate(file.name) })}
            </option>
          ))}
        </select>
      </Section>
    </EditorShell>
  );
}
