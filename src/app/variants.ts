// SPDX-License-Identifier: MIT
// The choices some slices hold (SPEC 5.3): a ring a level further in that opens when the pointer
// rests on the slice, while a plain drop or click still does what the slice always did (its
// default). Each builder returns the slice's `variants` and `default`, or null when the files
// call for none. The hosts turn a choice into a request in slices.ts.
import type { TFunction } from 'i18next';
import type { IconName } from '../components/Icon';
import { formatBytes } from '../i18n/format';
import type {
  Category,
  Compression,
  ConvertPreset,
  MediaTool,
  MetadataChange,
  PageLayout,
  QrReport,
  WebChoice,
} from '../ipc';
import { AUDIO_FORMATS } from '../web/links';
import type { WheelSlice } from '../wheel/Wheel';

export type Choices = Required<Pick<WheelSlice, 'variants' | 'default'>>;

/** "Other…": the tool's own window with every setting. */
export const OTHER = 'other';

function other(t: TFunction): WheelSlice {
  return { id: OTHER, label: t('wheel.other'), icon: 'more', hint: t('wheel.other.hint') };
}

/** A slice's own hint, and that resting on it offers more. */
export function withChoices(slice: WheelSlice, choices: Choices | null, t: TFunction): WheelSlice {
  if (!choices) return slice;
  const hint = slice.hint ? t('wheel.choices.hint', { hint: slice.hint }) : t('wheel.choices');
  return { ...slice, ...choices, hint };
}

// ---------------------------------------------------------------- Convert

export const ONE_PDF = 'one-pdf';
export const SEPARATE_PDFS = 'separate-pdfs';

/** "PDF from images" with the tool's own default page layout. */
export const PDF_LAYOUT: PageLayout = { size: 'fit-image', marginMm: 0 };

const PRESETS: readonly ConvertPreset[] = [
  'high',
  'balanced',
  'small',
  'screen',
  'normal',
  'print',
  'gif-small',
  'gif-medium',
  'gif-large',
  'kbps128',
  'kbps192',
  'kbps320',
];

export function isPreset(id: string): id is ConvertPreset {
  return (PRESETS as readonly string[]).includes(id);
}

/** Video → GIF: the widest picture and the frames a second of each size (the core's own). */
export const GIF_SIZES = { 'gif-small': [320, 10], 'gif-medium': [480, 12], 'gif-large': [720, 15] } as const;
const DPI = { screen: 96, normal: 150, print: 300 } as const;
const PICTURE_QUALITY = ['jpg', 'webp', 'avif'];
const PAGES = ['png', 'jpg'];

/**
 * The choices of a Convert target for one category of the selection:
 * - several pictures (and nothing else) to PDF: one PDF of them all (the default) or one each;
 * - pictures to JPG, WEBP or AVIF: the picture quality, Balanced being the usual settings;
 * - PDF or slides to PNG or JPG: the page resolution, Normal (150 dpi) by default;
 * - video to GIF: the size, Medium by default;
 * - video or audio to MP3 or M4A: the bit rate, 192 kbit/s (the usual settings) by default.
 */
