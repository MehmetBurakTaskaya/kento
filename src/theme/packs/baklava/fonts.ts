// SPDX-License-Identifier: MIT
// The faces this theme names (Yeseva One, El Messiri): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import yesevaOne400Latin from '@fontsource/yeseva-one/files/yeseva-one-latin-400-normal.woff2?url';
import yesevaOne400LatinExt from '@fontsource/yeseva-one/files/yeseva-one-latin-ext-400-normal.woff2?url';
import yesevaOne400Cyrillic from '@fontsource/yeseva-one/files/yeseva-one-cyrillic-400-normal.woff2?url';
import elMessiriLatin from '@fontsource-variable/el-messiri/files/el-messiri-latin-wght-normal.woff2?url';
import elMessiriLatinExt from '@fontsource-variable/el-messiri/files/el-messiri-latin-ext-wght-normal.woff2?url';
import elMessiriCyrillic from '@fontsource-variable/el-messiri/files/el-messiri-cyrillic-wght-normal.woff2?url';

registerFaces([
  {
    family: 'Yeseva One',
    weight: '400',
    sources: [
      {
        url: yesevaOne400Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: yesevaOne400LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: yesevaOne400Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'El Messiri',
    weight: '400 700',
    sources: [
      {
        url: elMessiriLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: elMessiriLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: elMessiriCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
