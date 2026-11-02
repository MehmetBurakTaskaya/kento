// SPDX-License-Identifier: MIT
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '../i18n';
import { C, polar, R } from './geometry';
import { MOTION } from './motion';
import { playWheelSound } from './sound';
import { Wheel, type WheelControl, type WheelProps, type WheelSlice } from './Wheel';

// The sounds a wheel asks for, without audio.
vi.mock('./sound', async (original) => ({ ...(await original<typeof import('./sound')>()), playWheelSound: vi.fn() }));

const FORMATS: WheelSlice[] = ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'ico', 'pdf'].map((id) => ({
  id,
  label: id.toUpperCase(),
  sublabel: `${id} sub`,
  hint: `${id.toUpperCase()}: hint`,
}));

/** A slice with choices, the first of them its default. */
const PDF: WheelSlice = {
  id: 'pdf',
  label: 'PDF',
  hint: 'PDF: hint',
  default: 'one',
  variants: [
    { id: 'one', label: 'One PDF', icon: 'merge' },
    { id: 'separate', label: 'Separate PDFs', icon: 'split' },
  ],
};
/** PDF at twelve o'clock, JPG at three, PNG at six, WEBP at nine. */
const WITH_PDF = [PDF, ...FORMATS.slice(0, 3)];

function setup(overrides: Partial<WheelProps> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const control = createRef<WheelControl>();
  const props: WheelProps = {
    kind: 'convert',
    title: 'Convert',
    subtitle: 'photo.heic',
    slices: FORMATS.slice(0, 4),
    onApply,
    onClose,
    sound: { enabled: false, volume: 0.3 },
    reducedMotion: false,
    control,
    ...overrides,
  };
  const view = render(<Wheel {...props} />);
  const key = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
  const items = () => [...document.querySelectorAll('[role="menuitem"]')];
  const labels = () => items().map((item) => item.getAttribute('aria-label'));
  const focused = () => document.activeElement?.getAttribute('aria-label');
  const ring = () => document.querySelector('[role="menu"]')?.getAttribute('aria-label');
  const said = () => document.querySelector('.wheel-sr')?.textContent;
  /** The drag over a point at an angle (or the hub), in the wheel's own 400-unit space. */
  const point = (deg: number | 'hub') => {
    const [x, y] = deg === 'hub' ? [C, C] : polar(R.LABEL, deg);
    act(() => control.current!.point(x, y));
  };
  const drop = (deg: number | 'hub') => {
    const [x, y] = deg === 'hub' ? [C, C] : polar(R.LABEL, deg);
    act(() => control.current!.drop(x, y));
  };
  const rest = (ms: number = MOTION.dwell) => act(() => vi.advanceTimersByTime(ms));
  return { onApply, onClose, key, items, labels, focused, ring, said, point, drop, rest, view, props };
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no canvas; the labels fall back to estimated widths.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // The disc is drawn at 400 px, so screen points are the wheel's own units.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 400,
    right: 400,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
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
    expect(items().some((item) => item.hasAttribute('aria-haspopup'))).toBe(false);
  });

  it('moves with Down and Up and applies with Enter at once, then closes after the lock', () => {
    const { key, focused, onApply, onClose } = setup();
    act(() => key('ArrowDown'));
    expect(focused()).toBe('JPG, jpg sub');
    act(() => key('ArrowDown'));
    act(() => key('ArrowDown'));
    act(() => key('ArrowUp'));
    expect(focused()).toBe('PNG, png sub');
    act(() => key('End'));
    expect(focused()).toBe('AVIF, avif sub');
    act(() => key('Home'));
    // Nothing to open on a plain slice.
    act(() => key('ArrowRight'));
    expect(focused()).toBe('JPG, jpg sub');
    act(() => key('Enter'));
    expect(onApply).toHaveBeenCalledWith('jpg', []);
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
    act(() => key('ArrowDown'));
    act(() => key('ArrowDown'));
    act(() => key('Enter'));
    expect(onApply).not.toHaveBeenCalled();
    expect(document.querySelector('.wheel-tip')?.textContent).toBe('Needs the Extras tools');
    act(() => vi.advanceTimersByTime(2000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('pages past eight slices with "More…" and back to the start', () => {
    const { key, items, focused, onApply, said } = setup({ slices: FORMATS });
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
    expect(said()).toBe('Page 2');
    act(() => key('Enter'));
    expect(items()[0]!.getAttribute('aria-label')).toBe('JPG, jpg sub');
  });

  it('shows new slices from the host as a new ring instead of locking', () => {
    const { key, labels, view, props, onClose } = setup();
    act(() => key('ArrowDown'));
    act(() => key('Enter'));
    view.rerender(<Wheel {...props} title="Image" slices={FORMATS.slice(4, 6)} />);
    expect(document.querySelector('.wheel')?.classList.contains('has-selected')).toBe(false);
    expect(labels()).toEqual(['GIF, gif sub', 'TIFF, tiff sub']);
    expect(document.activeElement?.getAttribute('role')).toBe('menu');
    act(() => vi.advanceTimersByTime(2000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mirrors the slice order right to left, where Left opens choices and Right goes back', async () => {
    await act(() => changeLanguage('ar-XB'));
    const { key, focused, labels } = setup({ slices: WITH_PDF });
    expect(document.querySelector('.wheel')?.getAttribute('dir')).toBe('rtl');
    act(() => key('ArrowDown'));
    expect(focused()).toBe('PDF');
    act(() => key('ArrowRight'));
    expect(labels()).toHaveLength(4);
    act(() => key('ArrowLeft'));
    expect(labels()).toEqual(['One PDF', 'Separate PDFs']);
    act(() => key('ArrowRight'));
    expect(labels()).toHaveLength(4);
    expect(focused()).toBe('PDF');
  });

  it('applies at once and closes with short fades when motion is reduced', () => {
    const { key, onApply, onClose } = setup({ reducedMotion: true });
    act(() => key('ArrowDown'));
    act(() => key(' '));
    expect(onApply).toHaveBeenCalledWith('jpg', []);
    expect(document.querySelector('.wheel')?.classList.contains('is-applied')).toBe(true);
    act(() => vi.advanceTimersByTime(MOTION.hold));
    act(() => vi.advanceTimersByTime(MOTION.reduced.close));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('a slice with choices', () => {
  it('is a submenu for screen readers and carries a mark', () => {
    const { items } = setup({ slices: WITH_PDF });
    expect(items()[0]!.getAttribute('aria-haspopup')).toBe('menu');
    expect(items()[1]!.hasAttribute('aria-haspopup')).toBe(false);
    expect(items()[0]!.querySelector('.wheel-ring-mark')).not.toBeNull();
    expect(items()[1]!.querySelector('.wheel-ring-mark')).toBeNull();
  });

  it('opens its ring when the drag rests on it, with its default where the pointer is', () => {
    const { point, rest, labels, ring, said, focused, drop, onApply } = setup({ slices: WITH_PDF });
    point(0);
    rest(MOTION.dwell - 20);
    expect(labels()).toHaveLength(4);
    rest(20);
    expect(labels()).toEqual(['One PDF', 'Separate PDFs']);
    expect(ring()).toBe('PDF');
    expect(said()).toBe('PDF: 2 choices');
    expect(focused()).toBe('One PDF');
    expect(document.querySelector('.wheel')?.getAttribute('data-depth')).toBe('1');
    // Still resting there: the default, unfolded under the pointer, is what a drop applies.
    point(0);
    rest(MOTION.dwell * 2);
    drop(0);
    expect(onApply).toHaveBeenCalledWith('one', ['pdf']);
  });

  it('runs the default on a plain drop, without opening', () => {
    const { point, drop, onApply, labels } = setup({ slices: WITH_PDF });
    point(0);
    drop(0);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('one', ['pdf']);
    expect(labels()).toHaveLength(4);
    expect(document.querySelector('.wheel')?.classList.contains('has-selected')).toBe(true);
  });

  it('runs the default on a click too', () => {
    const { onApply } = setup({ slices: WITH_PDF });
    const [x, y] = polar(R.LABEL, 0);
    act(() => void fireEvent.click(document.querySelector('.wheel-disc')!, { clientX: x, clientY: y, button: 0 }));
    expect(onApply).toHaveBeenCalledWith('one', ['pdf']);
  });

  it('runs the variant the drop lands on', () => {
    const { point, rest, drop, onApply } = setup({ slices: WITH_PDF });
    point(0);
    rest();
    // The other choice sits opposite.
    point(180);
    drop(180);
    expect(onApply).toHaveBeenCalledWith('separate', ['pdf']);
  });

  it('goes back a level when the drag rests on the hub, once', () => {
    const { point, rest, labels, ring, said } = setup({ slices: WITH_PDF });
    point(0);
    rest();
    point(0);
    point('hub');
    rest(MOTION.dwell - 20);
    expect(labels()).toEqual(['One PDF', 'Separate PDFs']);
    rest(20);
    expect(labels()).toEqual(['PDF', 'JPG, jpg sub', 'PNG, png sub', 'WEBP, webp sub']);
    expect(ring()).toBe('Convert');
    expect(said()).toBe('Back to Convert');
    expect(document.querySelector('.wheel')?.getAttribute('data-depth')).toBe('0');
    // Resting on in the hub does nothing more.
    point('hub');
    rest(MOTION.dwell * 3);
    expect(labels()).toHaveLength(4);
  });

  it('never opens rings in a chain while the pointer rests', () => {
    const image: WheelSlice = { id: 'image', label: 'Image', icon: 'image', variants: [PDF, ...FORMATS.slice(0, 2)] };
    const { point, rest, labels, ring, drop, onApply } = setup({ slices: [image, FORMATS[5]!] });
    point(0);
    rest();
    expect(ring()).toBe('Image');
    // PDF, the first target, now lies under the pointer; it waits for the pointer to move on.
    point(0);
    rest(MOTION.dwell * 3);
    expect(ring()).toBe('Image');
    point(120);
    point(0);
    rest();
    expect(ring()).toBe('PDF');
    expect(labels()).toEqual(['One PDF', 'Separate PDFs']);
    drop(0);
    expect(onApply).toHaveBeenCalledWith('one', ['image', 'pdf']);
  });

  it('opens on a mouse at rest in the main window, and the hub takes it back', () => {
    const { rest, labels } = setup({ slices: WITH_PDF });
    const disc = document.querySelector('.wheel-disc')!;
    const move = (deg: number | 'hub') => {
      const [x, y] = deg === 'hub' ? [C, C] : polar(R.LABEL, deg);
      act(() => void fireEvent.pointerMove(disc, { clientX: x, clientY: y, pointerType: 'mouse' }));
    };
    move(0);
    rest();
    expect(labels()).toEqual(['One PDF', 'Separate PDFs']);
    move(2);
    move('hub');
    rest();
    expect(labels()).toHaveLength(4);
  });

  it('opens with Enter or the forward arrow and goes back with the other arrow, Esc or Backspace', () => {
    const { key, labels, focused, said, onApply, onClose } = setup({ slices: WITH_PDF });
    act(() => key('ArrowDown'));
    expect(focused()).toBe('PDF');
    act(() => key('Enter'));
    expect(labels()).toEqual(['One PDF', 'Separate PDFs']);
    expect(focused()).toBe('One PDF');
    expect(said()).toBe('PDF: 2 choices');
    act(() => key('ArrowLeft'));
    expect(labels()).toHaveLength(4);
    expect(focused()).toBe('PDF');
    expect(said()).toBe('Back to Convert');
    act(() => key('ArrowRight'));
    expect(focused()).toBe('One PDF');
    act(() => key('Escape'));
    expect(focused()).toBe('PDF');
    act(() => key('ArrowRight'));
    act(() => key('Backspace'));
    expect(focused()).toBe('PDF');
    // Esc on the first ring closes, as always.
    act(() => key('Escape'));
    act(() => vi.advanceTimersByTime(MOTION.close));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies a variant from the keyboard with its trail', () => {
    const { key, focused, onApply } = setup({ slices: WITH_PDF });
    act(() => key('ArrowDown'));
    act(() => key('ArrowRight'));
    act(() => key('ArrowDown'));
    expect(focused()).toBe('Separate PDFs');
    act(() => key('Enter'));
    expect(onApply).toHaveBeenCalledWith('separate', ['pdf']);
  });

  it('shows a Back control in the hub one level in', () => {
    const { key, labels } = setup({ slices: WITH_PDF });
    expect(document.querySelector('.wheel-back')).toBeNull();
    act(() => key('ArrowDown'));
    act(() => key('Enter'));
    const back = document.querySelector<HTMLButtonElement>('.wheel-back')!;
    expect(back.textContent).toBe('Back');
    act(() => back.click());
    expect(labels()).toHaveLength(4);
    expect(document.querySelector('.wheel-back')).toBeNull();
  });

  it('only opens a category: a click opens it, a drop on it chooses nothing', () => {
    const category: WheelSlice = {
      id: 'video',
      label: 'Video',
      icon: 'video',
      subtitle: '2 files',
      variants: FORMATS.slice(0, 2),
    };
    const first = setup({ slices: [category, FORMATS[4]!] });
    const [x, y] = polar(R.LABEL, 0);
    act(() => void fireEvent.click(document.querySelector('.wheel-disc')!, { clientX: x, clientY: y, button: 0 }));
    expect(first.labels()).toEqual(['JPG, jpg sub', 'PNG, png sub']);
    expect(document.querySelector('.wheel-subtitle')?.textContent).toContain('2 files');
    cleanup();
    const second = setup({ slices: [category, FORMATS[4]!] });
    second.point(0);
    second.drop(0);
    expect(second.onApply).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(MOTION.close));
    expect(second.onClose).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first ring when the host’s slices drop the open one', () => {
    const { key, labels, view, props } = setup({ slices: WITH_PDF });
    act(() => key('ArrowDown'));
    act(() => key('Enter'));
    expect(labels()).toHaveLength(2);
    view.rerender(<Wheel {...props} slices={FORMATS.slice(0, 3)} />);
    expect(labels()).toEqual(['JPG, jpg sub', 'PNG, png sub', 'WEBP, webp sub']);
  });
});

describe('opening and closing a ring', () => {
  const wheel = () => document.querySelector('.wheel')!;
  const level = () => wheel().getAttribute('data-level');
  /** A text in the hub, without the marks that isolate each name. */
  const hubText = (selector: string) => document.querySelector(selector)?.textContent?.replace(/[⁨⁩]/g, '');
  const custom = (element: Element, name: string) => (element as SVGElement).style.getPropertyValue(name);
  const animate = vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => { cancel(): void }>(() => ({
    cancel: () => {},
  }));
  /** The first keyframe of each dial detent. */
  const detents = () => animate.mock.calls.map(([frames]) => frames[0]!.transform);

  beforeEach(() => {
    animate.mockClear();
    vi.mocked(playWheelSound).mockClear();
    // jsdom has no Web Animations; the dial's detent asks for one.
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  });

  it('sweeps the new ring out of the slice and flies the slice to the hub, which keeps the breadcrumb', () => {
    const { key, items } = setup({ slices: WITH_PDF });
    act(() => key('ArrowDown'));
    act(() => key('Enter'));
    expect(level()).toBe('in');
    // The new ring unfolds from its default, at the slice's angle; the other choice, opposite, comes last.
    expect(items().map((item) => custom(item, '--sweep'))).toEqual(['0', '1']);
    expect(items()[1]!.querySelector('.wheel-fade')?.classList.contains('is-in')).toBe(true);
    // The two halves of the slice's keyline run round the ring.
    expect(document.querySelectorAll('.wheel-arm.is-in')).toHaveLength(2);
    // The old ring fades over the new one, but for the slice, whose icon and label fly to the hub.
    const ghost = document.querySelector('.wheel-ghost.is-in')!;
    expect(ghost.textContent).toContain('JPG');
    expect(ghost.textContent).not.toContain('PDF');
    expect(document.querySelector('.wheel-flyer.is-in')?.textContent).toBe('PDF');
    expect(document.querySelector('.wheel-hub-text')?.classList.contains('is-in')).toBe(true);
    expect(hubText('.wheel-trail')).toBe('Convert ›');
    expect(hubText('.wheel-title')).toBe('PDF');
    expect(detents()).toEqual(['rotate(-14.4deg)']);
    act(() => vi.advanceTimersByTime(MOTION.level - 1));
    expect(level()).toBe('in');
    act(() => vi.advanceTimersByTime(1));
    expect(wheel().hasAttribute('data-level')).toBe(false);
    expect(document.querySelector('.wheel-ghost, .wheel-flyer, .wheel-arm')).toBeNull();
    // The breadcrumb stays while the wheel is inside.
    expect(hubText('.wheel-trail')).toBe('Convert ›');
    // The screen reader hears the ring as before.
    expect(document.querySelector('.wheel-sr')?.textContent).toBe('PDF: 2 choices');
  });

  it('folds the ring back into its slice and flies the title home', () => {
    const { key, items, said } = setup({ slices: WITH_PDF });
    act(() => key('ArrowDown'));
    act(() => key('Enter'));
    act(() => vi.advanceTimersByTime(MOTION.level));
    act(() => key('ArrowLeft'));
    expect(level()).toBe('out');
    // The ring left behind folds into the choice at the slice's angle, the farthest first.
    const ghost = document.querySelector('.wheel-ghost.is-out')!;
    const first = (slice: Element) => slice.querySelector('.wheel-label')?.textContent;
    expect([...ghost.children].map(first)).toEqual(['One PDF', 'Separate']);
    expect([...ghost.children].map((slice) => custom(slice, '--fold'))).toEqual(['1', '0']);
    expect(document.querySelectorAll('.wheel-arm.is-out')).toHaveLength(2);
    expect(document.querySelector('.wheel-flyer.is-out')?.textContent).toBe('PDF');
    // The ring below returns to the slice, which the keyboard's hover already shows.
    expect(items()[0]!.classList.contains('is-origin')).toBe(true);
    expect(items()[0]!.querySelector('.wheel-fade')?.classList.contains('is-out')).toBe(true);
    expect(document.querySelector('.wheel-wash')).toBeNull();
    expect(document.querySelector('.wheel-hub-text')?.classList.contains('is-out')).toBe(true);
    expect(document.querySelector('.wheel-trail')).toBeNull();
    expect(hubText('.wheel-title')).toBe('CONVERT');
    expect(detents()).toEqual(['rotate(-14.4deg)', 'rotate(14.4deg)']);
    expect(said()).toBe('Back to Convert');
    act(() => vi.advanceTimersByTime(MOTION.level));
    expect(wheel().hasAttribute('data-level')).toBe(false);
  });

  it('lights the slice up when the ring closes from the hub, where nothing points at it', () => {
    const { point, rest, items } = setup({ slices: WITH_PDF });
    point(0);
    rest();
    point(0);
    point('hub');
    rest();
    expect(level()).toBe('out');
    expect(items()[0]!.classList.contains('is-wash')).toBe(true);
    expect(items()[0]!.querySelector('.wheel-wash')).not.toBeNull();
    expect(items()[1]!.querySelector('.wheel-wash')).toBeNull();
  });

  it('mirrors the dial’s detent right to left', async () => {
    await act(() => changeLanguage('ar-XB'));
    const { key } = setup({ slices: WITH_PDF });
    act(() => key('ArrowDown'));
    act(() => key('ArrowLeft'));
    act(() => key('ArrowRight'));
    expect(detents()).toEqual(['rotate(14.4deg)', 'rotate(-14.4deg)']);
  });

  it('cross-fades without a detent, a sweep or a flight when motion is reduced', () => {
    const { key } = setup({ slices: WITH_PDF, reducedMotion: true });
    act(() => key('ArrowDown'));
    act(() => key('Enter'));
    expect(wheel().classList.contains('is-reduced')).toBe(true);
    expect(level()).toBe('in');
    expect(document.querySelector('.wheel-ghost.is-in')).not.toBeNull();
    expect(document.querySelector('.wheel-flyer, .wheel-arm')).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    // The breadcrumb tells where the wheel is.
    expect(hubText('.wheel-trail')).toBe('Convert ›');
    act(() => vi.advanceTimersByTime(MOTION.reduced.level));
    expect(wheel().hasAttribute('data-level')).toBe(false);
    act(() => key('Escape'));
    expect(level()).toBe('out');
    expect(document.querySelector('.wheel-flyer, .wheel-arm')).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it('sounds a deeper detent going in and a lighter one coming back, and taps the trackpad', () => {
    const onTick = vi.fn();
    const sound = { enabled: true, volume: 0.3 };
    const { key } = setup({ slices: WITH_PDF, sound, onTick });
    const heard = () => vi.mocked(playWheelSound).mock.calls.map(([name]) => name);
    act(() => key('ArrowDown'));
    vi.mocked(playWheelSound).mockClear();
    onTick.mockClear();
    act(() => key('Enter'));
    expect(heard()).toEqual(['enter']);
    expect(playWheelSound).toHaveBeenCalledWith('enter', sound);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.mocked(playWheelSound).mockClear();
    act(() => key('Escape'));
    expect(heard()).toEqual(['leave']);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('still clicks once for a new page', () => {
    const { key } = setup({ slices: FORMATS });
    act(() => key('End'));
    vi.mocked(playWheelSound).mockClear();
    act(() => key('Enter'));
    expect(vi.mocked(playWheelSound).mock.calls.map(([name]) => name)).toEqual(['tick']);
    expect(wheel().hasAttribute('data-level')).toBe(false);
  });

  it('lets a drop during the sweep land on the slice under the pointer', () => {
    const { point, rest, drop, onApply } = setup({ slices: WITH_PDF });
    point(0);
    rest();
    expect(level()).toBe('in');
    point(180);
    drop(180);
    expect(level()).toBe('in');
    expect(onApply).toHaveBeenCalledWith('separate', ['pdf']);
  });

  it('keeps the whole trail in the hub two rings in, and lets the outer rings give way when it is long', () => {
    const image: WheelSlice = { id: 'image', label: 'Image', icon: 'image', variants: [PDF, ...FORMATS.slice(0, 2)] };
    const { key } = setup({ slices: [image, FORMATS[5]!] });
    act(() => key('ArrowDown'));
    act(() => key('Enter'));
    expect(hubText('.wheel-trail')).toBe('Convert ›');
    expect(hubText('.wheel-title')).toBe('IMAGE');
    act(() => key('Enter'));
    expect(hubText('.wheel-trail')).toBe('Convert › Image ›');
    expect(hubText('.wheel-title')).toBe('PDF');
    cleanup();
    const long = setup({ title: 'Convert every file', slices: [image, FORMATS[5]!] });
    act(() => long.key('ArrowDown'));
    act(() => long.key('Enter'));
    act(() => long.key('Enter'));
    expect(hubText('.wheel-trail')).toBe('… › Image ›');
  });
});