export function targetChoices(
  category: Category,
  to: string,
  count: number,
  alone: boolean,
  t: TFunction,
): Choices | null {
  if (category === 'image' && to === 'pdf') {
    if (!alone || count < 2) return null;
    return {
      default: ONE_PDF,
      variants: [
        { id: ONE_PDF, label: t('variant.pdf.one'), icon: 'merge', hint: t('variant.pdf.one.hint') },
        { id: SEPARATE_PDFS, label: t('variant.pdf.separate'), icon: 'split', hint: t('variant.pdf.separate.hint') },
      ],
    };
  }
  if (category === 'image' && PICTURE_QUALITY.includes(to)) {
    const quality = (id: 'high' | 'balanced' | 'small', icon: IconName): WheelSlice => ({
      id,
      label: t(`variant.quality.${id}`),
      icon,
      hint: t(`variant.quality.${id}.hint`),
    });
    return {
      default: 'balanced',
      variants: [quality('high', 'star'), quality('balanced', 'sliders'), quality('small', 'shrink')],
    };
  }
  if ((category === 'pdf' || category === 'presentation') && PAGES.includes(to)) {
    return {
      default: 'normal',
      variants: (Object.keys(DPI) as (keyof typeof DPI)[]).map((id) => ({
        id,
        label: t(`variant.dpi.${id}`),
        sublabel: t('variant.dpi', { dpi: DPI[id] }),
        hint: t(`variant.dpi.${id}.hint`),
      })),
    };
  }
  if (category === 'video' && to === 'gif') {
    return {
      default: 'gif-medium',
      variants: (Object.keys(GIF_SIZES) as (keyof typeof GIF_SIZES)[]).map((id) => {
        const [width, fps] = GIF_SIZES[id];
        return {
          id,
          label: t(`variant.${id}`),
          sublabel: t('variant.gif', { width, fps }),
          hint: t('variant.gif.hint', { width, fps }),
        };
      }),
    };
  }
  if ((category === 'video' || category === 'audio') && (to === 'mp3' || to === 'm4a')) {
    // MP3 keeps its usual variable rate, about 192 kbit/s; M4A's AAC is 192 kbit/s.
    const usual = to === 'mp3' ? 'variant.kbps.usual.mp3' : 'variant.kbps.usual';
    return {
      default: 'kbps192',
      variants: ([128, 192, 320] as const).map((kbps) => ({
        id: `kbps${kbps}`,
        label: String(kbps),
        sublabel: t('variant.kbps'),
        hint: t(kbps === 192 ? usual : `variant.kbps.${kbps}`),
      })),
    };
  }
  return null;
}

// ---------------------------------------------------------------- Tools

/** Compress: three levels of the panel's quality scale (Balanced is the panel's first value) and a
 *  size for email and chat. */
export const COMPRESS_CHOICES: Record<string, Compression> = {
  high: { mode: 'quality', level: 85 },
  balanced: { mode: 'quality', level: 75 },
  smallest: { mode: 'quality', level: 35 },
  'under-25': { mode: 'size', bytes: 25_000_000 },
};

export const SPEED_CHOICES: Record<string, number> = { 'x0.5': 0.5, 'x1.5': 1.5, x2: 2 };

/** The media tools' choices that run at once from the wheel, by tool and choice. */
export const MEDIA_CHOICES: Record<string, Record<string, MediaTool>> = {
  'make-vertical': {
    crop: { tool: 'make-vertical', span: null, fill: { kind: 'crop', center: 0.5 } },
    blur: { tool: 'make-vertical', span: null, fill: { kind: 'blur' } },
  },
  'rotate-video': {
    right: { tool: 'rotate-video', turn: 'right', mirror: false, flip: false },
    left: { tool: 'rotate-video', turn: 'left', mirror: false, flip: false },
    half: { tool: 'rotate-video', turn: 'half', mirror: false, flip: false },
    mirror: { tool: 'rotate-video', turn: 'none', mirror: true, flip: false },
  },
  'loop-video': {
    reverse: { tool: 'loop-video', mode: 'reverse', count: 1 },
    boomerang: { tool: 'loop-video', mode: 'boomerang', count: 3 },
    repeat: { tool: 'loop-video', mode: 'repeat', count: 3 },
  },
  'color-video': Object.fromEntries(
    (['black-white', 'warm', 'cool', 'vivid'] as const).map((look) => [
      look,
      { tool: 'color-video', look, grade: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 } },
    ]),
  ),
  denoise: Object.fromEntries(
    (['light', 'medium', 'strong'] as const).map((strength) => [
      strength,
      { tool: 'denoise', strength, rumble: false },
    ]),
  ),
  stabilize: Object.fromEntries(
    (['light', 'medium', 'strong'] as const).map((strength) => [strength, { tool: 'stabilize', strength }]),
  ),
};

