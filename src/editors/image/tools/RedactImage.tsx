// SPDX-License-Identifier: MIT
// Redact image: areas drawn on the picture (added, moved, resized and removed) and hidden with a
// colour, blur or pixelation. The engine's preview shows the result; while it is on its way, the
// areas show a rough version of it.
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../../components/Icon';
import type { Area, Hide, ImageTool } from '../../../ipc';
import { Section, Segmented } from '../../controls';
import type { Size } from '../../crop';
import { hexToRgb } from '../../levels';
import type { EditorProps } from '../../panels';
import { RectOverlay } from '../../Stage';
import { nudge, pixelArea, previewSize } from '../geometry';
import { ImageShell, sizeText, useKeyRows, type KeyRow } from '../ImageShell';
import { ImageStage } from '../ImageStage';
import { useImageInfo, usePreview } from '../usePicture';

interface Redaction {
  id: number;
  area: Area;
}

export function RedactImage(props: EditorProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { paths } = props;
  const picture = useImageInfo(paths[0] ?? '');
  const frame: Size | null = picture.info;
  const [zoom, setZoom] = useState(1);
  const [items, setItems] = useState<Redaction[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [kind, setKind] = useState<Hide['kind']>('color');
  const [color, setColor] = useState('#000000');
  const ids = useRef(0);
  const keyRows = useKeyRows();

  const hide: Hide = kind === 'color' ? { kind: 'color', rgb: hexToRgb(color) } : { kind };
  const request: ImageTool | null =
    frame && items.length
      ? { tool: 'redact-image', areas: items.map((item) => pixelArea(item.area, frame)), hide }
      : null;
  const preview = usePreview(paths, request, previewSize(frame, zoom), Boolean(frame));
  const current = items.find((item) => item.id === selected) ?? null;

  const describe = (item: Redaction, index: number) => {
    const area = frame ? pixelArea(item.area, frame) : item.area;
    return t('image.redact.area', { index: index + 1, size: sizeText(area.width, area.height, lang) });
  };
  const remove = (id: number) => {
    setItems((list) => list.filter((item) => item.id !== id));
    if (selected === id) setSelected(null);
  };
  const keys: KeyRow[] = [keyRows.remove, keyRows.arrows, keyRows.fine, keyRows.zoom];

  return (
    <ImageShell
      tool="redact-image"
      meta={frame ? sizeText(frame.width, frame.height, lang) : null}
      request={request}
      problem={picture.error ?? preview.error}
      keys={keys}
      onAction={(action) => {
        if (!current || !frame) return false;
        if (action.type === 'remove') {
          remove(current.id);
          return true;
        }
        if (action.type !== 'nudge') return false;
        const area = nudge(current.area, action.x, action.y, action.fine, frame);
        setItems((list) => list.map((item) => (item.id === current.id ? { ...item, area } : item)));
        return true;
      }}
      stage={
        <ImageStage
          source={frame}
          picture={preview.url}
          busy={preview.loading}
          note={picture.reading ? t('image.reading') : t('image.noPreview')}
          label={t('image.preview')}
          zoom={zoom}
          onZoom={setZoom}
        >
          {() =>
            frame && (
              <RectOverlay
                frame={frame}
                mode="redact"
                ratio={null}
                // Once the engine has drawn these areas, outlines are enough.
                hide={preview.fresh && request ? undefined : hide}
                selected={selected}
                rects={items.map((item, index) => ({ id: item.id, area: item.area, label: describe(item, index) }))}
                onSelect={setSelected}
                onChange={(id, area) =>
                  setItems((list) => list.map((item) => (item.id === id ? { ...item, area } : item)))
                }
                onDraw={(area) => {
                  const id = ++ids.current;
                  setItems((list) => [...list, { id, area }]);
                  setSelected(id);
                }}
                onRemove={remove}
              />
            )
          }
        </ImageStage>
      }
      {...props}
    >
      <Section title={t('editor.redact.areas')}>
        {items.length === 0 ? (
          <p className="editor-hint muted">{t('image.redact.hint')}</p>
        ) : (
          <ol className="area-list">
            {items.map((item, index) => (
              <li key={item.id} className="area-row" data-selected={item.id === selected ? '' : undefined}>
                <button
                  type="button"
                  className="editor-link"
                  aria-pressed={item.id === selected}
                  onClick={() => setSelected(item.id === selected ? null : item.id)}
                >
                  {describe(item, index)}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('editor.redact.remove', { index: index + 1 })}
                  onClick={() => remove(item.id)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title={t('editor.redact.hide')}>
        <Segmented
          label={t('editor.redact.hide')}
          value={kind}
          options={[
            { value: 'color', label: t('editor.redact.color') },
            { value: 'blur', label: t('editor.redact.blur') },
            { value: 'pixelate', label: t('editor.redact.pixelate') },
          ]}
          onChange={setKind}
        />
        {kind === 'color' && (
          <label className="editor-field editor-color">
            <span>{t('editor.redact.fill')}</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
        )}
      </Section>
    </ImageShell>
  );
}
