// SPDX-License-Identifier: MIT
// Makes the themes' recorded voices, src/theme/sounds/<theme>/<voice>-<k>.mp3, from the CC0 recordings
// listed in src/theme/sounds/sources.json: `recordings` by Freesound id (title, author, page, preview,
// licence) and `themes`, each with what it sounds like (`about`) and the clips of its five voices
// (open, tick, enter, leave, success), takes in order. Each recording's Freesound preview is downloaded once into
// artifacts/sound-cache/ (not committed); each clip is cut from it as listed: the stretch from `start`
// to `end` seconds, mono, high-passed at `hp` Hz (and low-passed at `lp`), played `rate` times faster,
// faded in and out, brought to the same loudness as every other clip (its loudest 30 ms at -16 dBFS,
// its peak at most -1.5 dBFS), 32 kHz MP3 at 96 kbps. src/theme/levels.json then sets each voice's
// level (npm run theme:levels). Files no clip names are removed.
//
//   node scripts/theme-sounds.mjs            all themes
//   node scripts/theme-sounds.mjs karpuz     one theme
//   node scripts/theme-sounds.mjs --check    every clip has its file and no file is left over
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src', 'theme', 'sounds');
const cache = path.join(root, 'artifacts', 'sound-cache');
const SR = 32000;
const VOICES = ['open', 'tick', 'enter', 'leave', 'success'];

const sources = JSON.parse(readFileSync(path.join(dir, 'sources.json'), 'utf8'));
const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.find((arg) => !arg.startsWith('--'));

/** The files the manifest asks for, by theme. */
function wanted(theme) {
  const files = [];
  for (const voice of VOICES)
    (sources.themes[theme][voice] ?? []).forEach((clip, k) =>
      files.push({ voice, clip, file: `${voice}-${k + 1}.mp3` }),
    );
  return files;
}

if (check) {
  const problems = [];
  for (const theme of Object.keys(sources.themes)) {
    const files = wanted(theme);
    for (const { clip, file } of files) {
      if (!existsSync(path.join(dir, theme, file))) problems.push(`${theme}/${file} is missing`);
      const source = sources.recordings[clip.from];
      if (!source) problems.push(`${theme}/${file}: recording ${clip.from} is not listed`);
      else if (source.license !== 'CC0-1.0') problems.push(`${theme}/${file}: recording ${clip.from} is not CC0`);
    }
    const names = new Set(files.map((each) => each.file));
    if (existsSync(path.join(dir, theme)))
      for (const name of readdirSync(path.join(dir, theme)))
        if (!names.has(name)) problems.push(`${theme}/${name} is not in sources.json`);
  }
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    if (entry.isDirectory() && !sources.themes[entry.name]) problems.push(`${entry.name}/ is not in sources.json`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('Every theme sound matches sources.json.');
  process.exit(0);
}

const ffmpeg = (argv, input) =>
  execFileSync('ffmpeg', ['-v', 'error', ...argv], { input, maxBuffer: 1 << 28, windowsHide: true });

async function preview(id) {
  const file = path.join(cache, `${id}.mp3`);
  if (existsSync(file)) return file;
  const source = sources.recordings[id];
  if (!source || source.license !== 'CC0-1.0') throw new Error(`recording ${id} is not a listed CC0 recording`);
  const response = await fetch(source.preview);
  if (!response.ok) throw new Error(`${source.preview}: ${response.status}`);
  mkdirSync(cache, { recursive: true });
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

const floats = (raw) => new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();

/** The loudest 30 ms of a sound, as RMS. */
function loudest(y) {
  const n = Math.round(SR * 0.03);
  let sum = 0;
  let best = 0;
  for (let i = 0; i < y.length; i++) {
    sum += y[i] * y[i];
    if (i >= n) sum -= y[i - n] * y[i - n];
    best = Math.max(best, sum);
  }
  return Math.sqrt(best / Math.min(n, y.length));
}

async function cut(clip, out) {
  const { start, end, fadein = 0.002, hp = 70, lp = 0, rate = 1 } = clip;
  const length = (end - start) / rate;
  const fadeout = clip.fadeout ?? Math.min(0.06, Math.max(0.005, 0.15 * length));
  // An MP3 decoder that starts at a seek point mutes its first frame (about 26 ms), which would eat a
  // tick's attack: decoding starts up to 250 ms earlier and the extra samples go before any filter.
  const pre = Math.min(start, 0.25);
  const decoded = floats(
    ffmpeg([
      ...['-ss', (start - pre).toFixed(4), '-t', (end - start + pre).toFixed(4)],
      ...['-i', await preview(clip.from), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'],
    ]),
  );
  const skip = Math.round(pre * SR);
  const exact = decoded.slice(skip, skip + Math.round((end - start) * SR));
  const chain = [];
  if (rate !== 1) chain.push(`asetrate=${(SR * rate).toFixed(3)}`, `aresample=${SR}`);
  if (hp) chain.push(`highpass=f=${hp}:poles=2`);
  if (lp) chain.push(`lowpass=f=${lp}:poles=2`);
  chain.push(
    `afade=t=in:st=0:d=${fadein}`,
    `afade=t=out:st=${Math.max(0, length - fadeout).toFixed(4)}:d=${fadeout.toFixed(4)}`,
  );
  const y = floats(
    ffmpeg(
      ['-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-af', chain.join(','), '-f', 'f32le', '-'],
      Buffer.from(exact.buffer, exact.byteOffset, exact.byteLength),
    ),
  );
  let peak = 0;
  for (const x of y) peak = Math.max(peak, Math.abs(x));
  const gain = Math.min(10 ** (-16 / 20) / loudest(y), 10 ** (-1.5 / 20) / peak);
  for (let i = 0; i < y.length; i++) y[i] *= gain;
  ffmpeg(
    ['-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '96k', out],
    Buffer.from(y.buffer),
  );
}

let made = 0;
for (const theme of Object.keys(sources.themes)) {
  if (only && theme !== only) continue;
  const folder = path.join(dir, theme);
  mkdirSync(folder, { recursive: true });
  const files = wanted(theme);
  for (const { clip, file } of files) {
    await cut(clip, path.join(folder, file));
    made++;
  }
  const names = new Set(files.map((each) => each.file));
  for (const name of readdirSync(folder)) if (!names.has(name)) rmSync(path.join(folder, name));
}
console.log(`${made} theme sounds in src/theme/sounds`);
