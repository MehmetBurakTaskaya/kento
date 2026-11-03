// SPDX-License-Identifier: MIT
// The faces this theme names (IBM Plex Sans Variable, Inter Tight Variable, Martian Mono Variable, Manrope Variable): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import iBMPlexSansVariableLatin from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wdth-normal.woff2?url';
import iBMPlexSansVariableLatinExt from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-ext-wdth-normal.woff2?url';
import iBMPlexSansVariableCyrillic from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-cyrillic-wdth-normal.woff2?url';
import interTightVariableLatin from '@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2?url';
import interTightVariableLatinExt from '@fontsource-variable/inter-tight/files/inter-tight-latin-ext-wght-normal.woff2?url';
import interTightVariableCyrillic from '@fontsource-variable/inter-tight/files/inter-tight-cyrillic-wght-normal.woff2?url';
import martianMonoVariableLatin from '@fontsource-variable/martian-mono/files/martian-mono-latin-wdth-normal.woff2?url';
import martianMonoVariableLatinExt from '@fontsource-variable/martian-mono/files/martian-mono-latin-ext-wdth-normal.woff2?url';
import martianMonoVariableCyrillic from '@fontsource-variable/martian-mono/files/martian-mono-cyrillic-wdth-normal.woff2?url';
import manropeVariableLatin from '@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url';
import manropeVariableLatinExt from '@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2?url';
import manropeVariableCyrillic from '@fontsource-variable/manrope/files/manrope-cyrillic-wght-normal.woff2?url';

registerFaces([
  {
    family: 'IBM Plex Sans Variable',
    weight: '100 700',
    stretch: '75% 100%',
    sources: [
      {
        url: iBMPlexSansVariableLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: iBMPlexSansVariableLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: iBMPlexSansVariableCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Inter Tight Variable',
    weight: '100 900',
    sources: [
      {
        url: interTightVariableLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: interTightVariableLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: interTightVariableCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Martian Mono Variable',
    weight: '100 800',
    stretch: '75% 112.5%',
    sources: [
      {
        url: martianMonoVariableLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: martianMonoVariableLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: martianMonoVariableCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
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
]);
