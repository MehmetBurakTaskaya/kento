// SPDX-License-Identifier: MIT
// Remove pauses: the quiet gaps the engine finds with these settings, shown on the timeline over
// the waveform with how much time they take, before anything is written. The job finds them again
// with the same function (ARCHITECTURE 55), so it cuts exactly what the timeline shows.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type MediaTool, type Pauses, type Span } from '../../ipc';
import { Section } from '../controls';
import { EditorShell } from '../EditorShell';
import { Slider } from '../image/controls';
import { isAudio } from '../media';
import type { EditorProps } from '../panels';
import { PAUSE_RANGES, PAUSES, spansLength, useSoundPeaks } from '../sound';
import { Stage } from '../Stage';
import type { TimelineSpan } from '../Timeline';
import { formatNumber, formatTime } from '../time';
import { useEditor } from '../useEditor';

/** How long the sliders rest before the search starts again. */
const SETTLE_MS = 350;

const keyOf = (pauses: Pauses) => `${pauses.threshold}|${pauses.minLength}|${pauses.keep}`;

interface Found {
  key: string;
  spans: Span[] | null;
  error: string | null;
}

/** The pauses of `path` with `pauses`, searched again a moment after the settings change. */
function usePauses(path: string, pauses: Pauses, enabled: boolean) {
  const key = keyOf(pauses);
  const [found, setFound] = useState<Found | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const [threshold, minLength, keep] = key.split('|').map(Number) as [number, number, number];
    const timer = window.setTimeout(() => {
      api
        .mediaPauses(path, { threshold, minLength, keep })
        .then((spans) => live && setFound({ key, spans, error: null }))
        .catch((reason) => live && setFound({ key, spans: null, error: String(reason) }));
    }, SETTLE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [path, key, enabled]);
  const current = found?.key === key ? found : null;
  return { spans: current?.spans ?? null, error: current?.error ?? null, finding: enabled && !current };
}

export function RemovePauses(props: EditorProps) {
  const { t } = useTranslation();
  const path = props.paths[0] ?? '';
  const audio = isAudio(path);
  const core = useEditor(path, audio);
  const { lang, duration } = core;
  const peaks = useSoundPeaks(core);
  const [pauses, setPauses] = useState<Pauses>(PAUSES);
  const silent = core.info !== null && !core.info.audio;
  const found = usePauses(path, pauses, core.info !== null && !silent);
  const spans = found.spans ?? [];
  const saved = spansLength(spans);
  const request: MediaTool | null =
    core.info && !found.finding && spans.length > 0 ? { tool: 'remove-pauses', pauses } : null;
  const set = (change: Partial<Pauses>) => setPauses((current) => ({ ...current, ...change }));
  const seconds = (value: number) => t('editor.pauses.seconds', { value: formatNumber(value, lang, 2) });
  // Passed as a whole so the timeline shows the waveform of a video's sound too (the editor's
  // shell draws one for audio files only).
  const timeline: { spans: TimelineSpan[]; peaks: number[] | null } = {
    spans: spans.map((span) => ({ span })),
    peaks: core.audio || core.info?.audio ? (peaks ?? []) : null,
  };

  return (
    <EditorShell
      tool="remove-pauses"
      core={core}
      request={request}
      stage={audio ? undefined : <Stage core={core} />}
      timeline={timeline}
      {...props}
    >
      <Section title={t('editor.pauses.found')}>
        <div className="sound-pauses" role="status">
          {silent ? (
            <p className="error-text">{t('editor.pauses.noSound')}</p>
          ) : found.error ? (
            <p className="error-text">{found.error}</p>
          ) : found.finding ? (
            <p className="muted">{t('editor.pauses.finding')}</p>
          ) : (
            <>
              <p className="editor-big">{t('editor.pauses.count', { count: spans.length })}</p>
              {spans.length > 0 && (
                <p>
                  {t('editor.pauses.saved', {
                    saved: formatTime(saved, lang),
                    length: formatTime(Math.max(0, duration - saved), lang),
                  })}
                </p>
              )}
            </>
          )}
        </div>
      </Section>
      <Section title={t('editor.pauses.settings')}>
        <Slider
          label={t('editor.pauses.threshold')}
          value={pauses.threshold}
          {...PAUSE_RANGES.threshold}
          text={t('editor.pauses.db', { value: formatNumber(pauses.threshold, lang) })}
          onChange={(threshold) => set({ threshold })}
        />
        <Slider
          label={t('editor.pauses.minLength')}
          value={pauses.minLength}
          {...PAUSE_RANGES.minLength}
          text={seconds(pauses.minLength)}
          onChange={(minLength) => set({ minLength: Math.round(minLength * 10) / 10 })}
        />
        <Slider
          label={t('editor.pauses.keep')}
          value={pauses.keep}
          {...PAUSE_RANGES.keep}
          text={seconds(pauses.keep)}
          onChange={(keep) => set({ keep: Math.round(keep * 100) / 100 })}
        />
        <p className="editor-hint muted">{t('editor.pauses.hint')}</p>
      </Section>
    </EditorShell>
  );
}
