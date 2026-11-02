// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { WebInfo } from '../ipc';
import {
  choiceFor,
  defaultHeight,
  isLink,
  needsSetup,
  optionsFor,
  problemOf,
  qualityKey,
  QUICK_CHOICES,
  retryable,
  siteName,
} from './links';

const info = (patch: Partial<WebInfo>): WebInfo => ({
  url: 'https://example.org/a',
  site: 'other',
  kind: 'video',
  title: 'A',
  duration: null,
  heights: [],
  thumbnail: false,
  images: [],
  ...patch,
});

describe('links', () => {
  it('takes one http or https address, like the core', () => {
    expect(isLink('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isLink('  HTTP://example.org/a \n')).toBe(true);
    for (const text of ['https://', 'http://a', 'ftp://example.org/a', 'see https://a.org', 'https://a.org b', '']) {
      expect(isLink(text)).toBe(false);
    }
  });

  it('names the site without its www', () => {
    expect(siteName('https://www.youtube.com/watch?v=abc')).toBe('youtube.com');
    expect(siteName('https://user@Example.ORG:8080/a')).toBe('example.org');
    expect(siteName('https://www.instagram.com/reel/x/')).toBe('instagram.com');
  });
});

describe('choices', () => {
  it('offers video, audio, the YouTube thumbnail and the original for a video', () => {
    expect(optionsFor(info({ site: 'youtube', thumbnail: true }))).toEqual(['video', 'audio', 'thumbnail', 'original']);
    expect(optionsFor(info({}))).toEqual(['video', 'audio', 'original']);
  });

  it('offers video and audio only for an Instagram reel', () => {
    expect(optionsFor(info({ site: 'instagram', kind: 'video' }))).toEqual(['video', 'audio']);
  });

  it('opens the picture picker for a photo post', () => {
    const images = [0, 1, 2].map((index) => ({ index, width: null, height: null, preview: null }));
    expect(optionsFor(info({ site: 'instagram', kind: 'images', images }))).toEqual(['images']);
    expect(optionsFor(info({ kind: 'images', images }))).toEqual(['images', 'original']);
    expect(optionsFor(info({ kind: 'images' }))).toEqual(['original']);
    expect(optionsFor(info({ kind: 'audio' }))).toEqual(['audio', 'original']);
  });

  it('starts video at the best quality up to 1080 lines', () => {
    expect(defaultHeight([2160, 1440, 1080, 720, 480])).toBe(1080);
    expect(defaultHeight([2160, 720, 360])).toBe(720);
    expect(defaultHeight([2160, 1440])).toBe(1440);
    expect(defaultHeight([])).toBeNull();
    expect(QUICK_CHOICES.video).toEqual({ kind: 'video', maxHeight: 1080 });
  });

  it('gives the common qualities their names', () => {
    expect(qualityKey(2160)).toBe('web.quality.2160');
    expect(qualityKey(1080)).toBe('web.quality.1080');
    expect(qualityKey(720)).toBe('web.quality.720');
    expect(qualityKey(1440)).toBe('web.quality');
  });

  it('asks for pictures in the post order and for none without a pick', () => {
    expect(choiceFor('images', null, [4, 0, 2])).toEqual({ kind: 'images', indexes: [0, 2, 4] });
    expect(choiceFor('images', null, [])).toBeNull();
    expect(choiceFor('video', 720, [])).toEqual({ kind: 'video', maxHeight: 720 });
    expect(choiceFor('audio', 720, [1])).toEqual({ kind: 'audio' });
    expect(choiceFor('thumbnail', null, [])).toEqual({ kind: 'thumbnail' });
    expect(choiceFor('original', null, [])).toEqual({ kind: 'original' });
  });
});

describe('problems', () => {
  it('reads the core’s refusal and wraps anything else', () => {
    expect(problemOf({ key: 'error.web.live', details: 'live' })).toEqual({ key: 'error.web.live', details: 'live' });
    expect(problemOf('boom')).toEqual({ key: 'error.other', details: 'boom' });
    expect(problemOf({ key: 'error.web.drm' })).toEqual({ key: 'error.web.drm', details: '' });
  });

  it('knows which problems the setup or another try solves', () => {
    expect(needsSetup({ key: 'error.codec.ytdlp', details: '' })).toBe(true);
    expect(needsSetup({ key: 'error.web.drm', details: '' })).toBe(false);
    expect(retryable({ key: 'error.web.network', details: '' })).toBe(true);
    expect(retryable({ key: 'error.web.login', details: '' })).toBe(false);
  });
});
