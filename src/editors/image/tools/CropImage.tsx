// SPDX-License-Identifier: MIT
// Crop image: a rectangle drawn, moved and resized on the picture (or typed in pixels) with the
// outside dimmed. A ratio preset fixes its shape; with Free, Shift keeps the current one while
// resizing. The arrows move it and Enter saves.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Area, ImageTool } from '../../../ipc';
import { NumberField, Section, Segmented } from '../../controls';
import { center, clampArea, fitRatio, fullArea, MIN_SIDE, RATIOS, sameArea, type Size } from '../../crop';
import type { EditorProps } from '../../panels';
import { RectOverlay } from '../../Stage';
import { formatNumber } from '../../time';
import { nudge, pixelArea, previewSize, withSide } from '../geometry';
import { ImageShell, sizeText, useKeyRows, type KeyRow } from '../ImageShell';
import { ImageStage } from '../ImageStage';
import { useImageInfo, usePreview } from '../usePicture';

const pct = (part: number, whole: number) => `${whole > 0 ? (part / whole) * 100 : 0}%`;

export function CropImage(props: EditorProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { paths } = props;
  const picture = useImageInfo(paths[0] ?? '');
  const frame: Size | null = picture.info;
  const [zoom, setZoom] = useState(1);
  const plain = usePreview(paths, null, previewSize(frame, zoom), Boolean(frame));
  const [area, setArea] = useState<Area | null>(null);
  const [ratioId, setRatioId] = useState('free');
  const ratio = RATIOS.find((option) => option.id === ratioId)?.ratio ?? null;
  const current = frame ? (area ?? fullArea(frame)) : null;
  const shown = frame && current ? pixelArea(current, frame) : null;
  const request: ImageTool | null =
    frame && shown && !sameArea(shown, fullArea(frame), 1) ? { tool: 'crop-image', area: shown } : null;
  const keyRows = useKeyRows();

  // Enter and the arrows act on the area, so it has the focus from the start.
  const ready = Boolean(frame);
  useEffect(() => {
    if (!ready) return;
    const frameId = requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.image-editor[data-tool="crop-image"] .overlay-rect')?.focus(),
    );
    return () => cancelAnimationFrame(frameId);
  }, [ready]);

  const choose = (id: string) => {
    setRatioId(id);
    const next = RATIOS.find((option) => option.id === id)?.ratio;
    if (next && frame && current) setArea(fitRatio(frame, next, center(current)));
  };

  const keys: KeyRow[] = [
    [<kbd key="enter">Enter</kbd>, t('editor.keys.save')],
    keyRows.arrows,
    keyRows.fine,
    [<kbd key="shift">{keyRows.shift}</kbd>, t('image.keys.ratio')],
    keyRows.zoom,
  ];

  return (
    <ImageShell
      tool="crop-image"
      meta={frame ? sizeText(frame.width, frame.height, lang) : null}
      request={request}
      problem={picture.error ?? plain.error}
      enterSaves
      keys={keys}
      onAction={(action) => {
        if (action.type !== 'nudge' || !frame || !current) return false;
        setArea(nudge(current, action.x, action.y, action.fine, frame));
        return true;
      }}
      stage={
        <ImageStage
          source={frame}
          picture={plain.url}
          busy={plain.loading}
          note={picture.reading ? t('image.reading') : t('image.noPreview')}
          label={t('image.picture')}
          zoom={zoom}
          onZoom={setZoom}
        >
          {() =>
            frame &&
            current &&
            shown && (
              <>
                <RectOverlay
                  frame={frame}
                  mode="crop"
                  ratio={ratio}
                  selected={1}
                  rects={[
                    {
                      id: 1,
                      area: current,
                      label: t('image.crop.area', {
                        size: sizeText(shown.width, shown.height, lang),
                        x: formatNumber(shown.x, lang),
                        y: formatNumber(shown.y, lang),
                      }),
                    },
                  ]}
                  onSelect={() => {}}
                  onChange={(_, next) => setArea(next)}
                  onDraw={setArea}
                />
                <span
                  className="crop-size"
                  aria-hidden="true"
                  style={{
                    insetInlineStart: pct(current.x, frame.width),
                    insetBlockStart: pct(current.y, frame.height),
                  }}
                >
                  {t('image.crop.badge', { size: sizeText(shown.width, shown.height, lang) })}
                </span>
              </>
            )
          }
        </ImageStage>
      }
      {...props}
    >
      <Section title={t('editor.crop.ratio')}>
        <Segmented
          label={t('editor.crop.ratio')}
          value={ratioId}
          options={RATIOS.map((option) => ({
            value: option.id,
            label: option.ratio ? option.id : t('editor.crop.free'),
          }))}
          onChange={choose}
        />
        <p className="editor-hint muted">{t('image.crop.hint')}</p>
      </Section>
      {frame && current && shown && (
        <Section title={t('image.crop.values')}>
          <div className="editor-grid-fields">
            <NumberField
              label={t('editor.crop.x')}
              value={shown.x}
              min={0}
              max={frame.width - 1}
              onChange={(x) => setArea(clampArea({ ...current, x }, frame))}
            />
            <NumberField
              label={t('editor.crop.y')}
              value={shown.y}
              min={0}
              max={frame.height - 1}
              onChange={(y) => setArea(clampArea({ ...current, y }, frame))}
            />
            <NumberField
              label={t('editor.crop.width')}
              value={shown.width}
              min={MIN_SIDE}
              max={frame.width}
              onChange={(width) => setArea(withSide(current, 'width', width, ratio, frame))}
            />
            <NumberField
              label={t('editor.crop.height')}
              value={shown.height}
              min={MIN_SIDE}
              max={frame.height}
              onChange={(height) => setArea(withSide(current, 'height', height, ratio, frame))}
            />
          </div>
          <p className="muted">{t('image.crop.result', { size: sizeText(shown.width, shown.height, lang) })}</p>
          <button
            type="button"
            className="button small"
            disabled={!request}
            onClick={() => {
              setRatioId('free');
              setArea(null);
            }}
          >
            {t('editor.crop.reset')}
          </button>
        </Section>
      )}
    </ImageShell>
  );
}
