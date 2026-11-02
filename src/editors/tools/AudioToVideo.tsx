// SPDX-License-Identifier: MIT
// Audio to video: a video whose picture is a waveform, a spectrum, frequency bars or a still image.
// The preview sketches the chosen picture from the waveform peaks at the playhead.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { api, type MediaTool } from '../../ipc';
import { Picture, Section, Segmented, useBlobUrl } from '../controls';
import { EditorShell } from '../EditorShell';
import { peaksAround } from '../levels';
import type { EditorProps } from '../panels';
import { fileName, useEditor } from '../useEditor';

type Visual = 'waveform' | 'spectrum' | 'bars' | 'image';

const IMAGE = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i;

function draw(canvas: HTMLCanvasElement, kind: Visual, peaks: number[], time: number, duration: number) {
  const { width, height } = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return;
  const style = getComputedStyle(canvas);
  const line = style.color;
  const accent = style.getPropertyValue('--blue-hi').trim() || line;
  const w = canvas.width;
  const h = canvas.height;
  context.clearRect(0, 0, w, h);
  if (kind === 'waveform') {
    const values = peaksAround(peaks, time, duration, 240);
    context.fillStyle = line;
    const step = w / values.length;
    values.forEach((value, i) => {
      const half = Math.max(scale, value * h * 0.38);
      context.fillRect(i * step, h / 2 - half, Math.max(scale, step * 0.6), half * 2);
    });
  } else if (kind === 'bars') {
    const values = peaksAround(peaks, time, duration, 40);
    const step = w / values.length;
    values.forEach((value, i) => {
      const bar = Math.max(scale * 2, value * h * 0.8);
      context.fillStyle = accent;
      context.fillRect(i * step + step * 0.15, h - bar, step * 0.7, bar);
      context.fillStyle = line;
      context.fillRect(i * step + step * 0.15, h - bar, step * 0.7, Math.min(bar, scale * 3));
    });
  } else if (kind === 'spectrum') {
    // A scrolling spectrogram: time runs left to right, low frequencies at the bottom.
    const values = peaksAround(peaks, time, duration, 160);
    const step = w / values.length;
    const bands = 24;
    values.forEach((value, i) => {
      for (let band = 0; band < bands; band++) {
        const level = value * (1 - band / bands) ** 1.6;
        context.globalAlpha = Math.min(1, level * 1.4);
        context.fillStyle = band < bands / 3 ? line : accent;
        context.fillRect(i * step, h - ((band + 1) * h) / bands, step + 0.5, h / bands + 0.5);
      }
    });
    context.globalAlpha = 1;
  }
}

function Preview({
  kind,
  peaks,
  time,
  duration,
  image,
}: {
  kind: Visual;
  peaks: number[];
  time: number;
  duration: number;
  image: string | null;
}) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const src = useBlobUrl(image ? () => api.thumbnail(image, 640) : null, image ?? '');
  useEffect(() => {
    const element = canvas.current;
    if (kind === 'image' || !element) return;
    const paint = () => draw(element, kind, peaks, time, duration);
    paint();
    // A paused preview still follows the panel's size and the theme.
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(paint);
    resized?.observe(element);
    const themed = new MutationObserver(paint);
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => {
      resized?.disconnect();
      themed.disconnect();
    };
  }, [kind, peaks, time, duration]);
  return (
    <div className="editor-stage visual-stage" dir="ltr" style={{ '--ratio': 16 / 9 } as CSSProperties}>
      {kind === 'image' ? (
        image ? (
          <span className="visual-image">
            <Picture src={src} icon="image" label={fileName(image)} />
          </span>
        ) : (
          <div className="stage-placeholder">
            <Icon name="image" size={32} />
            <span>{t('editor.visual.noImage')}</span>
          </div>
        )
      ) : (
        <canvas ref={canvas} className="visual-canvas" aria-hidden="true" />
      )}
    </div>
  );
}

export function AudioToVideo(props: EditorProps) {
  const { t } = useTranslation();
  const core = useEditor(props.paths[0] ?? '', true);
  const [kind, setKind] = useState<Visual>('waveform');
  const [image, setImage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const request: MediaTool | null = !core.info
    ? null
    : kind === 'image'
      ? image
        ? { tool: 'audio-to-video', visual: { kind: 'image', path: image } }
        : null
      : { tool: 'audio-to-video', visual: { kind } };

  const pick = async () => {
    try {
      const files = await api.pickFiles();
      if (!files.length) return;
      const found = files.find((path) => IMAGE.test(path));
      if (!found) {
        setProblem(t('editor.visual.notImage'));
        return;
      }
      setImage(found);
      setKind('image');
      setProblem(null);
    } catch (reason) {
      setProblem(String(reason));
    }
  };

  return (
    <EditorShell
      tool="audio-to-video"
      core={core}
      request={request}
      stage={
        <Preview
          kind={kind}
          peaks={core.media.peaks ?? []}
          time={core.player.time}
          duration={core.duration}
          image={image}
        />
      }
      {...props}
    >
      <Section title={t('editor.visual.title')}>
        <Segmented
          label={t('editor.visual.title')}
          value={kind}
          options={[
            { value: 'waveform', label: t('editor.visual.waveform') },
            { value: 'spectrum', label: t('editor.visual.spectrum') },
            { value: 'bars', label: t('editor.visual.bars') },
            { value: 'image', label: t('editor.visual.image') },
          ]}
          onChange={setKind}
        />
        {kind === 'image' && (
          <div className="visual-pick">
            {image && <bdi className="file-name">{fileName(image)}</bdi>}
            <button type="button" className="button small" onClick={() => void pick()}>
              <Icon name="image" size={16} />
              {image ? t('editor.visual.change') : t('editor.visual.choose')}
            </button>
          </div>
        )}
        {problem && <p className="error-text">{problem}</p>}
        <p className="editor-hint muted">{t('editor.visual.hint')}</p>
      </Section>
    </EditorShell>
  );
}
