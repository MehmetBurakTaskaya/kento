// SPDX-License-Identifier: MIT
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { DEFAULT_SETTINGS, type Settings } from '../ipc';
import catalog from '../theme/catalog.json';
import { loadTheme } from '../theme/registry';
import { ThemePicker } from './ThemePicker';

let inView: (() => void)[] = [];

beforeAll(async () => {
  await initI18n('en');
  await loadTheme('telefon');
});

beforeEach(() => {
  inView = [];
  // Cards draw their wheel only once they come into view.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe() {
        inView.push(() => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never));
      }
      disconnect() {}
    },
  );
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

  it('shows the chosen theme’s wheel to try, and a card’s wheel once the card is in view', async () => {
    show('telefon');
    const preview = document.querySelector('.theme-preview')!;
    expect(preview.querySelector('[data-look="telefon"]')).not.toBeNull();
    expect(within(preview as HTMLElement).getAllByRole('menuitem')).toHaveLength(8);
    const card = screen.getByRole('radio', { name: 'Ahize' });
    expect(card.querySelector('.wheel-disc')).toBeNull();
    await act(async () => inView.forEach((show) => show()));
    await act(async () => {});
    expect(card.querySelector('.wheel-disc')).not.toBeNull();
    // The picture is decoration: inert, and out of the tab order.
    expect(card.querySelector('[inert]')).not.toBeNull();
  });
});
