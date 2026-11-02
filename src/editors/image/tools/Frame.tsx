// SPDX-License-Identifier: MIT
// Add frame: space around the picture on a colour, a two-colour gradient or the picture itself
// blurred, with rounded corners and a shadow, drawn live by the engine. Sizes follow the picture,
// so the first look suits a small picture and a large photo alike.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FrameStyle, ImageTool, Rgb } from '../../../ipc';
import { Section, Segmented } from '../../controls';
import type { Size } from '../../crop';
import { hexToRgb } from '../../levels';
import type { EditorProps } from '../../panels';
import { Check, Slider, Swatches, type Swatch } from '../controls';
import { previewSize } from '../geometry';
import { ImageShell, sizeText } from '../ImageShell';
import { ResultStage } from '../ImageStage';
import { rgbToHex } from '../marks';
import { useImageInfo, usePreview } from '../usePicture';

export const FRAME_SWATCHES: Swatch[] = [
  { id: 'white', rgb: [255, 255, 255] },
  { id: 'paper', rgb: [242, 243, 245] },
  { id: 'silver', rgb: [195, 200, 206] },
  { id: 'graphite', rgb: [43, 48, 54] },
  { id: 'black', rgb: [0, 0, 0] },
  { id: 'blue', rgb: [42, 78, 166] },
];

type Kind = FrameStyle['background']['kind'];

/** The first look: 6 % of the longer side around the picture, slightly rounded, with a shadow. */
export function frameDefaults(source: Size) {
  const long = Math.max(source.width, source.height);
  const short = Math.min(source.width, source.height);
  return {
    padding: Math.round(long * 0.06),
    radius: Math.round(short * 0.02),
    maxPadding: Math.max(1, Math.round(long * 0.3)),
    maxRadius: Math.max(1, Math.round(short * 0.25)),
  };
}

export function Frame(props: EditorProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { paths } = props;
  const picture = useImageInfo(paths[0] ?? '');
  const source = picture.info;
  const defaults = source ? frameDefaults(source) : null;
  const [padding, setPadding] = useState<number | null>(null);
  const [radius, setRadius] = useState<number | null>(null);
  const [shadow, setShadow] = useState(true);
  const [kind, setKind] = useState<Kind>('color');
  const [color, setColor] = useState<Rgb>([255, 255, 255]);
  const [from, setFrom] = useState<Rgb>([219, 226, 236]);
  const [to, setTo] = useState<Rgb>([42, 78, 166]);
  const [angle, setAngle] = useState(45);

  const style: FrameStyle | null = defaults
    ? {
        padding: padding ?? defaults.padding,
        radius: radius ?? defaults.radius,
        shadow,
        background:
          kind === 'color'
            ? { kind: 'color', rgb: color }
            : kind === 'gradient'
              ? { kind: 'gradient', from, to, angle }
              : { kind: 'blurred' },
      }
    : null;
  const changes = style && (style.padding > 0 || style.radius > 0 || style.shadow);
  const request: ImageTool | null = style && changes ? { tool: 'frame', frame: style } : null;
  const preview = usePreview(paths, request, previewSize(source), Boolean(source));
  const px = (value: number) => t('image.pixels', { value });

  return (
    <ImageShell
      tool="frame"
      meta={source ? sizeText(source.width, source.height, lang) : null}
      request={request}
      problem={picture.error ?? preview.error}
      stage={
        <ResultStage
          picture={preview.url}
          busy={preview.loading}
          note={picture.reading ? t('image.reading') : t('image.noPreview')}
          label={t('image.preview')}
        />
      }
      {...props}
    >
      {style && defaults && (
        <Section title={t('image.frame.shape')}>
          <Slider
            label={t('image.frame.padding')}
            value={style.padding}
            min={0}
            max={defaults.maxPadding}
            text={px(style.padding)}
            onChange={setPadding}
          />
          <Slider
            label={t('image.frame.radius')}
            value={style.radius}
            min={0}
            max={defaults.maxRadius}
            text={px(style.radius)}
            onChange={setRadius}
          />
          <Check label={t('image.frame.shadow')} checked={shadow} onChange={setShadow} />
        </Section>
      )}
      <Section title={t('image.frame.background')}>
        <Segmented
          label={t('image.frame.background')}
          value={kind}
          options={[
            { value: 'color', label: t('image.frame.color') },
            { value: 'gradient', label: t('image.frame.gradient') },
            { value: 'blurred', label: t('image.frame.blurred') },
          ]}
          onChange={setKind}
        />
        {kind === 'color' && (
          <Swatches
            label={t('image.frame.color')}
            swatches={FRAME_SWATCHES}
            value={color}
            name={(id) => t(`image.color.${id}`)}
            onChange={setColor}
          />
        )}
        {kind === 'gradient' && (
          <>
            <div className="image-gradient">
              <label className="editor-field editor-color">
                <span>{t('image.frame.from')}</span>
                <input
                  type="color"
                  value={rgbToHex(from)}
                  onChange={(event) => setFrom(hexToRgb(event.target.value))}
                />
              </label>
              <label className="editor-field editor-color">
                <span>{t('image.frame.to')}</span>
                <input type="color" value={rgbToHex(to)} onChange={(event) => setTo(hexToRgb(event.target.value))} />
              </label>
              <span
                className="image-gradient-sample"
                aria-hidden="true"
                style={{
                  // CSS angles start at the top; the engine's 0 runs left to right.
                  background: `linear-gradient(${angle + 90}deg, ${rgbToHex(from)}, ${rgbToHex(to)})`,
                }}
              />
            </div>
            <Slider
              label={t('image.frame.angle')}
              value={angle}
              min={0}
              max={359}
              text={t('image.degrees', { value: angle })}
              onChange={setAngle}
            />
          </>
        )}
        {kind === 'blurred' && <p className="editor-hint muted">{t('image.frame.blurredHint')}</p>}
      </Section>
      <button
        type="button"
        className="button small image-reset"
        disabled={padding === null && radius === null && shadow && kind === 'color'}
        onClick={() => {
          setPadding(null);
          setRadius(null);
          setShadow(true);
          setKind('color');
        }}
      >
        {t('image.frame.reset')}
      </button>
    </ImageShell>
  );
}
