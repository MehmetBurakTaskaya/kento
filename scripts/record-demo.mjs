// SPDX-License-Identifier: MIT
// The README's demo GIFs, recorded from the app itself: Vite serves the page with the in-memory
// stand-in for the core, and headless Chromium plays the storyboard of scripts/demo/stage.mjs (a
// plain desktop of our own round Kento's real windows: the floating wheel, the corner card, the
// shelf and the main window). Every frame is taken as a PNG through the DevTools screencast, then
// FFmpeg (on the PATH) turns them into a looping GIF with one palette for the whole take. The take
// plays three times slower than life (timers, frames and animations alike) and the frames are timed
// back, so a busy computer still gives every animation its frames.
//
// The same stage gives the README's screenshots (docs/images/kento-*.webp). The themes reel
// (scripts/demo/themes.mjs) is recorded the same way, in the app's own page.
//
//   npm run demo                      everything, in English and Turkish
//   npm run demo -- --gif             only the GIFs: docs/images/kento-demo.gif and kento-demo-tr.gif
//   npm run demo -- --stills          only the screenshots
//   npm run demo -- --themes          only the themes reel: docs/images/kento-themes.gif and -tr.gif
//   npm run demo -- --lang tr         one language
//   npm run demo -- --config file     another Vite config file
//
// Frames, screenshots at full size and the FFmpeg lists go to artifacts/demo (not committed). A
// take lasts about three minutes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'artifacts', 'demo');
const images = path.join(root, 'docs', 'images');

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const languages = (option('--lang') ?? 'en,tr').split(',');
const only = args.includes('--stills')
  ? 'stills'
  : args.includes('--gif')
    ? 'gif'
    : args.includes('--themes')
      ? 'themes'
      : null;

/** The size of the stage and of the GIF, the GIF's frame rate and the scale of its ordered dither
 *  (5: the least visible pattern and the smallest file, at the cost of a little banding). */
const WIDTH = 960;
const HEIGHT = 600;
const FPS = 18;
const BAYER = 5;
/** How much slower than life a take plays, and the shortest time (in the demo's seconds) between
 *  two frames kept. */
const SLOW = 3;
const STEP = 1 / 36;

/** Slows a page's clock by `slow`: its timers, its animation frames, Date.now and performance.now.
 *  Runs in every frame before the frame's own scripts. */
function slowClock(slow) {
  const now = performance.now.bind(performance);
  const origin = now();
  const dateNow = Date.now.bind(Date);
  const dateOrigin = dateNow();
  const timeout = window.setTimeout.bind(window);
  const interval = window.setInterval.bind(window);
  const frame = window.requestAnimationFrame.bind(window);
  performance.now = () => origin + (now() - origin) / slow;
  Date.now = () => dateOrigin + (dateNow() - dateOrigin) / slow;
  window.setTimeout = (handler, ms = 0, ...rest) => timeout(handler, ms * slow, ...rest);
  window.setInterval = (handler, ms = 0, ...rest) => interval(handler, ms * slow, ...rest);
  // The slower clock's time, whatever the frame's own timestamp follows.
  window.requestAnimationFrame = (callback) => frame(() => callback(performance.now()));
}

/** Loads the demo's additions into the stand-in, before the page asks it anything. */
const standIn = {
  name: 'kento-demo-stand-in',
  apply: 'serve',
  transform(code, id) {
    if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/ipc.ts')) return null;
    return `import { demoStandIn } from '/scripts/demo/stand-in.mjs';\n${code}\ndemoStandIn(api);\n`;
  },
};

const server = await createServer({
  root,
  configFile: option('--config') ? path.resolve(option('--config')) : undefined,
  cacheDir: path.join(work, 'vite-cache'),
  logLevel: 'error',
  plugins: [standIn],
  server: { port: 1440, strictPort: false },
});
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const errors = [];

/** A stage with every window loaded. A window that failed to load (the dev server can drop a
 *  request on a busy computer) costs a fresh page, twice at most. */
