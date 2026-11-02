// SPDX-License-Identifier: MIT
// The frame every image editor shares, in the media editors' layout: the file's details and the
// picture, the tool's controls beside them, and "Save as a new file" (Ctrl+S / ⌘S). Esc closes
// through the dialog, unless the tool takes it first (Mark up ends its text with it).
import { Fragment, useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { api, type ImageTool } from '../../ipc';
import { keyScope } from '../keys';
import type { EditorProps } from '../panels';
import { formatNumber } from '../time';
import { fileName } from '../useEditor';
import type { ImagePanel } from '.';
import { imageAllowed, imageKey, type ImageAction } from './keys';

export type KeyRow = [ReactNode, string];

export interface ImageShellProps extends EditorProps {
  tool: ImagePanel;
  /** What the meta line says after the file name (the size), or for a collage instead of it. */
  meta: string | null;
  /** The request "Save as a new file" sends; null while there is nothing to save. */
  request: ImageTool | null;
  /** The pictures the tool runs on, when they differ from `paths` (the collage's order). */
  runPaths?: string[];
  stage: ReactNode;
  /** The tool's own keys; true when it handled the action. */
  onAction?(action: ImageAction): boolean;
  /** Esc, before the dialog closes; true when the tool used it. */
  onEscape?(): boolean;
  /** Enter on the picture saves (Crop image). */
  enterSaves?: boolean;
  /** The tool's rows in the keyboard help. */
  keys?: KeyRow[];
  /** A problem reading the picture. */
  problem?: string | null;
  children: ReactNode;
}

const isMac = () => document.documentElement.dataset.platform === 'macos';

/** The picture and what is drawn on it are not controls, so Enter and the arrows are theirs. */
const onPicture = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.image-stage'));

/**
 * "4032 × 3024" in the language's digits, isolated left to right, so the width stays first in a
 * right-to-left sentence too.
 */
export const sizeText = (width: number, height: number, lang: string) =>
  `\u2066${formatNumber(width, lang)} × ${formatNumber(height, lang)}\u2069`;

function KeysHelp({ rows }: { rows: KeyRow[] }) {
  const { t } = useTranslation();
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

export function ImageShell({
  tool,
  paths,
  meta,
  request,
  runPaths,
  stage,
  onAction,
  onEscape,
  enterSaves = false,
  keys = [],
  problem,
  onClose,
  onStarted,
  children,
}: ImageShellProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mac = isMac();

  // The dialog keeps one close callback for its life, so its focus handling runs once.
  const latestClose = useRef(onClose);
  const latestEscape = useRef(onEscape);
  useEffect(() => {
    latestClose.current = onClose;
    latestEscape.current = onEscape;
  });
  const closePanel = useCallback(() => {
    if (latestEscape.current?.()) return;
    latestClose.current();
  }, []);

  const run = async () => {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ids = await api.runImageTool(request, runPaths ?? paths);
      onStarted(ids);
      latestClose.current();
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const action = imageKey(event, mac);
    if (!action || action.type === 'zoom') return;
    if (!imageAllowed(action, keyScope(event.target), onPicture(event.target))) return;
    if (action.type === 'save' || (action.type === 'enter' && enterSaves)) {
      event.preventDefault();
      void run();
      return;
    }
    if (onAction?.(action)) event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const save = mac ? '⌘S' : 'Ctrl+S';
  const rows: KeyRow[] = [
    ...keys,
    [<kbd key="save">{save}</kbd>, t('editor.keys.save')],
    [<kbd key="esc">Esc</kbd>, t('editor.keys.close')],
  ];

  return (
    <Dialog
      wide
      title={t(`tool.${tool}`)}
      onClose={closePanel}
      footer={
        <>
          <button type="button" className="button quiet" onClick={() => latestClose.current()}>
            {t('tools.cancel')}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!request || busy}
            aria-keyshortcuts={mac ? 'Meta+S' : 'Control+S'}
            title={t('editor.withKey', { label: t('editor.save'), key: save })}
            onClick={() => void run()}
          >
            {t('editor.save')}
          </button>
        </>
      }
    >
      <div className="editor image-editor" data-tool={tool}>
        <div className="editor-main">
          <p className="editor-meta">
            {paths.length === 1 && <bdi className="file-name editor-file">{fileName(paths[0]!)}</bdi>}
            {meta && <span className="muted">{meta}</span>}
          </p>
          {stage}
        </div>
        <div className="editor-side">
          {children}
          {problem && <p className="error-text">{problem}</p>}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <KeysHelp rows={rows} />
        </div>
      </div>
    </Dialog>
  );
}

/** Keyboard help rows several tools share. */
export function useKeyRows() {
  const { t } = useTranslation();
  const mac = isMac();
  const shift = t(mac ? 'key.shift.mac' : 'key.shift.windows');
  const command = mac ? '⌘' : 'Ctrl+';
  const arrows = (
    <>
      <kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd>
    </>
  );
  return {
    arrows: [arrows, t('image.keys.nudge')] as KeyRow,
    fine: [
      <>
        <kbd>{shift}</kbd>+<kbd>←</kbd> <kbd>→</kbd>
      </>,
      t('image.keys.fine'),
    ] as KeyRow,
    remove: [<kbd key="delete">Delete</kbd>, t('image.keys.remove')] as KeyRow,
    zoom: [
      <>
        <kbd>{command}+</kbd> <kbd>{command}-</kbd> <kbd>{command}0</kbd>
      </>,
      t('image.keys.zoom'),
    ] as KeyRow,
    shift,
    command,
  };
}
