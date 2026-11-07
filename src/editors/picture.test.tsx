// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { api, type MediaTool } from '../ipc';
import { MediaEditor } from './MediaEditor';
import type { MediaPanel } from './panels';
import {
  applyColor,
  centerOf,
  colorMap,
  FLAT,
  isPlain,
  loopLength,
  pastLimit,
  portraitWindow,
  svgMatrix,
  turnBy,
  turnTransform,
  unchanged,
} from './picture';
import { rightToLeft, textUnits } from './text';

const VIDEO = 'C:\\Users\\me\\Videos\\clip.mp4';
/** What the stand-in's canvas hands back for every picture it draws. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==';

function open(tool: MediaPanel) {
  const onClose = vi.fn();
  const onStarted = vi.fn();
  render(<MediaEditor tool={tool} paths={[VIDEO]} onClose={onClose} onStarted={onStarted} />);
  return { onClose, onStarted };
}

const ready = () => screen.findAllByText(/1920 × 1080/);
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });

/** Saves with Ctrl+S and gives the request the editor sent. */
async function saved(run: ReturnType<typeof vi.spyOn>): Promise<MediaTool> {
  press('s', { ctrlKey: true });
  await waitFor(() => expect(run).toHaveBeenCalled());
  return run.mock.calls[0]![0] as MediaTool;
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  // jsdom draws nothing: a stand-in context measures every letter at 0.6 of the font size, and every
  // canvas turns into the same tiny PNG.
  const context = {
    font: '10px sans-serif',
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
      return { width: [...text].length * size * 0.6 };
    },
    fillText: vi.fn(),
    strokeText: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(`data:image/png;base64,${PNG}`);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('picture numbers', () => {
  it('places the 9:16 window as the engine does', () => {
    const wide = { width: 1920, height: 1080 };
    expect(portraitWindow(0.5, wide)).toEqual({ x: 656, y: 0, width: 606, height: 1080 });
    expect(portraitWindow(0, wide).x).toBe(0);
    expect(portraitWindow(1, wide).x).toBe(1920 - 606);
    expect(portraitWindow(0.3, { width: 1080, height: 2400 })).toEqual({ x: 0, y: 240, width: 1080, height: 1920 });
    expect(portraitWindow(0.5, { width: 333, height: 101 })).toMatchObject({ width: 56, height: 100 });
    expect(centerOf({ x: 656, y: 0, width: 606, height: 1080 }, wide)).toBeCloseTo(0.5);
  });

  it('says which short-video length a result passes', () => {
    expect(pastLimit(59)).toBeNull();
    expect(pastLimit(60)).toBeNull();
    expect(pastLimit(61)).toBe(60);
    expect(pastLimit(200)).toBe(180);
  });

  it('turns, mirrors and flips', () => {
    expect(turnBy('none', 1)).toBe('right');
    expect(turnBy('none', -1)).toBe('left');
    expect(turnBy('left', 1)).toBe('none');
    expect(unchanged('none', false, false)).toBe(true);
    expect(unchanged('half', true, true)).toBe(true);
    expect(unchanged('half', true, false)).toBe(false);
    // The turn first: CSS applies the list from the right.
    expect(turnTransform('right', true, true)).toBe('scaleY(-1) scaleX(-1) rotate(90deg)');
    expect(turnTransform('none', false, false)).toBe('rotate(0deg)');
  });

  it('works out the length of a loop', () => {
    expect(loopLength('reverse', 5, 10)).toBe(10);
    expect(loopLength('boomerang', 3, 10)).toBe(60);
    expect(loopLength('repeat', 3, 10)).toBe(30);
    expect(loopLength('repeat', 99, 10)).toBe(100);
  });

  it('maps colours as the engine does', () => {
    // The same numbers as the engine's test (media/tools/picture/color.rs).
    const map = colorMap('vintage', { brightness: 20, contrast: -10, saturation: 30, warmth: -40 });
    const near = (actual: number[], expected: number[]) =>
      actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 3));
    near(applyColor(map, [0.2, 0.5, 0.8]), [0.4087, 0.5868, 0.7496]);
    near(applyColor(map, [1, 0, 0]), [0.8986, 0.2161, 0.1838]);
    expect(isPlain(colorMap('none', FLAT))).toBe(true);
    expect(isPlain(colorMap('warm', FLAT))).toBe(false);
    const gray = applyColor(colorMap('black-white', FLAT), [0.9, 0.2, 0.1]);
    expect(gray[0]).toBeCloseTo(gray[1]!, 9);
    expect(svgMatrix(colorMap('none', FLAT))).toBe('1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0');
  });

  it('knows the reading direction of a text and measures its block', () => {
    expect(rightToLeft('مرحبا Kento')).toBe(true);
    expect(rightToLeft('Kento مرحبا')).toBe(false);
    expect(rightToLeft('123 שלום')).toBe(true);
    expect(rightToLeft('🎈 İstanbul')).toBe(false);
    const one = textUnits({ text: 'Merhaba', font: 'sans', frame: 'plain' });
    const two = textUnits({ text: 'Merhaba\ndünya', font: 'sans', frame: 'plain' });
    const boxed = textUnits({ text: 'Merhaba', font: 'sans', frame: 'box' });
    expect(two.height).toBeCloseTo(one.height + 1.25);
    expect(boxed.width).toBeGreaterThan(one.width);
  });
});

