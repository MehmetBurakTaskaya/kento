// SPDX-License-Identifier: MIT
// Which voice plays each of the wheel's sounds: the steel wheel's own, or the theme's, at the level
// measured for it (src/theme/levels.json).
import type { ThemeVoice } from '../theme/host/contract';
import type { PackTheme } from '../theme/host/packs';
import { SFX } from '../theme/host/sfx';
import { playVoice, playWheelSound, voiceGain, type SoundSettings, type WheelSound } from './sound';

/** A theme's voices for the wheel's five sounds. A ring's way in and back are the theme's own when
 *  it has them, and its tick otherwise, like every other click of the dial. */
const THEME_VOICE: Record<WheelSound, ThemeVoice[]> = {
  open: ['open'],
  tick: ['tick'],
  enter: ['enter', 'tick'],
  leave: ['leave', 'tick'],
  apply: ['success'],
};

/** Plays a sound of the wheel in the theme of `pack` (the steel wheel's when there is none). */
export function playFor(pack: PackTheme | null, name: WheelSound, settings: SoundSettings): void {
  if (!pack) return playWheelSound(name, settings);
  const sounds = pack.concept.sounds;
  const which = THEME_VOICE[name].find((each) => sounds?.[each]);
  const voice = which && sounds?.[which];
  if (!which || !voice) return;
  playVoice(name, settings, (ac, out, t) => voice(ac, out, t, SFX), undefined, voiceGain(pack.id, which));
}
