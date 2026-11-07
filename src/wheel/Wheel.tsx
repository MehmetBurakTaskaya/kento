// SPDX-License-Identifier: MIT
// The wheel (design/DESIGN.md, section 5): a brushed-steel combination dial round a white enamel face,
// shown as a modal over the main window. Each slice is a target format or a tool. Pointing or the arrow
// keys turn the dial to a slice; applying one turns the vault handle and throws the bolts, then the
// wheel closes. A slice may hold a ring of choices (its variants, a category's targets): resting on
// it, Enter or the arrow in the reading direction opens that ring in place, unfolded from the slice,
// and resting on the hub, Esc or the other arrow goes back a level. A level change is plain to see
// and hear: the dial clicks into a stop, the new ring sweeps out from the slice (or folds back into
// it), the slice's label flies to the hub, which keeps the trail of rings, and a detent sounds. The
// new ring takes the pointer at once, so nothing waits for the animation. Every visible or spoken
// text comes from the props or the locale files.
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
import { isolate } from '../i18n/format';
import { Face, Flyer, Ghost, type Entrance, type FaceSlice } from './Face';
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
  ringMarkAngle,
  sliceAt,
  toView,
  turnTo,
  VIEW,
  type Direction,
} from './geometry';
import { keyAction } from './keys';
import { canvasMeasure, fitLabel, layoutBlock, type FittedLabel, type Measure } from './labels';
import { levelDuration, MOTION, STEEL_TIMINGS } from './motion';
import { clampPage, PAGE_SIZE, pageCount, pageItems } from './paging';
import { Arm, Bolts, DialIndex, DialScale, FixedRing, Glint, Handle, HubCap, hubLayout } from './parts';
import { Menu } from './Menu';
import { armWheelAudio, playVoice, playWheelSound, type SoundSettings, type WheelSound } from './sound';
import type { ThemeVoice } from '../theme/host/contract';
import { buildModel } from '../theme/host/model';
import type { PackTheme } from '../theme/host/packs';
import { SFX } from '../theme/host/sfx';
import { ThemeFace } from '../theme/host/ThemeFace';
import type { Mode, ThemeDefinition } from '../theme/registry';
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
  /** Called when the dial turns to an available slice, or clicks into a ring of choices or back out
   *  of one (a haptic tap on macOS trackpads). */
  onTick?: () => void;
  /** The theme that draws the wheel, in light or dark: steel by default, or a theme pack's own wheel,
   *  timings and sounds. */
  look?: WheelLook;
  /** The modifier key that opened the wheel, as the system names it; a theme may show it on the hub. */
  keyName?: string;
  /** In a page instead of over it, at exactly `size` pixels: 'live' to try it (it does not take the
   *  focus until it is used, and Tab leaves it), 'still' for a picture of it at rest. */
  preview?: 'live' | 'still';
  /** Whether opening sounds (on by default). */
  openSound?: boolean;
}

export interface WheelLook {
  theme: ThemeDefinition;
  mode: Mode;
}

type Phase = 'opening' | 'open' | 'applying' | 'applied' | 'closing' | 'closed';

/** A theme's voices for the wheel's five sounds. A ring's way in and back are the theme's own when
 *  it has them, and its tick otherwise, like every other click of the dial. */
const THEME_VOICE: Record<WheelSound, ThemeVoice[]> = {
  open: ['open'],
  tick: ['tick'],
  enter: ['enter', 'tick'],
  leave: ['leave', 'tick'],
  apply: ['success'],
};

function playFor(pack: PackTheme | null, name: WheelSound, settings: SoundSettings): void {
  if (!pack) return playWheelSound(name, settings);
  const sounds = pack.concept.sounds;
  const voice = THEME_VOICE[name].map((each) => sounds?.[each]).find(Boolean);
  if (voice) playVoice(name, settings, (ac, out, t) => voice(ac, out, t, SFX));
}

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

/** A ring opened or closed, kept until the next one: what the new ring enters from and what the old
 *  one leaves behind. */
