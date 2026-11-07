// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api } from '../ipc';
import { MediaEditor } from './MediaEditor';
import type { MediaPanel } from './panels';
import { crossfadeFor, fadeGain, keptLength, keptPieces, limitSpan, mergedLength, musicTime } from './sound';

// The browser stand-in gives a video 95.4 s long at 30 fps and audio 184.2 s long.
const VIDEO = 'C:\\Users\\me\\Videos\\clip.mp4';
const SONG = 'C:\\Users\\me\\Music\\şarkı 🎵.mp3';
const OTHER = 'C:\\Users\\me\\Music\\second.flac';
const THIRD = 'C:\\Users\\me\\Music\\third.ogg';

function open(tool: MediaPanel, paths: string[]) {
  const onClose = vi.fn();
  const onStarted = vi.fn();
  render(<MediaEditor tool={tool} paths={paths} onClose={onClose} onStarted={onStarted} />);
  return { onClose, onStarted };
}

const press = (key: string, init: KeyboardEventInit = {}, times = 1) => {
  for (let i = 0; i < times; i++) fireEvent.keyDown(document.body, { key, ...init });
};

const save = () => press('s', { ctrlKey: true });
const saveButton = () => screen.getByRole('button', { name: 'Save as a new file' });
const slide = (name: string, value: number) =>
  fireEvent.change(screen.getByRole('slider', { name }), { target: { value: String(value) } });

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sound helpers', () => {
  it('keeps what lies between the cuts, as the engine does', () => {
    const spans = [
      { start: 4, end: 5 },
      { start: 1, end: 2 },
      { start: 1.5, end: 3 },
      { start: 3, end: 3.5 },
      { start: 9, end: 20 },
    ];
    expect(keptPieces(spans, 10)).toEqual([
      { start: 0, end: 1 },
      { start: 3.5, end: 4 },
      { start: 5, end: 9 },
    ]);
    expect(keptLength(spans, 10)).toBeCloseTo(5.5);
    expect(keptLength([{ start: 0, end: 2 }], 2)).toBe(0);
  });

  it('fades the level in and out', () => {
    expect(fadeGain(0, 2, 2, 10)).toBe(0);
    expect(fadeGain(1, 2, 2, 10)).toBeCloseTo(0.5);
    expect(fadeGain(5, 2, 2, 10)).toBe(1);
    expect(fadeGain(9.5, 2, 2, 10)).toBeCloseTo(0.25);
    expect(fadeGain(5, 0, 0, 10)).toBe(1);
  });

  it('keeps a ringtone within its limit, moving the other end', () => {
    const before = { start: 0, end: 30 };
    expect(limitSpan({ start: 0, end: 35 }, before, 40, 100)).toEqual({ start: 0, end: 35 });
    expect(limitSpan({ start: 0, end: 90 }, before, 40, 100)).toEqual({ start: 50, end: 90 });
    expect(limitSpan({ start: 80, end: 100 }, before, 40, 100)).toEqual({ start: 80, end: 100 });
    expect(limitSpan({ start: 70, end: 200 }, { start: 0, end: 200 }, 40, 100)).toEqual({ start: 60, end: 100 });
  });

  it('holds a crossfade to half the shortest file', () => {
    expect(crossfadeFor(3, [10, 20])).toBe(3);
    expect(crossfadeFor(9, [10, 3])).toBe(1.5);
    expect(crossfadeFor(50, [100, 100])).toBe(10);
    expect(crossfadeFor(0.001, [10, 10])).toBe(0);
    expect(mergedLength([10, 20, 30], 2)).toBe(56);
  });

  it('follows the video in the music, again from the offset when it repeats', () => {
    expect(musicTime(5, 10, 60, false)).toBe(15);
    expect(musicTime(55, 10, 60, false)).toBeNull();
    expect(musicTime(55, 10, 60, true)).toBe(15);
    expect(musicTime(1, 70, 60, true)).toBeNull();
  });
});

