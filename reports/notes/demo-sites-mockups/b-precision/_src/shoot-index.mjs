import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/Users/lp1/.local/lib/node_modules/@playwright/cli/package.json');
const { chromium } = require('playwright-core');
const root = path.resolve(import.meta.dirname, '..');
const b = await chromium.launch();
for (const [w, h, f] of [[1440, 900, 'index'], [390, 844, 'index-movil']]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  await p.goto(`file://${root}/index.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(root, `shots/full/${f}-full.png`), fullPage: true });
  console.log(f, await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
}
await b.close();
