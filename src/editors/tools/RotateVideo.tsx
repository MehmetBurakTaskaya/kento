// SPDX-License-Identifier: MIT
// Rotate video: quarter and half turns, mirrored or flipped.
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function RotateVideo(props: EditorProps) {
  const core = useEditor(props.paths[0] ?? '', false);
  return (
    <EditorShell tool="rotate-video" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
