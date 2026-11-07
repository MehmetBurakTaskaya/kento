// SPDX-License-Identifier: MIT
// Cut out parts: spans taken out of a video or an audio file, the rest joined.
import { isAudio } from '../media';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function CutOut(props: EditorProps) {
  const path = props.paths[0] ?? '';
  const core = useEditor(path, isAudio(path));
  return (
    <EditorShell tool="cut-out" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
