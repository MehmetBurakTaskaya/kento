// SPDX-License-Identifier: MIT
// A file's picture in lists: a small preview for images and PDFs, otherwise the icon of its kind.
import { useEffect, useState } from 'react';
import { api, type Category } from '../ipc';
import { Icon, type IconName } from './Icon';

const KIND_ICON: Record<Category, IconName> = {
  image: 'image',
  video: 'video',
  audio: 'music',
  document: 'doc',
  spreadsheet: 'table',
  presentation: 'slides',
  subtitle: 'captions',
  pdf: 'pdf',
  archive: 'zip',
};

export function kindIcon(category: Category | null, folder = false): IconName {
  if (folder) return 'folder';
  return category ? KIND_ICON[category] : 'file';
}

// Previews are made once per path and size while the page lives.
const cache = new Map<string, Promise<string | null>>();

function preview(path: string, size: number): Promise<string | null> {
  const key = `${size}:${path}`;
  let url = cache.get(key);
  if (!url) {
    url = api
      .thumbnail(path, size)
      .then((blob) => (blob ? URL.createObjectURL(blob) : null))
      .catch(() => null);
    cache.set(key, url);
  }
  return url;
}

export function FileIcon({
  path,
  category,
  folder = false,
  size = 40,
}: {
  path: string;
  category: Category | null;
  folder?: boolean;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const previewable = !folder && (category === 'image' || category === 'pdf');
  useEffect(() => {
    if (!previewable) return;
    let live = true;
    void preview(path, size * 2).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [path, size, previewable]);
  return (
    <span className="file-icon" style={{ inlineSize: size, blockSize: size }} aria-hidden="true">
      {src ? <img src={src} alt="" /> : <Icon name={kindIcon(category, folder)} size={Math.round(size * 0.55)} />}
    </span>
  );
}
