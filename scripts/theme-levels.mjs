// SPDX-License-Identifier: MIT
// The level of every voice of every theme (src/theme/levels.json): each voice is drawn offline in
// headless Chromium, the app's own code through Vite, and measured; the table holds the gain, in
// decibels, that brings it to the level its sound should have at full volume. So every theme is as
// loud as every other, and a theme whose clicks were drawn quietly is not lost under the others.
// A theme's recorded voices (src/theme/sounds) are measured take by take, its voices drawn in code
// only where it has no recording. Run it again after changing a theme's sounds:
//   npm run theme:levels             write the table
//   npm run theme:levels -- --check  fail if the table is not the one the voices give
//
// Loudness of short sounds: the loudest 30 ms of the voice (its RMS), so a click and a chime compare
// by what the ear hears of them, not by their length. The gain also keeps the voice's peak under
// CEILING, and stays within LIMITS: a voice drawn nearly silent is not blown up.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'theme', 'levels.json');
const check = process.argv.includes('--check');

/** Each sound's loudest 30 ms at full volume, in dBFS: the clicks a little under the opening and the
 *  ring's way in, and the apply above them all. */
const TARGET = { open: -22, tick: -24, enter: -22, leave: -24, success: -16 };
const CEILING = -1;
const LIMITS = [-12, 36];
/** Takes per voice, each with its own chance: voices that vary are measured over several. */
const TAKES = 3;

const server = await createServer({
  root,
  cacheDir: path.join(root, 'artifacts', 'theme-levels', 'vite-cache'),
  logLevel: 'error',
  server: { port: 1450, strictPort: false },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
let measured;
try {
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  measured = await page.evaluate(
    async ({ takes }) => {
      const RATE = 48000;
      const seeded = (seed) => {
        let s = seed >>> 0 || 1;
        return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
      };
      const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
      const measure = (data) => {
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        const win = Math.round(RATE * 0.03);
        const hop = Math.round(RATE * 0.005);
        let loudest = 0;
        for (let s = 0; s + win <= data.length; s += hop) {
          let sum = 0;
          for (let i = s; i < s + win; i++) sum += data[i] * data[i];
          loudest = Math.max(loudest, Math.sqrt(sum / win));
        }
        return { peak: db(peak), rms: db(loudest) };
      };
      // A voice drawn `takes` times: the median loudness and the highest peak.
      const render = async (voice) => {
        const runs = [];
        for (let k = 0; k < takes; k++) {
          const ac = new OfflineAudioContext(1, 3 * RATE, RATE);
          const random = Math.random;
          Math.random = seeded(7 + k * 7919);
          try {
            voice(ac, ac.destination, 0.01);
          } finally {
            Math.random = random;
          }
          runs.push(measure((await ac.startRendering()).getChannelData(0)));
        }
        const rms = runs.map((run) => run.rms).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
        return { rms, peak: Math.max(...runs.map((run) => run.peak)) };
      };
      const { SFX } = await import('/src/theme/host/sfx.ts');
      const { steelVoice } = await import('/src/wheel/sound.ts');
      const recorded = await import('/src/theme/host/recorded.ts');
      // A recorded voice: every take, the median loudness and the highest peak.
      const renderTakes = async (theme, voice) => {
        await recorded.loadRecorded(theme);
        const runs = [];
        for (let k = 0; k < recorded.recordedTakes(theme, voice); k++) {
          const ac = new OfflineAudioContext(1, 3 * RATE, RATE);
          recorded.recordedVoice(theme, voice, k)(ac, ac.destination, 0.01, SFX);
          runs.push(measure((await ac.startRendering()).getChannelData(0)));
        }
        const rms = runs.map((run) => run.rms).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
        return { rms, peak: Math.max(...runs.map((run) => run.peak)) };
      };
      const catalog = (await import('/src/theme/catalog.json')).default;
      const out = { steel: {} };
      for (const [voice, sound] of [
        ['open', 'open'],
        ['tick', 'tick'],
        ['enter', 'enter'],
        ['leave', 'leave'],
        ['success', 'apply'],
      ])
        out.steel[voice] = recorded.hasRecorded('steel', voice)
          ? await renderTakes('steel', voice)
          : await render(steelVoice(sound));
      const packs = new Map();
      for (const entry of catalog) {
        if (!entry.pack) continue;
        if (!packs.has(entry.pack)) {
          const module = await import(`/src/theme/packs/${entry.pack}/theme.js`);
          const concepts = [];
          module.default({ define: (concept) => concepts.push(concept), DEFAULT_PAIRS: [] });
          packs.set(entry.pack, concepts);
        }
        const sounds = packs.get(entry.pack).find((concept) => concept.id === entry.id)?.sounds ?? {};
        out[entry.id] = {};
        for (const voice of ['open', 'tick', 'enter', 'leave', 'success'])
          if (recorded.hasRecorded(entry.id, voice)) out[entry.id][voice] = await renderTakes(entry.id, voice);
          else if (sounds[voice]) out[entry.id][voice] = await render((ac, dest, t) => sounds[voice](ac, dest, t, SFX));
      }
      return out;
    },
    { takes: TAKES },
  );
} finally {
  await browser.close();
  await server.close();
}

const levels = {};
const rows = [];
for (const [theme, voices] of Object.entries(measured)) {
  levels[theme] = {};
  for (const [voice, { rms, peak }] of Object.entries(voices)) {
    const gain = Math.min(TARGET[voice] - rms, CEILING - peak);
    levels[theme][voice] = Math.round(Math.min(LIMITS[1], Math.max(LIMITS[0], gain)) * 10) / 10;
    rows.push([theme, voice, rms, peak, levels[theme][voice]]);
  }
}
const text = `${JSON.stringify(levels, null, 2)}\n`;
if (check) {
  // The voices are drawn with the same chances every run, so the table comes out the same; a small
  // difference (another Chromium) is allowed.
  const kept = JSON.parse(readFileSync(file, 'utf8'));
  const off = rows.filter(([theme, voice, , , gain]) => !(Math.abs((kept[theme]?.[voice] ?? NaN) - gain) <= 0.5));
  const extra = Object.entries(kept).flatMap(([theme, voices]) =>
    Object.keys(voices)
      .filter((voice) => levels[theme]?.[voice] === undefined)
      .map((voice) => `${theme} ${voice}`),
  );
  if (off.length || extra.length) {
    for (const [theme, voice, , , gain] of off)
      console.error(`${theme} ${voice}: ${kept[theme]?.[voice] ?? 'missing'}, the voice gives ${gain}`);
    for (const each of extra) console.error(`${each}: no such voice`);
    console.error('src/theme/levels.json is out of date: run npm run theme:levels');
    process.exit(1);
  }
  console.log(`src/theme/levels.json matches ${rows.length} voices`);
} else {
  writeFileSync(file, text);
  const spread = (voice) => rows.filter((row) => row[1] === voice).map((row) => row[4]);
  for (const voice of Object.keys(TARGET)) {
    const gains = spread(voice);
    console.log(`${voice}: ${gains.length} voices, gains ${Math.min(...gains)} to ${Math.max(...gains)} dB`);
  }
  console.log(`${path.relative(root, file)}: ${rows.length} voices`);
}
