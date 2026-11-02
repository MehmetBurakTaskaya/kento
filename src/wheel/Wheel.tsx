// SPDX-License-Identifier: MIT
// The wheel (design/DESIGN.md, section 5): a brushed-steel combination dial round a white enamel face,
// shown as a modal over the main window. Each slice is a target format or a tool. Pointing or the arrow
// keys turn the dial to a slice; applying one turns the vault handle and throws the bolts, then the
// wheel closes. A slice may hold a ring of choices (its variants, a category's targets): resting on
// it, Enter or the arrow in the reading direction opens that ring in place, unfolded from the slice,
// and resting on the hub, Esc or the other arrow goes back a level. Every visible or spoken text
// comes from the props or the locale files.
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../components/Icon';
import { intlLocale, isRtl } from '../i18n';
import { Face, type FaceSlice } from './Face';
import {
  C,
  fx,
  hitTest,
  layoutSlices,
  MAX_SLICES,
  offsetFor,
  polar,
  R,
  restAngle,
  toView,
  turnTo,
  VIEW,
  type Direction,
} from './geometry';
import { keyAction } from './keys';
import { canvasMeasure, fitLabel, layoutBlock, type Measure } from './labels';
import { closeDuration, MOTION, openDuration } from './motion';
import { clampPage, PAGE_SIZE, pageCount, pageItems } from './paging';
import { Bolts, DialIndex, DialScale, FixedRing, Glint, Handle, HubCap } from './parts';
import { armWheelAudio, playWheelSound } from './sound';
import './wheel.css';

export interface WheelSlice {
  id: string;
  /** For example "JPG", or a tool name (already translated). */
  label: string;
  /** For example "lossless". */
  sublabel?: string;
  icon?: IconName;
  /** The description bubble, for example "PNG: lossless, keeps transparency". */
  hint?: string;
  disabled?: boolean;
  /** Shown faded but still applies (its tool group is not installed; applying offers the setup). */
  dimmed?: boolean;
  /** A ring of choices, a level further in (and so on): resting on the slice, Enter or the arrow in
   *  the reading direction opens it; resting on the hub, Esc or the other arrow comes back. */
  variants?: WheelSlice[];
  /** The variant a plain drop or click on the slice applies without opening its ring, so quick use
   *  stays quick. Without one the slice only opens its ring (a category). */
  default?: string;
  /** The hub's second line while the slice's ring is open (a category's files); the wheel's
   *  subtitle otherwise. */
  subtitle?: string;
}

/** Drives the wheel from outside during a system drag, when no pointer events reach the page. */
export interface WheelControl {
  /** The drag is over this point, in CSS pixels of the window. */
  point(x: number, y: number): void;
  /** The drag dropped here: the slice under it applies (a slice with choices its default), anywhere
   *  else the wheel closes. */
  drop(x: number, y: number): void;
  /** The drag left the window. */
  leave(): void;
  close(): void;
}

export interface WheelProps {
  kind: 'convert' | 'tools';
  /** The hub title, for example "Convert". */
  title: string;
  /** For example the file name or "3 files". */
  subtitle?: string;
  /** Any number; with more than eight, seven per page and a "More…" slice pages through the rest. */
  slices: WheelSlice[];
  /** Called as soon as a slice is applied, with the slices whose rings led to it, outermost first
   *  (empty on the first ring). A handler that swaps the slices turns the wheel to the new ring
   *  instead of locking it. */
  onApply(id: string, trail: string[]): void;
  /** Called once the close or apply animation has ended. */
  onClose(): void;
  sound: { enabled: boolean; volume: number };
  reducedMotion: boolean;
  /** CSS pixels, 300 to 440; the wheel also shrinks to fit a small window. */
  size?: number;
  /** Floating over other apps in its own transparent window: no dimmed backdrop. */
  overlay?: boolean;
  control?: Ref<WheelControl>;
  /** Called when the dial turns to an available slice (a haptic tap on macOS trackpads). */
  onTick?: () => void;
}

