// SPDX-License-Identifier: MIT
// Adjust color: a ready-made look and the sliders.
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function ColorVideo(props: EditorProps) {
  const core = useEditor(props.paths[0] ?? '', false);
  return (
    <EditorShell tool="color-video" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
