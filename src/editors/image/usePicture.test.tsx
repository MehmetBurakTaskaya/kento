// SPDX-License-Identifier: MIT
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ImageTool } from '../../ipc';
import { PREVIEW_DELAY, usePreview } from './usePicture';

const PATHS = ['C:\\Users\\me\\Pictures\\photo.jpg'];
const tool = (brightness: number): ImageTool => ({
  tool: 'edit-image',
  adjust: {
    turn: 'none',
    flipHorizontal: false,
    flipVertical: false,
    resize: null,
    brightness,
    contrast: 0,
    saturation: 0,
  },
});

/** A preview request the test answers when it wants to. */
function deferred() {
  let resolve!: (blob: Blob | null) => void;
  const promise = new Promise<Blob | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let urls = 0;
const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  urls = 0;
  created.length = 0;
  revoked.length = 0;
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:preview-${++urls}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const blob = () => new Blob(['png'], { type: 'image/png' });

describe('previews', () => {
  it('asks at once for the first picture, then waits until the choices rest', async () => {
    const calls = vi.spyOn(api, 'imagePreview').mockImplementation(async () => blob());
    const { result, rerender } = renderHook(({ value }) => usePreview(PATHS, tool(value), 1600), {
      initialProps: { value: 0 },
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ url: 'blob:preview-1', fresh: true, loading: false });

    // A slider moving: three values within the pause make one request, for the last value.
    for (const value of [10, 20, 30]) {
      rerender({ value });
      await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY - 40));
    }
    expect(calls).toHaveBeenCalledTimes(1);
    // The last picture stays while the next is made.
    expect(result.current).toMatchObject({ url: 'blob:preview-1', fresh: false, loading: true });
    await act(() => vi.advanceTimersByTimeAsync(40));
    expect(calls).toHaveBeenCalledTimes(2);
    expect(calls.mock.calls[1]).toEqual([PATHS, tool(30), 1600]);
    expect(result.current).toMatchObject({ url: 'blob:preview-2', fresh: true });
    // The replaced picture is let go.
    expect(revoked).toEqual(['blob:preview-1']);
  });

  it('drops an answer that arrives after a newer request', async () => {
    const first = deferred();
    const second = deferred();
    const answers = [first.promise, second.promise];
    vi.spyOn(api, 'imagePreview').mockImplementation(() => answers.shift()!);
    const { result, rerender } = renderHook(({ value }) => usePreview(PATHS, tool(value), 1600), {
      initialProps: { value: 0 },
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    rerender({ value: 50 });
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY));
    // The newer answer comes first; the older one, late, is never shown or kept.
    await act(async () => second.resolve(blob()));
    await act(async () => first.resolve(blob()));
    expect(result.current).toMatchObject({ url: 'blob:preview-1', fresh: true });
    expect(created).toEqual(['blob:preview-1']);
  });

  it('lets the last picture go when the editor closes, and reports a failure', async () => {
    const calls = vi.spyOn(api, 'imagePreview').mockResolvedValueOnce(blob());
    const { result, rerender, unmount } = renderHook(({ value }) => usePreview(PATHS, tool(value), 1600), {
      initialProps: { value: 0 },
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    calls.mockRejectedValueOnce('The picture could not be read.');
    rerender({ value: 5 });
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY));
    expect(result.current).toMatchObject({
      url: 'blob:preview-1',
      fresh: false,
      loading: false,
      error: 'The picture could not be read.',
    });
    unmount();
    expect(revoked).toEqual(['blob:preview-1']);
  });

  it('asks for nothing until the picture is known', async () => {
    const calls = vi.spyOn(api, 'imagePreview');
    const { result } = renderHook(() => usePreview(PATHS, null, 1600, false));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(calls).not.toHaveBeenCalled();
    expect(result.current).toEqual({ url: null, fresh: false, loading: false, error: null });
  });
});
