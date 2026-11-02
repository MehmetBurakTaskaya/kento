// SPDX-License-Identifier: MIT
// Crop video area: a rectangle drawn, moved and resized on the picture, or typed in video pixels.
// A ratio preset fixes its shape; with Free, Shift keeps the current one while resizing.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Area, MediaTool } from '../../ipc';
import { NumberField, Section, Segmented } from '../controls';
import { center, clampArea, fitRatio, fullArea, MIN_SIDE, RATIOS, roundArea, sameArea, type Size } from '../crop';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { RectOverlay, Stage } from '../Stage';
import { formatNumber } from '../time';
import { useEditor } from '../useEditor';

/** A typed side with a fixed ratio: the other side follows, both within the frame. */
function withSide(area: Area, side: 'width' | 'height', value: number, ratio: number | null, frame: Size): Area {
  if (!ratio) return clampArea({ ...area, [side]: value }, frame);
  let width = side === 'width' ? value : value * ratio;
  width = Math.min(width, frame.width, frame.height * ratio);
  return clampArea({ ...area, width, height: width / ratio }, frame);
}

export function Crop(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const video = core.info?.video;
  const frame: Size | null = video ? { width: video.width, height: video.height } : null;
  const [area, setArea] = useState<Area | null>(null);
  const [ratioId, setRatioId] = useState('free');
  const ratio = RATIOS.find((option) => option.id === ratioId)?.ratio ?? null;
  const current = frame ? (area ?? fullArea(frame)) : null;
  const shown = frame && current ? roundArea(current, frame) : null;
  const request: MediaTool | null =
    frame && shown && !sameArea(shown, fullArea(frame), 2) ? { tool: 'crop-video', area: shown } : null;

  const choose = (id: string) => {
    setRatioId(id);
    const next = RATIOS.find((option) => option.id === id)?.ratio;
    if (next && frame && current) setArea(fitRatio(frame, next, center(current)));
  };

  return (
    <EditorShell
      tool="crop-video"
      core={core}
      request={request}
      stage={
        <Stage core={core}>
          {frame && current && shown && (
            <RectOverlay
              frame={frame}
              mode="crop"
              ratio={ratio}
              selected={1}
              rects={[
                {
                  id: 1,
                  area: current,
                  label: t('editor.crop.area', {
                    width: formatNumber(shown.width, core.lang),
                    height: formatNumber(shown.height, core.lang),
                    x: formatNumber(shown.x, core.lang),
                    y: formatNumber(shown.y, core.lang),
                  }),
                },
              ]}
              onSelect={() => {}}
              onChange={(_, next) => setArea(next)}
              onDraw={setArea}
            />
          )}
        </Stage>
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
        <p className="editor-hint muted">{t('editor.crop.hint')}</p>
      </Section>
      {frame && current && shown && (
        <Section title={t('editor.crop.values')}>
          <div className="editor-grid-fields">
            <NumberField
              label={t('editor.crop.x')}
              value={shown.x}
              min={0}
              max={frame.width - MIN_SIDE}
              onChange={(x) => setArea(clampArea({ ...current, x }, frame))}
            />
            <NumberField
              label={t('editor.crop.y')}
              value={shown.y}
              min={0}
              max={frame.height - MIN_SIDE}
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
          <p className="muted">
            {t('editor.crop.result', {
              width: formatNumber(shown.width, core.lang),
              height: formatNumber(shown.height, core.lang),
            })}
          </p>
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
    </EditorShell>
  );
}
