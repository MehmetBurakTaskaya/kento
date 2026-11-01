// SPDX-License-Identifier: MIT
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '../i18n';
import { MOTION } from './motion';
import { Wheel, type WheelProps, type WheelSlice } from './Wheel';

const FORMATS: WheelSlice[] = ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'ico', 'pdf'].map((id) => ({
  id,
  label: id.toUpperCase(),
  sublabel: `${id} sub`,
  hint: `${id.toUpperCase()}: hint`,
}));

function setup(overrides: Partial<WheelProps> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const props: WheelProps = {
    kind: 'convert',
    title: 'Convert',
    subtitle: 'photo.heic',
    slices: FORMATS.slice(0, 4),
    onApply,
    onClose,
    sound: { enabled: false, volume: 0.3 },
    reducedMotion: false,
    ...overrides,
  };
  const view = render(<Wheel {...props} />);
  const key = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
  const items = () => [...document.querySelectorAll('[role="menuitem"]')];
  const focused = () => document.activeElement?.getAttribute('aria-label');
  return { onApply, onClose, key, items, focused, view, props };
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no canvas; the labels fall back to estimated widths.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await changeLanguage('en');
});

describe('Wheel', () => {
  it('is a modal dialog with a menu whose items carry their name and hint', () => {
    const { items } = setup();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Convert');
    expect(document.activeElement?.getAttribute('role')).toBe('menu');
    expect(items().map((item) => item.getAttribute('aria-label'))).toEqual([
      'JPG, jpg sub',
      'PNG, png sub',
      'WEBP, webp sub',
      'AVIF, avif sub',
    ]);
    const hint = document.getElementById(items()[1]!.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toBe('PNG: hint');
  });

  it('moves with the arrows and applies with Enter at once, then closes after the lock', () => {
    const { key, focused, onApply, onClose } = setup();
    act(() => key('ArrowRight'));
    expect(focused()).toBe('JPG, jpg sub');
    act(() => key('ArrowRight'));
    act(() => key('ArrowRight'));
    act(() => key('ArrowLeft'));
    expect(focused()).toBe('PNG, png sub');
    act(() => key('End'));
    expect(focused()).toBe('AVIF, avif sub');
    act(() => key('Home'));
    act(() => key('Enter'));
    expect(onApply).toHaveBeenCalledWith('jpg');
    const wheel = document.querySelector('.wheel')!;
    expect(wheel.classList.contains('is-applying')).toBe(true);
    expect(wheel.classList.contains('has-selected')).toBe(true);
    // Each phase starts its timer once React has rendered the one before.
    act(() => vi.advanceTimersByTime(MOTION.apply));
    expect(wheel.classList.contains('is-applied')).toBe(true);
    act(() => vi.advanceTimersByTime(MOTION.hold));
    expect(wheel.classList.contains('is-closing')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(MOTION.close));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Keys after the apply change nothing.
    act(() => key('Enter'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('closes with Esc or Tab after the close animation, without applying', () => {
    for (const closer of ['Escape', 'Tab']) {
      const { key, onApply, onClose } = setup();
      act(() => key(closer));
      expect(onClose).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(MOTION.close));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onApply).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('announces disabled slices as unavailable and never applies them', () => {
    const slices: WheelSlice[] = [
      { id: 'compress', label: 'Compress', icon: 'compress' },
      { id: 'cutout', label: 'Remove background', icon: 'cutout', disabled: true, hint: 'Needs the Extras tools' },
    ];
    const { key, items, onApply, onClose } = setup({ kind: 'tools', slices });
    expect(items()[1]!.getAttribute('aria-disabled')).toBe('true');
    act(() => key('ArrowRight'));
    act(() => key('ArrowRight'));
    act(() => key('Enter'));
    expect(onApply).not.toHaveBeenCalled();
    expect(document.querySelector('.wheel-tip')?.textContent).toBe('Needs the Extras tools');
    act(() => vi.advanceTimersByTime(2000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('pages past eight slices with "More…" and back to the start', () => {
    const { key, items, focused, onApply } = setup({ slices: FORMATS });
    expect(items()).toHaveLength(8);
    expect(items()[7]!.getAttribute('aria-label')).toBe('More…');
    act(() => key('End'));
    act(() => key('Enter'));
    expect(onApply).not.toHaveBeenCalled();
    expect(items().map((item) => item.getAttribute('aria-label'))).toEqual([
      'ICO, ico sub',
      'PDF, pdf sub',
      'Back to start',
    ]);
    expect(focused()).toBe('Back to start');
    expect(document.querySelector('.wheel-sr')?.textContent).toBe('Page 2');
    act(() => key('Enter'));
    expect(items()[0]!.getAttribute('aria-label')).toBe('JPG, jpg sub');
  });

  it('shows new slices from onApply as a sub-wheel instead of locking, and goes back', () => {
    const categories: WheelSlice[] = [
      { id: 'image', label: 'Image', icon: 'image' },
      { id: 'video', label: 'Video', icon: 'video' },
    ];
    const onBack = vi.fn();
    const { key, items, view, props, onClose } = setup({ slices: categories });
    act(() => key('ArrowRight'));
    act(() => key('Enter'));
    view.rerender(<Wheel {...props} title="Image" slices={FORMATS.slice(0, 2)} onBack={onBack} />);
    expect(document.querySelector('.wheel')?.classList.contains('has-selected')).toBe(false);
    expect(items().map((item) => item.getAttribute('aria-label'))).toEqual(['JPG, jpg sub', 'PNG, png sub']);
    expect(document.activeElement?.getAttribute('role')).toBe('menu');
    act(() => key('Backspace'));
    expect(onBack).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mirrors the slice order and the arrows in right-to-left languages', async () => {
    await act(() => changeLanguage('ar-XB'));
    const { key, focused } = setup();
    expect(document.querySelector('.wheel')?.getAttribute('dir')).toBe('rtl');
    act(() => key('ArrowRight'));
    expect(focused()).toBe('AVIF, avif sub');
    act(() => key('ArrowLeft'));
    act(() => key('ArrowLeft'));
    expect(focused()).toBe('PNG, png sub');
  });

  it('applies at once and closes with short fades when motion is reduced', () => {
    const { key, onApply, onClose } = setup({ reducedMotion: true });
    act(() => key('ArrowRight'));
    act(() => key(' '));
    expect(onApply).toHaveBeenCalledWith('jpg');
    expect(document.querySelector('.wheel')?.classList.contains('is-applied')).toBe(true);
    act(() => vi.advanceTimersByTime(MOTION.hold));
    act(() => vi.advanceTimersByTime(MOTION.reduced.close));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
