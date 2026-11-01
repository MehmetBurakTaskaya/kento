// SPDX-License-Identifier: MIT
// A page for trying the wheel in a plain browser (`npm run dev`, then `?wheel-demo=1`): a convert wheel
// that pages, tool wheels with tools that are not installed, a mixed selection with category
// sub-wheels, and switches for language, appearance, motion, sound and size. Development builds only.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../components/Icon';
import { changeLanguage, LOCALE_CODES, PSEUDO_LANGUAGES } from '../i18n';
import { pseudoLong, pseudoMirror } from '../i18n/pseudo';
import { applyTheme, getTheme } from '../theme/registry';
import '../theme/steel';
import { Wheel, type WheelProps, type WheelSlice } from './Wheel';

type DemoWheel = 'convert' | 'tools' | 'every' | 'mixed' | 'few';

// Sample sub-labels and descriptions for the convert wheel. They stand in for the format catalog,
// which brings the real ones; the pseudo-languages stretch or mirror the English ones.
const FORMATS: Record<string, Record<'en' | 'tr', [string, string]>> = {
  jpg: { en: ['Smaller', 'JPG: small, opens everywhere'], tr: ['Daha küçük', 'JPG: küçük, her yerde açılır'] },
  png: { en: ['Lossless', 'PNG: lossless, keeps transparency'], tr: ['Kayıpsız', 'PNG: kayıpsız, şeffaflığı korur'] },
  webp: { en: ['For the web', 'WEBP: small, made for websites'], tr: ['Web için', 'WEBP: küçük, web siteleri için'] },
  avif: {
    en: ['Smallest', 'AVIF: smallest, for newer apps'],
    tr: ['En küçük', 'AVIF: en küçük, yeni uygulamalar için'],
  },
  gif: { en: ['Animation', 'GIF: short animations, few colors'], tr: ['Animasyon', 'GIF: kısa animasyon, az renk'] },
  tiff: { en: ['For print', 'TIFF: lossless, for print'], tr: ['Baskı için', 'TIFF: kayıpsız, baskı için'] },
  bmp: { en: ['Uncompressed', 'BMP: large, no compression'], tr: ['Sıkıştırmasız', 'BMP: büyük, sıkıştırma yok'] },
  ico: { en: ['Icon', 'ICO: one icon in several sizes'], tr: ['Simge', 'ICO: birkaç boyutta tek simge'] },
  pdf: { en: ['Document', 'PDF: one page per image'], tr: ['Belge', 'PDF: her görsel bir sayfa'] },
};

const IMAGE_TOOLS: [string, IconName, string?][] = [
  ['compress', 'compress'],
  ['edit-image', 'sliders'],
  ['crop-image', 'crop'],
  ['markup', 'pen'],
  ['frame', 'frame'],
  ['redact-image', 'redact'],
  ['read-qr', 'qr'],
  ['remove-background', 'cutout', 'extras'],
  ['metadata', 'tag', 'extras'],
  ['collage', 'grid'],
  ['ocr', 'text'],
  ['make-qr', 'qr'],
  ['images-to-pdf', 'doc'],
];

const EVERY_TOOL: [string, IconName, string?][] = [
  ...IMAGE_TOOLS,
  ['split-pdf', 'split'],
  ['edit-pdf', 'doc'],
  ['merge-pdf', 'merge'],
  ['extract', 'zip'],
  ['mute', 'mute', 'media'],
  ['trim-video', 'scissors', 'media'],
  ['crop-video', 'crop', 'media'],
  ['speed', 'speed', 'media'],
  ['merge-video', 'merge', 'media'],
  ['frames', 'image', 'media'],
  ['split-video', 'split', 'media'],
  ['redact-video', 'redact', 'media'],
  ['normalize', 'music', 'media'],
  ['trim-audio', 'scissors', 'media'],
  ['channels', 'music', 'media'],
  ['redact-audio', 'redact', 'media'],
  ['audio-to-video', 'video', 'media'],
  ['burn-subtitles', 'captions', 'media'],
];

const CATEGORIES: { id: string; icon: IconName; targets: [string, string?][] }[] = [
  { id: 'image', icon: 'image', targets: [['JPG'], ['PNG'], ['WEBP'], ['PDF']] },
  {
    id: 'video',
    icon: 'video',
    targets: [
      ['MP4', 'media'],
      ['WEBM', 'media'],
      ['MOV', 'media'],
      ['GIF', 'media'],
      ['MP3', 'media'],
    ],
  },
  { id: 'pdf', icon: 'doc', targets: [['DOCX', 'office'], ['PNG'], ['JPG'], ['TXT']] },
];

const NAMES: Record<string, string> = { en: 'English', tr: 'Türkçe' };
const LONG_NAME = 'a-very-long-holiday-photo-name-from-the-camera.heic';

