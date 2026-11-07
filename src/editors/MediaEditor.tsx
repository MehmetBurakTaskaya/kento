// SPDX-License-Identifier: MIT
// One editor per media tool (SPEC 5.5, 5.6), each a large panel that ends in "Save as a new file".
import type { JSX } from 'react';
import type { EditorProps, MediaPanel } from './panels';
import { AddMusic } from './tools/AddMusic';
import { AddOverlay } from './tools/AddOverlay';
import { AudioToVideo } from './tools/AudioToVideo';
import { Channels } from './tools/Channels';
import { ColorVideo } from './tools/ColorVideo';
import { Crop } from './tools/Crop';
import { CutOut } from './tools/CutOut';
import { Denoise } from './tools/Denoise';
import { Fade } from './tools/Fade';
import { Frames } from './tools/Frames';
import { LoopVideo } from './tools/LoopVideo';
import { MakeVertical } from './tools/MakeVertical';
import { Merge } from './tools/Merge';
import { MergeAudio } from './tools/MergeAudio';
import { Normalize } from './tools/Normalize';
import { RedactAudio } from './tools/RedactAudio';
import { RedactVideo } from './tools/RedactVideo';
import { RemovePauses } from './tools/RemovePauses';
import { Ringtone } from './tools/Ringtone';
import { RotateVideo } from './tools/RotateVideo';
import { Speed } from './tools/Speed';
import { Split } from './tools/Split';
import { Stabilize } from './tools/Stabilize';
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
    case 'make-vertical':
      return <MakeVertical {...props} />;
    case 'cut-out':
      return <CutOut {...props} />;
    case 'remove-pauses':
      return <RemovePauses {...props} />;
    case 'add-music':
      return <AddMusic {...props} />;
    case 'add-overlay':
      return <AddOverlay {...props} />;
    case 'fade':
      return <Fade {...props} />;
    case 'denoise':
      return <Denoise {...props} />;
    case 'rotate-video':
      return <RotateVideo {...props} />;
    case 'loop-video':
      return <LoopVideo {...props} />;
    case 'color-video':
      return <ColorVideo {...props} />;
    case 'merge-audio':
      return <MergeAudio {...props} />;
    case 'ringtone':
      return <Ringtone {...props} />;
    case 'stabilize':
      return <Stabilize {...props} />;
  }
}
