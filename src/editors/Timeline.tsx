// SPDX-License-Identifier: MIT
// The timeline shared by the editors: a ruler, the waveform for audio, the playhead, the in/out
// handles, markers, spans and split parts. It stays left to right in every language (SPEC 5.19).
// Dragging anywhere scrubs; the handles are sliders for screen readers and the keyboard.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Span } from '../ipc';
import { resamplePeaks } from './levels';
import { dragEnd, dragStart } from './spans';
import { clamp, formatTime, tickStep, ticks } from './time';

export interface TimelineSpan {
  span: Span;
  /** A selected item's span is drawn stronger. */
  current?: boolean;
}

export interface TimelinePart {
  span: Span;
  kept: boolean;
}

export interface TimelineProps {
  duration: number;
  time: number;
  /** The step of Shift+arrow on a handle. */
  fine: number;
  onSeek(seconds: number): void;
  selection?: Span | null;
  onSelection?(span: Span): void;
  markers?: number[];
  spans?: TimelineSpan[];
  parts?: TimelinePart[];
  /** Waveform peaks from 0 to 1; the track grows taller with them. */
  peaks?: number[] | null;
}

/** The width a ruler label needs, in CSS pixels. */
const LABEL_ROOM = 44;

const percent = (at: number, duration: number) => `${duration > 0 ? clamp(at / duration, 0, 1) * 100 : 0}%`;

/** A canvas waveform in the element's text color, redrawn on resize and on a theme change. */
export function Waveform({ peaks, gain = 1, className }: { peaks: number[]; gain?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const { width, height } = element.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      element.width = Math.max(1, Math.round(width * scale));
      element.height = Math.max(1, Math.round(height * scale));
      const context = element.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, element.width, element.height);
      context.fillStyle = getComputedStyle(element).color;
      // One bar every 3 CSS pixels: 2 drawn, 1 gap.
      const bar = 3 * scale;
      const values = resamplePeaks(peaks, Math.floor(element.width / bar));
      const middle = element.height / 2;
      values.forEach((value, i) => {
        const half = Math.max(scale / 2, Math.min(1, value * gain) * middle);
        context.fillRect(i * bar, middle - half, 2 * scale, half * 2);
      });
    };
    draw();
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    resized?.observe(element);
    // Tokens change on <html> when the theme does.
    const themed = new MutationObserver(draw);
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => {
      resized?.disconnect();
      themed.disconnect();
    };
  }, [peaks, gain]);
  return <canvas ref={canvas} className={className ? `waveform ${className}` : 'waveform'} aria-hidden="true" />;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function Timeline({
  duration,
  time,
  fine,
  onSeek,
  selection,
  onSelection,
  markers,
  spans,
  parts,
  peaks,
}: TimelineProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { ref: track, width } = useWidth();
  // What the pointer is dragging, if anything.
  const drag = useRef<'scrub' | 'start' | 'end' | null>(null);
  const step = tickStep(duration, width || 640);

  const at = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return clamp((clientX - box.left) / box.width, 0, 1) * duration;
  };

  const follow = (clientX: number) => {
    const seconds = at(clientX);
    if (drag.current === 'scrub') onSeek(seconds);
    else if (selection && onSelection && drag.current === 'start') onSelection(dragStart(selection, seconds));
    else if (selection && onSelection && drag.current === 'end') onSelection(dragEnd(selection, seconds, duration));
  };

  const down = (event: PointerEvent<HTMLElement>, what: 'scrub' | 'start' | 'end') => {
    if (event.button !== 0 || duration <= 0) return;
    event.stopPropagation();
    event.preventDefault();
    drag.current = what;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (what === 'scrub') follow(event.clientX);
    else event.currentTarget.focus();
  };

  const handlers = {
    onPointerMove: (event: PointerEvent<HTMLElement>) => drag.current && follow(event.clientX),
    onPointerUp: () => (drag.current = null),
    onPointerCancel: () => (drag.current = null),
  };

  // Arrow keys move a focused handle by a second, or by a frame with Shift.
  const handleKey = (which: 'start' | 'end') => (event: KeyboardEvent) => {
    if (!selection || !onSelection || event.altKey || event.ctrlKey || event.metaKey) return;
    const current = which === 'start' ? selection.start : selection.end;
    const by = event.shiftKey ? fine : 1;
    const targets: Record<string, number> = {
      ArrowLeft: current - by,
      ArrowRight: current + by,
      ArrowDown: current - by,
      ArrowUp: current + by,
      PageDown: current - 10,
      PageUp: current + 10,
      Home: 0,
      End: duration,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onSelection(which === 'start' ? dragStart(selection, next) : dragEnd(selection, next, duration));
  };

  const handle = (which: 'start' | 'end') => {
    if (!selection || !onSelection) return null;
    const value = which === 'start' ? selection.start : selection.end;
    return (
      <div
        className={`timeline-handle ${which}`}
        role="slider"
        tabIndex={0}
        aria-label={t(which === 'start' ? 'editor.in' : 'editor.out')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-valuetext={formatTime(value, lang)}
        aria-keyshortcuts={which === 'start' ? 'I' : 'O'}
        style={{ insetInlineStart: percent(value, duration) }}
        onPointerDown={(event) => down(event, which)}
        onKeyDown={handleKey(which)}
      >
        <span className="timeline-grip" />
      </div>
    );
  };

  return (
    <div className="timeline" dir="ltr" data-wave={peaks ? '' : undefined}>
      <div className="timeline-ruler" aria-hidden="true">
        {ticks(duration, step).map((tick) => (
          <span key={tick} className="timeline-tick" style={{ insetInlineStart: percent(tick, duration) }}>
            {/* A label too close to the end would be cut off; its tick still shows. */}
            {(!width || (tick / duration) * width <= width - LABEL_ROOM) && formatTime(tick, lang, step < 1)}
          </span>
        ))}
      </div>
      <div ref={track} className="timeline-track" onPointerDown={(event) => down(event, 'scrub')} {...handlers}>
        {peaks && peaks.length > 0 && <Waveform peaks={peaks} />}
        {parts?.map((part, i) => (
          <span
            key={i}
            className="timeline-part"
            data-cut={i > 0 ? '' : undefined}
            data-dropped={part.kept ? undefined : ''}
            style={{
              insetInlineStart: percent(part.span.start, duration),
              inlineSize: percent(part.span.end - part.span.start, duration),
            }}
          />
        ))}
        {spans?.map((item, i) => (
          <span
            key={i}
            className="timeline-span"
            data-current={item.current ? '' : undefined}
            style={{
              insetInlineStart: percent(item.span.start, duration),
              inlineSize: percent(item.span.end - item.span.start, duration),
            }}
          />
        ))}
        {selection && (
          <span
            className="timeline-selection"
            style={{
              insetInlineStart: percent(selection.start, duration),
              inlineSize: percent(selection.end - selection.start, duration),
            }}
          />
        )}
        {markers?.map((marker) => (
          <span key={marker} className="timeline-marker" style={{ insetInlineStart: percent(marker, duration) }} />
        ))}
        <div
          className="timeline-playhead"
          role="slider"
          tabIndex={0}
          aria-label={t('editor.position')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 10) / 10}
          aria-valuenow={Math.round(time * 10) / 10}
          aria-valuetext={formatTime(time, lang)}
          style={{ insetInlineStart: percent(time, duration) }}
        />
        {handle('start')}
        {handle('end')}
      </div>
    </div>
  );
}
