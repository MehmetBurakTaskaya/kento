// SPDX-License-Identifier: MIT
// Redact video: areas drawn on the picture, each hidden during its own time span. The selected
// area's span is the selection, so I and O set it; with none selected they set the span the next
// area takes.
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import type { Area, Hide, MediaTool, Span } from '../../ipc';
import { Section, Segmented } from '../controls';
import { roundArea, type Size } from '../crop';
import { EditorShell } from '../EditorShell';
import { hexToRgb } from '../levels';
import type { EditorProps } from '../panels';
import { contains, fullSpan, roundSpan } from '../spans';
import { RectOverlay, Stage } from '../Stage';
import { formatTime } from '../time';
import { useEditor } from '../useEditor';

interface Redaction {
  id: number;
  area: Area;
  span: Span;
}

export function RedactVideo(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const { duration, lang } = core;
  const video = core.info?.video;
  const frame: Size | null = video ? { width: video.width, height: video.height } : null;
  const [items, setItems] = useState<Redaction[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Span | null>(null);
  const [kind, setKind] = useState<Hide['kind']>('color');
  const [color, setColor] = useState('#000000');
  const ids = useRef(0);

  const current = items.find((item) => item.id === selected) ?? null;
  const span = current?.span ?? draft ?? fullSpan(duration);
  const setSpan = (next: Span) => {
    if (current) setItems((list) => list.map((item) => (item.id === current.id ? { ...item, span: next } : item)));
    else setDraft(next);
  };
  const hide: Hide = kind === 'color' ? { kind: 'color', rgb: hexToRgb(color) } : { kind };
  const request: MediaTool | null =
    frame && items.length
      ? {
          tool: 'redact-video',
          areas: items.map((item) => ({ area: roundArea(item.area, frame), span: roundSpan(item.span) })),
          hide,
        }
      : null;
  const describe = (item: Redaction, index: number) =>
    t('editor.redact.area', {
      index: index + 1,
      start: formatTime(item.span.start, lang),
      end: formatTime(item.span.end, lang),
    });
  const remove = (id: number) => {
    setItems((list) => list.filter((item) => item.id !== id));
    if (selected === id) setSelected(null);
  };

  return (
    <EditorShell
      tool="redact-video"
      core={core}
      request={request}
      selection={{ span, set: setSpan }}
      stage={
        <Stage core={core}>
          {frame && (
            <RectOverlay
              frame={frame}
              mode="redact"
              ratio={null}
              hide={hide}
              selected={selected}
              rects={items.map((item, index) => ({
                id: item.id,
                area: item.area,
                label: describe(item, index),
                dim: !contains(item.span, core.player.time),
              }))}
              onSelect={setSelected}
              onChange={(id, area) =>
                setItems((list) => list.map((item) => (item.id === id ? { ...item, area } : item)))
              }
              onDraw={(area) => {
                const id = ++ids.current;
                setItems((list) => [...list, { id, area, span }]);
                setSelected(id);
              }}
              onRemove={remove}
            />
          )}
        </Stage>
      }
      timeline={{
        spans: items.filter((item) => item.id !== selected).map((item) => ({ span: item.span })),
      }}
      {...props}
    >
      <Section title={t('editor.redact.areas')}>
        {items.length === 0 ? (
          <p className="editor-hint muted">{t('editor.redact.hint')}</p>
        ) : (
          <ol className="area-list">
            {items.map((item, index) => (
              <li key={item.id} className="area-row" data-selected={item.id === selected ? '' : undefined}>
                <button
                  type="button"
                  className="editor-link"
                  aria-pressed={item.id === selected}
                  onClick={() => {
                    setSelected(item.id === selected ? null : item.id);
                    core.player.seek(item.span.start);
                  }}
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
        {current && (
          <p className="editor-hint muted">
            {t('editor.redact.editing', { index: items.findIndex((item) => item.id === current.id) + 1 })}
          </p>
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
            { value: 'erase', label: t('editor.redact.erase') },
          ]}
          onChange={setKind}
        />
        {kind === 'color' && (
          <label className="editor-field editor-color">
            <span>{t('editor.redact.fill')}</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
        )}
        {kind === 'erase' && <p className="editor-hint muted">{t('editor.redact.eraseHint')}</p>}
      </Section>
    </EditorShell>
  );
}
