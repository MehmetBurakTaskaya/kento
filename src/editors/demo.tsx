// SPDX-License-Identifier: MIT
// Browser previews and screenshots of the editors with the in-memory stand-in (no Tauri): in a page
// served by Vite, import('/src/editors/demo.tsx').then((demo) => demo.mountEditorDemo('crop-video')).
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MediaEditor, type MediaPanel } from '.';

const VIDEO = 'C:\\Users\\me\\Videos\\Kapadokya balonları.mp4';
const AUDIO = 'C:\\Users\\me\\Music\\Röportaj 2026.mp3';
const CLIPS = [VIDEO, 'C:\\Users\\me\\Videos\\Göreme gün batımı.mov', 'C:\\Users\\me\\Videos\\Uçhisar.mkv'];
const AUDIO_TOOLS: MediaPanel[] = ['normalize', 'trim-audio', 'channels', 'redact-audio', 'audio-to-video'];

let root: Root | null = null;

export function mountEditorDemo(tool: MediaPanel): void {
  let host = document.getElementById('editor-demo');
  if (!host) {
    host = document.createElement('div');
    host.id = 'editor-demo';
    document.body.append(host);
  }
  root?.unmount();
  const current = createRoot(host);
  root = current;
  const paths = tool === 'merge-video' ? CLIPS : AUDIO_TOOLS.includes(tool) ? [AUDIO] : [VIDEO];
  current.render(
    <StrictMode>
      <MediaEditor tool={tool} paths={paths} onClose={() => current.unmount()} onStarted={() => {}} />
    </StrictMode>,
  );
}
