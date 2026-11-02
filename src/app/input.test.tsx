// SPDX-License-Identifier: MIT
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, type Dropped } from '../ipc';
import { useApp } from '../state/store';
import { drop, paste, useFileInput } from './input';

const LINK = 'https://www.youtube.com/watch?v=abc';

function Host() {
  useFileInput(false);
  return <p>Home</p>;
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  useApp.setState({ web: null, wheel: null, panel: null, files: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('paste on Home', () => {
  it('opens the download dialog for a link', async () => {
    vi.spyOn(api, 'pasteFiles').mockResolvedValue([]);
    const text = vi.spyOn(api, 'importText');
    await paste(`  ${LINK} \n`, null);
    expect(useApp.getState().web).toEqual({ url: LINK });
    expect(text).not.toHaveBeenCalled();
  });

  it('keeps text that is not one link as a text file', async () => {
    vi.spyOn(api, 'pasteFiles').mockResolvedValue([]);
    const text = vi.spyOn(api, 'importText');
    await paste(`watch this: ${LINK}`, null);
    expect(useApp.getState().web).toBeNull();
    expect(text).toHaveBeenCalledWith(`watch this: ${LINK}`);
  });

  it('takes copied files before any text', async () => {
    vi.spyOn(api, 'pasteFiles').mockResolvedValue(['C:\\Users\\me\\Rapor.pdf']);
    await paste(LINK, null);
    expect(useApp.getState().web).toBeNull();
    expect(useApp.getState().files.map((file) => file.name)).toEqual(['Rapor.pdf']);
  });

  it('reads a Ctrl+V outside text fields, and leaves an open dialog alone', async () => {
    vi.spyOn(api, 'pasteFiles').mockResolvedValue([]);
    render(<Host />);
    const event = (text: string) => {
      const pasted = new Event('paste', { bubbles: true, cancelable: true });
      Object.assign(pasted, { clipboardData: { getData: () => text, items: [] } });
      return pasted;
    };
    await act(async () => {
      fireEvent(document.body, event(LINK));
    });
    expect(useApp.getState().web).toEqual({ url: LINK });
    await act(async () => {
      fireEvent(document.body, event('https://example.org/other'));
    });
    expect(useApp.getState().web).toEqual({ url: LINK });
  });
});

describe('drop on Home', () => {
  it('opens the download dialog for a link and adds dropped files', async () => {
    drop({ paths: [], link: LINK });
    expect(useApp.getState().web).toEqual({ url: LINK });
    useApp.setState({ web: null });
    const add = vi.spyOn(useApp.getState(), 'addFiles');
    drop({ paths: ['C:\\Users\\me\\Kapadokya 🎈.heic'], link: null });
    expect(add).toHaveBeenCalledWith(['C:\\Users\\me\\Kapadokya 🎈.heic']);
    expect(useApp.getState().web).toBeNull();
  });

  it('reaches the dialog from the window’s drop events', async () => {
    let handler: ((dropped: Dropped) => void) | undefined;
    vi.spyOn(api, 'onDrop').mockImplementation(async (handle) => {
      handler = handle;
      return () => {};
    });
    render(<Host />);
    await act(async () => {});
    act(() => handler?.({ paths: [], link: 'https://www.instagram.com/p/xyz/' }));
    expect(useApp.getState().web).toEqual({ url: 'https://www.instagram.com/p/xyz/' });
  });
});
