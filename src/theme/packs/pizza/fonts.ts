// SPDX-License-Identifier: MIT
// The faces this theme names (Alfa Slab One, Barlow Semi Condensed): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
// Neither face has Cyrillic, so Alegreya's black answers for Alfa Slab One and Sofia Sans Condensed
// for Barlow Semi Condensed, each inside the family it stands in for.
import { registerFaces } from '../../host/fonts';
import alfaSlabOne400Latin from '@fontsource/alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff2?url';
import alfaSlabOne400LatinExt from '@fontsource/alfa-slab-one/files/alfa-slab-one-latin-ext-400-normal.woff2?url';
import barlowSemiCondensed400Latin from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-400-normal.woff2?url';
import barlowSemiCondensed400LatinExt from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-ext-400-normal.woff2?url';
import barlowSemiCondensed500Latin from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-500-normal.woff2?url';
import barlowSemiCondensed500LatinExt from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-ext-500-normal.woff2?url';
import barlowSemiCondensed600Latin from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2?url';
import barlowSemiCondensed600LatinExt from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-ext-600-normal.woff2?url';
import barlowSemiCondensed700Latin from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2?url';
import barlowSemiCondensed700LatinExt from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-ext-700-normal.woff2?url';
import alegreyaCyrillic from '@fontsource-variable/alegreya/files/alegreya-cyrillic-wght-normal.woff2?url';
import sofiaSansCondensedCyrillic from '@fontsource-variable/sofia-sans-condensed/files/sofia-sans-condensed-cyrillic-wght-normal.woff2?url';

// A stand-in joins a family only when it is registered with the family's own weights; the one
// variable file stands in for each static weight of Barlow Semi Condensed under its own address.
registerFaces([
  {
    family: 'Alfa Slab One',
    // Its one weight stands for the black the labels ask for, so the Cyrillic below matches it.
    weight: '400 900',
    sources: [
      {
        url: alfaSlabOne400Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: alfaSlabOne400LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ],
  },
  {
    family: 'Barlow Semi Condensed',
    weight: '400',
    sources: [
      {
        url: barlowSemiCondensed400Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: barlowSemiCondensed400LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ],
  },
  {
    family: 'Barlow Semi Condensed',
    weight: '500',
    sources: [
      {
        url: barlowSemiCondensed500Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: barlowSemiCondensed500LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ],
  },
  {
    family: 'Barlow Semi Condensed',
    weight: '600',
    sources: [
      {
        url: barlowSemiCondensed600Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: barlowSemiCondensed600LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ],
  },
  {
    family: 'Barlow Semi Condensed',
    weight: '700',
    sources: [
      {
        url: barlowSemiCondensed700Latin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: barlowSemiCondensed700LatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ],
  },
  {
    family: 'Alfa Slab One',
    weight: '400 900',
    sources: [{ url: alegreyaCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' }],
  },
  {
    family: 'Barlow Semi Condensed',
    weight: '400',
    sources: [
      { url: `${sofiaSansCondensedCyrillic}#w400`, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Barlow Semi Condensed',
    weight: '500',
    sources: [
      { url: `${sofiaSansCondensedCyrillic}#w500`, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Barlow Semi Condensed',
    weight: '600',
    sources: [
      { url: `${sofiaSansCondensedCyrillic}#w600`, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
  {
    family: 'Barlow Semi Condensed',
    weight: '700',
    sources: [
      { url: `${sofiaSansCondensedCyrillic}#w700`, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
