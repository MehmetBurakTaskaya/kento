// SPDX-License-Identifier: MIT
// Mark up: pen, highlighter, rectangles, ellipses, lines, arrows and text drawn over the picture as
// SVG in source pixels; the engine draws the same marks into the result. Marks are chosen, moved
// and removed with the select tool, the list beside the picture or the keyboard; every finished
// change is one undo step.
import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../../components/Icon';
import type { ImageTool, Mark, Point as Pair, Rgb, Rgba } from '../../../ipc';
import { Section, Segmented } from '../../controls';
import { clampPoint, type Size } from '../../crop';
import type { EditorProps } from '../../panels';
import { Check, Swatches } from '../controls';
import { previewSize, toSource } from '../geometry';
import { Glyph, type GlyphName } from '../glyphs';
import { canRedo, canUndo, commit, redo, startHistory, undo, type History } from '../history';
import { ImageShell, sizeText, useKeyRows, type KeyRow } from '../ImageShell';
import { ImageStage } from '../ImageStage';
import type { ImageAction } from '../keys';
import { MarkShape } from '../MarkShape';
import {
  cornersToArea,
  extendStroke,
  FONT_FAMILY,
  FONT_WEIGHT,
  guessWidth,
  HIGHLIGHT_ALPHA,
  HIGHLIGHT_FACTOR,
  isVisible,
  LINE_HEIGHT,
  MARK_TOOLS,
  markBounds,
  moveMark,
  PALETTE,
  restyle,
  rgbCss,
  roundMark,
  snapAngle,
  strokeWidths,
  textSizes,
  type Measure,
  type MarkTool,
} from '../marks';
import { useImageInfo, usePreview } from '../usePicture';

interface Item {
  id: number;
  mark: Mark;
}

interface Typing {
  /** Each text field has its own token, so it is finished once even if it also loses focus. */
  token: number;
  at: Pair;
  text: string;
  /** The text mark being changed, or null for a new one. */
  id: number | null;
  color: Rgba;
  size: number;
}

type Gesture = { kind: 'draw'; from: Pair } | { kind: 'move'; id: number; from: Pair; start: Item[] };

const YELLOW = PALETTE.find((swatch) => swatch.id === 'yellow')!.rgb;

let context: CanvasRenderingContext2D | null | undefined;
/** Text widths from the font itself where a canvas can measure them. */
const measure: Measure = (text, size) => {
  if (context === undefined) context = document.createElement('canvas').getContext('2d');
  if (!context) return guessWidth(text, size);
  context.font = `${FONT_WEIGHT} ${size}px ${FONT_FAMILY}`;
  return context.measureText(text).width;
};

const TOOL_GLYPHS: Record<MarkTool, GlyphName> = {
  select: 'select',
  pen: 'pen',
  highlighter: 'highlighter',
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  line: 'line',
  arrow: 'arrow',
  text: 'text',
};

/** The nearest offered level for a width or size. */
const levelOf = (levels: number[], value: number) =>
  levels.reduce((best, level, i) => (Math.abs(level - value) < Math.abs(levels[best]! - value) ? i : best), 0);

