// SPDX-License-Identifier: MIT
// Playback for the editors. With a preview URL a media element plays it; without one (the browser
// stand-in, or a preview the WebView cannot decode) a clock runs instead, so the timeline, the keys
// and the selection still work against the probed duration.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Span } from '../ipc';
import { clampTime } from './time';

export interface Player {
  time: number;
  playing: boolean;
  /** A media element plays the preview; false while the clock stands in for it. */
  live: boolean;
  /** Spread on the <video> element that plays the preview. */
  videoProps: {
    ref(element: HTMLVideoElement | null): void;
    onLoadedMetadata(): void;
    onEnded(): void;
    onError(): void;
  };
  toggle(): void;
  /** Plays from the playhead, up to `until` when given. */
  play(until?: number): void;
  pause(): void;
  seek(seconds: number): void;
  step(seconds: number): void;
  playSpan(span: Span): void;
  /** The playback speed; the pitch stays (SPEC 5.5, Change video speed). */
  setRate(rate: number): void;
}

export function usePlayer(duration: number, url: string): Player {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const live = url !== '' && failed !== url;
  const element = useRef<HTMLVideoElement | null>(null);
  const clock = useRef({ time: 0, playing: false, stopAt: null as number | null, rate: 1 });

  const show = useCallback((seconds: number) => {
    clock.current.time = seconds;
    setTime(seconds);
  }, []);

  const pause = useCallback(() => {
    clock.current.playing = false;
    clock.current.stopAt = null;
    element.current?.pause();
    setPlaying(false);
  }, []);

  const seek = useCallback(
    (seconds: number) => {
      const next = clampTime(seconds, duration);
      if (live && element.current) element.current.currentTime = next;
      show(next);
    },
    [duration, live, show],
  );

  const play = useCallback(
    (until?: number) => {
      if (duration <= 0) return;
      const end = Math.min(until ?? duration, duration);
      // At the end, play starts over.
      if (clock.current.time >= end - 0.01) seek(0);
      clock.current.stopAt = until ?? null;
      clock.current.playing = true;
      setPlaying(true);
      const media = element.current;
      if (live && media) {
        media.play().catch((reason: unknown) => {
          const name = reason instanceof DOMException ? reason.name : '';
          // A pause right after play aborts it; that is not a failure.
          if (name === 'AbortError') return;
          if (name === 'NotSupportedError') setFailed(url);
          else pause();
        });
      }
    },
    [duration, live, pause, seek, url],
  );

  // The playhead follows the element (or the clock) once per frame while playing.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const state = clock.current;
      const media = element.current;
      let next = live && media ? media.currentTime : state.time + ((now - last) / 1000) * state.rate;
      last = now;
      const stop = Math.min(state.stopAt ?? duration, duration);
      if (next >= stop) {
        next = stop;
        state.playing = false;
        state.stopAt = null;
        media?.pause();
        if (live && media) media.currentTime = stop;
        show(next);
        setPlaying(false);
        return;
      }
      show(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, live, duration, show]);

  const setRate = useCallback((rate: number) => {
    clock.current.rate = rate;
    const media = element.current;
    if (media) {
      media.playbackRate = rate;
      media.preservesPitch = true;
    }
  }, []);

  const videoProps = useMemo(
    () => ({
      ref: (media: HTMLVideoElement | null) => {
        element.current = media;
        if (media) {
          media.playbackRate = clock.current.rate;
          media.preservesPitch = true;
        }
      },
      onLoadedMetadata: () => {
        const media = element.current;
        if (media) media.currentTime = clock.current.time;
      },
      // A proxy can end a little before the probed duration.
      onEnded: pause,
      onError: () => setFailed(url),
    }),
    [pause, url],
  );

  return {
    time,
    playing,
    live,
    videoProps,
    toggle: () => (clock.current.playing ? pause() : play()),
    play,
    pause,
    seek,
    step: (seconds) => seek(clock.current.time + seconds),
    playSpan: (span) => {
      seek(span.start);
      play(span.end);
    },
    setRate,
  };
}
