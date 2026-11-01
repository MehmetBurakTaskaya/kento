// SPDX-License-Identifier: MIT
import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import tr from '../../locales/tr.json';
import { formatBytes, formatDuration, formatRelative, matchesSearch, searchKey, upper } from './format';
import { isRtl, strings } from './index';
import { pseudoLong, pseudoMirror } from './pseudo';

const files = import.meta.glob<Record<string, string>>('../../locales/*.json', { eager: true, import: 'default' });

/** The argument names an ICU message uses, such as count and name. */
function argumentsOf(message: string): string[] {
  return [...message.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]!).sort();
}

describe('locale files', () => {
  it('have the same keys and arguments as English', () => {
    const source = strings(en);
    for (const [path, file] of Object.entries(files)) {
      const dict = strings(file);
      expect(Object.keys(dict).sort(), path).toEqual(Object.keys(source).sort());
      for (const [key, text] of Object.entries(dict)) {
        expect(argumentsOf(text), `${path} ${key}`).toEqual(argumentsOf(source[key]!));
      }
      expect(file['@language'], path).toBeTruthy();
    }
  });

  it('compile as ICU messages in their language', () => {
    for (const [code, file] of [
      ['en', en],
      ['tr', tr],
    ] as const) {
      for (const [key, text] of Object.entries(strings(file))) {
        expect(
          () =>
            new IntlMessageFormat(text, code).format({
              count: 2,
              name: 'x',
              language: 'x',
              shortcut: 'x',
              version: '1',
            }),
          key,
        ).not.toThrow();
      }
    }
  });

  it('use plurals the way each language needs', () => {
    const format = (text: string, lang: string, count: number) => new IntlMessageFormat(text, lang).format({ count });
    expect(format(en['library.count'], 'en', 0)).toBe('No files');
    expect(format(en['library.count'], 'en', 1)).toBe('1 file');
    expect(format(en['library.count'], 'en', 7)).toBe('7 files');
    expect(format(tr['library.count'], 'tr', 7)).toBe('7 dosya');
  });
});

describe('pseudo-languages', () => {
  it('keep placeholders and plurals working', () => {
    const long = pseudoLong(en['library.count']);
    expect(new IntlMessageFormat(long, 'en').format({ count: 3 })).toMatch(/^\[3 ƒíĺéš ~+\]$/);
    const placeholder = pseudoLong(en['settings.about.version']);
    expect(new IntlMessageFormat(placeholder, 'en').format({ version: '0.1.0' })).toContain('0.1.0');
  });

  it('grow texts by at least 40 percent', () => {
    for (const text of Object.values(strings(en))) {
      expect(pseudoLong(text).length).toBeGreaterThanOrEqual(Math.floor(text.length * 1.4));
    }
  });

  it('wrap literal text in right-to-left overrides', () => {
    expect(pseudoMirror('Home')).toBe('‮Ĥöɱé‬');
    expect(isRtl('ar-XB')).toBe(true);
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('tr')).toBe(false);
  });
});

describe('formatting', () => {
  it('formats sizes and times per language', () => {
    expect(formatBytes(2_100_000, 'en')).toBe('2.1 MB');
    expect(formatBytes(2_100_000, 'tr')).toBe('2,1 MB');
    expect(formatBytes(240_000, 'tr')).toBe('240 kB');
    expect(formatDuration(12_000, 'en')).toBe('12 sec');
    expect(formatRelative(Date.UTC(2026, 0, 1, 12, 0), Date.UTC(2026, 0, 1, 12, 2), 'en')).toBe('2 min. ago');
  });

  it('handles Turkish case and searches without accents', () => {
    expect(upper('istanbul ılık', 'tr')).toBe('İSTANBUL ILIK');
    expect(upper('istanbul', 'en')).toBe('ISTANBUL');
    expect(searchKey('Şiş Çöp ĞÜZ', 'tr')).toBe('sis cop guz');
    expect(matchesSearch('Fotoğraf Işığı.heic', 'isigi', 'tr')).toBe(true);
    expect(matchesSearch('report.pdf', 'xyz', 'en')).toBe(false);
  });
});
