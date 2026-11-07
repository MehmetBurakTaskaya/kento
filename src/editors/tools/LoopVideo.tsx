// SPDX-License-Identifier: MIT
// Reverse and loop: backwards, a boomerang or repeated.
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function LoopVideo(props: EditorProps) {
  const core = useEditor(props.paths[0] ?? '', false);
  return (
    <EditorShell tool="loop-video" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
