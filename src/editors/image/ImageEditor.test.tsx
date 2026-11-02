// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../i18n';
import { api } from '../../ipc';
import { ImageEditor, type ImagePanel } from '.';

const PHOTO = 'C:\\Users\\me\\Pictures\\photo.jpg';
const PHOTOS = [PHOTO, 'C:\\Users\\me\\Pictures\\b.png', 'C:\\Users\\me\\Pictures\\c.webp'];

function open(tool: ImagePanel, paths = [PHOTO]) {
  const onClose = vi.fn();
  const onStarted = vi.fn();
  const view = render(<ImageEditor tool={tool} paths={paths} onClose={onClose} onStarted={onStarted} />);
  return { onClose, onStarted, container: view.container };
}

/** The stand-in answers 4032 × 3024; the editors show it once read (sizes are bidi-isolated). */
const ready = () => screen.findAllByText(/4032 × 3024/);

const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, ...init });

/** A drag on an element laid out at 800 × 600 screen pixels, from and to screen points. */
function drag(element: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(element, { button: 0, clientX: from[0], clientY: from[1], pointerId: 1 });
  fireEvent.pointerMove(element, { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2, pointerId: 1 });
  fireEvent.pointerMove(element, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(element, { clientX: to[0], clientY: to[1], pointerId: 1 });
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  // jsdom has no layout: every box is 800 × 600 at the top left, so 1 screen px = 5.04 source px.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    toJSON: () => ({}),
  });
  // Nor a canvas; text is measured by a guess instead.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('image editors', () => {
  it('crops to a preset in source pixels and saves with Ctrl+S', async () => {
    const run = vi.spyOn(api, 'runImageTool');
    const { onClose, onStarted } = open('crop-image');
    await ready();
    const save = screen.getByRole('button', { name: 'Save as a new file' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('radio', { name: '1:1' }));
    expect(screen.getByText(/^The result is .3024 × 3024. pixels\.$/)).toBeTruthy();
    press('s', { ctrlKey: true });
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith([1]));
    expect(run).toHaveBeenCalledWith({ tool: 'crop-image', area: { x: 504, y: 0, width: 3024, height: 3024 } }, [
      PHOTO,
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('moves the crop area with the arrows and saves with Enter on it', async () => {
    const run = vi.spyOn(api, 'runImageTool');
    open('crop-image');
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: '16:9' }));
    const area = screen.getByRole('button', { name: /^Crop area/ });
    press('ArrowDown', {}, area);
    press('ArrowUp', { shiftKey: true }, area);
    press('Enter', {}, area);
    await waitFor(() => expect(run).toHaveBeenCalled());
    // 16:9 across the whole width, centred at 378, then 30 px (1 %) down and 1 px up.
    expect(run.mock.calls[0]![0]).toEqual({ tool: 'crop-image', area: { x: 0, y: 407, width: 4032, height: 2268 } });
  });

  it('turns, resizes with the proportions kept and adjusts the colours', async () => {
    const run = vi.spyOn(api, 'runImageTool');
    open('edit-image');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Turn right' }));
    const width = screen.getByRole('spinbutton', { name: /^Width/ });
    fireEvent.change(width, { target: { value: '1512' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    expect(screen.getByRole('spinbutton', { name: /^Height/ })).toHaveProperty('value', '2016');
    fireEvent.change(screen.getByRole('slider', { name: 'Brightness' }), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new file' }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith(
      {
        tool: 'edit-image',
        adjust: {
          turn: 'right',
          flipHorizontal: false,
          flipVertical: false,
          resize: [1512, 2016],
          brightness: 20,
          contrast: 0,
          saturation: 0,
        },
      },
      [PHOTO],
    );
  });

  it('draws marks, undoes and redoes them, and sends them in source pixels', async () => {
    const run = vi.spyOn(api, 'runImageTool');
    const { container } = open('markup');
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Rectangle' }));
    const layer = container.ownerDocument.querySelector('.mark-layer')!;
    drag(layer, [100, 100], [300, 250]);
    expect(screen.getByRole('button', { name: '1. Rectangle' })).toBeTruthy();
    press('z', { ctrlKey: true });
    expect(screen.queryByRole('button', { name: '1. Rectangle' })).toBeNull();
    press('y', { ctrlKey: true });
    fireEvent.click(screen.getByRole('radio', { name: 'Arrow' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    drag(layer, [400, 300], [500, 300]);
    press('z', { ctrlKey: true, shiftKey: true });
    press('s', { ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith(
      {
        tool: 'markup',
        marks: [
          {
            kind: 'rectangle',
            area: { x: 504, y: 504, width: 1008, height: 756 },
            color: [229, 57, 53, 255],
            width: 16,
            filled: false,
          },
          { kind: 'arrow', from: [2016, 1512], to: [2520, 1512], color: [30, 136, 229, 255], width: 16 },
        ],
      },
      [PHOTO],
    );
  });

  it('chooses a mark, restyles it and removes it with Delete', async () => {
    const { container } = open('markup');
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Line' }));
    const layer = container.ownerDocument.querySelector('.mark-layer')!;
    drag(layer, [100, 100], [300, 100]);
    fireEvent.click(screen.getByRole('radio', { name: 'Select and move' }));
    const hit = container.ownerDocument.querySelector('[data-mark] .mark-hit')!;
    fireEvent.pointerDown(hit, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 200, clientY: 100, pointerId: 1 });
    expect(screen.getByRole('button', { name: '1. Line' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Heavy' }));
    expect(container.ownerDocument.querySelector('[data-mark] line')!.getAttribute('stroke-width')).toBe('65');
    press('Delete');
    expect(screen.getByText('Nothing is drawn yet.')).toBeTruthy();
    press('z', { ctrlKey: true });
    expect(screen.getByRole('button', { name: '1. Line' })).toBeTruthy();
  });

  it('types text where the picture is clicked; Esc ends it without closing', async () => {
    const run = vi.spyOn(api, 'runImageTool');
    const { container, onClose } = open('markup');
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
    const layer = container.ownerDocument.querySelector('.mark-layer')!;
    fireEvent.click(layer, { clientX: 200, clientY: 100 });
    const field = screen.getByRole('textbox', { name: 'Text' });
    fireEvent.change(field, { target: { value: 'Hello' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '1. Text “Hello”' })).toBeTruthy();
    press('s', { ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0]![0]).toEqual({
      tool: 'markup',
      marks: [{ kind: 'text', at: [1008, 504], text: 'Hello', color: [229, 57, 53, 255], size: 161 }],
    });
  });

  it('redacts drawn areas with pixelation', async () => {
    const run = vi.spyOn(api, 'runImageTool');
    const { container } = open('redact-image');
    await ready();
    drag(container.ownerDocument.querySelector('.overlay')!, [80, 60], [240, 180]);
    // The area on the picture and its row in the list.
    expect(screen.getAllByRole('button', { name: /^Area 1: .806 × 604.$/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: 'Pixelate' }));
    press('s', { ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0]![0]).toEqual({
      tool: 'redact-image',
      areas: [{ x: 403, y: 302, width: 806, height: 604 }],
      hide: { kind: 'pixelate' },
    });
  });

  it('frames with sizes that follow the picture', async () => {
    const run = vi.spyOn(api, 'runImageTool');
    open('frame');
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Gradient' }));
    press('s', { ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0]![0]).toEqual({
      tool: 'frame',
      frame: {
        padding: 242,
        radius: 60,
        shadow: true,
        background: { kind: 'gradient', from: [219, 226, 236], to: [42, 78, 166], angle: 45 },
      },
    });
  });

  it('makes a collage of the pictures in the order of the list', async () => {
    const run = vi.spyOn(api, 'runImageTool');
    open('collage', PHOTOS);
    await screen.findByText('3 pictures');
    const list = screen.getByRole('list');
    fireEvent.keyDown(within(list).getAllByRole('listitem')[0]!, { key: 'ArrowDown', altKey: true });
    fireEvent.click(screen.getByRole('radio', { name: 'Show them whole' }));
    press('s', { ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith(
      {
        tool: 'collage',
        collage: {
          layout: { kind: 'grid', columns: 2 },
          spacing: 16,
          background: [255, 255, 255],
          width: 2400,
          fill: false,
        },
      },
      [PHOTOS[1], PHOTOS[0], PHOTOS[2]],
    );
  });

  it('keeps an error in view and the editor open', async () => {
    vi.spyOn(api, 'runImageTool').mockRejectedValue('The picture could not be read.');
    const { onClose } = open('frame');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new file' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The picture could not be read.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
