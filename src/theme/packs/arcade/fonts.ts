// SPDX-License-Identifier: MIT
// The faces this theme names (Tilt Neon, Bungee): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import tiltNeon400Latin from '@fontsource/tilt-neon/files/tilt-neon-latin-400-normal.woff2?url';
import tiltNeon400LatinExt from '@fontsource/tilt-neon/files/tilt-neon-latin-ext-400-normal.woff2?url';
import bungee400Latin from '@fontsource/bungee/files/bungee-latin-400-normal.woff2?url';
import bungee400LatinExt from '@fontsource/bungee/files/bungee-latin-ext-400-normal.woff2?url';

registerFaces([
  {
    family: 'Tilt Neon',
    weight: '400',
    sources: [
      {
        url: tiltNeon400Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: tiltNeon400LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ],
  },
  {
    family: 'Bungee',
    weight: '400',
    sources: [
      {
        url: bungee400Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: bungee400LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ],
  },
]);
