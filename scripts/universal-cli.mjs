// SPDX-License-Identifier: MIT
// Runs before Tauri bundles the Mac app (beforeBundleCommand in src-tauri/tauri.macos.conf.json).
// Tauri packs every binary it builds into Kento.app/Contents/MacOS, the command line kento-cli
// among them. For a universal build it must find each one in target/universal-apple-darwin, made
// of the Apple silicon and the Intel builds; this makes sure the command line is there and newer
// than both, joining them with lipo when it is not. Other builds need nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.TAURI_ENV_TARGET_TRIPLE !== 'universal-apple-darwin') process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(root, 'src-tauri', 'target');
const profile = process.env.TAURI_ENV_DEBUG === 'true' ? 'debug' : 'release';
const name = 'kento-cli';
const output = path.join(target, 'universal-apple-darwin', profile, name);
const inputs = ['aarch64-apple-darwin', 'x86_64-apple-darwin'].map((triple) =>
  path.join(target, triple, profile, name),
);
for (const input of inputs) {
  if (!existsSync(input)) {
    console.error(`${input} is missing: the universal build did not build the command line`);
    process.exit(1);
  }
}
const newest = Math.max(...inputs.map((input) => statSync(input).mtimeMs));
if (!existsSync(output) || statSync(output).mtimeMs < newest) {
  execFileSync('lipo', ['-create', '-output', output, ...inputs], { stdio: 'inherit' });
}
console.log(`${name}: ${execFileSync('lipo', ['-archs', output], { encoding: 'utf8' }).trim()}`);
