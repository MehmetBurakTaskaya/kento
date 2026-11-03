// SPDX-License-Identifier: MIT
// The faces this theme names (Quicksand, Righteous): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import quicksandLatin from '@fontsource-variable/quicksand/files/quicksand-latin-wght-normal.woff2?url';
import quicksandLatinExt from '@fontsource-variable/quicksand/files/quicksand-latin-ext-wght-normal.woff2?url';
import righteous400Latin from '@fontsource/righteous/files/righteous-latin-400-normal.woff2?url';
import righteous400LatinExt from '@fontsource/righteous/files/righteous-latin-ext-400-normal.woff2?url';

registerFaces([
  {
    family: 'Quicksand',
    weight: '300 700',
    sources: [
      {
        url: quicksandLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: quicksandLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ],
  },
  {
    family: 'Righteous',
    weight: '400',
    sources: [
      {
        url: righteous400Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: righteous400LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ],
  },
]);
