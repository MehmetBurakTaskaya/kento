// SPDX-License-Identifier: MIT
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadSlices, NEEDS_SETUP } from '../app/slices';
import i18n, { initI18n } from '../i18n';
import { api, DEFAULT_SETTINGS, type DragOver } from '../ipc';
import { useApp } from '../state/store';
import '../theme/steel';
import { WheelSurface } from './WheelSurface';

const LINK = 'https://www.youtube.com/watch?v=abc';
let drag: ((event: DragOver) => void) | undefined;

const items = () => [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.getAttribute('aria-label'));
const key = (name: string) => fireEvent.keyDown(document.activeElement!, { key: name });

/** The floating wheel in a drag session, with what the drag carries entering it. */
async function enter(event: Partial<Extract<DragOver, { type: 'enter' }>>) {
  render(<WheelSurface />);
  await act(async () => {});
  await act(async () => drag?.({ type: 'enter', paths: [], link: null, x: 260, y: 260, ...event }));
  await act(async () => {});
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.spyOn(api, 'wheelSession').mockResolvedValue({ id: 7, kind: 'tools', mode: 'drag', paths: [] });
  vi.spyOn(api, 'onDrag').mockImplementation(async (handler) => {
    drag = handler;
    return () => {};
  });
  useApp.setState({ settings: { ...DEFAULT_SETTINGS, sound: { enabled: false, volume: 0 } } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  drag = undefined;
});

describe('download slices', () => {
  it('download at once with the defaults, and More… opens every choice', () => {
    const slices = downloadSlices(i18n.t, null);
    expect(slices.map((slice) => [slice.id, slice.label, slice.hint])).toEqual([
      ['video', 'Video', 'Video: MP4, the best quality up to 1080p'],
      ['audio', 'Audio', 'Audio only: MP3'],
      ['original', 'Original', 'Original: the picture or media as the site serves it'],
      ['more', 'More…', 'Every choice: quality, pictures and folder'],
    ]);
    expect(slices.every((slice) => slice.icon && !slice.dimmed)).toBe(true);
  });

  it('are dimmed and open the setup while the web tools are missing', () => {
    const slices = downloadSlices(i18n.t, 'media');
    expect(slices.slice(0, 3).every((slice) => slice.dimmed && slice.id.startsWith(NEEDS_SETUP))).toBe(true);
    expect(slices[0]!.hint).toBe('Needs the Media tools: install them first');
    expect(slices[3]).toMatchObject({ id: 'more' });
    expect(slices[3]!.dimmed).toBeFalsy();
  });
});

describe('a link dragged onto the floating wheel', () => {
  it('turns the wheel into the download ring, whichever key opened it', async () => {
    await enter({ link: LINK });
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Download');
    expect(items()).toEqual(['Video', 'Audio', 'Original', 'More…']);
    expect(document.body.textContent).toContain('youtube.com');
  });

  it('downloads the video at up to 1080p from the first slice', async () => {
    const download = vi.spyOn(api, 'webDownload');
    await enter({ link: LINK });
    act(() => key('ArrowRight'));
    act(() => key('Enter'));
    expect(download).toHaveBeenCalledWith(LINK, { kind: 'video', maxHeight: 1080 }, null);
  });

  it('opens the dialog in the main window from More…', async () => {
    const opened = vi.spyOn(api, 'webOpen');
    const download = vi.spyOn(api, 'webDownload');
    await enter({ link: LINK });
    act(() => key('End'));
    act(() => key('Enter'));
    expect(opened).toHaveBeenCalledWith(LINK);
    expect(download).not.toHaveBeenCalled();
  });

  it('offers the setup instead when the web tools are missing', async () => {
    vi.spyOn(api, 'webNeeds').mockResolvedValue('media');
    const setup = vi.spyOn(api, 'openSetup');
    const download = vi.spyOn(api, 'webDownload');
    await enter({ link: LINK });
    act(() => key('ArrowRight'));
    act(() => key('Enter'));
    expect(setup).toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('keeps the file wheels for files, and closes for a drag of plain text', async () => {
    vi.spyOn(api, 'tools').mockResolvedValue([
      { id: 'compress', icon: 'compress', group: 'core', enhancement: false, needs: null },
    ]);
    await enter({ paths: ['C:\\Users\\me\\Kapadokya 🎈.jpg'] });
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Tools');
    cleanup();
    // Nothing to offer: the session ends at once and the window goes back off screen.
    const closed = vi.spyOn(api, 'wheelClosed');
    await enter({});
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
