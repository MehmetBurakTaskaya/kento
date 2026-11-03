// SPDX-License-Identifier: MIT
// The faces this theme names: Raleway (Latin, Latin Extended and Cyrillic), Limelight (Latin and
// Latin Extended) and, for the Cyrillic letters Limelight lacks, Yeseva One, from the Fontsource
// packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import ralewayLatin from '@fontsource-variable/raleway/files/raleway-latin-wght-normal.woff2?url';
import ralewayLatinExt from '@fontsource-variable/raleway/files/raleway-latin-ext-wght-normal.woff2?url';
import ralewayCyrillic from '@fontsource-variable/raleway/files/raleway-cyrillic-wght-normal.woff2?url';
import limelight400Latin from '@fontsource/limelight/files/limelight-latin-400-normal.woff2?url';
import limelight400LatinExt from '@fontsource/limelight/files/limelight-latin-ext-400-normal.woff2?url';
import yesevaOneCyrillic from '@fontsource/yeseva-one/files/yeseva-one-cyrillic-400-normal.woff2?url';

registerFaces([
  {
    family: 'Raleway',
    weight: '100 900',
    sources: [
      {
        url: ralewayLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: ralewayLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: ralewayCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Limelight',
    weight: '400',
    sources: [
      {
        url: limelight400Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: limelight400LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ],
  },
  {
    family: 'Yeseva One',
    weight: '400',
    sources: [{ url: yesevaOneCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' }],
  },
]);
