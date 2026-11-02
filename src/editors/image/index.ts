// SPDX-License-Identifier: MIT
// The image editors (SPEC 5.5): Edit image, Crop image, Mark up, Add frame, Make a collage and
// Redact image, each with a live preview drawn by the same engine code as the result.
export { ImageEditor } from './ImageEditor';

export type ImagePanel = 'edit-image' | 'crop-image' | 'markup' | 'frame' | 'collage' | 'redact-image';

export const IMAGE_PANELS: readonly ImagePanel[] = [
  'edit-image',
  'crop-image',
  'markup',
  'frame',
  'collage',
  'redact-image',
];

export const isImagePanel = (id: string): id is ImagePanel => (IMAGE_PANELS as readonly string[]).includes(id);
