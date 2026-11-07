// SPDX-License-Identifier: MIT
// The media tools that open an editor before they run (SPEC 5.5). Remove audio runs without one.

export type MediaPanel =
  | 'trim-video'
  | 'crop-video'
  | 'speed'
  | 'merge-video'
  | 'frames'
  | 'split-video'
  | 'redact-video'
  | 'normalize'
  | 'trim-audio'
  | 'channels'
  | 'redact-audio'
  | 'audio-to-video'
  | 'make-vertical'
  | 'cut-out'
  | 'remove-pauses'
  | 'add-music'
  | 'add-overlay'
  | 'fade'
  | 'denoise'
  | 'rotate-video'
  | 'loop-video'
  | 'color-video'
  | 'merge-audio'
  | 'ringtone'
  | 'stabilize';

export const MEDIA_PANELS: readonly MediaPanel[] = [
  'trim-video',
  'crop-video',
  'speed',
  'merge-video',
  'frames',
  'split-video',
  'redact-video',
  'normalize',
  'trim-audio',
  'channels',
  'redact-audio',
  'audio-to-video',
  'make-vertical',
  'cut-out',
  'remove-pauses',
  'add-music',
  'add-overlay',
  'fade',
  'denoise',
  'rotate-video',
  'loop-video',
  'color-video',
  'merge-audio',
  'ringtone',
  'stabilize',
];

export const isMediaPanel = (id: string): id is MediaPanel => (MEDIA_PANELS as readonly string[]).includes(id);

export interface EditorProps {
  /** One file, or the clips of Merge videos in their first order. */
  paths: string[];
  onClose(): void;
  /** The jobs the editor started, so their end shows a card. */
  onStarted(ids: number[]): void;
}
