// SPDX-License-Identifier: MIT
// Burn in subtitles (SPEC 5.5 [+]): one video and one SRT or VTT file, dragged together. The text
// size and its place (bottom or top) are chosen over a frame of the video at the first subtitle,
// with that subtitle laid on it as FFmpeg will draw it: the system's sans-serif, white with a dark
// outline, sized against the picture's height.
import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { FileIcon } from '../components/FileIcon';
import { Segmented } from '../editors/controls';
import { Slider } from '../editors/image/controls';
import { formatTime } from '../editors/time';
import { intlLocale } from '../i18n';
import { api, type FileEntry, type SubtitleSample } from '../ipc';
import { useApp } from '../state/store';
import '../styles/tools.css';

export type SubtitlePosition = 'bottom' | 'top';

/** Percent of the usual subtitle size. */
export const SUBTITLE_SIZE = { min: 50, max: 250, step: 10, initial: 100 };

/** FFmpeg sets text subtitles at 16 on a 288-line script: this share of the picture's height. */
export const LINE_SHARE = 16 / 288;

/** The video and the subtitles of the selection, in either order. */
export function pairOf(entries: FileEntry[]): { video: FileEntry; subtitles: FileEntry } | null {
  const video = entries.find((entry) => entry.category === 'video');
  const subtitles = entries.find((entry) => entry.category === 'subtitle');
  return entries.length === 2 && video && subtitles ? { video, subtitles } : null;
}

export function BurnSubtitlesPanel({ entries, onClose }: { entries: FileEntry[]; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const started = useApp((state) => state.started);
  const pair = pairOf(entries);
  const [size, setSize] = useState(SUBTITLE_SIZE.initial);
  const [position, setPosition] = useState<SubtitlePosition>('bottom');
  const [sample, setSample] = useState<SubtitleSample | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = pair?.video.path;
  const subtitles = pair?.subtitles.path;

  // The first subtitle, the picture's shape, and a frame in the middle of that subtitle.
  useEffect(() => {
    if (!video || !subtitles) return;
    let live = true;
    let url: string | null = null;
    void api
      .mediaProbe(video)
      .then((info) => {
        if (live && info.video && info.video.width > 0 && info.video.height > 0) {
          setAspect(info.video.width / info.video.height);
        }
      })
      .catch(() => {});
    api
      .subtitleSample(subtitles)
      .then((found) => {
        if (!live) return;
        setSample(found);
        const at = found ? (found.start + found.end) / 2 : 1;
        return api.mediaFrame(video, at, 640).then((blob) => {
          if (!live || !blob) return;
          url = URL.createObjectURL(blob);
          setFrame(url);
        });
      })
      .catch((reason: unknown) => live && setError(String(reason)));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [video, subtitles]);

  if (!pair) return null;

  const start = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api
      .runMediaTool({ tool: 'burn-subtitles', size, position }, [pair.video.path, pair.subtitles.path])
      .then((ids) => {
        started(ids);
        onClose();
      })
      .catch((reason: unknown) => {
        setError(String(reason));
        setBusy(false);
      });
  };

  const stage = {
    aspectRatio: String(aspect),
    '--aspect': String(aspect),
    '--subtitle-scale': String((LINE_SHARE * size) / 100),
  } as CSSProperties;

  return (
    <Dialog
      title={t('tool.burn-subtitles')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button quiet" onClick={onClose}>
            {t('tools.cancel')}
          </button>
          <button type="button" className="button primary" disabled={busy} onClick={start}>
            {t('tools.burn.run')}
          </button>
        </>
      }
    >
      <ul className="compress-files tool-files" aria-label={t('tools.burn.files')}>
        {[pair.video, pair.subtitles].map((entry) => (
          <li key={entry.path} className="compress-file">
            <FileIcon path={entry.path} category={entry.category} size={24} />
            <bdi className="file-name">{entry.name}</bdi>
          </li>
        ))}
      </ul>
      <figure className="burn-preview">
        <div className="burn-stage" style={stage} data-position={position}>
          {frame && <img src={frame} alt="" />}
          {sample && (
            <p className="burn-line" dir="auto">
              {sample.text}
            </p>
          )}
        </div>
        <figcaption className="muted compress-note">
          {sample ? t('tools.burn.sample', { time: formatTime(sample.start, lang, false) }) : t('tools.burn.noSample')}
        </figcaption>
      </figure>
      <Slider
        label={t('tools.burn.size')}
        value={size}
        min={SUBTITLE_SIZE.min}
        max={SUBTITLE_SIZE.max}
        step={SUBTITLE_SIZE.step}
        text={new Intl.NumberFormat(intlLocale(lang), { style: 'percent' }).format(size / 100)}
        onChange={setSize}
      />
      <Segmented
        label={t('tools.burn.position')}
        value={position}
        options={[
          { value: 'bottom', label: t('tools.burn.bottom') },
          { value: 'top', label: t('tools.burn.top') },
        ]}
        onChange={setPosition}
      />
      <p className="muted compress-note">{t('tools.burn.note')}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
