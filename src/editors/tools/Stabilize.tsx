// SPDX-License-Identifier: MIT
// Stabilize video: a steadier picture.
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function Stabilize(props: EditorProps) {
  const core = useEditor(props.paths[0] ?? '', false);
  return (
    <EditorShell tool="stabilize" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
