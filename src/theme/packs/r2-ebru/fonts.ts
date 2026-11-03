// SPDX-License-Identifier: MIT
// The faces this theme names (Ysabeau Office Variable, Literata Variable, Onest Variable): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import ysabeauOfficeVariableLatin from '@fontsource-variable/ysabeau-office/files/ysabeau-office-latin-wght-normal.woff2?url';
import ysabeauOfficeVariableLatinExt from '@fontsource-variable/ysabeau-office/files/ysabeau-office-latin-ext-wght-normal.woff2?url';
import ysabeauOfficeVariableCyrillic from '@fontsource-variable/ysabeau-office/files/ysabeau-office-cyrillic-wght-normal.woff2?url';
import literataVariableLatin from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import literataVariableLatinExt from '@fontsource-variable/literata/files/literata-latin-ext-wght-normal.woff2?url';
import literataVariableCyrillic from '@fontsource-variable/literata/files/literata-cyrillic-wght-normal.woff2?url';
import onestVariableLatin from '@fontsource-variable/onest/files/onest-latin-wght-normal.woff2?url';
import onestVariableLatinExt from '@fontsource-variable/onest/files/onest-latin-ext-wght-normal.woff2?url';
import onestVariableCyrillic from '@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2?url';

registerFaces([
  {
    family: 'Ysabeau Office Variable',
    weight: '1 1000',
    sources: [
      {
        url: ysabeauOfficeVariableLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: ysabeauOfficeVariableLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: ysabeauOfficeVariableCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Literata Variable',
    weight: '200 900',
    sources: [
      {
        url: literataVariableLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: literataVariableLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: literataVariableCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Onest Variable',
    weight: '100 900',
    sources: [
      {
        url: onestVariableLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: onestVariableLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: onestVariableCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
