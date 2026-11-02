// SPDX-License-Identifier: MIT
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, DEFAULT_SETTINGS } from '../ipc';
import { useApp } from '../state/store';
import '../theme/steel';
import { polar, R } from '../wheel/geometry';
import { WheelHost } from './WheelHost';
import { PDF_LAYOUT } from './variants';

const PICTURES = ['C:\\Users\\me\\Pictures\\Kapadokya 🎈.jpg', 'C:\\Users\\me\\Pictures\\Göreme.heic'];

const items = () => [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.getAttribute('aria-label'));
const key = (name: string) => fireEvent.keyDown(document.activeElement!, { key: name });
const focused = () => document.activeElement?.getAttribute('aria-label');

/** The main window's Convert wheel for the two pictures. */
async function open() {
  useApp.setState({ wheel: { kind: 'convert', paths: PICTURES }, mine: new Set(), toasts: [] });
  render(<WheelHost />);
  await act(async () => {});
  await act(async () => {});
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
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
  useApp.setState({ settings: { ...DEFAULT_SETTINGS, sound: { enabled: false, volume: 0 } } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useApp.setState({ wheel: null });
});

describe('the main window’s wheel', () => {
  it('opens the PDF choices from the keyboard and makes one PDF of the pictures', async () => {
    const toPdf = vi.spyOn(api, 'imagesToPdf').mockResolvedValue(9);
    await open();
    expect(items().slice(0, 5)).toEqual(['JPG', 'PNG', 'WEBP', 'AVIF', 'PDF']);
    for (let i = 0; i < 5; i++) act(() => key('ArrowDown'));
    expect(focused()).toBe('PDF');
    act(() => key('Enter'));
    expect(items()).toEqual(['One PDF', 'Separate PDFs']);
    expect(focused()).toBe('One PDF');
    act(() => key('Enter'));
    await act(async () => {});
    expect(toPdf).toHaveBeenCalledWith(PICTURES, PDF_LAYOUT);
    expect(useApp.getState().mine.has(9)).toBe(true);
    // The started job re-rendered the host; the wheel still plays its apply animation.
    expect(document.querySelector('.wheel')?.classList.contains('has-selected')).toBe(true);
  });

  it('makes one PDF from a plain click on PDF, and one PDF each from its ring', async () => {
    const toPdf = vi.spyOn(api, 'imagesToPdf').mockResolvedValue(9);
    const convert = vi.spyOn(api, 'convert');
    await open();
    // Eight slices with "More…": PDF, the fifth, sits at six o'clock.
    const [x, y] = polar(R.LABEL, 180);
    act(() => void fireEvent.click(document.querySelector('.wheel-disc')!, { clientX: x, clientY: y, button: 0 }));
    await act(async () => {});
    expect(toPdf).toHaveBeenCalledTimes(1);
    expect(convert).not.toHaveBeenCalled();
    cleanup();

    // PDF, just chosen, now comes first.
    await open();
    expect(items()[0]).toBe('PDF');
    act(() => key('Home'));
    act(() => key('ArrowRight'));
    act(() => key('ArrowDown'));
    act(() => key('Enter'));
    await act(async () => {});
    expect(convert).toHaveBeenCalledWith(PICTURES, 'pdf');
  });
});
