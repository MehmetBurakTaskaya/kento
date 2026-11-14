// SPDX-License-Identifier: MIT
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, type Bootstrap, type Platform, type UpdateStatus, type UpdateView } from '../ipc';
import { useApp } from '../state/store';
import { isUpdateShortcut, updateLines, UpdateSettings } from './UpdateSettings';

function view(status: UpdateStatus, kind: UpdateView['kind'] = 'installed'): UpdateView {
  return { current: '1.0.0', kind, lastCheck: null, status };
}

async function show(current: UpdateView, platform: Platform = 'windows') {
  const boot = await api.bootstrap();
  useApp.setState({ boot: { ...boot, app: { ...boot.app, platform } } as Bootstrap });
  vi.spyOn(api, 'updatesView').mockResolvedValue(current);
  render(<UpdateSettings />);
  await act(async () => {});
}

beforeAll(async () => {
  await initI18n('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Settings › Updates', () => {
  it('says what a downloaded update waits for', () => {
    const t = i18next.t.bind(i18next);
    const waiting = view({
      state: 'waiting',
      version: '1.1.0',
      jobs: 2,
      paused: true,
      editing: true,
      installs: false,
    });
    expect(updateLines(waiting, t)).toEqual([
      'Kento 1.1.0 is downloaded and verified. New jobs can start again after the restart that installs it.',
      'Waiting for 2 jobs to finish.',
      'Jobs are paused: resume them so the update can install.',
      'Waiting for the open panel in Kento’s window to close, so nothing you are working on is lost.',
    ]);
    // A paused queue with nothing in it holds nothing up.
    expect(updateLines(view({ ...waiting.status, jobs: 0, editing: false } as UpdateStatus), t)).toHaveLength(1);
    expect(updateLines(view({ state: 'failed', reason: 'offline' }), t)[0]).toContain('could not reach GitHub');
  });

  it('checks now, and has no way to skip or put off a version', async () => {
    const check = vi.spyOn(api, 'updatesCheck').mockResolvedValue();
    await show(view({ state: 'upToDate' }));
    expect(screen.getByText('Kento is up to date.')).toBeTruthy();
    expect(screen.getByText('Not yet since Kento started')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(check).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('button', { name: /skip|later|ignore/i })).toBeNull();
    expect(screen.getByText(/no version can be skipped/)).toBeTruthy();
  });

  it('asks a Mac app Kento may not change for the user’s go-ahead', async () => {
    const install = vi.spyOn(api, 'updatesInstall').mockResolvedValue();
    await show(view({ state: 'confirm', version: '1.1.0' }, 'lockedBundle'), 'macos');
    expect(screen.getByText(/asks for an administrator’s password/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check now' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Update and restart' }));
    expect(install).toHaveBeenCalled();
    expect(screen.getByText('⌘U looks for a new version at once, from any Kento window.')).toBeTruthy();
  });

  it('points a development build to the release page', async () => {
    const open = vi.spyOn(api, 'openLink').mockResolvedValue();
    await show(view({ state: 'available', version: '1.1.0' }, 'development'));
    expect(screen.getByText('Kento 1.1.0 is available.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the release page' }));
    expect(open).toHaveBeenCalledWith('releases');
  });

  it('says when an update closed Kento but did not install, and offers to try again', async () => {
    const check = vi.spyOn(api, 'updatesCheck').mockResolvedValue();
    const open = vi.spyOn(api, 'openLink').mockResolvedValue();
    await show(view({ state: 'missed', version: '1.2.1' }));
    expect(screen.getByText(/Kento 1.2.1 could not be installed, so this version keeps working/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(check).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open the release page' }));
    expect(open).toHaveBeenCalledWith('releases');
  });

  it('shows the download as it goes', async () => {
    await show(view({ state: 'downloading', version: '1.1.0', received: 25, total: 100 }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
  });

  it('takes Ctrl+U, or ⌘U on macOS', () => {
    const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { key: 'u', ...init });
    expect(isUpdateShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isUpdateShortcut(key({ ctrlKey: true, key: 'U' }), false)).toBe(true);
    expect(isUpdateShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isUpdateShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isUpdateShortcut(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isUpdateShortcut(key({ ctrlKey: true, key: 'y' }), false)).toBe(false);
  });
});
