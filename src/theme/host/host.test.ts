// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import catalog from '../catalog.json';
import { hitTest, layoutSlices, offsetFor, polar as appPolar, type Direction } from '../../wheel/geometry';
import { definePack, DEFAULT_PAIRS } from './board';
import { createHelpers, polar, sector } from './helpers';
import { ICONS, iconMarkup } from './icons';
import { buildModel, themeTimings } from './model';
import { loadPack } from './packs';
import { SFX } from './sfx';

const slices = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    label: `Slice ${i}`,
    off: false,
    ring: false,
    format: false,
  }));

function model(count: number, dir: Direction, offset = 0) {
  return buildModel({
    kind: 'tools',
    lang: dir === 'rtl' ? 'ar' : 'en',
    dir,
    title: 'Tools',
    file: 'photo.jpg',
    key: 'Ctrl',
    slices: slices(count),
    geometry: layoutSlices(count, dir, offset),
  });
}

describe('the model a theme draws', () => {
  it('puts every slice where the app points and finds it', () => {
    for (const dir of ['ltr', 'rtl'] as const)
      for (const count of [1, 2, 3, 5, 8])
        for (const offset of [0, offsetFor(135, 2, count, dir)]) {
          const m = model(count, dir, offset);
          expect(m.n).toBe(count);
          expect(m.step).toBe(360 / count);
          m.slices.forEach((slice, i) => {
            expect(slice.a1 - slice.a0).toBeCloseTo(360 / count);
            expect(slice.mid).toBeCloseTo((slice.a0 + slice.a1) / 2);
            // The middle of the theme's slice is the app's slice under the pointer.
            const [x, y] = appPolar(120, slice.mid);
            expect(hitTest(x, y, count, dir, offset), `${dir} ${count} ${i}`).toBe(i);
            // The theme's polar() is the app's.
            expect(polar(120, slice.mid)[0]).toBeCloseTo(x);
          });
        }
  });

  it('starts at twelve o’clock and turns clockwise, or counterclockwise right to left', () => {
    expect(model(4, 'ltr').slices.map((s) => s.mid)).toEqual([0, 90, 180, 270]);
    expect(model(4, 'rtl').slices.map((s) => s.mid)).toEqual([0, -90, -180, -270]);
    expect(model(4, 'rtl').dir).toBe('rtl');
  });

  it('carries the labels, the hub and what each slice is', () => {
    const m = buildModel({
      kind: 'convert',
      lang: 'tr',
      dir: 'ltr',
      title: 'Dönüştür',
      file: 'foto.heic',
      key: 'Shift',
      geometry: layoutSlices(2, 'ltr'),
      slices: [
        { id: 'png', label: 'PNG', sub: 'Kayıpsız', tip: 'PNG: kayıpsız', off: false, ring: true, format: true },
        { id: 'remove-background', label: 'Arka planı kaldır', icon: 'cutout', off: true, ring: false, format: false },
      ],
    });
    expect(m).toMatchObject({ kind: 'convert', lang: 'tr', title: 'Dönüştür', file: 'foto.heic', key: 'Shift' });
    expect(m.slices[0]).toMatchObject({ i: 0, id: 'png', sub: 'Kayıpsız', icon: 'file', ring: true, format: true });
    expect(m.slices[1]).toMatchObject({ i: 1, sub: null, icon: 'cutout', tip: '', off: true });
  });
});

describe('the timings of a theme', () => {
  it('follow its motion, and fade when motion is reduced', () => {
    const timings = themeTimings({ open: 180, close: 120, stagger: 12, apply: 640 });
    expect(timings.open(8, false)).toBe(180 + 12 * 7);
    expect(timings.open(1, false)).toBe(180);
    expect(timings.open(8, true)).toBe(100);
    expect(timings.apply(false)).toBe(640);
    expect(timings.apply(true)).toBe(0);
    // The wheel closes 450 ms after the effect, and never sooner than 650 ms after the apply.
    expect(timings.hold(false)).toBe(450);
    expect(themeTimings({ open: 150, close: 100, stagger: 10, apply: 120 }).hold(false)).toBe(530);
    expect(timings.hold(true)).toBe(650);
    expect(timings.close(false)).toBe(150);
    expect(timings.close(true)).toBe(120);
    expect(themeTimings({ open: 150, close: 100, stagger: 10 }).apply(false)).toBe(0);
  });

  it('of every theme keep the wheel on screen within the open budget', async () => {
    for (const entry of catalog.slice(1)) {
      const theme = (await loadPack(entry.pack!)).get(entry.id)!;
      const { motion } = theme.concept;
      expect(motion.open, entry.id).toBeLessThanOrEqual(200);
      expect(motion.apply ?? 0, entry.id).toBeLessThanOrEqual(800);
      expect(theme.timings.open(8, false), entry.id).toBe(motion.open + motion.stagger * 7);
    }
  });
});

