// SPDX-License-Identifier: MIT
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadSlices, NEEDS_SETUP } from '../app/slices';
import i18n, { initI18n } from '../i18n';
import { api, DEFAULT_SETTINGS, type DragOver } from '../ipc';
import { useApp } from '../state/store';
import '../theme/steel';
import { polar, R } from '../wheel/geometry';
import { MOTION } from '../wheel/motion';
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
  it('download at once with the defaults, make a QR code, and More… opens every choice', () => {
    const slices = downloadSlices(i18n.t, null);
    expect(slices.map((slice) => [slice.id, slice.label, slice.hint])).toEqual([
      ['video', 'Video', 'Video: MP4, the best quality up to 1080p · Rest here for more choices'],
      ['audio', 'Audio', 'Audio only: MP3 · Rest here for more choices'],
      ['original', 'Original', 'Original: the picture or media as the site serves it'],
      ['qr', 'QR code', 'A QR code of this link'],
      ['more', 'More…', 'Every choice: quality, pictures and folder'],
    ]);
    expect(slices.every((slice) => slice.icon && !slice.dimmed)).toBe(true);
  });

  it('are dimmed and open the setup while the web tools are missing', () => {
    const slices = downloadSlices(i18n.t, 'media');
    expect(slices.slice(0, 3).every((slice) => slice.dimmed && slice.id.startsWith(NEEDS_SETUP))).toBe(true);
    // Without the tools there is nothing to choose between.
    expect(slices.every((slice) => !slice.variants)).toBe(true);
    expect(slices[0]!.hint).toBe('Needs the Media tools: install them first');
    // A QR code and the dialog need no tools.
    expect(slices.slice(3).map((slice) => [slice.id, slice.dimmed])).toEqual([
      ['qr', undefined],
      ['more', undefined],
    ]);
  });
});

