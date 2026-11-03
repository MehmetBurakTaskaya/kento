// SPDX-License-Identifier: MIT
// The faces this theme names (Spectral, Raleway): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import spectral500Latin from '@fontsource/spectral/files/spectral-latin-500-normal.woff2?url';
import spectral500LatinExt from '@fontsource/spectral/files/spectral-latin-ext-500-normal.woff2?url';
import spectral500Cyrillic from '@fontsource/spectral/files/spectral-cyrillic-500-normal.woff2?url';
import spectral600Latin from '@fontsource/spectral/files/spectral-latin-600-normal.woff2?url';
import spectral600LatinExt from '@fontsource/spectral/files/spectral-latin-ext-600-normal.woff2?url';
import spectral600Cyrillic from '@fontsource/spectral/files/spectral-cyrillic-600-normal.woff2?url';
import ralewayLatin from '@fontsource-variable/raleway/files/raleway-latin-wght-normal.woff2?url';
import ralewayLatinExt from '@fontsource-variable/raleway/files/raleway-latin-ext-wght-normal.woff2?url';
import ralewayCyrillic from '@fontsource-variable/raleway/files/raleway-cyrillic-wght-normal.woff2?url';

registerFaces([
  {
    family: 'Spectral',
    weight: '500',
    sources: [
      {
        url: spectral500Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: spectral500LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: spectral500Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Spectral',
    weight: '600',
    sources: [
      {
        url: spectral600Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: spectral600LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: spectral600Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
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
]);
