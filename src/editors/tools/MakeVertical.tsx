// SPDX-License-Identifier: MIT
// Make vertical: a 1080 × 1920 MP4 for short-video apps, from the whole video or the selection (I and
// O). Crop shows the 9:16 window on the picture, dragged sideways, with the rest dimmed; every fill
// also shows a small portrait of the result from a still at the playhead.
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaTool, Span, VerticalFill } from '../../ipc';
import { Section, Segmented } from '../controls';
import type { Size } from '../crop';
import { EditorShell } from '../EditorShell';
import { hexToRgb } from '../levels';
import type { EditorProps } from '../panels';
import { centerOf, isUpright, pastLimit, portraitWindow, useStill, VERTICAL, windowPosition } from '../picture';
import { fullSpan, isFull, roundSpan, spanLength } from '../spans';
import { RectOverlay, Stage } from '../Stage';
import { formatNumber, formatTime } from '../time';
import { useEditor } from '../useEditor';

type FillKind = VerticalFill['kind'];

function Portrait({
  still,
  fill,
  color,
  position,
  frame,
}: {
  still: string | null;
  fill: FillKind;
  color: string;
  position: number;
  frame: Size;
}) {
  const { t } = useTranslation();
  const picture = still ? (
    <img src={still} alt="" />
  ) : (
    // Without a still, a calm block in the picture's own shape.
    <span className="vertical-blank" style={{ aspectRatio: `${frame.width} / ${frame.height}` }} />
  );
  return (
    <div
      className="vertical-portrait"
      data-fill={fill}
      role="img"
      aria-label={t('editor.vertical.preview')}
      style={{ '--back': color, '--position': `${position * 100}%` } as CSSProperties}
    >
      {fill === 'blur' && <span className="vertical-back">{picture}</span>}
      <span className="vertical-front">{picture}</span>
    </div>
  );
}

export function MakeVertical(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', false);
  const { duration, lang, player } = core;
  const video = core.info?.video;
  const frame: Size | null = video ? { width: video.width, height: video.height } : null;
  const [kind, setKind] = useState<FillKind>('crop');
  const [center, setCenter] = useState(0.5);
  const [color, setColor] = useState('#000000');
  const [span, setSpan] = useState<Span | null>(null);
  const still = useStill(core.path, player.time, player.playing, 480);

  const selection = span ?? fullSpan(duration);
  const whole = !span || isFull(span, duration);
  const fill: VerticalFill =
    kind === 'crop'
      ? { kind, center: Math.round(center * 1000) / 1000 }
      : kind === 'blur'
        ? { kind }
        : { kind, rgb: hexToRgb(color) };
  const request: MediaTool | null = frame
    ? { tool: 'make-vertical', span: whole ? null : roundSpan(selection), fill }
    : null;
  const window = frame ? portraitWindow(center, frame) : null;
  const length = whole ? duration : spanLength(selection);
  const limit = pastLimit(length);

  return (
    <EditorShell
      tool="make-vertical"
      core={core}
      request={request}
      selection={{ span: selection, set: setSpan }}
      stage={
        <Stage core={core}>
          {frame && window && kind === 'crop' && (
            <RectOverlay
              frame={frame}
              mode="crop"
              ratio={window.width / window.height}
              selected={null}
              rects={[
                {
                  id: 1,
                  area: window,
                  label: t('editor.vertical.window', {
                    width: formatNumber(window.width, lang),
                    height: formatNumber(window.height, lang),
                    x: formatNumber(window.x, lang),
                  }),
                },
              ]}
              onSelect={() => {}}
              onChange={(_, area) => setCenter(centerOf(area, frame))}
              onDraw={(area) => setCenter(centerOf(area, frame))}
            />
          )}
        </Stage>
      }
      {...props}
    >
      <Section title={t('editor.vertical.fill')}>
        <Segmented
          label={t('editor.vertical.fill')}
          value={kind}
          options={[
            { value: 'crop', label: t('editor.vertical.crop') },
            { value: 'blur', label: t('editor.vertical.blur') },
            { value: 'color', label: t('editor.vertical.color') },
          ]}
          onChange={setKind}
        />
        <p className="editor-hint muted">{t(`editor.vertical.${kind}Hint`)}</p>
        {kind === 'color' && (
          <label className="editor-field editor-color">
            <span>{t('editor.vertical.background')}</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
        )}
      </Section>
      <Section title={t('editor.vertical.result')}>
        <div className="vertical-result">
          {frame && window && (
            <Portrait still={still} fill={kind} color={color} position={windowPosition(window, frame)} frame={frame} />
          )}
          <div className="vertical-facts">
            <p>
              {t('editor.vertical.size', {
                width: formatNumber(VERTICAL.width, lang),
                height: formatNumber(VERTICAL.height, lang),
              })}
            </p>
            <p>{t('editor.vertical.length', { length: formatTime(length, lang) })}</p>
            <p className="editor-hint muted">{t(whole ? 'editor.vertical.whole' : 'editor.vertical.part')}</p>
          </div>
        </div>
        {limit !== null && (
          <p className="picture-note" role="status">
            {t(limit === 60 ? 'editor.vertical.overMinute' : 'editor.vertical.overThree')}
          </p>
        )}
        {frame && isUpright(frame) && <p className="editor-hint muted">{t('editor.vertical.upright')}</p>}
      </Section>
    </EditorShell>
  );
}