async function openStage(lang, still = false, dark = false, attempt = 1, reel = false) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: still ? 2 : 1 });
  if (!still) await page.addInitScript(slowClock, SLOW);
  const problems = [];
  page.on('pageerror', (error) => problems.push(`${lang}: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && problems.push(`${lang}: ${message.text()}`));
  const query = new URLSearchParams({ lang, ...(still && { still: '1' }), ...(dark && { appearance: 'dark' }) });
  try {
    if (reel) {
      await page.goto(`${base}?surface=wheel&lang=${lang}&appearance=light&theme=steel`);
      await page.waitForFunction(() => document.documentElement.dataset.surface, null, { timeout: 60_000 });
      await page.evaluate(() => import('/scripts/demo/themes.mjs'));
    } else {
      await page.goto(`${base}scripts/demo/stage.html?${query}`);
    }
    await page.waitForFunction(() => window.demo, null, { timeout: 60_000 });
    await page.evaluate(() => window.demo.ready);
  } catch (error) {
    await page.close();
    if (attempt === 3) throw new Error([error.message, ...problems].join('\n'), { cause: error });
    console.warn(`${lang}: the stage did not load (${error.message.split('\n')[0]}); trying again`);
    console.warn(problems.join('\n'));
    return openStage(lang, still, dark, attempt + 1, reel);
  }
  page.on('close', () => errors.push(...problems));
  return page;
}

/** Plays the storyboard once, slowed down, and keeps the frames the compositor makes with their
 *  time in the demo's seconds: one at most every STEP, and always the last before a pause. */
async function record(lang, reel = false) {
  const dir = path.join(work, reel ? `themes-${lang}` : lang);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await openStage(lang, false, false, 1, reel);
  const cdp = await page.context().newCDPSession(page);
  // CSS animations, transitions and the Web Animations of every frame follow the slower clock.
  // (Without Animation.enable, which would keep every animation for the inspector.)
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });
  const frames = [];
  let pending = null;
  const keep = ({ data, time }) => {
    const file = `f${String(frames.length).padStart(5, '0')}.png`;
    writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
    frames.push({ file, time });
  };
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const time = metadata.timestamp / SLOW;
    if (pending && (!frames.length || time - frames[frames.length - 1].time >= STEP)) keep(pending);
    pending = { data, time, arrived: Date.now() };
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  const marks = await page.evaluate(() => window.demo.play());
  // The last frame stands until the take ends.
  const end = pending ? pending.time + (Date.now() - pending.arrived) / 1000 / SLOW : 0;
  if (pending) keep(pending);
  const length = marks[marks.length - 1][1];
  const scenes = marks.slice(0, -1).map(([name, at], i) => `${at.toFixed(1)}–${marks[i + 1][1].toFixed(1)} s ${name}`);
  console.log(`${lang}:\n  ${scenes.join('\n  ')}`);
  await cdp.send('Page.stopScreencast');
  await page.close();
  if (frames.length < 2) throw new Error(`${lang}: the screencast gave ${frames.length} frames`);

  // Each frame stands until the next one; the last until the end of the take.
  const list = ['ffconcat version 1.0'];
  frames.forEach((frame, i) => {
    const next = frames[i + 1]?.time ?? end;
    list.push(`file '${frame.file}'`, `duration ${Math.max(0.001, next - frame.time).toFixed(4)}`);
  });
  list.push(`file '${frames[frames.length - 1].file}'`);
  writeFileSync(path.join(dir, 'frames.ffconcat'), `${list.join('\n')}\n`);
  console.log(`${lang}: ${frames.length} frames over ${length.toFixed(1)} s`);
  return dir;
}

/** One palette for the whole take, weighted to what moves (a first pass), then the frames in it:
 *  ordered dithering keeps still parts still from frame to frame, and only the changed rectangle
 *  of each frame is stored. */
function gif(dir, out) {
  const input = ['-f', 'concat', '-safe', '0', '-i', 'frames.ffconcat'];
  const ffmpeg = (...rest) =>
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...input, ...rest], { cwd: dir, stdio: 'inherit' });
  ffmpeg('-vf', `fps=${FPS},palettegen=max_colors=256:stats_mode=diff`, 'palette.png');
  ffmpeg(
    '-i',
    'palette.png',
    '-lavfi',
    `fps=${FPS}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=${BAYER}:diff_mode=rectangle`,
    '-loop',
    '0',
    out,
  );
  console.log(`${path.relative(root, out)}: ${(statSync(out).size / 1e6).toFixed(2)} MB`);
}

/** The README's screenshots, each from a fresh stage at twice the pixels, as WebP 1280 pixels
 *  wide. */
const STILLS = ['wheel', 'tools-dark', 'home', 'library-dark', 'compress', 'automation'];
async function stills(lang) {
  for (const name of STILLS) {
    const page = await openStage(lang, true, name.endsWith('-dark'));
    const clip = await page.evaluate((which) => window.demo.still(which), name);
    const png = path.join(work, `${name}-${lang}.png`);
    await page.screenshot({ path: png, clip });
    await page.close();
    const out = path.join(images, `kento-${name}${lang === 'en' ? '' : `-${lang}`}.webp`);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      png,
      '-vf',
      'scale=1280:-1:flags=lanczos',
      '-c:v',
      'libwebp',
      '-quality',
      '90',
      out,
    ]);
    console.log(`${path.relative(root, out)}: ${Math.round(statSync(out).size / 1000)} kB`);
  }
}

try {
  mkdirSync(images, { recursive: true });
  mkdirSync(work, { recursive: true });
  for (const lang of languages) {
    const suffix = lang === 'en' ? '' : `-${lang}`;
    if (!only || only === 'stills') await stills(lang);
    if (!only || only === 'gif') gif(await record(lang), path.join(images, `kento-demo${suffix}.gif`));
    if (only === 'themes') gif(await record(lang, true), path.join(images, `kento-themes${suffix}.gif`));
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
