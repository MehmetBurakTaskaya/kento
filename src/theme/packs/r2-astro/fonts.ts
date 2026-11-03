// SPDX-License-Identifier: MIT
// The faces this theme names (Literata Variable, Manrope Variable, Unbounded Variable, Geologica Variable): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import literataVariableLatin from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import literataVariableLatinExt from '@fontsource-variable/literata/files/literata-latin-ext-wght-normal.woff2?url';
import literataVariableCyrillic from '@fontsource-variable/literata/files/literata-cyrillic-wght-normal.woff2?url';
import manropeVariableLatin from '@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url';
import manropeVariableLatinExt from '@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2?url';
import manropeVariableCyrillic from '@fontsource-variable/manrope/files/manrope-cyrillic-wght-normal.woff2?url';
import unboundedVariableLatin from '@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2?url';
import unboundedVariableLatinExt from '@fontsource-variable/unbounded/files/unbounded-latin-ext-wght-normal.woff2?url';
import unboundedVariableCyrillic from '@fontsource-variable/unbounded/files/unbounded-cyrillic-wght-normal.woff2?url';
import geologicaVariableLatin from '@fontsource-variable/geologica/files/geologica-latin-wght-normal.woff2?url';
import geologicaVariableLatinExt from '@fontsource-variable/geologica/files/geologica-latin-ext-wght-normal.woff2?url';
import geologicaVariableCyrillic from '@fontsource-variable/geologica/files/geologica-cyrillic-wght-normal.woff2?url';

registerFaces([
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
    family: 'Manrope Variable',
    weight: '200 800',
    sources: [
      {
        url: manropeVariableLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: manropeVariableLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: manropeVariableCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Unbounded Variable',
    weight: '200 900',
    sources: [
      {
        url: unboundedVariableLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: unboundedVariableLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: unboundedVariableCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Geologica Variable',
    weight: '100 900',
    sources: [
      {
        url: geologicaVariableLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: geologicaVariableLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: geologicaVariableCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
