// SPDX-License-Identifier: MIT
// The faces this theme names: Playpen Sans (Latin, Latin Extended and Cyrillic), Bangers (Latin and
// Latin Extended) and, for the Cyrillic letters Bangers lacks, Sofia Sans Condensed, from the
// Fontsource packages, registered under the family names the theme's code and styles use.
import { registerFaces } from '../../host/fonts';
import playpenSansLatin from '@fontsource-variable/playpen-sans/files/playpen-sans-latin-wght-normal.woff2?url';
import playpenSansLatinExt from '@fontsource-variable/playpen-sans/files/playpen-sans-latin-ext-wght-normal.woff2?url';
import playpenSansCyrillic from '@fontsource-variable/playpen-sans/files/playpen-sans-cyrillic-wght-normal.woff2?url';
import bangers400Latin from '@fontsource/bangers/files/bangers-latin-400-normal.woff2?url';
import bangers400LatinExt from '@fontsource/bangers/files/bangers-latin-ext-400-normal.woff2?url';
import sofiaSansCondensedCyrillic from '@fontsource-variable/sofia-sans-condensed/files/sofia-sans-condensed-cyrillic-wght-normal.woff2?url';

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';

registerFaces([
  {
    family: 'Playpen Sans',
    weight: '100 800',
    sources: [
      { url: playpenSansLatin, range: LATIN },
      { url: playpenSansLatinExt, range: LATIN_EXT },
      { url: playpenSansCyrillic, range: CYRILLIC },
    ],
  },
  {
    family: 'Bangers',
    weight: '400',
    sources: [
      { url: bangers400Latin, range: LATIN },
      { url: bangers400LatinExt, range: LATIN_EXT },
    ],
  },
  {
    family: 'Sofia Sans Condensed',
    weight: '1 1000',
    sources: [{ url: sofiaSansCondensedCyrillic, range: CYRILLIC }],
  },
]);
