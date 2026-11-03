// SPDX-License-Identifier: MIT
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { layoutSlices } from '../../wheel/geometry';
import type { ThemeConcept, WheelModel } from './contract';
import { buildModel, themeTimings } from './model';
import type { PackTheme } from './packs';
import { ThemeFace, type FacePhase } from './ThemeFace';

function pack() {
  const wheel = {
    render: vi.fn((root: SVGGElement, m: WheelModel, H) => {
      for (const sl of m.slices) H.s('path', { d: H.sector(60, 190, sl.a0, sl.a1) }, H.slice(root, sl, m));
    }),
    update: vi.fn(),
    onOpen: vi.fn(),
    onSelect: vi.fn(),
  };
  const concept = {
    id: 'test',
    fonts: { brand: "'Test Sans'" },
    palette: { light: { bg: '#ffffff', text: '#000000' }, dark: { bg: '#000000', text: '#ffffff' } },
    motion: { open: 150, close: 100, stagger: 10, apply: 400 },
    defs: '<linearGradient id="test-g"/>',
    wheel,
  } as unknown as ThemeConcept;
  const theme: PackTheme = {
    id: 'test',
    concept,
    css: '.wheel { color: red; }',
    timings: themeTimings(concept.motion),
  };
  return { theme, wheel };
}

const model = (count: number) =>
  buildModel({
    kind: 'tools',
    lang: 'en',
    dir: 'ltr',
    title: 'Tools',
    file: 'photo.jpg',
    key: 'Ctrl',
    geometry: layoutSlices(count, 'ltr'),
    slices: Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      label: `S${i}`,
      off: false,
      ring: false,
      format: false,
    })),
  });

