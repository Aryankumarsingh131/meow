/**
 * Visual capture harness for the JalSakshi mobile screens.
 *
 * Drives the Expo **web** build (react-native-web) in a real browser and
 * saves screenshots. Uses the system-installed Microsoft Edge via Playwright's
 * `channel` option, so no browser binary is downloaded.
 *
 * This is developer tooling, not app code and not a task deliverable. It is
 * NOT a substitute for the device screen recording T07/T08 require: this is
 * react-native-web in a desktop browser, not the Android build on a phone.
 *
 * Prerequisite: the dev server must already be running --
 *   cd apps/mobile && npx expo start --web --port 8081
 *
 * Run:  node tools/screenshot.mjs
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.APP_URL ?? 'http://localhost:8081';
const OUT = 'docs/evidence/screenshots';

// Pixel 7-ish viewport so the layout is exercised at a realistic phone size.
const VIEWPORT = { width: 412, height: 915 };

/** Each entry: [filename, human label, async (page) => void]. */
const SHOTS = [
  ['t07-sources-list', 'T07 S02 — source list + cached history staleness label', async () => {}],
  [
    't07-sources-search',
    'T07 S02 — search filters the cached catalogue',
    async (page) => {
      await page.getByLabel('Search sources').fill('Rampur');
      await page.waitForTimeout(300);
    },
  ],
  [
    't07-sources-no-match',
    'T07 S02 — search with no match (empty state, not an error)',
    async (page) => {
      await page.getByLabel('Search sources').fill('zzzz');
      await page.waitForTimeout(300);
    },
  ],
  [
    't08-protocol-steps',
    'T08 S03 — manufacturer/lot/expiry + one instruction per step',
    async (page) => {
      await page.getByTestId('tab-protocol').click();
      await page.waitForTimeout(300);
    },
  ],
  [
    't08-protocol-timer-waiting',
    'T08 S03 — timer started, waiting for the read window to open',
    async (page) => {
      await page.getByTestId('tab-protocol').click();
      await page.getByText('Start read-window timer').click();
      await page.waitForTimeout(1500);
    },
  ],
  [
    't08-timer-waiting-countdown',
    'T08 S03 — countdown before the read window opens (fast fixture)',
    async (page) => {
      await page.getByTestId('tab-protocol-fast').click();
      await page.getByText('Start read-window timer').click();
      // prepare=2s, window opens at 4s. Land inside the countdown.
      await page.waitForTimeout(2600);
    },
  ],
  [
    't08-timer-in-window',
    'T08 S03 — inside the read window, capture permitted (fast fixture)',
    async (page) => {
      await page.getByTestId('tab-protocol-fast').click();
      await page.getByText('Start read-window timer').click();
      // window is 6s ± 2s => [4s, 8s]. Land at ~6s.
      await page.waitForTimeout(6000);
    },
  ],
  [
    't08-timer-expired',
    'T08 S03 — past invalid_after: too late to read, new test required',
    async (page) => {
      await page.getByTestId('tab-protocol-fast').click();
      await page.getByText('Start read-window timer').click();
      // invalid_after = 12s. Land well past it.
      await page.waitForTimeout(13500);
    },
  ],
  [
    't08-protocol-blocked-expired',
    'T08 S03 — expired + unverified lot blocks assisted reading, manual stays open',
    async (page) => {
      await page.getByTestId('tab-protocol-blocked').click();
      await page.waitForTimeout(300);
    },
  ],
];

const browser = await chromium.launch({ channel: 'msedge' });
await mkdir(OUT, { recursive: true });

let failures = 0;
for (const [name, label, drive] of SHOTS) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120_000 });
    // Wait for React to actually mount something, not just for the HTML shell.
    await page.waitForSelector('text=DEMO HARNESS', { timeout: 60_000 });
    await drive(page);
    await page.screenshot({ path: `${OUT}/${name}.png` });

    // A screenshot of a blank page is a failure to launch, not evidence.
    const bodyText = (await page.textContent('body')) ?? '';
    if (bodyText.trim().length < 40) throw new Error('page rendered almost no text');

    console.log(`  ok   ${name.padEnd(30)} ${label}`);
    if (errors.length) console.log(`       page errors: ${errors.slice(0, 2).join(' | ')}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name.padEnd(30)} ${error.message.split('\n')[0]}`);
    if (errors.length) console.error(`       page errors: ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await context.close();
  }
}

await browser.close();
console.log(`\n${SHOTS.length - failures}/${SHOTS.length} screenshots captured -> ${OUT}/`);
if (failures > 0) process.exit(1);
