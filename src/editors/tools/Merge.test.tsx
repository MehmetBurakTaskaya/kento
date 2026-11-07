// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../i18n';
import { api } from '../../ipc';
import { MediaEditor } from '../MediaEditor';
import { mergedLength } from './Merge';

// The stand-in says every video lasts 95.4 seconds.
const CLIPS = ['C:\\Videos\\Kapadokya ğ.mp4', 'C:\\Videos\\Göreme 🧪.mov', 'C:\\Videos\\Uçhisar.mkv'];

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

describe('the length of merged videos', () => {
  it('is the clips less each overlap, as the engine places them', () => {
    expect(mergedLength([2, 2, 2], 'cut', 0.5)).toBe(6);
    expect(mergedLength([2, 2, 2], 'fade', 0.5)).toBe(5);
    // 0.2 to 2 seconds.
    expect(mergedLength([10, 10], 'wipe', 5)).toBe(18);
    expect(mergedLength([10, 10], 'slide', 0.05)).toBeCloseTo(19.8);
    // Never more than a third of the shorter neighbour.
    expect(mergedLength([10, 0.3, 10], 'fade-black', 1)).toBeCloseTo(20.1);
    expect(mergedLength([4], 'fade', 1)).toBe(4);
  });
});

describe('Merge videos', () => {
  it('takes a transition and its length, and shows the shorter result', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    const onStarted = vi.fn();
    render(<MediaEditor tool="merge-video" paths={CLIPS} onClose={() => {}} onStarted={onStarted} />);
    await screen.findByText('3 videos, 04:46.2 in all');
    expect(screen.getByRole('radio', { name: 'Cut' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('slider', { name: 'Length of each transition' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Through black' }));
    const length = screen.getByRole('slider', { name: 'Length of each transition' });
    expect(length.getAttribute('aria-valuetext')).toBe('0.5 s');
    screen.getByText('3 videos, 04:45.2 in all');
    fireEvent.change(length, { target: { value: '2' } });
    screen.getByText('3 videos, 04:42.2 in all');

    fireEvent.click(screen.getByRole('button', { name: 'Save as a new file' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ tool: 'merge-video', transition: { kind: 'fade-black', seconds: 2 } }, CLIPS);
  });

  it('joins with a cut unless told otherwise', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    const onStarted = vi.fn();
    render(<MediaEditor tool="merge-video" paths={CLIPS.slice(0, 2)} onClose={() => {}} onStarted={onStarted} />);
    await screen.findByText('2 videos, 03:10.8 in all');
    fireEvent.click(screen.getByRole('radio', { name: 'Slide' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Cut' }));
    expect(screen.queryByRole('slider', { name: 'Length of each transition' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new file' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith(
      { tool: 'merge-video', transition: { kind: 'cut', seconds: 0.5 } },
      CLIPS.slice(0, 2),
    );
  });
});
