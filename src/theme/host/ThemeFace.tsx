// SPDX-License-Identifier: MIT
// A theme's wheel inside the app's wheel. The theme draws into a shadow root of its own, so its styles
// and the app's never meet: the root holds the base styles, the theme's styles, its SVG defs and
//   <div data-concept=<id> data-theme=<mode> style=<palette>> <div class="wheel …"> <svg class="wheel-svg">
//   <g class="wheel-root">
// The app keeps the pointer, the keys and the timing; this component turns its phases into the theme's
// lifecycle classes, calls the theme's render(), update(), onOpen() and onSelect() at the right moments,
// and draws the theme again, with its open animation, when a ring or a page brings new slices. The
// drawing is decoration only: the menu that assistive technology reads is the app's own.
import { useLayoutEffect, useMemo, useRef, type JSX } from 'react';
import base from './base.css?inline';
import type { Mode, WheelModel } from './contract';
import { createHelpers, type Helpers } from './helpers';
import type { PackTheme } from './packs';

export type FacePhase = 'opening' | 'open' | 'applying' | 'applied' | 'closing' | 'still';

export interface ThemeFaceProps {
  theme: PackTheme;
  mode: Mode;
  model: WheelModel;
  /** The wheel's phase; 'still' is a picture at rest, without the open animation. */
  phase: FacePhase;
  hover: number | null;
  selected: number | null;
  /** Bumped when a ring or a page brings new slices: the theme opens them with its own animation. */
  generation: number;
  /** Bumped on every apply: the theme plays its apply effect on the selected slice. */
  applied: number;
  /** Bumped when a slice that cannot be applied is chosen. */
  denied: number;
  reduced: boolean;
  /** A still frame this many milliseconds into the apply effect of the selected slice. */
  frame?: number | null;
}

const STATES = ['is-open', 'is-opening', 'is-closing', 'is-closed', 'is-opening-reduced', 'is-closing-reduced'];

const SVGNS = 'http://www.w3.org/2000/svg';

/** One parsed style sheet per text, shared by every wheel that shows it. */
const sheets = new Map<string, CSSStyleSheet>();
const adoptable =
  typeof ShadowRoot !== 'undefined' &&
  'adoptedStyleSheets' in ShadowRoot.prototype &&
  typeof CSSStyleSheet !== 'undefined' &&
  'replaceSync' in CSSStyleSheet.prototype;

function style(shadow: ShadowRoot, texts: string[]): void {
  if (adoptable) {
    shadow.adoptedStyleSheets = texts.map((text) => {
      let sheet = sheets.get(text);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(text);
        sheets.set(text, sheet);
      }
      return sheet;
    });
    return;
  }
  for (const text of texts) {
    const element = document.createElement('style');
    element.textContent = text;
    shadow.appendChild(element);
  }
}

/** A theme that throws leaves its wheel undrawn or still; the wheel keeps working. */
function guard(theme: PackTheme, what: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(`theme ${theme.id}: ${what} failed`, error);
  }
}

interface Parts {
  shadow: ShadowRoot;
  wheel: HTMLDivElement;
  svg: SVGSVGElement;
  root: SVGGElement;
}

