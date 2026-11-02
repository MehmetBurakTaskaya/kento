// SPDX-License-Identifier: MIT
// Edit image: quarter turns, flips, a new size (proportions kept by default) and brightness,
// contrast and saturation, with the engine's live preview of the result.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../../components/Icon';
import { intlLocale } from '../../../i18n';
import type { Adjust, ImageTool } from '../../../ipc';
import { NumberField, Section } from '../../controls';
import type { EditorProps } from '../../panels';
import { isUnchanged, MAX_SIDE, NO_ADJUST, outputSize, resize, turn, turnedSize } from '../adjust';
import { Slider } from '../controls';
import { previewSize } from '../geometry';
import { Glyph } from '../glyphs';
import { ImageShell, sizeText } from '../ImageShell';
import { ResultStage } from '../ImageStage';
import { useImageInfo, usePreview } from '../usePicture';

/** "+12", "−5" or "0" in the language's digits. */
const signed = (value: number, lang: string) =>
  new Intl.NumberFormat(intlLocale(lang), { signDisplay: 'exceptZero' }).format(value);

export function EditImage(props: EditorProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { paths } = props;
  const picture = useImageInfo(paths[0] ?? '');
  const source = picture.info;
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST);
  const [keep, setKeep] = useState(true);
  const request: ImageTool | null = source && !isUnchanged(adjust) ? { tool: 'edit-image', adjust } : null;
  const preview = usePreview(paths, request, previewSize(source), Boolean(source));
  const result = source ? outputSize(source, adjust) : null;
  const change = (part: Partial<Adjust>) => setAdjust((now) => ({ ...now, ...part }));
  const label = t('image.picture', { name: '' });

  const level = (key: 'brightness' | 'contrast' | 'saturation') => (
    <Slider
      label={t(`image.edit.${key}`)}
      value={adjust[key]}
      min={-100}
      max={100}
      text={signed(adjust[key], lang)}
      onChange={(value) => change({ [key]: value })}
    />
  );

  return (
    <ImageShell
      tool="edit-image"
      meta={source ? sizeText(source.width, source.height, lang) : null}
      request={request}
      problem={picture.error ?? preview.error}
      stage={
        <ResultStage
          picture={preview.url}
          busy={preview.loading}
          note={picture.reading ? t('image.reading') : t('image.noPreview')}
          label={label}
        />
      }
      {...props}
    >
      <Section title={t('image.edit.turn')}>
        <div className="image-actions">
          <button type="button" className="button small" onClick={() => setAdjust((now) => turn(now, -1))}>
            <Icon name="rotate-left" size={16} />
            {t('image.edit.left')}
          </button>
          <button type="button" className="button small" onClick={() => setAdjust((now) => turn(now, 1))}>
            <Icon name="rotate-right" size={16} />
            {t('image.edit.right')}
          </button>
          <button
            type="button"
            className="button small"
            aria-pressed={adjust.flipHorizontal}
            onClick={() => change({ flipHorizontal: !adjust.flipHorizontal })}
          >
            <Glyph name="flip-h" size={16} />
            {t('image.edit.flipHorizontal')}
          </button>
          <button
            type="button"
            className="button small"
            aria-pressed={adjust.flipVertical}
            onClick={() => change({ flipVertical: !adjust.flipVertical })}
          >
            <Glyph name="flip-v" size={16} />
            {t('image.edit.flipVertical')}
          </button>
        </div>
      </Section>
      {source && result && (
        <Section title={t('image.edit.size')}>
          <div className="image-size-fields">
            <NumberField
              label={t('editor.crop.width')}
              value={result.width}
              min={1}
              max={MAX_SIDE}
              suffix={t('image.px')}
              onChange={(value) => setAdjust((now) => resize(now, source, 'width', value, keep))}
            />
            <button
              type="button"
              className="icon-button image-keep"
              aria-pressed={keep}
              aria-label={t('image.edit.keep')}
              title={t('image.edit.keep')}
              onClick={() => {
                // Turning the lock on brings the height back to the picture's proportions.
                if (!keep) setAdjust((now) => resize(now, source, 'width', outputSize(source, now).width, true));
                setKeep(!keep);
              }}
            >
              <Icon name="link" size={16} />
            </button>
            <NumberField
              label={t('editor.crop.height')}
              value={result.height}
              min={1}
              max={MAX_SIDE}
              suffix={t('image.px')}
              onChange={(value) => setAdjust((now) => resize(now, source, 'height', value, keep))}
            />
          </div>
          {adjust.resize && (
            <button type="button" className="button small" onClick={() => change({ resize: null })}>
              {t('image.edit.original', {
                size: sizeText(turnedSize(source, adjust.turn).width, turnedSize(source, adjust.turn).height, lang),
              })}
            </button>
          )}
        </Section>
      )}
      <Section title={t('image.edit.colors')}>
        {level('brightness')}
        {level('contrast')}
        {level('saturation')}
      </Section>
      {result && (
        <p className="muted">{t('image.edit.result', { size: sizeText(result.width, result.height, lang) })}</p>
      )}
      <button
        type="button"
        className="button small image-reset"
        disabled={isUnchanged(adjust)}
        onClick={() => setAdjust(NO_ADJUST)}
      >
        {t('image.edit.reset')}
      </button>
    </ImageShell>
  );
}
