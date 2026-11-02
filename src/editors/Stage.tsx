// SPDX-License-Identifier: MIT
// The picture of a video editor: the preview at the video's own ratio, a calm placeholder while there
// is nothing to play, and an overlay where rectangles are drawn (Crop, Redact). Picture coordinates
// are physical, so the stage stays left to right like the timeline.
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import type { Area, Hide } from '../ipc';
import {
  drawArea,
  HANDLES,
  MIN_SIDE,
  moveArea,
  resizeArea,
  roundArea,
  type Handle,
  type Point,
  type Size,
} from './crop';
import type { EditorCore } from './useEditor';
import { clamp } from './time';

export function Stage({ core, children }: { core: EditorCore; children?: ReactNode }) {
  const { t } = useTranslation();
  const { info, preview, preparing, error } = core.media;
  const video = info?.video;
  const ratio = video && video.height > 0 ? video.width / video.height : 16 / 9;
  const url = preview?.url ?? '';
  const playable = url !== '' && core.player.live;
  const note = error
    ? null
    : !info
      ? t('editor.reading')
      : preparing && !preview
        ? t('editor.preparing')
        : t('editor.noPicture');
  return (
    <div className="editor-stage" dir="ltr" style={{ '--ratio': ratio } as CSSProperties}>
      {playable ? (
        <video
          key={url}
          className="editor-video"
          src={url}
          preload="auto"
          playsInline
          disablePictureInPicture
          {...core.player.videoProps}
        />
      ) : (
        <div className="stage-placeholder">
          <Icon name="video" size={32} />
          {note && <span>{note}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Plays the sound of an audio editor; the waveform is its picture. */
export function AudioSink({ core }: { core: EditorCore }) {
  const url = core.media.preview?.url ?? '';
  if (!url || !core.player.live) return null;
  return <video key={url} src={url} preload="auto" hidden {...core.player.videoProps} />;
}

export interface OverlayRect {
  id: number;
  area: Area;
  label: string;
  /** Outside its time span a redaction shows as an outline only. */
  dim?: boolean;
}

interface Gesture {
  kind: 'draw' | 'move' | 'resize';
  id: number;
  from: Point;
  start: Area;
  handle?: Handle;
}

const pct = (part: number, whole: number) => `${whole > 0 ? (part / whole) * 100 : 0}%`;

export function RectOverlay({
  frame,
  rects,
  selected,
  ratio,
  mode,
  hide,
  onSelect,
  onChange,
  onDraw,
  onRemove,
}: {
  frame: Size;
  rects: OverlayRect[];
  selected: number | null;
  /** A fixed width / height ratio, or null for free (Shift then keeps the current one). */
  ratio: number | null;
  mode: 'crop' | 'redact';
  hide?: Hide;
  onSelect(id: number | null): void;
  onChange(id: number, area: Area): void;
  onDraw(area: Area): void;
  onRemove?(id: number): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<Area | null>(null);

  const point = (event: PointerEvent): Point => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * frame.width,
      y: ((event.clientY - rect.top) / rect.height) * frame.height,
    };
  };

  const begin = (event: PointerEvent<HTMLElement>, next: Omit<Gesture, 'from'>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    gesture.current = { ...next, from: point(event) };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (next.kind !== 'draw') {
      onSelect(next.id);
      event.currentTarget.closest<HTMLElement>('.overlay-rect')?.focus();
    }
  };

  const move = (event: PointerEvent) => {
    const now = gesture.current;
    if (!now) return;
    const p = point(event);
    // Shift keeps the ratio: a square while drawing, the area's own while resizing.
    const keep = ratio ?? (event.shiftKey ? (now.kind === 'draw' ? 1 : now.start.width / now.start.height) : null);
    if (now.kind === 'draw') setDraft(drawArea(now.from, p, frame, keep));
    else if (now.kind === 'move') onChange(now.id, moveArea(now.start, p.x - now.from.x, p.y - now.from.y, frame));
    else if (now.handle) onChange(now.id, resizeArea(now.start, now.handle, p, frame, keep));
  };

  const end = () => {
    const now = gesture.current;
    gesture.current = null;
    if (now?.kind !== 'draw') return;
    if (draft && draft.width >= MIN_SIDE && draft.height >= MIN_SIDE) onDraw(roundArea(draft, frame));
    else if (mode === 'redact') onSelect(null);
    setDraft(null);
  };

  // Arrows nudge a focused area by 1 % of the frame, Shift+arrows by one pixel; Delete removes it.
  const key = (event: KeyboardEvent, item: OverlayRect) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && onRemove) {
      event.preventDefault();
      onRemove(item.id);
      return;
    }
    const sx = event.shiftKey ? 1 : Math.max(1, Math.round(frame.width / 100));
    const sy = event.shiftKey ? 1 : Math.max(1, Math.round(frame.height / 100));
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [-sx, 0],
      ArrowRight: [sx, 0],
      ArrowUp: [0, -sy],
      ArrowDown: [0, sy],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    onChange(item.id, moveArea(item.area, offset[0], offset[1], frame));
  };

  const place = (area: Area): CSSProperties => ({
    insetInlineStart: pct(clamp(area.x, 0, frame.width), frame.width),
    insetBlockStart: pct(clamp(area.y, 0, frame.height), frame.height),
    inlineSize: pct(area.width, frame.width),
    blockSize: pct(area.height, frame.height),
  });

  const fill =
    hide?.kind === 'color' ? ({ '--fill': `rgb(${hide.rgb.join(' ')})` } as CSSProperties) : ({} as CSSProperties);

  return (
    <div
      ref={box}
      className="overlay"
      data-mode={mode}
      onPointerDown={(event) => begin(event, { kind: 'draw', id: -1, start: { x: 0, y: 0, width: 0, height: 0 } })}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {rects.map((item) => (
        <div
          key={item.id}
          className="overlay-rect"
          role="button"
          tabIndex={0}
          aria-label={item.label}
          aria-pressed={mode === 'redact' ? item.id === selected : undefined}
          data-selected={item.id === selected ? '' : undefined}
          data-dim={item.dim ? '' : undefined}
          data-hide={mode === 'redact' ? hide?.kind : undefined}
          style={{ ...place(item.area), ...fill }}
          onPointerDown={(event) =>
            // An area as large as the picture cannot move, so a drag inside it draws a new one.
            begin(
              event,
              item.area.width >= frame.width - 1 && item.area.height >= frame.height - 1
                ? { kind: 'draw', id: -1, start: item.area }
                : { kind: 'move', id: item.id, start: item.area },
            )
          }
          onKeyDown={(event) => key(event, item)}
          onFocus={() => item.id !== selected && onSelect(item.id)}
        >
          {item.id === selected &&
            HANDLES.map((handle) => (
              <span
                key={handle}
                className="overlay-handle"
                data-handle={handle}
                aria-hidden="true"
                onPointerDown={(event) => begin(event, { kind: 'resize', id: item.id, start: item.area, handle })}
              />
            ))}
        </div>
      ))}
      {draft && <div className="overlay-draft" style={place(draft)} />}
    </div>
  );
}