const MEDIA_ICONS: Record<string, IconName> = {
  crop: 'crop',
  blur: 'layers',
  right: 'rotate-right',
  left: 'rotate-left',
  half: 'rotate-right',
  mirror: 'split',
  reverse: 'back',
  boomerang: 'restart',
  repeat: 'restart',
  light: 'sliders',
  medium: 'sliders',
  strong: 'sliders',
};

/** Where a media tool's choices find their names: the looks and strengths are shared. */
const MEDIA_KEYS: Record<string, string> = {
  'make-vertical': 'variant.vertical',
  'rotate-video': 'variant.rotate',
  'loop-video': 'variant.loop',
  'color-video': 'look',
  denoise: 'variant.strength',
  stabilize: 'variant.strength',
};

/** A media tool's quick choices, then "Other…" (its editor, also what a plain drop opens). */
function mediaChoices(tool: string, t: TFunction): Choices | null {
  const choices = MEDIA_CHOICES[tool];
  const key = MEDIA_KEYS[tool];
  if (!choices || !key) return null;
  // The strengths' hints are each tool's own; a look needs none.
  const hint = (id: string) =>
    tool === 'color-video'
      ? undefined
      : key === 'variant.strength'
        ? t(`variant.${tool}.${id}.hint`)
        : t(`${key}.${id}.hint`);
  return {
    default: OTHER,
    variants: [
      ...Object.keys(choices).map((id) => ({
        id,
        label: t(`${key}.${id}`),
        icon: MEDIA_ICONS[id] ?? ('sliders' as IconName),
        hint: hint(id),
      })),
      other(t),
    ],
  };
}

export const METADATA_CHOICES: Record<string, MetadataChange> = {
  'remove-location': { set: {}, removeAll: false, removeLocation: true, chapters: null },
  'remove-all': { set: {}, removeAll: true, removeLocation: false, chapters: null },
};

export const QR_REPORTS: QrReport[] = ['txt', 'csv', 'json'];

/** The choices of a Tools wheel slice: presets that run at once, and the tool's window, which is
 *  also what a plain drop or click opens. `kinds` are the categories of the files. */
export function toolChoices(tool: string, t: TFunction, lang: string, kinds: Category[] = []): Choices | null {
  switch (tool) {
    case 'compress':
      return {
        default: OTHER,
        variants: [
          { id: 'high', label: t('variant.quality.high'), icon: 'star', hint: t('variant.compress.high.hint') },
          {
            id: 'balanced',
            label: t('variant.quality.balanced'),
            icon: 'sliders',
            hint: t('variant.compress.balanced.hint'),
          },
          {
            id: 'smallest',
            label: t('variant.compress.smallest'),
            icon: 'shrink',
            hint: t('variant.compress.smallest.hint'),
          },
          {
            id: 'under-25',
            label: t('variant.compress.under', { size: formatBytes(25_000_000, lang) }),
            icon: 'compress',
            hint: t('variant.compress.under.hint', { size: formatBytes(25_000_000, lang) }),
          },
          other(t),
        ],
      };
    case 'speed':
      return {
        default: OTHER,
        variants: [
          ...Object.entries(SPEED_CHOICES).map(([id, factor]) => ({
            id,
            label: t('editor.speed.factor', { factor }),
            icon: 'speed' as const,
            hint: t(factor < 1 ? 'variant.speed.slow.hint' : 'variant.speed.fast.hint', { factor }),
          })),
          other(t),
        ],
      };
    case 'metadata':
      return {
        default: 'edit',
        variants: [
          // A PDF holds no position.
          ...(kinds.includes('pdf')
            ? []
            : [
                {
                  id: 'remove-location',
                  label: t('variant.metadata.location'),
                  icon: 'globe' as const,
                  hint: t('variant.metadata.location.hint'),
                },
              ]),
          { id: 'remove-all', label: t('variant.metadata.all'), icon: 'trash', hint: t('variant.metadata.all.hint') },
          { id: 'edit', label: t('variant.metadata.edit'), icon: 'tag', hint: t('variant.metadata.edit.hint') },
        ],
      };
    case 'read-qr':
      return {
        default: OTHER,
        variants: [
          ...QR_REPORTS.map((report) => ({
            id: report,
            label: report.toUpperCase(),
            icon: (report === 'csv' ? 'table' : 'doc') as IconName,
            hint: t('variant.qr.hint', { format: report.toUpperCase() }),
          })),
          { ...other(t), hint: t('variant.qr.other.hint') },
        ],
      };
    default:
      return mediaChoices(tool, t);
  }
}

