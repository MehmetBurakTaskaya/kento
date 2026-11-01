// SPDX-License-Identifier: MIT
// Interface strings come from /locales, shared with the Rust side. English is the source; every
// other file names its language in "@language" and says in "@status" whether a native speaker has
// checked it. Messages use ICU MessageFormat (plurals, selects) through i18next-icu.
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import en from '../../locales/en.json';
import tr from '../../locales/tr.json';
import { PSEUDO_LANGUAGES, pseudoDictionary, pseudoLong, pseudoMirror } from './pseudo';

type Dictionary = Record<string, string>;

/** The strings of a locale file without its "@" metadata. */
export function strings(file: Dictionary): Dictionary {
  return Object.fromEntries(Object.entries(file).filter(([key]) => !key.startsWith('@')));
}

export const SOURCE: Dictionary = strings(en);

/** Arabic, and the right-to-left pseudo-language, lay out right to left. */
export const isRtl = (code: string) => code.split('-')[0] === 'ar';

export const isPseudo = (code: string) => PSEUDO_LANGUAGES.some((lang) => lang.code === code);

/** The locale for Intl formatting: the pseudo-languages format like English. */
export const intlLocale = (code: string) => (isPseudo(code) ? 'en' : code);

const resources = {
  en: { translation: SOURCE },
  tr: { translation: strings(tr) },
  'en-XA': { translation: pseudoDictionary(SOURCE, pseudoLong) },
  'ar-XB': { translation: pseudoDictionary(SOURCE, pseudoMirror) },
};

export const LOCALE_CODES = Object.keys(resources);

function applyDocument(code: string) {
  document.documentElement.lang = intlLocale(code);
  document.documentElement.dir = isRtl(code) ? 'rtl' : 'ltr';
}

export async function initI18n(code: string): Promise<void> {
  await i18next
    .use(ICU)
    .use(initReactI18next)
    .init({
      resources,
      lng: code,
      fallbackLng: 'en',
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  applyDocument(code);
}

export async function changeLanguage(code: string): Promise<void> {
  if (i18next.language !== code) await i18next.changeLanguage(code);
  applyDocument(code);
}

export { PSEUDO_LANGUAGES };
export default i18next;
