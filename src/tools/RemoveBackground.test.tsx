// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, type Category, type FileEntry } from '../ipc';
import { useApp } from '../state/store';
import { PREVIEW_SIZE, RemoveBackgroundPanel } from './RemoveBackground';

const entry = (name: string, category: Category | null): FileEntry => ({
  path: `C:\\Users\\me\\${name}`,
  name,
  folder: false,
  format: name.split('.').pop() ?? null,
  category,
  size: 1000,
});

const revoked: string[] = [];

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  let made = 0;
  revoked.length = 0;
  URL.createObjectURL = vi.fn(() => `blob:cutout-${++made}`);
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Remove background panel', () => {
  const photo = entry('Kedi ğüşıöç.jpg', 'image');
  const logo = entry('logo.png', 'image');
  const notes = entry('notes.txt', 'document');

  it('shows the picture cut out and removes the background as a job', async () => {
    let answer: (png: Blob) => void = () => {};
    const preview = vi
      .spyOn(api, 'backgroundPreview')
      .mockImplementation(() => new Promise<Blob>((resolve) => (answer = resolve)));
    const run = vi.spyOn(api, 'removeBackground');
    const onClose = vi.fn();
    render(<RemoveBackgroundPanel entries={[photo]} onClose={onClose} />);
    expect(preview).toHaveBeenCalledWith(photo.path, PREVIEW_SIZE);
    // The model takes a while; the panel says so until the picture comes.
    expect(screen.getByRole('status').textContent).toMatch(/Finding what to keep/);
    answer(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
    const picture = await screen.findByRole('img', { name: 'Kedi ğüşıöç.jpg without its background' });
    expect(picture.getAttribute('src')).toBe('blob:cutout-1');

    fireEvent.click(screen.getByRole('button', { name: 'Remove the background' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith([photo.path]);
    expect([...useApp.getState().mine]).toContain(1);
  });

  it('takes only the pictures and shows the one chosen', async () => {
    const preview = vi.spyOn(api, 'backgroundPreview').mockResolvedValue(new Blob([], { type: 'image/png' }));
    const run = vi.spyOn(api, 'removeBackground');
    render(<RemoveBackgroundPanel entries={[photo, notes, logo]} onClose={() => {}} />);
    await screen.findByRole('img', { name: /Kedi/ });
    const second = screen.getByRole('button', { name: 'logo.png' });
    expect(second.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(second);
    expect(second.getAttribute('aria-pressed')).toBe('true');
    await screen.findByRole('img', { name: 'logo.png without its background' });
    expect(preview).toHaveBeenLastCalledWith(logo.path, PREVIEW_SIZE);
    // The first picture's preview is let go once another replaces it.
    expect(revoked).toContain('blob:cutout-1');

    fireEvent.click(screen.getByRole('button', { name: 'Remove from 2 pictures' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith([photo.path, logo.path]));
  });

  it('says why there is no preview and still lets the job start', async () => {
    vi.spyOn(api, 'backgroundPreview').mockRejectedValue('Removing backgrounds needs the Extras tools.');
    vi.spyOn(api, 'removeBackground').mockRejectedValue('Not now.');
    const onClose = vi.fn();
    render(<RemoveBackgroundPanel entries={[logo]} onClose={onClose} />);
    expect(await screen.findByText('Removing backgrounds needs the Extras tools.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the background' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Not now.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