// ---------------------------------------------------------------- File actions

export const CHOOSE_FOLDER = 'choose';
const FOLDER = 'folder:';

/** The folder a Copy or Move choice names, or null for "Choose folder…". */
export function folderOf(id: string): string | null {
  return id.startsWith(FOLDER) ? id.slice(FOLDER.length) : null;
}

/** "C:\Users\me\Pictures\" → "Pictures"; a drive or root keeps its whole name. */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const name = trimmed.split(/[\\/]/).pop();
  return name || path;
}

export const ARCHIVE_FORMATS = ['zip', '7z', 'tar-gz'] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

/** Copy and Move: the recent folders (newest first), then the folder dialog, which a plain drop
 *  or click opens as before. ZIP: the other archive formats. */
export function actionChoices(action: string, folders: string[], t: TFunction): Choices | null {
  if ((action === 'copy' || action === 'move') && folders.length) {
    return {
      default: CHOOSE_FOLDER,
      variants: [
        ...folders.map((folder) => ({
          id: `${FOLDER}${folder}`,
          label: folderName(folder),
          icon: 'folder' as const,
          hint: folder,
        })),
        { id: CHOOSE_FOLDER, label: t('variant.folder.choose'), icon: 'more', hint: t('variant.folder.choose.hint') },
      ],
    };
  }
  if (action === 'zip') {
    return {
      default: 'zip',
      variants: ARCHIVE_FORMATS.map((format) => ({
        id: format,
        label: format === 'tar-gz' ? 'TAR.GZ' : format.toUpperCase(),
        icon: 'zip',
        hint: t(`format.hint.${format}`),
      })),
    };
  }
  return null;
}

// ---------------------------------------------------------------- Downloads

/** Video: the best there is, or the best up to a height; yt-dlp picks it, since a drag has no time
 *  to ask the site first. 1080 lines is the quick slice's usual. */
export const VIDEO_HEIGHTS = [null, 2160, 1080, 720, 480] as const;

export function downloadChoices(slice: string, t: TFunction): Choices | null {
  if (slice === 'video') {
    return {
      default: '1080',
      variants: VIDEO_HEIGHTS.map((height) =>
        height === null
          ? { id: 'best', label: t('variant.video.best'), hint: t('variant.video.best.hint') }
          : {
              id: String(height),
              label: height === 2160 ? '4K' : t('web.quality', { height }),
              sublabel: t(`variant.video.${height}`),
              hint: t('variant.video.hint', { height }),
            },
      ),
    };
  }
  if (slice === 'audio') {
    return {
      default: 'mp3',
      variants: AUDIO_FORMATS.map((format) => ({
        id: format,
        label: format === 'original' ? t('variant.audio.original') : format.toUpperCase(),
        hint: t(`variant.audio.${format}.hint`),
      })),
    };
  }
  return null;
}

/** What to ask the core for from the Video or Audio choices. */
export function downloadChoice(slice: string, id: string): WebChoice | null {
  if (slice === 'video') {
    if (id === 'best') return { kind: 'video', maxHeight: null };
    const height = Number(id);
    return VIDEO_HEIGHTS.includes(height as (typeof VIDEO_HEIGHTS)[number])
      ? { kind: 'video', maxHeight: height }
      : null;
  }
  if (slice === 'audio') {
    if (id === 'mp3') return { kind: 'audio' };
    if (id === 'm4a' || id === 'original') return { kind: 'audioAs', format: id };
  }
  return null;
}
