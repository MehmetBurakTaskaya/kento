// SPDX-License-Identifier: MIT
// The face this theme names (Bricolage Grotesque): Latin and Latin Extended from its Fontsource package.
// Bricolage Grotesque has no Cyrillic, so Russian letters come from Onest's Cyrillic, registered under
// the same family: labels are measured and drawn in one face whatever the language.
import { registerFaces } from '../../host/fonts';
import onestCyrillic from '@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2?url';
import bricolageGrotesqueLatin from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2?url';
import bricolageGrotesqueLatinExt from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-standard-normal.woff2?url';

registerFaces([
  {
    family: 'Bricolage Grotesque',
    weight: '200 800',
    stretch: '75% 100%',
    sources: [
      {
        url: bricolageGrotesqueLatin,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        url: bricolageGrotesqueLatinExt,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
      { url: onestCyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
    ],
  },
]);
