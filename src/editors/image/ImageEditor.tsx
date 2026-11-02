// SPDX-License-Identifier: MIT
// One image editor at a time: the picture (or a live preview of the tool) and the tool's controls.
import type { EditorProps } from '../panels';
import type { ImagePanel } from '.';

export function ImageEditor({ tool, paths, onClose, onStarted }: EditorProps & { tool: ImagePanel }) {
  void tool;
  void paths;
  void onClose;
  void onStarted;
  return null;
}
