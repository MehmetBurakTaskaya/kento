// SPDX-License-Identifier: MIT
// Add music: a piece of music mixed into a video or replacing its sound.
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function AddMusic(props: EditorProps) {
  const core = useEditor(props.paths[0] ?? '', false);
  return (
    <EditorShell tool="add-music" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
