// SPDX-License-Identifier: MIT
// The picture of an image editor. `ImageStage` shows the upright picture fitted to the box, zooms in
// steps (the buttons, Ctrl with the wheel or with +, - and 0) and carries what is drawn on it at the
// picture's own size; `ResultStage` shows a finished preview whole. Pictures are physical, so the
// stage stays left to right in every language, like the media editors' picture.
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import type { Point, Size } from '../crop';
import { keyScope } from '../keys';
import { clamp } from '../time';
import { canvasLayout, fitScale, maxZoom, stepZoom, zoomScroll } from './geometry';
import { Glyph } from './glyphs';
import { imageKey } from './keys';

/** Before the box is measured (and in tests, which have no layout), a box of a usual size. */
const FALLBACK_BOX: Size = { width: 800, height: 450 };

const isMac = () => document.documentElement.dataset.platform === 'macos';

function useBox() {
  const element = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size | null>(null);
  useEffect(() => {
    const node = element.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setBox((now) => (now && now.width === width && now.height === height ? now : { width, height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { element, box: box && box.width > 0 && box.height > 0 ? box : FALLBACK_BOX };
}

function Empty({ note, label }: { note: string | null; label: string }) {
  return (
    <div className="stage-placeholder" role="img" aria-label={label}>
      <Icon name="image" size={32} />
      {note && <span>{note}</span>}
    </div>
  );
}

export interface ImageStageProps {
  /** The upright picture's size in pixels; null while it is read. */
  source: Size | null;
  /** The picture to show, or null for a calm placeholder at the picture's ratio. */
  picture: string | null;
  busy: boolean;
  /** What the placeholder says. */
  note: string | null;
  label: string;
  /** Controls at the start of the bar under the picture (undo, redo). */
  tools?: ReactNode;
  /** The zoom as a multiple of the fitted size; the editor keeps it to ask for sharper previews. */
  zoom: number;
  onZoom(zoom: number): void;
  /** What is drawn on the picture, given the screen pixels per source pixel. */
  children?: (scale: number) => ReactNode;
}

export function ImageStage({ source, picture, busy, note, label, tools, zoom, onZoom, children }: ImageStageProps) {
  const { t } = useTranslation();
  const { element, box } = useBox();
  const pending = useRef<Point | null>(null);
  const fit = source ? fitScale(source, box) : 1;
  const limit = maxZoom(fit);
  const level = Math.min(zoom, limit);
  const scale = fit * level;
  const layout = source ? canvasLayout(source, box, scale) : null;

  const zoomTo = (next: number, anchor?: Point) => {
    const node = element.current;
    const target = clamp(next, 1, limit);
    if (!source || !node || target === level) return;
    const at = anchor ?? { x: box.width / 2, y: box.height / 2 };
    pending.current = zoomScroll(
      at,
      { x: node.scrollLeft, y: node.scrollTop },
      canvasLayout(source, box, scale),
      canvasLayout(source, box, fit * target),
      box,
    );
    onZoom(target);
  };

  // The scroll that keeps the point under the pointer in place, once the new size is laid out.
  useLayoutEffect(() => {
    const node = element.current;
    const scroll = pending.current;
    pending.current = null;
    if (node && scroll) node.scrollTo(scroll.x, scroll.y);
  }, [level, element]);

  const onWheel = useEffectEvent((event: WheelEvent) => {
    const node = element.current;
    if (!(event.ctrlKey || event.metaKey) || !node) return;
    event.preventDefault();
    // The pointer in the stage's content box, where the picture is laid out.
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    zoomTo(stepZoom(level, event.deltaY < 0 ? 1 : -1, limit), {
      x: event.clientX - rect.left - node.clientLeft - parseFloat(style.paddingLeft),
      y: event.clientY - rect.top - node.clientTop - parseFloat(style.paddingTop),
    });
  });
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    // Not through React: its wheel listeners are passive, and Ctrl+wheel must not zoom the page.
    const listener = (event: WheelEvent) => onWheel(event);
    node.addEventListener('wheel', listener, { passive: false });
    return () => node.removeEventListener('wheel', listener);
  }, [element]);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const action = imageKey(event, isMac());
    if (action?.type !== 'zoom' || keyScope(event.target) === 'commands') return;
    event.preventDefault();
    zoomTo(action.by === 0 ? 1 : stepZoom(level, action.by, limit));
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const mac = isMac();
  const withKey = (text: string, key: string) => t('editor.withKey', { label: text, key });
  const command = mac ? '⌘' : 'Ctrl+';
  return (
    <div className="image-view">
      <div
        ref={element}
        className="image-stage"
        dir="ltr"
        aria-busy={busy}
        data-zoomed={level > 1 ? '' : undefined}
        style={{ '--ratio': source ? source.width / source.height : 4 / 3 } as CSSProperties}
      >
        {source && layout ? (
          <div className="image-canvas" style={{ inlineSize: layout.width, blockSize: layout.height }}>
            {picture ? (
              <img className="image-picture" src={picture} alt={label} draggable={false} />
            ) : (
              <Empty note={note} label={label} />
            )}
            {children?.(scale)}
          </div>
        ) : (
          <Empty note={note} label={label} />
        )}
      </div>
      {busy && <span className="image-busy" aria-hidden="true" />}
      <div className="image-bar">
        {tools}
        <span className="image-zoom" role="group" aria-label={t('image.zoom.title')}>
          <button
            type="button"
            className="icon-button"
            disabled={!source || level <= 1}
            aria-label={t('image.zoom.out')}
            title={withKey(t('image.zoom.out'), `${command}-`)}
            aria-keyshortcuts={mac ? 'Meta+-' : 'Control+-'}
            onClick={() => zoomTo(stepZoom(level, -1, limit))}
          >
            <Glyph name="zoom-out" />
          </button>
          <output className="image-zoom-level" aria-live="polite">
            {t('image.zoom.level', { value: scale })}
          </output>
          <button
            type="button"
            className="icon-button"
            disabled={!source || level >= limit}
            aria-label={t('image.zoom.in')}
            title={withKey(t('image.zoom.in'), `${command}+`)}
            aria-keyshortcuts={mac ? 'Meta+=' : 'Control+='}
            onClick={() => zoomTo(stepZoom(level, 1, limit))}
          >
            <Glyph name="zoom-in" />
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={!source || level === 1}
            aria-label={t('image.zoom.fit')}
            title={withKey(t('image.zoom.fit'), `${command}0`)}
            aria-keyshortcuts={mac ? 'Meta+0' : 'Control+0'}
            onClick={() => zoomTo(1)}
          >
            <Glyph name="fit" />
          </button>
        </span>
      </div>
    </div>
  );
}

/** A finished preview (Edit image, Add frame, Make a collage), whole inside the box. */
export function ResultStage({
  picture,
  busy,
  note,
  label,
}: {
  picture: string | null;
  busy: boolean;
  note: string | null;
  label: string;
}) {
  return (
    <div className="image-view">
      <div className="image-stage image-result" dir="ltr" aria-busy={busy}>
        {picture ? <img src={picture} alt={label} draggable={false} /> : <Empty note={note} label={label} />}
      </div>
      {busy && <span className="image-busy" aria-hidden="true" />}
    </div>
  );
}
