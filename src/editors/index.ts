// SPDX-License-Identifier: MIT
// Placeholder until the media editors land.
import type { JSX } from 'react';

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
  | 'audio-to-video';

export function MediaEditor(props: {
  tool: MediaPanel;
  paths: string[];
  onClose(): void;
  onStarted(ids: number[]): void;
}): JSX.Element | null {
  void props;
  return null;
}
