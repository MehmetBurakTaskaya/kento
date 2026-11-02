// SPDX-License-Identifier: MIT
// What an editor knows about its file: ffprobe's answer first, so the timeline works at once, then
// a playable preview (the original, or a proxy the core makes) and, for audio, the waveform peaks.
import { useEffect, useState } from 'react';
import { api, type MediaInfo, type MediaPreview } from '../ipc';

/** Enough peaks for a wide waveform; the canvas takes the highest of each group. */
const PEAK_BUCKETS = 1600;

export interface MediaState {
  info: MediaInfo | null;
  preview: MediaPreview | null;
  /** The preview is still being made. */
  preparing: boolean;
  peaks: number[] | null;
  error: string | null;
}

interface Loaded<T> {
  path: string;
  value: T;
}

export function useMedia(path: string, wantPeaks: boolean): MediaState {
  // Answers are kept with the path they belong to, so another file starts clean.
  const [info, setInfo] = useState<Loaded<MediaInfo> | null>(null);
  const [preview, setPreview] = useState<Loaded<MediaPreview> | null>(null);
  const [peaks, setPeaks] = useState<Loaded<number[]> | null>(null);
  const [error, setError] = useState<Loaded<string> | null>(null);

  useEffect(() => {
    let live = true;
    const failed = (reason: unknown) => live && setError({ path, value: String(reason) });
    api
      .mediaProbe(path)
      .then((value) => live && setInfo({ path, value }))
      .catch(failed);
    api
      .mediaPreview(path)
      .then((value) => live && setPreview({ path, value }))
      .catch((reason) => {
        // Without a preview the editor still works on the timeline.
        if (live) setPreview({ path, value: { url: '', proxy: false } });
        void api.log('warn', `media preview failed: ${String(reason)}`);
      });
    if (wantPeaks) {
      api
        .mediaPeaks(path, PEAK_BUCKETS)
        .then((value) => live && setPeaks({ path, value }))
        .catch((reason) => {
          if (live) setPeaks({ path, value: [] });
          void api.log('warn', `media peaks failed: ${String(reason)}`);
        });
    }
    return () => {
      live = false;
    };
  }, [path, wantPeaks]);

  const mine = <T>(loaded: Loaded<T> | null) => (loaded?.path === path ? loaded.value : null);
  const ready = mine(preview);
  return {
    info: mine(info),
    preview: ready,
    preparing: !ready || (wantPeaks && !mine(peaks)),
    peaks: mine(peaks),
    error: mine(error),
  };
}
