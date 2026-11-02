// SPDX-License-Identifier: MIT
// What the download dialog and the floating wheel offer for a link (SPEC 5.10). The core checks
// every link and choice again; these rules only decide what the page shows.
import type { AudioFormat, WebChoice, WebInfo, WebProblem } from '../ipc';

/** One http or https address and nothing else, the same test as the core's. */
export function isLink(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 'https://'.length && /^https?:\/\/\S+$/i.test(trimmed);
}

/** "https://www.youtube.com/watch?v=…" → "youtube.com". */
export function siteName(url: string): string {
  const host = /^https?:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url.trim())?.[1] ?? '';
  return host.toLowerCase().replace(/^www\./, '') || url;
}

/** The kinds of download, in the order the dialog lists them. */
export type WebOption = 'video' | 'audio' | 'thumbnail' | 'images' | 'original';

/** The choices that fit what a link holds. Instagram reels give the video and its sound only;
 *  a photo post opens its picture picker; YouTube adds the thumbnail on its own. */
export function optionsFor(info: WebInfo): WebOption[] {
  if (info.kind === 'images') {
    if (!info.images.length) return ['original'];
    return info.site === 'instagram' ? ['images'] : ['images', 'original'];
  }
  if (info.kind === 'audio') return ['audio', 'original'];
  if (info.site === 'instagram') return ['video', 'audio'];
  return ['video', 'audio', ...(info.thumbnail ? (['thumbnail'] as const) : []), 'original'];
}

/** Video starts at the best quality up to 1080 lines: it plays everywhere and stays a sensible
 *  size. The wheel's quick slice downloads the same. */
export const DEFAULT_HEIGHT = 1080;

/** The quality the dialog selects first: the highest up to 1080, else the lowest there is. */
export function defaultHeight(heights: number[]): number | null {
  if (!heights.length) return null;
  const fitting = heights.filter((height) => height <= DEFAULT_HEIGHT);
  return fitting.length ? Math.max(...fitting) : Math.min(...heights);
}

/** The message key of a quality: the common names for 4K, Full HD and HD, plain lines otherwise. */
export function qualityKey(height: number): string {
  return height === 2160 || height === 1080 || height === 720 ? `web.quality.${height}` : 'web.quality';
}

/** The sound's formats, MP3 first: it plays everywhere. */
export const AUDIO_FORMATS: AudioFormat[] = ['mp3', 'm4a', 'original'];

/** What to ask the core for; null while a photo post has no picture picked. Pictures go in the
 *  post's order whatever order they were picked in. */
export function choiceFor(
  option: WebOption,
  height: number | null,
  picked: number[],
  audio: AudioFormat = 'mp3',
): WebChoice | null {
  switch (option) {
    case 'video':
      return { kind: 'video', maxHeight: height };
    case 'images':
      return picked.length ? { kind: 'images', indexes: [...picked].sort((a, b) => a - b) } : null;
    case 'audio':
      return audio === 'mp3' ? { kind: 'audio' } : { kind: 'audioAs', format: audio };
    default:
      return { kind: option };
  }
}

/** The floating wheel's quick slices, with the dialog's defaults. */
export const QUICK_CHOICES: Record<'video' | 'audio' | 'original', WebChoice> = {
  video: { kind: 'video', maxHeight: DEFAULT_HEIGHT },
  audio: { kind: 'audio' },
  original: { kind: 'original' },
};

/** A refused probe as the core sends it, or anything else as "something went wrong". */
export function problemOf(reason: unknown): WebProblem {
  if (reason && typeof reason === 'object' && typeof (reason as WebProblem).key === 'string') {
    const { key, details } = reason as WebProblem;
    return { key, details: typeof details === 'string' ? details : '' };
  }
  return { key: 'error.other', details: String(reason) };
}

/** Problems the tool setup solves. */
export function needsSetup(problem: WebProblem): boolean {
  return problem.key === 'error.codec.ytdlp' || problem.key === 'error.codec.ffmpeg';
}

/** Problems another try may solve. */
export function retryable(problem: WebProblem): boolean {
  return problem.key === 'error.web.network' || problem.key === 'error.other';
}