type Phase = 'opening' | 'open' | 'applying' | 'applied' | 'closing' | 'closed';

interface Item extends Omit<WheelSlice, 'id' | 'disabled'> {
  key: string;
  id: string | null;
  disabled: boolean;
  paging: { target: number } | null;
}

/** One ring opened inside another. */
interface Level {
  /** The slice that opened it. */
  id: string;
  /** Where that slice sat in the ring below, to come back to. */
  index: number;
  page: number;
  /** Its angle: the new ring unfolds from there. */
  at: number;
  /** The slice of the new ring at that angle: the default, else the first. */
  anchor: number;
}

/** The ring the levels lead to and the slices that opened them; null when the slices changed under
 *  the levels. */
function resolve(root: WheelSlice[], levels: Level[]): { ring: WheelSlice[]; parents: WheelSlice[] } | null {
  let ring = root;
  const parents: WheelSlice[] = [];
  for (const level of levels) {
    const parent = ring.find((slice) => slice.id === level.id);
    if (!parent?.variants?.length) return null;
    parents.push(parent);
    ring = parent.variants;
  }
  return { ring, parents };
}

const opensRing = (item: { variants?: WheelSlice[]; disabled?: boolean } | null | undefined) =>
  !!item?.variants?.length && !item.disabled;

/** The variant that sits where its slice was: the default, when it is on the first page. */
function anchorOf(item: { variants?: WheelSlice[]; default?: string }): number {
  const variants = item.variants ?? [];
  const at = item.default ? variants.findIndex((variant) => variant.id === item.default) : 0;
  return at >= 0 && (variants.length <= MAX_SLICES || at < PAGE_SIZE) ? at : 0;
}

const keyOf = (kind: string, title: string, levels: Level[], ring: WheelSlice[]) =>
  [kind, title, ...levels.map((level) => level.id), '', ...ring.map((slice) => slice.id)].join('\u0001');

/** What the pointer rests on: a slice, the hub, or nothing. */
type Spot = number | 'hub' | null;

/** Icons that point along the reading direction mirror in right-to-left layouts. */
const DIRECTIONAL = new Set<IconName>(['back', 'restart', 'move']);
// File names are bidi-isolated wherever they appear (design/DESIGN.md, section 10).
const isolate = (text: string) => `⁨${text}⁩`;
const NO_SPACING = /^(ar|ja|zh|ko)\b/;

function brandFamily(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--font-brand').trim() || 'sans-serif';
}

function makeMeasures(lang: string, fontsReady: boolean) {
  const family = brandFamily();
  // Until the brand face has loaded the canvas measures a fallback, so nothing is cached yet.
  const make = (weight: number, spacing = 0): Measure => {
    const spec = { family, weight, spacing };
    return fontsReady ? canvasMeasure(spec) : (text) => canvasMeasure(spec)(text);
  };
  return {
    format: make(600, 0.04),
    label: make(500),
    sub: make(450, 0.01),
    title: make(600, NO_SPACING.test(lang) ? 0 : 0.14),
    file: make(450),
  };
}

