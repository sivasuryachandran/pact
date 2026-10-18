// Screenshots every simulated screen and measures the firefly's wingspan.
// Usage: PACT_URL=http://127.0.0.1:8799 node scripts/shoot-screens.mjs [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.PACT_URL || 'http://127.0.0.1:8787';
const OUT = process.argv[2] || 'docs/screens';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const consoleErrors = [];
const results = { base: BASE, sizes: {}, consoleErrors };

/** Wing-coloured pixels (saturated blue/violet, bright) -> bbox width/height in px, ignoring sparse dust. */
const measure = (page, png) => page.evaluate(async (b64) => {
  const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  const cols = new Uint16Array(width), rows = new Uint16Array(height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * height * 0 + y * width + x) * 4, r = data[i], gg = data[i + 1], b = data[i + 2];
    if (b > 110 && b > r * 1.5 && b > gg * 1.05) { cols[x]++; rows[y]++; }
  }
  // dust specks are 1-3 px; wing columns/rows hold many matching pixels
  const span = (arr, min) => { let a = -1, z = -1; for (let i = 0; i < arr.length; i++) if (arr[i] >= min) { if (a < 0) a = i; z = i; } return a < 0 ? null : [a, z]; };
  const xs = span(cols, 8), ys = span(rows, 8);
  return xs && ys ? { x0: xs[0], x1: xs[1], y0: ys[0], y1: ys[1], w: xs[1] - xs[0], h: ys[1] - ys[0] } : null;
}, png.toString('base64'));

for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${w}x${h}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${w}x${h}: ${e.message}`));
  const probe = await ctx.newPage();
  await probe.goto('about:blank');

  const load = async (demo = 'resolved') => {
    // plan card matches what the firefly is showing: fresh plan, waiting on Dad, or resolved plan
    await page.goto(`${BASE}/?screen=tv&still&demo=${demo}`);
    await page.waitForFunction(() => window.__signal, null, { timeout: 15000 });
  };
  const adv = (s) => page.evaluate((t) => window.__signal.advance(t), s);
  const mode = () => page.evaluate(() => window.__signal.getMode());
  const shot = async (name) => { const png = await page.screenshot({ path: `${OUT}/tv-${w}-${name}.png` }); return png; };
  const frac = (m) => (m ? +(m.w / h * 100).toFixed(1) : null);
  const leftEdge = () => page.evaluate(() => { const r = document.querySelector('.tv-left'); const t = [...r.querySelectorAll('.tv-time,.tv-date,.tv-status,.tv-sub')].map((e) => e.getBoundingClientRect().right); return Math.max(...t); });
  const size = (results.sizes[`${w}x${h}`] = { roam: {}, hover: {} });

  await load();
  // roaming: sample 80 s of flight, one measurement per second
  const roam = [];
  await adv(2);
  for (let i = 0; i < 80; i++) { await adv(1); if (i % 2) { const m = await measure(probe, await page.screenshot()); if (m) roam.push(frac(m)); } }
  roam.sort((a, b) => a - b);
  size.roam = { samples: roam.length, minPctOfHeight: roam[0], medianPctOfHeight: roam[Math.floor(roam.length / 2)], maxPctOfHeight: roam[roam.length - 1] };
  await load(); await adv(3.5); await shot('roam');

  // hover states: measure wing span across a flap cycle, plus clearance from the clock block
  const hover = async (name, setup, t, demo) => {
    await load(demo); await adv(1); await setup(); await adv(t);
    const spans = [], lefts = [];
    for (let i = 0; i < 12; i++) { const m = await measure(probe, await page.screenshot()); if (m) { spans.push(frac(m)); lefts.push(m.x0); } await adv(0.06); }
    spans.sort((a, b) => a - b);
    const clock = await leftEdge();
    await shot(name);
    size.hover[name] = { mode: await mode(), minPct: spans[0], medianPct: spans[spans.length / 2 | 0], maxPct: spans.at(-1), wingLeftMinPx: Math.min(...lefts), clockBlockRightPx: Math.round(clock), clearOfClock: Math.min(...lefts) > clock };
  };
  await hover('listen', () => page.evaluate(() => window.__signal.wake()), 5);
  await hover('think', async () => { await page.evaluate(() => window.__signal.wake()); await adv(5); await page.evaluate(() => window.__signal.think()); }, 2.2);
  for (const d of ['allowed', 'approval', 'denied']) {
    await hover(`respond-${d}`, async () => {
      await page.evaluate(() => window.__signal.wake()); await adv(5); await page.evaluate(() => window.__signal.think()); await adv(2);
      await page.evaluate((x) => { window.__setShown(x); window.__signal.respond(x); }, d);
    }, 0.8, { allowed: 'fresh', approval: 'asking', denied: 'resolved' }[d]);
  }
  await ctx.close();
}

// phone and tablet
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`phone: ${m.text()}`); });
  await page.goto(`${BASE}/?screen=phone&demo=asking`); await page.waitForSelector('.approval');
  await page.screenshot({ path: `${OUT}/phone-approval.png` });
  await page.goto(`${BASE}/?screen=phone&demo=resolved`); await page.waitForSelector('.approval');
  await page.screenshot({ path: `${OUT}/phone-clear.png` });
  await ctx.close();
  const t = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  const tp = await t.newPage();
  tp.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`tablet: ${m.text()}`); });
  await tp.goto(`${BASE}/?screen=tablet&demo=resolved`); await tp.waitForSelector('.step');
  await tp.screenshot({ path: `${OUT}/tablet.png` });
  await t.close();
}

writeFileSync(`${OUT}/measurements.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
