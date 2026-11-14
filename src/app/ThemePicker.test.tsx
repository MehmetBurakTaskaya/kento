// SPDX-License-Identifier: MIT
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { DEFAULT_SETTINGS, type Settings } from '../ipc';
import catalog from '../theme/catalog.json';
import { loadTheme } from '../theme/registry';
import { ThemePicker } from './ThemePicker';

/** Says whether a card has come near the screen or left it. */
let near = new Map<Element, (isIntersecting: boolean) => void>();
let frames: FrameRequestCallback[] = [];

beforeAll(async () => {
  await initI18n('en');
  await loadTheme('telefon');
  await loadTheme('pikap');
});

beforeEach(() => {
  near = new Map();
  frames = [];
  // Cards draw their wheel only once they come near the screen, one a frame.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(element: Element) {
        near.set(element, (isIntersecting) =>
          this.callback([{ isIntersecting } as IntersectionObserverEntry], this as never),
        );
      }
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
    configurable: true,
    value: () => 20,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (SVGElement.prototype as { getComputedTextLength?: unknown }).getComputedTextLength;
});

function show(theme: string, onChange = vi.fn()) {
  const settings: Settings = { ...DEFAULT_SETTINGS, theme, appearance: 'light' };
  render(
    <>
      <h3 id="theme-label">Theme</h3>
      <ThemePicker settings={settings} labelledBy="theme-label" onChange={onChange} />
    </>,
  );
  return onChange;
}

describe('the theme picker', () => {
  it('offers every theme by its name as one radio group, the chosen one checked and in the tab order', () => {
    show('telefon');
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    const radios = within(group).getAllByRole('radio');
    // The built-in theme says it is the original.
    expect(radios.map((radio) => radio.textContent)).toEqual(
      catalog.map((theme) => (theme.pack === null ? `${theme.name} (original)` : theme.name)),
    );
    const checked = radios.filter((radio) => radio.getAttribute('aria-checked') === 'true');
    expect(checked.map((radio) => radio.textContent)).toEqual(['Ahize']);
    expect(radios.filter((radio) => radio.tabIndex === 0)).toEqual(checked);
  });

  it('chooses a theme with a click, Space, the arrow keys, Home and End', () => {
    const onChange = show('telefon');
    const group = screen.getByRole('radiogroup');
    fireEvent.click(screen.getByRole('radio', { name: 'Kasa (original)' }));
    expect(onChange).toHaveBeenLastCalledWith('steel');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Plak' }), { key: ' ' });
    expect(onChange).toHaveBeenLastCalledWith('pikap');
    const at = catalog.findIndex((theme) => theme.id === 'telefon');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(catalog[at + 1]!.id);
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(catalog[at - 1]!.id);
    fireEvent.keyDown(group, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('steel');
    fireEvent.keyDown(group, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(catalog[catalog.length - 1]!.id);
  });

  it('shows the chosen theme’s wheel to try, and a card’s wheel near the screen, one card a frame', async () => {
    show('telefon');
    const preview = document.querySelector('.theme-preview')!;
    expect(preview.querySelector('[data-look="telefon"]')).not.toBeNull();
    expect(within(preview as HTMLElement).getAllByRole('menuitem')).toHaveLength(8);
    const [ahize, plak, kasa] = ['Ahize', 'Plak', 'Kasa (original)'].map((name) => screen.getByRole('radio', { name }));
    const drawn = () => [ahize, plak, kasa].map((card) => card!.querySelector('.wheel-disc') !== null);
    const frame = () =>
      act(async () => {
        const now = frames;
        frames = [];
        now.forEach((callback) => callback(0));
      });
    expect(drawn()).toEqual([false, false, false]);
    // Kasa leaves before its turn and gives it up.
    await act(async () => [ahize, plak, kasa].forEach((card) => near.get(card!)!(true)));
    await act(async () => near.get(kasa!)!(false));
    await frame();
    expect(drawn()).toEqual([true, false, false]);
    await frame();
    expect(drawn()).toEqual([true, true, false]);
    await frame();
    expect(drawn()).toEqual([true, true, false]);
    await act(async () => near.get(kasa!)!(true));
    await frame();
    expect(drawn()).toEqual([true, true, true]);
    // The picture is decoration: inert, and out of the tab order.
    expect(ahize!.querySelector('[inert]')).not.toBeNull();
  });
});
