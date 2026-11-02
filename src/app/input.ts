// SPDX-License-Identifier: MIT
// The ways files come into the main window (SPEC 5.2): dropping, Ctrl+O and Ctrl+V. Pasting reads
// the clipboard only at that moment: files as they are, text as a .txt, an image as a .png, and a
// link opens the web download (SPEC 5.10), as a link dropped on the window does.
import { useEffect } from 'react';
import i18n from '../i18n';
import { isolate } from '../i18n/format';
import { api, type Dropped } from '../ipc';
import { useApp } from '../state/store';
import { isLink } from '../web/links';

export async function chooseFiles() {
  try {
    const paths = await api.pickFiles();
    if (paths.length) await useApp.getState().addFiles(paths);
  } catch (error) {
    void api.log('warn', `choosing files failed: ${String(error)}`);
  }
}

function editable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  );
}

export async function paste(text: string, image: File | null) {
  const store = useApp.getState();
  const files = await api.pasteFiles();
  if (files.length) {
    await store.addFiles(files);
    return;
  }
  if (image) {
    const entry = await api.importImage(new Uint8Array(await image.arrayBuffer()));
    store.addEntries([entry]);
    store.toast({ kind: 'info', message: i18n.t('paste.saved', { name: isolate(entry.name) }) });
    return;
  }
  const trimmed = text.trim();
  if (isLink(trimmed)) {
    store.openWeb(trimmed);
    return;
  }
  if (trimmed) {
    const entry = await api.importText(text);
    store.addEntries([entry]);
    store.toast({ kind: 'info', message: i18n.t('paste.saved', { name: isolate(entry.name) }) });
  }
}

/** What a drop on the window brings in: a link opens the download dialog, files join Home. */
export function drop({ paths, link }: Dropped) {
  const store = useApp.getState();
  if (link) store.openWeb(link);
  else if (paths.length) void store.addFiles(paths);
}

/** Drop, paste and Ctrl+O for the whole window. */
export function useFileInput(mac: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    const dropped = api.onDrop(
      (what) => {
        root.removeAttribute('data-dragging');
        drop(what);
      },
      (over) => root.toggleAttribute('data-dragging', over),
    );
    const onPaste = (event: ClipboardEvent) => {
      const { wheel, panel, web } = useApp.getState();
      if (editable(event.target) || wheel || panel || web) return;
      // The clipboard data is only readable during the event.
      const data = event.clipboardData;
      const text = data?.getData('text/plain') ?? '';
      const item = [...(data?.items ?? [])].find((entry) => entry.kind === 'file' && entry.type.startsWith('image/'));
      const image = item?.getAsFile() ?? null;
      event.preventDefault();
      paste(text, image).catch((error) => void api.log('warn', `paste failed: ${String(error)}`));
    };
    const onKey = (event: KeyboardEvent) => {
      const command = mac ? event.metaKey : event.ctrlKey;
      if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void chooseFiles();
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      void dropped.then((stop) => stop());
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, [mac]);
}
