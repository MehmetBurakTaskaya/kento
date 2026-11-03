// SPDX-License-Identifier: MIT
// Pictures of a theme's wheel for scripts/shoot-themes.mjs: the floating wheel as the app shows it,
// with a chosen number of slices in the language of the page, on the theme's own desk. The slices hold
// the choices the app gives them, so the ones that open a ring show their mark. Development builds
// only: the script loads this module into the dev server's page.
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { changeLanguage } from '../i18n';
import i18n from '../i18n';
import type { IconName } from '../components/Icon';
import { TOOL_ICONS } from '../app/slices';
import { actionChoices, targetChoices, toolChoices, withChoices } from '../app/variants';
import type { Category } from '../ipc';
import { loadTheme, showTheme, type Mode } from './registry';
import { Wheel, type WheelSlice } from '../wheel/Wheel';

export type SampleSet = 'convert2' | 'tools3' | 'actions5' | 'convert8' | 'convert12' | 'tools8' | 'pdf8';

// The targets of a picture (JPG, WEBP and AVIF open a ring of picture quality) and of a PDF (JPG and
// PNG open a ring of page resolution).
const FORMATS = ['jpg', 'png', 'webp', 'avif', 'pdf', 'tiff', 'ico', 'gif', 'bmp', 'heic', 'jxl', 'qoi'];
const PDF_TARGETS = ['jpg', 'png', 'txt', 'md', 'xlsx', 'docx', 'pptx', 'html'];
const TOOLS = [
  'compress',
  'crop-image',
  'edit-image',
  'markup',
  'redact-image',
  'read-qr',
  'remove-background',
  'metadata',
];
/** Recent folders, which give Copy and Move a ring. */
const FOLDERS = ['C:\\Users\\me\\Pictures\\', 'C:\\Users\\me\\Documents\\Invoices\\'];
const ACTIONS: [string, IconName][] = [
  ['share', 'share'],
  ['shelf', 'shelf'],
  ['copy', 'copy'],
  ['move', 'move'],
  ['zip', 'zip'],
];

function formats(targets: string[], category: Category = 'image'): WheelSlice[] {
  const t = i18n.t.bind(i18n);
  return targets.map((to) => {
    const hint = i18n.exists(`format.hint.${to}`) ? t(`format.hint.${to}`) : undefined;
    return withChoices({ id: to, label: to.toUpperCase(), hint }, targetChoices(category, to, 1, true, t), t);
  });
}

export function sample(set: SampleSet): { kind: 'convert' | 'tools'; title: string; slices: WheelSlice[] } {
  const t = i18n.t.bind(i18n);
  const tools = (ids: string[]): WheelSlice[] =>
    ids.map((id) => {
      const slice: WheelSlice = {
        id,
        label: t(`tool.${id}`),
        icon: TOOL_ICONS[id] ?? 'sliders',
        dimmed: id === 'remove-background',
        hint: id === 'remove-background' ? t('wheel.needs', { name: t('group.extras') }) : undefined,
      };
      return slice.dimmed ? slice : withChoices(slice, toolChoices(id, t, i18n.language, ['image']), t);
    });
  switch (set) {
    case 'convert2':
      return { kind: 'convert', title: t('wheel.convert'), slices: formats(FORMATS.slice(0, 2)) };
    case 'convert8':
      return { kind: 'convert', title: t('wheel.convert'), slices: formats(FORMATS.slice(0, 8)) };
    case 'convert12':
      return { kind: 'convert', title: t('wheel.convert'), slices: formats(FORMATS) };
    case 'pdf8':
      return { kind: 'convert', title: t('wheel.convert'), slices: formats(PDF_TARGETS, 'pdf') };
    case 'tools3':
      return { kind: 'tools', title: t('wheel.tools'), slices: tools(TOOLS.slice(0, 3)) };
    case 'tools8':
      return { kind: 'tools', title: t('wheel.tools'), slices: tools(TOOLS) };
    case 'actions5':
      return {
        kind: 'tools',
        title: t('wheel.actions'),
        slices: ACTIONS.map(([id, icon]) =>
          withChoices({ id, label: t(`action.${id}`), icon }, actionChoices(id, FOLDERS, t), t),
        ),
      };
  }
}

let root: Root | null = null;
let host: HTMLElement | null = null;

export interface ShotOptions {
  theme: string;
  mode: Mode;
  lang: string;
  set: SampleSet;
  size?: number;
}

/** Shows the wheel and returns the theme's timings, for the script to wait on them. */
export async function mountWheelShot({ theme: id, mode, lang, set, size = 360 }: ShotOptions) {
  root?.unmount();
  host?.remove();
  if (i18n.language !== lang) await changeLanguage(lang);
  const theme = await loadTheme(id);
  await showTheme(document.documentElement, id, mode);
  document.body.style.background = theme.wheel?.concept.palette[mode].desk ?? theme.tokens[mode].bg!;
  const { kind, title, slices } = sample(set);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const start = performance.now();
  flushSync(() =>
    root!.render(
      <Wheel
        kind={kind}
        title={title}
        subtitle={i18n.t('settings.appearance.sample')}
        slices={slices}
        overlay
        size={size}
        look={{ theme, mode }}
        keyName={kind === 'convert' ? 'Shift' : 'Ctrl'}
        sound={{ enabled: false, volume: 0 }}
        reducedMotion={false}
        onApply={() => {}}
        onClose={() => {}}
      />,
    ),
  );
  // From the key press to a wheel on screen: drawn, and laid out for the first frame.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const drawn = Math.round(performance.now() - start);
  const timings = theme.wheel?.timings;
  const count = Math.min(slices.length, 8);
  return {
    open: (timings ? timings.open(count, false) : 250) + 60,
    apply: timings ? timings.apply(false) : 640,
    hold: timings ? timings.hold(false) : 450,
    drawn,
  };
}

/** What the page shows that a designer should know: labels shortened to fit, and faces that lack
 *  letters the interface needs (Turkish and Cyrillic). */
export async function inspectShot(id: string): Promise<{ shortened: string[]; missing: Record<string, string> }> {
  const theme = await loadTheme(id);
  const shortened: string[] = [];
  for (const face of document.querySelectorAll('.wheel-theme')) {
    face.shadowRoot?.querySelectorAll('[data-fit="shortened"]').forEach((text) => {
      shortened.push(text.getAttribute('aria-label') ?? text.textContent ?? '');
    });
  }
  const missing: Record<string, string> = {};
  const families = theme.wheel?.concept.fonts.load ?? [];
  const canvas = document.createElement('canvas').getContext('2d')!;
  for (const family of families) {
    await document.fonts.load(`600 40px ${family}`, 'çğıİöşüЖжЯя');
    const gaps = [...'çğıİöşüÇĞÖŞÜЖжЯяЁёЩщ'].filter((char) => {
      // A glyph the face lacks comes from the fallback, which differs between the two stacks.
      canvas.font = `600 40px ${family}, monospace`;
      const a = canvas.measureText(char).width;
      canvas.font = `600 40px ${family}, serif`;
      return Math.abs(a - canvas.measureText(char).width) > 0.01;
    });
    if (gaps.length) missing[family] = gaps.join('');
  }
  return { shortened, missing };
}
