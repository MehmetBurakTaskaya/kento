// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { MetadataField } from '../ipc';
import {
  buildChange,
  chapterIssues,
  formatTime,
  groupFields,
  isPictureDate,
  nextChapter,
  parseDrafts,
  parseTime,
  sameChapters,
  toDrafts,
  type ChapterDraft,
} from './Metadata';

const field = (key: string, group: string, value: string, editable = false): MetadataField => ({
  key,
  group,
  name: key,
  value,
  editable,
});

const draft = (id: number, start: string, end: string, title = ''): ChapterDraft => ({ id, start, end, title });

describe('metadata fields', () => {
  it('groups the read-only fields in the order the file gave them', () => {
    const groups = groupFields([
      field('title', 'XMP', 'Göreme', true),
      field('Make', 'EXIF', 'Apple'),
      field('GPSLatitude', 'GPS', '38 deg'),
      field('Model', 'EXIF', 'iPhone'),
    ]);
    expect(groups.map((group) => group.group)).toEqual(['EXIF', 'GPS']);
    expect(groups[0]!.fields.map((f) => f.key)).toEqual(['Make', 'Model']);
    expect(groupFields([])).toEqual([]);
  });

  it('sends only the fields that changed, trimmed', () => {
    const fields = [field('title', 'XMP', 'Göreme', true), field('author', 'EXIF', 'Ayşe', true)];
    expect(buildChange(fields, { title: 'Göreme ', author: 'Ayşe' }, false, false, null)).toBeNull();
    expect(buildChange(fields, { title: ' Yeni 😀 ', author: '' }, false, false, null)).toEqual({
      set: { title: 'Yeni 😀', author: '' },
      removeAll: false,
      removeLocation: false,
      chapters: null,
    });
    expect(buildChange(fields, { title: 'Göreme' }, false, true, null)?.removeLocation).toBe(true);
    const chapters = [{ start: 0, end: 5, title: 'Giriş' }];
    expect(buildChange(fields, {}, false, false, chapters)?.chapters).toEqual(chapters);
  });

  it('removing everything leaves nothing else to send', () => {
    const fields = [field('title', 'XMP', 'Göreme', true)];
    expect(buildChange(fields, { title: 'Yeni' }, true, true, [])).toEqual({
      set: {},
      removeAll: true,
      removeLocation: false,
      chapters: null,
    });
  });

  it('checks a picture date the way the engine reads it', () => {
    for (const ok of [
      '2024-05-01',
      '2024-05-01 14:30',
      '2024:05:01 14:30:00',
      '2024-5-1T9:05',
      '2024-05-01 14:30:00+03:00',
    ]) {
      expect(isPictureDate(ok), ok).toBe(true);
    }
    for (const wrong of ['', 'dün', '01.05.2024', '2024-13-01', '2024-05-32', '2024-05-01 24:00', '2024']) {
      expect(isPictureDate(wrong), wrong).toBe(false);
    }
  });
});

describe('chapter times', () => {
  it('format and read back', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.5)).toBe('1:05.5');
    expect(formatTime(3725.25)).toBe('1:02:05.25');
    for (const seconds of [0, 1.5, 59.999, 61, 3599, 3600, 7322.125]) {
      expect(parseTime(formatTime(seconds))).toBeCloseTo(seconds, 3);
    }
    expect(parseTime('65')).toBe(65);
    expect(parseTime(' 1:02:30,5 ')).toBe(3750.5);
    for (const wrong of ['', 'a', '1:60', '1.5:00', '1:2:3:4', '-5', '1::2']) {
      expect(parseTime(wrong), wrong).toBeNull();
    }
  });

  it('flag rows that end before they start, overlap or pass the end', () => {
    const rows = [draft(0, '0:00', '1:00'), draft(1, '0:50', '2:00'), draft(2, '2:00', '1:30'), draft(3, 'x', '3:00')];
    expect([...chapterIssues(rows, null)]).toEqual([1, 2, 3]);
    expect([...chapterIssues([draft(0, '0:00', '2:00')], 90)]).toEqual([0]);
    expect(chapterIssues([draft(0, '0:00', '1:30')], 90).size).toBe(0);
    expect(parseDrafts(rows, null)).toBeNull();
    expect(parseDrafts([draft(0, '0:00', '1:00', ' Giriş ')], null)).toEqual([{ start: 0, end: 60, title: 'Giriş' }]);
  });

  it('round-trip the file’s chapters unchanged', () => {
    const chapters = [
      { start: 0, end: 42.5, title: 'Giriş' },
      { start: 42.5, end: 95.4, title: 'Kapadokya 🎈' },
    ];
    const parsed = parseDrafts(toDrafts(chapters), 95.4)!;
    expect(sameChapters(parsed, chapters)).toBe(true);
    expect(sameChapters(parsed, chapters.slice(1))).toBe(false);
    expect(sameChapters([{ ...parsed[0]!, title: 'Başka' }, parsed[1]!], chapters)).toBe(false);
  });

  it('add a minute after the last chapter, never past the end', () => {
    expect(nextChapter([], null)).toEqual(draft(0, '0:00', '1:00'));
    expect(nextChapter([draft(4, '0:00', '1:30')], 100)).toEqual(draft(5, '1:30', '1:40'));
    expect(nextChapter([draft(0, '0:00', '1:40')], 100)).toBeNull();
  });
});
