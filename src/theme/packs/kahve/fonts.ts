// SPDX-License-Identifier: MIT
// The faces this theme names (Young Serif, Karla): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
// Neither has Cyrillic, so Young Serif's Cyrillic letters come from Vollkorn and Karla's from Onest,
// registered under the same names: Russian labels keep a warm serif and a plain grotesque.
import { registerFaces } from '../../host/fonts';
import youngSerif400Latin from '@fontsource/young-serif/files/young-serif-latin-400-normal.woff2?url';
import youngSerif400LatinExt from '@fontsource/young-serif/files/young-serif-latin-ext-400-normal.woff2?url';
import karlaLatin from '@fontsource-variable/karla/files/karla-latin-wght-normal.woff2?url';
import karlaLatinExt from '@fontsource-variable/karla/files/karla-latin-ext-wght-normal.woff2?url';
import vollkornCyrillic from '@fontsource-variable/vollkorn/files/vollkorn-cyrillic-wght-normal.woff2?url';
import onestCyrillic from '@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2?url';

registerFaces([
  {
    family: 'Young Serif',
    weight: '400',
    sources: [
      {
        url: youngSerif400Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: youngSerif400LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: vollkornCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Karla',
    weight: '200 800',
    sources: [
      {
        url: karlaLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: karlaLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: onestCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
