// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api } from '../ipc';
import { MediaEditor } from './MediaEditor';
import type { MediaPanel } from './panels';

const VIDEO = 'C:\\Users\\me\\Videos\\clip.mp4';
const AUDIO = 'C:\\Users\\me\\Music\\talk.mp3';

function open(tool: MediaPanel, paths: string[]) {
  const onClose = vi.fn();
  const onStarted = vi.fn();
  render(<MediaEditor tool={tool} paths={paths} onClose={onClose} onStarted={onStarted} />);
  return { onClose, onStarted };
}

/** Keys pressed with nothing focused, as after a click on the picture. */
const press = (key: string, init: KeyboardEventInit = {}, times = 1) => {
  for (let i = 0; i < times; i++) fireEvent.keyDown(document.body, { key, ...init });
};

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  // jsdom has no canvas; the waveform simply stays blank.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('media editors', () => {
  it('trim with the shared keys and save with Ctrl+S', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    const { onClose, onStarted } = open('trim-video', [VIDEO]);
    await screen.findAllByText(/1920 × 1080/);
    press('ArrowRight', {}, 2);
    press('i');
    press('End');
    press('ArrowLeft');
    press('o');
    const start = screen.getByRole('slider', { name: 'Selection start' });
    expect(start.getAttribute('aria-valuetext')).toBe('00:02.0');
    expect(screen.getByRole('slider', { name: 'Selection end' }).getAttribute('aria-valuetext')).toBe('01:34.4');
    press('s', { ctrlKey: true });
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith([1]));
    expect(run).toHaveBeenCalledWith({ tool: 'trim-video', span: { start: 2, end: 94.4 } }, [VIDEO]);
    expect(onClose).toHaveBeenCalled();
  });

  it('moves a focused handle by a frame with Shift and an arrow', async () => {
    open('trim-video', [VIDEO]);
    await screen.findAllByText(/1920 × 1080/);
    const start = screen.getByRole('slider', { name: 'Selection start' });
    fireEvent.keyDown(start, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(start, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(start, { key: 'ArrowRight', shiftKey: true });
    // Three frames at 30 fps; the playhead stays where it was.
    expect(start.getAttribute('aria-valuenow')).toBe('0.1');
    expect(screen.getByRole('slider', { name: 'Playhead' }).getAttribute('aria-valuenow')).toBe('0');
  });

  it('keeps nothing to save until the choice changes something', async () => {
    open('speed', [VIDEO]);
    await screen.findAllByText(/1920 × 1080/);
    const save = screen.getByRole('button', { name: 'Save as a new file' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('radio', { name: '2×' }));
    expect(save).toHaveProperty('disabled', false);
  });

  it('crops to a ratio preset in video pixels', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('crop-video', [VIDEO]);
    await screen.findAllByText(/1920 × 1080/);
    fireEvent.click(screen.getByRole('radio', { name: '1:1' }));
    press('s', { ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ tool: 'crop-video', area: { x: 420, y: 0, width: 1080, height: 1080 } }, [
      VIDEO,
    ]);
  });

  it('splits at markers set with M and drops a part', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('split-video', [VIDEO]);
    await screen.findAllByText(/1920 × 1080/);
    press('ArrowRight', {}, 10);
    press('m');
    press('ArrowRight', {}, 20);
    press('M');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Part 2' }));
    press('s', { ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith(
      { tool: 'split-video', at: { kind: 'markers', at: [10, 30] }, keep: [true, false, true] },
      [VIDEO],
    );
  });

  it('redacts audio spans with silence', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('redact-audio', [AUDIO]);
    await screen.findAllByText(/Stereo/);
    press('ArrowRight', {}, 3);
    press('i');
    press('ArrowRight', {}, 2);
    press('o');
    fireEvent.click(screen.getByRole('button', { name: 'Add the selection' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Silence' }));
    press('s', { ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ tool: 'redact-audio', spans: [{ start: 3, end: 5 }], beep: false }, [AUDIO]);
  });

  it('leaves typing in a field alone', async () => {
    open('split-video', [VIDEO]);
    await screen.findAllByText(/1920 × 1080/);
    fireEvent.click(screen.getByRole('radio', { name: 'Equal parts' }));
    const field = screen.getByRole('spinbutton', { name: 'Number of parts' });
    fireEvent.keyDown(field, { key: 'ArrowRight' });
    expect(screen.getByRole('slider', { name: 'Playhead' }).getAttribute('aria-valuenow')).toBe('0');
  });

  it('keeps an error in view and the panel open', async () => {
    vi.spyOn(api, 'runMediaTool').mockRejectedValue('FFmpeg is not installed.');
    const { onClose } = open('normalize', [AUDIO]);
    await screen.findAllByText(/Stereo/);
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new file' }));
    expect((await screen.findByRole('alert')).textContent).toBe('FFmpeg is not installed.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
