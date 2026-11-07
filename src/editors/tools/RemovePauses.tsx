// SPDX-License-Identifier: MIT
// Remove pauses: the quiet gaps found and taken out.
import { isAudio } from '../media';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function RemovePauses(props: EditorProps) {
  const path = props.paths[0] ?? '';
  const core = useEditor(path, isAudio(path));
  return (
    <EditorShell tool="remove-pauses" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
