// SPDX-License-Identifier: MIT
// Remove noise: less hiss and background noise.
import { isAudio } from '../media';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function Denoise(props: EditorProps) {
  const path = props.paths[0] ?? '';
  const core = useEditor(path, isAudio(path));
  return (
    <EditorShell tool="denoise" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
