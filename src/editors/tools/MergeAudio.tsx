// SPDX-License-Identifier: MIT
// Merge audio: audio files one after another.
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function MergeAudio(props: EditorProps) {
  const core = useEditor(props.paths[0] ?? '', true);
  return (
    <EditorShell tool="merge-audio" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
