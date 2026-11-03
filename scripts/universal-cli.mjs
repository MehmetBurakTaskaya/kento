// SPDX-License-Identifier: MIT
// Runs before Tauri bundles the Mac app (beforeBundleCommand in src-tauri/tauri.macos.conf.json).
// Tauri packs every binary it builds into Kento.app/Contents/MacOS, the command line kento-cli
// among them, but signs only the app's own program. For a universal build the command line must be
// in target/universal-apple-darwin, made of the Apple silicon and the Intel builds; this makes sure
// it is there and newer than both, joining them with lipo when it is not. Then it signs the command
// line the way the app is signed (the project's certificate in a release, ad hoc elsewhere), because
// codesign refuses to sign an app while another program in Contents/MacOS is unsigned.
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(root, 'src-tauri', 'target');
const profile = process.env.TAURI_ENV_DEBUG === 'true' ? 'debug' : 'release';
const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? '';
const name = 'kento-cli';

let output;
if (triple === 'universal-apple-darwin') {
  output = path.join(target, triple, profile, name);
  const inputs = ['aarch64-apple-darwin', 'x86_64-apple-darwin'].map((arch) => path.join(target, arch, profile, name));
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
} else {
  // A build for one architecture: with --target the binaries are under the triple, without it not.
  output = [path.join(target, triple, profile, name), path.join(target, profile, name)].find((file) =>
    existsSync(file),
  );
  if (!output) {
    console.error(`${name} is missing: the build did not build the command line`);
    process.exit(1);
  }
}

// The identity the release imported (scripts/mac-signing.sh), or an ad-hoc signature, as
// signingIdentity "-" gives the app on a Mac without the certificate.
const identity = process.env.APPLE_SIGNING_IDENTITY || '-';
execFileSync(
  'codesign',
  [
    '--force',
    '--options',
    'runtime',
    '--timestamp=none',
    '--entitlements',
    path.join(root, 'src-tauri', 'Entitlements.plist'),
    '--sign',
    identity,
    output,
  ],
  { stdio: 'inherit' },
);
console.log(`${name}: signed ${identity === '-' ? 'ad hoc' : 'with the project certificate'}`);
