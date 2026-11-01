// SPDX-License-Identifier: MIT
// Pseudo-languages for testing (SPEC 5.19). en-XA lengthens every text by about 40 % and swaps
// in accented letters, so overflow and hard-coded strings show at once; ar-XB also reverses
// the text and turns the layout right to left. Only the literal parts of an ICU message change:
// placeholders, plurals and selects keep working.
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { printAST } from '@formatjs/icu-messageformat-parser/printer.js';

export const PSEUDO_LANGUAGES = [
  { code: 'en-XA', name: 'Pseudo (long)' },
  { code: 'ar-XB', name: 'Pseudo (right to left)' },
] as const;

const ACCENTED: Record<string, string> = Object.fromEntries(
  [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter, i) => [
    letter,
    [...'áƀçďéƒĝĥíĵķĺɱñöþǫŕšţüṽŵẋýžÁƁÇĎÉƑĜĤÍĴĶĹṀÑÖÞǪŔŠŢÜṼŴẊÝŽ'][i]!,
  ]),
);

const accent = (text: string) => [...text].map((ch) => ACCENTED[ch] ?? ch).join('');

function mapLiterals(elements: MessageFormatElement[], fn: (text: string) => string): void {
  for (const element of elements) {
    if (element.type === TYPE.literal) {
      element.value = fn(element.value);
    } else if (element.type === TYPE.plural || element.type === TYPE.select) {
      for (const option of Object.values(element.options)) mapLiterals(option.value, fn);
    } else if (element.type === TYPE.tag) {
      mapLiterals(element.children, fn);
    }
  }
}

function transform(message: string, fn: (text: string) => string): string {
  const ast = parse(message, { ignoreTag: true });
  mapLiterals(ast, fn);
  return printAST(ast);
}

/** Accented and about 40 % longer, inside brackets that show where a text was cut. */
export function pseudoLong(message: string): string {
  const printed = transform(message, accent);
  // Printing can drop optional spaces in ICU syntax, so measure against the longer of the two.
  const target = Math.ceil(Math.max(message.length, printed.length) * 1.4);
  const pad = '~'.repeat(Math.max(2, target - printed.length - 3));
  return `[${printed} ${pad}]`;
}

const RLO = '‮';
const PDF = '‬';

/** Accented and drawn right to left, for the mirrored layout. */
export function pseudoMirror(message: string): string {
  return transform(message, (text) => (text.trim() ? `${RLO}${accent(text)}${PDF}` : text));
}

export function pseudoDictionary(source: Record<string, string>, fn: (message: string) => string) {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, fn(value)]));
}
