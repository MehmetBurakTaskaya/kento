// SPDX-License-Identifier: MIT
// One image editor at a time: the picture (or a live preview of the tool) and the tool's controls.
import type { JSX } from 'react';
import type { EditorProps } from '../panels';
import type { ImagePanel } from '.';
import { Collage } from './tools/Collage';
import { CropImage } from './tools/CropImage';
import { EditImage } from './tools/EditImage';
import { Frame } from './tools/Frame';
import { Markup } from './tools/Markup';
import { RedactImage } from './tools/RedactImage';

export function ImageEditor({ tool, ...props }: EditorProps & { tool: ImagePanel }): JSX.Element {
  switch (tool) {
    case 'edit-image':
      return <EditImage {...props} />;
    case 'crop-image':
      return <CropImage {...props} />;
    case 'markup':
      return <Markup {...props} />;
    case 'frame':
      return <Frame {...props} />;
    case 'collage':
      return <Collage {...props} />;
    case 'redact-image':
      return <RedactImage {...props} />;
  }
}