describe('a theme’s wheel in the app', () => {
  it('draws into a shadow root of its own and follows the wheel’s phases', () => {
    vi.useFakeTimers();
    const { theme, wheel } = pack();
    const m = model(4);
    const props = {
      theme,
      mode: 'dark' as const,
      model: m,
      hover: null as number | null,
      selected: null as number | null,
      generation: 0,
      applied: 0,
      denied: 0,
      reduced: false,
    };
    const view = render(<ThemeFace {...props} phase="opening" />);
    const shadow = view.container.querySelector('.wheel-theme')!.shadowRoot!;
    const scope = shadow.querySelector<HTMLElement>('[data-concept="test"]')!;
    const wrap = shadow.querySelector<HTMLElement>('.wheel')!;
    expect(scope.dataset.theme).toBe('dark');
    expect(scope.style.getPropertyValue('--bg')).toBe('#000000');
    expect(scope.style.getPropertyValue('--font-brand-face')).toBe("'Test Sans'");
    expect(shadow.querySelector('#test-g')).not.toBeNull();
    expect(shadow.querySelector('svg.wheel-svg[viewBox="0 0 400 400"] g.wheel-root')).not.toBeNull();
    expect(shadow.querySelectorAll('.slice')).toHaveLength(4);
    expect(wheel.render).toHaveBeenCalledTimes(1);
    expect(wrap.classList.contains('is-opening')).toBe(true);
    expect(wheel.onOpen).toHaveBeenCalledWith(expect.anything(), m, expect.anything(), false);

    const rerender = (phase: FacePhase, change: Partial<typeof props> = {}) => {
      Object.assign(props, change);
      view.rerender(<ThemeFace {...props} phase={phase} />);
    };
    rerender('open', { hover: 2 });
    expect(wrap.className).toContain('is-open');
    expect(wrap.classList.contains('has-hover')).toBe(true);
    expect(shadow.querySelector('[data-slice="2"]')!.classList.contains('is-hover')).toBe(true);
    expect(wheel.update).toHaveBeenLastCalledWith(
      expect.anything(),
      m,
      { hover: 2, selected: null },
      expect.anything(),
    );

    rerender('applying', { selected: 2, applied: 1 });
    expect(wrap.classList.contains('is-applying')).toBe(true);
    expect(wrap.classList.contains('has-selected')).toBe(true);
    expect(wheel.onSelect).toHaveBeenCalledWith(expect.anything(), m, 2, expect.anything());
    rerender('applied');
    expect(wrap.classList.contains('is-applying')).toBe(false);

    rerender('open', { denied: 1 });
    expect(wrap.classList.contains('is-denied')).toBe(true);

    // A new ring: drawn again and opened with the theme's own animation, then open.
    const next = model(3);
    rerender('open', { model: next, generation: 1, hover: null, selected: null });
    expect(wheel.render).toHaveBeenCalledTimes(2);
    expect(shadow.querySelectorAll('.slice')).toHaveLength(3);
    expect(wrap.classList.contains('is-opening')).toBe(true);
    act(() => void vi.advanceTimersByTime(theme.timings.open(3, false) + 40));
    expect(wrap.classList.contains('is-open')).toBe(true);

    rerender('closing');
    expect(wrap.classList.contains('is-closing')).toBe(true);
    vi.useRealTimers();
  });

  it('points at and chooses the mark of a slice that opens a ring, also outside its slice', () => {
    const { theme, wheel } = pack();
    wheel.render.mockImplementation((root: SVGGElement, m: WheelModel, H) => {
      for (const sl of m.slices) H.s('path', { d: H.sector(60, 190, sl.a0, sl.a1) }, H.slice(root, sl, m));
      const layer = H.s('g', { class: 'labels' }, root);
      for (const sl of m.slices) H.ringMark(layer, sl, m, { r: 170 });
    });
    const m = buildModel({
      kind: 'convert',
      lang: 'en',
      dir: 'ltr',
      title: 'Convert',
      file: 'photo.jpg',
      key: 'Shift',
      geometry: layoutSlices(3, 'ltr'),
      slices: ['jpg', 'png', 'webp'].map((id) => ({ id, label: id, off: false, ring: id !== 'png', format: true })),
    });
    const props = { theme, mode: 'light' as const, model: m, generation: 0, applied: 0, denied: 0, reduced: false };
    const view = render(<ThemeFace {...props} phase="still" hover={null} selected={null} />);
    const shadow = view.container.querySelector('.wheel-theme')!.shadowRoot!;
    const marks = [...shadow.querySelectorAll<SVGGElement>('.labels .ring-mark')];
    expect(marks.map((mark) => mark.dataset.ringMark)).toEqual(['0', '2']);
    view.rerender(<ThemeFace {...props} phase="still" hover={2} selected={0} />);
    expect(marks[1]!.classList.contains('is-hover')).toBe(true);
    expect(marks[0]!.classList.contains('is-selected')).toBe(true);
    expect(marks[0]!.classList.contains('is-hover')).toBe(false);
  });

  it('fades with reduced motion, rests without an animation as a still, and survives a theme that throws', () => {
    const { theme, wheel } = pack();
    const props = {
      theme,
      mode: 'light' as const,
      model: model(2),
      hover: null,
      selected: null,
      generation: 0,
      applied: 0,
      denied: 0,
    };
    const reduced = render(<ThemeFace {...props} phase="opening" reduced />);
    expect(reduced.container.querySelector('.wheel-theme')!.shadowRoot!.querySelector('.wheel')!.className).toContain(
      'is-opening-reduced',
    );
    const still = render(<ThemeFace {...props} phase="still" reduced={false} />);
    expect(still.container.querySelector('.wheel-theme')!.shadowRoot!.querySelector('.wheel')!.className).toContain(
      'is-open',
    );
    expect(wheel.onOpen).toHaveBeenCalledTimes(1);

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    wheel.render.mockImplementation(() => {
      throw new Error('broken');
    });
    expect(() => render(<ThemeFace {...props} phase="opening" reduced={false} />)).not.toThrow();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
