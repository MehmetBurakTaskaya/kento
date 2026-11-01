// SPDX-License-Identifier: MIT
// The npm packages that ship inside Kento (dependencies, not devDependencies) must have a
// permissive licence; cargo-deny does the same for the Rust side (src-tauri/deny.toml).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'OFL-1.1',
  'CC0-1.0',
  'Unlicense',
]);
const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { cwd: root, encoding: 'utf8' }));

const seen = new Map();
(function walk(deps = {}) {
  for (const [name, info] of Object.entries(deps)) {
    // Optional peers that are not installed do not ship.
    if (seen.has(name) || info.missing || !existsSync(join(root, 'node_modules', name, 'package.json'))) continue;
    const pkg = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
    const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN');
    seen.set(name, license);
    walk(info.dependencies);
  }
})(tree.dependencies);

const allowed = (expr) =>
  expr
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .some((id) => ALLOWED.has(id.trim()));
const bad = [...seen].filter(([, license]) => !allowed(license));
if (bad.length) {
  console.error(`Licences outside the allow-list:\n${bad.map(([n, l]) => `${n}: ${l}`).join('\n')}`);
  process.exit(1);
}
console.log(`${seen.size} shipped npm packages, all permissively licensed.`);