export function ThemeFace(props: ThemeFaceProps): JSX.Element {
  const { theme, mode, model, phase, hover, selected, generation, applied, denied, reduced, frame } = props;
  const host = useRef<HTMLDivElement>(null);
  const parts = useRef<Parts | null>(null);
  const latest = useRef(props);
  const H = useMemo<Helpers>(() => createHelpers(theme.concept.icons), [theme]);
  // What the drawing on screen has played already.
  const seen = useRef({ generation, applied, denied, phase: null as FacePhase | null, replay: 0 });

  useLayoutEffect(() => {
    latest.current = props;
  });

  const setState = () => {
    const now = parts.current;
    if (!now) return;
    const { hover, selected, model } = latest.current;
    now.root.querySelectorAll<SVGGElement>('.slice').forEach((g) => {
      const i = Number(g.dataset.slice);
      g.classList.toggle('is-hover', i === hover);
      g.classList.toggle('is-selected', i === selected);
    });
    now.wheel.classList.toggle('has-hover', hover !== null);
    now.wheel.classList.toggle('has-selected', selected !== null);
    const update = theme.concept.wheel.update;
    if (update) guard(theme, 'update', () => update.call(theme.concept.wheel, now.root, model, { hover, selected }, H));
  };

  /** Puts the wheel in one of its lifecycle states; opening plays the theme's open animation. */
  const enter = (state: 'open' | 'opening' | 'closing') => {
    const now = parts.current;
    if (!now) return;
    const { reduced, model } = latest.current;
    now.wheel.classList.remove(...STATES);
    if (state === 'open') {
      now.wheel.classList.add('is-open');
      return;
    }
    // A reflow between the classes starts the animation again.
    void now.wheel.offsetWidth;
    now.wheel.classList.add(`is-${state}${reduced ? '-reduced' : ''}`);
    const onOpen = theme.concept.wheel.onOpen;
    if (state === 'opening' && onOpen)
      guard(theme, 'onOpen', () => onOpen.call(theme.concept.wheel, now.root, model, H, reduced));
  };

  // The scaffold, once per theme and mode.
  useLayoutEffect(() => {
    const element = host.current!;
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    shadow.replaceChildren();
    style(shadow, [base, theme.css]);
    const { concept } = theme;
    if (concept.defs) {
      const holder = document.createElementNS(SVGNS, 'svg');
      holder.setAttribute('aria-hidden', 'true');
      holder.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
      holder.innerHTML = `<defs>${concept.defs}</defs>`;
      shadow.appendChild(holder);
    }
    const scope = document.createElement('div');
    scope.dataset.concept = concept.id;
    scope.dataset.theme = mode;
    for (const [name, value] of Object.entries(concept.palette[mode])) scope.style.setProperty(`--${name}`, value);
    scope.style.setProperty('--font-brand-face', concept.fonts.brand);
    scope.style.setProperty('--font-display-face', concept.fonts.display ?? concept.fonts.brand);
    if (concept.fonts.accent) scope.style.setProperty('--font-accent-face', concept.fonts.accent);
    const wheel = document.createElement('div');
    wheel.className = 'wheel is-open';
    wheel.style.setProperty('--dur-open', `${concept.motion.open}ms`);
    wheel.style.setProperty('--dur-close', `${concept.motion.close}ms`);
    wheel.style.setProperty('--stagger', `${concept.motion.stagger}ms`);
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 400 400');
    svg.setAttribute('class', 'wheel-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    wheel.appendChild(svg);
    scope.appendChild(wheel);
    shadow.appendChild(scope);
    parts.current = { shadow, wheel, svg, root: document.createElementNS(SVGNS, 'g') };
    seen.current.phase = null;
    return () => {
      shadow.replaceChildren();
      parts.current = null;
    };
  }, [theme, mode]);

  // The drawing: again for every new model, on a fresh group so nothing of the last one stays.
  useLayoutEffect(() => {
    const now = parts.current;
    if (!now) return;
    now.wheel.dir = model.dir;
    now.wheel.lang = model.lang;
    now.wheel.dataset.kind = model.kind;
    const root = document.createElementNS(SVGNS, 'g');
    root.setAttribute('class', 'wheel-root');
    now.root.remove();
    now.svg.appendChild(root);
    now.root = root;
    guard(theme, 'render', () => theme.concept.wheel.render(root, model, H));
    setState();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState reads the latest props
  }, [theme, mode, model, H]);

  useLayoutEffect(setState, [hover, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // The lifecycle: open, a new ring or page, apply, refusal, close.
  useLayoutEffect(() => {
    const now = parts.current;
    if (!now) return;
    const was = seen.current;
    const first = was.phase === null;
    if (phase === 'still') {
      if (first || was.phase !== 'still') enter('open');
    } else if (phase === 'opening') {
      if (first || was.phase !== 'opening') enter('opening');
    } else if (phase === 'closing') {
      if (was.phase !== 'closing') enter('closing');
    } else if (first || was.phase === 'opening' || was.phase === 'closing' || was.phase === 'still') {
      if (!was.replay) enter('open');
    }
    // New slices on screen: the theme opens them again, quickly and plainly.
    if (!first && generation !== was.generation && phase !== 'closing' && phase !== 'still') {
      window.clearTimeout(was.replay);
      enter('opening');
      const time = theme.timings.open(model.n, reduced) + 30;
      was.replay = window.setTimeout(() => {
        was.replay = 0;
        if (latest.current.phase !== 'closing') enter('open');
      }, time);
    }
    if (applied !== was.applied && selected !== null) {
      now.wheel.classList.remove('is-applying');
      void now.wheel.offsetWidth;
      if (theme.timings.apply(reduced) > 0) now.wheel.classList.add('is-applying');
      const onSelect = theme.concept.wheel.onSelect;
      if (onSelect) guard(theme, 'onSelect', () => onSelect.call(theme.concept.wheel, now.root, model, selected, H));
    }
    if (phase !== 'applying' && was.phase === 'applying') now.wheel.classList.remove('is-applying');
    if (denied !== was.denied) {
      now.wheel.classList.remove('is-denied');
      void now.wheel.offsetWidth;
      now.wheel.classList.add('is-denied');
    }
    was.phase = phase;
    was.generation = generation;
    was.applied = applied;
    was.denied = denied;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enter reads the latest props
  }, [phase, generation, applied, denied, theme, mode]);

  // A still frame of the apply effect: the animations stop at that time and the theme draws it.
  useLayoutEffect(() => {
    const now = parts.current;
    if (!now || frame == null || selected === null) return;
    now.wheel.classList.add('is-frozen', 'is-applying');
    now.wheel.style.setProperty('--t', `${frame}ms`);
    const onSelect = theme.concept.wheel.onSelect;
    if (onSelect)
      guard(theme, 'onSelect', () => onSelect.call(theme.concept.wheel, now.root, model, selected, H, frame));
    return () => {
      now.wheel.classList.remove('is-frozen', 'is-applying');
      now.wheel.style.removeProperty('--t');
    };
  }, [frame, selected, theme, model, H]);

  useLayoutEffect(() => () => window.clearTimeout(seen.current.replay), []);

  return <div ref={host} className="wheel-theme" />;
}
