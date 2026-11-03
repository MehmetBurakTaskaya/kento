// SPDX-License-Identifier: MIT
// The faces this theme names (Cinzel, Vollkorn): Latin, Latin Extended and Cyrillic only,
// from the Fontsource packages, registered under the family names the theme's code and styles use.
// Cinzel has no Cyrillic, so its Russian letters come from Vollkorn's Cyrillic, registered under the
// Cinzel family too: titles are measured and drawn in one face whatever the language.
import { registerFaces } from '../../host/fonts';
import cinzelLatin from '@fontsource-variable/cinzel/files/cinzel-latin-wght-normal.woff2?url';
import cinzelLatinExt from '@fontsource-variable/cinzel/files/cinzel-latin-ext-wght-normal.woff2?url';
import vollkornVariableLatin from '@fontsource-variable/vollkorn/files/vollkorn-latin-wght-normal.woff2?url';
import vollkornVariableLatinExt from '@fontsource-variable/vollkorn/files/vollkorn-latin-ext-wght-normal.woff2?url';
import vollkornVariableCyrillic from '@fontsource-variable/vollkorn/files/vollkorn-cyrillic-wght-normal.woff2?url';

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';

registerFaces([
  {
    family: 'Cinzel',
    weight: '400 900',
    sources: [
      { url: cinzelLatin, range: LATIN },
      { url: cinzelLatinExt, range: LATIN_EXT },
      { url: vollkornVariableCyrillic, range: CYRILLIC },
    ],
  },
  {
    family: 'Vollkorn Variable',
    weight: '400 900',
    sources: [
      { url: vollkornVariableLatin, range: LATIN },
      { url: vollkornVariableLatinExt, range: LATIN_EXT },
      { url: vollkornVariableCyrillic, range: CYRILLIC },
    ],
  },
]);