export function Wheel({
  kind,
  title,
  subtitle,
  slices,
  onApply,
  onClose,
  sound,
  reducedMotion,
  size = 360,
  overlay = false,
  control,
  onTick,
}: WheelProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const locale = intlLocale(lang);
  const dir: Direction = isRtl(lang) ? 'rtl' : 'ltr';
  const uid = `wheel${useId().replace(/[^\w-]/g, '')}`;

  // The levels opened inside the first ring; they fall back to it when the slices change under them.
  const [trail, setTrail] = useState<Level[]>([]);
  const resolved = resolve(slices, trail);
  if (!resolved && trail.length) setTrail([]);
  const levels = resolved ? trail : [];
  const { ring, parents } = resolved ?? { ring: slices, parents: [] };
  const level = levels[levels.length - 1];
  const parent = parents[parents.length - 1];
  const depth = levels.length;
  const path = levels.map((l) => l.id);
  const shownTitle = parent?.label ?? title;
  const shownSubtitle = parent ? (parent.subtitle ?? subtitle) : subtitle;

  const contentKey = keyOf(kind, title, levels, ring);
  const [shownKey, setShownKey] = useState(contentKey);
  const [phase, setPhase] = useState<Phase>('opening');
  const [pageState, setPage] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dial, setDial] = useState(() => restAngle(pageItems(slices, 0).length, dir));
  const [generation, setGeneration] = useState(0);
  const [applied, setApplied] = useState(0);
  const [keyboard, setKeyboard] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [lastTip, setLastTip] = useState('');
  const [fontsReady, setFontsReady] = useState(() => !document.fonts || document.fonts.status === 'loaded');

  /** Where slice 1 of a page sits: a ring opened from a slice turns so that its first page unfolds
   *  from there, with its default where the pointer rested. */
  const offsetOf = (on: Level | undefined, onPage: number, count: number) =>
    on ? offsetFor(on.at, onPage === 0 ? on.anchor : 0, count, dir) : 0;

  // New slices from the host while open: show the new ring from its first page instead of locking
  // the old one.
  if (shownKey !== contentKey) {
    setShownKey(contentKey);
    setPage(0);
    setHover(null);
    setSelected(null);
    setGeneration((n) => n + 1);
    const first = pageItems(ring, 0).length;
    setDial((angle) => turnTo(angle, restAngle(first, dir, offsetOf(level, 0, first))));
    if (phase === 'applying' || phase === 'applied') setPhase('open');
  }

  const pages = pageCount(ring.length);
  const page = clampPage(pageState, ring.length);
  const items = useMemo<Item[]>(
    () =>
      pageItems(ring, page).map((item) =>
        item.type === 'slice'
          ? { ...item.slice, key: item.slice.id, disabled: !!item.slice.disabled, paging: null }
          : {
              key: item.wraps ? '\u0001first' : '\u0001more',
              id: null,
              label: t(item.wraps ? 'wheel.first' : 'wheel.more'),
              icon: item.wraps ? 'restart' : 'more',
              hint: item.wraps ? t('wheel.first.hint') : t('wheel.more.hint', { count: item.remaining }),
              disabled: false,
              paging: { target: item.target },
            },
      ),
    [ring, page, t],
  );
  const count = items.length;
  const offset = offsetOf(level, page, count);
  const geometry = useMemo(() => layoutSlices(count, dir, offset), [count, dir, offset]);

  const measures = useMemo(() => makeMeasures(lang, fontsReady), [lang, fontsReady]);
  const numerals = useMemo(() => new Intl.NumberFormat(locale, { useGrouping: false }), [locale]);
  const dialNumbers = useMemo(() => Array.from({ length: 9 }, (_, k) => numerals.format((k + 1) * 10)), [numerals]);

  const faceSlices = useMemo<FaceSlice[]>(() => {
    const names = new Intl.ListFormat(locale, { type: 'unit', style: 'short' });
    return items.map((item, i) => {
      const g = geometry[i]!;
      const format = kind === 'convert' && !item.paging && (!!item.sublabel || !item.icon);
      const hint = item.hint || (item.disabled ? t('wheel.unavailable') : undefined);
      return {
        key: item.key,
        geometry: g,
        numeral: numerals.format(i + 1),
        icon: item.icon,
        flipIcon: dir === 'rtl' && !!item.icon && DIRECTIONAL.has(item.icon),
        disabled: item.disabled,
        dimmed: !!item.dimmed,
        // Off the centre line, towards the next slice, where no label reaches.
        ringMark: opensRing(item)
          ? g.mid + (dir === 'rtl' ? -1 : 1) * Math.min(16, Math.max(6, g.step * 0.36))
          : undefined,
        format,
        block: layoutBlock(
          { label: item.label, sublabel: item.sublabel, icon: !!item.icon, format },
          polar(R.LABEL, g.mid),
          measures,
        ),
        name: item.sublabel ? names.format([item.label, item.sublabel]) : item.label,
        describedBy: hint ? `${uid}-hint-${i}` : undefined,
      };
    });
  }, [items, geometry, kind, measures, numerals, locale, dir, t, uid]);

  const hub = useMemo(() => {
    const fittedTitle = fitLabel(
      shownTitle.toLocaleUpperCase(locale),
      { size: 11.5, minSize: 7.5, maxWidth: 86, maxLines: 1 },
      measures.title,
    );
    const fittedSubtitle = shownSubtitle
      ? fitLabel(shownSubtitle, { size: 11, minSize: 8, maxWidth: 90, maxLines: 1, truncate: 'middle' }, measures.file)
      : null;
    return {
      title: { text: fittedTitle.lines[0]!, size: fittedTitle.size },
      subtitle: fittedSubtitle ? { text: isolate(fittedSubtitle.lines[0]!), size: fittedSubtitle.size } : null,
    };
  }, [shownTitle, shownSubtitle, locale, measures]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<SVGSVGElement>(null);
  const itemRefs = useRef<(SVGGElement | null)[]>([]);
  const soundRef = useRef(sound);
  const onCloseRef = useRef(onClose);
  const openSoundPlayed = useRef(false);
  const applySoundPlayed = useRef(0);
  const firstGeneration = useRef(generation);

  useEffect(() => {
    soundRef.current = sound;
    onCloseRef.current = onClose;
  });

  useEffect(() => (sound.enabled ? armWheelAudio() : undefined), [sound.enabled]);

  useEffect(() => {
    if (fontsReady || !document.fonts) return;
    let live = true;
    void document.fonts.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, [fontsReady]);

  // Focus moves into the wheel and goes back where it was when the wheel leaves.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (openSoundPlayed.current) return;
    openSoundPlayed.current = true;
    playWheelSound('open', soundRef.current);
  }, []);

  // The keyboard hover is the pointer hover: the hovered slice holds the focus, so a screen reader
  // reads it and Enter applies the slice the dial points at. When a new ring replaces the focused
  // slice, the focus goes back to the menu instead of falling out of the wheel.
  useEffect(() => {
    const slice = hover === null ? null : itemRefs.current[hover];
    const inside = dialogRef.current?.contains(document.activeElement);
    const target = slice ?? (inside ? null : menuRef.current);
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [hover, generation]);

  useEffect(() => {
    if (generation === firstGeneration.current) return;
    firstGeneration.current = generation;
    playWheelSound('tick', soundRef.current);
  }, [generation]);

  useEffect(() => {
    if (applied === applySoundPlayed.current) return;
    applySoundPlayed.current = applied;
    if (phase === 'applying' || phase === 'applied') playWheelSound('apply', soundRef.current);
  }, [applied, phase]);

  // The phases follow the timings of design/DESIGN.md, section 6.
  useEffect(() => {
    const steps: Partial<Record<Phase, [number, Phase]>> = {
      opening: [openDuration(count, reducedMotion) + 30, 'open'],
      applying: [MOTION.apply, 'applied'],
      applied: [MOTION.hold, 'closing'],
      closing: [closeDuration(reducedMotion), 'closed'],
    };
    const step = steps[phase];
    if (!step) return;
    const timer = window.setTimeout(() => {
      setPhase(step[1]);
      if (step[1] === 'closed') onCloseRef.current();
    }, step[0]);
    return () => window.clearTimeout(timer);
  }, [phase, count, reducedMotion]);

  const interactive = phase === 'opening' || phase === 'open';

  // Resting acts: on a slice with choices it opens them, on the hub it goes back a level, and during
  // a drag (where nothing can be clicked) on "More…" it pages. Once a rest has acted, whatever lies
  // under the pointer in the new ring waits until the pointer moves on, so rings never open in a
  // chain.
  const dwell = useRef<{ spot: Spot; timer: number; settled: boolean }>({ spot: null, timer: 0, settled: false });
  // The ring changed and is not drawn yet: pointer positions would still meet the old one.
  const stale = useRef(false);
  const restOn = useRef<(spot: Spot) => void>(() => {});
  const settle = () => {
    window.clearTimeout(dwell.current.timer);
    dwell.current = { spot: null, timer: 0, settled: true };
    stale.current = true;
  };

  const hoverTo = (index: number | null) => {
    if (index === hover) return;
    setHover(index);
    if (index === null) return;
    setDial((angle) => turnTo(angle, geometry[index]!.mid));
    if (!items[index]!.disabled) {
      playWheelSound('tick', sound);
      onTick?.();
    }
  };

  const goToPage = (target: number, onPaging: boolean) => {
    const next = pageItems(ring, target);
    const at = onPaging ? next.length - 1 : null;
    const nextOffset = offsetOf(level, target, next.length);
    const angle =
      at === null ? restAngle(next.length, dir, nextOffset) : layoutSlices(next.length, dir, nextOffset)[at]!.mid;
    setPage(target);
    setGeneration((n) => n + 1);
    setHover(at);
    setDial((current) => turnTo(current, angle));
    setAnnouncement(t('wheel.page', { count: target + 1 }));
    settle();
  };

  /** Opens the ring of the slice at `index` in place, turned so that it unfolds from the slice; the
   *  hover (and the focus) lands on its default, where a pointer that rested on the slice still is. */
  const open = (index: number) => {
    const item = items[index];
    if (!interactive || !item?.id || !opensRing(item)) return;
    const variants = item.variants!;
    const anchor = anchorOf(item);
    const at = geometry[index]!.mid;
    const next = [...levels, { id: item.id, index, page, at, anchor }];
    setTrail(next);
    setShownKey(keyOf(kind, title, next, variants));
    setPage(0);
    setSelected(null);
    setHover(anchor);
    setGeneration((n) => n + 1);
    setDial((angle) => turnTo(angle, at));
    setAnnouncement(t('wheel.opened', { name: item.label, count: variants.length }));
    settle();
  };

  /** Back one level. From the keyboard the focus goes back to the slice that opened the ring; from
   *  the hub the dial comes to rest. */
  const back = (via: 'key' | 'pointer') => {
    const last = levels[levels.length - 1];
    if (!interactive || !last) return;
    const rest = levels.slice(0, -1);
    const below = resolve(slices, rest) ?? { ring: slices, parents: [] };
    const belowCount = pageItems(below.ring, last.page).length;
    const belowOffset = offsetOf(rest[rest.length - 1], last.page, belowCount);
    setTrail(rest);
    setShownKey(keyOf(kind, title, rest, below.ring));
    setPage(last.page);
    setSelected(null);
    setHover(via === 'key' ? last.index : null);
    setGeneration((n) => n + 1);
    setDial((angle) => turnTo(angle, via === 'key' ? last.at : restAngle(belowCount, dir, belowOffset)));
    setAnnouncement(t('wheel.backTo', { name: below.parents[below.parents.length - 1]?.label ?? title }));
    settle();
  };

  const deny = () => {
    const element = shakeRef.current;
    if (reducedMotion || !element || typeof element.animate !== 'function') return;
    const unit = element.getBoundingClientRect().width / VIEW;
    const at = (x: number, offset: number) => ({ transform: `translateX(${fx(x * unit)}px)`, offset });
    element.animate([at(0, 0), at(-5, 0.25), at(4, 0.5), at(-2, 0.75), at(0, 1)], {
      duration: MOTION.denied,
      easing: 'ease',
    });
  };

  const choose = (id: string, from: string[], index: number) => {
    onApply(id, from);
    setHover(index);
    setSelected(index);
    setDial((angle) => turnTo(angle, geometry[index]!.mid));
    setPhase(reducedMotion ? 'applied' : 'applying');
    setApplied((n) => n + 1);
  };

  /** Enter applies a slice or opens its choices; a click or a drop applies a slice with choices as
   *  its default, so quick use stays quick. */
  const activate = (index: number, how: 'key' | 'pointer') => {
    const item = items[index];
    if (!interactive || !item) return;
    if (item.disabled) {
      hoverTo(index);
      deny();
      return;
    }
    if (item.paging) {
      goToPage(item.paging.target, true);
      return;
    }
    if (opensRing(item)) {
      if (how === 'pointer' && item.default) choose(item.default, [...path, item.id!], index);
      else open(index);
      return;
    }
    choose(item.id!, path, index);
  };

  const close = () => {
    if (phase !== 'closing' && phase !== 'closed') setPhase('closing');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // The Back control answers Enter and Space itself.
    if (event.target instanceof HTMLButtonElement && (event.key === 'Enter' || event.key === ' ')) return;
    const action = keyAction(event.key, hover, count, dir, depth);
    if (!action) return;
    event.preventDefault();
    if (!keyboard) setKeyboard(true);
    if (!interactive) {
      if (action.type === 'close') close();
      return;
    }
    switch (action.type) {
      case 'move':
        hoverTo(action.index);
        break;
      case 'apply':
        if (hover !== null) activate(hover, 'key');
        break;
      case 'open':
        // The forward arrow also turns the page on "More…".
        if (hover !== null && items[hover]?.paging) activate(hover, 'key');
        else if (hover !== null) open(hover);
        break;
      case 'close':
        close();
        break;
      case 'back':
        back('key');
        break;
      case 'page':
        if (pages > 1) goToPage((page + action.delta + pages) % pages, false);
        break;
    }
  };

  const pointAt = (event: { clientX: number; clientY: number }) => {
    const box = discRef.current?.getBoundingClientRect();
    if (!box) return { index: null, radius: Infinity };
    const { x, y } = toView(event.clientX, event.clientY, box);
    return { index: hitTest(x, y, count, dir, offset), radius: Math.hypot(x - C, y - C) };
  };

  useLayoutEffect(() => {
    stale.current = false;
    restOn.current = (spot) => {
      if (spot === 'hub') return back('pointer');
      const paging = spot === null ? null : items[spot]?.paging;
      if (paging) goToPage(paging.target, true);
      else if (spot !== null) open(spot);
    };
  });

  const rests = (spot: Spot, drag: boolean) => {
    if (spot === 'hub') return depth > 0;
    const item = spot === null ? null : items[spot];
    return !!item && !item.disabled && (opensRing(item) || (drag && !!item.paging));
  };

  const dwellOn = (spot: Spot, drag: boolean) => {
    const now = dwell.current;
    if (now.settled) {
      dwell.current = { spot, timer: 0, settled: false };
      return;
    }
    if (now.spot === spot) return;
    window.clearTimeout(now.timer);
    dwell.current = { spot, timer: 0, settled: false };
    if (!rests(spot, drag)) return;
    dwell.current.timer = window.setTimeout(() => {
      dwell.current = { spot: null, timer: 0, settled: true };
      restOn.current(spot);
    }, MOTION.dwell);
  };
  useEffect(() => () => window.clearTimeout(dwell.current.timer), []);

  const pointTo = (x: number, y: number, drag: boolean) => {
    const { index, radius } = pointAt({ clientX: x, clientY: y });
    hoverTo(index);
    dwellOn(index ?? (radius < R.WINDOW ? 'hub' : null), drag);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || event.pointerType === 'touch' || stale.current) return;
    if (keyboard) setKeyboard(false);
    pointTo(event.clientX, event.clientY, false);
  };

  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || event.pointerType === 'touch') return;
    dwellOn(null, false);
    hoverTo(null);
  };

  useImperativeHandle(control, () => ({
    point(x, y) {
      if (interactive && !stale.current) pointTo(x, y, true);
    },
    drop(x, y) {
      dwellOn(null, true);
      const { index } = pointAt({ clientX: x, clientY: y });
      const item = index === null ? null : items[index];
      // A slice with choices applies its default; one without (a category) chose nothing.
      if (index === null || !item || !interactive || item.paging || (opensRing(item) && !item.default)) close();
      else activate(index, 'pointer');
    },
    leave() {
      dwellOn(null, true);
      if (interactive) hoverTo(null);
    },
    close,
  }));

  const onDiscClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const { index, radius } = pointAt(event);
    if (index !== null) activate(index, 'pointer');
    else if (radius > R.OUT) close();
  };

  const hovered = hover === null ? null : items[hover];
  const tip = interactive && hovered ? hovered.hint || (hovered.disabled ? t('wheel.unavailable') : '') : '';
  // The bubble keeps its last text while it fades out.
  if (tip && tip !== lastTip) setLastTip(tip);
  const live = (hovered && !hovered.disabled) || selected !== null;

  const classes = ['wheel', `is-${phase}`];
  if (reducedMotion) classes.push('is-reduced');
  if (selected !== null) classes.push('has-selected');
  if (live) classes.push('is-live');
  if (keyboard) classes.push('is-keyboard');

  const side = Math.min(440, Math.max(300, size));
  const style = {
    '--wheel-size': `min(${side}px, calc(100vw - 48px), calc(100vh - 112px))`,
    '--wheel-open': `${openDuration(1, reducedMotion)}ms`,
    '--wheel-stagger': `${MOTION.stagger}ms`,
    '--wheel-apply': `${MOTION.apply}ms`,
    '--wheel-close': `${closeDuration(reducedMotion)}ms`,
  } as CSSProperties;

  if (phase === 'closed') return <></>;

  return createPortal(
    <div
      className={`wheel-scrim is-${phase}${overlay ? ' is-overlay' : ''}`}
      style={style}
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        className={classes.join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={subtitle ? `${uid}-subtitle` : undefined}
        dir={dir}
        lang={locale}
        data-kind={kind}
        data-depth={depth}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.preventDefault()}
      >
        <div ref={shakeRef} className="wheel-shake">
          <div
            ref={discRef}
            className="wheel-disc"
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onClick={onDiscClick}
          >
            <div className="wheel-cast" />
            <Bolts uid={uid} />
            <div className="wheel-steel" />
            <Face
              uid={uid}
              slices={faceSlices}
              hover={hover}
              selected={selected}
              generation={generation}
              label={shownTitle}
              describedBy={`${uid}-help`}
              menuRef={menuRef}
              itemRef={(index, element) => {
                itemRefs.current[index] = element;
              }}
            />
            <div className="wheel-layer wheel-spin">
              <div className="wheel-layer wheel-turn" style={{ transform: `rotate(${fx(dial)}deg)` }}>
                <div className="wheel-layer wheel-snap">
                  <DialScale numbers={dialNumbers} />
                  <DialIndex />
                </div>
              </div>
            </div>
            <FixedRing uid={uid} />
            <Glint />
            <Handle uid={uid} />
            <HubCap uid={uid} title={hub.title} subtitle={hub.subtitle} raised={depth > 0} />
            {depth > 0 && (
              <button
                type="button"
                className="wheel-back"
                tabIndex={-1}
                aria-keyshortcuts="Escape Backspace"
                disabled={!interactive}
                onClick={() => back('pointer')}
              >
                <Icon name="back" size={12} className="flip" />
                {t('wheel.back')}
              </button>
            )}
            <div className="wheel-focus" />
          </div>
        </div>
        <div className={`wheel-tip${tip ? ' is-shown' : ''}${hovered?.disabled ? ' is-off' : ''}`} aria-hidden="true">
          {tip || lastTip}
        </div>
        <div hidden>
          {subtitle && <span id={`${uid}-subtitle`}>{isolate(subtitle)}</span>}
          <span id={`${uid}-help`}>{t('wheel.instructions', { dir })}</span>
          {items.map((item, i) => {
            const hint = item.hint || (item.disabled ? t('wheel.unavailable') : '');
            return hint ? (
              <span key={item.key} id={`${uid}-hint-${i}`}>
                {hint}
              </span>
            ) : null;
          })}
        </div>
        <div className="wheel-sr" aria-live="polite">
          {announcement}
        </div>
      </div>
    </div>,
    document.body,
  );
}