interface Shift {
  id: number;
  dir: Entrance;
  /** The generation it drew: those slices enter with it. */
  generation: number;
  /** The angle of the slice that opened the ring. */
  at: number;
  /** The slice of the new ring at that angle: the default going in, the slice itself coming back. */
  origin: number;
  /** The ring left behind, drawn over the new one while it goes. */
  ghost: FaceSlice[];
  /** The slice of the ghost at that angle: the one that flies to the hub going in, the one it folds
   *  into coming back. */
  ghostOrigin: number;
  /** Going in: the slice that opened the ring, as it was drawn. */
  parent: FaceSlice | null;
  /** Back from the hub, where nothing points at the slice: it lights up as its ring returns. */
  wash: boolean;
  /** The ghost, the sweep and the flight are still on screen. */
  live: boolean;
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
    trail: make(500, NO_SPACING.test(lang) ? 0 : 0.02),
    file: make(450),
  };
}

/** Steps of the dial's detent, as a share of its turn: it clicks a little past the stop and settles. */
const DETENT: [number, number][] = [
  [0, -1],
  [0.6, 0.07],
  [0.82, -0.02],
  [1, 0],
];

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
  look,
  keyName = '',
  preview,
  openSound = true,
}: WheelProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const locale = intlLocale(lang);
  const dir: Direction = isRtl(lang) ? 'rtl' : 'ltr';
  const uid = `wheel${useId().replace(/[^\w-]/g, '')}`;
  // In High Contrast the steel wheel draws itself in the system's colours; a theme's drawing cannot.
  const forced = typeof matchMedia === 'function' && matchMedia('(forced-colors: active)').matches;
  const pack = forced ? null : (look?.theme.wheel ?? null);
  const timings = pack ? pack.timings : STEEL_TIMINGS;
  const still = preview === 'still';

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
  // The rings above this one, outermost first, for the hub's breadcrumb.
  const above = parents.length ? [title, ...parents.slice(0, -1).map((p) => p.label)].join('\u0001') : '';

  const contentKey = keyOf(kind, title, levels, ring);
  const [shownKey, setShownKey] = useState(contentKey);
  const [phase, setPhase] = useState<Phase>(still ? 'open' : 'opening');
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
  const [shift, setShift] = useState<Shift | null>(null);
  // Refusals of a slice that cannot be applied, for a theme's own refusal.
  const [denied, setDenied] = useState(0);

  /** Where slice 1 of a page sits: a ring opened from a slice turns so that its first page unfolds
   *  from there, with its default where the pointer rested. */
  const offsetOf = (on: Level | undefined, onPage: number, count: number) =>
    on ? offsetFor(on.at, onPage === 0 ? on.anchor : 0, count, dir) : 0;

  // A new page or ring puts an end to a level change still on screen.
  const settleShift = () => setShift((s) => (s?.live ? { ...s, live: false } : s));

  // New slices from the host while open: show the new ring from its first page instead of locking
  // the old one.
  if (shownKey !== contentKey) {
    setShownKey(contentKey);
    setPage(0);
    setHover(null);
    setSelected(null);
    setGeneration((n) => n + 1);
    settleShift();
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
        ringMark: opensRing(item) ? ringMarkAngle(g, dir) : undefined,
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
    // Inside a ring, the rings that led to it head the title as a breadcrumb: "Convert ›" over "PDF".
    // Each name is isolated, so the separators follow the interface's direction. When the trail is
    // too long, the outer rings give way first ("… › Image ›"), as the nearest one matters most.
    let trail: FittedLabel | null = null;
    const names = above ? above.split('\u0001') : [];
    for (let skip = 0; skip < names.length && !trail; skip++) {
      const steps = [...(skip ? ['…'] : []), ...names.slice(skip).map(isolate)];
      const text = steps.map((name) => t('wheel.trail', { name })).join(' ');
      const fit = { size: 9.5, minSize: 7.5, maxWidth: 76, maxLines: 1, truncate: 'middle' } as const;
      const fitted = fitLabel(text, fit, measures.trail);
      if (fitted.lines[0] === text || skip === names.length - 1) trail = fitted;
    }
    return {
      title: { text: fittedTitle.lines[0]!, size: fittedTitle.size },
      subtitle: fittedSubtitle ? { text: isolate(fittedSubtitle.lines[0]!), size: fittedSubtitle.size } : null,
      trail: trail ? { text: trail.lines[0]!, size: trail.size } : null,
    };
  }, [shownTitle, shownSubtitle, above, locale, measures, t]);

  // What a theme draws: the same slices at the same angles, and the hub's title, file and key.
  const model = useMemo(
    () =>
      pack
        ? buildModel({
            kind,
            lang: locale,
            dir,
            title: shownTitle,
            file: shownSubtitle ? isolate(shownSubtitle) : '',
            key: keyName,
            geometry,
            slices: items.map((item) => ({
              id: item.id ?? (item.key === '\u0001first' ? 'first' : 'more'),
              label: item.label,
              sub: item.sublabel,
              icon: item.icon,
              tip: item.hint || (item.disabled ? t('wheel.unavailable') : ''),
              off: item.disabled || !!item.dimmed,
              ring: opensRing(item),
              format: kind === 'convert' && !item.paging && (!!item.sublabel || !item.icon),
            })),
          })
        : null,
    [pack, kind, locale, dir, shownTitle, shownSubtitle, keyName, geometry, items, t],
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<SVGSVGElement>(null);
  const detentRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(SVGGElement | null)[]>([]);
  const soundRef = useRef(sound);
  const packRef = useRef(pack);
  const onCloseRef = useRef(onClose);
  const openSoundPlayed = useRef(false);
  const applySoundPlayed = useRef(0);
  const heardGeneration = useRef(generation);
  const shifts = useRef(0);

  useEffect(() => {
    soundRef.current = still ? { ...sound, enabled: false } : sound;
    packRef.current = pack;
    onCloseRef.current = onClose;
  });

  useEffect(() => (sound.enabled && !still ? armWheelAudio() : undefined), [sound.enabled, still]);

  useEffect(() => {
    if (fontsReady || !document.fonts) return;
    let live = true;
    void document.fonts.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, [fontsReady]);

  // Focus moves into the wheel and goes back where it was when the wheel leaves. A preview in a page
  // waits until it is used.
  useEffect(() => {
    if (preview) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [preview]);

  useEffect(() => {
    if (openSoundPlayed.current) return;
    openSoundPlayed.current = true;
    if (openSound) playFor(packRef.current, 'open', soundRef.current);
  }, [openSound]);

  // The keyboard hover is the pointer hover: the hovered slice holds the focus, so a screen reader
  // reads it and Enter applies the slice the dial points at. When a new ring replaces the focused
  // slice, the focus goes back to the menu instead of falling out of the wheel.
  useEffect(() => {
    const slice = hover === null ? null : itemRefs.current[hover];
    const inside = dialogRef.current?.contains(document.activeElement);
    if (preview && !inside) return;
    const target = slice ?? (inside ? null : menuRef.current);
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [hover, generation, preview]);

  // A new page or ring clicks; opening and closing a ring sound their own detent instead.
  useEffect(() => {
    if (generation === heardGeneration.current) return;
    heardGeneration.current = generation;
    if (shift?.generation !== generation) playFor(packRef.current, 'tick', soundRef.current);
  }, [generation, shift]);

  // The ghost, the sweep and the flight leave the screen once the level change has played.
  useEffect(() => {
    if (!shift?.live) return;
    const { id } = shift;
    const timer = window.setTimeout(
      () => setShift((s) => (s?.id === id ? { ...s, live: false } : s)),
      levelDuration(reducedMotion),
    );
    return () => window.clearTimeout(timer);
  }, [shift, reducedMotion]);

  // The dial clicks a short way into its stop: forward going in, back coming out, mirrored right to
  // left. It runs through the Web Animations API on a layer of its own, so it starts again on every
  // change and leaves the cached dial and the apply effect alone. It is over before the change
  // settles, so stopping it then changes nothing.
  useEffect(() => {
    const element = detentRef.current;
    if (!shift?.live || reducedMotion || !element || typeof element.animate !== 'function') return;
    const turn = MOTION.detent.turn * (shift.dir === 'in' ? 1 : -1) * (dir === 'rtl' ? -1 : 1);
    const animation = element.animate(
      DETENT.map(([offset, share]) => ({
        offset,
        transform: `rotate(${fx(turn * share)}deg)`,
        easing: offset === 0 ? 'cubic-bezier(0.3, 0, 0.2, 1)' : 'ease-out',
      })),
      { duration: MOTION.detent.duration },
    );
    return () => animation.cancel();
  }, [shift, reducedMotion, dir]);

  useEffect(() => {
    if (applied === applySoundPlayed.current) return;
    applySoundPlayed.current = applied;
    if (phase === 'applying' || phase === 'applied') playFor(packRef.current, 'apply', soundRef.current);
  }, [applied, phase]);

  // The phases follow the timings of design/DESIGN.md, section 6, or a theme's own.
  useEffect(() => {
    const steps: Partial<Record<Phase, [number, Phase]>> = {
      opening: [timings.open(count, reducedMotion) + 30, 'open'],
      applying: [timings.apply(reducedMotion), 'applied'],
      applied: [timings.hold(reducedMotion), 'closing'],
      closing: [timings.close(reducedMotion), 'closed'],
    };
    const step = steps[phase];
    if (!step) return;
    const timer = window.setTimeout(() => {
      setPhase(step[1]);
      if (step[1] === 'closed') onCloseRef.current();
    }, step[0]);
    return () => window.clearTimeout(timer);
  }, [phase, count, reducedMotion, timings]);

  const interactive = !still && (phase === 'opening' || phase === 'open');

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
      playFor(pack, 'tick', sound);
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
    settleShift();
    settle();
  };

  /** A level change starts: the new ring is live at once; the old one, the dial's detent, the sweep
   *  and the flight play over it. */
  const shiftTo = (next: Omit<Shift, 'id' | 'generation' | 'live'>) => {
    shifts.current += 1;
    setShift({ ...next, id: shifts.current, generation: generation + 1, live: true });
    setGeneration(generation + 1);
    playFor(pack, next.dir === 'in' ? 'enter' : 'leave', sound);
    onTick?.();
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
    setDial((angle) => turnTo(angle, at));
    shiftTo({
      dir: 'in',
      at,
      origin: anchor,
      ghost: faceSlices,
      ghostOrigin: index,
      parent: faceSlices[index] ?? null,
      wash: false,
    });
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
    setDial((angle) => turnTo(angle, via === 'key' ? last.at : restAngle(belowCount, dir, belowOffset)));
    shiftTo({
      dir: 'out',
      at: last.at,
      origin: last.index,
      ghost: faceSlices,
      ghostOrigin: sliceAt(last.at, count, dir, offset),
      parent: null,
      // From the keyboard the slice takes the hover, which already shows it.
      wash: via === 'pointer',
    });
    setAnnouncement(t('wheel.backTo', { name: below.parents[below.parents.length - 1]?.label ?? title }));
    settle();
  };

  const deny = () => {
    // A theme refuses in its own way (a shake unless it says otherwise).
    if (pack) {
      if (!reducedMotion) setDenied((n) => n + 1);
      return;
    }
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
    setPhase(timings.apply(reducedMotion) > 0 ? 'applying' : 'applied');
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
  const mode: Mode = look?.mode ?? (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const style = {
    // A preview takes its own colours: Settings shows every theme, whatever the app wears.
    ...(preview && look
      ? Object.fromEntries(Object.entries(look.theme.tokens[mode]).map(([name, value]) => [`--${name}`, value]))
      : {}),
    '--wheel-size': preview ? `${size}px` : `min(${side}px, calc(100vw - 48px), calc(100vh - 112px))`,
    '--wheel-open': `${timings.open(1, reducedMotion)}ms`,
    '--wheel-stagger': `${MOTION.stagger}ms`,
    '--wheel-apply': `${MOTION.apply}ms`,
    '--wheel-close': `${timings.close(reducedMotion)}ms`,
    '--wheel-level': `${levelDuration(reducedMotion)}ms`,
  } as CSSProperties;

  // The level change on screen, and the one the slices of this generation entered with.
  const change = shift?.live ? shift : null;
  const entered = shift && shift.generation === generation ? shift : null;
  const titleAt: [number, number] = [C, hubLayout(!!hub.subtitle, true).titleY];
  // Going in, the slice flies from its old ring; coming back, into its place in this one.
  const flyer = change ? (change.dir === 'in' ? change.parent : (faceSlices[change.origin] ?? null)) : null;
  const itemRef = (index: number, element: SVGGElement | null) => {
    itemRefs.current[index] = element;
  };

  if (phase === 'closed') return <></>;

  const steel = (
    <>
      <div className="wheel-cast" />
      <Bolts uid={uid} />
      <div className="wheel-steel" />
      <Face
        uid={uid}
        slices={faceSlices}
        hover={hover}
        selected={selected}
        generation={generation}
        entrance={entered?.dir ?? null}
        origin={entered ? entered.origin : null}
        wash={entered?.wash ? entered.origin : null}
        label={shownTitle}
        describedBy={`${uid}-help`}
        menuRef={menuRef}
        itemRef={itemRef}
      />
      {change && (
        <Ghost key={`ghost:${change.id}`} slices={change.ghost} entrance={change.dir} origin={change.ghostOrigin} />
      )}
      {change &&
        !reducedMotion &&
        // The two halves of the slice's keyline part to the far side, or come back from it.
        [1, -1].map((way) => (
          <Arm
            key={`arm:${change.id}:${way}`}
            entrance={change.dir}
            from={change.dir === 'in' ? change.at : change.at + way * 170}
            to={change.dir === 'in' ? change.at + way * 170 : change.at}
          />
        ))}
      <div className="wheel-layer wheel-spin">
        <div className="wheel-layer wheel-turn" style={{ transform: `rotate(${fx(dial)}deg)` }}>
          <div ref={detentRef} className="wheel-layer">
            <div className="wheel-layer wheel-snap">
              <DialScale numbers={dialNumbers} />
              <DialIndex />
            </div>
          </div>
        </div>
      </div>
      <FixedRing uid={uid} />
      <Glint />
      <Handle uid={uid} />
      <HubCap
        uid={uid}
        title={hub.title}
        subtitle={hub.subtitle}
        trail={hub.trail}
        raised={depth > 0}
        entrance={shift?.dir ?? null}
        textKey={shift?.id ?? 0}
      />
      {change && flyer && !reducedMotion && (
        <Flyer key={`flyer:${change.id}`} slice={flyer} hub={titleAt} size={hub.title.size} entrance={change.dir} />
      )}
    </>
  );

  // A theme draws the wheel in its own way; the menu over it is the app's.
  const themed = pack && model && (
    <>
      <ThemeFace
        theme={pack}
        mode={mode}
        model={model}
        phase={still ? 'still' : phase}
        hover={hover}
        selected={selected}
        generation={generation}
        applied={applied}
        denied={denied}
        reduced={reducedMotion}
      />
      <Menu slices={faceSlices} label={shownTitle} describedBy={`${uid}-help`} menuRef={menuRef} itemRef={itemRef} />
    </>
  );

  const wheel = (
    <div
      className={`wheel-scrim is-${phase}${overlay ? ' is-overlay' : ''}${preview ? ` is-inline is-${preview}` : ''}`}
      style={style}
      onClick={(event) => !preview && event.target === event.currentTarget && close()}
      inert={still}
    >
      <div
        ref={dialogRef}
        className={classes.join(' ')}
        role={preview ? 'group' : 'dialog'}
        aria-modal={preview ? undefined : 'true'}
        aria-label={title}
        aria-describedby={subtitle ? `${uid}-subtitle` : undefined}
        dir={dir}
        lang={locale}
        data-kind={kind}
        data-depth={depth}
        data-level={change?.dir}
        data-look={pack ? pack.id : undefined}
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
            {themed || steel}
            {depth > 0 && (
              <button
                type="button"
                className={pack ? 'wheel-back is-corner' : 'wheel-back'}
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
    </div>
  );

  return preview ? wheel : createPortal(wheel, document.body);
}