describe('a link dragged onto the floating wheel', () => {
  it('turns the wheel into the download ring, whichever key opened it', async () => {
    await enter({ link: LINK });
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Download');
    expect(items()).toEqual(['Video', 'Audio', 'Original', 'QR code', 'More…']);
    expect(document.body.textContent).toContain('youtube.com');
  });

  it('opens the video quality from the keyboard, at up to 1080p first', async () => {
    const download = vi.spyOn(api, 'webDownload');
    await enter({ link: LINK });
    act(() => key('ArrowDown'));
    act(() => key('Enter'));
    expect(items()).toEqual(['Best', '4K, 2160p', '1080p, Full HD', '720p, HD', '480p, SD']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('1080p, Full HD');
    expect(download).not.toHaveBeenCalled();
    act(() => key('Enter'));
    expect(download).toHaveBeenCalledWith(LINK, { kind: 'video', maxHeight: 1080 }, null);
  });

  describe('during the drag', () => {
    const over = (type: 'over' | 'drop', deg: number) => {
      const [x, y] = polar(R.LABEL, deg);
      act(() => drag?.(type === 'over' ? { type, x, y } : { type, x, y, paths: [], link: LINK }));
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(api, 'wheelDropped').mockResolvedValue();
      // The wheel is drawn at 400 px, so the drag's points are the wheel's own units.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 400,
        height: 400,
        right: 400,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('downloads up to 1080p from a plain drop on Video', async () => {
      const download = vi.spyOn(api, 'webDownload');
      await enter({ link: LINK });
      over('over', 0);
      over('drop', 0);
      expect(download).toHaveBeenCalledWith(LINK, { kind: 'video', maxHeight: 1080 }, null);
    });

    it('opens the quality ring on a rest and downloads the quality the drop lands on', async () => {
      const download = vi.spyOn(api, 'webDownload');
      await enter({ link: LINK });
      over('over', 0);
      act(() => vi.advanceTimersByTime(MOTION.dwell));
      expect(items()).toEqual(['Best', '4K, 2160p', '1080p, Full HD', '720p, HD', '480p, SD']);
      expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Video');
      // 1080p unfolded under the pointer; 720p is the next slice clockwise.
      over('over', 0);
      over('over', 72);
      over('drop', 72);
      expect(download).toHaveBeenCalledWith(LINK, { kind: 'video', maxHeight: 720 }, null);
    });

    it('takes the sound as M4A from the Audio ring, and comes back through the hub', async () => {
      const download = vi.spyOn(api, 'webDownload');
      await enter({ link: LINK });
      // Audio, the second of five slices.
      over('over', 72);
      act(() => vi.advanceTimersByTime(MOTION.dwell));
      expect(items()).toEqual(['MP3', 'M4A', 'Original']);
      over('over', 72);
      act(() => drag?.({ type: 'over', x: 200, y: 200 }));
      act(() => vi.advanceTimersByTime(MOTION.dwell));
      expect(items()).toEqual(['Video', 'Audio', 'Original', 'QR code', 'More…']);
      // Still in the hub, then out to Audio again.
      act(() => drag?.({ type: 'over', x: 200, y: 200 }));
      over('over', 72);
      act(() => vi.advanceTimersByTime(MOTION.dwell));
      // MP3 sits under the pointer, M4A next clockwise.
      over('over', 72);
      over('over', 72 + 120);
      over('drop', 72 + 120);
      expect(download).toHaveBeenCalledWith(LINK, { kind: 'audioAs', format: 'm4a' }, null);
    });
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

  it('opens Make a QR code in the main window from the QR slice', async () => {
    const qr = vi.spyOn(api, 'qrOpen');
    const download = vi.spyOn(api, 'webDownload');
    await enter({ link: LINK });
    act(() => key('End'));
    act(() => key('ArrowUp'));
    act(() => key('Enter'));
    expect(qr).toHaveBeenCalledWith(LINK);
    expect(download).not.toHaveBeenCalled();
  });

  it('offers the setup instead when the web tools are missing', async () => {
    vi.spyOn(api, 'webNeeds').mockResolvedValue('media');
    const setup = vi.spyOn(api, 'openSetup');
    const download = vi.spyOn(api, 'webDownload');
    await enter({ link: LINK });
    act(() => key('ArrowDown'));
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

describe('the Window ring', () => {
  async function open() {
    vi.spyOn(api, 'wheelSession').mockResolvedValue({
      id: 9,
      kind: 'window',
      mode: 'click',
      paths: [],
      window: 'Rapor 2026.docx - Word',
    });
    render(<WheelSurface />);
    await act(async () => {});
  }

  it('shows the eight layouts for the window that was in front', async () => {
    await open();
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Window');
    expect(document.body.textContent).toContain('Rapor 2026.docx - Word');
    expect(items()).toEqual([
      'Full screen',
      'Top right',
      'Right half',
      'Bottom right',
      'Center',
      'Bottom left',
      'Left half',
      'Top left',
    ]);
    // Every slice draws its layout icon.
    const icons = [...document.querySelectorAll('[role="menuitem"] svg.icon path')];
    expect(icons).toHaveLength(8);
    expect(icons.every((path) => (path.getAttribute('d') ?? '').length > 20)).toBe(true);
  });

  it('places the window with the chosen layout', async () => {
    const apply = vi.spyOn(api, 'layoutsApply');
    await open();
    act(() => key('End'));
    act(() => key('Enter'));
    expect(apply).toHaveBeenCalledWith('top-left');
  });

  it('does not turn into a file wheel when a wheel key is pressed', async () => {
    const switched = vi.spyOn(api, 'wheelSwitch');
    await open();
    act(() => void fireEvent.keyDown(window, { key: 'Shift' }));
    act(() => void fireEvent.keyDown(window, { key: 'Control' }));
    expect(switched).not.toHaveBeenCalled();
    expect(items()).toHaveLength(8);
  });
});
