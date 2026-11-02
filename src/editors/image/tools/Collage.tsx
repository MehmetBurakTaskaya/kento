// SPDX-License-Identifier: MIT
// Make a collage: the pictures in the order of the list (dragged, or moved with Alt and the
// arrows) in a grid, a row or a column, with spacing, a background and the result's width, each
// picture filling its cell or shown whole. The engine draws the preview from all of them.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CollageStyle, FileEntry, ImageTool, Rgb } from '../../../ipc';
import { OrderList } from '../../../tools/OrderList';
import { NumberField, Section, Segmented } from '../../controls';
import type { EditorProps } from '../../panels';
import { fileName } from '../../useEditor';
import { Slider, Swatches } from '../controls';
import { previewSize } from '../geometry';
import { ImageShell } from '../ImageShell';
import { ResultStage } from '../ImageStage';
import { usePreview } from '../usePicture';
import { FRAME_SWATCHES } from './Frame';

const entry = (path: string): FileEntry => ({
  path,
  name: fileName(path),
  folder: false,
  format: fileName(path).split('.').pop()?.toLowerCase() ?? null,
  category: 'image',
  size: null,
});

export const COLLAGE_WIDTH = { min: 200, max: 12000, initial: 2400 };
export const MAX_SPACING = 200;

/** A grid about as wide as it is tall: 2 columns for 2–4 pictures, 3 for 5–9 and so on. */
export const gridColumns = (count: number) => Math.max(1, Math.ceil(Math.sqrt(count)));

type LayoutKind = CollageStyle['layout']['kind'];

export function Collage({ paths, ...props }: EditorProps) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<FileEntry[]>(() => paths.map(entry));
  const [layout, setLayout] = useState<LayoutKind>('grid');
  const [columns, setColumns] = useState(() => gridColumns(paths.length));
  const [spacing, setSpacing] = useState(16);
  const [background, setBackground] = useState<Rgb>([255, 255, 255]);
  const [width, setWidth] = useState(COLLAGE_WIDTH.initial);
  const [fill, setFill] = useState(true);

  const runPaths = order.map((item) => item.path);
  const style: CollageStyle = {
    layout:
      layout === 'grid' ? { kind: 'grid', columns: Math.min(columns, Math.max(1, order.length)) } : { kind: layout },
    spacing,
    background,
    width,
    fill,
  };
  const request: ImageTool | null = order.length >= 2 ? { tool: 'collage', collage: style } : null;
  const preview = usePreview(runPaths, request, previewSize(null));

  return (
    <ImageShell
      tool="collage"
      paths={paths}
      meta={t('image.collage.count', { count: order.length })}
      request={request}
      runPaths={runPaths}
      problem={preview.error}
      stage={
        <ResultStage
          picture={preview.url}
          busy={preview.loading}
          note={t('image.noPreview')}
          label={t('image.preview')}
        />
      }
      {...props}
    >
      <Section title={t('image.collage.order')}>
        <p className="editor-hint muted">{t('image.collage.orderHint')}</p>
        <OrderList items={order} onChange={setOrder} />
      </Section>
      <Section title={t('image.collage.layout')}>
        <Segmented
          label={t('image.collage.layout')}
          value={layout}
          options={[
            { value: 'grid', label: t('image.collage.grid') },
            { value: 'row', label: t('image.collage.row') },
            { value: 'column', label: t('image.collage.column') },
          ]}
          onChange={setLayout}
        />
        {layout === 'grid' && (
          <NumberField
            label={t('image.collage.columns')}
            value={Math.min(columns, Math.max(1, order.length))}
            min={1}
            max={Math.max(1, order.length)}
            onChange={(value) => setColumns(Math.round(value))}
          />
        )}
        <Segmented
          label={t('image.collage.fit')}
          value={fill ? 'fill' : 'fit'}
          options={[
            { value: 'fill', label: t('image.collage.fill') },
            { value: 'fit', label: t('image.collage.whole') },
          ]}
          onChange={(value) => setFill(value === 'fill')}
        />
      </Section>
      <Section title={t('image.collage.look')}>
        <Slider
          label={t('image.collage.spacing')}
          value={spacing}
          min={0}
          max={MAX_SPACING}
          text={t('image.pixels', { value: spacing })}
          onChange={setSpacing}
        />
        <NumberField
          label={t('image.collage.width')}
          value={width}
          min={COLLAGE_WIDTH.min}
          max={COLLAGE_WIDTH.max}
          step={10}
          suffix={t('image.px')}
          onChange={(value) => setWidth(Math.round(value))}
        />
        <Swatches
          label={t('image.collage.background')}
          swatches={FRAME_SWATCHES}
          value={background}
          name={(id) => t(`image.color.${id}`)}
          onChange={setBackground}
        />
      </Section>
    </ImageShell>
  );
}
