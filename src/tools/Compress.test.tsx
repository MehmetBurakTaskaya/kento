// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, type Category, type FileEntry } from '../ipc';
import { useApp } from '../state/store';
import { CompressPanel, compression, parseSize, suggestTarget } from './Compress';

const entry = (name: string, category: Category | null, size: number): FileEntry => ({
  path: `C:\\Users\\me\\${name}`,
  name,
  folder: false,
  format: name.split('.').pop() ?? null,
  category,
  size,
});

beforeAll(async () => {
  await initI18n('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('target size', () => {
  it('reads a number in the chosen unit, with a dot or a comma', () => {
    expect(parseSize('25', 'MB')).toBe(25_000_000);
    expect(parseSize('2.5', 'MB')).toBe(2_500_000);
    expect(parseSize('2,5', 'MB')).toBe(2_500_000);
    expect(parseSize(' 800 ', 'KB')).toBe(800_000);
    expect(parseSize('.5', 'MB')).toBe(500_000);
  });

  it('takes a unit typed with the number over the chosen one', () => {
    expect(parseSize('25 MB', 'KB')).toBe(25_000_000);
    expect(parseSize('25MB', 'KB')).toBe(25_000_000);
    expect(parseSize('800 kb', 'MB')).toBe(800_000);
    expect(parseSize('1 GB', 'MB')).toBe(1_000_000_000);
    expect(parseSize('3m', 'KB')).toBe(3_000_000);
  });

  it('refuses what is not a size', () => {
    for (const text of ['', ' ', '0', '0,0', 'abc', '25 TB', '1.2.3', '-4', '25 MB MB', '1,000.5']) {
      expect(parseSize(text, 'MB')).toBeNull();
    }
  });

  it('suggests half of the largest file in a unit that reads well', () => {
    expect(suggestTarget([6_420_000, 182_400_000], 'en')).toEqual({ text: '91', unit: 'MB' });
    expect(suggestTarget([3_150_000], 'tr')).toEqual({ text: '1,6', unit: 'MB' });
    expect(suggestTarget([900_000], 'en')).toEqual({ text: '450', unit: 'KB' });
    expect(suggestTarget([], 'en')).toEqual({ text: '1', unit: 'KB' });
  });

  it('builds the request of each mode', () => {
    expect(compression('quality', 75, 50, null)).toEqual({ mode: 'quality', level: 75 });
    expect(compression('ratio', 75, 40, null)).toEqual({ mode: 'ratio', percent: 40 });
    expect(compression('size', 75, 40, 25_000_000)).toEqual({ mode: 'size', bytes: 25_000_000 });
    expect(compression('size', 75, 40, null)).toBeNull();
  });
});

describe('Compress panel', () => {
  const files = [
    entry('photo.jpg', 'image', 6_000_000),
    entry('trip.mp4', 'video', 120_000_000),
    entry('report.pdf', 'pdf', 4_000_000),
    entry('notes.txt', 'document', 1_000),
  ];

  it('compresses every file it can under a target size and records the jobs', async () => {
    const run = vi.spyOn(api, 'runCompress');
    const onClose = vi.fn();
    render(<CompressPanel entries={files} onClose={onClose} />);
    expect(screen.getByText('3 files, 130 MB in all')).toBeTruthy();
    expect(screen.getByText('1 file can’t be compressed and is left out.')).toBeTruthy();
    expect(screen.getByText(/PDF compression is an extra/)).toBeTruthy();
    expect(screen.getByText(/Video and audio are compressed with the media tools/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Target size' }));
    const field = screen.getByRole('textbox', { name: 'At most' });
    fireEvent.change(field, { target: { value: 'big' } });
    expect(screen.getByRole('button', { name: 'Compress 3 files' })).toHaveProperty('disabled', true);
    fireEvent.change(field, { target: { value: '25 MB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compress 3 files' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ mode: 'size', bytes: 25_000_000 }, [
      files[0]!.path,
      files[1]!.path,
      files[2]!.path,
    ]);
    expect([...useApp.getState().mine]).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it('starts at quality 75 and estimates the size of a ratio', async () => {
    const run = vi.spyOn(api, 'runCompress');
    const onClose = vi.fn();
    render(<CompressPanel entries={[files[0]!]} onClose={onClose} />);
    expect(screen.getByRole('slider', { name: 'Quality' })).toHaveProperty('value', '75');
    fireEvent.click(screen.getByRole('radio', { name: 'Ratio' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Share of the original size' }), { target: { value: '30' } });
    expect(screen.getByText('About 1.8 MB in all')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Compress the file' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ mode: 'ratio', percent: 30 }, [files[0]!.path]);
  });

  it('keeps an error in view and the panel open', async () => {
    vi.spyOn(api, 'runCompress').mockRejectedValue('Nothing to compress.');
    const onClose = vi.fn();
    render(<CompressPanel entries={[files[0]!]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compress the file' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nothing to compress.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
