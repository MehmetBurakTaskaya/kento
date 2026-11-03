// SPDX-License-Identifier: MIT
// The faces this theme names (Alegreya SC, Alegreya Sans): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import alegreyaSC500Latin from '@fontsource/alegreya-sc/files/alegreya-sc-latin-500-normal.woff2?url';
import alegreyaSC500LatinExt from '@fontsource/alegreya-sc/files/alegreya-sc-latin-ext-500-normal.woff2?url';
import alegreyaSC500Cyrillic from '@fontsource/alegreya-sc/files/alegreya-sc-cyrillic-500-normal.woff2?url';
import alegreyaSC700Latin from '@fontsource/alegreya-sc/files/alegreya-sc-latin-700-normal.woff2?url';
import alegreyaSC700LatinExt from '@fontsource/alegreya-sc/files/alegreya-sc-latin-ext-700-normal.woff2?url';
import alegreyaSC700Cyrillic from '@fontsource/alegreya-sc/files/alegreya-sc-cyrillic-700-normal.woff2?url';
import alegreyaSC800Latin from '@fontsource/alegreya-sc/files/alegreya-sc-latin-800-normal.woff2?url';
import alegreyaSC800LatinExt from '@fontsource/alegreya-sc/files/alegreya-sc-latin-ext-800-normal.woff2?url';
import alegreyaSC800Cyrillic from '@fontsource/alegreya-sc/files/alegreya-sc-cyrillic-800-normal.woff2?url';
import alegreyaSans400Latin from '@fontsource/alegreya-sans/files/alegreya-sans-latin-400-normal.woff2?url';
import alegreyaSans400LatinExt from '@fontsource/alegreya-sans/files/alegreya-sans-latin-ext-400-normal.woff2?url';
import alegreyaSans400Cyrillic from '@fontsource/alegreya-sans/files/alegreya-sans-cyrillic-400-normal.woff2?url';
import alegreyaSans500Latin from '@fontsource/alegreya-sans/files/alegreya-sans-latin-500-normal.woff2?url';
import alegreyaSans500LatinExt from '@fontsource/alegreya-sans/files/alegreya-sans-latin-ext-500-normal.woff2?url';
import alegreyaSans500Cyrillic from '@fontsource/alegreya-sans/files/alegreya-sans-cyrillic-500-normal.woff2?url';
import alegreyaSans700Latin from '@fontsource/alegreya-sans/files/alegreya-sans-latin-700-normal.woff2?url';
import alegreyaSans700LatinExt from '@fontsource/alegreya-sans/files/alegreya-sans-latin-ext-700-normal.woff2?url';
import alegreyaSans700Cyrillic from '@fontsource/alegreya-sans/files/alegreya-sans-cyrillic-700-normal.woff2?url';

registerFaces([
  {
    family: 'Alegreya SC',
    weight: '500',
    sources: [
      {
        url: alegreyaSC500Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: alegreyaSC500LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: alegreyaSC500Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Alegreya SC',
    weight: '700',
    sources: [
      {
        url: alegreyaSC700Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: alegreyaSC700LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: alegreyaSC700Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Alegreya SC',
    weight: '800',
    sources: [
      {
        url: alegreyaSC800Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: alegreyaSC800LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: alegreyaSC800Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Alegreya Sans',
    weight: '400',
    sources: [
      {
        url: alegreyaSans400Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: alegreyaSans400LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: alegreyaSans400Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Alegreya Sans',
    weight: '500',
    sources: [
      {
        url: alegreyaSans500Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: alegreyaSans500LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: alegreyaSans500Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Alegreya Sans',
    weight: '700',
    sources: [
      {
        url: alegreyaSans700Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: alegreyaSans700LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: alegreyaSans700Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
