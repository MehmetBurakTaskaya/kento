// SPDX-License-Identifier: MIT
// The faces this theme names (Geologica, Literata): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import geologicaLatin from '@fontsource-variable/geologica/files/geologica-latin-wght-normal.woff2?url';
import geologicaLatinExt from '@fontsource-variable/geologica/files/geologica-latin-ext-wght-normal.woff2?url';
import geologicaCyrillic from '@fontsource-variable/geologica/files/geologica-cyrillic-wght-normal.woff2?url';
import literataItalicLatin from '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url';
import literataItalicLatinExt from '@fontsource-variable/literata/files/literata-latin-ext-wght-italic.woff2?url';
import literataItalicCyrillic from '@fontsource-variable/literata/files/literata-cyrillic-wght-italic.woff2?url';

registerFaces([
  {
    family: 'Geologica',
    weight: '100 900',
    sources: [
      {
        url: geologicaLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: geologicaLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: geologicaCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Literata',
    weight: '200 900',
    style: 'italic',
    sources: [
      {
        url: literataItalicLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: literataItalicLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: literataItalicCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
