// Print jalsakshi-first-review.html to PDF and PNG previews; report any page whose content overflows.
//   node render.mjs            (uses installed Google Chrome through playwright-core)
import { chromium } from '../../../node_modules/playwright-core/index.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1123, height: 794 }, deviceScaleFactor: 1.5 });
await page.goto(pathToFileURL(path.join(here, 'jalsakshi-first-review.html')).href, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });

const problems = await page.evaluate(() => {
  const res = [];
  document.querySelectorAll('section.page').forEach((s, i) => {
    const box = s.getBoundingClientRect();
    const limit = box.bottom - parseFloat(getComputedStyle(s).paddingBottom) + 2;
    let worst = 0;
    s.querySelectorAll('*').forEach(el => { const b = el.getBoundingClientRect(); if (b.height && b.bottom > worst) worst = b.bottom; if (b.right > box.right + 1) res.push(`page ${i + 1}: horizontal overflow <${el.tagName}>`); });
    if (worst > limit) res.push(`page ${i + 1}: content ${Math.round(worst - limit)}px past the bottom margin`);
    s.querySelectorAll('img').forEach(im => { if (!im.complete || !im.naturalWidth) res.push(`page ${i + 1}: missing image ${im.src}`); });
  });
  return [...new Set(res)];
});
console.log(problems.length ? problems.join('\n') : 'layout check: no overflow, no missing images');

await page.pdf({ path: path.join(out, 'jalsakshi-first-review.pdf'), preferCSSPageSize: true, printBackground: true });
mkdirSync(path.join(out, 'preview'), { recursive: true });
const n = await page.locator('section.page').count();
for (let i = 0; i < n; i++) {
  await page.locator('section.page').nth(i).screenshot({ path: path.join(out, 'preview', `page-${String(i + 1).padStart(2, '0')}.png`) });
}
console.log(`pages: ${n}`);
await browser.close();
