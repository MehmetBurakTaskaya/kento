// SPDX-License-Identifier: MIT
// What an image editor knows about its picture: its upright size, and previews drawn by the engine
// (the picture itself, or the tool applied to it). While sliders move, a preview is asked for only
// after a short pause; an answer that arrives after a newer request is dropped, and every object
// URL is revoked once a newer picture replaces it.
import { useEffect, useRef, useState } from 'react';
import { api, type ImageInfo, type ImageTool } from '../../ipc';

/** The pause after the last change before a new preview is asked for. */
export const PREVIEW_DELAY = 130;

export interface PictureInfo {
  info: ImageInfo | null;
  error: string | null;
  reading: boolean;
}

export function useImageInfo(path: string): PictureInfo {
  const [loaded, setLoaded] = useState<{ path: string; info: ImageInfo | null; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    api
      .imageInfo(path)
      .then((info) => live && setLoaded({ path, info, error: null }))
      .catch((reason) => live && setLoaded({ path, info: null, error: String(reason) }));
    return () => {
      live = false;
    };
  }, [path]);
  const mine = loaded?.path === path ? loaded : null;
  return { info: mine?.info ?? null, error: mine?.error ?? null, reading: !mine };
}

export interface Preview {
  /** The newest picture that arrived; it stays while the next one is made. */
  url: string | null;
  /** The picture shows the current choices. */
  fresh: boolean;
  loading: boolean;
  error: string | null;
}

export function usePreview(paths: string[], tool: ImageTool | null, size: number, enabled = true): Preview {
  // One string for everything a preview depends on, so equal choices never ask twice.
  const key = enabled && paths.length ? JSON.stringify([paths, tool, size]) : '';
  const [shown, setShown] = useState<{ key: string; url: string | null } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const answered = useRef(false);

  useEffect(() => {
    if (!key) return;
    let live = true;
    const [list, request, side] = JSON.parse(key) as [string[], ImageTool | null, number];
    // The first picture comes at once; later ones wait until the choices rest.
    const timer = window.setTimeout(
      () => {
        api
          .imagePreview(list, request, side)
          .then((blob) => {
            if (!live) return;
            answered.current = true;
            setShown({ key, url: blob ? URL.createObjectURL(blob) : null });
          })
          .catch((reason) => {
            if (live) setFailed({ key, message: String(reason) });
          });
      },
      answered.current ? PREVIEW_DELAY : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [key]);

  const url = shown?.url ?? null;
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const current = Boolean(key) && shown?.key === key;
  const error = key && failed?.key === key ? failed.message : null;
  return { url, fresh: current && url !== null, loading: Boolean(key) && !current && !error, error };
}
