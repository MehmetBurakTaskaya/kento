// SPDX-License-Identifier: MIT
// Every tracked source file starts with the SPDX line (in its first three lines).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CODE = /\.(rs|ts|tsx|js|mjs|cjs|css|html)$/;
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  // A file deleted but not yet committed is still listed by git.
  .filter((file) => CODE.test(file) && existsSync(join(root, file)));
const missing = files.filter((file) => {
  const head = readFileSync(join(root, file), 'utf8').split('\n', 3).join('\n');
  return !head.includes('SPDX-License-Identifier: MIT');
});
if (missing.length) {
  console.error(`No SPDX-License-Identifier: MIT line in:\n${missing.join('\n')}`);
  process.exit(1);
}
console.log(`${files.length} source files carry the SPDX line.`);
