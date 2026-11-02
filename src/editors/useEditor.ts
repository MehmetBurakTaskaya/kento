// SPDX-License-Identifier: MIT
// The parts every editor shares: the file, what is known about it and its player.
import { useTranslation } from 'react-i18next';
import type { MediaInfo } from '../ipc';
import { useMedia, type MediaState } from './useMedia';
import { usePlayer, type Player } from './usePlayer';
import { fineStep } from './time';

export interface EditorCore {
  path: string;
  name: string;
  /** An audio editor: a waveform instead of the picture, 0.1 s fine steps. */
  audio: boolean;
  media: MediaState;
  info: MediaInfo | null;
  duration: number;
  /** One frame, or 0.1 s for audio. */
  fine: number;
  lang: string;
  player: Player;
}

export const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

export function useEditor(path: string, audio: boolean): EditorCore {
  const { i18n } = useTranslation();
  const media = useMedia(path, audio);
  const duration = media.info?.duration ?? 0;
  const player = usePlayer(duration, media.preview?.url ?? '');
  return {
    path,
    name: fileName(path),
    audio,
    media,
    info: media.info,
    duration,
    fine: fineStep(media.info, audio),
    lang: i18n.language,
    player,
  };
}