describe('the board a pack registers with', () => {
  it('fills in default timings and hands out its own copy of the contrast pairs', () => {
    const defined = definePack((board) => {
      board.DEFAULT_PAIRS.push(['a', 'b', 'ui']);
      board.define({ id: 'x', motion: { open: 120 } } as never);
    });
    expect(defined[0]!.motion).toEqual({ open: 120, close: 110, stagger: 12 });
    expect(DEFAULT_PAIRS).toHaveLength(11);
  });
});

describe('the drawing helpers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draw a whole ring for a wheel of one slice', () => {
    expect(sector(60, 180, -180, 180)).toContain('a180 180 0 1 1');
    expect(sector(60, 180, 0, 90)).toMatch(/^M200 20A180 180 0 0 1 380 200L260 200A60 60 0 0 0 200 140Z$/);
  });

  it('shrink, wrap and, past the smallest size, shorten a label', () => {
    // Every character is 10 units wide at size 14, in proportion to the font size.
    Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
      configurable: true,
      value(this: SVGElement) {
        const size = Number((this.closest('text') ?? this).getAttribute('font-size') ?? 14);
        return (this.textContent ?? '').length * 10 * (size / 14);
      },
    });
    const H = createHelpers();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const short = H.label(svg, 200, 200, 'Crop', { maxWidth: 80, size: 14 });
    expect(short.getAttribute('font-size')).toBe('14');
    const wrapped = H.label(svg, 200, 200, 'Remove background', { maxWidth: 110, size: 14, minSize: 9 });
    expect(wrapped.querySelectorAll('tspan')).toHaveLength(2);
    const long = H.label(svg, 200, 200, 'Hintergrundentfernung', { maxWidth: 60, size: 14, minSize: 9, maxLines: 1 });
    expect(long.textContent!.endsWith('…')).toBe(true);
    expect(long.getAttribute('data-fit')).toBe('shortened');
    expect(long.getAttribute('aria-label')).toBe('Hintergrundentfernung');
    delete (SVGElement.prototype as { getComputedTextLength?: unknown }).getComputedTextLength;
  });

  it('draw the app’s icons, a theme’s own first', () => {
    expect(iconMarkup('image')).toBe(ICONS.image);
    expect(iconMarkup('settings')).toBe(ICONS.gear);
    expect(iconMarkup('scissors')).toContain('<path d="M9 6.5');
    expect(iconMarkup('no-such-icon')).toBe(ICONS.file);
    expect(iconMarkup('crop', { crop: '<circle r="1"/>' })).toBe('<circle r="1"/>');
    const g = createHelpers({ more: '<rect/>' }).icon(
      document.createElementNS('http://www.w3.org/2000/svg', 'g'),
      'more',
      100,
      50,
      24,
    );
    expect(g.innerHTML).toBe('<rect></rect>');
    expect(g.getAttribute('transform')).toBe('translate(88 38) scale(1)');
  });
});

describe('the sound helpers', () => {
  it('start every gain silent, so no sound begins with a click', () => {
    const gains: { value: number; first?: number }[] = [];
    const param = () => ({
      value: 1,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    });
    const node = () => ({ connect: (next: unknown) => next });
    const ac = {
      sampleRate: 8000,
      createGain: () => {
        const gain = { ...node(), gain: param() };
        gains.push(gain.gain);
        return gain;
      },
      createOscillator: () => ({
        ...node(),
        type: '',
        frequency: param(),
        detune: param(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createBufferSource: () => ({ ...node(), buffer: null, start: vi.fn(), stop: vi.fn() }),
      createBiquadFilter: () => ({ ...node(), type: '', frequency: param(), Q: param() }),
      createBuffer: (_: number, length: number) => ({
        sampleRate: 8000,
        getChannelData: () => new Float32Array(length),
      }),
    } as unknown as AudioContext;
    SFX.tone(ac, {} as AudioNode, 0, { f: 440 });
    SFX.burst(ac, {} as AudioNode, 0, { f: 2000 });
    expect(gains.map((gain) => gain.value)).toEqual([0, 0]);
  });
});