describe('make vertical', () => {
  it('sends the crop window, the selection and the fill', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('make-vertical');
    await ready();
    // The demo video runs 95.4 seconds: past a minute.
    expect(screen.getByText(/longer than a minute/)).toBeTruthy();
    const window = screen.getByRole('button', { name: /^9:16 window, 606 × 1080 at 656/ });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    press('ArrowRight', {}); // the playhead to 00:01
    press('i');
    press('ArrowRight');
    press('ArrowRight');
    press('o');
    expect(screen.queryByText(/longer than a minute/)).toBeNull();
    expect(await saved(run)).toEqual({
      tool: 'make-vertical',
      span: { start: 1, end: 3 },
      fill: { kind: 'crop', center: 0.519 },
    });
  });

  it('lays the picture over a blur or a colour', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('make-vertical');
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Color' }));
    fireEvent.input(screen.getByLabelText('Background color'), { target: { value: '#ff8000' } });
    expect(screen.queryByRole('button', { name: /9:16 window/ })).toBeNull();
    expect(await saved(run)).toEqual({
      tool: 'make-vertical',
      span: null,
      fill: { kind: 'color', rgb: [255, 128, 0] },
    });
  });
});

describe('add text or logo', () => {
  it('sends the text as the picture it draws, with its place, opacity and time', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('add-overlay');
    await ready();
    const save = screen.getByRole('button', { name: 'Save as a new file' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    fireEvent.change(screen.getByLabelText('What it says'), { target: { value: 'Merhaba 🎈' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Opacity' }), { target: { value: '60' } });
    // From the playhead on, for five seconds; then O sets the end.
    press('ArrowRight');
    press('ArrowRight');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show for the whole video' }));
    press('ArrowRight');
    press('o');
    const request = await saved(run);
    expect(request.tool).toBe('add-overlay');
    if (request.tool !== 'add-overlay') return;
    const [layer] = request.layers;
    expect(request.layers).toHaveLength(1);
    expect(layer!.source).toEqual({ kind: 'picture', png: PNG });
    expect(layer!.opacity).toBe(0.6);
    expect(layer!.span).toEqual({ start: 2, end: 3 });
    // 8 % of the height, in the middle, at four fifths of the way down.
    const { x, y, width, height } = layer!.area;
    expect(Number.isInteger(x) && Number.isInteger(width)).toBe(true);
    expect(x + width / 2).toBeCloseTo(960, -1);
    expect(y + height / 2).toBeCloseTo(864, -1);
    expect(height).toBeGreaterThan(86);
  });

  it('adds a picture by its path and removes a layer', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    vi.spyOn(api, 'pickFiles').mockResolvedValue(['C:\\Pictures\\notes.txt', 'C:\\Pictures\\Logo ğ.png']);
    vi.spyOn(api, 'imageInfo').mockResolvedValue({ width: 200, height: 100 });
    open('add-overlay');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a picture…' }));
    await screen.findByText(/Picture 2: Logo ğ.png/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove layer 1' }));
    const request = await saved(run);
    if (request.tool !== 'add-overlay') throw new Error(request.tool);
    expect(request.layers).toEqual([
      {
        source: { kind: 'image', path: 'C:\\Pictures\\Logo ğ.png' },
        // 22 % of the width, two to one, four hundredths of the height from the top right corner.
        area: { x: 1454, y: 43, width: 422, height: 211 },
        opacity: 1,
        span: null,
      },
    ]);
  });

  it('says when no picture was chosen', async () => {
    vi.spyOn(api, 'pickFiles').mockResolvedValue(['C:\\Pictures\\notes.txt']);
    open('add-overlay');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Add a picture…' }));
    expect(await screen.findByText(/None of the chosen files is a PNG/)).toBeTruthy();
  });
});

describe('rotate video', () => {
  it('turns, mirrors and flips, and knows when they cancel out', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('rotate-video');
    await ready();
    const save = screen.getByRole('button', { name: 'Save as a new file' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Turn right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mirror' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flip upside down' }));
    expect(save).toHaveProperty('disabled', true);
    expect(screen.getByText(/cancel each other out/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn left' }));
    expect(screen.getByText('1080 × 1920 pixels')).toBeTruthy();
    expect(await saved(run)).toEqual({ tool: 'rotate-video', turn: 'right', mirror: true, flip: true });
  });
});

describe('reverse and loop', () => {
  it('reverses once, or loops as many times as chosen', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('loop-video');
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Boomerang' }));
    fireEvent.change(screen.getByRole('slider', { name: 'How many times' }), { target: { value: '5' } });
    expect(screen.getByText('Length 15:54.0')).toBeTruthy();
    expect(screen.getByText('A boomerang has no sound.')).toBeTruthy();
    expect(await saved(run)).toEqual({ tool: 'loop-video', mode: 'boomerang', count: 5 });
  });

  it('sends a count of one for reverse', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('loop-video');
    await ready();
    expect(screen.queryByRole('slider', { name: 'How many times' })).toBeNull();
    expect(await saved(run)).toEqual({ tool: 'loop-video', mode: 'reverse', count: 1 });
  });
});

describe('color and look', () => {
  it('sends the look and the sliders, and nothing that changes nothing', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('color-video');
    await ready();
    const save = screen.getByRole('button', { name: 'Save as a new file' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('radio', { name: 'Warm' }));
    // The arrows move the look like any radio group.
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Warm' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Cool' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.change(screen.getByRole('slider', { name: 'Brightness' }), { target: { value: '20' } });
    expect(screen.getByText('+20')).toBeTruthy();
    expect(await saved(run)).toEqual({
      tool: 'color-video',
      look: 'cool',
      grade: { brightness: 20, contrast: 0, saturation: 0, warmth: 0 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(save).toHaveProperty('disabled', true);
  });
});

describe('stabilize video', () => {
  it('sends the strength', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('stabilize');
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Strong' }));
    expect(await saved(run)).toEqual({ tool: 'stabilize', strength: 'strong' });
  });
});

describe('redact video', () => {
  it('erases an area drawn on the picture', async () => {
    const run = vi.spyOn(api, 'runMediaTool');
    open('redact-video');
    await ready();
    const overlay = document.querySelector<HTMLElement>('.overlay')!;
    const box = { x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 };
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ ...box, toJSON: () => box });
    fireEvent.pointerDown(overlay, { button: 0, clientX: 800, clientY: 450, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: 900, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 900, clientY: 500, pointerId: 1 });
    fireEvent.click(screen.getByRole('radio', { name: 'Erase' }));
    expect(screen.getByText(/for your own logo/)).toBeTruthy();
    expect(document.querySelector('.overlay-rect')?.getAttribute('data-hide')).toBe('erase');
    const request = await saved(run);
    expect(request).toEqual({
      tool: 'redact-video',
      areas: [{ area: { x: 1600, y: 900, width: 200, height: 100 }, span: { start: 0, end: 95.4 } }],
      hide: { kind: 'erase' },
    });
  });
});
