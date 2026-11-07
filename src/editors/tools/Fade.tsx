// SPDX-License-Identifier: MIT
// Fade and volume: fades in and out, and the level.
import { isAudio } from '../media';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function Fade(props: EditorProps) {
  const path = props.paths[0] ?? '';
  const core = useEditor(path, isAudio(path));
  return (
    <EditorShell tool="fade" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
