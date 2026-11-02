// SPDX-License-Identifier: MIT
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, DEFAULT_SETTINGS, type Bootstrap, type LayoutId, type LayoutStatus, type Platform } from '../ipc';
import { useApp } from '../state/store';
import { LayoutSettings } from './LayoutSettings';

const LAYOUTS: LayoutId[] = [
  'left-half',
  'right-half',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'center',
  'full-screen',
];

function status(permission: LayoutStatus['permission'], taken: LayoutId[] = []): LayoutStatus {
  return {
    permission,
    shortcuts: LAYOUTS.map((layout) => ({ layout, keys: `Ctrl+Alt+${layout}`, taken: taken.includes(layout) })),
  };
}

async function show(platform: Platform, current: LayoutStatus, enabled = false) {
  const boot = await api.bootstrap();
  const settings = { ...DEFAULT_SETTINGS, layouts: { enabled, shortcuts: true } };
  useApp.setState({ boot: { ...boot, settings, app: { ...boot.app, platform } } as Bootstrap, settings });
  vi.spyOn(api, 'layoutsStatus').mockResolvedValue(current);
  render(<LayoutSettings />);
  await act(async () => {});
}

const toggle = () => screen.getByRole('switch', { name: 'Place windows with shortcuts and the Window wheel' });

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  vi.spyOn(api, 'saveSettings').mockImplementation(async (settings) => ({ settings, language: 'en' }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Settings › Window layouts', () => {
  it('is off by default and lists every shortcut', async () => {
    await show('windows', status('not-needed'));
    expect(DEFAULT_SETTINGS.layouts.enabled).toBe(false);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Left half')).toBeTruthy();
    expect(screen.getByText('Ctrl+Alt+full-screen')).toBeTruthy();
    expect(document.querySelectorAll('.layout-key')).toHaveLength(8);
    // Windows asks for no permission.
    expect(screen.queryByText('Accessibility permission')).toBeNull();
    expect(document.body.textContent).toContain('Windows Snap');
  });

  it('switches on at once where no permission is needed', async () => {
    const ask = vi.spyOn(api, 'layoutsAskPermission');
    await show('windows', status('not-needed'));
    await act(async () => void fireEvent.click(toggle()));
    expect(useApp.getState().settings?.layouts.enabled).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('marks a shortcut another app holds', async () => {
    await show('windows', status('not-needed', ['center']), true);
    expect(screen.getAllByText('Another app uses it')).toHaveLength(1);
  });

  it('on macOS says why before the system asks, and asks only on Continue', async () => {
    const ask = vi.spyOn(api, 'layoutsAskPermission').mockResolvedValue(status('missing'));
    await show('macos', status('missing'));
    expect(screen.getByText('Not allowed')).toBeTruthy();
    await act(async () => void fireEvent.click(toggle()));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(ask).not.toHaveBeenCalled();
    expect(useApp.getState().settings?.layouts.enabled).toBe(false);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Continue' })));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(useApp.getState().settings?.layouts.enabled).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('on macOS stays off when the user says not now', async () => {
    const ask = vi.spyOn(api, 'layoutsAskPermission');
    await show('macos', status('missing'));
    await act(async () => void fireEvent.click(toggle()));
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Not now' })));
    expect(ask).not.toHaveBeenCalled();
    expect(useApp.getState().settings?.layouts.enabled).toBe(false);
  });

  it('on macOS opens System Settings from the permission row', async () => {
    const open = vi.spyOn(api, 'layoutsOpenPermissionSettings').mockResolvedValue();
    await show('macos', status('granted'), true);
    expect(screen.getByText('Allowed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
