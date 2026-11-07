// SPDX-License-Identifier: MIT
import i18next, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../website-kit/catalog.json';
import { TOOL_ICONS } from '../app/slices';
import { MEDIA_CHOICES, toolChoices } from '../app/variants';
import { initI18n } from '../i18n';
import { iconPath } from './Icon';

const t: TFunction = i18next.t.bind(i18next);

/** Path data with absolute and relative commands and numbers only, starting with a move. */
const DRAWABLE = /^M[\d.\s,-]+[MLHVCSQTAZmlhvcsqtaz\d.\s,-]*$/;

beforeAll(async () => {
  await initI18n('en');
});

describe('icons', () => {
  it('draw every tool on the Tools wheel', () => {
    for (const [tool, name] of Object.entries(TOOL_ICONS)) {
      expect(iconPath(name), `${tool}: ${name}`).toMatch(DRAWABLE);
    }
  });

  it('give each tool its own icon, and the catalog names one of the set', () => {
    const names = Object.values(TOOL_ICONS);
    for (const tool of catalog.tools) {
      expect(iconPath(tool.icon), `${tool.id}: ${tool.icon}`).toBeDefined();
      expect(TOOL_ICONS[tool.id], tool.id).toBeDefined();
    }
    for (const action of catalog.actions) {
      expect(iconPath(action.icon), `${action.id}: ${action.icon}`).toBeDefined();
    }
    // The video and audio tools of the second wave share no icon with another tool.
    for (const tool of [
      'make-vertical',
      'cut-out',
      'remove-pauses',
      'add-music',
      'add-overlay',
      'fade',
      'denoise',
      'rotate-video',
      'loop-video',
      'color-video',
      'merge-audio',
      'ringtone',
      'stabilize',
    ]) {
      const name = TOOL_ICONS[tool]!;
      expect(
        names.filter((other) => other === name),
        `${tool}: ${name}`,
      ).toHaveLength(1);
    }
  });

  it('draw the quick choices of the video and audio tools', () => {
    for (const tool of Object.keys(MEDIA_CHOICES)) {
      const variants = toolChoices(tool, t, 'en')?.variants ?? [];
      expect(variants.length, tool).toBeGreaterThan(1);
      for (const variant of variants) {
        expect(variant.icon, `${tool} ${variant.id}`).toBeDefined();
        expect(iconPath(variant.icon!), `${tool} ${variant.id}: ${variant.icon}`).toMatch(DRAWABLE);
        // No placeholder left: each choice says what it does.
        expect(variant.icon, `${tool} ${variant.id}`).not.toBe('sliders');
      }
    }
  });
});
