// SPDX-License-Identifier: MIT
// Add text or logo: texts and pictures over the video. Each layer is dragged into place on the picture
// and resized by its corners (its shape stays); the selected layer's time is the selection, so I and O
// set it. Text is drawn here at the layer's size in the video's pixels and sent as that picture
// (ARCHITECTURE 54): the stage shows the very picture the video gets.
import { useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { api, type Area, type Layer, type MediaTool, type Rgb, type Span } from '../../ipc';
import { Section, Segmented, useBlobUrl } from '../controls';
import type { Size } from '../crop';
import { EditorShell } from '../EditorShell';
import { Check, Slider } from '../image/controls';
import { hexToRgb } from '../levels';
import type { EditorProps } from '../panels';
import { contains, fullSpan, isFull, roundSpan } from '../spans';
import { RectOverlay, Stage } from '../Stage';
import {
  pngBase64,
  textPicture,
  textUnits,
  TYPEFACES,
  useTypefaces,
  type TextAlign,
  type TextFrame,
  type TextStyle,
  type TypefaceId,
} from '../text';
import { clamp, formatTime } from '../time';
import { fileName, useEditor } from '../useEditor';

const PICTURE = /\.(png|jpe?g|webp|bmp)$/i;
/** Text sizes on the slider, in hundredths of the picture's height. */
const SIZE = { min: 2, max: 40, start: 8 };
/** Picture widths on the slider, in hundredths of the picture's width. */
const WIDTH = { min: 4, max: 100, start: 22 };
/** A new layer's distance from the edges, in hundredths of the shorter side. */
const MARGIN = 4;
/** How long a layer shows when it stops showing all the time. */
const SHOWING = 5;

interface Placed {
  id: number;
  /** The layer's middle, in video pixels. */
  cx: number;
  cy: number;
  /** 0 to 1. */
  opacity: number;
  span: Span | null;
}

interface TextItem extends Placed, TextStyle {
  kind: 'text';
  /** The font size in video pixels. */
  size: number;
}

interface PictureItem extends Placed {
  kind: 'picture';
  path: string;
  /** Width / height. */
  ratio: number;
  /** In video pixels. */
  width: number;
}

type Item = TextItem | PictureItem;

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;

function areaOf(item: Item): Area {
  let width: number;
  let height: number;
  if (item.kind === 'text') {
    const units = textUnits(item);
    width = units.width * item.size;
    height = units.height * item.size;
  } else {
    width = item.width;
    height = item.width / item.ratio;
  }
  return { x: item.cx - width / 2, y: item.cy - height / 2, width, height };
}

/** Whole pixels, as the layer's picture is drawn. */
const pixels = (area: Area): Area => ({
  x: Math.round(area.x),
  y: Math.round(area.y),
  width: Math.max(1, Math.round(area.width)),
  height: Math.max(1, Math.round(area.height)),
});

const placement = (area: Area, frame: Size): CSSProperties => ({
  insetInlineStart: `${(area.x / frame.width) * 100}%`,
  insetBlockStart: `${(area.y / frame.height) * 100}%`,
  inlineSize: `${(area.width / frame.width) * 100}%`,
  blockSize: `${(area.height / frame.height) * 100}%`,
});

function PicturePreview({ item, style }: { item: PictureItem; style: CSSProperties }) {
  const src = useBlobUrl(() => api.thumbnail(item.path, 512), item.path);
  return src ? (
    <img className="layer-preview" src={src} alt="" style={style} />
  ) : (
    <span className="layer-preview layer-blank" style={style}>
      <Icon name="image" size={20} />
    </span>
  );
}

export function AddOverlay(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const { duration, lang, player } = core;
  const video = core.info?.video;
  const frame: Size | null = video ? { width: video.width, height: video.height } : null;
  const fonts = useTypefaces();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = useRef(0);

  const current = items.find((item) => item.id === selected) ?? null;
  const update = (id: number, change: (item: Item) => Item) =>
    setItems((list) => list.map((item) => (item.id === id ? change(item) : item)));
  const change = (patch: Partial<TextItem> & Partial<PictureItem>) => {
    if (current) update(current.id, (item) => ({ ...item, ...patch }) as Item);
  };
  const remove = (id: number) => {
    setItems((list) => list.filter((item) => item.id !== id));
    if (selected === id) setSelected(null);
  };
  const add = (item: Item) => {
    setItems((list) => [...list, item]);
    setSelected(item.id);
  };

  const shorter = frame ? Math.min(frame.width, frame.height) : 0;
  const addText = (at?: Area) => {
    if (!frame) return;
    const style: TextStyle = {
      text: t('editor.overlay.sample'),
      font: 'sans',
      color: [255, 255, 255],
      frame: 'outline',
      accent: [0, 0, 0],
      align: 'center',
    };
    const units = textUnits(style);
    const size = at ? at.height / units.height : (SIZE.start / 100) * frame.height;
    add({
      kind: 'text',
      id: ++ids.current,
      ...style,
      size,
      cx: at ? at.x + at.width / 2 : frame.width / 2,
      cy: at ? at.y + at.height / 2 : frame.height * 0.8,
      opacity: 1,
      span: null,
    });
  };

  const addPicture = async () => {
    if (!frame) return;
    try {
      const files = await api.pickFiles();
      if (!files.length) return;
      const path = files.find((file) => PICTURE.test(file));
      if (!path) {
        setProblem(t('editor.overlay.notPicture'));
        return;
      }
      const info = await api.imageInfo(path).catch(() => null);
      const ratio = info && info.width > 0 && info.height > 0 ? info.width / info.height : 1;
      const width = (WIDTH.start / 100) * frame.width;
      const margin = (MARGIN / 100) * shorter;
      add({
        kind: 'picture',
        id: ++ids.current,
        path,
        ratio,
        width,
        cx: frame.width - margin - width / 2,
        cy: margin + width / ratio / 2,
        opacity: 1,
        span: null,
      });
      setProblem(null);
    } catch (reason) {
      setProblem(String(reason));
    }
  };

  // What the video gets: each text as the picture drawn at its size, each picture by its path.
  const layers: (Layer | null)[] = items
    .filter((item) => item.kind === 'picture' || item.text.trim() !== '')
    .map((item) => {
      const area = pixels(areaOf(item));
      const span = item.span ? roundSpan(item.span) : null;
      const opacity = Math.round(item.opacity * 100) / 100;
      if (item.kind === 'picture') return { source: { kind: 'image', path: item.path }, area, opacity, span };
      const url = textPicture(item, area.width, area.height, fonts);
      return url ? { source: { kind: 'picture', png: pngBase64(url) }, area, opacity, span } : null;
    });
  const ready = layers.filter((layer): layer is Layer => layer !== null);
  const request: MediaTool | null =
    frame && ready.length && ready.length === layers.length ? { tool: 'add-overlay', layers: ready } : null;

  const describe = (item: Item, index: number) =>
    item.kind === 'text'
      ? t('editor.overlay.textLayer', { index: index + 1, text: item.text.split('\n')[0]!.slice(0, 32) })
      : t('editor.overlay.pictureLayer', { index: index + 1, name: fileName(item.path) });
  const span = current ? (current.span ?? fullSpan(duration)) : null;
  const setSpan = (next: Span) => change({ span: isFull(next, duration) ? null : next });
  const showAlways = (on: boolean) => {
    if (on) return change({ span: null });
    const start = clamp(player.time, 0, Math.max(0, duration - 0.1));
    change({ span: { start, end: Math.min(duration, start + SHOWING) } });
  };

  return (
    <EditorShell
      tool="add-overlay"
      core={core}
      request={request}
      selection={span ? { span, set: setSpan } : null}
      stage={
        <Stage core={core}>
          {frame && (
            <>
              <div className="layer-stage" aria-hidden="true">
                {items.map((item) => {
                  const area = areaOf(item);
                  const style: CSSProperties = {
                    ...placement(area, frame),
                    opacity: item.opacity,
                    visibility: item.span && !contains(item.span, player.time) ? 'hidden' : undefined,
                  };
                  if (item.kind === 'picture') return <PicturePreview key={item.id} item={item} style={style} />;
                  const rounded = pixels(area);
                  const url = textPicture(item, rounded.width, rounded.height, fonts);
                  return url ? <img key={item.id} className="layer-preview" src={url} alt="" style={style} /> : null;
                })}
              </div>
              <RectOverlay
                frame={frame}
                mode="redact"
                ratio={current ? areaOf(current).width / areaOf(current).height : null}
                selected={selected}
                rects={items.map((item, index) => ({
                  id: item.id,
                  area: areaOf(item),
                  label: describe(item, index),
                  dim: item.span ? !contains(item.span, player.time) : false,
                }))}
                onSelect={setSelected}
                onChange={(id, area) =>
                  update(id, (item) => {
                    const middle = { cx: area.x + area.width / 2, cy: area.y + area.height / 2 };
                    if (item.kind === 'picture') return { ...item, ...middle, width: area.width };
                    return { ...item, ...middle, size: area.height / textUnits(item).height };
                  })
                }
                onDraw={(area) => addText(area)}
                onRemove={remove}
              />
            </>
          )}
        </Stage>
      }
      {...props}
    >
      <Section title={t('editor.overlay.layers')}>
        <div className="overlay-add">
          <button type="button" className="button small" disabled={!frame} onClick={() => addText()}>
            <Icon name="text" size={16} />
            {t('editor.overlay.addText')}
          </button>
          <button type="button" className="button small" disabled={!frame} onClick={() => void addPicture()}>
            <Icon name="image" size={16} />
            {t('editor.overlay.addPicture')}
          </button>
        </div>
        {problem && <p className="error-text">{problem}</p>}
        {items.length === 0 ? (
          <p className="editor-hint muted">{t('editor.overlay.hint')}</p>
        ) : (
          <ol className="area-list">
            {items.map((item, index) => (
              <li key={item.id} className="area-row" data-selected={item.id === selected ? '' : undefined}>
                <button
                  type="button"
                  className="editor-link layer-name"
                  aria-pressed={item.id === selected}
                  onClick={() => setSelected(item.id === selected ? null : item.id)}
                >
                  <bdi>{describe(item, index)}</bdi>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('editor.overlay.remove', { index: index + 1 })}
                  onClick={() => remove(item.id)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Section>
      {current?.kind === 'text' && frame && (
        <Section title={t('editor.overlay.text')}>
          <label className="editor-field">
            <span>{t('editor.overlay.words')}</span>
            <textarea
              className="overlay-words"
              dir="auto"
              rows={2}
              value={current.text}
              onChange={(event) => change({ text: event.target.value })}
            />
          </label>
          <Segmented
            label={t('editor.overlay.typeface')}
            value={current.font}
            options={(Object.keys(TYPEFACES) as TypefaceId[]).map((id) => ({
              value: id,
              label: t(`editor.overlay.font.${id}`),
            }))}
            onChange={(font) => change({ font })}
          />
          <Slider
            label={t('editor.overlay.size')}
            value={Math.round((current.size / frame.height) * 100)}
            min={SIZE.min}
            max={SIZE.max}
            text={t('editor.overlay.percent', { value: Math.round((current.size / frame.height) * 100) })}
            onChange={(value) => change({ size: (value / 100) * frame.height })}
          />
          <div className="overlay-colors">
            <label className="editor-field editor-color">
              <span>{t('editor.overlay.color')}</span>
              <input
                type="color"
                value={hex(current.color)}
                onChange={(event) => change({ color: hexToRgb(event.target.value) })}
              />
            </label>
            {current.frame !== 'plain' && (
              <label className="editor-field editor-color">
                <span>{t(current.frame === 'box' ? 'editor.overlay.boxColor' : 'editor.overlay.outlineColor')}</span>
                <input
                  type="color"
                  value={hex(current.accent)}
                  onChange={(event) => change({ accent: hexToRgb(event.target.value) })}
                />
              </label>
            )}
          </div>
          <Segmented
            label={t('editor.overlay.frame')}
            value={current.frame}
            options={(['plain', 'outline', 'box'] as TextFrame[]).map((value) => ({
              value,
              label: t(`editor.overlay.frame.${value}`),
            }))}
            onChange={(value) => change({ frame: value })}
          />
          <Segmented
            label={t('editor.overlay.align')}
            value={current.align}
            options={(['left', 'center', 'right'] as TextAlign[]).map((value) => ({
              value,
              label: t(`editor.overlay.align.${value}`),
            }))}
            onChange={(align) => change({ align })}
          />
        </Section>
      )}
      {current?.kind === 'picture' && frame && (
        <Section title={t('editor.overlay.picture')}>
          <p className="file-line">
            <bdi className="file-name">{fileName(current.path)}</bdi>
          </p>
          <Slider
            label={t('editor.overlay.width')}
            value={Math.round((current.width / frame.width) * 100)}
            min={WIDTH.min}
            max={WIDTH.max}
            text={t('editor.overlay.percent', { value: Math.round((current.width / frame.width) * 100) })}
            onChange={(value) => change({ width: (value / 100) * frame.width })}
          />
        </Section>
      )}
      {current && (
        <Section title={t('editor.overlay.showing')}>
          <Slider
            label={t('editor.overlay.opacity')}
            value={Math.round(current.opacity * 100)}
            min={5}
            max={100}
            text={t('editor.overlay.percent', { value: Math.round(current.opacity * 100) })}
            onChange={(value) => change({ opacity: value / 100 })}
          />
          <Check label={t('editor.overlay.always')} checked={!current.span} onChange={showAlways} />
          <p className="editor-hint muted">
            {current.span
              ? t('editor.overlay.when', {
                  start: formatTime(current.span.start, lang),
                  end: formatTime(current.span.end, lang),
                })
              : t('editor.overlay.whenAlways')}
          </p>
        </Section>
      )}
    </EditorShell>
  );
}
