// SPDX-License-Identifier: MIT
// The frame every media editor shares: a large panel with the file's details, the picture or
// waveform, the transport and timeline, the tool's own controls beside them and "Save as a new
// file". It owns the keyboard layout of SPEC 5.6.
import { Fragment, useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { api, type MediaInfo, type MediaTool, type Span } from '../ipc';
import { allowed, editorKey, keyScope } from './keys';
import type { EditorProps, MediaPanel } from './panels';
import { setEnd, setStart, spanLength } from './spans';
import { AudioSink } from './Stage';
import { Timeline, type TimelineProps } from './Timeline';
import { formatNumber, formatTime } from './time';
import type { EditorCore } from './useEditor';

export interface Selection {
  span: Span;
  set(span: Span): void;
}

export interface ShellProps extends EditorProps {
  tool: MediaPanel;
  core: EditorCore;
  /** The request "Save as a new file" sends; null while the choices are not ready. */
  request: MediaTool | null;
  /** The files the tool runs on, when they differ from the previewed one (Merge). */
  runPaths?: string[];
  selection?: Selection | null;
  /** What M does in this tool: a split marker or a frame at the playhead. */
  mark?: { label: string; run(): void } | null;
  /** The picture above the transport (video editors). */
  stage?: ReactNode;
  /** Markers, spans and parts on the timeline; `peaks` gives a video editor its sound's waveform. */
  timeline?: Pick<TimelineProps, 'markers' | 'spans' | 'parts' | 'peaks'>;
  children: ReactNode;
}

const isMac = () => document.documentElement.dataset.platform === 'macos';

function Meta({ info, lang }: { info: MediaInfo; lang: string }) {
  const { t } = useTranslation();
  const parts = [
    info.video
      ? t('editor.meta.video', {
          width: formatNumber(info.video.width, lang),
          height: formatNumber(info.video.height, lang),
          fps: formatNumber(info.video.fps, lang, 2),
        })
      : info.audio
        ? t('editor.meta.audio', {
            channels: info.audio.channels,
            rate: formatNumber(info.audio.sampleRate / 1000, lang, 1),
          })
        : null,
    formatTime(info.duration, lang),
  ].filter(Boolean);
  return <span className="muted">{parts.join(' · ')}</span>;
}

function KeysHelp({ audio, selection, mark }: { audio: boolean; selection: boolean; mark: string | null }) {
  const { t } = useTranslation();
  const mac = isMac();
  const shift = t(mac ? 'key.shift.mac' : 'key.shift.windows');
  const space = t('editor.key.space');
  const rows: [ReactNode, string][] = [
    [<kbd key="space">{space}</kbd>, t('editor.keys.play')],
    [
      <>
        <kbd>←</kbd> <kbd>→</kbd>
      </>,
      t('editor.keys.second'),
    ],
    [
      <>
        <kbd>{shift}</kbd>+<kbd>←</kbd> <kbd>→</kbd>
      </>,
      t(audio ? 'editor.keys.tenth' : 'editor.keys.frame'),
    ],
  ];
  if (selection) {
    rows.push(
      [
        <>
          <kbd>I</kbd> <kbd>O</kbd>
        </>,
        t('editor.keys.inOut'),
      ],
      [
        <>
          <kbd>{shift}</kbd>+<kbd>{space}</kbd>
        </>,
        t('editor.keys.playSelection'),
      ],
    );
  }
  if (mark) rows.push([<kbd key="m">M</kbd>, mark]);
  rows.push(
    [
      <>
        <kbd>Home</kbd> <kbd>End</kbd>
      </>,
      t('editor.keys.ends'),
    ],
    [<kbd key="save">{mac ? '⌘S' : 'Ctrl+S'}</kbd>, t('editor.keys.save')],
    [<kbd key="esc">Esc</kbd>, t('editor.keys.close')],
  );
  return (
    <details className="editor-keys">
      <summary>
        <Icon name="keyboard" size={16} />
        {t('editor.keys.title')}
      </summary>
      <dl>
        {rows.map(([keys, text], i) => (
          <Fragment key={i}>
            <dt dir="ltr">{keys}</dt>
            <dd>{text}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

export function EditorShell({
  tool,
  core,
  request,
  runPaths,
  selection,
  mark,
  stage,
  timeline,
  onClose,
  onStarted,
  children,
}: ShellProps) {
  const { t } = useTranslation();
  const { player, duration, lang } = core;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const mac = isMac();

  // The panel keeps one close callback for its life, so its focus handling runs once.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });
  const { pause } = player;
  const closePanel = useCallback(() => {
    pause();
    latestClose.current();
  }, [pause]);

  const run = async () => {
    if (!request || busy) return;
    player.pause();
    setBusy(true);
    setError(null);
    try {
      const ids = await api.runMediaTool(request, runPaths ?? [core.path]);
      onStarted(ids);
      latestClose.current();
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const action = editorKey(event, mac, core.fine);
    if (!action || !allowed(action, keyScope(event.target))) return;
    event.preventDefault();
    switch (action.type) {
      case 'toggle':
        return player.toggle();
      case 'step':
        return player.step(action.seconds);
      case 'in':
        return selection?.set(setStart(selection.span, player.time, duration));
      case 'out':
        return selection?.set(setEnd(selection.span, player.time, duration));
      case 'play-selection':
        return selection ? player.playSpan(selection.span) : player.toggle();
      case 'marker':
        return mark?.run();
      case 'start':
        return player.seek(0);
      case 'end':
        return player.seek(duration);
      case 'save':
        return void run();
      case 'close':
        return closePanel();
    }
  });

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The panel focuses its first control; the editor starts on Play instead.
  useEffect(() => {
    const frame = requestAnimationFrame(() => playButton.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const withKey = (label: string, key: string) => t('editor.withKey', { label, key });
  const status = core.media.error
    ? null
    : core.media.preparing
      ? t('editor.preparing')
      : core.media.preview?.proxy
        ? t('editor.proxy')
        : null;
  const space = t('editor.key.space');

  return (
    <Dialog
      wide
      title={t(`tool.${tool}`)}
      onClose={closePanel}
      footer={
        <>
          <button type="button" className="button quiet" onClick={closePanel}>
            {t('tools.cancel')}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!request || busy}
            aria-keyshortcuts={mac ? 'Meta+S' : 'Control+S'}
            title={withKey(t('editor.save'), mac ? '⌘S' : 'Ctrl+S')}
            onClick={() => void run()}
          >
            {t('editor.save')}
          </button>
        </>
      }
    >
      <div className="editor" data-audio={core.audio ? '' : undefined}>
        <div className="editor-main">
          <p className="editor-meta">
            <bdi className="file-name editor-file">{core.name}</bdi>
            {core.info && <Meta info={core.info} lang={lang} />}
            {status && (
              <span className="editor-status" data-proxy={core.media.preview?.proxy ? '' : undefined}>
                {status}
              </span>
            )}
          </p>
          <span className="visually-hidden" role="status">
            {status}
          </span>
          {stage}
          {core.audio && <AudioSink core={core} />}
          <div className="editor-deck">
            {/* Play sits over the start of the timeline in every language, like the timeline itself. */}
            <div className="editor-transport" dir="ltr">
              <button
                ref={playButton}
                type="button"
                className="transport-button"
                aria-label={player.playing ? t('editor.pause') : t('editor.play')}
                title={withKey(player.playing ? t('editor.pause') : t('editor.play'), space)}
                aria-keyshortcuts="Space"
                onClick={player.toggle}
              >
                <Icon name={player.playing ? 'pause' : 'play'} size={18} />
              </button>
              {selection && (
                <button
                  type="button"
                  className="transport-button"
                  aria-label={t('editor.playSelection')}
                  title={withKey(t('editor.playSelection'), `Shift+${space}`)}
                  aria-keyshortcuts="Shift+Space"
                  onClick={() => player.playSpan(selection.span)}
                >
                  <Icon name="play-span" size={18} />
                </button>
              )}
              <span className="editor-clock">
                {t('editor.clock', { time: formatTime(player.time, lang), duration: formatTime(duration, lang) })}
              </span>
              <span className="transport-tools">
                {selection && (
                  <>
                    <button
                      type="button"
                      className="button small"
                      title={withKey(t('editor.setIn'), 'I')}
                      aria-keyshortcuts="I"
                      onClick={() => selection.set(setStart(selection.span, player.time, duration))}
                    >
                      <Icon name="mark-in" size={16} />
                      {t('editor.setIn')}
                    </button>
                    <button
                      type="button"
                      className="button small"
                      title={withKey(t('editor.setOut'), 'O')}
                      aria-keyshortcuts="O"
                      onClick={() => selection.set(setEnd(selection.span, player.time, duration))}
                    >
                      <Icon name="mark-out" size={16} />
                      {t('editor.setOut')}
                    </button>
                  </>
                )}
                {mark && (
                  <button
                    type="button"
                    className="button small"
                    title={withKey(mark.label, 'M')}
                    aria-keyshortcuts="M"
                    onClick={mark.run}
                  >
                    <Icon name="marker" size={16} />
                    {mark.label}
                  </button>
                )}
              </span>
            </div>
            <Timeline
              duration={duration}
              time={player.time}
              fine={core.fine}
              onSeek={player.seek}
              selection={selection?.span ?? null}
              onSelection={selection?.set}
              peaks={core.audio ? (core.media.peaks ?? []) : null}
              {...timeline}
            />
            {selection && (
              <p className="editor-selection muted">
                {t('editor.selection', {
                  start: formatTime(selection.span.start, lang),
                  end: formatTime(selection.span.end, lang),
                  length: formatTime(spanLength(selection.span), lang),
                })}
              </p>
            )}
          </div>
        </div>
        <div className="editor-side">
          {children}
          {core.media.error && <p className="error-text">{core.media.error}</p>}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <KeysHelp audio={core.audio} selection={Boolean(selection)} mark={mark?.label ?? null} />
        </div>
      </div>
    </Dialog>
  );
}
