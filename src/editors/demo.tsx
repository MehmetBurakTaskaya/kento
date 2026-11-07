// SPDX-License-Identifier: MIT
// Browser previews and screenshots of the editors with the in-memory stand-in (no Tauri): in a page
// served by Vite, import('/src/editors/demo.tsx').then((demo) => demo.mountEditorDemo('crop-video')).
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MediaEditor, type MediaPanel } from '.';

const VIDEO = 'C:\\Users\\me\\Videos\\Kapadokya balonları.mp4';
const AUDIO = 'C:\\Users\\me\\Music\\Röportaj 2026.mp3';
const CLIPS = [VIDEO, 'C:\\Users\\me\\Videos\\Göreme gün batımı.mov', 'C:\\Users\\me\\Videos\\Uçhisar.mkv'];
const SONGS = [AUDIO, 'C:\\Users\\me\\Music\\Gün doğumu 🌅.flac', 'C:\\Users\\me\\Music\\Kapanış.ogg'];
const AUDIO_TOOLS: MediaPanel[] = [
  'normalize',
  'trim-audio',
  'channels',
  'redact-audio',
  'audio-to-video',
  'remove-pauses',
  'ringtone',
];

let root: Root | null = null;

/** `paths` overrides the sample files (a video for a tool that takes audio by default, say). */
export function mountEditorDemo(tool: MediaPanel, paths?: string[]): void {
  let host = document.getElementById('editor-demo');
  if (!host) {
    host = document.createElement('div');
    host.id = 'editor-demo';
    document.body.append(host);
  }
  root?.unmount();
  const current = createRoot(host);
  root = current;
  const files =
    paths ??
    (tool === 'merge-video'
      ? CLIPS
      : tool === 'merge-audio'
        ? SONGS
        : tool === 'add-music'
          ? [VIDEO, AUDIO]
          : AUDIO_TOOLS.includes(tool)
            ? [AUDIO]
            : [VIDEO]);
  current.render(
    <StrictMode>
      <MediaEditor tool={tool} paths={files} onClose={() => current.unmount()} onStarted={() => {}} />
    </StrictMode>,
  );
}
