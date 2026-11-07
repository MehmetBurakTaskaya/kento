// SPDX-License-Identifier: MIT
// Make vertical: a 9:16 video for short-video apps.
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function MakeVertical(props: EditorProps) {
  const core = useEditor(props.paths[0] ?? '', false);
  return (
    <EditorShell tool="make-vertical" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
