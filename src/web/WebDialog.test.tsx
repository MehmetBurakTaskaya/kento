// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, DEFAULT_SETTINGS, DEMO_LINKS, type Settings } from '../ipc';
import { useApp } from '../state/store';
import { WebDialog } from './WebDialog';

function open(url: string, web: Settings['web'] = { shortcut: true, noticeShown: true }) {
  useApp.setState({ settings: { ...DEFAULT_SETTINGS, web }, web: { url }, setup: false, mine: new Set() });
  return render(<WebDialog />);
}

const radios = () => screen.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent);
const downloadButton = () => screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement;

beforeAll(async () => {
  await initI18n('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useApp.setState({ web: null, setup: false });
});

describe('download dialog', () => {
  it('shows that it reads the link, and what Kento never downloads', async () => {
    vi.spyOn(api, 'webProbe').mockReturnValue(new Promise(() => {}));
    open(DEMO_LINKS.youtube);
    expect(await screen.findByRole('progressbar', { name: 'Reading the link…' })).toBeTruthy();
    expect(screen.getByText('youtube.com')).toBeTruthy();
    expect(screen.getByText(/^Not supported: DRM-protected content, live streams/)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('offers a video with a short quality list, starting at 1080p', async () => {
    const download = vi.spyOn(api, 'webDownload');
    open(DEMO_LINKS.youtube);
    expect(await screen.findByText('Kapadokya’da gün doğumu: balon turu 🎈 (4K)')).toBeTruthy();
    expect(screen.getByText('YouTube · Video · 12:34')).toBeTruthy();
    expect(radios()).toEqual([
      'VideoMP4 with sound',
      'Audio onlyMP3',
      'ThumbnailThe video’s cover picture, as JPG',
      'OriginalAs the site serves it, unconverted',
    ]);
    const quality = screen.getByLabelText('Quality') as HTMLSelectElement;
    expect([...quality.options].map((option) => option.text)).toEqual([
      '2160p (4K)',
      '1440p',
      '1080p (Full HD)',
      '720p (HD)',
      '480p',
      '360p',
    ]);
    expect(quality.value).toBe('1080');
    fireEvent.change(quality, { target: { value: '720' } });
    fireEvent.click(downloadButton());
    await waitFor(() => expect(useApp.getState().web).toBeNull());
    expect(download).toHaveBeenCalledWith(DEMO_LINKS.youtube, { kind: 'video', maxHeight: 720 }, null);
    expect(useApp.getState().mine.has(1)).toBe(true);
  });

  it('downloads the sound alone as MP3, or the thumbnail on its own', async () => {
    const download = vi.spyOn(api, 'webDownload');
    open(DEMO_LINKS.youtube);
    fireEvent.click(await screen.findByRole('radio', { name: /^Audio only/ }));
    expect(screen.queryByLabelText('Quality')).toBeNull();
    fireEvent.click(downloadButton());
    await waitFor(() => expect(download).toHaveBeenCalledWith(DEMO_LINKS.youtube, { kind: 'audio' }, null));
    cleanup();
    open(DEMO_LINKS.youtube);
    fireEvent.click(await screen.findByRole('radio', { name: /^Thumbnail/ }));
    fireEvent.click(downloadButton());
    await waitFor(() => expect(download).toHaveBeenLastCalledWith(DEMO_LINKS.youtube, { kind: 'thumbnail' }, null));
  });

  it('offers only the video and its sound for an Instagram reel', async () => {
    open(DEMO_LINKS.reel);
    expect(await screen.findByText('Peri bacaları 30 saniyede')).toBeTruthy();
    expect(radios()).toEqual(['VideoMP4 with sound', 'Audio onlyMP3']);
  });

  it('picks every picture of a photo post and saves them in the post’s order', async () => {
    const download = vi.spyOn(api, 'webDownload');
    open(DEMO_LINKS.post);
    expect(await screen.findByText('Göreme, Mayıs 2026')).toBeTruthy();
    expect(screen.getByText('Instagram · 6 pictures')).toBeTruthy();
    const pictures = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(pictures.map((box) => box.checked)).toEqual([true, true, true, true, true, true]);
    expect(screen.getByText('6 of 6 picked, saved in the post’s order')).toBeTruthy();
    // Left out and picked again in another order: the download still follows the post.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Picture 2' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Picture 5' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Picture 2' }));
    expect(screen.getByText('5 of 6 picked, saved in the post’s order')).toBeTruthy();
    fireEvent.click(downloadButton());
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(DEMO_LINKS.post, { kind: 'images', indexes: [0, 1, 2, 3, 5] }, null),
    );
  });

  it('cannot download a photo post with no picture picked', async () => {
    open(DEMO_LINKS.post);
    fireEvent.click(await screen.findByRole('button', { name: 'Pick none' }));
    expect(downloadButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pick all' }));
    expect(downloadButton().disabled).toBe(false);
  });

  it('downloads into a folder picked in the system dialog', async () => {
    const download = vi.spyOn(api, 'webDownload');
    vi.spyOn(api, 'webChooseFolder').mockResolvedValue('D:\\Videolar ğüş');
    open(DEMO_LINKS.podcast);
    expect(await screen.findByText('C:\\Users\\me\\Downloads\\Kento')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    expect(await screen.findByText('D:\\Videolar ğüş')).toBeTruthy();
    fireEvent.click(downloadButton());
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(DEMO_LINKS.podcast, { kind: 'audio' }, 'D:\\Videolar ğüş'),
    );
  });

  it('explains a page without media and points to the share link', async () => {
    vi.spyOn(api, 'webProbe').mockRejectedValue({ key: 'error.web.no-media', details: 'ERROR: no video formats' });
    open('https://example.org/player');
    expect(await screen.findByText(/use “Copy share link” and try that link/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('offers the setup when yt-dlp is missing', async () => {
    vi.spyOn(api, 'webProbe').mockRejectedValue({ key: 'error.codec.ytdlp', details: 'missing' });
    open(DEMO_LINKS.youtube);
    fireEvent.click(await screen.findByRole('button', { name: 'Complete setup' }));
    expect(useApp.getState().setup).toBe(true);
    expect(useApp.getState().web).toBeNull();
  });

  it('asks for the setup before reading a link when a web tool is missing', async () => {
    const probe = vi.spyOn(api, 'webProbe');
    vi.spyOn(api, 'webNeeds').mockResolvedValue('media');
    open(DEMO_LINKS.youtube);
    expect(
      await screen.findByText('Downloading from the web needs the media tools: FFmpeg, yt-dlp and Deno.'),
    ).toBeTruthy();
    expect(probe).not.toHaveBeenCalled();
  });

  it('tries again after the site could not be reached', async () => {
    const probe = vi
      .spyOn(api, 'webProbe')
      .mockRejectedValueOnce({ key: 'error.web.network', details: 'timed out' })
      .mockResolvedValueOnce({
        url: DEMO_LINKS.youtube,
        site: 'youtube',
        kind: 'video',
        title: 'Second try',
        duration: null,
        heights: [],
        thumbnail: false,
        images: [],
      });
    open(DEMO_LINKS.youtube);
    expect(await screen.findByText(/The site could not be reached/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Second try')).toBeTruthy();
    expect(probe).toHaveBeenCalledTimes(2);
    // Without heights there is no quality to choose.
    expect(screen.queryByLabelText('Quality')).toBeNull();
  });

  it('shows the first-use notice once and remembers it in the settings', async () => {
    const save = vi.spyOn(api, 'saveSettings');
    open(DEMO_LINKS.youtube, { shortcut: true, noticeShown: false });
    expect(screen.getByRole('note').textContent).toBe('Only download content you have the right to download.');
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ web: { shortcut: true, noticeShown: true } })),
    );
    // It stays while this dialog is open, then never comes back.
    expect(await screen.findByText('Kapadokya’da gün doğumu: balon turu 🎈 (4K)')).toBeTruthy();
    expect(screen.getByRole('note')).toBeTruthy();
    cleanup();
    useApp.setState({ web: { url: DEMO_LINKS.youtube } });
    render(<WebDialog />);
    expect(useApp.getState().settings?.web.noticeShown).toBe(true);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