export function Markup(props: EditorProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { paths } = props;
  const picture = useImageInfo(paths[0] ?? '');
  const source: Size | null = picture.info;
  const [zoom, setZoom] = useState(1);
  const plain = usePreview(paths, null, previewSize(source, zoom), Boolean(source));

  const [history, setHistory] = useState<History<Item[]>>(() => startHistory([]));
  const [moving, setMoving] = useState<Item[] | null>(null);
  const [drawing, setDrawing] = useState<Mark | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [tool, setTool] = useState<MarkTool>('pen');
  const [color, setColor] = useState<Rgb>(PALETTE[0]!.rgb);
  const [highlight, setHighlight] = useState<Rgb>(YELLOW);
  const [widthLevel, setWidthLevel] = useState(1);
  const [sizeLevel, setSizeLevel] = useState(1);
  const [filled, setFilled] = useState(false);
  const [typing, setTyping] = useState<Typing | null>(null);
  const ids = useRef(0);
  const tokens = useRef(0);
  const open = useRef(0);
  const gesture = useRef<Gesture | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const keyRows = useKeyRows();

  const items = moving ?? history.present;
  const chosen = items.find((item) => item.id === selected) ?? null;
  const widths = source ? strokeWidths(source) : [1, 2, 4, 8];
  const sizes = source ? textSizes(source) : [24, 40, 64, 96];

  const change = (next: Item[]) => setHistory((now) => commit(now, next));
  const newColor = (kind: MarkTool): Rgba =>
    kind === 'highlighter' ? [...highlight, HIGHLIGHT_ALPHA] : [...color, 255];
  const newWidth = (kind: MarkTool) => widths[widthLevel]! * (kind === 'highlighter' ? HIGHLIGHT_FACTOR : 1);

  const marks = items.map((item) => roundMark(item.mark));
  // A text still being typed counts, so Ctrl+S in the field keeps it.
  if (typing && typing.text.trim() && typing.id === null) {
    marks.push(roundMark({ kind: 'text', at: typing.at, text: typing.text, color: typing.color, size: typing.size }));
  }
  const request: ImageTool | null = source && marks.length ? { tool: 'markup', marks } : null;

  const finishText = (token: number) => {
    if (!typing || open.current !== token) return;
    open.current = 0;
    const text = typing.text.replace(/\s+$/, '');
    if (typing.id !== null) {
      const id = typing.id;
      const next = text.trim()
        ? history.present.map((item) =>
            item.id === id && item.mark.kind === 'text' ? { ...item, mark: { ...item.mark, text } } : item,
          )
        : history.present.filter((item) => item.id !== id);
      change(next);
    } else if (text.trim()) {
      const mark: Mark = { kind: 'text', at: typing.at, text, color: typing.color, size: typing.size };
      change([...history.present, { id: ++ids.current, mark }]);
    }
    setTyping(null);
  };

  const startText = (at: Pair, item?: Item) => {
    const token = ++tokens.current;
    open.current = token;
    const mark = item?.mark.kind === 'text' ? item.mark : null;
    setTyping({
      token,
      at: mark ? mark.at : at,
      text: mark ? mark.text : '',
      id: item && mark ? item.id : null,
      color: mark ? mark.color : newColor('text'),
      size: mark ? mark.size : sizes[sizeLevel]!,
    });
  };

  const remove = (id: number) => {
    change(history.present.filter((item) => item.id !== id));
    if (selected === id) setSelected(null);
  };

  const pickTool = (next: MarkTool) => {
    setTool(next);
    if (next !== 'select') setSelected(null);
  };

  // Changing a style changes the chosen mark too, as one undo step.
  const restyleChosen = (style: Parameters<typeof restyle>[1]) => {
    if (!chosen) return;
    change(
      history.present.map((item) => (item.id === chosen.id ? { ...item, mark: restyle(item.mark, style) } : item)),
    );
  };

  const kind: MarkTool | null = chosen ? chosen.mark.kind : tool === 'select' ? null : tool;
  const swatchValue: Rgb = chosen
    ? [chosen.mark.color[0], chosen.mark.color[1], chosen.mark.color[2]]
    : kind === 'highlighter'
      ? highlight
      : color;
  const chosenWidth =
    chosen && 'width' in chosen.mark
      ? levelOf(widths, chosen.mark.width / (chosen.mark.kind === 'highlighter' ? HIGHLIGHT_FACTOR : 1))
      : widthLevel;
  const chosenSize = chosen?.mark.kind === 'text' ? levelOf(sizes, chosen.mark.size) : sizeLevel;
  const chosenFilled =
    chosen && (chosen.mark.kind === 'rectangle' || chosen.mark.kind === 'ellipse') ? chosen.mark.filled : filled;

  const onAction = (action: ImageAction): boolean => {
    switch (action.type) {
      case 'undo':
        setHistory(undo);
        return true;
      case 'redo':
        setHistory(redo);
        return true;
      case 'remove':
        if (!chosen) return false;
        remove(chosen.id);
        return true;
      case 'nudge': {
        if (!chosen || !source) return false;
        const step = (side: number) => (action.fine ? 1 : Math.max(1, Math.round(side / 100)));
        const moved = moveMark(chosen.mark, action.x * step(source.width), action.y * step(source.height));
        change(history.present.map((item) => (item.id === chosen.id ? { ...item, mark: moved } : item)));
        return true;
      }
      default:
        return false;
    }
  };

  const layer = (scale: number) => {
    if (!source) return null;
    const point = (event: { clientX: number; clientY: number; currentTarget: Element }): Pair => {
      const p = clampPoint(
        toSource({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), source),
        source,
      );
      return [p.x, p.y];
    };
    const onDown = (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      const p = point(event);
      if (tool === 'select') {
        const hit = (event.target as Element).closest('[data-mark]')?.getAttribute('data-mark');
        const id = hit ? Number(hit) : null;
        setSelected(id);
        if (id !== null) {
          gesture.current = { kind: 'move', id, from: p, start: history.present };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        return;
      }
      if (tool === 'text') return;
      gesture.current = { kind: 'draw', from: p };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const style = { color: newColor(tool), width: newWidth(tool) };
      setDrawing(
        tool === 'pen' || tool === 'highlighter'
          ? { kind: tool, points: [p], ...style }
          : tool === 'rectangle' || tool === 'ellipse'
            ? { kind: tool, area: { x: p[0], y: p[1], width: 0, height: 0 }, ...style, filled }
            : { kind: tool, from: p, to: p, ...style },
      );
    };
    const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
      const now = gesture.current;
      if (!now) return;
      const p = point(event);
      if (now.kind === 'move') {
        const dx = p[0] - now.from[0];
        const dy = p[1] - now.from[1];
        setMoving(
          now.start.map((item) => (item.id === now.id ? { ...item, mark: moveMark(item.mark, dx, dy) } : item)),
        );
        return;
      }
      setDrawing((mark) => {
        if (!mark) return mark;
        switch (mark.kind) {
          case 'pen':
          case 'highlighter':
            // About one and a half screen pixels between points.
            return { ...mark, points: extendStroke(mark.points, p, 1.5 / scale) };
          case 'rectangle':
          case 'ellipse':
            return { ...mark, area: cornersToArea(now.from, p, event.shiftKey) };
          case 'line':
          case 'arrow':
            return { ...mark, to: event.shiftKey ? snapAngle(now.from, p) : p };
          default:
            return mark;
        }
      });
    };
    const onUp = () => {
      const now = gesture.current;
      gesture.current = null;
      if (now?.kind === 'move') {
        if (moving) change(moving);
        setMoving(null);
      } else if (now?.kind === 'draw') {
        // Three screen pixels is the least that counts as a drawn mark, not a slip.
        if (drawing && isVisible(drawing, 3 / scale)) {
          change([...history.present, { id: ++ids.current, mark: drawing }]);
        }
        setDrawing(null);
      }
    };
    const box = chosen ? markBounds(chosen.mark, measure) : null;
    const pad = 4 / scale;
    return (
      <>
        <svg
          className="mark-layer"
          viewBox={`0 0 ${source.width} ${source.height}`}
          preserveAspectRatio="none"
          data-tool={tool}
          tabIndex={0}
          role="application"
          aria-label={t('image.markup.canvas')}
          aria-describedby="markup-hint"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onClick={(event) => {
            // Text starts on click, after the press has moved the focus, so the new field keeps it.
            if (tool === 'text' && !typing) startText(point(event));
          }}
          onDoubleClick={(event) => {
            const hit = (event.target as Element).closest('[data-mark]')?.getAttribute('data-mark');
            const item = hit ? items.find((entry) => entry.id === Number(hit)) : undefined;
            if (tool === 'select' && item?.mark.kind === 'text') startText(item.mark.at, item);
          }}
        >
          {items.map((item) =>
            typing?.id === item.id ? null : (
              <MarkShape
                key={item.id}
                id={item.id}
                mark={item.mark}
                hit={tool === 'select' ? 14 / scale : 0}
                measure={measure}
              />
            ),
          )}
          {drawing && <MarkShape mark={drawing} hit={0} measure={measure} />}
          {box && !typing && (
            <rect
              className="mark-selection"
              x={box.x - pad}
              y={box.y - pad}
              width={box.width + 2 * pad}
              height={box.height + 2 * pad}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {typing && (
          <textarea
            ref={field}
            autoFocus
            className="mark-field"
            dir="auto"
            value={typing.text}
            rows={Math.max(1, typing.text.split('\n').length)}
            aria-label={t('image.markup.textField')}
            spellCheck={false}
            style={{
              insetInlineStart: typing.at[0] * scale,
              insetBlockStart: typing.at[1] * scale,
              fontSize: typing.size * scale,
              lineHeight: LINE_HEIGHT,
              color: rgbCss(typing.color),
              inlineSize: `${Math.max(4, ...typing.text.split('\n').map((line) => line.length + 2))}ch`,
            }}
            onChange={(event) => setTyping({ ...typing, text: event.target.value })}
            onKeyDown={(event) => {
              // Enter ends the text, Shift+Enter starts a new line; never while a word is composed.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                finishText(typing.token);
              }
            }}
            onBlur={() => finishText(typing.token)}
          />
        )}
      </>
    );
  };

  const toolName = (id: MarkTool) => t(`image.markup.tool.${id}`);
  const describe = (item: Item, index: number) =>
    t('image.markup.item', {
      index: index + 1,
      name:
        item.mark.kind === 'text'
          ? t('image.markup.textMark', { text: item.mark.text.split('\n')[0] ?? '' })
          : toolName(item.mark.kind),
    });

  const mac = document.documentElement.dataset.platform === 'macos';
  const undoKey = mac ? '⌘Z' : 'Ctrl+Z';
  const redoKey = mac ? '⇧⌘Z' : 'Ctrl+Y';
  const keys: KeyRow[] = [
    [<kbd key="undo">{undoKey}</kbd>, t('image.keys.undo')],
    [
      <>
        <kbd>{redoKey}</kbd> <kbd>{mac ? '⌘Y' : 'Ctrl+Shift+Z'}</kbd>
      </>,
      t('image.keys.redo'),
    ],
    keyRows.remove,
    keyRows.arrows,
    keyRows.fine,
    [
      <>
        <kbd>{keyRows.shift}</kbd>
      </>,
      t('image.keys.straight'),
    ],
    [<kbd key="enter">Enter</kbd>, t('image.keys.textEnd')],
    keyRows.zoom,
  ];

  return (
    <ImageShell
      tool="markup"
      meta={source ? sizeText(source.width, source.height, lang) : null}
      request={request}
      problem={picture.error ?? plain.error}
      onAction={onAction}
      onEscape={() => {
        // Esc ends the text being typed instead of closing the editor.
        if (!typing || document.activeElement !== field.current) return false;
        finishText(typing.token);
        return true;
      }}
      keys={keys}
      stage={
        <ImageStage
          source={source}
          picture={plain.url}
          busy={plain.loading}
          note={picture.reading ? t('image.reading') : t('image.noPreview')}
          label={t('image.picture')}
          zoom={zoom}
          onZoom={setZoom}
          tools={
            <span className="image-history">
              <button
                type="button"
                className="icon-button"
                disabled={!canUndo(history)}
                aria-label={t('image.markup.undo')}
                title={t('editor.withKey', { label: t('image.markup.undo'), key: undoKey })}
                aria-keyshortcuts={mac ? 'Meta+Z' : 'Control+Z'}
                onClick={() => setHistory(undo)}
              >
                <Glyph name="undo" />
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={!canRedo(history)}
                aria-label={t('image.markup.redo')}
                title={t('editor.withKey', { label: t('image.markup.redo'), key: redoKey })}
                aria-keyshortcuts={mac ? 'Meta+Shift+Z' : 'Control+Y'}
                onClick={() => setHistory(redo)}
              >
                <Glyph name="redo" />
              </button>
            </span>
          }
        >
          {layer}
        </ImageStage>
      }
      {...props}
    >
      <Section title={t('image.markup.tool.title')}>
        <ToolPicker value={tool} onChange={pickTool} name={toolName} label={t('image.markup.tool.title')} />
        <p id="markup-hint" className="editor-hint muted">
          {t(`image.markup.hint.${tool}`)}
        </p>
      </Section>
      {kind && (
        <Section title={t('image.markup.style')}>
          <Swatches
            label={t('image.color.title')}
            swatches={PALETTE}
            value={swatchValue}
            name={(id) => t(`image.color.${id}`)}
            onChange={(rgb) => {
              if (kind === 'highlighter') setHighlight(rgb);
              else setColor(rgb);
              restyleChosen({ color: rgb });
            }}
          />
          {kind === 'text' ? (
            <Segmented
              label={t('image.markup.size')}
              value={chosenSize}
              options={sizes.map((_, i) => ({ value: i, label: t(`image.markup.sizes.${i}`) }))}
              onChange={(level) => {
                setSizeLevel(level);
                restyleChosen({ size: sizes[level] });
              }}
            />
          ) : (
            <Segmented
              label={t('image.markup.width')}
              value={chosenWidth}
              options={widths.map((_, i) => ({ value: i, label: t(`image.markup.widths.${i}`) }))}
              onChange={(level) => {
                setWidthLevel(level);
                restyleChosen({ width: widths[level]! * (kind === 'highlighter' ? HIGHLIGHT_FACTOR : 1) });
              }}
            />
          )}
          {(kind === 'rectangle' || kind === 'ellipse') && (
            <Check
              label={t('image.markup.filled')}
              checked={chosenFilled}
              onChange={(on) => {
                setFilled(on);
                restyleChosen({ filled: on });
              }}
            />
          )}
        </Section>
      )}
      <Section title={t('image.markup.marks', { count: items.length })}>
        {items.length === 0 ? (
          <p className="editor-hint muted">{t('image.markup.empty')}</p>
        ) : (
          <ol className="area-list">
            {items.map((item, index) => (
              <li key={item.id} className="area-row" data-selected={item.id === selected ? '' : undefined}>
                <button
                  type="button"
                  className="editor-link image-mark-name"
                  aria-pressed={item.id === selected}
                  onClick={() => {
                    setTool('select');
                    setSelected(item.id === selected ? null : item.id);
                  }}
                >
                  <bdi>{describe(item, index)}</bdi>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('image.markup.remove', { index: index + 1 })}
                  onClick={() => remove(item.id)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </ImageShell>
  );
}

/** The drawing tools as one radio group of icon buttons; the arrows move the choice. */
function ToolPicker({
  value,
  onChange,
  name,
  label,
}: {
  value: MarkTool;
  onChange(tool: MarkTool): void;
  name(tool: MarkTool): string;
  label: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (event: KeyboardEvent, index: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    const steps: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: 1,
      ArrowUp: -1,
    };
    const step = steps[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = (index + step + MARK_TOOLS.length) % MARK_TOOLS.length;
    onChange(MARK_TOOLS[next]!);
    buttons.current[next]?.focus();
  };
  return (
    <div className="image-tools" role="radiogroup" aria-label={label}>
      {MARK_TOOLS.map((tool, index) => (
        <button
          key={tool}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="radio"
          className="image-tool"
          aria-checked={tool === value}
          aria-label={name(tool)}
          title={name(tool)}
          tabIndex={tool === value ? 0 : -1}
          onClick={() => onChange(tool)}
          onKeyDown={(event) => onKey(event, index)}
        >
          <Glyph name={TOOL_GLYPHS[tool]} size={20} />
        </button>
      ))}
    </div>
  );
}
