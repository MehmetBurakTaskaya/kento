// SPDX-License-Identifier: MIT
// The faces this theme names (Zen Maru Gothic): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import zenMaruGothic500Latin from '@fontsource/zen-maru-gothic/files/zen-maru-gothic-latin-500-normal.woff2?url';
import zenMaruGothic500LatinExt from '@fontsource/zen-maru-gothic/files/zen-maru-gothic-latin-ext-500-normal.woff2?url';
import zenMaruGothic500Cyrillic from '@fontsource/zen-maru-gothic/files/zen-maru-gothic-cyrillic-500-normal.woff2?url';
import zenMaruGothic700Latin from '@fontsource/zen-maru-gothic/files/zen-maru-gothic-latin-700-normal.woff2?url';
import zenMaruGothic700LatinExt from '@fontsource/zen-maru-gothic/files/zen-maru-gothic-latin-ext-700-normal.woff2?url';
import zenMaruGothic700Cyrillic from '@fontsource/zen-maru-gothic/files/zen-maru-gothic-cyrillic-700-normal.woff2?url';
import zenMaruGothic900Latin from '@fontsource/zen-maru-gothic/files/zen-maru-gothic-latin-900-normal.woff2?url';
import zenMaruGothic900LatinExt from '@fontsource/zen-maru-gothic/files/zen-maru-gothic-latin-ext-900-normal.woff2?url';
import zenMaruGothic900Cyrillic from '@fontsource/zen-maru-gothic/files/zen-maru-gothic-cyrillic-900-normal.woff2?url';

registerFaces([
  {
    family: 'Zen Maru Gothic',
    weight: '500',
    sources: [
      {
        url: zenMaruGothic500Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: zenMaruGothic500LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: zenMaruGothic500Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Zen Maru Gothic',
    weight: '700',
    sources: [
      {
        url: zenMaruGothic700Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: zenMaruGothic700LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: zenMaruGothic700Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Zen Maru Gothic',
    weight: '900',
    sources: [
      {
        url: zenMaruGothic900Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: zenMaruGothic900LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: zenMaruGothic900Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
