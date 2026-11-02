// SPDX-License-Identifier: MIT
// One editor per media tool (SPEC 5.5, 5.6), each a large panel that ends in "Save as a new file".
import type { JSX } from 'react';
import type { EditorProps, MediaPanel } from './panels';
import { AudioToVideo } from './tools/AudioToVideo';
import { Channels } from './tools/Channels';
import { Crop } from './tools/Crop';
import { Frames } from './tools/Frames';
import { Merge } from './tools/Merge';
import { Normalize } from './tools/Normalize';
import { RedactAudio } from './tools/RedactAudio';
import { RedactVideo } from './tools/RedactVideo';
import { Speed } from './tools/Speed';
import { Split } from './tools/Split';
import { Trim } from './tools/Trim';

export function MediaEditor({ tool, ...props }: EditorProps & { tool: MediaPanel }): JSX.Element {
  switch (tool) {
    case 'trim-video':
    case 'trim-audio':
      return <Trim tool={tool} {...props} />;
    case 'crop-video':
      return <Crop {...props} />;
    case 'speed':
      return <Speed {...props} />;
    case 'merge-video':
      return <Merge {...props} />;
    case 'frames':
      return <Frames {...props} />;
    case 'split-video':
      return <Split {...props} />;
    case 'redact-video':
      return <RedactVideo {...props} />;
    case 'normalize':
      return <Normalize {...props} />;
    case 'channels':
      return <Channels {...props} />;
    case 'redact-audio':
      return <RedactAudio {...props} />;
    case 'audio-to-video':
      return <AudioToVideo {...props} />;
  }
}