export default function WheelDemo() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [open, setOpen] = useState<DemoWheel | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const [reduced, setReduced] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [volume, setVolume] = useState(0.3);
  const [size, setSize] = useState(360);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => applyTheme(document.documentElement, getTheme('steel'), dark ? 'dark' : 'light'), [dark]);

  const sample = (text: string) => (lang === 'en-XA' ? pseudoLong(text) : lang === 'ar-XB' ? pseudoMirror(text) : text);
  const needs = (group?: string) => (group ? t('wheel.needs', { name: t(`group.${group}`) }) : undefined);
  const tools = (list: [string, IconName, string?][]): WheelSlice[] =>
    list.map(([id, icon, group]) => ({ id, icon, label: t(`tool.${id}`), disabled: !!group, hint: needs(group) }));

  function wheel(which: DemoWheel): Omit<WheelProps, 'onApply' | 'onClose' | 'sound' | 'reducedMotion'> {
    switch (which) {
      case 'convert':
        return {
          kind: 'convert',
          title: t('wheel.convert'),
          subtitle: 'photo.heic',
          slices: Object.entries(FORMATS).map(([id, text]) => {
            const [sublabel, hint] = text[lang === 'tr' ? 'tr' : 'en'];
            return { id, label: id.toUpperCase(), sublabel: sample(sublabel), hint: sample(hint) };
          }),
        };
      case 'tools':
        return { kind: 'tools', title: t('wheel.tools'), subtitle: 'photo.heic', slices: tools(IMAGE_TOOLS) };
      case 'every':
        return {
          kind: 'tools',
          title: t('wheel.tools'),
          subtitle: t('wheel.files', { count: 3 }),
          slices: tools(EVERY_TOOL),
        };
      case 'few':
        return {
          kind: 'tools',
          title: t('wheel.tools'),
          subtitle: LONG_NAME,
          slices: [
            { id: 'share', icon: 'share', label: t('action.share') },
            { id: 'shelf', icon: 'shelf', label: t('action.shelf') },
            { id: 'move', icon: 'move', label: t('action.move') },
          ],
        };
      case 'mixed': {
        const current = CATEGORIES.find((c) => c.id === category);
        if (!current) {
          return {
            kind: 'convert',
            title: t('wheel.convert'),
            subtitle: t('wheel.files', { count: 3 }),
            slices: CATEGORIES.map((c) => ({ id: c.id, icon: c.icon, label: t(`category.${c.id}`) })),
          };
        }
        return {
          kind: 'convert',
          title: t(`category.${current.id}`),
          subtitle: t('wheel.files', { count: 1 }),
          slices: current.targets.map(([label, group]) => ({
            id: label.toLowerCase(),
            label,
            disabled: !!group,
            hint: needs(group),
          })),
          onBack: () => setCategory(null),
        };
      }
    }
  }

  const shown = open ? wheel(open) : null;
  const buttons: [DemoWheel, string][] = [
    ['convert', `${t('wheel.convert')} · photo.heic`],
    ['tools', `${t('wheel.tools')} · photo.heic`],
    ['every', `${t('wheel.tools')} · ${t('wheel.files', { count: 3 })}`],
    ['mixed', `${t('wheel.convert')} · ${t('wheel.files', { count: 3 })}`],
    ['few', `${t('wheel.tools')} · ${LONG_NAME}`],
  ];

  return (
    <div className="page wheel-demo">
      <section className="card">
        <div className="drop-actions">
          {buttons.map(([which, label]) => (
            <button key={which} type="button" className="button primary" onClick={() => setOpen(which)}>
              {label}
            </button>
          ))}
        </div>
        {last && (
          <output className="muted">
            <Icon name="check" size={16} /> {last}
          </output>
        )}
      </section>
      <section className="card settings-group">
        <label className="row">
          <span>{t('settings.language.title')}</span>
          <select value={lang} onChange={(event) => void changeLanguage(event.target.value)}>
            {LOCALE_CODES.map((code) => (
              <option key={code} value={code}>
                {NAMES[code] ?? PSEUDO_LANGUAGES.find((p) => p.code === code)?.name ?? code}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <span>{t('settings.appearance.mode')}</span>
          <div className="segmented">
            <button type="button" className={dark ? '' : 'is-on'} onClick={() => setDark(false)}>
              {t('settings.appearance.light')}
            </button>
            <button type="button" className={dark ? 'is-on' : ''} onClick={() => setDark(true)}>
              {t('settings.appearance.dark')}
            </button>
          </div>
        </div>
        <label className="row">
          <span>{t('settings.feedback.motion')}</span>
          <input type="checkbox" checked={reduced} onChange={(event) => setReduced(event.target.checked)} />
        </label>
        <label className="row">
          <span>{t('settings.feedback.sound')}</span>
          <input type="checkbox" checked={soundOn} onChange={(event) => setSoundOn(event.target.checked)} />
        </label>
        <label className="row">
          <span>{t('settings.feedback.volume')}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
        <label className="row">
          <span>{t('wheel.size')}</span>
          <input
            type="range"
            min={300}
            max={440}
            step={10}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
        </label>
      </section>
      {open && shown && (
        <Wheel
          {...shown}
          sound={{ enabled: soundOn, volume }}
          reducedMotion={reduced}
          size={size}
          onApply={(id) => {
            if (open === 'mixed' && !category) setCategory(id);
            else setLast(shown.slices.find((slice) => slice.id === id)?.label ?? id);
          }}
          onClose={() => {
            setOpen(null);
            setCategory(null);
          }}
        />
      )}
    </div>
  );
}