describe('sound editors', () => {
  it('cuts out the parts marked with I, O and M', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('cut-out', [VIDEO]);
    await screen.findAllByText(/1920 × 1080/);
    // The transport's M button comes first; the side column's waits for a selection.
    const add = () => screen.getAllByRole('button', { name: 'Add the selection' })[1]!;
    expect(add()).toHaveProperty('disabled', true);
    expect(saveButton()).toHaveProperty('disabled', true);
    press('ArrowRight', {}, 10);
    press('i');
    press('ArrowRight', {}, 5);
    press('o');
    press('m');
    press('ArrowRight', {}, 20);
    press('i');
    press('ArrowRight', {}, 4);
    press('o');
    fireEvent.click(add());
    expect(screen.getByText('The result lasts 01:26.4; 00:09.0 is cut out.')).toBeTruthy();
    // Taking a part off the list puts it back.
    fireEvent.click(screen.getByRole('button', { name: 'Take 00:35.0 – 00:39.0 off the list' }));
    press('s', { ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ tool: 'cut-out', spans: [{ start: 10, end: 15 }] }, [VIDEO]);
  });

  it('says when nothing would be left', async () => {
    open('cut-out', [SONG]);
    await screen.findAllByText(/Stereo/);
    press('ArrowRight');
    press('o');
    press('m');
    press('i');
    press('m');
    expect(screen.getByText(/Nothing would be left/)).toBeTruthy();
    expect(saveButton()).toHaveProperty('disabled', true);
  });

  it('finds pauses again when the settings change, and saves the settings', async () => {
    const find = vi.spyOn(api, 'mediaPauses');
    const run = vi.spyOn(api, 'runMediaTool');
    open('remove-pauses', [SONG]);
    expect(await screen.findByText('23 pauses')).toBeTruthy();
    expect(find).toHaveBeenLastCalledWith(SONG, { threshold: -40, minLength: 0.6, keep: 0.15 });
    slide('For at least', 1.4);
    slide('Quieter than', -50);
    expect(screen.getByText('Finding pauses…')).toBeTruthy();
    expect(saveButton()).toHaveProperty('disabled', true);
    expect(await screen.findByText('5 pauses')).toBeTruthy();
    // The sliders rested before the search started again.
    expect(find).toHaveBeenCalledTimes(2);
    expect(find).toHaveBeenLastCalledWith(SONG, { threshold: -50, minLength: 1.4, keep: 0.15 });
    save();
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith(
      { tool: 'remove-pauses', pauses: { threshold: -50, minLength: 1.4, keep: 0.15 } },
      [SONG],
    );
  });

  it('shows a video’s pauses over its waveform', async () => {
    const peaks = vi.spyOn(api, 'mediaPeaks');
    open('remove-pauses', [VIDEO]);
    await screen.findByText('12 pauses');
    await waitFor(() => expect(peaks).toHaveBeenCalledWith(VIDEO, 1600));
    expect(document.querySelector('.timeline[data-wave] canvas.waveform')).toBeTruthy();
    expect(document.querySelectorAll('.timeline-span')).toHaveLength(12);
  });

  it('adds the music dragged in with the video, sending only the video', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('add-music', [SONG, VIDEO]);
    await screen.findAllByText(/1920 × 1080/);
    await screen.findByText('03:04.2');
    fireEvent.click(screen.getByRole('radio', { name: 'Replace it' }));
    expect(screen.queryByRole('checkbox', { name: 'Lower the music while someone speaks' })).toBeNull();
    slide('Music level', 3);
    save();
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith(
      {
        tool: 'add-music',
        music: SONG,
        mix: {
          music: 3,
          original: 0,
          replace: true,
          duck: false,
          offset: 0,
          repeat: true,
          fadeIn: 1,
          fadeOut: 2,
        },
      },
      [VIDEO],
    );
  });

  it('chooses music from a file dialog and ducks it', async () => {
    const pick = vi.spyOn(api, 'pickFiles').mockResolvedValueOnce(['C:\\notes.pdf']).mockResolvedValueOnce([SONG]);
    const run = vi.spyOn(api, 'runMediaTool');
    open('add-music', [VIDEO]);
    await screen.findAllByText(/1920 × 1080/);
    expect(saveButton()).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Choose music…' }));
    expect(await screen.findByText('None of the chosen files is an audio file.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose music…' }));
    await screen.findByText('03:04.2');
    expect(pick).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lower the music while someone speaks' }));
    slide('Start in the music at', 30);
    save();
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0]![0]).toMatchObject({
      tool: 'add-music',
      music: SONG,
      mix: { replace: false, duck: true, offset: 30, music: -6 },
    });
    expect(run.mock.calls[0]![1]).toEqual([VIDEO]);
  });

  it('fades sound and picture and changes the level', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('fade', [VIDEO]);
    await screen.findAllByText(/1920 × 1080/);
    // The fades show on the timeline.
    expect(document.querySelectorAll('.timeline-span')).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fade the picture from and to black too' }));
    slide('Fade out', 4.5);
    slide('Level', -6);
    save();
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ tool: 'fade', fadeIn: 1, fadeOut: 4.5, picture: true, volume: -6 }, [VIDEO]);
  });

  it('offers no picture fade for audio and warns about a louder level', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('fade', [SONG]);
    await screen.findAllByText(/Stereo/);
    expect(screen.queryByRole('checkbox')).toBeNull();
    slide('Fade in', 0);
    slide('Fade out', 0);
    expect(saveButton()).toHaveProperty('disabled', true);
    slide('Level', 6);
    expect(screen.getByText(/A limiter keeps the louder sound from clipping/)).toBeTruthy();
    save();
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ tool: 'fade', fadeIn: 0, fadeOut: 0, picture: false, volume: 6 }, [SONG]);
  });

  it('removes noise at the chosen strength', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('denoise', [SONG]);
    await screen.findAllByText(/Stereo/);
    expect(screen.getByText('For a fan, traffic or a steady hum')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Strong' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also take away low rumble and hum' }));
    save();
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ tool: 'denoise', strength: 'strong', rumble: true }, [SONG]);
  });

  it('merges audio files in the chosen order with a crossfade', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('merge-audio', [SONG, OTHER, THIRD]);
    expect(await screen.findByText('3 files, 09:12.6 in all')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move second.flac up' }));
    slide('Overlap', 4);
    expect(screen.getByText('3 files, 09:04.6 in all')).toBeTruthy();
    save();
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ tool: 'merge-audio', crossfade: 4 }, [OTHER, SONG, THIRD]);
  });

  it('keeps a ringtone within 40 seconds and says so', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('ringtone', [SONG]);
    await screen.findAllByText(/Stereo/);
    expect(screen.getByText('The ringtone lasts 00:30.0.')).toBeTruthy();
    press('End');
    press('o');
    expect(screen.getByText('The ringtone lasts 00:40.0.')).toBeTruthy();
    expect(screen.getByText(/at most 40 seconds, so the other end moved along/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'MP3' }));
    save();
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith(
      { tool: 'ringtone', span: { start: 144.2, end: 184.2 }, fade: true, format: 'mp3' },
      [SONG],
    );
  });
});
