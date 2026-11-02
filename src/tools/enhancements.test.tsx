// SPDX-License-Identifier: MIT
// Make a QR code, Extract text and Burn in subtitles, against the browser stand-in of the core.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, type Category, type FileEntry } from '../ipc';
import { useApp } from '../state/store';
import { BurnSubtitlesPanel, pairOf } from './BurnSubtitles';
import { MakeQrPanel, QR_DEFAULT, qrNote, svgSource } from './MakeQr';
import { baseLanguage, installed, languageChoices, languageName, OcrPanel } from './Ocr';

const entry = (name: string, category: Category | null): FileEntry => ({
  path: `C:\\Users\\me\\${name}`,
  name,
  folder: false,
  format: name.split('.').pop() ?? null,
  category,
  size: 1000,
});

beforeAll(async () => {
  await initI18n('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Make a QR code', () => {
  it('says why a code cannot be made, and warns about light codes on dark', () => {
    const preview = { svg: null, contrast: 21, inverted: false };
    expect(qrNote(null)).toBeNull();
    expect(qrNote({ ...preview, problem: 'empty' })).toBeNull();
    expect(qrNote({ ...preview, problem: 'too-long' })).toEqual({ key: 'tools.makeQr.tooLong', error: true });
    expect(qrNote({ ...preview, problem: 'low-contrast' })).toEqual({ key: 'tools.makeQr.lowContrast', error: true });
    expect(qrNote({ svg: '<svg/>', problem: null, contrast: 21, inverted: true })).toEqual({
      key: 'tools.makeQr.inverted',
      error: false,
    });
    expect(svgSource('<svg a="#1"/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%231%22%2F%3E');
    expect(svgSource(null)).toBeNull();
  });

  it('previews the code as it is typed and saves it with the chosen style', async () => {
    const make = vi.spyOn(api, 'makeQr');
    const onClose = vi.fn();
    render(<MakeQrPanel text="https://example.test/menü" onClose={onClose} />);
    expect(await screen.findByRole('img', { name: 'Preview of the QR code' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Error correction' }), { target: { value: 'high' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Size' }), { target: { value: '512' } });
    fireEvent.click(screen.getByRole('radio', { name: 'SVG' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save as SVG' })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: 'Save as SVG' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(make).toHaveBeenCalledWith(
      'https://example.test/menü',
      { ...QR_DEFAULT, correction: 'high', size: 512 },
      'svg',
      null,
    );
    expect(useApp.getState().mine.has(1)).toBe(true);
  });

  it('refuses colours too close to read, and an empty text', async () => {
    render(<MakeQrPanel text="" onClose={() => {}} />);
    expect(await screen.findByText('Type or paste text or a link.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save as PNG' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Text or link' }), { target: { value: 'Merhaba' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '#dddddd' } });
    expect((await screen.findByRole('alert')).textContent).toContain('too close for phones');
    expect(screen.getByRole('button', { name: 'Save as PNG' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Black on white' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('Extract text', () => {
  it('matches languages by their tag or their language', () => {
    expect(baseLanguage('tr-TR')).toBe('tr');
    expect(baseLanguage('zh-Hant-TW')).toBe('zh-hant');
    expect(installed('tr-TR', ['en-US', 'tr'])).toBe('tr');
    expect(installed('en-GB', ['en-US'])).toBe('en-US');
    expect(installed('de', ['en-US'])).toBeNull();
    expect(languageName('tr', 'en')).toBe('Turkish');
    expect(languageName('tr', 'tr')).toBe('Türkçe');
    expect(
      languageChoices({ available: ['en-US', 'de-DE'], suggested: 'en-US', interface: 'tr', system: 'tr-TR' }),
    ).toEqual([
      { tag: 'en-US', missing: false },
      { tag: 'de-DE', missing: false },
      { tag: 'tr', missing: true },
    ]);
  });

  it('names a missing language and reads the images and PDFs in an installed one', async () => {
    vi.spyOn(api, 'ocrLanguages').mockResolvedValue({
      available: ['en-US', 'de-DE'],
      suggested: 'en-US',
      interface: 'tr',
      system: 'tr-TR',
    });
    const run = vi.spyOn(api, 'runOcr');
    const onClose = vi.fn();
    const files = [entry('Fiş.jpg', 'image'), entry('Tarama.pdf', 'pdf'), entry('not.txt', 'document')];
    render(<OcrPanel entries={files} onClose={onClose} />);
    const hint = await screen.findByText(/Windows can’t read Turkish text yet/);
    expect(hint.getAttribute('role')).toBe('note');
    const select = screen.getByRole('combobox', { name: 'Language of the text' });
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'English (United States)',
      'German (Germany)',
      'Turkish (not installed)',
    ]);
    fireEvent.change(select, { target: { value: 'tr' } });
    expect(screen.getByRole('alert').textContent).toContain('Settings › Time & language › Language & region');
    expect(screen.getByRole('button', { name: 'Extract text from 2 files' })).toHaveProperty('disabled', true);
    fireEvent.change(select, { target: { value: 'de-DE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Extract text from 2 files' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith([files[0]!.path, files[1]!.path], 'de-DE');
  });
});

describe('Burn in subtitles', () => {
  it('takes exactly one video and one subtitle file, in either order', () => {
    const video = entry('Gezi.mp4', 'video');
    const srt = entry('Gezi.srt', 'subtitle');
    expect(pairOf([srt, video])).toEqual({ video, subtitles: srt });
    expect(pairOf([video])).toBeNull();
    expect(pairOf([video, entry('Başka.mp4', 'video')])).toBeNull();
    expect(pairOf([video, srt, entry('Ek.vtt', 'subtitle')])).toBeNull();
  });

  it('shows the first subtitle where it will go and burns it in at the chosen size', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    const onClose = vi.fn();
    const video = entry('Gezi 🎈.mp4', 'video');
    const srt = entry('Gezi 🎈.srt', 'subtitle');
    render(<BurnSubtitlesPanel entries={[srt, video]} onClose={onClose} />);
    expect(await screen.findByText(/Kapadokya’da gün doğarken/)).toBeTruthy();
    expect(screen.getByText('The first subtitle, at 00:01')).toBeTruthy();
    fireEvent.change(screen.getByRole('slider', { name: 'Text size' }), { target: { value: '150' } });
    expect(screen.getByText('150%')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Top' }));
    expect(document.querySelector('.burn-stage')?.getAttribute('data-position')).toBe('top');
    fireEvent.click(screen.getByRole('button', { name: 'Burn in' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ tool: 'burn-subtitles', size: 150, position: 'top' }, [video.path, srt.path]);
  });
});
