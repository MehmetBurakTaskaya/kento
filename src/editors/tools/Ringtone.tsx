// SPDX-License-Identifier: MIT
// Make a ringtone: a part of the sound as M4R or MP3.
import { isAudio } from '../media';
import { EditorShell } from '../EditorShell';
import type { EditorProps } from '../panels';
import { useEditor } from '../useEditor';

export function Ringtone(props: EditorProps) {
  const path = props.paths[0] ?? '';
  const core = useEditor(path, isAudio(path));
  return (
    <EditorShell tool="ringtone" core={core} request={null} {...props}>
      {null}
    </EditorShell>
  );
}
