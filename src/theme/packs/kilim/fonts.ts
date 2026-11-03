// SPDX-License-Identifier: MIT
// The faces this theme names (Kufam): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
// Kufam has no Cyrillic, so its Cyrillic letters come from Exo 2, registered under the same name:
// Russian labels keep a squarish geometric face rather than the system's.
import { registerFaces } from '../../host/fonts';
import kufamLatin from '@fontsource-variable/kufam/files/kufam-latin-wght-normal.woff2?url';
import kufamLatinExt from '@fontsource-variable/kufam/files/kufam-latin-ext-wght-normal.woff2?url';
import exo2Cyrillic from '@fontsource-variable/exo-2/files/exo-2-cyrillic-wght-normal.woff2?url';

registerFaces([
  {
    family: 'Kufam',
    weight: '400 900',
    sources: [
      {
        url: kufamLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: kufamLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: exo2Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
