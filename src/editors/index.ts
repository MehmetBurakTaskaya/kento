// SPDX-License-Identifier: MIT
// The media editors (SPEC 5.5, 5.6): <MediaEditor tool paths onClose onStarted />, and the image
// editors: <ImageEditor tool paths onClose onStarted />.
import '../styles/editors.css';
import '../styles/editors-merge.css';
import '../styles/editors-picture.css';
import '../styles/editors-sound.css';

export { MediaEditor } from './MediaEditor';
export { isMediaPanel, MEDIA_PANELS, type EditorProps, type MediaPanel } from './panels';
export { ImageEditor, IMAGE_PANELS, isImagePanel, type ImagePanel } from './image';
