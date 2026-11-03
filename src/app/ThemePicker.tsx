// SPDX-License-Identifier: MIT
// Settings › Appearance › Theme (SPEC 5.20): every theme as a card with its wheel, small and at rest,
// drawn once the card comes into view, in the light or dark the app shows; the cards are one radio
// group. Choosing a card applies the theme at once, here and in every other window. Above them the
// chosen theme's wheel is live: pointing at a slice ticks, a click applies it with its sound and its
// effect, and the wheel opens again.
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../components/Icon';
import { isRtl } from '../i18n';
import type { Settings } from '../ipc';
import { useApp } from '../state/store';
import { listThemes, themeReady, useLook, useTheme, type CatalogEntry, type Mode } from '../theme/registry';
import { Wheel, type WheelSlice } from '../wheel/Wheel';
import { TOOL_ICONS } from './slices';
import './themes.css';

/** The sample every wheel here shows: the Tools wheel of a photo, with one tool not installed. */
const SAMPLE = [
  'compress',
  'crop-image',
  'edit-image',
  'markup',
  'redact-image',
  'read-qr',
  'remove-background',
  'metadata',
];

function useSample(): { title: string; subtitle: string; slices: WheelSlice[] } {
  const { t } = useTranslation();
  return {
    title: t('wheel.tools'),
    subtitle: t('settings.appearance.sample'),
    slices: SAMPLE.map((id) => ({
      id,
      label: t(`tool.${id}`),
      icon: (TOOL_ICONS[id] ?? 'sliders') as IconName,
      dimmed: id === 'remove-background',
      hint: id === 'remove-background' ? t('wheel.needs', { name: t('group.extras') }) : undefined,
    })),
  };
}

/** True once the element has come near the screen; it stays true. */
function useSeen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen];
}

function Card({
  entry,
  mode,
  checked,
  focusable,
  onChoose,
}: {
  entry: CatalogEntry;
  mode: Mode;
  checked: boolean;
  focusable: boolean;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const sample = useSample();
  return (
    <div
      ref={ref}
      role="radio"
      aria-checked={checked}
      tabIndex={focusable ? 0 : -1}
      className={checked ? 'theme-card is-checked' : 'theme-card'}
      data-theme-id={entry.id}
      onClick={onChoose}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          onChoose();
        }
      }}
    >
      {seen ? <CardStage id={entry.id} mode={mode} sample={sample} /> : <span className="theme-card-stage" />}
      <span className="theme-card-name">
        {checked && <Icon name="check" size={14} />}
        {/* The theme Kento was designed with, the one without a pack, says so. */}
        {entry.pack === null ? t('settings.appearance.original', { name: entry.name }) : entry.name}
      </span>
    </div>
  );
}

function CardStage({ id, mode, sample }: { id: string; mode: Mode; sample: ReturnType<typeof useSample> }) {
  const theme = useTheme(id);
  const ready = themeReady(id);
  const tokens = theme.tokens[mode];
  const desk = theme.wheel?.concept.palette[mode].desk ?? tokens.bg;
  return (
    <span className="theme-card-stage" style={{ background: desk }} aria-hidden="true">
      {ready && (
        <Wheel
          preview="still"
          look={{ theme, mode }}
          kind="tools"
          title={sample.title}
          subtitle={sample.subtitle}
          slices={sample.slices}
          size={128}
          sound={{ enabled: false, volume: 0 }}
          reducedMotion
          openSound={false}
          onApply={() => {}}
          onClose={() => {}}
        />
      )}
    </span>
  );
}

/** The chosen theme's wheel, to try: it opens again after every apply or close. */
function Preview({ id, appearance, settings }: { id: string; appearance: Settings['appearance']; settings: Settings }) {
  const { t } = useTranslation();
  const mac = useApp((state) => state.boot?.app.platform === 'macos');
  const sample = useSample();
  const look = useLook(id, appearance);
  // The theme on show stays until the chosen one has loaded; a new theme opens with its sound.
  const [shown, setShown] = useState({ id, round: 0, sound: false });
  if (shown.id !== id && look.theme.id === id && themeReady(id)) setShown({ id, round: shown.round + 1, sound: true });
  const reduced = document.documentElement.classList.contains('reduce-motion');
  return (
    <figure className="theme-preview">
      <div className="theme-preview-stage" style={{ background: look.theme.wheel?.concept.palette[look.mode].desk }}>
        {shown.id === id && themeReady(id) && (
          <Wheel
            key={`${shown.id}:${shown.round}`}
            preview="live"
            look={look}
            kind="tools"
            title={sample.title}
            subtitle={sample.subtitle}
            slices={sample.slices}
            size={264}
            keyName={t(`key.${settings.wheels.tools}.${mac ? 'mac' : 'windows'}`)}
            sound={settings.sound}
            reducedMotion={reduced}
            openSound={shown.sound}
            onApply={() => {}}
            onClose={() => setShown((now) => ({ ...now, round: now.round + 1, sound: false }))}
          />
        )}
      </div>
      <figcaption className="muted">{t('settings.appearance.try')}</figcaption>
    </figure>
  );
}

export function ThemePicker({
  settings,
  labelledBy,
  onChange,
}: {
  settings: Settings;
  labelledBy: string;
  onChange: (theme: string) => void;
}): JSX.Element {
  const { i18n } = useTranslation();
  const themes = listThemes();
  const mode = useLook(settings.theme, settings.appearance).mode;
  const group = useRef<HTMLDivElement>(null);
  const selected = Math.max(
    0,
    themes.findIndex((theme) => theme.id === settings.theme),
  );
  const focusNext = useRef(false);

  // Arrow keys move the choice, as in any radio group, and the focus follows it.
  useLayoutEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    group.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [settings.theme]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const cards = [...(group.current?.querySelectorAll<HTMLElement>('.theme-card') ?? [])];
    if (!cards.length) return;
    const top = cards[0]!.offsetTop;
    const columns = Math.max(1, cards.filter((card) => card.offsetTop === top).length);
    const ahead = isRtl(i18n.language) ? -1 : 1;
    const moves: Record<string, number> = {
      ArrowRight: ahead,
      ArrowLeft: -ahead,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    let next: number | null = null;
    if (event.key in moves) next = (selected + moves[event.key]! + themes.length) % themes.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = themes.length - 1;
    if (next === null) return;
    event.preventDefault();
    focusNext.current = true;
    onChange(themes[next]!.id);
  };

  return (
    <div className="theme-picker">
      <Preview id={settings.theme} appearance={settings.appearance} settings={settings} />
      <div ref={group} className="theme-grid" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
        {themes.map((entry, index) => (
          <Card
            key={entry.id}
            entry={entry}
            mode={mode}
            checked={index === selected}
            focusable={index === selected}
            onChoose={() => onChange(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}
