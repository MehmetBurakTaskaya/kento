// SPDX-License-Identifier: MIT
// Add text or logo: text and pictures laid over a video.
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function AddOverlay(props: EditorProps) {
  const core = useEditor(props.paths[0] ?? '', false);
  return (
    <EditorShell tool="add-overlay" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
