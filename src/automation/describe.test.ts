// SPDX-License-Identifier: MIT
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { isolate } from '../i18n/format';
import { describeFilter, formatLabel } from './describe';

const t = ((key: string) => key) as unknown as TFunction;

describe('formats in words', () => {
  // Turkish capitals turn i into İ; extensions and format ids keep their Latin capitals.
  it('writes extensions in the same capitals in every language', () => {
    const filter = { extensions: ['jpg', 'heic', 'zip', '7z'], pattern: '', minSize: null, maxSize: null };
    expect(describeFilter(filter, t, 'tr')).toBe(isolate('JPG, HEIC, ZIP, 7Z'));
    expect(describeFilter(filter, t, 'en')).toBe(isolate('JPG, HEIC, ZIP, 7Z'));
  });

  it('gives a format without a catalog label its id in capitals', () => {
    expect(formatLabel('heic', [])).toBe('HEIC');
  });
});
