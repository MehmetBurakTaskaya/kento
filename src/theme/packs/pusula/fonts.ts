// SPDX-License-Identifier: MIT
// The faces this theme names (Vollkorn Variable, Fira Sans): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import vollkornVariableLatin from '@fontsource-variable/vollkorn/files/vollkorn-latin-wght-normal.woff2?url';
import vollkornVariableLatinExt from '@fontsource-variable/vollkorn/files/vollkorn-latin-ext-wght-normal.woff2?url';
import vollkornVariableCyrillic from '@fontsource-variable/vollkorn/files/vollkorn-cyrillic-wght-normal.woff2?url';
import vollkornVariableItalicLatin from '@fontsource-variable/vollkorn/files/vollkorn-latin-wght-italic.woff2?url';
import vollkornVariableItalicLatinExt from '@fontsource-variable/vollkorn/files/vollkorn-latin-ext-wght-italic.woff2?url';
import vollkornVariableItalicCyrillic from '@fontsource-variable/vollkorn/files/vollkorn-cyrillic-wght-italic.woff2?url';
import firaSans400Latin from '@fontsource/fira-sans/files/fira-sans-latin-400-normal.woff2?url';
import firaSans400LatinExt from '@fontsource/fira-sans/files/fira-sans-latin-ext-400-normal.woff2?url';
import firaSans400Cyrillic from '@fontsource/fira-sans/files/fira-sans-cyrillic-400-normal.woff2?url';
import firaSans500Latin from '@fontsource/fira-sans/files/fira-sans-latin-500-normal.woff2?url';
import firaSans500LatinExt from '@fontsource/fira-sans/files/fira-sans-latin-ext-500-normal.woff2?url';
import firaSans500Cyrillic from '@fontsource/fira-sans/files/fira-sans-cyrillic-500-normal.woff2?url';
import firaSans600Latin from '@fontsource/fira-sans/files/fira-sans-latin-600-normal.woff2?url';
import firaSans600LatinExt from '@fontsource/fira-sans/files/fira-sans-latin-ext-600-normal.woff2?url';
import firaSans600Cyrillic from '@fontsource/fira-sans/files/fira-sans-cyrillic-600-normal.woff2?url';

registerFaces([
  {
    family: 'Vollkorn Variable',
    weight: '400 900',
    sources: [
      {
        url: vollkornVariableLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: vollkornVariableLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: vollkornVariableCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Vollkorn Variable',
    weight: '400 900',
    style: 'italic',
    sources: [
      {
        url: vollkornVariableItalicLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: vollkornVariableItalicLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: vollkornVariableItalicCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Fira Sans',
    weight: '400',
    sources: [
      {
        url: firaSans400Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: firaSans400LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: firaSans400Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Fira Sans',
    weight: '500',
    sources: [
      {
        url: firaSans500Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: firaSans500LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: firaSans500Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Fira Sans',
    weight: '600',
    sources: [
      {
        url: firaSans600Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: firaSans600LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: firaSans600Cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
