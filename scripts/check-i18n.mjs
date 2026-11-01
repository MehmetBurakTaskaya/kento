// SPDX-License-Identifier: MIT
// Fails when a locale file disagrees with locales/en.json (keys, ICU arguments, empty texts,
// "@language" and "@status"), when a message is not valid ICU, or when code uses a key that does not
// exist. Lists the translations that still wait for review.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@formatjs/icu-messageformat-parser';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = join(root, 'locales');
const load = (code) => JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8'));
const codes = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -5))
  .sort();
const strings = (dict) => Object.fromEntries(Object.entries(dict).filter(([key]) => !key.startsWith('@')));
const args = (text) =>
  [...text.matchAll(/\{\s*(\w+)\s*[,}]/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

const problems = [];
const waiting = [];
const en = strings(load('en'));

for (const code of codes) {
  const file = `locales/${code}.json`;
  let raw;
  try {
    raw = load(code);
  } catch (error) {
    problems.push(`${file} is not valid JSON: ${error.message}`);
    continue;
  }
  const dict = strings(raw);
  if (!raw['@language']) problems.push(`${file} has no "@language"`);
  const status = raw['@status'];
  if (code === 'en' ? status !== 'source' : !['needs review', 'reviewed'].includes(status)) {
    problems.push(`${file} has "@status" ${JSON.stringify(status)}`);
  }
  if (status === 'needs review') waiting.push(code);
  for (const key of Object.keys(en)) if (!(key in dict)) problems.push(`${file} is missing "${key}"`);
  for (const [key, text] of Object.entries(dict)) {
    if (!(key in en)) problems.push(`${file} has "${key}", which English does not`);
    if (typeof text !== 'string' || !text.trim()) problems.push(`${file} "${key}" is empty`);
    else if (key in en && args(text) !== args(en[key]))
      problems.push(`${file} "${key}" uses {${args(text)}}, English {${args(en[key])}}`);
    try {
      parse(text, { ignoreTag: true });
    } catch (error) {
      problems.push(`${file} "${key}" is not valid ICU: ${error.message}`);
    }
  }
}

// Keys written out in code: t('key') in the page, t("key") and text(…, "key") in Rust.
function walk(folder, ext) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === 'target' ? [] : walk(path, ext);
    return ext.some((e) => entry.name.endsWith(e)) ? [path] : [];
  });
}
const uses = [
  ...walk(join(root, 'src'), ['.ts', '.tsx']).map((path) => [path, /\bt\(\s*'([\w.-]+)'/g]),
  ...walk(join(root, 'src-tauri', 'src'), ['.rs']).map((path) => [
    path,
    /\b(?:t|text)\([^)]*?"([a-z][\w-]*\.[\w.-]+)"/g,
  ]),
];
for (const [path, pattern] of uses) {
  if (path.endsWith('.test.ts')) continue;
  // Rust tests may ask for keys that do not exist on purpose.
  const code = readFileSync(path, 'utf8').split('#[cfg(test)]')[0];
  for (const match of code.matchAll(pattern)) {
    if (!(match[1] in en))
      problems.push(`${relative(root, path)} uses "${match[1]}", which locales/en.json does not have`);
  }
}

if (waiting.length) console.log(`Waiting for review: ${waiting.join(', ')}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`${codes.length} locale files, ${Object.keys(en).length} keys: consistent.`);
